/**
 * `SplitUploadPlanStore` — the multi-bundle plan persistence store (T3 of
 * `arweave-split-bundle-upload`).
 *
 * Mirrors `streamingPostResumeStore.ts`'s CLASS SHAPE exactly — the SAME
 * established IndexedDB pattern, not a new persistence convention: a
 * `static open(opts: { indexedDB: IdbFactoryLike; databaseName: string })`
 * factory using the SAME injectable `IdbFactoryLike`/`IdbDatabaseLike` seams
 * from `../types.ts` (so `fake-indexeddb` drives it under Node for tests, no
 * `lib:["DOM"]` needed), a keyPath-based object store created in
 * `onupgradeneeded`.
 *
 * ASYNC CORRECTNESS (same invariant `streamingPostResumeStore.ts` documents,
 * repeated here because it is the single most important thing this file
 * must preserve): every WRITE promise resolves on `transaction.oncomplete`,
 * NEVER `request.onsuccess` — `onsuccess` fires before the transaction
 * commits, and resolving there would let T4's orchestrator believe a
 * bundle's completion (or the plan itself) was durably persisted before it
 * actually was, risking a reload re-running an already-completed bundle. A
 * plain read-only `load` MAY resolve on `onsuccess` — it never risks losing
 * a write.
 *
 * RECORD SHAPE — grounded against T1's `planSplitBundles.ts` output and T4's
 * (`runSplitBundleUpload`, next task) real needs, per the plan's own
 * instruction to co-design this with T4's task text in mind:
 *
 * - `uploadId` is this record's keyPath AND the shared `Codex-Upload-Id`
 *   every one of the K bundles' files (and the final manifest) carry — the
 *   SAME value `postSplitUploadManifest` (T2) is handed, so there is no
 *   separate "record id" distinct from the value T4 actually needs to pass
 *   around.
 * - `bundles` is the COMPUTED K-way file grouping — `PlannedFile[][]`,
 *   structurally identical to `planSplitBundles`'s own `SplitBundlePlan.
 *   bundles` (duplicated here structurally rather than imported, same
 *   reason `streamingPostResumeStore.ts` duplicates arweave-js's `Chunk`/
 *   `Proof` shapes rather than importing them: this is a plain data record,
 *   not a re-export of the planner's types). Persisted ONCE, before bundle
 *   0 starts (T4's step 2) — this is what makes a reload NEVER recompute or
 *   reshuffle which files belong to which bundle, per the design doc's
 *   explicit requirement. Each bundle's own `size` sum (derivable by
 *   summing its files) is ALSO what T4's `onOverallProgress` aggregation
 *   needs for `overallTotalBytes`/the completed-bundles portion of
 *   `overallBytesUploaded` — no separate byte-total field is needed since
 *   it is always re-derivable from this same array, and storing a second,
 *   independently-updated copy would risk the two drifting apart.
 * - `completedBundleFileIds` is a PARALLEL array to `bundles` (same length,
 *   same index order): `null` at index `i` means bundle `i` has not yet
 *   fully completed; a non-null entry is that bundle's resulting
 *   `{path, id}[]` file-id list (`UploadBundleResult.fileIds`'s own shape),
 *   in that bundle's own file order. This single array is BOTH "which
 *   bundle indices have fully completed" (any index whose entry is
 *   non-null) and "each completed bundle's resulting file-id list" in one
 *   place — a separate `completedBundleIndices: number[]` alongside a
 *   file-id map would let the two drift out of sync; a single
 *   null-or-filled array cannot. T4 skips any bundle whose entry here is
 *   non-null (no re-sign, no re-post) and, once every entry is non-null,
 *   flattens them in order as the `files` list `postSplitUploadManifest`
 *   (T2) is called with — building the final manifest without ever
 *   re-deriving or re-reading anything.
 *
 * Deliberately NOT persisted: the uploader's `jwk`, `maxRewardWinston`, or
 * any other per-call upload parameter — those are re-supplied fresh by the
 * caller on every `runSplitBundleUpload` invocation (including a resumed
 * one), exactly like `uploadBundleStreaming` itself never persists `jwk`.
 * Persisting key material here would violate this project's N-07 "no secret
 * ever written to an on-disk store" convention the Library seam
 * (`../types.ts`'s own doc comment) already establishes elsewhere in this
 * package. A per-bundle `resumeId`/`fileName` for `uploadBundleStreaming`'s
 * OWN resume plumbing is likewise not stored here: T4 derives it
 * deterministically and purely from `uploadId` + bundle index on every
 * call (resumed or not), so it never needs to be durable state of its own.
 */

import {
  type IdbDatabaseLike,
  type IdbFactoryLike,
  type IdbObjectStoreLike,
  type IdbRequestLike,
} from "../types.js";

const STORE_NAME = "splitUploadPlans";

