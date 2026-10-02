// @vitest-environment node
/**
 * `fileEncryption.ts` RED matrix (T3, `arweave-upload-encryption`).
 *
 * `deriveAccountAesKey`/`encryptWithDerivedKey`/`decryptWithDerivedKey` are the
 * derive-ONCE-per-upload-action cipher primitives used to encrypt many files
 * under one Ouronet account's bitstring without re-running the 600k-iteration
 * PBKDF2 per file (that per-file re-derivation is exactly what T1's
 * `encryptWithAccountKey`/`decryptWithAccountKey` — built for single, one-off
 * string values — would cost on a folder upload).
 *
 * Pure Node-crypto logic, no DOM — `// @vitest-environment node` (mirrors
 * `e3-upload.test.ts`'s own pragma for the same reason: avoid any jsdom/browser
 * shimming of WebCrypto affecting a pure cipher-math assertion).
 *
 * These rows prove the three properties the plan's "done when" calls out
 * explicitly:
 *   - same bitstring twice → the SAME derived key (deterministic salt, not
 *     randomly regenerated per call) — proven via an actual encrypt-under-call-1/
 *     decrypt-under-call-2 round trip, not just referential/structural equality;
 *   - a DIFFERENT bitstring's derived key fails to decrypt data encrypted under
 *     the first bitstring's key, and the failure is a THROWN error (AES-GCM's
 *     auth-tag check), never silently-wrong plaintext bytes;
 *   - encrypting the SAME data twice under the SAME key yields DIFFERENT
 *     ciphertext bytes each time (the IV really is fresh per call, not reused).
 */

import { describe, it, expect } from "vitest";

import {
  deriveAccountAesKey,
  encryptWithDerivedKey,
  decryptWithDerivedKey,
} from "../src/crypto/fileEncryption.js";

/** A stand-in 1600-bit `"0"`/`"1"` bitstring — the canonical account-key form
 *  this module's callers always hand in (never base10/base49). The exact
 *  length/content doesn't matter for these unit rows; only that it's a
 *  stable string usable as PBKDF2 key material. */
const BITSTRING_A = "1".repeat(800) + "0".repeat(800);
const BITSTRING_B = "0".repeat(800) + "1".repeat(800);

describe("deriveAccountAesKey — deterministic, salt derived from the bitstring itself", () => {
  it("derives a key from the SAME bitstring twice that can decrypt data encrypted under the first call's key", async () => {
    const keyCall1 = await deriveAccountAesKey(BITSTRING_A);
    const keyCall2 = await deriveAccountAesKey(BITSTRING_A);

    const plaintext = new TextEncoder().encode("hello, derive-once world");
    const { ciphertext, iv } = await encryptWithDerivedKey(keyCall1, plaintext);

    const decrypted = await decryptWithDerivedKey(keyCall2, ciphertext, iv);

    expect(new TextDecoder().decode(decrypted)).toBe("hello, derive-once world");
  });

  it("throws (never returns garbage plaintext) when decrypting with a key derived from a DIFFERENT bitstring", async () => {
    const keyA = await deriveAccountAesKey(BITSTRING_A);
    const keyB = await deriveAccountAesKey(BITSTRING_B);

    const plaintext = new TextEncoder().encode("secret file bytes");
    const { ciphertext, iv } = await encryptWithDerivedKey(keyA, plaintext);

    await expect(decryptWithDerivedKey(keyB, ciphertext, iv)).rejects.toThrow();
  });
});

describe("encryptWithDerivedKey — fresh IV per call", () => {
  it("produces DIFFERENT ciphertext bytes for the SAME data encrypted twice under the SAME key", async () => {
    const key = await deriveAccountAesKey(BITSTRING_A);
    const plaintext = new TextEncoder().encode("identical payload, encrypted twice");

    const first = await encryptWithDerivedKey(key, plaintext);
    const second = await encryptWithDerivedKey(key, plaintext);

    // The IV must differ (fresh crypto.getRandomValues per call)...
    expect(Buffer.from(first.iv).equals(Buffer.from(second.iv))).toBe(false);
    // ...and consequently so must the ciphertext, even though the plaintext
    // and key are identical both times.
    expect(Buffer.from(first.ciphertext).equals(Buffer.from(second.ciphertext))).toBe(false);

    // Both remain independently decryptable back to the original plaintext.
    expect(new TextDecoder().decode(await decryptWithDerivedKey(key, first.ciphertext, first.iv))).toBe(
      "identical payload, encrypted twice",
    );
    expect(new TextDecoder().decode(await decryptWithDerivedKey(key, second.ciphertext, second.iv))).toBe(
      "identical payload, encrypted twice",
    );
  });

  it("uses a 12-byte IV, matching the same AES-GCM IV length the V2 cipher uses", async () => {
    const key = await deriveAccountAesKey(BITSTRING_A);
    const { iv } = await encryptWithDerivedKey(key, new TextEncoder().encode("x"));

    expect(iv.byteLength).toBe(12);
  });
});
