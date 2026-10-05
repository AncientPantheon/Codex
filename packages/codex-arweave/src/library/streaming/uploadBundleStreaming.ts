/**
 * `uploadBundleStreaming`/`uploadStreaming` (T2, `arweave-streaming-ui`) —
 * the streaming-engine-calling counterparts `flow.ts`'s
 * `uploadAndTrack`/`uploadFilesAndTrack` will route to once streaming is
 * supported (T3, Wave 2 — NOT this task's job; `flow.ts` is not edited
 * here). Composes every engine this streaming-upload project has already
 * built:
 *
 *   - `assembleBundleToFile` (`arweave-opfs-bundle-assembly` + T2 of
 *     `arweave-streaming-encryption`) — incrementally signs+writes the
 *     ANS-104 bundle (and, when `encryptionKey` is supplied, each file's
 *     chunked-AES-GCM ciphertext instead of its plaintext) into an OPFS
 *     file.
 *   - `computeStreamingDataRoot` (`arweave-streaming-data-root`) — the
 *     streaming Merkle `data_root`, read one chunk at a time from that same
 *     file.
 *   - `createStreamingTransaction` (`arweave-streaming-post-core`, called
 *     indirectly through `streamingPostBundle`) — builds+signs the
 *     transaction from the already-computed `data_root`, `tx.data` always
 *     empty.
 *   - `streamingPostBundle` (`arweave-streaming-post-core`/
 *     `-post-resume`) — the chunk-by-chunk posting loop, checkpointed
 *     through a REAL `StreamingPostResumeStore` instance the caller
 *     provides (never bypassed/mocked — the resume record is genuinely
 *     written mid-flight and cleared on success).
 *
 * `uploadBundleStreaming` is the bundle analog of `arweave-core`'s
 * `uploadBundle`, returning `UploadBundleResult`-shaped data; `uploadStreaming`
 * is the single-file analog of `uploadData`, returning `UploadResult`-shaped
 * data. Both functions' return types are literally `arweave-core`'s own
 * `UploadBundleResult`/`UploadResult` (imported, not re-declared) — the
 * strongest form of "drop-in compatible" available: there is no way for this
 * module's shape to drift from the in-memory functions' own, by construction.
 *
 * KNOWN GAP (flagged, not silently worked around — out of this task's file
 * scope to fix): `AssembleBundleToFileResult` does not expose the
 * `Codex-Upload-Id` value `assembleBundleToFile` generates and stamps
 * internally onto every file/manifest item's tags (unlike `uploadBundle`'s
 * own `UploadBundleResult.uploadId`, which IS that exact value). This
 * module's own returned `uploadId` is therefore a FRESH id generated here
 * for `UploadBundleResult`-shape-compatibility purposes only (and reused as
 * this upload action's resume-record id / OPFS file-name seed) — it is not
 * guaranteed to equal the tag value actually written on-chain by the signed
 * items. Closing this gap requires widening `AssembleBundleToFileParams`/
 * `-Result` (a sibling module, outside this task's `- files:` scope) to
 * accept/return an externally-supplied `uploadId`; a later task should do
 * so before any caller relies on this value matching the real on-chain tag.
 */

import {
  importKeyfile,
  addressOf,
  buildUploadTags,
  computeStreamingDataRoot,
  type ArweaveJwk,
  type UploadCategory,
  type NftAssetType,
  type Tag,
  type GatewayPool,
  type ByteRangeReader,
  type UploadBundleResult,
  type UploadResult,
  type StreamingUploadGatewayApiFactory,
} from "@ancientpantheon/arweave-core";

import { streamingPostBundle } from "./streamingPost.js";
import { openOpfsBundleAssemblyFile, type BundleAssemblyFile } from "./bundleAssemblyFile.js";
import { assembleBundleToFile, type AssembleBundleToFileInput } from "./assembleBundleToFile.js";
import type { StreamingPostResumeStore } from "./streamingPostResumeStore.js";
import { encryptStreamToFile } from "../../crypto/streamingFileEncryption.js";

