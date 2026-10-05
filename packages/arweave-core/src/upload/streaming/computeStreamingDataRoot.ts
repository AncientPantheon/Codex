/**
 * `computeStreamingDataRoot` — the streaming leaf/tree/data_root pipeline.
 *
 * Replaces `arweave-js`'s own `chunkData` step (`node_modules/arweave/web/lib
 * /merkle.js`, identical source under `node/lib/merkle.js`) — the ONE step in
 * `generateTransactionChunks`'s pipeline that requires a fully-materialized
 * `Uint8Array` — with T1's `planChunkBoundaries` (pure, no I/O, computes every
 * chunk's `{offset, size}` from the total length alone) plus an injectable
 * `ByteRangeReader` that supplies one chunk's bytes at a time. Every other
 * step of the real pipeline is reused UNMODIFIED, straight from `arweave-js`:
 *
 *   - The per-chunk hash: `chunkData`'s own loop hashes each chunk with
 *     `common_1.default.crypto.hash(chunk)` (merkle.js line 44) — `common_1`
 *     is the `arweave` package's own `Arweave` class (`common_1.default ===
 *     Arweave`), and that `hash` call is a PLAIN digest of the chunk's raw
 *     bytes alone (`WebCryptoDriver.hash`, `node/lib/crypto/webcrypto-
 *     driver.js` lines 67-70: `this.driver.digest(algorithm, data)`, default
 *     `algorithm = "SHA-256"`) — it needs nothing but this one chunk's bytes,
 *     so it's called here via the SAME public entry point
 *     (`Arweave.crypto.hash`), not reimplemented.
 *   - `generateLeaves` (merkle.js lines 60-70): builds each leaf from a
 *     chunk's `dataHash` + its own `minByteRange`/`maxByteRange` alone, never
 *     the full dataset — imported and called directly, unmodified, fed the
 *     `Chunk[]` this module assembles from streamed reads instead of from a
 *     resident buffer.
 *   - `buildLayers` (merkle.js lines 115-128): recursively hashes the
 *     (small, leaf-count-sized, not data-size-sized) leaf-node list up to a
 *     single root — operates purely on that list, no raw-data access at all
 *     — imported and called directly, unmodified.
 *
 * So the only thing ported here is `chunkData`'s "read all data, hash each
 * chunk" loop, replaced by `planChunkBoundaries` (plan) + sequential
 * `readRange` calls (read-hash-discard one chunk at a time — never more than
 * one chunk's bytes resident in memory at once, which is the whole point of
 * this project: a 6+ GB folder upload must never require the whole payload
 * in browser memory).
 *
 * Mirrors `generateTransactionChunks`'s own real return shape (merkle.js
 * lines 92-108) closely enough for later streaming-upload topics (OPFS-
 * backed bundle assembly in `codex-arweave`) to consume directly: a
 * `data_root` plus the real, exported `Chunk[]`/`Proof[]` — including its
 * own "discard a trailing zero-length chunk (and its proof)" behavior
 * (merkle.js lines 97-102), reproduced here so `chunks`/`proofs` match
 * `generateTransactionChunks`'s own `chunks`/`proofs` exactly, not just its
 * `data_root`. `proofs` are generated the SAME way `generateTransactionChunks`
 * itself does: `generateProofs(root)`, called on the same root node
 * `buildLayers` already produces here — unmodified, straight from
 * `arweave-js`, same as `generateLeaves`/`buildLayers` above.
 *
 * Verified byte-for-byte against the real, buffer-based
 * `generateTransactionChunks` — see
 * `tests/streaming-compute-data-root.test.ts`.
 */

