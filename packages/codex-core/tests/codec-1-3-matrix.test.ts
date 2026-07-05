/**
 * codex-core canonical envelope codec — exhaustive 1.2 / 1.3 matrix.
 *
 * FUNDS-CRITICAL. This is the RED author for the ported canonical codec:
 * buildCodexExport / serializeCodex / deserializeCodex plus the 1.3
 * foreignKeys keyring block. Every row below is an explicit acceptance
 * criterion — the writer/reader must never drop, reorder, blank, or leak
 * an encrypted keyfile, because each `encryptedKeyfile` is the only copy
 * of a user's foreign-chain (e.g. Arweave) key material inside the backup.
 *
 * Post-flip contract (D2 — codec envelope move):
 *   - There is NO 1.2 WRITER anymore. buildCodexExport always stamps "1.3".
 *     1.2 is READ-ONLY: historical `OuronetCodex_*.json` files must still
 *     deserialize clean, and restore with `foreignKeys` ABSENT (D4).
 *   - `foreignKeys` is OMITTED entirely when the codex has no foreign keys.
 *     An empty block `{schemaVersion:1,keys:[]}` is DISTINCT from omission —
 *     both are valid on read.
 *
 * Pinned contract (T6.2 / T6.3 must satisfy):
 *   ForeignKeyEntry  = { id: string; label?: string; chainId: string; encryptedKeyfile: string }  // label OPTIONAL
 *   ForeignKeysBlock = { schemaVersion: number; keys: ForeignKeyEntry[] }
 *   Each `encryptedKeyfile` is an already-encrypted ciphertext string — never plaintext.
 *
 * Pure unit tests — no WebCrypto, no fs, no network.
 */

import { describe, it, expect } from "vitest";
import {
  buildCodexExport,
  serializeCodex,
  deserializeCodex,
  CodexError,
  CodexUnknownFieldError,
  type CodexExportV1_2,
  type CodexExportV1_3,
  type ForeignKeyEntry,
  type PlaintextCodex,
} from "../src";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// A hand-built valid "1.2" envelope literal, shaped like a real historical
// OuronetUI export. NO foreignKeys (1.2 predates the keyring block).
function make12Envelope(): Record<string, unknown> {
  return {
    version: "1.2",
    exportedAt: "2026-04-22T07:23:01.234Z",
    kadenaWallets: [
      { id: "seed-a", name: "Main seed", seedType: "koala", secret: "encrypted-blob-v2-here", main: "k:abc", accounts: [] },
    ],
    ouronetWallets: [
      { id: "acct-1", name: "Resident", address: "ouro:AB-XYZ", guard: { pred: "keys-all", keys: ["pub1"] }, secret: "enc-secret" },
    ],
    addressBook: [
      { id: "ab-1", label: "Friend", address: "ouro:FRIEND" },
    ],
    uiSettings: { infoZoneOpen: true, zbomExecutePosition: "top" },
  };
}

// FROZEN byte-exact 1.2 wire-shape golden. This is the canonical 1.2 fixture
// that T6.5 replays against the same reader (StoaWallet's importCodex) — the
// two readers must agree on THIS EXACT string, so do not fork a second golden.
// It is a copy of a real historical OuronetCodex_*.json "1.2" top-level shape.
const GOLDEN_12_WIRE = JSON.stringify(
  {
    version: "1.2",
    exportedAt: "2026-01-13T00:00:00.000Z",
    kadenaWallets: [
      { id: "seed-golden", name: "Golden seed", seedType: "chainweaver", secret: "enc:v2:golden-seed-blob", main: "k:golden", accounts: [] },
    ],
    ouronetWallets: [
      { id: "acct-golden", name: "Golden resident", address: "ouro:GOLDEN", guard: { pred: "keys-all", keys: ["pubG"] }, secret: "enc:golden-acct" },
    ],
    addressBook: [{ id: "ab-golden", label: "GoldenFriend", address: "ouro:GFRIEND" }],
    uiSettings: { infoZoneOpen: false, dockPosition: "left" },
  },
  null,
  2,
);

