/**
 * `generateDek` / `encryptWithDek` / `decryptWithDek` / `wrapDekWithScalar` /
 * `unwrapDekWithScalar` — the foundational envelope-encryption primitives for
 * a codex-backup upload (T1, `codex-backup-envelope-encryption`). These are
 * pure, reusable crypto building blocks: no dependency on `codex-core`'s
 * codec/export shape and no backup-specific logic at all. The caller (Wave 2)
 * decides which DEK plays the "IDEK" role (re-encrypting individual secret
 * fields) and which plays the "EDEK" role (encrypting the whole resulting
 * export as one opaque blob) — this module has no concept of either role, it
 * only makes and operates on generic DEKs.
 *
 * TWO GENUINELY DIFFERENT OPERATIONS — never conflate them:
 *
 * 1. Encrypting codex CONTENT under an already-raw DEK
 *    (`encryptWithDek`/`decryptWithDek`): plain AES-256-GCM, no password, no
 *    derivation step of any kind. The DEK is already a real, random
 *    `CryptoKey` (from `generateDek`) — these functions just run AES-GCM with
 *    a fresh IV per call, identical in shape to `fileEncryption.ts`'s own
 *    `encryptWithDerivedKey`/`decryptWithDerivedKey` (which already have
 *    exactly this signature: operate on an already-resolved `CryptoKey`
 *    regardless of how it was derived). This module re-exports those two
 *    directly under this file's names rather than duplicating the AES-GCM
 *    call — see the re-export below for why no new code was needed here.
 *
 * 2. Wrapping the DEK ITSELF under a password-shaped scalar string
 *    (`wrapDekWithScalar`/`unwrapDekWithScalar`): the DEK's raw bytes are
 *    exported, base64-encoded into a string, and that STRING is encrypted via
 *    the injected `CryptoSeam` (the real PBKDF2-SHA512/600k-iteration
 *    AES-256-GCM V2 envelope, `encryptStringV2`/`smartDecrypt`) keyed by
 *    `scalarString` — structurally the SAME operation as
 *    `accountKeyCipher.ts`'s `encryptWithAccountKey`/`decryptWithAccountKey`
 *    (wrap a plaintext string under a bitstring-derived V2 key via an
 *    injected seam), just wrapping raw DEK bytes instead of a password. Per
 *    the design doc, `scalarString` is one of two different string spellings
 *    of the SAME underlying scalar (`base49(scalar)` wraps the IDEK,
 *    `base10(scalar)` wraps the EDEK, for each of the two default wrap
 *    sources) — different spellings are different strings to the cipher, so
 *    they produce different wrapped ciphertext even for the same scalar and
 *    the same DEK. `codex-arweave` does not (and must not) declare a direct
 *    dependency on `@stoachain/stoa-core` — only a caller that already does
 *    (`codex-ouronet`, `codex-ui`, the host app) may construct the real seam
 *    and hand it in at the call boundary, mirroring `accountKeyCipher.ts`'s
 *    own injection convention exactly.
 */

import type { CryptoSeam } from "@ancientpantheon/codex-core";

import {
  encryptWithDerivedKey,
  decryptWithDerivedKey,
  type DerivedKeyEncryptResult,
} from "./fileEncryption.js";

/**
 * Generate a fresh, random AES-256-GCM `CryptoKey` via
 * `crypto.subtle.generateKey` — used identically for BOTH the IDEK and the
 * EDEK roles (this function has no concept of either; two independent calls
 * produce two independent keys, and the caller decides which role each
 * plays). Extractable (`true`), matching `wrapDekWithScalar`'s need to
 * `exportKey("raw", ...)` it, and matching `fileEncryption.ts`'s own derived
 * keys' non-extractable-vs-extractable split by necessity rather than by
 * convention — `deriveAccountAesKey`'s key never needs to leave the process,
 * a DEK must, in order to be wrapped.
 */
