/**
 * `streamingPostBundle` — the streaming post loop (T3 of
 * `arweave-streaming-post-core`), the task that ties the whole
 * streaming-upload architecture together: a multi-gigabyte folder upload
 * never requires holding the whole bundle in browser memory, end to end.
 *
 * Composition, mirroring `arweave-core`'s `nativeUpload.ts`'s
 * `postArweaveData` structure (read in full before writing this) as closely
 * as this streaming variant allows:
 *   0. Input validation — jwk via `importKeyfile`, the REQUIRED
 *      `maxRewardWinston` fee cap — before any pool attempt, same ordering.
 *   1. anchor + price EACH through `pool.execute` — `estimateFee` reused
 *      directly (its own injectable `getPrice` seam threaded to this
 *      module's own, possibly test-injected, `apiFactory`), so there is
 *      exactly ONE "fetch and validate a Winston price quote" implementation
 *      in this project, same as `postArweaveData` itself.
 *   1b. fee cap — a quote exceeding `maxRewardWinston` throws
 *      `RewardExceedsCapError` BEFORE building or signing.
 *   2. Transaction creation + signing: `@ancientpantheon/arweave-core`'s
 *      `createStreamingTransaction` (T3's other half — lives in
 *      `arweave-core`, not here, because it needs the real `arweave`
 *      package's `Transaction`/`createTransaction` surface, which this
 *      package takes no direct dependency on; see that function's own
 *      "PACKAGE PLACEMENT" doc comment for the full grounding). `data` is
 *      ALWAYS an empty `Uint8Array(0)`; `chunks`/`data_root`/`data_size` are
 *      set directly from the caller-supplied, already-computed streaming
 *      `data_root` (Topic 1's `computeStreamingDataRoot`, fed by Topic 2's
 *      `BundleAssemblyFile` for the actual byte reads during THAT
 *      computation — a step this function's caller already ran, not
 *      repeated here).
 *   3. Post through `pool.execute`, ONE attempt wrapping BOTH steps below —
 *      mirroring `postArweaveData`'s own single `pool.execute` wrapping
 *      `getUploader` + the whole `runUploaderLoop`: if the whole attempt
 *      ultimately fails (a chunk exhausts its own retry budget), the pool
 *      rotates to a fresh endpoint and this ENTIRE step restarts there
 *      (re-posts the tx, re-loops every chunk from 0) — never resuming a
 *      partial upload across a rotation, same semantics as the stock path:
 *     a. POST the transaction itself FIRST (`txPosted`-then-chunks ordering
 *        — the real `TransactionUploader` always posts the tx before any
 *        chunk, confirmed by reading `transaction-uploader.js` in full).
 *        `tx.data` stays empty, so this step never reads any bundle bytes.
 *     b. For each chunk index 0..chunks.length-1, in order: build the body
 *        via Topic 2's `buildStreamingChunkBody` (reads EXACTLY that one
 *        chunk's bytes from `params.file`, never more) and POST it to the
 *        gateway's `/chunk` endpoint. A chunk POST that throws is retried
 *        on the SAME chunk index, in place, up to `MAX_CHUNK_RETRIES` times
 *        before the error propagates — the EXACT retry-in-place shape
 *        `nativeUpload.ts`'s own `runUploaderLoop` already established,
 *        just substituting `uploader.uploadChunk()` for
 *        `buildStreamingChunkBody` + `api.postChunk`. Progress (`onProgress`)
 *        is reported after each chunk succeeds.
 *   4. Resolve `{ id, data_root, reward }` — `data_root` is included
 *      (unlike `postArweaveData`'s `{id, reward}`) because a caller
 *      resuming a later streaming upload needs it for verification.
 *
 * T2 of `arweave-streaming-post-resume` adds, ON TOP of the above (never
 * changing steps 0-2 or the core per-chunk posting mechanics in step 3):
 *   - OPT-IN checkpoint persistence via `opts.resume` (T1's
 *     `StreamingPostResumeStore`): a record is saved right after the tx post
 *     succeeds (`chunkIndex: 0, txPosted: true`) and again after EVERY
 *     successfully-posted chunk (`chunkIndex: idx + 1`) — see
 *     {@link postTxAndRemainingChunks}'s own doc comment for the write-volume
 *     tradeoff this per-chunk cadence makes deliberately. On full completion,
 *     the record is deleted and (by default, overridable) the OPFS bundle
 *     file itself is deleted too.
 *   - {@link resumeStreamingPost}, a SEPARATE entry point that loads a
 *     persisted record, reopens the same-named OPFS file, reconstructs the
 *     signed transaction DIRECTLY from the persisted fields (no
 *     `createStreamingTransaction` call, no signing — that is the entire
 *     point), and drives the SAME {@link postTxAndRemainingChunks} helper
 *     starting from the persisted `chunkIndex`/`txPosted`, so a resumed run
 *     can never re-sign, re-read an already-posted chunk's bytes, or
 *     re-post it.
 */

