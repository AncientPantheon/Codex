/**
 * Turbo upload orchestration.
 *
 * `uploadData` validates the jwk, derives the canonical owner address, builds the
 * required tag schema, uploads through an injectable Turbo client seam, validates
 * the returned id, and resolves the data-item id plus applied tags.
 */

import { importKeyfile } from "../keys/keyfile.js";
import { addressOf } from "../keys/address.js";
import { isCanonicalAddress } from "../canonical.js";
import { buildUploadTags } from "./tags.js";
import { InvalidUploadParamsError, UploadFailedError } from "./errors.js";
import type {
  UploadParams,
  UploadResult,
  TurboUploadClientFactory,
} from "./types.js";

/** Options for {@link uploadData} — an injectable client factory for tests/browser. */
export interface UploadOptions {
  /**
   * Override the Turbo client factory. When omitted, `uploadData` LAZILY imports
   * the default factory (`./turboClient.js`) so a code-splitting bundler can drop
   * the SDK's Node build for consumers that always inject a client.
   */
  clientFactory?: TurboUploadClientFactory;
}

function isEmptyData(data: string | Uint8Array): boolean {
  if (typeof data === "string") return data.length === 0;
  if (data instanceof Uint8Array) return data.byteLength === 0;
  return true;
}

/**
 * Uploads a data item to the permaweb through Turbo's bundling service, applying
 * the required Codex tag schema, and resolves the data-item id.
 *
 * WARNING — uploads are PERMANENT and PUBLIC. There is no delete and no edit; the
 * payload AND every tag are stored forever and are world-readable. If privacy is
 * needed, client-side ENCRYPT the payload BEFORE calling this (encryption applies
 * only to the data payload — never to tags). ALL tag names and values (including
 * `appName`, `appMetadata`, and `Codex-Item-Id`) are permanent, public, and
 * GraphQL-indexed/searchable: NEVER place PII or secrets in tags.
 *
 * SECURITY: the jwk is the private key. It goes ONLY to the local signer (via the
 * client factory) — it is never logged, never transmitted, and never placed into
 * an error. Turbo is the sole upload path this spec ships (a base-layer chunked
 * fallback is out of scope).
 *
 * Order of operations: (1) validate the jwk (`InvalidKeyfileError` propagates with
 * ZERO client calls); (2) derive `ownerAddress = await addressOf(jwk)` — THE
 * canonical Codex-Owner value; (3) `itemId = params.itemId ?? crypto.randomUUID()`
 * — `crypto.randomUUID` requires Node >=20 OR a SECURE-CONTEXT browser (https /
 * localhost); non-secure-context callers must pass an explicit `itemId`;
 * (4) build the tag schema (`InvalidUploadParamsError` propagates; empty data is
 * rejected here); (5) upload through the client; (6) validate the response id;
 * (7) resolve `{ id, ownerAddress, itemId, tags, winc? }`.
 */
export async function uploadData(
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
  });

  const clientFactory =
    opts?.clientFactory ??
    (await import("./turboClient.js")).defaultTurboClientFactory;

  const client = clientFactory(jwk);

  let response: { id: string; [k: string]: unknown };
  try {
    response = await client.upload({ data: params.data, dataItemOpts: { tags } });
  } catch (cause) {
    throw new UploadFailedError("upload-rejected", { cause });
  }

  if (typeof response.id !== "string" || !isCanonicalAddress(response.id)) {
    throw new UploadFailedError("bad-response");
  }

  const result: UploadResult = {
    id: response.id,
    ownerAddress,
    itemId,
    tags,
  };
  if (typeof response.winc === "string") {
    result.winc = response.winc;
  }
  return result;
}
