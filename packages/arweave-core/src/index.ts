/**
 * `@ancientpantheon/arweave-core` public API.
 *
 * The single entry point for the package: everything a consumer may reach is
 * re-exported here with EXPLICIT NAMED exports (never `export *`), so the public
 * surface is auditable and internal helpers stay private-by-default. Type-only
 * members use `export type`, making the value/type split of the surface explicit
 * (and keeping the barrel correct under `isolatedModules`/`verbatimModuleSyntax`
 * if ever enabled).
 *
 * Every typed error class thrown by an exported public function is itself
 * exported: consumers must be able to `instanceof`-catch (the library contract
 * forbids parsing error message strings). This is why `InvalidGatewayConfigError`
 * (thrown by `createGatewayPool`) and `InvalidBase64UrlError` (thrown through
 * `addressOf`) appear below alongside the functions that throw them.
 *
 * DELIBERATELY PRIVATE: the base64url `base64urlEncode`/`base64urlDecode`
 * helper FUNCTIONS and the gateway health-tracker internals are implementation
 * detail, not public surface — only the error CLASS `InvalidBase64UrlError` is
 * public.
 */

// ── Gateway pool ───────────────────────────────────────────────────────────
export { createGatewayPool } from "./gateway/pool.js";
export {
  GatewayError,
  GatewayPoolExhaustedError,
  InvalidGatewayConfigError,
} from "./gateway/errors.js";
export type { GatewayAttempt } from "./gateway/errors.js";
export type {
  GatewayPoolConfig,
  GatewayPool,
  GatewayOperation,
  GatewayOperationContext,
  EndpointHealth,
  SleepFn,
  NowFn,
  SetRequestTimerFn,
  ClearRequestTimerFn,
  RequestTimerHandle,
} from "./gateway/types.js";

// ── Canonical address / txid predicate ─────────────────────────────────────
// The shared 43-char base64url gate every read/transfer/upload/rebuild path
// uses. Public so consumers validating ids before composing gateway URLs or
// embedding them in a signed tx can gate on the exact same form.
export { isCanonicalAddress, ARWEAVE_ADDRESS_RE } from "./canonical.js";

// ── Units (Winston ↔ AR) ───────────────────────────────────────────────────
export { WINSTON_PER_AR, arToWinston, winstonToAr, InvalidAmountError } from "./units.js";

// ── Keys: canonical type, generation, keyfile import/export ────────────────
export type { ArweaveJwk } from "./keys/types.js";
export { generateKey } from "./keys/generate.js";
export { importKeyfile, exportKeyfile } from "./keys/keyfile.js";
export { InvalidKeyfileError } from "./keys/errors.js";
export type { InvalidKeyfileReason } from "./keys/errors.js";

// ── Keys: address derivation (encode/decode helpers stay internal) ─────────
// Phase 3 T3.2 consolidated every keys-module error into `./keys/errors.js`;
// the barrel now points the base64url error at that single home. Public name
// and identity are unchanged (encoding.ts re-exports it, so either path is the
// same class).
export { addressOf } from "./keys/address.js";
export { InvalidBase64UrlError } from "./keys/errors.js";
export type { InvalidBase64UrlReason } from "./keys/errors.js";

// ── Keys: flag-gated derivation design stubs (default OFF) ─────────────────
// The stub FUNCTIONS + flags stay pointed at `./keys/derivation.js` (their
// home); the two derivation ERROR classes are repointed to the consolidated
// `./keys/errors.js` (Phase 3 T3.2), same class either way.
export {
  DEFAULT_KEY_DERIVATION_FLAGS,
  generateFromMnemonic,
  deriveFromEthereumSignature,
} from "./keys/derivation.js";
export type { KeyDerivationFlags } from "./keys/derivation.js";
export {
  KeyDerivationDisabledError,
  KeyDerivationNotImplementedError,
} from "./keys/errors.js";
export type { KeyDerivationPath } from "./keys/errors.js";

