/**
 * Public barrel for @ancientpantheon/codex-core.
 *
 * codex-core is the CANONICAL owner of the chain-agnostic codex substrate: the
 * "1.3" codex envelope codec, the typed error family, the seedless foreignKeys
 * keyring model, the generic storage-adapter seam (plus two reference adapters),
 * the foreign-chain adapter registry, and the CK-wrapping vault contract.
 *
 * The surface is EXPLICITLY NAMED (never `export *`) so it stays auditable — no
 * internal helper leaks into the public API. Each seam also has its own subpath
 * barrel (`./adapters`, `./chains`, `./vault`); this root barrel aggregates them.
 */

// ----- product-facing form version (NOT the at-rest migration counter —
// ----- see codexPackageVersionOutput.ts's own doc comment for why these are separate) -----

export { CODEX_PACKAGE_VERSION_OUTPUT } from "./codexPackageVersionOutput.js";

// ----- per-codex-instance shape stamp (`codex-shape-version-stamp` topic) —
// ----- DISTINCT from the product-facing CODEX_FORM_VERSION above: this is
// ----- per-codex-instance, not per-app-build; see shapeVersion.ts's own doc
// ----- comment -----

export {
  detectCodexShapeVersion,
  formatCodexShapeVersionLabel,
} from "./codex/shapeVersion.js";

// ----- codec envelope (D2) -----

export {
  buildCodexExport,
  serializeCodex,
  deserializeCodex,
} from "./codex/codec.js";

export type {
  PlaintextCodex,
  CodexExportV1_2,
  CodexExportV1_3,
} from "./codex/types.js";
// ----- master-key locks: which derived key positions are load-bearing and
// therefore unremovable; see codex/masterKeyLocks.ts for why this is a
// reason-tagged registry rather than a boolean flag.
export {
  lockMatchesPosition,
  lockedPositionsOf,
  seedIsLocked,
} from "./codex/masterKeyLocks.js";
export type { MasterKeyLock, MasterKeyLockReason } from "./codex/masterKeyLocks.js";
// ----- locked entities: one reason-returning predicate per entity type, each
// answering "would the store refuse to delete this?". Built ON the lock
// registry above — `chainwebSeedLock`/`chainwebKeyPositionLock` CALL its
// helpers rather than restate them, and `MasterKeyLockReason` rides into
// `EntityLockReason` verbatim so a medallion and a thrown
// `CodexMasterKeyLockedError` name the same thing. Render-time cheap and
// in-memory by contract; see codex/lockedEntities.ts for why the reason, and
// not a boolean, is the return value.
export {
  ouronetAccountLock,
  chainwebSeedLock,
  chainwebKeyPositionLock,
  pureKeypairLock,
  arweaveSeedLock,
} from "./codex/lockedEntities.js";
export type {
  EntityLock,
  EntityLockReason,
  OuronetAccountLockCandidate,
  OuronetAccountLockOpts,
  ChainwebSeedLockCandidate,
  ChainwebKeyPositionLockOpts,
  PureKeypairLockCandidate,
  ArweaveSeedLockCandidate,
} from "./codex/lockedEntities.js";
// ----- the Codex Master Seed row: which three entities are the three faces
// of this codex's one seed. Pure linkage; see codex/masterSeed.ts.
// `recordFormerMasterIds` is the one writer of the former-holder history;
// `isFormerMasterAccount`/`isFormerMasterArweaveSeed`/`isLegacyPrimeAccount`
// are its readers, and all three take the migration progress because the
// designation follows the SEAL, not the finalize. `isLegacyPrimeAccount` is
// the one the accounts tab renders ("Former Codex Prime"); it reads the
// WRITE-ONCE `legacyPrimeOuroAccountId`, not the append-only history, because
// that history accumulates wizard candidates that displaced nobody.
export {
  describeCodexMasterSeed,
  recordFormerMasterIds,
  isFormerMasterAccount,
  isFormerMasterArweaveSeed,
  isLegacyPrimeAccount,
} from "./codex/masterSeed.js";
export type { CodexMasterSeed, CodexMasterSeedFaces } from "./codex/masterSeed.js";
// ----- which Ouronet account the codex has SETTLED on as its master: the
// account-side twin of codex-arweave's `resolveMasterArweaveSeed`, with the
// same precedence (settled id > `isPrime` > position 0). A pure list-and-id
// resolver — it does NOT apply the seal gate; see
// codex/masterOuronetAccount.ts for why that is the caller's job here while
// `isFormerMasterAccount` above gates itself.
export { resolveMasterOuronetAccount } from "./codex/masterOuronetAccount.js";
export type { MasterOuronetAccountCandidate } from "./codex/masterOuronetAccount.js";
// ----- a started-but-unfinished eligibility migration. Carries ids and
// public keys only; `toPersistableAccountSelection` is what keeps seed words
// out of it. See codex/migrationProgress.ts.
export {
  toPersistableAccountSelection,
  isResumableSelection,
  containsSuspectedSecret,
  isMigrationSealed,
  hasMigrationPending,
} from "./codex/migrationProgress.js";
export type {
  MigrationProgress,
  MigrationStage,
  MigrationPendingPlan,
  MigrationSelection,
  MigrationAccountSelection,
  MigrationPaymentSelection,
  MigrationGuardSelection,
  MigrationCommitRecord,
  MigrationExecutionStep,
  LiveAccountChoice,
} from "./codex/migrationProgress.js";
// ----- the MIGRATION CHAIN's brain: design §2's step order, §4's predicates
// over chain state (which is what makes the chain idempotent and re-pressing
// the recovery path), §5's once-only preconditions and round 2's keyset
// -definition step. Pure — it imports nothing, so no chain read, no React and no
// `@stoachain` can arrive through it; the engine in codex-ouronet is a loop
// over `planMigrationChain`'s output. `paymentKeyAccountString` is the
// bare-key -> account-string conversion `store.ts:2680` encodes and nothing
// else performs. See codex/migrationChain.ts.
export {
  planMigrationChain,
  checkMigrationPreconditions,
  sumIgnisNeed,
  paymentKeyAccountString,
  bareKeyOf,
  STOA_CONSOLIDATION_TARGET_CHAIN,
  CONSOLIDATION_SOURCE_CHAINS,
  KEYSET_UPDATE_NO_REF_REASON,
  KEYSET_UPDATE_FORFEITED_REASON,
  KEYSET_UPDATE_NO_DEFINITION_REASON,
} from "./codex/migrationChain.js";
export type {
  ChainStateSnapshot,
  MigrationGuardTarget,
  MigrationChainIntent,
  MigrationChainStep,
  MigrationChainStepKind,
  MigrationChainPlan,
  MigrationIgnisCosts,
  MigrationPreconditionInputs,
  MigrationPreconditionVerdict,
  MigrationPreconditionFailure,
  MigrationPreconditionCode,
} from "./codex/migrationChain.js";
// ----- canonical display names for the Codex Master Seed and its three
// derivations; see codex/masterNames.ts for why the positional rule lives
// there too rather than being re-inlined at every call site.
export {
  OURONET_CODEX_MASTER,
  MASTER_CHAINWEB_SEED,
  MASTER_ARWEAVE_SEED,
  CODEX_MASTER_SEED,
  CODEX_STOIC_IDENTITY,
  FORMER_CODEX_PRIME,
  FORMER_MASTER_ARWEAVE_SEED,
  masterOuronetAccountName,
  masterOuronetAccountParts,
  masterChainwebSeedName,
} from "./codex/masterNames.js";
export type {
  MasterOuronetAccountOpts,
  MasterOuronetAccountParts,
} from "./codex/masterNames.js";