import {
  importKeyfile,
  estimateFee,
  createStreamingTransaction,
  createDefaultStreamingUploadGatewayApiFactory,
  InvalidUploadParamsError,
  RewardExceedsCapError,
  type ArweaveJwk,
  type Tag,
  type GatewayPool,
  type StreamingDataRootResult,
  type StreamingUploadGatewayApi,
  type StreamingUploadGatewayApiFactory,
} from "@ancientpantheon/arweave-core";

import { buildStreamingChunkBody, type StreamingChunkMeta } from "./buildStreamingChunkBody.js";
import { openOpfsBundleAssemblyFile, type BundleAssemblyFile } from "./bundleAssemblyFile.js";
import {
  type StreamingPostResumeStore,
  type StreamingPostResumeRecord,
  type StreamingPostResumeSignedTx,
} from "./streamingPostResumeStore.js";

/**
 * Race an arweave-js/gateway network call against the pool's per-attempt
 * abort signal. Mirrors `nativeUpload.ts`'s identically-named/-purposed
 * helper (duplicated per-file across this project's upload/transfer/fee
 * modules by established convention, rather than shared) — arweave-js
 * accepts no `AbortSignal` on any of these calls, so a hung call would
 * otherwise stall the pool's own timeout enforcement.
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

/** Bounded number of consecutive retries for a SINGLE chunk (same chunk
 *  index, in place) before giving up and letting the whole pool attempt
 *  fail (which rotates to a different endpoint, restarting from the tx
 *  post) — the EXACT same budget/semantics as `nativeUpload.ts`'s own
 *  `MAX_CHUNK_RETRIES`. */
const MAX_CHUNK_RETRIES = 3;

/**
 * Options enabling persisted-checkpoint resumability (T2 of
 * `arweave-streaming-post-resume`) — entirely OPT-IN: omitting `resume` from
 * {@link StreamingPostOptions} means no resume record is ever written (T3's
 * own uninterrupted-path tests, unaffected, pass `opts.resume` as `undefined`).
 */
