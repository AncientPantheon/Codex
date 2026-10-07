/**
 * The main-thread OPFS-streaming-support-probe SEAM
 * (`arweave-streaming-ui-support-probe-worker`).
 *
 * Mirrors `StreamingDryRunRunner.ts`'s pattern exactly, trimmed to what a
 * single yes/no support check needs: a `WorkerLike` structural interface, an
 * INJECTABLE `workerFactory: () => Worker` option (never a hardcoded
 * `new Worker(new URL(...))`), a shared `SupportProbeRunner` interface, and
 * both a real (`createWorkerSupportProbeRunner`) and fake
 * (`FakeSupportProbeRunner`) implementation — so `realArweaveAdapter.ts`'s
 * wiring (and, eventually, `UploadWizard`'s own `isStreamingUploadSupported`
 * prop) is fully testable without a real Worker, and this seam itself is
 * fully testable without a real browser.
 *
 * `SupportProbeWorkerMsg` is imported TYPE-ONLY from the real
 * `supportProbeWorker.ts` — erased at compile time, so this module never
 * actually loads (or executes the worker-global side effects of) that file
 * at runtime; it only narrows the SAME message protocol it posts.
 *
 * Lifecycle: `check()` spins up a FRESH worker (via the injected factory),
 * posts ONE `{ kind: "check" }` message, resolves the single `boolean` the
 * worker's `{ kind: "result" }` reply carries, and terminates the worker
 * immediately — never left running idle. A caller that calls `check()`
 * again later gets a second, independently spun-up-and-torn-down worker,
 * exactly mirroring `createWorkerStreamingDryRunRunner`'s own "fresh worker
 * per `.run()` call" convention.
 */

import type { SupportProbeWorkerMsg } from "./supportProbeWorker.js";

/**
 * The injectable off-main-thread support-probe seam. Resolves `true` when
 * streaming uploads are genuinely supported in this browser context, `false`
 * otherwise. A fake resolves synchronously/deterministically; the real
 * implementation drives a Worker.
 */
export interface SupportProbeRunner {
  check(): Promise<boolean>;
}

/** Config for {@link FakeSupportProbeRunner}: the scripted boolean it
 *  resolves with — mirrors `FakeStreamingDryRunRunner`'s own `{ result }`
 *  shape, simplified (a probe never fails: `isStreamingUploadSupported`'s
 *  own doc comment states it "never throws", every failure path already
 *  folds into `false`). */
export interface FakeSupportProbeRunnerOptions {
  supported: boolean;
}

/**
 * A test double: resolves deterministically without a worker or a real
 * probe — mirrors `FakeStreamingDryRunRunner`'s shape and configurability.
 */
export class FakeSupportProbeRunner implements SupportProbeRunner {
  readonly #supported: boolean;

  constructor(options: FakeSupportProbeRunnerOptions) {
    this.#supported = options.supported;
  }

  async check(): Promise<boolean> {
    return this.#supported;
  }
}

/**
 * A structural Worker surface — exactly the members this runner drives.
 * Typed locally (mirrors `StreamingDryRunRunner.ts`'s own `WorkerLike`) so
 * the seam does not depend on the DOM `Worker` lib beyond what it uses, and
 * so an injected fake worker satisfies it in tests.
 */
export interface WorkerLike {
  onmessage: ((ev: { data: SupportProbeWorkerMsg }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  postMessage(msg: unknown): void;
  terminate(): void;
}

/** Config for {@link createWorkerSupportProbeRunner}: the INJECTED worker factory. */
export interface WorkerSupportProbeRunnerOptions {
  /**
   * Produces the worker the runner drives. INJECTED — never
   * `new Worker(new URL(...))`. The DOM `Worker` type is accepted; the runner
   * reads it through the structural {@link WorkerLike} view so a fake worker
   * in tests satisfies the same seam without a real Web Worker. Called ONCE
   * per `check()` — see this module's own doc comment for why a fresh worker
   * is spun up (and torn down) per check.
   */
  workerFactory: () => Worker;
}

/**
 * The real seam: drives an INJECTED worker and narrows its typed messages.
 *
 * `{ kind: "result" }` → resolves `supported`. The worker is terminated once
 * the check settles — mirrors `createWorkerStreamingDryRunRunner`'s own
 * `settle` helper. An `onerror` (the worker itself throwing, rather than the
 * probe resolving `false`) rejects — a genuine Worker-construction/runtime
 * failure must surface distinctly from a normal "not supported" answer, so a
 * caller that only knows how to interpret `true`/`false` never silently
 * treats a broken Worker as "unsupported".
 */
export function createWorkerSupportProbeRunner(
  options: WorkerSupportProbeRunnerOptions,
): SupportProbeRunner {
  const { workerFactory } = options;

  return {
    check(): Promise<boolean> {
      return new Promise<boolean>((resolve, reject) => {
        // Read the DOM `Worker` through the structural view: the runner only
        // uses the four members `WorkerLike` declares, and `onmessage` is
        // typed to the discriminated `SupportProbeWorkerMsg` boundary
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
          if (data.kind === "result") {
            settle(() => resolve(data.supported));
          }
        };

        worker.onerror = (): void => {
          settle(() => reject(new Error("support probe worker errored")));
        };

        worker.postMessage({ kind: "check" });
      });
    },
  };
}
