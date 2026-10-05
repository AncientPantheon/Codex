/**
 * upload-tags.test.ts — the pure upload tag-schema module.
 *
 * `buildUploadTags({ ownerAddress, contentType, itemId, appName?, appMetadata? })`
 * builds the ANS-104 tag list every upload carries: the four REQUIRED tags first
 * (App-Name, Content-Type, Codex-Item-Id, Codex-Owner — exact casing, GraphQL
 * matches exact strings), then caller metadata in order. It is PURE — no I/O, no
 * crypto, no imports from other src modules — and validates its inputs against the
 * canonical address form, the ANS-104 empty/reserved/bounds rules, and (critically)
 * UTF-8 BYTE bounds measured via TextEncoder, never String.length.
 *
 * These are the RED tests: they fail until tags.ts + errors.ts exist.
 */

import { describe, it, expect } from "vitest";
import {
  buildUploadTags,
  DEFAULT_APP_NAME,
  REQUIRED_UPLOAD_TAG_NAMES,
  TAG_APP_NAME,
  TAG_CONTENT_TYPE,
  TAG_CODEX_ITEM_ID,
  TAG_CODEX_OWNER,
  TAG_CODEX_TAG_SCHEMA_VERSION,
  CODEX_TAG_SCHEMA_VERSION_CURRENT,
  TAG_CODEX_UPLOAD_ID,
  TAG_CODEX_ITEM_TYPE,
  TAG_CODEX_CATEGORY,
  TAG_CODEX_ASSET_TYPE,
  TAG_CODEX_APP_ID,
  TAG_CODEX_APP_VERSION,
  TAG_CODEX_ENCRYPTED,
  TAG_CODEX_ENCRYPTOR,
  TAG_CODEX_ENCRYPTION_VERSION,
  CODEX_ENCRYPTION_VERSION_CURRENT,
  UPLOAD_CATEGORIES,
  NFT_ASSET_TYPES,
  type Tag,
} from "../src/upload/tags.js";
import { InvalidUploadParamsError } from "../src/upload/errors.js";

/** Standard UUID v4 shape — what `globalThis.crypto.randomUUID()` produces. */
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A canonical 43-char base64url address (fixture-independent shape gate). */
const OWNER = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO_-".slice(0, 43);

/** Minimal valid params factory so each test overrides only what it exercises. */
function params(overrides: Partial<Parameters<typeof buildUploadTags>[0]> = {}) {
  return {
    ownerAddress: OWNER,
    contentType: "text/plain",
    itemId: "item-123",
    ...overrides,
  };
}

describe("tag-name constants — the one canonical spelling upload+rebuild share", () => {
  it("pins the four required names to their exact GraphQL-matched casing", () => {
    // A drift here silently breaks the rebuild filter — exact strings are load-bearing.
    expect(TAG_APP_NAME).toBe("App-Name");
    expect(TAG_CONTENT_TYPE).toBe("Content-Type");
    expect(TAG_CODEX_ITEM_ID).toBe("Codex-Item-Id");
    expect(TAG_CODEX_OWNER).toBe("Codex-Owner");
  });

  it("pins DEFAULT_APP_NAME to the app literal (the single source T4.3/T4.4 import)", () => {
    expect(DEFAULT_APP_NAME).toBe("AncientPantheon-Codex");
  });

  it("exposes the required names as a tuple mirroring the constants", () => {
    expect(REQUIRED_UPLOAD_TAG_NAMES).toEqual([
      "App-Name",
      "Content-Type",
      "Codex-Item-Id",
      "Codex-Owner",
    ]);
  });

  it("pins the three T2 schema-versioning/grouping tag names to their exact casing", () => {
    // Same load-bearing rationale as the four above: GraphQL matching is exact-string.
    expect(TAG_CODEX_TAG_SCHEMA_VERSION).toBe("Codex-Tag-Schema-Version");
    expect(TAG_CODEX_UPLOAD_ID).toBe("Codex-Upload-Id");
    expect(TAG_CODEX_ITEM_TYPE).toBe("Codex-Item-Type");
  });

  it("pins CODEX_TAG_SCHEMA_VERSION_CURRENT to the current schema version", () => {
    expect(CODEX_TAG_SCHEMA_VERSION_CURRENT).toBe("1");
  });
});

