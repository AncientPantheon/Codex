/**
 * The Library COMPOSITION flows (E-07) — the upload→track→poll→open path.
 *
 * Composes the two shipped seams WITHOUT re-authoring either: the adapter
 * `upload` (arweave-core `uploadData`) for the write, the `LibraryStore` seam
 * for persistence, and arweave-core `getTransactionStatus` / the `GatewayPool`
 * for the confirmation and open paths.
 *
 * N-07: this module imports ONLY the `LibraryStore` seam + arweave-core + the
 * adapter upload. It NEVER touches the codec / `saveAll` / `foreignKeys` — the
 * Library is a separate store from the codex backup and holds only public,
 * on-chain metadata (no JWK, no ciphertext, no password ever reaches an entry).
 *
 * The finality gate is DELEGATED, not re-derived: arweave-core owns
 * `final = confirmations >= depth`; this module flips an entry to `final` ONLY
 * when arweave-core reports `confirmed && final === true`, and forwards an
 * omitted `confirmationDepth` as `undefined` so arweave-core's exported
 * `DEFAULT_CONFIRMATION_DEPTH` applies — never a hardcoded local value.
 *
 * `arweave-upload-encryption` (T5): `uploadAndTrack`'s optional `opts.encryptFor`
 * is the ONE place actual file encryption happens in this composition — T4's
 * `encrypted`/`encryptorAddress` fields on `UploadParams`/`UploadBundleParams`
 * only thread the already-encrypted bytes + metadata through; they perform no
 * encryption themselves. `UploadAndTrackParams` therefore OMITS `encrypted`/
 * `encryptorAddress` from the caller-facing shape entirely — this module is
 * the sole authority for both, derived from `opts.encryptFor` (or `false`/
 * `undefined` when it's omitted), so a caller never supplies them directly
 * and can never disagree with what was actually uploaded. `fileEncryption.ts`
 * (T3) is imported via a NAMESPACE import for the same testability reason as
 * the `arweaveCore` namespace import below: `vi.spyOn(fileEncryption,
 * "deriveAccountAesKey")` needs to intercept THIS module's own call site, and
 * a destructured local binding would defeat that spy. This import stays
 * within N-07's isolation rule — `fileEncryption.ts` is pure WebCrypto, no
 * `codex-ouronet`/codec/`foreignKeys` touch of its own.
 */

import {
  uploadData,
  uploadBundle,
  uploadCodexBackup,
  isCanonicalAddress,
  importKeyfile,
  addressOf,
  buildUploadTags,
  CODEX_ENCRYPTION_VERSION_CURRENT,
  TAG_CODEX_BACKUP_IDEK_MASTERSEED_DEFAULT,
  TAG_CODEX_BACKUP_EDEK_MASTERSEED_DEFAULT,
  TAG_CODEX_BACKUP_IDEK_STANDARDAPOLLO_DEFAULT,
  TAG_CODEX_BACKUP_EDEK_STANDARDAPOLLO_DEFAULT,
  // `codex-backup-envelope-encryption` T4: the Arweave-PIN wrap path's own
  // sibling tag names — see `tags.ts`'s own doc comment.
  TAG_CODEX_BACKUP_IDEK_MASTERSEED_PIN,
  TAG_CODEX_BACKUP_EDEK_MASTERSEED_PIN,
  TAG_CODEX_BACKUP_IDEK_STANDARDAPOLLO_PIN,
  TAG_CODEX_BACKUP_EDEK_STANDARDAPOLLO_PIN,
  TAG_CODEX_BACKUP_ENCRYPTION_VERSION,
  CODEX_BACKUP_ENCRYPTION_VERSION_CURRENT,
  TAG_CODEX_FORM_VERSION,
  type Tag,
  type UploadParams,
  type UploadResult,
  type UploadBundleParams,
  type UploadBundleResult,
  type GatewayPool,
  type UploadGatewayApiFactory,
  type ArweaveJwk,
  type StreamingUploadGatewayApiFactory,
} from "@ancientpantheon/arweave-core";
// T3 (`arweave-streaming-ui`): the Wave-1 OPFS-support detector and the
// streaming-engine-calling counterparts to `uploadBundle`/`uploadData` this
// module now routes to when streaming is supported — see `uploadAndTrack`'s
// own doc comment below for the exact routing rule.
import { isStreamingUploadSupported } from "./streaming/isStreamingUploadSupported.js";
import { uploadBundleStreaming, uploadStreaming } from "./streaming/uploadBundleStreaming.js";
import type { StreamingPostResumeStore } from "./streaming/streamingPostResumeStore.js";
import type { BundleAssemblyFile } from "./streaming/bundleAssemblyFile.js";
// Namespace import so `vi.spyOn(arweaveCore, "getTransactionStatus")` in the
// test intercepts THIS call site: a destructured local binding would capture
// the original function reference and defeat the spy.
import * as arweaveCore from "@ancientpantheon/arweave-core";
// Namespace import for the SAME reason (see the module doc's T5 paragraph):
// `vi.spyOn(fileEncryption, "deriveAccountAesKey")` must intercept this
// module's own call site to prove derive-ONCE-per-batch, which a destructured
// binding would defeat.
import * as fileEncryption from "../crypto/fileEncryption.js";
import type { CryptoSeam } from "@ancientpantheon/codex-core";
import { reencryptBackupSecretFields, CODEX_FORM_VERSION } from "@ancientpantheon/codex-core";
// `codex-backup-envelope-encryption` T3: the dual-key envelope primitives
// (T1, `crypto/backupEnvelope.ts`) — generates/wraps the IDEK/EDEK this
// function's own module doc below describes.
import { generateDek, encryptWithDek, wrapDekWithScalar } from "../crypto/backupEnvelope.js";
// `codex-backup-envelope-encryption` T5: the SAME module's unwrap/decrypt
// halves — the restore-side inverse of `wrapDekWithScalar`/`encryptWithDek`
// above, used by {@link restoreCodexFromBackupEnvelope} below.
import { unwrapDekWithScalar, decryptWithDek } from "../crypto/backupEnvelope.js";
// `codex-backup-envelope-encryption` T4: the EXISTING Worker-wrapped
// keygen-at-position primitive (`src/keygen/KeygenRunner.ts`) — the
// Arweave-PIN wrap path reuses this UNCHANGED (never a new main-thread RSA
// keygen call). Imported from its module, not the `src/keygen` barrel,
// mirroring `derivePrimeSeed.ts`'s own identical import — relative imports
// stay inside this package's `src/library/**` StoaChain/DALOS-free
// isolation boundary (`e2-stoachain-isolation.test.ts`) regardless of what
// `KeygenRunner.ts` itself imports (only TYPE-ONLY, erased at compile time).
import { runSeededBatch } from "../keygen/KeygenRunner.js";

import { MANIFEST_CONTENT_TYPE } from "./constants.js";
import type { LibraryEntry, LibraryStore } from "./types.js";

/**
 * The T7 bundle-aware entry point: given 2+ files, `uploadAndTrack` calls
 * T6's `uploadBundle` instead of T5's single-file `uploadData` (a 1-item
 * `files` array is still routed through the plain single-file path — see the
 * function doc). Reuses arweave-core's own `UploadBundleParams` VERBATIM
 * (`{ jwk, files, maxRewardWinston }`) rather than re-declaring an identical
 * shape — EXCEPT `encrypted`/`encryptorAddress` (T5), which this module
 * derives entirely from `UploadAndTrackOptions.encryptFor` rather than taking
 * from the caller, so they are omitted from the caller-facing params shape.
 */
export type UploadAndTrackParams =
  | Omit<UploadParams, "encrypted" | "encryptorAddress">
  | Omit<UploadBundleParams, "encrypted" | "encryptorAddress">;

/**
 * Optional per-upload-action encryption selection for {@link uploadAndTrack}
 * (T5, `arweave-upload-encryption`). When supplied, EVERY file in the upload
 * action (the single file, or all N files of a bundle) is encrypted under
 * ONE AES key derived ONCE from `accountId`'s revealed bitstring (T3's
 * `deriveAccountAesKey`) — never once per file, which is the whole
 * performance reason `fileEncryption.ts`'s derive-once primitives exist
 * instead of `accountKeyCipher.ts`'s per-call derivation.
 */
export interface UploadEncryptFor {
  /** The Ouronet account id whose secret `revealAccountSecret` resolves —
   *  the SAME id later handed to `onAccountUsedForEncryption`. */
  accountId: string;
  /**
   * The SAME account's own OURONET address — NOT an Arweave-derived value.
   * `Codex-Encryptor` names the encrypting OURONET account (a different
   * chain, a different address format than Arweave's 43-char base64url
   * shape), so this becomes `Codex-Encryptor` verbatim. It MUST be the exact
   * value `LibraryArea.tsx`'s `findEncryptorAccount` later matches against
   * (`ArweaveSeedAccountSource.account.address`) — any other derivation here
   * silently breaks T6's decrypt-on-download.
   */
  accountAddress: string;
  /** Resolves `accountId`'s plaintext bitstring (unlock-gated) — the SAME
   *  seam shape as `ArweavePanelDeps.revealAccountSecret`/`LibraryArea`'s own
   *  prop of the same name. A `null`/`undefined`/empty resolve throws a
   *  specific error (see {@link uploadAndTrack}) rather than silently
   *  skipping encryption or uploading under a garbage key. */
  revealAccountSecret: (accountId: string) => Promise<string | null> | string | null;
}

/** The T7 bundle-aware result: the classic single-file `UploadResult`, or
 *  (given 2+ files) T6's `UploadBundleResult`. Callers discriminate via
 *  `"manifestId" in result`. */
export type UploadAndTrackResult = UploadResult | UploadBundleResult;

/**
 * `arweave-streaming-worker-wiring` T1: the already-resolved encryption
 * IDENTITY {@link performUploadAndTrack} needs post-`resolveEncryptionKey` —
 * everything {@link UploadEncryptFor} carries EXCEPT the live
 * `revealAccountSecret` CALLBACK, which cannot cross a Worker `postMessage`
 * boundary (functions are not structured-cloneable; see `uploadWorker.ts`'s
 * own module doc). `accountId`/`accountAddress` are plain strings — readily
 * cloneable — so they ride straight through unchanged; only the callback
 * itself is excluded.
 */
export interface ResolvedEncryptFor {
  /** `UploadEncryptFor.accountId` verbatim — forwarded to
   *  `onAccountUsedForEncryption` after a successful encrypted upload. */
  accountId: string;
  /** `UploadEncryptFor.accountAddress` verbatim — becomes the posted
   *  `encryptorAddress` (`Codex-Encryptor`). */
  accountAddress: string;
}

