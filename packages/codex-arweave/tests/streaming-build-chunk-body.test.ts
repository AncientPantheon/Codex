// @vitest-environment node
/**
 * T2 RED/GREEN — the per-chunk POST-body builder reading from OPFS
 * (`buildStreamingChunkBody`).
 *
 * `// @vitest-environment node` mirrors `e3-stoachain-isolation.test.ts`'s own
 * pragma: this test builds a real `arweave-js` `Transaction` via
 * `createTransaction`, and under the package's default jsdom environment vite
 * resolves `arweave`'s `browser` package.json field instead of its `main`
 * field — a different (though behaviourally-equivalent for this test's
 * purposes) implementation than the one `arweave-core`/the rest of this
 * project runs under Node. Forcing `node` here resolves `arweave/node/lib/*`,
 * matching every other `createTransaction`-driving test in this package.
 *
 * ONE correctness property is under test: `buildStreamingChunkBody`'s output,
 * reading ONLY one chunk's bytes at a time via `BundleAssemblyFile.read()`,
 * must be byte-identical to `Transaction.getChunk(idx, data)`'s own output
 * (`node_modules/arweave/node/lib/transaction.js`, read in full before writing
 * this) for EVERY chunk index of a real multi-chunk fixture — proven by direct
 * comparison against the real `arweave-js` API, not assumed from reading its
 * source alone (per this task's own "done when").
 *
 * The comparison is grounded on a REAL signed transaction: a throwaway JWK
 * (the same E1 fixture already committed to this package,
 * `tests/fixtures/throwaway-arweave-keyfile.json`, reused verbatim rather than
 * generating a new one) signs a real `Transaction` built via `createTransaction`
 * (the same build pattern `arweave-core/src/upload/nativeUpload.ts`'s
 * `postArweaveData` already uses: `last_tx`/`reward` supplied up front so the
 * build issues zero network calls) + `signTransaction` (`@ancientpantheon/
 * arweave-core`'s isolated signer — the only signing path this project uses).
 * `createTransaction`'s own `getSignatureData()` call internally runs
 * `prepareChunks(data)`, which calls arweave-js's real `generateTransactionChunks`
 * on this exact buffer — so `tx.chunks.chunks`/`tx.chunks.proofs` extracted
 * below ARE that real function's own output for this fixture, not a
 * separately-invented one.
 *
 * `buildStreamingChunkBody`'s own `file` argument is a `FakeBundleAssemblyFile`
 * (already built, T1 of the OPFS-bundle-assembly topic) pre-loaded with the
 * SAME buffer's bytes — the fixture whose bytes `tx.getChunk(idx, buffer)`
 * slices directly, and whose bytes `buildStreamingChunkBody` instead reads
 * incrementally through the seam.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, it, expect } from "vitest";
import Arweave from "arweave";
import { MAX_CHUNK_SIZE } from "arweave/node/lib/merkle.js";
import { importKeyfile, signTransaction, type ArweaveJwk } from "@ancientpantheon/arweave-core";

import { FakeBundleAssemblyFile } from "../src/library/streaming/fakeBundleAssemblyFile.js";
import {
  buildStreamingChunkBody,
  type StreamingChunkMeta,
} from "../src/library/streaming/buildStreamingChunkBody.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const throwawayJwk = JSON.parse(
  readFileSync(join(FIXTURES, "throwaway-arweave-keyfile.json"), "utf8"),
) as ArweaveJwk;

/** A deterministic PRNG (not `crypto.getRandomValues`) so the fixture buffer's
 *  content is reproducible across runs while still being non-trivial (not all
 *  zero/repeating) — a real data_root/chunk hash must be driven by real,
 *  varied bytes, not an edge-case-masking constant fill. */
function pseudoRandomBytes(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  let state = seed;
  for (let i = 0; i < length; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    out[i] = state & 0xff;
  }
  return out;
}

// Offline-only build instance — mirrors `nativeUpload.ts`'s own inert-host
// `builder`/`signing/sign.ts`'s inert-host `signer` convention: `last_tx` and
// `reward` are both supplied below, so `createTransaction` issues zero network
// calls, and this host is never actually dialed.
const BUILD_INERT_HOST = "streaming-build-chunk-body-test.invalid";
const builder = Arweave.init({ host: BUILD_INERT_HOST, protocol: "https", port: 443 });

describe("buildStreamingChunkBody (T2) — parity with the real Transaction.getChunk", () => {
  it("is byte-identical to the real getChunk's output for every chunk index of a real multi-chunk fixture", async () => {
    // 2.5x MAX_CHUNK_SIZE guarantees multiple chunks (arweave-js's own
    // `chunkData` splits at `MAX_CHUNK_SIZE` boundaries), proving this isn't a
    // single-chunk coincidence.
    const bufferLength = Math.floor(MAX_CHUNK_SIZE * 2.5);
    const buffer = pseudoRandomBytes(bufferLength, 42);

    const jwk = importKeyfile(throwawayJwk);
    const tx = await builder.createTransaction(
      {
        data: buffer,
        last_tx: "abcdEFGHijkLMNopQRSTuvWXyz0123456789_-ABCDEF".slice(0, 43),
        reward: "100",
      },
      jwk,
    );
    await signTransaction(tx, throwawayJwk);

    // `tx.chunks` is populated by `createTransaction`'s internal
    // `prepareChunks(data)` call, which runs arweave-js's own real
    // `generateTransactionChunks(buffer)` on this exact buffer — extracted
    // here, not independently recomputed.
    expect(tx.chunks).toBeDefined();
    const realChunks = tx.chunks!.chunks;
    const realProofs = tx.chunks!.proofs;

    // Sanity: a genuinely multi-chunk fixture, not a single-chunk coincidence
    // that would make the "every chunk index" claim hollow.
    expect(realChunks.length).toBeGreaterThan(1);
    expect(realChunks.length).toBe(realProofs.length);

    const meta: StreamingChunkMeta = {
      dataRoot: tx.data_root,
      dataSize: tx.data_size,
      chunks: realChunks,
      proofs: realProofs,
    };

    const file = new FakeBundleAssemblyFile();
    await file.write(0, buffer);

    for (let idx = 0; idx < realChunks.length; idx++) {
      const expected = tx.getChunk(idx, buffer);
      const actual = await buildStreamingChunkBody(idx, meta, file);
      expect(actual).toEqual(expected);
    }
  });
});
