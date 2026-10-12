/**
 * The Web Worker entry for off-main-thread SPLIT (multi-bundle) streaming
 * uploads (`arweave-split-bundle-upload` T5b — closing the gap T5 flagged:
 * `runSplitBundleUpload` runs its OPFS work on the main thread, exactly the
 * platform fact `arweave-streaming-worker-wiring` already fixed for the
 * single-bundle path).
 *
 * Thin postMessage plumbing (TDD-exempt — the SAME convention
 * `uploadWorker.ts`'s own doc comment states: "the seam, the fake, and the
 * typed narrowing carry the tested logic", here in `runSplitBundleUpload.ts`
 * and `SplitUploadRunner.ts`). This file's only job is: install the one
 * polyfill a Worker's own global scope is missing, reconstruct every real
 * `File` reference it received into a `readData()` closure, call the
 * already-tested `runSplitBundleUpload` against freshly-constructed
 * dependencies, and translate its calls/result/throw into typed
 * {@link SplitUploadWorkerMsg} posts.
 *
 * WHY this must run inside a dedicated Worker at all: every one of the K
 * per-bundle engine calls `runSplitBundleUpload` makes
 * (`uploadBundleStreaming`/`resumeStreamingPost`) ultimately opens an OPFS
 * `FileSystemFileHandle.createSyncAccessHandle()` — Worker-only by spec, the
 * identical hard platform fact `uploadWorker.ts`'s own doc comment documents
 * for the single-bundle path. Calling `runSplitBundleUpload` from the main
 * document thread throws there today; this worker is the fix.
 *
 * WHAT CROSSES THE WORKER BOUNDARY, AND WHAT IS RECONSTRUCTED FRESH INSIDE
 * (confirmed against the real types/signatures below, not assumed):
 *   - `params.jwk` (a plain JWK object) and `params.encryptionKey` (a
 *     `CryptoKey`, structured-cloneable per the HTML spec regardless of its
 *     `extractable` flag) cross directly — the SAME two facts
 *     `uploadWorker.ts`'s own doc comment already establishes for the
 *     single-bundle path.
 *   - Each file crosses as `{ path, size, contentType, file: File }` — the
 *     real browser `File` object (structured-cloneable; the browser clones
 *     the underlying blob reference, not a byte-for-byte copy up front),
 *     NEVER a `readData()` callback (`RunSplitBundleUploadParams.files`'s own
 *     real shape requires one — functions are never structured-cloneable,
 *     and eagerly reading every file's bytes on the MAIN thread before
 *     posting them would defeat the entire point of this feature for a
 *     multi-GB folder). {@link runUpload} below reconstructs each file's
 *     `readData()` closure from its own in-worker `File` reference via
 *     `.arrayBuffer()` — called lazily, exactly once, when it becomes that
 *     file's turn, same contract `assembleBundleToFile.ts`'s own
 *     `AssembleBundleToFileInput.readData` already documents.
 *   - `opts.pool` (a `GatewayPool`) is a plain object of FUNCTIONS — never
 *     cloneable. Replaced on the wire by `poolEndpoints` (plain, cloneable
 *     endpoint URL strings, read via `pool.getHealthSnapshot()` by T5b's
 *     `createWorkerSplitUploadRunner`), from which {@link runUpload}
 *     reconstructs its OWN fresh `GatewayPool` (`createGatewayPool({
 *     endpoints })`) — the SAME tradeoff `uploadWorker.ts`'s own `pool`
 *     reconstruction already accepts.
 *   - `opts.planStore`/`opts.resumeStore` (both real IndexedDB-backed class
 *     instances wrapping a live `IDBDatabase` handle) are likewise never
 *     cloneable, and — unlike `uploadWorker.ts`'s own `LibraryStore`, which
 *     genuinely needs proxying back to the main thread's own in-memory
 *     instance — never NEED to be: IndexedDB is an origin-scoped database
 *     available natively inside a dedicated Worker's own global scope, the
 *     SAME database the main thread sees. {@link runUpload} therefore opens
 *     BOTH fresh, every call, via their own real `.open({ indexedDB,
 *     databaseName })` factories (confirmed against `SplitUploadPlanStore`/
 *     `StreamingPostResumeStore`'s real signatures, not guessed), using this
 *     Worker's own `self.indexedDB` — never requesting either store, or any
 *     RPC proxy for one, from the main thread at all.
 *   - `opts.apiFactory`/`opts.manifestApiFactory`/`opts.openFile`/
 *     `opts.deleteFile` (every one a function, or a factory OF functions)
 *     are deliberately dropped from the wire protocol entirely — this
 *     worker always runs `runSplitBundleUpload` against its OWN real
 *     defaults for every one of them (the real arweave-js-backed gateway API
 *     factories, and the real `openOpfsBundleAssemblyFile`, which only
 *     succeeds from inside a Worker in the first place — the whole reason
 *     this file exists). A caller that needs a FAKE for any of these
 *     exercises `runSplitBundleUpload` directly, in its own unit tests, not
 *     through this real production Worker entry.
 *   - `opts.onOverallProgress` cannot cross (a live callback) — translated
 *     into posted `{ kind: "progress" }` messages, exactly mirroring how
 *     `uploadWorker.ts`'s own `onProgress` becomes posted `{ kind:
 *     "progress" }` messages.
 *
 * Message protocol (mirrors `StreamingUploadWorkerMsg`'s own shape/spirit,
 * narrowed to what this engine actually reports — `runSplitBundleUpload` has
 * no "streaming vs. fallback" routing concept of its own, so there is no
 * `{ kind: "route" }` message here): the main thread posts ONE `{ kind:
 * "start", params, opts }` message; this worker posts zero or more `{ kind:
 * "progress" }`, then exactly one of `{ kind: "done" }` / `{ kind: "error" }`.
 * An uncaught exception anywhere in the run is caught and ALWAYS yields a
 * posted `error` message — this worker never lets a message-less throw
 * escape.
 *
 * `Buffer` polyfill install, and WHY it is a lazy `await import("buffer")`
 * rather than a static one: the SAME reasoning `uploadWorker.ts`'s own doc
 * comment gives verbatim — `e2-stoachain-isolation.test.ts`'s static
 * import-scan asserts every `src/library/**` file's bare import specifiers
 * are drawn ONLY from the allow-listed packages (this file lives under
 * `src/library/streaming`, so it is in scope), and `runSplitBundleUpload.ts`
 * (lazily imported below) ultimately drives `arbundles`' signer construction
 * (via `uploadBundleStreaming.ts`), which references the bare `Buffer`
 * global — missing in a Worker's own global scope, same as the single-bundle
 * path.
 */

