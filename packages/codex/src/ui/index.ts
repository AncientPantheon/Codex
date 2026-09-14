// @ancientpantheon/codex/ui — the full Codex UI surface.
//
// codex-ouronet's `./ui` barrel is the single place the complete pre-carve UI
// name set is reassembled: the chain-generic leaves + settings cards moved into
// codex-ui, PLUS the Ouronet-edged account tabs, the zbom debouncer trio, the
// settings cards, and the Ouronet-composed CodexTabs / CodexSettingsSection
// aggregators. One source, no collisions.
//
// The stylesheet ships separately as `@ancientpantheon/codex/ui.css`.
export * from "@ancientpantheon/codex-ouronet/ui";

// The aggregate-only wiring: `CodexTabs` with Class 2's rail pre-bound to the
// two chain panels this package (and only this package) can see. Plain
// `CodexTabs` above stays available for a consumer wiring its own chains.
export { CodexTabsWired } from "./CodexTabsWired.js";
export type { CodexTabsWiredProps } from "./CodexTabsWired.js";
