/**
 * Native transfer surface types.
 *
 * `sendTransfer` builds/signs/posts a native AR transfer through the gateway
 * pool. Its network touchpoints — fetching the anchor, quoting the reward, and
 * posting the signed tx — are abstracted behind a NARROW per-endpoint seam
 * (`TransferGatewayApi`) typed against OUR interface, not arweave-js's. The
 * default implementation is built on the T3.4 endpoint client (arweave-js), but
 * the seam lets tests inject plain functions with no network and no arweave-js
 * network objects.
 */

import type Transaction from "arweave/node/lib/transaction";

import type { ArweaveJwk } from "../keys/types.js";

/**
 * Inputs for a native AR transfer. Winston `quantity` is a `bigint`
 * end-to-end; it crosses to the wire only as the decimal string of the bigint
 * (no floats, no `Number()`).
 */
export interface TransferParams {
  /** The sender keyfile (validated via `importKeyfile` before any pool call). */
  readonly jwk: ArweaveJwk;
  /** The recipient address — canonical 43-char base64url. */
  readonly target: string;
  /** The amount to send, in Winston. */
  readonly quantity: bigint;
  /**
   * REQUIRED fee cap, in Winston. The reward is quoted by an untrusted rotating
   * gateway and is signed and PAID verbatim, so a compromised/MITM'd gateway
   * could otherwise quote and burn an arbitrary fee. The caller MUST state the
   * maximum reward they will pay: a quoted reward STRICTLY greater than this cap
   * throws `RewardExceedsCapError` BEFORE building or signing; an absent cap
   * throws `InvalidTransferError` (reason `missing-max-reward`) before ANY pool
   * call. The boundary is inclusive (reward === cap is allowed).
   */
  readonly maxRewardWinston: bigint;
}

/**
 * The narrow per-endpoint gateway operations the transfer orchestration needs.
 *
 * Each method targets a SINGLE endpoint (the factory binds the endpoint). The
 * three touchpoints are the offline-build inputs (`getAnchor`, `getPrice`) and
 * the post. `postTransaction` returns only the status surface the pool op
 * inspects — arweave-js's `transactions.post` NEVER rejects on HTTP errors, so
 * the op reads the status and throws on non-2xx to make the pool rotate.
 */
export interface TransferGatewayApi {
  /** The `last_tx` anchor for an offline build. Throws on gateway failure. */
  getAnchor(): Promise<string>;
  /** The reward (fee) quote in Winston for a `byteSize`-byte tx to `target`. */
  getPrice(byteSize: number, target: string): Promise<string>;
  /**
   * Post the signed tx. Resolves the gateway's HTTP status verbatim (does NOT
   * throw on non-2xx — the pool op inspects `status` and throws itself).
   */
  postTransaction(
    tx: Transaction,
  ): Promise<{ status: number; statusText?: string }>;
}

/**
 * Maps a pool endpoint base URL to a per-endpoint {@link TransferGatewayApi}.
 * The injectable seam: the default builds arweave-js clients via the T3.4
 * factory; tests inject plain functions.
 */
export type TransferGatewayApiFactory = (
  endpointBaseUrl: string,
) => TransferGatewayApi;

/** Options for {@link TransferParams}-driven transfers. The fee cap
 *  (`maxRewardWinston`) is NOT here — it is a REQUIRED field of
 *  {@link TransferParams}, because a caller MUST always state the maximum reward
 *  they will pay. */
export interface SendTransferOptions {
  /**
   * The per-endpoint gateway-API factory. Defaults to an arweave-js-backed
   * factory built on the T3.4 endpoint client. Tests inject plain fakes.
   */
  apiFactory?: TransferGatewayApiFactory;
}

/** The result of a successful transfer: the tx id and the paid fee. */
export interface TransferResult {
  /** The signed transaction's canonical id (43-char base64url). */
  readonly id: string;
  /** The fee actually paid, in Winston — callers can display/log it. */
  readonly reward: bigint;
}
