// @vitest-environment node
/**
 * T3 RED/GREEN (`arweave-streaming-post-core`) — the streaming post loop
 * (`streamingPostBundle`), the task that ties the whole streaming-upload
 * architecture together: a real multi-file bundle, assembled via Topic 2's
 * `assembleBundleToFile` into a `FakeBundleAssemblyFile`, posted end to end
 * WITHOUT ever holding the whole bundle in memory for the posting step.
 *
 * `// @vitest-environment node` — same reason as `streaming-build-chunk-
 * body.test.ts`/`streaming-assemble-bundle-to-file.test.ts`: this file
 * constructs real `arweave-js` `Transaction`s (via `@ancientpantheon/
 * arweave-core`'s `postArweaveData`/`createStreamingTransaction`), which
 * needs `arweave/node/lib/*`, not the jsdom-resolved `browser` build.
 *
 * THREE correctness properties are under test (this task's own "done when"):
 *
 * (a) `streamingPostBundle`'s resulting signed transaction's `id`/`data_root`
 *     are IDENTICAL to what calling the EXISTING `postArweaveData` with the
 *     FULL (non-streaming) bundle bytes produces, for the same input/key —
 *     proving a PROTOCOL-IDENTICAL transaction, not just "a" transaction.
 *
 *     RSA-PSS draws a fresh random salt on every `sign()` call — verified
 *     empirically by this project's own `streaming-assemble-bundle-to-
 *     file.test.ts` ("two independent sign() calls on byte-identical input
 *     never produce byte-identical output") — so two REAL, independent
 *     signs of the identical deep hash can never be compared byte-for-byte.
 *     `arweave/node/common.js`'s `Arweave` class declares `crypto` as ONE
 *     process-wide STATIC field (`static crypto = new NodeCryptoDriver()`),
 *     shared verbatim by every `Arweave.init(...)` instance in this process
 *     (confirmed by reading `common.js`'s constructor: every instance's
 *     `Transactions` is built with the literal `Arweave.crypto` reference) —
 *     including `postArweaveData`'s own offline `builder` and
 *     `createStreamingTransaction`'s own. Stubbing `Arweave.crypto.sign` to a
 *     deterministic (input-only-dependent) function for this ONE comparison
 *     neutralizes JUST that inherent per-call randomness, without touching
 *     `signTransaction` itself (still the real, only-signing-path function,
 *     for both flows) — what is actually proven is that BOTH flows feed an
 *     IDENTICAL deep hash into signing (owner/tags/data_root/data_size/
 *     reward/last_tx all match), which is the real "protocol-identical"
 *     claim; `id = hash(signature)` then matches too, deterministically,
 *     under the stub. `Arweave.crypto.hash` (real SHA-256) is left untouched.
 *
 * (b) the sequence of per-chunk POST bodies `streamingPostBundle` sends to
 *     the fake gateway is byte-identical to what the stock `TransactionUploader`
 *     would have sent for the same bundle — proven directly against
 *     `tx.getChunk(idx, fullBuffer)` on the REAL full-buffer oracle
 *     transaction (the exact call `transaction-uploader.js`'s own
 *     `uploadChunk()` makes — `node_modules/arweave/node/lib/
 *     transaction-uploader.js`, read in full for this task).
 *
 * (c) a chunk read never requests more than one chunk's worth of bytes from
 *     the `BundleAssemblyFile` at a time — structural proof via a recording
 *     wrapper, the same discipline every prior task in this project used.
 */

// `fake-indexeddb/auto` — T2's own new resume-checkpoint tests below drive a
// REAL `StreamingPostResumeStore` (T1), the same `fake-indexeddb`-under-node
// convention `streaming-post-resume-store.test.ts` already establishes,
// rather than a hand-rolled store mock. Importing it unconditionally at the
// top of this file (rather than only in the new describe block) is safe and
// matches that sibling test file's own placement — it is a one-time global
// `indexedDB` polyfill, inert for every test in this file that never touches
// it (the two existing `streamingPostBundle` tests above).
import "fake-indexeddb/auto";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

