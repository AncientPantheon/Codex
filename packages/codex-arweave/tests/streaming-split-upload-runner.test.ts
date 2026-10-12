// @vitest-environment node
/**
 * The main-thread `SplitUploadRunner` seam — the Worker-backed wrapper for
 * `runSplitBundleUpload` (T5b of `arweave-split-bundle-upload`, closing the
 * flagged gap: `runSplitBundleUpload`'s own OPFS work is Worker-only in a
 * real browser, exactly like the single-bundle `uploadAndTrack` path
 * `arweave-streaming-worker-wiring` already Worker-wrapped).
 *
 * Mirrors `streaming-upload-runner.test.ts`'s own convention for
 * `createWorkerStreamingUploadRunner`/`FakeStreamingUploadRunner` exactly:
 * the real worker-backed runner is driven through a hand-built `FakeWorker`
 * (a `WorkerLike` stand-in with `postMessage`/`onmessage`/`onerror`/
 * `terminate`) returned by an INJECTED `workerFactory` — never a real Web
 * Worker — and the test drives the fake's `onmessage` with typed
 * `SplitUploadWorkerMsg` values exactly as the real `splitUploadWorker.ts`
 * would post them (`progress`* → `done`/`error`).
 *
 * `// @vitest-environment node`: pure node-logic over an injected fake
 * worker — nothing here touches a real browser/Worker API, OPFS, or React.
 * Node 22's global `File` is used directly for the fixture files (confirmed
 * available, not jsdom-only).
 *
 * RED: `../src/library/streaming/SplitUploadRunner.js` does not exist yet —
 * every import below fails to resolve.
 */

import { describe, it, expect, vi } from "vitest";

import { createGatewayPool } from "@ancientpantheon/arweave-core";

import {
  createWorkerSplitUploadRunner,
  FakeSplitUploadRunner,
  type SplitUploadRunner,
  type SplitUploadRunnerOptions,
  type SplitUploadRunnerParams,
  type WorkerLike,
} from "../src/library/streaming/SplitUploadRunner.js";
import type { SplitUploadWorkerMsg } from "../src/library/streaming/splitUploadWorker.js";

import { throwawayJwk } from "./e3-helpers.js";

const CAP = 1_000_000_000_000n;

/** A real, valid `SplitUploadRunnerParams` — real `File` objects (Node 22's
 *  global `File`), never a `readData()` callback: that is exactly the thing
 *  a caller MUST NOT try to hand across a Worker boundary (functions are
 *  never structured-cloneable) — see `SplitUploadRunner.ts`'s own doc
 *  comment for the full grounding. Never actually read by the fake worker
 *  below — only present so the calls type-check against the real contract. */
function makeParams(): SplitUploadRunnerParams {
  return {
    jwk: throwawayJwk,
    files: [
      {
        path: "a.txt",
        size: 3,
        contentType: "text/plain",
        file: new File([new Uint8Array([1, 2, 3])], "a.txt", { type: "text/plain" }),
      },
      {
        path: "b.txt",
        size: 3,
        contentType: "text/plain",
        file: new File([new Uint8Array([4, 5, 6])], "b.txt", { type: "text/plain" }),
      },
    ],
    maxRewardWinston: CAP,
    category: "general-other",
    encrypted: false,
  };
}

function makeOpts(overrides: Partial<SplitUploadRunnerOptions> = {}): SplitUploadRunnerOptions {
  return {
    pool: createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} }),
    ...overrides,
  };
}

/** A minimal FAKE `Worker`: records `postMessage` calls and lets the test
 *  drive `onmessage` with a typed `SplitUploadWorkerMsg` — mirrors
 *  `streaming-upload-runner.test.ts`'s own `FakeWorker`. NOT a real Web
 *  Worker: the injected `workerFactory` returning this proves
 *  `createWorkerSplitUploadRunner` never hardcodes `new Worker(new URL(...))`. */
class FakeWorker {
  onmessage: ((ev: { data: SplitUploadWorkerMsg }) => void) | null = null;
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
  emit(data: SplitUploadWorkerMsg): void {
    this.onmessage?.({ data });
  }
}

const FAKE_RESULT = {
  manifestId: "fake-manifest-id",
  bundleResults: [
    { manifestId: "fake-manifest-id", fileIds: [{ path: "a.txt", id: "id-a" }], uploadId: "fake-upload" },
  ],
};

