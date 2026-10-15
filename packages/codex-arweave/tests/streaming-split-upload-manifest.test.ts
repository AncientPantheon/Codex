// @vitest-environment node
/**
 * T2 RED/GREEN (`arweave-split-bundle-upload`) — the standalone manifest-only
 * upload primitive (`postSplitUploadManifest`): posts the SAME `arweave/
 * paths` manifest JSON format `assembleBundleToFile`'s own inline manifest-
 * building code produces (the `MANIFEST_CONTENT_TYPE`/`MANIFEST_FORMAT`/
 * `MANIFEST_VERSION`/`manifestBody` block near the end of that file, read in
 * full for this task), as its OWN plain native transaction — independent of
 * any one bundle, so a single manifest can later tie together files split
 * across several separate bundle uploads (`docs/work/
 * arweave-split-bundle-upload/design.md`).
 *
 * `// @vitest-environment node` — same reason every sibling streaming test
 * already uses it (`streaming-post.test.ts`, `streaming-upload-bundle
 * .test.ts`): `postArweaveData` builds a real `arweave-js` `Transaction`,
 * which needs `arweave/node/lib/*`, not the jsdom-resolved browser build.
 *
 * FORMAT-IDENTITY PROOF — the strongest available, not a hand-replica of the
 * production format: this file reuses `streaming-assemble-bundle-to-file
 * .test.ts`'s own `vi.mock("arbundles", ...)` transparent-recording-pass-
 * through technique to intercept the REAL manifest `DataItem`
 * `assembleBundleToFile` itself signs for a real multi-file fixture, and
 * reads its `.rawData` (`arbundles`' own `DataItem.rawData` getter — the
 * EXACT JSON bytes that module actually signed, same extraction that sibling
 * test already uses). `postSplitUploadManifest` is then driven with the
 * EXACT `{path, id}[]` list `assembleBundleToFile` itself produced
 * (`result.fileIds`), and its own posted manifest body is asserted
 * STRUCTURALLY equal (parsed JSON) to that real captured JSON.
 *
 * STRUCTURAL, not byte-for-byte, deliberately: the real contract a gateway/
 * manifest-resolver cares about is the PARSED shape (`manifest`/`version`/
 * `index`/`paths`), never raw whitespace or object-literal key order — so a
 * structural comparison is the stronger, more correct assertion for "same
 * format", and stays correct even if either module's own key order shifted
 * without being a real regression (`JSON.stringify`'s V8 insertion-order
 * behavior means the two ARE byte-identical today too, but that is an
 * implementation detail, not the thing actually under test).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, it, expect, vi } from "vitest";
// "arbundles/web" — see streaming-upload-bundle.test.ts's own comment on
// this import for why the root "arbundles" DataItem type doesn't typecheck
// here (nominal distinctness from a private class member).
import type { DataItem } from "arbundles/web";
import {
  isCanonicalAddress,
  InvalidUploadParamsError,
  type ArweaveJwk,
} from "@ancientpantheon/arweave-core";

import { FakeBundleAssemblyFile } from "../src/library/streaming/fakeBundleAssemblyFile.js";
import {
  assembleBundleToFile,
  type AssembleBundleToFileInput,
} from "../src/library/streaming/assembleBundleToFile.js";
import { postSplitUploadManifest } from "../src/library/streaming/postSplitUploadManifest.js";
import { makeHealthPool, makeRecordingUploadApi } from "./e3-helpers.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const throwawayJwk = JSON.parse(
  readFileSync(join(FIXTURES, "throwaway-arweave-keyfile.json"), "utf8"),
) as ArweaveJwk;

const CAP = 1_000_000_000_000n;

/** Opt-in capture of every real `{item, rawId}` pair `assembleBundleToFile`
 *  actually signs, in call order — mirrors `streaming-assemble-bundle-to-
 *  file.test.ts`'s own identically-named/-purposed module state, kept `null`
 *  outside the one test that needs it. */
let capturedSignCalls: { item: DataItem; rawId: Buffer }[] | null = null;

// "arbundles/web" — matches the real module the source now dynamically
// imports (fixed 2026-10-15: see assembleBundleToFile.ts's doc comment).
vi.mock("arbundles/web", async (importOriginal) => {
  const original = await importOriginal<typeof import("arbundles/web")>();
  return {
    ...original,
    // Transparent recording pass-through — every call still reaches the real
    // `sign`; this only lets the test observe which exact items got signed.
    sign: async (...args: Parameters<typeof original.sign>) => {
      const rawId = await original.sign(...args);
      if (capturedSignCalls !== null) {
        capturedSignCalls.push({ item: args[0], rawId });
      }
      return rawId;
    },
  };
});