// TYPE-ONLY, and deliberately so: erased at compile time, so naming these
// here costs this light entry NOTHING at runtime — the heavy implementation
// behind them still loads only via the LAZY `await import(...)` in
// {@link runUpload} below (mirrors `uploadWorker.ts`'s own E-12 discipline).
import type {
  RunSplitBundleUploadResult,
} from "./runSplitBundleUpload.js";
import type {
  ArweaveJwk,
  UploadCategory,
  NftAssetType,
} from "@ancientpantheon/arweave-core";

/**
 * The worker's global `postMessage`, typed to the message protocol — the
 * `MessageEvent.data` boundary is narrowed on `.kind`, never read as `any`.
 */
declare const self: {
  postMessage(msg: SplitUploadWorkerMsg): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  indexedDB: unknown;
};

/**
 * The typed worker→main message protocol, discriminated on `.kind` — mirrors
 * `StreamingUploadWorkerMsg`'s own shape, narrowed to what this engine
 * actually reports (see this module's own doc comment for why there is no
 * `{ kind: "route" }` here). Exported for T5b's `SplitUploadRunner.ts` to
 * import directly (its own `WorkerLike.onmessage` narrows on this exact
 * union, exactly as `StreamingUploadRunner.ts` narrows on
 * `StreamingUploadWorkerMsg`).
 */
