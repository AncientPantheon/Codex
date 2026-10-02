/**
 * Multi-file/folder ANS-104 bundle upload — one atomic bundle, one payment,
 * for N files (subfolder paths preserved) plus a manifest.
 *
 * `uploadBundle` is the counterpart to `upload.ts`'s single-file `uploadData`
 * path: it is reached ONLY for 2+ files or an explicit folder selection — a
 * single input file uses `uploadData` instead (no bundle/manifest overhead
 * for one item). This module does not special-case a 1-file `files` array;
 * that decision is the caller's, not this function's.
 *
 * `category` (REQUIRED) plus the optional `assetType`/`appId`/`appVersion`
 * are a per-upload-action choice, never a per-file one: the SAME values are
 * applied to every file item AND the manifest item this call produces.
 *
 * `encrypted` (REQUIRED, T4) plus optional `encryptorAddress`/
 * `encryptionVersion` (`arweave-tag-schema-spec` T2) are NOT applied
 * uniformly, unlike `category`: they apply to every FILE item verbatim, but
 * the MANIFEST item is ALWAYS tagged `encrypted: false` (no
 * `Codex-Encryptor`, no `Codex-Encryption-Version`) regardless of what the
 * caller passed for the files — the manifest's own JSON content (the
 * folder/file path structure) must stay public and gateway-readable even
 * when the files it points to are encrypted; only file CONTENTS are
 * encrypted, never the structural mapping. `data`/`files[].data` must
 * already be ciphertext bytes when `encrypted` is `true` — this function
 * performs no encryption itself.
 *
 * Composition, per call:
 *   1. Generate ONE `uploadId` (`globalThis.crypto.randomUUID()`) shared by
 *      every data item this call produces (the files AND the manifest) — the
 *      `Codex-Upload-Id` tag that groups a bundle's items as one unit.
 *   2. For each input file: build an `arbundles` `ArweaveSigner` from the
 *      caller's jwk (shared across every item this call signs), tag it via
 *      `buildUploadTags` (`itemType: "file"`, the shared `uploadId`, the
 *      shared `category`/`assetType`/`appId`/`appVersion`, a `Codex-Path`
 *      app-metadata tag carrying the file's relative path),
 *      `createData(file.data, signer, { tags })`, then sign it via
 *      `arbundles`' standalone `sign(item, signer)` export (NOT the
 *      `DataItem.prototype.sign()`/`.id`/`.rawId` instance members — see
 *      `assembleSignedBundle`'s doc comment below for why) — the raw id
 *      bytes it returns are the deterministic post-sign ANS-104 id, read
 *      back as a base64url STRING via a throwaway `assembleSignedBundle(...)
 *      .getIds()` call (reusing `arbundles`' own `Bundle.getIds()` base64url
 *      encoding instead of this module taking a direct `base64url` dependency).
 *   3. Build the `arweave/paths` manifest JSON referencing every file item's
 *      id by its relative path, wrap it as its own signed data item
 *      (`itemType: "manifest"`, `Content-Type:
 *      application/x.arweave-manifest+json`, the same shared `uploadId` and
 *      `category`/`assetType`/`appId`/`appVersion`), signed the same way.
 *   4. `assembleSignedBundle([...fileItems, manifestItem])` — ONE ANS-104
 *      bundle binary containing every item (a local, Node-`crypto`-free
 *      reimplementation of `arbundles`' own `bundleAndSignData`; see its doc
 *      comment below for why `bundleAndSignData` itself cannot be used here).
 *   5. Post the bundle binary as ONE transaction via `postArweaveData`
 *      (`nativeUpload.ts`), with `Bundle-Format: binary` / `Bundle-Version:
 *      2.0.0` added directly to `postArweaveData`'s own `tags` param (NOT
 *      via `buildUploadTags` — these describe the WRAPPING L1 transaction,
 *      not a Codex upload item).
 *   6. Resolve `{ manifestId, fileIds, uploadId }` — `manifestId` and each
 *      `fileIds[].id` are the ANS-104 DATA-ITEM ids (step 2/3's base64url-
 *      encoded raw id bytes), NOT the wrapping L1 transaction id
 *      `postArweaveData` resolves: once
 *      the bundle is indexed, gateways resolve each data item individually
 *      by its own id, which is what a manifest/file link browses.
 *
 * One payment: `postArweaveData` is called exactly once for the whole batch
 * — the fee is quoted and paid for the single wrapping transaction, not per
 * file.
 */

