// @ancientpantheon/codex-ui/ui/foreign-chains — the chain-generic foreign-chains
// tab subpath barrel.
//
// NAMED re-exports only (no `export *`) — the generic tab shell + its
// chain-agnostic panel-slot contract. The shell dispatches per-chain subtabs
// PURELY off the injected id list + slot map; it names no concrete chain, imports
// no concrete chain panel, and carries no @stoachain / Arweave value edge.

export { ForeignChainsTab } from "./ForeignChainsTab.js";
export type {
  PanelProps,
  ForeignChainPanels,
  ForeignChainsTabProps,
} from "./ForeignChainsTab.js";
