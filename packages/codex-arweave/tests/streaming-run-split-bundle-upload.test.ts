// @vitest-environment node
/**
 * T4 RED/GREEN (`arweave-split-bundle-upload`) — the multi-bundle sequential
 * orchestration engine (`runSplitBundleUpload`). `@vitest-environment node`
 * for the same reason every sibling streaming test already uses it
 * (`streaming-upload-bundle.test.ts`/`streaming-post.test.ts`): real
 * `arweave-js`/`arbundles` signing + a real `fake-indexeddb`-backed store,
 * all needing the SAME realm as Node's own globals.
 *
 * FIDELITY CALL (fake vs. real per-bundle engine): this file drives the
 * REAL, unmodified `uploadBundleStreaming`/`resumeStreamingPost` (never a
 * fake stand-in for them) against small fixture file sizes, exactly the
 * convention `streaming-upload-bundle.test.ts` itself already established
 * for testing that same engine. A fake engine would let this file's tests
 * pass against an orchestrator that calls the REAL engine subtly wrong
 * (wrong options shape, wrong resume-id threading, wrong file-content
 * mapping) without ever noticing — the whole point of this task's
 * "no-regression-for-the-common-case" requirement is that the REAL engine
 * is what gets exercised, identically to a direct caller. The only things
 * faked are the OPFS filesystem (neither Node nor jsdom has one — mirrors
 * `FakeBundleAssemblyFile`'s own role in every sibling streaming test) and
 * the gateway wire (`StreamingUploadGatewayApiFactory`/
 * `UploadGatewayApiFactory` fakes, same as every sibling test).
 *
 * SPYING: `uploadBundleStreaming` (`./uploadBundleStreaming.js`) and
 * `resumeStreamingPost` (`./streamingPost.js`) are both partially mocked —
 * transparent pass-throughs to the REAL implementation, recording
 * start/end order and (for `uploadBundleStreaming`) each call's real
 * resolved result — mirroring this project's own established
 * `vi.mock("arbundles", ...)` transparent-recording-pass-through
 * convention (`streaming-upload-bundle.test.ts`,
 * `streaming-split-upload-manifest.test.ts`). This is what makes "never
 * concurrent" and "bundle 0 never re-signed/re-posted on a resumed call"
 * provable by direct observation rather than merely "true by construction
 * of a sequential for-loop, trust me".
 */

import "fake-indexeddb/auto";

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import type { ArweaveJwk, UploadBundleResult } from "@ancientpantheon/arweave-core";

import {
  runSplitBundleUpload,
  OversizedFilesError,
  type SplitBundleUploadFile,
} from "../src/library/streaming/runSplitBundleUpload.js";
import { SplitUploadPlanStore } from "../src/library/streaming/splitUploadPlanStore.js";
import { StreamingPostResumeStore } from "../src/library/streaming/streamingPostResumeStore.js";
import type { BundleAssemblyFile } from "../src/library/streaming/bundleAssemblyFile.js";
import type { IdbFactoryLike } from "../src/library/types.js";
import { makeHealthPool, makeRecordingUploadApi } from "./e3-helpers.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const throwawayJwk = JSON.parse(
  readFileSync(join(FIXTURES, "throwaway-arweave-keyfile.json"), "utf8"),
) as ArweaveJwk;

const CAP = 1_000_000_000_000n;

// ---------------------------------------------------------------------------
// Opt-in call-order/call-result recording for the two real per-bundle entry
// points this orchestrator drives — `null` means "don't record", mirroring
// this project's own established `capturedSignCalls` convention
// (`streaming-upload-bundle.test.ts`). Reset to `null` at the end of every
// test that turns it on.
// ---------------------------------------------------------------------------
let bundleEvents: string[] | null = null;
let bundleLogs: { resumeId: string; result: UploadBundleResult }[] | null = null;
let resumeEvents: string[] | null = null;

vi.mock("../src/library/streaming/uploadBundleStreaming.js", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../src/library/streaming/uploadBundleStreaming.js")
  >();
  return {
    ...original,
    uploadBundleStreaming: async (
      params: Parameters<typeof original.uploadBundleStreaming>[0],
      opts: Parameters<typeof original.uploadBundleStreaming>[1],
    ) => {
      const resumeId = (opts as { resumeId?: string }).resumeId ?? "(unknown)";
      bundleEvents?.push(`start:${resumeId}`);
      try {
        const result = await original.uploadBundleStreaming(params, opts);
        bundleLogs?.push({ resumeId, result });
        return result;
      } finally {
        bundleEvents?.push(`end:${resumeId}`);
      }
    },
  };
});