// The bare foreignKeys SOURCE (a ForeignKeyEntry[]) that the WRITER receives.
// ≥2 entries; one WITH label, one WITHOUT (labelless entries are valid — E1).
function makeForeignKeyEntries(): ForeignKeyEntry[] {
  return [
    { id: "fk-ar-1", label: "Arweave main", chainId: "arweave:mainnet", encryptedKeyfile: "enc:AR-keyfile-blob-1" },
    { id: "fk-ar-2", chainId: "arweave:mainnet", encryptedKeyfile: "enc:AR-keyfile-blob-2" },
  ];
}

// A PlaintextCodex-shaped fixture the WRITER consumes. Carries a bare
// ForeignKeyEntry[] as its foreignKeys source; buildCodexExport must emit
// the { schemaVersion, keys } block wrapping these entries verbatim.
function makeCodexWithForeignKeys(): PlaintextCodex {
  return {
    kadenaWallets: [{ id: "seed-a", secret: "enc-seed" }],
    ouronetWallets: [{ id: "acct-1", secret: "enc-acct" }],
    addressBook: [{ id: "ab-1", label: "Friend", address: "ouro:FRIEND" }],
    pureKeypairs: [],
    uiSettings: { infoZoneOpen: true },
    schemaVersion: 1,
    lastUpdatedAt: "2026-04-22T00:00:00Z",
    lastUpdatedDevice: "dev",
    foreignKeys: makeForeignKeyEntries(),
  };
}

// A PlaintextCodex-shaped fixture with NO foreign keys — writer must OMIT
// the foreignKeys property entirely (not emit an empty block).
function makeCodexNoForeignKeys(): PlaintextCodex {
  return {
    kadenaWallets: [{ id: "seed-a", secret: "enc-seed" }],
    ouronetWallets: [{ id: "acct-1", secret: "enc-acct" }],
    addressBook: [],
    pureKeypairs: [],
    uiSettings: { infoZoneOpen: true },
    schemaVersion: 1,
    lastUpdatedAt: null,
    lastUpdatedDevice: "dev",
  };
}

// A valid "1.3" envelope literal builder. `foreignKeys` param controls the block.
function make13Envelope(foreignKeys?: unknown): Record<string, unknown> {
  const env: Record<string, unknown> = {
    version: "1.3",
    exportedAt: "2026-07-04T00:00:00.000Z",
    kadenaWallets: [{ id: "seed-a", secret: "enc-seed" }],
    ouronetWallets: [{ id: "acct-1", secret: "enc-acct" }],
    addressBook: [],
    uiSettings: { infoZoneOpen: true },
  };
  if (foreignKeys !== undefined) env.foreignKeys = foreignKeys;
  return env;
}

// ─── (1a) 1.2 PARSE (reader-only; NOT a round-trip — no 1.2 writer post-flip) ──

describe("(1a) 1.2 PARSE — reader restores a historical 1.2 envelope with foreignKeys ABSENT", () => {
  // 1.2 WRITER coverage is intentionally dropped: there is no 1.2 writer after
  // the flip. This asserts the READER still accepts the historical shape and
  // that a 1.2 restore surfaces NO foreignKeys (D4: 1.2 has no keyring block).
  it("deserializes a valid 1.2 literal clean and round-trips the four collections unchanged", () => {
    const env = make12Envelope();
    const parsed = deserializeCodex(JSON.stringify(env));
    expect(parsed.version).toBe("1.2");
    expect(parsed.kadenaWallets).toEqual(env.kadenaWallets);
    expect(parsed.ouronetWallets).toEqual(env.ouronetWallets);
    expect(parsed.addressBook).toEqual(env.addressBook);
    expect(parsed.uiSettings).toEqual(env.uiSettings);
  });

  it("restores a 1.2 envelope with NO foreignKeys property (1.2 predates the keyring block — D4)", () => {
    const parsed = deserializeCodex(JSON.stringify(make12Envelope()));
    expect(parsed).not.toHaveProperty("foreignKeys");
  });
});