/** Options for {@link uploadAndTrack}. */
export interface UploadAndTrackOptions {
  /** The Library persistence seam the pending entry/entries are appended to. */
  store: LibraryStore;
  /** The gateway pool `uploadData`/`uploadBundle` post through (POOL-FIRST —
   *  mirrors `PollStatusOptions.pool`/`SendArweaveModal`'s own constructor-
   *  injected pool pattern for a chain-write seam). REQUIRED: neither
   *  primitive has a default pool. */
  pool: GatewayPool;
  /** Injectable per-endpoint gateway-API factory, forwarded verbatim to
   *  `uploadData`/`uploadBundle` — tests inject a fake so no real, permanent
   *  upload is ever made. */
  apiFactory?: UploadGatewayApiFactory;
  /** Injectable wall clock for the entry's `createdAt`; defaults to `Date.now`.
   *  Pinned as a seam so tests are deterministic. */
  now?: () => number;
  /** T5 (`arweave-upload-encryption`): when supplied, every file in this
   *  upload action is encrypted before posting — see {@link UploadEncryptFor}.
   *  Omitted → `encrypted: false` on every posted item, completely unchanged
   *  from pre-T5 behavior (regression guard). */
  encryptFor?: UploadEncryptFor;
  /** T5: called ONCE, ONLY after a successful ENCRYPTED upload resolves AND
   *  is appended to the store, with `encryptFor.accountId` — the
   *  non-removable-account trigger point for the later
   *  `arweave-account-safety` topic. This module has zero knowledge of what
   *  "non-removable" means and NEVER imports from `codex-ouronet` (this
   *  file's own N-07 isolation, preserved here) — that meaning belongs
   *  entirely to whatever the host wires into this callback. Never called for
   *  an unencrypted upload, and never called when the upload rejects. */
  onAccountUsedForEncryption?: (accountId: string) => void;
  /**
   * T3 (`arweave-streaming-ui`): injectable OPFS-support probe, forwarded
   * verbatim to T1's `isStreamingUploadSupported`. Called ONCE per upload
   * action — before either path below does any work — to make the routing
   * decision. Defaults to the real detector; tests inject a fake so the
   * decision never touches a real OPFS API.
   */
  isStreamingSupported?: () => Promise<boolean>;
  /**
   * T3: fires ONCE per upload action, synchronously, the moment the routing
   * decision is made (before either path's own work begins) — the
   * UI-facing SIGNAL of which engine actually handles this upload.
   * `"streaming"` when `isStreamingSupported` resolved `true` (T2's
   * `uploadBundleStreaming`/`uploadStreaming` are about to run);
   * `"fallback"` otherwise (the classic in-memory `uploadBundle`/
   * `uploadData` are about to run, exactly as before T3). Mirrors
   * `UploadWizard.tsx`'s own `UploadWizardUploadCallbacks.onRouteDecided`,
   * which this module's real caller threads straight through.
   */
  onUploadRouteDecided?: (route: "streaming" | "fallback") => void;
  /**
   * T3: chunk/byte progress, forwarded verbatim to the streaming path's own
   * `uploadBundleStreaming`/`uploadStreaming` → `streamingPostBundle`
   * `onProgress` callback. NEVER called when the fallback path runs — that
   * path has no chunk concept at all. Additive; omitted → zero behavior
   * change.
   */
  onProgress?: (uploadedChunks: number, totalChunks: number) => void;
  /**
   * T3: the REAL resume-checkpoint store the streaming path persists its
   * progress through (`uploadBundleStreaming`/`uploadStreaming`'s own
   * `resumeStore` — never bypassed/mocked, per that module's own contract).
   * REQUIRED only when the streaming path actually runs (i.e.
   * `isStreamingSupported` resolves `true`); the fallback path never
   * touches this and omitting it there is fine. Omitted while streaming
   * WOULD run throws a specific error BEFORE any upload is attempted — the
   * same "throw before any upload, never a silent degrade" discipline
   * {@link resolveEncryptionKey} already applies for a bad reveal.
   */
  streamingResumeStore?: StreamingPostResumeStore;
  /** T3: injectable per-endpoint streaming gateway-API factory, forwarded to
   *  `uploadBundleStreaming`/`uploadStreaming`'s own `apiFactory`. Defaults
   *  to their own default (arweave-js-backed); tests inject plain fakes —
   *  NEVER the classic `apiFactory` above, a completely different API shape
   *  (streaming's chunk-posting surface vs. the native single-post one). */
  streamingApiFactory?: StreamingUploadGatewayApiFactory;
  /** T3: injectable OPFS-file-open seam, forwarded to
   *  `uploadBundleStreaming`/`uploadStreaming`'s own `openFile`. Defaults to
   *  the real `openOpfsBundleAssemblyFile`; tests inject a fake (neither
   *  Node nor jsdom has real OPFS). */
  streamingOpenFile?: (fileName: string) => Promise<BundleAssemblyFile>;
  /** T3: injectable OPFS-file-delete seam, forwarded to
   *  `uploadBundleStreaming`/`uploadStreaming`'s own `deleteFile`. */
  streamingDeleteFile?: (fileName: string) => Promise<void>;
}

/**
 * Options for {@link performUploadAndTrack} (`arweave-streaming-worker-
 * wiring` T1) — every {@link UploadAndTrackOptions} field EXCEPT
 * `encryptFor`, which is replaced by the already-resolved
 * {@link ResolvedEncryptFor} (no live callback — see that type's own doc).
 * `uploadAndTrack` itself still accepts the full live `UploadEncryptFor`;
 * this narrower options type is what's left once `resolveEncryptionKey` has
 * already run and only its OUTPUT needs to keep flowing — the exact shape
 * `uploadWorker.ts`'s `{ kind: "start" }` message carries across the Worker
 * boundary.
 */
export interface PerformUploadAndTrackOptions
  extends Omit<UploadAndTrackOptions, "encryptFor"> {
  /** The resolved encryption identity for `resolvedKey`, OMITTING the live
   *  `revealAccountSecret` callback. Required (together with a defined
   *  `resolvedKey`) to tag/attribute an encrypted upload; omit entirely for
   *  an unencrypted one — mirrors `resolvedKey: undefined`. */
  encryptFor?: ResolvedEncryptFor;
}

/** The app-metadata tag carrying a bundled file item's relative path — mirrors
 *  arweave-core's OWN private `bundle.ts` constant of the same name/value (not
 *  exported there); duplicated here only for building this module's own LOCAL
 *  optimistic entry tags, never posted to chain by this module. */
const TAG_CODEX_PATH = "Codex-Path";

/**
 * Resolves `encryptFor.accountId`'s plaintext bitstring via
 * `encryptFor.revealAccountSecret` and derives the AES key ONCE (T3's
 * `deriveAccountAesKey`) for the WHOLE upload action. A `null`/`undefined`/
 * empty resolve throws a specific, non-generic error — mirroring this file's
 * own `openUrl` "non-canonical arweave id" error-propagation style — rather
 * than silently uploading unencrypted or under a garbage key. Throws BEFORE
 * any upload is attempted, so a bad reveal never partially uploads.
 */
export async function resolveEncryptionKey(encryptFor: UploadEncryptFor): Promise<CryptoKey> {
  const bitstring = await encryptFor.revealAccountSecret(encryptFor.accountId);
  if (bitstring === null || bitstring === undefined || bitstring === "") {
    throw new Error(
      `uploadAndTrack: revealAccountSecret resolved no secret for account "${encryptFor.accountId}" — cannot encrypt this upload.`,
    );
  }
  return fileEncryption.deriveAccountAesKey(bitstring);
}

/** UTF-8-encodes a plain string, or passes an existing Uint8Array through —
 *  the common raw-byte form {@link encryptFileForUpload} encrypts, whether
 *  the caller's data arrived as a string (`UploadParams.data`) or raw bytes
 *  (`UploadBundleFile.data`). */
function toBytes(data: string | Uint8Array): Uint8Array {
  return typeof data === "string" ? new TextEncoder().encode(data) : data;
}

/** Standard-alphabet base64 encode — the EXACT inverse of `LibraryArea.tsx`'s
 *  own `base64ToBytes` (`atob` + `charCodeAt`), so a file encrypted here
 *  base64-decodes back to its original bytes on that download path. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/**
 * Encrypts one file's raw bytes under an already-derived key (T3's
 * `deriveAccountAesKey`, called ONCE per upload action — never per file) and
 * returns the exact bytes posted to chain: base64-encode the raw bytes,
 * UTF-8-encode that base64 STRING, `encryptWithDerivedKey` it, then PREPEND
 * the fresh 12-byte IV to the returned ciphertext. This is the EXACT inverse
 * of `LibraryArea.tsx`'s decrypt-on-download pipeline (T6) — strip the
 * leading IV, `decryptWithDerivedKey`, UTF-8-decode, then base64-decode — so
 * changing this byte layout without changing T6's would silently break every
 * existing encrypted download.
 */
async function encryptFileForUpload(data: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
  const base64Bytes = new TextEncoder().encode(bytesToBase64(data));
  const { ciphertext, iv } = await fileEncryption.encryptWithDerivedKey(key, base64Bytes);
  const out = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  out.set(iv, 0);
  out.set(ciphertext, iv.byteLength);
  return out;
}

/** Builds the single appended {@link LibraryEntry} for a plain (non-bundle)
 *  upload — the classic T5 single-file path, unchanged in shape from before
 *  T7. `uploadId` is the item's own Codex-Item-Id (`result.itemId`) — the
 *  SAME value `uploadData` itself writes into the Codex-Upload-Id tag for a
 *  single-file upload (its own one-item upload action), so a LOCAL entry and
 *  a REBUILT one (`rebuild.ts`'s `recordToEntry`) agree. */
function buildSingleEntry(
  result: UploadResult,
  contentType: string,
  createdAt: number,
): LibraryEntry {
  return {
    id: result.id,
    owner: result.ownerAddress,
    itemId: result.itemId,
    contentType,
    status: "pending",
    createdAt,
    tags: [...result.tags],
    uploadId: result.itemId,
    ...(isManifestContentType(contentType)
      ? { manifest: { isManifest: true } as const }
      : {}),
  };
}

/**
 * Builds the N+1 appended entries for a resolved bundle upload (the N file
 * entries plus the manifest entry), all sharing `result.uploadId`.
 *
 * `UploadBundleResult` deliberately returns only ids (`manifestId`/`fileIds`),
 * not the full per-item tag lists `uploadBundle` actually posted on-chain (it
 * signs each item independently, internally, with its own randomly-generated
 * Codex-Item-Id this caller never sees) — so the tags below are this module's
 * OWN best-effort, schema-consistent reconstruction for local/optimistic
 * display (same tag NAMES/shape `buildUploadTags` would apply), keyed by each
 * item's own resolved id rather than the unknown internal one. `rebuild.ts`
 * refreshes every field (including `tags`) from the real on-chain record once
 * the bundle is indexed, so this approximation is corrected automatically.
 *
 * `encrypted`/`encryptorAddress`/`encryptionVersion` (T5; `encryptionVersion`
 * added by `arweave-tag-schema-spec` T4) are applied to the FILE entries
 * exactly like `uploadBundle` itself applies them on-chain: verbatim per
 * file, but ALWAYS `encrypted: false` (no `Codex-Encryptor`, no
 * `Codex-Encryption-Version`) on the manifest entry, mirroring `bundle.ts`'s
 * own asymmetric rule — the manifest's path structure stays public even when
 * every sibling file is encrypted. Getting this right here (not just
 * on-chain) matters because `LibraryArea`'s decrypt-on-download reads
 * `Codex-Encryptor` off the LOCAL entry's `tags` before any rebuild ever
 * runs.
 */
