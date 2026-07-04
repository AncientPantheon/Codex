/**
 * Upload surface types + the Turbo client mock seam.
 *
 * The seam (`TurboUploadClient` + `TurboUploadClientFactory`) is typed against
 * OUR narrow structural interface, NOT `@ardrive/turbo-sdk` types — so tests can
 * inject a plain recording object and never import the SDK, and so the upload
 * orchestrator depends on a minimal contract rather than the whole SDK surface.
 */

import type { ArweaveJwk } from "../keys/types.js";
import type { Tag } from "./tags.js";

/**
 * Caller input for {@link uploadData}.
 *
 * `data` is narrowed to `string | Uint8Array` — the two payload forms portable
 * across Node and browsers without `Buffer`. `itemId` defaults to a generated
 * UUID; `appName` defaults to `DEFAULT_APP_NAME`; `appMetadata` is appended after
 * the required tag schema in caller order.
 */
export interface UploadParams {
  /** The uploader's keyfile. Validated via `importKeyfile`; goes only to the local signer. */
  jwk: ArweaveJwk;
  /** The payload to upload. Must be a non-empty string or Uint8Array. */
  data: string | Uint8Array;
  /** MIME type — becomes the Content-Type tag. */
  contentType: string;
  /** Optional Codex-Item-Id; defaults to a generated UUID. */
  itemId?: string;
  /** Optional App-Name override; defaults to `DEFAULT_APP_NAME`. */
  appName?: string;
  /** Optional app metadata tags, appended after the required four in order. */
  appMetadata?: readonly Tag[];
}

/**
 * Result of a successful {@link uploadData} call.
 *
 * `id` is the Turbo data-item id (the tx-equivalent id a consumer persists);
 * `ownerAddress` is `addressOf(jwk)` — the exact value the Codex-Owner tag
 * carries; `itemId` is the id (supplied or generated) also present in the
 * Codex-Item-Id tag; `tags` is the full applied tag list. `winc` is an optional
 * pass-through of the credits the upload cost, when the client reports it.
 */
export interface UploadResult {
  /** The Turbo data-item id — canonical 43-char base64url. */
  id: string;
  /** The uploader's canonical 43-char address (Codex-Owner value, verbatim). */
  ownerAddress: string;
  /** The Codex-Item-Id used for this upload (supplied or generated). */
  itemId: string;
  /** The full tag list applied to the upload. */
  tags: Tag[];
  /** Optional credits-spent pass-through from the Turbo response, when present. */
  winc?: string;
}

/**
 * Narrow structural contract for a Turbo upload client — exactly the surface
 * `uploadData` needs. The default factory adapts a real `TurboAuthenticatedClient`
 * to this shape; tests inject a plain recording object satisfying it.
 */
export interface TurboUploadClient {
  upload(p: {
    data: string | Uint8Array;
    dataItemOpts: { tags: Tag[] };
  }): Promise<{ id: string; [k: string]: unknown }>;
}

/** Builds a {@link TurboUploadClient} from a jwk. Injectable via `uploadData` opts. */
export type TurboUploadClientFactory = (jwk: ArweaveJwk) => TurboUploadClient;
