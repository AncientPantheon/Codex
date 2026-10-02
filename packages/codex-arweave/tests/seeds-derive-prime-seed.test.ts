// @vitest-environment node
/**
 * `deriveArweaveSeedAtPositionZero` — the Prime Arweave seed auto-derivation
 * primitive (T3 of `docs/work/codex-recovery-backup-tagging/plan.md`), built
 * on `runSeededBatch` (see `docs/work/arweave-seed-restore/design.md`:
 * deriving the Prime seed at index 0 is what makes it possible to
 * auto-install it right after a codex is kickstarted — a LATER task).
 *
 * This is a PURE derivation primitive: it requests index 0, resolves with the
 * single `SeededKey` `runSeededBatch` delivers via `onKey`, and does nothing
 * else — no `ArweaveSeedEntry`, no codex store. Two things can go wrong and
 * both must be honest, never papered over:
 *
 *   - the batch completes with zero keys delivered (e.g. a worker `cancelled`
 *     terminal before any key arrived) — must reject, never hang forever
 *     waiting for a key that will never come;
 *   - the batch errors — must reject with the UNDERLYING error, not a
 *     reworded/generic message that hides what actually failed.
 *
 * NO real Worker and NO real RSA: driven through an INJECTED `workerFactory`
 * returning a fake worker that emits typed `KeygenWorkerMsg` values — the
 * same idiom `e5-seeded-batch.test.ts` uses for `runSeededBatch` itself.
 * `// @vitest-environment node`: message plumbing only, no DOM.
 */

import { describe, it, expect } from "vitest";

import type { KeygenWorkerMsg } from "../src/keygen";
import { deriveArweaveSeedAtPositionZero } from "../src/seeds/derivePrimeSeed";
import { throwawayJwk } from "./e3-helpers";

/** A minimal FAKE `Worker` the test drives message-by-message — mirrors the
 *  `FakeWorker` in `e5-seeded-batch.test.ts` (not a real Web Worker). */
class FakeWorker {
  onmessage: ((ev: { data: KeygenWorkerMsg }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;
  postMessage(msg: unknown): void {
    this.posted.push(msg);
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(data: KeygenWorkerMsg): void {
    this.onmessage?.({ data });
  }
}

/** A 1600-bit stand-in seed — only forwarded to the worker, never inspected. */
const BITS = "1".repeat(1600);

describe("deriveArweaveSeedAtPositionZero", () => {
  it("resolves the single SeededKey delivered at index 0 by a fake worker", async () => {
    const worker = new FakeWorker();

    const result = deriveArweaveSeedAtPositionZero({
      bitstring: BITS,
      workerFactory: () => worker as unknown as Worker,
    });

    worker.emit({ kind: "key", index: 0, jwk: throwawayJwk, address: "address-0" });
    worker.emit({ kind: "batch-done" });

    await expect(result).resolves.toEqual({
      index: 0,
      jwk: throwawayJwk,
      address: "address-0",
    });
    // Requested index 0 explicitly, for clarity — even though the library
    // force-includes it regardless (`planIndexRanges.ts`'s documented behavior).
    expect(worker.posted).toEqual([
      { kind: "start-seeded", bits: BITS, ranges: [{ start: 0, end: 0 }] },
    ]);
  });

  it("rejects with the underlying error when the worker reports a { kind: 'error' } message", async () => {
    const worker = new FakeWorker();

    const result = deriveArweaveSeedAtPositionZero({
      bitstring: BITS,
      workerFactory: () => worker as unknown as Worker,
    });

    worker.emit({ kind: "error", message: "seeded keygen failed in worker" });

    await expect(result).rejects.toThrow(/seeded keygen failed in worker/);
  });

  it("rejects instead of hanging when the batch completes with zero keys delivered", async () => {
    const worker = new FakeWorker();

    const result = deriveArweaveSeedAtPositionZero({
      bitstring: BITS,
      workerFactory: () => worker as unknown as Worker,
    });

    // The batch terminates (e.g. a worker-sent cancellation) before any key
    // ever reached onKey.
    worker.emit({ kind: "cancelled" });

    await expect(result).rejects.toThrow(/no key/i);
  });
});
