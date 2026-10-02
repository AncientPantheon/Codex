/**
 * Native upload orchestration.
 *
 * `uploadData` validates the jwk, derives the canonical owner address, builds the
 * required tag schema, posts the payload as a native (non-bundler) Arweave
 * transaction through T3's `postArweaveData` (`nativeUpload.ts`) — chunked-upload
 * through the gateway pool, no bundler service involved — and resolves the
 * signed transaction id plus applied tags.
 */

import { importKeyfile } from "../keys/keyfile.js";
import { addressOf } from "../keys/address.js";
import { buildUploadTags } from "./tags.js";
import { InvalidUploadParamsError } from "./errors.js";
import { postArweaveData } from "./nativeUpload.js";
import type { UploadGatewayApiFactory } from "./nativeUpload.js";
import type { GatewayPool } from "../gateway/types.js";
import type { UploadParams, UploadResult } from "./types.js";

/** Options for {@link uploadData} — an injectable gateway-API factory for tests. */
export interface UploadOptions {
  /**
   * Override the per-endpoint gateway-API factory `postArweaveData` uses.
   * When omitted, `postArweaveData` builds its own default arweave-js-backed
   * factory. Tests inject a fake — exactly as `tests/tx-transfer.test.ts` and
   * `tests/upload-native.test.ts` already do — so no test ever touches a real
   * network.
   */
  apiFactory?: UploadGatewayApiFactory;
}

function isEmptyData(data: string | Uint8Array): boolean {
  if (typeof data === "string") return data.length === 0;
  if (data instanceof Uint8Array) return data.byteLength === 0;
  return true;
}

/**
 * Uploads a data item to the permaweb as a native Arweave transaction, applying
 * the required Codex tag schema, and resolves the signed transaction's id.
 *
 * WARNING — uploads are PERMANENT and PUBLIC. There is no delete and no edit; the
 * payload AND every tag are stored forever and are world-readable. If privacy is
 * needed, client-side ENCRYPT the payload BEFORE calling this (encryption applies
 * only to the data payload — never to tags). ALL tag names and values (including
 * `appName`, `appMetadata`, and `Codex-Item-Id`) are permanent, public, and
 * GraphQL-indexed/searchable: NEVER place PII or secrets in tags.
 *
 * SECURITY: the jwk is the private key. It goes ONLY to the local signer — it is
 * never logged, never transmitted, and never placed into an error.
 *
 * Order of operations: (1) validate the jwk (`InvalidKeyfileError` propagates with
 * ZERO pool calls); (2) derive `ownerAddress = await addressOf(jwk)` — THE
 * canonical Codex-Owner value; (3) `itemId = params.itemId ?? crypto.randomUUID()`
 * — `crypto.randomUUID` requires Node >=20 OR a SECURE-CONTEXT browser (https /
 * localhost); non-secure-context callers must pass an explicit `itemId`;
 * (4) build the tag schema (`InvalidUploadParamsError` propagates; empty data is
 * rejected here) with `uploadId: itemId` and `itemType: "file"` — a single-file
 * upload's own item id also groups it as its own one-item upload action —
 * forwarding `params.category` (REQUIRED, T2), `assetType`/`appId`/`appVersion`
 * (optional), and `encrypted` (REQUIRED, T4)/`encryptorAddress`/
 * `encryptionVersion` (optional at this type, but `buildUploadTags` requires
 * `encryptionVersion` whenever `encrypted === true`) verbatim to
 * `buildUploadTags`, whose own validation applies;
 * (5) post the payload as a native transaction via `postArweaveData` (T3) — its
 * own typed errors (`RewardExceedsCapError`, `InvalidUploadParamsError` for a
 * missing fee cap, `GatewayPoolExhaustedError`, `UnsupportedEndpointError`)
 * propagate UNWRAPPED, exactly as `sendTransfer`'s callers already rely on;
 * (6) resolve `{ id, ownerAddress, itemId, tags }`.
 */
export async function uploadData(
  pool: GatewayPool,
  params: UploadParams,
  opts?: UploadOptions,
): Promise<UploadResult> {
  const jwk = importKeyfile(params.jwk);

  const ownerAddress = await addressOf(jwk);

  if (isEmptyData(params.data)) {
    throw new InvalidUploadParamsError(
      "data",
      "empty-or-non-buffer",
      "data must be a non-empty string or Uint8Array.",
    );
  }

  const itemId = params.itemId ?? globalThis.crypto.randomUUID();

  const tags = buildUploadTags({
    ownerAddress,
    contentType: params.contentType,
    itemId,
    appName: params.appName,
    appMetadata: params.appMetadata,
    uploadId: itemId,
    itemType: "file",
    category: params.category,
    assetType: params.assetType,
    appId: params.appId,
    appVersion: params.appVersion,
    encrypted: params.encrypted,
    encryptorAddress: params.encryptorAddress,
    encryptionVersion: params.encryptionVersion,
  });

  const posted = await postArweaveData(
    pool,
    {
      jwk: params.jwk,
      data: params.data,
      tags,
      maxRewardWinston: params.maxRewardWinston,
    },
    { apiFactory: opts?.apiFactory },
  );

  return {
    id: posted.id,
    ownerAddress,
    itemId,
    tags,
  };
}
