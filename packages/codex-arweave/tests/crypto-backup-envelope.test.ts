// @vitest-environment node
/**
 * `backupEnvelope.ts` RED matrix (T1, `codex-backup-envelope-encryption`).
 *
 * This module provides two genuinely different operations, exercised
 * separately here:
 *   - `generateDek`/`encryptWithDek`/`decryptWithDek` — plain AES-GCM over an
 *     already-raw DEK (no password derivation at all). These rows prove the
 *     DEK generator produces real, independent keys and that content
 *     round-trips byte-exact under a fresh IV per call.
 *   - `wrapDekWithScalar`/`unwrapDekWithScalar` — the DEK's raw bytes
 *     themselves, wrapped as a V2-cipher string payload keyed by a
 *     password-shaped scalar string, via an injected `CryptoSeam` (the SAME
 *     injection convention `accountKeyCipher.ts`'s own tests use — a
 *     deterministic, KEY-AWARE fake seam, never a hand-rolled
 *     key-blind one, so a wrong-key decrypt genuinely throws). These rows
 *     prove the REAL functional property: unwrap a DEK and actually use it
 *     to decrypt content the original (pre-wrap) DEK encrypted — not just
 *     exported-bytes equality.
 *
 * Pure Node-crypto logic, no DOM — `// @vitest-environment node` (mirrors
 * `crypto-file-encryption.test.ts`/`crypto-account-key-cipher.test.ts`'s own
 * pragma for the same reason).
 */

import { describe, it, expect } from "vitest";
import type { CryptoSeam } from "@ancientpantheon/codex-core";
import { bigIntToBase49 } from "@ouronet/dalos-crypto/gen1";

import {
  generateDek,
  encryptWithDek,
  decryptWithDek,
  wrapDekWithScalar,
  unwrapDekWithScalar,
} from "../src/crypto/backupEnvelope.js";

/** A deterministic, KEY-AWARE fake `CryptoSeam` — mirrors
 *  `crypto-account-key-cipher.test.ts`'s own fake exactly (this package's
 *  established convention for exercising `CryptoSeam`-injected code without
 *  a real `@stoachain/stoa-core` dependency, which `codex-arweave` does not
 *  declare): the ciphertext embeds the key it was encrypted under, and
 *  `decrypt` throws unless the key matches, so a wrong-key case genuinely
 *  fails rather than silently ignoring the key. */
const keyAwareFakeSeam: CryptoSeam = {
  encrypt: (plaintext: string, key: string) => `${key}::${plaintext}`,
  decrypt: (ciphertext: string, key: string) => {
    const prefix = `${key}::`;
    if (!ciphertext.startsWith(prefix)) {
      throw new Error("wrong key — auth-tag-equivalent failure");
    }
    return ciphertext.slice(prefix.length);
  },
};

/** A real scalar, spelled two different ways — base10 (plain decimal) and
 *  base49 (`bigIntToBase49`, the SAME real function `codex-identity-derivation.
 *  test.ts`'s own base49-mode rows use from `@ouronet/dalos-crypto/gen1`) —
 *  proving the wrap functions are genuinely sensitive to the string handed
 *  in, not just to the underlying number. The exact value doesn't matter,
 *  only that it's a real scalar with two real, independently-computed
 *  spellings. */
const SCALAR = 123456789012345678901234567890n;
const SCALAR_BASE10 = SCALAR.toString(10);
const SCALAR_BASE49 = bigIntToBase49(SCALAR);

describe("generateDek", () => {
  it("produces a usable AES-GCM key", async () => {
    const dek = await generateDek();

    expect(dek.algorithm.name).toBe("AES-GCM");
    expect(dek.usages).toContain("encrypt");
    expect(dek.usages).toContain("decrypt");
  });

  it("never produces the same raw key bytes across two separate calls", async () => {
    const dekA = await generateDek();
    const dekB = await generateDek();

    const rawA = Buffer.from(await crypto.subtle.exportKey("raw", dekA));
    const rawB = Buffer.from(await crypto.subtle.exportKey("raw", dekB));

    expect(rawA.equals(rawB)).toBe(false);
  });
});

describe("encryptWithDek / decryptWithDek", () => {
  it("round-trips real content byte-exact under an already-raw DEK", async () => {
    const dek = await generateDek();
    const plaintext = new TextEncoder().encode("the full re-encrypted export JSON, as one blob");

    const { ciphertext, iv } = await encryptWithDek(dek, plaintext);
    const decrypted = await decryptWithDek(dek, ciphertext, iv);

    expect(Buffer.from(decrypted).equals(Buffer.from(plaintext))).toBe(true);
  });
});

describe("wrapDekWithScalar / unwrapDekWithScalar", () => {
  it("round-trips a REAL generated DEK's functional identity — unwrap and actually decrypt content with it", async () => {
    const dek = await generateDek();
    const plaintext = new TextEncoder().encode("secret codex content encrypted under the IDEK");
    const { ciphertext, iv } = await encryptWithDek(dek, plaintext);

    const wrapped = await wrapDekWithScalar(dek, SCALAR_BASE49, keyAwareFakeSeam);
    const unwrapped = await unwrapDekWithScalar(wrapped, SCALAR_BASE49, keyAwareFakeSeam);

    const decrypted = await decryptWithDek(unwrapped, ciphertext, iv);
    expect(Buffer.from(decrypted).equals(Buffer.from(plaintext))).toBe(true);
  });

  it("produces DIFFERENT wrapped ciphertext strings for base49 vs base10 spellings of the SAME scalar", async () => {
    const dek = await generateDek();

    const wrappedBase49 = await wrapDekWithScalar(dek, SCALAR_BASE49, keyAwareFakeSeam);
    const wrappedBase10 = await wrapDekWithScalar(dek, SCALAR_BASE10, keyAwareFakeSeam);

    expect(wrappedBase49).not.toBe(wrappedBase10);
  });

  it("fails loudly (the seam's own wrong-key error propagates unmodified) when unwrapping with the WRONG scalar string", async () => {
    const dek = await generateDek();
    const wrapped = await wrapDekWithScalar(dek, SCALAR_BASE49, keyAwareFakeSeam);

    await expect(
      unwrapDekWithScalar(wrapped, SCALAR_BASE10, keyAwareFakeSeam),
    ).rejects.toThrow("wrong key — auth-tag-equivalent failure");
  });
});
