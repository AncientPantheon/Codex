// @vitest-environment node
/**
 * `accountKeyCipher.ts` round-trip matrix (T1, `arweave-upload-encryption`).
 *
 * `encryptWithAccountKey`/`decryptWithAccountKey` are thin wrappers around an
 * INJECTED `CryptoSeam` (never a direct `@stoachain/stoa-core` import —
 * `codex-arweave` does not declare that dependency, mirroring
 * `keyring/foreignKeys.ts`'s own injected-seam architecture), keyed by an
 * Ouronet account's raw 1600-bit `"0"`/`"1"` bitstring rather than a codex
 * password. Pure crypto logic, no DOM — `// @vitest-environment node` (mirrors
 * `crypto-file-encryption.test.ts`'s own pragma for the same reason).
 *
 * The fake seam here is DETERMINISTIC and KEY-AWARE (unlike a plain
 * string-reversing fake, which would ignore the key entirely and so could
 * never fail a wrong-key case) — it mirrors `e1-foreign-keys-slice.test.ts`'s
 * own `reversingSeam` convention for a fake `CryptoSeam`, but ties the
 * ciphertext to the key so decrypting under the wrong bitstring genuinely
 * throws, exactly like the real V2 cipher's auth-tag check would.
 *
 * These rows prove the two properties the plan's "done when" calls out:
 *   - encrypt-then-decrypt round-trips a plaintext string EXACTLY under the
 *     same bitstring;
 *   - decrypting with a DIFFERENT bitstring than the one used to encrypt
 *     THROWS — the injected seam's wrong-key failure propagates, it is never
 *     caught/reworded into a different shape here.
 */

import { describe, it, expect } from "vitest";
import type { CryptoSeam } from "@ancientpantheon/codex-core";

import { encryptWithAccountKey, decryptWithAccountKey } from "../src/crypto/accountKeyCipher.js";

/** Stand-in 1600-bit `"0"`/`"1"` bitstrings — the canonical account-key form
 *  this module's callers always hand in (never base10/base49). The exact
 *  length/content doesn't matter for these unit rows; only that the two are
 *  distinct, stable strings usable as key material. */
const BITSTRING_A = "1".repeat(800) + "0".repeat(800);
const BITSTRING_B = "0".repeat(800) + "1".repeat(800);

/** A deterministic, KEY-AWARE fake `CryptoSeam`: the ciphertext embeds the key
 *  it was encrypted under, and `decrypt` throws unless the key matches — a
 *  plain string-reversing fake would ignore the key and could never fail a
 *  wrong-key case, so this is the minimal fake that actually exercises that
 *  property. */
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

describe("encryptWithAccountKey / decryptWithAccountKey", () => {
  it("round-trips a plaintext string exactly under the same bitstring", async () => {
    const plaintext = "a single short field — e.g. a password";

    const ciphertext = await encryptWithAccountKey(plaintext, BITSTRING_A, keyAwareFakeSeam);
    const decrypted = await decryptWithAccountKey(ciphertext, BITSTRING_A, keyAwareFakeSeam);

    expect(decrypted).toBe(plaintext);
  });

  it("throws when decrypting with a DIFFERENT bitstring than the one used to encrypt", async () => {
    const plaintext = "another account's secret field";
    const ciphertext = await encryptWithAccountKey(plaintext, BITSTRING_A, keyAwareFakeSeam);

    await expect(
      decryptWithAccountKey(ciphertext, BITSTRING_B, keyAwareFakeSeam),
    ).rejects.toThrow();
  });
});
