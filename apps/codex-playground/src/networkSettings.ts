// ============================================================================
// networkSettings — the playground's surfaced, editable, UNLOCKED network config
// (CL-13, N-03, N-04).
//
// The standalone Codex has no operator-injected global connection, so BOTH
// chains are surfaced as LOCAL, user-editable endpoints:
//   - the StoaChain node URL, defaulting to the explicit node2-host
//     default `STOACHAIN_DEFAULT_NODE_URL` (never a hidden hardcoded node);
//   - the Arweave gateway URL, defaulting to the real mainnet reference
//     gateway `DEFAULT_GATEWAY_URL` (= https://arweave.net) — a deliberate
//     default so balance reads/sends reflect the real chain out of the box;
//     the field remains fully user-editable to point at a testnet/alternate
//     gateway during development.
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
  createKadenaConnection,
  KADENA_CONNECTION_CHAIN_ID,
  KADENA_MAINNET_DEFAULT_NODE_URL,
} from "@ancientpantheon/codex-ouronet/connection";
import { createArweaveConnection } from "@ancientpantheon/codex-arweave/connection";
import { ARWEAVE_CHAIN_ID } from "@ancientpantheon/codex-arweave/address-book";

import { DEFAULT_GATEWAY_URL } from "./ArweaveModeToggle";
import {
  ARWEAVE_WIRING_MODE_MOCK,
  ARWEAVE_WIRING_MODE_REAL,
  type ArweaveWiringMode,
} from "./ForeignChainsWiring";

/** The StoaChain connection chain id (matches createStoaChainConnection). */
export const STOACHAIN_CHAIN_ID = "stoachain" as const;
/** Re-exported so the wiring + tests key rows uniformly. */
export { ARWEAVE_CHAIN_ID };
/** The Kadena-mainnet connection chain id (2026-09-26, owner directive: "we
 *  also need an entry here for the kadena connection"). Re-exported from
 *  `createKadenaConnection.ts` so this row keys uniformly with the other two. */
export const KADENA_CHAIN_ID = KADENA_CONNECTION_CHAIN_ID;

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
  /** The Kadena-mainnet node URL (2026-09-26) — reads only this round (see
   *  `kadenaReads.ts`'s own doc comment); no signing/broadcast happens
   *  against it yet. Defaults to the real, public mainnet node. */
  kadenaNodeUrl: string;
  /** The Arweave mock<->real wiring mode. OPTIONAL (unlike the other fields)
   *  since `resolveNetworkModel` and its own callers never needed it before
   *  this field existed. Defaults to REAL (owner directive, updated): a
   *  standalone Codex should show real balances out of the box, not require
   *  an extra manual toggle click before anything useful shows — mock stays
   *  available (still user-selectable, in the Network settings tab) as an
   *  offline/dev escape hatch, it is just no longer the default. PERSISTED so
   *  a page reload / dev-server restart cannot silently reset a user's
   *  chosen mode back to the default with no indication anything changed. */
  arweaveMode?: ArweaveWiringMode;
}

/** The localStorage key the surfaced config persists under. */
export const NETWORK_SETTINGS_STORAGE_KEY = "codex-playground:network-settings";

/** The StoaChain node field's placeholder — now identical to the real
 *  default below (kept as its own export since the field still shows it
 *  as placeholder text when the persisted value is ever cleared). */
export const STOACHAIN_NODE_PLACEHOLDER = STOACHAIN_DEFAULT_NODE_URL;

