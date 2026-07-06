/**
 * useStoaChainSeeds — CRUD over the codex's kadena seeds.
 *
 * Per-entity hook so components mutating one seed only re-render on
 * seeds-array changes (not the whole codex). Actions are the store
 * actions verbatim — they handle persistence + dirty-marking +
 * lastUpdatedAt touch internally.
 */

import { useCodexStore } from "../provider/index.js";
import type { IStoaChainSeed } from "@ancientpantheon/codex-ouronet/types";

export interface StoaChainSeedsView {
  seeds: IStoaChainSeed[];
  addSeed: (seed: IStoaChainSeed) => Promise<void>;
  updateSeed: (seed: IStoaChainSeed) => Promise<void>;
  deleteSeed: (id: string) => Promise<void>;
}

export function useStoaChainSeeds(): StoaChainSeedsView {
  const store = useCodexStore();
  const seeds = store((s) => s.kadenaSeeds);
  const actions = store((s) => s.actions);

  return {
    seeds,
    addSeed: actions.addStoaChainSeed,
    updateSeed: actions.updateStoaChainSeed,
    deleteSeed: actions.deleteStoaChainSeed,
  };
}