// ─── (1b) 1.2 WIRE-SHAPE GOLDEN (frozen; T6.5 replays THIS fixture) ────────────

describe("(1b) 1.2 WIRE-SHAPE GOLDEN — field-complete deserialize pins the exact 1.2 wire shape", () => {
  // The frozen `GOLDEN_12_WIRE` string replaces the lost 1.2 writer round-trip.
  // T6.5's reader must deserialize the SAME string identically — this is the
  // shared golden. Every 1.2 top-level field must survive; none dropped.
  it("deserializes the frozen 1.2 golden with every top-level field present (none dropped)", () => {
    const source = JSON.parse(GOLDEN_12_WIRE);
    const parsed = deserializeCodex(GOLDEN_12_WIRE) as CodexExportV1_2;
    expect(parsed.version).toBe("1.2");
    expect(parsed.exportedAt).toBe(source.exportedAt);
    expect(parsed.kadenaWallets).toEqual(source.kadenaWallets);
    expect(parsed.ouronetWallets).toEqual(source.ouronetWallets);
    expect(parsed.addressBook).toEqual(source.addressBook);
    expect(parsed.uiSettings).toEqual(source.uiSettings);
    expect(parsed).not.toHaveProperty("foreignKeys");
  });
});

// ─── (2) 1.2 → 1.3 FORWARD (reader accepts 1.2; writer now stamps 1.3) ─────────

describe("(2) 1.2 → 1.3 FORWARD — writer stamps 1.3 with no foreignKeys when input has none", () => {
  it("deserializes the 1.2 literal clean", () => {
    const parsed = deserializeCodex(JSON.stringify(make12Envelope()));
    expect(parsed.version).toBe("1.2");
  });

  it("buildCodexExport stamps version 1.3 (never 1.2) and omits foreignKeys when the codex has none", () => {
    const exp = buildCodexExport(makeCodexNoForeignKeys());
    expect(exp.version).toBe("1.3");
    expect(exp).not.toHaveProperty("foreignKeys");
  });
});

// ─── (3) 1.3 ROUND-TRIP (no foreign keys) ─────────────────────────────────────

describe("(3) 1.3 ROUND-TRIP — build → serialize → deserialize with no foreign keys", () => {
  it("round-trips a 1.3 export whose result has NO foreignKeys property", () => {
    const exp = buildCodexExport(makeCodexNoForeignKeys());
    const json = serializeCodex(makeCodexNoForeignKeys());
    const parsed = deserializeCodex(json);
    expect(exp.version).toBe("1.3");
    expect(parsed.version).toBe("1.3");
    expect(parsed).not.toHaveProperty("foreignKeys");
    expect(parsed.kadenaWallets).toEqual(exp.kadenaWallets);
    expect(parsed.ouronetWallets).toEqual(exp.ouronetWallets);
  });
});

// ─── (4) 1.3 EMPTY foreignKeys block (distinct from omitted) ───────────────────

describe("(4) 1.3 EMPTY foreignKeys — empty keys array deserializes clean, distinct from omission", () => {
  it("deserializes a 1.3 envelope with foreignKeys {schemaVersion:1,keys:[]} and yields an empty keys array", () => {
    const env = make13Envelope({ schemaVersion: 1, keys: [] });
    const parsed = deserializeCodex(JSON.stringify(env)) as CodexExportV1_3;
    expect(parsed.version).toBe("1.3");
    expect(parsed.foreignKeys).toBeDefined();
    expect(parsed.foreignKeys?.schemaVersion).toBe(1);
    expect(parsed.foreignKeys?.keys).toEqual([]);
  });
});

// ─── (5) 1.3 POPULATED foreignKeys (READER) ───────────────────────────────────