/** Deterministic, non-trivial per-file bytes (mirrors the sibling assemble
 *  test's own fixture convention). */
function makeDeterministicBytes(size: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    bytes[i] = (i * 31 + seed * 7) & 0xff;
  }
  return bytes;
}

function makeFiles(): AssembleBundleToFileInput[] {
  const sizes = [37, 2_048, 64_000];
  return sizes.map((size, i) => ({
    path: i === 0 ? `root-${i}.bin` : `sub/dir/file-${i}.bin`,
    contentType: "application/octet-stream",
    readData: async () => makeDeterministicBytes(size, i),
  }));
}

/** Decodes a posted transaction's raw `data` (UTF-8 JSON bytes) into the
 *  parsed manifest object. */
function parseManifestData(data: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(data));
}

describe("postSplitUploadManifest — format-identical standalone manifest posting", () => {
  it("posts a manifest structurally identical to assembleBundleToFile's own inline manifest for the same file list", async () => {
    capturedSignCalls = [];

    const bundleFile = new FakeBundleAssemblyFile();
    const assembled = await assembleBundleToFile(bundleFile, {
      jwk: throwawayJwk,
      files: makeFiles(),
      category: "general-other",
      encrypted: false,
    });

    // The REAL manifest item is the LAST item assembleBundleToFile signs —
    // its `.rawData` is the EXACT JSON bytes that module actually produced
    // and signed, read directly off the real DataItem (never re-derived).
    const realManifestItem = capturedSignCalls.at(-1)!.item;
    const realManifestJson = JSON.parse(realManifestItem.rawData.toString("utf8"));
    capturedSignCalls = null;

    expect(assembled.fileIds.length).toBe(3);

    const recording = makeRecordingUploadApi();
    const pool = makeHealthPool();

    const result = await postSplitUploadManifest(
      pool,
      {
        jwk: throwawayJwk,
        files: assembled.fileIds,
        uploadId: "shared-split-upload-id-1",
        maxRewardWinston: CAP,
      },
      { apiFactory: recording.apiFactory },
    );

    expect(recording.calls.length).toBe(1);
    const postedJson = parseManifestData(recording.calls[0]!.data);

    // FORMAT-IDENTITY: structurally equal to the REAL inline manifest this
    // task must reuse the exact shape of, for the SAME {path, id}[] input.
    expect(postedJson).toEqual(realManifestJson);

    // Sanity on the shape itself, grounding what "format" means here.
    expect(postedJson).toMatchObject({
      manifest: "arweave/paths",
      version: "0.2.0",
      index: { path: assembled.fileIds[0]!.path },
    });

    // The resolved manifestId is a real, well-formed canonical tx id.
    expect(isCanonicalAddress(result.manifestId)).toBe(true);
  });

  it("tags the posted manifest with itemType: \"manifest\" and the given uploadId", async () => {
    const assembledFiles = [
      { path: "a.bin", id: "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_ABCDE" },
      { path: "sub/b.bin", id: "ZzYyXxWwVvUuTtSsRrQqPpOoNnMmLlKkJjIiHhGgFfE" },
    ];

    const recording = makeRecordingUploadApi();
    const pool = makeHealthPool();

    await postSplitUploadManifest(
      pool,
      {
        jwk: throwawayJwk,
        files: assembledFiles,
        uploadId: "shared-split-upload-id-2",
        maxRewardWinston: CAP,
      },
      { apiFactory: recording.apiFactory },
    );

    expect(recording.calls.length).toBe(1);
    const { tags } = recording.calls[0]!;
    expect(tags).toContainEqual({ name: "Codex-Item-Type", value: "manifest" });
    expect(tags).toContainEqual({ name: "Codex-Upload-Id", value: "shared-split-upload-id-2" });
  });

  it("rejects an empty file list with a clear, structured error before any pool call", async () => {
    const recording = makeRecordingUploadApi();
    const pool = makeHealthPool();

    await expect(
      postSplitUploadManifest(
        pool,
        {
          jwk: throwawayJwk,
          files: [],
          uploadId: "shared-split-upload-id-3",
          maxRewardWinston: CAP,
        },
        { apiFactory: recording.apiFactory },
      ),
    ).rejects.toMatchObject({
      name: "InvalidUploadParamsError",
      field: "files",
    } satisfies Partial<InvalidUploadParamsError>);

    expect(recording.calls.length).toBe(0);
  });
});
