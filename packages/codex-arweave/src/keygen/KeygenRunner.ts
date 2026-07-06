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

/**
 * Coarse keygen progress — status only. Deliberately carries NO `jwk`/`d`/`n`
 * (or any RSA field): the key never rides the progress channel. `generateKey`
 * has no native percentage, so the states are coarse phases, not a fraction.
 */
export interface KeygenProgress {
  state: "start" | "working" | "done" | "error";
}

/**
 * The typed worker→main message protocol, discriminated on `.kind`. The main
 * thread narrows on `data.kind` — the `MessageEvent.data` boundary is never read
 * as `any`. Only the `done` message carries the JWK; the `error` message carries
 * only a string.
 */
export type KeygenWorkerMsg =
  | { kind: "progress"; state: KeygenProgress }
  | { kind: "done"; jwk: ArweaveJwk }
  | { kind: "error"; message: string };

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