import { ArweaveSigner, createData, sign as signDataItem, longTo32ByteArray, Bundle } from "arbundles";
import type { DataItem } from "arbundles";

import { importKeyfile } from "../keys/keyfile.js";
import { addressOf } from "../keys/address.js";
import { buildUploadTags } from "./tags.js";
import type { UploadCategory, NftAssetType } from "./tags.js";
import { postArweaveData } from "./nativeUpload.js";
import type { UploadGatewayApiFactory } from "./nativeUpload.js";
import type { GatewayPool } from "../gateway/types.js";
import type { ArweaveJwk } from "../keys/types.js";

/** The app-metadata tag carrying a bundled file item's relative path,
 *  subfolders preserved (e.g. `"sub/dir/file.txt"`). */
const TAG_CODEX_PATH = "Codex-Path";

/** The manifest data item's `Content-Type` — the ANS-104/arweave-paths
 *  manifest media type gateways recognize for subpath resolution. */
const MANIFEST_CONTENT_TYPE = "application/x.arweave-manifest+json";
const MANIFEST_FORMAT = "arweave/paths";
const MANIFEST_VERSION = "0.2.0";

/** One input file for {@link uploadBundle}. */
export interface UploadBundleFile {
  /** The file's path relative to the upload root, subfolders preserved with
   *  forward slashes — becomes the manifest's path key and the file item's
   *  `Codex-Path` tag value verbatim. */
  path: string;
  /** The file's raw bytes. */
  data: Uint8Array;
  /** The file's MIME type — becomes the file item's `Content-Type`. */
  contentType: string;
}

/** Inputs for {@link uploadBundle}. */
export interface UploadBundleParams {
  /** The uploader's keyfile (validated via `importKeyfile` before any item is
   *  signed). The SAME jwk signs every file item, the manifest item, and the
   *  wrapping L1 transaction. */
  jwk: ArweaveJwk;
  /** The files to bundle — 2+ files or an explicit folder selection; this
   *  function does not special-case a single-file array. */
  files: UploadBundleFile[];
  /** REQUIRED fee cap, in Winston, forwarded verbatim to `postArweaveData`
   *  for the single wrapping transaction. */
  maxRewardWinston: bigint;
  /** REQUIRED Codex-Category — a per-upload-action choice, applied IDENTICALLY
   *  to every file item AND the manifest item in this batch (never per-file). */
  category: UploadCategory;
  /** Optional Codex-Asset-Type — present if and only if `category ===
   *  "nft-data"`; applied identically to every item, same as `category`. */
  assetType?: NftAssetType;
  /** Optional Codex-App-Id — applied identically to every item. */
  appId?: string;
  /** Optional Codex-App-Version — applied identically to every item. */
  appVersion?: string;
  /**
   * REQUIRED Codex-Encrypted — every upload must explicitly state whether it
   * is encrypted, no silent default. Applied verbatim to every FILE item;
   * the MANIFEST item is ALWAYS tagged `encrypted: false` regardless of this
   * value (the manifest's path structure stays public even when file
   * contents are encrypted — see the module doc comment above).
   */
  encrypted: boolean;
  /** Optional Codex-Encryptor — the encrypting account's public address only.
   *  Applied verbatim to every FILE item when `encrypted === true`; NEVER
   *  applied to the manifest item, which carries no `Codex-Encryptor` tag. */
  encryptorAddress?: string;
  /** Optional Codex-Encryption-Version — identifies which encryption
   *  PROCEDURE produced the file items' ciphertext. Applied verbatim to
   *  every FILE item when `encrypted === true` (and required there, by
   *  `buildUploadTags`); NEVER applied to the manifest item, which carries
   *  no `Codex-Encryption-Version` tag, same as `Codex-Encryptor`. */
  encryptionVersion?: string;
}

