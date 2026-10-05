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
import { encryptWithAccountKey } from "../crypto/accountKeyCipher.js";
import type { CryptoSeam } from "@ancientpantheon/codex-core";

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

/** The app-metadata tag name carrying {@link backupCodexToLibrary}'s
 *  optional encrypted-codex-password recovery payload (T2,
 *  `codex-recovery-backup-tagging`) — see that function's own doc comment
 *  for the full rationale. Not a new entry in arweave-core's `tags.ts`
 *  reserved-name schema: this rides the existing `appMetadata` passthrough
 *  seam exactly like `TAG_CODEX_PATH` above. */
const TAG_CODEX_BACKUP_RECOVERY_KEY = "Codex-Backup-Recovery-Key";

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
   * The plaintext password the codex is CURRENTLY unlocked with (T2,
   * `codex-recovery-backup-tagging`). Opaque to this function, exactly like
   * `exportJson` already is — NEVER logged, NEVER echoed, and never placed
   * into an error. Combined with `primeArweaveSeedBitstring` and
   * `cryptoSeam` (see below) to attach an encrypted recovery copy of this
   * value to the upload; see {@link backupCodexToLibrary}'s own doc comment.
   */
  codexPassword?: string;
  /**
   * The Prime Arweave seed's raw 1600-bit `"0"`/`"1"` canonical bitstring
   * (T2, `codex-recovery-backup-tagging`) — NEVER its base10/base49 spelling
   * (see `accountKeyCipher.ts`'s own warning). Opaque to this function,
   * never logged, never echoed.
   */
  primeArweaveSeedBitstring?: string;
  /**
   * The injected real cipher seam `encryptWithAccountKey` delegates to —
   * mirrors `keyring/foreignKeys.ts`'s own `cryptoSeam` injection pattern
   * (this module does not and must not depend on `@stoachain/stoa-core`
   * directly). Required, together with `codexPassword` and
   * `primeArweaveSeedBitstring`, for the recovery-key tag to be attached.
   */
  cryptoSeam?: CryptoSeam;
}

/**
 * Best-effort, FULLY DEFENSIVE derivation of `{ appId, appVersion }` from an
 * opaque `exportJson` string, for {@link backupCodexToLibrary}'s real
 * version-lineage tagging.
 *
 * `exportJson` is parsed with `JSON.parse` (returning `unknown`) and read
 * back through narrow, unknown-safe property checks ONLY — this function
 * MUST NOT import any type from `codex-core`/`codex-ouronet`/any other
 * `codex-*` package (this module's own isolation, documented at the top of
 * this file, applies here too). Any parse failure, missing field, or
 * wrong-typed field yields `undefined` for that field rather than throwing —
 * a codex backup must never fail because the export JSON's shape was
 * slightly different than expected.
 *
 *   - `appId` = `parsed.codexIdentity.formatted` when it is a string.
 *   - `appVersion` = `parsed.lastUpdatedAt` when it is a string.
 */
function deriveBackupLineage(exportJson: string): { appId?: string; appVersion?: string } {
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

    let appVersion: string | undefined;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "lastUpdatedAt" in parsed &&
      typeof (parsed as { lastUpdatedAt: unknown }).lastUpdatedAt === "string"
    ) {
      appVersion = (parsed as { lastUpdatedAt: string }).lastUpdatedAt;
    }

    return { appId, appVersion };
  } catch {
    // Not valid JSON, or some other parse-time throw — no lineage tag this
    // time, but the backup itself must still proceed.
    return {};
  }
}

/**
 * Backs up the codex's existing export (`exportJson`, an OPAQUE string this
 * module does not parse or interpret BEYOND the best-effort lineage
 * derivation below) to Arweave under `Codex-Category: codex-backup`, via
 * arweave-core's dedicated `uploadCodexBackup` primitive (T4) — never the
 * classic `uploadData`/`uploadBundle` call sites above, and never the bundle
 * path (a codex backup is always exactly one file).
 *
 * BEFORE uploading, `deriveBackupLineage` best-effort-derives `appId`/
 * `appVersion` from `exportJson` and forwards them to `uploadCodexBackup` —
 * real version lineage across a codex's own backup history. This derivation
 * is FULLY DEFENSIVE: a malformed or non-JSON `exportJson` never throws from
 * this step, it just proceeds with no lineage tags.
 *
 * Upload-THEN-append, exactly like {@link uploadAndTrack}: a throwing upload
 * rejects and leaves the store EMPTY (no phantom pending entry) and
 * `onSuccess` is never called. On success, the pending {@link LibraryEntry}
 * is appended FIRST, then `opts.onSuccess?.()` fires — the actual
 * dirty-clearing is the CALLER's job (this module has zero knowledge of
 * `clearDirty()` or any `codex-ouronet` concept).
 *
 * `codex-recovery-backup-tagging` T2: when `opts.codexPassword`,
 * `opts.primeArweaveSeedBitstring`, AND `opts.cryptoSeam` are ALL present,
 * `codexPassword` is encrypted under the Prime Arweave account's bitstring
 * key (`accountKeyCipher.ts`'s `encryptWithAccountKey`) and the resulting
 * ciphertext is attached to the SAME upload as a `Codex-Backup-Recovery-Key`
 * app-metadata tag — so a future restore-by-seed-words flow can recover the
 * codex password from nothing but the same seed words that re-derive this
 * account. If ANY of the three is absent, this step is skipped entirely:
 * no tag, no error, no placeholder value — a codex with no Prime Arweave
 * seed yet still backs up exactly as it does today (regression guard).
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
    cryptoSeam,
  } = opts;

  const { appId, appVersion } = deriveBackupLineage(exportJson);

  // T2 (codex-recovery-backup-tagging): all three of codexPassword /
  // primeArweaveSeedBitstring / cryptoSeam must be present — any one absent
  // skips this entirely, no tag, no error (a codex with no Prime Arweave
  // seed yet must still back up normally).
  const appMetadata =
    codexPassword !== undefined && primeArweaveSeedBitstring !== undefined && cryptoSeam !== undefined
      ? [
          {
            name: TAG_CODEX_BACKUP_RECOVERY_KEY,
            value: await encryptWithAccountKey(codexPassword, primeArweaveSeedBitstring, cryptoSeam),
          },
        ]
      : undefined;

  const result = await uploadCodexBackup(
    pool,
    { jwk, exportJson, maxRewardWinston, appId, appVersion, appMetadata },
    { apiFactory },
  );

  const entry = buildSingleEntry(result, "application/json", now());
  await store.append(entry);
  onSuccess?.();
  return result;
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
