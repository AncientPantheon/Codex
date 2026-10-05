/**
 * `StreamingPostResumeStore` — the resume-record IndexedDB store (T1 of
 * `arweave-streaming-post-resume`).
 *
 * Mirrors `../indexedDbStore.ts`'s `IndexedDBLibraryStore` CLASS SHAPE
 * exactly — the SAME established pattern, not a new persistence
 * convention: a `static open(opts: { indexedDB: IdbFactoryLike;
 * databaseName: string })` factory using the injectable `IdbFactoryLike`/
 * `IdbDatabaseLike` seams from `../types.ts` (so `fake-indexeddb` drives it
 * under Node for tests, no `lib:["DOM"]` needed), a keyPath-based object
 * store created in `onupgradeneeded`.
 *
 * ASYNC CORRECTNESS (the classic lost-write bug — same doc comment as
 * `indexedDbStore.ts`'s own, repeated here because it is the single most
 * important invariant this file must preserve): every WRITE promise
 * resolves on `transaction.oncomplete`, NEVER `request.onsuccess`.
 * `onsuccess` fires once the request has a result but BEFORE the
 * transaction commits — resolving there would let a following
 * `streamingPost.ts` checkpoint read (T2) miss the just-written progress
 * after a crash. A plain read-only request (`load`) MAY resolve on
 * `onsuccess` — it never risks losing a write.
 *
 * RECORD SHAPE — grounded against the REAL `SignedStreamingTransaction`
 * (`arweave-core`'s `createStreamingTransaction.ts`, a type alias for
 * `arweave`'s own `Transaction` class, `node_modules/arweave/node/lib/
 * transaction.d.ts` read directly): `format`/`data` are deliberately
 * excluded — `data` is always an empty `Uint8Array(0)` for every streaming
 * transaction (never persisted, never read), and `format` is always `2`
 * (arweave-js's own `Transaction` constructor default, and the only format
 * whose `data_root` bypass this project's streaming path uses) so it never
 * needs to be distinguished per record. `tx.tags` are the Transaction's
 * OWN tags — already base64url-ENCODED by `addTag` at signing time, unlike
 * `arweave-core`'s plain pre-encoding `Tag` — duplicated here structurally
 * (not imported) for the SAME reason `buildStreamingChunkBody.ts`'s own
 * `StreamingChunkMeta`/`createStreamingTransaction.ts`'s own
 * `StreamingChunkPostBody` duplicate structurally rather than import
 * across the package boundary: `codex-arweave`'s own `src` takes no direct
 * dependency on the `arweave` package at all (see that file's "PACKAGE
 * PLACEMENT" doc comment) — importing `SignedStreamingTransaction`'s real
 * `Transaction` class type here, even type-only, would cross that
 * boundary. `chunks`/`proofs` are likewise a local structural mirror of
 * arweave-js's own `Chunk`/`Proof` (`arweave/node/lib/merkle.js`), the SAME
 * duplication `StreamingChunkMeta` already establishes.
 */

import {
  type IdbDatabaseLike,
  type IdbFactoryLike,
  type IdbObjectStoreLike,
  type IdbRequestLike,
} from "../types.js";

const STORE_NAME = "resumeRecords";

/** Options for {@link StreamingPostResumeStore.open}. */
export interface OpenStreamingPostResumeStoreOptions {
  /** The `IDBFactory` handle (injectable — fake-indexeddb under node). */
  indexedDB: IdbFactoryLike;
  /** The database name (a fresh name isolates test runs). */
  databaseName: string;
}

/** A single tag on the signed transaction itself — post-`addTag`-encoding
 *  (both `name`/`value` already base64url strings), matching the real
 *  `Transaction.tags`'s own `Tag` shape exactly (see this module's doc
 *  comment for why this is duplicated rather than imported). */
export interface StreamingPostResumeTag {
  name: string;
  value: string;
}

/** One chunk's byte range + content hash — mirrors arweave-js's own
 *  `Chunk` shape (`arweave/node/lib/merkle.js`) structurally. */
export interface StreamingPostResumeChunk {
  dataHash: Uint8Array;
  minByteRange: number;
  maxByteRange: number;
}

/** One chunk's Merkle inclusion proof, in the SAME order as `chunks` —
 *  mirrors arweave-js's own `Proof` shape structurally. */
export interface StreamingPostResumeProof {
  offset: number;
  proof: Uint8Array;
}

