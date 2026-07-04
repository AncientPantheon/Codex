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
  type Tag,
} from "../src/upload/tags.js";
import { InvalidUploadParamsError } from "../src/upload/errors.js";

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

describe("buildUploadTags — app metadata pass-through and ordering (room for metadata)", () => {
  it("appends metadata AFTER the four required tags in caller order", () => {
    const tags = buildUploadTags(
      params({
        appMetadata: [
          { name: "Title", value: "Alpha" },
          { name: "Kind", value: "photo" },
        ],
      }),
    );
    expect(tags).toHaveLength(6);
    expect(tags.slice(4)).toEqual([
      { name: "Title", value: "Alpha" },
      { name: "Kind", value: "photo" },
    ]);
  });

  it("returns exactly the four required tags when no metadata is given", () => {
    expect(buildUploadTags(params())).toHaveLength(4);
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
    // 4 required + 125 metadata = 129 > 128.
    const meta = Array.from({ length: 125 }, (_, i) => ({
      name: `m${i}`,
      value: `v${i}`,
    }));
    expect(() => buildUploadTags(params({ appMetadata: meta }))).toThrow(
      InvalidUploadParamsError,
    );
  });

  it("accepts exactly 128 total tags (4 required + 124 metadata)", () => {
    const meta = Array.from({ length: 124 }, (_, i) => ({
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
