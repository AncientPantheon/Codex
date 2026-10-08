/**
 * Upload tag-schema module — the ONE canonical source of the tag contract.
 *
 * Every upload carries a REQUIRED tag schema so the rebuild-from-chain path works:
 *   App-Name                  — the pinned application tag (default `DEFAULT_APP_NAME`)
 *   Content-Type               — the item's MIME type
 *   Codex-Item-Id              — the uuid the caller assigns
 *   Codex-Owner                — the uploader's canonical 43-char address (verbatim)
 *   Codex-Tag-Schema-Version   — the tag schema version (always `CODEX_TAG_SCHEMA_VERSION_CURRENT`, never caller-supplied)
 *   Codex-Upload-Id            — groups N files + a manifest from one upload action
 *   Codex-Item-Type            — `"file"` | `"manifest"`
 * plus any app metadata (title, kind, version, ...) appended AFTER those seven, in
 * caller order — the "room for app metadata" the spec requires.
 *
 * The tag NAMES are exact strings: GraphQL tag matching is exact-string, so upload
 * and rebuild MUST share one spelling — hence one module owns the constants and
 * both consumers import them.
 *
 * `uploadId`/`itemType` are OPTIONAL on `BuildUploadTagsParams`, deliberately: every
 * existing call site (e.g. `upload.ts`) keeps compiling and behaving identically
 * without passing them. Omitting `uploadId` generates one via
 * `globalThis.crypto.randomUUID()`, mirroring `upload.ts`'s own `itemId` default
 * pattern; omitting `itemType` defaults to `"file"`.
 *
 * `category`/`assetType`/`appId`/`appVersion` (T1 of the `arweave-upload-categories`
 * topic) are likewise OPTIONAL at THIS layer, validated only when present — an
 * omitted `category` emits no `Codex-Category` tag at all. Real mandatory-category
 * enforcement is a caller's job one layer up (the orchestration functions that
 * actually call this with real values), never this pure tag-builder's. When
 * present, `category` must be one of `UPLOAD_CATEGORIES`; `assetType` is present if
 * and only if `category === "nft-data"` (a two-way implication) and must be one of
 * `NFT_ASSET_TYPES`; `appId`/`appVersion` are independent non-empty-string checks
 * with no cross-field rule between them.
 *
 * `encrypted`/`encryptorAddress` (T2 of the `arweave-upload-encryption` topic) are
 * likewise OPTIONAL at THIS layer, mirroring `category`/`assetType`'s two-way
 * implication: `encryptorAddress` is present if and only if `encrypted === true`,
 * and when `encrypted === true` the address must be a valid canonical 43-char
 * Arweave address (via `isCanonicalAddress`, same as `ownerAddress`). UNLIKE
 * `category`, once `encrypted` is EXPLICITLY provided (`true` or `false`) it is
 * ALWAYS emitted as the literal string `"true"`/`"false"` — never omitted for a
 * `false` value — so "was this encrypted" is never ambiguous on a real upload;
 * omitting `encrypted` entirely still emits no tag at all, for backward
 * compatibility with every existing caller.
 *
 * `encryptionVersion` (T1 of the `arweave-tag-schema-spec` topic) mirrors
 * `encryptorAddress`'s own two-way implication: present if and only if
 * `encrypted === true`. UNLIKE `appId`/`appVersion` (and unlike nothing else on this
 * module), it is NEVER optional once `encrypted === true` — an encrypted upload with
 * no stamped encryption-procedure version is exactly the permanent-data risk this
 * field exists to close, since Arweave data can never be retroactively re-tagged.
 * Callers always pass the pinned `CODEX_ENCRYPTION_VERSION_CURRENT`, never a
 * free-form value, mirroring `CODEX_TAG_SCHEMA_VERSION_CURRENT`'s own pattern.
 * Emitted as `Codex-Encryption-Version`, immediately after `Codex-Encryptor`.
 *
 * PURITY: no I/O, no imports from other src modules. The one exception is
 * `globalThis.crypto.randomUUID()` for the default `uploadId` above — the same
 * runtime-global RNG `upload.ts` already relies on for `itemId`, not a new
 * dependency. The owner address is passed IN (the `addressOf` derivation lives in
 * the upload orchestrator, which forwards the derived value here) — keeping tag
 * logic testable without a signing key and forcing exactly one derivation site
 * upstream.
 */

