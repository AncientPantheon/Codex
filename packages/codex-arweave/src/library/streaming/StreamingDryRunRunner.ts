/**
 * The main-thread dry-run-upload SEAM (`arweave-upload-dry-run` T3 — a SCOPE
 * DEVIATION from this task's own `- files:` list; see `dryRunWorker.ts`'s own
 * doc comment for the real-browser finding that made this necessary).
 *
 * Mirrors `StreamingUploadRunner.ts`'s pattern exactly, trimmed to what a dry
 * run needs: a `WorkerLike` structural interface, an INJECTABLE
 * `workerFactory: () => Worker` option (never a hardcoded `new Worker(new
 * URL(...))`), a shared `StreamingDryRunRunner` interface, and both a real
 * (`createWorkerStreamingDryRunRunner`) and fake (`FakeStreamingDryRunRunner`)
 * implementation — so `realArweaveAdapter.ts`'s `runDryRunUpload` wiring is
 * fully testable without a real Worker, and this seam itself is fully
 * testable without a real browser.
 *
 * `StreamingDryRunWorkerMsg`/`StreamingDryRunWorkerStartMsg`/
 * `StreamingDryRunWorkerStartOpts` are imported TYPE-ONLY from the real
 * `dryRunWorker.ts` — erased at compile time, so this module never actually
 * loads (or executes the worker-global side effects of) that file at
 * runtime; it only narrows the SAME message protocol it posts.
 */

import type {
  StreamingDryRunWorkerMsg,
  StreamingDryRunWorkerStartMsg,
} from "./dryRunWorker.js";
import type { UploadAndTrackParams } from "../flow.js";
import type { DryRunResult } from "./dryRunUpload.js";
import type { GatewayPool } from "@ancientpantheon/arweave-core";

/** Options for {@link StreamingDryRunRunner.run} — the one thing a dry run
 *  needs on the main thread that cannot default inside the Worker: the
 *  `GatewayPool` whose configured endpoints the Worker reconstructs its own
 *  fresh pool from (see `dryRunWorker.ts`'s own `poolEndpoints` doc
 *  comment). `decryptionKey` mirrors `RunUploadDryRunOptions.decryptionKey`
 *  verbatim — see that field's own doc comment for why it exists. */
export interface StreamingDryRunRunnerOptions {
  pool: GatewayPool;
  decryptionKey?: CryptoKey;
}

/**
 * The injectable off-main-thread dry-run-upload seam. Resolves with the same
 * {@link DryRunResult} `runUploadDryRun` itself would resolve with. A fake
 * resolves synchronously/deterministically; the real implementation drives a
 * Worker.
 */
export interface StreamingDryRunRunner {
  run(
    params: UploadAndTrackParams,
    resolvedKey: CryptoKey | undefined,
    opts: StreamingDryRunRunnerOptions,
  ): Promise<DryRunResult>;
}

/** Config for {@link FakeStreamingDryRunRunner}: either resolve with
 *  `result`, or reject with `failWith` — mirrors
 *  `FakeStreamingUploadRunnerOptions`'s own `{ result } | { failWith }`
 *  shape (minus the scripted `route`/`progress`, which a dry run has no
 *  equivalent of — its own progress-shaped fields live INSIDE the one
 *  resolved `DryRunResult`). */
export type FakeStreamingDryRunRunnerOptions =
  | { result: DryRunResult; failWith?: undefined }
  | { failWith: string; result?: undefined };

/**
 * A test double: resolves/rejects deterministically without a worker or a
 * real dry run — mirrors `FakeStreamingUploadRunner`'s shape and
 * configurability.
 */
export class FakeStreamingDryRunRunner implements StreamingDryRunRunner {
  readonly #result?: DryRunResult;
  readonly #failWith?: string;

  constructor(options: FakeStreamingDryRunRunnerOptions) {
    this.#result = options.result;
    this.#failWith = options.failWith;
  }

  async run(
    _params: UploadAndTrackParams,
    _resolvedKey: CryptoKey | undefined,
    _opts: StreamingDryRunRunnerOptions,
  ): Promise<DryRunResult> {
    if (this.#failWith !== undefined) {
      throw new Error(this.#failWith);
    }
    return this.#result as DryRunResult;
  }
}

/**
 * A structural Worker surface — exactly the members this runner drives.
 * Typed locally (mirrors `StreamingUploadRunner.ts`'s own `WorkerLike`) so
 * the seam does not depend on the DOM `Worker` lib beyond what it uses, and
 * so an injected fake worker satisfies it in tests.
 */
export interface WorkerLike {
  onmessage: ((ev: { data: StreamingDryRunWorkerMsg }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  postMessage(msg: unknown): void;
  terminate(): void;
}

/** Config for {@link createWorkerStreamingDryRunRunner}: the INJECTED worker factory. */
export interface WorkerStreamingDryRunRunnerOptions {
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
 * `{ kind: "done" }` → resolves the result; `{ kind: "error" }` → rejects
 * with the message ONLY (mirrors `createWorkerStreamingUploadRunner`'s own
 * JWK-hygiene-style discipline). The worker is terminated once the run
 * settles — on success OR error.
 */
export function createWorkerStreamingDryRunRunner(
  options: WorkerStreamingDryRunRunnerOptions,
): StreamingDryRunRunner {
  const { workerFactory } = options;

  return {
    run(
      params: UploadAndTrackParams,
      resolvedKey: CryptoKey | undefined,
      opts: StreamingDryRunRunnerOptions,
    ): Promise<DryRunResult> {
      // `pool` is THIS seam's own main-thread value — stripped here and
      // replaced by `poolEndpoints` (its own configured endpoint URLs, plain
      // cloneable strings), from which the Worker reconstructs its OWN fresh
      // pool. Mirrors `createWorkerStreamingUploadRunner`'s identical
      // treatment of its own `pool` option, for the identical
      // "functions are never structured-cloneable" reason.
      const { pool, decryptionKey } = opts;
      const poolEndpoints = pool.getHealthSnapshot().map((entry) => entry.endpoint);

      return new Promise<DryRunResult>((resolve, reject) => {
        // Read the DOM `Worker` through the structural view: the runner only
        // uses the four members `WorkerLike` declares, and `onmessage` is
        // typed to the discriminated `StreamingDryRunWorkerMsg` boundary
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
            case "done":
              settle(() => resolve(data.result));
              break;
            case "error":
              settle(() => reject(new Error(data.message)));
              break;
          }
        };

        worker.onerror = (): void => {
          settle(() => reject(new Error("dry-run upload worker errored")));
        };

        const startMsg: StreamingDryRunWorkerStartMsg = {
          kind: "start",
          params,
          resolvedKey,
          ...(decryptionKey !== undefined ? { decryptionKey } : {}),
          opts: { poolEndpoints },
        };
        worker.postMessage(startMsg);
      });
    },
  };
}