describe("buildUploadTags — required tags present, correct values, required-first order", () => {
  it("emits the four required tags FIRST with the exact schema values", () => {
    const tags = buildUploadTags(params());
    expect(tags.slice(0, 4)).toEqual<Tag[]>([
      { name: "App-Name", value: DEFAULT_APP_NAME },
      { name: "Content-Type", value: "text/plain" },
      { name: "Codex-Item-Id", value: "item-123" },
      { name: "Codex-Owner", value: OWNER },
    ]);
  });

  it("uses an explicit appName over the default when provided", () => {
    const tags = buildUploadTags(params({ appName: "My-App" }));
    expect(tags[0]).toEqual({ name: "App-Name", value: "My-App" });
  });

  it("carries the ownerAddress VERBATIM as Codex-Owner (no normalization)", () => {
    const tags = buildUploadTags(params());
    const owner = tags.find((t) => t.name === "Codex-Owner");
    expect(owner?.value).toBe(OWNER);
  });
});

describe("buildUploadTags — T2 schema-versioning/upload-grouping/item-type tags", () => {
  it("emits Codex-Tag-Schema-Version, Codex-Upload-Id, Codex-Item-Type right after the required four, with generated defaults when omitted", () => {
    const tags = buildUploadTags(params());
    expect(tags).toHaveLength(7);
    expect(tags[4]).toEqual({
      name: "Codex-Tag-Schema-Version",
      value: CODEX_TAG_SCHEMA_VERSION_CURRENT,
    });
    expect(tags[5].name).toBe("Codex-Upload-Id");
    expect(tags[5].value).toMatch(UUID_V4_RE);
    expect(tags[6]).toEqual({ name: "Codex-Item-Type", value: "file" });
  });

  it("uses a caller-supplied uploadId and itemType verbatim instead of generating them", () => {
    const tags = buildUploadTags(params({ uploadId: "u1", itemType: "manifest" }));
    expect(tags.slice(4, 7)).toEqual([
      { name: "Codex-Tag-Schema-Version", value: CODEX_TAG_SCHEMA_VERSION_CURRENT },
      { name: "Codex-Upload-Id", value: "u1" },
      { name: "Codex-Item-Type", value: "manifest" },
    ]);
  });

  it("generates a different uploadId per call when omitted (never reused across items)", () => {
    const a = buildUploadTags(params());
    const b = buildUploadTags(params());
    const idOf = (tags: Tag[]) => tags.find((t) => t.name === "Codex-Upload-Id")?.value;
    expect(idOf(a)).not.toBe(idOf(b));
  });

  it("rejects an itemType outside the file|manifest enum", () => {
    expect(() =>
      buildUploadTags(params({ itemType: "bogus" as unknown as "file" })),
    ).toThrow(InvalidUploadParamsError);
  });

  it("rejects an explicit empty-string uploadId (same rigor as ownerAddress/contentType)", () => {
    expect(() => buildUploadTags(params({ uploadId: "" }))).toThrow(
      InvalidUploadParamsError,
    );
  });

  it("rejects a non-string uploadId", () => {
    expect(() =>
      buildUploadTags(params({ uploadId: 5 as unknown as string })),
    ).toThrow(InvalidUploadParamsError);
  });

  it.each(["Codex-Tag-Schema-Version", "Codex-Upload-Id", "Codex-Item-Type"])(
    "rejects a metadata entry that duplicates the new reserved name %s",
    (reserved) => {
      expect(() =>
        buildUploadTags(params({ appMetadata: [{ name: reserved, value: "forged" }] })),
      ).toThrow(InvalidUploadParamsError);
    },
  );
});

