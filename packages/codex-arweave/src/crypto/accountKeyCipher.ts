/**
 * `encryptWithAccountKey` / `decryptWithAccountKey` — a one-shot, Ouronet
 * account-keyed string cipher (T1, `arweave-upload-encryption`; also the
 * shared convention `docs/work/codex-recovery-backup-tagging/design.md`'s own
 * T1 calls for — this IS that primitive, not a second, duplicate one).
 *
 * Thin wrappers around an INJECTED `CryptoSeam` (`@ancientpantheon/codex-core`)
 * — never a direct `@stoachain/stoa-core` import. `codex-arweave` does not (and
 * per its own architecture, per `keyring/foreignKeys.ts`'s own module doc
 * comment — "codex-core owns the at-rest crypto CONTRACT... holds no real
 * cipher — the caller injects the live `smartEncrypt`/`smartDecrypt` seam" —
 * must not) declare a direct dependency on `@stoachain/stoa-core`; only the
 * packages that already do (`codex-ouronet`, `codex-ui`, the host app) may
 * construct the real seam (`encryptStringV2`/`smartDecrypt`) and hand it in
 * at the call boundary, exactly mirroring `foreignKeys.ts`'s existing
 * `CryptoSeam`-injection pattern for the JWK keyring. The real seam is the
 * same PBKDF2-SHA512/600k-iteration AES-GCM v2 envelope every other
 * codex-password-keyed secret in this monorepo already uses. The only
 * difference here: the "password" handed to the cipher is an Ouronet
 * account's private key material, not the codex password.
 *
 * `bitstring` MUST be the raw 1600-bit `"0"`/`"1"` string form of that
 * account's key — NEVER its base10 or base49 spelling. Different spellings
 * of the SAME key derive DIFFERENT AES keys (each is a different string to
 * PBKDF2), so encrypting under one spelling and decrypting under another
 * silently fails to round-trip. This module does NOT validate or re-derive
 * that shape itself — normalizing an arbitrary key spelling to its canonical
 * bitstring form is `resolveSeedBitString.ts`'s job, upstream of this module.
 * Callers MUST normalize before calling either function here.
 *
 * SCOPE: this helper is for a SINGLE, one-off small-string encryption (a
 * password, one short field) — NOT file content. The real V2 cipher re-runs
 * its full 600k-iteration PBKDF2 derivation on EVERY call, so calling this
 * once per file in a multi-file upload would re-pay that cost per file. Bulk/
 * file encryption uses the derive-ONCE `fileEncryption.ts` primitives
 * (`deriveAccountAesKey`/`encryptWithDerivedKey`/`decryptWithDerivedKey`)
 * instead.
 */

import type { CryptoSeam } from "@ancientpantheon/codex-core";

/**
 * Encrypt a single plaintext string under an Ouronet account's bitstring key.
 *
 * @param plaintext - the short string to encrypt (e.g. a password, one field).
 * @param bitstring - the account's private key, in its raw 1600-bit `"0"`/`"1"`
 *   canonical form (never base10/base49).
 * @param seam - the injected real cipher (e.g. `{ encrypt: encryptStringV2,
 *   decrypt: smartDecrypt }` from `@stoachain/stoa-core/crypto`, constructed
 *   by a caller that already depends on that package).
 */
export async function encryptWithAccountKey(
  plaintext: string,
  bitstring: string,
  seam: CryptoSeam,
): Promise<string> {
  return seam.encrypt(plaintext, bitstring);
}

/**
 * Decrypt a ciphertext produced by {@link encryptWithAccountKey} back to its
 * plaintext string. Decrypting under a DIFFERENT bitstring than the one used
 * to encrypt throws — the injected seam's wrong-key failure propagates
 * unmodified, it is never caught or reworded here.
 *
 * @param ciphertext - the envelope produced by {@link encryptWithAccountKey}.
 * @param bitstring - the SAME account's raw 1600-bit `"0"`/`"1"` canonical
 *   bitstring used to encrypt.
 * @param seam - the injected real cipher, same as {@link encryptWithAccountKey}.
 */
export async function decryptWithAccountKey(
  ciphertext: string,
  bitstring: string,
  seam: CryptoSeam,
): Promise<string> {
  return seam.decrypt(ciphertext, bitstring);
}
