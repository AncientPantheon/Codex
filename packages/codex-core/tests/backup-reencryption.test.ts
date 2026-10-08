/**
 * `reencryptBackupSecretFields` — the SANCTIONED backup-upload field
 * re-encryption seam (`codex-backup-envelope-encryption` T2).
 *
 * This is the function that lets a codex-backup upload swap every individual
 * secret-ciphertext field (today encrypted under the user's local password)
 * for the SAME plaintext re-encrypted under a per-upload DEK — WITHOUT
 * hand-parsing the export JSON (IMPORT_EXPORT_CONTRACT.md §1). It reuses the
 * real `deserializeCodex`/`serializeCodex` fixture-building convention from
 * `codec-arweaveseeds-allowlist.test.ts`/`codec-1-3-matrix.test.ts` — a real,
 * multi-keyring `PlaintextCodex` built via `buildCodexExport`'s own writer,
 * never a hand-typed JSON literal that could silently drift from the real
 * wire shape.
 *
 * Why each case matters:
 *   (1) proves the function actually reaches and transforms all THREE
 *       documented secret-field types (IMPORT_EXPORT_CONTRACT.md §2) — a
 *       regression here means a real backup upload leaves a field under the
 *       OLD key, defeating the whole envelope-encryption scheme silently.
 *   (2) proves the transform is surgical — touching anything else (an id, a
 *       label, a timestamp, the envelope `version`) would corrupt a user's
 *       restore or silently rename/misplace an entry.
 *   (3) proves the output is still a valid, restorable backup — producing
 *       ciphertext nobody can ever read back in is a funds-loss regression,
 *       not a cosmetic one.
 *   (4) proves the callbacks run exactly once per field — calling twice
 *       double-encrypts (unrestorable); calling zero times for a present
 *       field silently leaves the OLD key in place.
 *   (5) proves an omitted keyring (a real, valid state per
 *       IMPORT_EXPORT_CONTRACT.md §2's "Omitted when" column) doesn't throw
 *       or get treated as if it had phantom entries.
 *   (6) proves the contract end-to-end with REAL AES-GCM crypto (not label
 *       stubs) — decrypting the function's own output with the NEW key must
 *       recover exactly the plaintext that was encrypted under the OLD key,
 *       the actual real-world shape of the backup-upload re-encryption step.
 *
 * Pure unit tests — no fs, no network. Case (6) uses real WebCrypto
 * (Node's global `crypto.subtle`), everything else uses deterministic stub
 * callbacks so the call-count/field-identity assertions stay exact.
 */

import { describe, it, expect, vi } from "vitest";
import {
  serializeCodex,
  deserializeCodex,
  type ForeignKeyEntry,
  type PureKeypairEntry,
  type PlaintextCodex,
} from "../src";
import { reencryptBackupSecretFields } from "../src/codex/backupReencryption.js";

// ─── Fixtures ──────────────────────────────────────────────────────────────

const arweaveSeedA = {
  id: "seed-a",
  name: "Prime Arweave Seed",
  secret: "ENC::arweave-seed-ciphertext-A",
  createdAt: "2025-01-01T00:00:00.000Z",
  isPrime: true,
};
const arweaveSeedB = {
  id: "seed-b",
  secret: "ENC::arweave-seed-ciphertext-B",
  createdAt: "2025-01-02T00:00:00.000Z",
};

const foreignKeyA: ForeignKeyEntry = {
  id: "fk-a",
  label: "AR key A",
  chainId: "arweave:mainnet",
  encryptedKeyfile: "ENC::keyfile-ciphertext-A",
};
const foreignKeyB: ForeignKeyEntry = {
  id: "fk-b",
  chainId: "arweave:mainnet",
  encryptedKeyfile: "ENC::keyfile-ciphertext-B",
  seedId: "seed-a",
  index: 0,
};