import { isCanonicalAddress } from "../canonical.js";
import { InvalidUploadParamsError } from "./errors.js";

/** The arbundles data-item / native-transaction tag element shape. */
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
 *
 * Kept at exactly these four names for backward compatibility with existing
 * consumers of this exported tuple (`REQUIRED_UPLOAD_TAG_NAMES` predates the T2
 * schema-versioning tags and T1 category/asset-type/app-lineage tags below). All
 * later-added tag names join the RESERVED name set directly, not this tuple — see
 * `RESERVED_NAMES`.
 */
export const REQUIRED_UPLOAD_TAG_NAMES = [
  TAG_APP_NAME,
  TAG_CONTENT_TYPE,
  TAG_CODEX_ITEM_ID,
  TAG_CODEX_OWNER,
] as const;

/** Codex-Tag-Schema-Version tag key — the tag schema version every upload carries. */
export const TAG_CODEX_TAG_SCHEMA_VERSION = "Codex-Tag-Schema-Version";
/** The current tag schema version value. Bumps only when a REQUIRED tag's shape or
 *  meaning changes; adding a new optional tag is never a version bump. */
export const CODEX_TAG_SCHEMA_VERSION_CURRENT = "1";
/** Codex-Upload-Id tag key — groups N files + a manifest from one upload action. */
export const TAG_CODEX_UPLOAD_ID = "Codex-Upload-Id";
/** Codex-Item-Type tag key — `"file"` | `"manifest"`. */
export const TAG_CODEX_ITEM_TYPE = "Codex-Item-Type";

/** Codex-Category tag key — the curated upload-taxonomy value (T1). */
export const TAG_CODEX_CATEGORY = "Codex-Category";
/** Codex-Asset-Type tag key — present only when Codex-Category is "nft-data". */
export const TAG_CODEX_ASSET_TYPE = "Codex-Asset-Type";
/** Codex-App-Id tag key — a stable identifier reused across an app/site's uploads. */
export const TAG_CODEX_APP_ID = "Codex-App-Id";
/** Codex-App-Version tag key — a free-text label on one specific upload. */
export const TAG_CODEX_APP_VERSION = "Codex-App-Version";

/** Codex-Encrypted tag key — `"true"`/`"false"`, present whenever `encrypted` is
 *  explicitly provided (`arweave-upload-encryption` T2). */
export const TAG_CODEX_ENCRYPTED = "Codex-Encrypted";
/** Codex-Encryptor tag key — the encrypting account's public address only, present
 *  only when `Codex-Encrypted` is `"true"`. */
export const TAG_CODEX_ENCRYPTOR = "Codex-Encryptor";
/** Codex-Encryption-Version tag key — identifies which encryption PROCEDURE produced
 *  this upload's ciphertext, present if and only if `Codex-Encrypted` is `"true"`
 *  (`arweave-tag-schema-spec` T1). Arweave data is permanent, so a future decrypt
 *  path needs to know which scheme version to run; this is distinct from
 *  `Codex-Tag-Schema-Version`, which versions which TAGS exist, not the procedure
 *  behind any one tag's value. */
