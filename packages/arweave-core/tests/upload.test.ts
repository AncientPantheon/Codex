/**
 * upload.test.ts — native upload orchestration (`uploadData`).
 *
 * `uploadData` validates the jwk, derives Codex-Owner via Phase 2's `addressOf`
 * (the SOLE derivation path — the one-canonical-form contract), builds the tag
 * schema, and posts the payload as a native (non-bundler) Arweave transaction
 * through T3's `postArweaveData` — an INJECTABLE per-endpoint gateway-API seam,
 * mirroring `tests/tx-transfer.test.ts`/`tests/upload-native.test.ts`'s fake
 * `apiFactory` pattern. NO network, and (deliberately) no bundler-service
 * client anywhere in this file — the seam is typed against our own narrow
 * `UploadGatewayApiFactory` interface.
 *
 * The offline guarantee is asserted structurally: `globalThis.fetch` is stubbed
 * to throw across the whole happy path, proving the mocked upload touches no
 * network.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Transaction from "arweave/node/lib/transaction";

import { uploadData } from "../src/upload/upload.js";
import { InvalidUploadParamsError } from "../src/upload/errors.js";
import { InvalidKeyfileError } from "../src/keys/errors.js";
import { RewardExceedsCapError } from "../src/tx/errors.js";
import { GatewayPoolExhaustedError } from "../src/gateway/errors.js";
import { addressOf } from "../src/keys/address.js";
import { queryOwnerUploads } from "../src/rebuild/query.js";
import { createGatewayPool } from "../src/gateway/pool.js";
import type { UploadGatewayApi, UploadGatewayApiFactory, ChunkedUploader } from "../src/upload/nativeUpload.js";
import type { UploadParams } from "../src/upload/types.js";
import {
  TAG_APP_NAME,
  TAG_CONTENT_TYPE,
  TAG_CODEX_ITEM_ID,
  TAG_CODEX_OWNER,
  TAG_CODEX_TAG_SCHEMA_VERSION,
  TAG_CODEX_UPLOAD_ID,
  TAG_CODEX_ITEM_TYPE,
  TAG_CODEX_CATEGORY,
  TAG_CODEX_ASSET_TYPE,
  TAG_CODEX_ENCRYPTED,
  TAG_CODEX_ENCRYPTOR,
  TAG_CODEX_ENCRYPTION_VERSION,
  CODEX_TAG_SCHEMA_VERSION_CURRENT,
  CODEX_ENCRYPTION_VERSION_CURRENT,
  DEFAULT_APP_NAME,
  type Tag,
} from "../src/upload/tags.js";
import { TEST_KEYFILE } from "./fixtures/test-keyfile.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANONICAL_ID_RE = /^[A-Za-z0-9_-]{43}$/;

const ANCHOR = "abcdEFGHijkLMNopQRSTuvWXyz0123456789_-ABCDEF".slice(0, 43);
/** A valid canonical 43-char Arweave address, distinct from ANCHOR, used as a
 *  stand-in `encryptorAddress` in the encryption tests below. */
const ENCRYPTOR_ADDRESS = "ZYXwvuTSRQponmLKJIHgfedCBA9876543210_-zyxwv".slice(0, 43);
const PRICE = "1000000000"; // honest Winston fee quote (decimal string)
/** A cap comfortably above the honest PRICE — the fee cap is REQUIRED. */
const CAP = 1000000000000n;

/** A fake chunked uploader completing after a single `uploadChunk()` call. */
class FakeChunkedUploader implements ChunkedUploader {
  private done = false;
  get isComplete(): boolean {
    return this.done;
  }
  async uploadChunk(): Promise<void> {
    this.done = true;
  }
}

interface FakeApiOptions {
  anchor?: string;
  price?: string;
  /** When set, every `getAnchor()` call rejects — for pool-exhaustion tests. */
  anchorFails?: boolean;
}

function makeFakeFactory(opts: FakeApiOptions = {}): {
  factory: UploadGatewayApiFactory;
  anchorCalls: string[];
  priceCalls: string[];
  uploaderTxs: Transaction[];
} {
  const anchorCalls: string[] = [];
  const priceCalls: string[] = [];
  const uploaderTxs: Transaction[] = [];

  const factory: UploadGatewayApiFactory = (endpoint: string): UploadGatewayApi => ({
    async getAnchor() {
      anchorCalls.push(endpoint);
      if (opts.anchorFails) throw new Error("anchor endpoint down");
      return opts.anchor ?? ANCHOR;
    },
    async getPrice(_byteSize: number, _target?: string) {
      priceCalls.push(endpoint);
      return opts.price ?? PRICE;
    },
    async getUploader(tx: Transaction) {
      uploaderTxs.push(tx);
      return new FakeChunkedUploader();
    },
  });

  return { factory, anchorCalls, priceCalls, uploaderTxs };
}