describe("buildUploadTags — app metadata pass-through and ordering (room for metadata)", () => {
  it("appends metadata AFTER the seven required/schema tags in caller order", () => {
    const tags = buildUploadTags(
      params({
        appMetadata: [
          { name: "Title", value: "Alpha" },
          { name: "Kind", value: "photo" },
        ],
      }),
    );
    expect(tags).toHaveLength(9);
    expect(tags.slice(7)).toEqual([
      { name: "Title", value: "Alpha" },
      { name: "Kind", value: "photo" },
    ]);
  });

  it("returns exactly the seven required/schema tags when no metadata is given", () => {
    expect(buildUploadTags(params())).toHaveLength(7);
  });
});

describe("buildUploadTags — ownerAddress validation (the load-bearing rebuild key)", () => {
  it.each([
    ["42-char (too short)", "a".repeat(42)],
    ["44-char (too long)", "a".repeat(44)],
    ["+-containing (non-base64url)", "+".padEnd(43, "a")],
  ])("rejects a %s ownerAddress with InvalidUploadParamsError", (_label, bad) => {
    expect(() => buildUploadTags(params({ ownerAddress: bad }))).toThrow(
      InvalidUploadParamsError,
    );
  });

  it("accepts a valid canonical 43-char address", () => {
    expect(() => buildUploadTags(params({ ownerAddress: OWNER }))).not.toThrow();
  });

  it("names the offending field in the structured error (no message parsing)", () => {
    try {
      buildUploadTags(params({ ownerAddress: "short" }));
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidUploadParamsError);
      expect((err as InvalidUploadParamsError).field).toBe("ownerAddress");
      expect((err as InvalidUploadParamsError).reason).toBeTruthy();
    }
  });
});

describe("buildUploadTags — explicit appName rigor (the ?? default does NOT catch '')", () => {
  it("rejects an explicit empty-string appName (would ship an unfindable upload)", () => {
    expect(() => buildUploadTags(params({ appName: "" }))).toThrow(
      InvalidUploadParamsError,
    );
  });

  it("rejects a non-string appName", () => {
    expect(() =>
      buildUploadTags(params({ appName: 123 as unknown as string })),
    ).toThrow(InvalidUploadParamsError);
  });

  it("does NOT reject an omitted appName (falls back to the default)", () => {
    expect(() => buildUploadTags(params({ appName: undefined }))).not.toThrow();
  });
});

describe("buildUploadTags — contentType / itemId validation", () => {
  it("rejects an empty contentType", () => {
    expect(() => buildUploadTags(params({ contentType: "" }))).toThrow(
      InvalidUploadParamsError,
    );
  });

  it("rejects a non-string itemId", () => {
    expect(() =>
      buildUploadTags(params({ itemId: null as unknown as string })),
    ).toThrow(InvalidUploadParamsError);
  });

  it("rejects an empty itemId", () => {
    expect(() => buildUploadTags(params({ itemId: "" }))).toThrow(
      InvalidUploadParamsError,
    );
  });
});

describe("buildUploadTags — app metadata entry validation", () => {
  it("rejects a metadata entry with an empty name", () => {
    expect(() =>
      buildUploadTags(params({ appMetadata: [{ name: "", value: "x" }] })),
    ).toThrow(InvalidUploadParamsError);
  });

  it("rejects a metadata entry with an empty VALUE (ANS-104 forbids empty values)", () => {
    expect(() =>
      buildUploadTags(params({ appMetadata: [{ name: "Title", value: "" }] })),
    ).toThrow(InvalidUploadParamsError);
  });

  it("rejects a metadata entry with a non-string value", () => {
    expect(() =>
      buildUploadTags(
        params({
          appMetadata: [
            { name: "Title", value: 5 as unknown as string },
          ],
        }),
      ),
    ).toThrow(InvalidUploadParamsError);
  });

  it.each(REQUIRED_UPLOAD_TAG_NAMES)(
    "rejects a metadata entry that duplicates the reserved name %s",
    (reserved) => {
      expect(() =>
        buildUploadTags(
          params({ appMetadata: [{ name: reserved, value: "forged" }] }),
        ),
      ).toThrow(InvalidUploadParamsError);
    },
  );
});

