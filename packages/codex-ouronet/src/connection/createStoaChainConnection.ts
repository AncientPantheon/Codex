/**
 * createStoaChainConnection (CL-08 / CL-09) — source the StoaChain Pact node URL from a
 * network-settings connection descriptor instead of stoa-core's hidden `node2`
 * default.
 *
 * ## The mechanism (grounded)
 *
 * stoa-core's `nodeFailover` holds the active StoaChain host in a MODULE-LEVEL
 * global. `getActivePactUrl(chainId)` — used by BOTH the Accounts-tab balance
 * reads (`useStoaChainBalances` → `getPactUrl`) AND the resolver's lazy
 * `createClient(getPactUrl(...))` signing default — reads that global. So there
 * is exactly one lever, `setNodeConfig(selected, customUrl)`, and pulling it
 * redirects reads AND signing together.
 *
 * Today nobody in Codex calls `setNodeConfig`: the stored
 * `uiSettings.selectedNode`/`customNodeUrl` never reach it, so every read and
 * every signature silently uses the `node2` default. That IS the hidden default
 * CL-09 removes.
 *
 * ## What this helper produces
 *
 * From a `StoaChainConnectionDescriptor` it returns:
 *   - `signingOptions` — the `{ clientOverride?, selectedNode, customNodeUrl }`
 *     the resolver seam's `createSigningStrategy` consumes. For a `direct` URL it
 *     builds a `clientOverride = createClient(nodeUrl)` (so signing follows the
 *     user's node without depending on the global) AND carries
 *     `selectedNode:"custom"`/`customNodeUrl` for parity with the existing field
 *     shape. For a `preset` it maps to the surfaced `selectedNode:"node1"/"node2"`
 *     with no override (the resolver builds its own client for that node).
 *   - `applyNodeConfig()` — the single side-effect that moves stoa-core's global
 *     active host onto the descriptor's node, so the READS follow it too.
 *   - `connection` — a Phase-1 `ChainConnection` over the node URL (a thin Pact
 *     read/send/poll relay), so the network-settings model + health work.
 *
 * Behaviour is identical to today when the descriptor is `{kind:"preset",
 * preset:"node2"}` (the surfaced form of the old implicit default).
 */

import { createClient } from "@stoachain/kadena-stoic-legacy/client";
import {
  createDirectNodeConnection,
  type ChainConnection,
  type DirectNodeTransport,
  type ConnectionPollResult,
  type FetchLike,
} from "@ancientpantheon/codex-core";

import {
  setNodeConfig,
  STOACHAIN_CHAIN_ID,
} from "./stoaNetwork.js";

/** The canonical StoaChain node preset hosts (mirrors stoa-core's nodeFailover). */
export const STOACHAIN_NODE1_URL = "https://node1.stoachain.com";
export const STOACHAIN_NODE2_URL = "https://node2.stoachain.com";

/**
 * The EXPLICIT surfaced StoaChain default (CL-09): the same `node2` host the old
 * hidden default used. Surfacing it as a real value is what lets the Network tab
 * display and edit it instead of it being a baked-in assumption.
 */
export const STOACHAIN_DEFAULT_NODE_URL = STOACHAIN_NODE2_URL;

/** The StoaChain network name the chainweb Pact base path embeds. */
const STOACHAIN_NETWORK = "stoa";

/** The chainId the connection speaks for, as a ChainConnection identifier. */
export const STOACHAIN_CONNECTION_CHAIN_ID = "stoachain";

/**
 * A StoaChain connection descriptor — the serialisable network-settings shape the
 * Network tab (Phase 4) edits and this helper consumes.
 *
 *   - `direct`  — an explicit node URL the user typed (or the surfaced default).
 *   - `preset`  — one of stoa-core's two known nodes, by name.
 *   - `pythia`  — (stretch) route reads/broadcast through a Pythia gateway.
 */
export type StoaChainConnectionDescriptor =
  | { kind: "direct"; nodeUrl: string }
  | { kind: "preset"; preset: "node1" | "node2" }
  | { kind: "pythia"; baseUrl: string };

/** The signing-strategy inputs the resolver seam consumes. Structurally matches
 *  `OuronetSigningStrategyOptions`' node fields without importing it. */
export interface StoaChainSigningOptions {
  clientOverride?: unknown;
  selectedNode?: "node1" | "node2" | "custom";
  customNodeUrl?: string;
}

/** The full result of resolving a descriptor into the resolver seam's inputs. */
export interface StoaChainConnection {
  /** The inputs `createSigningStrategy` reads (override + surfaced node fields). */
  signingOptions: StoaChainSigningOptions;
  /** Move stoa-core's global active host onto this descriptor's node so the
   *  READ path (`getActivePactUrl`) follows it too. Idempotent. */
  applyNodeConfig(): void;
  /** A Phase-1 ChainConnection over the node URL (health + transport). */
  connection: ChainConnection;
}