function tagValueOnTx(tx: Transaction, name: string): string | undefined {
  return tx.tags
    .find((t) => t.get("name", { decode: true, string: true }) === name)
    ?.get("value", { decode: true, string: true });
}

function tagValue(tags: Tag[], name: string): string | undefined {
  return tags.find((t) => t.name === name)?.value;
}

/**
 * `category` is a REQUIRED field on `UploadParams` (T2) — this fixture always
 * supplies one so every existing test keeps passing; `overrides` may replace it
 * with any other valid `UploadCategory` (see the `nft-data` tests below).
 *
 * `encrypted` is likewise REQUIRED (T4, `arweave-upload-encryption`) — this
 * fixture defaults to `false` (the fully-backward-compatible, everything-public
 * case) so every existing test keeps passing unchanged; `overrides` may set
 * `encrypted: true` plus `encryptorAddress` (see the encryption tests below).
 */
function baseParams(overrides: Partial<UploadParams> = {}): UploadParams {
  return {
    jwk: TEST_KEYFILE,
    data: "hello permaweb",
    contentType: "text/plain",
    maxRewardWinston: CAP,
    category: "general-other",
    encrypted: false,
    ...overrides,
  };
}

let realFetch: typeof globalThis.fetch;

beforeEach(() => {
  // Offline guarantee: any network touch during the mocked path must fail loudly.
  realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(() => {
    throw new Error("network access is forbidden in upload tests");
  }) as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("uploadData — tag schema application (one-canonical-form)", () => {
  it("applies the full 7-tag schema with Codex-Owner strictly equal to addressOf(jwk)", async () => {
    const { factory, uploaderTxs } = makeFakeFactory();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} });
    const expectedOwner = await addressOf(TEST_KEYFILE);

    const result = await uploadData(pool, baseParams(), { apiFactory: factory });

    expect(uploaderTxs).toHaveLength(1);
    const tx = uploaderTxs[0];
    expect(tagValueOnTx(tx, TAG_APP_NAME)).toBe(DEFAULT_APP_NAME);
    expect(tagValueOnTx(tx, TAG_CONTENT_TYPE)).toBe("text/plain");
    expect(tagValueOnTx(tx, TAG_CODEX_OWNER)).toBe(expectedOwner);
    expect(tagValueOnTx(tx, TAG_CODEX_ITEM_ID)).toMatch(UUID_RE);
    expect(tagValueOnTx(tx, TAG_CODEX_TAG_SCHEMA_VERSION)).toBe(CODEX_TAG_SCHEMA_VERSION_CURRENT);
    expect(tagValueOnTx(tx, TAG_CODEX_UPLOAD_ID)).toBe(tagValueOnTx(tx, TAG_CODEX_ITEM_ID));
    expect(tagValueOnTx(tx, TAG_CODEX_ITEM_TYPE)).toBe("file");
    expect(result.tags.slice(0, 7).map((t) => t.name)).toEqual([
      TAG_APP_NAME,
      TAG_CONTENT_TYPE,
      TAG_CODEX_ITEM_ID,
      TAG_CODEX_OWNER,
      TAG_CODEX_TAG_SCHEMA_VERSION,
      TAG_CODEX_UPLOAD_ID,
      TAG_CODEX_ITEM_TYPE,
    ]);
  });

  it("passes app metadata tags through to the wire after the required seven", async () => {
    const { factory, uploaderTxs } = makeFakeFactory();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} });

    const result = await uploadData(
      pool,
      baseParams({ appMetadata: [{ name: "Title", value: "The Odyssey" }] }),
      { apiFactory: factory },
    );

    expect(tagValueOnTx(uploaderTxs[0], "Title")).toBe("The Odyssey");
    expect(tagValue(result.tags, "Title")).toBe("The Odyssey");
    // 7 required tags + Codex-Category (baseParams always sets one, T2) +
    // Codex-Encrypted (baseParams always sets encrypted: false, T4 — emitted
    // even for false once explicitly provided) + Title.
    expect(result.tags).toHaveLength(10);
  });

  it("honors an explicit appName override in the App-Name tag", async () => {
    const { factory, uploaderTxs } = makeFakeFactory();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} });

    await uploadData(pool, baseParams({ appName: "Custom-App" }), { apiFactory: factory });

    expect(tagValueOnTx(uploaderTxs[0], TAG_APP_NAME)).toBe("Custom-App");
  });
});