function buildBundleEntries(
  result: UploadBundleResult,
  params: UploadBundleParams,
  ownerAddress: string,
  createdAt: number,
): LibraryEntry[] {
  const contentTypeByPath = new Map(params.files.map((f) => [f.path, f.contentType]));

  const fileEntries: LibraryEntry[] = result.fileIds.map(({ path, id }) => {
    const contentType = contentTypeByPath.get(path) ?? "application/octet-stream";
    const tags = buildUploadTags({
      ownerAddress,
      contentType,
      itemId: id,
      uploadId: result.uploadId,
      itemType: "file",
      category: params.category,
      assetType: params.assetType,
      appId: params.appId,
      appVersion: params.appVersion,
      encrypted: params.encrypted,
      encryptorAddress: params.encryptorAddress,
      encryptionVersion: params.encryptionVersion,
      appMetadata: [{ name: TAG_CODEX_PATH, value: path }],
    });
    return {
      id,
      owner: ownerAddress,
      itemId: id,
      contentType,
      status: "pending",
      createdAt,
      tags,
      uploadId: result.uploadId,
    };
  });

  const manifestTags = buildUploadTags({
    ownerAddress,
    contentType: MANIFEST_CONTENT_TYPE,
    itemId: result.manifestId,
    uploadId: result.uploadId,
    itemType: "manifest",
    category: params.category,
    assetType: params.assetType,
    appId: params.appId,
    appVersion: params.appVersion,
    // ALWAYS public, regardless of params.encrypted — mirrors bundle.ts's own
    // rule that the manifest's JSON path structure never itself encrypts.
    encrypted: false,
  });
  const manifestEntry: LibraryEntry = {
    id: result.manifestId,
    owner: ownerAddress,
    itemId: result.manifestId,
    contentType: MANIFEST_CONTENT_TYPE,
    status: "pending",
    createdAt,
    tags: manifestTags,
    uploadId: result.uploadId,
    manifest: { isManifest: true },
  };

  return [...fileEntries, manifestEntry];
}

/** Options for {@link pollStatus}. */
export interface PollStatusOptions {
  /** The gateway pool the status read runs through (POOL-FIRST arg). */
  pool: GatewayPool;
  /** The Library seam whose entry is flipped to `final` on deep confirmation. */
  store: LibraryStore;
  /** Injectable fetch seam forwarded to arweave-core — tests inject a fake. */
  fetchFn?: typeof fetch;
  /** Confirmations at/above which the tx is final. When omitted, `undefined` is
   *  forwarded so arweave-core applies its `DEFAULT_CONFIRMATION_DEPTH`. */
  confirmationDepth?: number;
}

/** Options for {@link openUrl}. */
export interface OpenUrlOptions {
  /** The gateway pool whose healthy endpoint the link is composed against. */
  pool: GatewayPool;
}

/** Whether a content type is the Arweave path-manifest type (one entry / one link). */
function isManifestContentType(contentType: string): boolean {
  return contentType === MANIFEST_CONTENT_TYPE;
}

/**
 * Upload `params` and, ONLY after the upload RESOLVES, append the resulting
 * `pending` {@link LibraryEntry}/entries to the store.
 *
 * `arweave-streaming-worker-wiring` T1: this function is now a THIN wrapper —
 * it resolves `opts.encryptFor` into a `CryptoKey | undefined` (unchanged,
 * still via the real `revealAccountSecret` callback, which must stay on the
 * main thread since functions cannot cross a Worker boundary), then hands
 * everything else to {@link performUploadAndTrack}, which carries the full
 * upload-then-append / bundle-vs-single-file / streaming-routing logic
 * documented below (the logic itself did not move conceptually, only its
 * home within this file — `uploadWorker.ts`'s Worker entry calls
 * `performUploadAndTrack` directly with an already-resolved key).
 *
 * The append is upload-THEN-append: a throwing upload rejects and leaves the
 * store EMPTY (no phantom-pending placeholder) — true for BOTH paths below.
 * The JWK rides `params.jwk` as a per-call transient and is NEVER persisted
 * in any entry.
 *
 * TWO paths, both reached through this one function (T7):
 *   - `params.files.length >= 2` (a `files` array of 2+, or an explicit
 *     folder selection the caller flattened to `files`): calls T6's
 *     `uploadBundle` — ONE atomic bundle, one payment — and appends ONE entry
 *     PER returned file id PLUS one for the manifest id, all sharing the
 *     SAME `uploadId` (`buildBundleEntries`).
 *   - everything else (the classic single-file `UploadParams` shape, OR a
 *     `files` array carrying exactly ONE file): calls T5's single-file
 *     `uploadData` and appends exactly ONE entry — mirrors `uploadBundle`'s
 *     own "a single file uses the plain path instead" rule, so a 1-file
 *     selection never pays bundle/manifest overhead. This is the EXACT
 *     pre-T7 behavior for a classic `UploadParams` call — no regression.
 *
 * `opts.encryptFor` (T5, `arweave-upload-encryption`): when supplied, the
 * account's bitstring is resolved and the AES key derived ONCE
 * (`resolveEncryptionKey`) BEFORE either path below runs — a bad reveal
 * throws before any upload is attempted, in either path. Every file's raw
 * bytes are then encrypted (`encryptFileForUpload`) and `encrypted: true` /
 * `encryptorAddress: opts.encryptFor.accountAddress` /
 * `encryptionVersion: CODEX_ENCRYPTION_VERSION_CURRENT` (`arweave-tag-schema-
 * spec` T4 — the pinned CURRENT value, never caller-suppliable) are forwarded
 * to `uploadData`/`uploadBundle` — this module performs the encryption, T4's
 * (`arweave-upload-encryption`) layer only threads the resulting ciphertext +
 * metadata through. Omitting `encryptFor` passes `encrypted: false` and
 * leaves every byte/tag exactly as before T5 (regression guard).
 * `opts.onAccountUsedForEncryption` fires
 * ONCE, ONLY after a successful encrypted upload is appended to the store —
 * never for an unencrypted upload, never on a throw.
 */
export async function uploadAndTrack(
  params: UploadAndTrackParams,
  opts: UploadAndTrackOptions,
): Promise<UploadAndTrackResult> {
  const { encryptFor, ...rest } = opts;

  // T5: resolve the bitstring + derive the AES key ONCE for the WHOLE upload
  // action (single file or N-file bundle alike) — never once per file. Runs
  // BEFORE any upload is attempted, so a bad reveal never partially uploads.
  // This step MUST stay on the main thread (`arweave-streaming-worker-
  // wiring` T1): `encryptFor.revealAccountSecret` is a live callback that
  // cannot cross a Worker boundary — only its OUTPUT, the derived
  // `CryptoKey`, is handed to `performUploadAndTrack` below.
  const resolvedKey = encryptFor ? await resolveEncryptionKey(encryptFor) : undefined;

  return performUploadAndTrack(params, resolvedKey, {
    ...rest,
    encryptFor: encryptFor
      ? { accountId: encryptFor.accountId, accountAddress: encryptFor.accountAddress }
      : undefined,
  });
}

/**
 * Everything {@link uploadAndTrack} runs AFTER its key resolution step —
 * factored out verbatim (`arweave-streaming-worker-wiring` T1, a PURE
 * refactor, zero behavior change) so the SAME logic is callable with an
 * ALREADY-RESOLVED key: both `uploadAndTrack` itself (the main-thread public
 * entry point) and `uploadWorker.ts`'s thin Worker entry (which receives
 * `resolvedKey` over `postMessage`, never a live callback) call this
 * function. See {@link uploadAndTrack}'s own doc comment for the full
 * upload-THEN-append / bundle-vs-single-file / streaming-routing contract —
 * none of that changed, it simply now lives here.
 */