describe("createWorkerSplitUploadRunner — injected workerFactory + full message lifecycle (T5b)", () => {
  it("a successful run fires onOverallProgress in arrival order and resolves with the done message's result", async () => {
    const worker = new FakeWorker();
    const workerFactory = vi.fn(() => worker as unknown as Worker);
    const runner = createWorkerSplitUploadRunner({ workerFactory });

    const seen: unknown[][] = [];
    const opts = makeOpts({
      onOverallProgress: (...args) => seen.push(args),
    });

    const done = runner.run(makeParams(), opts);

    // The runner obtained its worker THROUGH the injected factory, not a
    // hardcoded `new Worker(...)`.
    expect(workerFactory).toHaveBeenCalledTimes(1);

    worker.emit({
      kind: "progress",
      bundleIndex: 0,
      totalBundles: 2,
      bundleUploadedChunks: 1,
      bundleTotalChunks: 4,
      overallBytesUploaded: 100,
      overallTotalBytes: 400,
    });
    worker.emit({
      kind: "progress",
      bundleIndex: 1,
      totalBundles: 2,
      bundleUploadedChunks: 2,
      bundleTotalChunks: 4,
      overallBytesUploaded: 300,
      overallTotalBytes: 400,
    });
    worker.emit({ kind: "done", result: FAKE_RESULT });

    const result = await done;

    expect(result).toBe(FAKE_RESULT);
    expect(seen).toEqual([
      [0, 2, 1, 4, 100, 400],
      [1, 2, 2, 4, 300, 400],
    ]);
  });

  it("posts the real { kind: 'start' } message with real File objects (never a readData callback) and pool stripped down to poolEndpoints", async () => {
    const worker = new FakeWorker();
    const runner = createWorkerSplitUploadRunner({
      workerFactory: () => worker as unknown as Worker,
    });

    const params = makeParams();
    const done = runner.run(
      params,
      makeOpts({
        pool: createGatewayPool({ endpoints: ["https://a.example", "https://b.example"], sleep: async () => {} }),
      }),
    );
    worker.emit({ kind: "done", result: FAKE_RESULT });
    await done;

    expect(worker.posted).toHaveLength(1);
    const posted = worker.posted[0] as {
      kind: string;
      params: { files: { file: unknown }[] };
      opts: { poolEndpoints: string[]; pool?: unknown };
    };
    expect(posted.kind).toBe("start");
    // The real `File` objects cross verbatim — never pre-read into bytes on
    // the main thread (that would defeat the whole point of this feature
    // for a multi-GB folder).
    expect(posted.params.files[0]!.file).toBe(params.files[0]!.file);
    expect(posted.params.files[1]!.file).toBe(params.files[1]!.file);
    // `pool` (a plain object of FUNCTIONS) never crosses — only its own
    // configured endpoint URLs do, mirroring `StreamingUploadRunner.ts`'s
    // own established `poolEndpoints` convention exactly.
    expect(posted.opts.pool).toBeUndefined();
    expect(posted.opts.poolEndpoints).toEqual(["https://a.example", "https://b.example"]);
  });

  it("an error message REJECTS the returned promise with that message, as an Error", async () => {
    const worker = new FakeWorker();
    const runner = createWorkerSplitUploadRunner({
      workerFactory: () => worker as unknown as Worker,
    });

    const rejected = runner.run(makeParams(), makeOpts());
    worker.emit({ kind: "error", message: "split upload failed in worker" });

    await expect(rejected).rejects.toThrow(/split upload failed in worker/);
  });

  it("terminates the worker after a successful run settles", async () => {
    const worker = new FakeWorker();
    const runner = createWorkerSplitUploadRunner({
      workerFactory: () => worker as unknown as Worker,
    });

    const done = runner.run(makeParams(), makeOpts());
    expect(worker.terminated).toBe(false);
    worker.emit({ kind: "done", result: FAKE_RESULT });
    await done;

    expect(worker.terminated).toBe(true);
  });

  it("terminates the worker after an error settles it too", async () => {
    const worker = new FakeWorker();
    const runner = createWorkerSplitUploadRunner({
      workerFactory: () => worker as unknown as Worker,
    });

    const rejected = runner.run(makeParams(), makeOpts());
    worker.emit({ kind: "error", message: "boom" });
    await expect(rejected).rejects.toThrow();

    expect(worker.terminated).toBe(true);
  });
});

describe("FakeSplitUploadRunner — scripted progress + success/error injection (T5b)", () => {
  it("a success-configured fake fires the scripted onOverallProgress in order and resolves with the injected result", async () => {
    const runner = new FakeSplitUploadRunner({
      result: FAKE_RESULT,
      progress: [{ bundleIndex: 0, totalBundles: 1, bundleUploadedChunks: 1, bundleTotalChunks: 1, overallBytesUploaded: 10, overallTotalBytes: 10 }],
    });

    const seen: unknown[][] = [];
    const opts = makeOpts({ onOverallProgress: (...args) => seen.push(args) });

    const result = await runner.run(makeParams(), opts);

    expect(result).toBe(FAKE_RESULT);
    expect(seen).toEqual([[0, 1, 1, 1, 10, 10]]);
  });

  it("a reject-configured fake REJECTS with the configured message and never resolves a result", async () => {
    const runner = new FakeSplitUploadRunner({ failWith: "fake split upload failed" });

    await expect(runner.run(makeParams(), makeOpts())).rejects.toThrow(/fake split upload failed/);
  });
});

describe("SplitUploadRunner — FakeSplitUploadRunner and createWorkerSplitUploadRunner satisfy the SAME interface (T5b)", () => {
  it("both assign to a SplitUploadRunner-typed variable without widening to `any`", () => {
    const fake: SplitUploadRunner = new FakeSplitUploadRunner({ result: FAKE_RESULT });
    const real: SplitUploadRunner = createWorkerSplitUploadRunner({
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
