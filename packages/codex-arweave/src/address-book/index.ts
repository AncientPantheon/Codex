/**
 * The LIGHT address-book subpath barrel (E-11, FIX-8).
 *
 * Exposes the Arweave validator registration + the single-source
 * `ARWEAVE_CHAIN_ID` const. Carries NO static heavy-dependency edge (no adapter,
 * no panel, no Turbo/arweave sender) so a light consumer importing only this
 * subpath stays tree-shakeable.
 */

export { ARWEAVE_CHAIN_ID } from "./chainId.js";
export { arweaveValidator, registerArweaveAddressValidator } from "./arweaveValidator.js";