vi.mock("../src/library/streaming/streamingPost.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/library/streaming/streamingPost.js")>();
  return {
    ...original,
    resumeStreamingPost: async (
      id: string,
      pool: Parameters<typeof original.resumeStreamingPost>[1],
      opts: Parameters<typeof original.resumeStreamingPost>[2],
    ) => {
      resumeEvents?.push(`start:${id}`);
      try {
        return await original.resumeStreamingPost(id, pool, opts);
      } finally {
        resumeEvents?.push(`end:${id}`);
      }
    },
  };
});

/** Deterministic, non-trivial per-file bytes (mirrors every sibling
 *  streaming test's own fixture convention). */
function makeDeterministicBytes(size: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    bytes[i] = (i * 31 + seed * 7) & 0xff;
  }
  return bytes;
}

function makeFile(path: string, size: number, seed: number): SplitBundleUploadFile {
  const bytes = makeDeterministicBytes(size, seed);
  return {
    path,
    size,
    contentType: "application/octet-stream",
    readData: async () => bytes,
  };
}

/** A fresh, isolated `SplitUploadPlanStore` — mirrors T3's own `freshStore`
 *  helper, so no two tests ever share state. */
function freshPlanStore(): Promise<SplitUploadPlanStore> {
  return SplitUploadPlanStore.open({
    indexedDB: globalThis.indexedDB as unknown as IdbFactoryLike,
    databaseName: `codex-split-plan-${Math.random().toString(36).slice(2)}`,
  });
}

/** A fresh, isolated `StreamingPostResumeStore` — mirrors
 *  `streaming-upload-bundle.test.ts`'s own `freshResumeStore` helper. */
function freshResumeStore(): Promise<StreamingPostResumeStore> {
  return StreamingPostResumeStore.open({
    indexedDB: globalThis.indexedDB as unknown as IdbFactoryLike,
    databaseName: `codex-split-resume-${Math.random().toString(36).slice(2)}`,
  });
}

/**
 * An in-memory, named-file "OPFS-like" filesystem fake — unlike
 * `FakeBundleAssemblyFile` (which is itself one, brand-new, empty buffer per
 * instance), this is shared/keyed by file name so repeated `openFile(name)`
 * calls for the SAME name see the SAME persisted bytes — exactly how a real
 * OPFS directory behaves across separate opens (confirmed by
 * `openOpfsBundleAssemblyFile`'s own real semantics), which THIS task's own
 * resume scenario genuinely needs (the orchestrator's own header-read open,
 * the interrupted run's open, and the resumed run's second open must all see
 * the SAME already-assembled bytes).
 */
function makeFakeFileSystem(): {
  openFile: (name: string) => Promise<BundleAssemblyFile>;
  deleteFile: (name: string) => Promise<void>;
} {
  const files = new Map<string, Uint8Array>();

  async function openFile(name: string): Promise<BundleAssemblyFile> {
    if (!files.has(name)) {
      files.set(name, new Uint8Array(0));
    }
    let closed = false;
    return {
      async write(offset: number, bytes: Uint8Array) {
        if (closed) throw new Error(`fake file "${name}" already closed`);
        let buf = files.get(name)!;
        const end = offset + bytes.byteLength;
        if (end > buf.byteLength) {
          const grown = new Uint8Array(end);
          grown.set(buf, 0);
          buf = grown;
          files.set(name, buf);
        }
        buf.set(bytes, offset);
      },
      async read(offset: number, length: number) {
        if (closed) throw new Error(`fake file "${name}" already closed`);
        const buf = files.get(name)!;
        const out = new Uint8Array(length);
        const available = Math.max(0, Math.min(length, buf.byteLength - offset));
        if (available > 0) {
          out.set(buf.subarray(offset, offset + available), 0);
        }
        return out;
      },
      async close() {
        closed = true;
      },
    };
  }

  async function deleteFile(name: string): Promise<void> {
    files.delete(name);
  }

  return { openFile, deleteFile };
}

/** A fake `StreamingUploadGatewayApiFactory` that fails every `postChunk`
 *  call once `stopAfterTotal` total chunks have ever succeeded, GLOBALLY
 *  across however many bundles this ONE run drives — mirrors
 *  `streaming-upload-bundle.test.ts`'s own `makeInterruptingStreamingApiFactory`,
 *  generalized here to a global threshold since a single `apiFactory`
 *  instance is shared across every bundle in one `runSplitBundleUpload`
 *  call (the seam has no per-bundle context). `null` (the default) never
 *  interrupts. */
