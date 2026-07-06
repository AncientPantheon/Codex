/**
 * The Arweave canonical-address validator + its registration into D5's per-chain
 * address-book validator registry (E-11).
 *
 * The validator DELEGATES to arweave-core `isCanonicalAddress` — it never
 * re-spells the 43-char base64url form (that regex lives once, in
 * arweave-core `canonical.ts`). Arweave addresses have no per-type variants, so
 * the `type` argument the registry passes is ignored.
 */

import { isCanonicalAddress } from "@ancientpantheon/arweave-core";
import { registerChainAddressValidator } from "@ancientpantheon/codex-ouronet/hooks";

import { ARWEAVE_CHAIN_ID } from "./chainId.js";

/**
 * Whether `addr` is a canonical Arweave address. Delegates to arweave-core's
 * `isCanonicalAddress`; the `type` argument is ignored (Arweave has no
 * type-specific address forms).
 */
export function arweaveValidator(addr: string, _type?: unknown): boolean {
  return isCanonicalAddress(addr);
}

/**
 * Register the Arweave validator on D5's module-level default validator registry.
 * Idempotent-safe from the caller's view: it registers under
 * `ARWEAVE_CHAIN_ID` and does not touch any other chain's validator.
 */
export function registerArweaveAddressValidator(): void {
  registerChainAddressValidator(ARWEAVE_CHAIN_ID, arweaveValidator);
}
