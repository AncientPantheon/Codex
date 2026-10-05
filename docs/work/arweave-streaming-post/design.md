# Arweave Streaming Post — Design

Topic 3 of `docs/work/arweave-streaming-upload/design.md`. Wires Topic 1
(streaming `data_root`, built) and Topic 2 (OPFS-backed bundle assembly,
built) into real transaction creation and chunk-by-chunk posting read
directly from OPFS, plus resumable state persistence.

## Problem

Verified by reading `arweave-js`'s real source (not assumed):
`Transaction.getChunk(idx, data)` (`node_modules/arweave/node/lib/
transaction.js`) — called by `TransactionUploader.uploadChunk()` for
every chunk — needs the FULL raw data buffer to slice out that chunk's
bytes (`data.slice(chunk.minByteRange, chunk.maxByteRange)`), even
though the wire protocol it's posting to is already chunk-based.
`TransactionUploader`'s own constructor stores the whole buffer
(`this.data = transaction.data`) for exactly this reason. So even
though Topic 1 makes computing the `data_root` fully streaming, the
STOCK uploader would still force the whole bundle back into memory at
posting time — the existing chunked-upload code already used elsewhere
in this project (`postArweaveData`) is not itself streaming at this
level, it just doesn't require re-sending the whole body in one HTTP
request.

A second, smaller gap: `getChunk` also needs `this.chunks.proofs[idx]`
— the Merkle inclusion proof per chunk — which comes from
`generateProofs(root)` (operating on the small in-memory tree, not raw
data) but Topic 1's `computeStreamingDataRoot` was scoped to return
only `{ data_root, chunks }`, not the proofs or the tree root needed to
derive them.

## Approach

**Extend Topic 1's output first (small, additive).** Add `proofs:
Proof[]` (or the tree root, whichever is more directly usable) to
`computeStreamingDataRoot`'s return shape, by calling `generateProofs`
on the tree it already builds internally (currently discarded after
extracting `.id`) — cheap, since the tree is already small and already
in memory at that point. Verify this exactly the way Topic 1's own
tests already do: byte-identical to what `arweave-js`'s own
`generateTransactionChunks`'s `proofs` field produces for the same
input.

**Build a streaming chunk-source POST loop**, a parallel implementation
of `TransactionUploader.uploadChunk()`'s per-chunk body construction
(`{ data_root, data_size, data_path: base64url(proof), offset,
chunk: base64url(bytes) }`) that reads ONLY that one chunk's bytes via
Topic 2's `BundleAssemblyFile.read(offset, length)` instead of slicing
a full in-memory buffer — everything else (the retry-in-place behavior
already built in `postArweaveData`'s `runUploaderLoop`, the fatal-vs-
retryable error classification, the chunk-index progression) is
preserved, reusing the SAME gateway POST endpoint (`/chunk`) and
request shape `arweave-js` already uses, just sourcing the one thing
(`chunk` bytes) differently.

**Resumability**: persist the small, already-serializable state
(`chunkIndex`, `txPosted`, the signed transaction metadata, `data_root`)
to a durable store (IndexedDB — this project already has an
`IdbDatabaseLike`-shaped seam per `library/types.ts`, reuse that
convention rather than inventing a new persistence layer) alongside a
reference to the OPFS file (which already survives a reload on its
own). A resumed upload: reopen the same OPFS file by name, reload the
persisted chunk-progress state, continue posting from
`chunkIndex` — never re-signs, never re-reads the original source
files, never recomputes `data_root`.

**Transaction creation itself** stays built on `arweave-js`'s real
`createTransaction`, but supplied the already-known `data_root`/
`data_size`/`chunks`/`proofs` directly (confirm during implementation
whether `createTransaction`'s options accept pre-computed chunks, or
whether `Transaction.chunks`/`.data_root` need to be set directly on
the constructed instance before signing, bypassing its own internal
`prepareChunks(data)` call which would otherwise require the full
buffer) — ground this precisely against the real source, it is a load
-bearing detail, not assumed from this doc alone.

## Acceptance criteria

- [ ] `computeStreamingDataRoot`'s extended output (`proofs`) is
      byte-identical to `arweave-js`'s own `generateTransactionChunks`
      for the same fixtures already used in Topic 1's tests.
- [ ] A streamed post of a real multi-chunk bundle reaches a real (or
      faithfully faked, for CI) gateway with a byte-identical sequence
      of per-chunk POST bodies to what the stock `TransactionUploader`
      would have sent for the same bundle — verified by comparison, not
      "looks right."
- [ ] At no point during posting does the implementation hold more than
      one chunk's bytes in memory at once — proven structurally, the
      same discipline Topic 1/2 already established.
- [ ] An upload interrupted mid-post (simulated: kill the loop after N
      chunks) and resumed from persisted state continues from chunk N,
      never re-posts chunks 0..N-1, never re-reads source files.
- [ ] A real browser smoke verification (same throwaway-script
      convention already used in Topic 2, not new permanent
      infrastructure) proves the whole pipeline — OPFS assembly through
      streaming post — produces a transaction a real gateway accepts.

## Out of scope

- The progress UI and removing the 1 GiB cap (Topic 4 of the parent
  project).
- OPFS-support detection/fallback routing (Topic 4 of the parent
  project).
- Any change to the gateway's own `/chunk` API contract.

## Topics

This split at planning time (the same escalation this session has hit
repeatedly on large topics): the full scope above is 5 tasks across 4
waves, past the plan skill's own ≤3-wave trigger.

1. `arweave-streaming-post-core` — the extended `proofs` output, the
   per-chunk POST-body builder reading from OPFS, and transaction
   creation + the streaming post loop itself. No resumability yet —
   proves the mechanism works end to end for an uninterrupted upload
   first. Shaped and planned next.
2. `arweave-streaming-post-resume` — resumable state persistence (the
   IndexedDB-backed progress seam) and the full real-browser end-to-end
   verification (OPFS assembly → streaming data_root → streaming post,
   proven against a real gateway). Depends on sub-topic 1 landing.
