/**
 * local-dry-run-gateway.test.ts — `createLocalDryRunGatewayApiFactory`, the
 * shippable (production, not test-only) local/no-op gateway `arweave-upload-
 * dry-run` T1 builds for a future "Test this upload" path.
 *
 * Mirrors this package's own existing proof convention for "no real network":
 * `tests/upload.test.ts` stubs `globalThis.fetch` to THROW across a whole
 * mocked happy path, then asserts it was never called — the same technique
 * used here (test 3 below), since a passing stub-throws-on-call assertion
 * means nothing in the exercised code path ever reached `fetch`.
 *
 * Also proves — a STRUCTURAL claim, not "it compiles because of `any`" —
 * that ONE shared factory function satisfies BOTH real gateway contracts
 * (`UploadGatewayApiFactory` and `StreamingUploadGatewayApiFactory`): see
 * test 4, which assigns the same `factory` value to variables typed against
 * each real interface, re-imported fresh from their actual source modules.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Transaction from "arweave/node/lib/transaction";

import { createLocalDryRunGatewayApiFactory } from "../src/upload/localDryRunGateway.js";
import { base64urlEncode } from "../src/keys/encoding.js";
import type { UploadGatewayApiFactory, ChunkedUploader } from "../src/upload/nativeUpload.js";
import type {
  StreamingUploadGatewayApiFactory,
  StreamingChunkPostBody,
  SignedStreamingTransaction,
} from "../src/upload/streaming/createStreamingTransaction.js";

/** A structurally-valid-looking 43-char base64url id — never a real tx. */
const TX_ID_A = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_ABCD";
const TX_ID_B = "ZzYyXxWwVvUuTtSsRrQqPpOoNnMmLlKkJjIiHhGgFfE";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

/**
 * A plain object shaped like the slice of a real signed `arweave-js`
 * `Transaction` this module's gateway actually reads (`id`/`data`/
 * `data_root`) — deliberately NOT a real signed tx (no RSA signing needed;
 * this gateway never inspects a signature), cast through the same real
 * `SignedStreamingTransaction`/`Transaction` type every production caller
 * passes.
 */
function makeFakeTx(opts: {
  id: string;
  data?: Uint8Array;
  dataRoot?: string;
}): SignedStreamingTransaction {
  return {
    id: opts.id,
    data: opts.data ?? new Uint8Array(0),
    data_root: opts.dataRoot ?? opts.id,
  } as unknown as SignedStreamingTransaction;
}

function makeChunkBody(dataRoot: string, offset: number, bytes: Uint8Array): StreamingChunkPostBody {
  return {
    data_root: dataRoot,
    data_size: "999",
    data_path: "unused-by-the-dry-run-gateway",
    offset: offset.toString(),
    chunk: base64urlEncode(bytes),
  };
}