import Arweave from "arweave";
// `arweave/web/lib/merkle.js`, NOT `arweave/node/lib/merkle.js` — confirmed
// identical logic (`diff`-ed byte-for-byte minus CJS/ESM import-style
// boilerplate) but the `node/` path's own `generateLeaves`'s internal
// `hash()` helper resolves ITS `common.js` import to `NodeCryptoDriver`
// (`node:crypto`), which this project's browser build deliberately makes
// unavailable (`apps/codex-playground/crypto.shim.ts`'s own explicit
// "`createHash` is unavailable in the browser bundle" guard) — a hardcoded
// Node-only deep import, unlike this module's own bare `import Arweave from
// "arweave"` above, which DOES respect the package's `browser` field and
// portably switches per consumer. This surfaced the hard way: a real-browser
// Worker run of this exact function threw `node:crypto createHash is
// unavailable`, confirmed live
// (`docs/work/arweave-streaming-post-resume/plan.md` T3's own real-browser
// capstone check). The `web/` path's `WebCryptoDriver` uses `crypto.subtle`,
// available in both a real browser AND Node 19+'s own global `crypto` — so
// this switch changes nothing under this module's own `@vitest-environment
// node` tests (confirmed: both drivers hash via SHA-256 digest, byte-
// identical output) while finally making the module actually loadable in a
// real browser bundle.
import { generateLeaves, buildLayers, generateProofs } from "arweave/web/lib/merkle.js";
import type { Chunk, Proof } from "arweave/web/lib/merkle.js";

import { planChunkBoundaries } from "./planChunkBoundaries.js";

// Re-exported so a consumer typing against `StreamingDataRootResult.chunks`/
// `.proofs` (e.g. a later streaming-upload topic posting these chunks to a
// gateway) never needs its own deep import into `arweave`'s internals just
// for this shape — these are the SAME real types `generateTransactionChunks`
// itself returns.
export type { Chunk, Proof };

/**
 * Supplies exactly `size` bytes starting at `offset` — the streaming seam
 * this module reads through instead of requiring a resident buffer. A plain
 * buffer/file slice in tests; an OPFS-backed read is later topics' concern,
 * not this module's.
 */
export type ByteRangeReader = (offset: number, size: number) => Promise<Uint8Array>;

export interface StreamingDataRootResult {
  data_root: Uint8Array;
  chunks: Chunk[];
  proofs: Proof[];
}

/**
 * Computes the Arweave `data_root` (plus the `Chunk[]`/`Proof[]` lists it
 * was built from) for an upload of `totalLength` bytes, reading the data
 * through `readRange` ONE planned chunk at a time instead of requiring the
 * whole payload resident in memory.
 */
export async function computeStreamingDataRoot(
  totalLength: number,
  readRange: ByteRangeReader,
): Promise<StreamingDataRootResult> {
  const boundaries = planChunkBoundaries(totalLength);

  // Sequential, one chunk at a time: each chunk's bytes are read, hashed,
  // and discarded (only the 32-byte `dataHash` + two numbers survive into
  // `chunks`) before the next read starts — never more than one chunk's
  // worth of the payload resident in memory at once.
  const chunks: Chunk[] = [];
  for (const { offset, size } of boundaries) {
    const bytes = await readRange(offset, size);
    const dataHash = await Arweave.crypto.hash(bytes);
    chunks.push({
      dataHash,
      minByteRange: offset,
      maxByteRange: offset + size,
    });
  }

  const leaves = await generateLeaves(chunks);
  const root = await buildLayers(leaves);
  const proofs = generateProofs(root);

  // Mirrors generateTransactionChunks's own discarding of a trailing
  // zero-length chunk AND its proof (merkle.js lines 97-102): chunkData
  // always pushes a final chunk covering whatever's left, which is
  // zero-length exactly when totalLength is 0 or an exact multiple of
  // MAX_CHUNK_SIZE — that chunk (and the proof generateProofs built for it)
  // is never actually uploaded, so both are dropped from the returned lists
  // here too. `proofs` is produced from the same leaves/root in the same
  // left-to-right order as `chunks`, so the last entry of each always
  // corresponds to the same trailing chunk.
  const lastChunk = chunks[chunks.length - 1];
  if (lastChunk && lastChunk.maxByteRange - lastChunk.minByteRange === 0) {
    chunks.pop();
    proofs.pop();
  }

  return { data_root: root.id, chunks, proofs };
}
