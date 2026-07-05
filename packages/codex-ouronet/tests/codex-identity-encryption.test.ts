/**
 * buildCodexIdentityFromDerivation tests — Phase 7 T7.2 of the v0.3.0 codex
 * spec (REQ-07).
 *
 * The helper takes Phase 4's `DoubleApolloDerivation` + the codex password (CK)
 * and returns a fully-shaped `ICodexIdentity` with all 9 secret fields encrypted
 * at CK via `encryptStringV2`. It is pure (no store/adapter/I-O beyond the crypto
 * call). These specs prove:
 *   - every field maps from the derivation correctly (round-trip decrypts back)
 *   - the non-words-mode `encryptedSeedWords` JSON envelope round-trips
 *   - encryption is non-deterministic (fresh salt+nonce) — a security property
 *   - CK binding (wrong password fails decrypt)
 *   - `createdBy` stays absent when not supplied; `createdAt` is the real clock
 */

import { describe, it, expect, vi, afterEach } from "vitest";

// encryptStringV2 is PBKDF2-SHA512/600k (deliberately slow); each identity build
// runs 9 encryptions and the round-trip specs add 8+ decryptions. The default
// 5s budget is too tight for the heavy KDF on a single test, so the crypto-heavy
// specs opt into a generous timeout.
const CRYPTO_TIMEOUT = 60_000;
import { buildCodexIdentityFromDerivation } from "@ancientpantheon/codex-ouronet/codex-identity";
import { deriveDoubleApollo } from "@ancientpantheon/codex-ouronet/codex-identity";
import type { DoubleApolloDerivation } from "@ancientpantheon/codex-ouronet/codex-identity";
import { encryptStringV2, decryptStringV2 } from "@stoachain/stoa-core/crypto";

const CK = "test-codex-password";
const WORDS_12 =
  "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima";

