## Wave 1

- [x] T1: The injectable OPFS-like file I/O seam. Read
      `packages/arweave-core/src/upload/bundle.ts`'s
      `assembleSignedBundle` in full first (the exact byte layout this
      whole topic reproduces incrementally: 32 bytes item-count +
      `64 * N` bytes of per-item `{32-byte length, 32-byte raw id}`
      headers + the concatenated raw item binaries) and
      `packages/codex-arweave/src/keygen/KeygenRunner.ts` (this
      project's own established off-main-thread Worker convention — the
      precedent to mirror for running this topic's heavy signing/IO loop
      off the main thread, not a new pattern).

      Define a small seam interface (e.g.
      `BundleAssemblyFile`): `write(offset: number, bytes: Uint8Array):
      Promise<void>`, `read(offset: number, length: number):
      Promise<Uint8Array>`, `close(): Promise<void>` — ground the exact
      method shapes against what's actually easy to implement on both
      sides (a real `FileSystemSyncAccessHandle` in a Worker, and a
      simple fake for Node tests), adjust if a different shape is
      cleaner. Implement TWO things against this interface:
      1. A real, browser-backed implementation using OPFS
         (`navigator.storage.getDirectory()` →
         `FileSystemDirectoryHandle.getFileHandle(name, {create:
         true})` → `FileSystemFileHandle.createSyncAccessHandle()` —
         confirm these exact API names/shapes against current MDN/spec
         knowledge as you implement; this runs inside a Worker, mirror
         `KeygenRunner.ts`'s worker-message-protocol conventions for how
         the caller talks to it).
      2. A simple in-memory (or Node temp-file-backed) fake satisfying
         the same interface, for unit tests — a Node/jsdom test
         environment has no OPFS at all, so this fake is what T2's tests
         actually exercise directly; the real OPFS implementation gets
         verified separately (T2's own done-when includes a real-browser
         check, not this task's job to build permanent browser-test
         infrastructure for — confirmed via investigation this session
         that no Playwright/Vitest-browser-mode tooling exists anywhere
         in this monorepo; a throwaway manually-run browser check is the
         right scope here, not new permanent infra).

      Follow TDD: write the failing tests first against the FAKE
      implementation (write at various offsets including non-sequential
      ones, read back, confirm byte-exact round trips; confirm writing
      past the current file length correctly extends it; confirm
      `close()` is idempotent-safe or clearly documented if not),
      confirm they fail, then implement.

      Done when: the fake implementation passes its own round-trip
      tests; the real OPFS-backed implementation compiles cleanly and
      correctly implements the same interface (full real-browser
      verification is T2's job, once there's an actual assembly
      pipeline worth verifying end to end — this task's own scope is the
      seam + fake + the real implementation's code, not yet proven live
      in a browser).
  - files: `packages/codex-arweave/src/library/streaming/bundleAssemblyFile.ts`
    (new — real OPFS-backed implementation + the interface), `packages/
    codex-arweave/src/library/streaming/fakeBundleAssemblyFile.ts` (new
    — the Node-test fake), `packages/codex-arweave/tests/
    streaming-bundle-assembly-file.test.ts` (new)

## Wave 2 (depends on Wave 1)

- [x] T2: The incremental bundle assembler. Read
      `packages/arweave-core/src/upload/bundle.ts`'s `uploadBundle` in
      full first (the per-file tag-building + `createData`/
      `signDataItem` calls — the EXACT signing convention to reuse
      verbatim, never `DataItem.prototype.sign()`/`.rawId`) alongside
      `assembleSignedBundle` again for the header-backfill arithmetic.

      Implement an incremental assembler (e.g.
      `assembleBundleToFile(files, manifestBuilder, file:
      BundleAssemblyFile): Promise<{ manifestId: string; fileIds: {
      path: string; id: string }[] }>` — exact signature is your call,
      ground it against what's actually ergonomic given T1's seam and
      what Topic 3 will plausibly need to call) that: computes the
      header region size from file count + 1 (manifest) up front, writes
      placeholder/zeroed header bytes there first (so the write cursor
      can start right after it), then for EACH file in sequence: builds
      its tags (reuse `buildUploadTags`/the exact tag set `uploadBundle`
      already builds per file — do not diverge), signs it via
      `signDataItem` (the already-established browser-safe path),
      writes its raw signed bytes via the seam's `write()` at the
      current cursor, records `{byteLength, rawId}`, advances the
      cursor, and — critically — releases the file's own raw input
      bytes (let them become garbage-collectable; do not hold a
      reference past this point) before moving to the next file. Once
      every file is done, build the manifest (same `index`/`paths`
      construction `uploadBundle` already does, needing every file's
      now-known final id), sign it the same way, write it as the final
      item. Then read back every recorded `{byteLength, rawId}` and
      backfill the header region at offset 0 via the seam's `write()`.

      Follow TDD: write the failing tests first, using T1's fake
      implementation as the file seam: for a real multi-file input
      (reuse realistic fixture files/sizes — at least one case with
      enough total size to prove the "one file resident at a time"
      property meaningfully, not just 2 tiny files), assert the
      resulting assembled bytes (read back via the fake's own storage)
      are byte-identical to calling the EXISTING in-memory
      `assembleSignedBundle` on the same input signed the same way —
      compare the full byte buffers directly. Also assert via the fake
      (or a wrapping spy) that no more than one file's raw input bytes
      are referenced/held at any point during the loop (structural
      proof, not just "trust the code"). Confirm all fail first, then
      implement.

      Additionally — part of THIS task's own done-when, not deferred —
      do a real, manual, throwaway-script verification against the
      ACTUAL OPFS-backed implementation from T1 (not just the fake): the
      same convention other tasks this session already used for
      real-browser checks (a small driven-headless-Chromium script over
      CDP, or equivalent), proving the real OPFS file ends up containing
      the correct assembled bytes for at least one real multi-file case.
      Describe exactly what you ran and observed in your report — this
      is a one-time manual proof, not new permanent test infrastructure.

      Done when: the fake-backed assembled bundle is byte-identical to
      the existing in-memory `assembleSignedBundle`'s output for the
      same input; the "only one file resident at a time" property is
      structurally proven; a real OPFS-backed run (verified manually,
      described in the report) produces the same correct result against
      the actual browser API.
  - files: `packages/codex-arweave/src/library/streaming/
    assembleBundleToFile.ts` (new), `packages/codex-arweave/tests/
    streaming-assemble-bundle-to-file.test.ts` (new)

  After implementing, run the full `codex-arweave` test suite (not just
  the new tests) and `npx tsc -b packages/codex-arweave --force` to
  confirm nothing else broke. The one known pre-existing unrelated
  failure is `tests/e3-library-store.test.ts`'s `node:sqlite` sandbox
  limitation. Check whether `arweave-core`'s dist needs rebuilding first
  if anything here imports from it (a repeatedly-hit stale-dist gotcha
  in this project).
