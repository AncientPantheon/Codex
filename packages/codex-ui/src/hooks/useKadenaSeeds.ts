/**
 * useKadenaSeeds — CRUD over the codex's kadena seeds.
 *
 * Per-entity hook so components mutating one seed only re-render on
 * seeds-array changes (not the whole codex). Actions are the store
 * actions verbatim — they handle persistence + dirty-marking +
 * lastUpdatedAt touch internally.
 */

import { useCodexStore } from "../provider/index.js";
import type { IKadenaSeed } from "@ancientpantheon/codex-ouronet/types";

export interface KadenaSeedsView {
  seeds: IKadenaSeed[];
  addSeed: (seed: IKadenaSeed) => Promise<void>;
  updateSeed: (seed: IKadenaSeed) => Promise<void>;
  deleteSeed: (id: string) => Promise<void>;
}

export function useKadenaSeeds(): KadenaSeedsView {
  const store = useCodexStore();
  const seeds = store((s) => s.kadenaSeeds);
  const actions = store((s) => s.actions);

  return {
    seeds,
    addSeed: actions.addKadenaSeed,
    updateSeed: actions.updateKadenaSeed,
    deleteSeed: actions.deleteKadenaSeed,
  };
}