const pureKeypairA: PureKeypairEntry = {
  id: "pk-a",
  label: "Pact key A",
  publicKey: "a".repeat(64),
  encryptedPrivateKey: "ENC::pure-ciphertext-A",
  createdAt: "2025-01-03T00:00:00.000Z",
};
const pureKeypairB: PureKeypairEntry = {
  id: "pk-b",
  publicKey: "b".repeat(64),
  encryptedPrivateKey: "ENC::pure-ciphertext-B",
  createdAt: "2025-01-04T00:00:00.000Z",
};

function fullMultiKeyringCodex(overrides: Partial<PlaintextCodex> = {}): PlaintextCodex {
  return {
    kadenaWallets: [
      { id: "kw-1", name: "Koala seed", secret: "ENC::kadena-seed", seedType: "koala" },
    ],
    ouronetWallets: [
      { id: "oa-1", address: "ouro:ABC", secret: "ENC::ouro-acct" },
    ],
    addressBook: [{ id: "ab-1", label: "Friend", address: "ouro:FRIEND" }],
    pureKeypairs: [pureKeypairA, pureKeypairB],
    uiSettings: { dockPosition: "left", zbomExecutePosition: "top" },
    schemaVersion: 1,
    lastUpdatedAt: "2026-04-22T00:00:00Z",
    lastUpdatedDevice: "main",
    arweaveSeeds: [arweaveSeedA, arweaveSeedB],
    foreignKeys: [foreignKeyA, foreignKeyB],
    ...overrides,
  };
}

// Deterministic, order-visible stub transform: lets every assertion below
// check EXACTLY which ciphertext went in and what came out, without needing
// real crypto for the call-count / field-identity cases.
function makeStubOpts() {
  const decryptField = vi.fn(async (ciphertext: string) => `PLAIN(${ciphertext})`);
  const encryptField = vi.fn(async (plaintext: string) => `REENC(${plaintext})`);
  return { decryptField, encryptField };
}

function expectedTransform(originalCiphertext: string): string {
  return `REENC(PLAIN(${originalCiphertext}))`;
}

// ─── (1) ALL THREE SECRET-FIELD TYPES TRANSFORMED ──────────────────────────

describe("(1) reencryptBackupSecretFields — transforms all three documented secret-field types", () => {
  it("transforms arweaveSeeds[].secret, foreignKeys.keys[].encryptedKeyfile, and pureKeypairs[].encryptedPrivateKey", async () => {
    const exportJson = serializeCodex(fullMultiKeyringCodex());
    const { decryptField, encryptField } = makeStubOpts();

    const outputJson = await reencryptBackupSecretFields(exportJson, { decryptField, encryptField });
    const output = JSON.parse(outputJson) as {
      arweaveSeeds: Array<{ id: string; secret: string }>;
      foreignKeys: { keys: Array<{ id: string; encryptedKeyfile: string }> };
      pureKeypairs: Array<{ id: string; encryptedPrivateKey: string }>;
    };

    expect(output.arweaveSeeds[0].secret).toBe(expectedTransform(arweaveSeedA.secret));
    expect(output.arweaveSeeds[1].secret).toBe(expectedTransform(arweaveSeedB.secret));
    expect(output.foreignKeys.keys[0].encryptedKeyfile).toBe(expectedTransform(foreignKeyA.encryptedKeyfile));
    expect(output.foreignKeys.keys[1].encryptedKeyfile).toBe(expectedTransform(foreignKeyB.encryptedKeyfile));
    expect(output.pureKeypairs[0].encryptedPrivateKey).toBe(expectedTransform(pureKeypairA.encryptedPrivateKey));
    expect(output.pureKeypairs[1].encryptedPrivateKey).toBe(expectedTransform(pureKeypairB.encryptedPrivateKey));

    // Genuinely different from the input ciphertext — not a no-op passthrough.
    expect(output.arweaveSeeds[0].secret).not.toBe(arweaveSeedA.secret);
    expect(output.foreignKeys.keys[0].encryptedKeyfile).not.toBe(foreignKeyA.encryptedKeyfile);
    expect(output.pureKeypairs[0].encryptedPrivateKey).not.toBe(pureKeypairA.encryptedPrivateKey);
  });
});

