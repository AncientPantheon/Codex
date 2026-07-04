/**
 * Transaction confirmation status/depth reads through the gateway pool.
 *
 * `getTransactionStatus` fetches `GET {endpoint}/tx/{txId}/status` through the
 * Phase 2 pool and maps VALID gateway answers to a discriminated result:
 *   - HTTP 200 + a body with numeric `block_height`, string `block_indep_hash`,
 *     and numeric `number_of_confirmations` -> `confirmed`, carrying those fields
 *     plus `final = number_of_confirmations >= confirmationDepth`.
 *   - HTTP 202 -> `pending` (accepted, not yet mined).
 *   - HTTP 404 -> `not-found` (a LEGITIMATE answer: a just-posted tx is honestly
 *     unknown on honest gateways). It resolves and does NOT rotate — chasing a
 *     tx across gateways on 404 would burn the pool on every fresh-tx poll.
 * Any OTHER status, or a 200 body failing shape validation, throws inside the
 * operation so the pool rotates (a garbage answer from one gateway may be fine
 * on the next).
 *
 * Network I/O flows through the runtime-global `fetch` via the pool — NOT
 * arweave-js. The pool is passed IN by the caller.
 */

import type { GatewayPool } from "../gateway/types.js";
import { assertOriginOnlyEndpoints } from "../endpoints.js";
import { isCanonicalAddress } from "../canonical.js";
import { InvalidTransactionIdError, InvalidGatewayResponseError } from "./errors.js";

/**
 * The number of confirmations at/above which a mined transaction is considered
 * FINAL (irreversible enough for consumer purposes) rather than merely
 * `confirmed`. This is the handoff's CONFIRM_DEPTH concept — tunable per call
 * via {@link GetTransactionStatusOptions.confirmationDepth}; the default of 10
 * matches the observer's conservative reorg margin.
 */
export const DEFAULT_CONFIRMATION_DEPTH = 10;

/**
 * The injectable fetch seam. Binding-safe and resolved at CALL time (see
 * `reads/balance.ts` for the browser `Illegal invocation` / stub-blinding
 * rationale).
 */
export type FetchFn = typeof fetch;

const defaultFetch: FetchFn = (input, init) => globalThis.fetch(input, init);

/** Options for {@link getTransactionStatus}. */
export interface GetTransactionStatusOptions {
  /** Injectable fetch seam; defaults to a binding-safe call-time delegate to
   *  `globalThis.fetch`. */
  fetchFn?: FetchFn;
  /** Confirmations at/above which the tx is FINAL. Defaults to
   *  {@link DEFAULT_CONFIRMATION_DEPTH}. */
  confirmationDepth?: number;
}

/** A confirmed (mined) transaction with its block coordinates and finality. */
export interface ConfirmedTransactionStatus {
  readonly status: "confirmed";
  readonly blockHeight: number;
  readonly blockIndepHash: string;
  readonly numberOfConfirmations: number;
  /** `true` when `numberOfConfirmations >= confirmationDepth`. */
  readonly final: boolean;
}

/** A transaction accepted by the network but not yet mined into a block. */
export interface PendingTransactionStatus {
  readonly status: "pending";
}

/** A transaction the gateway does not (yet) know about — legitimately fresh. */
export interface NotFoundTransactionStatus {
  readonly status: "not-found";
}

/** The discriminated result of a transaction-status read. */
export type TransactionStatus =
  | ConfirmedTransactionStatus
  | PendingTransactionStatus
  | NotFoundTransactionStatus;

/** Join an endpoint base URL with a route, collapsing any double slash at the
 *  seam (trailing-slash endpoint + leading-slash route must not double up). */
function joinUrl(endpointBaseUrl: string, route: string): string {
  const base = endpointBaseUrl.replace(/\/+$/, "");
  const path = route.replace(/^\/+/, "");
  return `${base}/${path}`;
}

