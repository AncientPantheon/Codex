/**
 * The off-main-thread keygen SEAM (E-10, N-10).
 *
 * RSA-4096 `generateKey` is expensive and blocks the main thread, so it runs in
 * a Web Worker. The panel consumes an INJECTABLE `KeygenRunner` seam rather than
 * constructing a worker itself, so the create flow is fully testable without a
 * real worker or real RSA-4096: `FakeKeygenRunner` scripts coarse progress and
 * resolves a fixture JWK, and `createWorkerKeygenRunner` takes an INJECTED
 * `workerFactory` (never a hardcoded `new Worker(new URL(...))`).
 *
 * JWK hygiene (N-06): `KeygenProgress` carries ONLY a coarse `state` — never any
 * key field. The worker→main message that carries the JWK is a discrete `done`
 * message; the error branch carries only `message`. No branch here logs or
 * serializes the key.
 */

import type { ArweaveJwk } from "@ancientpantheon/arweave-core";
// TYPE-ONLY, and deliberately so: `import type` is fully erased, so naming the
// library's own progress event here costs the light entry NOTHING at runtime —
// the heavy `@ouronet/dalos-crypto/rsa4096` surface still loads only inside the
// worker's lazy `await import(...)` (E-12). Re-declaring the event locally was
// rejected: a library field rename must break the build, not drift silently.
import type { BatchProgressEvent } from "@ouronet/dalos-crypto/rsa4096";
// TYPE-ONLY: the planner is pure and the seeded run consumes exactly its
// `ranges` shape. Imported from the module (not the `src/seeds` barrel) —
// `planIndexRanges.ts` is deliberately not barrelled.
import type { IndexRange } from "../seeds/planIndexRanges.js";

/**
 * Coarse keygen progress — status only. Deliberately carries NO `jwk`/`d`/`n`
 * (or any RSA field): the key never rides the progress channel. `generateKey`
 * has no native percentage, so the states are coarse phases, not a fraction.
 */
export interface KeygenProgress {
  state: "start" | "working" | "done" | "error";
}

/**
 * The library's RICH seeded-batch progress event, re-exported UNCHANGED so
 * consumers type against one definition.
 *
 * `generateFromBitStringAtRangesAsync` emits one of these after every candidate
 * draw, carrying `index`, `stage` (`'p'`/`'q'`), `attempts`, `overallProgress`
 * (0..1), `completedCount` and `totalCount` — everything a live progress line
 * needs. It is forwarded VERBATIM across the worker boundary (see
 * `{ kind: "batch-progress" }`); flattening it to {@link KeygenProgress} is what
 * the coarse channel is for, and the two never substitute for each other.
 *
 * JWK hygiene (N-06) still holds: the event is purely observational counters —
 * it carries no key field, and the library computes it without reading the seed
 * stream.
 */
export type { BatchProgressEvent };

/**
 * The typed worker→main message protocol, discriminated on `.kind`. The main
 * thread narrows on `data.kind` — the `MessageEvent.data` boundary is never read
 * as `any`. Only the `done` message carries the JWK; the `error` message carries
 * only a string.
 */
export type KeygenWorkerMsg =
  | { kind: "progress"; state: KeygenProgress }
  | { kind: "done"; jwk: ArweaveJwk }
  | { kind: "error"; message: string }
  /**
   * SEEDED batch: one generated key, posted the moment its (~6.7 s) prime
   * search finishes — never batched up. `index` is the position within THIS
   * seed's own index space.
   */
  | { kind: "key"; index: number; jwk: ArweaveJwk; address: string }
  /**
   * SEEDED batch: the library's own {@link BatchProgressEvent}, forwarded RAW —
   * not summarised, not renamed, not flattened. This is the ONLY channel that
   * can move a real progress line: at ~6.7 s per key the coarse `working` state
   * is a single unchanging value for the entire run, whereas this fires per
   * candidate draw with the index, the `p`/`q` stage, the attempt count and the
   * whole-batch 0..1 fraction. Mirrors the shipped Crypto Lab worker, which
   * posts `{ type: 'progress', ev }` with the event untouched.
   */
  | { kind: "batch-progress"; ev: BatchProgressEvent }
  /** SEEDED batch terminal: every requested index finished. Carries no key
   *  material — each key already crossed on its own `key` message. */
  | { kind: "batch-done" }
  /** SEEDED batch terminal: the run stopped early. Keys already posted stand. */
  | { kind: "cancelled" };

