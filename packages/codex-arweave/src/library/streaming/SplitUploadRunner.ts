/**
 * The main-thread split-bundle-upload SEAM (`arweave-split-bundle-upload`
 * T5b — closing the gap T5 flagged: `runSplitBundleUpload`'s own OPFS work
 * is Worker-only in a real browser).
 *
 * Mirrors `StreamingUploadRunner.ts`'s pattern exactly — same rationale, same
 * shape: a `WorkerLike` structural interface (declared LOCALLY, narrowed to
 * THIS seam's own {@link SplitUploadWorkerMsg} union — mirrors
 * `StreamingUploadRunner.ts`'s/`KeygenRunner.ts`'s own convention of each
 * runner seam declaring its own minimal `postMessage`/`onmessage`/`onerror`/
 * `terminate` surface, narrowed to its own message protocol, rather than a
 * shared generic type), an INJECTABLE `workerFactory: () => Worker` option
 * (never a hardcoded `new Worker(new URL(...))`), a shared
 * `SplitUploadRunner` interface, and both a real
 * (`createWorkerSplitUploadRunner`) and fake (`FakeSplitUploadRunner`)
 * implementation.
 *
 * NAMING: `SplitUploadRunner.ts`, not `SplitUploadWorkerRunner.ts` — mirrors
 * `StreamingUploadRunner.ts`'s own naming convention most directly
 * (`<domain>Runner.ts`; the Worker-backed-ness lives in the exported
 * `createWorker...` function's own name, not the filename, exactly as
 * `StreamingUploadRunner.ts` itself does for `createWorkerStreamingUploadRunner`).
 *
 * `SplitUploadWorkerMsg`/`SplitUploadWorkerStartMsg`/`SplitUploadWorkerParams`/
 * `SplitUploadWorkerFile` are imported TYPE-ONLY from T5b's
 * `splitUploadWorker.ts` — erased at compile time, so this module never
 * actually loads (or executes the worker-global side effects of) that file
 * at runtime; it only narrows the SAME message protocol the real worker
 * posts.
 *
 * `run`'s `params` is {@link SplitUploadRunnerParams} — structurally
 * identical to `runSplitBundleUpload`'s own `RunSplitBundleUploadParams`
 * EXCEPT each file carries a real `file: File` instead of a `readData()`
 * callback (functions are never structured-cloneable; a real `File` object
 * IS — see `splitUploadWorker.ts`'s own doc comment for the full grounding).
 * `run`'s `opts` is {@link SplitUploadRunnerOptions}: the REQUIRED `pool`
 * every real caller must supply (mirroring `StreamingUploadRunnerOptions`'s
 * own `store`/`pool` requirement), plus this seam's own `onOverallProgress`
 * callback. Deliberately ABSENT from this caller-facing options shape:
 * `planStore`/`resumeStore` (real IndexedDB-backed stores a caller could
 * never meaningfully hand across a Worker boundary anyway — the real
 * worker always opens its OWN fresh instances, from inside itself; see
 * `splitUploadWorker.ts`), and `apiFactory`/`manifestApiFactory`/`openFile`/
 * `deleteFile` (every one a function, or a factory OF functions — a real
 * production caller through THIS seam never needs to fake any of them; a
 * caller that does exercises `runSplitBundleUpload` directly, in its own
 * unit tests, never through this Worker-wrapping seam). The real runner
 * strips `pool`/`onOverallProgress` back off before posting — `pool` is
 * replaced by `poolEndpoints` (its own configured endpoint URLs), and
 * `onOverallProgress` is reconstructed from the worker's own `progress`
 * messages as they arrive.
 */

import type {
  SplitUploadWorkerFile,
  SplitUploadWorkerMsg,
  SplitUploadWorkerParams,
  SplitUploadWorkerStartMsg,
} from "./splitUploadWorker.js";
// TYPE-ONLY, and deliberately so: erased at compile time, so naming these
// here costs this seam nothing at runtime — mirrors `StreamingUploadRunner.ts`'s
// own type-only imports for the identical reason.
import type { RunSplitBundleUploadResult } from "./runSplitBundleUpload.js";
import type { ArweaveJwk, GatewayPool, UploadCategory, NftAssetType } from "@ancientpantheon/arweave-core";

/**
 * A structural Worker surface — exactly the members this runner drives,
 * narrowed to THIS seam's own {@link SplitUploadWorkerMsg} union. Typed
 * locally (mirrors `StreamingUploadRunner.ts`'s own `WorkerLike`) so the
 * seam does not depend on the DOM `Worker` lib beyond what it uses, and so
 * an injected fake worker satisfies it in tests.
 */
