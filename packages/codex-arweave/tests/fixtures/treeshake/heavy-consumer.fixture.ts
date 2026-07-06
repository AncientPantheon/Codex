/**
 * The NEGATIVE-CONTROL tree-shake fixture (E-12 / N-08 — FIX-2 / F-3, REQUIRED).
 *
 * This module STATICALLY imports `createArweaveAdapter` — a heavy E1-E3 symbol
 * that reaches arweave-core's static `arweave` edge (via `sendTransfer` /
 * `signTransaction`). Bundling this entry MUST pull the `arweave` package into
 * the emitted output. The gate uses this fixture as the negative control: the
 * SAME absence assertion that PASSES on the light fixture MUST FAIL here. A
 * negative control that does NOT fail is itself a RED failure of the gate — it
 * is the only proof the gate is non-vacuous.
 *
 * RED: `../../../src/adapter` may already exist (E1), but the fixture is only
 * meaningful once the bundle helper (`scripts/treeshake-bundle.mjs`, T14.11)
 * exists to emit it — which it does not yet.
 */

import { createArweaveAdapter } from "../../../src/adapter/arweaveAdapter";

export function useHeavy(): typeof createArweaveAdapter {
  return createArweaveAdapter;
}
