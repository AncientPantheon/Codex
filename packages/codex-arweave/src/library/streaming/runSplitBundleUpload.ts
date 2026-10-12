/**
 * `runSplitBundleUpload` — the multi-bundle sequential orchestration engine
 * (T4 of `arweave-split-bundle-upload`).
 *
 * Composes, never rebuilds, every prerequisite piece this topic already
 * landed:
 *   - T1 (`planSplitBundles.ts`) — `checkAvailableStorageBudget`/
 *     `planSplitBundles` compute the K-way file grouping, ONCE, up front.
 *   - T2 (`postSplitUploadManifest.ts`) — posts the ONE shared manifest once
 *     every bundle's files are known.
 *   - T3 (`splitUploadPlanStore.ts`) — persists the computed grouping and
 *     each bundle's completion state, so a reload never recomputes/
 *     reshuffles which files belong to which bundle (`design.md` §3).
 *   - The EXISTING, unmodified per-bundle engine (`uploadBundleStreaming.ts`/
 *     `streamingPost.ts`) — every bundle actually runs through this,
 *     untouched.
 *
 * ORCHESTRATION (`design.md` §3, `plan.md` T4 steps 1-5):
 *   1. Reuse the persisted plan verbatim if one already exists for
 *      `opts.uploadId` (a resumed run); otherwise compute it fresh via T1
 *      and persist it (step 2) BEFORE bundle 0 starts.
 *   2. Walk bundles 0..K-1 IN ORDER, NEVER CONCURRENTLY (a plain
 *      sequential `for` loop with `await` — concurrency is structurally
 *      impossible, not merely avoided by convention).
 *   3. A bundle already marked complete in the persisted record is SKIPPED
 *      ENTIRELY — its persisted file-id list is reused verbatim, the
 *      per-bundle engine is never touched again for it.
 *   4. A bundle NOT yet complete runs via {@link resumeOrRunBundle} below —
 *      see that function's own doc comment for the fresh-vs-resumed branch.
 *      Its completion (file-id list) is persisted to T3's store
 *      IMMEDIATELY, before the next bundle starts.
 *   5. Once every bundle is complete, `postSplitUploadManifest` (T2) posts
 *      the ONE shared manifest over every bundle's flattened file list, and
 *      the plan record is deleted (mirrors the per-bundle resume store's
 *      own "delete on completion" discipline, one level up).
 *
 * IN-FLIGHT BUNDLE RESUME — THE REAL GAP, HONESTLY FLAGGED, NOT SILENTLY
 * WORKED AROUND: `design.md`'s own acceptance criteria require "the
 * in-flight bundle resumes from its real last checkpoint" (never re-signing,
 * never re-posting an already-successful chunk) across a genuine process
 * restart — which is exactly what `streamingPost.ts`'s OWN, separate
 * `resumeStreamingPost` entry point exists for (see that function's doc
 * comment: "never re-signing, never re-reading an already-posted chunk's
 * bytes, never re-posting it" — `uploadBundleStreaming` itself has NO such
 * check; calling it again plainly always re-assembles AND RE-SIGNS from
 * scratch, confirmed by reading it in full). But `resumeStreamingPost`
 * resolves only `{id, data_root, reward}` — the WRAPPING transaction's own
 * fields, never the bundle's per-file ids `postSplitUploadManifest` needs,
 * and `AssembleBundleToFileResult.fileIds` is NOT re-derivable by
 * re-assembling (ANS-104 signing is randomized — RSA-PSS — so a fresh
 * `assembleBundleToFile` call produces DIFFERENT ids for the "same" files,
 * which would no longer match the bytes already posted under the
 * already-signed, in-flight transaction `resumeStreamingPost` continues).
 *
 * The fix, additive and narrow, touching neither `uploadBundleStreaming.ts`
 * nor `streamingPost.ts`: {@link readAssembledBundleItemIds} reads a
 * resumed bundle's real item ids directly out of its own OPFS file's
 * already-backfilled header region (see `assembleBundleToFile.ts`'s "THE
 * LAYOUT" doc comment for the exact byte layout reused here — a SECOND,
 * by-necessity format-READING site, mirroring `postSplitUploadManifest.ts`'s
 * own doc comment on being a second, by-necessity manifest-WRITING site for
 * the identical underlying reason: no other seam exposes this data to a
 * caller that never itself ran the signing). This is safe to read whenever
 * a resume record already exists for that bundle: `assembleBundleToFile`
 * ALWAYS fully backfills this header before `streamingPostBundle` ever
 * writes its first checkpoint (checkpoint writes only start once the
 * wrapping tx itself has posted, which happens strictly after assembly
 * completes) — so an existing resume record is itself proof the header is
 * complete and safe to read.
 */