describe("buildUploadTags — ANS-104 bounds (measured as UTF-8 bytes, never String.length)", () => {
  it("rejects when total tags (required + metadata) exceed 128", () => {
    // 7 required/schema + 122 metadata = 129 > 128.
    const meta = Array.from({ length: 122 }, (_, i) => ({
      name: `m${i}`,
      value: `v${i}`,
    }));
    expect(() => buildUploadTags(params({ appMetadata: meta }))).toThrow(
      InvalidUploadParamsError,
    );
  });

  it("accepts exactly 128 total tags (7 required/schema + 121 metadata)", () => {
    const meta = Array.from({ length: 121 }, (_, i) => ({
      name: `m${i}`,
      value: `v${i}`,
    }));
    expect(() => buildUploadTags(params({ appMetadata: meta }))).not.toThrow();
  });

  it("rejects a tag name longer than 1024 UTF-8 bytes", () => {
    expect(() =>
      buildUploadTags(
        params({ appMetadata: [{ name: "a".repeat(1025), value: "x" }] }),
      ),
    ).toThrow(InvalidUploadParamsError);
  });

  it("rejects a tag value longer than 3072 UTF-8 bytes (ASCII)", () => {
    expect(() =>
      buildUploadTags(
        params({ appMetadata: [{ name: "big", value: "a".repeat(3073) }] }),
      ),
    ).toThrow(InvalidUploadParamsError);
  });

  it("rejects a multibyte value whose .length is under 3072 but UTF-8 bytes exceed 3072", () => {
    // 1600 two-byte (é = 2 UTF-8 bytes) chars => .length 1600 (< 3072) but 3200 bytes (> 3072).
    // A naive String.length implementation would WRONGLY accept this.
    const value = "é".repeat(1600);
    expect(value.length).toBeLessThan(3072);
    expect(new TextEncoder().encode(value).length).toBeGreaterThan(3072);
    expect(() =>
      buildUploadTags(params({ appMetadata: [{ name: "m", value }] })),
    ).toThrow(InvalidUploadParamsError);
  });

  it("accepts a multibyte value whose UTF-8 byte length is within 3072", () => {
    // 1500 two-byte chars => 3000 bytes (< 3072) — must be accepted.
    const value = "é".repeat(1500);
    expect(new TextEncoder().encode(value).length).toBeLessThanOrEqual(3072);
    expect(() =>
      buildUploadTags(params({ appMetadata: [{ name: "m", value }] })),
    ).not.toThrow();
  });
});

describe("category/asset-type/app-lineage tag-name constants and enums (T1)", () => {
  it("pins the four new tag names to their exact casing", () => {
    // GraphQL matching is exact-string, same rationale as every other tag constant.
    expect(TAG_CODEX_CATEGORY).toBe("Codex-Category");
    expect(TAG_CODEX_ASSET_TYPE).toBe("Codex-Asset-Type");
    expect(TAG_CODEX_APP_ID).toBe("Codex-App-Id");
    expect(TAG_CODEX_APP_VERSION).toBe("Codex-App-Version");
  });

  it("exposes exactly the 26 UPLOAD_CATEGORIES values in the design doc's grouped order", () => {
    expect(UPLOAD_CATEGORIES).toEqual([
      "personal-photos",
      "personal-videos",
      "personal-audio",
      "journals-writing",
      "personal-documents",
      "medical-records",
      "financial-records",
      "legal-records",
      "certificates-credentials",
      "creative-work",
      "nft-data",
      "software-code",
      "website-dapp-hosting",
      "research-data",
      "publications-books",
      "public-statement",
      "proof-timestamping",
      "memorial-legacy",
      "historical-archive",
      "genealogy-family-history",
      "correspondence-archive",
      "gaming-virtual-assets",
      "event-records",
      "codex-backup",
      "foreign",
      "general-other",
    ]);
  });

  it("exposes exactly the 7 NFT_ASSET_TYPES values", () => {
    expect(NFT_ASSET_TYPES).toEqual([
      "image",
      "audio",
      "video",
      "document",
      "archive",
      "model",
      "exotic",
    ]);
  });
});

