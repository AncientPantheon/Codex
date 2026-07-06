/**
 * `createArweaveConnection` (CL-06/CL-07) — the Codex-path bridge that binds the
 * Arweave gateway to the Phase-1 `ChainConnection` seam.
 *
 * THE INVARIANT: the gateway endpoint is ALWAYS the EXPLICITLY-supplied
 * `gatewayUrl` (sourced from the network-settings connection descriptor), never a
 * hidden `arweave.net` default. This helper builds a
 * `createGatewayPool({ endpoints: [gatewayUrl] })` — an endpoint list is ALWAYS
 * passed, so arweave-core's library `DEFAULT_ENDPOINT` is never triggered on the
 * Codex path — and wraps it as a `ChainConnection` via Phase 1's
 * `createDirectNodeConnection`, so the network-settings model + health work
 * uniformly across chains.
 *
 * KEYLESS (N-01): the seam holds no key and signs nothing. `read` relays an
 * opaque balance/status query to the injected gateway through the pool; `send`
 * broadcasts an ALREADY-SIGNED tx (POST `{gatewayUrl}/tx`) — the Codex signs
 * elsewhere and hands the signed tx in; `poll` maps arweave-core's confirmation
 * status onto the seam's `pending`/`final` result.
 *
 * ISOLATION (E2): this module imports ONLY arweave-core + codex-core — never the
 * Kadena resolver/PactClient. The Arweave path stays a sibling of the Kadena one.
 *
 * NOTE ON arweave.net: no `arweave.net` literal appears in this file. The reads
 * flow through the pool's INJECTED endpoint; the broadcast POSTs to the same
 * injected `gatewayUrl`. arweave-core's own `DEFAULT_ENDPOINT` remains a library
 * convenience but is unreachable here because `endpoints` is always supplied.
 */

import {
  createGatewayPool,
  getBalance,
  getTransactionStatus,
  type GatewayPool,
} from "@ancientpantheon/arweave-core";
import {
  createDirectNodeConnection,
  type ChainConnection,
  type ConnectionPollResult,
  type DirectNodeTransport,
} from "@ancientpantheon/codex-core";

import { ARWEAVE_CHAIN_ID } from "../address-book/index.js";

/** A minimal fetch-like seam (matches codex-core's `FetchLike` structurally and
 *  arweave-core's `typeof fetch`), so the connection stays self-typed and a test
 *  drives every read/broadcast/probe with zero real network. */
type FetchFn = typeof fetch;

/** Construction inputs for {@link createArweaveConnection}. */
export interface ArweaveConnectionOptions {
  /** The EXPLICIT Arweave gateway URL — sourced from the network-settings
   *  connection descriptor. Always injected; never defaulted to arweave.net. */
  gatewayUrl: string;
  /** Injectable fetch seam forwarded to arweave-core's reads and used for the
   *  broadcast POST + the reachability probe. Defaults to the runtime global. */
  fetchFn?: FetchFn;
}

/**
 * The opaque read query the Arweave connection understands. Discriminated by
 * `kind`: a wallet balance read or a tx confirmation-status read. Carries NO key.
 */
export type ArweaveReadQuery =
  | { kind: "balance"; address: string }
  | { kind: "status"; txId: string };

/** The opaque poll reference: the tx id to resolve to pending/final. */
export interface ArweavePollRef {
  txId: string;
}

/** Bind an endpoint base URL to a route, collapsing a double slash at the seam. */
function joinUrl(base: string, route: string): string {
  return `${base.replace(/\/+$/, "")}/${route.replace(/^\/+/, "")}`;
}

/**
 * Build the Arweave transport over an explicit `gatewayUrl`-backed pool. Every
 * method relays through the pool's injected endpoint(s); none holds a key.
 */
function createArweaveTransport(
  pool: GatewayPool,
  fetchFn: FetchFn | undefined,
): DirectNodeTransport {
  const readOpts = fetchFn ? { fetchFn } : undefined;

  return {
    async read(query: unknown): Promise<unknown> {
      const q = query as ArweaveReadQuery;
      if (q.kind === "balance") {
        return getBalance(pool, q.address, readOpts);
      }
      if (q.kind === "status") {
        return getTransactionStatus(pool, q.txId, readOpts);
      }
      throw new Error(
        `unsupported Arweave read query kind: ${String((q as { kind?: unknown }).kind)}`,
      );
    },

    async send(signedTx: unknown): Promise<unknown> {
      // Broadcast an ALREADY-SIGNED tx: POST it verbatim to `{endpoint}/tx`
      // through the pool so rotation/retry apply. NO key is read off the tx — the
      // Codex signed it elsewhere; the connection only relays the signed bytes.
      const doFetch = fetchFn ?? (globalThis.fetch as FetchFn);
      return pool.execute(async function postTransaction(endpoint, { signal }) {
        const response = await doFetch(joinUrl(endpoint, "tx"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(signedTx),
          signal,
        } as RequestInit);
        if (!response.ok) {
          // Non-2xx throws so the pool rotates to another gateway.
          throw new Error(`broadcast failed: http-status-${response.status}`);
        }
        return { status: response.status };
      });
    },

    async poll(ref: unknown): Promise<ConnectionPollResult> {
      const { txId } = ref as ArweavePollRef;
      const status = await getTransactionStatus(pool, txId, readOpts);
      // A tx is `final` only once arweave-core deems it confirmed AND at/above the
      // finality depth; everything else (pending / not-found) is `pending` on the
      // seam — the caller keeps polling.
      const isFinal = status.status === "confirmed" && status.final === true;
      return { status: isFinal ? "final" : "pending", detail: status };
    },
  };
}

/**
 * Create an Arweave `ChainConnection` bound to an EXPLICIT gateway URL.
 *
 * Builds `createGatewayPool({ endpoints: [gatewayUrl] })` (endpoints ALWAYS
 * supplied — arweave-core's arweave.net default is never reached) and wraps it as
 * a direct-node connection for {@link ARWEAVE_CHAIN_ID}. The reachability probe
 * falls back to a GET on `gatewayUrl` (the direct-node default), so `health()`
 * reports `reachable` + coverage `[arweave]` uniformly with the rest of the
 * network-settings model.
 *
 * @throws {InvalidGatewayConfigError} if `gatewayUrl` is not URL-parseable
 *   (surfaced by `createGatewayPool` at construction).
 */
export function createArweaveConnection(
  options: ArweaveConnectionOptions,
): ChainConnection {
  const { gatewayUrl, fetchFn } = options;

  const pool = createGatewayPool({ endpoints: [gatewayUrl] });
  const transport = createArweaveTransport(pool, fetchFn);

  return createDirectNodeConnection({
    chainId: ARWEAVE_CHAIN_ID,
    nodeUrl: gatewayUrl,
    transport,
    fetchFn: fetchFn as never,
  });
}