export interface StreamingPostResumeOptions {
  /** Where the checkpoint is persisted/updated — T1's store. */
  store: StreamingPostResumeStore;
  /** This upload's resume-record id (the store's keyPath) — the caller's own
   *  identifier for this upload action, independent of `fileName`. */
  id: string;
  /** The already-open `params.file`'s own OPFS file name — persisted so a
   *  LATER {@link resumeStreamingPost} call can reopen the SAME file. This
   *  function itself never opens/closes/deletes `params.file` by this name
   *  WHILE POSTING (the caller already holds it open) — but see
   *  `deleteFileOnComplete` below: on successful completion, if that policy
   *  is enabled, this function DOES close `params.file` itself (idempotent;
   *  safe even if the caller also closes it again afterward), because a real
   *  OPFS `directory.removeEntry()` throws against a file with an open
   *  `FileSystemSyncAccessHandle` — confirmed the hard way, real-browser, by
   *  `arweave-streaming-post-resume`'s own T3 capstone check (the identical
   *  ordering bug {@link resumeStreamingPost}'s own doc comment/fix
   *  describes in full). */
  fileName: string;
  /** Deletes the OPFS bundle file by name once every chunk has posted
   *  successfully. Injectable — defaults to the real OPFS
   *  `directory.removeEntry(fileName)` call (mirrors `bundleAssemblyFile.ts`'s
   *  own locally-typed `navigator.storage` seam); tests inject a fake/spy. */
  deleteFile?: (fileName: string) => Promise<void>;
  /**
   * Whether to delete the OPFS bundle file on full completion. Defaults to
   * `true` — nothing further needs the file once every chunk has posted —
   * but is an explicit, overridable policy rather than a silently hardcoded
   * choice either way (`arweave-streaming-post-resume/design.md`).
   */
  deleteFileOnComplete?: boolean;
}

/** Options for {@link streamingPostBundle}. */
export interface StreamingPostOptions {
  /** The per-endpoint streaming gateway-API factory. Defaults to
   *  `arweave-core`'s own arweave-js-backed factory; tests inject plain
   *  fakes. */
  apiFactory?: StreamingUploadGatewayApiFactory;
  /** Called after each chunk's POST succeeds, with the number of chunks
   *  uploaded so far and the total — the streaming loop's progress seam. */
  onProgress?: (uploadedChunks: number, totalChunks: number) => void;
  /** Enables persisted-checkpoint resumability — see
   *  {@link StreamingPostResumeOptions}. Omitted entirely by default. */
  resume?: StreamingPostResumeOptions;
}

/** Inputs for {@link streamingPostBundle}. */
export interface StreamingPostParams {
  /** The uploader's keyfile (validated via `importKeyfile` before any pool
   *  attempt). The SAME jwk signs the transaction. */
  jwk: ArweaveJwk;
  /** The tags applied to the transaction, in order, via `tx.addTag`. */
  tags: Tag[];
  /** REQUIRED fee cap, in Winston — same contract as `postArweaveData`'s own
   *  `maxRewardWinston`: an absent cap throws `InvalidUploadParamsError`
   *  (field `"maxRewardWinston"`, reason `"missing-max-reward"`) with zero
   *  pool attempts; a quote exceeding it throws `RewardExceedsCapError`
   *  before building or signing. */
  maxRewardWinston: bigint;
  /** The total payload byte length — becomes the transaction's `data_size`.
   *  Also the price-quote `byteSize` (the fee is quoted for the REAL
   *  payload size, even though `data` itself stays empty). */
  dataSize: number;
  /** The already-computed streaming `data_root`/`chunks`/`proofs` —
   *  `@ancientpantheon/arweave-core`'s `computeStreamingDataRoot` output,
   *  computed by the caller by reading `file` one chunk at a time. */
  streaming: StreamingDataRootResult;
  /** The assembled bundle, read ONE chunk's bytes at a time during the
   *  per-chunk POST loop below — never a resident full-buffer read. */
  file: BundleAssemblyFile;
}

/** The result of a successful streaming post. */
export interface StreamingPostResult {
  /** The signed transaction's canonical id (43-char base64url). */
  readonly id: string;
  /** The signed transaction's base64url `data_root`. */
  readonly data_root: string;
  /** The fee actually paid, in Winston. */
  readonly reward: bigint;
}

/**
 * Build, sign, and post a native Arweave transaction for an already-
 * assembled bundle, reading at most one chunk's worth of bytes from `file`
 * at any point during posting.
 *
 * @throws {InvalidKeyfileError} if `params.jwk` fails structural validation.
 * @throws {InvalidUploadParamsError} if `maxRewardWinston` is absent —
 *   zero pool attempts.
 * @throws {RewardExceedsCapError} if a valid quote exceeds `maxRewardWinston`.
 * @throws {GatewayPoolExhaustedError} (unwrapped) if the pool exhausts on
 *   the anchor/price read path or on the post.
 */
