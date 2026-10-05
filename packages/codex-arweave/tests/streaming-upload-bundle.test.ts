// @vitest-environment node
/**
 * T2 RED/GREEN (`arweave-streaming-ui`) — the new streaming-engine-calling
 * routing functions `flow.ts` will eventually route to (T3, Wave 2, NOT this
 * task's job): `uploadBundleStreaming` (the bundle analog of `arweave-core`'s
 * `uploadBundle`) and `uploadStreaming` (the single-file analog of
 * `uploadData`).
 *
 * `// @vitest-environment node` — same reason `streaming-post.test.ts`/
 * `streaming-post-resume-store.test.ts` already use it: this file builds
 * real `arweave-js` `Transaction`s (via `arweave-core`'s
 * `createStreamingTransaction`/`postArweaveData`) AND drives a real
 * `fake-indexeddb`-backed `StreamingPostResumeStore`, whose structured-clone
 * internals need every `Uint8Array` in the SAME realm as this package's
 * default jsdom environment otherwise gives its own.
 *
 * FOUR correctness properties are under test (this task's own "done when"):
 *
 * (1) `uploadBundleStreaming`'s resolved value is `UploadBundleResult`-SHAPE-
 *     compatible with the real, unmodified `uploadBundle`'s own resolved
 *     value, for the SAME unencrypted multi-file input. SHAPE comparison
 *     (keys + value types), not exact-id comparison, is deliberate here —
 *     unlike `streaming-post.test.ts`'s own protocol-identical proof (which
 *     needed a deterministic-`sign` stub specifically because it asserts
 *     `streamResult.id === oracleResult.id`), this test never compares an id
 *     VALUE between the two independently-signed runs, so RSA-PSS's per-call
 *     random salt never enters the picture and no stub is needed. What IS
 *     asserted value-for-value where it is genuinely deterministic
 *     (file paths, in order) still is.
 * (2) An ENCRYPTED run's bytes ACTUALLY POSTED to the fake gateway (captured
 *     chunk-by-chunk, reconstructed in posted order), when decrypted via
 *     `arweave-streaming-encryption`'s `decryptStream` using the same key,
 *     round-trip byte-identical to each file's original plaintext.
 * (3) A REAL `StreamingPostResumeStore` (fake-indexeddb-backed) genuinely has
 *     its resume record written mid-flight (an interrupted run leaves a
 *     record whose `chunkIndex`/`txPosted` reflect real progress) and
 *     cleared on a full, successful completion — never bypassed.
 * (4) `uploadStreaming`'s resolved value is `UploadResult`-shape-compatible
 *     with the real, unmodified `uploadData`'s own resolved value, for the
 *     SAME unencrypted single-file input — the SAME shape-only reasoning as
 *     (1) applies (`ownerAddress`, uniquely, IS asserted value-equal: it is
 *     a pure function of the shared jwk, not of signing's own randomness).
 */

import "fake-indexeddb/auto";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, it, expect, vi } from "vitest";
import type { DataItem } from "arbundles";
import {
  uploadBundle,
  uploadData,
  type ArweaveJwk,
  type StreamingUploadGatewayApi,
  type StreamingUploadGatewayApiFactory,
  type StreamingChunkPostBody,
} from "@ancientpantheon/arweave-core";

import { FakeBundleAssemblyFile } from "../src/library/streaming/fakeBundleAssemblyFile.js";
import {
  uploadBundleStreaming,
  uploadStreaming,
} from "../src/library/streaming/uploadBundleStreaming.js";
import type { AssembleBundleToFileInput } from "../src/library/streaming/assembleBundleToFile.js";
import { StreamingPostResumeStore } from "../src/library/streaming/streamingPostResumeStore.js";
import type { IdbFactoryLike } from "../src/library/types.js";
import { deriveAccountAesKey } from "../src/crypto/fileEncryption.js";
import { decryptStream, ENCRYPTION_CHUNK_SIZE } from "../src/crypto/streamingFileEncryption.js";
import { makeHealthPool, makeRecordingUploadApi } from "./e3-helpers.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const throwawayJwk = JSON.parse(
  readFileSync(join(FIXTURES, "throwaway-arweave-keyfile.json"), "utf8"),
) as ArweaveJwk;

