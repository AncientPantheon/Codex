# Arweave Streaming Data Root — Design

Topic 1 of `docs/work/arweave-streaming-upload/design.md`. A pure,
OPFS-independent algorithm — testable against any byte-range-readable
source (a plain Node buffer in tests, an OPFS file later), not
browser-dependent. Foundational for the rest of the streaming-upload
project; nothing else in that project can start until this produces
provably correct output.

## Problem

`arweave-js`'s own `chunkData`/`generateTransactionChunks` (read in
full at `node_modules/arweave/web/lib/merkle.js` before writing any
code) require a fully-materialized `Uint8Array` — the whole point of
this project is to never hold the whole payload in memory, so this
function cannot be called as-is for a large upload.

## Approach

**Key finding from reading the real algorithm (not assumed):**
`chunkData`'s loop decides each chunk's size using only
`rest.byteLength` — the REMAINING length from the current position to
the end — never the actual byte content. Concretely: default chunk
size is `MAX_CHUNK_SIZE` (256 KiB); if taking a full `MAX_CHUNK_SIZE`
chunk would leave a next chunk smaller than `MIN_CHUNK_SIZE` (32 KiB),
the CURRENT chunk is rebalanced to `ceil(rest.byteLength / 2)` instead,
so no tiny dangling last chunk is ever produced. **This means every
chunk's exact `{offset, size}` for an entire upload can be computed
from the TOTAL length alone, before any bytes are read** — chunk
planning needs zero I/O and zero lookahead/buffering. This removes what
would otherwise be the hardest part of a streaming port.

Two-stage design, matching this split:

1. **A pure chunk-boundary planner.** `planChunkBoundaries(totalLength:
   number): Array<{ offset: number; size: number }>` — a direct,
   faithful port of `chunkData`'s loop logic, operating on a length
   number only, no data, no I/O. Verified correct by comparing its
   output against `arweave-js`'s own real `chunkData` fed a real
   buffer of the same length (extract `minByteRange`/`maxByteRange`
   from its returned chunks, compare to the planner's `{offset, size}`
   pairs — must match exactly, for every fixture size tried, including
   the specific sizes that trigger the `MIN_CHUNK_SIZE` rebalancing
   branch).
2. **Streaming leaf + tree + data_root computation**, built on (1) plus
   an injectable byte-range reader (`readRange(offset: number, size:
   number): Promise<Uint8Array>` — satisfied by a plain buffer/file
   slice in tests; later satisfied by an OPFS read in Topic 2/3, not
   this topic's concern). For each planned chunk: read just that range,
   hash it (reusing `arweave-js`'s own per-leaf hash construction from
   `generateLeaves` — it already only needs one chunk's hash + its byte
   range, never the whole dataset), discard the bytes, keep the leaf.
   Once every leaf is computed (a small, bounded list — leaf count
   scales with total size ÷ 256 KiB, e.g. ~4 million leaves at 32-byte
   dataHash + overhead for a full terabyte, roughly 128 MB, not
   terabytes), build the tree via `arweave-js`'s own `buildLayers`
   directly (unmodified — it already only operates on the small leaf
   list, never raw data, so there is nothing to port there).

## Acceptance criteria

- [ ] `planChunkBoundaries` produces chunk ranges identical to
      `arweave-js`'s real `chunkData` for every tried fixture length,
      including at least: a length smaller than one chunk, a length
      that's an exact multiple of `MAX_CHUNK_SIZE`, and a length
      specifically chosen to land in the `MIN_CHUNK_SIZE` rebalancing
      branch (total length between `MAX_CHUNK_SIZE` and
      `MAX_CHUNK_SIZE + MIN_CHUNK_SIZE`).
- [ ] The full streaming pipeline (planner + byte-range reader +
      leaf/tree computation) produces a `data_root` byte-identical to
      `arweave-js`'s own buffer-based `generateTransactionChunks` for
      the same fixture set, proven by direct comparison, not by
      separately "looking correct."
- [ ] The byte-range reader is called with non-overlapping, fully
      covering ranges for the whole input (no gap, no overlap) —
      verified directly, not assumed from the planner's own correctness
      alone.
- [ ] No step in this pipeline ever requires the full payload resident
      in memory at once — verified by an injectable reader in tests
      that would fail/assert if asked for a range larger than one
      planned chunk.

## Out of scope

- OPFS itself — the byte-range reader is an injectable seam; wiring a
  real OPFS-backed implementation is Topic 2/3's job.
- Signing, bundle assembly, posting — later topics.
- Any change to `arweave-js` itself — this is a from-scratch,
  standalone module in `arweave-core` that reuses its algorithm (by
  reading and faithfully porting it) and, where directly reusable
  without modification (leaf hash construction, tree building), its
  actual exported functions.