export async function performUploadAndTrack(
  params: UploadAndTrackParams,
  resolvedKey: CryptoKey | undefined,
  opts: PerformUploadAndTrackOptions,
): Promise<UploadAndTrackResult> {
  const {
    store,
    pool,
    apiFactory,
    now = Date.now,
    encryptFor,
    onAccountUsedForEncryption,
    isStreamingSupported = isStreamingUploadSupported,
    onUploadRouteDecided,
    onProgress,
    streamingResumeStore,
    streamingApiFactory,
    streamingOpenFile,
    streamingDeleteFile,
  } = opts;

  const encryptionKey = resolvedKey;
  const encrypted = encryptionKey !== undefined;
  const encryptorAddress = encryptFor?.accountAddress;
  // `arweave-tag-schema-spec` T4: the pinned CURRENT encryption-procedure
  // version, stamped whenever this module actually encrypts — NEVER
  // caller-suppliable (no `encryptFor.encryptionVersion` field exists),
  // exactly like `uploadCodexBackup` hardcodes its own `category`. Mirrors
  // `encrypted`/`encryptorAddress` above: `undefined` unless this upload
  // action is actually encrypted.
  const encryptionVersion = encrypted ? CODEX_ENCRYPTION_VERSION_CURRENT : undefined;

  // T3 (`arweave-streaming-ui`): ONE routing decision per upload action,
  // made BEFORE either path below does any work. `onUploadRouteDecided`
  // fires regardless of which path is about to run — see its own doc
  // comment on `UploadAndTrackOptions` for exactly what it signals.
  const streaming = await isStreamingSupported();
  onUploadRouteDecided?.(streaming ? "streaming" : "fallback");

  if ("files" in params && params.files.length >= 2) {
    let result: UploadBundleResult;

    if (streaming) {
      if (!streamingResumeStore) {
        throw new Error(
          'uploadAndTrack: streaming is supported but no "streamingResumeStore" was supplied — cannot route this upload through the streaming engines.',
        );
      }
      // T2's `uploadBundleStreaming` takes the SAME already-derived
      // `encryptionKey` (never re-derived) and performs its own chunked
      // AES-GCM internally (`assembleBundleToFile`'s `encryption` param) —
      // UNLIKE the fallback branch below, this path never eagerly
      // `encryptFileForUpload`s a whole-file buffer first.
      result = await uploadBundleStreaming(
        {
          jwk: params.jwk,
          files: params.files.map((f) => ({
            path: f.path,
            contentType: f.contentType,
            readData: async () => f.data,
          })),
          maxRewardWinston: params.maxRewardWinston,
          category: params.category,
          assetType: params.assetType,
          appId: params.appId,
          appVersion: params.appVersion,
          encrypted,
          encryptorAddress,
          encryptionVersion,
          encryptionKey,
        },
        {
          pool,
          resumeStore: streamingResumeStore,
          apiFactory: streamingApiFactory,
          openFile: streamingOpenFile,
          deleteFile: streamingDeleteFile,
          onProgress,
        },
      );
    } else {
      // EXACTLY today's existing in-memory path — unchanged.
      const files = encryptionKey
        ? await Promise.all(
            params.files.map(async (file) => ({
              ...file,
              data: await encryptFileForUpload(file.data, encryptionKey),
            })),
          )
        : params.files;

      const bundleParams: UploadBundleParams = {
        jwk: params.jwk,
        files,
        maxRewardWinston: params.maxRewardWinston,
        category: params.category,
        assetType: params.assetType,
        appId: params.appId,
        appVersion: params.appVersion,
        encrypted,
        encryptorAddress,
        encryptionVersion,
      };
      result = await uploadBundle(pool, bundleParams, { apiFactory });
    }

    // `UploadBundleResult` does not carry `ownerAddress` (only ids) — derive
    // it independently, the SAME derivation `uploadBundle` itself already
    // performed internally, so the appended entries' `owner` field is correct.
    const jwk = importKeyfile(params.jwk);
    const ownerAddress = await addressOf(jwk);
    const createdAt = now();

    // Entry-building only ever reads each file's path/contentType plus the
    // per-batch category/tag inputs — never the actual bytes — so the SAME
    // reconstruction correctly serves EITHER path above; built fresh from
    // the ORIGINAL (pre-encryption) `params.files` rather than whichever
    // (possibly ciphertext-swapped) `files` variable the fallback branch
    // used internally.
    const bundleParamsForEntries: UploadBundleParams = {
      jwk: params.jwk,
      files: params.files,
      maxRewardWinston: params.maxRewardWinston,
      category: params.category,
      assetType: params.assetType,
      appId: params.appId,
      appVersion: params.appVersion,
      encrypted,
      encryptorAddress,
      encryptionVersion,
    };

    const entries = buildBundleEntries(result, bundleParamsForEntries, ownerAddress, createdAt);
    for (const entry of entries) {
      await store.append(entry);
    }
    if (encryptFor) onAccountUsedForEncryption?.(encryptFor.accountId);
    return result;
  }

  // Single-file path — either the classic `UploadParams` shape, or a `files`
  // array of exactly one file (unwrapped into the same shape here).
  const singleParamsBase: Omit<UploadParams, "encrypted" | "encryptorAddress"> =
    "files" in params
      ? {
          jwk: params.jwk,
          data: params.files[0].data,
          contentType: params.files[0].contentType,
          maxRewardWinston: params.maxRewardWinston,
          category: params.category,
          assetType: params.assetType,
          appId: params.appId,
          appVersion: params.appVersion,
        }
      : params;

  let result: UploadResult;

  if (streaming) {
    if (!streamingResumeStore) {
      throw new Error(
        'uploadAndTrack: streaming is supported but no "streamingResumeStore" was supplied — cannot route this upload through the streaming engines.',
      );
    }
    // Same rule as the bundle branch above: the SAME already-derived
    // `encryptionKey` is passed straight through to T2's `uploadStreaming`,
    // which performs its own chunked AES-GCM internally — never an eager
    // whole-file `encryptFileForUpload` first.
    const bytes = toBytes(singleParamsBase.data);
    result = await uploadStreaming(
      {
        jwk: singleParamsBase.jwk,
        readData: async (offset, length) => bytes.subarray(offset, offset + length),
        totalLength: bytes.byteLength,
        contentType: singleParamsBase.contentType,
        maxRewardWinston: singleParamsBase.maxRewardWinston,
        itemId: singleParamsBase.itemId,
        appName: singleParamsBase.appName,
        appMetadata: singleParamsBase.appMetadata,
        category: singleParamsBase.category,
        assetType: singleParamsBase.assetType,
        appId: singleParamsBase.appId,
        appVersion: singleParamsBase.appVersion,
        encrypted,
        encryptorAddress,
        encryptionVersion,
        encryptionKey,
      },
      {
        pool,
        resumeStore: streamingResumeStore,
        apiFactory: streamingApiFactory,
        openFile: streamingOpenFile,
        deleteFile: streamingDeleteFile,
        onProgress,
      },
    );
  } else {
    // EXACTLY today's existing in-memory path — unchanged.
    const data = encryptionKey
      ? await encryptFileForUpload(toBytes(singleParamsBase.data), encryptionKey)
      : singleParamsBase.data;

    const singleParams: UploadParams = {
      ...singleParamsBase,
      data,
      encrypted,
      encryptorAddress,
      encryptionVersion,
    };

    result = await uploadData(pool, singleParams, { apiFactory });
  }

  const entry = buildSingleEntry(result, singleParamsBase.contentType, now());
  await store.append(entry);
  if (encryptFor) onAccountUsedForEncryption?.(encryptFor.accountId);
  return result;
}

/** Options for {@link backupCodexToLibrary}. */
export interface BackupCodexToLibraryOptions {
  /** The Library persistence seam the pending entry is appended to. */
  store: LibraryStore;
  /** The gateway pool `uploadCodexBackup` posts through (POOL-FIRST). */
  pool: GatewayPool;
  /** The uploader's keyfile. Per-call transient — never cached, never persisted
   *  in any entry. */
  jwk: ArweaveJwk;
  /** REQUIRED fee cap, in Winston, forwarded verbatim to `uploadCodexBackup`. */
  maxRewardWinston: bigint;
  /** Injectable per-endpoint gateway-API factory, forwarded verbatim to
   *  `uploadCodexBackup` — tests inject a fake so no real, permanent upload is
   *  ever made. */
  apiFactory?: UploadGatewayApiFactory;
  /**
   * Called ONLY after the upload resolves AND the entry is appended. This
   * module never clears a `dirty` flag itself and never imports from
   * `codex-ouronet` (the cross-package isolation this file maintains
   * elsewhere) — the caller's own `clearDirty()` action, if any, belongs in
   * this callback.
   */
  onSuccess?: () => void;
  /** Injectable wall clock for the entry's `createdAt`; defaults to `Date.now`. */
  now?: () => number;
  /**
   * The plaintext password the codex is CURRENTLY unlocked with
   * (`codex-backup-envelope-encryption` T3). Opaque to this function, exactly
   * like `exportJson` already is — NEVER logged, NEVER echoed, and never
   * placed into an error. REQUIRED: this is how every individual secret
   * field inside `exportJson` is decrypted (via `cryptoSeam`) before being
   * re-encrypted under the per-upload IDEK — see {@link backupCodexToLibrary}'s
   * own doc comment for the full envelope flow. This is NOT the old
   * `codex-recovery-backup-tagging` usage (that mechanism — a
   * `Codex-Backup-Recovery-Key` tag encrypting this value itself — is fully
   * removed); the password is consumed locally, in-memory, and never
   * persisted or tagged anywhere in this upload.
   */
  codexPassword: string;
  /**
   * The Prime Arweave seed's raw 1600-bit `"0"`/`"1"` canonical bitstring —
   * the "Master Seed" default wrap source (design.md). NEVER its base10/
   * base49 spelling (see `accountKeyCipher.ts`'s own warning) — this
   * function derives both spellings itself (`base49` wraps the IDEK,
   * `base10` wraps the EDEK). Opaque to this function, never logged, never
   * echoed. REQUIRED: per design.md, eligibility for this envelope scheme
   * (a Prime Arweave seed existing at all, genuinely restorable from seed
   * words) is already gated upstream of this function
   * (`checkArweaveRestoreEligibility`, `codex-seed-restore-activation`) — a
   * caller that cannot supply this has no business calling this function at
   * all; see this function's own doc comment for the full degrade-path
   * reasoning.
   */
  primeArweaveSeedBitstring: string;
  /**
   * The Codex Identity's Standard half's raw 1024-bit `"0"`/`"1"` canonical
   * bitstring (APOLLO's own S=1024 width) — the "Standard Apollo" default
   * wrap source (design.md), mirroring `primeArweaveSeedBitstring`'s exact
   * shape: an OPAQUE, already-resolved string this function neither derives
   * nor validates the origin of. Resolving it (decrypting
   * `ICodexIdentity.encryptedStandardBitstring` via whichever seam already
   * reveals it) is the HOST's job, the same one layer up where
   * `primeArweaveSeedBitstring` is already resolved today — never this
   * function's. REQUIRED for the same reason `primeArweaveSeedBitstring` is.
   */
  standardApolloBitstring: string;
  /**
   * The injected real V2-cipher seam — used BOTH to decrypt `exportJson`'s
   * secret fields under `codexPassword` (mirrors `keyring/foreignKeys.ts`'s
   * own `cryptoSeam` injection pattern) AND to wrap/unwrap the IDEK/EDEK
   * under each default source's scalar spelling (T1's `wrapDekWithScalar`).
   * This module does not and must not depend on `@stoachain/stoa-core`
   * directly. REQUIRED — both uses above are load-bearing, not optional
   * add-ons.
   */
  cryptoSeam: CryptoSeam;
  /**
   * `codex-backup-envelope-encryption` T4 — OPT-IN: when supplied, the
   * Master Seed source is protected by an Arweave-PIN derivation INSTEAD OF
   * its default scalar wrap — this source's `...-Pin` tag pair is posted
   * and its `...-Default` pair is NOT (mutual exclusivity, the single most
   * safety-critical property of this path: an unprotected default sitting
   * alongside a PIN'd wrap would defeat the PIN entirely). A 6-to-15-digit
   * numeric string (design.md's own stated bounds); validated BEFORE any
   * keygen is attempted (see {@link deriveRsaKeypairAtPin}). Independent of
   * {@link standardApolloPin} — a caller may PIN one source, both, or
   * neither. REQUIRES {@link pinKeygenWorkerFactory} when supplied.
   */
  masterSeedPin?: string;
  /**
   * `codex-backup-envelope-encryption` T4 — the SAME opt-in PIN mechanism as
   * {@link masterSeedPin}, applied to the Standard Apollo source instead —
   * independently optional, mirroring that field's own doc comment exactly
   * (mutual exclusivity is per-source: PIN'ing this source never affects
   * whether Master Seed gets its Pin or Default pair, and vice versa).
   */
  standardApolloPin?: string;
  /**
   * The INJECTED Worker factory `deriveRsaKeypairAtPin` drives (the SAME
   * `workerFactory` convention as `deriveArweaveSeedAtPositionZero`/
   * `runSeededBatch` — never `new Worker(new URL(...))` here). REQUIRED
   * when EITHER {@link masterSeedPin} or {@link standardApolloPin} is
   * supplied; a caller using neither PIN never needs this and may omit it
   * (the pre-T4 default-only path is completely unaffected). A single
   * factory serves BOTH sources' PIN derivations — each call produces its
   * own fresh worker, mirroring `runSeededBatch`'s own per-call contract.
   */
  pinKeygenWorkerFactory?: () => Worker;
}

/**
 * Best-effort, FULLY DEFENSIVE derivation of `{ appId }` from an opaque
 * `exportJson` string, for {@link backupCodexToLibrary}'s real
 * `Codex-App-Id` lineage tagging. Runs against the ORIGINAL, plaintext-shaped
 * `exportJson` (never the opaque EDEK-encrypted blob this function ultimately
 * posts) — `codexIdentity.formatted` is not one of the three documented
 * secret-ciphertext fields, so reading it here is unaffected by the envelope
 * re-encryption below.
 *
 * `exportJson` is parsed with `JSON.parse` (returning `unknown`) and read
 * back through narrow, unknown-safe property checks ONLY — this function
 * MUST NOT import any type from `codex-core`/`codex-ouronet`/any other
 * `codex-*` package (this module's own isolation, documented at the top of
 * this file, applies here too). Any parse failure, missing field, or
 * wrong-typed field yields `undefined` rather than throwing — a MALFORMED
 * lineage derivation never fails the backup; a genuinely un-parseable
 * `exportJson` still fails, but later, at {@link reencryptBackupSecretFields}'s
 * own `deserializeCodex` call, which is the real, sanctioned shape gate for
 * this envelope (see this function's own doc comment).
 *
 *   - `appId` = `parsed.codexIdentity.formatted` when it is a string.
 *
 * `appVersion` is NOT derived here any more (`codex-backup-envelope-
 * encryption` T3's version-tag fix): the previous convention —
 * `parsed.lastUpdatedAt`, a timestamp — answered "when was this backup
 * made," not "what shape is it in." `Codex-Form-Version` (this function's
 * own `appMetadata`, carrying the real `CODEX_FORM_VERSION` constant) now
 * answers that correctly; no separate timestamp tag is added (this
 * function's own choice — see its doc comment).
 */
