/**
 * codec arweaveSeeds allow-list — funds-critical.
 *
 * Reported incident this suite pins: a user defined a Prime Arweave Seed,
 * generated a key under it, then a save+reload (which in `apps/codex-playground`
 * round-trips through `useCodexBackup`'s export/import, backed by this codec)
 * made the Seed itself vanish — the codex-export codec never knew `arweaveSeeds`
 * existed. `CodexExportV1_3` had NO `arweaveSeeds` field at all: `buildCodexExport`
 * never emitted it, `KNOWN_TOP_LEVEL_FIELDS` never allow-listed it, and
 * `deserializeCodex` never validated/returned it — so a backup that DID carry it
 * would throw `CodexUnknownFieldError`, and the field was silently dropped on
 * export regardless.
 *
 * Mirrors `codec-purekeypairs-allowlist.test.ts` exactly, adapted for
 * `arweaveSeeds`:
 *
 *   - a `{arweaveSeeds, foreignKeys}` 1.3 envelope round-trips WITHOUT throwing;
 *   - `arweaveSeeds` travels as a BARE ARRAY (like `pureKeypairs`, unlike the
 *     `foreignKeys` `{schemaVersion, keys}` block);
 *   - `buildCodexExport` EMITS `arweaveSeeds` when the source carries them and
 *     OMITS the property when it does not (matching the pureKeypairs/foreignKeys
 *     omission discipline);
 *   - a genuinely-unknown third field STILL throws (widened for arweaveSeeds
 *     ONLY, not wide-open);
 *   - a malformed `arweaveSeeds` entry throws a shape error NAMING the path and
 *     NEVER echoing the ciphertext `secret` value;
 *   - the historical 1.2 path is untouched (a 1.2 file still round-trips);
 *   - the `isPrime` marker (the field the reported incident actually lost)
 *     survives the round-trip.
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
  type ForeignKeyEntry,
  type PlaintextCodex,
} from "../src";

// An Arweave-seed entry as it rides the wire — the IArweaveSeed core field set
// (id / secret / createdAt), with the `isPrime` marker that the reported
// incident lost (a Prime Arweave Seed became "Undefined" after a save+reload).
const samplePrimeSeed = {
  id: "seed-1",
  name: "Prime Arweave Seed",
  secret: "ENC::arweave-seed-ciphertext",
  createdAt: "2025-01-01T00:00:00.000Z",
  isPrime: true,
};

const sampleForeignKey: ForeignKeyEntry = {
  id: "fk-1",
  label: "AR key",
  chainId: "arweave",
  encryptedKeyfile: "ENC::keyfile-ciphertext",
};

function baseCodex(overrides: Partial<PlaintextCodex> = {}): PlaintextCodex {
  return {
    kadenaWallets: [],
    ouronetWallets: [],
    addressBook: [],
    pureKeypairs: [],
    uiSettings: { dockPosition: "left" },
    schemaVersion: 1,
    lastUpdatedAt: null,
    lastUpdatedDevice: "main",
    ...overrides,
  };
}

// ─── (1) {arweaveSeeds, foreignKeys} 1.3 ROUND-TRIP — the funds-loss gate ──────

describe("(1) arweaveSeeds allow-list — a {arweaveSeeds, foreignKeys} 1.3 envelope round-trips (funds-critical)", () => {
  it("deserializes a {arweaveSeeds, foreignKeys} 1.3 envelope WITHOUT CodexUnknownFieldError — both survive byte-identical", () => {
    const codex = baseCodex({
      arweaveSeeds: [samplePrimeSeed],
      foreignKeys: [sampleForeignKey],
    });
    const json = serializeCodex(codex);

    const parsed = deserializeCodex(json) as unknown as Record<string, unknown>;
    expect(parsed.version).toBe("1.3");
    // foreignKeys rides as a {schemaVersion, keys} BLOCK...
    expect((parsed.foreignKeys as { keys: ForeignKeyEntry[] }).keys).toEqual([sampleForeignKey]);
    // ...arweaveSeeds rides as a BARE ARRAY (different wire shape).
    expect(parsed.arweaveSeeds).toEqual([samplePrimeSeed]);
  });

  it("preserves the isPrime marker and secret ciphertext verbatim — the reader never decrypts (the exact field the reported incident lost)", () => {
    const codex = baseCodex({ arweaveSeeds: [samplePrimeSeed] });
    const parsed = deserializeCodex(serializeCodex(codex)) as {
      arweaveSeeds: Array<{ isPrime?: boolean; secret: string }>;
    };
    expect(parsed.arweaveSeeds[0].isPrime).toBe(true);
    expect(parsed.arweaveSeeds[0].secret).toBe(samplePrimeSeed.secret);
  });
});

// ─── (2) WRITER — emits when present, omits when absent ────────────────────────

describe("(2) WRITER — buildCodexExport emits arweaveSeeds when present, omits when absent", () => {
  it("emits arweaveSeeds as a bare array in the 1.3 envelope when the source carries them", () => {
    const envelope = buildCodexExport(baseCodex({ arweaveSeeds: [samplePrimeSeed] })) as unknown as Record<string, unknown>;
    expect(envelope.version).toBe("1.3");
    expect(Array.isArray(envelope.arweaveSeeds)).toBe(true);
    expect(envelope.arweaveSeeds).toEqual([samplePrimeSeed]);
  });

  it("OMITS the arweaveSeeds property entirely when the source has an empty arweaveSeeds array (no mandatory empty member)", () => {
    const envelope = buildCodexExport(baseCodex({ arweaveSeeds: [] })) as unknown as Record<string, unknown>;
    expect(envelope).not.toHaveProperty("arweaveSeeds");
  });

  it("OMITS the arweaveSeeds property when the source does not carry the field at all (OPTIONAL, unset)", () => {
    const envelope = buildCodexExport(baseCodex()) as unknown as Record<string, unknown>;
    expect(envelope).not.toHaveProperty("arweaveSeeds");
  });

  it("keeps arweaveSeeds a BARE ARRAY while foreignKeys is a {schemaVersion,keys} BLOCK — the two keyrings diverge on the wire", () => {
    const envelope = buildCodexExport(
      baseCodex({ arweaveSeeds: [samplePrimeSeed], foreignKeys: [sampleForeignKey] }),
    ) as unknown as Record<string, unknown>;
    expect(Array.isArray(envelope.arweaveSeeds)).toBe(true);
    expect(Array.isArray(envelope.foreignKeys)).toBe(false);
    expect(envelope.foreignKeys).toMatchObject({ schemaVersion: expect.any(Number), keys: [sampleForeignKey] });
  });
});

// ─── (3) UNKNOWN FIELD STILL THROWS — widened for arweaveSeeds ONLY ────────────

describe("(3) UNKNOWN FIELD — a third genuinely-unknown field still throws (allow-list widened for arweaveSeeds ONLY, not wide-open)", () => {
  it("throws CodexUnknownFieldError naming bogusField even when arweaveSeeds is also present", () => {
    const emitted = JSON.parse(serializeCodex(baseCodex({ arweaveSeeds: [samplePrimeSeed] }))) as Record<string, unknown>;
    emitted.bogusField = { nope: true };
    const json = JSON.stringify(emitted);
    expect(() => deserializeCodex(json)).toThrow(CodexUnknownFieldError);
    expect(() => deserializeCodex(json)).toThrow(/bogusField/);
  });
});

// ─── (4) READER SHAPE VALIDATION — malformed entry throws, secret-free ─────────

describe("(4) READER — a malformed arweaveSeeds entry throws naming the path, never echoing the secret", () => {
  it("throws when arweaveSeeds is not an array, naming arweaveSeeds", () => {
    const emitted = JSON.parse(serializeCodex(baseCodex({ arweaveSeeds: [samplePrimeSeed] }))) as Record<string, unknown>;
    emitted.arweaveSeeds = "not-an-array";
    expect(() => deserializeCodex(JSON.stringify(emitted))).toThrow(/arweaveSeeds/);
  });

  it("throws a CodexError NAMING arweaveSeeds[0] when an entry is missing secret, without echoing any ciphertext value", () => {
    const emitted = JSON.parse(serializeCodex(baseCodex({ arweaveSeeds: [samplePrimeSeed] }))) as Record<string, unknown>;
    const bad = { id: "seed-bad", createdAt: "2025-01-01T00:00:00.000Z" };
    emitted.arweaveSeeds = [bad];

    let thrown: unknown;
    try {
      deserializeCodex(JSON.stringify(emitted));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(CodexError);
    const msg = (thrown as Error).message;
    expect(msg).toMatch(/arweaveSeeds\[0\]/);
    // Secret hygiene: the entry's ciphertext value is never surfaced.
    expect(msg).not.toContain(samplePrimeSeed.secret);
  });

  it("accepts a fully-formed entry without the optional name/isPrime fields (a non-prime seed is valid)", () => {
    const bare = { id: "seed-2", secret: "ENC::secondary", createdAt: "2025-01-02T00:00:00.000Z" };
    const parsed = deserializeCodex(serializeCodex(baseCodex({ arweaveSeeds: [bare] }))) as {
      arweaveSeeds: Array<Record<string, unknown>>;
    };
    expect(parsed.arweaveSeeds[0]).toEqual(bare);
  });
});

// ─── (5) 1.2 PATH UNTOUCHED — a historical 1.2 file still round-trips ──────────

describe("(5) 1.2 PATH UNTOUCHED — widening the allow-list for arweaveSeeds does not disturb the historical 1.2 reader", () => {
  it("still deserializes a valid 1.2 envelope (no arweaveSeeds) clean", () => {
    const env = {
      version: "1.2",
      exportedAt: "2024-11-02T09:14:33.000Z",
      kadenaWallets: [{ id: "seed-a", secret: "enc-seed" }],
      ouronetWallets: [{ id: "acct-1", secret: "enc-acct" }],
      addressBook: [],
      uiSettings: { dockPosition: "left" },
    };
    const parsed = deserializeCodex(JSON.stringify(env));
    expect(parsed.version).toBe("1.2");
    expect(parsed).not.toHaveProperty("arweaveSeeds");
  });
});