export async function streamingPostBundle(
  pool: GatewayPool,
  params: StreamingPostParams,
  opts: StreamingPostOptions = {},
): Promise<StreamingPostResult> {
  // (0) Input validation — before any pool attempt.
  importKeyfile(params.jwk);
  if (params.maxRewardWinston === undefined) {
    throw new InvalidUploadParamsError("maxRewardWinston", "missing-max-reward");
  }

  const apiFactory = opts.apiFactory ?? createDefaultStreamingUploadGatewayApiFactory();

  // (1) Fetch anchor and price — each rotates independently through the pool.
  const lastTx = await pool.execute((endpoint, { signal }) =>
    withAbort(apiFactory(endpoint).getAnchor(), signal),
  );
  const reward = await estimateFee(pool, params.dataSize, undefined, {
    getPrice: (endpoint, size, target) => apiFactory(endpoint).getPrice(size, target),
  });

  // (1b) Fee cap — refuse to sign/pay a quote above the caller's ceiling.
  if (reward > params.maxRewardWinston) {
    throw new RewardExceedsCapError(reward, params.maxRewardWinston);
  }

  // (2) Build + sign — `arweave-core`'s own real `Transaction`/
  // `createTransaction` surface; `data` is always empty, `chunks`/
  // `data_root`/`data_size` come directly from the already-computed
  // streaming result.
  const tx = await createStreamingTransaction({
    jwk: params.jwk,
    lastTx,
    reward: reward.toString(),
    tags: params.tags,
    dataSize: params.dataSize,
    streaming: params.streaming,
  });

  const chunks = params.streaming.chunks;
  const chunkMeta: StreamingChunkMeta = {
    dataRoot: tx.data_root,
    dataSize: tx.data_size,
    chunks,
    proofs: params.streaming.proofs,
  };

  // Checkpoint base record (tx fields + chunk/proof metadata never change
  // again once built) — `undefined` entirely when `opts.resume` is absent,
  // so a fresh run that never opts in writes nothing to IndexedDB at all.
  const resumeBaseRecord: StreamingPostResumeRecord | undefined = opts.resume
    ? {
        id: opts.resume.id,
        fileName: opts.resume.fileName,
        tx: toResumeTx(tx),
        chunks: params.streaming.chunks,
        proofs: params.streaming.proofs,
        chunkIndex: 0,
        txPosted: false,
      }
    : undefined;
  // MONOTONICITY GUARD (`arweave-streaming-checkpoint-regression`): a
  // checkpoint write must never move the PERSISTED `chunkIndex` backward.
  // `pool.execute` below re-invokes its operation closure once per attempt
  // (default `maxAttemptsPerEndpoint: 3`) with the SAME literal
  // `startChunkIndex: 0`/`txAlreadyPosted: false` it was written with — so a
  // retried attempt re-posts the tx and re-runs
  // `saveCheckpoint(startChunkIndex, true)` with that stale `0`, overwriting
  // progress (`chunkIndex: N`) a previous attempt genuinely earned and
  // persisted. The retried chunk loop normally re-saves the correct value
  // moments later, but a crash landing in that window would leave the durable
  // record claiming LESS progress than the gateway actually accepted — which
  // a later `resumeStreamingPost` would honour by re-posting already-accepted
  // chunks, breaking this module's own "never re-posts an already-successful
  // chunk" guarantee. Clamping the write here (rather than deriving
  // `startChunkIndex`/`txAlreadyPosted` from live checkpoint state per
  // attempt) deliberately leaves step (3)'s documented attempt-restart
  // semantics untouched: a rotation still restarts the whole post from the tx,
  // it just can no longer un-record progress already made.
  let highestPersistedChunkIndex = -1;
  const saveCheckpoint = resumeBaseRecord
    ? async (chunkIndex: number, txPosted: boolean) => {
        if (chunkIndex < highestPersistedChunkIndex) {
          return;
        }
        highestPersistedChunkIndex = chunkIndex;
        await opts.resume!.store.save({ ...resumeBaseRecord, chunkIndex, txPosted });
      }
    : undefined;

  // (3) Post — ONE pool attempt wraps posting the tx AND every chunk, same
  // as `postArweaveData`'s own single `pool.execute` wrapping its whole
  // uploader loop: an endpoint rotation restarts this entire step on the
  // new endpoint, never resuming a partial upload mid-rotation (T2 adds
  // checkpointing on top of this unchanged rotation semantics — it does not
  // alter it; see this module's own doc comment).
  await pool.execute(async (endpoint, { signal }) => {
    const api: StreamingUploadGatewayApi = apiFactory(endpoint);
    await postTxAndRemainingChunks(api, tx, chunkMeta, params.file, {
      txAlreadyPosted: false,
      startChunkIndex: 0,
      signal,
      onProgress: opts.onProgress,
      saveCheckpoint,
    });
  });

  // Completion — clear the checkpoint (and, by default, the OPFS file
  // itself; see `StreamingPostResumeOptions.deleteFileOnComplete`) once
  // every chunk has posted successfully.
  if (opts.resume) {
    await opts.resume.store.delete(opts.resume.id);
    if (opts.resume.deleteFileOnComplete ?? true) {
      // Close `params.file`'s own sync access handle FIRST — a real OPFS
      // `directory.removeEntry()` throws `NoModificationAllowedError`
      // against a file with an open `FileSystemSyncAccessHandle` (confirmed
      // the hard way, real-browser, by this sub-topic's own T3 capstone
      // check). `close()` is documented idempotent, so this is safe even if
      // the caller also closes `params.file` again afterward.
      await params.file.close();
      await (opts.resume.deleteFile ?? defaultDeleteOpfsFile)(opts.resume.fileName);
    }
  }

  // (4) Resolve.
  return { id: tx.id, data_root: tx.data_root, reward };
}