const ANCHOR = "abcdEFGHijkLMNopQRSTuvWXyz0123456789_-ABCDEF".slice(0, 43);
const PRICE = "1000000000";
const CAP = 1_000_000_000_000n;

/** Deterministic, non-trivial per-file bytes — same convention
 *  `streaming-post.test.ts`/`streaming-assemble-bundle-to-file.test.ts`
 *  already use. */
function makeDeterministicBytes(size: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    bytes[i] = (i * 31 + seed * 7) & 0xff;
  }
  return bytes;
}

/** Three real files, sized so the assembled bundle spans several Merkle
 *  chunks — mirrors `streaming-post.test.ts`'s own `makeFiles` fixture, so a
 *  resume interruption (test 3) has more than one chunk to interrupt
 *  between. Returns BOTH the lazy `AssembleBundleToFileInput[]` shape the
 *  streaming path needs and the plain bytes, so an oracle comparison can
 *  build its own eager `UploadBundleFile[]` from the IDENTICAL content. */
function makeFileFixtures(): { path: string; contentType: string; bytes: Uint8Array }[] {
  const sizes = [50_000, 300_000, 400_000];
  return sizes.map((size, i) => ({
    path: `sub/file-${i}.bin`,
    contentType: "application/octet-stream",
    bytes: makeDeterministicBytes(size, i),
  }));
}

function toStreamingInputs(
  fixtures: ReturnType<typeof makeFileFixtures>,
): AssembleBundleToFileInput[] {
  return fixtures.map((f) => ({
    path: f.path,
    contentType: f.contentType,
    readData: async () => f.bytes,
  }));
}

/** A fake `StreamingUploadGatewayApiFactory` that captures the posted
 *  transaction and every chunk body, in order — mirrors
 *  `streaming-post.test.ts`'s own `makeStreamingApiFactory`. */
function makeStreamingApiFactory(): {
  apiFactory: StreamingUploadGatewayApiFactory;
  postedChunks: StreamingChunkPostBody[];
} {
  const postedChunks: StreamingChunkPostBody[] = [];
  const apiFactory: StreamingUploadGatewayApiFactory = (): StreamingUploadGatewayApi => ({
    async getAnchor() {
      return ANCHOR;
    },
    async getPrice() {
      return PRICE;
    },
    async postTransaction() {
      // Not inspected by this file's own assertions.
    },
    async postChunk(body) {
      postedChunks.push(body);
    },
  });
  return { apiFactory, postedChunks };
}

/** A fake `StreamingUploadGatewayApiFactory` whose `postChunk` succeeds for
 *  exactly the first `stopAfter` calls, then fails on every call after —
 *  mirrors `streaming-post.test.ts`'s own `makeInterruptingStreamingApiFactory`. */
function makeInterruptingStreamingApiFactory(stopAfter: number): {
  apiFactory: StreamingUploadGatewayApiFactory;
  postedChunks: StreamingChunkPostBody[];
} {
  const postedChunks: StreamingChunkPostBody[] = [];
  const apiFactory: StreamingUploadGatewayApiFactory = (): StreamingUploadGatewayApi => ({
    async getAnchor() {
      return ANCHOR;
    },
    async getPrice() {
      return PRICE;
    },
    async postTransaction() {
      // Not inspected by this file's own assertions.
    },
    async postChunk(body) {
      if (postedChunks.length >= stopAfter) {
        throw new Error("simulated gateway interruption");
      }
      postedChunks.push(body);
    },
  });
  return { apiFactory, postedChunks };
}

/** A fresh, isolated `StreamingPostResumeStore` — mirrors
 *  `streaming-post.test.ts`'s/`streaming-post-resume-store.test.ts`'s own
 *  `freshStore()` helper, so no two tests ever share state. */
function freshResumeStore(): Promise<StreamingPostResumeStore> {
  return StreamingPostResumeStore.open({
    indexedDB: globalThis.indexedDB as unknown as IdbFactoryLike,
    databaseName: `codex-streaming-upload-bundle-${Math.random().toString(36).slice(2)}`,
  });
}