import {
  type ArweaveJwk,
  type UploadCategory,
  type NftAssetType,
  type GatewayPool,
  type UploadBundleResult,
  type StreamingUploadGatewayApiFactory,
  type UploadGatewayApiFactory,
} from "@ancientpantheon/arweave-core";

import {
  checkAvailableStorageBudget,
  planSplitBundles,
  type CheckAvailableStorageBudgetOptions,
} from "./planSplitBundles.js";
import {
  postSplitUploadManifest,
  type SplitUploadManifestFile,
} from "./postSplitUploadManifest.js";
import {
  SplitUploadPlanStore,
  type SplitUploadPlanRecord,
} from "./splitUploadPlanStore.js";
import { uploadBundleStreaming } from "./uploadBundleStreaming.js";
import type { AssembleBundleToFileInput } from "./assembleBundleToFile.js";
import { resumeStreamingPost } from "./streamingPost.js";
import {
  openOpfsBundleAssemblyFile,
  type BundleAssemblyFile,
} from "./bundleAssemblyFile.js";
import type { StreamingPostResumeStore } from "./streamingPostResumeStore.js";

/** One input file: `planSplitBundles`'s own `{path, size}` planning input,
 *  PLUS everything `assembleBundleToFile` needs to actually read and sign
 *  it — the two concerns `planSplitBundles.ts` deliberately keeps
 *  independent (pure planning vs. lazy, I/O-bearing content) are reunited
 *  here, at the one layer that genuinely needs both. */
export interface SplitBundleUploadFile extends AssembleBundleToFileInput {
  /** The file's byte size — the ONLY thing T1's planner needs; never read
   *  from `readData()` up front (that would defeat the whole point of the
   *  lazy seam one layer down). */
  size: number;
}

/** Inputs for {@link runSplitBundleUpload} — mirrors
 *  `UploadBundleStreamingParams` field-for-field for every per-upload-action
 *  tag input, applied identically to every one of the K bundles (same rule
 *  `uploadBundleStreaming` itself already applies within one bundle). */
export interface RunSplitBundleUploadParams {
  /** The uploader's keyfile. The SAME jwk signs every bundle's items and
   *  the final shared manifest. Re-supplied fresh on every call (including a
   *  resumed one) — never persisted, same discipline every sibling store in
   *  this package already holds to. */
  jwk: ArweaveJwk;
  /** The WHOLE selection, re-supplied fresh on every call — including a
   *  resumed one, where a file whose bundle has already completed (or is
   *  mid-resume) is simply never read again. */
  files: SplitBundleUploadFile[];
  /** REQUIRED fee cap, in Winston — forwarded verbatim to every bundle's
   *  `uploadBundleStreaming`/`resumeStreamingPost` call AND to the final
   *  `postSplitUploadManifest` call. */
  maxRewardWinston: bigint;
  /** REQUIRED Codex-Category — applied identically to every bundle. */
  category: UploadCategory;
  /** Optional Codex-Asset-Type. */
  assetType?: NftAssetType;
  /** Optional Codex-App-Id. */
  appId?: string;
  /** Optional Codex-App-Version. */
  appVersion?: string;
  /** REQUIRED Codex-Encrypted, applied to every FILE item across every
   *  bundle. */
  encrypted: boolean;
  /** Optional Codex-Encryptor. */
  encryptorAddress?: string;
  /** Optional Codex-Encryption-Version. */
  encryptionVersion?: string;
  /** The already-derived AES key, if encrypting. */
  encryptionKey?: CryptoKey;
}

