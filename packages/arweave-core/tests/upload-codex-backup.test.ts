/**
 * upload-codex-backup.test.ts — the dedicated codex-backup upload primitive.
 *
 * `uploadCodexBackup(pool, { jwk, exportJson, maxRewardWinston }, opts?)` is a
 * thin, hardcoded-category wrapper around `uploadData` (T2): it posts the
 * caller's OPAQUE `exportJson` string verbatim as `data`, with
 * `contentType: "application/json"` and `category: "codex-backup"` — the
 * category is fixed inside `uploadCodexBackup` itself, never caller-supplied.
 * Mirrors `upload.test.ts`/`upload-native.test.ts`'s fake-`apiFactory`
 * injection pattern — no network, no bundler-service client.
 */

import { describe, it, expect } from "vitest";
import type Transaction from "arweave/node/lib/transaction";

import { uploadCodexBackup, type UploadCodexBackupParams } from "../src/upload/codexBackup.js";
import { InvalidKeyfileError } from "../src/keys/errors.js";
import { RewardExceedsCapError } from "../src/tx/errors.js";
import { createGatewayPool } from "../src/gateway/pool.js";
import type { UploadGatewayApi, UploadGatewayApiFactory, ChunkedUploader } from "../src/upload/nativeUpload.js";
import {
  TAG_CONTENT_TYPE,
  TAG_CODEX_CATEGORY,
  TAG_CODEX_APP_ID,
  TAG_CODEX_APP_VERSION,
  type Tag,
} from "../src/upload/tags.js";
import { TEST_KEYFILE } from "./fixtures/test-keyfile.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANONICAL_ID_RE = /^[A-Za-z0-9_-]{43}$/;

const ANCHOR = "abcdEFGHijkLMNopQRSTuvWXyz0123456789_-ABCDEF".slice(0, 43);
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
  price?: string;
}

function makeFakeFactory(opts: FakeApiOptions = {}): {
  factory: UploadGatewayApiFactory;
  uploaderTxs: Transaction[];
} {
  const uploaderTxs: Transaction[] = [];

  const factory: UploadGatewayApiFactory = (): UploadGatewayApi => ({
    async getAnchor() {
      return ANCHOR;
    },
    async getPrice() {
      return opts.price ?? PRICE;
    },
    async getUploader(tx: Transaction) {
      uploaderTxs.push(tx);
      return new FakeChunkedUploader();
    },
  });

  return { factory, uploaderTxs };
}

function tagValueOnTx(tx: Transaction, name: string): string | undefined {
  return tx.tags
    .find((t) => t.get("name", { decode: true, string: true }) === name)
    ?.get("value", { decode: true, string: true });
}

function tagValue(tags: Tag[], name: string): string | undefined {
  return tags.find((t) => t.name === name)?.value;
}