describe("uploadBundleStreaming — UploadBundleResult shape parity with the real uploadBundle", () => {
  it("matches uploadBundle's shape (keys + value types; deterministic fields byte-equal) for an unencrypted multi-file run", async () => {
    const fixtures = makeFileFixtures();

    const store = await freshResumeStore();
    const stream = makeStreamingApiFactory();
    const streamPool = makeHealthPool();

    const streamResult = await uploadBundleStreaming(
      {
        jwk: throwawayJwk,
        files: toStreamingInputs(fixtures),
        maxRewardWinston: CAP,
        category: "general-other",
        encrypted: false,
      },
      {
        pool: streamPool,
        resumeStore: store,
        apiFactory: stream.apiFactory,
        openFile: async () => new FakeBundleAssemblyFile(),
        deleteFile: async () => {},
      },
    );

    const oracle = makeRecordingUploadApi();
    const oraclePool = makeHealthPool();
    const oracleResult = await uploadBundle(
      oraclePool,
      {
        jwk: throwawayJwk,
        files: fixtures.map((f) => ({ path: f.path, data: f.bytes, contentType: f.contentType })),
        maxRewardWinston: CAP,
        category: "general-other",
        encrypted: false,
      },
      { apiFactory: oracle.apiFactory },
    );

    // Field-for-field shape parity — never an id VALUE comparison (see the
    // module doc comment above for why that is the deliberate, justified
    // choice for this test).
    expect(Object.keys(streamResult).sort()).toEqual(Object.keys(oracleResult).sort());
    expect(typeof streamResult.manifestId).toBe("string");
    expect(typeof oracleResult.manifestId).toBe("string");
    expect(typeof streamResult.uploadId).toBe("string");
    expect(typeof oracleResult.uploadId).toBe("string");
    expect(Array.isArray(streamResult.fileIds)).toBe(true);
    expect(streamResult.fileIds.length).toBe(oracleResult.fileIds.length);
    streamResult.fileIds.forEach((entry, i) => {
      expect(Object.keys(entry).sort()).toEqual(Object.keys(oracleResult.fileIds[i]!).sort());
      expect(typeof entry.path).toBe("string");
      expect(typeof entry.id).toBe("string");
    });
    // Paths ARE deterministic (not touched by signing) — a genuine
    // value-level check, not merely "some string".
    expect(streamResult.fileIds.map((f) => f.path)).toEqual(fixtures.map((f) => f.path));
  });
});

describe("uploadStreaming — UploadResult shape parity with the real uploadData", () => {
  it("matches uploadData's shape (keys + value types; ownerAddress byte-equal) for an unencrypted single-file run", async () => {
    const bytes = makeDeterministicBytes(500_000, 42);

    const store = await freshResumeStore();
    const stream = makeStreamingApiFactory();
    const streamPool = makeHealthPool();

    const streamResult = await uploadStreaming(
      {
        jwk: throwawayJwk,
        readData: async (offset, length) => bytes.subarray(offset, offset + length),
        totalLength: bytes.byteLength,
        contentType: "application/octet-stream",
        maxRewardWinston: CAP,
        category: "general-other",
        encrypted: false,
      },
      {
        pool: streamPool,
        resumeStore: store,
        apiFactory: stream.apiFactory,
        openFile: async () => new FakeBundleAssemblyFile(),
        deleteFile: async () => {},
      },
    );

    const oracle = makeRecordingUploadApi();
    const oraclePool = makeHealthPool();
    const oracleResult = await uploadData(
      oraclePool,
      {
        jwk: throwawayJwk,
        data: bytes,
        contentType: "application/octet-stream",
        maxRewardWinston: CAP,
        category: "general-other",
        encrypted: false,
      },
      { apiFactory: oracle.apiFactory },
    );

    expect(Object.keys(streamResult).sort()).toEqual(Object.keys(oracleResult).sort());
    expect(typeof streamResult.id).toBe("string");
    expect(typeof streamResult.itemId).toBe("string");
    expect(Array.isArray(streamResult.tags)).toBe(true);
    expect(streamResult.tags.length).toBeGreaterThan(0);
    streamResult.tags.forEach((t) => {
      expect(typeof t.name).toBe("string");
      expect(typeof t.value).toBe("string");
    });
    // ownerAddress is a pure function of the shared jwk (addressOf), never
    // touched by signing's own randomness — a genuine value-level check.
    expect(streamResult.ownerAddress).toBe(oracleResult.ownerAddress);
  });
});