/** Options for {@link runSplitBundleUpload}. */
export interface RunSplitBundleUploadOptions {
  /** The gateway pool every bundle AND the final manifest post through. */
  pool: GatewayPool;
  /** T3's plan store — persists the K-way grouping and per-bundle
   *  completion state. */
  planStore: SplitUploadPlanStore;
  /** The REAL per-bundle resume-checkpoint store — forwarded verbatim to
   *  every `uploadBundleStreaming`/`resumeStreamingPost` call, NEVER
   *  bypassed/mocked (same discipline `uploadBundleStreaming` itself already
   *  documents for its own callers). */
  resumeStore: StreamingPostResumeStore;
  /** This upload action's shared `Codex-Upload-Id` — the SAME value a
   *  resumed call must pass again to reuse its persisted plan. Defaults to
   *  a freshly generated id (a brand-new upload). */
  uploadId?: string;
  /** The safe per-attempt byte budget T1's planner partitions against.
   *  Supplying this directly BYPASSES `checkAvailableStorageBudget`
   *  entirely — the real/default path calls that (via `opts.estimate`)
   *  instead. An explicit override is a genuinely reasonable production
   *  knob too (e.g. a caller that already showed the computed plan to the
   *  user and let them confirm it), not merely a test seam. */
  budgetBytes?: number;
  /** Forwarded to `checkAvailableStorageBudget` when `budgetBytes` is
   *  omitted — injectable `navigator.storage.estimate()` fake, mirroring
   *  that module's own seam. */
  estimate?: CheckAvailableStorageBudgetOptions["estimate"];
  /** Per-endpoint streaming gateway-API factory, forwarded verbatim to every
   *  bundle's `uploadBundleStreaming`/`resumeStreamingPost` call. */
  apiFactory?: StreamingUploadGatewayApiFactory;
  /** Per-endpoint PLAIN (non-streaming) gateway-API factory, forwarded
   *  verbatim to the final `postSplitUploadManifest` call — a DIFFERENT
   *  seam/type than `apiFactory` above (manifest posting never goes through
   *  the streaming/chunked path; see `postSplitUploadManifest.ts`'s own doc
   *  comment for why). */
  manifestApiFactory?: UploadGatewayApiFactory;
  /** Opens a bundle's OPFS assembly file by name, forwarded to every
   *  bundle's engine call AND to this module's own header-read (the ONE
   *  extra, read-only open this module itself ever performs — see the
   *  module doc comment's "IN-FLIGHT BUNDLE RESUME" section). Defaults to
   *  the real `openOpfsBundleAssemblyFile`; tests inject a fake. */
  openFile?: (fileName: string) => Promise<BundleAssemblyFile>;
  /** Deletes a bundle's OPFS file by name on completion — forwarded
   *  verbatim to every bundle's engine call. */
  deleteFile?: (fileName: string) => Promise<void>;
  /** Whether to delete a bundle's OPFS file on its own completion —
   *  forwarded verbatim to every bundle's engine call. Defaults to `true`
   *  (that engine's own default). */
  deleteFileOnComplete?: boolean;
  /** Whole-sequence progress — called from inside whichever bundle is
   *  currently running, wrapping that bundle's own chunk-level `onProgress`
   *  (never replacing it). `overallBytesUploaded` is the sum of every
   *  already-complete bundle's own byte total plus the CURRENT bundle's
   *  in-flight proportion (`bundleUploadedChunks / bundleTotalChunks` of
   *  its own total) — never resets to 0 at a bundle boundary. Never called
   *  for a bundle that was skipped because it was already complete before
   *  this call started (nothing new to report for it). */
  onOverallProgress?: (
    bundleIndex: number,
    totalBundles: number,
    bundleUploadedChunks: number,
    bundleTotalChunks: number,
    overallBytesUploaded: number,
    overallTotalBytes: number,
  ) => void;
}

