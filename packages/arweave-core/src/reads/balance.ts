/**
 * Address balance reads through the gateway pool.
 *
 * `getBalance` fetches `GET {endpoint}/wallet/{address}/balance` through the
 * Phase 2 pool and returns the Winston amount as a `bigint`. Winston is `bigint`
 * end-to-end (Phase 2 units contract); the wire value is a decimal string that
 * MUST pass the strict `^\d+$` gate BEFORE `BigInt(...)` — the Phase 2
 * lenient-BigInt lesson: `BigInt("")` -> 0n, whitespace is trimmed, `0x`
 * prefixes and `1e3` exponents are accepted, so a raw response body must never
 * reach `BigInt` unvalidated.
 *
 * Network I/O flows through the runtime-global `fetch` (Node >=20 + browsers) via
 * the pool — NOT arweave-js — keeping the heavy dependency confined to the tx
 * path and mocks trivial. The pool is passed IN by the caller (no module-global
 * state). Failures inside the per-endpoint operation THROW so the pool rotates.
 */

import type { GatewayPool } from "../gateway/types.js";
import { assertOriginOnlyEndpoints } from "../endpoints.js";
import { isCanonicalAddress } from "../canonical.js";
import {
  InvalidAddressError,
  InvalidGatewayResponseError,
} from "./errors.js";

/** Strict Winston amount gate: one-or-more ASCII digits, nothing else. Rejects
 *  the lenient-BigInt traps (`""`, leading/trailing whitespace, `0x`, `1e3`,
 *  decimals) before any `BigInt(...)` call. */
const STRICT_DIGITS = /^\d+$/;

/**
 * The injectable fetch seam. Its default MUST be binding-safe and resolved at
 * CALL time — a bare `globalThis.fetch` captured at module load would (a) throw
 * `TypeError: Illegal invocation` in browsers (WebIDL receiver brand check) when
 * called detached, and (b) blind test stubs installed after module load. The
 * wrapper reads `globalThis.fetch` on every invocation and calls it bound.
 */
export type FetchFn = typeof fetch;

const defaultFetch: FetchFn = (input, init) => globalThis.fetch(input, init);

/** Options for {@link getBalance}. */
export interface GetBalanceOptions {
  /** Injectable fetch seam; defaults to a binding-safe call-time delegate to
   *  `globalThis.fetch`. */
  fetchFn?: FetchFn;
}

/** Join an endpoint base URL with a route, collapsing any double slash at the
 *  seam (a trailing-slash endpoint + a leading-slash route must not double up). */
function joinUrl(endpointBaseUrl: string, route: string): string {
  const base = endpointBaseUrl.replace(/\/+$/, "");
  const path = route.replace(/^\/+/, "");
  return `${base}/${path}`;
}

/**
 * Read the Winston balance of `address` through the gateway pool.
 *
 * TRUST MODEL: the returned balance is only as trustworthy as the SINGLE gateway
 * that answered. It is NOT consensus-verified — one malicious or out-of-sync
 * pooled gateway can fabricate any balance, and the pool resolves on the first
 * gateway that returns a well-formed answer. For value decisions, cross-check the
 * result across INDEPENDENT gateways (and compare `block_indep_hash` via
 * {@link getTransactionStatus} for tx-level confirmations) rather than trusting a
 * single read.
 *
 * Pre-validates `address` against the canonical form (throws
 * {@link InvalidAddressError} BEFORE any network call), runs the origin-only
 * pre-flight over the pool's configured endpoints (a pathed endpoint surfaces
 * `UnsupportedEndpointError` unwrapped with zero pool attempts), then executes
 * `GET {endpoint}/wallet/{address}/balance` through `pool.execute`. A non-2xx
 * response throws inside the operation (pool rotates); a 2xx body failing the
 * strict `^\d+$` gate throws {@link InvalidGatewayResponseError} inside the
 * operation (also rotates). Resolves with the Winston `bigint`.
 */
export async function getBalance(
  pool: GatewayPool,
  address: string,
  opts?: GetBalanceOptions,
): Promise<bigint> {
  if (!isCanonicalAddress(address)) {
    throw new InvalidAddressError(address);
  }

  // Origin-only pre-flight over ALL configured endpoints (the Phase 2 snapshot
  // enumerates them verbatim from construction, so this can never vacuously
  // pass). Surfaces UnsupportedEndpointError UNWRAPPED before the first attempt.
  assertOriginOnlyEndpoints(pool.getHealthSnapshot().map((e) => e.endpoint));

  const fetchFn = opts?.fetchFn ?? defaultFetch;

  return pool.execute(async function getBalance(endpointBaseUrl, { signal }) {
    const url = joinUrl(endpointBaseUrl, `wallet/${address}/balance`);
    const response = await fetchFn(url, { signal });

    if (!response.ok) {
      // Non-2xx throws so the pool rotates/backs off.
      throw new InvalidGatewayResponseError(
        "getBalance",
        endpointBaseUrl,
        `http-status-${response.status}`,
      );
    }

    // Raw text, NO trimming — the strict gate rejects any body BigInt would
    // silently coerce (empty, whitespace, 0x, exponent, decimal).
    const body = await response.text();
    if (!STRICT_DIGITS.test(body)) {
      throw new InvalidGatewayResponseError(
        "getBalance",
        endpointBaseUrl,
        "non-integer-winston-body",
      );
    }

    return BigInt(body);
  });
}
