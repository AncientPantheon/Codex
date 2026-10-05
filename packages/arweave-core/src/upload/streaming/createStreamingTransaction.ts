/**
 * `createStreamingTransaction` — builds + signs a Transaction from an
 * ALREADY-COMPUTED streaming `data_root` (T3 of `arweave-streaming-post-core`),
 * never from a resident data buffer.
 *
 * GROUNDING (read in full before writing this, never assumed):
 *
 * `node_modules/arweave/node/lib/transaction.js`'s `prepareChunks(data)`:
 * ```
 * async prepareChunks(data) {
 *   if (!this.chunks && data.byteLength > 0) {
 *     this.chunks = await generateTransactionChunks(data);
 *     this.data_root = ArweaveUtils.bufferTob64Url(this.chunks.data_root);
 *   }
 *   if (!this.chunks && data.byteLength === 0) {
 *     this.chunks = { chunks: [], data_root: new Uint8Array(), proofs: [] };
 *     this.data_root = "";
 *   }
 * }
 * ```
 * — only computes+assigns `this.chunks`/`this.data_root` when `!this.chunks`.
 * `getSignatureData()`'s format-2 branch only calls it `if (!this.data_root)`.
 * So setting `tx.chunks`/`tx.data_root`/`tx.data_size` DIRECTLY, before
 * `signTransaction` ever triggers `getSignatureData()`, is the documented
 * bypass path: `prepareChunks` never runs, `this.data` is never read.
 *
 * `node_modules/arweave/node/common.js`'s `createTransaction` ALWAYS assigns
 * `transaction.data_root = ""` / `transaction.data_size = data ? len : "0"`
 * itself, then calls `createdTransaction.getSignatureData()` once internally
 * (its own return value discarded) before returning — with `data: new
 * Uint8Array(0)` passed in below, that internal call harmlessly runs the
 * zero-byte branch of `prepareChunks` (`chunks: []`, `data_root: ""`), which
 * this function then overwrites with the REAL streaming-computed values
 * before `signTransaction` runs. By the time signing's own
 * `getSignatureData()` call fires, `this.data_root` is already truthy (our
 * override), so `prepareChunks` is skipped entirely — the format-2 deep hash
 * is built from `data_size`/`data_root`/owner/tags/last_tx/reward, which
 * NEVER includes `this.data` itself (confirmed by reading the `case 2` branch
 * directly) — so this produces the IDENTICAL deep-hash input a real
 * full-buffer build would have, without ever touching the real bytes. See
 * `tests/streaming-create-transaction.test.ts` for the byte-identical proof.
 *
 * `last_tx`/`reward` are supplied by the caller (fetched through the gateway
 * pool one layer up, mirroring `nativeUpload.ts`'s own offline-build
 * convention) so this call issues zero network I/O, same as
 * `postArweaveData`'s own `builder.createTransaction(...)` step.
 *
 * PACKAGE PLACEMENT: this logic lives in `arweave-core`, not `codex-arweave`,
 * because it needs the real `arweave` package's `Transaction`/`Arweave.init`/
 * `createTransaction` surface — the ONLY package in this project that takes a
 * direct runtime dependency on `arweave` in its own `src` (confirmed:
 * `codex-arweave/package.json` declares no `arweave` dependency at all; its
 * OWN `src` never imports it either — only its TEST files do, for comparison
 * oracles, which is a different concern). `signTransaction`/`importKeyfile`
 * are already exported from this package's public barrel and reachable from
 * `codex-arweave`, but `createTransaction`/`Transaction`/the raw gateway
 * `Api.post` calls are not, and extending that reach would break this
 * project's established package-isolation boundary. `codex-arweave`'s own
 * `streamingPost.ts` (T3's other half) calls this function instead of
 * reaching for `arweave` itself.
 */

import Arweave from "arweave";
import type Transaction from "arweave/node/lib/transaction";

import { importKeyfile } from "../../keys/keyfile.js";
import { signTransaction } from "../../signing/sign.js";
import { createEndpointClientFactory } from "../../tx/endpointClient.js";
import type { ArweaveJwk } from "../../keys/types.js";
import type { Tag } from "../tags.js";
import type { StreamingDataRootResult } from "./computeStreamingDataRoot.js";