/** The wrapping L1 transaction's own tags — mirrors `arweave-core`'s
 *  `bundle.ts`'s own hardcoded `postArweaveData` call verbatim (these
 *  describe the ANS-104 bundle carrier itself, never built via
 *  `buildUploadTags`, which tags Codex upload ITEMS). */
const WRAPPING_TAGS: Tag[] = [
  { name: "Bundle-Format", value: "binary" },
  { name: "Bundle-Version", value: "2.0.0" },
];

/** Bounded read/write window for copying an unencrypted single file's bytes
 *  into the OPFS assembly file — a LOCAL constant, deliberately not imported
 *  from `streamingFileEncryption.ts`'s `ENCRYPTION_CHUNK_SIZE` (independent
 *  concern, same value today by coincidence only) nor from `arweave-core`'s
 *  own Merkle `MAX_CHUNK_SIZE` (this package's established "no direct
 *  dependency on arweave-core's internals" convention, same reason
 *  `streamingFileEncryption.ts` itself gives for its own local constant). */
const COPY_WINDOW_BYTES = 262_144;

/**
 * Wraps any {@link BundleAssemblyFile} to track the furthest byte offset any
 * `write()` has reached — this package's seam has no size/length query of
 * its own (confirmed by reading `bundleAssemblyFile.ts` in full), so a
 * caller that needs the final assembled length (both functions below do, to
 * drive `computeStreamingDataRoot`/`dataSize`) must track it itself. Mirrors
 * `streaming-post.test.ts`'s own `TrackingBundleAssemblyFile.length`
 * convention exactly, generalized here into a real (non-test) utility since
 * production callers need the same tracking, not just tests.
 */
class LengthTrackingBundleAssemblyFile implements BundleAssemblyFile {
  length = 0;

  constructor(private readonly inner: BundleAssemblyFile) {}

  async write(offset: number, bytes: Uint8Array): Promise<void> {
    await this.inner.write(offset, bytes);
    this.length = Math.max(this.length, offset + bytes.byteLength);
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    return this.inner.read(offset, length);
  }

  async close(): Promise<void> {
    await this.inner.close();
  }
}

/** The per-upload-action streaming-progress/resume-plumbing options shared,
 *  identically, by both {@link uploadBundleStreaming} and
 *  {@link uploadStreaming} below. */
interface StreamingUploadOptionsBase {
  /** The gateway pool `streamingPostBundle` posts through (POOL-FIRST —
   *  mirrors every other upload seam in this project). */
  pool: GatewayPool;
  /** The REAL resume-checkpoint store this upload's progress is persisted
   *  through — NEVER bypassed/mocked: a genuine record is written right
   *  after the tx posts and after every successfully-posted chunk, and
   *  cleared on full completion (`streamingPostBundle`'s own `opts.resume`
   *  contract). */
  resumeStore: StreamingPostResumeStore;
  /** Injectable per-endpoint streaming gateway-API factory, forwarded to
   *  `streamingPostBundle`. Defaults to `arweave-core`'s own arweave-js-
   *  backed factory; tests inject plain fakes. */
  apiFactory?: StreamingUploadGatewayApiFactory;
  /** Opens the OPFS bundle-assembly file by name. Defaults to the real
   *  `openOpfsBundleAssemblyFile`; tests inject a fake (neither Node nor
   *  jsdom has OPFS at all). */
  openFile?: (fileName: string) => Promise<BundleAssemblyFile>;
  /** Deletes the OPFS file by name on completion — forwarded verbatim to
   *  `streamingPostBundle`'s own `opts.resume.deleteFile`. Defaults to the
   *  real OPFS `directory.removeEntry(fileName)`; tests inject a fake/spy
   *  (there is no real `navigator.storage` under Node). */
  deleteFile?: (fileName: string) => Promise<void>;
  /** Whether to delete the OPFS file on full completion — forwarded
   *  verbatim to `streamingPostBundle`'s own `opts.resume
   *  .deleteFileOnComplete` (defaults to `true` there). */
  deleteFileOnComplete?: boolean;
  /** Chunk/byte progress callback, forwarded verbatim to
   *  `streamingPostBundle`'s own `opts.onProgress`. */
  onProgress?: (uploadedChunks: number, totalChunks: number) => void;
  /** Override this upload action's OPFS file name. Defaults to a generated
   *  name; a caller resuming a specific interrupted upload later supplies
   *  the SAME name it used originally. */
  fileName?: string;
  /** Override this upload action's resume-record id (the store's keyPath).
   *  Defaults to a generated id. */
  resumeId?: string;
}

