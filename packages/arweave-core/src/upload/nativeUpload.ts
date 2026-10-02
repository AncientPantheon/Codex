/**
 * Native (non-bundler-service) Arweave data-upload posting primitive.
 *
 * `postArweaveData` mirrors `tx/transfer.ts`'s `sendTransfer` composition —
 * pool-driven anchor fetch → pool-driven price quote → fully-offline
 * `createTransaction` build → `signTransaction` (the isolated signer,
 * `src/signing/sign.ts` — the ONLY signing path) → pool-driven post — but for
 * a `data` + `tags` payload instead of a `target`/`quantity` transfer, and
 * posts via a CHUNKED uploader loop (`getUploader(tx)` / `uploader
 * .uploadChunk()`, looping until `uploader.isComplete`) rather than
 * `sendTransfer`'s single `postTransaction` call — a data payload commonly
 * exceeds one request size unlike a dataless transfer.
 *
 * Ordering (each step gates the next, exactly mirroring `sendTransfer`):
 *   0. PRE-FLIGHT origin-only guard over the pool's configured endpoints —
 *      package-wide policy (`../endpoints.js`): a pathed/query/fragment
 *      endpoint surfaces `UnsupportedEndpointError` UNWRAPPED, zero pool
 *      attempts.
 *   1. input validation — jwk via `importKeyfile`, and the REQUIRED
 *      `maxRewardWinston` fee cap present — before any pool attempt. An
 *      absent cap throws `InvalidUploadParamsError` (field
 *      `"maxRewardWinston"`, reason `"missing-max-reward"`) with zero pool
 *      attempts.
 *   2. anchor + price EACH through `pool.execute`; the price quote is fetched
 *      via `estimateFee`'s now-optional `target` param (omitted — a data
 *      upload has no transfer recipient), `byteSize` = the payload's byte
 *      length.
 *   2b. fee cap — if the quote exceeds the caller-required
 *      `maxRewardWinston`, throw `RewardExceedsCapError` to the caller BEFORE
 *      building/signing.
 *   3. build offline via `createTransaction({ data, last_tx, reward }, jwk)`,
 *      then `tx.addTag(name, value)` per tag (NOT a raw `tags` attribute —
 *      arweave-js only base64url-encodes tag name/value through `addTag`;
 *      passing pre-built `Tag` objects through `createTransaction`'s
 *      attributes bypasses that encoding and would post malformed tags).
 *   4. sign via the isolated signer — the ONLY signing path.
 *   5. post through `pool.execute`: build a chunked uploader for the signed
 *      tx and loop `uploadChunk()` until `isComplete`. A chunk that THROWS is
 *      retried on the SAME uploader instance (bounded retries) — resuming
 *      from its current chunk index rather than re-requesting a fresh
 *      uploader (which would re-post the whole transaction from scratch).
 *   6. resolve `{ id, reward }`.
 *
 * The default gateway-API factory is arweave-js-backed (via the T3.4 endpoint
 * client); tests inject plain fakes through `opts.apiFactory`.
 */

import Arweave from "arweave";
import type Transaction from "arweave/node/lib/transaction";

import { importKeyfile } from "../keys/keyfile.js";
import { signTransaction } from "../signing/sign.js";
import { assertOriginOnlyEndpoints } from "../endpoints.js";
import { estimateFee } from "../reads/fee.js";
import type { GatewayPool } from "../gateway/types.js";
import { createEndpointClientFactory } from "../tx/endpointClient.js";
import { RewardExceedsCapError } from "../tx/errors.js";
import { InvalidUploadParamsError } from "./errors.js";
import type { ArweaveJwk } from "../keys/types.js";
import type { Tag } from "./tags.js";

/**
 * Race an arweave-js network call against the pool's per-attempt abort
 * signal. Mirrors `tx/transfer.ts`/`reads/fee.ts`'s identically-named helper
 * (arweave-js accepts no `AbortSignal` on any of these calls, so a hung call
 * would otherwise stall the whole pool; the abandoned promise still settles
 * later, unobserved, once the attempt is abandoned).
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
 * A chunked upload in progress — the narrow surface `postArweaveData` needs
 * from arweave-js's `TransactionUploader` (`getUploader(tx)`'s resolved
 * value satisfies this structurally as-is; tests inject plain fakes).
 */
export interface ChunkedUploader {
  /** True once every chunk (and the initial tx post) has succeeded. */
  readonly isComplete: boolean;
  /**
   * Uploads the next unsent chunk (or, on the first call, posts the
   * transaction itself). A transient failure on arweave-js's real uploader
   * does NOT throw — it leaves `isComplete` false and the same chunk is
   * retried on the next call. A thrown rejection (this seam's fakes, or a
   * genuinely fatal arweave-js error) is retried by `postArweaveData` on this
   * SAME instance, bounded, before giving up.
   */
  uploadChunk(): Promise<void>;
}

