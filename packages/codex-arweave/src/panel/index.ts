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
// `CodexIdPage` — the extracted "Codex ID" page content (same markup
// `ArweavePanel.tsx`'s own `active === "codex-id"` branch renders), exposed
// here so a host can mount it DIRECTLY from a top-level nav entry, outside
// `ArweavePanel`'s own tab-bar machinery, without duplicating any markup.
export { CodexIdPage } from "./CodexIdPage.js";
export type { CodexIdPageProps } from "./CodexIdPage.js";
// The payload `CodexIdPage`'s `ensurePrimeArweaveSeed` reports progress
// through. Exported BY NAME so the consumer that renders the live prime-search
// line — `codex-ouronet`'s `LegacyPrimeMigrationWizard`, which cannot import
// the rendering component itself without closing a package cycle — types
// against THIS declaration rather than re-declaring the shape structurally and
// drifting from it. A type-only import is fully erased, so naming it there
// adds no runtime edge back into this heavy entry.
export type {
  EnsurePrimeArweaveSeedProgress,
  EnsurePrimeArweaveSeedSearch,
} from "./CodexIdPage.js";
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
// entry, so it re-exports the default heavy Arweave runtime. A LIGHT consumer
// (the `.` root / `./address-book`) never reaches this, keeping the static
// `arweave` edge out of its bundle; the panel entry retains it — the real
// light/heavy split.
//
// `loadTurbo` / `TurboSdkModule` were removed here (browser-safe-release,
// 2026-11): nothing called them, and the `@ardrive/turbo-sdk` specifier they
// carried had to be RESOLVED by a consumer's browser bundler even behind a
// dynamic `import()`, which broke a Turbopack build on 1.6.0. See
// `./lazyDeps.ts` for the full history.
export { createDefaultArweaveRuntime } from "./lazyDeps.js";
