/**
 * `postSplitUploadManifest` — the standalone manifest-only upload primitive
 * (T2 of `arweave-split-bundle-upload`).
 *
 * WHY THIS EXISTS: a bundle's manifest doesn't require its `paths` entries to
 * all come from the SAME bundle — so when a selection too large to fit in one
 * bundle's free-space budget is split into K separate bundle uploads
 * (`planSplitBundles.ts`, T1), one single manifest can still tie every file
 * across every one of those K bundles together as a single browsable upload
 * action, posted as its OWN plain transaction once all K bundles' files are
 * known (`docs/work/arweave-split-bundle-upload/design.md`, step 2).
 *
 * MANIFEST FORMAT — reused VERBATIM from `assembleBundleToFile.ts`'s own
 * inline manifest-building code (its `MANIFEST_CONTENT_TYPE`/
 * `MANIFEST_FORMAT`/`MANIFEST_VERSION`/`manifestBody` block, read in full
 * before writing this module): the same `arweave/paths` format string, the
 * same `"0.2.0"` version field, the same default-resolution convention
 * (`index: { path }` names the FIRST file's path, same as `uploadBundle`'s
 * own bundle manifest), and the same `paths: { [path]: { id } }` shape. This
 * is a SECOND manifest-JSON construction site by necessity (this function has
 * no `BundleAssemblyFile` to write incrementally through, and takes an
 * already-flat `{path, id}[]` list spanning every one of the K bundles
 * rather than one bundle's own files) — never a DIVERGENT format. Any future
 * change to the manifest shape must be made in BOTH places.
 *
 * POSTING PRIMITIVE — `arweave-core`'s `postArweaveData` (`nativeUpload.ts`),
 * NOT `uploadData` (`upload.ts`): `uploadData` always builds its OWN tags
 * internally with `itemType: "file"` and `uploadId: itemId` hardcoded (see
 * that module's own doc comment) — it has no seam for a caller-supplied
 * `itemType: "manifest"` or a caller-supplied shared `uploadId` independent
 * of the item's own id, both of which this function genuinely needs (the
 * manifest must be tagged `itemType: "manifest"` and share the SAME
 * `Codex-Upload-Id` every sibling bundle's files carry, so the whole K+1-
 * transaction sequence reads as one logical upload action). `postArweaveData`
 * is the lower-level primitive both `uploadData` and `uploadBundle` already
 * forward to — it accepts an already-built `tags` list verbatim, posting
 * whatever `buildUploadTags` is given here directly. A manifest is tiny JSON
 * (no file content), so `postArweaveData`'s plain chunked-native-transaction
 * path (not the streaming bundle-assembly machinery) is already the right,
 * simplest fit — no OPFS staging, no Merkle-chunk planning beyond whatever
 * `postArweaveData` already does internally for an ordinary payload.
 *
 * EMPTY FILE LIST — rejected explicitly, not posted as a vacuous "valid"
 * manifest: `assembleBundleToFile`'s own inline manifest-building code reads
 * `fileIds[0]!.path` as its default-resolution target, which has no sound
 * value for an empty list (a real run there is only ever reachable with
 * `params.files.length >= 1`, since a 0-file bundle is never actually built).
 * A manifest with no `index.path` and an empty `paths` map would be
 * structurally "valid" JSON but semantically useless (nothing for a resolver
 * to serve by default, and no upload actually happened) — so this function
 * throws a clear, structured `InvalidUploadParamsError` BEFORE any pool call,
 * rather than inventing a second, divergent "empty manifest" convention the
 * rest of this project has never needed.
 */

import {
  importKeyfile,
  addressOf,
  buildUploadTags,
  postArweaveData,
  InvalidUploadParamsError,
  type ArweaveJwk,
  type GatewayPool,
  type UploadGatewayApiFactory,
} from "@ancientpantheon/arweave-core";

/** Mirrors `assembleBundleToFile.ts`'s own (module-private, so redeclared
 *  here verbatim rather than diverging) manifest content-type/format/version
 *  constants exactly. */
const MANIFEST_CONTENT_TYPE = "application/x.arweave-manifest+json";
const MANIFEST_FORMAT = "arweave/paths";
const MANIFEST_VERSION = "0.2.0";

/** One file to reference in the posted manifest's `paths` map — the flat
 *  list spanning every bundle in a split sequence, not just one bundle's
 *  own files. */