/**
 * The narrow per-endpoint gateway operations the native upload orchestration
 * needs. Mirrors `tx/types.ts`'s `TransferGatewayApi` shape, swapping the
 * single `postTransaction` for a chunked `getUploader`.
 */
export interface UploadGatewayApi {
  /** The `last_tx` anchor for an offline build. Throws on gateway failure. */
  getAnchor(): Promise<string>;
  /** The reward (fee) quote in Winston for a `byteSize`-byte payload. `target`
   *  is omitted (undefined) for a data upload — there is no recipient. */
  getPrice(byteSize: number, target?: string): Promise<string>;
  /** A chunked uploader for the signed `tx`, targeting this endpoint. */
  getUploader(tx: Transaction): Promise<ChunkedUploader>;
}

/**
 * Maps a pool endpoint base URL to a per-endpoint {@link UploadGatewayApi}.
 * The injectable seam, mirroring `SendTransferOptions.apiFactory`'s shape:
 * the default builds arweave-js clients via the T3.4 endpoint client; tests
 * inject plain functions.
 */
export type UploadGatewayApiFactory = (endpointBaseUrl: string) => UploadGatewayApi;

/** Options for {@link postArweaveData}. */
export interface PostArweaveDataOptions {
  /**
   * The per-endpoint gateway-API factory. Defaults to an arweave-js-backed
   * factory built on the T3.4 endpoint client. Tests inject plain fakes.
   */
  apiFactory?: UploadGatewayApiFactory;
}

/** Inputs for {@link postArweaveData}. */
export interface PostArweaveDataParams {
  /** The uploader's keyfile (validated via `importKeyfile` before any pool call). */
  jwk: ArweaveJwk;
  /** The payload to upload. */
  data: string | Uint8Array;
  /** The tags applied to the transaction, in order, via `tx.addTag`. */
  tags: Tag[];
  /**
   * REQUIRED fee cap, in Winston. The reward is quoted by an untrusted
   * rotating gateway and is signed and PAID verbatim, so a compromised/
   * MITM'd gateway could otherwise quote and burn an arbitrary fee. A quoted
   * reward STRICTLY greater than this cap throws `RewardExceedsCapError`
   * BEFORE building or signing; an absent cap throws
   * `InvalidUploadParamsError` before ANY pool call. The boundary is
   * inclusive (reward === cap is allowed).
   */
  maxRewardWinston: bigint;
}

/** The result of a successful upload: the tx id and the paid fee. */
export interface PostArweaveDataResult {
  /** The signed transaction's canonical id (43-char base64url). */
  readonly id: string;
  /** The fee actually paid, in Winston. */
  readonly reward: bigint;
}

/** A dataless quote (an anchor fetch) prices at byteSize 0; a data upload's
 *  quote is priced by the payload's own encoded byte length. */
function byteSizeOf(data: string | Uint8Array): number {
  return typeof data === "string" ? new TextEncoder().encode(data).length : data.byteLength;
}

/**
 * Module-internal Arweave instance used ONLY for the OFFLINE `createTransaction`
 * build. NOT A NETWORK CONNECTION POINT — mirrors `tx/transfer.ts`'s identically
 * -purposed `builder` instance: with `last_tx` and `reward` both supplied,
 * `createTransaction` issues zero network calls, so this instance never
 * touches a gateway. The host is deliberately NOT a reachable gateway (N-03).
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
 * via `transactions.getPrice(byteSize, target)` (target `undefined` for a data
 * upload — arweave-js's own `getPrice` already treats it as optional), and
 * builds a chunked uploader via `transactions.getUploader(tx)`.
 */
function defaultApiFactory(): UploadGatewayApiFactory {
  const clientFor = createEndpointClientFactory();
  return (endpoint: string) => {
    const client = clientFor(endpoint);
    return {
      getAnchor: () => client.transactions.getTransactionAnchor(),
      getPrice: (byteSize: number, target?: string) =>
        client.transactions.getPrice(byteSize, target),
      getUploader: (tx: Transaction) => client.transactions.getUploader(tx),
    };
  };
}

/** The configured endpoint list, verbatim, from the pool's eager health
 *  snapshot (complete from construction — see the Phase 2 snapshot contract). */
function configuredEndpoints(pool: GatewayPool): string[] {
  return pool.getHealthSnapshot().map((entry) => entry.endpoint);
}

/** Bounded number of consecutive retries for a SINGLE chunk (on the same
 *  uploader instance, resuming in place) before giving up and letting the
 *  whole pool attempt fail (which rotates to a different endpoint — a fresh
 *  uploader, unavoidably starting over, but only after this budget is spent). */
const MAX_CHUNK_RETRIES = 3;