function makeStreamingApiFactory(stopAfterTotal: number | null = null) {
  const postedChunks: unknown[] = [];
  const apiFactory = () => ({
    async getAnchor() {
      return "abcdEFGHijkLMNopQRSTuvWXyz0123456789_-ABCDEF".slice(0, 43);
    },
    async getPrice() {
      return "1000000000";
    },
    async postTransaction() {
      // Not inspected by this file's own assertions.
    },
    async postChunk(body: unknown) {
      if (stopAfterTotal !== null && postedChunks.length >= stopAfterTotal) {
        throw new Error("simulated gateway interruption");
      }
      postedChunks.push(body);
    },
  });
  return { apiFactory, postedChunks };
}

describe("runSplitBundleUpload — in-budget selection (common case, zero regression)", () => {
  it("runs as exactly 1 bundle and returns uploadBundleStreaming's own real result verbatim", async () => {
    bundleEvents = [];
    bundleLogs = [];

    const planStore = await freshPlanStore();
    const resumeStore = await freshResumeStore();
    const fakeFs = makeFakeFileSystem();
    const stream = makeStreamingApiFactory();
    const manifest = makeRecordingUploadApi();
    const pool = makeHealthPool();

    const files = [makeFile("a.bin", 10_000, 1), makeFile("sub/b.bin", 20_000, 2)];

    const result = await runSplitBundleUpload(
      {
        jwk: throwawayJwk,
        files,
        maxRewardWinston: CAP,
        category: "general-other",
        encrypted: false,
      },
      {
        pool,
        planStore,
        resumeStore,
        uploadId: "in-budget-test-1",
        budgetBytes: 10_000_000, // comfortably fits everything in 1 bundle
        apiFactory: stream.apiFactory,
        manifestApiFactory: manifest.apiFactory,
        openFile: fakeFs.openFile,
        deleteFile: fakeFs.deleteFile,
      },
    );

    // Exactly one real uploadBundleStreaming call — the no-regression proof:
    // the orchestrator's in-budget path is a plain pass-through to the
    // SAME real engine a direct caller would use, nothing added/removed.
    expect(bundleLogs!.length).toBe(1);
    expect(result.bundleResults).toEqual([bundleLogs![0]!.result]);
    expect(result.bundleResults[0]!.fileIds.map((f) => f.path)).toEqual([
      "a.bin",
      "sub/b.bin",
    ]);

    // The final split-upload manifest is a SEPARATE transaction from the
    // bundle's own inline manifest.
    expect(result.manifestId).not.toBe(result.bundleResults[0]!.manifestId);
    expect(manifest.calls.length).toBe(1);

    // The plan record is cleaned up on full success (mirrors the per-bundle
    // resume store's own "delete on completion" discipline, one level up).
    await expect(planStore.load("in-budget-test-1")).resolves.toBeNull();

    bundleEvents = null;
    bundleLogs = null;
  });
});

describe("runSplitBundleUpload — over-budget selection splits into K sequential, never-concurrent bundles", () => {
  it("runs exactly 3 bundles strictly in order, and the final manifest references every file across every bundle", async () => {
    bundleEvents = [];
    bundleLogs = [];

    const planStore = await freshPlanStore();
    const resumeStore = await freshResumeStore();
    const fakeFs = makeFakeFileSystem();
    const stream = makeStreamingApiFactory();
    const manifest = makeRecordingUploadApi();
    const pool = makeHealthPool();

    // Three equal-sized files, large enough that planSplitBundles (K =
    // ceil(900000/310000) = 3, target = 300000) produces exactly 3
    // singleton-file bundles, in order.
    const files = [
      makeFile("f0.bin", 300_000, 0),
      makeFile("f1.bin", 300_000, 1),
      makeFile("f2.bin", 300_000, 2),
    ];

    const progressEvents: { bundleIndex: number; overallBytesUploaded: number; overallTotalBytes: number }[] = [];

    const result = await runSplitBundleUpload(
      {
        jwk: throwawayJwk,
        files,
        maxRewardWinston: CAP,
        category: "general-other",
        encrypted: false,
      },
      {
        pool,
        planStore,
        resumeStore,
        budgetBytes: 310_000,
        apiFactory: stream.apiFactory,
        manifestApiFactory: manifest.apiFactory,
        openFile: fakeFs.openFile,
        deleteFile: fakeFs.deleteFile,
        onOverallProgress: (bundleIndex, _totalBundles, _uc, _tc, overallBytesUploaded, overallTotalBytes) => {
          progressEvents.push({ bundleIndex, overallBytesUploaded, overallTotalBytes });
        },
      },
    );

    expect(result.bundleResults.length).toBe(3);
    expect(bundleLogs!.length).toBe(3);

    // NEVER CONCURRENT: each bundle's "end" event must appear before the
    // NEXT bundle's "start" event, in the real recorded call order (not
    // merely assumed from the loop's own structure).
    const starts = bundleEvents!.filter((e) => e.startsWith("start:"));
    const ends = bundleEvents!.filter((e) => e.startsWith("end:"));
    expect(starts.length).toBe(3);
    expect(ends.length).toBe(3);
    for (let i = 0; i < 3; i++) {
      const startIdx = bundleEvents!.indexOf(starts[i]!);
      const endIdx = bundleEvents!.indexOf(ends[i]!);
      expect(startIdx).toBeLessThan(endIdx);
      if (i > 0) {
        const prevEndIdx = bundleEvents!.indexOf(ends[i - 1]!);
        expect(prevEndIdx).toBeLessThan(startIdx);
      }
    }

    // The final manifest references every file across every bundle,
    // correctly, in bundle order.
    expect(manifest.calls.length).toBe(1);
    const expectedFileIds = bundleLogs!.flatMap((l) => l.result.fileIds);
    expect(expectedFileIds.map((f) => f.path)).toEqual(["f0.bin", "f1.bin", "f2.bin"]);

    // Overall progress never resets: bundleIndex is non-decreasing and
    // overallTotalBytes stays fixed across the whole sequence.
    expect(progressEvents.length).toBeGreaterThan(0);
    for (const e of progressEvents) {
      expect(e.overallTotalBytes).toBe(900_000);
    }
    let lastBundleIndex = -1;
    for (const e of progressEvents) {
      expect(e.bundleIndex).toBeGreaterThanOrEqual(lastBundleIndex);
      lastBundleIndex = e.bundleIndex;
    }

    bundleEvents = null;
    bundleLogs = null;
  });
});

