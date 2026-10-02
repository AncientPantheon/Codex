/**
 * Upload surface types.
 *
 * `UploadParams`/`UploadResult` are `uploadData`'s (upload.ts) public caller
 * contract. The injectable gateway-API seam `uploadData` forwards to
 * `postArweaveData` (T3, `nativeUpload.ts`) is `UploadGatewayApiFactory` —
 * defined there, not here, and re-exported via `UploadOptions` (upload.ts) —
 * so tests can inject a plain fake and never touch a real gateway, exactly as
 * `tests/tx-transfer.test.ts`/`tests/upload-native.test.ts` already do.
 */

import type { ArweaveJwk } from "../keys/types.js";
import type { NftAssetType, Tag, UploadCategory } from "./tags.js";

/**
 * Caller input for {@link uploadData}.
 *
 * `data` is narrowed to `string | Uint8Array` — the two payload forms portable
 * across Node and browsers without `Buffer`. `itemId` defaults to a generated
 * UUID and also becomes the `Codex-Upload-Id` value for this single-file
 * upload (`uploadData` always passes `itemType: "file"`); `appName` defaults
 * to `DEFAULT_APP_NAME`; `appMetadata` is appended after the required tag
 * schema in caller order.
 *
 * `category` is REQUIRED (T2, `arweave-upload-categories`) — unlike
 * `tags.ts`'s `BuildUploadTagsParams.category`, which stays optional at that
 * pure tag-builder layer, this orchestration-level contract is where
 * mandatory-category enforcement actually lives: omitting `category` here is
 * a TypeScript compile-time error, not a runtime one. `assetType`/`appId`/
 * `appVersion` stay optional, forwarded verbatim to `buildUploadTags`, whose
 * own validation rules (assetType iff category === "nft-data", etc.) apply
 * unchanged.
 *
 * `encrypted` is likewise REQUIRED (T4, `arweave-upload-encryption`) — every
 * upload must explicitly state whether it's encrypted, no silent default;
 * omitting it here is a TypeScript compile-time error, not a runtime one.
 * `encryptorAddress`/`encryptionVersion` stay optional, forwarded verbatim to
 * `buildUploadTags`, whose own two-way validation (present iff `encrypted ===
 * true`, and — UNLIKE `encryptorAddress`'s own optionality here —
 * `encryptionVersion` is NEVER actually optional once `encrypted === true`;
 * `buildUploadTags` enforces that, not this type) applies unchanged. NOTE:
 * this task does NOT perform any encryption — `data` is expected to already
 * be ciphertext bytes by the time it reaches `uploadData` when `encrypted:
 * true`; encryption happens one layer up.
 */
export interface UploadParams {
  /** The uploader's keyfile. Validated via `importKeyfile`; goes only to the local signer. */
  jwk: ArweaveJwk;
  /** The payload to upload. Must be a non-empty string or Uint8Array. */
  data: string | Uint8Array;
  /** MIME type — becomes the Content-Type tag. */
  contentType: string;
  /** Optional Codex-Item-Id; defaults to a generated UUID. Also used, verbatim,
   *  as this upload's Codex-Upload-Id. */
  itemId?: string;
  /** Optional App-Name override; defaults to `DEFAULT_APP_NAME`. */
  appName?: string;
  /** Optional app metadata tags, appended after the required tag schema in order. */
  appMetadata?: readonly Tag[];
  /**
   * REQUIRED fee cap, in Winston, forwarded verbatim to `postArweaveData`. The
   * reward is quoted by an untrusted rotating gateway and is signed and PAID
   * verbatim, so a caller MUST state their ceiling: a quoted reward STRICTLY
   * greater than this cap throws `RewardExceedsCapError` BEFORE any signing;
   * an absent cap throws `InvalidUploadParamsError` before any pool call.
   */
  maxRewardWinston: bigint;
  /**
   * REQUIRED Codex-Category — one of `UPLOAD_CATEGORIES` (`tags.ts`). No
   * upload completes without one actively chosen; there is no silent default.
   * Forwarded verbatim to `buildUploadTags`, which validates enum membership.
   */
  category: UploadCategory;
  /** Optional Codex-Asset-Type; only valid (and required) when `category ===
   *  "nft-data"` — `buildUploadTags` enforces the two-way implication. */
  assetType?: NftAssetType;
  /** Optional Codex-App-Id — a stable identifier reused across an app/site's
   *  uploads. Independent of `appVersion`. */
  appId?: string;
  /** Optional Codex-App-Version — a free-text label on this specific upload.
   *  Independent of `appId`. */
  appVersion?: string;
  /**
   * REQUIRED Codex-Encrypted — every upload must explicitly state whether it
   * is encrypted, no silent default. Forwarded verbatim to `buildUploadTags`,
   * which always emits the literal `"true"`/`"false"` string once provided.
   * `data` must already be ciphertext bytes when this is `true` — this
   * function performs no encryption itself.
   */
  encrypted: boolean;
  /** Optional Codex-Encryptor — the encrypting account's public address only.
   *  Present if and only if `encrypted === true`; `buildUploadTags` enforces
   *  the two-way implication and the canonical-address shape. */
  encryptorAddress?: string;
  /** Optional Codex-Encryption-Version — identifies which encryption
   *  PROCEDURE produced this upload's ciphertext. Present if and only if
   *  `encrypted === true`; forwarded verbatim to `buildUploadTags`, whose own
   *  two-way validation enforces it — UNLIKE `encryptorAddress`, this field
   *  is NEVER optional once `encrypted === true` (`buildUploadTags` throws
   *  otherwise). Callers always pass the pinned
   *  `CODEX_ENCRYPTION_VERSION_CURRENT` (`tags.ts`), never a free-form value. */
  encryptionVersion?: string;
}

/**
 * Result of a successful {@link uploadData} call.
 *
 * `id` is the signed transaction's canonical id (the tx-equivalent id a
 * consumer persists); `ownerAddress` is `addressOf(jwk)` — the exact value
 * the Codex-Owner tag carries; `itemId` is the id (supplied or generated)
 * also present in the Codex-Item-Id AND Codex-Upload-Id tags; `tags` is the
 * full applied tag list.
 */
export interface UploadResult {
  /** The signed transaction's canonical id — 43-char base64url. */
  id: string;
  /** The uploader's canonical 43-char address (Codex-Owner value, verbatim). */
  ownerAddress: string;
  /** The Codex-Item-Id used for this upload (supplied or generated). */
  itemId: string;
  /** The full tag list applied to the upload. */
  tags: Tag[];
}
