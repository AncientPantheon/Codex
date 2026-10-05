// @vitest-environment node
/**
 * `arweave-upload-dry-run` T3 (scope deviation — see `dryRunWorker.ts`'s own
 * doc comment for why this seam exists at all): the main-thread
 * `StreamingDryRunRunner` seam.
 *
 * Mirrors `streaming-upload-runner.test.ts`'s own convention exactly: the
 * real worker-backed runner is driven through a hand-built `FakeWorker` (a
 * `WorkerLike` stand-in) returned by an INJECTED `workerFactory` — never a
 * real Web Worker — and the test drives the fake's `onmessage` with typed
 * `StreamingDryRunWorkerMsg` values exactly as the real `dryRunWorker.ts`
 * would post them (`done`/`error`).
 *
 * WHY THIS TEST MATTERS: without it, a regression that silently drops the
 * `poolEndpoints` reconstruction, forgets to terminate the worker on
 * settle, or posts the wrong message shape would only surface as a mystery
 * hang/leak in a real browser — this test pins the exact message lifecycle
 * and worker-cleanup contract the adapter wiring depends on.
 */

import { describe, it, expect, vi } from "vitest";

import { createGatewayPool } from "@ancientpantheon/arweave-core";

import {
  createWorkerStreamingDryRunRunner,
  FakeStreamingDryRunRunner,
  type StreamingDryRunRunner,
  type WorkerLike,
} from "../src/library/streaming/StreamingDryRunRunner.js";
import type { StreamingDryRunWorkerMsg } from "../src/library/streaming/dryRunWorker.js";
import type { DryRunResult } from "../src/library/streaming/dryRunUpload.js";
import { throwawayJwk } from "./e3-helpers";

const CAP = 1_000_000_000_000n;

/** A minimal upload action — never actually executed in these tests (the
 *  fake worker never calls `runUploadDryRun`), but a real, valid
 *  `UploadAndTrackParams` shape so the calls below type-check against the
 *  SAME params type the real worker-backed runner posts. */
const PARAMS = {
  jwk: throwawayJwk,
  data: "streaming-dry-run-runner fixture contents",
  contentType: "text/plain",
  maxRewardWinston: CAP,
  category: "general-other" as const,
};

function makePool() {
  return createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} });
}

/** A minimal FAKE `Worker`: records `postMessage` calls and lets the test
 *  drive `onmessage` with a typed `StreamingDryRunWorkerMsg`. */
class FakeWorker {
  onmessage: ((ev: { data: StreamingDryRunWorkerMsg }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;
  postMessage(msg: unknown): void {
    this.posted.push(msg);
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(data: StreamingDryRunWorkerMsg): void {
    this.onmessage?.({ data });
  }
}

const FAKE_RESULT: DryRunResult = {
  success: true,
  filesTested: 1,
  totalBytes: 42,
  chunksPosted: 2,
  resumeTested: true,
  proofsValid: true,
  decryptRoundTripOk: "not-applicable",
  streamingSupported: true,
  elapsedMs: 10,
  errors: [],
};

describe("createWorkerStreamingDryRunRunner — injected workerFactory + full message lifecycle", () => {
  it("resolves with the done message's result", async () => {
    const worker = new FakeWorker();
    const workerFactory = vi.fn(() => worker as unknown as Worker);
    const runner = createWorkerStreamingDryRunRunner({ workerFactory });

    const done = runner.run(PARAMS, undefined, { pool: makePool() });

    // The runner obtained its worker THROUGH the injected factory, not a
    // hardcoded `new Worker(...)`.
    expect(workerFactory).toHaveBeenCalledTimes(1);

    worker.emit({ kind: "done", result: FAKE_RESULT });
    const result = await done;

    expect(result).toBe(FAKE_RESULT);
  });

  it("posts a { kind: 'start', params, resolvedKey, opts: { poolEndpoints } } message — never the live pool object itself", async () => {
    const worker = new FakeWorker();
    const runner = createWorkerStreamingDryRunRunner({
      workerFactory: () => worker as unknown as Worker,
    });

    const done = runner.run(PARAMS, undefined, { pool: makePool() });
    worker.emit({ kind: "done", result: FAKE_RESULT });
    await done;

    expect(worker.posted).toHaveLength(1);
    const posted = worker.posted[0] as {
      kind: string;
      params: unknown;
      resolvedKey: unknown;
      opts: { poolEndpoints: string[] };
    };
    expect(posted.kind).toBe("start");
    expect(posted.params).toBe(PARAMS);
    expect(posted.resolvedKey).toBeUndefined();
    expect(posted.opts.poolEndpoints).toEqual(["https://a.example"]);
    expect("pool" in posted.opts).toBe(false);
  });

  it("an error message REJECTS the returned promise with that message, as an Error", async () => {
    const worker = new FakeWorker();
    const runner = createWorkerStreamingDryRunRunner({
      workerFactory: () => worker as unknown as Worker,
    });

    const rejected = runner.run(PARAMS, undefined, { pool: makePool() });
    worker.emit({ kind: "error", message: "dry run failed in worker" });

    await expect(rejected).rejects.toThrow(/dry run failed in worker/);
  });

  it("terminates the worker after a successful run settles", async () => {
    const worker = new FakeWorker();
    const runner = createWorkerStreamingDryRunRunner({
      workerFactory: () => worker as unknown as Worker,
    });

    const done = runner.run(PARAMS, undefined, { pool: makePool() });
    expect(worker.terminated).toBe(false);
    worker.emit({ kind: "done", result: FAKE_RESULT });
    await done;

    expect(worker.terminated).toBe(true);
  });

  it("terminates the worker after an error settles it too", async () => {
    const worker = new FakeWorker();
    const runner = createWorkerStreamingDryRunRunner({
      workerFactory: () => worker as unknown as Worker,
    });

    const rejected = runner.run(PARAMS, undefined, { pool: makePool() });
    worker.emit({ kind: "error", message: "boom" });
    await expect(rejected).rejects.toThrow();

    expect(worker.terminated).toBe(true);
  });
});

describe("FakeStreamingDryRunRunner — success/error injection", () => {
  it("a success-configured fake resolves with the injected result", async () => {
    const runner = new FakeStreamingDryRunRunner({ result: FAKE_RESULT });
    const result = await runner.run(PARAMS, undefined, { pool: makePool() });
    expect(result).toBe(FAKE_RESULT);
  });

  it("a reject-configured fake REJECTS with the configured message", async () => {
    const runner = new FakeStreamingDryRunRunner({ failWith: "fake dry run failed" });
    await expect(runner.run(PARAMS, undefined, { pool: makePool() })).rejects.toThrow(
      /fake dry run failed/,
    );
  });
});

describe("StreamingDryRunRunner — Fake and real implementations satisfy the SAME interface", () => {
  it("both assign to a StreamingDryRunRunner-typed variable without widening to `any`", () => {
    const fake: StreamingDryRunRunner = new FakeStreamingDryRunRunner({ result: FAKE_RESULT });
    const real: StreamingDryRunRunner = createWorkerStreamingDryRunRunner({
      workerFactory: () => new FakeWorker() as unknown as Worker,
    });
    expect(typeof fake.run).toBe("function");
    expect(typeof real.run).toBe("function");
  });

  it("WorkerLike's structural surface is exactly what the FakeWorker above satisfies", () => {
    const worker: WorkerLike = new FakeWorker() as unknown as WorkerLike;
    expect(typeof worker.postMessage).toBe("function");
    expect(typeof worker.terminate).toBe("function");
  });
});