export interface SplitUploadManifestFile {
  /** The file's path relative to the upload root, subfolders preserved —
   *  becomes the manifest's `paths` key verbatim. */
  path: string;
  /** The file's already-posted data item id (base64url) — becomes that
   *  path's `{ id }` entry verbatim. */
  id: string;
}

/** Inputs for {@link postSplitUploadManifest}. */
export interface PostSplitUploadManifestParams {
  /** The uploader's keyfile. The SAME jwk that signed every sibling bundle's
   *  files signs this manifest transaction too. */
  jwk: ArweaveJwk;
  /** Every file across every bundle in the split sequence, in the order the
   *  manifest's `index` default-resolution target is chosen from (the FIRST
   *  entry's path, same convention as the inline bundle manifest). REQUIRED
   *  non-empty — see the module doc comment for why an empty list is
   *  rejected rather than posted as a vacuous manifest. */
  files: SplitUploadManifestFile[];
  /** The shared `Codex-Upload-Id` value every one of the K bundles' files
   *  already carries — generated ONCE by the caller, up front; this function
   *  does not generate it itself, so the whole K+1-transaction sequence
   *  reads as one logical upload action. */
  uploadId: string;
  /** REQUIRED fee cap, in Winston, forwarded verbatim to `postArweaveData` —
   *  same contract as every other primitive in this project: an absent cap
   *  throws before any pool call, a quote exceeding it throws before
   *  signing. */
  maxRewardWinston: bigint;
}

/** Options for {@link postSplitUploadManifest}. */
export interface PostSplitUploadManifestOptions {
  /** The per-endpoint gateway-API factory, forwarded verbatim to
   *  `postArweaveData`. Defaults to `postArweaveData`'s own arweave-js-backed
   *  factory; tests inject a fake — the SAME seam `uploadData`/`uploadBundle`
   *  callers in this package already inject through (`flow.ts`'s own
   *  `UploadAndTrackOptions.apiFactory`). */
  apiFactory?: UploadGatewayApiFactory;
}

/** The result of a successful manifest-only post. */
export interface PostSplitUploadManifestResult {
  /** The posted manifest transaction's canonical id (base64url) — what a
   *  later `runSplitBundleUpload` resolves as the whole split sequence's
   *  final manifest id. */
  manifestId: string;
}

/**
 * Builds the SAME `arweave/paths` manifest JSON format `assembleBundleToFile`
 * builds inline, tags it via `buildUploadTags` with `itemType: "manifest"`
 * and the given, shared `uploadId`, and posts it as its own plain native
 * transaction via `postArweaveData` — see the module doc comment for the
 * full grounding of every one of those choices.
 *
 * @throws {InvalidUploadParamsError} (field `"files"`) if `params.files` is
 *   empty — before any pool call.
 */
export async function postSplitUploadManifest(
  pool: GatewayPool,
  params: PostSplitUploadManifestParams,
  opts: PostSplitUploadManifestOptions = {},
): Promise<PostSplitUploadManifestResult> {
  const jwk = importKeyfile(params.jwk);

  if (params.files.length === 0) {
    throw new InvalidUploadParamsError(
      "files",
      "empty-file-list",
      "postSplitUploadManifest requires at least one file — an empty manifest has no default resolution target.",
    );
  }

  const ownerAddress = await addressOf(jwk);

  // Same construction as assembleBundleToFile's own inline manifest: the
  // FIRST file's path is the default-resolution target, every file's path
  // maps to its own `{ id }` entry.
  const paths: Record<string, { id: string }> = {};
  for (const entry of params.files) {
    paths[entry.path] = { id: entry.id };
  }
  const manifestBody = JSON.stringify({
    manifest: MANIFEST_FORMAT,
    version: MANIFEST_VERSION,
    index: { path: params.files[0]!.path },
    paths,
  });

  const tags = buildUploadTags({
    ownerAddress,
    contentType: MANIFEST_CONTENT_TYPE,
    itemId: globalThis.crypto.randomUUID(),
    uploadId: params.uploadId,
    itemType: "manifest",
    // The manifest item is ALWAYS public — same rule `assembleBundleToFile`'s
    // own inline manifest tagging applies, regardless of whether the sibling
    // FILE items across the split sequence were encrypted.
    encrypted: false,
  });

  const posted = await postArweaveData(
    pool,
    {
      jwk: params.jwk,
      data: manifestBody,
      tags,
      maxRewardWinston: params.maxRewardWinston,
    },
    { apiFactory: opts.apiFactory },
  );

  return { manifestId: posted.id };
}
