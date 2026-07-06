/**
 * The `ChainConnection` seam (CL-01) — the per-chain, KEYLESS transport contract
 * the whole connection layer is built on.
 *
 * A `ChainConnection` relays a read query, broadcasts an ALREADY-SIGNED tx, polls
 * tx status, and reports health (reachability + advertised chain coverage). It
 * NEVER builds requests, signs, or holds keys: codex-core does not reimplement
 * the Chainweb/Arweave protocol. The request/response payloads are OPAQUE
 * (`unknown`) — the chain modules in later phases supply the chain-specific shape.
 *
 * N-01 (keyless invariant): NO method accepts a key/seed/sign parameter. `read`
 * takes exactly one opaque query; `send` takes exactly one already-signed tx.
 * Widening either to accept key material is a compile-time break (asserted via a
 * `@ts-expect-error` in the seam's test).
 */

/**
 * A minimal fetch-like function. Declared narrowly here (rather than depending on
 * the ambient DOM/Node `fetch` global type) so the connection layer stays
 * self-typed and portable across runtimes. The real global `fetch` structurally
 * satisfies it.
 */
export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/** The reachability + advertised-coverage snapshot a connection reports. */
export interface ConnectionHealth {
  /** Whether the connection's backing endpoint answered a health probe. */
  reachable: boolean;
  /** The chains this connection advertises it can serve. READ from the health
   *  response for a Pythia gateway (never hardcoded); the single served chain for
   *  a direct node. */
  coveredChains: string[];
  /** Optional human-readable diagnostic (e.g. the routing state or an error). */
  detail?: string;
}

/** The status of a tx poll: still `pending` in the mempool, or `final` (mined to
 *  the connection's finality depth). `detail` carries the opaque node payload. */
export interface ConnectionPollResult {
  status: "pending" | "final";
  detail?: unknown;
}

/**
 * The per-chain keyless transport seam. Payloads are opaque `unknown` — filled by
 * the chain modules in later phases. Holds no keys; signs nothing.
 */
export interface ChainConnection {
  /** The chain this connection speaks for (e.g. "stoachain", "arweave"). */
  readonly chainId: string;
  /** Relay a read query to the backing endpoint; return the response verbatim. */
  read(query: unknown): Promise<unknown>;
  /** Broadcast an ALREADY-SIGNED transaction; return the node response verbatim.
   *  Takes no key/seed — the tx arrives pre-signed by the Codex. */
  send(signedTx: unknown): Promise<unknown>;
  /** Resolve a tx reference to its pending/final status. */
  poll(ref: unknown): Promise<ConnectionPollResult>;
  /** Probe reachability + report advertised chain coverage. */
  health(): Promise<ConnectionHealth>;
}