describe("createLocalDryRunGatewayApiFactory — capture + round-trip", () => {
  it("captures a posted tx then several posted chunks, retrievable via getCapturedTx/getCapturedChunks in POST order", async () => {
    const { factory, getCapturedTx, getCapturedChunks } = createLocalDryRunGatewayApiFactory();
    const client = factory("https://dry-run.example");

    const tx = makeFakeTx({ id: TX_ID_A, dataRoot: "root-A" });
    await expect(client.postTransaction(tx)).resolves.toBeUndefined();

    const pieces = ["first chunk ", "second chunk ", "third chunk"];
    for (const [i, piece] of pieces.entries()) {
      await expect(
        client.postChunk(makeChunkBody("root-A", i, enc(piece))),
      ).resolves.toBeUndefined();
    }

    expect(getCapturedTx(TX_ID_A)).toBe(tx);
    const captured = getCapturedChunks(TX_ID_A);
    expect(captured.map(dec)).toEqual(pieces);
  });

  /**
   * REGRESSION (`arweave-streaming-resume-opfs-corruption`): a RE-POST of a
   * chunk at an offset already captured must be idempotent, not an extra
   * payload entry.
   *
   * `pool.execute` (`gateway/pool.ts`) runs its whole operation up to
   * `maxAttemptsPerEndpoint` (default 3) times PER endpoint, and
   * `streamingPostBundle` wraps "post the tx + every chunk from index 0" in
   * ONE such call — so any attempt that dies partway re-posts, from offset 0,
   * every chunk it had already posted successfully. That is deliberate,
   * documented behavior (`streamingPost.ts`: "a duplicate chunk POST for an
   * already-accepted offset is a no-op server-side"), and a real gateway
   * stores chunks ADDRESSED BY OFFSET, so re-posting cannot change the
   * payload it holds.
   *
   * This gateway stands in for that real gateway, so it must model the same
   * offset-addressed, idempotent store. Capturing posted bytes as a
   * post-ORDER append list instead made `getCapturedChunks` report the SAME
   * chunk several times, which inflated any caller's reassembly of the
   * payload by one full chunk per retried attempt — surfacing as a bogus
   * `data_root` mismatch and unparseable ANS-104 headers in
   * `runUploadDryRun`'s self-check, for an upload whose posted bytes were in
   * fact perfectly correct.
   */
  it("captures a re-POSTed offset idempotently — three attempts at the same chunk yield ONE payload entry, so the reassembly is never inflated", async () => {
    const { factory, getCapturedChunks } = createLocalDryRunGatewayApiFactory();
    const client = factory("https://dry-run.example");

    await client.postTransaction(makeFakeTx({ id: TX_ID_A, dataRoot: "root-A" }));

    // The exact shape a 3-attempt `pool.execute` produces when every attempt
    // posts chunk 0 then dies on chunk 1: offset 0 posted three times, then
    // the resumed run posts the rest once each.
    await client.postChunk(makeChunkBody("root-A", 0, enc("AAAA")));
    await client.postChunk(makeChunkBody("root-A", 0, enc("AAAA")));
    await client.postChunk(makeChunkBody("root-A", 0, enc("AAAA")));
    await client.postChunk(makeChunkBody("root-A", 4, enc("BBBB")));
    await client.postChunk(makeChunkBody("root-A", 8, enc("CC")));

    const captured = getCapturedChunks(TX_ID_A);
    expect(captured.map(dec)).toEqual(["AAAA", "BBBB", "CC"]);
    expect(captured.reduce((n, c) => n + c.byteLength, 0)).toBe(10);
  });

  /** Companion to the regression above: offsets are reassembled in PAYLOAD
   *  order, never arrival order, so a re-post arriving after a later chunk
   *  (exactly what a resumed run interleaved with a retried attempt does)
   *  still reconstructs the payload correctly. */
  it("orders captured chunks by payload offset, not arrival order", async () => {
    const { factory, getCapturedChunks } = createLocalDryRunGatewayApiFactory();
    const client = factory("https://dry-run.example");

    await client.postTransaction(makeFakeTx({ id: TX_ID_A, dataRoot: "root-A" }));

    await client.postChunk(makeChunkBody("root-A", 8, enc("CC")));
    await client.postChunk(makeChunkBody("root-A", 0, enc("AAAA")));
    await client.postChunk(makeChunkBody("root-A", 4, enc("BBBB")));

    expect(getCapturedChunks(TX_ID_A).map(dec)).toEqual(["AAAA", "BBBB", "CC"]);
  });

  it("reset() clears all captured state — a previously-posted id resolves empty/undefined afterward", async () => {
    const { factory, getCapturedTx, getCapturedChunks, reset } = createLocalDryRunGatewayApiFactory();
    const client = factory("https://dry-run.example");

    const tx = makeFakeTx({ id: TX_ID_A, dataRoot: "root-A" });
    await client.postTransaction(tx);
    await client.postChunk(makeChunkBody("root-A", 0, enc("payload")));

    expect(getCapturedTx(TX_ID_A)).toBeDefined();
    expect(getCapturedChunks(TX_ID_A)).toHaveLength(1);

    reset();

    expect(getCapturedTx(TX_ID_A)).toBeUndefined();
    expect(getCapturedChunks(TX_ID_A)).toEqual([]);
  });
});

describe("createLocalDryRunGatewayApiFactory — zero network reachability", () => {
  let realFetch: typeof globalThis.fetch;

  beforeEach(() => {
    // Mirrors `tests/upload.test.ts`'s own convention: stub `fetch` to THROW
    // so any accidental network touch fails loudly rather than silently
    // succeeding against a real endpoint.
    realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(() => {
      throw new Error("network access is forbidden in local-dry-run-gateway tests");
    }) as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("never calls fetch across a full tx + multi-chunk post sequence (both the streaming and classic client surfaces)", async () => {
    const { factory } = createLocalDryRunGatewayApiFactory();
    const client = factory("https://dry-run.example");

    // Streaming surface: getAnchor/getPrice/postTransaction/postChunk x N.
    await client.getAnchor();
    await client.getPrice(1234);
    const streamingTx = makeFakeTx({ id: TX_ID_A, dataRoot: "root-A" });
    await client.postTransaction(streamingTx);
    await client.postChunk(makeChunkBody("root-A", 0, enc("alpha")));
    await client.postChunk(makeChunkBody("root-A", 1, enc("beta")));
    await client.postChunk(makeChunkBody("root-A", 2, enc("gamma")));

    // Classic surface: getUploader(tx) -> loop uploadChunk() until isComplete.
    const classicTx = {
      id: TX_ID_B,
      data: enc("classic full payload"),
      data_root: TX_ID_B,
    } as unknown as Transaction;
    const uploader: ChunkedUploader = await client.getUploader(classicTx);
    while (!uploader.isComplete) {
      await uploader.uploadChunk();
    }

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("createLocalDryRunGatewayApiFactory — satisfies both real gateway contracts", () => {
  it("the returned factory is assignable to both UploadGatewayApiFactory and StreamingUploadGatewayApiFactory, structurally (not via `any`)", () => {
    const { factory } = createLocalDryRunGatewayApiFactory();

    const asClassicFactory: UploadGatewayApiFactory = factory;
    const asStreamingFactory: StreamingUploadGatewayApiFactory = factory;

    expect(asClassicFactory("https://dry-run.example")).toBeTruthy();
    expect(asStreamingFactory("https://dry-run.example")).toBeTruthy();
  });
});
