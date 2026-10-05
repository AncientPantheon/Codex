/**
 * OPFS-support detection (T1 of `arweave-streaming-ui`).
 *
 * `bundleAssemblyFile.ts`'s `openOpfsBundleAssemblyFile` takes an injectable
 * `getDirectory` seam but performs no "is this even available" check of its
 * own — callers are expected to know. `UploadWizard.tsx`'s real routing
 * (a later task in this sub-topic) needs exactly that check, once per
 * upload session, before deciding whether to route through the streaming
 * engines or fall back to the in-memory path.
 *
 * Just checking `typeof navigator.storage?.getDirectory === "function"` is a
 * false positive in some restricted browser contexts — private browsing and
 * sandboxed iframes without storage permission can expose the method on the
 * prototype while still throwing the moment it's actually invoked (or the
 * moment a real file operation is attempted against the directory it
 * returns). The only reliable way to know a context genuinely grants OPFS
 * access is to try the real thing: open the root directory, create a
 * throwaway probe file, open a sync access handle on it (the same handle
 * type `openOpfsBundleAssemblyFile` opens for real work), close it, then
 * delete the probe file. Any thrown error at any step — including the
 * initial `getDirectory()` call itself — is caught and yields `false`;
 * `true` only on genuine, full-round-trip success.
 *
 * On `bundleAssemblyFile.ts`'s own types: `OpfsDirectoryHandleLike` /
 * `OpfsFileHandleLike` / `OpfsSyncAccessHandleLike` declared there are NOT
 * exported (confirmed by reading that file in full — only
 * `BundleAssemblyFile`, `OpenOpfsBundleAssemblyFileOptions`, and
 * `openOpfsBundleAssemblyFile` are), and are each narrowed to only the
 * members THAT module uses — notably, its `OpfsDirectoryHandleLike` has no
 * `removeEntry`, which this module needs for its own cleanup step. Importing
 * them unmodified is therefore not possible without editing that file
 * (out of this task's scope), and they wouldn't fully cover this module's
 * needs even if they were exported. Per that file's own documented
 * rationale for declaring these structurally rather than importing ambient
 * `DOM`/`WebWorker` lib typings, this module follows the identical
 * convention and declares its OWN narrow structural view — same member
 * names where they overlap, so a real `FileSystemDirectoryHandle` (or a
 * shared fake) satisfies both this module's and `bundleAssemblyFile.ts`'s
 * views side by side without any cast — scoped to exactly what THIS probe
 * needs.
 */

/** Structural view of `FileSystemSyncAccessHandle`'s one member this module uses. */
interface OpfsSyncAccessHandleLike {
  close(): void;
}

/** Structural view of `FileSystemFileHandle`'s one member this module uses. */
interface OpfsFileHandleLike {
  createSyncAccessHandle(): Promise<OpfsSyncAccessHandleLike>;
}

/**
 * Structural view of `FileSystemDirectoryHandle`'s members this module
 * uses — `getFileHandle` (to create the throwaway probe) and `removeEntry`
 * (to delete it again), the latter not needed by `bundleAssemblyFile.ts`'s
 * own narrower view since that module never deletes anything.
 */
export interface OpfsDirectoryHandleLike {
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<OpfsFileHandleLike>;
  removeEntry(name: string): Promise<void>;
}

/** Structural view of `StorageManager`'s one member this module uses. */
interface OpfsStorageManagerLike {
  getDirectory(): Promise<OpfsDirectoryHandleLike>;
}

/** Options for {@link isStreamingUploadSupported}. */
export interface IsStreamingUploadSupportedOptions {
  /**
   * Produces the OPFS root directory handle. INJECTED — mirrors
   * `openOpfsBundleAssemblyFile`'s own `getDirectory` injection convention
   * exactly, including defaulting to the real
   * `navigator.storage.getDirectory()` when omitted — so tests never touch
   * a real browser API and the real call path is exercised identically to
   * how `bundleAssemblyFile.ts` exercises it.
   */
  getDirectory?: () => Promise<OpfsDirectoryHandleLike>;
}

/** The throwaway probe file's name — clearly scoped so it's unmistakably this project's, never confused with real uploaded content. */
const PROBE_FILE_NAME = ".codex-opfs-probe";

function defaultGetDirectory(): Promise<OpfsDirectoryHandleLike> {
  // Read through the structural view (never `any`) — the same one real
  // `navigator` touch `bundleAssemblyFile.ts`'s own `defaultGetDirectory`
  // makes; everywhere else in this module only sees the injected seam.
  const storage = (
    navigator as unknown as { storage: OpfsStorageManagerLike }
  ).storage;
  return storage.getDirectory();
}

/**
 * Actually attempts a real, minimal, throwaway round trip through the OPFS
 * API surface — get the directory, create a throwaway probe file, open a
 * sync access handle on it, close it, then delete the probe file — rather
 * than merely checking whether `navigator.storage.getDirectory` exists as a
 * function (a false positive in some restricted contexts; see the module
 * doc comment above).
 *
 * Any thrown error at any step is caught and yields `false`; this function
 * never throws.
 *
 * Cleanup behavior, by failure point (the true behavior this
 * implementation produces, not merely what would be convenient to claim):
 * - `getDirectory()` or `getFileHandle()` throwing: no probe file was ever
 *   created, so no cleanup is attempted — there is nothing to clean up.
 * - `createSyncAccessHandle()` (or anything after) throwing: the probe file
 *   WAS already created by the preceding `getFileHandle(..., { create:
 *   true })` call, so a best-effort `removeEntry` is still attempted for it
 *   before returning `false`. That cleanup attempt's own outcome (success
 *   or failure) is swallowed either way — it must never flip a genuine
 *   "unsupported" result to `true`, and must never throw out of this
 *   function.
 */
export async function isStreamingUploadSupported(
  opts: IsStreamingUploadSupportedOptions = {},
): Promise<boolean> {
  const getDirectory = opts.getDirectory ?? defaultGetDirectory;
  let directory: OpfsDirectoryHandleLike | undefined;
  let probeFileCreated = false;

  try {
    directory = await getDirectory();
    const fileHandle = await directory.getFileHandle(PROBE_FILE_NAME, {
      create: true,
    });
    probeFileCreated = true;

    const syncAccessHandle = await fileHandle.createSyncAccessHandle();
    syncAccessHandle.close();

    await directory.removeEntry(PROBE_FILE_NAME);
    probeFileCreated = false;
    return true;
  } catch {
    if (probeFileCreated && directory) {
      try {
        await directory.removeEntry(PROBE_FILE_NAME);
      } catch {
        // Genuinely unsupported/denied contexts may not even support
        // `removeEntry` — nothing more can be done, and this must never
        // throw out of this function nor mask the `false` result below.
      }
    }
    return false;
  }
}