/** Options for {@link SplitUploadPlanStore.open}. */
export interface OpenSplitUploadPlanStoreOptions {
  /** The `IDBFactory` handle (injectable — fake-indexeddb under node). */
  indexedDB: IdbFactoryLike;
  /** The database name (a fresh name isolates test runs). */
  databaseName: string;
}

/** One planned file: its path and byte size — structurally identical to
 *  `planSplitBundles.ts`'s own `PlannedFile` (see this module's doc comment
 *  for why this is duplicated rather than imported). */
export interface SplitUploadPlanFile {
  path: string;
  size: number;
}

/** One file's resulting data-item id after a bundle finishes — structurally
 *  identical to `arweave-core`'s `UploadBundleResult.fileIds` entry shape
 *  (and `postSplitUploadManifest.ts`'s own `SplitUploadManifestFile`). */
export interface SplitUploadPlanFileId {
  path: string;
  id: string;
}

/**
 * The persisted multi-bundle plan — see this module's doc comment for the
 * full grounding of each field.
 */
export interface SplitUploadPlanRecord {
  /** The shared `Codex-Upload-Id` across every bundle's files and the final
   *  manifest — this record's IndexedDB keyPath. */
  uploadId: string;
  /** The COMPUTED K-way file grouping, decided once up front — `bundles.
   *  length === K`, never recomputed or reshuffled across a reload. */
  bundles: SplitUploadPlanFile[][];
  /** Parallel to `bundles`: `null` while that bundle has not yet fully
   *  completed, or that bundle's resulting file-id list (in its own file
   *  order) once it has. */
  completedBundleFileIds: (SplitUploadPlanFileId[] | null)[];
}

/** Resolves a single request on `onsuccess` — read-only paths that never
 *  commit (mirrors `streamingPostResumeStore.ts`'s own identically-named
 *  helper). */
function awaitRequest<T>(request: IdbRequestLike<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * `IdbObjectStoreLike` (`../types.ts`) plus `delete` — same additive
 * structural widening `streamingPostResumeStore.ts`'s own
 * `IdbObjectStoreWithDelete` declares (the shared seam interface serves the
 * Library store's needs only, which never deletes a single key by id).
 */
interface IdbObjectStoreWithDelete extends IdbObjectStoreLike {
  delete(key: string): IdbRequestLike;
}

export class SplitUploadPlanStore {
  private constructor(private readonly db: IdbDatabaseLike) {}

  /**
   * Opens (and, on first open, creates the schema for) the split-upload-plan
   * database, then resolves a ready store. The object store is keyed by the
   * record `uploadId`.
   */
  static open(
    opts: OpenSplitUploadPlanStoreOptions,
  ): Promise<SplitUploadPlanStore> {
    return new Promise((resolve, reject) => {
      const request = opts.indexedDB.open(opts.databaseName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "uploadId" });
        }
      };
      request.onsuccess = () =>
        resolve(new SplitUploadPlanStore(request.result));
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Runs a write against the object store and resolves ONLY on the
   * transaction's `oncomplete` — the write is durable before the returned
   * promise resolves (see this module's doc comment).
   */
  private write(
    mode: "readwrite",
    fn: (store: IdbObjectStoreWithDelete) => void,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME) as IdbObjectStoreWithDelete;
      fn(store);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  private read<T>(
    fn: (store: IdbObjectStoreLike) => IdbRequestLike<T>,
  ): Promise<T> {
    const tx = this.db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    return awaitRequest(fn(store));
  }

  /** Inserts or overwrites (by `record.uploadId`) — a `put` is
   *  idempotent-by-id, so a second `save` for an already-persisted
   *  `uploadId` replaces it in place, never erroring or duplicating (T4's
   *  step-3 "on completion, persist immediately" contract relies on this). */
  async save(record: SplitUploadPlanRecord): Promise<void> {
    await this.write("readwrite", (store) => {
      store.put(record);
    });
  }

  /** Resolves the persisted record, or `null` if `uploadId` was never saved
   *  (or was already deleted) — never throws for a missing id. */
  async load(uploadId: string): Promise<SplitUploadPlanRecord | null> {
    const found = await this.read<unknown>((store) => store.get(uploadId));
    return (found as SplitUploadPlanRecord | undefined) ?? null;
  }

  /** Removes the record for `uploadId`, if present. A subsequent `load`
   *  resolves `null`. Deleting an absent id is a defined no-op (IndexedDB's
   *  own `delete` semantics) — mirrors T4's step-5 "clean up the plan
   *  record on full success" discipline, the sequence-level analog of the
   *  per-bundle resume store's own "delete on completion" behavior. */
  async delete(uploadId: string): Promise<void> {
    await this.write("readwrite", (store) => {
      store.delete(uploadId);
    });
  }
}