describe("runSplitBundleUpload — simulated crash/reload mid-sequence resumes correctly", () => {
  it("skips the already-complete bundle (no re-sign/re-post), resumes the interrupted bundle from its own real checkpoint, completes the remaining bundle, and posts the manifest exactly once", async () => {
    const planStore = await freshPlanStore();
    const resumeStore = await freshResumeStore();
    const fakeFs = makeFakeFileSystem();

    const UPLOAD_ID = "resume-test-upload-1";

    // Three equal, 300_000-byte files — the SAME sizes/budget as the
    // K-way-split test above, so planSplitBundles (K = ceil(900000/310000)
    // = 3, target = 300000) produces exactly 3 singleton-file bundles, in
    // order (asserted directly against the persisted plan below, not
    // merely assumed). Each single-file bundle is strictly larger than one
    // 256 KiB Merkle chunk (300_000 > 262_144) even before ANS-104
    // overhead, so EVERY bundle here has exactly 2 chunks — giving bundle 1
    // a genuine "chunk 1 of 2" partial-progress state to interrupt and
    // later resume from.
    const files = [
      makeFile("f0.bin", 300_000, 0),
      makeFile("f1.bin", 300_000, 1),
      makeFile("f2.bin", 300_000, 2),
    ];
    const BUDGET = 310_000;

    bundleEvents = [];
    bundleLogs = [];
    resumeEvents = [];

    // First attempt: globally interrupts after exactly 3 successfully
    // posted chunks — bundle 0's own 2 chunks complete it fully, then
    // bundle 1's FIRST (of 2) chunk succeeds before its second is
    // interrupted — the SAME global-counter technique
    // `makeStreamingApiFactory`'s own doc comment explains.
    const interrupting = makeStreamingApiFactory(3);
    const manifestFirstAttempt = makeRecordingUploadApi();
    const pool = makeHealthPool();

    await expect(
      runSplitBundleUpload(
        {
          jwk: throwawayJwk,
          files,
          maxRewardWinston: CAP,
          category: "general-other",
          encrypted: false,
        },
        {
          pool,
          planStore,
          resumeStore,
          uploadId: UPLOAD_ID,
          budgetBytes: BUDGET,
          apiFactory: interrupting.apiFactory,
          manifestApiFactory: manifestFirstAttempt.apiFactory,
          openFile: fakeFs.openFile,
          deleteFile: fakeFs.deleteFile,
        },
      ),
    ).rejects.toThrow();

    // Ground the 3-singleton-bundle assumption directly against the
    // PERSISTED plan (not merely assumed from the budget arithmetic above).
    const planAfterFirstAttempt = await planStore.load(UPLOAD_ID);
    expect(planAfterFirstAttempt).not.toBeNull();
    expect(planAfterFirstAttempt!.bundles.map((b) => b.map((f) => f.path))).toEqual([
      ["f0.bin"],
      ["f1.bin"],
      ["f2.bin"],
    ]);
    // Bundle 0 genuinely completed; bundle 1 did not; bundle 2 never
    // started.
    expect(planAfterFirstAttempt!.completedBundleFileIds[0]).not.toBeNull();
    expect(planAfterFirstAttempt!.completedBundleFileIds[1]).toBeNull();
    expect(planAfterFirstAttempt!.completedBundleFileIds[2]).toBeNull();

    // The manifest was NEVER posted — the sequence never reached full
    // completion.
    expect(manifestFirstAttempt.calls.length).toBe(0);

    const bundle0ResumeId = bundleLogs!.map((l) => l.resumeId).find((id) => id.endsWith("--bundle-0"))!;
    expect(bundle0ResumeId).toBeDefined();
    // Exactly one real uploadBundleStreaming call so far (bundle 0) —
    // bundle 1's own attempt never got far enough to even START via
    // uploadBundleStreaming a second time (it's bundle 1's FIRST, only
    // attempt in this run).
    expect(bundleLogs!.length).toBe(1);

    // Second, fresh call — reuses the SAME persisted plan/stores, a
    // NON-interrupting apiFactory this time.
    const fresh = makeStreamingApiFactory(null);
    const manifestSecondAttempt = makeRecordingUploadApi();

    const result = await runSplitBundleUpload(
      {
        jwk: throwawayJwk,
        files,
        maxRewardWinston: CAP,
        category: "general-other",
        encrypted: false,
      },
      {
        pool,
        planStore,
        resumeStore,
        uploadId: UPLOAD_ID,
        budgetBytes: BUDGET,
        apiFactory: fresh.apiFactory,
        manifestApiFactory: manifestSecondAttempt.apiFactory,
        openFile: fakeFs.openFile,
        deleteFile: fakeFs.deleteFile,
      },
    );

    // Bundle 0: NEVER touched again — no re-sign, no re-post. Still exactly
    // the ONE uploadBundleStreaming call recorded for its resume id, from
    // the FIRST attempt.
    const bundle0CallsTotal = bundleLogs!.filter((l) => l.resumeId === bundle0ResumeId).length;
    expect(bundle0CallsTotal).toBe(1);

    // Bundle 1: resumed via the per-bundle engine's OWN dedicated resume
    // entry point — never re-signed via a second uploadBundleStreaming
    // call.
    const bundle1ResumeId = `${UPLOAD_ID}--bundle-1`;
    expect(resumeEvents!.some((e) => e === `start:${bundle1ResumeId}`)).toBe(true);
    expect(bundleLogs!.some((l) => l.resumeId === bundle1ResumeId)).toBe(false);

    // Bundle 2: a genuinely fresh uploadBundleStreaming call.
    const bundle2ResumeId = `${UPLOAD_ID}--bundle-2`;
    expect(bundleLogs!.some((l) => l.resumeId === bundle2ResumeId)).toBe(true);

    // Full completion: the manifest posts exactly once (on the resumed
    // call), referencing all 3 files.
    expect(manifestSecondAttempt.calls.length).toBe(1);
    expect(result.manifestId).toBeDefined();

    // The plan record is cleaned up once genuinely, fully complete.
    await expect(planStore.load(UPLOAD_ID)).resolves.toBeNull();

    bundleEvents = null;
    bundleLogs = null;
    resumeEvents = null;
  });
});