function deriveBackupLineage(exportJson: string): { appId?: string } {
  try {
    const parsed: unknown = JSON.parse(exportJson);

    let appId: string | undefined;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "codexIdentity" in parsed
    ) {
      const codexIdentity = (parsed as { codexIdentity: unknown }).codexIdentity;
      if (
        typeof codexIdentity === "object" &&
        codexIdentity !== null &&
        "formatted" in codexIdentity &&
        typeof (codexIdentity as { formatted: unknown }).formatted === "string"
      ) {
        appId = (codexIdentity as { formatted: string }).formatted;
      }
    }

    return { appId };
  } catch {
    // Not valid JSON, or some other parse-time throw — no lineage tag this
    // time; `reencryptBackupSecretFields` below is the real shape gate and
    // will throw loudly if `exportJson` genuinely cannot be processed.
    return {};
  }
}

/**
 * `@ouronet/dalos-crypto/gen1`'s own base-49 alphabet, reproduced EXACTLY
 * (same 49-character order) so {@link bigIntToBase49Local}'s output is
 * byte-identical to the real library's `bigIntToBase49` for the same input —
 * load-bearing for a later restore flow that re-derives the SAME scalar's
 * base49 spelling via the real library and must get the IDENTICAL string
 * back to successfully unwrap what THIS function wrapped.
 */
const BASE49_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLM";

/**
 * Reimplements `@ouronet/dalos-crypto/gen1`'s `bigIntToBase49` locally
 * (same algorithm: positional, most-significant-digit-first, no padding;
 * `0n` → `"0"`) rather than importing that package here: `src/library/**`
 * is a StoaChain/DALOS-free isolation boundary
 * (`tests/e2-stoachain-isolation.test.ts`'s static import-scan allow-lists
 * only `@ancientpantheon/arweave-core`/`@ancientpantheon/codex-core`/
 * `arweave`) that this module must stay inside. This is pure number-base
 * arithmetic, not a cryptographic primitive — duplicating ~10 lines of it
 * here does not cross that boundary's actual intent (keeping the Arweave
 * protocol layer free of DALOS/StoaChain-specific code paths), and the
 * `codex-identity-derivation`/`crypto-backup-envelope` test suites already
 * exercise the REAL library's own `bigIntToBase49` directly, so a drift
 * between the two would surface as a cross-suite mismatch, not silently.
 */
function bigIntToBase49Local(n: bigint): string {
  if (n === 0n) return "0";
  const digits: string[] = [];
  let x = n;
  while (x > 0n) {
    digits.push(BASE49_ALPHABET[Number(x % 49n)]);
    x = x / 49n;
  }
  return digits.reverse().join("");
}

/** Interprets a raw `"0"`/`"1"` bitstring as an unsigned big-endian binary
 *  integer — the "scalar" design.md's `base49(scalar)`/`base10(scalar)` wrap
 *  convention refers to for a default wrap source. Pure math; no DALOS/
 *  Apollo keygen involved. */
function bitstringToScalar(bitstring: string): bigint {
  return BigInt(`0b${bitstring}`);
}

/** The two wrap-key spellings {@link wrapDekWithScalar} needs for ONE
 *  source's bitstring — `base49` wraps the IDEK, `base10` wraps the EDEK
 *  (design.md's fixed pairing, applied identically to both default
 *  sources). */
function scalarSpellings(bitstring: string): { base49: string; base10: string } {
  const scalar = bitstringToScalar(bitstring);
  return { base49: bigIntToBase49Local(scalar), base10: scalar.toString(10) };
}

/**
 * The Arweave-PIN wrap path's digit-length bounds (design.md's "Arweave-PIN
 * wrap path" section): 6 digits is the floor that section's brute-force-cost
 * analysis assumes (worst case ~78 days of continuous ~6.7s-per-guess
 * RSA-4096 keygen at 6 digits; ~21 years at 8); 15 digits is the ceiling,
 * deliberately one digit short of `Number.MAX_SAFE_INTEGER`'s own 16-digit
 * ceiling (design.md's own stated reason) so a maximal PIN still parses to
 * an exact integer with zero floating-point precision loss.
 */
const PIN_MIN_DIGITS = 6;
const PIN_MAX_DIGITS = 15;

/**
 * Validates `pin`'s shape ONLY (a {@link PIN_MIN_DIGITS}-to-
 * {@link PIN_MAX_DIGITS}-digit numeric string) — cheap, synchronous, and
 * run BEFORE any keygen is attempted ({@link deriveRsaKeypairAtPin} calls
 * this FIRST): a real RSA-4096 keygen-at-position costs ~6.7s per key (and,
 * since index 0 is force-generated alongside whatever position is
 * requested, ~13.4s per call), so an already-invalid PIN must never burn
 * that cost. `label` identifies which option field is being validated
 * (`"masterSeedPin"`/`"standardApolloPin"`) for a clear error message.
 */
function validatePinShape(pin: string, label: string): void {
  if (!/^[0-9]+$/.test(pin) || pin.length < PIN_MIN_DIGITS || pin.length > PIN_MAX_DIGITS) {
    throw new Error(
      `backupCodexToLibrary: "${label}" must be a ${PIN_MIN_DIGITS}-to-${PIN_MAX_DIGITS}-digit ` +
        `numeric string, got length ${pin.length} — rejected BEFORE any RSA-4096 keygen is attempted.`,
    );
  }
}

/**
 * The largest index `@ouronet/dalos-crypto/rsa4096`'s keygen-at-position
 * primitive accepts — matches Go's `uint32` range exactly
 * (`rsa4096/indexed.js`'s own `MAX_INDEX = 0xffffffff`). Reproduced as a
 * plain numeric literal rather than imported: this module's own
 * `src/library/**` StoaChain/DALOS-free isolation boundary
 * (`e2-stoachain-isolation.test.ts`) allow-lists only
 * `@ancientpantheon/arweave-core`/`@ancientpantheon/codex-core`/`arweave` as
 * bare-module imports — a pure numeric bound is not a cryptographic
 * primitive, mirroring {@link bigIntToBase49Local}'s own
 * reproduced-not-imported reasoning above.
 */
const RSA4096_MAX_INDEX = 0xffffffff;

/**
 * Maps a (already shape-validated) PIN string to the keygen position
 * {@link deriveRsaKeypairAtPin} requests — the real design decision
 * design.md left to whichever task implemented this path.
 *
 * A 6-to-15-digit PIN parses to an integer up to 999999999999999 — safely
 * exact under `Number.MAX_SAFE_INTEGER` (the 15-digit ceiling's own
 * justification) — but the underlying keygen-at-position primitive only
 * accepts indices in `[0, RSA4096_MAX_INDEX]` (a uint32), far smaller than a
 * 15-digit PIN's own range. This function reduces the PIN into that range
 * via modulo, then adds 1 (equivalently: reduces modulo
 * {@link RSA4096_MAX_INDEX}, not `RSA4096_MAX_INDEX + 1`, before the +1) so
 * the result can NEVER be 0 — index 0 is the seed's already-PUBLIC primary
 * address (`deriveArweaveSeedAtPositionZero`), and a PIN that happened to
 * reduce to it would silently defeat that PIN's secrecy entirely.
 *
 * Two DIFFERENT PINs reducing to the SAME non-zero position does not weaken
 * either PIN's own brute-force resistance: design.md's ~6.7s-per-guess cost
 * is paid once per PIN VALUE an attacker tries (this function runs on every
 * guess, not once per distinct position) — a collision only means some
 * OTHER, un-entered PIN would also unlock the same wrap, never that the
 * correct PIN became any cheaper to find.
 */
function pinToKeygenPosition(pin: string): number {
  const asNumber = Number(pin);
  return 1 + (asNumber % RSA4096_MAX_INDEX);
}

/**
 * Derives the RSA-4096 keypair at `pin`'s chosen position from `bitstring`,
 * via the EXISTING Worker-wrapped keygen-at-position primitive
 * (`runSeededBatch`, `../keygen/KeygenRunner.js`) — NEVER a direct
 * main-thread call into the heavy `@ouronet/dalos-crypto/rsa4096` surface
 * (this module has no dependency on that package at all — see
 * {@link RSA4096_MAX_INDEX}'s own doc comment). `workerFactory` is
 * INJECTED, mirroring `deriveArweaveSeedAtPositionZero`'s own convention;
 * the caller constructs a fresh worker per call (never
 * `new Worker(new URL(...))` here).
 *
 * Validates `pin`'s shape FIRST ({@link validatePinShape}) — an already
 * invalid PIN never reaches `workerFactory` at all, so a 5-digit or
 * 16-digit PIN never burns a real keygen's ~6.7-13.4s cost.
 *
 * Returns the keypair's `p`/`q` CRT primes verbatim, as their base64url JWK
 * string encoding (`ArweaveJwk.p`/`.q`) — NOT converted to a bigint. This is
 * exactly the string shape `wrapDekWithScalar`/`unwrapDekWithScalar`
 * (`../crypto/backupEnvelope.js`) already accept as `scalarString` (see
 * this task's own report for the full reasoning): a JWK prime is already a
 * string, the same password-shaped input those functions were built for,
 * just sourced from a derived keypair instead of a bitstring — so this task
 * reuses them AS-IS for the PIN wrap path rather than adding a sibling
 * "wrap with a raw bigint" function to `backupEnvelope.ts`.
 *
 * Exported (not module-private) so a later restore flow (`arweave-seed-
 * restore`'s own T5, per design.md's settled restore-routing mechanic) can
 * re-derive the SAME keypair at restore time from a user-entered PIN,
 * through this SAME function — never a re-implementation of this mapping.
 */
export async function deriveRsaKeypairAtPin(
  bitstring: string,
  pin: string,
  label: string,
  workerFactory: () => Worker,
): Promise<{ p: string; q: string }> {
  validatePinShape(pin, label);
  const position = pinToKeygenPosition(pin);

  let found: { p: string; q: string } | undefined;
  await runSeededBatch({
    bits: bitstring,
    ranges: [{ start: position, end: position }],
    workerFactory,
    onKey: (key) => {
      if (key.index === position) found = { p: key.jwk.p, q: key.jwk.q };
    },
  });

  if (found === undefined) {
    throw new Error(
      `backupCodexToLibrary: PIN-position keygen for "${label}" delivered no key at index ${position}.`,
    );
  }
  return found;
}