// ─── (2) EVERY OTHER FIELD UNCHANGED ───────────────────────────────────────

describe("(2) reencryptBackupSecretFields — every non-secret field is byte-for-byte unchanged", () => {
  it("leaves ids, labels, addresses, timestamps, version, and non-secret structure untouched", async () => {
    const codex = fullMultiKeyringCodex();
    const exportJson = serializeCodex(codex);
    const inputParsed = JSON.parse(exportJson) as Record<string, unknown>;
    const { decryptField, encryptField } = makeStubOpts();

    const outputJson = await reencryptBackupSecretFields(exportJson, { decryptField, encryptField });
    const outputParsed = JSON.parse(outputJson) as Record<string, unknown>;

    expect(outputParsed.version).toBe(inputParsed.version);
    expect(outputParsed.exportedAt).toBe(inputParsed.exportedAt);
    expect(outputParsed.kadenaWallets).toEqual(inputParsed.kadenaWallets);
    expect(outputParsed.ouronetWallets).toEqual(inputParsed.ouronetWallets);
    expect(outputParsed.addressBook).toEqual(inputParsed.addressBook);
    expect(outputParsed.uiSettings).toEqual(inputParsed.uiSettings);

    const inArweave = (inputParsed.arweaveSeeds as Array<Record<string, unknown>>);
    const outArweave = (outputParsed.arweaveSeeds as Array<Record<string, unknown>>);
    outArweave.forEach((entry, i) => {
      expect(entry.id).toBe(inArweave[i].id);
      expect(entry.createdAt).toBe(inArweave[i].createdAt);
      expect(entry.name).toBe(inArweave[i].name);
      expect(entry.isPrime).toBe(inArweave[i].isPrime);
    });

    const inForeign = (inputParsed.foreignKeys as { schemaVersion: number; keys: Array<Record<string, unknown>> });
    const outForeign = (outputParsed.foreignKeys as { schemaVersion: number; keys: Array<Record<string, unknown>> });
    expect(outForeign.schemaVersion).toBe(inForeign.schemaVersion);
    outForeign.keys.forEach((entry, i) => {
      expect(entry.id).toBe(inForeign.keys[i].id);
      expect(entry.chainId).toBe(inForeign.keys[i].chainId);
      expect(entry.label).toBe(inForeign.keys[i].label);
      expect(entry.seedId).toBe(inForeign.keys[i].seedId);
      expect(entry.index).toBe(inForeign.keys[i].index);
    });

    const inPure = (inputParsed.pureKeypairs as Array<Record<string, unknown>>);
    const outPure = (outputParsed.pureKeypairs as Array<Record<string, unknown>>);
    outPure.forEach((entry, i) => {
      expect(entry.id).toBe(inPure[i].id);
      expect(entry.label).toBe(inPure[i].label);
      expect(entry.publicKey).toBe(inPure[i].publicKey);
      expect(entry.createdAt).toBe(inPure[i].createdAt);
    });
  });
});

// ─── (3) OUTPUT RE-PARSES CLEAN ─────────────────────────────────────────────

describe("(3) reencryptBackupSecretFields — the output re-parses through deserializeCodex with no shape errors", () => {
  it("deserializeCodex accepts the transformed output and preserves array lengths", async () => {
    const exportJson = serializeCodex(fullMultiKeyringCodex());
    const { decryptField, encryptField } = makeStubOpts();

    const outputJson = await reencryptBackupSecretFields(exportJson, { decryptField, encryptField });

    let parsed: ReturnType<typeof deserializeCodex> | undefined;
    expect(() => {
      parsed = deserializeCodex(outputJson);
    }).not.toThrow();
    expect(parsed?.version).toBe("1.3");
    const asRecord = parsed as unknown as {
      arweaveSeeds: unknown[];
      foreignKeys: { keys: unknown[] };
      pureKeypairs: unknown[];
    };
    expect(asRecord.arweaveSeeds).toHaveLength(2);
    expect(asRecord.foreignKeys.keys).toHaveLength(2);
    expect(asRecord.pureKeypairs).toHaveLength(2);
  });
});