/**
 * Maps a real, already-signed streaming `Transaction`'s serializable fields
 * onto T1's `StreamingPostResumeSignedTx` — everything a later
 * `resumeStreamingPost` needs to reconstruct the SAME signed transaction
 * without ever re-signing. `tx.tags` are read as plain `{name, value}` pairs
 * (already base64url-encoded by `addTag` at signing time — see
 * `streamingPostResumeStore.ts`'s own doc comment), never the real `Tag`
 * class instances, keeping this mapping free of any class-shaped value.
 */
function toResumeTx(
  tx: Parameters<StreamingUploadGatewayApi["postTransaction"]>[0],
): StreamingPostResumeSignedTx {
  return {
    id: tx.id,
    owner: tx.owner,
    target: tx.target,
    quantity: tx.quantity,
    reward: tx.reward,
    last_tx: tx.last_tx,
    signature: tx.signature,
    data_root: tx.data_root,
    data_size: tx.data_size,
    tags: tx.tags.map((t) => ({ name: t.name, value: t.value })),
  };
}

/**
 * The real `arweave` `Transaction` shape {@link StreamingUploadGatewayApi
 * .postTransaction} expects, extracted POSITIONALLY off that method's own
 * parameter rather than naming `Transaction`/`SignedStreamingTransaction`
 * directly — this package's own `src` takes no dependency, even type-only,
 * on the real `Transaction` class (the SAME boundary
 * `streamingPostResumeStore.ts`'s own doc comment establishes and explains
 * in full).
 */
type SignedTxForPosting = Parameters<StreamingUploadGatewayApi["postTransaction"]>[0];

