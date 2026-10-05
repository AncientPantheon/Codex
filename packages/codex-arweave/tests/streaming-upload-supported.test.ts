// @vitest-environment node
/**
 * T1 RED/GREEN (`arweave-streaming-ui`) — OPFS-support detection
 * (`isStreamingUploadSupported`).
 *
 * Grounding: `bundleAssemblyFile.ts`'s `openOpfsBundleAssemblyFile` takes an
 * injectable `getDirectory` but has no "is this even available" check of its
 * own — callers are expected to know. Just checking
 * `typeof navigator.storage?.getDirectory === "function"` is a false
 * positive in restricted contexts (private browsing, sandboxed iframes
 * without storage permission can expose the method but throw when actually
 * invoked), so this detector instead performs a REAL, minimal, throwaway
 * round-trip through the OPFS API surface — get the directory, create a
 * throwaway probe file, open a sync access handle on it, close it, then
 * delete the probe file — catching any failure at any step as `false`.
 *
 * `// @vitest-environment node` — this is pure logic over an injected fake;
 * nothing here touches a real browser/OPFS API or React, same reasoning
 * `streaming-bundle-assembly-file.test.ts` and `streaming-post.test.ts` give
 * for their own `node` pragma.
 *
 * The fakes below are hand-built structural stand-ins for
 * `FileSystemDirectoryHandle`/`FileSystemFileHandle`/
 * `FileSystemSyncAccessHandle` — there is no existing fake-OPFS-handle test
 * helper in this package to reuse (`fakeBundleAssemblyFile.ts` fakes the
 * higher-level `BundleAssemblyFile` seam directly, not the raw OPFS handle
 * chain `openOpfsBundleAssemblyFile`/this detector call through), so this
 * file builds its own, narrowly scoped to exactly the calls this detector
 * makes, mirroring `bundleAssemblyFile.ts`'s own "structural view, only the
 * members actually used" convention.
 */

import { describe, it, expect } from "vitest";

import { isStreamingUploadSupported } from "../src/library/streaming/isStreamingUploadSupported.js";

/** Records every OPFS-surface call made against a fake, in call order. */
function createCallLog(): { calls: string[]; record: (call: string) => void } {
  const calls: string[] = [];
  return { calls, record: (call: string) => calls.push(call) };
}

/**
 * Builds a fully-succeeding fake OPFS chain: `getDirectory()` resolves a
 * directory handle whose `getFileHandle` resolves a file handle whose
 * `createSyncAccessHandle` resolves a sync access handle with a no-op
 * `close()`, and whose `removeEntry` resolves cleanly — every step a
 * genuinely-supported browser context would complete without error.
 */
function createSucceedingFakeOpfs() {
  const { calls, record } = createCallLog();
  const getDirectory = async () => {
    record("getDirectory");
    return {
      getFileHandle: async (name: string, options?: { create?: boolean }) => {
        record(`getFileHandle:${name}:create=${options?.create ?? false}`);
        return {
          createSyncAccessHandle: async () => {
            record("createSyncAccessHandle");
            return {
              close: () => {
                record("close");
              },
            };
          },
        };
      },
      removeEntry: async (name: string) => {
        record(`removeEntry:${name}`);
      },
    };
  };
  return { getDirectory, calls };
}

describe("isStreamingUploadSupported (T1)", () => {
  it("resolves true when every OPFS step (open, probe, cleanup) succeeds", async () => {
    const { getDirectory } = createSucceedingFakeOpfs();

    // Regression this catches: a detector that only checks the method's
    // mere PRESENCE (the exact false-positive this task exists to avoid)
    // would also resolve `true` here, but so would a detector that never
    // actually attempts the real round trip — this test alone doesn't
    // distinguish those, which is exactly why the other cases below exist.
    await expect(isStreamingUploadSupported({ getDirectory })).resolves.toBe(
      true,
    );
  });

  it("resolves false, never throws, when getDirectory() itself rejects", async () => {
    const getDirectory = async () => {
      throw new Error("OPFS denied: storage permission blocked in this context");
    };

    // Regression this catches: a restricted context (private browsing,
    // sandboxed iframe) where `navigator.storage.getDirectory` EXISTS as a
    // function but throws the moment it's actually called — the exact false
    // positive a presence-only check would miss.
    await expect(isStreamingUploadSupported({ getDirectory })).resolves.toBe(
      false,
    );
  });

  it("resolves false when a LATER step (getFileHandle) throws, distinct from getDirectory failing", async () => {
    const getDirectory = async () => ({
      getFileHandle: async () => {
        throw new Error("quota exceeded");
      },
      removeEntry: async () => {
        throw new Error("should never be reached: nothing was created");
      },
    });

    // Regression this catches: a detector that only wraps the
    // `getDirectory()` call itself in try/catch, leaving a later real-API
    // call free to throw uncaught out of this function.
    await expect(isStreamingUploadSupported({ getDirectory })).resolves.toBe(
      false,
    );
  });

  it("resolves false when createSyncAccessHandle throws after the probe file was already created, without throwing out of the function", async () => {
    // Documents the true behavior for this narrow window: the probe file
    // WAS created (getFileHandle succeeded) before createSyncAccessHandle
    // failed, so a best-effort cleanup is still attempted for it — verified
    // by the removeEntry assertion below — but even if that cleanup attempt
    // itself were to fail, the function must still resolve `false`, never
    // throw and never flip to `true`.
    const { calls, record } = createCallLog();
    const getDirectory = async () => ({
      getFileHandle: async (name: string) => {
        record(`getFileHandle:${name}`);
        return {
          createSyncAccessHandle: async () => {
            throw new Error("sync access handle unavailable");
          },
        };
      },
      removeEntry: async (name: string) => {
        record(`removeEntry:${name}`);
      },
    });

    await expect(isStreamingUploadSupported({ getDirectory })).resolves.toBe(
      false,
    );
    // Best-effort cleanup of the already-created probe file still happens
    // on this later failure, even though the overall result is `false`.
    expect(calls.some((call) => call.startsWith("removeEntry:"))).toBe(true);
  });

  it("deletes the throwaway probe file (calls removeEntry) before resolving true on the success path", async () => {
    const { getDirectory, calls } = createSucceedingFakeOpfs();

    await isStreamingUploadSupported({ getDirectory });

    // Regression this catches: a detector that proves OPFS access works but
    // forgets to clean up its own throwaway probe file, leaving residue
    // behind in the user's real OPFS storage on every single check.
    expect(calls.some((call) => call.startsWith("removeEntry:"))).toBe(true);
    // The create → access → cleanup order must hold: cleanup happens AFTER
    // the probe was actually opened, not before or instead of it.
    const createIndex = calls.indexOf("createSyncAccessHandle");
    const removeIndex = calls.findIndex((call) => call.startsWith("removeEntry:"));
    expect(createIndex).toBeGreaterThanOrEqual(0);
    expect(removeIndex).toBeGreaterThan(createIndex);
  });
});
