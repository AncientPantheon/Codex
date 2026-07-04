/**
 * Flag-gated mnemonic + EthAReum key-derivation DESIGN STUBS.
 *
 * v1 of this library is SEEDLESS-ONLY: the default account is an RSA JWK
 * generated directly (see `generate.ts`). Mnemonic-based derivation and the
 * "EthAReum" (derive an Arweave key from an Ethereum signature) path are kept
 * here as design surface ONLY — nothing is implemented. Both live behind flags
 * that default OFF, which is a spec contract, not a convenience default.
 *
 * These stubs exist so the future-facing public signatures are pinned into the
 * barrel-locked `.d.ts` now; a later spec that actually implements a path fills
 * the bodies and renames the underscore-prefixed parameters — the exported
 * surface does not shift under consumers when that happens.
 *
 * DESIGN WARNINGS (carried forward from the integration handoff — read before
 * ever enabling these paths):
 *
 * - Mnemonic derivation is NON-NATIVE to Arweave and is NOT deterministic
 *   across libraries: different implementations map the same phrase to
 *   different keys. If ever enabled, exactly ONE derivation implementation
 *   MUST be pinned and versioned, and every derived address MUST record which
 *   implementation produced it — otherwise the same phrase silently yields a
 *   different (unrecoverable) account under a different library or version.
 * - One phrase = one key = one address. There is NO HD / BIP44 multi-account
 *   derivation here and no such claim may be made. Multiple addresses are
 *   ALWAYS multiple independent keyfiles, never children of one seed.
 * - EthAReum is a ONE-WAY link only: an Ethereum signature can seed an Arweave
 *   key, but the Arweave key can never be turned back into the Ethereum key.
 */

import type { ArweaveJwk } from "./types.js";
// The derivation errors now live in the keys-module error home (`./errors.js`).
// They are imported here (the stubs throw them) and re-exported so existing
// import paths (`from "./derivation.js"`) keep working.
import {
  KeyDerivationDisabledError,
  KeyDerivationNotImplementedError,
} from "./errors.js";
export { KeyDerivationDisabledError, KeyDerivationNotImplementedError };
export type { KeyDerivationPath } from "./errors.js";

/**
 * Per-call switches for the optional derivation paths. Passed explicitly by a
 * caller that opts in; omitting them applies {@link DEFAULT_KEY_DERIVATION_FLAGS}
 * (both OFF). This is a per-call parameter rather than module-global mutable
 * state so a headless library carries no hidden switch.
 */
export interface KeyDerivationFlags {
  /** Enable mnemonic-phrase derivation. Default OFF. */
  readonly mnemonic: boolean;
  /** Enable the EthAReum (Ethereum-signature) derivation path. Default OFF. */
  readonly ethareum: boolean;
}

/**
 * The default flag set: both optional paths OFF. Frozen so a consumer cannot
 * flip a path on by mutating the shared default — "default OFF" is structurally
 * enforced, not merely conventional.
 */
export const DEFAULT_KEY_DERIVATION_FLAGS: KeyDerivationFlags = Object.freeze({
  mnemonic: false,
  ethareum: false,
});

/**
 * DESIGN STUB — derive an Arweave JWK from a mnemonic phrase. NOT implemented.
 *
 * Throws {@link KeyDerivationDisabledError} unless `flags.mnemonic` is `true`
 * (the default is OFF), and {@link KeyDerivationNotImplementedError} when it is
 * forced on. See the module-level design warnings: mnemonic derivation is
 * non-native and cross-library non-deterministic, and there is no HD/BIP44
 * multi-account model — one phrase is exactly one key.
 *
 * The `_mnemonic` parameter is underscore-prefixed because the stub body never
 * reads it (the flag gate alone decides the outcome); the tsconfig pins
 * `noUnusedParameters`, whose documented exemption is the `_` prefix.
 */
export function generateFromMnemonic(
  _mnemonic: string,
  flags: KeyDerivationFlags = DEFAULT_KEY_DERIVATION_FLAGS,
): Promise<ArweaveJwk> {
  if (!flags.mnemonic) {
    return Promise.reject(new KeyDerivationDisabledError("mnemonic"));
  }
  return Promise.reject(new KeyDerivationNotImplementedError("mnemonic"));
}

/**
 * DESIGN STUB — derive an Arweave JWK from an Ethereum signature (the EthAReum
 * path). NOT implemented.
 *
 * Throws {@link KeyDerivationDisabledError} unless `flags.ethareum` is `true`
 * (the default is OFF), and {@link KeyDerivationNotImplementedError} when it is
 * forced on. See the module-level design warnings: EthAReum is a one-way link
 * only — the resulting Arweave key can never be reversed back to the Ethereum
 * key.
 *
 * The `_signature` parameter is underscore-prefixed because the stub body never
 * reads it (the flag gate alone decides the outcome); the tsconfig pins
 * `noUnusedParameters`, whose documented exemption is the `_` prefix.
 */
export function deriveFromEthereumSignature(
  _signature: Uint8Array,
  flags: KeyDerivationFlags = DEFAULT_KEY_DERIVATION_FLAGS,
): Promise<ArweaveJwk> {
  if (!flags.ethareum) {
    return Promise.reject(new KeyDerivationDisabledError("ethareum"));
  }
  return Promise.reject(new KeyDerivationNotImplementedError("ethareum"));
}
