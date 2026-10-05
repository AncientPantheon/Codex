# Arweave OPFS Bundle Assembly — Design

Topic 2 of `docs/work/arweave-streaming-upload/design.md`. Depends on
Topic 1 (`arweave-streaming-data-root`, built) only loosely — this topic
produces the OPFS-backed bundle file Topic 1's primitive will later read
from; it does not call Topic 1's code directly itself.

## Problem

`packages/arweave-core/src/upload/bundle.ts`'s `assembleSignedBundle`
(read in full before writing any code) builds the final bundle via
`Buffer.concat([...binaries])` after reading every file fully into
memory — exactly the pattern this whole project exists to replace.

## Approach

**The exact byte layout, confirmed by reading `assembleSignedBundle`
directly (not assumed):** a bundle is `32 bytes (item count,
`longTo32ByteArray`) + 64 bytes × N (per-item header: 32-byte length +
32-byte raw id) + the concatenated raw item binaries, in order`. The
header REGION's size (`32 + 64*N`) is known the instant the item count
(file count + 1 manifest) is known — before anything is signed. Only
the header's CONTENT (each item's final byte length + id) needs every
item to have been signed first.

This means: **no item size needs to be predicted before signing.**
Reserve the header region at the start of a new OPFS-backed file,
advance a write cursor through it as each item is signed (one file at a
time: read → sign via `arbundles`' standalone WebCrypto-only `sign()`
— the same fix already applied to the in-memory path this session,
never `DataItem.prototype.sign()`/`.rawId` — → write the signed bytes
at the current cursor position → record `{byteLength, rawId}` → release
the raw input bytes → advance cursor → next file), then build the
manifest LAST (it needs every file's final id, which are now all
known), sign and write it the same way, then **seek back to offset 0
and backfill the header region** now that every item's final
`{byteLength, rawId}` is known. The result is byte-identical to what
`assembleSignedBundle` produces today, just assembled incrementally
on disk instead of in one in-memory pass.

**OPFS access pattern:** mirror this project's own established
off-main-thread convention (`packages/codex-arweave/src/keygen/
KeygenRunner.ts`'s Worker-based RSA-4096 keygen) — run the whole
read→sign→write loop in a Worker, using `FileSystemSyncAccessHandle`
(synchronous, random-offset read/write, Worker-only) for the OPFS file
rather than the main-thread async `FileSystemWritableFileStream` API —
signing thousands of RSA-4096-backed items is real CPU work that
belongs off the main thread regardless of the I/O question. Ground the
exact OPFS API surface (`navigator.storage.getDirectory()` →
`FileSystemDirectoryHandle.getFileHandle(name, {create: true})` →
`FileSystemFileHandle.createSyncAccessHandle()`) during implementation,
not from this doc alone.

**Testability without a browser:** the OPFS file I/O itself is an
injectable seam (a small `{ write(offset, bytes), read(offset,
length), close() }`-shaped interface), satisfied by a real
`FileSystemSyncAccessHandle` in the browser and by a simple in-memory
or temp-file fake in Node tests — consistent with every other
browser-API seam this project has already built (`workerFactory` for
keygen, `fetchFn` for network calls).

**Scope boundary:** this topic produces a correctly-assembled
OPFS-backed bundle file plus the final `{manifestId, fileIds,
uploadId}` metadata. It does NOT post anything, and does NOT compute
the `data_root` (Topic 1's primitive exists for that, wired in by
Topic 3) — those are explicitly Topic 3's job, kept separate so this
topic's correctness (byte-for-byte bundle assembly) can be verified in
isolation first.

## Acceptance criteria

- [ ] For a real multi-file input (various sizes, including at least
      one large enough to meaningfully exceed a trivial in-memory
      concat), the OPFS-assembled bundle's bytes are identical to what
      `assembleSignedBundle` (the existing in-memory path) produces for
      the exact same input — verified by direct byte comparison, not
      "looks right."
- [ ] No file's raw bytes remain resident in memory once that file's
      signed data item has been written to the OPFS file — verified via
      an injectable seam that can assert this (e.g. a reference/weak-map
      check, or structurally by never holding more than one file's
      buffer at a time in the implementation).
- [ ] The header-backfill correctly reflects every item's real final
      byte length and id, including the manifest item written last.
- [ ] A real OPFS smoke test (not just the Node-fake-backed unit tests)
      confirms the primitive works against the actual browser API, run
      via whatever this project's existing browser-test tooling supports
      (ground this — check if Vitest's browser mode or a Playwright-based
      check already exists anywhere in this monorepo for a precedent to
      follow, rather than inventing new tooling).

## Out of scope

- Posting (Topic 3).
- Computing `data_root` from the assembled file (Topic 1's primitive,
  wired by Topic 3).
- Resumability / persisted upload state (Topic 3).
- The progress UI and removing the 1 GiB cap (Topic 4).
