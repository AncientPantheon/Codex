/**
 * The LIGHT-ONLY-CONSUMER tree-shake fixture (E-12 / N-08 — FIX-2 / F-002).
 *
 * This module imports ONLY the LIGHT surface of codex-arweave — the Arweave
 * address validator registration + the `ARWEAVE_CHAIN_ID` single-source const +
 * types — from the LIGHT `./address-book` subpath. It deliberately imports NO
 * `createArweaveAdapter` and NO heavy E1-E3 symbol: importing a heavy symbol
 * would LEGITIMATELY pull the `arweave` package (via arweave-core's static
 * sign.ts/transfer.ts edge), which is NOT what the light-consumer gate measures.
 *
 * When esbuild tree-shakes this entry (over codex-arweave's `sideEffects:false`
 * barrel), the emitted bundle MUST contain neither `@ardrive/turbo-sdk` (the
 * genuinely-lazy dep) nor the bare `arweave` package (the tree-shaken static
 * edge). The gate asserts exactly that.
 *
 * RED: `../../../src/address-book` (its `index.ts` barrel) does not exist yet
 * (T14.9 GREEN provisions it; T14.4 provisioned only the raw `chainId.ts`).
 */

import {
  ARWEAVE_CHAIN_ID,
  registerArweaveAddressValidator,
} from "../../../src/address-book";

// A trivial light-surface use so esbuild does not drop the whole module as dead.
export function registerLight(): string {
  registerArweaveAddressValidator();
  return ARWEAVE_CHAIN_ID;
}