/**
 * The Kadena node default, with a local-dev escape hatch.
 *
 * CURRENT DEFAULT (2026-09-28): `KADENA_MAINNET_DEFAULT_NODE_URL` itself is
 * now `https://denascan.ancientholdings.eu` — a transparent Chainweb
 * passthrough GATEWAY (HTTPS, CORS-open, forwards reads AND
 * signing/broadcast), not the direct node. See `kadenaReads.ts`'s own doc
 * comment on that constant for the full history/why. This escape hatch is
 * now specifically about the DIRECT node (`KADENA_DIRECT_NODE_URL`,
 * `http://bytales.duckdns.org:31849`) — a dev who wants to bypass the
 * gateway (or genuinely needs to, if the gateway itself is ever down) still
 * hits the SAME "hairpin NAT" problem the gateway was built to route around
 * in the first place: `bytales.duckdns.org` resolves to the node's PUBLIC
 * IP, and the LAN router the node itself sits behind will not loop that
 * traffic back to a machine on the same LAN — the request dies at the
 * router, every time, for every dev box on that network.
 *
 * `VITE_KADENA_NODE_URL`, read once at startup, is that escape hatch: unset
 * in production, so production gets the real (gateway) default; a dev on
 * the direct node's own LAN who specifically wants IT (not the gateway)
 * sets this in an UNCOMMITTED `.env.local` (see `.env.local.example`) to
 * `http://localhost:31849` or `http://<node's LAN IP>:31849`. Deliberately
 * NOT a silent runtime "try the gateway, fall back to localhost" — that
 * would mask a real gateway outage as a working dev box (the same reason
 * the timeout in `kadenaReads.ts` surfaces its error instead of quietly
 * retrying).
 */
const KADENA_NODE_URL_OVERRIDE = import.meta.env.VITE_KADENA_NODE_URL;

/** The surfaced defaults (owner directive, updated): no operator Pythia by
 *  default, but StoaChain now defaults to the real, public `node2.stoachain.com`
 *  gateway out of the box — a standalone Codex should be able to read/send on
 *  Chainweb immediately, not require the user to paste a node URL in the
 *  Network tab first. Still fully user-editable there. The Arweave gateway
 *  now defaults to the real mainnet reference gateway (`https://arweave.net`,
 *  via `DEFAULT_GATEWAY_URL`) for the same reason — real balance reads/sends
 *  out of the box, still fully user-editable to a testnet/alternate gateway. */
