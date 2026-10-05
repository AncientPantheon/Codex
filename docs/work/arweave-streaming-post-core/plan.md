## Wave 1

- [x] T1: Extend `computeStreamingDataRoot` with `proofs`. Read
      `packages/arweave-core/src/upload/streaming/computeStreamingDataRoot.ts`
      (already built this session) in full first, and
      `node_modules/arweave/web/lib/merkle.js`'s `generateProofs` and
      `generateTransactionChunks` (confirm exactly how
      `generateTransactionChunks` calls `generateProofs(root)` on the
      tree root node and includes the result as its own `proofs` field
      — your extension must match this precisely). Confirm whether
      `computeStreamingDataRoot`'s current implementation already has
      the tree root node available internally (it calls `buildLayers`
      to get the root, per T2 of the prior topic's own report) before
      extracting just `.id` — if so, this is a small, additive change:
      also call `generateProofs` on that same root and include it in
      the return value.

      Widen the return type (e.g. add `proofs: Proof[]` alongside the
      existing `data_root`/`chunks` fields — import the real `Proof`
      type from `arweave`'s merkle module the same way `Chunk` was
      already imported for the existing code).

      Follow TDD: write the failing tests first — reuse the SAME
      fixture set this module's existing tests already use (0, 5,
      MAX_CHUNK_SIZE, MAX_CHUNK_SIZE+1, the rebalancing-branch case,
      the composite multi-chunk case), and for each, assert the new
      `proofs` field is byte-identical (compare `.offset` and the raw
      `.proof` bytes for every entry, in order) to calling the REAL
      `generateTransactionChunks(buffer).proofs` directly on the same
      buffer. Confirm the new assertions fail against the current
      (proofs-less) implementation first, then implement.

      Done when: `proofs` output is byte-identical to `arweave-js`'s own
      `generateTransactionChunks`'s `proofs` field for every existing
      fixture. All of this module's PRE-EXISTING tests (data_root,
      reader-call-shape, gap/overlap coverage) still pass unmodified —
      explicit regression guard, this is a widening, not a rewrite.
  - files: `packages/arweave-core/src/upload/streaming/computeStreamingDataRoot.ts`,
    `packages/arweave-core/tests/streaming-compute-data-root.test.ts`

