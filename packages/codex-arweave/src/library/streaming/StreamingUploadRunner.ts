/**
 * The main-thread streaming-upload SEAM (`arweave-streaming-worker-wiring`
 * T2).
 *
 * Mirrors `keygen/KeygenRunner.ts`'s pattern exactly (that file's own doc
 * comment states the rationale this seam reuses verbatim): a `WorkerLike`
 * structural interface, an INJECTABLE `workerFactory: () => Worker` option
 * (never a hardcoded `new Worker(new URL(...))`), a shared `StreamingUploadRunner`
 * interface, and both a real (`createWorkerStreamingUploadRunner`) and fake
 * (`FakeStreamingUploadRunner`) implementation — so `UploadWizard` (T3) is
 * fully testable without a real Worker, and this seam itself is fully
 * testable without a real browser.
 *
 * `StreamingUploadWorkerMsg`/`StreamingUploadWorkerStartMsg`/
 * `StreamingUploadWorkerOpts` are imported TYPE-ONLY from T1's
 * `uploadWorker.ts` — erased at compile time, so this module never actually
 * loads (or executes the worker-global side effects of) that file at
 * runtime; it only narrows the SAME message protocol T1's real worker posts.
 *
 * `run`'s `opts` is `StreamingUploadRunnerOptions` — T1's own
 * `StreamingUploadWorkerOpts` (the `store`/`pool`/etc. `performUploadAndTrack`
 * requires, EXACTLY what the worker's `{ kind: "start" }` message carries)
 * PLUS this seam's two own callbacks, `onRoute`/`onProgress`. `store`/`pool`
 * are REQUIRED there (mirroring `PerformUploadAndTrackOptions`'s own
 * requirement) — the real worker genuinely cannot run an upload without
 * them, so making the whole bag optional would let a caller silently drop a
 * requirement the worker will reject anyway. The real runner strips
 * `onRoute`/`onProgress` back off before posting — they are THIS seam's own
 * callbacks, not part of the wire protocol — and reconstructs them from the
 * worker's own `route`/`progress` messages as they arrive.
 */

import type {
  StreamingUploadWorkerMsg,
  StreamingUploadWorkerOpts,
  StreamingUploadWorkerStartMsg,
} from "./uploadWorker.js";
// TYPE-ONLY, and deliberately so: erased at compile time, so naming these
// here costs this seam nothing at runtime — mirrors `KeygenRunner.ts`'s own
// `ArweaveJwk`/`BatchProgressEvent` type-only imports for the identical
// reason.
import type { UploadAndTrackParams, UploadAndTrackResult } from "../flow.js";

/**
 * Options for {@link StreamingUploadRunner.run} — T1's own
 * `StreamingUploadWorkerOpts` (the exact `opts` the worker's `{ kind: "start" }`
 * message carries) plus this seam's two callbacks. `onRoute` fires once,
 * synchronously, the moment the worker posts its `route` message (BEFORE
 * the upload itself proceeds); `onProgress` fires for every `progress`
 * message the worker posts (never on the fallback path, exactly like
 * `UploadAndTrackOptions.onProgress`'s own contract).
 */
export interface StreamingUploadRunnerOptions extends StreamingUploadWorkerOpts {
  /** Fired once with the worker's routing decision — mirrors
   *  `UploadAndTrackOptions.onUploadRouteDecided`'s own timing/contract,
   *  now driven by a cross-Worker message instead of a same-thread call. */
  onRoute?: (route: "streaming" | "fallback") => void;
  /** Fired for every chunk-progress tick the worker posts — mirrors
   *  `UploadAndTrackOptions.onProgress`'s own contract. */
  onProgress?: (uploadedChunks: number, totalChunks: number) => void;
}

/**
 * The injectable off-main-thread streaming-upload seam. Resolves with the
 * same {@link UploadAndTrackResult} `performUploadAndTrack` itself would
 * resolve with (or rejects on failure), while emitting `onRoute`/`onProgress`
 * as the run proceeds. A fake resolves synchronously/deterministically; the
 * real implementation drives a Worker.
 */
export interface StreamingUploadRunner {
  run(
    params: UploadAndTrackParams,
    resolvedKey: CryptoKey | undefined,
    opts: StreamingUploadRunnerOptions,
  ): Promise<UploadAndTrackResult>;
}

/** Config for {@link FakeStreamingUploadRunner}: either resolve with `result`
 *  (optionally first emitting a scripted `route` and/or `progress` sequence),
 *  or reject with `failWith` (after emitting the SAME scripted `route`/
 *  `progress`, if any — mirrors a real run that fails partway through) —
 *  mirrors `FakeKeygenRunnerOptions`'s own `{ jwk } | { failWith }` shape. */
export type FakeStreamingUploadRunnerOptions =
  | {
      result: UploadAndTrackResult;
      failWith?: undefined;
      route?: "streaming" | "fallback";
      progress?: readonly { uploadedChunks: number; totalChunks: number }[];
    }
  | {
      failWith: string;
      result?: undefined;
      route?: "streaming" | "fallback";
      progress?: readonly { uploadedChunks: number; totalChunks: number }[];
    };

/**
 * A test double: scripts `onRoute`/`onProgress` without a worker or a real
 * upload, for `UploadWizard`'s own tests — mirrors `FakeKeygenRunner`'s
 * shape and configurability exactly.
 *
 * - `{ result }` → emits the scripted `route`/`progress` (if any), resolves
 *   `result`.
 * - `{ failWith }` → emits the scripted `route`/`progress` (if any), then
 *   throws `failWith`.
 */