/**
 * Base64url-decodes `value` — the EXACT inverse of
 * `buildStreamingChunkBody.ts`'s own local `base64url` encode (standard
 * `"base64"` + the RFC 4648 §5 substitution), so a chunk body's `chunk`
 * field can be read back to raw bytes in this test.
 */
function base64urlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const withPadding = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  return new Uint8Array(Buffer.from(withPadding, "base64"));
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return out;
}

/** Opt-in capture of every real `{item, rawId}` pair `assembleBundleToFile`
 *  (called internally by `uploadBundleStreaming`) actually signs, in call
 *  order — mirrors `streaming-assemble-bundle-to-file.test.ts`'s own
 *  identically-purposed transparent `vi.mock("arbundles")` recording
 *  pass-through, reused here (not reinvented) for the SAME reason: deriving
 *  each file's ciphertext BYTE REGION within the assembled bundle requires
 *  knowing each item's real final raw/data length, which
 *  `AssembleBundleToFileResult` does not expose. `null` means "don't
 *  capture" so a test that doesn't need this never retains a stray
 *  reference. */
let capturedSignCalls: { item: DataItem; rawId: Buffer }[] | null = null;

vi.mock("arbundles", async (importOriginal) => {
  const original = await importOriginal<typeof import("arbundles")>();
  return {
    ...original,
    sign: async (...args: Parameters<typeof original.sign>) => {
      const rawId = await original.sign(...args);
      if (capturedSignCalls !== null) {
        capturedSignCalls.push({ item: args[0], rawId });
      }
      return rawId;
    },
  };
});

/** Derives every captured item's ciphertext region within the assembled
 *  bundle file — the SAME cumulative-cursor bookkeeping
 *  `streaming-assemble-bundle-to-file.test.ts`'s own
 *  `ciphertextRegionsFromCapturedItems` already establishes, reused here
 *  verbatim (not reinvented) for the SAME reason. */
function ciphertextRegionsFromCapturedItems(
  items: { item: DataItem; rawId: Buffer }[],
  headerRegionSize: number,
): { dataOffset: number; dataLength: number }[] {
  const regions: { dataOffset: number; dataLength: number }[] = [];
  let cursor = headerRegionSize;
  for (const { item } of items) {
    const raw = item.getRaw();
    const dataLength = item.rawData.byteLength;
    const dataOffset = cursor + (raw.byteLength - dataLength);
    regions.push({ dataOffset, dataLength });
    cursor += raw.byteLength;
  }
  return regions;
}

const ENCRYPTION_BITSTRING = "1".repeat(800) + "0".repeat(800);

