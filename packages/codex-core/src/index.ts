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

export {
  isForeignKeyEntry,
  type ForeignKeyEntry,
  type ForeignKeysBlock,
} from "./codex/foreignKeys.js";

export {
  isPureKeypairEntry,
  type PureKeypairEntry,
} from "./codex/pureKeypairs.js";

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
