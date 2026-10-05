/**
 * `planChunkBoundaries` — the pure chunk-boundary planner for streaming uploads.
 *
 * A faithful, line-by-line port of `arweave-js`'s own `chunkData` loop
 * (`node_modules/arweave/web/lib/merkle.js`, identical source under
 * `node/lib/merkle.js`), but operating on a LENGTH NUMBER only — never a
 * materialized buffer. `chunkData`'s own loop decides every chunk's size from
 * `rest.byteLength` alone (the remaining length from the current position to
 * the end), never the actual byte content, so the full chunk plan for an
 * upload of any size — including a 6+ GB folder — can be computed up front
 * without ever holding the payload in memory.
 *
 * Ported decision rule (mirrors `chunkData` exactly):
 *   - While `rest >= MAX_CHUNK_SIZE` (256 KiB): the default chunk size is
 *     `MAX_CHUNK_SIZE`, UNLESS taking a full `MAX_CHUNK_SIZE` chunk would
 *     leave a next chunk strictly under `MIN_CHUNK_SIZE` (32 KiB) — a
 *     nonzero remainder narrower than the floor — in which case the CURRENT
 *     chunk is rebalanced to `Math.ceil(rest / 2)` instead, so no dangling
 *     tiny last chunk is ever produced.
 *   - After the loop, one final chunk always covers whatever is left,
 *     including a zero-length chunk for a zero-length (or exactly
 *     MAX_CHUNK_SIZE-length) input — this matches `chunkData`'s own RAW
 *     output, which `generateTransactionChunks` later discards if
 *     zero-length; discarding is that caller's job, not this planner's.
 *
 * Verified byte-for-byte against the real `chunkData` fed a real buffer of
 * the same length — see `tests/streaming-plan-chunk-boundaries.test.ts`.
 */

const MAX_CHUNK_SIZE = 256 * 1024;
const MIN_CHUNK_SIZE = 32 * 1024;

/** One planned chunk's byte range: `size` bytes starting at `offset`. */
export interface ChunkBoundary {
  offset: number;
  size: number;
}

/**
 * Computes every chunk's `{offset, size}` for an upload of `totalLength`
 * bytes, without reading or requiring any of the actual data.
 */
export function planChunkBoundaries(totalLength: number): ChunkBoundary[] {
  const boundaries: ChunkBoundary[] = [];
  let rest = totalLength;
  let cursor = 0;

  while (rest >= MAX_CHUNK_SIZE) {
    let chunkSize = MAX_CHUNK_SIZE;

    // If the total bytes left will produce a chunk < MIN_CHUNK_SIZE, then
    // adjust the amount we put in this 2nd-last chunk (mirrors chunkData's
    // own `nextChunkSize` check exactly).
    const nextChunkSize = rest - MAX_CHUNK_SIZE;
    if (nextChunkSize > 0 && nextChunkSize < MIN_CHUNK_SIZE) {
      chunkSize = Math.ceil(rest / 2);
    }

    boundaries.push({ offset: cursor, size: chunkSize });
    cursor += chunkSize;
    rest -= chunkSize;
  }

  boundaries.push({ offset: cursor, size: rest });

  return boundaries;
}
