// @vitest-environment node
/**
 * `arweave-streaming-ui-support-probe-worker` — the main-thread
 * `SupportProbeRunner` seam.
 *
 * `UploadWizard.tsx`'s own `isStreamingUploadSupported` prop calls T1's
 * `isStreamingUploadSupported()` directly on the main document thread — but
 * that probe internally calls `FileSystemFileHandle.createSyncAccessHandle()`,
 * which, by spec, only works inside a dedicated Worker; called on the main
 * thread it always throws internally and the probe always resolves `false`,
 * regardless of genuine browser capability (see this sub-topic's own
 * bug-report.md). This seam fixes that the SAME way
 * `arweave-streaming-worker-wiring`/`arweave-upload-dry-run` already fixed
 * the identical problem for the real-upload and dry-run call sites: run the
 * probe inside a real Worker, and talk to it over postMessage.
 *
 * Mirrors `streaming-dry-run-runner.test.ts`'s own convention exactly: the
 * real worker-backed runner is driven through a hand-built `FakeWorker` (a
 * `WorkerLike` stand-in) returned by an INJECTED `workerFactory` — never a
 * real Web Worker — and the test drives the fake's `onmessage` with typed
 * `SupportProbeWorkerMsg` values exactly as the real `supportProbeWorker.ts`
 * would post them (`result`).
 *
 * WHY THIS TEST MATTERS: without it, a regression that posts the wrong
 * message shape, forgets to terminate the worker once the check settles, or
 * silently swaps `true`/`false` would only surface as a mystery "browser
 * doesn't support this" banner in a real, genuinely-capable browser — this
 * test pins the exact message lifecycle and worker-cleanup contract
 * `realArweaveAdapter.ts`'s wiring depends on.
 *
 * RED: `../src/library/streaming/SupportProbeRunner.js` does not exist yet —
 * every import below fails to resolve.
 */

import { describe, it, expect, vi } from "vitest";

import {
  createWorkerSupportProbeRunner,
  FakeSupportProbeRunner,
  type SupportProbeRunner,
  type WorkerLike,
} from "../src/library/streaming/SupportProbeRunner.js";
import type { SupportProbeWorkerMsg } from "../src/library/streaming/supportProbeWorker.js";

/** A minimal FAKE `Worker`: records `postMessage` calls and lets the test
 *  drive `onmessage` with a typed `SupportProbeWorkerMsg`. */
class FakeWorker {
  onmessage: ((ev: { data: SupportProbeWorkerMsg }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;
  postMessage(msg: unknown): void {
    this.posted.push(msg);
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(data: SupportProbeWorkerMsg): void {
    this.onmessage?.({ data });
  }
}

describe("createWorkerSupportProbeRunner — injected workerFactory + full message lifecycle", () => {
  it("resolves true when the worker posts { kind: 'result', supported: true }", async () => {
    const worker = new FakeWorker();
    const workerFactory = vi.fn(() => worker as unknown as Worker);
    const runner = createWorkerSupportProbeRunner({ workerFactory });

    const done = runner.check();

    // The runner obtained its worker THROUGH the injected factory, not a
    // hardcoded `new Worker(...)`.
    expect(workerFactory).toHaveBeenCalledTimes(1);

    worker.emit({ kind: "result", supported: true });
    await expect(done).resolves.toBe(true);
  });

  it("resolves false when the worker posts { kind: 'result', supported: false }", async () => {
    const worker = new FakeWorker();
    const runner = createWorkerSupportProbeRunner({
      workerFactory: () => worker as unknown as Worker,
    });

    const done = runner.check();
    worker.emit({ kind: "result", supported: false });

    await expect(done).resolves.toBe(false);
  });

  it("posts a { kind: 'check' } message to the worker", async () => {
    const worker = new FakeWorker();
    const runner = createWorkerSupportProbeRunner({
      workerFactory: () => worker as unknown as Worker,
    });

    const done = runner.check();
    worker.emit({ kind: "result", supported: true });
    await done;

    expect(worker.posted).toEqual([{ kind: "check" }]);
  });

  it("terminates the worker once the check settles — a fresh worker is spun up and torn down per check, never left idle", async () => {
    const worker = new FakeWorker();
    const runner = createWorkerSupportProbeRunner({
      workerFactory: () => worker as unknown as Worker,
    });

    const done = runner.check();
    expect(worker.terminated).toBe(false);
    worker.emit({ kind: "result", supported: true });
    await done;

    expect(worker.terminated).toBe(true);
  });

  it("a fresh worker is constructed on EVERY call to check() — never a shared idle worker reused across calls", async () => {
    const workers = [new FakeWorker(), new FakeWorker()];
    let callCount = 0;
    const workerFactory = vi.fn(() => {
      const w = workers[callCount++]!;
      return w as unknown as Worker;
    });
    const runner = createWorkerSupportProbeRunner({ workerFactory });

    const first = runner.check();
    workers[0]!.emit({ kind: "result", supported: true });
    await first;

    const second = runner.check();
    workers[1]!.emit({ kind: "result", supported: false });
    await second;

    expect(workerFactory).toHaveBeenCalledTimes(2);
  });
});

describe("FakeSupportProbeRunner — scripted true/false injection", () => {
  it("a true-configured fake resolves true", async () => {
    const runner = new FakeSupportProbeRunner({ supported: true });
    await expect(runner.check()).resolves.toBe(true);
  });

  it("a false-configured fake resolves false", async () => {
    const runner = new FakeSupportProbeRunner({ supported: false });
    await expect(runner.check()).resolves.toBe(false);
  });
});

describe("SupportProbeRunner — Fake and real implementations satisfy the SAME interface", () => {
  it("both assign to a SupportProbeRunner-typed variable without widening to `any`", () => {
    const fake: SupportProbeRunner = new FakeSupportProbeRunner({ supported: true });
    const real: SupportProbeRunner = createWorkerSupportProbeRunner({
      workerFactory: () => new FakeWorker() as unknown as Worker,
    });
    expect(typeof fake.check).toBe("function");
    expect(typeof real.check).toBe("function");
  });

  it("WorkerLike's structural surface is exactly what the FakeWorker above satisfies", () => {
    const worker: WorkerLike = new FakeWorker() as unknown as WorkerLike;
    expect(typeof worker.postMessage).toBe("function");
    expect(typeof worker.terminate).toBe("function");
  });
});
