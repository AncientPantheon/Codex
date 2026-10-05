// @vitest-environment node
/**
 * T2 (`arweave-streaming-worker-wiring`) — the main-thread
 * `StreamingUploadRunner` seam.
 *
 * Mirrors `e4-keygen-runner.test.ts`'s own convention for
 * `createWorkerKeygenRunner`/`FakeKeygenRunner` exactly: the real
 * worker-backed runner is driven through a hand-built `FakeWorker` (a
 * `WorkerLike` stand-in with `postMessage`/`onmessage`/`onerror`/`terminate`)
 * returned by an INJECTED `workerFactory` — never a real Web Worker — and the
 * test drives the fake's `onmessage` with typed `StreamingUploadWorkerMsg`
 * values exactly as T1's real `uploadWorker.ts` would post them (`route` →
 * `progress`* → `done`/`error`).
 *
 * `// @vitest-environment node`: pure node-logic over an injected fake
 * worker, same reasoning `e4-keygen-runner.test.ts` and the other streaming
 * seam tests (`streaming-upload-supported.test.ts`, etc.) give for their own
 * `node` pragma — nothing here touches a real browser/Worker API or React.
 *
 * RED: `../src/library/streaming/StreamingUploadRunner.js` does not exist
 * yet — every import below fails to resolve.
 */

import { describe, it, expect, vi } from "vitest";

import { createGatewayPool, type UploadResult } from "@ancientpantheon/arweave-core";

import {
  createWorkerStreamingUploadRunner,
  FakeStreamingUploadRunner,
  type StreamingUploadRunner,
  type StreamingUploadRunnerOptions,
  type WorkerLike,
} from "../src/library/streaming/StreamingUploadRunner.js";
import type { StreamingUploadWorkerMsg } from "../src/library/streaming/uploadWorker.js";
import { MemoryLibraryStore } from "../src/library/memoryStore.js";

import { throwawayJwk, KNOWN_ADDRESS } from "./e3-helpers";

const OWNER = KNOWN_ADDRESS;
const CAP = 1_000_000_000_000n;

/** A minimal upload action — never actually executed in these tests (the
 *  fake worker never calls `performUploadAndTrack`), but a real, valid
 *  `UploadAndTrackParams` shape so the calls below type-check against the
 *  SAME params type the real worker-backed runner posts. */
const PARAMS = {
  jwk: throwawayJwk,
  data: "streaming-upload-runner fixture contents",
  contentType: "text/plain",
  itemId: "streaming-runner-fixture-1",
  maxRewardWinston: CAP,
  category: "general-other" as const,
};

/** A real, valid `StreamingUploadRunnerOptions` bag — `store`/`pool` are the
 *  SAME required fields `PerformUploadAndTrackOptions` itself requires (this
 *  seam never relaxes that), built from the package's own real
 *  `MemoryLibraryStore` + `createGatewayPool` rather than a hand-rolled fake,
 *  mirroring `streaming-perform-upload-and-track.test.ts`'s own convention.
 *  Never actually read by the fake worker below — only present so the calls
 *  type-check against the real contract. */
function makeOpts(
  overrides: Partial<StreamingUploadRunnerOptions> = {},
): StreamingUploadRunnerOptions {
  return {
    store: new MemoryLibraryStore(),
    pool: createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} }),
    ...overrides,
  };
}

/** A minimal FAKE `Worker`: records `postMessage` calls and lets the test
 *  drive `onmessage` with a typed `StreamingUploadWorkerMsg` — mirrors
 *  `e4-keygen-runner.test.ts`'s own `FakeWorker`. NOT a real Web Worker: the
 *  injected `workerFactory` returning this proves
 *  `createWorkerStreamingUploadRunner` never hardcodes
 *  `new Worker(new URL(...))`. */
