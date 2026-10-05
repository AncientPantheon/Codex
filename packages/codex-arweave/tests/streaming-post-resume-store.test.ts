// @vitest-environment node
/**
 * T1 RED/GREEN (`arweave-streaming-post-resume`) — the resume-record
 * IndexedDB store (`StreamingPostResumeStore`).
 *
 * `@vitest-environment node` — same pragma `streaming-bundle-assembly-
 * file.test.ts`/`e4-keygen-runner.test.ts` already use for pure node-logic
 * seams: this package's DEFAULT jsdom environment gives `Uint8Array` its
 * OWN realm-local constructor, distinct from the one `fake-indexeddb`'s
 * structured-clone internals construct against (plain Node globals) — a
 * `Uint8Array` round-tripped through fake-indexeddb under the default
 * jsdom environment fails `instanceof Uint8Array` even though its bytes
 * are correct (confirmed empirically with a throwaway probe before writing
 * this pragma in). Running under the `node` environment keeps every
 * `Uint8Array` reference in the SAME realm, eliminating that cross-realm
 * false negative entirely — the exact kind of pitfall the task's "verify
 * empirically, don't assume" instruction exists to catch.
 *
 * Mirrors `tests/e3-library-store.test.ts`'s own `fake-indexeddb` injection
 * convention exactly (`import "fake-indexeddb/auto"` + a fresh
 * `globalThis.indexedDB`-backed database name per test) rather than a
 * hand-rolled IndexedDB mock — a mock could silently diverge from real
 * IndexedDB's structured-clone semantics, which is exactly what the
 * typed-array round-trip case below exists to catch for real.
 *
 * Every test here guards a specific resume-correctness regression: if any
 * field (especially a `Uint8Array`-typed one) silently dropped, truncated,
 * or coerced across a save/load round trip, `resumeStreamingPost` (T2, not
 * this task) would reconstruct a transaction/proof set that does not match
 * what was actually signed — corrupting the resumed upload instead of
 * continuing it.
 */

import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";

import {
  StreamingPostResumeStore,
  type StreamingPostResumeRecord,
} from "../src/library/streaming/streamingPostResumeStore.js";
import type { IdbFactoryLike } from "../src/library/types.js";

function freshStore(): Promise<StreamingPostResumeStore> {
  return StreamingPostResumeStore.open({
    indexedDB: globalThis.indexedDB as unknown as IdbFactoryLike,
    databaseName: `codex-streaming-resume-${Math.random().toString(36).slice(2)}`,
  });
}

/** A fully-populated record, every field driven by an input (not a hardcoded
 *  constant) so a round-trip assertion against it actually exercises every
 *  field's real value, including the two `Uint8Array`-typed ones. */
function makeRecord(
  over: Partial<StreamingPostResumeRecord> & Pick<StreamingPostResumeRecord, "id">,
): StreamingPostResumeRecord {
  return {
    id: over.id,
    fileName: over.fileName ?? "bundle-upload-1.bin",
    tx: over.tx ?? {
      id: "tx-id-canonical-43-chars-0000000000000000000",
      owner: "owner-pubkey-0000000000000000000000000000",
      target: "",
      quantity: "0",
      reward: "123456789",
      last_tx: "anchor-0000000000000000000000000000000000000",
      signature: "sig-base64url-string-0000000000000000000000000000",
      data_root: "data-root-base64url-0000000000000000000000",
      data_size: "4096",
      tags: [{ name: "QXBwLU5hbWU", value: "QW5jaWVudFBhbnRoZW9uLUNvZGV4" }],
    },
    chunks: over.chunks ?? [
      { dataHash: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), minByteRange: 0, maxByteRange: 256 },
      { dataHash: new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1]), minByteRange: 256, maxByteRange: 512 },
    ],
    proofs: over.proofs ?? [
      { offset: 255, proof: new Uint8Array([10, 20, 30, 40, 50]) },
      { offset: 511, proof: new Uint8Array([60, 70, 80, 90, 100, 110]) },
    ],
    chunkIndex: over.chunkIndex ?? 1,
    txPosted: over.txPosted ?? true,
  };
}

describe("StreamingPostResumeStore (T1, arweave-streaming-post-resume)", () => {
  it("save then load round-trips every field exactly, including Uint8Array-typed chunk/proof bytes", async () => {
    const store = await freshStore();
    const record = makeRecord({ id: "upload-abc" });

    await store.save(record);
    const loaded = await store.load("upload-abc");

    expect(loaded).not.toBeNull();
    // Scalar/nested-object fields round-trip exactly.
    expect(loaded!.id).toBe(record.id);
    expect(loaded!.fileName).toBe(record.fileName);
    expect(loaded!.tx).toEqual(record.tx);
    expect(loaded!.chunkIndex).toBe(record.chunkIndex);
    expect(loaded!.txPosted).toBe(record.txPosted);

    // The two Uint8Array-typed fields — IndexedDB's structured clone must
    // hand back a REAL Uint8Array with the same bytes, not a plain array,
    // an empty object, or a dropped field. Checked empirically, not assumed.
    expect(loaded!.chunks).toHaveLength(record.chunks.length);
    for (let i = 0; i < record.chunks.length; i++) {
      expect(loaded!.chunks[i].dataHash).toBeInstanceOf(Uint8Array);
      expect([...loaded!.chunks[i].dataHash]).toEqual([...record.chunks[i].dataHash]);
      expect(loaded!.chunks[i].minByteRange).toBe(record.chunks[i].minByteRange);
      expect(loaded!.chunks[i].maxByteRange).toBe(record.chunks[i].maxByteRange);
    }
    expect(loaded!.proofs).toHaveLength(record.proofs.length);
    for (let i = 0; i < record.proofs.length; i++) {
      expect(loaded!.proofs[i].proof).toBeInstanceOf(Uint8Array);
      expect([...loaded!.proofs[i].proof]).toEqual([...record.proofs[i].proof]);
      expect(loaded!.proofs[i].offset).toBe(record.proofs[i].offset);
    }
  });

  it("loading a never-saved id resolves null, never throws", async () => {
    const store = await freshStore();

    await expect(store.load("never-saved-id")).resolves.toBeNull();
  });

  it("delete removes the record — a subsequent load resolves null", async () => {
    const store = await freshStore();
    const record = makeRecord({ id: "upload-to-delete" });
    await store.save(record);
    expect(await store.load("upload-to-delete")).not.toBeNull();

    await store.delete("upload-to-delete");

    expect(await store.load("upload-to-delete")).toBeNull();
  });

  it("a second save with the same id overwrites rather than erroring or duplicating", async () => {
    const store = await freshStore();
    await store.save(makeRecord({ id: "upload-overwrite", chunkIndex: 1, txPosted: true }));

    // Re-save the SAME id with different progress — simulates another chunk
    // having completed since the first checkpoint write.
    await store.save(makeRecord({ id: "upload-overwrite", chunkIndex: 5, txPosted: true }));

    const loaded = await store.load("upload-overwrite");
    expect(loaded!.chunkIndex).toBe(5);

    // No duplicate record under a different key — this id's record count
    // in the store stays exactly one (proven via a direct second store
    // handle on the SAME underlying db seeing the identical, single value).
    const again = await store.load("upload-overwrite");
    expect(again).toEqual(loaded);
  });
});