// ─── (4) CALLBACKS CALLED EXACTLY ONCE PER PRESENT FIELD ───────────────────

describe("(4) reencryptBackupSecretFields — decryptField/encryptField run exactly once per secret field present", () => {
  it("calls each callback exactly 6 times for 2 arweaveSeeds + 2 foreignKeys + 2 pureKeypairs", async () => {
    const exportJson = serializeCodex(fullMultiKeyringCodex());
    const { decryptField, encryptField } = makeStubOpts();

    await reencryptBackupSecretFields(exportJson, { decryptField, encryptField });

    expect(decryptField).toHaveBeenCalledTimes(6);
    expect(encryptField).toHaveBeenCalledTimes(6);

    const decryptedArgs = decryptField.mock.calls.map((c) => c[0]);
    expect(decryptedArgs).toContain(arweaveSeedA.secret);
    expect(decryptedArgs).toContain(arweaveSeedB.secret);
    expect(decryptedArgs).toContain(foreignKeyA.encryptedKeyfile);
    expect(decryptedArgs).toContain(foreignKeyB.encryptedKeyfile);
    expect(decryptedArgs).toContain(pureKeypairA.encryptedPrivateKey);
    expect(decryptedArgs).toContain(pureKeypairB.encryptedPrivateKey);

    // encryptField always receives decryptField's OWN output, never the raw
    // ciphertext directly — proves the pipeline is decrypt-THEN-encrypt, not
    // encrypt-the-ciphertext-again.
    const encryptedArgs = encryptField.mock.calls.map((c) => c[0]);
    encryptedArgs.forEach((arg) => expect(arg.startsWith("PLAIN(")).toBe(true));
  });
});

// ─── (5) OMITTED KEYRING — ZERO ENTRIES HANDLED WITHOUT ERROR ──────────────

describe("(5) reencryptBackupSecretFields — an omitted keyring is handled without error or phantom calls", () => {
  it("does not call the callbacks for pureKeypairs when the codex carries none (IMPORT_EXPORT_CONTRACT.md §2 omission)", async () => {
    const codex = fullMultiKeyringCodex({ pureKeypairs: [] });
    const exportJson = serializeCodex(codex);
    const inputParsed = JSON.parse(exportJson) as Record<string, unknown>;
    expect(inputParsed).not.toHaveProperty("pureKeypairs");

    const { decryptField, encryptField } = makeStubOpts();
    const outputJson = await reencryptBackupSecretFields(exportJson, { decryptField, encryptField });
    const outputParsed = JSON.parse(outputJson) as Record<string, unknown>;

    expect(outputParsed).not.toHaveProperty("pureKeypairs");
    // Only the 2 arweaveSeeds + 2 foreignKeys fields were transformed.
    expect(decryptField).toHaveBeenCalledTimes(4);
    expect(encryptField).toHaveBeenCalledTimes(4);
  });

  it("handles a codex with NONE of the three keyrings at all without throwing", async () => {
    const codex = fullMultiKeyringCodex({ pureKeypairs: [], arweaveSeeds: undefined, foreignKeys: undefined });
    const exportJson = serializeCodex(codex);
    const { decryptField, encryptField } = makeStubOpts();

    let outputJson: string | undefined;
    await expect(
      (async () => {
        outputJson = await reencryptBackupSecretFields(exportJson, { decryptField, encryptField });
      })(),
    ).resolves.not.toThrow();

    expect(decryptField).not.toHaveBeenCalled();
    expect(encryptField).not.toHaveBeenCalled();
    expect(() => deserializeCodex(outputJson as string)).not.toThrow();
  });
});

// ─── (6) REAL AES-GCM ROUND-TRIP (not faked callbacks) ─────────────────────