export class FakeStreamingUploadRunner implements StreamingUploadRunner {
  readonly #result?: UploadAndTrackResult;
  readonly #failWith?: string;
  readonly #route?: "streaming" | "fallback";
  readonly #progress: readonly { uploadedChunks: number; totalChunks: number }[];

  constructor(options: FakeStreamingUploadRunnerOptions) {
    this.#result = options.result;
    this.#failWith = options.failWith;
    this.#route = options.route;
    this.#progress = options.progress ?? [];
  }

  async run(
    _params: UploadAndTrackParams,
    _resolvedKey: CryptoKey | undefined,
    opts: StreamingUploadRunnerOptions,
  ): Promise<UploadAndTrackResult> {
    if (this.#route !== undefined) opts.onRoute?.(this.#route);
    for (const p of this.#progress) opts.onProgress?.(p.uploadedChunks, p.totalChunks);

    if (this.#failWith !== undefined) {
      throw new Error(this.#failWith);
    }
    return this.#result as UploadAndTrackResult;
  }
}

/**
 * A structural Worker surface — exactly the members this runner drives.
 * Typed locally (mirrors `KeygenRunner.ts`'s own `WorkerLike`) so the seam
 * does not depend on the DOM `Worker` lib beyond what it uses, and so an
 * injected fake worker satisfies it in tests.
 */
export interface WorkerLike {
  onmessage: ((ev: { data: StreamingUploadWorkerMsg }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  postMessage(msg: unknown): void;
  terminate(): void;
}

/** Config for {@link createWorkerStreamingUploadRunner}: the INJECTED worker factory. */
export interface WorkerStreamingUploadRunnerOptions {
  /**
   * Produces the worker the runner drives. INJECTED — never
   * `new Worker(new URL(...))`. The DOM `Worker` type is accepted; the runner
   * reads it through the structural {@link WorkerLike} view so a fake worker
   * in tests satisfies the same seam without a real Web Worker.
   */
  workerFactory: () => Worker;
}

/**
 * The real seam: drives an INJECTED worker and narrows its typed messages.
 *
 * `{ kind: "route" }` → forwards to `onRoute`; `{ kind: "progress" }` →
 * forwards to `onProgress`; `{ kind: "done" }` → resolves the result;
 * `{ kind: "error" }` → rejects with the message ONLY (mirrors
 * `createWorkerKeygenRunner`'s own JWK-hygiene-style discipline of never
 * forwarding more than the message string). The worker is terminated once
 * the run settles — on success OR error — exactly like
 * `createWorkerKeygenRunner`'s own `settle` helper.
 */
export function createWorkerStreamingUploadRunner(
  options: WorkerStreamingUploadRunnerOptions,
): StreamingUploadRunner {
  const { workerFactory } = options;

  return {
    run(
      params: UploadAndTrackParams,
      resolvedKey: CryptoKey | undefined,
      opts: StreamingUploadRunnerOptions,
    ): Promise<UploadAndTrackResult> {
      // `onRoute`/`onProgress` are THIS seam's own callbacks — never part of
      // the wire protocol the worker itself expects. `pool`/`store` are ALSO
      // stripped here — confirmed, the hard way (this sub-topic's own T4
      // real-browser check): both are plain objects of FUNCTIONS
      // (`GatewayPool.execute`/`LibraryStore.append` et al), which throw a
      // real `DataCloneError` the instant `postMessage` is called with them.
      // `pool` is replaced below by `poolEndpoints` (its own configured
      // endpoint URLs — plain, cloneable strings), from which the Worker
      // reconstructs its OWN fresh pool; `store` is dropped entirely — the
      // Worker instead proxies its one real call (`append`) back to THIS
      // `store`, below, via the `appendLibraryEntry`/
      // `appendLibraryEntryResult` message pair (see `uploadWorker.ts`'s own
      // `StreamingUploadWorkerStartOpts` doc comment for the full reasoning).
      const { onRoute, onProgress, pool, store, ...rest } = opts;
      const poolEndpoints = pool.getHealthSnapshot().map((entry) => entry.endpoint);

      return new Promise<UploadAndTrackResult>((resolve, reject) => {
        // Read the DOM `Worker` through the structural view: the runner only
        // uses the four members `WorkerLike` declares, and `onmessage` is
        // typed to the discriminated `StreamingUploadWorkerMsg` boundary
        // (never `any`).
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
            case "route":
              onRoute?.(data.route);
              break;
            case "progress":
              onProgress?.(data.uploadedChunks, data.totalChunks);
              break;
            case "appendLibraryEntry":
              // Proxies the Worker's own `store.append(entry)` call onto
              // THIS runner's real `store` — see this method's own comment
              // above for why `store` could never cross into the Worker
              // directly in the first place.
              store.append(data.entry).then(
                () => worker.postMessage({ kind: "appendLibraryEntryResult", requestId: data.requestId, ok: true }),
                (err: unknown) =>
                  worker.postMessage({
                    kind: "appendLibraryEntryResult",
                    requestId: data.requestId,
                    ok: false,
                    message: err instanceof Error ? err.message : String(err),
                  }),
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
          settle(() => reject(new Error("streaming upload worker errored")));
        };

        const startMsg: StreamingUploadWorkerStartMsg = {
          kind: "start",
          params,
          resolvedKey,
          opts: { ...rest, poolEndpoints },
        };
        worker.postMessage(startMsg);
      });
    },
  };
}
