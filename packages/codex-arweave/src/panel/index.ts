/**
 * Panel SUBPATH barrel for @ancientpantheon/codex-arweave — the HEAVY `./panel`
 * entry (the T14.4 export map points here).
 *
 * NAMED exports only (never `export *`) so the public surface is auditable and
 * tree-shakeable. Exposes the `ArweavePanel` (the codex-ui `PanelProps`-shaped
 * component the E5 consumer wires into `foreignChainPanels[ARWEAVE_CHAIN_ID]`) +
 * the seam-context provider/hook + the injected-deps TYPES the panel, its areas
 * (T14.8-T14.10), and the terminal root barrel (T14.13) type against.
 *
 * The 5 area components are imported by the RED tests DIRECTLY from
 * `../src/panel/{Keyring,Balance,Send,Upload,Library}Area`, so this barrel does
 * not re-export them. The root `src/index.ts` aggregation is owned by T14.11/
 * T14.13 — this barrel does NOT touch it.
 */

export { ArweavePanel } from "./ArweavePanel.js";
export {
  ArweavePanelProvider,
  ArweavePanelContext,
  useArweavePanelDeps,
} from "./context.js";
export type {
  ArweavePanelDeps,
  ArweavePanelProviderProps,
  KeygenRunner,
  KeygenProgress,
  ArweaveSendRequest,
  ArweaveSendResult,
  PanelAddressBookEntry,
} from "./context.js";

// The HEAVY lazy boundary (E-12 / FIX-2): the `./panel` subpath is the heavy
// entry, so it re-exports the default heavy Arweave runtime + the Turbo
// dynamic-import boundary. A LIGHT consumer (the `.` root / `./address-book`)
// never reaches this, keeping `@ardrive/turbo-sdk` + the static `arweave` edge
// out of its bundle; the panel entry retains both — the real light/heavy split.
export { loadTurbo, createDefaultArweaveRuntime } from "./lazyDeps.js";
export type { TurboSdkModule } from "./lazyDeps.js";