describe("uploadBundleStreaming — encrypted run's ACTUALLY POSTED bytes decrypt back to the originals", () => {
  it("every file's ciphertext region within the posted-chunk byte stream decrypts to its exact original plaintext", async () => {
    capturedSignCalls = [];
    const key = await deriveAccountAesKey(ENCRYPTION_BITSTRING);
    // Sizes deliberately span a partial-chunk file, a tiny file, and a file
    // crossing multiple ENCRYPTION_CHUNK_SIZE boundaries — mirrors
    // `streaming-assemble-bundle-to-file.test.ts`'s own encrypted fixture.
    const sizes = [ENCRYPTION_CHUNK_SIZE + 500, 2_048, 3 * ENCRYPTION_CHUNK_SIZE + 777];
    const plaintexts = sizes.map((size, i) => makeDeterministicBytes(size, 300 + i));
    const files: AssembleBundleToFileInput[] = sizes.map((_size, i) => ({
      path: i === 0 ? `enc-${i}.bin` : `sub/enc-${i}.bin`,
      contentType: "application/octet-stream",
      readData: async () => plaintexts[i]!,
    }));

    const store = await freshResumeStore();
    const stream = makeStreamingApiFactory();
    const pool = makeHealthPool();

    await uploadBundleStreaming(
      {
        jwk: throwawayJwk,
        files,
        maxRewardWinston: CAP,
        category: "general-other",
        encrypted: true,
        encryptorAddress: "Ѻ.throwaway-ouronet-address",
        encryptionVersion: "2",
        encryptionKey: key,
      },
      {
        pool,
        resumeStore: store,
        apiFactory: stream.apiFactory,
        openFile: async () => new FakeBundleAssemblyFile(),
        deleteFile: async () => {},
      },
    );

    const items = capturedSignCalls!;
    capturedSignCalls = null;
    expect(items.length).toBe(files.length + 1);

    // The FULL byte stream `uploadBundleStreaming` actually handed the fake
    // gateway, reconstructed purely from what was POSTED, in posted order —
    // never read back from the OPFS file directly (the whole point of this
    // test: prove what the GATEWAY received, not merely what landed on
    // disk).
    const postedFull = concatBytes(stream.postedChunks.map((body) => base64urlDecode(body.chunk)));

    const headerRegionSize = 32 + 64 * (files.length + 1);
    const regions = ciphertextRegionsFromCapturedItems(items, headerRegionSize);

    for (let i = 0; i < files.length; i++) {
      const { dataOffset, dataLength } = regions[i]!;
      const ciphertext = postedFull.subarray(dataOffset, dataOffset + dataLength);
      const decryptedChunks: Uint8Array[] = [];
      for await (const chunk of decryptStream({
        read: async (offset, length) => ciphertext.subarray(offset, offset + length),
        totalCiphertextLength: dataLength,
        totalPlaintextLength: plaintexts[i]!.byteLength,
        key,
      })) {
        decryptedChunks.push(chunk);
      }
      expect(Buffer.from(concatBytes(decryptedChunks)).equals(Buffer.from(plaintexts[i]!))).toBe(true);
    }
  });
});

describe("uploadBundleStreaming — genuine resume-record lifecycle via a REAL StreamingPostResumeStore", () => {
  it("leaves a real mid-flight checkpoint reflecting actual progress when the gateway is interrupted partway", async () => {
    const fixtures = makeFileFixtures();
    const store = await freshResumeStore();
    const interrupting = makeInterruptingStreamingApiFactory(1);
    const pool = makeHealthPool();

    await expect(
      uploadBundleStreaming(
        {
          jwk: throwawayJwk,
          files: toStreamingInputs(fixtures),
          maxRewardWinston: CAP,
          category: "general-other",
          encrypted: false,
        },
        {
          pool,
          resumeStore: store,
          apiFactory: interrupting.apiFactory,
          openFile: async () => new FakeBundleAssemblyFile(),
          deleteFile: async () => {},
          resumeId: "resume-test-1",
          fileName: "resume-test-1.bin",
        },
      ),
    ).rejects.toThrow();

    // Exactly 1 chunk actually posted before the simulated interruption...
    expect(interrupting.postedChunks.length).toBe(1);

    // ...and the persisted record genuinely reflects that progress — proof
    // this was written DURING the run, not just absent (never written) or
    // present only at the very end.
    const record = await store.load("resume-test-1");
    expect(record).not.toBeNull();
    expect(record!.txPosted).toBe(true);
    expect(record!.chunkIndex).toBe(1);
    expect(record!.fileName).toBe("resume-test-1.bin");
  });

  it("clears the real resume record once the upload completes successfully", async () => {
    const fixtures = makeFileFixtures();
    const store = await freshResumeStore();
    const stream = makeStreamingApiFactory();
    const pool = makeHealthPool();

    await uploadBundleStreaming(
      {
        jwk: throwawayJwk,
        files: toStreamingInputs(fixtures),
        maxRewardWinston: CAP,
        category: "general-other",
        encrypted: false,
      },
      {
        pool,
        resumeStore: store,
        apiFactory: stream.apiFactory,
        openFile: async () => new FakeBundleAssemblyFile(),
        deleteFile: async () => {},
        resumeId: "resume-test-2",
        fileName: "resume-test-2.bin",
      },
    );

    await expect(store.load("resume-test-2")).resolves.toBeNull();
  });
});
