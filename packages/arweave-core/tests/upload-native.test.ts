/**
 * upload-native.test.ts — native (non-bundler-service) Arweave data-upload
 * posting primitive, through the gateway pool.
 *
 * `postArweaveData(pool, params, opts?)` mirrors `tx/transfer.ts`'s
 * `sendTransfer` composition (pool-driven anchor fetch → pool-driven price
 * quote via the now-optional-target `estimateFee` → fully-offline
 * `createTransaction` build → `signTransaction` → pool-driven post) but posts
 * a `data` + `tags` payload via a CHUNKED uploader loop
 * (`getUploader(tx)` / `uploader.uploadChunk()`, resuming until
 * `uploader.isComplete`) rather than `sendTransfer`'s single `postTransaction`
 * call. It resolves `{ id, reward }`.
 *
 * Tests use a REAL Phase 2 pool (multi-endpoint, injected instant sleep) plus
 * an injected fake API factory of PLAIN functions — no network, no arweave-js
 * network objects — mirroring `tx-transfer.test.ts`'s fake-`apiFactory`
 * pattern, extended with a fake chunked-uploader shape.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import Arweave from "arweave";
import type Transaction from "arweave/node/lib/transaction";

import { createGatewayPool } from "../src/gateway/pool.js";
import { GatewayPoolExhaustedError } from "../src/gateway/errors.js";
import { UnsupportedEndpointError } from "../src/endpoints.js";
import { InvalidKeyfileError } from "../src/keys/errors.js";
import { postArweaveData } from "../src/upload/nativeUpload.js";
import { RewardExceedsCapError } from "../src/tx/errors.js";
import { InvalidUploadParamsError } from "../src/upload/errors.js";
import type {
  UploadGatewayApi,
  UploadGatewayApiFactory,
  ChunkedUploader,
} from "../src/upload/nativeUpload.js";
import { TEST_KEYFILE } from "./fixtures/test-keyfile.js";

const instantSleep = async () => {};

/** A never-networked instance for the verify oracle only (verify is local). */
const oracle = Arweave.init({ host: "arweave.net", protocol: "https", port: 443 });

const ANCHOR = "abcdEFGHijkLMNopQRSTuvWXyz0123456789_-ABCDEF".slice(0, 43);
const PRICE = "1000000000"; // honest Winston fee quote (decimal string)
/** A cap comfortably above the honest PRICE — the fee cap is REQUIRED. */
const CAP = 1000000000000n;

const DATA = "hello, permanent web";
const TAGS = [
  { name: "Content-Type", value: "text/plain" },
  { name: "App-Name", value: "Codex-Test" },
];

/**
 * A fake chunked uploader mirroring arweave-js's `TransactionUploader`: a
 * fixed number of chunks, each `uploadChunk()` call advancing `chunkIndex` by
 * one on success. `failOnceAt` names chunk indices whose FIRST `uploadChunk()`
 * call throws (simulating a transient network blip); the SECOND call for that
 * same index (same instance — chunkIndex unchanged by the throw) succeeds,
 * mirroring the real uploader's resume-in-place behavior.
 */
class FakeChunkedUploader implements ChunkedUploader {
  private chunkIndex = 0;
  private readonly failedOnce = new Set<number>();
  public readonly calls: number[] = [];

  constructor(
    private readonly totalChunks: number,
    private readonly failOnceAt: ReadonlySet<number> = new Set(),
  ) {}

  get isComplete(): boolean {
    return this.chunkIndex === this.totalChunks;
  }

  async uploadChunk(): Promise<void> {
    this.calls.push(this.chunkIndex);
    if (this.failOnceAt.has(this.chunkIndex) && !this.failedOnce.has(this.chunkIndex)) {
      this.failedOnce.add(this.chunkIndex);
      throw new Error(`simulated transient failure at chunk ${this.chunkIndex}`);
    }
    this.chunkIndex++;
  }
}

interface FakeApiOptions {
  anchor?: string;
  priceByEndpoint?: Record<string, string>;
  /** Total chunks each fake uploader reports; defaults to 1 (single-chunk post). */
  totalChunks?: number;
  /** Chunk indices whose first upload attempt throws once, then succeeds. */
  failOnceAt?: number[];
}