export type SplitUploadWorkerMsg =
  /** Forwarded verbatim from `runSplitBundleUpload`'s own
   *  `onOverallProgress` option — never fired for a bundle that was skipped
   *  because it was already complete before this run started (nothing new
   *  to report for it; see that option's own doc comment). */
  | {
      kind: "progress";
      bundleIndex: number;
      totalBundles: number;
      bundleUploadedChunks: number;
      bundleTotalChunks: number;
      overallBytesUploaded: number;
      overallTotalBytes: number;
    }
  /** The terminal success message — carries the SAME
   *  `RunSplitBundleUploadResult` `runSplitBundleUpload` itself resolves
   *  with. */
  | { kind: "done"; result: RunSplitBundleUploadResult }
  /** The terminal failure message. Only the message STRING crosses back —
   *  mirrors `StreamingUploadWorkerMsg`'s own JWK-hygiene discipline of
   *  never serializing more than necessary across the boundary. */
  | { kind: "error"; message: string };

/** One input file as it actually crosses the wire: the real `File` object,
 *  never a `readData()` callback — see this module's own doc comment for the
 *  full grounding. */
export interface SplitUploadWorkerFile {
  path: string;
  size: number;
  contentType: string;
  file: File;
}

/** The wire-safe shape of `RunSplitBundleUploadParams` — identical field for
 *  field EXCEPT `files`, whose entries carry a real `File` instead of a
 *  `readData()` closure (see this module's own doc comment for why). */
export interface SplitUploadWorkerParams {
  jwk: ArweaveJwk;
  files: SplitUploadWorkerFile[];
  maxRewardWinston: bigint;
  category: UploadCategory;
  assetType?: NftAssetType;
  appId?: string;
  appVersion?: string;
  encrypted: boolean;
  encryptorAddress?: string;
  encryptionVersion?: string;
  encryptionKey?: CryptoKey;
}

/** The wire-safe shape of `RunSplitBundleUploadOptions` actually carried by a
 *  `{ kind: "start" }` message — `pool`/`planStore`/`resumeStore`/
 *  `apiFactory`/`manifestApiFactory`/`openFile`/`deleteFile`/
 *  `onOverallProgress` are ALL dropped (see this module's own doc comment
 *  for each one's own reason); `pool` is replaced by `poolEndpoints`. */
export interface SplitUploadWorkerStartOpts {
  /** The main thread's `GatewayPool`'s own configured endpoint URLs — see
   *  this type's own doc comment above. */
  poolEndpoints: string[];
  uploadId?: string;
  budgetBytes?: number;
  deleteFileOnComplete?: boolean;
}

/** The ONE inbound message shape this worker handles. Not part of the
 *  exported {@link SplitUploadWorkerMsg} union (that type is the
 *  worker→main direction only) — exported separately so T5b's
 *  `SplitUploadRunner.ts` can construct this exact shape without
 *  re-guessing its fields. */
export interface SplitUploadWorkerStartMsg {
  kind: "start";
  params: SplitUploadWorkerParams;
  opts: SplitUploadWorkerStartOpts;
}

function post(msg: SplitUploadWorkerMsg): void {
  self.postMessage(msg);
}

/**
 * Installs the guarded Worker-scope `Buffer` polyfill — see this module's own
 * doc comment above for why this is a lazy dynamic import rather than a
 * static one. MUST be awaited (and complete) before any other import that
 * might reference the bare `Buffer` global; {@link runUpload} calls this
 * FIRST, before its own lazy imports.
 */
async function ensureBufferPolyfill(): Promise<void> {
  const { Buffer } = await import("buffer");
  globalThis.Buffer = globalThis.Buffer ?? Buffer;
}

/** The stable IndexedDB database names {@link runUpload} opens REAL
 *  `SplitUploadPlanStore`/`StreamingPostResumeStore` instances against —
 *  constructed fresh, from INSIDE this Worker (its own `self.indexedDB`),
 *  every call. Scoped separately from `uploadWorker.ts`'s own
 *  `STREAMING_RESUME_DB_NAME` (a different object-store schema entirely —
 *  `SplitUploadPlanStore`'s records key on `uploadId`, not a per-bundle
 *  `resumeId`) so this feature's own persistence never shares a database
 *  with, or risks colliding with, the single-bundle resume path's. */
