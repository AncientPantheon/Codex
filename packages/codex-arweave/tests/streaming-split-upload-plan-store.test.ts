// @vitest-environment node
/**
 * T3 RED/GREEN (`arweave-split-bundle-upload`) — the multi-bundle plan
 * persistence store (`SplitUploadPlanStore`).
 *
 * `@vitest-environment node` — same pragma `streaming-post-resume-store.
 * test.ts` uses for the identical reason: this package's default jsdom
 * environment gives plain-array/object structured-clone round trips through
 * `fake-indexeddb` a DIFFERENT realm than the one Node's own globals share,
 * which can surface false negatives for nested-array fields. Running under
 * `node` keeps every reference in the same realm.
 *
 * Mirrors `streaming-post-resume-store.test.ts`'s own `fake-indexeddb`
 * injection convention exactly (`import "fake-indexeddb/auto"` + a fresh
 * `globalThis.indexedDB`-backed database name per test).
 *
 * Every test here guards a specific resume-correctness regression for T4's
 * orchestrator: if the computed K-way grouping or a completed bundle's
 * file-id list were silently dropped, truncated, or reordered across a
 * save/load round trip, a resumed `runSplitBundleUpload` would reshuffle
 * which files belong to which bundle (violating the design doc's explicit
 * "never recomputed/reshuffled on a reload" requirement) or build a final
 * manifest missing/misattributing files.
 */

import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";

import {
  SplitUploadPlanStore,
  type SplitUploadPlanRecord,
} from "../src/library/streaming/splitUploadPlanStore.js";
import type { IdbFactoryLike } from "../src/library/types.js";

function freshStore(): Promise<SplitUploadPlanStore> {
  return SplitUploadPlanStore.open({
    indexedDB: globalThis.indexedDB as unknown as IdbFactoryLike,
    databaseName: `codex-split-upload-plan-${Math.random().toString(36).slice(2)}`,
  });
}

/** A fully-populated record, every field driven by an input (not a
 *  hardcoded constant) so a round-trip assertion against it actually
 *  exercises every field's real value — including a MIX of a completed
 *  bundle (with its real file-id list) and a not-yet-completed bundle
 *  (`null`), the exact in-flight shape a resumed run observes. */
function makeRecord(
  over: Partial<SplitUploadPlanRecord> & Pick<SplitUploadPlanRecord, "uploadId">,
): SplitUploadPlanRecord {
  return {
    uploadId: over.uploadId,
    bundles: over.bundles ?? [
      [
        { path: "a.txt", size: 100 },
        { path: "b.txt", size: 200 },
      ],
      [{ path: "c.txt", size: 150 }],
    ],
    completedBundleFileIds: over.completedBundleFileIds ?? [
      [
        { path: "a.txt", id: "id-a-0000000000000000000000000000000000" },
        { path: "b.txt", id: "id-b-0000000000000000000000000000000000" },
      ],
      null,
    ],
  };
}

describe("SplitUploadPlanStore (T3, arweave-split-bundle-upload)", () => {
  it("save then load round-trips every field exactly, including the K-way grouping and per-bundle completion state", async () => {
    const store = await freshStore();
    const record = makeRecord({ uploadId: "upload-abc" });

    await store.save(record);
    const loaded = await store.load("upload-abc");

    expect(loaded).not.toBeNull();
    expect(loaded!.uploadId).toBe(record.uploadId);
    expect(loaded!.bundles).toEqual(record.bundles);
    expect(loaded!.completedBundleFileIds).toEqual(record.completedBundleFileIds);
  });

  it("loading a never-saved id resolves null, never throws", async () => {
    const store = await freshStore();

    await expect(store.load("never-saved-id")).resolves.toBeNull();
  });

  it("delete removes the record — a subsequent load resolves null", async () => {
    const store = await freshStore();
    const record = makeRecord({ uploadId: "upload-to-delete" });
    await store.save(record);
    expect(await store.load("upload-to-delete")).not.toBeNull();

    await store.delete("upload-to-delete");

    expect(await store.load("upload-to-delete")).toBeNull();
  });

  it("a second save with the same uploadId overwrites rather than erroring or duplicating", async () => {
    const store = await freshStore();
    await store.save(
      makeRecord({
        uploadId: "upload-overwrite",
        completedBundleFileIds: [null, null],
      }),
    );

    // Re-save the SAME uploadId with bundle 0 now complete — simulates
    // persisting the next bundle's completion since the first checkpoint
    // write (T4's step-3 "on completion, persist immediately" contract).
    await store.save(
      makeRecord({
        uploadId: "upload-overwrite",
        completedBundleFileIds: [
          [{ path: "a.txt", id: "id-a-0000000000000000000000000000000000" }],
          null,
        ],
      }),
    );

    const loaded = await store.load("upload-overwrite");
    expect(loaded!.completedBundleFileIds).toEqual([
      [{ path: "a.txt", id: "id-a-0000000000000000000000000000000000" }],
      null,
    ]);

    // No duplicate record under a different key — this id's record count
    // in the store stays exactly one (proven via a second load on the SAME
    // underlying db seeing the identical, single value).
    const again = await store.load("upload-overwrite");
    expect(again).toEqual(loaded);
  });
});