/** The result of a full, successful split-bundle upload. */
export interface RunSplitBundleUploadResult {
  /** The ONE shared manifest's posted transaction id (`postSplitUploadManifest`,
   *  T2) — referencing every file across every bundle. */
  manifestId: string;
  /** Each bundle's own result, for every bundle THIS call actually ran
   *  (freshly or resumed) — in bundle-index order. A bundle already
   *  complete BEFORE this call started (skipped entirely, never re-touched)
   *  is deliberately NOT reconstructed into this array: its files are still
   *  correctly included in the posted manifest (`manifestId` above), but
   *  this package's "no-sign/no-post" guarantee for an already-complete
   *  bundle (`design.md`) extends to never even FABRICATING a redundant
   *  result for it. */
  bundleResults: UploadBundleResult[];
}

/** Thrown when T1's planner reports one or more files individually larger
 *  than the per-bundle budget (`planSplitBundles`'s own `oversizedFiles`) —
 *  surfaced explicitly, BEFORE any plan is persisted or any bundle starts,
 *  rather than silently dropping those files from the upload (`design.md`'s
 *  own explicit "a clear warning surfaced rather than a silent failure or a
 *  crash" requirement for this known, out-of-scope-to-fix edge case). */
export class OversizedFilesError extends Error {
  constructor(public readonly oversizedFiles: { path: string; size: number }[]) {
    super(
      `runSplitBundleUpload: ${oversizedFiles.length} file(s) individually exceed the per-bundle budget and cannot be split: ${oversizedFiles
        .map((f) => f.path)
        .join(", ")}`,
    );
    this.name = "OversizedFilesError";
  }
}

/** Base64url-encodes a raw 32-byte ANS-104 item id read directly off an
 *  assembled bundle's own header — mirrors `assembleBundleToFile.ts`'s own
 *  LOCAL `base64url` helper verbatim (a SECOND, by-necessity copy; see this
 *  module's own doc comment for why). */
function base64urlFromRawId(rawId: Uint8Array): string {
  return Buffer.from(rawId)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Reads every item's (files, then the manifest, in that order) real,
 * already-signed id directly out of an ALREADY-FULLY-ASSEMBLED bundle
 * file's own header region — see this module's own doc comment for why
 * this is safe and necessary. Layout mirrors `assembleBundleToFile.ts`'s
 * own backfill exactly: 32 bytes item count + 64 bytes per item (32-byte
 * length, 32-byte raw id); this reads only the 32-byte raw id of each of
 * the first `itemCount` items, at `64 * (index + 1)`.
 */
async function readAssembledBundleItemIds(
  file: BundleAssemblyFile,
  itemCount: number,
): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < itemCount; index++) {
    const rawId = await file.read(64 * (index + 1), 32);
    ids.push(base64urlFromRawId(rawId));
  }
  return ids;
}

/** This bundle's deterministic resume-id/file-name pair — purely derived
 *  from `uploadId` + bundle index on EVERY call (fresh or resumed), never
 *  itself persisted (T3's own doc comment's own "derives it deterministically
 *  and purely... so it never needs to be durable state of its own"). */
function bundlePlumbing(uploadId: string, bundleIndex: number): { resumeId: string; fileName: string } {
  const resumeId = `${uploadId}--bundle-${bundleIndex}`;
  return { resumeId, fileName: `split-bundle-${resumeId}.bin` };
}

