/**
 * Upload tag-schema module — the ONE canonical source of the tag contract.
 *
 * Every upload carries a REQUIRED tag schema so the rebuild-from-chain path works:
 *   App-Name       — the pinned application tag (default `DEFAULT_APP_NAME`)
 *   Content-Type   — the item's MIME type
 *   Codex-Item-Id  — the uuid the caller assigns
 *   Codex-Owner    — the uploader's canonical 43-char address (verbatim)
 * plus any app metadata (title, kind, version, ...) appended AFTER the required
 * four, in caller order — the "room for app metadata" the spec requires.
 *
 * The tag NAMES are exact strings: GraphQL tag matching is exact-string, so upload
 * and rebuild MUST share one spelling — hence one module owns the constants and
 * both consumers import them.
 *
 * PURITY: this module is pure. No I/O, no crypto, no imports from other src
 * modules. The owner address is passed IN (the `addressOf` derivation lives in the
 * upload orchestrator, which forwards the derived value here) — keeping tag logic
 * testable without crypto and forcing exactly one derivation site upstream.
 */

import { isCanonicalAddress } from "../canonical.js";
import { InvalidUploadParamsError } from "./errors.js";

/** The arbundles / Turbo `dataItemOpts.tags` element shape. */
export interface Tag {
  name: string;
  value: string;
}

/** App-Name tag key — the application identifier the rebuild filter keys on. */
export const TAG_APP_NAME = "App-Name";
/** Content-Type tag key — the item's MIME type. */
export const TAG_CONTENT_TYPE = "Content-Type";
/** Codex-Item-Id tag key — the caller-assigned uuid. */
export const TAG_CODEX_ITEM_ID = "Codex-Item-Id";
/** Codex-Owner tag key — the uploader's canonical 43-char address. */
export const TAG_CODEX_OWNER = "Codex-Owner";

/**
 * The four required tag names, in the schema's canonical order. A metadata entry
 * may not reuse any of these names (a forged duplicate would corrupt the rebuild
 * source of truth).
 */
export const REQUIRED_UPLOAD_TAG_NAMES = [
  TAG_APP_NAME,
  TAG_CONTENT_TYPE,
  TAG_CODEX_ITEM_ID,
  TAG_CODEX_OWNER,
] as const;

/**
 * The pinned default App-Name value — the ONE place the app-name literal lives.
 * Upload and rebuild both take this as their App-Name default so the filter pair
 * stays coherent; overridable per call.
 */
export const DEFAULT_APP_NAME = "AncientPantheon-Codex";

/** ANS-104 bounds. Byte lengths are measured as UTF-8, never as UTF-16 units. */
const MAX_TAG_COUNT = 128;
const MAX_TAG_NAME_BYTES = 1024;
const MAX_TAG_VALUE_BYTES = 3072;

const RESERVED_NAMES: ReadonlySet<string> = new Set(REQUIRED_UPLOAD_TAG_NAMES);

/** UTF-8 byte length. `TextEncoder` is runtime-global in Node >=18 and browsers;
 *  `String.prototype.length` counts UTF-16 code units and under-counts multibyte
 *  content, and `Buffer` is Node-only — both are forbidden here. */
function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** Parameters for {@link buildUploadTags}. */
export interface BuildUploadTagsParams {
  /** The uploader's canonical 43-char address — becomes Codex-Owner verbatim. */
  ownerAddress: string;
  /** The item's MIME type — becomes Content-Type. */
  contentType: string;
  /** The caller-assigned uuid — becomes Codex-Item-Id. */
  itemId: string;
  /** Optional App-Name override; when omitted, defaults to `DEFAULT_APP_NAME`.
   *  When EXPLICITLY provided it must be a non-empty string — `?? DEFAULT_APP_NAME`
   *  does not catch `""`, and an empty App-Name ships an upload invisible to the
   *  rebuild filter, so it gets the same rigor as ownerAddress. */
  appName?: string;
  /** Optional app metadata tags, appended after the required four in this order. */
  appMetadata?: readonly Tag[];
}

/**
 * Build the ANS-104 tag list for an upload: the four required tags first, then app
 * metadata in caller order. Pure and synchronous. Validates every input BEFORE
 * emitting; throws {@link InvalidUploadParamsError} (structured field + reason) for
 * any violation so a malformed tag never reaches the SDK as an opaque error.
 */
export function buildUploadTags(params: BuildUploadTagsParams): Tag[] {
  const { ownerAddress, contentType, itemId, appName, appMetadata } = params;

  if (typeof ownerAddress !== "string" || !isCanonicalAddress(ownerAddress)) {
    throw new InvalidUploadParamsError(
      "ownerAddress",
      "invalid-address",
      "ownerAddress must be 43 base64url characters ([A-Za-z0-9_-]).",
    );
  }

  // An EXPLICIT appName must be a non-empty string; omitting it uses the default.
  if (appName !== undefined && !isNonEmptyString(appName)) {
    throw new InvalidUploadParamsError(
      "appName",
      "empty-or-non-string",
      "appName, when provided, must be a non-empty string.",
    );
  }

  if (!isNonEmptyString(contentType)) {
    throw new InvalidUploadParamsError(
      "contentType",
      "empty-or-non-string",
      "contentType must be a non-empty string.",
    );
  }

  if (!isNonEmptyString(itemId)) {
    throw new InvalidUploadParamsError(
      "itemId",
      "empty-or-non-string",
      "itemId must be a non-empty string.",
    );
  }

  const metadata = appMetadata ?? [];
  metadata.forEach((entry, i) => {
    if (!isNonEmptyString(entry.name)) {
      throw new InvalidUploadParamsError(
        `appMetadata[${i}].name`,
        "empty-or-non-string",
        "metadata tag name must be a non-empty string.",
      );
    }
    if (!isNonEmptyString(entry.value)) {
      throw new InvalidUploadParamsError(
        `appMetadata[${i}].value`,
        "empty-or-non-string",
        "metadata tag value must be a non-empty string.",
      );
    }
    if (RESERVED_NAMES.has(entry.name)) {
      throw new InvalidUploadParamsError(
        `appMetadata[${i}].name`,
        "reserved-name",
        `metadata may not reuse the reserved tag name "${entry.name}".`,
      );
    }
  });

  const tags: Tag[] = [
    { name: TAG_APP_NAME, value: appName ?? DEFAULT_APP_NAME },
    { name: TAG_CONTENT_TYPE, value: contentType },
    { name: TAG_CODEX_ITEM_ID, value: itemId },
    { name: TAG_CODEX_OWNER, value: ownerAddress },
    ...metadata.map((t) => ({ name: t.name, value: t.value })),
  ];

  if (tags.length > MAX_TAG_COUNT) {
    throw new InvalidUploadParamsError(
      "appMetadata",
      "too-many-tags",
      `total tags (${tags.length}) exceed the ANS-104 limit of ${MAX_TAG_COUNT}.`,
    );
  }

  tags.forEach((tag, i) => {
    if (utf8ByteLength(tag.name) > MAX_TAG_NAME_BYTES) {
      throw new InvalidUploadParamsError(
        `tags[${i}].name`,
        "name-too-long",
        `tag name exceeds ${MAX_TAG_NAME_BYTES} UTF-8 bytes.`,
      );
    }
    if (utf8ByteLength(tag.value) > MAX_TAG_VALUE_BYTES) {
      throw new InvalidUploadParamsError(
        `tags[${i}].value`,
        "value-too-long",
        `tag value exceeds ${MAX_TAG_VALUE_BYTES} UTF-8 bytes.`,
      );
    }
  });

  return tags;
}