export {
  isForeignKeyEntry,
  type ForeignKeyEntry,
  type ForeignKeysBlock,
} from "./codex/foreignKeys.js";

export {
  isPureKeypairEntry,
  type PureKeypairEntry,
} from "./codex/pureKeypairs.js";

export {
  reencryptBackupSecretFields,
  type ReencryptBackupSecretFieldsOptions,
} from "./codex/backupReencryption.js";

// ----- 1-bit "key bitmap" BMP codec -----

export {
  encodeBitmapBMP,
  decodeBitmapBMP,
  type DecodedBitmap,
  type DecodeBitmapResult,
} from "./codex/bitmapCodec.js";

// ----- typed error family -----

export {
  CodexError,
  CodexUnknownFieldError,
  CodexAdapterError,
  CodexKeyMissingError,
} from "./codex/errors.js";

// ----- storage-adapter seam + reference adapters -----

export {
  emptySnapshotBase,
  assertCodexAdapter,
  MemoryCodexAdapter,
  LocalStorageCodexAdapter,
  type CodexSnapshotBase,
  type CodexAdapter,
  type DeviceVariant,
  type StorageLike,
  type LocalStorageCodexKeys,
  type LocalStorageCodexAdapterOptions,
} from "./adapters/index.js";

// ----- foreign-chain adapter registry -----

export {
  createForeignChainRegistry,
  ForeignChainError,
  type ForeignChainAdapter,
  type ForeignChainRegistry,
} from "./chains/index.js";

// ----- CK-wrapping vault contract -----

export {
  makeVault,
  VaultCryptoError,
  makePasswordCache,
  isUnlocked,
  type CryptoSeam,
  type Vault,
  type PasswordCacheEntry,
} from "./vault/index.js";

// ----- headless resolver factory (D4) -----

export { createHeadlessCodexResolver } from "./resolver/index.js";

export type {
  ResolvedStoaChainKeypair,
  HeadlessResolverDeps,
  HeadlessCodexResolver,
  SnapshotSlice,
  StoaChainSeedLike,
  PureKeypairLike,
  StoaChainSeedType,
  MnemonicSeedType,
} from "./resolver/index.js";

// ----- headless connection layer (Phase 1: CL-01..CL-05, N-01) -----

export {
  createPythiaConnection,
  createDirectNodeConnection,
  createConnectionResolver,
} from "./connection/index.js";

export type {
  ChainConnection,
  ConnectionHealth,
  ConnectionPollResult,
  FetchLike,
  PythiaConnectionOptions,
  DirectNodeConnectionOptions,
  DirectNodeTransport,
  ConnectionResolver,
  ConnectionResolverOptions,
  NetworkSettingsModel,
  ChainConnectionRow,
  ChainConnectionStatus,
} from "./connection/index.js";