function derive(): DoubleApolloDerivation {
  return deriveDoubleApollo(WORDS_12, "words");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("buildCodexIdentityFromDerivation", () => {
  it("populates all 16 fields and round-trips encryptedSeedWords to the raw words", { timeout: CRYPTO_TIMEOUT }, async () => {
    const d = derive();
    const id = await buildCodexIdentityFromDerivation(d, CK, {
      codexIdSeed: { mode: "words", value: WORDS_12 },
      createdByUsername: "test-user",
    });

    // plaintext display + public fields map directly from the derivation
    expect(id.formatted).toBe(d.formatted);
    expect(id.standardPublicKey).toBe(d.standard.publicKey);
    expect(id.smartPublicKey).toBe(d.smart.publicKey);
    expect(id.totalWordCount).toBe(d.totalWordCount);
    expect(id.splitIndex).toBe(d.splitIndex);
    expect(id.createdBy).toBe("test-user");
    expect(typeof id.createdAt).toBe("string");

    // all 9 encrypted fields present + non-empty
    const encryptedFields = [
      id.encryptedSeedWords,
      id.encryptedStandardBitstring,
      id.encryptedSmartBitstring,
      id.encryptedStandardBase10,
      id.encryptedSmartBase10,
      id.encryptedStandardBase49,
      id.encryptedSmartBase49,
      id.encryptedStandardPrivateKey,
      id.encryptedSmartPrivateKey,
    ];
    for (const f of encryptedFields) {
      expect(typeof f).toBe("string");
      expect((f as string).length).toBeGreaterThan(0);
    }

    expect(await decryptStringV2(id.encryptedSeedWords, CK)).toBe(WORDS_12);
  });

  it("round-trips every encrypted field back to its derivation plaintext", { timeout: CRYPTO_TIMEOUT }, async () => {
    const d = derive();
    const id = await buildCodexIdentityFromDerivation(d, CK, {
      codexIdSeed: { mode: "words", value: WORDS_12 },
    });

    expect(await decryptStringV2(id.encryptedStandardBitstring, CK)).toBe(d.standard.formats.bitstring);
    expect(await decryptStringV2(id.encryptedSmartBitstring, CK)).toBe(d.smart.formats.bitstring);
    expect(await decryptStringV2(id.encryptedStandardBase10, CK)).toBe(d.standard.formats.base10);
    expect(await decryptStringV2(id.encryptedSmartBase10, CK)).toBe(d.smart.formats.base10);
    expect(await decryptStringV2(id.encryptedStandardBase49, CK)).toBe(d.standard.formats.base49);
    expect(await decryptStringV2(id.encryptedSmartBase49, CK)).toBe(d.smart.formats.base49);
    expect(await decryptStringV2(id.encryptedStandardPrivateKey as string, CK)).toBe(d.standard.privateKey);
    expect(await decryptStringV2(id.encryptedSmartPrivateKey as string, CK)).toBe(d.smart.privateKey);
  });

  it("encodes non-words modes as a {mode,value} JSON envelope inside encryptedSeedWords", { timeout: CRYPTO_TIMEOUT }, async () => {
    const bits = "01".repeat(1024); // 2048 bits
    const d = deriveDoubleApollo(bits, "bitstring");
    const id = await buildCodexIdentityFromDerivation(d, CK, {
      codexIdSeed: { mode: "bitstring", value: bits },
    });

    const plain = await decryptStringV2(id.encryptedSeedWords, CK);
    const parsed = JSON.parse(plain) as { mode: string; value: string };
    expect(parsed.mode).toBe("bitstring");
    expect(parsed.value).toBe(bits);
  });

  it("is non-deterministic per encryption yet recovers identical plaintext (AES-GCM v2 security property)", { timeout: CRYPTO_TIMEOUT }, async () => {
    const d = derive();
    const opts = { codexIdSeed: { mode: "words" as const, value: WORDS_12 } };
    const a = await buildCodexIdentityFromDerivation(d, CK, opts);
    const b = await buildCodexIdentityFromDerivation(d, CK, opts);

    // fresh salt+nonce → different ciphertext bytes across calls
    expect(a.encryptedSeedWords).not.toBe(b.encryptedSeedWords);
    expect(a.encryptedStandardBitstring).not.toBe(b.encryptedStandardBitstring);

    // but both decrypt to the same plaintext
    expect(await decryptStringV2(a.encryptedSeedWords, CK)).toBe(WORDS_12);
    expect(await decryptStringV2(b.encryptedSeedWords, CK)).toBe(WORDS_12);
  });

  it("binds ciphertext to CK — a wrong password fails to decrypt", { timeout: CRYPTO_TIMEOUT }, async () => {
    const d = derive();
    const id = await buildCodexIdentityFromDerivation(d, CK, {
      codexIdSeed: { mode: "words", value: WORDS_12 },
    });
    await expect(decryptStringV2(id.encryptedSeedWords, "wrong-password")).rejects.toThrow();
  });

  it("leaves createdBy undefined when no username is supplied", { timeout: CRYPTO_TIMEOUT }, async () => {
    const d = derive();
    const id = await buildCodexIdentityFromDerivation(d, CK, {
      codexIdSeed: { mode: "words", value: WORDS_12 },
    });
    expect(id.createdBy).toBeUndefined();
  });

  it("stamps createdAt from the real clock", { timeout: CRYPTO_TIMEOUT }, async () => {
    vi.useFakeTimers();
    const fixed = new Date("2026-05-31T12:00:00.000Z");
    vi.setSystemTime(fixed);

    const d = derive();
    const id = await buildCodexIdentityFromDerivation(d, CK, {
      codexIdSeed: { mode: "words", value: WORDS_12 },
    });
    expect(id.createdAt).toBe(fixed.toISOString());
  });
});

// Sanity: keep encryptStringV2 referenced so the import-resolution contract is
// exercised even if a future refactor drops one of the decrypt asserts.
it("uses the same encryptStringV2 envelope the helper relies on", async () => {
  const blob = await encryptStringV2("hello", CK);
  expect(await decryptStringV2(blob, CK)).toBe("hello");
});