describe("(5) 1.3 POPULATED foreignKeys — reader round-trips entries byte-identical, shape-only (no decrypt)", () => {
  it("deserializes a populated 1.3 envelope and round-trips the entry byte-identical", () => {
    const entry: ForeignKeyEntry = { id: "fk-1", label: "Arweave", chainId: "arweave:mainnet", encryptedKeyfile: "enc:AR-keyfile-blob" };
    const env = make13Envelope({ schemaVersion: 1, keys: [entry] });
    const parsed = deserializeCodex(JSON.stringify(env)) as CodexExportV1_3;
    expect(parsed.foreignKeys?.keys).toHaveLength(1);
    expect(parsed.foreignKeys?.keys[0]).toEqual(entry);
  });

  it("validates entry SHAPE without decrypting (id/chainId/encryptedKeyfile are strings; label string when present)", () => {
    const entry: ForeignKeyEntry = { id: "fk-1", label: "Arweave", chainId: "arweave:mainnet", encryptedKeyfile: "enc:AR-keyfile-blob" };
    const env = make13Envelope({ schemaVersion: 1, keys: [entry] });
    const parsed = deserializeCodex(JSON.stringify(env)) as CodexExportV1_3;
    const k = parsed.foreignKeys!.keys[0];
    expect(typeof k.id).toBe("string");
    expect(typeof k.chainId).toBe("string");
    expect(typeof k.encryptedKeyfile).toBe("string");
    expect(typeof k.label).toBe("string");
    // The reader never decrypts: the ciphertext survives verbatim.
    expect(k.encryptedKeyfile).toBe("enc:AR-keyfile-blob");
  });

  it("deserializes a populated entry with label OMITTED clean (labelless entries are valid — E1)", () => {
    const entry: ForeignKeyEntry = { id: "fk-nolabel", chainId: "arweave:mainnet", encryptedKeyfile: "enc:AR-no-label-blob" };
    const env = make13Envelope({ schemaVersion: 1, keys: [entry] });
    const parsed = deserializeCodex(JSON.stringify(env)) as CodexExportV1_3;
    expect(parsed.foreignKeys?.keys[0]).toEqual(entry);
    expect(parsed.foreignKeys?.keys[0]).not.toHaveProperty("label");
  });
});

// ─── (5b) 1.3 POPULATED foreignKeys (WRITER — the funds-loss path) ─────────────

describe("(5b) 1.3 POPULATED foreignKeys WRITER — the single most funds-critical codepath", () => {
  // If the writer drops, reorders, or blanks a keyfile the user permanently
  // loses foreign-chain funds. deep-equal on the ORDERED array is the contract.
  it("emits foreignKeys.keys deep-equal to the input entries (no drop / reorder / blank) with schemaVersion present", () => {
    const codex = makeCodexWithForeignKeys();
    const inputEntries = codex.foreignKeys as ForeignKeyEntry[];
    const exp = buildCodexExport(codex) as CodexExportV1_3;
    expect(exp.version).toBe("1.3");
    expect(exp.foreignKeys).toBeDefined();
    expect(typeof exp.foreignKeys?.schemaVersion).toBe("number");
    expect(exp.foreignKeys?.keys).toEqual(inputEntries);
  });

  it("keeps keys byte-identical through serialize → deserialize (nothing lost on the wire)", () => {
    const codex = makeCodexWithForeignKeys();
    const inputEntries = codex.foreignKeys as ForeignKeyEntry[];
    const json = serializeCodex(codex);
    const parsed = deserializeCodex(json) as CodexExportV1_3;
    expect(parsed.foreignKeys?.keys).toEqual(inputEntries);
    // Order is load-bearing: entry[0] and entry[1] must not swap.
    expect(parsed.foreignKeys?.keys[0].id).toBe(inputEntries[0].id);
    expect(parsed.foreignKeys?.keys[1].id).toBe(inputEntries[1].id);
    expect(parsed.foreignKeys?.keys[1].encryptedKeyfile).toBe(inputEntries[1].encryptedKeyfile);
  });
});

// ─── (6) UNKNOWN FIELD THROWS ─────────────────────────────────────────────────