// `category` is a REQUIRED field on `UploadParams` (T2) — TypeScript rejects, at
// COMPILE time, any object literal assigned to `UploadParams` (including every
// `baseParams()` call in this file) that omits it. That guarantee cannot be
// asserted at runtime the same way a validation throw can (there is no "missing
// field" value to catch), so it is not exercised by a test here; it is enforced
// structurally by every fixture in this file being a plain, uncast `UploadParams`
// literal that always sets `category` — if a future edit ever tried to make
// `category` optional again, or a test tried to omit it, `tsc` would fail this
// file before any test could run.
describe("uploadData — category/assetType forwarding (T2, mandatory category)", () => {
  it("forwards category verbatim into the posted Codex-Category tag", async () => {
    const { factory, uploaderTxs } = makeFakeFactory();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} });

    const result = await uploadData(pool, baseParams({ category: "creative-work" }), {
      apiFactory: factory,
    });

    expect(tagValueOnTx(uploaderTxs[0], TAG_CODEX_CATEGORY)).toBe("creative-work");
    expect(tagValue(result.tags, TAG_CODEX_CATEGORY)).toBe("creative-work");
  });

  it("succeeds for an nft-data upload with a valid assetType, posting both Codex-Category and Codex-Asset-Type", async () => {
    const { factory, uploaderTxs } = makeFakeFactory();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} });

    const result = await uploadData(
      pool,
      baseParams({ category: "nft-data", assetType: "video" }),
      { apiFactory: factory },
    );

    expect(tagValueOnTx(uploaderTxs[0], TAG_CODEX_CATEGORY)).toBe("nft-data");
    expect(tagValueOnTx(uploaderTxs[0], TAG_CODEX_ASSET_TYPE)).toBe("video");
    expect(tagValue(result.tags, TAG_CODEX_CATEGORY)).toBe("nft-data");
    expect(tagValue(result.tags, TAG_CODEX_ASSET_TYPE)).toBe("video");
  });

  it("rejects category: nft-data without assetType, propagating buildUploadTags's InvalidUploadParamsError", async () => {
    const { factory, anchorCalls } = makeFakeFactory();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} });

    await expect(
      uploadData(pool, baseParams({ category: "nft-data" }), { apiFactory: factory }),
    ).rejects.toBeInstanceOf(InvalidUploadParamsError);
    expect(anchorCalls).toHaveLength(0);
  });

  it("forwards appId/appVersion verbatim into their tags", async () => {
    const { factory, uploaderTxs } = makeFakeFactory();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} });

    await uploadData(pool, baseParams({ appId: "my-app", appVersion: "1.2.3" }), {
      apiFactory: factory,
    });

    expect(tagValueOnTx(uploaderTxs[0], "Codex-App-Id")).toBe("my-app");
    expect(tagValueOnTx(uploaderTxs[0], "Codex-App-Version")).toBe("1.2.3");
  });
});