/**
 * Builds the two wrapped-key tags for ONE default wrap source — either its
 * `...-Pin` pair (when `pin` is supplied) or its `...-Default` pair
 * (otherwise), NEVER both for the SAME source (mutual exclusivity, the
 * single most safety-critical property of the Arweave-PIN wrap path — an
 * unprotected default sitting alongside a PIN'd wrap would defeat the PIN
 * entirely). The PIN branch uses ONE keygen call to cover BOTH DEKs (`p`
 * wraps the IDEK, `q` wraps the EDEK) — the same one-keygen-covers-both-DEKs
 * economy as the default branch's single scalar covering both spellings.
 */
async function buildSourceWrapTags(args: {
  bitstring: string;
  pin: string | undefined;
  label: string;
  idek: CryptoKey;
  edek: CryptoKey;
  cryptoSeam: CryptoSeam;
  pinKeygenWorkerFactory: (() => Worker) | undefined;
  defaultIdekTag: string;
  defaultEdekTag: string;
  pinIdekTag: string;
  pinEdekTag: string;
}): Promise<Tag[]> {
  const {
    bitstring,
    pin,
    label,
    idek,
    edek,
    cryptoSeam,
    pinKeygenWorkerFactory,
    defaultIdekTag,
    defaultEdekTag,
    pinIdekTag,
    pinEdekTag,
  } = args;

  if (pin !== undefined) {
    if (pinKeygenWorkerFactory === undefined) {
      throw new Error(
        `backupCodexToLibrary: "pinKeygenWorkerFactory" is required when "${label}" is supplied.`,
      );
    }
    const { p, q } = await deriveRsaKeypairAtPin(bitstring, pin, label, pinKeygenWorkerFactory);
    const [idekWrapped, edekWrapped] = await Promise.all([
      wrapDekWithScalar(idek, p, cryptoSeam),
      wrapDekWithScalar(edek, q, cryptoSeam),
    ]);
    return [
      { name: pinIdekTag, value: idekWrapped },
      { name: pinEdekTag, value: edekWrapped },
    ];
  }

  const { base49, base10 } = scalarSpellings(bitstring);
  const [idekWrapped, edekWrapped] = await Promise.all([
    wrapDekWithScalar(idek, base49, cryptoSeam),
    wrapDekWithScalar(edek, base10, cryptoSeam),
  ]);
  return [
    { name: defaultIdekTag, value: idekWrapped },
    { name: defaultEdekTag, value: edekWrapped },
  ];
}

/** UTF-8-encodes `plaintext` and base64-encodes the IV-then-ciphertext pair
 *  an {@link encryptWithDek} call produces into ONE string — the shape every
 *  individual IDEK-reencrypted secret field, and the whole EDEK-encrypted
 *  opaque blob, are stored/posted as. Mirrors `encryptFileForUpload`'s own
 *  IV-prepend convention above (this function's sibling for the account-key
 *  file-encryption path), reusing `bytesToBase64` rather than Node's
 *  `Buffer` so this stays usable in a real browser bundle, not just Node. */
async function encryptToIvPrefixedBase64(dek: CryptoKey, plaintext: string): Promise<string> {
  const { ciphertext, iv } = await encryptWithDek(dek, new TextEncoder().encode(plaintext));
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(ciphertext, iv.byteLength);
  return bytesToBase64(combined);
}

/** Standard-alphabet base64 DECODE — the exact inverse of {@link bytesToBase64}
 *  (`atob` + `charCodeAt`), mirroring `panel/LibraryArea.tsx`'s own identical
 *  `base64ToBytes` helper (duplicated locally there for the same reason this
 *  one is duplicated here: a tiny, pure, dependency-free primitive, not worth
 *  a shared-module indirection across two otherwise-unrelated call sites). */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** AES-GCM IV length in bytes — mirrors `panel/LibraryArea.tsx`'s own
 *  `IV_BYTE_LENGTH` (itself a reproduction of `fileEncryption.ts`'s private
 *  constant of the same name): the upload/encrypt side always prepends
 *  exactly this many IV bytes before the ciphertext ({@link
 *  encryptToIvPrefixedBase64} above), so this restore-side decrypt strips the
 *  same fixed length off the front before calling {@link decryptWithDek}. */
const IV_BYTE_LENGTH = 12;

/**
 * Inverse of {@link encryptToIvPrefixedBase64}: base64-decodes `encoded`,
 * splits off the leading {@link IV_BYTE_LENGTH} IV bytes, AES-256-GCM-decrypts
 * the remainder under `dek` with that IV (T1's `decryptWithDek`, a direct
 * re-export of `fileEncryption.ts`'s `decryptWithDerivedKey` — an auth-tag
 * mismatch, e.g. decrypting under the WRONG unwrapped DEK, throws rather than
 * returning garbage plaintext), and UTF-8-decodes the result back to a
 * string. Used by {@link restoreCodexFromBackupEnvelope} below for BOTH the
 * EDEK-encrypted opaque blob and each individual IDEK-reencrypted secret
 * field — the exact same byte layout, just at two different "layers" of the
 * envelope (design.md's own restore-order note).
 */
async function decryptFromIvPrefixedBase64(dek: CryptoKey, encoded: string): Promise<string> {
  const combined = base64ToBytes(encoded);
  const iv = combined.slice(0, IV_BYTE_LENGTH);
  const ciphertext = combined.slice(IV_BYTE_LENGTH);
  const plaintextBytes = await decryptWithDek(dek, ciphertext, iv);
  return new TextDecoder().decode(plaintextBytes);
}

/**
 * Throws a specific, named error for the first of
 * {@link BackupCodexToLibraryOptions}'s 4 envelope-load-bearing fields
 * (`codexPassword`/`primeArweaveSeedBitstring`/`standardApolloBitstring`/
 * `cryptoSeam`) that is missing — defense in depth alongside the TypeScript
 * type (which already marks all 4 required): a caller reaching this
 * function from plain JS, or constructing `opts` dynamically, still fails
 * loudly BEFORE any upload is attempted, never silently degrading to an
 * unwrapped/weaker/wrong-but-claimed-successful backup. See this function's
 * own doc comment for why these 4 are PRECONDITIONS, not optional add-ons,
 * in this design.
 */
function requireEnvelopeInputs(opts: BackupCodexToLibraryOptions): void {
  const required: Array<[string, unknown]> = [
    ["codexPassword", opts.codexPassword],
    ["primeArweaveSeedBitstring", opts.primeArweaveSeedBitstring],
    ["standardApolloBitstring", opts.standardApolloBitstring],
    ["cryptoSeam", opts.cryptoSeam],
  ];
  for (const [name, value] of required) {
    if (value === undefined || value === "") {
      throw new Error(
        `backupCodexToLibrary: "${name}" is required — the dual-key envelope ` +
          "(codex-backup-envelope-encryption) has no degraded/partial mode; " +
          "an ineligible or un-derivable codex must not call this function at all.",
      );
    }
  }
}

/**
 * Backs up the codex's current export (`exportJson`, a plaintext-SHAPED
 * string whose three documented secret fields are already ciphertext under
 * `opts.codexPassword` — see `IMPORT_EXPORT_CONTRACT.md` §2) to Arweave under
 * `Codex-Category: codex-backup`, via arweave-core's dedicated
 * `uploadCodexBackup` primitive — never the classic `uploadData`/
 * `uploadBundle` call sites above, and never the bundle path (a codex backup
 * is always exactly one file).
 *
 * `codex-backup-envelope-encryption` T3 rebuilds this function's entire
 * upload payload as a dual-key envelope, replacing the previous
 * `Codex-Backup-Recovery-Key` password-tagging mechanism outright (no real
 * backup was ever made under that scheme — confirmed with the owner — so
 * this is a full replacement, not an additive parallel path):
 *
 *   1. Generate a fresh, independent IDEK and EDEK (T1's `generateDek`,
 *      called twice — never the same key for both roles).
 *   2. T2's `reencryptBackupSecretFields` decrypts every one of the three
 *      documented secret fields under `opts.codexPassword` (via
 *      `opts.cryptoSeam`) and re-encrypts each under the IDEK — the
 *      resulting export needs nothing but the IDEK to decrypt its fields,
 *      never the codex password again.
 *   3. The WHOLE resulting (IDEK-reencrypted) export string is encrypted
 *      ONCE MORE, as one opaque blob, under the EDEK — this is what hides
 *      the backup's shape (field names, keyring counts) from anyone who
 *      finds the permanent, public transaction.
 *   4. Both DEKs are wrapped under EACH of `primeArweaveSeedBitstring`
 *      ("Master Seed") and `standardApolloBitstring` ("Standard Apollo") —
 *      by DEFAULT, each source's bitstring treated as a scalar with two
 *      string spellings (`base49` wraps the IDEK, `base10` wraps the EDEK,
 *      T1's `wrapDekWithScalar`), producing that source's `...-Default` tag
 *      pair. `codex-backup-envelope-encryption` T4 (the Arweave-PIN wrap
 *      path): when `opts.masterSeedPin`/`opts.standardApolloPin` is
 *      supplied for a given source, that source's `...-Pin` pair is posted
 *      INSTEAD — an RSA-4096 keypair derived (via `opts.pinKeygenWorkerFactory`,
 *      {@link deriveRsaKeypairAtPin}) at the PIN-chosen position, `p` wraps
 *      the IDEK and `q` wraps the EDEK (still T1's `wrapDekWithScalar`, the
 *      JWK prime strings fit its `scalarString` input as-is) — NEVER both a
 *      source's `-Pin` AND `-Default` pair on the same upload (mutual
 *      exclusivity, see {@link buildSourceWrapTags}). Either default source
 *      alone is sufficient to restore (deliberate OR redundancy, design.md);
 *      a PIN'd source narrows that source's own unlock to the PIN alone.
 *      Exactly 4 wrapped-key tags total either way (2 per source, Pin-or-
 *      Default).
 *   5. The opaque EDEK-encrypted blob (NOT the plaintext-shaped export) is
 *      posted as `uploadCodexBackup`'s payload, with the 4 wrapped-key tags
 *      plus `Codex-Backup-Encryption-Version` (a version axis independent of
 *      the per-file `Codex-Encryption-Version`) attached via `appMetadata`.
 *
 * `opts.codexPassword`/`opts.primeArweaveSeedBitstring`/
 * `opts.standardApolloBitstring`/`opts.cryptoSeam` are all REQUIRED
 * preconditions (enforced both by the TypeScript type and, defensively, at
 * runtime by {@link requireEnvelopeInputs}) — there is no degraded/partial
 * mode. Per design.md, whether a codex is even ELIGIBLE for this scheme (a
 * Prime Arweave seed existing, genuinely restorable from seed words) is
 * already gated one layer up, by the existing, already-built
 * `checkArweaveRestoreEligibility` (`codex-seed-restore-activation`) — the
 * real app's own `backupCodex` call site only resolves and supplies these 4
 * inputs when that check reads eligible. This function therefore
 * legitimately treats eligibility as the CALLER's precondition rather than
 * re-deriving/re-checking it itself (re-deriving it here would mean a second,
 * redundant ~6.7s RSA-4096 re-derivation for the same logical action, and
 * this function has no access to the Ouronet bitstring that check needs
 * anyway). An ineligible codex's backup action is, per this design, simply
 * never invoked with a complete `opts` — never silently downgraded to an
 * unwrapped, partially-wrapped, or wrong-but-claimed-successful upload.
 *
 * `Codex-Form-Version` carries the real `CODEX_FORM_VERSION` constant
 * (`@ancientpantheon/codex-core`) — never a timestamp (the previous, wrong
 * convention this task also fixes). No separate timestamp tag is added
 * alongside it (this function's own choice): the Arweave transaction's own
 * network-recorded block timestamp is already a public, permanent record of
 * "when," so a duplicate app-level tag would add nothing `Codex-Form-Version`
 * doesn't already answer correctly ("what shape").
 *
 * `exportJson` is parsed via the sanctioned codec path INSIDE
 * `reencryptBackupSecretFields` (`deserializeCodex`) — a genuinely
 * un-parseable or non-codec-shaped `exportJson` now throws (there is nothing
 * for this envelope to opacity-wrap or field-transform if it cannot be read
 * at all), unlike the pre-T3 "verbatim passthrough" behavior. `appId`
 * lineage is still best-effort-derived from the ORIGINAL `exportJson` by
 * {@link deriveBackupLineage}, independently of the envelope steps above.
 *
 * Upload-THEN-append, exactly like {@link uploadAndTrack}: a throwing upload
 * (or a throwing envelope-construction step before it) rejects and leaves the
 * store EMPTY (no phantom pending entry) and `onSuccess` is never called. On
 * success, the pending {@link LibraryEntry} is appended FIRST, then
 * `opts.onSuccess?.()` fires — the actual dirty-clearing is the CALLER's job.
 */