/**
 * Reconstructs a postable transaction value DIRECTLY from a persisted
 * {@link StreamingPostResumeSignedTx} — no signing, no `createStreamingTransaction`
 * call, no network I/O. `data` is set to `""` (the real `Transaction
 * .toJSON()`'s own base64url encoding of an empty buffer) rather than left
 * unset, so a resumed run posts the IDENTICAL wire shape a freshly-signed
 * transaction's own `postTransaction` call would have. The result is only
 * ever used as an opaque value threaded straight to `api.postTransaction` —
 * never a real `Transaction` instance, so it is cast through `unknown`
 * rather than built to structurally satisfy every method (`addTag`,
 * `getChunk`, ...) that type's own class shape otherwise requires but this
 * module never calls on it.
 */
function reconstructSignedTx(persisted: StreamingPostResumeSignedTx): SignedTxForPosting {
  return {
    format: 2,
    id: persisted.id,
    last_tx: persisted.last_tx,
    owner: persisted.owner,
    tags: persisted.tags.map((t) => ({ name: t.name, value: t.value })),
    target: persisted.target,
    quantity: persisted.quantity,
    data: "",
    data_size: persisted.data_size,
    data_root: persisted.data_root,
    reward: persisted.reward,
    signature: persisted.signature,
  } as unknown as SignedTxForPosting;
}

/** Options for {@link postTxAndRemainingChunks}. */
interface PostTxAndRemainingChunksOptions {
  /** Whether the tx-post step already succeeded (skip it entirely — the
   *  resume path's whole point) or still needs to run (the fresh path). */
  txAlreadyPosted: boolean;
  /** The first chunk index to post — `0` for a fresh run, the persisted
   *  `chunkIndex` for a resumed one. */
  startChunkIndex: number;
  signal: AbortSignal;
  onProgress?: (uploadedChunks: number, totalChunks: number) => void;
  /**
   * Persists an updated checkpoint, if resumability is enabled for this
   * call — `undefined` entirely otherwise (a fresh run with no `opts.resume`
   * configured). Called once right after the tx posts (`chunkIndex:
   * startChunkIndex, txPosted: true`) and once after EVERY successfully-
   * posted chunk (`chunkIndex: idx + 1`).
   *
   * WRITE-VOLUME TRADEOFF (ground this in the design doc, not assumed):
   * checkpointing after EVERY chunk (never batched) is the deliberate
   * choice here, even though it means one IndexedDB write per chunk — up to
   * tens of thousands of writes for a multi-gigabyte upload at the 256 KiB
   * Merkle chunk size. The alternative (batching every N chunks) would cut
   * that write volume by ~N but WEAKEN this module's own strict "never
   * re-posts an already-successful chunk" guarantee: an ungraceful crash
   * between two batch boundaries would make a resumed run re-post up to
   * `N - 1` chunks the gateway already has (wasted bandwidth/time, though
   * harmless to the chain itself — a duplicate chunk POST for an
   * already-accepted offset is a no-op server-side). Each checkpoint write
   * here is tiny (a scalar index + a boolean; the tx/chunk/proof metadata
   * stays byte-identical across writes) and is NEVER on the hot path of the
   * chunk's own HTTP POST (fire-and-await, not fire-and-forget, but orders
   * of magnitude smaller than the chunk body itself) — so per-chunk
   * checkpointing is the correctness-first choice; batching remains a later,
   * purely additive tuning knob if IndexedDB write volume ever proves to be
   * a real bottleneck in practice.
   */
  saveCheckpoint?: (chunkIndex: number, txPosted: boolean) => Promise<void>;
}

/**
 * The shared chunk-posting core BOTH `streamingPostBundle` (fresh, always
 * `txAlreadyPosted: false, startChunkIndex: 0`) and `resumeStreamingPost`
 * (whatever the persisted record says) drive — never duplicated, never
 * changed in its own per-chunk retry mechanics by T2's checkpoint/resume
 * addition. Posts the transaction first (unless already posted), then every
 * remaining chunk in order, retrying a single chunk in place up to
 * `MAX_CHUNK_RETRIES` times before propagating.
 */