describe("buildUploadTags — category/assetType/appId/appVersion (T1, all optional at this layer)", () => {
  it("no regression: without any of the four new fields, still returns exactly the same 7-tag array as before", () => {
    const tags = buildUploadTags(params());
    expect(tags).toHaveLength(7);
    expect(tags.map((t) => t.name)).toEqual([
      "App-Name",
      "Content-Type",
      "Codex-Item-Id",
      "Codex-Owner",
      "Codex-Tag-Schema-Version",
      "Codex-Upload-Id",
      "Codex-Item-Type",
    ]);
  });

  it("appends Codex-Category and Codex-Asset-Type, in that order, right after the existing seven", () => {
    const tags = buildUploadTags(params({ category: "nft-data", assetType: "video" }));
    expect(tags).toHaveLength(9);
    expect(tags.slice(7)).toEqual([
      { name: "Codex-Category", value: "nft-data" },
      { name: "Codex-Asset-Type", value: "video" },
    ]);
  });

  it("appends Codex-App-Id and Codex-App-Version after category/assetType and before appMetadata", () => {
    const tags = buildUploadTags(
      params({
        category: "software-code",
        appId: "my-app",
        appVersion: "1.0.0",
        appMetadata: [{ name: "Title", value: "Alpha" }],
      }),
    );
    expect(tags.slice(7)).toEqual([
      { name: "Codex-Category", value: "software-code" },
      { name: "Codex-App-Id", value: "my-app" },
      { name: "Codex-App-Version", value: "1.0.0" },
      { name: "Title", value: "Alpha" },
    ]);
  });

  it("emits only the fields actually provided — no empty-string placeholders for omitted ones", () => {
    const tags = buildUploadTags(params({ appId: "my-app" }));
    expect(tags).toHaveLength(8);
    expect(tags[7]).toEqual({ name: "Codex-App-Id", value: "my-app" });
  });

  it("rejects a category outside the UPLOAD_CATEGORIES enum", () => {
    expect(() =>
      buildUploadTags(params({ category: "not-a-real-category" as never })),
    ).toThrow(InvalidUploadParamsError);
  });

  it("rejects assetType provided without category === nft-data (category omitted)", () => {
    expect(() => buildUploadTags(params({ assetType: "video" }))).toThrow(
      InvalidUploadParamsError,
    );
  });

  it("rejects assetType provided when category is set to something other than nft-data", () => {
    expect(() =>
      buildUploadTags(params({ category: "creative-work", assetType: "video" })),
    ).toThrow(InvalidUploadParamsError);
  });

  it("rejects category === nft-data without assetType", () => {
    expect(() => buildUploadTags(params({ category: "nft-data" }))).toThrow(
      InvalidUploadParamsError,
    );
  });

  it("rejects an assetType outside the NFT_ASSET_TYPES enum, even with category nft-data", () => {
    expect(() =>
      buildUploadTags(params({ category: "nft-data", assetType: "bogus" as never })),
    ).toThrow(InvalidUploadParamsError);
  });

  it("appId round-trips verbatim when provided", () => {
    const tags = buildUploadTags(params({ appId: "app-42" }));
    expect(tags.find((t) => t.name === "Codex-App-Id")?.value).toBe("app-42");
  });

  it("appVersion round-trips verbatim when provided", () => {
    const tags = buildUploadTags(params({ appVersion: "2.3.1" }));
    expect(tags.find((t) => t.name === "Codex-App-Version")?.value).toBe("2.3.1");
  });

  it("accepts appId without appVersion, and appVersion without appId (no cross-field rule)", () => {
    expect(() => buildUploadTags(params({ appId: "app-only" }))).not.toThrow();
    expect(() => buildUploadTags(params({ appVersion: "version-only" }))).not.toThrow();
  });

  it("rejects an explicit empty-string appId", () => {
    expect(() => buildUploadTags(params({ appId: "" }))).toThrow(InvalidUploadParamsError);
  });

  it("rejects an explicit empty-string appVersion", () => {
    expect(() => buildUploadTags(params({ appVersion: "" }))).toThrow(
      InvalidUploadParamsError,
    );
  });

  it.each(["Codex-Category", "Codex-Asset-Type", "Codex-App-Id", "Codex-App-Version"])(
    "rejects a metadata entry that duplicates the new reserved name %s",
    (reserved) => {
      expect(() =>
        buildUploadTags(params({ appMetadata: [{ name: reserved, value: "forged" }] })),
      ).toThrow(InvalidUploadParamsError);
    },
  );
});

