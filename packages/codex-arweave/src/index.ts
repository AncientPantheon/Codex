/**
 * Public barrel for `@ancientpantheon/codex-arweave`.
 *
 * Aggregates the two E1 subpaths — the Arweave `ForeignChainAdapter`
 * (`./adapter`) and the seedless foreign-key keyring (`./keyring`) — behind
 * EXPLICIT NAMED exports. Never `export *` (PAT-001, arweave-core's
 * auditable-surface rule): every public symbol is enumerated here so a future
 * internal helper cannot silently leak into the package's API.
 *
 * The signer (`sign`/`post`/`buildSend`) is stubbed for E2/Phase 12 and the
 * `upload` path for E3/Phase 13 — neither is re-exported as "ready" here.
 */

// ----- Arweave foreign-chain adapter -----

export {
  createArweaveAdapter,
  registerArweave,
  ARWEAVE_CHAIN_ID,
  NotImplementedError,
} from "./adapter/index.js";
export type { ArweaveAdapterDeps } from "./adapter/index.js";

// ----- seedless foreign-key keyring -----

export {
  generateArweaveKey,
  importArweaveKey,
  decryptArweaveKey,
} from "./keyring/index.js";
export type {
  ForeignKeyStoreSeam,
  GenerateArweaveKeyArgs,
  ImportArweaveKeyArgs,
  DecryptArweaveKeyArgs,
} from "./keyring/index.js";

// ----- Library persistence + upload/track/poll/open + rebuild-from-chain (E3) -----
//
// The SEPARATE (N-07) Library layer: the `LibraryStore` seam + its Memory/IndexedDB
// impls, the manifest/permanence constants, the composition flows
// (`uploadAndTrack`/`pollStatus`/`openUrl`), and the rebuild-from-chain self-heal
// (`rebuildLibrary`). The adapter's `upload` path ships as a method of the
// `createArweaveAdapter` result above (E3 activated it). EXPLICIT NAMED exports
// (PAT-001); no `SqliteLibraryStore` (deferred to E4).

export {
  MemoryLibraryStore,
  IndexedDBLibraryStore,
  MANIFEST_CONTENT_TYPE,
  UPLOAD_PERMANENCE_WARNING,
  uploadAndTrack,
  pollStatus,
  openUrl,
  rebuildLibrary,
} from "./library/index.js";
export type {
  LibraryStore,
  LibraryEntry,
  LibraryStatus,
  OpenIndexedDBLibraryStoreOptions,
  UploadAndTrackOptions,
  PollStatusOptions,
  OpenUrlOptions,
  RebuildLibraryOptions,
} from "./library/index.js";