describe("uploadData — encrypted/encryptorAddress/encryptionVersion forwarding (T4, arweave-tag-schema-spec T2)", () => {
  it("posts Codex-Encrypted: \"true\", the correct Codex-Encryptor, and Codex-Encryption-Version when encrypted: true", async () => {
    const { factory, uploaderTxs } = makeFakeFactory();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} });

    const result = await uploadData(
      pool,
      baseParams({
        encrypted: true,
        encryptorAddress: ENCRYPTOR_ADDRESS,
        encryptionVersion: CODEX_ENCRYPTION_VERSION_CURRENT,
      }),
      { apiFactory: factory },
    );

    expect(tagValueOnTx(uploaderTxs[0], TAG_CODEX_ENCRYPTED)).toBe("true");
    expect(tagValueOnTx(uploaderTxs[0], TAG_CODEX_ENCRYPTOR)).toBe(ENCRYPTOR_ADDRESS);
    expect(tagValueOnTx(uploaderTxs[0], TAG_CODEX_ENCRYPTION_VERSION)).toBe(CODEX_ENCRYPTION_VERSION_CURRENT);
    expect(tagValue(result.tags, TAG_CODEX_ENCRYPTED)).toBe("true");
    expect(tagValue(result.tags, TAG_CODEX_ENCRYPTOR)).toBe(ENCRYPTOR_ADDRESS);
    expect(tagValue(result.tags, TAG_CODEX_ENCRYPTION_VERSION)).toBe(CODEX_ENCRYPTION_VERSION_CURRENT);
  });

  it("posts Codex-Encrypted: \"false\" and no Codex-Encryptor/Codex-Encryption-Version tag when encrypted: false", async () => {
    const { factory, uploaderTxs } = makeFakeFactory();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} });

    const result = await uploadData(pool, baseParams({ encrypted: false }), { apiFactory: factory });

    expect(tagValueOnTx(uploaderTxs[0], TAG_CODEX_ENCRYPTED)).toBe("false");
    expect(tagValueOnTx(uploaderTxs[0], TAG_CODEX_ENCRYPTOR)).toBeUndefined();
    expect(tagValueOnTx(uploaderTxs[0], TAG_CODEX_ENCRYPTION_VERSION)).toBeUndefined();
    expect(tagValue(result.tags, TAG_CODEX_ENCRYPTED)).toBe("false");
    expect(tagValue(result.tags, TAG_CODEX_ENCRYPTOR)).toBeUndefined();
    expect(tagValue(result.tags, TAG_CODEX_ENCRYPTION_VERSION)).toBeUndefined();
  });

  it("propagates buildUploadTags's InvalidUploadParamsError when encrypted: true is missing encryptorAddress", async () => {
    const { factory, anchorCalls } = makeFakeFactory();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} });

    await expect(
      uploadData(pool, baseParams({ encrypted: true }), { apiFactory: factory }),
    ).rejects.toBeInstanceOf(InvalidUploadParamsError);
    expect(anchorCalls).toHaveLength(0);
  });

  it("propagates buildUploadTags's InvalidUploadParamsError when encrypted: true is missing encryptionVersion", async () => {
    const { factory, anchorCalls } = makeFakeFactory();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} });

    await expect(
      uploadData(
        pool,
        baseParams({ encrypted: true, encryptorAddress: ENCRYPTOR_ADDRESS }),
        { apiFactory: factory },
      ),
    ).rejects.toBeInstanceOf(InvalidUploadParamsError);
    expect(anchorCalls).toHaveLength(0);
  });
});

describe("uploadData — result and item id", () => {
  it("resolves a canonical 43-char id equal to the signed transaction's id", async () => {
    const { factory, uploaderTxs } = makeFakeFactory();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} });

    const result = await uploadData(pool, baseParams(), { apiFactory: factory });

    expect(result.id).toMatch(CANONICAL_ID_RE);
    expect(result.id).toBe(uploaderTxs[0].id);
  });

  it("auto-generates a UUID itemId used verbatim as both Codex-Item-Id and Codex-Upload-Id", async () => {
    const { factory } = makeFakeFactory();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} });

    const result = await uploadData(pool, baseParams(), { apiFactory: factory });

    expect(result.itemId).toMatch(UUID_RE);
    expect(tagValue(result.tags, TAG_CODEX_ITEM_ID)).toBe(result.itemId);
    expect(tagValue(result.tags, TAG_CODEX_UPLOAD_ID)).toBe(result.itemId);
  });

  it("respects an explicitly provided itemId, used verbatim as both tags", async () => {
    const { factory } = makeFakeFactory();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} });
    const explicit = "my-explicit-item-id";

    const result = await uploadData(pool, baseParams({ itemId: explicit }), {
      apiFactory: factory,
    });

    expect(result.itemId).toBe(explicit);
    expect(tagValue(result.tags, TAG_CODEX_ITEM_ID)).toBe(explicit);
    expect(tagValue(result.tags, TAG_CODEX_UPLOAD_ID)).toBe(explicit);
  });

  it("returns ownerAddress equal to addressOf(jwk) and the applied tags", async () => {
    const { factory } = makeFakeFactory();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} });
    const expectedOwner = await addressOf(TEST_KEYFILE);

    const result = await uploadData(pool, baseParams(), { apiFactory: factory });

    expect(result.ownerAddress).toBe(expectedOwner);
  });
});

