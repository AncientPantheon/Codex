/**
 * Winston price-quote reads through the gateway pool.
 *
 * `estimateFee` fetches a reward (fee) quote in Winston for a `byteSize`-byte
 * transfer to `target`, through the Phase 2 gateway pool, and returns it as a
 * `bigint`. This is the SAME "fetch and validate a Winston price quote through
 * the pool" logic `tx/transfer.ts`'s `sendTransfer` used to keep inline —
 * extracted here so there is exactly one implementation. `sendTransfer` now
 * calls this function (threading its own, possibly test-injected, per-endpoint
 * `apiFactory` through {@link EstimateFeeOptions.getPrice} so its price step
 * keeps this module's single fetch-and-validate implementation instead of a
 * second copy); a standalone caller (e.g. a send modal's live "Network fee: ~X
 * AR" estimate) calls it with no options and gets the real default client.
 *
 * The reward string is embedded in a SIGNED transaction once paid — a strictly
 * more dangerous sink than a balance read — so the raw gateway response MUST
 * pass the strict `^\d+$` gate BEFORE `BigInt(...)` (the Phase 2 lenient-BigInt
 * lesson: `BigInt("")` -> 0n, whitespace is trimmed, `0x` prefixes and `1e3`
 * exponents are accepted, so a raw response must never reach `BigInt`
 * unvalidated). A gate-failing quote throws `InvalidGatewayPriceError` INSIDE
 * the pool operation so the pool rotates to an honest gateway.
 *
 * Network I/O flows through arweave-js (NOT the runtime `fetch`) via a
 * per-endpoint client built by `createEndpointClientFactory()` — arweave-js
 * accepts no `AbortSignal` on `getPrice`, so each call is raced against the
 * pool attempt's abort signal (mirrors `tx/transfer.ts`'s own `withAbort`) so a
 * hung gateway is abandoned and the pool rotates rather than stalling.
 */

import { createEndpointClientFactory } from "../tx/endpointClient.js";
import { InvalidGatewayPriceError } from "../tx/errors.js";
import type { GatewayPool } from "../gateway/types.js";

/** Strict Winston amount gate: one-or-more ASCII digits, nothing else. Rejects
 *  the lenient-BigInt traps (`""`, leading/trailing whitespace, `0x`, `1e3`,
 *  decimals) before any `BigInt(...)` call. */
const WINSTON_DECIMAL = /^\d+$/;

/**
 * Race an arweave-js network call against the pool's per-attempt abort signal.
 * Mirrors `tx/transfer.ts`'s identically-named helper (arweave-js's own
 * `getPrice` accepts no `AbortSignal`, so a hung call would otherwise stall the
 * pool's own timeout enforcement — the abandoned promise still settles later,
 * unobserved, once the attempt is abandoned).
 */
function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new Error("request aborted before start"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("request aborted by pool timeout"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/** A per-endpoint Winston price-quote fetch: `endpoint` targets a single
 *  gateway, mirroring `tx/types.ts`'s `TransferGatewayApi.getPrice`. */
export type EstimateFeeGetPriceFn = (
  endpoint: string,
  byteSize: number,
  target: string,
) => Promise<string>;

/** Options for {@link estimateFee}. */
export interface EstimateFeeOptions {
  /**
   * Internal per-endpoint price-quote seam. `tx/transfer.ts`'s `sendTransfer`
   * threads its own (possibly test-injected) `apiFactory`'s `getPrice` through
   * here so its price step reuses this module's single fetch-and-validate
   * implementation rather than a second copy. A plain consumer of
   * `estimateFee` never needs this — it defaults to a real arweave-js client
   * built via `createEndpointClientFactory()`.
   */
  getPrice?: EstimateFeeGetPriceFn;
}

/** The default `getPrice`: a real arweave-js client per endpoint, built via
 *  the T3.4 endpoint client factory (cache scoped to this single call). */
function defaultGetPrice(): EstimateFeeGetPriceFn {
  const clientFor = createEndpointClientFactory();
  return (endpoint, byteSize, target) =>
    clientFor(endpoint).transactions.getPrice(byteSize, target);
}

/**
 * Fetch and validate a Winston reward (fee) quote for a `byteSize`-byte
 * transfer to `target`, through the gateway pool.
 *
 * @throws {GatewayPoolExhaustedError} (unwrapped) if the pool exhausts; its
 *   `attempts` carry the per-endpoint underlying errors (e.g.
 *   `InvalidGatewayPriceError` for a gate-failing quote).
 */
export async function estimateFee(
  pool: GatewayPool,
  byteSize: number,
  target: string,
  opts: EstimateFeeOptions = {},
): Promise<bigint> {
  const getPrice = opts.getPrice ?? defaultGetPrice();

  const rewardString = await pool.execute(async (endpoint, { signal }) => {
    const quote = await withAbort(getPrice(endpoint, byteSize, target), signal);
    // The quote is embedded in a SIGNED tx — gate it strictly. A gate-failing
    // quote throws inside the op so the pool rotates to an honest gateway.
    if (!WINSTON_DECIMAL.test(quote)) {
      throw new InvalidGatewayPriceError(endpoint);
    }
    return quote;
  });

  return BigInt(rewardString);
}
