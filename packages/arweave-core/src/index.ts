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

// ── Upload: Turbo bundling path + required tag schema (Phase 4) ─────────────
// The DEFAULT Turbo client factory (turboClient.ts) is DELIBERATELY PRIVATE —
// the single runtime site importing `@ardrive/turbo-sdk`. Consumers inject a
// custom client via `uploadData`'s options (a browser consumer injects a
// web-built client / aliases the SDK to its web build), rather than minting SDK
// clients through us — mirroring the tx module's endpoint-client-factory
// decision. `uploadData` lazily imports it only when no client is injected.
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
} from "./upload/tags.js";
export type { Tag, BuildUploadTagsParams } from "./upload/tags.js";
export type {
  UploadParams,
  UploadResult,
  TurboUploadClient,
  TurboUploadClientFactory,
} from "./upload/types.js";
export { InvalidUploadParamsError, UploadFailedError } from "./upload/errors.js";
export type { UploadFailedReason } from "./upload/errors.js";

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
