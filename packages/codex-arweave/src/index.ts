/**
 * Public barrel for `@ancientpantheon/codex-arweave` — the LIGHT `.` root.
 *
 * Aggregates the E1-E3 subpaths — the Arweave `ForeignChainAdapter`
 * (`./adapter`), the seedless foreign-key keyring (`./keyring`), the Library
 * layer (`./library`), and the LIGHT address-book surface (`./address-book`) —
 * behind EXPLICIT NAMED exports. Never `export *` (PAT-001, arweave-core's
 * auditable-surface rule): every public symbol is enumerated here so a future
 * internal helper cannot silently leak into the package's API.
 *
 * LIGHT-SURFACE DISCIPLINE (E-12 / FIX-2): this root carries NO static edge to
 * the heavy `./panel` React runtime and NO top-level `@ardrive/turbo-sdk`/
 * `arweave` import. The panel is reached ONLY via the separate `./panel`
 * subpath (the heavy entry, which wraps Turbo behind `lazyDeps.ts`'s dynamic
 * `import()`). The E1-E3 adapter/keyring/upload re-exports below DO statically
 * reach arweave-core's `arweave` edge, but arweave-core is `sideEffects:false`,
 * so a consumer importing ONLY the light address-book surface tree-shakes them
 * away — the bundle-emit gate (`tests/e4-treeshake-bundle.test.ts`) proves it.
 *
 * The signer (`sign`/`post`/`buildSend`) is stubbed for E2/Phase 12 and the
 * `upload` path for E3/Phase 13 — neither is re-exported as "ready" here.
 *
 * TERMINAL RECONCILIATION (E4): the E4 light additions that belong on this root
 * are the address-book surface (already re-exported below) and the concrete Node
 * `SqliteLibraryStore` (E-07 carry) — a LIGHT store behind E3's seam whose only
 * heavy dependency is a LAZY `await import("node:sqlite")` at first use, so it
 * carries no static heavy edge. The heavy React panel stays the `./panel` subpath
 * only (never re-exported here). E1-E3's adapter/keyring/upload re-exports are
 * PRESERVED (never dropped — their consumers depend on the root export).
 */

// ----- LIGHT address-book surface (E-11 / FIX-8) -----
//
// The single-source `ARWEAVE_CHAIN_ID` + the Arweave address validator
// registration. This subpath carries NO heavy edge, so it is the surface a
// light consumer imports. `ARWEAVE_CHAIN_ID` is re-exported from HERE (its
// single home) rather than from `./adapter` (which itself re-exports it from
// the same `./address-book/chainId` module).

export { ARWEAVE_CHAIN_ID } from "./address-book/index.js";
export {
  arweaveValidator,
  registerArweaveAddressValidator,
} from "./address-book/index.js";

// ----- Arweave foreign-chain adapter -----

export {
  createArweaveAdapter,
  registerArweave,
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
// The SEPARATE (N-07) Library layer: the `LibraryStore` seam + its Memory/IndexedDB/
// SQLite impls, the manifest/permanence constants, the composition flows
// (`uploadAndTrack`/`pollStatus`/`openUrl`), and the rebuild-from-chain self-heal
// (`rebuildLibrary`). The adapter's `upload` path ships as a method of the
// `createArweaveAdapter` result above (E3 activated it). EXPLICIT NAMED exports
// (PAT-001). `SqliteLibraryStore` (E-07 carry) is light — its `node:sqlite` edge
// is a lazy `await import()` at first use, not a static top-level import.

export {
  MemoryLibraryStore,
  IndexedDBLibraryStore,
  SqliteLibraryStore,
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
  OpenSqliteLibraryStoreOptions,
  UploadAndTrackOptions,
  PollStatusOptions,
  OpenUrlOptions,
  RebuildLibraryOptions,
} from "./library/index.js";