/** Options for {@link uploadBundle}. */
export interface UploadBundleOptions {
  /** The per-endpoint gateway-API factory, forwarded to `postArweaveData`.
   *  Defaults to `postArweaveData`'s own default (arweave-js-backed); tests
   *  inject plain fakes. */
  apiFactory?: UploadGatewayApiFactory;
}

/** The result of a successful bundle upload. */
export interface UploadBundleResult {
  /** The manifest data item's deterministic post-sign ANS-104 id. */
  manifestId: string;
  /** Each input file's relative path paired with its data item's
   *  deterministic post-sign ANS-104 id, in `params.files` order. */
  fileIds: { path: string; id: string }[];
  /** The `Codex-Upload-Id` value shared by every data item this call
   *  produced (every file item and the manifest item). */
  uploadId: string;
}

/**
 * Bundle N files (subfolder paths preserved) plus an `arweave/paths`
 * manifest into ONE atomic ANS-104 bundle and post it as ONE transaction —
 * one payment for the whole batch.
 */
export async function uploadBundle(
  pool: GatewayPool,
  params: UploadBundleParams,
  opts: UploadBundleOptions = {},
): Promise<UploadBundleResult> {
  const jwk = importKeyfile(params.jwk);
  const ownerAddress = await addressOf(jwk);
  const uploadId = globalThis.crypto.randomUUID();

  // One signer, shared by every data item this call signs (files + manifest)
  // and by the ANS-104 bundle signature itself.
  const signer = new ArweaveSigner(jwk);

  const fileItems: { path: string; item: DataItem; rawId: Buffer }[] = [];
  for (const file of params.files) {
    const tags = buildUploadTags({
      ownerAddress,
      contentType: file.contentType,
      itemId: globalThis.crypto.randomUUID(),
      uploadId,
      itemType: "file",
      category: params.category,
      assetType: params.assetType,
      appId: params.appId,
      appVersion: params.appVersion,
      encrypted: params.encrypted,
      encryptorAddress: params.encryptorAddress,
      encryptionVersion: params.encryptionVersion,
      appMetadata: [{ name: TAG_CODEX_PATH, value: file.path }],
    });
    const item = createData(file.data, signer, { tags });
    // `signDataItem` (arbundles' standalone `sign` export) — NEVER
    // `item.sign(signer)` — see `assembleSignedBundle`'s doc comment below.
    const rawId = await signDataItem(item, signer);
    fileItems.push({ path: file.path, item, rawId });
  }

  // Base64url-encode each file item's raw id via a throwaway `Bundle` built
  // from just the file items (never posted — discarded once `fileIds` is
  // read back). This reuses `Bundle.getIds()` (header bytes -> base64url,
  // no Node `crypto` touched — see `assembleSignedBundle`'s doc comment)
  // instead of this module adding its OWN direct `base64url` dependency.
  const fileRawBundleIds = assembleSignedBundle(fileItems).getIds();
  const fileIds = fileItems.map(({ path }, index) => ({ path, id: fileRawBundleIds[index]! }));
  const paths: Record<string, { id: string }> = {};
  for (const entry of fileIds) {
    paths[entry.path] = { id: entry.id };
  }

  // The manifest item is ALWAYS public — its JSON content is the folder/file
  // path structure gateways must read to resolve paths, never the caller's
  // encrypted file contents. So it is ALWAYS tagged `encrypted: false` (no
  // `Codex-Encryptor`, no `Codex-Encryption-Version`), regardless of
  // `params.encrypted`/`encryptorAddress`/`encryptionVersion` applied to the
  // sibling file items above.
  const manifestTags = buildUploadTags({
    ownerAddress,
    contentType: MANIFEST_CONTENT_TYPE,
    itemId: globalThis.crypto.randomUUID(),
    uploadId,
    itemType: "manifest",
    category: params.category,
    assetType: params.assetType,
    appId: params.appId,
    appVersion: params.appVersion,
    encrypted: false,
  });
  // Per the ANS-104/arweave-paths manifest spec, a manifest with no "index"
  // has no default content to resolve to when browsed at its bare id with no
  // trailing path — confirmed 404ing against the live gateway for an
  // already-posted manifest of exactly this (pre-fix) shape. `index` names
  // the FIRST input file's own path as the manifest's default resolution
  // target, so a bare `<manifestId>` link always resolves to real content.
  // `fileIds` is non-empty whenever `params.files` is (this function is only
  // ever reached with 2+ files — see the module doc comment), so `paths[0]`
  // is always defined here.
  const manifestBody = JSON.stringify({
    manifest: MANIFEST_FORMAT,
    version: MANIFEST_VERSION,
    index: { path: fileIds[0]!.path },
    paths,
  });
  const manifestItem = createData(manifestBody, signer, { tags: manifestTags });
  const manifestRawId = await signDataItem(manifestItem, signer);

  const bundle = assembleSignedBundle([
    ...fileItems.map(({ item, rawId }) => ({ item, rawId })),
    { item: manifestItem, rawId: manifestRawId },
  ]);

  // ONE transaction for the whole batch — the fee is quoted/paid once, not
  // per file. `Bundle-Format`/`Bundle-Version` describe the WRAPPING L1
  // transaction and go directly on `postArweaveData`'s `tags`, not through
  // `buildUploadTags` (which tags Codex upload ITEMS, not the bundle carrier).
  await postArweaveData(
    pool,
    {
      jwk: params.jwk,
      data: bundle.getRaw(),
      tags: [
        { name: "Bundle-Format", value: "binary" },
        { name: "Bundle-Version", value: "2.0.0" },
      ],
      maxRewardWinston: params.maxRewardWinston,
    },
    { apiFactory: opts.apiFactory },
  );

  return {
    manifestId: bundle.getIds().at(-1)!,
    fileIds,
    uploadId,
  };
}