const SPLIT_UPLOAD_PLAN_DB_NAME = "codex-arweave-split-upload-plan";
const SPLIT_UPLOAD_RESUME_DB_NAME = "codex-arweave-split-upload-resume";

/**
 * Runs one split-bundle upload action to completion, posting the full
 * message sequence documented on {@link SplitUploadWorkerMsg}. Never lets a
 * throw escape un-posted — every failure, at any step, yields exactly one
 * `error` message.
 */
async function runUpload(
  params: SplitUploadWorkerParams,
  opts: SplitUploadWorkerStartOpts,
): Promise<void> {
  try {
    // FIRST — before any import that might reference the bare `Buffer`
    // global (the streaming engines' own `arbundles`-touching signer
    // construction, lazy-imported right below).
    await ensureBufferPolyfill();

    // LAZY heavy imports — mirrors `uploadWorker.ts`'s own E-12 discipline,
    // and here additionally guarantees this module evaluation happens
    // strictly AFTER the polyfill above has already run.
    const { runSplitBundleUpload } = await import("./runSplitBundleUpload.js");
    const { SplitUploadPlanStore } = await import("./splitUploadPlanStore.js");
    const { StreamingPostResumeStore } = await import("./streamingPostResumeStore.js");
    const { createGatewayPool } = await import("@ancientpantheon/arweave-core");

    // Reconstruct every one of the four things the wire shape could not
    // carry directly — see this module's own doc comment for why each one
    // is safe and necessary to construct fresh, INSIDE this Worker.
    const pool = createGatewayPool({ endpoints: opts.poolEndpoints });
    const indexedDB = self.indexedDB as Parameters<typeof SplitUploadPlanStore.open>[0]["indexedDB"];
    const [planStore, resumeStore] = await Promise.all([
      SplitUploadPlanStore.open({ indexedDB, databaseName: SPLIT_UPLOAD_PLAN_DB_NAME }),
      StreamingPostResumeStore.open({ indexedDB, databaseName: SPLIT_UPLOAD_RESUME_DB_NAME }),
    ]);

    // Each file's `readData()` is reconstructed from its own in-worker
    // `File` reference — called lazily, exactly once, when it becomes that
    // file's turn (the SAME contract `AssembleBundleToFileInput.readData`
    // already documents); never pre-read here.
    const files = params.files.map((f) => ({
      path: f.path,
      size: f.size,
      contentType: f.contentType,
      readData: async () => new Uint8Array(await f.file.arrayBuffer()),
    }));

    const result = await runSplitBundleUpload(
      {
        jwk: params.jwk,
        files,
        maxRewardWinston: params.maxRewardWinston,
        category: params.category,
        assetType: params.assetType,
        appId: params.appId,
        appVersion: params.appVersion,
        encrypted: params.encrypted,
        encryptorAddress: params.encryptorAddress,
        encryptionVersion: params.encryptionVersion,
        encryptionKey: params.encryptionKey,
      },
      {
        pool,
        planStore,
        resumeStore,
        uploadId: opts.uploadId,
        budgetBytes: opts.budgetBytes,
        deleteFileOnComplete: opts.deleteFileOnComplete,
        onOverallProgress: (
          bundleIndex,
          totalBundles,
          bundleUploadedChunks,
          bundleTotalChunks,
          overallBytesUploaded,
          overallTotalBytes,
        ) => {
          post({
            kind: "progress",
            bundleIndex,
            totalBundles,
            bundleUploadedChunks,
            bundleTotalChunks,
            overallBytesUploaded,
            overallTotalBytes,
          });
        },
      },
    );

    post({ kind: "done", result });
  } catch (err) {
    // Only the message string crosses back — never a stack/err object the
    // caller never asked for.
    const message = err instanceof Error ? err.message : String(err);
    post({ kind: "error", message });
  }
}

self.onmessage = (ev): void => {
  const data = ev.data;
  const kind =
    typeof data === "object" && data !== null ? (data as { kind?: unknown }).kind : undefined;

  if (kind === "start") {
    const msg = data as SplitUploadWorkerStartMsg;
    void runUpload(msg.params, msg.opts);
  }
};