export async function backupCodexToLibrary(
  exportJson: string,
  opts: BackupCodexToLibraryOptions,
): Promise<UploadResult> {
  const {
    store,
    pool,
    jwk,
    maxRewardWinston,
    apiFactory,
    onSuccess,
    now = Date.now,
    codexPassword,
    primeArweaveSeedBitstring,
    standardApolloBitstring,
    cryptoSeam,
    masterSeedPin,
    standardApolloPin,
    pinKeygenWorkerFactory,
  } = opts;

  requireEnvelopeInputs(opts);

  const { appId } = deriveBackupLineage(exportJson);

  // Step 1: fresh, independent DEKs — never the same key for both roles.
  const idek = await generateDek();
  const edek = await generateDek();

  // Step 2: decrypt every secret field under the current codex password,
  // re-encrypt each under the IDEK.
  const idekReencryptedJson = await reencryptBackupSecretFields(exportJson, {
    decryptField: async (ciphertext) => cryptoSeam.decrypt(ciphertext, codexPassword),
    encryptField: (plaintext) => encryptToIvPrefixedBase64(idek, plaintext),
  });

  // Step 3: encrypt the WHOLE resulting export, as one opaque blob, under
  // the EDEK — this is what hides the backup's shape/structure/counts.
  const opaqueBlob = await encryptToIvPrefixedBase64(edek, idekReencryptedJson);

  // Step 4: wrap both DEKs under EACH source's chosen path — its `...-Pin`
  // pair (T4, `codex-backup-envelope-encryption`) when that source has a
  // PIN supplied, else its `...-Default` pair exactly as T3 built it. NEVER
  // both for the same source (mutual exclusivity — see
  // `buildSourceWrapTags`'s own doc comment).
  const [masterSeedTags, standardApolloTags] = await Promise.all([
    buildSourceWrapTags({
      bitstring: primeArweaveSeedBitstring,
      pin: masterSeedPin,
      label: "masterSeedPin",
      idek,
      edek,
      cryptoSeam,
      pinKeygenWorkerFactory,
      defaultIdekTag: TAG_CODEX_BACKUP_IDEK_MASTERSEED_DEFAULT,
      defaultEdekTag: TAG_CODEX_BACKUP_EDEK_MASTERSEED_DEFAULT,
      pinIdekTag: TAG_CODEX_BACKUP_IDEK_MASTERSEED_PIN,
      pinEdekTag: TAG_CODEX_BACKUP_EDEK_MASTERSEED_PIN,
    }),
    buildSourceWrapTags({
      bitstring: standardApolloBitstring,
      pin: standardApolloPin,
      label: "standardApolloPin",
      idek,
      edek,
      cryptoSeam,
      pinKeygenWorkerFactory,
      defaultIdekTag: TAG_CODEX_BACKUP_IDEK_STANDARDAPOLLO_DEFAULT,
      defaultEdekTag: TAG_CODEX_BACKUP_EDEK_STANDARDAPOLLO_DEFAULT,
      pinIdekTag: TAG_CODEX_BACKUP_IDEK_STANDARDAPOLLO_PIN,
      pinEdekTag: TAG_CODEX_BACKUP_EDEK_STANDARDAPOLLO_PIN,
    }),
  ]);

  // Step 5: post the OPAQUE blob (never the plaintext-shaped export) with
  // the 4 wrapped-key tags (2 per source, Pin-or-Default) + the fresh
  // envelope-version axis + the real codex-shape version — all via the
  // appMetadata passthrough.
  const appMetadata: Tag[] = [
    ...masterSeedTags,
    ...standardApolloTags,
    { name: TAG_CODEX_BACKUP_ENCRYPTION_VERSION, value: CODEX_BACKUP_ENCRYPTION_VERSION_CURRENT },
    { name: TAG_CODEX_FORM_VERSION, value: CODEX_FORM_VERSION },
  ];

  const result = await uploadCodexBackup(
    pool,
    { jwk, exportJson: opaqueBlob, maxRewardWinston, appId, appMetadata },
    { apiFactory },
  );

  const entry = buildSingleEntry(result, "application/json", now());
  await store.append(entry);
  onSuccess?.();
  return result;
}

/**
 * `codex-backup-envelope-encryption` T5 — the restore-side counterpart to
 * {@link backupCodexToLibrary}: identifies which of the two default wrap
 * sources ("Master Seed" / "Standard Apollo") a given `bitstring` belongs to,
 * per {@link RestoreCodexFromBackupEnvelopeOptions.source}. Per source, both
 * the `...-Default` and `...-Pin` tag pairs it may carry share one naming
 * family — see `tags.ts`'s own doc comment.
 */
export type BackupUnlockSource = "masterSeed" | "standardApollo";

/** Which of a source's two mutually-exclusive wrap pairs (if either) a given
 *  upload's tags carry — the pure, tag-PRESENCE-only signal {@link
 *  determineBackupSourceRouting} computes, entirely independent of whether
 *  the caller's `bitstring`/`pin` are even correct. */
export type BackupSourceRouting = "default" | "pin" | "absent";

/** The four wrapped-key tag names for ONE {@link BackupUnlockSource} — the
 *  SAME two name pairs {@link buildSourceWrapTags} builds for the write side,
 *  looked up by source label so the restore side never re-derives/duplicates
 *  the naming convention. */
const BACKUP_SOURCE_TAG_NAMES: Record<
  BackupUnlockSource,
  { defaultIdek: string; defaultEdek: string; pinIdek: string; pinEdek: string }
> = {
  masterSeed: {
    defaultIdek: TAG_CODEX_BACKUP_IDEK_MASTERSEED_DEFAULT,
    defaultEdek: TAG_CODEX_BACKUP_EDEK_MASTERSEED_DEFAULT,
    pinIdek: TAG_CODEX_BACKUP_IDEK_MASTERSEED_PIN,
    pinEdek: TAG_CODEX_BACKUP_EDEK_MASTERSEED_PIN,
  },
  standardApollo: {
    defaultIdek: TAG_CODEX_BACKUP_IDEK_STANDARDAPOLLO_DEFAULT,
    defaultEdek: TAG_CODEX_BACKUP_EDEK_STANDARDAPOLLO_DEFAULT,
    pinIdek: TAG_CODEX_BACKUP_IDEK_STANDARDAPOLLO_PIN,
    pinEdek: TAG_CODEX_BACKUP_EDEK_STANDARDAPOLLO_PIN,
  },
};

/**
 * Thrown by {@link restoreCodexFromBackupEnvelope} when `source`'s tag
 * presence resolves to `"pin"` (its `...-Default` pair is absent, its
 * `...-Pin` pair is present) and no `pin` was supplied — thrown BEFORE any
 * unwrap/keygen is attempted (design.md's settled restore-routing mechanic:
 * tag presence alone tells a restorer whether a PIN is needed, never a
 * failed blind decrypt attempt). A caller catching this specific error knows
 * exactly what to do next: prompt for `source`'s PIN and retry with it.
 */
export class BackupPinRequiredError extends Error {
  constructor(public readonly source: BackupUnlockSource) {
    super(
      `restoreCodexFromBackupEnvelope: a PIN is required to unlock the "${source}" source — ` +
        `its "...-Default" wrap pair is absent and its "...-Pin" wrap pair is present on this ` +
        "upload's tags. Prompt for the PIN and retry with it; never guess or attempt a blind unwrap.",
    );
    this.name = "BackupPinRequiredError";
  }
}

/**
 * Thrown by {@link restoreCodexFromBackupEnvelope} when `source`'s tag
 * presence resolves to `"absent"` — neither `source`'s `...-Default` nor
 * `...-Pin` tag pair is present on this upload at all, meaning that source
 * was simply never used to wrap this particular backup (design.md's own
 * "tell the user plainly" case, rather than a silent/ambiguous failure).
 */
export class BackupSourceNotUsedError extends Error {
  constructor(public readonly source: BackupUnlockSource) {
    super(
      `restoreCodexFromBackupEnvelope: the "${source}" source was not used to wrap this backup — ` +
        'neither its "...-Default" nor "...-Pin" tag pair is present on this upload\'s tags. ' +
        "Try the other default source instead.",
    );
    this.name = "BackupSourceNotUsedError";
  }
}

/**
 * Determines, from tag PRESENCE ALONE (never attempting a decrypt),
 * `source`'s wrap routing for this upload: `"default"` when its
 * `...-Default` IDEK tag is present (unwrap directly, never ask for a PIN);
 * `"pin"` when `...-Default` is absent but its `...-Pin` IDEK tag is present
 * (a PIN is known to be needed, before any unwrap is attempted); `"absent"`
 * when neither is present (this source was never used for this upload at
 * all). Checks the IDEK tag only — `backupCodexToLibrary`'s own mutual-
 * exclusivity guarantee (T4) means the paired EDEK tag is always present
 * alongside it on any upload this package itself produced.
 *
 * Exported standalone (not just inlined into {@link
 * restoreCodexFromBackupEnvelope}) so a caller's UI can decide whether to
 * show a PIN prompt BEFORE it even has a candidate `bitstring`/`pin` ready —
 * this check needs only the upload's own tags.
 */
export function determineBackupSourceRouting(
  tags: readonly Tag[],
  source: BackupUnlockSource,
): BackupSourceRouting {
  const { defaultIdek, pinIdek } = BACKUP_SOURCE_TAG_NAMES[source];
  if (tags.some((t) => t.name === defaultIdek)) return "default";
  if (tags.some((t) => t.name === pinIdek)) return "pin";
  return "absent";
}