- [x] T2: The per-chunk POST-body builder reading from OPFS. Read
      `node_modules/arweave/node/lib/transaction.js`'s `getChunk(idx,
      data)` in full first (confirmed shape this task reproduces:
      `{ data_root, data_size, data_path: base64url(proof.proof),
      offset: proof.offset.toString(), chunk:
      base64url(data.slice(chunk.minByteRange, chunk.maxByteRange)) }`
      — read the exact base64url helper `arweave-js` uses,
      `ArweaveUtils.bufferTob64Url`, and mirror its exact encoding, NOT
      Node's own `"base64url"` string encoding — a sibling task earlier
      this session found the browser-polyfilled `buffer` package doesn't
      support `"base64url"` as a `Buffer.toString` argument at all, so
      match whatever `arweave-js`'s own util function does internally
      instead of assuming either path works) and
      `packages/codex-arweave/src/library/streaming/bundleAssemblyFile.ts`
      (the `BundleAssemblyFile` interface, already built — `read(offset,
      length): Promise<Uint8Array>`).

      Define your own local input type for this task (do NOT import
      `computeStreamingDataRoot`'s output type directly — decouple from
      T1's own file so these two tasks don't conflict): something like
      `{ dataRoot: string; dataSize: string; chunks: readonly {
      minByteRange: number; maxByteRange: number }[]; proofs: readonly {
      offset: number; proof: Uint8Array }[] }` (adjust field names/shape
      to whatever's most natural once you've read the real `Chunk`/
      `Proof` types — the point is this task's function signature should
      accept plain, already-known small metadata, not a full
      `Transaction` instance). Implement `buildStreamingChunkBody(idx:
      number, meta: <your type>, file: BundleAssemblyFile):
      Promise<{ data_root: string; data_size: string; data_path: string;
      offset: string; chunk: string }>` — reads exactly
      `chunks[idx].maxByteRange - chunks[idx].minByteRange` bytes via
      `file.read(chunks[idx].minByteRange, ...)`, encodes it the same
      way `getChunk` does, and assembles the same body shape.

      Follow TDD: write the failing tests first using
      `FakeBundleAssemblyFile` (already built) pre-loaded with known
      bytes at known offsets, and known `chunks`/`proofs` metadata
      (construct these directly from `arweave-js`'s own real
      `generateTransactionChunks` on a real small-to-multi-chunk test
      buffer, so the metadata is real, not invented) — for EVERY chunk
      index, assert `buildStreamingChunkBody`'s output is byte-identical
      (same `data_path`, same `offset`, same `chunk` base64url string)
      to calling the REAL `transaction.getChunk(idx, buffer)` on a REAL
      signed `arweave-js` `Transaction` built from the same buffer (you
      will need to actually construct and sign a minimal real
      transaction for this comparison — ground exactly how, reading
      `createTransaction`'s own real usage elsewhere in this package,
      e.g. `nativeUpload.ts`, for the pattern). Confirm failing first,
      then implement.

      Done when: output is byte-identical to the real `getChunk`'s
      output for every chunk index of a real multi-chunk fixture,
      proven by direct comparison against the real `arweave-js` API, not
      assumed from reading its source alone.
  - files: `packages/codex-arweave/src/library/streaming/buildStreamingChunkBody.ts`
    (new), `packages/codex-arweave/tests/streaming-build-chunk-body.test.ts`
    (new)

## Wave 2 (depends on Wave 1)

- [x] T3: Transaction creation + the streaming post loop. Read
      `node_modules/arweave/node/lib/transaction.js`'s `prepareChunks`
      (confirms `this.chunks`/`this.data_root` are plain assignable
      fields — `prepareChunks` only computes+assigns them when absent,
      so setting them directly BEFORE calling it, or instead of calling
      it at all, is the documented bypass path — ground this precisely,
      don't assume) and `packages/arweave-core/src/upload/nativeUpload.ts`'s
      `postArweaveData`/`runUploaderLoop` (the retry-in-place,
      pool-execute conventions to mirror for the new loop — chunk
      failures retried on the same attempt up to `MAX_CHUNK_RETRIES`
      before propagating, never silently swallowed) in full first.

      Build the real transaction creation path: construct a
      `Transaction` via `createTransaction` (or direct construction —
      ground which is correct) with `data: new Uint8Array(0)` (never the
      real bundle bytes) but with `.chunks`/`.data_root`/`.data_size`
      set directly from T1's extended `computeStreamingDataRoot` output
      (fed by Topic 2's `BundleAssemblyFile` for the actual byte reads
      during that computation) and `.owner`/tags/etc. set the same way
      `nativeUpload.ts`'s existing `postArweaveData` already does for a
      non-streaming upload — sign it via the SAME isolated signer
      (`signTransaction`, `src/signing/sign.ts` — the only signing path
      this project uses). Then build a streaming post loop (mirroring
      `runUploaderLoop`'s retry/abort-signal shape) that, for each chunk
      index from 0 to `chunks.length - 1`, builds the body via T2's
      `buildStreamingChunkBody` and POSTs it to the gateway's `/chunk`
      endpoint (confirm the exact endpoint/client call `postArweaveData`
      already uses and reuse it, don't invent a second gateway-call
      convention) — posting the transaction itself first (same
      `txPosted`-then-chunks ordering `TransactionUploader` already
      uses), tracking progress.

      Follow TDD: write the failing tests first — a real multi-file
      bundle assembled via Topic 2's `assembleBundleToFile` into a
      `FakeBundleAssemblyFile`, its `data_root`/`proofs` computed via
      T1's extended `computeStreamingDataRoot`, posted via this new
      streaming loop against a FAKE gateway API (mirror
      `nativeUpload.ts`'s own `UploadGatewayApi`/test-fake conventions),
      asserting: (a) the resulting signed transaction's `id` and
      `data_root` are IDENTICAL to what calling the EXISTING
      `postArweaveData` with the full (non-streaming) bundle bytes would
      produce for the same input and key — proving protocol-identical
      output, not just "a" transaction; (b) the sequence of per-chunk
      POST bodies sent to the fake gateway is byte-identical to what the
      stock `TransactionUploader` would have sent for the same bundle;
      (c) a chunk read never requests more than one chunk's worth of
      bytes from the `BundleAssemblyFile` at a time (structural proof,
      same discipline as every prior task in this project). Confirm
      failing first, then implement.

      Done when: all three comparisons above hold for a real multi-chunk
      fixture. The full `arweave-core` AND `codex-arweave` test suites
      pass (unscoped — check for and fix any gap outside this task's own
      file list, flagging explicitly if found; the one known
      pre-existing unrelated failure is `codex-arweave`'s
      `tests/e3-library-store.test.ts` `node:sqlite` sandbox
      limitation). Clean typecheck both packages. Rebuild `arweave-core`'s
      dist first if `codex-arweave` resolves a stale one (a repeatedly
      -hit gotcha in this project).
  - files: `packages/codex-arweave/src/library/streaming/streamingPost.ts`
    (new), `packages/codex-arweave/tests/streaming-post.test.ts` (new)
