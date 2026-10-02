// @vitest-environment node
/**
 * `checkArweaveRestoreEligibility` (T1 of
 * `docs/work/codex-seed-restore-activation/plan.md`) — the eligibility
 * detector: re-derives what the Prime Arweave seed's address WOULD be from
 * the Prime Ouronet account's bitstring (via `deriveArweaveSeedAtPositionZero`)
 * and compares it, case-sensitively, to the actual stored Prime Arweave
 * seed's address. Equal => eligible.
 *
 * NO real Worker and NO real RSA: driven through an INJECTED `workerFactory`
 * returning a fake worker that emits typed `KeygenWorkerMsg` values — mirrors
 * `FakeWorker` in `tests/seeds-derive-prime-seed.test.ts` (itself mirroring
 * `e5-seeded-batch.test.ts`'s convention), not a real Web Worker.
 * `// @vitest-environment node`: message plumbing only, no DOM.
 */

import { describe, it, expect } from "vitest";

import type { KeygenWorkerMsg } from "../src/keygen";
import { checkArweaveRestoreEligibility } from "../src/seeds/checkRestoreEligibility";
import { throwawayJwk } from "./e3-helpers";

/** A minimal FAKE `Worker` the test drives message-by-message — mirrors the
 *  `FakeWorker` in `tests/seeds-derive-prime-seed.test.ts`. */
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

describe("checkArweaveRestoreEligibility", () => {
  it("resolves true when the derived key's address exactly matches primeArweaveAddress", async () => {
    const worker = new FakeWorker();

    const result = checkArweaveRestoreEligibility({
      ouronetBitstring: BITS,
      primeArweaveAddress: "address-0",
      workerFactory: () => worker as unknown as Worker,
    });

    worker.emit({ kind: "key", index: 0, jwk: throwawayJwk, address: "address-0" });
    worker.emit({ kind: "batch-done" });

    await expect(result).resolves.toBe(true);
  });

  it("resolves false when the derived key's address does not match primeArweaveAddress", async () => {
    const worker = new FakeWorker();

    const result = checkArweaveRestoreEligibility({
      ouronetBitstring: BITS,
      primeArweaveAddress: "address-unrelated",
      workerFactory: () => worker as unknown as Worker,
    });

    worker.emit({ kind: "key", index: 0, jwk: throwawayJwk, address: "address-0" });
    worker.emit({ kind: "batch-done" });

    await expect(result).resolves.toBe(false);
  });

  it("resolves false on a case-only mismatch — Arweave addresses are base64url, comparison is case-sensitive", async () => {
    const worker = new FakeWorker();

    const result = checkArweaveRestoreEligibility({
      ouronetBitstring: BITS,
      primeArweaveAddress: "ADDRESS-0",
      workerFactory: () => worker as unknown as Worker,
    });

    worker.emit({ kind: "key", index: 0, jwk: throwawayJwk, address: "address-0" });
    worker.emit({ kind: "batch-done" });

    await expect(result).resolves.toBe(false);
  });

  it("propagates a derivation failure instead of swallowing it into false", async () => {
    const worker = new FakeWorker();

    const result = checkArweaveRestoreEligibility({
      ouronetBitstring: BITS,
      primeArweaveAddress: "address-0",
      workerFactory: () => worker as unknown as Worker,
    });

    worker.emit({ kind: "error", message: "seeded keygen failed in worker" });

    await expect(result).rejects.toThrow(/seeded keygen failed in worker/);
  });
});