/**
 * Runs (or resumes) exactly one not-yet-complete bundle, returning its
 * `UploadBundleResult`. Two branches:
 *   - NO existing resume record for this bundle's id: a fresh run — calls
 *     the EXISTING, unmodified `uploadBundleStreaming` plainly, exactly as
 *     any other caller would.
 *   - An existing resume record: this bundle's wrapping transaction already
 *     posted (and its OPFS file's header is therefore already complete —
 *     see the module doc comment) during an earlier, interrupted attempt.
 *     Recovers its real item ids directly from that header, then continues
 *     posting via `resumeStreamingPost` — the per-bundle engine's OWN
 *     dedicated resume entry point — never re-signing, never re-posting an
 *     already-successful chunk.
 */
async function resumeOrRunBundle(
  bundleFiles: SplitBundleUploadFile[],
  resumeId: string,
  fileName: string,
  params: RunSplitBundleUploadParams,
  opts: RunSplitBundleUploadOptions,
  onProgress: (uploadedChunks: number, totalChunks: number) => void,
): Promise<UploadBundleResult> {
  const openFile = opts.openFile ?? ((name: string) => openOpfsBundleAssemblyFile(name));

  const existing = await opts.resumeStore.load(resumeId);
  if (existing !== null) {
    const headerFile = await openFile(existing.fileName);
    let itemIds: string[];
    try {
      itemIds = await readAssembledBundleItemIds(headerFile, bundleFiles.length + 1);
    } finally {
      await headerFile.close();
    }
    const fileIds = bundleFiles.map((f, i) => ({ path: f.path, id: itemIds[i]! }));
    const manifestId = itemIds[bundleFiles.length]!;

    await resumeStreamingPost(resumeId, opts.pool, {
      store: opts.resumeStore,
      apiFactory: opts.apiFactory,
      onProgress,
      openFile,
      deleteFile: opts.deleteFile,
      deleteFileOnComplete: opts.deleteFileOnComplete,
    });

    return { manifestId, fileIds, uploadId: resumeId };
  }

  return uploadBundleStreaming(
    {
      jwk: params.jwk,
      files: bundleFiles,
      maxRewardWinston: params.maxRewardWinston,
      category: params.category,
      assetType: params.assetType,
      appId: params.appId,
      appVersion: params.appVersion,
      encrypted: params.encrypted,
      encryptorAddress: params.encryptorAddress,
      encryptionVersion: params.encryptionVersion,
      encryptionKey: params.encryptionKey,
    },
    {
      pool: opts.pool,
      resumeStore: opts.resumeStore,
      apiFactory: opts.apiFactory,
      openFile,
      deleteFile: opts.deleteFile,
      deleteFileOnComplete: opts.deleteFileOnComplete,
      onProgress,
      resumeId,
      fileName,
    },
  );
}

/**
 * Runs a (possibly resumed) multi-bundle split upload end to end — see the
 * module doc comment for the full step-by-step grounding.
 *
 * @throws {OversizedFilesError} if T1's planner reports any file
 *   individually larger than the computed budget — before any plan is
 *   persisted or any bundle starts.
 */