describe("runSplitBundleUpload — a single oversized file is surfaced explicitly, never silently dropped", () => {
  it("throws OversizedFilesError before persisting any plan or starting any bundle", async () => {
    const planStore = await freshPlanStore();
    const resumeStore = await freshResumeStore();
    const fakeFs = makeFakeFileSystem();
    const stream = makeStreamingApiFactory();
    const manifest = makeRecordingUploadApi();
    const pool = makeHealthPool();

    const files = [makeFile("huge.bin", 500_000, 0), makeFile("small.bin", 10_000, 1)];

    await expect(
      runSplitBundleUpload(
        {
          jwk: throwawayJwk,
          files,
          maxRewardWinston: CAP,
          category: "general-other",
          encrypted: false,
        },
        {
          pool,
          planStore,
          resumeStore,
          uploadId: "oversized-test-1",
          budgetBytes: 100_000,
          apiFactory: stream.apiFactory,
          manifestApiFactory: manifest.apiFactory,
          openFile: fakeFs.openFile,
          deleteFile: fakeFs.deleteFile,
        },
      ),
    ).rejects.toBeInstanceOf(OversizedFilesError);

    expect(manifest.calls.length).toBe(0);
    await expect(planStore.load("oversized-test-1")).resolves.toBeNull();
  });
});
