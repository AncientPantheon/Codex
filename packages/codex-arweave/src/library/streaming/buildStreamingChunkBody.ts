/**
 * The per-chunk POST-body builder reading from OPFS (T2 of
 * `arweave-streaming-post-core`).
 *
 * Reproduces `Transaction.getChunk(idx, data)`'s exact body shape
 * (`node_modules/arweave/node/lib/transaction.js`, read in full before writing
 * this):
 *
 * ```
 * {
 *   data_root: this.data_root,
 *   data_size: this.data_size,
 *   data_path: ArweaveUtils.bufferTob64Url(proof.proof),
 *   offset: proof.offset.toString(),
 *   chunk: ArweaveUtils.bufferTob64Url(data.slice(chunk.minByteRange, chunk.maxByteRange)),
 * }
 * ```
 *
 * — but sources `chunk` from a {@link BundleAssemblyFile} read of EXACTLY that
 * one chunk's byte range (`read(chunks[idx].minByteRange, length)`) instead of
 * slicing a fully-resident `data` buffer. `data_root`/`data_size` are supplied
 * directly as already-known small strings (see {@link StreamingChunkMeta}) —
 * never a full `Transaction` instance — and `chunks`/`proofs` are the same
 * small, already-computed per-chunk metadata `getChunk` itself indexes
 * (`this.chunks.chunks[idx]`/`this.chunks.proofs[idx]`).
 *
 * ENCODING: `getChunk` base64url-encodes via `ArweaveUtils.bufferTob64Url`
 * (`node_modules/arweave/node/lib/utils.js`) — standard base64 (`base64-js`'s
 * `fromByteArray`, bit-for-bit the same alphabet/padding as `Buffer`'s own
 * `"base64"` encoding) followed by the RFC 4648 §5 substitution
 * (`+`→`-`, `/`→`_`, strip `=` padding). {@link base64url} below mirrors that
 * exact two-step transform via `Buffer`'s universally-supported `"base64"`
 * encoding, NOT Node's own `"base64url"` string argument — confirmed, the hard
 * way, by a sibling task in this project: the browser-polyfilled `buffer`
 * package this project's bundler aliases `node:buffer`/`buffer` onto does not
 * support `"base64url"` as a `Buffer.toString` argument at all
 * (`TypeError: Unknown encoding: base64url`). This is the SAME helper pattern
 * `assembleBundleToFile.ts`'s own module-local `base64url` already
 * establishes in this package — reused verbatim here rather than diverging.
 */

import type { BundleAssemblyFile } from "./bundleAssemblyFile.js";

/**
 * This task's own local input shape — deliberately NOT importing
 * `computeStreamingDataRoot`'s output type directly from `arweave-core` (a
 * sibling task's own file, built in parallel this wave). `dataRoot`/
 * `dataSize` are already-known, already-stringified small metadata (the same
 * strings a real `Transaction` carries as `.data_root`/`.data_size` once
 * `prepareChunks` has run) — never a full `Transaction` instance.
 */
export interface StreamingChunkMeta {
  /** The already base64url-encoded Merkle root — `Transaction.data_root`. */
  dataRoot: string;
  /** The total payload byte length, stringified — `Transaction.data_size`. */
  dataSize: string;
  /** Every chunk's byte range, in order — the same shape `arweave-js`'s own
   *  `Chunk[]` (`arweave/node/lib/merkle.js`) carries, minus the `dataHash`
   *  this builder never needs (it reads the bytes themselves). */
  chunks: readonly { minByteRange: number; maxByteRange: number }[];
  /** Each chunk's Merkle inclusion proof, in the SAME order as `chunks` — the
   *  same shape `arweave-js`'s own `Proof[]` carries. */
  proofs: readonly { offset: number; proof: Uint8Array }[];
}

/** The exact body shape `Transaction.getChunk(idx, data)` produces, ready to
 *  POST to a gateway's `/chunk` endpoint. */
export interface StreamingChunkBody {
  data_root: string;
  data_size: string;
  data_path: string;
  offset: string;
  chunk: string;
}

/** Base64url-encodes `bytes` via the universally-supported `"base64"`
 *  encoding + the RFC 4648 §5 substitution — see the module doc comment above
 *  for why `.toString("base64url")` itself is NOT safe here. Mirrors
 *  `assembleBundleToFile.ts`'s own identically-purposed local `base64url`
 *  helper (that one takes a `Buffer`; this one a `Uint8Array`, since both
 *  `BundleAssemblyFile.read()` and a real `Proof.proof` hand back a plain
 *  `Uint8Array`, never a `Buffer`). */
function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Builds the `/chunk` POST body for chunk `idx`, reading ONLY that chunk's own
 * byte range from `file` — never the full payload.
 */
export async function buildStreamingChunkBody(
  idx: number,
  meta: StreamingChunkMeta,
  file: BundleAssemblyFile,
): Promise<StreamingChunkBody> {
  const chunk = meta.chunks[idx];
  const proof = meta.proofs[idx];
  const length = chunk.maxByteRange - chunk.minByteRange;
  const bytes = await file.read(chunk.minByteRange, length);
  return {
    data_root: meta.dataRoot,
    data_size: meta.dataSize,
    data_path: base64url(proof.proof),
    offset: proof.offset.toString(),
    chunk: base64url(bytes),
  };
}