import { describe, it, expect, vi, afterEach } from "vitest";
import Arweave from "arweave";
import type Transaction from "arweave/node/lib/transaction";
import { MAX_CHUNK_SIZE } from "arweave/node/lib/merkle.js";
import {
  postArweaveData,
  computeStreamingDataRoot,
  createGatewayPool,
  type ArweaveJwk,
  type Tag,
  type UploadGatewayApiFactory,
  type ChunkedUploader,
  type StreamingUploadGatewayApi,
  type StreamingUploadGatewayApiFactory,
  type StreamingChunkPostBody,
} from "@ancientpantheon/arweave-core";

import { FakeBundleAssemblyFile } from "../src/library/streaming/fakeBundleAssemblyFile.js";
import { assembleBundleToFile, type AssembleBundleToFileInput } from "../src/library/streaming/assembleBundleToFile.js";
import { streamingPostBundle, resumeStreamingPost } from "../src/library/streaming/streamingPost.js";
import { StreamingPostResumeStore } from "../src/library/streaming/streamingPostResumeStore.js";
import type { IdbFactoryLike } from "../src/library/types.js";
import { makeHealthPool } from "./e3-helpers.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const throwawayJwk = JSON.parse(
  readFileSync(join(FIXTURES, "throwaway-arweave-keyfile.json"), "utf8"),
) as ArweaveJwk;

const ANCHOR = "abcdEFGHijkLMNopQRSTuvWXyz0123456789_-ABCDEF".slice(0, 43);
const PRICE = "1000000000";
const CAP = 1_000_000_000_000n;
const WRAPPING_TAGS: Tag[] = [
  { name: "Bundle-Format", value: "binary" },
  { name: "Bundle-Version", value: "2.0.0" },
];

/** Deterministic, non-trivial per-file bytes. */
function makeDeterministicBytes(size: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    bytes[i] = (i * 31 + seed * 7) & 0xff;
  }
  return bytes;
}

/** Three real files, sized so the assembled bundle spans several Merkle
 *  chunks (MAX_CHUNK_SIZE = 256 KiB) — a genuinely multi-chunk fixture, not
 *  a single-chunk coincidence. */
function makeFiles(): AssembleBundleToFileInput[] {
  const sizes = [50_000, 300_000, 400_000];
  return sizes.map((size, i) => ({
    path: `sub/file-${i}.bin`,
    contentType: "application/octet-stream",
    readData: async () => makeDeterministicBytes(size, i),
  }));
}

/** A `BundleAssemblyFile` wrapping `FakeBundleAssemblyFile`, tracking the
 *  file's logical length (the max extent any `write()` has reached — the
 *  same "size" semantics a real OPFS file has) and recording every `read()`
 *  call's `(offset, length)`, so the streaming-post phase's reads can be
 *  asserted against the planned chunk boundaries (criterion (c)). */
class TrackingBundleAssemblyFile extends FakeBundleAssemblyFile {
  length = 0;
  readCalls: Array<{ offset: number; length: number }> = [];

  override async write(offset: number, bytes: Uint8Array): Promise<void> {
    await super.write(offset, bytes);
    this.length = Math.max(this.length, offset + bytes.byteLength);
  }

  override async read(offset: number, length: number): Promise<Uint8Array> {
    this.readCalls.push({ offset, length });
    return super.read(offset, length);
  }
}

/** A fake `UploadGatewayApiFactory` (the EXISTING non-streaming seam) that
 *  captures the signed tx handed to `getUploader` — mirrors
 *  `tests/upload.test.ts`'s own `makeFakeFactory`/`e3-helpers.ts`'s
 *  `makeRecordingUploadApi` conventions. */
function makeOracleApiFactory(): {
  apiFactory: UploadGatewayApiFactory;
  capturedTx: Transaction[];
} {
  const capturedTx: Transaction[] = [];
  class FakeChunkedUploader implements ChunkedUploader {
    #done = false;
    get isComplete(): boolean {
      return this.#done;
    }
    async uploadChunk(): Promise<void> {
      this.#done = true;
    }
  }
  const apiFactory: UploadGatewayApiFactory = () => ({
    async getAnchor() {
      return ANCHOR;
    },
    async getPrice() {
      return PRICE;
    },
    async getUploader(tx: Transaction) {
      capturedTx.push(tx);
      return new FakeChunkedUploader();
    },
  });
  return { apiFactory, capturedTx };
}