function makeFakeFactory(opts: FakeApiOptions = {}): {
  factory: UploadGatewayApiFactory;
  anchorCalls: string[];
  priceCalls: string[];
  uploaderTxs: Transaction[];
  uploaderEndpoints: string[];
  uploaders: FakeChunkedUploader[];
} {
  const anchorCalls: string[] = [];
  const priceCalls: string[] = [];
  const uploaderTxs: Transaction[] = [];
  const uploaderEndpoints: string[] = [];
  const uploaders: FakeChunkedUploader[] = [];

  const factory: UploadGatewayApiFactory = (endpoint: string): UploadGatewayApi => ({
    async getAnchor() {
      anchorCalls.push(endpoint);
      return opts.anchor ?? ANCHOR;
    },
    async getPrice(_byteSize: number, _target?: string) {
      priceCalls.push(endpoint);
      return opts.priceByEndpoint?.[endpoint] ?? PRICE;
    },
    async getUploader(tx: Transaction) {
      uploaderEndpoints.push(endpoint);
      uploaderTxs.push(tx);
      const uploader = new FakeChunkedUploader(
        opts.totalChunks ?? 1,
        new Set(opts.failOnceAt ?? []),
      );
      uploaders.push(uploader);
      return uploader;
    },
  });

  return { factory, anchorCalls, priceCalls, uploaderTxs, uploaderEndpoints, uploaders };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("postArweaveData — happy path through the pool", () => {
  it("builds an offline transaction carrying the given data/tags, signs it, and posts it via the chunked-upload loop; resolves { id, reward }", async () => {
    const { factory, uploaderTxs, uploaderEndpoints } = makeFakeFactory();
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });

    const result = await postArweaveData(
      pool,
      { jwk: TEST_KEYFILE, data: DATA, tags: TAGS, maxRewardWinston: CAP },
      { apiFactory: factory },
    );

    expect(result.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.reward).toBe(BigInt(PRICE));

    expect(uploaderTxs).toHaveLength(1);
    const posted = uploaderTxs[0];
    expect(posted.last_tx).toBe(ANCHOR);
    expect(posted.reward).toBe(PRICE);
    expect(posted.owner).toBe(TEST_KEYFILE.n);
    expect(posted.signature.length).toBeGreaterThan(0);
    expect(posted.id).toBe(result.id);
    // The tags survive onto the signed tx, base64url-encoded per the wire
    // format (matches `tx.addTag`'s encoding, not a raw pass-through).
    expect(posted.tags.map((t) => t.get("name", { decode: true, string: true }))).toEqual(
      TAGS.map((t) => t.name),
    );
    expect(posted.tags.map((t) => t.get("value", { decode: true, string: true }))).toEqual(
      TAGS.map((t) => t.value),
    );

    expect(uploaderEndpoints).toEqual(["https://a.example"]);
  });

  it("the signed tx verifies true against the arweave-js oracle (end-to-end signing correctness)", async () => {
    const { factory, uploaderTxs } = makeFakeFactory();
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });

    await postArweaveData(
      pool,
      { jwk: TEST_KEYFILE, data: DATA, tags: TAGS, maxRewardWinston: CAP },
      { apiFactory: factory },
    );

    await expect(oracle.transactions.verify(uploaderTxs[0])).resolves.toBe(true);
  });

  it("accepts Uint8Array data and carries it through to the signed tx", async () => {
    const { factory, uploaderTxs } = makeFakeFactory();
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });
    const bytes = new TextEncoder().encode("binary payload");

    const result = await postArweaveData(
      pool,
      { jwk: TEST_KEYFILE, data: bytes, tags: TAGS, maxRewardWinston: CAP },
      { apiFactory: factory },
    );

    expect(result.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(uploaderTxs[0].data_size).toBe(bytes.byteLength.toString());
  });
});

describe("postArweaveData — chunked upload loop", () => {
  it("loops uploadChunk() until isComplete across multiple chunks", async () => {
    const { factory, uploaders } = makeFakeFactory({ totalChunks: 3 });
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });

    await postArweaveData(
      pool,
      { jwk: TEST_KEYFILE, data: DATA, tags: TAGS, maxRewardWinston: CAP },
      { apiFactory: factory },
    );

    expect(uploaders).toHaveLength(1);
    expect(uploaders[0].calls).toEqual([0, 1, 2]);
    expect(uploaders[0].isComplete).toBe(true);
  });

  it("resumes a single failed chunk on the SAME uploader instance rather than restarting the whole upload from scratch", async () => {
    const { factory, uploaders } = makeFakeFactory({
      totalChunks: 3,
      failOnceAt: [1],
    });
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });

    const result = await postArweaveData(
      pool,
      { jwk: TEST_KEYFILE, data: DATA, tags: TAGS, maxRewardWinston: CAP },
      { apiFactory: factory },
    );

    expect(result.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Exactly ONE uploader instance was ever created for the whole call — the
    // chunk-1 failure did not cause a fresh getUploader()/tx re-post.
    expect(uploaders).toHaveLength(1);
    // Chunk 0 succeeded once, chunk 1 was attempted twice (fail then resume
    // from the SAME chunkIndex — not chunk 0 again), chunk 2 succeeded once.
    expect(uploaders[0].calls).toEqual([0, 1, 1, 2]);
    expect(uploaders[0].isComplete).toBe(true);
  });
});