/**
 * The already-signed transaction's serializable fields — everything a
 * later `resumeStreamingPost` (T2) needs to reconstruct the SAME
 * `SignedStreamingTransaction` directly, without ever re-signing. Grounded
 * directly against `TransactionInterface`/`Transaction`
 * (`node_modules/arweave/node/lib/transaction.d.ts`): every field minus
 * `data` (always empty) and `format` (always `2` for this project — see
 * this module's doc comment).
 */
export interface StreamingPostResumeSignedTx {
  id: string;
  owner: string;
  target: string;
  quantity: string;
  reward: string;
  last_tx: string;
  signature: string;
  data_root: string;
  data_size: string;
  tags: StreamingPostResumeTag[];
}

/**
 * A single resume checkpoint — everything `resumeStreamingPost` (T2) needs
 * to continue an interrupted streaming post without re-signing, re-reading
 * the original source files, or re-posting an already-successful chunk.
 * Deliberately excludes the bulk bundle bytes themselves (those stay
 * durable in OPFS, reopened by `fileName`) — this record is small and
 * independent of total upload size beyond chunk count.
 */
export interface StreamingPostResumeRecord {
  /** The upload/bundle identifier — this record's IndexedDB keyPath. */
  id: string;
  /** The OPFS file's name, to reopen the same assembled bundle on resume. */
  fileName: string;
  /** The already-signed transaction's serializable fields. */
  tx: StreamingPostResumeSignedTx;
  /** Every chunk's byte range + hash, in order — `computeStreamingDataRoot`'s
   *  own `chunks` output. */
  chunks: StreamingPostResumeChunk[];
  /** Each chunk's Merkle inclusion proof, in the SAME order as `chunks`. */
  proofs: StreamingPostResumeProof[];
  /** The index of the next chunk to post — equivalently, how many chunks
   *  have been successfully posted so far. */
  chunkIndex: number;
  /** Whether the initial transaction-post step has already succeeded. */
  txPosted: boolean;
}

/** Resolves a single request on `onsuccess` — read-only paths that never
 *  commit (mirrors `indexedDbStore.ts`'s own identically-named helper). */
function awaitRequest<T>(request: IdbRequestLike<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * `IdbObjectStoreLike` (`../types.ts`) plus `delete` — the one object-store
 * member this store needs that the shared seam interface does not declare
 * (that interface only serves `IndexedDBLibraryStore`'s own needs, which
 * never deletes a single key by id, only via whole-store `clear()`). Both
 * real `IDBObjectStore` and `fake-indexeddb` already implement `delete` —
 * this is a local, additive type widening (via a structural cast at the one
 * call site below), not a change to the shared `../types.ts` seam file.
 */
interface IdbObjectStoreWithDelete extends IdbObjectStoreLike {
  delete(key: string): IdbRequestLike;
}

export class StreamingPostResumeStore {
  private constructor(private readonly db: IdbDatabaseLike) {}

  /**
   * Opens (and, on first open, creates the schema for) the resume-record
   * database, then resolves a ready store. The object store is keyed by
   * the record `id`.
   */
  static open(
    opts: OpenStreamingPostResumeStoreOptions,
  ): Promise<StreamingPostResumeStore> {
    return new Promise((resolve, reject) => {
      const request = opts.indexedDB.open(opts.databaseName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      request.onsuccess = () =>
        resolve(new StreamingPostResumeStore(request.result));
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

  /** Inserts or overwrites (by `record.id`) — a `put` is idempotent-by-id,
   *  so a second `save` for an already-persisted id replaces it in place,
   *  never erroring or duplicating. */
  async save(record: StreamingPostResumeRecord): Promise<void> {
    await this.write("readwrite", (store) => {
      store.put(record);
    });
  }

  /** Resolves the persisted record, or `null` if `id` was never saved (or
   *  was already deleted) — never throws for a missing id. */
  async load(id: string): Promise<StreamingPostResumeRecord | null> {
    const found = await this.read<unknown>((store) => store.get(id));
    return (found as StreamingPostResumeRecord | undefined) ?? null;
  }

  /** Removes the record for `id`, if present. A subsequent `load` resolves
   *  `null`. Deleting an absent id is a defined no-op (IndexedDB's own
   *  `delete` semantics). */
  async delete(id: string): Promise<void> {
    await this.write("readwrite", (store) => {
      store.delete(id);
    });
  }
}