/** A fake `StreamingUploadGatewayApiFactory` (the NEW seam) that captures the
 *  posted transaction and every chunk body, in order. */
function makeStreamingApiFactory(): {
  apiFactory: StreamingUploadGatewayApiFactory;
  capturedTx: Transaction[];
  postedChunks: StreamingChunkPostBody[];
} {
  const capturedTx: Transaction[] = [];
  const postedChunks: StreamingChunkPostBody[] = [];
  const apiFactory: StreamingUploadGatewayApiFactory = (): StreamingUploadGatewayApi => ({
    async getAnchor() {
      return ANCHOR;
    },
    async getPrice() {
      return PRICE;
    },
    async postTransaction(tx) {
      capturedTx.push(tx as unknown as Transaction);
    },
    async postChunk(body) {
      postedChunks.push(body);
    },
  });
  return { apiFactory, capturedTx, postedChunks };
}

describe("streamingPostBundle — protocol-identical, structurally-streamed posting", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("matches the non-streaming postArweaveData path's id/data_root, the stock uploader's chunk bodies, and never over-reads a chunk", async () => {
    // Stub the ONE process-wide shared crypto driver's `sign` to a
    // deterministic (input-only) function, neutralizing RSA-PSS's inherent
    // per-call random salt for THIS comparison only — see this file's own
    // module doc comment for the full grounding. `hash` (real SHA-256) is
    // left untouched, so `id = hash(signature)` stays deterministic given a
    // deterministic `signature`.
    vi.spyOn(Arweave.crypto, "sign").mockImplementation(async (_jwk, data) =>
      new Uint8Array(createHash("sha256").update(Buffer.from(data)).digest()),
    );

    const bundleFile = new TrackingBundleAssemblyFile();
    await assembleBundleToFile(bundleFile, {
      jwk: throwawayJwk,
      files: makeFiles(),
      category: "general-other",
      encrypted: false,
    });
    const totalLength = bundleFile.length;
    const fullBuffer = await bundleFile.read(0, totalLength);

    // --- Oracle: the EXISTING non-streaming path, fed the full buffer. ---
    const oracle = makeOracleApiFactory();
    const oraclePool = makeHealthPool();
    const oracleResult = await postArweaveData(
      oraclePool,
      { jwk: throwawayJwk, data: fullBuffer, tags: WRAPPING_TAGS, maxRewardWinston: CAP },
      { apiFactory: oracle.apiFactory },
    );
    const fullTx = oracle.capturedTx[0]!;
    expect(fullTx.chunks).toBeDefined();
    // Sanity: a genuinely multi-chunk fixture, not a single-chunk coincidence.
    expect(fullTx.chunks!.chunks.length).toBeGreaterThan(2);

    // --- The new streaming path: data_root computed via T1, read one chunk
    // at a time from the SAME bundle file; reads reset below so criterion
    // (c) only measures the POSTING phase's own reads, not this step's. ---
    const streaming = await computeStreamingDataRoot(totalLength, (offset, size) =>
      bundleFile.read(offset, size),
    );
    bundleFile.readCalls = [];

    const stream = makeStreamingApiFactory();
    const streamPool = makeHealthPool();
    const progressCalls: Array<[number, number]> = [];
    const streamResult = await streamingPostBundle(
      streamPool,
      {
        jwk: throwawayJwk,
        tags: WRAPPING_TAGS,
        maxRewardWinston: CAP,
        dataSize: totalLength,
        streaming,
        file: bundleFile,
      },
      {
        apiFactory: stream.apiFactory,
        onProgress: (uploaded, total) => progressCalls.push([uploaded, total]),
      },
    );

    // (a) PROTOCOL-IDENTICAL: id and data_root match the full-buffer oracle.
    expect(streamResult.id).toBe(oracleResult.id);
    expect(streamResult.data_root).toBe(fullTx.data_root);
    expect(streamResult.reward).toBe(oracleResult.reward);

    // (b) The posted chunk-body SEQUENCE is byte-identical to what the stock
    // `TransactionUploader` would have sent — `tx.getChunk(idx, data)` is
    // the EXACT call `transaction-uploader.js`'s own `uploadChunk()` makes.
    expect(stream.postedChunks.length).toBe(fullTx.chunks!.chunks.length);
    for (let idx = 0; idx < fullTx.chunks!.chunks.length; idx++) {
      expect(stream.postedChunks[idx]).toEqual(fullTx.getChunk(idx, fullBuffer));
    }

    // (c) STRUCTURAL PROOF: no read during the posting phase ever requested
    // more than one chunk's worth of bytes, and each request matches the
    // EXACT planned boundary for its chunk, in order.
    expect(bundleFile.readCalls.length).toBe(streaming.chunks.length);
    bundleFile.readCalls.forEach((call, idx) => {
      const chunk = streaming.chunks[idx]!;
      expect(call.offset).toBe(chunk.minByteRange);
      expect(call.length).toBe(chunk.maxByteRange - chunk.minByteRange);
      expect(call.length).toBeLessThanOrEqual(MAX_CHUNK_SIZE);
    });

    // Progress was tracked across every chunk, ending at completion.
    expect(progressCalls.at(-1)).toEqual([streaming.chunks.length, streaming.chunks.length]);

    // The transaction posted to the streaming gateway never carried the real
    // bundle bytes.
    expect(stream.capturedTx[0]!.data.byteLength).toBe(0);
  });

  it("throws InvalidUploadParamsError when maxRewardWinston is omitted, before any pool call", async () => {
    const bundleFile = new TrackingBundleAssemblyFile();
    await bundleFile.write(0, makeDeterministicBytes(10, 1));
    const streaming = await computeStreamingDataRoot(10, (offset, size) => bundleFile.read(offset, size));
    const stream = makeStreamingApiFactory();
    const pool = makeHealthPool();

    await expect(
      streamingPostBundle(
        pool,
        {
          jwk: throwawayJwk,
          tags: WRAPPING_TAGS,
          // @ts-expect-error — deliberately omitted to assert the required-cap guard.
          maxRewardWinston: undefined,
          dataSize: 10,
          streaming,
          file: bundleFile,
        },
        { apiFactory: stream.apiFactory },
      ),
    ).rejects.toMatchObject({ name: "InvalidUploadParamsError", field: "maxRewardWinston" });

    expect(stream.capturedTx.length).toBe(0);
    expect(stream.postedChunks.length).toBe(0);
  });
});

