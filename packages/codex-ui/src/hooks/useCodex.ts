/**
 * useCodex — high-level read of the entire codex state.
 *
 * Intended for components that want a quick view of "what's in the
 * codex right now" — onboarding completion check, dashboard counters,
 * etc. Components that mutate one specific slice should use the
 * per-entity CRUD hooks (useStoaChainSeeds, useOuroAccounts, etc.) so
 * they only re-render on changes to that slice.
 *
 * This hook subscribes to MANY slices, so any change to the codex
 * re-renders the component. Acceptable for top-level / status
 * panels; not appropriate for high-frequency renders.
 */

import { useCodexStore } from "../provider/index.js";
import type { CodexMasterSeed } from "@ancientpantheon/codex-core";

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
  /** The per-codex-instance shape stamp (`"1.0.0"`, …), or `undefined` for a
   *  codex that predates this field ("Unversioned"). Distinct from
   *  `schemaVersion` (the local-only, never-exported migration counter) and
   *  from `CODEX_PACKAGE_VERSION_OUTPUT` (the running app/package's own
   *  build version) — see `docs/work/codex-shape-version-stamp/design.md`. */
  Codex_Shape_Version: string | undefined;
  /** The Codex Master Seed row — which three entities are the three faces of
   *  this codex's one seed. `undefined` on a codex that has never settled
   *  one; see codex-core's `codex/masterSeed.ts`. */
  codexMasterSeed: CodexMasterSeed | undefined;
  /** `"aligned"` once the codex's Prime Ouronet Account/Chainweb Seed/
   *  Arweave Seed trio has been permanently locked via the Permaweb
   *  Eligibility wizard's Finalize step; `"legacy"` otherwise (the
   *  default for every codex, including ones that predate this field —
   *  see `docs/work/legacy-prime-migration/design.md`'s "lock-in rule").
   *  Read directly off the live store (the real type, via a type-only
   *  import in `CodexProvider.tsx`) — not yet part of the exported JSON
   *  envelope, so never written through `buildCodexExport`. */
  primeAlignment: "legacy" | "aligned";
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
    Codex_Shape_Version: store((s) => s.Codex_Shape_Version),
    codexMasterSeed: store((s) => s.codexMasterSeed),
    primeAlignment: store((s) => s.primeAlignment),
    lastUpdatedAt: store((s) => s.lastUpdatedAt),
    lastUpdatedDevice: store((s) => s.lastUpdatedDevice),
  };
}
