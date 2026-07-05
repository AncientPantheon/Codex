/**
 * The browser `IndexedDBLibraryStore` — the persistent `LibraryStore` impl.
 *
 * Typed via the narrow structural IDB interfaces in `types.ts` so the package
 * stays DOM-free (no `lib:["DOM"]`). The `IDBFactory` handle is injected through
 * the static `open` factory so `fake-indexeddb` can drive it under node.
 *
 * Async correctness (the classic lost-write bug): EVERY write promise resolves on
 * `transaction.oncomplete`, NOT `request.onsuccess`. `onsuccess` fires when the
 * request has a result but BEFORE the transaction commits — resolving there lets
 * a following read miss the write. Awaiting `oncomplete` guarantees the write is
 * durable before the promise resolves.
 */

import {
  type IdbDatabaseLike,
  type IdbFactoryLike,
  type IdbObjectStoreLike,
  type IdbRequestLike,
  type LibraryEntry,
  type LibraryStatus,
  type LibraryStore,
  mergeReconciled,
  sortNewestFirst,
} from "./types.js";

const STORE_NAME = "entries";

/** Options for {@link IndexedDBLibraryStore.open}. */
export interface OpenIndexedDBLibraryStoreOptions {
  /** The `IDBFactory` handle (injectable — fake-indexeddb under node). */
  indexedDB: IdbFactoryLike;
  /** The database name (a fresh name isolates test runs). */
  databaseName: string;
}

/** Resolves a single request on `onsuccess` — read-only paths that never commit. */
function awaitRequest<T>(request: IdbRequestLike<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export class IndexedDBLibraryStore implements LibraryStore {
  private constructor(private readonly db: IdbDatabaseLike) {}

  /**
   * Opens (and, on first open, creates the schema for) the Library database,
   * then resolves a ready store. The object store is keyed by the entry `id`.
   */
  static open(
    opts: OpenIndexedDBLibraryStoreOptions,
  ): Promise<IndexedDBLibraryStore> {
    return new Promise((resolve, reject) => {
      const request = opts.indexedDB.open(opts.databaseName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      request.onsuccess = () =>
        resolve(new IndexedDBLibraryStore(request.result));
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Runs a write against the object store and resolves ONLY on the transaction's
   * `oncomplete` — the write is durable before the returned promise resolves.
   */
  private write(
    mode: "readwrite",
    fn: (store: IdbObjectStoreLike) => void,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
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

  private async readAll(): Promise<LibraryEntry[]> {
    const all = await this.read<unknown[]>((store) => store.getAll());
    return all as LibraryEntry[];
  }

  async append(entry: LibraryEntry): Promise<void> {
    await this.write("readwrite", (store) => {
      store.put(entry);
    });
  }

  async get(id: string): Promise<LibraryEntry | undefined> {
    const found = await this.read<unknown>((store) => store.get(id));
    return (found as LibraryEntry | undefined) ?? undefined;
  }

  async updateStatus(id: string, status: LibraryStatus): Promise<void> {
    const found = await this.get(id);
    if (!found) {
      return;
    }
    await this.write("readwrite", (store) => {
      store.put({ ...found, status });
    });
  }

  async list(owner: string): Promise<LibraryEntry[]> {
    const owned = (await this.readAll()).filter((e) => e.owner === owner);
    return sortNewestFirst(owned);
  }

  async reconcile(_owner: string, incoming: LibraryEntry[]): Promise<void> {
    const existing = new Map<string, LibraryEntry>();
    for (const e of await this.readAll()) {
      existing.set(e.id, e);
    }
    await this.write("readwrite", (store) => {
      for (const entry of incoming) {
        const local = existing.get(entry.id);
        store.put(local ? mergeReconciled(local, entry) : entry);
      }
    });
  }

  async clear(): Promise<void> {
    await this.write("readwrite", (store) => {
      store.clear();
    });
  }
}