/**
 * T2 RED/GREEN (`arweave-streaming-post-resume`) — checkpoint persistence
 * wired into the post loop (`streamingPostBundle`'s new `opts.resume`), and
 * the resume entry point (`resumeStreamingPost`).
 *
 * Two correctness properties are under test, beyond T3's own
 * protocol-identical proof above (still exercised, unaffected, by the first
 * describe block — `opts.resume` is entirely opt-in):
 *
 * (d) an interruption (a fake gateway that starts failing after N chunks)
 *     leaves a resume record whose `chunkIndex` is EXACTLY N, `txPosted`
 *     true — proving checkpoints are written incrementally, not just once
 *     at the end (which an interrupted run never reaches).
 * (e) `resumeStreamingPost`, given a FRESH fake gateway, completes without
 *     ever re-signing (`Arweave.crypto.sign`'s call count is unchanged
 *     across the resume call), ever re-reading the already-posted chunks'
 *     bytes (structural proof via `TrackingBundleAssemblyFile.readCalls`,
 *     the SAME discipline criterion (c) above already uses), or ever
 *     re-posting chunks `0..N-1` (the fresh gateway's own captured tx/chunk
 *     lists start EMPTY and, after resuming, contain ONLY the remaining
 *     chunks, byte-identical to what an uninterrupted run would have sent
 *     at those same indices) — and reaches the IDENTICAL final `id`/
 *     `data_root`/`reward` an uninterrupted run of the same input produces.
 */