async function postTxAndRemainingChunks(
  api: StreamingUploadGatewayApi,
  tx: SignedTxForPosting,
  chunkMeta: StreamingChunkMeta,
  file: BundleAssemblyFile,
  opts: PostTxAndRemainingChunksOptions,
): Promise<void> {
  const { txAlreadyPosted, startChunkIndex, signal, onProgress, saveCheckpoint } = opts;

  // (a) The transaction itself, FIRST — `tx.data` stays empty, so this never
  // reads any bundle bytes (mirrors the real `TransactionUploader
  // .postTransaction()`'s own `txPosted`-then-chunks ordering). Skipped
  // entirely when resuming a record that already has `txPosted: true`.
  if (!txAlreadyPosted) {
    await withAbort(api.postTransaction(tx), signal);
    await saveCheckpoint?.(startChunkIndex, true);
  }

  // (b) Each remaining chunk, in order — reading ONLY that one chunk's
  // bytes, starting at `startChunkIndex` (0 for a fresh run; the persisted
  // `chunkIndex` for a resumed one, so an already-successful chunk below it
  // is never read or re-posted).
  const chunks = chunkMeta.chunks;
  for (let idx = startChunkIndex; idx < chunks.length; idx++) {
    let attempts = 0;
    for (;;) {
      try {
        const body = await buildStreamingChunkBody(idx, chunkMeta, file);
        await withAbort(api.postChunk(body), signal);
        break;
      } catch (err) {
        attempts++;
        if (attempts > MAX_CHUNK_RETRIES) {
          throw err;
        }
      }
    }
    onProgress?.(idx + 1, chunks.length);
    await saveCheckpoint?.(idx + 1, true);
  }
}

/**
 * Structural view of `StorageManager`/`FileSystemDirectoryHandle`'s one
 * member this module's default OPFS-file-cleanup needs — mirrors
 * `bundleAssemblyFile.ts`'s own locally-typed, narrower-than-`lib:["DOM"]`
 * OPFS surface (that module's own doc comment explains why this is
 * duplicated locally per-module rather than shared: a narrow browser-API
 * surface this package's lib config doesn't otherwise carry).
 */
interface OpfsDirectoryHandleWithRemoveLike {
  removeEntry(name: string): Promise<void>;
}
interface OpfsStorageManagerLike {
  getDirectory(): Promise<OpfsDirectoryHandleWithRemoveLike>;
}

/** The real, default `StreamingPostResumeOptions.deleteFile` /
 *  `ResumeStreamingPostOptions.deleteFile`: removes the named OPFS file via
 *  `navigator.storage.getDirectory().removeEntry(name)`. Tests inject a
 *  fake/spy instead — this is the ONE place a real ambient `navigator` is
 *  touched, same convention `bundleAssemblyFile.ts`'s own
 *  `defaultGetDirectory` establishes. */
async function defaultDeleteOpfsFile(fileName: string): Promise<void> {
  const storage = (navigator as unknown as { storage: OpfsStorageManagerLike }).storage;
  const directory = await storage.getDirectory();
  await directory.removeEntry(fileName);
}