describe("uploadData — input validation (zero pool calls)", () => {
  it("rejects a malformed jwk with InvalidKeyfileError and never touches the pool", async () => {
    const { factory, anchorCalls, uploaderTxs } = makeFakeFactory();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} });
    const badJwk = { ...TEST_KEYFILE };
    delete (badJwk as Record<string, unknown>).d;

    await expect(
      uploadData(pool, baseParams({ jwk: badJwk as UploadParams["jwk"] }), {
        apiFactory: factory,
      }),
    ).rejects.toBeInstanceOf(InvalidKeyfileError);
    expect(anchorCalls).toHaveLength(0);
    expect(uploaderTxs).toHaveLength(0);
  });

  it("rejects empty string data with InvalidUploadParamsError and never touches the pool", async () => {
    const { factory, anchorCalls } = makeFakeFactory();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} });

    await expect(
      uploadData(pool, baseParams({ data: "" }), { apiFactory: factory }),
    ).rejects.toBeInstanceOf(InvalidUploadParamsError);
    expect(anchorCalls).toHaveLength(0);
  });

  it("rejects empty Uint8Array data with InvalidUploadParamsError and never touches the pool", async () => {
    const { factory, anchorCalls } = makeFakeFactory();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} });

    await expect(
      uploadData(pool, baseParams({ data: new Uint8Array(0) }), { apiFactory: factory }),
    ).rejects.toBeInstanceOf(InvalidUploadParamsError);
    expect(anchorCalls).toHaveLength(0);
  });

  it("propagates InvalidUploadParamsError (missing-max-reward) when maxRewardWinston is omitted, before any pool call", async () => {
    const { factory, anchorCalls } = makeFakeFactory();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} });

    let thrown: unknown;
    try {
      await uploadData(
        pool,
        { jwk: TEST_KEYFILE, data: "hello", contentType: "text/plain" } as unknown as UploadParams,
        { apiFactory: factory },
      );
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(InvalidUploadParamsError);
    expect((thrown as InvalidUploadParamsError).field).toBe("maxRewardWinston");
    expect(anchorCalls).toHaveLength(0);
  });
});

describe("uploadData — upload failure propagates T3's typed errors, unwrapped", () => {
  it("propagates RewardExceedsCapError when the quote exceeds maxRewardWinston, before any signing/posting", async () => {
    const { factory, uploaderTxs } = makeFakeFactory({ price: "5000000000000" });
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} });

    await expect(
      uploadData(pool, baseParams({ maxRewardWinston: 1000000000n }), { apiFactory: factory }),
    ).rejects.toBeInstanceOf(RewardExceedsCapError);
    expect(uploaderTxs).toHaveLength(0);
  });

  it("propagates GatewayPoolExhaustedError when every endpoint's anchor fetch fails, without leaking JWK private-field values", async () => {
    const { factory } = makeFakeFactory({ anchorFails: true });
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      maxAttemptsPerEndpoint: 1,
      sleep: async () => {},
    });

    const err = (await uploadData(pool, baseParams(), { apiFactory: factory }).catch(
      (e: unknown) => e,
    )) as GatewayPoolExhaustedError;

    expect(err).toBeInstanceOf(GatewayPoolExhaustedError);
    const serialized = JSON.stringify(err, Object.getOwnPropertyNames(err));
    for (const field of [
      TEST_KEYFILE.d,
      TEST_KEYFILE.p,
      TEST_KEYFILE.q,
      TEST_KEYFILE.dp,
      TEST_KEYFILE.dq,
      TEST_KEYFILE.qi,
    ]) {
      expect(serialized).not.toContain(field);
    }
    // Sanity: the private field is a long non-empty string, so the assertion is real.
    expect(TEST_KEYFILE.d.length).toBeGreaterThan(100);
  });
});

describe("uploadData → queryOwnerUploads — FLOW A owner-address round-trip (one canonical string)", () => {
  it("stamps the SAME string upload's Codex-Owner, addressOf, and rebuild's owners filter all use", async () => {
    // Upload derives Codex-Owner via addressOf(jwk); rebuild filters by owners:[owner].
    // This closes the loop at the contract level: the string uploadData stamps is
    // byte-identical to addressOf(TEST_KEYFILE) AND is exactly what queryOwnerUploads
    // binds into its GraphQL `owners` variable — proving one canonical form end to end.
    const { factory } = makeFakeFactory();
    const uploadPool = createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} });
    const owner = (await uploadData(uploadPool, baseParams(), { apiFactory: factory })).ownerAddress;

    // 1) Upload's stamped owner equals the independent addressOf derivation.
    const derived = await addressOf(TEST_KEYFILE);
    expect(owner).toBe(derived);

    // 2) Rebuild binds that exact string into owners:[owner]. Capture the request.
    let capturedOwners: unknown;
    const fetchFn = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      capturedOwners = JSON.parse(String(init?.body)).variables.owners;
      return new Response(
        JSON.stringify({ data: { transactions: { pageInfo: { hasNextPage: false }, edges: [] } } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const rebuildPool = createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} });

    await queryOwnerUploads(rebuildPool, owner, { fetchFn });

    expect(capturedOwners).toEqual([owner]);
  });
});

describe("uploadData — offline guarantee", () => {
  it("completes the mocked happy path without any network access", async () => {
    const { factory } = makeFakeFactory();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} });

    const result = await uploadData(pool, baseParams(), { apiFactory: factory });

    expect(result.id).toMatch(CANONICAL_ID_RE);
    // fetch was stubbed to throw; a passing result proves no network touch.
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