describe("postArweaveData — the fee cap is REQUIRED (fund-burn defense)", () => {
  it("throws before any pool call when maxRewardWinston is omitted", async () => {
    const { factory, anchorCalls, priceCalls, uploaderTxs } = makeFakeFactory();
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });

    let thrown: unknown;
    try {
      await postArweaveData(
        pool,
        // No maxRewardWinston — the cast bypasses the compile-time requirement
        // to exercise the RUNTIME guard.
        { jwk: TEST_KEYFILE, data: DATA, tags: TAGS } as unknown as Parameters<
          typeof postArweaveData
        >[1],
        { apiFactory: factory },
      );
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(InvalidUploadParamsError);
    expect((thrown as InvalidUploadParamsError).field).toBe("maxRewardWinston");
    expect(anchorCalls).toHaveLength(0);
    expect(priceCalls).toHaveLength(0);
    expect(uploaderTxs).toHaveLength(0);
  });

  it("throws RewardExceedsCapError when the quote exceeds maxRewardWinston, BEFORE any signing/posting", async () => {
    const { factory, uploaderTxs } = makeFakeFactory({
      priceByEndpoint: { "https://a.example": "5000000000000" },
    });
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });

    let thrown: unknown;
    try {
      await postArweaveData(
        pool,
        {
          jwk: TEST_KEYFILE,
          data: DATA,
          tags: TAGS,
          maxRewardWinston: 1000000000n,
        },
        { apiFactory: factory },
      );
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(RewardExceedsCapError);
    const err = thrown as RewardExceedsCapError;
    expect(err.reward).toBe(5000000000000n);
    expect(err.cap).toBe(1000000000n);
    expect(uploaderTxs).toHaveLength(0);
  });

  it("allows a quote exactly at the cap (boundary is inclusive)", async () => {
    const { factory } = makeFakeFactory({
      priceByEndpoint: { "https://a.example": PRICE },
    });
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });

    const result = await postArweaveData(
      pool,
      {
        jwk: TEST_KEYFILE,
        data: DATA,
        tags: TAGS,
        maxRewardWinston: BigInt(PRICE),
      },
      { apiFactory: factory },
    );
    expect(result.reward).toBe(BigInt(PRICE));
  });
});

describe("postArweaveData — input validation", () => {
  it("throws InvalidKeyfileError for a malformed jwk without touching the pool", async () => {
    const { factory, anchorCalls, uploaderTxs } = makeFakeFactory();
    const broken = { ...TEST_KEYFILE } as Record<string, unknown>;
    delete broken.d;
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });

    await expect(
      postArweaveData(
        pool,
        {
          jwk: broken as unknown as typeof TEST_KEYFILE,
          data: DATA,
          tags: TAGS,
          maxRewardWinston: CAP,
        },
        { apiFactory: factory },
      ),
    ).rejects.toBeInstanceOf(InvalidKeyfileError);
    expect(anchorCalls).toHaveLength(0);
    expect(uploaderTxs).toHaveLength(0);
  });
});

describe("postArweaveData — retry/rotation on getUploader failure", () => {
  it("rotates to endpoint B when A's getUploader rejects entirely", async () => {
    const aFails: UploadGatewayApiFactory = (endpoint: string) => ({
      async getAnchor() {
        return ANCHOR;
      },
      async getPrice() {
        return PRICE;
      },
      async getUploader() {
        if (endpoint === "https://a.example") {
          throw new Error("ECONNRESET — simulated network failure");
        }
        return new FakeChunkedUploader(1);
      },
    });
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      sleep: instantSleep,
    });

    const result = await postArweaveData(
      pool,
      { jwk: TEST_KEYFILE, data: DATA, tags: TAGS, maxRewardWinston: CAP },
      { apiFactory: aFails },
    );
    expect(result.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("postArweaveData — origin-only pre-flight", () => {
  it("surfaces UnsupportedEndpointError UNWRAPPED with ZERO pool attempts for a pathed endpoint", async () => {
    const { factory, anchorCalls, priceCalls, uploaderTxs } = makeFakeFactory();
    const pool = createGatewayPool({
      endpoints: ["https://gw.example/api"],
      sleep: instantSleep,
    });

    await expect(
      postArweaveData(
        pool,
        { jwk: TEST_KEYFILE, data: DATA, tags: TAGS, maxRewardWinston: CAP },
        { apiFactory: factory },
      ),
    ).rejects.toBeInstanceOf(UnsupportedEndpointError);
    expect(anchorCalls).toHaveLength(0);
    expect(priceCalls).toHaveLength(0);
    expect(uploaderTxs).toHaveLength(0);
  });
});

describe("postArweaveData — pool exhaustion on the read path (no upload attempted)", () => {
  it("surfaces GatewayPoolExhaustedError from anchor/price with zero uploader attempts", async () => {
    const uploaderCalls: string[] = [];
    const factory: UploadGatewayApiFactory = () => ({
      async getAnchor() {
        throw new Error("anchor endpoint down");
      },
      async getPrice() {
        return PRICE;
      },
      async getUploader() {
        uploaderCalls.push("uploaded");
        return new FakeChunkedUploader(1);
      },
    });
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      maxAttemptsPerEndpoint: 1,
      sleep: instantSleep,
    });

    await expect(
      postArweaveData(
        pool,
        { jwk: TEST_KEYFILE, data: DATA, tags: TAGS, maxRewardWinston: CAP },
        { apiFactory: factory },
      ),
    ).rejects.toBeInstanceOf(GatewayPoolExhaustedError);
    expect(uploaderCalls).toHaveLength(0);
  });
});
