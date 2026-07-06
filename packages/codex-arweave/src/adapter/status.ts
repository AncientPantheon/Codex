/**
 * Balance-as-display + confirmation-status sibling surface.
 *
 * These are STANDALONE helpers (pattern PAT-002) — NOT methods on the D3
 * `ForeignChainAdapter` contract. They mirror arweave-core's own read APIs:
 * balance stays base-unit `bigint` on the adapter (E1's `getBalance`), while
 * these helpers present DISPLAY AR (`winstonToAr`) and the discriminated
 * confirmation status. The adapter's `getBalance` is UNCHANGED — the display
 * helper composes on it rather than shadowing it (N-10: base-unit stored,
 * display-unit presented).
 *
 * SEAM DISCIPLINE: the READS path forwards `opts.fetchFn` (a `typeof fetch`) —
 * NOT `opts.apiFactory` (that is the SEND seam). Rotation is inherited from the
 * pool's `execute`; there is no custom retry here.
 *
 * ISOLATION: this file imports ONLY arweave-core — no StoaChain resolver/strategy.
 */

import {
  getBalance,
  getTransactionStatus,
  winstonToAr,
  type GatewayPool,
  type TransactionStatus,
} from "@ancientpantheon/arweave-core";

/** Options for {@link arweaveBalanceAsAr}. Forwards the injectable fetch seam so
 *  a consumer/test resolves the balance read with zero real network. */
export interface ArweaveBalanceAsArOptions {
  fetchFn?: typeof fetch;
}

/**
 * Read the winston balance of `address` through the pool and present it as an
 * EXACT display AR string via arweave-core `winstonToAr` (no float math, no
 * scientific notation). Composes `getBalance` (bigint) → `winstonToAr`; the
 * base-unit read stays authoritative. A non-canonical address surfaces
 * `InvalidAddressError` from `getBalance`.
 */
export async function arweaveBalanceAsAr(
  pool: GatewayPool,
  address: string,
  opts?: ArweaveBalanceAsArOptions,
): Promise<string> {
  const winston = await getBalance(
    pool,
    address,
    opts?.fetchFn ? { fetchFn: opts.fetchFn } : undefined,
  );
  return winstonToAr(winston);
}

/** Options for {@link arweaveTransactionStatus}. Forwards both the fetch seam
 *  and the tunable confirmation depth to arweave-core. */
export interface ArweaveTransactionStatusOptions {
  fetchFn?: typeof fetch;
  confirmationDepth?: number;
}

/**
 * Read the confirmation status of `txId` through the pool — a thin delegate to
 * arweave-core `getTransactionStatus`. Returns the discriminated
 * `TransactionStatus` (pending / not-found / confirmed-with-`final`). Finality
 * (`final = numberOfConfirmations >= confirmationDepth`, inclusive) is computed
 * by arweave-core; this helper does NOT re-derive it. Forwards `fetchFn` +
 * `confirmationDepth`.
 */
export async function arweaveTransactionStatus(
  pool: GatewayPool,
  txId: string,
  opts?: ArweaveTransactionStatusOptions,
): Promise<TransactionStatus> {
  return getTransactionStatus(pool, txId, opts);
}
