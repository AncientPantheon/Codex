// ============================================================================
// networkSettings — the playground's surfaced, editable, UNLOCKED network config
// (CL-13, N-03, N-04).
//
// The standalone Codex has no operator-injected global connection, so BOTH
// chains are surfaced as LOCAL, user-editable endpoints:
//   - the StoaChain node URL, defaulting to the explicit node2-host
//     default `STOACHAIN_DEFAULT_NODE_URL` (never a hidden hardcoded node);
//   - the Arweave gateway URL, defaulting to the local testnet gateway
//     `DEFAULT_GATEWAY_URL` (= http://localhost:1984 — NEVER mainnet, N-04).
//
// The config is persisted to localStorage (browser-scoped) so an edit survives a
// reload. `resolveNetworkModel` builds a codex-core `NetworkSettingsModel` off
// the surfaced state via `createConnectionResolver` (global: undefined → both
// chains resolve LOCAL → "live-local" + editable), which the dashboard renders
// through codex-ui's `NetworkSettingsCard`.
//
// Keys never enter this layer: the connection seam is keyless, and this module
// only carries endpoint URLs.
// ============================================================================

import {
  createConnectionResolver,
  createPythiaConnection,
  type NetworkSettingsModel,
} from "@ancientpantheon/codex-core";
import {
  createStoaChainConnection,
  STOACHAIN_DEFAULT_NODE_URL,
} from "@ancientpantheon/codex-ouronet/connection";
import { createArweaveConnection } from "@ancientpantheon/codex-arweave/connection";
import { ARWEAVE_CHAIN_ID } from "@ancientpantheon/codex-arweave/address-book";

import { DEFAULT_GATEWAY_URL } from "./ArweaveModeToggle";

/** The StoaChain connection chain id (matches createStoaChainConnection). */
export const STOACHAIN_CHAIN_ID = "stoachain" as const;
/** Re-exported so the wiring + tests key rows uniformly. */
export { ARWEAVE_CHAIN_ID };

/** The persisted, editable connection config. */
export interface NetworkSettings {
  /** The Pythia (GLOBAL) base URL. Empty = no global connector → both chains
   *  resolve LOCAL. When set + reachable, the chains Pythia advertises flip to
   *  "Live via Pythia" and their per-chain LOCAL field auto-disables. */
  pythiaUrl: string;
  /** The StoaChain node URL the dashboard reads/broadcasts against (LOCAL). */
  stoaChainNodeUrl: string;
  /** The Arweave gateway URL the Arweave panel reads/broadcasts against (LOCAL). */
  arweaveGatewayUrl: string;
}

/** The localStorage key the surfaced config persists under. */
export const NETWORK_SETTINGS_STORAGE_KEY = "codex-playground:network-settings";

/** A SUGGESTED StoaChain node (shown as the field placeholder), NOT a default
 *  value — a standalone Codex ships wired to nothing (see below). */
export const STOACHAIN_NODE_PLACEHOLDER = STOACHAIN_DEFAULT_NODE_URL;

/** The surfaced defaults. A standalone Codex is connected to NOTHING out of the
 *  box (owner directive): no operator Pythia, and the StoaChain node is EMPTY
 *  until the user wires one in the Network tab — so it never silently reads a
 *  chain "by its own power". The Arweave gateway keeps the local-testnet default
 *  (localhost:1984, never mainnet). */
export const DEFAULT_NETWORK_SETTINGS: NetworkSettings = {
  pythiaUrl: "",
  stoaChainNodeUrl: "",
  arweaveGatewayUrl: DEFAULT_GATEWAY_URL,
};

/**
 * Load the surfaced network config from localStorage, falling back to the
 * defaults for any absent/invalid field. Never throws — a corrupt blob yields
 * the defaults so the playground always boots.
 */
export function loadNetworkSettings(): NetworkSettings {
  try {
    const raw = window.localStorage.getItem(NETWORK_SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_NETWORK_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<NetworkSettings>;
    return {
      pythiaUrl:
        typeof parsed.pythiaUrl === "string" ? parsed.pythiaUrl : DEFAULT_NETWORK_SETTINGS.pythiaUrl,
      stoaChainNodeUrl:
        typeof parsed.stoaChainNodeUrl === "string" && parsed.stoaChainNodeUrl.length > 0
          ? parsed.stoaChainNodeUrl
          : DEFAULT_NETWORK_SETTINGS.stoaChainNodeUrl,
      arweaveGatewayUrl:
        typeof parsed.arweaveGatewayUrl === "string" && parsed.arweaveGatewayUrl.length > 0
          ? parsed.arweaveGatewayUrl
          : DEFAULT_NETWORK_SETTINGS.arweaveGatewayUrl,
    };
  } catch {
    return { ...DEFAULT_NETWORK_SETTINGS };
  }
}

/** Persist the surfaced network config to localStorage. */
export function saveNetworkSettings(settings: NetworkSettings): void {
  try {
    window.localStorage.setItem(
      NETWORK_SETTINGS_STORAGE_KEY,
      JSON.stringify(settings),
    );
  } catch {
    /* storage unavailable (private mode / quota) — surfaced state is still live in memory */
  }
}

/**
 * Build the `NetworkSettingsModel` off the surfaced state. With no `pythiaUrl`,
 * standalone = no operator global, both chains surfaced LOCAL + unlocked → both
 * rows resolve "live-local" + editable. With a `pythiaUrl`, Pythia is promoted to
 * the GLOBAL connection — the chains it advertises (via `health().coveredChains`;
 * StoaChain today) flip to "Live via Pythia" and their local field auto-disables,
 * while chains Pythia does not cover (Arweave) fall back to their LOCAL endpoint.
 */
export function resolveNetworkModel(
  settings: NetworkSettings,
): Promise<NetworkSettingsModel> {
  const pythiaUrl = settings.pythiaUrl.trim();
  const resolver = createConnectionResolver({
    supportedChains: [STOACHAIN_CHAIN_ID, ARWEAVE_CHAIN_ID],
    // The global connection routes by the chain it's covering; Pythia is
    // StoaChain-only today, so target the StoaChain route (coverage is still read
    // dynamically from health() — an unreachable Pythia advertises nothing and
    // both chains gracefully fall back to LOCAL).
    global: pythiaUrl
      ? createPythiaConnection({ baseUrl: pythiaUrl, chainId: STOACHAIN_CHAIN_ID })
      : undefined,
    // A LOCAL override exists only when the user actually entered a URL — an
    // empty field means "not connected" (the row shows Not-connected + editable),
    // never a phantom live-local against nothing.
    local: {
      [STOACHAIN_CHAIN_ID]: settings.stoaChainNodeUrl.trim()
        ? createStoaChainConnection({ kind: "direct", nodeUrl: settings.stoaChainNodeUrl }).connection
        : undefined,
      [ARWEAVE_CHAIN_ID]: settings.arweaveGatewayUrl.trim()
        ? createArweaveConnection({ gatewayUrl: settings.arweaveGatewayUrl })
        : undefined,
    },
    locked: false,
  });
  return resolver.resolve();
}