/** A fresh, isolated `StreamingPostResumeStore` — a new random database name
 *  per call, mirroring `streaming-post-resume-store.test.ts`'s own
 *  `freshStore()` helper, so no two tests in this file ever share state. */
function freshResumeStore(): Promise<StreamingPostResumeStore> {
  return StreamingPostResumeStore.open({
    indexedDB: globalThis.indexedDB as unknown as IdbFactoryLike,
    databaseName: `codex-streaming-post-resume-${Math.random().toString(36).slice(2)}`,
  });
}

/** A fake `StreamingUploadGatewayApiFactory` whose `postChunk` succeeds for
 *  exactly the first `stopAfter` calls, then fails on every call after —
 *  simulating a gateway/connection that dies partway through an upload
 *  (the SAME "retried in place, then propagates" semantics `streamingPost
 *  .ts`'s own `MAX_CHUNK_RETRIES` loop already exhausts against ANY
 *  persistent per-chunk failure, interrupting or not). */
function makeInterruptingStreamingApiFactory(stopAfter: number): {
  apiFactory: StreamingUploadGatewayApiFactory;
  capturedTx: Transaction[];
  postedChunks: StreamingChunkPostBody[];
} {
  const capturedTx: Transaction[] = [];
  const postedChunks: StreamingChunkPostBody[] = [];
  const apiFactory: StreamingUploadGatewayApiFactory = (): StreamingUploadGatewayApi => ({
    async getAnchor() {
      return ANCHOR;
    },
    async getPrice() {
      return PRICE;
    },
    async postTransaction(tx) {
      capturedTx.push(tx as unknown as Transaction);
    },
    async postChunk(body) {
      if (postedChunks.length >= stopAfter) {
        throw new Error("simulated gateway interruption");
      }
      postedChunks.push(body);
    },
  });
  return { apiFactory, capturedTx, postedChunks };
}

/** Builds the same real multi-chunk bundle fixture the T3 tests above use,
 *  with its streaming `data_root` already computed — shared setup for the
 *  checkpoint tests below, each of which drives its OWN interruption/resume
 *  pair against a fresh file/store so no two tests ever interact. */
async function buildFixture() {
  const bundleFile = new TrackingBundleAssemblyFile();
  await assembleBundleToFile(bundleFile, {
    jwk: throwawayJwk,
    files: makeFiles(),
    category: "general-other",
    encrypted: false,
  });
  const totalLength = bundleFile.length;
  const streaming = await computeStreamingDataRoot(totalLength, (offset, size) =>
    bundleFile.read(offset, size),
  );
  bundleFile.readCalls = [];
  return { bundleFile, totalLength, streaming };
}

