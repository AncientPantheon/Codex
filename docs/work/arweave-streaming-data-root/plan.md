## Wave 1

- [x] T1: The pure chunk-boundary planner. Read
      `node_modules/arweave/web/lib/merkle.js`'s `chunkData` function in
      full first (the real, shipped algorithm — do not work from a
      description, read the actual loop) — note `MAX_CHUNK_SIZE = 256 *
      1024`, `MIN_CHUNK_SIZE = 32 * 1024`, and the exact rebalancing
      rule: while remaining length >= `MAX_CHUNK_SIZE`, default chunk
      size is `MAX_CHUNK_SIZE`, UNLESS taking a full `MAX_CHUNK_SIZE`
      chunk would leave fewer than `MIN_CHUNK_SIZE` bytes remaining (and
      more than 0), in which case the CURRENT chunk size becomes
      `Math.ceil(rest / 2)` instead; after the loop, one final chunk
      covers whatever's left (possibly zero-length — `chunkData` itself
      always pushes it, but `generateTransactionChunks` later discards a
      trailing zero-length chunk/proof, read that discarding logic too
      since this task's planner must match `chunkData`'s own raw output,
      not the post-discard result).

      Implement `planChunkBoundaries(totalLength: number): Array<{
      offset: number; size: number }>` in a new module — pure function,
      zero I/O, zero data access, operating only on the length number,
      faithfully reproducing `chunkData`'s loop decision at each step.

      Follow TDD: write the failing tests first. For each of several
      fixture lengths (0 bytes, a few bytes, exactly `MAX_CHUNK_SIZE`,
      `MAX_CHUNK_SIZE + 1`, a length landing in the rebalancing branch —
      i.e. between `MAX_CHUNK_SIZE` and `MAX_CHUNK_SIZE +
      MIN_CHUNK_SIZE`, and a length spanning several full chunks plus a
      rebalanced tail), build a REAL buffer of that exact length (content
      doesn't matter, e.g. `Buffer.alloc(length)` or random bytes), call
      the REAL `chunkData` from `node_modules/arweave` on it, extract
      each returned chunk's `{ minByteRange, maxByteRange }` and convert
      to `{ offset: minByteRange, size: maxByteRange - minByteRange }`,
      and assert `planChunkBoundaries(length)` returns the IDENTICAL
      array (same count, same offsets, same sizes, same order). Confirm
      each test fails against a stub/empty implementation first, then
      implement `planChunkBoundaries` until all pass.

      Done when: `planChunkBoundaries(length)` matches `chunkData`'s own
      real output exactly for every fixture tried, including the
      rebalancing-branch case (the one most likely to be gotten wrong by
      a careless port).
  - files: `packages/arweave-core/src/upload/streaming/planChunkBoundaries.ts`
    (new), `packages/arweave-core/tests/streaming-plan-chunk-boundaries.test.ts`
    (new)

## Wave 2 (depends on Wave 1)

- [x] T2: The streaming leaf/tree/data_root pipeline. Read
      `node_modules/arweave/web/lib/merkle.js`'s `generateLeaves`,
      `buildLayers`, and `generateTransactionChunks` in full first —
      confirm directly (don't assume) that `generateLeaves`'s per-leaf
      hash construction needs only ONE chunk's `dataHash` (itself just a
      hash of that chunk's raw bytes — confirm `chunkData`'s own
      `common_1.default.crypto.hash(chunk)` call is a plain per-chunk
      hash, reusable as-is) plus that chunk's own byte-range metadata,
      never the full dataset, and that `buildLayers` operates purely on
      the already-computed leaf-node list (small, independent of total
      data size beyond leaf count) with no raw-data access at all. Where
      the real exported functions already satisfy "no full-buffer
      access needed" (almost certainly `buildLayers`, and the per-chunk
      hash primitive `generateLeaves` wraps), reuse them directly,
      unmodified, by importing from `arweave`'s own module — do not
      reimplement logic that's already safe to call as-is. Only the
      "read all data into chunks" step (`chunkData` itself) is what this
      task replaces, using T1's `planChunkBoundaries` plus a new
      injectable byte-range reader instead.

      Define `type ByteRangeReader = (offset: number, size: number) =>
      Promise<Uint8Array>`. Implement
      `computeStreamingDataRoot(totalLength: number, readRange:
      ByteRangeReader): Promise<{ data_root: Uint8Array; chunks: Chunk[]
      }>` (or whatever return shape mirrors `generateTransactionChunks`'s
      own real return shape closely enough for later topics to consume
      directly — ground this against `generateTransactionChunks`'s own
      `.d.ts`/source, match it rather than inventing a different shape)
      in a new module: call T1's planner on `totalLength`, for each
      planned `{offset, size}` call `readRange(offset, size)`, hash it
      the same way `chunkData` does, build the leaf exactly as
      `generateLeaves` does (reuse its real per-leaf construction
      directly if it's exported/importable at the right granularity;
      otherwise port the small hash-construction expression faithfully,
      citing the exact source lines in a comment), accumulate leaves,
      then call the real `buildLayers` unmodified to get the root.

      Follow TDD: write the failing tests first. For each of several
      real fixture buffers (reuse the same fixture-length set as T1,
      plus at least one large-ish multi-chunk buffer), build a
      `ByteRangeReader` that slices the SAME in-memory buffer by
      `(offset, size)` (a thin test double — for a real OPFS-backed
      reader, later topics' job), call
      `computeStreamingDataRoot(buffer.length, reader)`, and assert its
      `data_root` is byte-identical to calling the REAL
      `generateTransactionChunks(buffer)` directly on the same buffer.
      Also add a test asserting the reader is NEVER called with a range
      whose `size` exceeds `MAX_CHUNK_SIZE` (proves nothing ever asks
      for more than one chunk's worth of data at once) and that the
      union of all requested ranges exactly covers `[0, totalLength)`
      with no gap and no overlap (sort the recorded calls, check
      contiguity). Confirm all new tests fail against a stub first, then
      implement.

      Done when: `data_root` output is byte-identical to `arweave-js`'s
      own buffer-based `generateTransactionChunks` for every fixture
      tried; the reader is proven to only ever be asked for one
      chunk-sized range at a time, covering the whole input with no
      gaps/overlaps.
  - files: `packages/arweave-core/src/upload/streaming/computeStreamingDataRoot.ts`
    (new), `packages/arweave-core/tests/streaming-compute-data-root.test.ts`
    (new)

  After implementing, run the full `arweave-core` test suite (not just
  the new tests) and `npx tsc -b packages/arweave-core --force` to
  confirm nothing else broke. The one known pre-existing unrelated
  failure in this monorepo (in `codex-arweave`, not this package) is
  `tests/e3-library-store.test.ts`'s `node:sqlite` sandbox limitation —
  not relevant here. Check whether these new modules need exporting from
  `packages/arweave-core/src/index.ts`'s public barrel for later
  streaming-upload topics to reach them — this project has repeatedly
  found "forgot to export" gaps; decide based on whether Topic 2/3 would
  plausibly need to import from outside this package (likely yes, since
  the OPFS-backed bundle assembly living in `codex-arweave` will need to
  call into this).