/** Reads `name`'s value off `tags`, throwing a specific error if absent —
 *  only ever called AFTER {@link determineBackupSourceRouting} has already
 *  confirmed the corresponding tag pair should be present, so a throw here
 *  means the upload's own tags are malformed (not a routing/caller-input
 *  mistake), never silently treated as "source absent" a second time. */
function requireTagValue(tags: readonly Tag[], name: string): string {
  const tag = tags.find((t) => t.name === name);
  if (tag === undefined) {
    throw new Error(
      `restoreCodexFromBackupEnvelope: expected tag "${name}" to be present (its routing already ` +
        "confirmed it should be) — this upload's tags are malformed.",
    );
  }
  return tag.value;
}

/** Options for {@link restoreCodexFromBackupEnvelope}. */
export interface RestoreCodexFromBackupEnvelopeOptions {
  /** The posted backup upload's own tags (the same `Tag[]` shape {@link
   *  backupCodexToLibrary}'s `UploadResult.tags` carries, or whatever a
   *  chain-query/rebuild path resolves them to) — read ONLY for per-source
   *  tag-presence routing; never hand-parsed for anything else. */
  tags: readonly Tag[];
  /** The posted opaque payload, decoded to the UTF-8 string `uploadCodexBackup`
   *  actually posted — i.e. exactly what fetching this upload's transaction
   *  data and UTF-8-decoding the raw bytes yields (the base64 IV-prefixed
   *  EDEK ciphertext {@link encryptToIvPrefixedBase64} produced at backup
   *  time). NEVER JSON — see `backupCodexToLibrary`'s own "opaque blob"
   *  guarantee. */
  opaqueBlob: string;
  /** Which of the two default wrap sources `bitstring` belongs to — Master
   *  Seed's 1600-bit bitstring, or Standard Apollo's 1024-bit bitstring.
   *  Determines which of the 8 wrapped-key tag names this call reads. */
  source: BackupUnlockSource;
  /** The SAME raw `"0"`/`"1"` canonical bitstring `backupCodexToLibrary` was
   *  given for this exact `source` at backup time — opaque to this function,
   *  never logged, never echoed (mirrors `BackupCodexToLibraryOptions`'s own
   *  bitstring fields exactly). A bitstring that does not match the REAL
   *  value used at backup time fails loudly at the unwrap step below (the
   *  injected `cryptoSeam`'s own wrong-key behavior), never a
   *  plausible-looking wrong success. */
  bitstring: string;
  /** REQUIRED only when {@link determineBackupSourceRouting} resolves
   *  `source` to `"pin"` — the user-supplied PIN. Omit entirely to restore a
   *  `"default"`-routed source. Supplying a `"pin"`-routed source with no
   *  `pin` throws {@link BackupPinRequiredError} BEFORE any unwrap/keygen is
   *  attempted — the caller is expected to catch that specific error, prompt
   *  for the PIN, and retry with it. */
  pin?: string;
  /** REQUIRED together with `pin` — the SAME injected Worker factory
   *  `deriveRsaKeypairAtPin` drives at backup time ({@link
   *  BackupCodexToLibraryOptions.pinKeygenWorkerFactory}'s own doc comment),
   *  never a new main-thread RSA call. Unused (may be omitted) when `source`
   *  is `"default"`-routed. */
  pinKeygenWorkerFactory?: () => Worker;
  /** The injected real V2-cipher seam — the SAME seam shape {@link
   *  wrapDekWithScalar}/{@link unwrapDekWithScalar} already use, here run in
   *  its DECRYPT direction to unwrap the IDEK/EDEK and to decrypt each
   *  IDEK-reencrypted secret field. This function never needs (and never
   *  accepts) the codex's own local password — see this function's own doc
   *  comment for why. */
  cryptoSeam: CryptoSeam;
}

/**
 * Restores a codex-backup upload's FULLY PLAINTEXT export JSON from its
 * dual-key envelope — the restore-side counterpart to {@link
 * backupCodexToLibrary}, replacing the old `Codex-Backup-Recovery-Key`-based
 * restore step entirely (design.md's own restore-order note).
 *
 * Restore order (the exact inverse of the backup order):
 *   1. {@link determineBackupSourceRouting} reads `opts.source`'s tag
 *      presence ALONE — `"default"` unwraps directly, no PIN ever asked;
 *      `"pin"` with no `opts.pin` supplied throws {@link
 *      BackupPinRequiredError} immediately, before any unwrap/keygen is even
 *      attempted; `"absent"` throws {@link BackupSourceNotUsedError}
 *      immediately — this source was never used for this particular upload.
 *   2. Resolves `source`'s actual unwrap key material: the `"default"`
 *      route re-derives `opts.bitstring`'s `base49`/`base10` scalar
 *      spellings ({@link scalarSpellings}, the SAME pairing
 *      `backupCodexToLibrary` wrapped under); the `"pin"` route re-derives
 *      the RSA-4096 keypair at the PIN-chosen position ({@link
 *      deriveRsaKeypairAtPin}, the SAME Worker-wrapped `runSeededBatch`
 *      pattern backup time used — never a new main-thread RSA call) and
 *      uses its `p`/`q` CRT primes.
 *   3. Unwraps the EDEK and the IDEK ({@link unwrapDekWithScalar} — a wrong
 *      `bitstring`/PIN fails loudly here, the injected `cryptoSeam`'s own
 *      wrong-key behavior propagating unmodified, never a plausible-looking
 *      wrong success).
 *   4. Decrypts `opts.opaqueBlob` under the unwrapped EDEK ({@link
 *      decryptFromIvPrefixedBase64}) to recover the IDEK-reencrypted export
 *      JSON string.
 *   5. Calls `reencryptBackupSecretFields` with `decryptField` set to decrypt
 *      each of the three documented secret fields under the unwrapped IDEK
 *      ({@link decryptFromIvPrefixedBase64} again — the SAME byte layout, a
 *      different "layer"), and `encryptField` set to a NO-OP passthrough
 *      (`async (plaintext) => plaintext`). `reencryptBackupSecretFields` was
 *      built generically as decrypt-then-encrypt (T2,
 *      `codex-backup-envelope-encryption`); feeding it a passthrough
 *      `encryptField` is the deliberate, minimal way to reuse that exact
 *      function for a decrypt-ONLY pass here, rather than writing a second,
 *      parallel field-walker — the three documented secret-field paths stay
 *      owned by exactly one function, never duplicated.
 *
 * The result is the FULLY plaintext codex export JSON — no password of any
 * kind (old or new) is consulted anywhere in this function; `opts` has no
 * `codexPassword`-shaped field at all, architecturally, not just
 * incidentally. Per design.md's own restore-order note, the caller is
 * expected to hand this plaintext JSON to the existing "prompt for a new
 * password, encrypt locally, inject into the browser" tail — this function's
 * own job ends at producing fully-decrypted plaintext, matching {@link
 * backupCodexToLibrary}'s own symmetric scope (that function's job begins
 * AFTER eligibility is already established upstream; this one's ends BEFORE
 * a new password is chosen downstream).
 */
export async function restoreCodexFromBackupEnvelope(
  opts: RestoreCodexFromBackupEnvelopeOptions,
): Promise<string> {
  const { tags, opaqueBlob, source, bitstring, pin, pinKeygenWorkerFactory, cryptoSeam } = opts;
  const { defaultIdek, defaultEdek, pinIdek, pinEdek } = BACKUP_SOURCE_TAG_NAMES[source];

  const routing = determineBackupSourceRouting(tags, source);

  let idek: CryptoKey;
  let edek: CryptoKey;

  if (routing === "absent") {
    throw new BackupSourceNotUsedError(source);
  } else if (routing === "pin") {
    if (pin === undefined) {
      throw new BackupPinRequiredError(source);
    }
    if (pinKeygenWorkerFactory === undefined) {
      throw new Error(
        'restoreCodexFromBackupEnvelope: "pinKeygenWorkerFactory" is required to restore the ' +
          `PIN'd "${source}" source.`,
      );
    }
    const { p, q } = await deriveRsaKeypairAtPin(bitstring, pin, `${source}Pin`, pinKeygenWorkerFactory);
    idek = await unwrapDekWithScalar(requireTagValue(tags, pinIdek), p, cryptoSeam);
    edek = await unwrapDekWithScalar(requireTagValue(tags, pinEdek), q, cryptoSeam);
  } else {
    const { base49, base10 } = scalarSpellings(bitstring);
    idek = await unwrapDekWithScalar(requireTagValue(tags, defaultIdek), base49, cryptoSeam);
    edek = await unwrapDekWithScalar(requireTagValue(tags, defaultEdek), base10, cryptoSeam);
  }

  const idekReencryptedJson = await decryptFromIvPrefixedBase64(edek, opaqueBlob);

  return reencryptBackupSecretFields(idekReencryptedJson, {
    decryptField: (ciphertext) => decryptFromIvPrefixedBase64(idek, ciphertext),
    encryptField: async (plaintext) => plaintext,
  });
}

/**
 * Poll `id`'s confirmation status through the pool and flip its entry to `final`
 * ONLY when arweave-core reports `confirmed && final === true`.
 *
 * Every other result LEAVES the entry pending with no throw: a shallow
 * `confirmed && final:false`, a `pending`, and a `not-found` all no-op. Finality
 * is arweave-core's decision — this function does not re-derive it.
 */
export async function pollStatus(
  id: string,
  opts: PollStatusOptions,
): Promise<void> {
  const { pool, store, fetchFn, confirmationDepth } = opts;

  // POOL-FIRST arity: getTransactionStatus(pool, id, opts). `confirmationDepth`
  // is forwarded verbatim — when omitted it is `undefined`, so arweave-core's
  // DEFAULT_CONFIRMATION_DEPTH governs (never a local 10).
  const status = await arweaveCore.getTransactionStatus(pool, id, {
    fetchFn,
    confirmationDepth,
  });

  if (status.status === "confirmed" && status.final === true) {
    await store.updateStatus(id, "final");
  }
}

/**
 * Compose the gateway URL for `id` against a HEALTHY endpoint.
 *
 * Selection: prefer a `healthy && active` endpoint; else any `healthy`; else
 * fall back to `getActiveEndpoint()` (active is NOT guaranteed healthy). A
 * non-canonical id throws before any URL is composed. Never hardcodes a gateway.
 */
export function openUrl(id: string, opts: OpenUrlOptions): string {
  if (!isCanonicalAddress(id)) {
    throw new Error(`openUrl: non-canonical arweave id "${id}"`);
  }

  const { pool } = opts;
  const snapshot = pool.getHealthSnapshot();

  const healthyActive = snapshot.find((e) => e.healthy && e.active);
  const healthy = healthyActive ?? snapshot.find((e) => e.healthy);
  const endpoint = healthy ? healthy.endpoint : pool.getActiveEndpoint();

  // Strip a trailing slash so a caller-configured endpoint like
  // "https://arweave.net/" yields a single-slash join, not "//<id>".
  const base = endpoint.replace(/\/+$/, "");
  return `${base}/${id}`;
}
