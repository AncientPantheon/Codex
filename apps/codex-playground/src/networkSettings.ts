// ============================================================================
// networkSettings — the playground's surfaced, editable, UNLOCKED network config
// (CL-13, N-03, N-04).
//
// The standalone Codex has no operator-injected global connection, so BOTH
// chains are surfaced as LOCAL, user-editable endpoints:
//   - the Kadena/StoaChain node URL, defaulting to the explicit node2-host
//     default `KADENA_DEFAULT_NODE_URL` (never a hidden hardcoded node);
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
  type NetworkSettingsModel,
} from "@ancientpantheon/codex-core";
import {
  createKadenaConnection,
  KADENA_DEFAULT_NODE_URL,
} from "@ancientpantheon/codex-ouronet/connection";
import { createArweaveConnection } from "@ancientpantheon/codex-arweave/connection";
import { ARWEAVE_CHAIN_ID } from "@ancientpantheon/codex-arweave/address-book";

import { DEFAULT_GATEWAY_URL } from "./ArweaveModeToggle";

/** The Kadena/StoaChain connection chain id (matches createKadenaConnection). */
export const STOACHAIN_CHAIN_ID = "stoachain" as const;
/** Re-exported so the wiring + tests key rows uniformly. */
export { ARWEAVE_CHAIN_ID };

/** The persisted, editable per-chain endpoint config. */
export interface NetworkSettings {
  /** The Kadena/StoaChain node URL the dashboard reads/broadcasts against. */
  kadenaNodeUrl: string;
  /** The Arweave gateway URL the Arweave panel reads/broadcasts against. */
  arweaveGatewayUrl: string;
}

/** The localStorage key the surfaced config persists under. */
export const NETWORK_SETTINGS_STORAGE_KEY = "codex-playground:network-settings";

/** The surfaced defaults — both real, editable, local/testnet endpoints. */
export const DEFAULT_NETWORK_SETTINGS: NetworkSettings = {
  kadenaNodeUrl: KADENA_DEFAULT_NODE_URL,
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
      kadenaNodeUrl:
        typeof parsed.kadenaNodeUrl === "string" && parsed.kadenaNodeUrl.length > 0
          ? parsed.kadenaNodeUrl
          : DEFAULT_NETWORK_SETTINGS.kadenaNodeUrl,
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
 * Build the `NetworkSettingsModel` off the surfaced state. Standalone = no
 * operator global, both chains surfaced LOCAL + unlocked → both rows resolve to
 * "live-local" + editable.
 */
export function resolveNetworkModel(
  settings: NetworkSettings,
): Promise<NetworkSettingsModel> {
  const resolver = createConnectionResolver({
    supportedChains: [STOACHAIN_CHAIN_ID, ARWEAVE_CHAIN_ID],
    global: undefined,
    local: {
      [STOACHAIN_CHAIN_ID]: createKadenaConnection({
        kind: "direct",
        nodeUrl: settings.kadenaNodeUrl,
      }).connection,
      [ARWEAVE_CHAIN_ID]: createArweaveConnection({
        gatewayUrl: settings.arweaveGatewayUrl,
      }),
    },
    locked: false,
  });
  return resolver.resolve();
}