// INVARIANT: the allow-list is widened for `foreignKeys` AND `pureKeypairs` ONLY
// (still rejects a third unknown field). E1 (T11.7, FIX-2) added `pureKeypairs`
// alongside `foreignKeys` because the `useCodexBackup` rewire routes a backup
// carrying `pureKeypairs` through this reader — a fresh 1.3 backup that carried
// `pureKeypairs` would otherwise throw `CodexUnknownFieldError` and be
// UNRESTORABLE (funds loss). DO NOT narrow this back to "foreignKeys ONLY":
// deleting `pureKeypairs` from the accepted set re-breaks the rewire. The
// accepted keyring set the reader tolerates is {foreignKeys, pureKeypairs}; any
// OTHER top-level field still throws.
describe("(6) UNKNOWN FIELD — allow-list widened for foreignKeys AND pureKeypairs ONLY (still rejects a third unknown field)", () => {
  it("throws CodexUnknownFieldError and names bogusField", () => {
    const env = make13Envelope();
    env.bogusField = "x";
    const json = JSON.stringify(env);
    expect(() => deserializeCodex(json)).toThrow(CodexUnknownFieldError);
    expect(() => deserializeCodex(json)).toThrow(/bogusField/);
  });

  it("accepts pureKeypairs (a bare array) as a KNOWN field — it does NOT throw CodexUnknownFieldError (FIX-2 gate)", () => {
    const env = make13Envelope();
    env.pureKeypairs = [
      { id: "pk-1", publicKey: "a".repeat(64), encryptedPrivateKey: "ENC::pk", createdAt: "2025-01-01T00:00:00.000Z" },
    ];
    // No throw: pureKeypairs is in the widened allow-list alongside foreignKeys.
    expect(() => deserializeCodex(JSON.stringify(env))).not.toThrow();
  });

  it("still throws for a third unknown field even when both foreignKeys AND pureKeypairs are present (widened, not wide-open)", () => {
    const env = make13Envelope({ schemaVersion: 1, keys: [] });
    env.pureKeypairs = [];
    env.thirdUnknown = "nope";
    const json = JSON.stringify(env);
    expect(() => deserializeCodex(json)).toThrow(CodexUnknownFieldError);
    expect(() => deserializeCodex(json)).toThrow(/thirdUnknown/);
  });
});

// ─── (7) OUT-OF-SET VERSION THROWS (per-case) ─────────────────────────────────

describe("(7) OUT-OF-SET VERSION — each rejected version throws /unsupported version/i", () => {
  // Reader accepts ONLY exact "1.2" / "1.3". Everything else fails closed.
  // Near-miss strings must NOT be trimmed/normalized into an accepted value.
  const inSetParityCases: Array<[string, unknown]> = [
    ["1.1", "1.1"],
    ["1.4", "1.4"],
    ["2.0", "2.0"],
    ["near-miss ' 1.3 '", " 1.3 "],
    ["near-miss '1.3.0'", "1.3.0"],
    ["near-miss '1.30'", "1.30"],
    ["near-miss '1.3\\n'", "1.3\n"],
  ];

  it.each(inSetParityCases)("throws for version %s", (_label, version) => {
    const env = make13Envelope();
    env.version = version;
    expect(() => deserializeCodex(JSON.stringify(env))).toThrow(/unsupported version/i);
  });

  // READER-SPECIFIC cases: deserializeCodex has no upstream typeof gate, so a
  // missing / null / non-string version falls through to the unsupported-version
  // throw. StoaWallet's importCodex rejects these earlier as invalid-json, so
  // these are EXCLUDED from T6.5's shared parity subset (F-006).
  it("throws when version is MISSING (reader-specific — excluded from T6.5 shared parity, F-006)", () => {
    const env = make13Envelope();
    delete env.version;
    expect(() => deserializeCodex(JSON.stringify(env))).toThrow(/unsupported version/i);
  });

  it("throws when version is null (reader-specific — F-006)", () => {
    const env = make13Envelope();
    env.version = null;
    expect(() => deserializeCodex(JSON.stringify(env))).toThrow(/unsupported version/i);
  });

  it("throws when version is a non-string 123 (reader-specific — F-006)", () => {
    const env = make13Envelope();
    env.version = 123;
    expect(() => deserializeCodex(JSON.stringify(env))).toThrow(/unsupported version/i);
  });
});

