// estimateUploadCostAr — T1 (arweave-upload-wizard Wave 1).
//
// A thin convenience wrapper around arweave-core's `estimateFee` +
// `winstonToAr`: the wizard's Review & Cost step needs a live "Network fee:
// ~X AR" quote for a set of selected files, and this is the single call site
// that composes the two so the wizard component itself never has to. No new
// price-quote logic lives here — `estimateFee` already does the real work
// (pool rotation, the strict Winston-string gate, the optional-`target`
// byte-size-only quote a data upload needs); this just forwards to it and
// converts the resolved Winston bigint to its AR display string.

import {
  estimateFee,
  winstonToAr,
  type GatewayPool,
  type EstimateFeeGetPriceFn,
} from "@ancientpantheon/arweave-core";

/** Options for {@link estimateUploadCostAr}. `target` is optional — omitted,
 *  it fetches a byte-size-only quote (no transfer recipient), exactly like
 *  `estimateFee`'s own optional `target`, the shape a data upload needs.
 *  `getPrice` is `estimateFee`'s OWN injectable per-endpoint price-quote
 *  seam (its actual `EstimateFeeOptions` shape — NOT a `fetch` stand-in);
 *  a plain caller never supplies it and gets `estimateFee`'s real default
 *  arweave-js client. */
export interface EstimateUploadCostOptions {
  target?: string;
  getPrice?: EstimateFeeGetPriceFn;
}

/** A resolved upload-cost quote: the exact Winston bigint `estimateFee`
 *  resolved, plus its AR display string via `winstonToAr` (never a second,
 *  separately-reimplemented conversion). */
export interface UploadCostEstimate {
  winston: bigint;
  ar: string;
}

/**
 * Fetch a live Winston price quote for a `byteSize`-byte upload through the
 * gateway pool, and return it alongside its AR display string.
 */
export async function estimateUploadCostAr(
  pool: GatewayPool,
  byteSize: number,
  opts: EstimateUploadCostOptions = {},
): Promise<UploadCostEstimate> {
  const winston = await estimateFee(pool, byteSize, opts.target, {
    getPrice: opts.getPrice,
  });

  return { winston, ar: winstonToAr(winston) };
}