/**
 * Loop `uploader.uploadChunk()` until `isComplete`, racing each individual
 * call against the pool attempt's abort signal. A call that RESOLVES without
 * completing (arweave-js's own non-fatal-error path) is naturally retried by
 * the next loop iteration on the same instance — no special-casing needed. A
 * call that THROWS is retried on the SAME instance up to `MAX_CHUNK_RETRIES`
 * times before the error propagates (ending this pool attempt, but never
 * re-requesting a fresh uploader/re-posting the transaction while retries
 * remain).
 */
async function runUploaderLoop(uploader: ChunkedUploader, signal: AbortSignal): Promise<void> {
  while (!uploader.isComplete) {
    let attempts = 0;
    for (;;) {
      try {
        await withAbort(uploader.uploadChunk(), signal);
        break;
      } catch (err) {
        attempts++;
        if (attempts > MAX_CHUNK_RETRIES) {
          throw err;
        }
      }
    }
  }
}

/**
 * Build, sign, and post a native Arweave data upload through the gateway
 * pool, resolving the signed transaction's id and the fee actually paid.
 *
 * @throws {UnsupportedEndpointError} (unwrapped) if any configured endpoint is
 *   not origin-only — zero pool attempts.
 * @throws {InvalidKeyfileError} if `params.jwk` fails structural validation.
 * @throws {InvalidUploadParamsError} if the required `maxRewardWinston` fee
 *   cap is absent (field `"maxRewardWinston"`, reason `"missing-max-reward"`)
 *   — zero pool attempts.
 * @throws {RewardExceedsCapError} if a valid quote exceeds `maxRewardWinston`.
 * @throws {GatewayPoolExhaustedError} (unwrapped) if the pool exhausts on the
 *   anchor/price read path or on the chunked upload.
 */
export async function postArweaveData(
  pool: GatewayPool,
  params: PostArweaveDataParams,
  opts: PostArweaveDataOptions = {},
): Promise<PostArweaveDataResult> {
  // (0) PRE-FLIGHT: a pathed endpoint is a deterministic caller-config error —
  // surface it unwrapped before burning a single pool attempt. Package-wide
  // policy (`../endpoints.js`).
  assertOriginOnlyEndpoints(configuredEndpoints(pool));

  // (1) Input validation — before any pool attempt.
  const jwk = importKeyfile(params.jwk);
  // The fee cap is REQUIRED: the reward is quoted by an untrusted rotating
  // gateway and signed/PAID verbatim, so a caller MUST state their ceiling
  // before any gateway is contacted.
  if (params.maxRewardWinston === undefined) {
    throw new InvalidUploadParamsError("maxRewardWinston", "missing-max-reward");
  }

  const apiFactory = opts.apiFactory ?? defaultApiFactory();
  const byteSize = byteSizeOf(params.data);

  // (2) Fetch anchor and price — each rotates independently through the pool.
  const lastTx = await pool.execute((endpoint, { signal }) =>
    withAbort(apiFactory(endpoint).getAnchor(), signal),
  );
  // No `target` — a data upload has no transfer recipient. Threads our own
  // (possibly test-injected) `apiFactory`'s `getPrice` through `estimateFee`'s
  // `getPrice` seam so the price step reuses its single fetch-and-validate
  // implementation instead of a second copy.
  const reward = await estimateFee(pool, byteSize, undefined, {
    getPrice: (endpoint, size, target) => apiFactory(endpoint).getPrice(size, target),
  });

  // (2b) Fee cap — refuse to sign/pay a quote above the caller's ceiling.
  if (reward > params.maxRewardWinston) {
    throw new RewardExceedsCapError(reward, params.maxRewardWinston);
  }

  // (3) Build FULLY OFFLINE — last_tx + reward supplied means zero network.
  const tx = await builder.createTransaction(
    {
      data: params.data,
      last_tx: lastTx,
      reward: reward.toString(),
    },
    jwk,
  );
  // Tags MUST go through `addTag` (base64url-encodes name/value) — passing a
  // raw `tags` attribute into `createTransaction` bypasses that encoding.
  for (const tag of params.tags) {
    tx.addTag(tag.name, tag.value);
  }

  // (4) Sign via the isolated signer — the ONLY signing path. Signs AFTER
  // tags are added, since the signature covers the tag list.
  await signTransaction(tx, jwk);

  // (5) Post via a CHUNKED uploader loop — a data payload commonly exceeds
  // one request, unlike a dataless transfer's single `postTransaction`.
  await pool.execute(async (endpoint, { signal }) => {
    const uploader = await withAbort(apiFactory(endpoint).getUploader(tx), signal);
    await runUploaderLoop(uploader, signal);
  });

  // (6) Resolve the id and the fee actually paid.
  return { id: tx.id, reward };
}