// ── Signing: isolated RSA-PSS + deep-hash signer (Phase 3) ─────────────────
export { signTransaction, SigningError } from "./signing/sign.js";

// ── Endpoints: package-wide origin-only policy (Phase 3) ───────────────────
// Only the ERROR class is public — it surfaces UNWRAPPED from the eager
// pre-flight in sendTransfer/getBalance/getTransactionStatus, per the
// every-thrown-error-is-exported rule. `assertOriginOnlyEndpoints` stays an
// internal helper (mirrors the private-by-default encode/decode decision).
export { UnsupportedEndpointError } from "./endpoints.js";

// ── Reads: address balance + transaction status/depth (Phase 3) ────────────
export { getBalance } from "./reads/balance.js";
export { getTransactionStatus, DEFAULT_CONFIRMATION_DEPTH } from "./reads/status.js";
export type {
  TransactionStatus,
  ConfirmedTransactionStatus,
  PendingTransactionStatus,
  NotFoundTransactionStatus,
} from "./reads/status.js";
export {
  InvalidAddressError,
  InvalidTransactionIdError,
  InvalidGatewayResponseError,
} from "./reads/errors.js";

// ── Reads: Winston fee/price-quote estimate (Phase 4) ───────────────────────
// Extracted from `tx/transfer.ts`'s own inline price-fetch so there is exactly
// one implementation of "fetch and validate a Winston price quote through the
// pool" — `sendTransfer` calls this too. `EstimateFeeOptions.getPrice` is an
// internal seam `sendTransfer` reuses for its own test-injectable
// `apiFactory`; a plain consumer never needs it.
export { estimateFee } from "./reads/fee.js";
export type { EstimateFeeOptions, EstimateFeeGetPriceFn } from "./reads/fee.js";

// ── Transfer: native AR transfer orchestration (Phase 3) ───────────────────
// The per-endpoint arweave-js client factory (endpointClient.ts) is
// DELIBERATELY PRIVATE — an internal seam of the tx path; consumers configure
// gateways via the pool, not by minting arweave-js instances (mirrors T2.8's
// encoding-helper decision).
export { sendTransfer } from "./tx/transfer.js";
export type {
  TransferParams,
  TransferGatewayApi,
  TransferGatewayApiFactory,
  SendTransferOptions,
  TransferResult,
} from "./tx/types.js";
export {
  InvalidTransferError,
  TransferPostFailedError,
  InvalidGatewayPriceError,
  RewardExceedsCapError,
} from "./tx/errors.js";

