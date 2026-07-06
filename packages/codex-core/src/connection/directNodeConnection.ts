/**
 * `createDirectNodeConnection` (CL-03) — a `ChainConnection` over a single
 * node/gateway URL for ONE chain.
 *
 * codex-core does NOT know the Chainweb/Arweave protocol: the chain-specific
 * transport (`read`/`send`/`poll`, plus an optional reachability `probe`) is
 * INJECTED by the later phase that owns the chain (a Chainweb node for
 * StoaChain, an Arweave gateway for Arweave). This factory only wires
 * delegation + the health probe.
 *
 * health() is a reachability probe: `transport.probe?()` if the transport
 * supplies one, else a GET on `nodeUrl` via the injected fetch (any thrown /
 * non-ok response → unreachable). Coverage is always exactly the single
 * `chainId` — a direct node speaks for one chain.
 */

import type {
  ChainConnection,
  ConnectionHealth,
  ConnectionPollResult,
  FetchLike,
} from "./types.js";

/**
 * The injected per-chain transport bound to a `nodeUrl`. `read`/`send`/`poll` are
 * keyless relays; `probe?` is an optional bespoke reachability check (falls back
 * to a plain GET on the node URL when absent).
 */
export interface DirectNodeTransport {
  read(query: unknown): Promise<unknown>;
  send(signedTx: unknown): Promise<unknown>;
  poll(ref: unknown): Promise<ConnectionPollResult>;
  probe?(): Promise<boolean>;
}

/** Options for {@link createDirectNodeConnection}. */
export interface DirectNodeConnectionOptions {
  /** The single chain this node serves. */
  chainId: string;
  /** The node/gateway URL the transport is bound to (also the fallback probe target). */
  nodeUrl: string;
  /** The injected chain-specific transport. */
  transport: DirectNodeTransport;
  /** Injected fetch for the fallback probe; defaults to the runtime global `fetch`. */
  fetchFn?: FetchLike;
}

/**
 * Create a direct-node `ChainConnection`. Keyless: it delegates the caller's
 * opaque payloads to the injected transport untouched.
 */
export function createDirectNodeConnection(
  options: DirectNodeConnectionOptions,
): ChainConnection {
  const { chainId, nodeUrl, transport } = options;
  const fetchFn: FetchLike =
    options.fetchFn ?? (globalThis.fetch as unknown as FetchLike);

  async function reachable(): Promise<boolean> {
    if (transport.probe) {
      return transport.probe();
    }
    try {
      const response = await fetchFn(nodeUrl, { method: "GET" });
      return response.ok;
    } catch {
      return false;
    }
  }

  return {
    chainId,
    read: (query) => transport.read(query),
    send: (signedTx) => transport.send(signedTx),
    poll: (ref) => transport.poll(ref),
    async health(): Promise<ConnectionHealth> {
      return { reachable: await reachable(), coveredChains: [chainId] };
    },
  };
}