class FakeWorker {
  onmessage: ((ev: { data: StreamingUploadWorkerMsg }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;
  postMessage(msg: unknown): void {
    this.posted.push(msg);
  }
  terminate(): void {
    this.terminated = true;
  }
  /** Drive a typed message into the runner (structured-clone stand-in). */
  emit(data: StreamingUploadWorkerMsg): void {
    this.onmessage?.({ data });
  }
}

const FAKE_RESULT: UploadResult = {
  id: "fake-tx-id",
  itemId: "streaming-runner-fixture-1",
  ownerAddress: OWNER,
  tags: [],
};

describe("createWorkerStreamingUploadRunner — injected workerFactory + full message lifecycle (T2)", () => {
  it("a successful run fires onRoute then onProgress (in order, with the right arguments) and resolves with the done message's result", async () => {
    const worker = new FakeWorker();
    const workerFactory = vi.fn(() => worker as unknown as Worker);
    const runner = createWorkerStreamingUploadRunner({ workerFactory });

    const seen: Array<{ kind: string; args: unknown[] }> = [];
    const opts = makeOpts({
      onRoute: (route) => seen.push({ kind: "route", args: [route] }),
      onProgress: (uploadedChunks, totalChunks) =>
        seen.push({ kind: "progress", args: [uploadedChunks, totalChunks] }),
    });

    const done = runner.run(PARAMS, undefined, opts);

    // The runner obtained its worker THROUGH the injected factory, not a
    // hardcoded `new Worker(...)`.
    expect(workerFactory).toHaveBeenCalledTimes(1);

    worker.emit({ kind: "route", route: "streaming" });
    worker.emit({ kind: "progress", uploadedChunks: 1, totalChunks: 4 });
    worker.emit({ kind: "progress", uploadedChunks: 2, totalChunks: 4 });
    worker.emit({ kind: "done", result: FAKE_RESULT });

    const result = await done;

    expect(result).toBe(FAKE_RESULT);
    expect(seen).toEqual([
      { kind: "route", args: ["streaming"] },
      { kind: "progress", args: [1, 4] },
      { kind: "progress", args: [2, 4] },
    ]);
  });

  it("posts the real { kind: 'start', params, resolvedKey } message shape through the injected worker", async () => {
    const worker = new FakeWorker();
    const runner = createWorkerStreamingUploadRunner({
      workerFactory: () => worker as unknown as Worker,
    });

    const done = runner.run(PARAMS, undefined, makeOpts());
    worker.emit({ kind: "done", result: FAKE_RESULT });
    await done;

    expect(worker.posted).toHaveLength(1);
    const posted = worker.posted[0] as { kind: string; params: unknown; resolvedKey: unknown };
    expect(posted.kind).toBe("start");
    expect(posted.params).toBe(PARAMS);
    expect(posted.resolvedKey).toBeUndefined();
  });

  it("an error message REJECTS the returned promise with that message, as an Error", async () => {
    const worker = new FakeWorker();
    const runner = createWorkerStreamingUploadRunner({
      workerFactory: () => worker as unknown as Worker,
    });

    const rejected = runner.run(PARAMS, undefined, makeOpts());
    worker.emit({ kind: "error", message: "streaming upload failed in worker" });

    await expect(rejected).rejects.toThrow(/streaming upload failed in worker/);
  });

  it("terminates the worker after a successful run settles", async () => {
    const worker = new FakeWorker();
    const runner = createWorkerStreamingUploadRunner({
      workerFactory: () => worker as unknown as Worker,
    });

    const done = runner.run(PARAMS, undefined, makeOpts());
    expect(worker.terminated).toBe(false);
    worker.emit({ kind: "done", result: FAKE_RESULT });
    await done;

    expect(worker.terminated).toBe(true);
  });

  it("terminates the worker after an error settles it too", async () => {
    const worker = new FakeWorker();
    const runner = createWorkerStreamingUploadRunner({
      workerFactory: () => worker as unknown as Worker,
    });

    const rejected = runner.run(PARAMS, undefined, makeOpts());
    worker.emit({ kind: "error", message: "boom" });
    await expect(rejected).rejects.toThrow();

    expect(worker.terminated).toBe(true);
  });
});

describe("FakeStreamingUploadRunner — scripted route/progress + success/error injection (T2)", () => {
  it("a success-configured fake fires the scripted onRoute/onProgress in order and resolves with the injected result", async () => {
    const runner = new FakeStreamingUploadRunner({
      result: FAKE_RESULT,
      route: "fallback",
      progress: [{ uploadedChunks: 1, totalChunks: 2 }],
    });

    const seen: Array<{ kind: string; args: unknown[] }> = [];
    const opts = makeOpts({
      onRoute: (route) => seen.push({ kind: "route", args: [route] }),
      onProgress: (uploadedChunks, totalChunks) =>
        seen.push({ kind: "progress", args: [uploadedChunks, totalChunks] }),
    });

    const result = await runner.run(PARAMS, undefined, opts);

    expect(result).toBe(FAKE_RESULT);
    expect(seen).toEqual([
      { kind: "route", args: ["fallback"] },
      { kind: "progress", args: [1, 2] },
    ]);
  });

  it("a reject-configured fake REJECTS with the configured message and never resolves a result", async () => {
    const runner = new FakeStreamingUploadRunner({ failWith: "fake streaming upload failed" });

    await expect(runner.run(PARAMS, undefined, makeOpts())).rejects.toThrow(
      /fake streaming upload failed/,
    );
  });
});

describe("StreamingUploadRunner — FakeStreamingUploadRunner and createWorkerStreamingUploadRunner satisfy the SAME interface (T2)", () => {
  it("both assign to a StreamingUploadRunner-typed variable without widening to `any`", () => {
    const fake: StreamingUploadRunner = new FakeStreamingUploadRunner({ result: FAKE_RESULT });
    const real: StreamingUploadRunner = createWorkerStreamingUploadRunner({
      workerFactory: () => new FakeWorker() as unknown as Worker,
    });

    // Both are genuinely usable through the one shared interface — not just
    // compiling because either side was typed `any`.
    expect(typeof fake.run).toBe("function");
    expect(typeof real.run).toBe("function");
  });

  it("WorkerLike's structural surface is exactly what the FakeWorker above satisfies", () => {
    const worker: WorkerLike = new FakeWorker() as unknown as WorkerLike;
    expect(typeof worker.postMessage).toBe("function");
    expect(typeof worker.terminate).toBe("function");
  });
});