/**
 * Packs N already-signed `DataItem`s (each paired with its raw id bytes) into
 * ONE ANS-104 bundle binary — a local reimplementation of `arbundles`' own
 * `bundleAndSignData`'s final assembly step (header-pack + concatenate), used
 * INSTEAD of calling `bundleAndSignData` directly.
 *
 * WHY: `bundleAndSignData`'s own per-item loop is
 * `d.isSigned() ? d.rawId : await sign(d, signer)` — for an item this
 * function already signed (true for every item here), it resolves the
 * header id via `DataItem.rawId`. That getter — and `DataItem.prototype
 * .sign()`'s own internal `return this.rawId` this module used to rely on
 * before this fix — unconditionally calls Node's `crypto.createHash`,
 * REGARDLESS of environment, even though a WebCrypto-only equivalent
 * (`getSignatureAndId`/`getCryptoDriver().hash`, what `signDataItem` uses)
 * already exists. In a bundler's browser build (Vite aliases `crypto` onto a
 * deliberately fail-loud shim — `apps/codex-playground/crypto.shim.ts` —
 * because `arbundles`'/`@dha-team/arbundles`'s web build statically imports
 * Node's `crypto`), reaching `.rawId`/`.id`/`.sign()` on any `DataItem`, or
 * calling `bundleAndSignData` with an already-signed one, throws
 * "node:crypto createHash is unavailable in the browser bundle" — this is
 * NOT confined to a genuinely Node-only stream/async-iterator branch (the
 * shim's own doc comment's premise for `deepHash`/`hashStream`); it is a
 * SEPARATE, always-reached code path reached by every multi-file bundle
 * upload. This function never touches any of those three members, so the
 * resulting bundle is byte-identical to what `bundleAndSignData` itself
 * would have produced, without ever reaching the Node-only getter.
 */
function assembleSignedBundle(items: { item: DataItem; rawId: Buffer }[]): Bundle {
  const headers = new Uint8Array(64 * items.length);
  const binaries: Uint8Array[] = [];
  items.forEach(({ item, rawId }, index) => {
    const header = new Uint8Array(64);
    header.set(longTo32ByteArray(item.getRaw().byteLength), 0);
    header.set(rawId, 32);
    headers.set(header, 64 * index);
    binaries.push(item.getRaw());
  });
  const buffer = Buffer.concat([
    Buffer.from(longTo32ByteArray(items.length)),
    Buffer.from(headers),
    Buffer.concat(binaries),
  ]);
  return new Bundle(buffer);
}
