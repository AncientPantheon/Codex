/**
 * Library SUBPATH barrel for @ancientpantheon/codex-arweave.
 *
 * The SEPARATE (N-07) Library persistence layer: the `LibraryStore` seam, its
 * two reference impls (Memory for node/tests, IndexedDB for the browser — the
 * node SQLite impl is deferred), and the shared constants. EXPLICIT NAMED
 * exports only (never `export *`) so the public surface is auditable.
 *
 * The composition flows (`uploadAndTrack`/`pollStatus`/`openUrl`) and the
 * rebuild-from-chain self-heal (`rebuildLibrary`) are added to this barrel by a
 * later task; this barrel is the import site for the store seam + impls today.
 * The root `src/index.ts` aggregation is owned by that later task.
 */

export { MemoryLibraryStore } from "./memoryStore.js";
export {
  IndexedDBLibraryStore,
  type OpenIndexedDBLibraryStoreOptions,
} from "./indexedDbStore.js";
export {
  SqliteLibraryStore,
  type OpenSqliteLibraryStoreOptions,
} from "./sqliteStore.js";
export {
  MANIFEST_CONTENT_TYPE,
  UPLOAD_PERMANENCE_WARNING,
} from "./constants.js";
export type {
  LibraryStore,
  LibraryEntry,
  LibraryStatus,
} from "./types.js";

// ----- composition flows + rebuild-from-chain (E-07 / E-08) -----

export { uploadAndTrack, pollStatus, openUrl } from "./flow.js";
export type {
  UploadAndTrackOptions,
  PollStatusOptions,
  OpenUrlOptions,
} from "./flow.js";
export { rebuildLibrary } from "./rebuild.js";
export type { RebuildLibraryOptions } from "./rebuild.js";