describe("buildUploadTags — encrypted/encryptorAddress (T2, arweave-upload-encryption)", () => {
  it("pins the two new tag names to their exact casing", () => {
    // GraphQL matching is exact-string, same rationale as every other tag constant.
    expect(TAG_CODEX_ENCRYPTED).toBe("Codex-Encrypted");
    expect(TAG_CODEX_ENCRYPTOR).toBe("Codex-Encryptor");
  });

  it("no regression: without encrypted/encryptorAddress, still returns exactly the same 7-tag array as before", () => {
    const tags = buildUploadTags(params());
    expect(tags).toHaveLength(7);
    expect(tags.map((t) => t.name)).toEqual([
      "App-Name",
      "Content-Type",
      "Codex-Item-Id",
      "Codex-Owner",
      "Codex-Tag-Schema-Version",
      "Codex-Upload-Id",
      "Codex-Item-Type",
    ]);
  });

  it("emits Codex-Encrypted: true and Codex-Encryptor when encrypted is true with a valid address", () => {
    const tags = buildUploadTags(
      params({
        encrypted: true,
        encryptorAddress: OWNER,
        encryptionVersion: CODEX_ENCRYPTION_VERSION_CURRENT,
      }),
    );
    expect(tags).toHaveLength(10);
    expect(tags.slice(7)).toEqual([
      { name: "Codex-Encrypted", value: "true" },
      { name: "Codex-Encryptor", value: OWNER },
      { name: "Codex-Encryption-Version", value: CODEX_ENCRYPTION_VERSION_CURRENT },
    ]);
  });

  it("appends Codex-Encrypted/Codex-Encryptor/Codex-Encryption-Version right after category/asset-type/app-lineage tags and before appMetadata", () => {
    const tags = buildUploadTags(
      params({
        category: "nft-data",
        assetType: "video",
        encrypted: true,
        encryptorAddress: OWNER,
        encryptionVersion: CODEX_ENCRYPTION_VERSION_CURRENT,
        appMetadata: [{ name: "Title", value: "Alpha" }],
      }),
    );
    expect(tags.slice(7)).toEqual([
      { name: "Codex-Category", value: "nft-data" },
      { name: "Codex-Asset-Type", value: "video" },
      { name: "Codex-Encrypted", value: "true" },
      { name: "Codex-Encryptor", value: OWNER },
      { name: "Codex-Encryption-Version", value: CODEX_ENCRYPTION_VERSION_CURRENT },
      { name: "Title", value: "Alpha" },
    ]);
  });

  it("emits Codex-Encrypted: false with no Codex-Encryptor when encrypted is false alone", () => {
    const tags = buildUploadTags(params({ encrypted: false }));
    expect(tags).toHaveLength(8);
    expect(tags[7]).toEqual({ name: "Codex-Encrypted", value: "false" });
    expect(tags.find((t) => t.name === "Codex-Encryptor")).toBeUndefined();
  });

  it("rejects encrypted: true without an encryptorAddress", () => {
    expect(() => buildUploadTags(params({ encrypted: true }))).toThrow(
      InvalidUploadParamsError,
    );
  });

  it("rejects an encryptorAddress provided without encrypted === true (encrypted omitted)", () => {
    expect(() => buildUploadTags(params({ encryptorAddress: OWNER }))).toThrow(
      InvalidUploadParamsError,
    );
  });

  it("rejects an encryptorAddress provided when encrypted is set to false", () => {
    expect(() =>
      buildUploadTags(params({ encrypted: false, encryptorAddress: OWNER })),
    ).toThrow(InvalidUploadParamsError);
  });

  it("accepts a non-Arweave-canonical encryptorAddress — the encrypting account is an Ouronet account, a different address format entirely, and this pure tag-builder must not assume a specific foreign-chain shape", () => {
    // "too-short" deliberately does NOT look like a 43-char Arweave address —
    // proving this field is validated only as a non-empty string, never as
    // isCanonicalAddress (that check is reserved for genuine Arweave
    // addresses like `ownerAddress`/`Codex-Owner`).
    const tags = buildUploadTags(
      params({
        encrypted: true,
        encryptorAddress: "too-short",
        encryptionVersion: CODEX_ENCRYPTION_VERSION_CURRENT,
      }),
    );
    expect(tags.find((t) => t.name === TAG_CODEX_ENCRYPTOR)?.value).toBe("too-short");
  });

  it("rejects encrypted: true with an empty-string encryptorAddress", () => {
    expect(() =>
      buildUploadTags(params({ encrypted: true, encryptorAddress: "" })),
    ).toThrow(InvalidUploadParamsError);
  });

  it.each(["Codex-Encrypted", "Codex-Encryptor"])(
    "rejects a metadata entry that duplicates the new reserved name %s",
    (reserved) => {
      expect(() =>
        buildUploadTags(params({ appMetadata: [{ name: reserved, value: "forged" }] })),
      ).toThrow(InvalidUploadParamsError);
    },
  );
});