export interface WorkerLike {
  onmessage: ((ev: { data: SplitUploadWorkerMsg }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  postMessage(msg: unknown): void;
  terminate(): void;
}

/** One input file for {@link SplitUploadRunnerParams} — identical to
 *  {@link SplitUploadWorkerFile} (the real `File` object crosses verbatim;
 *  see `splitUploadWorker.ts`'s own doc comment for why), re-exported under
 *  this seam's own name so a caller of THIS file never needs to reach into
 *  `splitUploadWorker.ts` directly. */
export type SplitUploadRunnerFile = SplitUploadWorkerFile;

/** The caller-facing params for {@link SplitUploadRunner.run} — identical to
 *  `runSplitBundleUpload`'s own `RunSplitBundleUploadParams` EXCEPT `files`
 *  (see this module's own doc comment for why). */
export interface SplitUploadRunnerParams {
  jwk: ArweaveJwk;
  files: SplitUploadRunnerFile[];
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

/** Options for {@link SplitUploadRunner.run} — see this module's own doc
 *  comment for exactly why `planStore`/`resumeStore`/`apiFactory`/
 *  `manifestApiFactory`/`openFile`/`deleteFile` are deliberately absent. */
export interface SplitUploadRunnerOptions {
  /** The gateway pool every bundle AND the final manifest post through.
   *  REQUIRED — the real worker genuinely cannot run without it. */
  pool: GatewayPool;
  /** This upload action's shared `Codex-Upload-Id`. Defaults (inside the
   *  real engine) to a freshly generated id when omitted. */
  uploadId?: string;
  /** The safe per-attempt byte budget override — forwarded verbatim;
   *  omitted, the real engine computes its own via the real
   *  `navigator.storage.estimate()`, run from INSIDE the Worker (the same
   *  reason this whole seam exists). */
  budgetBytes?: number;
  /** Forwarded verbatim to every bundle's engine call. */
  deleteFileOnComplete?: boolean;
  /** Whole-sequence progress — mirrors `runSplitBundleUpload`'s own
   *  `onOverallProgress` option exactly, now driven by a cross-Worker
   *  message instead of a same-thread call. */
  onOverallProgress?: (
    bundleIndex: number,
    totalBundles: number,
    bundleUploadedChunks: number,
    bundleTotalChunks: number,
    overallBytesUploaded: number,
    overallTotalBytes: number,
  ) => void;
}

/**
 * The injectable off-main-thread split-bundle-upload seam. Resolves with the
 * same {@link RunSplitBundleUploadResult} `runSplitBundleUpload` itself
 * would resolve with (or rejects on failure), while emitting
 * `onOverallProgress` as the run proceeds. A fake resolves synchronously/
 * deterministically; the real implementation drives a Worker.
 */
export interface SplitUploadRunner {
  run(
    params: SplitUploadRunnerParams,
    opts: SplitUploadRunnerOptions,
  ): Promise<RunSplitBundleUploadResult>;
}

/** Config for {@link FakeSplitUploadRunner}: either resolve with `result`
 *  (optionally first emitting a scripted `onOverallProgress` sequence), or
 *  reject with `failWith` (after emitting the SAME scripted progress, if
 *  any) — mirrors `FakeStreamingUploadRunnerOptions`'s own `{ result } |
 *  { failWith }` shape. */
export type FakeSplitUploadRunnerOptions =
  | {
      result: RunSplitBundleUploadResult;
      failWith?: undefined;
      progress?: readonly {
        bundleIndex: number;
        totalBundles: number;
        bundleUploadedChunks: number;
        bundleTotalChunks: number;
        overallBytesUploaded: number;
        overallTotalBytes: number;
      }[];
    }
  | {
      failWith: string;
      result?: undefined;
      progress?: readonly {
        bundleIndex: number;
        totalBundles: number;
        bundleUploadedChunks: number;
        bundleTotalChunks: number;
        overallBytesUploaded: number;
        overallTotalBytes: number;
      }[];
    };

/**
 * A test double: scripts `onOverallProgress` without a worker or a real
 * upload — mirrors `FakeStreamingUploadRunner`'s shape and configurability
 * exactly.
 *
 * - `{ result }` → emits the scripted progress (if any), resolves `result`.
 * - `{ failWith }` → emits the scripted progress (if any), then throws
 *   `failWith`.
 */
export class FakeSplitUploadRunner implements SplitUploadRunner {
  readonly #result?: RunSplitBundleUploadResult;
  readonly #failWith?: string;
  readonly #progress: readonly {
    bundleIndex: number;
    totalBundles: number;
    bundleUploadedChunks: number;
    bundleTotalChunks: number;
    overallBytesUploaded: number;
    overallTotalBytes: number;
  }[];

  constructor(options: FakeSplitUploadRunnerOptions) {
    this.#result = options.result;
    this.#failWith = options.failWith;
    this.#progress = options.progress ?? [];
  }

  async run(
    _params: SplitUploadRunnerParams,
    opts: SplitUploadRunnerOptions,
  ): Promise<RunSplitBundleUploadResult> {
    for (const p of this.#progress) {
      opts.onOverallProgress?.(
        p.bundleIndex,
        p.totalBundles,
        p.bundleUploadedChunks,
        p.bundleTotalChunks,
        p.overallBytesUploaded,
        p.overallTotalBytes,
      );
    }

    if (this.#failWith !== undefined) {
      throw new Error(this.#failWith);
    }
    return this.#result as RunSplitBundleUploadResult;
  }
}

/** Config for {@link createWorkerSplitUploadRunner}: the INJECTED worker factory. */
export interface WorkerSplitUploadRunnerOptions {
  /**
   * Produces the worker the runner drives. INJECTED — never
   * `new Worker(new URL(...))`. The DOM `Worker` type is accepted; the
   * runner reads it through the structural {@link WorkerLike} view so a
   * fake worker in tests satisfies the same seam without a real Web Worker.
   */
  workerFactory: () => Worker;
}

/**
 * The real seam: drives an INJECTED worker and narrows its typed messages.
 *
 * `{ kind: "progress" }` → forwards to `onOverallProgress`; `{ kind: "done" }`
 * → resolves the result; `{ kind: "error" }` → rejects with the message ONLY
 * (mirrors `createWorkerStreamingUploadRunner`'s own JWK-hygiene-style
 * discipline). The worker is terminated once the run settles — on success OR
 * error — exactly like `createWorkerStreamingUploadRunner`'s own `settle`
 * helper.
 */
export function createWorkerSplitUploadRunner(
  options: WorkerSplitUploadRunnerOptions,
): SplitUploadRunner {
  const { workerFactory } = options;

  return {
    run(
      params: SplitUploadRunnerParams,
      opts: SplitUploadRunnerOptions,
    ): Promise<RunSplitBundleUploadResult> {
      // `onOverallProgress` is THIS seam's own callback — never part of the
      // wire protocol the worker itself expects. `pool` is ALSO stripped
      // here — a plain object of FUNCTIONS, which throws a real
      // `DataCloneError` the instant `postMessage` is called with it (the
      // SAME confirmed fact `StreamingUploadRunner.ts`'s own `run` already
      // documents). `pool` is replaced below by `poolEndpoints`.
      const { onOverallProgress, pool, ...restOpts } = opts;
      const poolEndpoints = pool.getHealthSnapshot().map((entry) => entry.endpoint);

      const wireParams: SplitUploadWorkerParams = {
        jwk: params.jwk,
        files: params.files,
        maxRewardWinston: params.maxRewardWinston,
        category: params.category,
        assetType: params.assetType,
        appId: params.appId,
        appVersion: params.appVersion,
        encrypted: params.encrypted,
        encryptorAddress: params.encryptorAddress,
        encryptionVersion: params.encryptionVersion,
        encryptionKey: params.encryptionKey,
      };

      return new Promise<RunSplitBundleUploadResult>((resolve, reject) => {
        // Read the DOM `Worker` through the structural view: the runner only
        // uses the four members `WorkerLike` declares, and `onmessage` is
        // typed to the discriminated `SplitUploadWorkerMsg` boundary (never
        // `any`).
        const worker = workerFactory() as unknown as WorkerLike;

        const settle = (fn: () => void): void => {
          worker.onmessage = null;
          worker.onerror = null;
          worker.terminate();
          fn();
        };

        worker.onmessage = (ev): void => {
          const data = ev.data;
          switch (data.kind) {
            case "progress":
              onOverallProgress?.(
                data.bundleIndex,
                data.totalBundles,
                data.bundleUploadedChunks,
                data.bundleTotalChunks,
                data.overallBytesUploaded,
                data.overallTotalBytes,
              );
              break;
            case "done":
              settle(() => resolve(data.result));
              break;
            case "error":
              settle(() => reject(new Error(data.message)));
              break;
          }
        };

        worker.onerror = (): void => {
          settle(() => reject(new Error("split upload worker errored")));
        };

        const startMsg: SplitUploadWorkerStartMsg = {
          kind: "start",
          params: wireParams,
          opts: { ...restOpts, poolEndpoints },
        };
        worker.postMessage(startMsg);
      });
    },
  };
}