/** Resolves the shared `{actionId, fileName, openFile}` triple both
 *  functions below need before touching OPFS, and the resume-options object
 *  `streamingPostBundle` itself expects — one implementation, not
 *  duplicated per function. */
function resolveStreamingPlumbing(
  opts: StreamingUploadOptionsBase,
  fileNamePrefix: string,
): {
  actionId: string;
  fileName: string;
  openFile: (fileName: string) => Promise<BundleAssemblyFile>;
  resume: {
    store: StreamingPostResumeStore;
    id: string;
    fileName: string;
    deleteFile?: (fileName: string) => Promise<void>;
    deleteFileOnComplete?: boolean;
  };
} {
  const actionId = opts.resumeId ?? globalThis.crypto.randomUUID();
  const fileName = opts.fileName ?? `${fileNamePrefix}-${actionId}.bin`;
  const openFile = opts.openFile ?? ((name: string) => openOpfsBundleAssemblyFile(name));
  return {
    actionId,
    fileName,
    openFile,
    resume: {
      store: opts.resumeStore,
      id: actionId,
      fileName,
      deleteFile: opts.deleteFile,
      deleteFileOnComplete: opts.deleteFileOnComplete,
    },
  };
}

/** Inputs for {@link uploadBundleStreaming} — mirrors `arweave-core`'s
 *  `UploadBundleParams` field-for-field for every per-upload-action tag
 *  input (`category`/`assetType`/`appId`/`appVersion`/`encrypted`/
 *  `encryptorAddress`/`encryptionVersion`), grounded directly against that
 *  real interface (`bundle.ts`). `files` uses `assembleBundleToFile`'s own
 *  LAZY `AssembleBundleToFileInput` shape (`readData()`), never
 *  `UploadBundleFile`'s eager `data: Uint8Array` — an eagerly-resident
 *  caller-supplied buffer would defeat the entire point of routing through
 *  the streaming engines in the first place. `encryptionKey` is the
 *  already-derived `CryptoKey` (never derived here); when present,
 *  `assembleBundleToFile` is called with `encryption: { key: encryptionKey }`,
 *  matching `arweave-streaming-encryption`'s T2 contract exactly. */
export interface UploadBundleStreamingParams {
  /** The uploader's keyfile. The SAME jwk signs every file item, the
   *  manifest item, and the wrapping L1 transaction. */
  jwk: ArweaveJwk;
  /** The files to bundle, in the order they are signed and written. */
  files: AssembleBundleToFileInput[];
  /** REQUIRED fee cap, in Winston, forwarded to `streamingPostBundle`. */
  maxRewardWinston: bigint;
  /** REQUIRED Codex-Category — applied identically to every file item AND
   *  the manifest item, same as `uploadBundle`. */
  category: UploadCategory;
  /** Optional Codex-Asset-Type — present if and only if `category ===
   *  "nft-data"`. */
  assetType?: NftAssetType;
  /** Optional Codex-App-Id, applied identically to every item. */
  appId?: string;
  /** Optional Codex-App-Version, applied identically to every item. */
  appVersion?: string;
  /** REQUIRED Codex-Encrypted, applied verbatim to every FILE item; the
   *  MANIFEST item is ALWAYS tagged `encrypted: false` regardless, same
   *  rule as `uploadBundle`/`assembleBundleToFile`. */
  encrypted: boolean;
  /** Optional Codex-Encryptor — present if and only if `encrypted === true`. */
  encryptorAddress?: string;
  /** Optional Codex-Encryption-Version — present if and only if `encrypted
   *  === true`. */
  encryptionVersion?: string;
  /** The already-derived AES key (T3 of `arweave-upload-encryption`'s own
   *  `deriveAccountAesKey`, called ONCE by the caller — never here). When
   *  present, every file's plaintext (never the manifest) is streamed
   *  through chunked AES-GCM before being signed/written — see
   *  `assembleBundleToFile`'s own `encryption` param doc comment. */
  encryptionKey?: CryptoKey;
}

