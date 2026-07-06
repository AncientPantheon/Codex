/**
 * Native AR transfer orchestration.
 *
 * `sendTransfer` composes the Phase 2 gateway pool, the T3.3 isolated signer,
 * the T3.5 origin-only guard, and the T3.4 endpoint client into the Module B
 * transfer recipe: fetch the anchor and reward through the pool, build the tx
 * FULLY OFFLINE, sign it, and post it through the pool with retry/rotation.
 *
 * Ordering (each step gates the next so a caller-config error never burns the
 * retry schedule and a bad quote never reaches a signed tx):
 *   0. PRE-FLIGHT origin-only guard over the pool's configured endpoints — a
 *      pathed/query/fragment endpoint surfaces `UnsupportedEndpointError`
 *      UNWRAPPED with zero pool attempts.
 *   1. input validation — jwk via `importKeyfile`, target 43-char base64url,
 *      quantity > 0n, and the REQUIRED `maxRewardWinston` fee cap present — all
 *      before any pool attempt. An absent cap throws `InvalidTransferError`
 *      (reason `missing-max-reward`) with zero pool attempts.
 *   2. anchor + price EACH through `pool.execute`; the price op strictly gates
 *      the quote with `^\d+$` (the reward is embedded in a SIGNED tx — more
 *      dangerous than `BigInt`) and throws `InvalidGatewayPriceError` inside
 *      the op on failure → rotation.
 *   2b. fee cap — if the quote exceeds the caller-required `maxRewardWinston`,
 *      throw `RewardExceedsCapError` to the caller BEFORE building/signing.
 *   3. build offline via `createTransaction({ target, quantity, last_tx, reward }, jwk)`.
 *   4. sign via the T3.3 signer (the ONLY signing path).
 *   5. post through `pool.execute`; the post op inspects the seam status and
 *      throws `TransferPostFailedError` for anything outside 200-299 (208 is
 *      2xx → success) → rotation.
 *   6. resolve `{ id, reward }`.
 *
 * The default gateway-API factory is arweave-js-backed (via the T3.4 endpoint
 * client); tests inject plain fakes through `opts.apiFactory`. The build is
 * offline because the anchor and reward are supplied (verified arweave-js
 * fact), so no network is touched until the post.
 */

import Arweave from "arweave";

import { importKeyfile } from "../keys/keyfile.js";
import { signTransaction } from "../signing/sign.js";
import { assertOriginOnlyEndpoints } from "../endpoints.js";
import { isCanonicalAddress } from "../canonical.js";
import type { GatewayPool } from "../gateway/types.js";
import { createEndpointClientFactory } from "./endpointClient.js";
import {
  InvalidTransferError,
  TransferPostFailedError,
  InvalidGatewayPriceError,
  RewardExceedsCapError,
} from "./errors.js";
import type {
  SendTransferOptions,
  TransferGatewayApiFactory,
  TransferParams,
  TransferResult,
} from "./types.js";

/** Strict Winston amount gate: a plain decimal digit string (no lenient
 *  `BigInt` coercion of `""`, `" 123"`, `"1e3"`, `"0x10"`). */
const WINSTON_DECIMAL = /^\d+$/;

/** A data-less transfer prices at byteSize 0. */
const TRANSFER_BYTE_SIZE = 0;

/**
 * Race an arweave-js network call against the pool's per-attempt abort signal.
 * arweave-js's own `getAnchor`/`getPrice`/`post` accept no `AbortSignal` (and
 * its `timeout` config is verified dead code), so a hung call would otherwise
 * stall the whole pool. Rejecting when the signal aborts abandons the call so
 * the pool's timeout drives rotation exactly as it does for the fetch-based
 * reads. The abandoned arweave-js promise still settles later, unobserved — we
 * do not need its result once the attempt is abandoned.
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

/**
 * Module-internal Arweave instance used ONLY for the OFFLINE `createTransaction`
 * build.
 *
 * NOT A NETWORK CONNECTION POINT. With `last_tx` and `reward` both supplied,
 * `createTransaction` issues zero network calls (verified arweave-js fact +
 * vestigial-host probe), so this instance never touches a gateway. The real
 * anchor/price/post I/O goes through the per-endpoint client built from the
 * INJECTED pool endpoint (`endpointClient.ts`), never this instance. The host is
 * therefore an INERT placeholder, deliberately NOT `arweave.net`, so no reachable
 * gateway default is baked in (N-03).
 */
const BUILDER_INERT_HOST = "offline-build.invalid";
const builder = Arweave.init({
  host: BUILDER_INERT_HOST,
  protocol: "https",
  port: 443,
});

/**
 * Build the default arweave-js-backed gateway-API factory: each per-endpoint
 * client fetches the anchor via `transactions.getTransactionAnchor()`, prices
 * via `transactions.getPrice(0, target)` (both throw on non-200, verified), and
 * posts via `transactions.post` (which resolves the status verbatim without
 * throwing — the pool op checks it).
 */
function defaultApiFactory(): TransferGatewayApiFactory {
  const clientFor = createEndpointClientFactory();
  return (endpoint: string) => {
    const client = clientFor(endpoint);
    return {
      getAnchor: () => client.transactions.getTransactionAnchor(),
      getPrice: (byteSize: number, target: string) =>
        client.transactions.getPrice(byteSize, target),
      postTransaction: async (tx) => {
        const response = await client.transactions.post(tx);
        return { status: response.status, statusText: response.statusText };
      },
    };
  };
}