export async function generateDek(): Promise<CryptoKey> {
  return globalThis.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Encrypt codex content under an already-raw DEK. Plain AES-256-GCM, no
 * derivation — a direct re-export of `fileEncryption.ts`'s
 * `encryptWithDerivedKey`, whose signature (operate on an already-resolved
 * `CryptoKey`, fresh random IV per call) already fits this module's needs
 * exactly; writing a second, near-duplicate AES-GCM call here would diverge
 * from that file's IV-length/randomness guarantees for no reason.
 */
export const encryptWithDek: (
  key: CryptoKey,
  data: Uint8Array<ArrayBuffer>,
) => Promise<DerivedKeyEncryptResult> = encryptWithDerivedKey;

/**
 * Decrypt content produced by {@link encryptWithDek}. A direct re-export of
 * `fileEncryption.ts`'s `decryptWithDerivedKey` — same reasoning as
 * {@link encryptWithDek}: the signature already fits, so there is nothing
 * genuinely new to write.
 */
export const decryptWithDek: (
  key: CryptoKey,
  ciphertext: Uint8Array<ArrayBuffer>,
  iv: Uint8Array<ArrayBuffer>,
) => Promise<Uint8Array<ArrayBuffer>> = decryptWithDerivedKey;

/**
 * Wrap a DEK (encrypt its raw bytes, ~32 bytes, as a small string payload)
 * under a password-shaped scalar string, via the injected `CryptoSeam`.
 * Exports the DEK's raw bytes, base64-encodes them into a plaintext string,
 * and hands that string to the seam exactly as `accountKeyCipher.ts`'s
 * `encryptWithAccountKey` hands in its plaintext — the seam never sees a
 * `CryptoKey` or raw bytes directly, only the base64 string.
 *
 * @param dek - the DEK to wrap (IDEK or EDEK — this function doesn't care
 *   which role it plays).
 * @param scalarString - the password-shaped key material: a string spelling
 *   (e.g. `base49(scalar)` or `base10(scalar)`) of one of the two default
 *   wrap sources' scalar. Different spellings of the SAME scalar are
 *   different strings to the cipher and so produce different wrapped output
 *   — callers must use the exact spelling the design's wrap-source/layer
 *   pairing calls for, and the SAME spelling again on unwrap.
 * @param seam - the injected real cipher (e.g.
 *   `{ encrypt: encryptStringV2, decrypt: smartDecrypt }`), constructed by a
 *   caller that already depends on `@stoachain/stoa-core`.
 */
export async function wrapDekWithScalar(
  dek: CryptoKey,
  scalarString: string,
  seam: CryptoSeam,
): Promise<string> {
  const raw = await globalThis.crypto.subtle.exportKey("raw", dek);
  const rawBase64 = Buffer.from(raw).toString("base64");
  return seam.encrypt(rawBase64, scalarString);
}

/**
 * Inverse of {@link wrapDekWithScalar}: decrypts the wrapped string back to
 * the DEK's raw bytes and re-imports them as a usable AES-256-GCM
 * `CryptoKey` (`crypto.subtle.importKey("raw", ...)`, extractable — matching
 * {@link generateDek}'s own extractable key, so an unwrapped DEK can be
 * wrapped again under another source without a fresh `generateKey` call).
 * Unwrapping with a `scalarString` DIFFERENT from the one used to wrap
 * throws — the injected seam's own wrong-key failure propagates unmodified,
 * it is never caught or reworded here.
 *
 * @param wrapped - the string produced by {@link wrapDekWithScalar}.
 * @param scalarString - the SAME scalar spelling used to wrap.
 * @param seam - the injected real cipher, same as {@link wrapDekWithScalar}.
 */
export async function unwrapDekWithScalar(
  wrapped: string,
  scalarString: string,
  seam: CryptoSeam,
): Promise<CryptoKey> {
  const rawBase64 = await seam.decrypt(wrapped, scalarString);
  const raw = Buffer.from(rawBase64, "base64");
  return globalThis.crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, true, [
    "encrypt",
    "decrypt",
  ]);
}