export const DEFAULT_NETWORK_SETTINGS: NetworkSettings = {
  pythiaUrl: "",
  stoaChainNodeUrl: STOACHAIN_DEFAULT_NODE_URL,
  arweaveGatewayUrl: DEFAULT_GATEWAY_URL,
  arweaveMode: ARWEAVE_WIRING_MODE_REAL,
  kadenaNodeUrl: KADENA_NODE_URL_OVERRIDE?.trim() || KADENA_MAINNET_DEFAULT_NODE_URL,
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
        typeof parsed.arweaveGatewayUrl === "string" &&
        parsed.arweaveGatewayUrl.length > 0 &&
        // ONE-TIME migration: "http://localhost:1984" was this constant's own
        // hardcoded value before this default flipped to real mainnet — any
        // browser that loaded the app before that change has it WRITTEN to
        // localStorage not because anyone chose it, but because it was simply
        // the code's default at the time. Correcting exactly this one legacy
        // literal (never any OTHER value, including a different localhost URL
        // someone actually typed) is what lets "real" mode work out of the box
        // for a returning browser instead of silently pointing at nothing.
        parsed.arweaveGatewayUrl !== "http://localhost:1984"
          ? parsed.arweaveGatewayUrl
          : DEFAULT_NETWORK_SETTINGS.arweaveGatewayUrl,
      arweaveMode:
        parsed.arweaveMode === ARWEAVE_WIRING_MODE_REAL ||
        parsed.arweaveMode === ARWEAVE_WIRING_MODE_MOCK
          ? parsed.arweaveMode
          : DEFAULT_NETWORK_SETTINGS.arweaveMode,
      kadenaNodeUrl:
        typeof parsed.kadenaNodeUrl === "string" &&
        parsed.kadenaNodeUrl.length > 0 &&
        // ONE-TIME migration, same shape as the Arweave gateway one above:
        // "https://api.chainweb.com" was this constant's own hardcoded value
        // before 2026-09-27, when it was replaced with our own confirmed-live
        // Kadena node (see kadenaReads.ts's own doc comment — the public host
        // could not be verified reachable and gave no independent way to
        // confirm it served correct balances). Any browser that loaded the
        // app before that change has the OLD default WRITTEN to localStorage
        // not because anyone chose it, but because it was simply the code's
        // default at the time. Correcting exactly this one legacy literal
        // (never any OTHER value, including a different node someone
        // actually typed) is what lets balances resolve correctly for a
        // returning browser instead of silently querying a node that was
        // never confirmed to work.
        parsed.kadenaNodeUrl !== "https://api.chainweb.com" &&
        // SECOND one-time migration (live bug report, this round): a dev on
        // the node's own LAN sets `VITE_KADENA_NODE_URL=http://localhost:31849`
        // (the documented hairpin-NAT escape hatch, this file's own doc
        // comment above `KADENA_NODE_URL_OVERRIDE`) and that value gets
        // WRITTEN to localStorage by `saveNetworkSettings` — exactly like the
        // other two migrations, not because anyone chose it as a permanent
        // setting. Unlike an ordinary typo, this one silently outlives its
        // own cause: once `.env.local` is removed (a dev.moves machines, or
        // a completely different tester loads the SAME browser profile —
        // confirmed live: a real tester's "Failed to fetch" against
        // `localhost:31849` traced straight back to this exact stale value),
        // the override is gone but the persisted literal remains, silently
        // pointing every read/send at a node that isn't running anymore.
        // Correcting exactly this one literal — never any OTHER localhost/LAN
        // URL someone deliberately typed — is safe in BOTH directions: if
        // `VITE_KADENA_NODE_URL` is CURRENTLY set (a dev genuinely on that
        // LAN right now), `DEFAULT_NETWORK_SETTINGS.kadenaNodeUrl` already
        // resolves to that same override, so "correcting" to the default is
        // a no-op; if it is NOT currently set (the common case, and the one
        // that produced the live failure), this restores the real default
        // (the `denascan.ancientholdings.eu` gateway, 2026-09-28 — see
        // `KADENA_NODE_URL_OVERRIDE`'s own doc comment above) instead of
        // silently failing forever.
        //
        parsed.kadenaNodeUrl !== "http://localhost:31849" &&
        // THIRD one-time migration (2026-09-28, gateway rollout — REVISED
        // reasoning, see below): `http://bytales.duckdns.org:31849`
        // (`KADENA_DIRECT_NODE_URL`) was THIS constant's own shipped
        // default before this round. This migration was originally left
        // OUT on the theory that a returning browser with it persisted
        // might be a dev on that LAN deliberately preferring it over the
        // gateway — but a live re-test after the gateway rollout produced
        // the EXACT SAME "Kadena simulation timed out after 10000ms"
        // symptom this whole round exists to fix, with no way to tell from
        // that generic message alone which node was actually being hit
        // (since fixed separately — see `describeKadenaNetworkError` in
        // `SendKadenaModal.tsx`, now names the active node in the error).
        // The far more likely explanation, in hindsight: the tester's own
        // browser simply still had the OLD default persisted from before
        // this round, exactly like the OTHER two migrations' own "written
        // because it was the default, not chosen" shape — not a deliberate
        // LAN-specific preference. Correcting exactly this one literal
        // (never any OTHER duckdns/LAN URL someone actually typed) is safe
        // the same way migration two already is: a dev genuinely on that
        // LAN who wants it can still select it explicitly in the Network
        // tab afterward — this only stops a stale, unchosen value from
        // silently winning forever.
        parsed.kadenaNodeUrl !== "http://bytales.duckdns.org:31849"
          ? parsed.kadenaNodeUrl
          : DEFAULT_NETWORK_SETTINGS.kadenaNodeUrl,
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
    supportedChains: [STOACHAIN_CHAIN_ID, ARWEAVE_CHAIN_ID, KADENA_CHAIN_ID],
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
      // Kadena mainnet (2026-09-26) — reads-only this round; no signing seam
      // (see `createKadenaConnection.ts`'s own doc comment for why this row
      // is simpler than StoaChain's).
      [KADENA_CHAIN_ID]: settings.kadenaNodeUrl.trim()
        ? createKadenaConnection({ nodeUrl: settings.kadenaNodeUrl })
        : undefined,
    },
    locked: false,
  });
  return resolver.resolve();
}
