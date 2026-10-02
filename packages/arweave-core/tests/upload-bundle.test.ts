/**
 * upload-bundle.test.ts — `uploadBundle`, the multi-file/folder ANS-104
 * bundle upload primitive.
 *
 * `uploadBundle(pool, params, opts?)` signs one `arbundles` data item per
 * input file (tagged via `buildUploadTags` with `itemType: "file"`, a shared
 * `uploadId`, and a `Codex-Path` app-metadata tag carrying the file's
 * relative path), builds an `arweave/paths` manifest referencing every file
 * item's post-sign id, signs the manifest as its own data item
 * (`itemType: "manifest"`), bundles everything (`bundleAndSignData`) into
 * ONE binary payload, and posts that payload as a SINGLE transaction via
 * `postArweaveData` (`Bundle-Format: binary` / `Bundle-Version: 2.0.0` tags
 * on the wrapping transaction) — one atomic bundle, one payment, for N files.
 *
 * Tests use a REAL Phase-2 gateway pool (single endpoint, injected instant
 * sleep) plus an injected fake API factory of PLAIN functions — no network —
 * mirroring `upload-native.test.ts`'s fake-`apiFactory` pattern. The posted
 * bundle bytes are parsed back with `arbundles`' own `unbundleData` so the
 * test verifies the ACTUAL signed/tagged data items that were posted, not
 * just `uploadBundle`'s return value.
 */

import { describe, it, expect } from "vitest";
import { unbundleData } from "arbundles";
import type Transaction from "arweave/node/lib/transaction";

import { createGatewayPool } from "../src/gateway/pool.js";
import { uploadBundle } from "../src/upload/bundle.js";
import {
  TAG_CODEX_UPLOAD_ID,
  TAG_CODEX_ITEM_TYPE,
  TAG_CODEX_TAG_SCHEMA_VERSION,
  TAG_CODEX_CATEGORY,
  TAG_CODEX_ASSET_TYPE,
  TAG_CODEX_APP_ID,
  TAG_CODEX_APP_VERSION,
  TAG_CODEX_ENCRYPTED,
  TAG_CODEX_ENCRYPTOR,
  TAG_CODEX_ENCRYPTION_VERSION,
  CODEX_ENCRYPTION_VERSION_CURRENT,
} from "../src/upload/tags.js";
import type { UploadGatewayApi, UploadGatewayApiFactory, ChunkedUploader } from "../src/upload/nativeUpload.js";
import { TEST_KEYFILE } from "./fixtures/test-keyfile.js";

const instantSleep = async () => {};

const ANCHOR = "abcdEFGHijkLMNopQRSTuvWXyz0123456789_-ABCDEF".slice(0, 43);
const PRICE = "1000000000";
const CAP = 1000000000000n;
/** A valid canonical 43-char Arweave address, distinct from ANCHOR, used as a
 *  stand-in `encryptorAddress` in the encryption tests below. */
const ENCRYPTOR_ADDRESS = "ZYXwvuTSRQponmLKJIHgfedCBA9876543210_-zyxwv".slice(0, 43);

class FakeChunkedUploader implements ChunkedUploader {
  private chunkIndex = 0;
  constructor(private readonly totalChunks = 1) {}
  get isComplete(): boolean {
    return this.chunkIndex === this.totalChunks;
  }
  async uploadChunk(): Promise<void> {
    this.chunkIndex++;
  }
}

function makeFakeFactory(): {
  factory: UploadGatewayApiFactory;
  anchorCalls: string[];
  priceCalls: string[];
  uploaderTxs: Transaction[];
  getUploaderCalls: string[];
} {
  const anchorCalls: string[] = [];
  const priceCalls: string[] = [];
  const uploaderTxs: Transaction[] = [];
  const getUploaderCalls: string[] = [];

  const factory: UploadGatewayApiFactory = (endpoint: string): UploadGatewayApi => ({
    async getAnchor() {
      anchorCalls.push(endpoint);
      return ANCHOR;
    },
    async getPrice() {
      priceCalls.push(endpoint);
      return PRICE;
    },
    async getUploader(tx: Transaction) {
      getUploaderCalls.push(endpoint);
      uploaderTxs.push(tx);
      return new FakeChunkedUploader(1);
    },
  });

  return { factory, anchorCalls, priceCalls, uploaderTxs, getUploaderCalls };
}

const FILES = [
  { path: "a.txt", data: new TextEncoder().encode("file a"), contentType: "text/plain" },
  { path: "sub1/b.txt", data: new TextEncoder().encode("file b"), contentType: "text/plain" },
  { path: "sub2/nested/c.txt", data: new TextEncoder().encode("file c"), contentType: "text/plain" },
];

