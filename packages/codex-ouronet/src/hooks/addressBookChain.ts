/**
 * The chain-aware address-book validation seam (D-10 / D-11).
 *
 * `AddressBookEntry` gained an OPTIONAL `chainId` (defaulting to StoaChain on read).
 * This module is the PLUGGABLE per-chain validator registry that consumes it: a
 * `chainId` maps to a validator, and the address book validates a contact against
 * the validator for its chain.
 *
 * The registry VALUE TYPE is `(addr, type?: AddressKind) => boolean` — a chain
 * validator INTERNALLY dispatches on the orthogonal address-KIND (`type`), so the
 * StoaChain validator preserves the three per-kind checks verbatim rather than
 * collapsing them into one permissive/over-strict check. `type` (KIND) and
 * `chainId` (CHAIN) are orthogonal.
 *
 * The design mirrors codex-core's `createForeignChainRegistry`: a FACTORY returns
 * a fresh, instance-scoped registry (no global singleton), lookups FAIL LOUD
 * (an unregistered chain THROWS a typed error naming the chain id, never
 * returning a silent default), and no error echoes the address value. A
 * module-level default registry is provided for the app's single shared instance,
 * with a `reset` for test isolation.
 *
 * D5 ships the StoaChain validator + this seam only. E-series registers Arweave via
 * `registerChainAddressValidator(ARWEAVE_CHAIN_ID, arweaveValidator)` with ZERO
 * change here.
 */

import type { AddressKind } from "../types/entities.js";

/**
 * The default chainId a legacy entry (no `chainId`) resolves to on read
 * (`entry.chainId ?? STOACHAIN_CHAIN_ID`). Shares the string namespace with
 * codex-core's `ForeignKeyEntry.chainId` / `ForeignChainAdapter.id`, and is
 * DISTINCT from a foreign chainId like `"arweave:mainnet"`.
 */
export const STOACHAIN_CHAIN_ID = "kadena:mainnet";

/**
 * A per-chain address validator. Returns whether `addr` is well-formed for the
 * chain, dispatching internally on the orthogonal address-KIND (`type`).
 */
export type ChainAddressValidator = (addr: string, type?: AddressKind) => boolean;

/** Strip a leading StoicTag `§` sigil and surrounding whitespace. Mirrors the
 *  bare-name storage rule the address book uses for `stoic-tag` entries. */
const stripSigil = (v: string): string => v.replace(/^§/, "").trim();

/**
 * The StoaChain chain validator. Dispatches on the address-KIND to reuse the three
 * per-kind checks the address book has always enforced:
 *   - `ouronet`   → starts with `Ѻ.`
 *   - `stoa`      → starts with `k:` / `c:` / `w:` / `u:`
 *   - `stoic-tag` → a non-empty bare tag (after stripping the `§` sigil)
 *
 * The three are kept distinct: an address valid under one kind is rejected under
 * another. An unspecified/unknown kind is not a valid StoaChain address.
 */
export const stoaChainAddressValidator: ChainAddressValidator = (addr, type) => {
  switch (type) {
    case "ouronet":
      return addr.startsWith("Ѻ.");
    case "stoa":
      return /^[kcwu]:/.test(addr);
    case "stoic-tag":
      return stripSigil(addr).length > 0;
    default:
      return false;
  }
};

/**
 * Thrown when `validateAddress` is asked to dispatch on a chainId that has no
 * registered validator — a programmer error that must fail diagnosably (mirrors
 * codex-core's `ForeignChainError` on an unregistered chain). The message NAMES
 * the missing chainId but NEVER echoes the address value it was asked to
 * validate.
 */
export class UnknownChainError extends Error {
  public override readonly name = "UnknownChainError";

  constructor(chainId: string, options?: ErrorOptions) {
    super(`No address validator registered for chainId "${chainId}"`, options);
    // Restore the prototype chain after super() reset it, so
    // `instanceof UnknownChainError` survives transpilation to older targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * A fresh, instance-scoped registry of chain address validators. Maps `chainId`
 * → validator behind `register` / `validate` / `getRegisteredChains`.
 */
export type AddressValidatorRegistry = {
  /** Register a validator under a chainId. */
  register(chainId: string, validator: ChainAddressValidator): void;
  /** Validate `addr` (dispatching on `type`) against `chainId`'s validator.
   *  Throws `UnknownChainError` naming the chainId if none is registered. */
  validate(chainId: string, addr: string, type?: AddressKind): boolean;
  /** All registered chainIds. */
  getRegisteredChains(): string[];
};

/**
 * Create a fresh, empty, instance-scoped address-validator registry. Two
 * registries are fully isolated — registrations never leak between them, and a
 * freshly created registry reports no chains.
 */
export function createAddressValidatorRegistry(): AddressValidatorRegistry {
  const validators = new Map<string, ChainAddressValidator>();

  return {
    register(chainId, validator) {
      validators.set(chainId, validator);
    },

    validate(chainId, addr, type) {
      const validator = validators.get(chainId);
      if (validator === undefined) {
        throw new UnknownChainError(chainId);
      }
      return validator(addr, type);
    },

    getRegisteredChains() {
      return [...validators.keys()];
    },
  };
}

// ----- module-level default registry (the app's single shared instance) -----

let defaultRegistry = createAddressValidatorRegistry();

/** Register a validator on the module-level default registry. */
export function registerChainAddressValidator(
  chainId: string,
  validator: ChainAddressValidator,
): void {
  defaultRegistry.register(chainId, validator);
}

/** Validate `addr` (dispatching on `type`) against the module-level default
 *  registry's validator for `chainId`. Throws `UnknownChainError` if none. */
export function validateAddress(
  chainId: string,
  addr: string,
  type?: AddressKind,
): boolean {
  return defaultRegistry.validate(chainId, addr, type);
}

/** All chainIds registered on the module-level default registry. */
export function getRegisteredChains(): string[] {
  return defaultRegistry.getRegisteredChains();
}

/** Clear the module-level default registry (test isolation). */
export function resetAddressValidators(): void {
  defaultRegistry = createAddressValidatorRegistry();
}