describe("streamingPostBundle + resumeStreamingPost — persisted checkpoint resume (T2, arweave-streaming-post-resume)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("checkpoints after the tx post and after every successful chunk — an interruption after N chunks leaves chunkIndex exactly N", async () => {
    vi.spyOn(Arweave.crypto, "sign").mockImplementation(async (_jwk, data) =>
      new Uint8Array(createHash("sha256").update(Buffer.from(data)).digest()),
    );

    const { bundleFile, totalLength, streaming } = await buildFixture();
    expect(streaming.chunks.length).toBeGreaterThan(2);
    const STOP_AFTER = 1;

    const store = await freshResumeStore();
    const interrupting = makeInterruptingStreamingApiFactory(STOP_AFTER);
    const pool = makeHealthPool();

    await expect(
      streamingPostBundle(
        pool,
        {
          jwk: throwawayJwk,
          tags: WRAPPING_TAGS,
          maxRewardWinston: CAP,
          dataSize: totalLength,
          streaming,
          file: bundleFile,
        },
        {
          apiFactory: interrupting.apiFactory,
          resume: { store, id: "upload-interrupt-1", fileName: "bundle-upload-interrupt-1.bin" },
        },
      ),
    ).rejects.toThrow();

    // Exactly STOP_AFTER chunks were actually posted before the gateway
    // started failing...
    expect(interrupting.postedChunks.length).toBe(STOP_AFTER);

    // ...and the persisted record reflects EXACTLY that progress: the tx
    // step (which ran before any chunk) succeeded, and chunkIndex is
    // exactly STOP_AFTER — not 0 (never checkpointed), not the full count
    // (checkpointed only at the very end), proving incremental writes.
    const record = await store.load("upload-interrupt-1");
    expect(record).not.toBeNull();
    expect(record!.txPosted).toBe(true);
    expect(record!.chunkIndex).toBe(STOP_AFTER);
    expect(record!.fileName).toBe("bundle-upload-interrupt-1.bin");
    expect(record!.chunks.length).toBe(streaming.chunks.length);
    expect(record!.proofs.length).toBe(streaming.proofs.length);
  });

  it("resumeStreamingPost continues from the checkpoint on a FRESH gateway: never re-signs, never re-reads already-posted chunks, never re-posts them, and reaches the same completion state an uninterrupted run would", async () => {
    vi.spyOn(Arweave.crypto, "sign").mockImplementation(async (_jwk, data) =>
      new Uint8Array(createHash("sha256").update(Buffer.from(data)).digest()),
    );

    const { bundleFile, totalLength, streaming } = await buildFixture();
    const STOP_AFTER = 1;
    expect(streaming.chunks.length).toBeGreaterThan(STOP_AFTER + 1);

    const store = await freshResumeStore();
    const interrupting = makeInterruptingStreamingApiFactory(STOP_AFTER);

    await expect(
      streamingPostBundle(
        makeHealthPool(),
        {
          jwk: throwawayJwk,
          tags: WRAPPING_TAGS,
          maxRewardWinston: CAP,
          dataSize: totalLength,
          streaming,
          file: bundleFile,
        },
        {
          apiFactory: interrupting.apiFactory,
          resume: { store, id: "upload-resume-1", fileName: "bundle-upload-resume-1.bin" },
        },
      ),
    ).rejects.toThrow();

    // --- Oracle: an UNINTERRUPTED run of the IDENTICAL input (same jwk,
    // tags, dataSize, streaming data_root, and — because `sign` is stubbed
    // deterministically above — the SAME resulting signed tx), against its
    // own independent fresh fake gateway, never failing. This is the
    // baseline `resumeStreamingPost`'s own completion state must match. ---
    const oracle = makeStreamingApiFactory();
    const oracleResult = await streamingPostBundle(
      makeHealthPool(),
      {
        jwk: throwawayJwk,
        tags: WRAPPING_TAGS,
        maxRewardWinston: CAP,
        dataSize: totalLength,
        streaming,
        file: bundleFile,
      },
      { apiFactory: oracle.apiFactory },
    );

    // Isolate the resume phase's own reads (criterion (c)'s own discipline,
    // reused here) from every read the interrupted run / oracle run above
    // already made.
    bundleFile.readCalls = [];
    const signCallsBeforeResume = (Arweave.crypto.sign as unknown as { mock: { calls: unknown[] } })
      .mock.calls.length;

    const fresh = makeStreamingApiFactory();
    const deletedFileNames: string[] = [];
    const resumeResult = await resumeStreamingPost("upload-resume-1", makeHealthPool(), {
      store,
      apiFactory: fresh.apiFactory,
      openFile: async () => bundleFile,
      // No real OPFS under Node — inject a fake, and assert it fires with
      // the persisted `fileName` on completion (the default-delete policy,
      // made explicit/overridable per this topic's own design doc).
      deleteFile: async (fileName) => {
        deletedFileNames.push(fileName);
      },
    });

    // Never re-signs: `Arweave.crypto.sign`'s call count is UNCHANGED across
    // the whole `resumeStreamingPost` call — the signature was already
    // persisted, never recomputed.
    expect(
      (Arweave.crypto.sign as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
    ).toBe(signCallsBeforeResume);

    // Never re-posts the transaction itself (txPosted was already true).
    expect(fresh.capturedTx.length).toBe(0);

    // Never re-posts, and never re-reads, chunks `0..STOP_AFTER-1`: the
    // fresh gateway's own chunk list — starting EMPTY — contains ONLY the
    // remaining chunks, in order, byte-identical to the oracle's own chunks
    // at those same indices (chunk-body construction depends only on
    // (idx, chunkMeta, file bytes), never on which gateway receives it).
    const remaining = streaming.chunks.length - STOP_AFTER;
    expect(fresh.postedChunks.length).toBe(remaining);
    for (let i = 0; i < remaining; i++) {
      expect(fresh.postedChunks[i]).toEqual(oracle.postedChunks[STOP_AFTER + i]);
    }

    // Structural proof: every read the resume phase made starts at or past
    // chunk STOP_AFTER's own offset — none of chunks `0..STOP_AFTER-1`'s
    // bytes were re-read from the (reopened) bundle file.
    expect(bundleFile.readCalls.length).toBe(remaining);
    bundleFile.readCalls.forEach((call, i) => {
      const chunk = streaming.chunks[STOP_AFTER + i]!;
      expect(call.offset).toBe(chunk.minByteRange);
      expect(call.length).toBe(chunk.maxByteRange - chunk.minByteRange);
    });

    // Final completion state matches the uninterrupted oracle run exactly.
    expect(resumeResult.id).toBe(oracleResult.id);
    expect(resumeResult.data_root).toBe(oracleResult.data_root);
    expect(resumeResult.reward).toBe(oracleResult.reward);

    // Completion clears the resume record — nothing left to resume again.
    await expect(store.load("upload-resume-1")).resolves.toBeNull();

    // Completion also deletes the OPFS bundle file by default (explicit,
    // overridable policy — see `StreamingPostResumeOptions
    // .deleteFileOnComplete`'s own doc comment).
    expect(deletedFileNames).toEqual(["bundle-upload-resume-1.bin"]);
  });
});