/** The real, already-signed `arweave-js` `Transaction` — re-exported so a
 *  consumer (e.g. `codex-arweave`'s `streamingPost.ts`) never needs its own
 *  direct `arweave` import just to type the value this function hands back. */
export type SignedStreamingTransaction = Transaction;

/** Inputs for {@link createStreamingTransaction}. */
export interface CreateStreamingTransactionParams {
  /** The uploader's keyfile — the SAME jwk signs this transaction. */
  jwk: ArweaveJwk;
  /** The anchor (`last_tx`), fetched by the caller through the gateway pool —
   *  supplying it up front means this build issues zero network I/O, same as
   *  `nativeUpload.ts`'s own offline-build convention. */
  lastTx: string;
  /** The quoted reward (fee), in Winston, as a decimal string. */
  reward: string;
  /** The tags applied to the transaction, in order, via `tx.addTag` — NEVER
   *  a raw `tags` attribute (see `nativeUpload.ts`'s own doc comment for why
   *  that would bypass arweave-js's base64url tag encoding). */
  tags: Tag[];
  /** The total payload byte length — becomes `tx.data_size`, stringified.
   *  NEVER derived from `tx.data` (which stays an empty `Uint8Array(0)`). */
  dataSize: number;
  /** The already-computed streaming `data_root`/`chunks`/`proofs` (T1's
   *  `computeStreamingDataRoot` output) — set directly onto the transaction,
   *  bypassing `prepareChunks` entirely (see this module's doc comment). */
  streaming: StreamingDataRootResult;
}

/** Module-internal Arweave instance used ONLY for the OFFLINE `createTransaction`
 *  build — mirrors `nativeUpload.ts`'s own identically-purposed `builder`
 *  instance. `last_tx`/`reward` are both supplied by the caller, so this
 *  build issues zero network calls; the host is deliberately NOT a reachable
 *  gateway (N-03). */
const BUILDER_INERT_HOST = "offline-streaming-build.invalid";
const builder = Arweave.init({
  host: BUILDER_INERT_HOST,
  protocol: "https",
  port: 443,
});

/**
 * Builds and signs a Transaction whose `data` is ALWAYS an empty
 * `Uint8Array(0)` — the real bundle bytes are never passed in — but whose
 * `chunks`/`data_root`/`data_size` are the REAL values `computeStreamingDataRoot`
 * already computed by reading the payload one chunk at a time. Owner/tags are
 * set the same way `nativeUpload.ts`'s `postArweaveData` already does for a
 * non-streaming upload; signing goes through the SAME isolated signer
 * (`signTransaction`) — the only signing path this project uses.
 */
export async function createStreamingTransaction(
  params: CreateStreamingTransactionParams,
): Promise<SignedStreamingTransaction> {
  const jwk = importKeyfile(params.jwk);

  // `data: new Uint8Array(0)` — never the real bundle bytes. `createTransaction`
  // itself harmlessly runs `prepareChunks` on this empty buffer internally
  // (see the module doc comment); the overrides below replace that result
  // with the real streaming-computed values before signing.
  const tx = await builder.createTransaction(
    { data: new Uint8Array(0), last_tx: params.lastTx, reward: params.reward },
    jwk,
  );

  // Set directly, BEFORE signing — the documented `prepareChunks` bypass.
  tx.chunks = {
    data_root: params.streaming.data_root,
    chunks: params.streaming.chunks,
    proofs: params.streaming.proofs,
  };
  tx.data_root = Arweave.utils.bufferTob64Url(params.streaming.data_root);
  // `data_size` is typed `readonly` on arweave-js's own `Transaction` class
  // (`transaction.d.ts`) purely as a TS annotation — it is a plain,
  // assignable class field at runtime (no getter), the SAME bypass
  // `prepareChunks` itself relies on internally. Cast through the narrow
  // mutable view rather than `as any`.
  (tx as unknown as { data_size: string }).data_size = params.dataSize.toString();

  // Tags MUST go through `addTag` (base64url-encodes name/value) — same rule
  // as `nativeUpload.ts`'s own non-streaming build.
  for (const tag of params.tags) {
    tx.addTag(tag.name, tag.value);
  }

  // Sign via the isolated signer — the ONLY signing path. By now
  // `tx.data_root` is truthy, so signing's own `getSignatureData()` call
  // skips `prepareChunks` entirely and never touches `tx.data` (empty).
  await signTransaction(tx, params.jwk);

  return tx;
}

