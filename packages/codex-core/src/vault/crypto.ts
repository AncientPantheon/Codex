/**
 * The CK-wrapping vault: an INJECTABLE crypto seam, never a crypto re-impl.
 *
 * Every codex secret (a kadena seed's mnemonic, a pure keypair's private key, a
 * foreign chain's keyfile) is encrypted at the codex password — the "CK" — BEFORE
 * it reaches storage. codex-core owns that CONTRACT and the type discipline, but
 * holds NO real cipher and NO password: the actual KDF/cipher pair
 * (`encryptStringV2` / `smartDecrypt` from `@stoachain/stoa-core/crypto`) is
 * supplied by the consumer (D5/E1) as a `CryptoSeam`. Core never imports
 * `@stoachain/stoa-core`, keeping it dependency-light (D7).
 *
 * The CK is passed PER CALL and is NEVER retained on the vault object — the vault
 * is a thin caller-bound seam holder, so no field stores the password or the
 * plaintext. The real wiring (injecting `smartDecrypt`) is a D5/consumer concern;
 * the headless resolver factory that consumes this vault is D4/Phase 8.
 *
 * SECURITY CONTRACT: a decrypt failure surfaces as a `VaultCryptoError` that NAMES
 * the failing operation (so telemetry can see "decrypt failed") but NEVER echoes
 * the CK, the plaintext, or the ciphertext — no secret material reaches a log line.
 */

import { CodexError } from "../codex/errors.js";

/**
 * The injectable encrypt/decrypt pair. A consumer binds the real crypto
 * (`encryptStringV2` / `smartDecrypt`) at the call boundary; the vault only ever
 * delegates to this seam. Each method may be sync or async — the vault normalizes
 * the result to a `Promise`.
 */
export interface CryptoSeam {
  encrypt(plaintext: string, key: string): Promise<string> | string;
  decrypt(ciphertext: string, key: string): Promise<string> | string;
}

/**
 * The caller-bound vault surface. `wrap` encrypts a secret at the CK before
 * storage (output is ciphertext, never plaintext); `unwrap` recovers the
 * plaintext. Both return a `Promise` regardless of whether the injected seam is
 * sync or async.
 */
export interface Vault {
  wrap(plaintext: string, key: string): Promise<string>;
  unwrap(ciphertext: string, key: string): Promise<string>;
}

/**
 * Thrown when the injected seam's `decrypt` fails (wrong CK, corrupt ciphertext).
 * Extends `CodexError` so a consumer's module-wide `instanceof CodexError` catches
 * it alongside the codec errors. The message names the `decrypt` operation ONLY —
 * it never carries the CK, plaintext, or ciphertext value (secret-free). Restores
 * the prototype chain after `super()` so `instanceof VaultCryptoError` holds after
 * transpilation to older targets.
 */
export class VaultCryptoError extends CodexError {
  public override readonly name = "VaultCryptoError";

  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Build a vault bound to an injected `CryptoSeam`. The seam is the only reference
 * the vault closes over; the CK is supplied per call and never stored, so the
 * returned object retains neither the password nor any plaintext.
 */
export function makeVault(seam: CryptoSeam): Vault {
  return {
    async wrap(plaintext: string, key: string): Promise<string> {
      return await seam.encrypt(plaintext, key);
    },
    async unwrap(ciphertext: string, key: string): Promise<string> {
      try {
        return await seam.decrypt(ciphertext, key);
      } catch (cause) {
        // Name the operation for observability; never echo the CK, plaintext,
        // or ciphertext. The underlying cause is chained but not stringified
        // into the message.
        throw new VaultCryptoError("vault decrypt failed", { cause });
      }
    },
  };
}