// ── Upload: native Arweave transaction path + required tag schema (Phase 4) ─
// `uploadData` posts a data item as a native (non-bundler) Arweave transaction
// through `postArweaveData` (nativeUpload.ts, T3) — a pool-driven, chunked
// upload, no bundler service involved. The per-endpoint gateway-API factory is
// the injectable seam (`UploadOptions.apiFactory`), mirroring the tx module's
// `SendTransferOptions.apiFactory` decision; consumers/tests inject a fake
// rather than minting SDK clients through us.
export { uploadData } from "./upload/upload.js";
export type { UploadOptions } from "./upload/upload.js";
export {
  buildUploadTags,
  DEFAULT_APP_NAME,
  TAG_APP_NAME,
  TAG_CONTENT_TYPE,
  TAG_CODEX_ITEM_ID,
  TAG_CODEX_OWNER,
  REQUIRED_UPLOAD_TAG_NAMES,
  TAG_CODEX_TAG_SCHEMA_VERSION,
  CODEX_TAG_SCHEMA_VERSION_CURRENT,
  TAG_CODEX_UPLOAD_ID,
  TAG_CODEX_ITEM_TYPE,
  TAG_CODEX_CATEGORY,
  TAG_CODEX_ASSET_TYPE,
  TAG_CODEX_APP_ID,
  TAG_CODEX_APP_VERSION,
  TAG_CODEX_ENCRYPTED,
  TAG_CODEX_ENCRYPTOR,
  TAG_CODEX_ENCRYPTION_VERSION,
  CODEX_ENCRYPTION_VERSION_CURRENT,
  UPLOAD_CATEGORIES,
  NFT_ASSET_TYPES,
} from "./upload/tags.js";
export type {
  Tag,
  BuildUploadTagsParams,
  UploadItemType,
  UploadCategory,
  NftAssetType,
} from "./upload/tags.js";
export type { UploadParams, UploadResult } from "./upload/types.js";
export { InvalidUploadParamsError, UploadFailedError } from "./upload/errors.js";
export type { UploadFailedReason } from "./upload/errors.js";
// The injectable per-endpoint gateway-API seam `uploadData`/`uploadBundle` both
// forward to `postArweaveData` (`UploadOptions.apiFactory` / T6's
// `UploadBundleOptions.apiFactory`) — mirroring `TransferGatewayApiFactory`'s
// own exported-type treatment just above. A consumer composing its own
// upload-then-track flow (e.g. codex-arweave's `library/flow.ts`) needs this
// type to declare its own forwarding seam without a deep-path import.
export type {
  UploadGatewayApi,
  UploadGatewayApiFactory,
  ChunkedUploader,
} from "./upload/nativeUpload.js";
// `postArweaveData` itself (the pool-driven build+sign+chunked-post
// primitive `uploadData`/`uploadBundle` both forward to) was previously
// reachable ONLY through those two thin wrappers. Exported directly here
// (arweave-streaming-post-core, T3) because the streaming post path's own
// comparison tests need to drive it with ARBITRARY raw tags/data (not
// `uploadData`'s Codex tag schema, nor `uploadBundle`'s own internal
// per-file signing) to prove the streaming path produces a
// protocol-identical transaction for the SAME input — a gap this task found
// and fixed, not a pre-existing export.
export { postArweaveData } from "./upload/nativeUpload.js";
export type {
  PostArweaveDataParams,
  PostArweaveDataOptions,
  PostArweaveDataResult,
} from "./upload/nativeUpload.js";

// ── Upload: multi-file/folder ANS-104 bundle path (Phase 4, T6) ─────────────
// `uploadBundle` is the counterpart to `uploadData` for 2+ files or an
// explicit folder selection — one atomic `arbundles` ANS-104 bundle (N signed
// file data items + a signed `arweave/paths` manifest data item, all sharing
// one `Codex-Upload-Id`), posted as ONE wrapping transaction via the SAME
// `postArweaveData` primitive. Held back from the T5 export block (Wave 2) to
// avoid a concurrent-edit conflict with T5 on this same file; added here now
// that both Wave 2 tasks have landed.
export { uploadBundle } from "./upload/bundle.js";
export type {
  UploadBundleFile,
  UploadBundleParams,
  UploadBundleOptions,
  UploadBundleResult,
} from "./upload/bundle.js";

// ── Upload: dedicated codex-backup primitive (arweave-upload-categories, T4) ─
// `uploadCodexBackup` is a thin, hardcoded-`category:"codex-backup"` wrapper
// around `uploadData` — the codex's own consuming app (codex-arweave) composes
// it with its own export flow; this package stays zero-dependency on any
// `codex-*` package.
export { uploadCodexBackup } from "./upload/codexBackup.js";
export type { UploadCodexBackupParams } from "./upload/codexBackup.js";

