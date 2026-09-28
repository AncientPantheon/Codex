/**
 * createKadenaConnection — the Network tab's third row: a real Kadena
 * mainnet node connection, entirely independent of `@stoachain/stoa-core`'s
 * StoaChain global.
 *
 * WHY THIS IS SIMPLER THAN `createStoaChainConnection`. That helper's whole
 * shape exists to redirect stoa-core's SINGLE module-level active-host global
 * (`setNodeConfig`/`getActivePactUrl`) — the one lever that moves both reads
 * AND signing together, per that file's own doc comment. Kadena mainnet
 * reads do NOT go through stoa-core at all (see `../kadena/kadenaReads.ts`'s
 * own doc comment: stoa-core hardcodes every transaction's Pact `networkId`
 * to `"stoa"` with no override seam, so a Kadena-mainnet transaction can
 * never be built through it) — they hand-build their own transaction via
 * `@stoachain/kadena-stoic-legacy/client`'s `createClient`/`dirtyRead`
 * directly. So there is no global to redirect and no `applyNodeConfig()`
 * side-effect needed here: this connection exists purely to give the
 * Network tab a health/status row (reachable? / which chain?) over the
 * configured Kadena node URL — the SAME generic Chainweb Pact HTTP surface
 * (`/api/v1/local`, `/send`, `/poll`) every Chainweb-family node exposes,
 * just under the `mainnet01` network path instead of `stoa`.
 *
 * READS-ONLY THIS ROUND. Owner directive, 2026-09-26: "lets wire first the
 * kadena switch, and read functions" (signing/transfer wiring for real
 * Kadena mainnet is explicit future work) — so this connection carries no
 * signing seam at all, unlike `StoaChainConnection`'s `signingOptions`.
 */

import {
  createDirectNodeConnection,
  type ChainConnection,
  type DirectNodeTransport,
  type ConnectionPollResult,
  type FetchLike,
} from "@ancientpantheon/codex-core";
import {
  KADENA_MAINNET_NETWORK_ID,
  KADENA_MAINNET_DEFAULT_NODE_URL,
  KADENA_DIRECT_NODE_URL,
  KADENA_MAINNET_DEFAULT_CHAIN_ID,
} from "../kadena/kadenaReads.js";

/** The chainId this connection speaks for, as a ChainConnection identifier —
 *  mirrors `STOACHAIN_CONNECTION_CHAIN_ID`'s own naming convention. */
export const KADENA_CONNECTION_CHAIN_ID = "kadena";

/** Re-exported so a consumer wiring the Network tab doesn't need a second
 *  import just for the default node URL — or for the selectable direct-node
 *  fallback, e.g. as Network-tab placeholder/hint text. */
export { KADENA_MAINNET_DEFAULT_NODE_URL, KADENA_DIRECT_NODE_URL };

/** Build the chainweb Pact base path for a Kadena node origin + chain —
 *  mirrors `createStoaChainConnection.ts`'s own `pactBaseUrl`, with
 *  `mainnet01` in place of `stoa`. */
function kadenaPactBaseUrl(nodeUrl: string, chainId: string): string {
  const origin = nodeUrl.replace(/\/+$/, "");
  return `${origin}/chainweb/0.0/${KADENA_MAINNET_NETWORK_ID}/chain/${chainId}/pact`;
}

/** A thin Pact read/send/poll relay for the ChainConnection — mirrors
 *  `createStoaChainConnection.ts`'s own `directPactTransport` byte-for-byte
 *  except for the base-path network segment. It POSTs opaque payloads to
 *  the node's standard Chainweb Pact API endpoints; it never builds or
 *  signs commands itself (this connection exists for health/status only —
 *  the actual reads live in `kadenaReads.ts`, which talks to the node
 *  directly via `createClient`, not through this transport). */
function directKadenaPactTransport(
  nodeUrl: string,
  chainId: string,
  fetchFn: FetchLike,
): DirectNodeTransport {
  const base = kadenaPactBaseUrl(nodeUrl, chainId);

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

/** Options for {@link createKadenaConnection}. */
export interface CreateKadenaConnectionOptions {
  /** The Kadena node URL (e.g. `https://api.chainweb.com`). Defaults to the
   *  real, public mainnet node — same "surface a real default, stay fully
   *  editable" convention `STOACHAIN_DEFAULT_NODE_URL` already uses. */
  nodeUrl?: string;
  /** The chain this connection's health row speaks for. Defaults to the
   *  conventional "0". */
  chainId?: string;
  /** Injected fetch for the transport + health probe. */
  fetchFn?: FetchLike;
}

/** Build a Kadena-mainnet `ChainConnection` for the Network tab. */
export function createKadenaConnection(
  options: CreateKadenaConnectionOptions = {},
): ChainConnection {
  const nodeUrl = options.nodeUrl ?? KADENA_MAINNET_DEFAULT_NODE_URL;
  const chainId = options.chainId ?? KADENA_MAINNET_DEFAULT_CHAIN_ID;
  const fetchFn: FetchLike =
    options.fetchFn ?? (globalThis.fetch as unknown as FetchLike);

  return createDirectNodeConnection({
    chainId: KADENA_CONNECTION_CHAIN_ID,
    nodeUrl,
    transport: directKadenaPactTransport(nodeUrl, chainId, fetchFn),
    fetchFn,
  });
}