/** Whether a parsed JSON body has the confirmed-status shape. */
function isConfirmedBody(body: unknown): body is {
  block_height: number;
  block_indep_hash: string;
  number_of_confirmations: number;
} {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  // block_height and number_of_confirmations must be non-negative safe integers,
  // not merely `typeof "number"` — a dishonest gateway could otherwise send a
  // negative, fractional, or Infinity confirmations count that passes the shape
  // gate and drives the `final` finality decision (e.g. Infinity → final:true).
  // Such a body is garbage and must rotate to another gateway, consistent with
  // the "a garbage answer from one gateway may be fine on the next" contract.
  const isNonNegativeSafeInt = (v: unknown): v is number =>
    typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  return (
    isNonNegativeSafeInt(b.block_height) &&
    typeof b.block_indep_hash === "string" &&
    b.block_indep_hash !== "" &&
    isNonNegativeSafeInt(b.number_of_confirmations)
  );
}

/**
 * Read the confirmation status/depth of `txId` through the gateway pool.
 *
 * TRUST MODEL: the result is only as trustworthy as the SINGLE gateway that
 * answered. Neither `final`/the confirmation depth NOR any other field is
 * consensus-verified — one malicious or out-of-sync pooled gateway can fabricate
 * a `confirmed`/`final: true` status (or a bogus `numberOfConfirmations`), and
 * the pool resolves on the first gateway that returns a well-formed answer. For
 * value decisions, cross-check `blockIndepHash` (the wire `block_indep_hash`)
 * across INDEPENDENT gateways: agreement on the block hash at the reported height
 * is what raises confidence, not a single gateway's `final` flag.
 *
 * Pre-validates `txId` against the canonical form (throws
 * {@link InvalidTransactionIdError} BEFORE any network call), runs the
 * origin-only pre-flight over the pool's configured endpoints (a pathed endpoint
 * surfaces `UnsupportedEndpointError` unwrapped with zero pool attempts), then
 * executes `GET {endpoint}/tx/{txId}/status` through `pool.execute`. Maps 200/202/404
 * to the discriminated result; any other status or a malformed 200 body throws
 * inside the operation so the pool rotates.
 */
export async function getTransactionStatus(
  pool: GatewayPool,
  txId: string,
  opts?: GetTransactionStatusOptions,
): Promise<TransactionStatus> {
  if (!isCanonicalAddress(txId)) {
    throw new InvalidTransactionIdError(txId);
  }

  assertOriginOnlyEndpoints(pool.getHealthSnapshot().map((e) => e.endpoint));

  const fetchFn = opts?.fetchFn ?? defaultFetch;
  const confirmationDepth =
    opts?.confirmationDepth ?? DEFAULT_CONFIRMATION_DEPTH;

  return pool.execute(async function getTransactionStatus(
    endpointBaseUrl,
    { signal },
  ) {
    const url = joinUrl(endpointBaseUrl, `tx/${txId}/status`);
    const response = await fetchFn(url, { signal });

    // 202 (accepted) and 404 (unknown) are LEGITIMATE answers — resolve, do not
    // rotate. A fresh tx is honestly pending/unknown on honest gateways.
    if (response.status === 202) {
      return { status: "pending" } satisfies PendingTransactionStatus;
    }
    if (response.status === 404) {
      return { status: "not-found" } satisfies NotFoundTransactionStatus;
    }

    if (response.status !== 200) {
      // Any other status (5xx, unexpected) throws so the pool rotates.
      throw new InvalidGatewayResponseError(
        "getTransactionStatus",
        endpointBaseUrl,
        `http-status-${response.status}`,
      );
    }

    const body: unknown = await response.json().catch(() => undefined);
    if (!isConfirmedBody(body)) {
      // A 200 that fails shape validation is a garbage answer — throw to rotate.
      throw new InvalidGatewayResponseError(
        "getTransactionStatus",
        endpointBaseUrl,
        "malformed-confirmed-body",
      );
    }

    return {
      status: "confirmed",
      blockHeight: body.block_height,
      blockIndepHash: body.block_indep_hash,
      numberOfConfirmations: body.number_of_confirmations,
      final: body.number_of_confirmations >= confirmationDepth,
    } satisfies ConfirmedTransactionStatus;
  });
}