export const TAG_CODEX_ENCRYPTION_VERSION = "Codex-Encryption-Version";
/** The current encryption-procedure version value — a PINNED constant, never
 *  caller-supplied directly, mirroring `CODEX_TAG_SCHEMA_VERSION_CURRENT`'s own
 *  pattern. Bumps only when the real encryption procedure in `fileEncryption.ts`
 *  changes; version `"1"`'s decrypt logic is never removed, since real data may
 *  depend on it forever.
 *
 *  Bumped to `"2"` by `arweave-streaming-encryption` T2: newly-encrypted
 *  uploads now use `streamingFileEncryption.ts`'s chunked-AES-GCM v2 envelope
 *  (`IV(12) ‖ ciphertext+tag(16)` per `ENCRYPTION_CHUNK_SIZE` chunk, no
 *  base64 blowup) instead of v1's whole-blob `base64(plaintext)` + single
 *  `AES-GCM` call (`fileEncryption.ts`'s `encryptWithDerivedKey`, still
 *  unchanged and still what every `"1"`-tagged item depends on forever). */
export const CODEX_ENCRYPTION_VERSION_CURRENT = "2";

/**
 * `codex-backup-envelope-encryption` T3: the four wrapped-key tag names a
 * codex-backup upload's dual-key envelope carries by default — one pair
 * (IDEK + EDEK) per default wrap source (the Prime Arweave seed's "Master
 * Seed" bitstring; the Codex Identity's Standard-half "Standard Apollo"
 * bitstring). Each name ends `-Default` so a later PIN-variant sibling (e.g.
 * `Codex-Backup-IDEK-MasterSeed-Pin`) can exist alongside it under the SAME
 * per-source/per-DEK naming family without a name collision — the design
 * doc's own settled restore-routing convention (tag PRESENCE alone tells a
 * restorer whether a PIN is needed, never a failed blind decrypt attempt).
 * These ride `codex-arweave`'s `backupCodexToLibrary` → `uploadCodexBackup`'s
 * `appMetadata` passthrough exactly like `Codex-Backup-Recovery-Key` (the
 * mechanism this topic replaces) did — not added to `RESERVED_NAMES` below,
 * mirroring that same precedent (a feature-specific metadata tag, not part
 * of the universal required/reserved tag schema).
 */
export const TAG_CODEX_BACKUP_IDEK_MASTERSEED_DEFAULT = "Codex-Backup-IDEK-MasterSeed-Default";
export const TAG_CODEX_BACKUP_EDEK_MASTERSEED_DEFAULT = "Codex-Backup-EDEK-MasterSeed-Default";
export const TAG_CODEX_BACKUP_IDEK_STANDARDAPOLLO_DEFAULT =
  "Codex-Backup-IDEK-StandardApollo-Default";
export const TAG_CODEX_BACKUP_EDEK_STANDARDAPOLLO_DEFAULT =
  "Codex-Backup-EDEK-StandardApollo-Default";

/**
 * `codex-backup-envelope-encryption` T4: the four wrapped-key tag names for
 * the OPT-IN Arweave-PIN wrap path — the SAME per-source/per-DEK naming
 * family as the four `...-Default` names above, just ending `-Pin` instead
 * (the design doc's own settled restore-routing convention: tag PRESENCE
 * alone tells a restorer whether a PIN is needed, never a failed blind
 * decrypt attempt). For a GIVEN source, exactly one of its `-Default`/`-Pin`
 * pairs is ever posted on a single upload — NEVER both (mutual exclusivity;
 * an unprotected default sitting alongside a PIN'd wrap would defeat the PIN
 * entirely) — enforced by `codex-arweave`'s `backupCodexToLibrary`, not by
 * this module. Ride the same `appMetadata` passthrough as the `-Default`
 * names; not added to `RESERVED_NAMES` below, same precedent.
 */
export const TAG_CODEX_BACKUP_IDEK_MASTERSEED_PIN = "Codex-Backup-IDEK-MasterSeed-Pin";
export const TAG_CODEX_BACKUP_EDEK_MASTERSEED_PIN = "Codex-Backup-EDEK-MasterSeed-Pin";
export const TAG_CODEX_BACKUP_IDEK_STANDARDAPOLLO_PIN = "Codex-Backup-IDEK-StandardApollo-Pin";
export const TAG_CODEX_BACKUP_EDEK_STANDARDAPOLLO_PIN = "Codex-Backup-EDEK-StandardApollo-Pin";