/** Options for {@link createStoaChainConnection}. */
export interface CreateStoaChainConnectionOptions {
  /** Injected fetch for the ChainConnection transport + health probe. */
  fetchFn?: FetchLike;
}

/** Resolve the effective node URL for a descriptor (presets map to their host). */
function resolveNodeUrl(descriptor: StoaChainConnectionDescriptor): string {
  if (descriptor.kind === "direct") return descriptor.nodeUrl;
  if (descriptor.kind === "preset") {
    return descriptor.preset === "node1" ? STOACHAIN_NODE1_URL : STOACHAIN_NODE2_URL;
  }
  // pythia — the base URL is the transport target.
  return descriptor.baseUrl;
}

/** Build the chainweb Pact base path for a node origin + chain. */
function pactBaseUrl(nodeUrl: string, chainId: string): string {
  const origin = nodeUrl.replace(/\/+$/, "");
  return `${origin}/chainweb/0.0/${STOACHAIN_NETWORK}/chain/${chainId}/pact`;
}

/**
 * A thin Pact read/send/poll relay for the ChainConnection. It POSTs opaque
 * payloads to the node's Pact API endpoints — it NEVER builds or signs commands
 * (stoa-core still does that for the real signing path); this transport exists
 * so the network-settings model + health can operate over the node URL.
 */
function directPactTransport(
  nodeUrl: string,
  chainId: string,
  fetchFn: FetchLike,
): DirectNodeTransport {
  const base = pactBaseUrl(nodeUrl, chainId);

  async function postJson(endpoint: string, payload: unknown): Promise<unknown> {
    const response = await fetchFn(`${base}/api/v1/${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return response.json();
  }

  return {
    read: (query: unknown) => postJson("local", query),
    send: (signedTx: unknown) => postJson("send", signedTx),
    async poll(ref: unknown): Promise<ConnectionPollResult> {
      const body = await postJson("poll", ref);
      const final =
        typeof body === "object" &&
        body !== null &&
        Object.keys(body as Record<string, unknown>).length > 0;
      return { status: final ? "final" : "pending", detail: body };
    },
  };
}

/**
 * Resolve a StoaChain connection descriptor into the resolver seam's signing inputs,
 * a `setNodeConfig` side-effect, and a Phase-1 ChainConnection.
 */
export function createStoaChainConnection(
  descriptor: StoaChainConnectionDescriptor,
  options: CreateStoaChainConnectionOptions = {},
): StoaChainConnection {
  const fetchFn: FetchLike =
    options.fetchFn ?? (globalThis.fetch as unknown as FetchLike);
  const nodeUrl = resolveNodeUrl(descriptor);

  const connection = createDirectNodeConnection({
    chainId: STOACHAIN_CONNECTION_CHAIN_ID,
    nodeUrl,
    transport: directPactTransport(nodeUrl, STOACHAIN_CHAIN_ID, fetchFn),
    fetchFn,
  });

  if (descriptor.kind === "preset") {
    const preset = descriptor.preset;
    return {
      signingOptions: { selectedNode: preset },
      applyNodeConfig() {
        setNodeConfig(preset);
      },
      connection,
    };
  }

  if (descriptor.kind === "pythia") {
    // TODO: StoaChain-via-Pythia (CL-10, deferred). A faithful `clientOverride`
    // Pact-client SHIM that routes kadena-stoic-legacy's local/send/poll through
    // Pythia's REST (POST <base>/stoachain/read|send|poll) is NOT built here:
    // matching kadena-stoic-legacy's full ICreateClient return surface risks the
    // live signing path, which this phase must not endanger. For now a pythia
    // descriptor yields a ChainConnection over the base URL (so the network model
    // + health work) but NO signing override and NO global read redirect — the
    // resolver keeps its default node client. See Task Notes for the follow-up.
    return {
      signingOptions: {},
      applyNodeConfig() {
        /* deferred — Pythia does not redirect stoa-core's chainweb read global */
      },
      connection,
    };
  }

  // direct carries an explicit node URL. The resolver prefers the clientOverride,
  // so signing follows the URL regardless of the global; the
  // selectedNode:"custom"/customNodeUrl pair mirrors the existing field shape and
  // drives applyNodeConfig for the read path.
  return {
    signingOptions: {
      clientOverride: createClient(nodeUrl),
      selectedNode: "custom",
      customNodeUrl: nodeUrl,
    },
    applyNodeConfig() {
      setNodeConfig("custom", nodeUrl);
    },
    connection,
  };
}