/** The configured endpoint list, verbatim, from the pool's eager health
 *  snapshot (complete from construction — see the Phase 2 snapshot contract). */
function configuredEndpoints(pool: GatewayPool): string[] {
  return pool.getHealthSnapshot().map((entry) => entry.endpoint);
}

/**
 * Build, sign, and post a native AR transfer through the gateway pool,
 * resolving the signed transaction's id and the fee actually paid.
 *
 * WORST-CASE WALL TIME: this composes THREE sequential pool calls (anchor,
 * price, post), each a full `maxAttemptsPerEndpoint × endpoints` retry schedule
 * with exponential backoff between failures — on a fully-degraded pool the
 * composed latency is minutes, not seconds. Each individual per-endpoint attempt
 * is now additionally bounded by the pool's `requestTimeoutMs` (default 15s), so
 * a black-holed gateway is abandoned rather than stalling a call indefinitely;
 * the composed schedule remains the product of the three calls' retry budgets.
 *
 * @throws {UnsupportedEndpointError} (unwrapped) if any configured endpoint is
 *   not origin-only — zero pool attempts.
 * @throws {InvalidKeyfileError} if `params.jwk` fails structural validation.
 * @throws {InvalidTransferError} if `target`/`quantity` are structurally invalid
 *   or the required `maxRewardWinston` fee cap is absent — zero pool attempts.
 * @throws {RewardExceedsCapError} if a valid quote exceeds `maxRewardWinston`.
 * @throws {GatewayPoolExhaustedError} (unwrapped) if the pool exhausts on the
 *   anchor/price read path or on the post; its `attempts` carry the per-endpoint
 *   underlying errors (`TransferPostFailedError`, `InvalidGatewayPriceError`, …).
 */
export async function sendTransfer(
  pool: GatewayPool,
  params: TransferParams,
  opts: SendTransferOptions = {},
): Promise<TransferResult> {
  // (0) PRE-FLIGHT: a pathed endpoint is a deterministic caller-config error —
  // surface it unwrapped before burning a single pool attempt.
  assertOriginOnlyEndpoints(configuredEndpoints(pool));

  // (1) Input validation — before any pool attempt.
  const jwk = importKeyfile(params.jwk);
  if (!isCanonicalAddress(params.target)) {
    throw new InvalidTransferError("bad-target", params.target);
  }
  if (params.quantity <= 0n) {
    throw new InvalidTransferError("non-positive-quantity");
  }
  // The fee cap is REQUIRED: the reward is quoted by an untrusted rotating
  // gateway and signed/PAID verbatim, so a caller MUST state their ceiling
  // before any gateway is contacted — otherwise a compromised/MITM'd gateway
  // could quote and burn an arbitrary fee on the default path.
  if (params.maxRewardWinston === undefined) {
    throw new InvalidTransferError("missing-max-reward");
  }

  const apiFactory = opts.apiFactory ?? defaultApiFactory();

  // (2) Fetch anchor and price — each rotates independently through the pool.
  // Each arweave-js call is raced against the attempt's abort signal so a hung
  // gateway is abandoned and the pool rotates (arweave-js accepts no signal).
  const lastTx = await pool.execute((endpoint, { signal }) =>
    withAbort(apiFactory(endpoint).getAnchor(), signal),
  );
  const rewardString = await pool.execute(async (endpoint, { signal }) => {
    const quote = await withAbort(
      apiFactory(endpoint).getPrice(TRANSFER_BYTE_SIZE, params.target),
      signal,
    );
    // The quote is embedded in a SIGNED tx — gate it strictly. A gate-failing
    // quote throws inside the op so the pool rotates to an honest gateway.
    if (!WINSTON_DECIMAL.test(quote)) {
      throw new InvalidGatewayPriceError(endpoint);
    }
    return quote;
  });

  const reward = BigInt(rewardString);

  // (2b) Fee cap — refuse to sign/pay a quote above the caller's ceiling.
  if (reward > params.maxRewardWinston) {
    throw new RewardExceedsCapError(reward, params.maxRewardWinston);
  }

  // (3) Build FULLY OFFLINE — last_tx + reward supplied means zero network.
  const tx = await builder.createTransaction(
    {
      target: params.target,
      quantity: params.quantity.toString(),
      last_tx: lastTx,
      reward: rewardString,
    },
    jwk,
  );

  // (4) Sign via the isolated signer — the ONLY signing path.
  await signTransaction(tx, jwk);

  // (5) Post — the op inspects the seam status and throws on non-2xx so the
  // pool rotates. arweave-js's post never rejects on HTTP errors, so this
  // status check is what surfaces gateway failures to the pool.
  await pool.execute(async (endpoint, { signal }) => {
    const { status, statusText } = await withAbort(
      apiFactory(endpoint).postTransaction(tx),
      signal,
    );
    if (status < 200 || status > 299) {
      throw new TransferPostFailedError(endpoint, status, statusText);
    }
  });

  // (6) Resolve the id and the fee actually paid.
  return { id: tx.id, reward };
}