export async function runSplitBundleUpload(
  params: RunSplitBundleUploadParams,
  opts: RunSplitBundleUploadOptions,
): Promise<RunSplitBundleUploadResult> {
  const uploadId = opts.uploadId ?? globalThis.crypto.randomUUID();

  // (1) Reuse the persisted plan verbatim for a resumed run; otherwise
  // compute it fresh via T1 and (2) persist it BEFORE bundle 0 starts.
  let planRecord = await opts.planStore.load(uploadId);
  if (planRecord === null) {
    const budgetBytes =
      opts.budgetBytes ??
      (await checkAvailableStorageBudget({ estimate: opts.estimate })).safeBudgetBytes;
    const plan = planSplitBundles(
      params.files.map((f) => ({ path: f.path, size: f.size })),
      budgetBytes,
    );
    if (plan.oversizedFiles.length > 0) {
      throw new OversizedFilesError(plan.oversizedFiles);
    }
    const freshRecord: SplitUploadPlanRecord = {
      uploadId,
      bundles: plan.bundles,
      completedBundleFileIds: plan.bundles.map(() => null),
    };
    await opts.planStore.save(freshRecord);
    planRecord = freshRecord;
  }

  const filesByPath = new Map(params.files.map((f) => [f.path, f]));
  const bundleByteTotals = planRecord.bundles.map((bundle) =>
    bundle.reduce((sum, f) => sum + f.size, 0),
  );
  const overallTotalBytes = bundleByteTotals.reduce((sum, n) => sum + n, 0);
  const totalBundles = planRecord.bundles.length;

  let completedBytesSoFar = planRecord.completedBundleFileIds.reduce(
    (sum, fileIds, i) => (fileIds !== null ? sum + bundleByteTotals[i]! : sum),
    0,
  );

  const bundleResults: UploadBundleResult[] = [];
  const allFileIds: SplitUploadManifestFile[] = [];

  // (3)+(4) Walk every bundle IN ORDER, NEVER CONCURRENTLY — a plain
  // sequential loop; the next iteration's `await` never starts until this
  // one's promise has settled.
  for (let i = 0; i < totalBundles; i++) {
    const alreadyComplete = planRecord.completedBundleFileIds[i];
    if (alreadyComplete !== null) {
      // Already complete (this call or an earlier one) — skipped entirely,
      // no re-sign, no re-post, its persisted file-id list reused verbatim.
      allFileIds.push(...alreadyComplete);
      continue;
    }

    const plannedFiles = planRecord.bundles[i]!;
    const bundleFiles: SplitBundleUploadFile[] = plannedFiles.map((f) => {
      const input = filesByPath.get(f.path);
      if (!input) {
        throw new Error(
          `runSplitBundleUpload: no content supplied for planned file "${f.path}" — every file in the persisted plan must be re-supplied on every call, including a resumed one.`,
        );
      }
      return input;
    });
    const bundleTotalBytes = bundleByteTotals[i]!;
    const { resumeId, fileName } = bundlePlumbing(uploadId, i);

    const bundleResult = await resumeOrRunBundle(
      bundleFiles,
      resumeId,
      fileName,
      params,
      opts,
      (uploadedChunks, totalChunks) => {
        const inFlightBytes =
          totalChunks > 0 ? Math.round((uploadedChunks / totalChunks) * bundleTotalBytes) : 0;
        opts.onOverallProgress?.(
          i,
          totalBundles,
          uploadedChunks,
          totalChunks,
          completedBytesSoFar + inFlightBytes,
          overallTotalBytes,
        );
      },
    );

    // Persist this bundle's completion IMMEDIATELY, before the next bundle
    // starts — never recomputed/reshuffled, and a crash right after this
    // point correctly leaves the NEXT bundle as the resume point.
    planRecord = {
      ...planRecord,
      completedBundleFileIds: planRecord.completedBundleFileIds.map((v, idx) =>
        idx === i ? bundleResult.fileIds : v,
      ),
    };
    await opts.planStore.save(planRecord);

    completedBytesSoFar += bundleTotalBytes;
    allFileIds.push(...bundleResult.fileIds);
    bundleResults.push(bundleResult);
  }

  // (5) Every bundle complete — post the ONE shared manifest, then clean up
  // the plan record (mirrors the per-bundle resume store's own "delete on
  // completion" discipline, one level up).
  const manifestResult = await postSplitUploadManifest(
    opts.pool,
    {
      jwk: params.jwk,
      files: allFileIds,
      uploadId,
      maxRewardWinston: params.maxRewardWinston,
    },
    { apiFactory: opts.manifestApiFactory },
  );

  await opts.planStore.delete(uploadId);

  return { manifestId: manifestResult.manifestId, bundleResults };
}
