/**
 * useCodex — high-level read of the entire codex state.
 *
 * Intended for components that want a quick view of "what's in the
 * codex right now" — onboarding completion check, dashboard counters,
 * etc. Components that mutate one specific slice should use the
 * per-entity CRUD hooks (useKadenaSeeds, useOuroAccounts, etc.) so
 * they only re-render on changes to that slice.
 *
 * This hook subscribes to MANY slices, so any change to the codex
 * re-renders the component. Acceptable for top-level / status
 * panels; not appropriate for high-frequency renders.
 */

import { useCodexStore } from "../provider/index.js";

export interface CodexView {
  isReady: boolean;
  isLocked: boolean;
  isDirty: boolean;
  initError: Error | null;

  kadenaSeeds: ReturnType<
    ReturnType<typeof useCodexStore>["getState"]
  >["kadenaSeeds"];
  pureKeypairs: ReturnType<
    ReturnType<typeof useCodexStore>["getState"]
  >["pureKeypairs"];
  ouroAccounts: ReturnType<
    ReturnType<typeof useCodexStore>["getState"]
  >["ouroAccounts"];
  addressBook: ReturnType<
    ReturnType<typeof useCodexStore>["getState"]
  >["addressBook"];
  watchList: ReturnType<
    ReturnType<typeof useCodexStore>["getState"]
  >["watchList"];
  uiSettings: ReturnType<
    ReturnType<typeof useCodexStore>["getState"]
  >["uiSettings"];

  schemaVersion: number;
  lastUpdatedAt: string | null;
  lastUpdatedDevice: ReturnType<
    ReturnType<typeof useCodexStore>["getState"]
  >["lastUpdatedDevice"];
}

export function useCodex(): CodexView {
  const store = useCodexStore();
  return {
    isReady: store((s) => s.ready),
    isLocked: store((s) => s.locked),
    isDirty: store((s) => s.dirty),
    initError: store((s) => s.initError),
    kadenaSeeds: store((s) => s.kadenaSeeds),
    pureKeypairs: store((s) => s.pureKeypairs),
    ouroAccounts: store((s) => s.ouroAccounts),
    addressBook: store((s) => s.addressBook),
    watchList: store((s) => s.watchList),
    uiSettings: store((s) => s.uiSettings),
    schemaVersion: store((s) => s.schemaVersion),
    lastUpdatedAt: store((s) => s.lastUpdatedAt),
    lastUpdatedDevice: store((s) => s.lastUpdatedDevice),
  };
}