/**
 * The `/chunk` POST body shape `buildStreamingChunkBody`
 * (`codex-arweave/src/library/streaming/buildStreamingChunkBody.ts`) already
 * produces — duplicated here structurally (never imported across the
 * package boundary) so this interface stays decoupled from that sibling
 * package's own file, same decoupling convention T2 established.
 */
export interface StreamingChunkPostBody {
  data_root: string;
  data_size: string;
  data_path: string;
  offset: string;
  chunk: string;
}

/**
 * The narrow per-endpoint gateway operations the streaming post loop needs.
 * Mirrors `nativeUpload.ts`'s own `UploadGatewayApi` shape, swapping the
 * full-buffer `getUploader` for two low-level calls that never require a
 * resident payload: `postTransaction` (the real `TransactionUploader
 * .postTransaction()`'s own `api.post("tx", transaction)` call — `transaction
 * .data` is always empty here, so no buffer is ever read for this step
 * either) and `postChunk` (the real `TransactionUploader.uploadChunk()`'s own
 * `api.post("chunk", body)` call, fed a body built by `codex-arweave`'s
 * `buildStreamingChunkBody` instead of `Transaction.getChunk`).
 */
export interface StreamingUploadGatewayApi {
  /** The `last_tx` anchor for an offline build. Throws on gateway failure. */
  getAnchor(): Promise<string>;
  /** The reward (fee) quote in Winston for a `byteSize`-byte payload. */
  getPrice(byteSize: number, target?: string): Promise<string>;
  /** Posts the signed transaction itself (`data` always empty) — the real
   *  `api.post("tx", tx)` call, status 200-299 required. */
  postTransaction(tx: SignedStreamingTransaction): Promise<void>;
  /** Posts one chunk's body — the real `api.post("chunk", body)` call,
   *  status 200 required. */
  postChunk(body: StreamingChunkPostBody): Promise<void>;
}

/** Maps a pool endpoint base URL to a per-endpoint {@link StreamingUploadGatewayApi}.
 *  Mirrors `nativeUpload.ts`'s `UploadGatewayApiFactory` shape; tests inject
 *  plain fakes. */
export type StreamingUploadGatewayApiFactory = (
  endpointBaseUrl: string,
) => StreamingUploadGatewayApi;

/**
 * The default arweave-js-backed {@link StreamingUploadGatewayApiFactory}:
 * each per-endpoint client fetches the anchor/price the SAME way
 * `nativeUpload.ts`'s own default factory does, and posts the transaction/
 * each chunk via the client's raw `api.post(...)` — the exact same low-level
 * call the real `TransactionUploader` makes internally (see this module's own
 * doc comment), just fed a body this project's own streaming code builds
 * instead of slicing a resident buffer.
 */
export function createDefaultStreamingUploadGatewayApiFactory(): StreamingUploadGatewayApiFactory {
  const clientFor = createEndpointClientFactory();
  return (endpoint: string) => {
    const client = clientFor(endpoint);
    return {
      getAnchor: () => client.transactions.getTransactionAnchor(),
      getPrice: (byteSize: number, target?: string) =>
        client.transactions.getPrice(byteSize, target),
      postTransaction: async (tx: SignedStreamingTransaction) => {
        const resp = await client.api.post("tx", tx);
        if (!(resp.status >= 200 && resp.status < 300)) {
          throw new Error(`Unable to upload transaction: ${resp.status}`);
        }
      },
      postChunk: async (body: StreamingChunkPostBody) => {
        const resp = await client.api.post("chunk", body);
        if (resp.status !== 200) {
          throw new Error(`Unable to upload chunk: ${resp.status}`);
        }
      },
    };
  };
}
