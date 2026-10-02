/**
 * Dedicated codex-backup upload primitive.
 *
 * `uploadCodexBackup` is a thin, hardcoded-category wrapper around `uploadData`
 * (T2): it posts the caller's `exportJson` string as the payload, tagged
 * `Content-Type: application/json` and `Codex-Category: codex-backup`.
 *
 * `exportJson` is treated as an OPAQUE string — this module has ZERO knowledge
 * of codex internals and MUST NOT import from any `codex-*` package (that
 * boundary is load-bearing across this monorepo: `arweave-core` stays a
 * framework/app-agnostic protocol library). Producing the export string is the
 * caller's job (a later task, in `codex-arweave`, via the codex's own existing
 * export flow).
 *
 * `"codex-backup"` is hardcoded HERE and only here — `UploadCodexBackupParams`
 * deliberately has no `category` field, so no caller of `uploadCodexBackup` can
 * override it. `assetType` does not apply to a codex-backup upload and is
 * likewise absent from this params type. `appId`/`appVersion` DO apply (real
 * version lineage across a codex's own backup history) — both are OPTIONAL
 * passthroughs, forwarded verbatim to `uploadData`, never derived or
 * validated here. `appMetadata` is likewise an OPTIONAL pure passthrough
 * (T2, `codex-recovery-backup-tagging`) — the seam a caller uses to attach
 * arbitrary app-level tags (e.g. the `Codex-Backup-Recovery-Key` tag) to the
 * same codex-backup upload; this module forwards it verbatim, with zero
 * knowledge of what any entry means.
 */

import { uploadData } from "./upload.js";
import type { UploadOptions } from "./upload.js";
import type { UploadResult } from "./types.js";
import type { ArweaveJwk } from "../keys/types.js";
import type { GatewayPool } from "../gateway/types.js";
import type { Tag } from "./tags.js";

/** Caller input for {@link uploadCodexBackup}. No `category` field — the
 *  category is fixed internally to `"codex-backup"`, never caller-supplied. */
export interface UploadCodexBackupParams {
  /** The uploader's keyfile. Forwarded verbatim to `uploadData`. */
  jwk: ArweaveJwk;
  /** The codex export payload, as an opaque JSON string. Forwarded verbatim
   *  as `uploadData`'s `data`. */
  exportJson: string;
  /** REQUIRED fee cap, in Winston. Forwarded verbatim to `uploadData`. */
  maxRewardWinston: bigint;
  /** Optional Codex-App-Id passthrough — a stable identifier reused across a
   *  codex's own backup history, forwarded verbatim to `uploadData`. Omitted
   *  entirely (no tag) when not provided. */
  appId?: string;
  /** Optional Codex-App-Version passthrough — a free-text label on this
   *  specific backup, forwarded verbatim to `uploadData`. Omitted entirely
   *  (no tag) when not provided. */
  appVersion?: string;
  /** Optional app-metadata tags, forwarded verbatim to `uploadData`'s own
   *  `appMetadata` passthrough — appended after the required + category tag
   *  schema, in caller order. This is the seam `codex-arweave`'s
   *  `backupCodexToLibrary` uses to attach the `Codex-Backup-Recovery-Key`
   *  tag (`codex-recovery-backup-tagging` T2); this module has zero
   *  knowledge of that tag's name or meaning — it is just another metadata
   *  entry to this pure passthrough. Omitted entirely (no extra tags) when
   *  not provided. */
  appMetadata?: readonly Tag[];
}

/**
 * Uploads a codex export as a permanent, `codex-backup`-categorized Arweave
 * upload. Delegates entirely to `uploadData`, hardcoding `contentType:
 * "application/json"` and `category: "codex-backup"`; `jwk`, `maxRewardWinston`,
 * `appId`, `appVersion`, `appMetadata`, and `opts` (the injectable `apiFactory`
 * test seam) pass through verbatim — an omitted `appId`/`appVersion`/
 * `appMetadata` forwards as `undefined`, so `uploadData`/`buildUploadTags` emit
 * no tag at all for it.
 *
 * See `uploadData`'s own doc comment for the full permanence/security warnings
 * (payload AND tags are permanent, public, and GraphQL-indexed) — they apply
 * identically here.
 */
export async function uploadCodexBackup(
  pool: GatewayPool,
  params: UploadCodexBackupParams,
  opts?: UploadOptions,
): Promise<UploadResult> {
  return uploadData(
    pool,
    {
      jwk: params.jwk,
      data: params.exportJson,
      contentType: "application/json",
      category: "codex-backup",
      // Never encrypted by this composition: the payload is already ciphertext
      // from the codex's own existing export cipher (the codex password), and
      // layering this feature's separate Ouronet-account encryption on top
      // would mean needing BOTH secrets to ever recover it — more fragile, not
      // more secure. `encrypted` is REQUIRED on `UploadParams` (no implicit
      // default), so this is stated explicitly rather than omitted.
      encrypted: false,
      maxRewardWinston: params.maxRewardWinston,
      appId: params.appId,
      appVersion: params.appVersion,
      appMetadata: params.appMetadata,
    },
    opts,
  );
}