/** Options for {@link uploadBundleStreaming} — see
 *  {@link StreamingUploadOptionsBase} for the shared streaming plumbing. */
export type UploadBundleStreamingOptions = StreamingUploadOptionsBase;

/**
 * The streaming, bundle-aware counterpart to `arweave-core`'s `uploadBundle`
 * — same `UploadBundleResult` return type, built via the OPFS-backed
 * assembly + streaming data_root + checkpointed posting engines instead of
 * one in-memory `Buffer.concat`-then-sign-then-post pass. See this module's
 * own doc comment for the full composition and the flagged `uploadId` gap.
 */
export async function uploadBundleStreaming(
  params: UploadBundleStreamingParams,
  opts: UploadBundleStreamingOptions,
): Promise<UploadBundleResult> {
  const { actionId, fileName, openFile, resume } = resolveStreamingPlumbing(
    opts,
    "streaming-bundle",
  );

  const file = new LengthTrackingBundleAssemblyFile(await openFile(fileName));

  try {
    const assembled = await assembleBundleToFile(file, {
      jwk: params.jwk,
      files: params.files,
      category: params.category,
      assetType: params.assetType,
      appId: params.appId,
      appVersion: params.appVersion,
      encrypted: params.encrypted,
      encryptorAddress: params.encryptorAddress,
      encryptionVersion: params.encryptionVersion,
      encryption: params.encryptionKey ? { key: params.encryptionKey } : undefined,
    });

    const totalLength = file.length;
    const streaming = await computeStreamingDataRoot(totalLength, (offset, size) =>
      file.read(offset, size),
    );

    await streamingPostBundle(
      opts.pool,
      {
        jwk: params.jwk,
        tags: WRAPPING_TAGS,
        maxRewardWinston: params.maxRewardWinston,
        dataSize: totalLength,
        streaming,
        file,
      },
      {
        apiFactory: opts.apiFactory,
        onProgress: opts.onProgress,
        resume,
      },
    );

    return {
      manifestId: assembled.manifestId,
      fileIds: assembled.fileIds,
      // See this module's own doc comment's "KNOWN GAP" paragraph: NOT
      // guaranteed to equal the Codex-Upload-Id tag `assembleBundleToFile`
      // stamped internally — `AssembleBundleToFileResult` does not expose
      // that value.
      uploadId: actionId,
    };
  } finally {
    // This function opened `file` itself (via `openFile`) — same discipline
    // `resumeStreamingPost` already establishes: close it on EVERY exit
    // path (success, already closed by `streamingPostBundle`'s own
    // completion policy — idempotent — or a throw before that point ever
    // ran), so a real OPFS exclusive sync-access handle is always released
    // for a later resume attempt to reopen.
    await file.close();
  }
}

/** Inputs for {@link uploadStreaming} — mirrors `arweave-core`'s
 *  `UploadParams` field-for-field for every per-upload-action tag input,
 *  grounded directly against that real interface (`upload/types.ts`).
 *  `readData`/`totalLength` replace `UploadParams.data`'s eager
 *  `string | Uint8Array` — a LAZY `ByteRangeReader` seam (the SAME shape
 *  `computeStreamingDataRoot`/`encryptStreamToFile` already read through),
 *  since a single file large enough to need streaming in the first place
 *  must never require a caller-resident whole-file buffer either. */