// ── Upload: streaming data_root pipeline (arweave-streaming-data-root) ─────
// `planChunkBoundaries` (T1) and `computeStreamingDataRoot` (T2) are the
// foundation of the streaming-upload project (`docs/work/arweave-streaming-
// upload/design.md`): computing an Arweave `data_root` from a byte-range
// reader instead of a fully-materialized buffer, so a 6+ GB upload never
// needs to be resident in browser memory. Exported the same way
// `queryUploadsByTag` was (this package's `exports` field only exposes the
// barrel, no subpath exports) because the OPFS-backed bundle-assembly work
// that consumes these lives in `codex-arweave`, a separate package — it can
// only reach them through here.
export { planChunkBoundaries } from "./upload/streaming/planChunkBoundaries.js";
export type { ChunkBoundary } from "./upload/streaming/planChunkBoundaries.js";
export { computeStreamingDataRoot } from "./upload/streaming/computeStreamingDataRoot.js";
export type {
  ByteRangeReader,
  StreamingDataRootResult,
  Chunk,
} from "./upload/streaming/computeStreamingDataRoot.js";

// ── Upload: streaming transaction creation + gateway post seam
//    (arweave-streaming-post-core, T3) ──────────────────────────────────────
// `createStreamingTransaction` builds+signs a Transaction directly from an
// already-computed streaming `data_root` (never a resident data buffer) —
// the real `arweave` package's `Transaction`/`createTransaction` surface this
// needs is NOT otherwise reachable outside this package (see that module's
// own "PACKAGE PLACEMENT" doc comment for why this stays here rather than in
// `codex-arweave`, whose own `src` takes no direct `arweave` dependency at
// all). Exported the same way `computeStreamingDataRoot` just above is —
// `codex-arweave`'s own streaming post loop (OPFS-specific chunk reads) is a
// separate package and can only reach this through the barrel.
export {
  createStreamingTransaction,
  createDefaultStreamingUploadGatewayApiFactory,
} from "./upload/streaming/createStreamingTransaction.js";
export type {
  SignedStreamingTransaction,
  CreateStreamingTransactionParams,
  StreamingChunkPostBody,
  StreamingUploadGatewayApi,
  StreamingUploadGatewayApiFactory,
} from "./upload/streaming/createStreamingTransaction.js";

// ── Upload: local/no-op dry-run gateway (arweave-upload-dry-run, T1) ────────
// A shippable (not test-only) stand-in satisfying both `UploadGatewayApiFactory`
// and `StreamingUploadGatewayApiFactory` — captures posted tx/chunks in
// memory, zero real network reachability. `codex-arweave`'s own dry-run
// engine (`arweave-upload-dry-run` T2) needs this through the barrel, same
// cross-package-reachability reason as `createStreamingTransaction` above.
export { createLocalDryRunGatewayApiFactory } from "./upload/localDryRunGateway.js";
export type { LocalDryRunGateway, CapturedDryRunTx } from "./upload/localDryRunGateway.js";

// ── Rebuild: owner → matching tx ids + tags via GraphQL through the pool ────
export { queryOwnerUploads } from "./rebuild/query.js";
export {
  DEFAULT_REBUILD_PAGE_SIZE,
  DEFAULT_REBUILD_MAX_PAGES,
} from "./rebuild/types.js";
export type {
  OwnerUploadRecord,
  QueryOwnerUploadsOptions,
} from "./rebuild/types.js";
export {
  InvalidRebuildParamsError,
  RebuildPageLimitError,
} from "./rebuild/errors.js";

// ── Rebuild: tag-only (no owner filter) GraphQL query through the pool ─────
// `queryUploadsByTag` (T2, `arweave-non-removable-account`) is the sanctioned
// seam for a downstream chain-query safety net (e.g. `codex-arweave`'s
// `checkAccountEncryptedArweaveUploads`) that must find any confirmed upload
// carrying an arbitrary tag/value pair — `queryOwnerUploads`'s `owners`
// filter is mandatory (see that function's own module doc) and cannot answer
// this. Exported the same way `queryOwnerUploads` is, so downstream packages
// never need a deep-path import.
export { queryUploadsByTag } from "./rebuild/query.js";
export type { QueryUploadsByTagOptions } from "./rebuild/query.js";