/**
 * REGRESSION (`arweave-streaming-checkpoint-regression`) — the persisted
 * checkpoint must never move BACKWARD.
 *
 * Mechanism under test (confirmed directly against the real code, not
 * assumed): `streamingPostBundle` wraps `postTxAndRemainingChunks` in ONE
 * `pool.execute(...)` call, passing LITERAL `txAlreadyPosted: false,
 * startChunkIndex: 0` into the closure. `createGatewayPool`'s own `execute`
 * (`arweave-core/src/gateway/pool.ts`) re-invokes that SAME closure once per
 * attempt (`maxAttemptsPerEndpoint`, default 3) — so a second attempt still
 * sees `txAlreadyPosted: false`/`startChunkIndex: 0`, re-posts the tx, and
 * re-runs `saveCheckpoint(startChunkIndex /* 0 *\/, true)` — overwriting an
 * already-persisted, already-earned `chunkIndex` with a SMALLER value. A
 * crash in that window leaves the durable record claiming less progress than
 * the gateway actually accepted, violating this module's own documented
 * "never re-posts an already-successful chunk" guarantee.
 *
 * The observation point is the REAL `StreamingPostResumeStore.save` (spy-
 * wrapped, calling through to the real IndexedDB write) — so what is asserted
 * is the sequence of values that genuinely reach durable storage, not an
 * in-memory proxy for it.
 */

/** A fake `StreamingUploadGatewayApiFactory` that accepts a chunk POST ONLY
 *  for the offsets in `acceptOffsets`, and throws for every other chunk —
 *  the same shape as `makeInterruptingStreamingApiFactory` above, but keyed
 *  on the chunk's own identity (its `offset`) rather than a call count, so it
 *  keeps accepting chunk 0 and keeps rejecting chunk 1 across EVERY pool
 *  attempt (exactly what forces the outer `pool.execute` retry while chunk
 *  0's progress has already been checkpointed). */
function makeChunkOffsetGatedApiFactory(acceptOffsets: ReadonlySet<string>): {
  apiFactory: StreamingUploadGatewayApiFactory;
  capturedTx: Transaction[];
  postedChunks: StreamingChunkPostBody[];
} {
  const capturedTx: Transaction[] = [];
  const postedChunks: StreamingChunkPostBody[] = [];
  const apiFactory: StreamingUploadGatewayApiFactory = (): StreamingUploadGatewayApi => ({
    async getAnchor() {
      return ANCHOR;
    },
    async getPrice() {
      return PRICE;
    },
    async postTransaction(tx) {
      capturedTx.push(tx as unknown as Transaction);
    },
    async postChunk(body) {
      if (!acceptOffsets.has(body.offset)) {
        throw new Error(`simulated gateway rejection for chunk at offset ${body.offset}`);
      }
      postedChunks.push(body);
    },
  });
  return { apiFactory, capturedTx, postedChunks };
}