// A minimal, self-contained AES-GCM helper — mirrors the real shape of
// "decrypt under the old key, re-encrypt under the new key" without
// depending on any other package's crypto module (keeps this test isolated
// to codex-core, which has no WebCrypto cipher helper of its own). Typed via
// `Awaited<ReturnType<...importKey>>` (always resolves to a single
// `CryptoKey`, never the `generateKey`-only `CryptoKeyPair` union) rather
// than the bare `CryptoKey` name — this package's `tsconfig` lib is
// `ES2023` (no `dom`), so the global `CryptoKey` type identifier is not in
// scope even though `globalThis.crypto` itself is (Node's own ambient
// WebCrypto typings).
type AesGcmKey = Awaited<ReturnType<typeof globalThis.crypto.subtle.importKey>>;

async function aesGcmEncrypt(key: AesGcmKey, plaintext: string): Promise<string> {
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const packed = new Uint8Array(iv.length + ciphertext.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(ciphertext), iv.length);
  return Buffer.from(packed).toString("base64");
}

async function aesGcmDecrypt(key: AesGcmKey, packedBase64: string): Promise<string> {
  const packed = new Uint8Array(Buffer.from(packedBase64, "base64"));
  const iv = packed.slice(0, 12);
  const ciphertext = packed.slice(12);
  const plaintext = await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

describe("(6) reencryptBackupSecretFields — REAL AES-GCM round-trip, not faked callbacks", () => {
  it("decrypting the function's output under the NEW key recovers exactly the original plaintext", async () => {
    const oldKey = (await globalThis.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
      "encrypt",
      "decrypt",
    ])) as AesGcmKey;
    const newKey = (await globalThis.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
      "encrypt",
      "decrypt",
    ])) as AesGcmKey;

    const originalSecretPlaintext = "1600-bit-arweave-seed-bitstring-material";
    const originalKeyfilePlaintext = "{\"kty\":\"RSA\",\"n\":\"...\"}";
    const originalPrivateKeyPlaintext = "pact-ed25519-private-key-hex";

    const realArweaveSeed = {
      id: "real-seed",
      secret: await aesGcmEncrypt(oldKey, originalSecretPlaintext),
      createdAt: "2025-02-01T00:00:00.000Z",
    };
    const realForeignKey: ForeignKeyEntry = {
      id: "real-fk",
      chainId: "arweave:mainnet",
      encryptedKeyfile: await aesGcmEncrypt(oldKey, originalKeyfilePlaintext),
    };
    const realPureKeypair: PureKeypairEntry = {
      id: "real-pk",
      publicKey: "c".repeat(64),
      encryptedPrivateKey: await aesGcmEncrypt(oldKey, originalPrivateKeyPlaintext),
      createdAt: "2025-02-02T00:00:00.000Z",
    };

    const codex = fullMultiKeyringCodex({
      arweaveSeeds: [realArweaveSeed],
      foreignKeys: [realForeignKey],
      pureKeypairs: [realPureKeypair],
    });
    const exportJson = serializeCodex(codex);

    const outputJson = await reencryptBackupSecretFields(exportJson, {
      decryptField: (ciphertext) => aesGcmDecrypt(oldKey, ciphertext),
      encryptField: (plaintext) => aesGcmEncrypt(newKey, plaintext),
    });

    const output = deserializeCodex(outputJson) as unknown as {
      arweaveSeeds: Array<{ secret: string }>;
      foreignKeys: { keys: Array<{ encryptedKeyfile: string }> };
      pureKeypairs: Array<{ encryptedPrivateKey: string }>;
    };

    // The OLD key can no longer decrypt the output (it is genuinely re-keyed) —
    // and the NEW key recovers exactly the original plaintext.
    await expect(aesGcmDecrypt(newKey, output.arweaveSeeds[0].secret)).resolves.toBe(originalSecretPlaintext);
    await expect(aesGcmDecrypt(newKey, output.foreignKeys.keys[0].encryptedKeyfile)).resolves.toBe(
      originalKeyfilePlaintext,
    );
    await expect(aesGcmDecrypt(newKey, output.pureKeypairs[0].encryptedPrivateKey)).resolves.toBe(
      originalPrivateKeyPlaintext,
    );
    await expect(aesGcmDecrypt(oldKey, output.arweaveSeeds[0].secret)).rejects.toThrow();
  });
});