// ─── (8) SECRET NEVER ECHOED ──────────────────────────────────────────────────

describe("(8) SECRET NEVER ECHOED — malformed-entry errors name the path but never the secret", () => {
  const SECRET = "SUPER-SECRET-KEYFILE-CIPHERTEXT-9f3a2b";

  it("names foreignKeys.keys[0].encryptedKeyfile path without echoing the secret substring", () => {
    // The offending entry's encryptedKeyfile is the wrong TYPE (number, not
    // string) so a shape error fires; but the value it would echo is the secret
    // — it must NOT appear in the thrown message. We inject a secret-looking
    // sibling value in a REQUIRED field to force the path-naming throw while
    // the secret string is present in the payload.
    const badEntry = { id: 123, label: "x", chainId: "arweave:mainnet", encryptedKeyfile: SECRET };
    const env = make13Envelope({ schemaVersion: 1, keys: [badEntry] });
    let caught: unknown;
    try {
      deserializeCodex(JSON.stringify(env));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toMatch(/foreignKeys\.keys\[0\]/);
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain("9f3a2b");
  });

  it("parallel top-level malformed field: names kadenaWallets without echoing its secret-looking value", () => {
    const env = make13Envelope();
    env.kadenaWallets = SECRET;
    let caught: unknown;
    try {
      deserializeCodex(JSON.stringify(env));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toMatch(/kadenaWallets/);
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain("9f3a2b");
  });
});

// ─── (9) foreignKeys SHAPE VALIDATION THROWS ──────────────────────────────────

describe("(9) foreignKeys SHAPE VALIDATION — malformed block throws naming the bad path, no value echo", () => {
  it("throws when foreignKeys is not an object (string variant), naming foreignKeys", () => {
    const env = make13Envelope("not-an-object");
    expect(() => deserializeCodex(JSON.stringify(env))).toThrow(/foreignKeys/);
  });

  it("throws when foreignKeys.keys is not an array, naming foreignKeys.keys", () => {
    const env = make13Envelope({ schemaVersion: 1, keys: "not-an-array" });
    expect(() => deserializeCodex(JSON.stringify(env))).toThrow(/foreignKeys\.keys/);
  });

  it("throws when a key entry is missing its required id, naming the offending path", () => {
    const env = make13Envelope({ schemaVersion: 1, keys: [{ chainId: "arweave:mainnet", encryptedKeyfile: "enc:blob" }] });
    expect(() => deserializeCodex(JSON.stringify(env))).toThrow(/foreignKeys\.keys\[0\]/);
  });
});

// ─── (10) ERROR HIERARCHY — CodexUnknownFieldError extends the shared base ─────

describe("(10) ERROR HIERARCHY — CodexUnknownFieldError is a CodexError and an Error", () => {
  // codex-core exposes ONE `instanceof CodexError` catch-all: every codec error
  // (and D3's future CodexAdapterError) extends CodexError, so a consumer catches
  // the whole family without enumerating subclasses. If CodexUnknownFieldError
  // regressed to `extends Error`, that catch-all would silently miss it.
  it("is an instanceof CodexError (the shared base, so the module-wide catch-all sees it)", () => {
    expect(new CodexUnknownFieldError("x") instanceof CodexError).toBe(true);
  });

  it("is still an instanceof Error (the base chain is preserved through CodexError)", () => {
    expect(new CodexUnknownFieldError("x") instanceof Error).toBe(true);
  });

  it("carries the CodexUnknownFieldError name for name-based branching after minification", () => {
    expect(new CodexUnknownFieldError("x").name).toBe("CodexUnknownFieldError");
  });
});
