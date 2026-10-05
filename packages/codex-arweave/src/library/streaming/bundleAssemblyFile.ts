/**
 * The injectable OPFS-like file I/O seam (T1 of `arweave-opfs-bundle-assembly`).
 *
 * `assembleSignedBundle` (`@ancientpantheon/arweave-core`'s `upload/bundle.ts`,
 * read in full before writing this) builds a bundle by holding every signed
 * item's raw bytes in memory at once and `Buffer.concat`-ing them — exactly the
 * pattern this whole streaming-upload project replaces. The exact byte layout
 * it reproduces, confirmed by reading that function directly: 32 bytes
 * (item count) + 64 bytes × N (per-item header: 32-byte length + 32-byte raw
 * id) + the concatenated raw item binaries, in order.
 *
 * `BundleAssemblyFile` is the seam the NEXT task's incremental assembler
 * (`assembleBundleToFile`, T2) writes that same layout against, one file at a
 * time, without ever holding the whole bundle in memory. Its write/read access
 * pattern is deliberately non-sequential: the header REGION's size is known up
 * front (file count + 1 manifest), so the assembler reserves it, writes item
 * bodies forward past it, then seeks back to offset 0 to backfill the header
 * CONTENT once every item's real length/id is known (every item must be signed
 * first). `write`/`read` take an explicit `offset` (not an implicit cursor) for
 * exactly that reason.
 *
 * Two implementations satisfy this interface:
 *   - {@link openOpfsBundleAssemblyFile} — the real, browser/Worker-backed impl,
 *     over a `FileSystemSyncAccessHandle` (OPFS, Worker-only, synchronous
 *     random-offset read/write — the right primitive for the heavy signing
 *     loop T2 runs off the main thread, mirroring this project's own
 *     established Worker convention in `keygen/KeygenRunner.ts`).
 *   - `FakeBundleAssemblyFile` (`fakeBundleAssemblyFile.ts`) — an in-memory
 *     fake for Node tests, since neither Node nor jsdom has OPFS at all. T2's
 *     own tests exercise THIS implementation directly; the real OPFS impl is
 *     verified separately (compiles here; a real-browser run is a later
 *     task's job).
 */

/**
 * The seam interface. Every method is `offset`-explicit (never an implicit
 * cursor) because the assembler's access pattern is non-sequential: it writes
 * forward past a reserved header region, then seeks back to offset 0 once
 * every item is signed. `read(offset, length)` ALWAYS resolves a `length`-byte
 * `Uint8Array`, zero-filled for any portion of the requested range that was
 * never written (or lies past the current end) — the same zero-fill behavior
 * `FileSystemSyncAccessHandle.write()` gives a gap introduced by writing past
 * the current end, so both implementations behave identically at that edge.
 * `close()` is idempotent: a second call is a safe no-op, so a caller (the
 * eventual Worker message loop) can close on both its success and
 * cleanup/error paths without tracking whether it already ran.
 */
export interface BundleAssemblyFile {
  /** Writes `bytes` at `offset`, extending the file (zero-filling any gap
   *  ahead of the previous end) if `offset + bytes.byteLength` exceeds it. */
  write(offset: number, bytes: Uint8Array): Promise<void>;
  /** Resolves exactly `length` bytes starting at `offset`, zero-filled for any
   *  portion never written (or past the current end). */
  read(offset: number, length: number): Promise<Uint8Array>;
  /** Releases the underlying handle. Idempotent — safe to call more than once. */
  close(): Promise<void>;
}

/**
 * Structural view of the OPFS sync-access-handle surface this module needs,
 * declared LOCALLY rather than depending on TypeScript's ambient `DOM`/
 * `WebWorker` lib typings. Confirmed against the installed TypeScript 5.9
 * lib files: `FileSystemSyncAccessHandle`/`createSyncAccessHandle()` are
 * declared in `lib.webworker.d.ts` ONLY — `lib.dom.d.ts` has no
 * `createSyncAccessHandle` on its own `FileSystemFileHandle` and no
 * `FileSystemSyncAccessHandle` type at all — and this package's tsconfig
 * pulls in `"DOM"`, not `"WebWorker"` (it is NOT built as a worker entry
 * itself; `keygen/worker.ts` is the sibling precedent for that split, and
 * types the worker-global `self` locally for the same reason). This mirrors
 * `KeygenRunner.ts`'s own locally-typed `WorkerLike` and `library/types.ts`'s
 * locally-typed IndexedDB surfaces (`IdbDatabaseLike` etc.) — the established
 * convention for a narrow browser-API surface this package's lib config
 * doesn't otherwise carry, rather than widening that config for one corner.
 */
interface OpfsSyncAccessHandleLike {
  read(buffer: Uint8Array, options?: { at?: number }): number;
  write(buffer: Uint8Array, options?: { at?: number }): number;
  flush(): void;
  close(): void;
}

