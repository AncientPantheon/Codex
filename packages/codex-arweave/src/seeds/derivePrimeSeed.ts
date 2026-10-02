/**
 * The Prime Arweave seed auto-derivation primitive (T3 of
 * `docs/work/codex-recovery-backup-tagging/plan.md`), built on
 * `runSeededBatch` (`../keygen/KeygenRunner.ts`).
 *
 * `docs/work/arweave-seed-restore/design.md` depends on the Prime Ouronet
 * account and the Prime Arweave seed sharing origin words, so a fresh codex
 * can be made restore-ready by deriving the Prime Arweave seed's #0 key the
 * moment the codex is kickstarted (a LATER task, once this primitive exists).
 *
 * This module is DELIBERATELY thin: it is a pure derivation step, not the
 * storage step. It does not know about `ArweaveSeedEntry`, `isPrime`, or
 * `addArweaveSeed` — building the entry and persisting it belongs to T4, at
 * the layer that actually has access to the codex store.
 */

import { runSeededBatch, type SeededKey } from "../keygen/KeygenRunner.js";

/** Re-exported so a caller can type its `onProgress` without reaching into
 *  `../keygen/KeygenRunner.js` directly. */
export type { KeygenProgress } from "../keygen/KeygenRunner.js";

/** Config for {@link deriveArweaveSeedAtPositionZero}. */
export interface DeriveArweaveSeedAtPositionZeroOptions {
  /** The seed: a validated 1600-bit DALOS bitstring (see `resolveSeedBitString`). */
  bitstring: string;
  /** INJECTED worker factory — never `new Worker(new URL(...))` here. */
  workerFactory: () => Worker;
  /** Coarse phase updates, forwarded from the worker's `progress` messages. */
  onProgress?: (p: import("../keygen/KeygenRunner.js").KeygenProgress) => void;
}

/**
 * Derives the Prime Arweave seed's key at index 0 — its primary address.
 *
 * Requests `ranges: [{ start: 0, end: 0 }]` EXPLICITLY, for clarity, even
 * though `runSeededBatch`'s underlying library force-includes index 0 on
 * every call regardless of `ranges` (`planIndexRanges.ts`'s documented
 * behavior) — this function does not special-case that.
 *
 * Resolves with the single {@link SeededKey} delivered via `onKey`. Rejects
 * with the UNDERLYING error — never a reworded/generic message — if the run
 * errors, and rejects (rather than hanging) if the batch settles having
 * delivered zero keys (e.g. cancelled or aborted before index 0 arrived).
 */
export function deriveArweaveSeedAtPositionZero(
  options: DeriveArweaveSeedAtPositionZeroOptions,
): Promise<SeededKey> {
  const { bitstring, workerFactory, onProgress } = options;

  return new Promise<SeededKey>((resolve, reject) => {
    let key: SeededKey | undefined;

    runSeededBatch({
      bits: bitstring,
      ranges: [{ start: 0, end: 0 }],
      workerFactory,
      onProgress,
      onKey: (delivered) => {
        key = delivered;
      },
    }).then(
      (result) => {
        if (key === undefined) {
          reject(
            new Error(
              `deriveArweaveSeedAtPositionZero: no key delivered (delivered=${result.delivered}, cancelled=${result.cancelled})`,
            ),
          );
          return;
        }
        resolve(key);
      },
      (error: unknown) => {
        // Surface the underlying error verbatim — never rewrapped/reworded.
        reject(error);
      },
    );
  });
}