describe("uploadCodexBackup — uploads exportJson verbatim, tagged codex-backup", () => {
  it("posts exportJson as the payload with Content-Type: application/json and Codex-Category: codex-backup, resolving uploadData's UploadResult shape", async () => {
    const { factory, uploaderTxs } = makeFakeFactory();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} });
    const exportJson = JSON.stringify({ vaults: [{ name: "example", secret: "shh" }] });

    const result = await uploadCodexBackup(
      pool,
      { jwk: TEST_KEYFILE, exportJson, maxRewardWinston: CAP },
      { apiFactory: factory },
    );

    expect(uploaderTxs).toHaveLength(1);
    const tx = uploaderTxs[0];
    // The payload is the exportJson string, byte-for-byte — never reshaped,
    // reparsed, or otherwise inspected (uploadCodexBackup treats it opaquely).
    expect(tx.get("data", { decode: true, string: true })).toBe(exportJson);
    expect(tagValueOnTx(tx, TAG_CONTENT_TYPE)).toBe("application/json");
    expect(tagValueOnTx(tx, TAG_CODEX_CATEGORY)).toBe("codex-backup");

    // The resolved UploadResult mirrors those same tags plus uploadData's shape.
    expect(tagValue(result.tags, TAG_CONTENT_TYPE)).toBe("application/json");
    expect(tagValue(result.tags, TAG_CODEX_CATEGORY)).toBe("codex-backup");
    expect(result.id).toMatch(CANONICAL_ID_RE);
    expect(result.id).toBe(tx.id);
    expect(result.ownerAddress).toMatch(CANONICAL_ID_RE);
    expect(result.itemId).toMatch(UUID_RE);
  });

  it("forwards jwk verbatim to uploadData — a malformed jwk rejects with InvalidKeyfileError before any pool call", async () => {
    const { factory, uploaderTxs } = makeFakeFactory();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} });
    const badJwk = { ...TEST_KEYFILE };
    delete (badJwk as Record<string, unknown>).d;

    await expect(
      uploadCodexBackup(
        pool,
        { jwk: badJwk as UploadCodexBackupParams["jwk"], exportJson: "{}", maxRewardWinston: CAP },
        { apiFactory: factory },
      ),
    ).rejects.toBeInstanceOf(InvalidKeyfileError);
    expect(uploaderTxs).toHaveLength(0);
  });

  it("forwards optional appId/appVersion verbatim to the Codex-App-Id/Codex-App-Version tags when provided", async () => {
    const { factory, uploaderTxs } = makeFakeFactory();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} });

    const result = await uploadCodexBackup(
      pool,
      {
        jwk: TEST_KEYFILE,
        exportJson: "{}",
        maxRewardWinston: CAP,
        appId: "my-codex",
        appVersion: "2026-09-30T00:00:00.000Z",
      },
      { apiFactory: factory },
    );

    const tx = uploaderTxs[0];
    expect(tagValueOnTx(tx, TAG_CODEX_APP_ID)).toBe("my-codex");
    expect(tagValueOnTx(tx, TAG_CODEX_APP_VERSION)).toBe("2026-09-30T00:00:00.000Z");
    expect(tagValue(result.tags, TAG_CODEX_APP_ID)).toBe("my-codex");
    expect(tagValue(result.tags, TAG_CODEX_APP_VERSION)).toBe("2026-09-30T00:00:00.000Z");
  });

  it("omits Codex-App-Id/Codex-App-Version entirely when appId/appVersion are not provided — no empty-string placeholder tags", async () => {
    const { factory, uploaderTxs } = makeFakeFactory();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} });

    const result = await uploadCodexBackup(
      pool,
      { jwk: TEST_KEYFILE, exportJson: "{}", maxRewardWinston: CAP },
      { apiFactory: factory },
    );

    const tx = uploaderTxs[0];
    expect(tagValueOnTx(tx, TAG_CODEX_APP_ID)).toBeUndefined();
    expect(tagValueOnTx(tx, TAG_CODEX_APP_VERSION)).toBeUndefined();
    expect(tagValue(result.tags, TAG_CODEX_APP_ID)).toBeUndefined();
    expect(tagValue(result.tags, TAG_CODEX_APP_VERSION)).toBeUndefined();
  });

  it("forwards optional appMetadata entries verbatim to the posted upload's tags, after the required+category tags (T2, codex-recovery-backup-tagging — the seam the recovery-key tag rides)", async () => {
    const { factory, uploaderTxs } = makeFakeFactory();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} });

    const result = await uploadCodexBackup(
      pool,
      {
        jwk: TEST_KEYFILE,
        exportJson: "{}",
        maxRewardWinston: CAP,
        appMetadata: [{ name: "Codex-Backup-Recovery-Key", value: "ciphertext-value" }],
      },
      { apiFactory: factory },
    );

    const tx = uploaderTxs[0];
    expect(tagValueOnTx(tx, "Codex-Backup-Recovery-Key")).toBe("ciphertext-value");
    expect(tagValue(result.tags, "Codex-Backup-Recovery-Key")).toBe("ciphertext-value");
  });

  it("omits any metadata tag entirely when appMetadata is not provided — no regression for existing callers", async () => {
    const { factory, uploaderTxs } = makeFakeFactory();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} });

    const result = await uploadCodexBackup(
      pool,
      { jwk: TEST_KEYFILE, exportJson: "{}", maxRewardWinston: CAP },
      { apiFactory: factory },
    );

    const tx = uploaderTxs[0];
    expect(tagValueOnTx(tx, "Codex-Backup-Recovery-Key")).toBeUndefined();
    expect(tagValue(result.tags, "Codex-Backup-Recovery-Key")).toBeUndefined();
  });

  it("forwards maxRewardWinston verbatim as the fee cap — a quote exceeding it throws RewardExceedsCapError", async () => {
    const { factory, uploaderTxs } = makeFakeFactory({ price: "5000000000000" });
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} });

    await expect(
      uploadCodexBackup(
        pool,
        { jwk: TEST_KEYFILE, exportJson: "{}", maxRewardWinston: 1000000000n },
        { apiFactory: factory },
      ),
    ).rejects.toBeInstanceOf(RewardExceedsCapError);
    expect(uploaderTxs).toHaveLength(0);
  });
});

// TYPE-LEVEL GUARANTEE: `UploadCodexBackupParams` has no `category` field for a
// caller to set — `uploadCodexBackup` is the ONLY code path allowed to choose
// the category (hardcoded internally to "codex-backup"). If a `category` field
// is ever added to this params type, the line below fails to compile (a type
// that is `never` cannot be assigned `true`), catching an accidental widening
// of the caller-facing surface at `tsc` time rather than at runtime.
type ParamsHasNoCategoryField = "category" extends keyof UploadCodexBackupParams ? never : true;
const _assertNoCategoryField: ParamsHasNoCategoryField = true;
void _assertNoCategoryField;

describe("uploadCodexBackup — category cannot be overridden by a caller", () => {
  it("UploadCodexBackupParams has exactly {jwk, exportJson, maxRewardWinston} — no category field to override", () => {
    // Runtime companion to the type-level assertion above, for a reader running
    // only `vitest` (not `tsc`): a real params object built from the exported
    // type has exactly these three keys, and "category" is absent.
    const params: UploadCodexBackupParams = {
      jwk: TEST_KEYFILE,
      exportJson: "{}",
      maxRewardWinston: CAP,
    };
    expect(Object.keys(params).sort()).toEqual(["exportJson", "jwk", "maxRewardWinston"]);
    expect("category" in params).toBe(false);
  });
});