export interface UploadStreamingParams {
  /** The uploader's keyfile. */
  jwk: ArweaveJwk;
  /** Lazily supplies exactly `length` bytes of the file's PLAINTEXT starting
   *  at `offset` — read in bounded windows, never as one resident buffer. */
  readData: ByteRangeReader;
  /** The plaintext's total byte length. */
  totalLength: number;
  /** MIME type — becomes the Content-Type tag. */
  contentType: string;
  /** REQUIRED fee cap, in Winston, forwarded to `streamingPostBundle`. */
  maxRewardWinston: bigint;
  /** Optional Codex-Item-Id; defaults to a generated UUID, also used as
   *  this upload's Codex-Upload-Id — same default pattern as `uploadData`. */
  itemId?: string;
  /** Optional App-Name override; defaults to `DEFAULT_APP_NAME`. */
  appName?: string;
  /** Optional app metadata tags, appended after the required tag schema. */
  appMetadata?: readonly Tag[];
  /** REQUIRED Codex-Category. */
  category: UploadCategory;
  /** Optional Codex-Asset-Type — present if and only if `category ===
   *  "nft-data"`. */
  assetType?: NftAssetType;
  /** Optional Codex-App-Id. */
  appId?: string;
  /** Optional Codex-App-Version. */
  appVersion?: string;
  /** REQUIRED Codex-Encrypted. */
  encrypted: boolean;
  /** Optional Codex-Encryptor — present if and only if `encrypted === true`. */
  encryptorAddress?: string;
  /** Optional Codex-Encryption-Version — present if and only if `encrypted
   *  === true`. */
  encryptionVersion?: string;
  /** The already-derived AES key. When present, the plaintext is streamed
   *  through chunked AES-GCM (`encryptStreamToFile`) into the OPFS file
   *  instead of being copied verbatim. */
  encryptionKey?: CryptoKey;
}

/** Options for {@link uploadStreaming} — see
 *  {@link StreamingUploadOptionsBase} for the shared streaming plumbing. */
export type UploadStreamingOptions = StreamingUploadOptionsBase;

/** Copies `totalLength` unencrypted bytes from `readData` into `file`, one
 *  bounded {@link COPY_WINDOW_BYTES} window at a time — never the whole
 *  file resident at once, the same bound the encrypted path's
 *  `encryptStreamToFile` call already holds. */
async function copyPlaintextToFile(
  readData: ByteRangeReader,
  totalLength: number,
  file: BundleAssemblyFile,
): Promise<void> {
  let offset = 0;
  while (offset < totalLength) {
    const length = Math.min(COPY_WINDOW_BYTES, totalLength - offset);
    const bytes = await readData(offset, length);
    await file.write(offset, bytes);
    offset += length;
  }
}

/**
 * The streaming, single-file counterpart to `arweave-core`'s `uploadData` —
 * same `UploadResult` return type. Unlike the bundle path, no ANS-104
 * signing is involved at all (a native transaction's `data` stays empty
 * throughout, exactly like every other streaming transaction in this
 * project), so there is no "whole file resident for signing" ceiling here:
 * the plaintext (or its chunked ciphertext) is written into the OPFS file
 * one bounded window at a time, straight from the caller's lazy `readData`.
 */
export async function uploadStreaming(
  params: UploadStreamingParams,
  opts: UploadStreamingOptions,
): Promise<UploadResult> {
  const { fileName, openFile, resume } = resolveStreamingPlumbing(opts, "streaming-upload");

  const jwk = importKeyfile(params.jwk);
  const ownerAddress = await addressOf(jwk);
  const itemId = params.itemId ?? globalThis.crypto.randomUUID();

  const file = await openFile(fileName);

  try {
    let dataSize: number;
    if (params.encryptionKey) {
      const { totalCiphertextLength } = await encryptStreamToFile({
        read: params.readData,
        totalPlaintextLength: params.totalLength,
        key: params.encryptionKey,
        write: (offset, bytes) => file.write(offset, bytes),
      });
      dataSize = totalCiphertextLength;
    } else {
      await copyPlaintextToFile(params.readData, params.totalLength, file);
      dataSize = params.totalLength;
    }

    const streaming = await computeStreamingDataRoot(dataSize, (offset, size) =>
      file.read(offset, size),
    );

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

    const posted = await streamingPostBundle(
      opts.pool,
      {
        jwk: params.jwk,
        tags,
        maxRewardWinston: params.maxRewardWinston,
        dataSize,
        streaming,
        file,
      },
      {
        apiFactory: opts.apiFactory,
        onProgress: opts.onProgress,
        resume,
      },
    );

    return { id: posted.id, ownerAddress, itemId, tags };
  } finally {
    // Same discipline as `uploadBundleStreaming` above — this function
    // opened `file` itself, so it alone closes it again on every exit path.
    await file.close();
  }
}
