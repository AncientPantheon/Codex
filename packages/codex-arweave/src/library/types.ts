/**
 * The Library persistence seam — the `LibraryStore` interface + the public-only
 * `LibraryEntry` shape, plus a narrow structural IndexedDB typing.
 *
 * N-07: the Library is a SEPARATE store from the codex backup and holds ONLY
 * public on-chain metadata — no key material, no ciphertext, no password. The
 * `LibraryEntry` shape is the compile-time guard: there is no field that could
 * carry a secret.
 *
 * The seam is env-agnostic: no IndexedDB or SQLite type leaks into `LibraryStore`.
 * Consumers inject an impl (`MemoryLibraryStore` for node/tests, an
 * `IndexedDBLibraryStore` for the browser). The IndexedDB handles are typed via
 * a narrow LOCAL STRUCTURAL interface (mirroring arweave-core's `TurboUploadClient`)
 * so the package stays DOM-free — no `lib:["DOM"]`.
 */

import type { Tag } from "@ancientpantheon/arweave-core";

import { MANIFEST_CONTENT_TYPE } from "./constants.js";

/** Entry lifecycle: `pending` after upload, `final` once the tx is deep-confirmed. */
export type LibraryStatus = "pending" | "final";

/**
 * A single Library record — PUBLIC data ONLY (N-07/N-06). Every field is
 * on-chain metadata: the data-item id, the canonical owner address, the item id,
 * the content type, the lifecycle status, an ordering timestamp, and the applied
 * public tags. `manifest` flags a manifest content-type entry (one link). There
 * is deliberately NO field for a JWK, ciphertext, password, or any secret.
 */
export interface LibraryEntry {
  /** The data-item / tx id (canonical 43-char base64url). */
  id: string;
  /** The canonical 43-char owner address (the Codex-Owner tag value). */
  owner: string;
  /** The Codex-Item-Id for this upload. */
  itemId: string;
  /** The Content-Type tag value. */
  contentType: string;
  /** `pending` until deep-confirmed, then `final`. */
  status: LibraryStatus;
  /**
   * Ordering key. Locally-originated entries carry their real upload-time clock
   * value; rebuilt-only entries carry a rebuild-stable sentinel so `list`
   * ordering is idempotent across rebuilds.
   */
  createdAt: number;
  /** The full public tag list applied to the upload. */
  tags: Tag[];
  /** Present (and `{ isManifest: true }`) iff the content-type is the manifest type. */
  manifest?: { isManifest: true };
}

/**
 * The injectable Library persistence seam. All ops are async so a single seam
 * spans an in-memory Map (node/tests) and an async IndexedDB store (browser).
 */
export interface LibraryStore {
  /** Insert an entry (idempotent by id — a re-append overwrites). */
  append(entry: LibraryEntry): Promise<void>;
  /** Read an entry by id; `undefined` when absent. */
  get(id: string): Promise<LibraryEntry | undefined>;
  /** Flip an entry's status. A missing id is a defined no-op. */
  updateStatus(id: string, status: LibraryStatus): Promise<void>;
  /**
   * The owner's entries, NEWEST-FIRST by `createdAt` DESC with a SECONDARY `id`
   * DESC tiebreak (deterministic under equal/sentinel timestamps). Owner-scoped.
   */
  list(owner: string): Promise<LibraryEntry[]>;
  /**
   * Field-level upsert-by-id from a rebuild result: insert missing entries; for
   * an existing id keep the local `createdAt` + `manifest`, set `status:"final"`,
   * refresh `tags`. Never deletes a local entry absent from the input.
   */
  reconcile(owner: string, entries: LibraryEntry[]): Promise<void>;
  /** Remove all entries (test/reset affordance). */
  clear(): Promise<void>;
}

/**
 * Sorts entries NEWEST-FIRST by `createdAt` DESC with a SECONDARY `id` DESC
 * tiebreak. Shared by every `LibraryStore` impl so ordering is identical across
 * seams and deterministic under equal/sentinel `createdAt`.
 */
export function sortNewestFirst(entries: LibraryEntry[]): LibraryEntry[] {
  return [...entries].sort((a, b) => {
    if (a.createdAt !== b.createdAt) {
      return b.createdAt - a.createdAt;
    }
    if (a.id < b.id) return 1;
    if (a.id > b.id) return -1;
    return 0;
  });
}

/**
 * Applies the field-level reconcile merge for a single id against an existing
 * local entry. Shared by every impl so the merge precedence is identical:
 * keep local `createdAt` + `manifest`, set `status:"final"`, refresh `tags`.
 */
export function mergeReconciled(
  local: LibraryEntry,
  incoming: LibraryEntry,
): LibraryEntry {
  const contentType = incoming.contentType;
  return {
    ...local,
    itemId: incoming.itemId,
    contentType,
    owner: incoming.owner,
    status: "final",
    tags: incoming.tags,
    // The manifest flag is derived from the RESULTING contentType so this MERGE
    // path stays consistent with the INSERT path (recordToEntry). A locally
    // detected manifest also survives even if the incoming contentType is not
    // the manifest type: present iff resulting type is manifest OR local was set.
    ...(contentType === MANIFEST_CONTENT_TYPE
      ? { manifest: { isManifest: true } as const }
      : local.manifest
        ? { manifest: local.manifest }
        : {}),
  };
}

// --- Narrow structural IndexedDB typing (DOM-free — mirrors TurboUploadClient) ---
//
// Exactly the IndexedDB surface `IndexedDBLibraryStore` needs, typed locally so
// the package does not pull in `lib:["DOM"]`. These are structural contracts,
// not the browser's own IDB* types.

/** A request that resolves to a result and fires success/error callbacks. */
export interface IdbRequestLike<T = unknown> {
  result: T;
  error: unknown;
  onsuccess: ((this: unknown, ev: unknown) => void) | null;
  onerror: ((this: unknown, ev: unknown) => void) | null;
}

/** An object store: the CRUD surface the Library uses (all keyed by entry id). */
export interface IdbObjectStoreLike {
  put(value: unknown): IdbRequestLike;
  get(key: string): IdbRequestLike<unknown>;
  getAll(): IdbRequestLike<unknown[]>;
  clear(): IdbRequestLike;
}

/** A transaction: yields a store and signals commit via `oncomplete`. */
export interface IdbTransactionLike {
  objectStore(name: string): IdbObjectStoreLike;
  oncomplete: ((this: unknown, ev: unknown) => void) | null;
  onerror: ((this: unknown, ev: unknown) => void) | null;
  onabort: ((this: unknown, ev: unknown) => void) | null;
  error: unknown;
}

/** A database: opens transactions and reports its existing stores. */
export interface IdbDatabaseLike {
  transaction(
    storeNames: string | string[],
    mode?: "readonly" | "readwrite",
  ): IdbTransactionLike;
  createObjectStore(
    name: string,
    options?: { keyPath?: string },
  ): IdbObjectStoreLike;
  objectStoreNames: { contains(name: string): boolean };
  close(): void;
}

/** An open-DB request: adds the upgrade hook the schema setup uses. */
export interface IdbOpenDbRequestLike extends IdbRequestLike<IdbDatabaseLike> {
  onupgradeneeded: ((this: unknown, ev: unknown) => void) | null;
}

/** The `indexedDB` factory handle — injectable so fake-indexeddb drives it under node. */
export interface IdbFactoryLike {
  open(name: string, version?: number): IdbOpenDbRequestLike;
}