/**
 * Codex-Backup-Encryption-Version tag key — the dual-key ENVELOPE procedure
 * version for a codex-backup upload (`codex-backup-envelope-encryption` T3).
 * A FRESH version axis, independent of `Codex-Encryption-Version` above: that
 * tag versions the per-FILE `fileEncryption.ts` procedure (a single
 * already-raw-key AES-GCM blob); this one versions the codex-backup-specific
 * dual-DEK scheme (IDEK re-encrypts every secret field, EDEK then encrypts
 * the whole resulting export as one opaque blob, both DEKs wrapped under
 * each default source's base49/base10 scalar spelling) — a genuinely
 * different procedure protecting a genuinely different payload shape, so it
 * must be able to evolve (e.g. the Arweave-PIN wrap path) without implying
 * anything about the per-file procedure's own version.
 */
export const TAG_CODEX_BACKUP_ENCRYPTION_VERSION = "Codex-Backup-Encryption-Version";
/** The current codex-backup envelope-procedure version value — a PINNED
 *  constant, never caller-supplied directly, mirroring
 *  `CODEX_ENCRYPTION_VERSION_CURRENT`'s own pattern. Version `"1"` is the
 *  two-default-source (Master Seed + Standard Apollo) scheme this task
 *  built; a later PIN-variant addition is additive to the SAME tag family
 *  (see the four wrapped-key tag names above) and may or may not warrant its
 *  own version bump when it lands — not decided here. */
export const CODEX_BACKUP_ENCRYPTION_VERSION_CURRENT = "1";

/**
 * Codex-Form-Version tag key — carries `@ancientpantheon/codex-core`'s
 * `CODEX_FORM_VERSION` constant (the real product-facing "shape of the
 * codex" version) on a codex-backup upload. `arweave-core` has and must keep
 * zero dependency on `codex-core`, so this module owns only the tag NAME;
 * the caller (`codex-arweave`'s `backupCodexToLibrary`) supplies the real
 * value. Replaces the previous (incorrect) convention of deriving
 * `Codex-App-Version` from the export's `lastUpdatedAt` timestamp for a
 * codex-backup upload — a reader of THAT tag learned *when* a backup was
 * made, not *what shape* it is in.
 */
export const TAG_CODEX_FORM_VERSION = "Codex-Form-Version";

/** The `itemType` enum `buildUploadTags` accepts for `Codex-Item-Type`. */
export type UploadItemType = "file" | "manifest";
const VALID_ITEM_TYPES: ReadonlySet<string> = new Set<UploadItemType>(["file", "manifest"]);

/**
 * The curated `Codex-Category` enum — every value from the design doc's grouped
 * taxonomy table, in that table's row order (11 groups, 26 rows total). Drives both
 * `buildUploadTags` validation and, later, a UI picker.
 */
export type UploadCategory =
  | "personal-photos"
  | "personal-videos"
  | "personal-audio"
  | "journals-writing"
  | "personal-documents"
  | "medical-records"
  | "financial-records"
  | "legal-records"
  | "certificates-credentials"
  | "creative-work"
  | "nft-data"
  | "software-code"
  | "website-dapp-hosting"
  | "research-data"
  | "publications-books"
  | "public-statement"
  | "proof-timestamping"
  | "memorial-legacy"
  | "historical-archive"
  | "genealogy-family-history"
  | "correspondence-archive"
  | "gaming-virtual-assets"
  | "event-records"
  | "codex-backup"
  | "foreign"
  | "general-other";

