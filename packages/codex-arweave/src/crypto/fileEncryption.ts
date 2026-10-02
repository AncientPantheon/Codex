/**
 * Derive-once, encrypt-many symmetric cipher for multi-file uploads.
 *
 * SEPARATE from `accountKeyCipher.ts`'s `encryptWithAccountKey`/
 * `decryptWithAccountKey` (T1): those are thin wrappers over
 * `@stoachain/stoa-core/crypto`'s `encryptStringV2`/`smartDecrypt`, meant for
 * SINGLE, one-off string encryptions. `encryptStringV2` re-runs its full
 * 600,000-iteration PBKDF2 derivation on EVERY call — fine for a one-off
 * value, but real, avoidable per-file delay for a folder upload of many
 * files. This module derives the AES key exactly ONCE per upload action
 * (`deriveAccountAesKey`) and reuses it via plain AES-GCM for every file
 * (`encryptWithDerivedKey`/`decryptWithDerivedKey`).
 *
 * ALGORITHM PARAMETERS — deliberately matched to
 * `@stoachain/stoa-core/crypto`'s V2 cipher (confirmed by reading its actual
 * source, `node_modules/@stoachain/stoa-core/dist/crypto/v2.js`) for
 * consistency/auditability across the codebase's encrypted-blob conventions:
 *   - PBKDF2, hash SHA-512, 600,000 iterations (OWASP-current minimum, same
 *     as V2's `encryptStringV2`/`decryptStringV2`);
 *   - AES-256-GCM;
 *   - 12-byte GCM IV, fresh per encrypt call.
 *
 * This module does NOT need byte-compatibility with V2's on-wire envelope
 * (`btoa(JSON.stringify({ v, ciphertext, iv, salt }))`) — nothing outside
 * this feature ever needs to decrypt an Arweave upload through the generic
 * V2 path, so `encryptWithDerivedKey`/`decryptWithDerivedKey` return raw
 * `{ ciphertext, iv }` byte pairs rather than V2's JSON envelope. The caller
 * (the upload composition layer) owns how the IV travels alongside the
 * ciphertext (e.g. prepended to the uploaded bytes).
 *
 * SALT DERIVATION — the one real design decision in this file. V2's cipher
 * generates a FRESH random 16-byte salt per `encryptStringV2` call and
 * carries it in the envelope, so `decryptStringV2` always has the exact
 * salt used at encrypt time. This module has no such envelope for the KEY
 * itself — `deriveAccountAesKey` must reproduce the IDENTICAL CryptoKey
 * from nothing but the bitstring, both when encrypting now and when
 * decrypting later (e.g. after a page reload), with no side-channel to
 * separately store/retrieve a random salt across those two calls. A
 * randomly-generated salt would therefore make every second call derive a
 * DIFFERENT key from the same bitstring — silently breaking decryption.
 * The fix: derive the salt DETERMINISTICALLY from the bitstring itself,
 * via SHA-256 of the UTF-8 bytes of a fixed, namespaced string built from
 * the bitstring (`"codex-arweave/file-encryption/salt/v1:" + bitstring`).
 * SHA-256's 32-byte digest is used directly as the PBKDF2 salt (PBKDF2's
 * `salt` parameter accepts any byte length — there is no 16-byte
 * requirement to match V2's convention, and a longer, hash-derived salt is
 * adequate here since PBKDF2's security against precomputation already
 * comes from the salt being UNIQUE per key-derivation input, not from being
 * secret or random). The namespace prefix keeps this salt derivation
 * cryptographically distinct from any other place in the codebase that
 * might hash the same bitstring for an unrelated purpose. Two calls to
 * `deriveAccountAesKey` with the SAME bitstring therefore always compute
 * the SAME salt, and so the SAME PBKDF2 output, and so the SAME AES-GCM
 * key — which is exactly the property this module's "derive now, derive
 * again later and still decrypt" contract requires.
 */

/** Namespace prefix mixed into the salt-derivation hash input, so this
 *  module's deterministic salt can never collide with an unrelated hash of
 *  the same bitstring computed elsewhere in the codebase for a different
 *  purpose. Versioned (`v1`) in case the derivation ever needs to change. */
const SALT_DERIVATION_NAMESPACE = "codex-arweave/file-encryption/salt/v1:";

/** AES-GCM IV length in bytes — matches V2's cipher and the standard
 *  96-bit GCM nonce size. */
const IV_BYTE_LENGTH = 12;

/** PBKDF2 iteration count — matches `@stoachain/stoa-core/crypto`'s V2
 *  cipher (OWASP's current minimum for PBKDF2-SHA512 at time of writing). */
const PBKDF2_ITERATIONS = 600_000;

/**
 * Deterministically derive the PBKDF2 salt for a given bitstring. SHA-256 of
 * a namespaced string built from the bitstring — see the module-level
 * comment for the full rationale. Returns the raw 32-byte digest, used
 * directly as PBKDF2's `salt`.
 */
async function deriveSaltFromBitstring(bitstring: string): Promise<Uint8Array<ArrayBuffer>> {
  const encoded = new TextEncoder().encode(SALT_DERIVATION_NAMESPACE + bitstring);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoded);
  return new Uint8Array(digest);
}

/**
 * Derive an AES-256-GCM `CryptoKey` from an Ouronet account's canonical
 * 1600-bit `"0"`/`"1"` bitstring, via PBKDF2-SHA512 at 600,000 iterations
 * (same parameters as `@stoachain/stoa-core/crypto`'s V2 cipher). The
 * PBKDF2 salt is DETERMINISTICALLY derived from the bitstring itself (see
 * the module-level comment) — calling this twice with the SAME bitstring
 * always yields a key that decrypts data encrypted under the other call's
 * key, with no salt to separately store or pass around.
 *
 * Intended to be called ONCE per upload action (not once per file) and the
 * resulting key reused across every file in that action via
 * `encryptWithDerivedKey`/`decryptWithDerivedKey` — that reuse is what
 * avoids re-running the expensive 600k-iteration PBKDF2 per file.
 */
export async function deriveAccountAesKey(bitstring: string): Promise<CryptoKey> {
  const salt = await deriveSaltFromBitstring(bitstring);
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(bitstring),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return globalThis.crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-512" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** The result of {@link encryptWithDerivedKey} — raw ciphertext bytes plus
 *  the fresh IV used to produce them. The caller is responsible for how the
 *  IV travels alongside the ciphertext (this module defines no envelope). */
export interface DerivedKeyEncryptResult {
  ciphertext: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
}

/**
 * Encrypt `data` under an already-derived key via AES-256-GCM, with a FRESH
 * random 12-byte IV generated per call (`crypto.getRandomValues`). Reusing
 * the same key across many files in one upload action is safe for AES-GCM
 * as long as every call gets its own fresh IV, which this function
 * guarantees — it never accepts or reuses a caller-supplied IV.
 */
export async function encryptWithDerivedKey(
  key: CryptoKey,
  data: Uint8Array<ArrayBuffer>,
): Promise<DerivedKeyEncryptResult> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTE_LENGTH));
  const encrypted = await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  return { ciphertext: new Uint8Array(encrypted), iv };
}

/**
 * Inverse of {@link encryptWithDerivedKey}. Decrypting with a key derived
 * from a DIFFERENT bitstring than the one used to encrypt fails the
 * AES-GCM auth-tag check and throws (WebCrypto's `OperationError`) — it
 * never silently returns garbage plaintext.
 */
export async function decryptWithDerivedKey(
  key: CryptoKey,
  ciphertext: Uint8Array<ArrayBuffer>,
  iv: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const decrypted = await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new Uint8Array(decrypted);
}