describe("uploadBundle — bundles N files across subfolders into one atomic transaction", () => {
  it("resolves a manifestId, one fileIds entry per file (keyed by its original relative path), and a shared uploadId", async () => {
    const { factory } = makeFakeFactory();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: instantSleep });

    const result = await uploadBundle(
      pool,
      {
        jwk: TEST_KEYFILE,
        files: FILES,
        maxRewardWinston: CAP,
        category: "personal-documents",
        encrypted: false,
      },
      { apiFactory: factory },
    );

    expect(result.manifestId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.fileIds).toHaveLength(3);
    expect(result.fileIds.map((f) => f.path).sort()).toEqual(
      ["a.txt", "sub1/b.txt", "sub2/nested/c.txt"].sort(),
    );
    for (const entry of result.fileIds) {
      expect(entry.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
    expect(typeof result.uploadId).toBe("string");
    expect(result.uploadId.length).toBeGreaterThan(0);
  });

  it("posts the whole batch as EXACTLY ONE transaction (one atomic bundle, one payment)", async () => {
    const { factory, anchorCalls, priceCalls, getUploaderCalls } = makeFakeFactory();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: instantSleep });

    await uploadBundle(
      pool,
      {
        jwk: TEST_KEYFILE,
        files: FILES,
        maxRewardWinston: CAP,
        category: "personal-documents",
        encrypted: false,
      },
      { apiFactory: factory },
    );

    // Exactly one postArweaveData-equivalent post call for the whole batch —
    // not one call per file. Every step of a single postArweaveData
    // invocation (anchor, price, upload) fires exactly once.
    expect(anchorCalls).toHaveLength(1);
    expect(priceCalls).toHaveLength(1);
    expect(getUploaderCalls).toHaveLength(1);
  });

  it("the wrapping transaction carries Bundle-Format: binary and Bundle-Version: 2.0.0", async () => {
    const { factory, uploaderTxs } = makeFakeFactory();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: instantSleep });

    await uploadBundle(
      pool,
      {
        jwk: TEST_KEYFILE,
        files: FILES,
        maxRewardWinston: CAP,
        category: "personal-documents",
        encrypted: false,
      },
      { apiFactory: factory },
    );

    const posted = uploaderTxs[0];
    const tags = posted.tags.map((t) => ({
      name: t.get("name", { decode: true, string: true }),
      value: t.get("value", { decode: true, string: true }),
    }));
    expect(tags).toContainEqual({ name: "Bundle-Format", value: "binary" });
    expect(tags).toContainEqual({ name: "Bundle-Version", value: "2.0.0" });
  });

  it("every produced data item (files + manifest) carries the same Codex-Upload-Id tag value, and the manifest's paths map resolves each path to its file item's exact id", async () => {
    const { factory, uploaderTxs } = makeFakeFactory();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: instantSleep });

    const result = await uploadBundle(
      pool,
      {
        jwk: TEST_KEYFILE,
        files: FILES,
        maxRewardWinston: CAP,
        category: "personal-documents",
        encrypted: false,
      },
      { apiFactory: factory },
    );

    // Parse the ACTUAL posted bundle bytes — proves the tags/ids on the wire,
    // not just the function's return value.
    const bundle = unbundleData(Buffer.from(uploaderTxs[0].data));
    expect(bundle.items).toHaveLength(4); // 3 files + 1 manifest

    const tagValue = (item: (typeof bundle.items)[number], name: string): string | undefined =>
      item.tags.find((t) => t.name === name)?.value;

    for (const item of bundle.items) {
      expect(tagValue(item, TAG_CODEX_UPLOAD_ID)).toBe(result.uploadId);
      expect(tagValue(item, TAG_CODEX_TAG_SCHEMA_VERSION)).toBeDefined();
    }

    const manifestItem = bundle.items.find((item) => tagValue(item, TAG_CODEX_ITEM_TYPE) === "manifest");
    expect(manifestItem).toBeDefined();
    expect(manifestItem!.id).toBe(result.manifestId);
    expect(tagValue(manifestItem!, "Content-Type")).toBe("application/x.arweave-manifest+json");

    const manifestJson = JSON.parse(manifestItem!.rawData.toString("utf8")) as {
      manifest: string;
      version: string;
      index?: { path: string };
      paths: Record<string, { id: string }>;
    };
    expect(manifestJson.manifest).toBe("arweave/paths");
    expect(manifestJson.version).toBe("0.2.0");
    for (const entry of result.fileIds) {
      expect(manifestJson.paths[entry.path]?.id).toBe(entry.id);
    }
    // A manifest with no "index" has no default content to resolve to when
    // browsed at its bare id with no trailing path (ANS-104/arweave-paths
    // manifest spec) — confirmed 404ing against the live gateway for an
    // already-posted manifest with this exact pre-fix shape. `index` names
    // the FIRST input file's own path (`FILES[0].path` === "a.txt") as the
    // manifest's default resolution target, so a bare `<manifestId>` link
    // always resolves to real content.
    expect(manifestJson.index).toEqual({ path: FILES[0]!.path });

    // Each file item carries its own Codex-Path tag verbatim.
    const fileItems = bundle.items.filter((item) => tagValue(item, TAG_CODEX_ITEM_TYPE) === "file");
    expect(fileItems).toHaveLength(3);
    for (const item of fileItems) {
      const path = tagValue(item, "Codex-Path");
      expect(path).toBeDefined();
      expect(result.fileIds.some((f) => f.path === path && f.id === item.id)).toBe(true);
    }
  });

  it("applies category/assetType/appId/appVersion IDENTICALLY to every produced item (files + manifest) — a per-upload-action choice, not per-file", async () => {
    const { factory, uploaderTxs } = makeFakeFactory();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: instantSleep });

    await uploadBundle(
      pool,
      {
        jwk: TEST_KEYFILE,
        files: FILES,
        maxRewardWinston: CAP,
        category: "nft-data",
        assetType: "image",
        appId: "ouronet-nft-gallery",
        appVersion: "2.3.1",
        encrypted: false,
      },
      { apiFactory: factory },
    );

    // Parse the ACTUAL posted bundle bytes — the same on-wire verification
    // pattern the tests above already use.
    const bundle = unbundleData(Buffer.from(uploaderTxs[0].data));
    expect(bundle.items).toHaveLength(4); // 3 files + 1 manifest

    const tagValue = (item: (typeof bundle.items)[number], name: string): string | undefined =>
      item.tags.find((t) => t.name === name)?.value;

    for (const item of bundle.items) {
      expect(tagValue(item, TAG_CODEX_CATEGORY)).toBe("nft-data");
      expect(tagValue(item, TAG_CODEX_ASSET_TYPE)).toBe("image");
      expect(tagValue(item, TAG_CODEX_APP_ID)).toBe("ouronet-nft-gallery");
      expect(tagValue(item, TAG_CODEX_APP_VERSION)).toBe("2.3.1");
    }
  });

  it("applies encrypted: true + encryptorAddress + encryptionVersion to every FILE item, but the MANIFEST item stays Codex-Encrypted: \"false\" with no Codex-Encryptor/Codex-Encryption-Version (structure stays public even when file contents are encrypted)", async () => {
    const { factory, uploaderTxs } = makeFakeFactory();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: instantSleep });

    const result = await uploadBundle(
      pool,
      {
        jwk: TEST_KEYFILE,
        files: FILES,
        maxRewardWinston: CAP,
        category: "personal-documents",
        encrypted: true,
        encryptorAddress: ENCRYPTOR_ADDRESS,
        encryptionVersion: CODEX_ENCRYPTION_VERSION_CURRENT,
      },
      { apiFactory: factory },
    );

    // Parse the ACTUAL posted bundle bytes — the same on-wire verification
    // pattern the tests above already use.
    const bundle = unbundleData(Buffer.from(uploaderTxs[0].data));
    expect(bundle.items).toHaveLength(4); // 3 files + 1 manifest

    const tagValue = (item: (typeof bundle.items)[number], name: string): string | undefined =>
      item.tags.find((t) => t.name === name)?.value;

    const fileItems = bundle.items.filter((item) => tagValue(item, TAG_CODEX_ITEM_TYPE) === "file");
    expect(fileItems).toHaveLength(3);
    for (const item of fileItems) {
      expect(tagValue(item, TAG_CODEX_ENCRYPTED)).toBe("true");
      expect(tagValue(item, TAG_CODEX_ENCRYPTOR)).toBe(ENCRYPTOR_ADDRESS);
      expect(tagValue(item, TAG_CODEX_ENCRYPTION_VERSION)).toBe(CODEX_ENCRYPTION_VERSION_CURRENT);
    }

    const manifestItem = bundle.items.find((item) => tagValue(item, TAG_CODEX_ITEM_TYPE) === "manifest");
    expect(manifestItem).toBeDefined();
    expect(manifestItem!.id).toBe(result.manifestId);
    expect(tagValue(manifestItem!, TAG_CODEX_ENCRYPTED)).toBe("false");
    expect(tagValue(manifestItem!, TAG_CODEX_ENCRYPTOR)).toBeUndefined();
    expect(tagValue(manifestItem!, TAG_CODEX_ENCRYPTION_VERSION)).toBeUndefined();
  });

  it("posts Codex-Encrypted: \"false\" and no Codex-Encryptor/Codex-Encryption-Version on every item (files + manifest) when encrypted: false", async () => {
    const { factory, uploaderTxs } = makeFakeFactory();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: instantSleep });

    await uploadBundle(
      pool,
      {
        jwk: TEST_KEYFILE,
        files: FILES,
        maxRewardWinston: CAP,
        category: "personal-documents",
        encrypted: false,
      },
      { apiFactory: factory },
    );

    const bundle = unbundleData(Buffer.from(uploaderTxs[0].data));
    const tagValue = (item: (typeof bundle.items)[number], name: string): string | undefined =>
      item.tags.find((t) => t.name === name)?.value;

    for (const item of bundle.items) {
      expect(tagValue(item, TAG_CODEX_ENCRYPTED)).toBe("false");
      expect(tagValue(item, TAG_CODEX_ENCRYPTOR)).toBeUndefined();
      expect(tagValue(item, TAG_CODEX_ENCRYPTION_VERSION)).toBeUndefined();
    }
  });
});