/** Runtime array mirroring {@link UploadCategory}, in the same canonical order. */
export const UPLOAD_CATEGORIES: readonly UploadCategory[] = [
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
];
const VALID_CATEGORIES: ReadonlySet<string> = new Set(UPLOAD_CATEGORIES);

/**
 * The `Codex-Asset-Type` enum — only meaningful (and only permitted) when
 * `category === "nft-data"`. Mirrors OuronetUI's NFT viewer's `asset-type` values.
 */
export type NftAssetType = "image" | "audio" | "video" | "document" | "archive" | "model" | "exotic";

/** Runtime array mirroring {@link NftAssetType}. */
export const NFT_ASSET_TYPES: readonly NftAssetType[] = [
  "image",
  "audio",
  "video",
  "document",
  "archive",
  "model",
  "exotic",
];
const VALID_ASSET_TYPES: ReadonlySet<string> = new Set(NFT_ASSET_TYPES);

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

const RESERVED_NAMES: ReadonlySet<string> = new Set([
  ...REQUIRED_UPLOAD_TAG_NAMES,
  TAG_CODEX_TAG_SCHEMA_VERSION,
  TAG_CODEX_UPLOAD_ID,
  TAG_CODEX_ITEM_TYPE,
  TAG_CODEX_CATEGORY,
  TAG_CODEX_ASSET_TYPE,
  TAG_CODEX_APP_ID,
  TAG_CODEX_APP_VERSION,
  TAG_CODEX_ENCRYPTED,
  TAG_CODEX_ENCRYPTOR,
  TAG_CODEX_ENCRYPTION_VERSION,
]);

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
  /** Optional Codex-Upload-Id override; when omitted, defaults to a generated
   *  `globalThis.crypto.randomUUID()` — mirroring `upload.ts`'s existing `itemId`
   *  default pattern. Groups this item with any others sharing the same upload
   *  action (e.g. the files + manifest of one bundle). When EXPLICITLY provided it
   *  must be a non-empty string, same rigor as `appName`. */
  uploadId?: string;
  /** Optional Codex-Item-Type override; defaults to `"file"` when omitted. Must be
   *  `"file"` or `"manifest"` when provided. */
  itemType?: UploadItemType;
  /** Optional Codex-Category — OPTIONAL at this layer (real mandatory-enforcement is
   *  a caller's job, one layer up). Must be one of {@link UPLOAD_CATEGORIES} when
   *  provided. */
  category?: UploadCategory;
  /** Optional Codex-Asset-Type — present if and only if `category === "nft-data"`;
   *  must be one of {@link NFT_ASSET_TYPES} when provided. */
  assetType?: NftAssetType;
  /** Optional Codex-App-Id — a stable identifier reused across an app/site's
   *  uploads. When EXPLICITLY provided must be a non-empty string. Independent of
   *  `appVersion` — either may appear without the other. */
  appId?: string;
  /** Optional Codex-App-Version — a free-text label on this specific upload. When
   *  EXPLICITLY provided must be a non-empty string. Independent of `appId`. */
  appVersion?: string;
  /** Optional Codex-Encrypted — OPTIONAL at this layer (real mandatory-enforcement is
   *  a caller's job, one layer up, same as `category`). Unlike `category`, once
   *  EXPLICITLY provided (`true` or `false`) it is ALWAYS emitted as the literal
   *  string `"true"`/`"false"` — never omitted — so "was this encrypted" is never
   *  ambiguous on a real upload. Omitted entirely, it emits no tag at all (backward
   *  compatible with every existing caller). */
  encrypted?: boolean;
  /** Optional Codex-Encryptor — the encrypting account's public address only.
   *  Present if and only if `encrypted === true` (a two-way implication): requires
   *  `encrypted === true` when provided, and `encrypted === true` requires this to be
   *  present and a valid canonical 43-char Arweave address. */
  encryptorAddress?: string;
  /** Optional Codex-Encryption-Version — identifies which encryption PROCEDURE
   *  produced this upload's ciphertext. Present if and only if `encrypted === true`
   *  (a two-way implication, same shape as `encryptorAddress`): requires
   *  `encrypted === true` when provided, and — UNLIKE `appId`/`appVersion` —
   *  `encrypted === true` ALWAYS requires this to be present; an encrypted upload
   *  with no stamped procedure version is exactly the permanent-data risk this field
   *  exists to close. Always pass {@link CODEX_ENCRYPTION_VERSION_CURRENT}, never a
   *  free-form caller value. */
  encryptionVersion?: string;
  /** Optional app metadata tags, appended after the required + schema tags in this
   *  order. */
  appMetadata?: readonly Tag[];
}