describe("streamingPostBundle — checkpoint monotonicity across a pool-level retry (regression, arweave-streaming-checkpoint-regression)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never persists a chunkIndex smaller than one already persisted, even when pool.execute retries the whole post from the top", async () => {
    vi.spyOn(Arweave.crypto, "sign").mockImplementation(async (_jwk, data) =>
      new Uint8Array(createHash("sha256").update(Buffer.from(data)).digest()),
    );

    const { bundleFile, totalLength, streaming } = await buildFixture();
    // A genuinely multi-chunk fixture: chunk 0 can succeed while chunk 1 fails.
    expect(streaming.chunks.length).toBeGreaterThan(2);

    // Chunk 0 is accepted forever; every later chunk is rejected forever. So
    // each pool attempt: tx posts → chunk 0 posts (progress earned and
    // checkpointed at chunkIndex 1) → chunk 1 exhausts MAX_CHUNK_RETRIES →
    // the whole attempt throws → the pool re-invokes the SAME closure.
    const gateway = makeChunkOffsetGatedApiFactory(
      new Set([streaming.proofs[0]!.offset.toString()]),
    );

    // The REAL pool — real retry mechanics, real default `maxAttemptsPerEndpoint`
    // (3), with the INSTANT `sleep` seam so no backoff wall-time elapses (the
    // same convention `e2-gateway-rotation.test.ts` establishes).
    const pool = createGatewayPool({
      endpoints: ["https://gateway-regression.example"],
      sleep: async () => {},
    });

    // The REAL resume store, spy-wrapped to record EVERY chunkIndex that
    // actually reaches durable storage (the spy calls through).
    const store = await freshResumeStore();
    const realSave = store.save.bind(store);
    const persistedChunkIndexes: number[] = [];
    vi.spyOn(store, "save").mockImplementation(async (record) => {
      persistedChunkIndexes.push(record.chunkIndex);
      await realSave(record);
    });

    await expect(
      streamingPostBundle(
        pool,
        {
          jwk: throwawayJwk,
          tags: WRAPPING_TAGS,
          maxRewardWinston: CAP,
          dataSize: totalLength,
          streaming,
          file: bundleFile,
        },
        {
          apiFactory: gateway.apiFactory,
          resume: {
            store,
            id: "upload-checkpoint-monotonic",
            fileName: "bundle-upload-checkpoint-monotonic.bin",
          },
        },
      ),
    ).rejects.toThrow();

    // The outer pool-level retry genuinely happened — the SAME closure ran
    // more than once, re-posting the transaction each time (this is what makes
    // the stale-`startChunkIndex` write reachable at all).
    expect(gateway.capturedTx.length).toBeGreaterThan(1);

    // Real progress WAS earned and checkpointed: chunk 0 posted successfully,
    // so `chunkIndex: 1` reached durable storage at least once.
    expect(persistedChunkIndexes).toContain(1);

    // THE REGRESSION ASSERTION: the sequence of persisted `chunkIndex` values
    // is non-decreasing — a value that reached durable storage is never
    // replaced by a SMALLER one. (Compared against its own sorted copy so the
    // failure diff shows the real observed sequence.)
    expect(persistedChunkIndexes).toEqual([...persistedChunkIndexes].sort((a, b) => a - b));

    // And the record left behind for a later `resumeStreamingPost` reflects the
    // furthest progress ever achieved, not a regressed value.
    const record = await store.load("upload-checkpoint-monotonic");
    expect(record).not.toBeNull();
    expect(record!.txPosted).toBe(true);
    expect(record!.chunkIndex).toBe(Math.max(...persistedChunkIndexes));
  });
});