/** Structural view of `FileSystemFileHandle`'s one member this module uses. */
interface OpfsFileHandleLike {
  createSyncAccessHandle(): Promise<OpfsSyncAccessHandleLike>;
}

/** Structural view of `FileSystemDirectoryHandle`'s one member this module uses. */
interface OpfsDirectoryHandleLike {
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<OpfsFileHandleLike>;
}

/** Structural view of `StorageManager`'s one member this module uses. */
interface OpfsStorageManagerLike {
  getDirectory(): Promise<OpfsDirectoryHandleLike>;
}

/** Options for {@link openOpfsBundleAssemblyFile}. */
export interface OpenOpfsBundleAssemblyFileOptions {
  /**
   * Produces the OPFS root directory handle. INJECTED — never a hardcoded
   * `navigator.storage.getDirectory()` reference baked into the function body
   * — mirrors this project's own `workerFactory` (`KeygenRunner.ts`) and
   * `fetchFn` (arweave-core) injectable-browser-API-seam convention. Defaults
   * to the real `navigator.storage.getDirectory()`.
   */
  getDirectory?: () => Promise<OpfsDirectoryHandleLike>;
}

function defaultGetDirectory(): Promise<OpfsDirectoryHandleLike> {
  // Read through the structural view (never `any`) — same pattern
  // `createWorkerKeygenRunner` uses to read the DOM `Worker` through
  // `WorkerLike`. This is the ONE place a real ambient `navigator` is
  // touched; everywhere else in this module only sees the injected seam.
  const storage = (
    navigator as unknown as { storage: OpfsStorageManagerLike }
  ).storage;
  return storage.getDirectory();
}

/**
 * Opens (creating if absent) the named OPFS file and returns a
 * {@link BundleAssemblyFile} backed by a real `FileSystemSyncAccessHandle`.
 *
 * API chain confirmed against `lib.webworker.d.ts` (see the structural types
 * above): `navigator.storage.getDirectory()` →
 * `FileSystemDirectoryHandle.getFileHandle(name, { create: true })` →
 * `FileSystemFileHandle.createSyncAccessHandle()`. A sync access handle is
 * exclusive per file and Worker-only (no other handle — including a second
 * call to this function for the same `name` — may be open concurrently); this
 * function itself makes no main-thread-only assumption, so it is callable from
 * wherever it eventually gets invoked (a Worker, per this topic's design).
 */
export async function openOpfsBundleAssemblyFile(
  name: string,
  options: OpenOpfsBundleAssemblyFileOptions = {},
): Promise<BundleAssemblyFile> {
  const getDirectory = options.getDirectory ?? defaultGetDirectory;
  const directory = await getDirectory();
  const fileHandle = await directory.getFileHandle(name, { create: true });
  const accessHandle = await fileHandle.createSyncAccessHandle();
  return new OpfsBundleAssemblyFile(accessHandle);
}

/**
 * The real impl: wraps a `FileSystemSyncAccessHandle`'s synchronous
 * read/write/close in the seam's async methods. `write`/`read` pass `{ at:
 * offset }` — the handle's own random-offset option — so no implicit cursor
 * is tracked here; the assembler above owns cursor arithmetic entirely.
 */
class OpfsBundleAssemblyFile implements BundleAssemblyFile {
  #handle: OpfsSyncAccessHandleLike | null;

  constructor(handle: OpfsSyncAccessHandleLike) {
    this.#handle = handle;
  }

  async write(offset: number, bytes: Uint8Array): Promise<void> {
    const handle = this.#requireOpen();
    // `FileSystemSyncAccessHandle.write()` itself extends the file and
    // zero-fills any gap when `offset` lands past the current end (per spec)
    // — this method adds no extend/zero-fill logic of its own.
    handle.write(bytes, { at: offset });
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    const handle = this.#requireOpen();
    const buffer = new Uint8Array(length);
    // `buffer` is freshly allocated (zero-initialized); any tail the handle's
    // `read()` leaves untouched (reading past the current end) stays zero,
    // matching this seam's documented zero-fill-on-short-read contract.
    handle.read(buffer, { at: offset });
    return buffer;
  }

  async close(): Promise<void> {
    // Idempotent by construction: a second call finds `#handle` already
    // `null` and is a no-op, regardless of whether the underlying
    // `FileSystemSyncAccessHandle.close()` itself tolerates a double call.
    if (this.#handle === null) {
      return;
    }
    // Flush before closing so the manual browser verification (a later
    // task) reading the file back via `getFile()` sees every write, not
    // whatever the UA happened to have committed so far.
    this.#handle.flush();
    this.#handle.close();
    this.#handle = null;
  }

  #requireOpen(): OpfsSyncAccessHandleLike {
    if (this.#handle === null) {
      throw new Error("BundleAssemblyFile: already closed");
    }
    return this.#handle;
  }
}
