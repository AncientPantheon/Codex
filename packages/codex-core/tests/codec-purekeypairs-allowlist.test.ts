/**
 * codec pureKeypairs allow-list — the D2 REVISIT (FIX-2), funds-critical.
 *
 * D2 widened the codec allow-list for `foreignKeys` ONLY; `CodexExportV1_3`
 * OMITTED `pureKeypairs`. The `useCodexBackup` rewire (E1) routes a backup
 * carrying `pureKeypairs` through `deserializeCodex` — so the reader would throw
 * `CodexUnknownFieldError` on `pureKeypairs` = the fresh backup is UNRESTORABLE =
 * funds loss. This suite pins the widened contract:
 *
 *   - a `{pureKeypairs, foreignKeys}` 1.3 envelope round-trips WITHOUT throwing;
 *   - `pureKeypairs` travels as a BARE ARRAY (diverging from the `foreignKeys`
 *     `{schemaVersion, keys}` block — it was already a bare array in the old
 *     `BackupFileV12Plus` hook format);
 *   - `buildCodexExport` EMITS `pureKeypairs` when the source carries them and
 *     OMITS the property when it does not (matching the foreignKeys discipline);
 *   - a genuinely-unknown third field STILL throws (widened for pureKeypairs
 *     ONLY, not wide-open);
 *   - a malformed `pureKeypairs` entry throws a shape error NAMING the path and
 *     NEVER echoing the ciphertext value (secret-free);
 *   - the historical 1.2 path is untouched (a 1.2 file still round-trips).
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

// A pure-keypair entry as it rides the wire — the exact IPureKeypair core field
// set (id / publicKey / encryptedPrivateKey / createdAt), label omitted.
const samplePureKeypair = {
  id: "pk-1",
  publicKey: "a".repeat(64),
  encryptedPrivateKey: "ENC::pk-ciphertext",
  createdAt: "2025-01-01T00:00:00.000Z",
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

// ─── (1) {pureKeypairs, foreignKeys} 1.3 ROUND-TRIP — the FIX-2 gate ───────────

describe("(1) pureKeypairs allow-list — a {pureKeypairs, foreignKeys} 1.3 envelope round-trips (FIX-2, funds-critical)", () => {
  it("deserializes a {pureKeypairs, foreignKeys} 1.3 envelope WITHOUT CodexUnknownFieldError — both survive byte-identical", () => {
    const codex = baseCodex({
      pureKeypairs: [samplePureKeypair],
      foreignKeys: [sampleForeignKey],
    });
    const json = serializeCodex(codex);

    const parsed = deserializeCodex(json) as unknown as Record<string, unknown>;
    expect(parsed.version).toBe("1.3");
    // foreignKeys rides as a {schemaVersion, keys} BLOCK...
    expect((parsed.foreignKeys as { keys: ForeignKeyEntry[] }).keys).toEqual([sampleForeignKey]);
    // ...pureKeypairs rides as a BARE ARRAY (different wire shape).
    expect(parsed.pureKeypairs).toEqual([samplePureKeypair]);
  });

  it("preserves the pureKeypairs ciphertext verbatim — the reader never decrypts", () => {
    const codex = baseCodex({ pureKeypairs: [samplePureKeypair] });
    const parsed = deserializeCodex(serializeCodex(codex)) as {
      pureKeypairs: Array<{ encryptedPrivateKey: string }>;
    };
    expect(parsed.pureKeypairs[0].encryptedPrivateKey).toBe(samplePureKeypair.encryptedPrivateKey);
  });
});

// ─── (2) WRITER — emits when present, omits when absent ────────────────────────

describe("(2) WRITER — buildCodexExport emits pureKeypairs when present, omits when absent", () => {
  it("emits pureKeypairs as a bare array in the 1.3 envelope when the source carries them", () => {
    const envelope = buildCodexExport(baseCodex({ pureKeypairs: [samplePureKeypair] })) as unknown as Record<string, unknown>;
    expect(envelope.version).toBe("1.3");
    expect(Array.isArray(envelope.pureKeypairs)).toBe(true);
    expect(envelope.pureKeypairs).toEqual([samplePureKeypair]);
  });

  it("OMITS the pureKeypairs property entirely when the source has an empty pureKeypairs array (no mandatory empty member)", () => {
    const envelope = buildCodexExport(baseCodex({ pureKeypairs: [] })) as unknown as Record<string, unknown>;
    expect(envelope).not.toHaveProperty("pureKeypairs");
  });

  it("keeps pureKeypairs a BARE ARRAY while foreignKeys is a {schemaVersion,keys} BLOCK — the two keyrings diverge on the wire", () => {
    const envelope = buildCodexExport(
      baseCodex({ pureKeypairs: [samplePureKeypair], foreignKeys: [sampleForeignKey] }),
    ) as unknown as Record<string, unknown>;
    expect(Array.isArray(envelope.pureKeypairs)).toBe(true);
    expect(Array.isArray(envelope.foreignKeys)).toBe(false);
    expect(envelope.foreignKeys).toMatchObject({ schemaVersion: expect.any(Number), keys: [sampleForeignKey] });
  });
});

// ─── (3) UNKNOWN FIELD STILL THROWS — widened for pureKeypairs ONLY ────────────

describe("(3) UNKNOWN FIELD — a third genuinely-unknown field still throws (allow-list widened for pureKeypairs+foreignKeys ONLY, not wide-open)", () => {
  it("throws CodexUnknownFieldError naming bogusField even when pureKeypairs is also present", () => {
    const emitted = JSON.parse(serializeCodex(baseCodex({ pureKeypairs: [samplePureKeypair] }))) as Record<string, unknown>;
    emitted.bogusField = { nope: true };
    const json = JSON.stringify(emitted);
    expect(() => deserializeCodex(json)).toThrow(CodexUnknownFieldError);
    expect(() => deserializeCodex(json)).toThrow(/bogusField/);
  });
});

// ─── (4) READER SHAPE VALIDATION — malformed entry throws, secret-free ─────────

describe("(4) READER — a malformed pureKeypairs entry throws naming the path, never echoing the ciphertext", () => {
  it("throws when pureKeypairs is not an array, naming pureKeypairs", () => {
    const emitted = JSON.parse(serializeCodex(baseCodex({ pureKeypairs: [samplePureKeypair] }))) as Record<string, unknown>;
    emitted.pureKeypairs = "not-an-array";
    expect(() => deserializeCodex(JSON.stringify(emitted))).toThrow(/pureKeypairs/);
  });

  it("throws a CodexError NAMING pureKeypairs[0] when an entry is missing encryptedPrivateKey, without echoing the secret value", () => {
    const emitted = JSON.parse(serializeCodex(baseCodex({ pureKeypairs: [samplePureKeypair] }))) as Record<string, unknown>;
    const bad = { id: "pk-bad", publicKey: "b".repeat(64), createdAt: "2025-01-01T00:00:00.000Z" };
    emitted.pureKeypairs = [bad];

    let thrown: unknown;
    try {
      deserializeCodex(JSON.stringify(emitted));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(CodexError);
    const msg = (thrown as Error).message;
    expect(msg).toMatch(/pureKeypairs\[0\]/);
    // Secret hygiene: the entry's ciphertext value is never surfaced.
    expect(msg).not.toContain(samplePureKeypair.encryptedPrivateKey);
  });

  it("names pureKeypairs[0] and never echoes a secret-looking encryptedPrivateKey when the entry's publicKey is the wrong type", () => {
    const SECRET = "SUPER-SECRET-PK-CIPHERTEXT-9f3a2b";
    const badEntry = { id: "pk-bad", publicKey: 123, encryptedPrivateKey: SECRET, createdAt: "2025-01-01T00:00:00.000Z" };
    const emitted = JSON.parse(serializeCodex(baseCodex({ pureKeypairs: [samplePureKeypair] }))) as Record<string, unknown>;
    emitted.pureKeypairs = [badEntry];

    let caught: unknown;
    try {
      deserializeCodex(JSON.stringify(emitted));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CodexError);
    const message = (caught as Error).message;
    expect(message).toMatch(/pureKeypairs\[0\]/);
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain("9f3a2b");
  });

  it("accepts a fully-formed entry that also carries the optional label + CodexGuard marker flag (additive fields pass)", () => {
    const flagged = { ...samplePureKeypair, id: "pk-guard", label: "CodexGuard", isCodexGuard: true };
    const parsed = deserializeCodex(serializeCodex(baseCodex({ pureKeypairs: [flagged] }))) as {
      pureKeypairs: Array<Record<string, unknown>>;
    };
    expect(parsed.pureKeypairs[0]).toEqual(flagged);
  });
});

// ─── (5) 1.2 PATH UNTOUCHED — a historical 1.2 file still round-trips ──────────

describe("(5) 1.2 PATH UNTOUCHED — widening the allow-list for pureKeypairs does not disturb the historical 1.2 reader", () => {
  it("still deserializes a valid 1.2 envelope (no pureKeypairs) clean", () => {
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
    expect(parsed).not.toHaveProperty("pureKeypairs");
  });
});
