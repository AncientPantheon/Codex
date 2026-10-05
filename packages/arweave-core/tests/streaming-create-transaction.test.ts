// @vitest-environment node
/**
 * T3 RED/GREEN (`arweave-streaming-post-core`) — transaction creation via
 * `createStreamingTransaction`.
 *
 * `node_modules/arweave/node/lib/transaction.js`'s `prepareChunks` (read in
 * full before writing this) only computes+assigns `this.chunks`/
 * `this.data_root` when `!this.chunks`/`!this.data_root` — so setting both
 * directly, BEFORE `signTransaction` ever runs `getSignatureData()`, bypasses
 * `prepareChunks` entirely: the format-2 deep hash (`getSignatureData`'s
 * `case 2` branch) is built from `this.data_size`/`this.get("data_root", ...)`
 * plus owner/tags/last_tx/reward — NEVER from `this.data` itself — so an
 * empty `data: new Uint8Array(0)` transaction, with `data_root`/`data_size`/
 * `chunks` overridden to the REAL streaming-computed values before signing,
 * produces the IDENTICAL deep-hash input a full-buffer `createTransaction`
 * call would have produced internally via its own real `prepareChunks(data)`.
 *
 * This is proven here WITHOUT comparing signed `id`s across two independent
 * `signTransaction` calls: RSA-PSS draws a fresh random salt every call (this
 * project's own `streaming-assemble-bundle-to-file.test.ts` already verified
 * this empirically — "two independent sign() calls on byte-identical input
 * never produce byte-identical output"), so two REAL signs can never be
 * byte-compared. The sound comparison is the PRE-SIGNATURE deep hash
 * (`tx.getSignatureData()`) — computed fresh from fields untouched by
 * signing, so calling it on an already-signed tx returns the same bytes it
 * would have returned right before signing.
 */

import { describe, it, expect } from "vitest";
import Arweave from "arweave";
import { MAX_CHUNK_SIZE } from "arweave/node/lib/merkle.js";

import { importKeyfile } from "../src/keys/keyfile.js";
import { signTransaction } from "../src/signing/sign.js";
import { computeStreamingDataRoot } from "../src/upload/streaming/computeStreamingDataRoot.js";
import { createStreamingTransaction } from "../src/upload/streaming/createStreamingTransaction.js";
import { TEST_KEYFILE } from "./fixtures/test-keyfile.js";

const throwawayJwk = TEST_KEYFILE;

/** A deterministic PRNG (not `crypto.getRandomValues`) so the fixture
 *  buffer's content is reproducible, non-trivial real bytes — mirrors T2's
 *  own `streaming-build-chunk-body.test.ts` fixture convention. */
function pseudoRandomBytes(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  let state = seed;
  for (let i = 0; i < length; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    out[i] = state & 0xff;
  }
  return out;
}

const LAST_TX = "abcdEFGHijkLMNopQRSTuvWXyz0123456789_-ABCDEF".slice(0, 43);
const REWARD = "100";

const BUILD_INERT_HOST = "streaming-create-transaction-test.invalid";
const builder = Arweave.init({ host: BUILD_INERT_HOST, protocol: "https", port: 443 });

describe("createStreamingTransaction — deep-hash parity with a real full-buffer build", () => {
  it("produces a data_root/data_size/chunks/deep-hash identical to a real prepareChunks-driven build, for a real multi-chunk fixture", async () => {
    const bufferLength = Math.floor(MAX_CHUNK_SIZE * 2.5);
    const buffer = pseudoRandomBytes(bufferLength, 7);
    const tags = [{ name: "Content-Type", value: "application/octet-stream" }];

    // The oracle: a real, full-buffer `createTransaction` build — its own
    // internal `getSignatureData()` call runs the REAL `prepareChunks(data)`
    // against this exact buffer, so `tx.chunks`/`tx.data_root` below are
    // arweave-js's own real output, not independently recomputed.
    const jwk = importKeyfile(throwawayJwk);
    const fullTx = await builder.createTransaction(
      { data: buffer, last_tx: LAST_TX, reward: REWARD },
      jwk,
    );
    for (const tag of tags) fullTx.addTag(tag.name, tag.value);
    await signTransaction(fullTx, throwawayJwk);

    // Sanity: a genuinely multi-chunk fixture.
    expect(fullTx.chunks).toBeDefined();
    expect(fullTx.chunks!.chunks.length).toBeGreaterThan(1);

    // The streaming build: data_root/chunks/proofs computed via T1's
    // `computeStreamingDataRoot`, reading the SAME buffer one chunk at a
    // time (a plain in-memory slice reader here — OPFS-specific reads are
    // `codex-arweave`'s own concern, out of this arweave-core-level test).
    const streamed = await computeStreamingDataRoot(buffer.byteLength, async (offset, size) =>
      buffer.slice(offset, offset + size),
    );

    const streamTx = await createStreamingTransaction({
      jwk: throwawayJwk,
      lastTx: LAST_TX,
      reward: REWARD,
      tags,
      dataSize: buffer.byteLength,
      streaming: streamed,
    });

    // Never holds the real bundle bytes.
    expect(streamTx.data.byteLength).toBe(0);

    // Same data_root/data_size/owner — all deterministic, no signing
    // randomness involved.
    expect(streamTx.data_root).toBe(fullTx.data_root);
    expect(streamTx.data_size).toBe(fullTx.data_size);
    expect(streamTx.owner).toBe(fullTx.owner);

    // The load-bearing proof: the PRE-SIGNATURE deep hash — built from
    // data_root/data_size/owner/tags/last_tx/reward, never from `data`
    // itself (confirmed by reading `getSignatureData`'s format-2 branch) —
    // is byte-identical between the two builds. This is what "protocol
    // -identical transaction, not just a transaction" actually rests on;
    // two independent RSA-PSS signs of this same hash would legitimately
    // differ (random salt), so `id`/`signature` are deliberately NOT
    // compared here — see this file's own module doc comment.
    const fullDeepHash = await fullTx.getSignatureData();
    const streamDeepHash = await streamTx.getSignatureData();
    expect(Buffer.from(streamDeepHash)).toEqual(Buffer.from(fullDeepHash));
  });
});