/**
 * Build the ANS-104 tag list for an upload: the four required tags first, then app
 * metadata in caller order. Pure and synchronous. Validates every input BEFORE
 * emitting; throws {@link InvalidUploadParamsError} (structured field + reason) for
 * any violation so a malformed tag never reaches the SDK as an opaque error.
 */
export function buildUploadTags(params: BuildUploadTagsParams): Tag[] {
  const {
    ownerAddress,
    contentType,
    itemId,
    appName,
    uploadId,
    itemType,
    category,
    assetType,
    appId,
    appVersion,
    encrypted,
    encryptorAddress,
    encryptionVersion,
    appMetadata,
  } = params;

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

  // An EXPLICIT uploadId must be a non-empty string; omitting it generates one.
  if (uploadId !== undefined && !isNonEmptyString(uploadId)) {
    throw new InvalidUploadParamsError(
      "uploadId",
      "empty-or-non-string",
      "uploadId, when provided, must be a non-empty string.",
    );
  }

  // An EXPLICIT itemType must be one of the enum values; omitting it defaults to "file".
  if (itemType !== undefined && !VALID_ITEM_TYPES.has(itemType)) {
    throw new InvalidUploadParamsError(
      "itemType",
      "invalid-item-type",
      'itemType, when provided, must be "file" or "manifest".',
    );
  }

  // An EXPLICIT category must be one of UPLOAD_CATEGORIES; omitting it emits no tag.
  if (category !== undefined && !VALID_CATEGORIES.has(category)) {
    throw new InvalidUploadParamsError(
      "category",
      "invalid-category",
      "category, when provided, must be one of UPLOAD_CATEGORIES.",
    );
  }

  // assetType is present if and only if category === "nft-data" — a two-way implication.
  if (assetType !== undefined && category !== "nft-data") {
    throw new InvalidUploadParamsError(
      "assetType",
      "requires-nft-category",
      'assetType, when provided, requires category === "nft-data".',
    );
  }
  if (category === "nft-data" && assetType === undefined) {
    throw new InvalidUploadParamsError(
      "assetType",
      "required-for-nft-category",
      'assetType is required when category is "nft-data".',
    );
  }
  if (assetType !== undefined && !VALID_ASSET_TYPES.has(assetType)) {
    throw new InvalidUploadParamsError(
      "assetType",
      "invalid-asset-type",
      "assetType, when provided, must be one of NFT_ASSET_TYPES.",
    );
  }

  // An EXPLICIT appId/appVersion must each be a non-empty string; independent of one another.
  if (appId !== undefined && !isNonEmptyString(appId)) {
    throw new InvalidUploadParamsError(
      "appId",
      "empty-or-non-string",
      "appId, when provided, must be a non-empty string.",
    );
  }
  if (appVersion !== undefined && !isNonEmptyString(appVersion)) {
    throw new InvalidUploadParamsError(
      "appVersion",
      "empty-or-non-string",
      "appVersion, when provided, must be a non-empty string.",
    );
  }

  // encryptorAddress is present if and only if encrypted === true — a two-way implication.
  if (encryptorAddress !== undefined && encrypted !== true) {
    throw new InvalidUploadParamsError(
      "encryptorAddress",
      "requires-encrypted-true",
      "encryptorAddress, when provided, requires encrypted === true.",
    );
  }
  if (encrypted === true && encryptorAddress === undefined) {
    throw new InvalidUploadParamsError(
      "encryptorAddress",
      "required-when-encrypted",
      "encryptorAddress is required when encrypted is true.",
    );
  }
  // NOT validated via `isCanonicalAddress` — that check is specifically the
  // 43-char base64url Arweave address shape, but the account that encrypts an
  // upload is an OURONET account (a different chain, a different address
  // format entirely; e.g. DALOS-prefixed, not Arweave-canonical). arweave-core
  // has and must keep zero dependency on any codex-* package, so it cannot
  // know what a valid Ouronet address looks like — only that a caller-supplied
  // reference value was actually provided. The real format-correctness
  // responsibility belongs to the codex-arweave-layer caller that populates
  // this field, not this pure tag-builder.
  if (encrypted === true && encryptorAddress !== undefined && !isNonEmptyString(encryptorAddress)) {
    throw new InvalidUploadParamsError(
      "encryptorAddress",
      "empty-or-non-string",
      "encryptorAddress, when provided, must be a non-empty string.",
    );
  }

  // encryptionVersion is present if and only if encrypted === true — a two-way
  // implication, same shape as encryptorAddress. UNLIKE appId/appVersion, this field
  // is NEVER optional once encrypted === true: an encrypted upload with no stamped
  // procedure version is exactly the permanent-data risk this field exists to close.
  if (encryptionVersion !== undefined && encrypted !== true) {
    throw new InvalidUploadParamsError(
      "encryptionVersion",
      "requires-encrypted-true",
      "encryptionVersion, when provided, requires encrypted === true.",
    );
  }
  if (encrypted === true && encryptionVersion === undefined) {
    throw new InvalidUploadParamsError(
      "encryptionVersion",
      "required-when-encrypted",
      "encryptionVersion is required when encrypted is true.",
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

  // Only the ones actually provided emit a tag — an omitted optional field never
  // ships an empty-string placeholder.
  const optionalTags: Tag[] = [];
  if (category !== undefined) optionalTags.push({ name: TAG_CODEX_CATEGORY, value: category });
  if (assetType !== undefined) optionalTags.push({ name: TAG_CODEX_ASSET_TYPE, value: assetType });
  if (appId !== undefined) optionalTags.push({ name: TAG_CODEX_APP_ID, value: appId });
  if (appVersion !== undefined) optionalTags.push({ name: TAG_CODEX_APP_VERSION, value: appVersion });
  // Unlike category, once EXPLICITLY provided (true or false) Codex-Encrypted is
  // ALWAYS emitted — "was this encrypted" is never ambiguous/absent on a real upload.
  if (encrypted !== undefined) {
    optionalTags.push({ name: TAG_CODEX_ENCRYPTED, value: encrypted ? "true" : "false" });
  }
  if (encrypted === true) {
    optionalTags.push({ name: TAG_CODEX_ENCRYPTOR, value: encryptorAddress as string });
    optionalTags.push({ name: TAG_CODEX_ENCRYPTION_VERSION, value: encryptionVersion as string });
  }

  const tags: Tag[] = [
    { name: TAG_APP_NAME, value: appName ?? DEFAULT_APP_NAME },
    { name: TAG_CONTENT_TYPE, value: contentType },
    { name: TAG_CODEX_ITEM_ID, value: itemId },
    { name: TAG_CODEX_OWNER, value: ownerAddress },
    { name: TAG_CODEX_TAG_SCHEMA_VERSION, value: CODEX_TAG_SCHEMA_VERSION_CURRENT },
    { name: TAG_CODEX_UPLOAD_ID, value: uploadId ?? globalThis.crypto.randomUUID() },
    { name: TAG_CODEX_ITEM_TYPE, value: itemType ?? "file" },
    ...optionalTags,
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