describe("buildUploadTags — encryptionVersion (T1, arweave-tag-schema-spec)", () => {
  it("pins the new tag name and the current pinned version value", () => {
    // GraphQL matching is exact-string, same rationale as every other tag constant.
    expect(TAG_CODEX_ENCRYPTION_VERSION).toBe("Codex-Encryption-Version");
    expect(CODEX_ENCRYPTION_VERSION_CURRENT).toBe("2");
  });

  it("emits Codex-Encryption-Version immediately after Codex-Encryptor when encrypted is true", () => {
    const tags = buildUploadTags(
      params({
        encrypted: true,
        encryptorAddress: OWNER,
        encryptionVersion: CODEX_ENCRYPTION_VERSION_CURRENT,
      }),
    );
    expect(tags).toHaveLength(10);
    expect(tags.slice(7)).toEqual([
      { name: "Codex-Encrypted", value: "true" },
      { name: "Codex-Encryptor", value: OWNER },
      { name: "Codex-Encryption-Version", value: CODEX_ENCRYPTION_VERSION_CURRENT },
    ]);
  });

  it("rejects encrypted: true without an encryptionVersion, even with a valid encryptorAddress — the permanent-data risk this field exists to close", () => {
    expect(() =>
      buildUploadTags(params({ encrypted: true, encryptorAddress: OWNER })),
    ).toThrow(InvalidUploadParamsError);
  });

  it("names the offending field in the structured error for the missing-encryptionVersion case", () => {
    try {
      buildUploadTags(params({ encrypted: true, encryptorAddress: OWNER }));
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidUploadParamsError);
      expect((err as InvalidUploadParamsError).field).toBe("encryptionVersion");
      expect((err as InvalidUploadParamsError).reason).toBeTruthy();
    }
  });

  it("rejects an encryptionVersion provided without encrypted === true (encrypted omitted)", () => {
    expect(() =>
      buildUploadTags(params({ encryptionVersion: CODEX_ENCRYPTION_VERSION_CURRENT })),
    ).toThrow(InvalidUploadParamsError);
  });

  it("rejects an encryptionVersion provided when encrypted is set to false", () => {
    expect(() =>
      buildUploadTags(
        params({ encrypted: false, encryptionVersion: CODEX_ENCRYPTION_VERSION_CURRENT }),
      ),
    ).toThrow(InvalidUploadParamsError);
  });

  it("rejects a metadata entry that duplicates the new reserved name Codex-Encryption-Version", () => {
    expect(() =>
      buildUploadTags(
        params({ appMetadata: [{ name: "Codex-Encryption-Version", value: "forged" }] }),
      ),
    ).toThrow(InvalidUploadParamsError);
  });
});
