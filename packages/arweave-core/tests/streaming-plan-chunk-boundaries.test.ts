/**
 * streaming-plan-chunk-boundaries.test.ts — the pure chunk-boundary planner.
 *
 * `planChunkBoundaries(totalLength)` is a from-scratch, faithful port of
 * `arweave-js`'s own `chunkData` loop (`node_modules/arweave/web/lib/merkle.js`,
 * identical source under `node/lib/merkle.js`) — but operating on a LENGTH
 * NUMBER only, never a materialized buffer, so a 6+ GB upload's chunk plan can
 * be computed without ever holding the payload in memory.
 *
 * These tests are the ground truth: for every fixture length below, a REAL
 * `Uint8Array` of that exact length is fed to the REAL `chunkData` (imported
 * straight from the `arweave` dependency, not reimplemented or mocked), and
 * `planChunkBoundaries`'s output is asserted byte-range-identical to
 * `chunkData`'s own raw `{minByteRange, maxByteRange}` output (NOT the
 * post-discard shape `generateTransactionChunks` produces — `chunkData` itself
 * always pushes a final chunk, including a zero-length one for a zero-length
 * input, and this planner must match that raw behavior exactly).
 *
 * Fixture set deliberately includes the `MIN_CHUNK_SIZE` rebalancing branch —
 * the one most likely to be gotten wrong by a careless port (`chunkData`
 * shrinks the CURRENT chunk to `ceil(rest / 2)`, rather than ever emitting a
 * dangling final chunk under `MIN_CHUNK_SIZE`).
 */

import { describe, it, expect } from "vitest";
import { chunkData, MAX_CHUNK_SIZE, MIN_CHUNK_SIZE } from "arweave/node/lib/merkle.js";
import { planChunkBoundaries } from "../src/upload/streaming/planChunkBoundaries.js";

/** The real `chunkData`, reduced to the `{offset, size}` shape this planner returns. */
async function realBoundaries(totalLength: number): Promise<Array<{ offset: number; size: number }>> {
  const chunks = await chunkData(new Uint8Array(totalLength));
  return chunks.map((chunk) => ({
    offset: chunk.minByteRange,
    size: chunk.maxByteRange - chunk.minByteRange,
  }));
}

const FIXTURES: Array<{ name: string; length: number }> = [
  { name: "zero bytes", length: 0 },
  { name: "a few bytes (well under MIN_CHUNK_SIZE)", length: 5 },
  { name: "exactly MAX_CHUNK_SIZE", length: MAX_CHUNK_SIZE },
  { name: "MAX_CHUNK_SIZE + 1", length: MAX_CHUNK_SIZE + 1 },
  {
    name: "rebalancing branch (between MAX_CHUNK_SIZE and MAX_CHUNK_SIZE + MIN_CHUNK_SIZE)",
    length: MAX_CHUNK_SIZE + 1000,
  },
  {
    name: "several full chunks plus a rebalanced tail",
    length: 3 * MAX_CHUNK_SIZE + 1000,
  },
];

describe("planChunkBoundaries — faithful port of chunkData's pure loop", () => {
  for (const { name, length } of FIXTURES) {
    it(`matches chunkData's real raw output for ${name} (length=${length})`, async () => {
      const expected = await realBoundaries(length);
      const actual = planChunkBoundaries(length);
      expect(actual).toEqual(expected);
    });
  }

  it("sanity-checks the rebalancing fixture actually exercises the MIN_CHUNK_SIZE branch", async () => {
    // Guards against the fixture length accidentally landing in the simple
    // default-MAX_CHUNK_SIZE branch instead of the rebalancing branch it's
    // meant to exercise — if this assertion ever fails, the fixture choice
    // above (not the planner) is the thing to fix. The whole POINT of
    // rebalancing is that the final chunk is never left under
    // MIN_CHUNK_SIZE, so both halves here must clear that floor.
    const length = MAX_CHUNK_SIZE + 1000;
    const expected = await realBoundaries(length);

    expect(expected.length).toBe(2);
    expect(expected[0].size).not.toBe(MAX_CHUNK_SIZE);
    expect(expected[0].size).toBe(Math.ceil(length / 2));
    expect(expected[0].size).toBeGreaterThanOrEqual(MIN_CHUNK_SIZE);
    expect(expected[1].size).toBeGreaterThanOrEqual(MIN_CHUNK_SIZE);
    expect(expected[0].size + expected[1].size).toBe(length);
  });

  it("sanity-checks the multi-chunk fixture spans full chunks plus a rebalanced tail", async () => {
    // Guards the second composite fixture the same way: proves it actually
    // produces 2 full MAX_CHUNK_SIZE chunks followed by a rebalanced chunk
    // and a final remainder chunk (four chunks total) — not just "some
    // chunks". Three full MAX_CHUNK_SIZE chunks never happen here: by the
    // 3rd iteration, `rest` (MAX_CHUNK_SIZE + 1000) already triggers the
    // rebalancing branch, same as the dedicated rebalancing fixture above.
    const length = 3 * MAX_CHUNK_SIZE + 1000;
    const expected = await realBoundaries(length);

    expect(expected.length).toBe(4);
    expect(expected[0].size).toBe(MAX_CHUNK_SIZE);
    expect(expected[1].size).toBe(MAX_CHUNK_SIZE);
    expect(expected[2].size).not.toBe(MAX_CHUNK_SIZE);
    expect(expected[2].size).toBeGreaterThanOrEqual(MIN_CHUNK_SIZE);
    expect(expected[3].size).toBeGreaterThanOrEqual(MIN_CHUNK_SIZE);
    expect(expected[2].size + expected[3].size).toBe(length - 2 * MAX_CHUNK_SIZE);
  });
});
