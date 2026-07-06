/**
 * Keygen SUBPATH barrel for @ancientpantheon/codex-arweave.
 *
 * The off-main-thread keygen seam (E-10, N-10): the `KeygenRunner` interface, the
 * `FakeKeygenRunner` test double, the `createWorkerKeygenRunner` factory (INJECTED
 * workerFactory), and the typed message/progress types. NAMED exports only so the
 * public surface is auditable. The `worker.ts` entry is NOT re-exported here — it
 * is a bundler worker entry, not a library symbol.
 *
 * This is the SINGLE source of truth for `KeygenProgress`/`KeygenRunner`; the
 * panel context re-exports these types (never re-declares them).
 */

export {
  FakeKeygenRunner,
  createWorkerKeygenRunner,
} from "./KeygenRunner.js";
export type {
  KeygenRunner,
  KeygenProgress,
  KeygenWorkerMsg,
  FakeKeygenRunnerOptions,
  WorkerLike,
  WorkerKeygenRunnerOptions,
} from "./KeygenRunner.js";