/**
 * The injectable off-main-thread keygen seam. Emits coarse progress via
 * `onProgress`, then resolves the generated JWK (or rejects on failure). A fake
 * resolves synchronously; the real impl drives a worker.
 */
export interface KeygenRunner {
  runKeygen(onProgress: (p: KeygenProgress) => void): Promise<ArweaveJwk>;
}

/** Config for {@link FakeKeygenRunner}: either resolve with `jwk` or reject with `failWith`. */
export type FakeKeygenRunnerOptions =
  | { jwk: ArweaveJwk; failWith?: undefined }
  | { failWith: string; jwk?: undefined };

/**
 * A test double: scripts coarse progress without a worker or real RSA-4096.
 *
 * - `{ jwk }`  → emits `working` then `done`, resolves the injected JWK.
 * - `{ failWith }` → emits `error`, rejects with the given message (no JWK).
 */
export class FakeKeygenRunner implements KeygenRunner {
  readonly #jwk?: ArweaveJwk;
  readonly #failWith?: string;

  constructor(options: FakeKeygenRunnerOptions) {
    this.#jwk = options.jwk;
    this.#failWith = options.failWith;
  }

  async runKeygen(
    onProgress: (p: KeygenProgress) => void,
  ): Promise<ArweaveJwk> {
    if (this.#failWith !== undefined) {
      onProgress({ state: "error" });
      throw new Error(this.#failWith);
    }
    onProgress({ state: "working" });
    onProgress({ state: "done" });
    return this.#jwk as ArweaveJwk;
  }
}

/**
 * A structural Worker surface — exactly the members the runner drives. Typed
 * locally so the seam does not depend on the DOM `Worker` lib beyond what it
 * uses, and so an injected fake worker satisfies it.
 */
export interface WorkerLike {
  onmessage: ((ev: { data: KeygenWorkerMsg }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  postMessage(msg: unknown): void;
  terminate(): void;
}

/** Config for {@link createWorkerKeygenRunner}: the INJECTED worker factory. */
export interface WorkerKeygenRunnerOptions {
  /**
   * Produces the worker the runner drives. INJECTED — never
   * `new Worker(new URL(...))`. The DOM `Worker` type is accepted; the runner
   * reads it through the structural {@link WorkerLike} view so a fake worker in
   * tests satisfies the same seam without a real Web Worker.
   */
  workerFactory: () => Worker;
}

/**
 * The real seam: drives an INJECTED worker and narrows its typed messages.
 *
 * `{ kind: "progress" }` → forwards the coarse state to `onProgress`;
 * `{ kind: "done" }` → resolves the JWK; `{ kind: "error" }` → rejects with the
 * message ONLY (no key material). The worker is terminated once the run settles.
 */
export function createWorkerKeygenRunner(
  options: WorkerKeygenRunnerOptions,
): KeygenRunner {
  const { workerFactory } = options;

  return {
    runKeygen(onProgress: (p: KeygenProgress) => void): Promise<ArweaveJwk> {
      return new Promise<ArweaveJwk>((resolve, reject) => {
        // Read the DOM `Worker` through the structural view: the runner only uses
        // the four members `WorkerLike` declares, and the `onmessage` handler is
        // typed to the discriminated `KeygenWorkerMsg` boundary (never `any`).
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
              onProgress(data.state);
              break;
            case "done":
              settle(() => resolve(data.jwk));
              break;
            case "error":
              settle(() => reject(new Error(data.message)));
              break;
          }
        };

        worker.onerror = (): void => {
          settle(() => reject(new Error("keygen worker errored")));
        };

        worker.postMessage({ kind: "start" });
      });
    },
  };
}

/**
 * One generated key as it leaves the seeded batch. `index` is its position in
 * the SEED's own index space (`#0` is per-seed, not global), and `address` is
 * the deterministic Arweave address the library already derived — the caller
 * never has to re-derive it.
 */
export interface SeededKey {
  index: number;
  jwk: ArweaveJwk;
  address: string;
}

/** How a seeded run ended: how many keys reached `onKey`, and whether it was cut short. */
export interface SeededBatchResult {
  /** Keys handed to `onKey`. Counted at DELIVERY, so a cancelled run reports what it kept. */
  delivered: number;
  /** True when the run stopped before its terminal (aborted `signal`, or a worker `cancelled`). */
  cancelled: boolean;
}

/** Config for {@link runSeededBatch}. */
export interface RunSeededBatchOptions {
  /** The seed: a validated 1600-bit DALOS bitstring (see `resolveSeedBitString`). */
  bits: string;
  /** The indices to generate, as planned by `planIndexRanges`. */
  ranges: readonly IndexRange[];
  /** INJECTED worker factory — never `new Worker(new URL(...))` here. */
  workerFactory: () => Worker;
  /**
   * Called for EVERY key the worker posts, as it arrives.
   *
   * Two consequences, both deliberate. First, nothing is buffered until the end:
   * at ~6.7 s per key a 100-position run is ~11 minutes, so a cancel or a closed
   * tab must keep everything already finished. Second, index 0 is handed over
   * like any other index — `rsa4096/ranges.js` force-generates it on every call
   * (`const seen = new Set([0])`) whatever `ranges` says, so the never-clobber
   * decision belongs to the CALLER at the storage step, not here.
   */
  onKey: (key: SeededKey) => void;
  /** Coarse phase updates, forwarded from the worker's `progress` messages. */
  onProgress?: (p: KeygenProgress) => void;
  /**
   * RICH per-draw progress: the library's {@link BatchProgressEvent} exactly as
   * it was emitted. OPTIONAL and independent of `onProgress` — a caller that
   * only needs the run's phase omits it and pays nothing, while a caller
   * rendering a live progress line reads `index` / `stage` / `attempts` /
   * `overallProgress` / `completedCount` / `totalCount` off it directly.
   */
  onBatchProgress?: (ev: BatchProgressEvent) => void;
  /** Aborts the run: delivery stops and the worker is terminated. */
  signal?: AbortSignal;
}

/**
 * Runs a SEEDED batch off the main thread: drives an INJECTED worker over
 * `bits` + `ranges` and streams each generated key to `onKey`.
 *
 * Settles once — resolving with a {@link SeededBatchResult} on `batch-done`, on
 * `cancelled`, or on an aborted `signal`; rejecting on `error` or a worker-level
 * failure. Keys delivered before a cancel or a rejection are NEVER retracted:
 * they cost multiple seconds of CPU each and the caller has already stored them.
 */
export function runSeededBatch(
  options: RunSeededBatchOptions,
): Promise<SeededBatchResult> {
  const {
    bits,
    ranges,
    workerFactory,
    onKey,
    onProgress,
    onBatchProgress,
    signal,
  } = options;

  return new Promise<SeededBatchResult>((resolve, reject) => {
    let delivered = 0;

    // Already cancelled before we started: never construct the worker, so no
    // multi-second prime search is paid for a run the user has abandoned.
    if (signal?.aborted === true) {
      resolve({ delivered, cancelled: true });
      return;
    }

    const worker = workerFactory() as unknown as WorkerLike;

    const settle = (fn: () => void): void => {
      worker.onmessage = null;
      worker.onerror = null;
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      fn();
    };

    function onAbort(): void {
      // Terminating is the hard stop — the library has no cancel hook, so the
      // worker is told AND killed. Delivery ceases; delivered keys stand.
      worker.postMessage({ kind: "cancel" });
      settle(() => resolve({ delivered, cancelled: true }));
    }

    signal?.addEventListener("abort", onAbort);

    worker.onmessage = (ev): void => {
      const data = ev.data;
      switch (data.kind) {
        case "progress":
          onProgress?.(data.state);
          break;
        case "batch-progress":
          // Forwarded VERBATIM — the runner adds nothing and drops nothing, so
          // the UI sees exactly what the library reported. Optional-chained:
          // every caller predating this channel omits `onBatchProgress`, and a
          // throw here would abort a run mid-batch.
          onBatchProgress?.(data.ev);
          break;
        case "key":
          delivered += 1;
          onKey({ index: data.index, jwk: data.jwk, address: data.address });
          break;
        case "batch-done":
          settle(() => resolve({ delivered, cancelled: false }));
          break;
        case "cancelled":
          settle(() => resolve({ delivered, cancelled: true }));
          break;
        case "error":
          settle(() => reject(new Error(data.message)));
          break;
        case "done":
          // The RANDOM path's terminal — not part of a seeded run.
          break;
      }
    };

    worker.onerror = (): void => {
      settle(() => reject(new Error("seeded keygen worker errored")));
    };

    worker.postMessage({ kind: "start-seeded", bits, ranges });
  });
}