/** Options for {@link resumeStreamingPost}. */
export interface ResumeStreamingPostOptions {
  /** Where the persisted checkpoint lives — required; this function has
   *  nothing to resume from without one. */
  store: StreamingPostResumeStore;
  /** The per-endpoint streaming gateway-API factory. Defaults to
   *  `arweave-core`'s own arweave-js-backed factory; tests inject plain
   *  fakes (a FRESH one, independent of whatever factory the original,
   *  interrupted run used). */
  apiFactory?: StreamingUploadGatewayApiFactory;
  /** Called after each chunk's POST succeeds, with the number of chunks
   *  uploaded so far and the total. */
  onProgress?: (uploadedChunks: number, totalChunks: number) => void;
  /** Reopens the persisted OPFS file by its `fileName` — defaults to the
   *  real `openOpfsBundleAssemblyFile`; tests inject a fake (or simply
   *  hand back the SAME in-memory fake file the interrupted run used, to
   *  simulate reopening it). */
  openFile?: (fileName: string) => Promise<BundleAssemblyFile>;
  /** Deletes the OPFS bundle file by name once every chunk has posted
   *  successfully — same contract as `StreamingPostResumeOptions.deleteFile`. */
  deleteFile?: (fileName: string) => Promise<void>;
  /** Whether to delete the OPFS bundle file on full completion. Defaults to
   *  `true` — same policy, same override, as the fresh path's own
   *  `deleteFileOnComplete`. */
  deleteFileOnComplete?: boolean;
}

/**
 * Resumes an interrupted streaming post from its last persisted checkpoint:
 * loads the record, reopens the same-named OPFS file, reconstructs the
 * signed transaction DIRECTLY from the persisted fields (no
 * `createStreamingTransaction` call, no signing), and continues the SAME
 * {@link postTxAndRemainingChunks} core from the persisted `chunkIndex`/
 * `txPosted` — never re-signing, never re-reading an already-posted chunk's
 * bytes, never re-posting it.
 *
 * @throws {Error} if no resume record is persisted for `id`.
 */
export async function resumeStreamingPost(
  id: string,
  pool: GatewayPool,
  opts: ResumeStreamingPostOptions,
): Promise<StreamingPostResult> {
  const record = await opts.store.load(id);
  if (record === null) {
    throw new Error(`resumeStreamingPost: no resume record found for id "${id}"`);
  }

  const openFile = opts.openFile ?? ((fileName: string) => openOpfsBundleAssemblyFile(fileName));
  const file = await openFile(record.fileName);

  try {
    const apiFactory = opts.apiFactory ?? createDefaultStreamingUploadGatewayApiFactory();
    const tx = reconstructSignedTx(record.tx);
    const chunkMeta: StreamingChunkMeta = {
      dataRoot: record.tx.data_root,
      dataSize: record.tx.data_size,
      chunks: record.chunks,
      proofs: record.proofs,
    };
    const saveCheckpoint = (chunkIndex: number, txPosted: boolean) =>
      opts.store.save({ ...record, chunkIndex, txPosted });

    await pool.execute(async (endpoint, { signal }) => {
      const api: StreamingUploadGatewayApi = apiFactory(endpoint);
      await postTxAndRemainingChunks(api, tx, chunkMeta, file, {
        txAlreadyPosted: record.txPosted,
        startChunkIndex: record.chunkIndex,
        signal,
        onProgress: opts.onProgress,
        saveCheckpoint,
      });
    });

    // Completion — same policy as the fresh path.
    await opts.store.delete(id);
    if (opts.deleteFileOnComplete ?? true) {
      // Close `file` BEFORE deleting it — a real OPFS `directory
      // .removeEntry()` throws `NoModificationAllowedError` against a file
      // with an open `FileSystemSyncAccessHandle` (confirmed the hard way,
      // real-browser, by this sub-topic's own T3 capstone check: deletion
      // was attempted here while `file`'s own handle was still open, since
      // the `finally` block below used to be the ONLY close call, running
      // AFTER this point). `close()` is documented idempotent, so the
      // `finally` block's own call below remains a safe no-op afterward.
      await file.close();
      await (opts.deleteFile ?? defaultDeleteOpfsFile)(record.fileName);
    }

    return { id: tx.id, data_root: tx.data_root, reward: BigInt(record.tx.reward) };
  } finally {
    // This function opened `file` itself (unlike `streamingPostBundle`,
    // whose caller already holds `params.file` open) — so it alone is
    // responsible for closing it again, on both the success and failure
    // paths. Idempotent — a no-op here on the completion path above, which
    // already closed it before deleting.
    await file.close();
  }
}
