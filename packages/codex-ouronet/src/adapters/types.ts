import type {
  IStoaChainSeed,
  IOuroAccount,
  IPureKeypair,
  AddressBookEntry,
  UiSettings,
  DeviceVariant,
  WatchListEntry,
  IConsumerSettings,
  ICodexIdentity,
} from "../types/entities.js";
// The D3-genericized headless substrate (F-BUG-002). The Ouronet snapshot below
// EXTENDS core's chain-agnostic base skeleton so the storage seam core is
// generic over is the SAME metadata shape the Ouronet side adds its entity
// arrays onto — not a divergent parallel fork. This is the allowed
// codex-ouronet → codex-core VALUE edge for the adapter substrate.
import type { CodexSnapshotBase } from "@ancientpantheon/codex-core";

/**
 * Codex snapshot — the full persisted state of a codex at one point in
 * time. Adapters round-trip this verbatim via `loadAll()` / `saveAll()`.
 *
 * The shape is deliberately flat (no nested namespaces) so the wire
 * format remains the v1.2 codex JSON. The schema-version + last-updated
 * metadata travels alongside the entity arrays.
 *
 * EXTENDS codex-core's `CodexSnapshotBase` (F-BUG-002): the base contributes the
 * chain-agnostic metadata (`schemaVersion`/`lastUpdatedAt`/`lastUpdatedDevice`,
 * optional `foreignKeys`); the Ouronet arrays below are the chain-specific
 * extension. Declaring the extension (rather than merely restating the fields)
 * makes a future base-field drop a compile error HERE.
 */
export interface CodexSnapshot extends CodexSnapshotBase {
  kadenaSeeds: IStoaChainSeed[];
  ouroAccounts: IOuroAccount[];
  pureKeypairs: IPureKeypair[];
  addressBook: AddressBookEntry[];
  watchList: WatchListEntry[];
  uiSettings: UiSettings;
  /** Per-consumer settings registry (v0.3.0+). Keyed by `consumerName`, each
   *  value is that consumer's own namespaced settings. Additive-optional so
   *  v0.2 snapshots (which have no such field) load cleanly — readers
   *  coalesce a missing value to an empty registry. `emptySnapshot()`
   *  initializes it to `{}`. */
  consumerSettings?: Record<string, IConsumerSettings>;
  /** The codex's double-Apollo identity (v0.3.0+). Additive-optional so v0.2
   *  snapshots (which have no such field) load cleanly. Unlike
   *  `consumerSettings` (a registry container initialized to `{}`), this is a
   *  singleton VALUE type: its resting state is `undefined`, and
   *  `emptySnapshot()` leaves it off entirely. Populated by Phase 7's
   *  `kickstartCodex` (or Phase 8's interactive legacy flow); IMMUTABLE once
   *  set. */
  codexIdentity?: ICodexIdentity;
  schemaVersion: number;
  lastUpdatedAt: string | null;
  lastUpdatedDevice: DeviceVariant;
}

/**
 * CodexAdapter — pluggable storage backend contract.
 *
 * Adapters own ONLY persistence — they read and write the codex snapshot
 * to/from their backing store (localStorage, IndexedDB, file system, KMS,
 * etc.). They do NOT:
 *   - Trigger browser file downloads (that's a hook concern — `useCodexBackup`).
 *   - Open OAuth flows (that's the `/google-drive` sub-export).
 *   - Encrypt/decrypt secrets (the snapshot's `kadenaSeeds[].secret`,
 *     `pureKeypairs[].encryptedPrivateKey`, etc. are already encrypted
 *     when the snapshot is passed to `saveAll()` — the hooks handle the
 *     encryption boundary via `@stoachain/stoa-core/crypto`).
 *   - Validate entity shapes (consumers' state-store actions normalize
 *     inputs before passing them through).
 *
 * Two reference implementations ship with v0.1.0:
 *   - LocalStorageCodexAdapter — browser default (window.localStorage).
 *   - MemoryCodexAdapter       — in-memory only (SSR / Next.js server / tests).
 *
 * Consumers wanting different backends (IndexedDB for larger codices,
 * Tauri secure storage for native shells, etc.) implement this interface
 * and pass to `<CodexProvider adapter={...}>`.
 *
 * All methods are async to accommodate adapters whose backend isn't
 * synchronous (file system, network-backed KMS). LocalStorage is sync
 * under the hood but its adapter wraps in `Promise.resolve()` to match
 * the interface — keeps consumer code uniform.
 *
 * Errors: throw `CodexAdapterError` (from `@ancientpantheon/codex-ouronet/errors`)
 * with the operation name + the original cause when storage fails.
 */
export interface CodexAdapter {
  /** Stable name for the adapter (used in error messages). */
  readonly name: string;

  // ----- snapshot read/write -----

  /** Load the full codex snapshot from backing storage. If nothing is
   *  persisted yet, returns a sentinel empty snapshot with
   *  `schemaVersion: 0` and the `DEFAULT_UI_SETTINGS`. */
  loadAll(): Promise<CodexSnapshot>;

  /** Persist the full codex snapshot atomically. Updates `lastUpdatedAt`
   *  and `lastUpdatedDevice` from the snapshot's own fields — adapters
   *  do NOT auto-touch (call `touch()` explicitly for that). */
  saveAll(snapshot: CodexSnapshot): Promise<void>;

  // ----- per-entity convenience writes -----
  //
  // Avoid full-snapshot rewrite churn when only one slice changes. Each
  // call updates only its target slice in the backing store; the next
  // `loadAll()` returns the merged state. Adapters MAY implement these
  // as wrappers around `saveAll()` if their backend doesn't support
  // partial writes — semantics are equivalent.

  saveStoaChainSeeds(seeds: IStoaChainSeed[]): Promise<void>;
  saveOuroAccounts(accounts: IOuroAccount[]): Promise<void>;
  savePureKeypairs(keypairs: IPureKeypair[]): Promise<void>;
  saveAddressBook(entries: AddressBookEntry[]): Promise<void>;
  saveWatchList(entries: WatchListEntry[]): Promise<void>;
  saveUiSettings(settings: UiSettings): Promise<void>;
  /** Persist the per-consumer settings registry slice (v0.3.0+). Like the
   *  other per-slice writes, updates ONLY the consumerSettings shard in the
   *  backing store; the next `loadAll()` returns it merged into the snapshot.
   *  A dedicated method is required (rather than relying on `saveAll`) so the
   *  LocalStorage adapter — which shards known keys — does not silently drop
   *  the field. */
  saveConsumerSettings(
    consumerSettings: Record<string, IConsumerSettings>
  ): Promise<void>;

  /**
   * Persist (or clear) the ICodexIdentity on the codex (v0.3.0+).
   *
   * **Trust boundary:** the adapter does NOT validate identity-field shape
   * (encrypted blob non-emptiness, Apollo pubkey format, totalWordCount
   * range). Callers — Phase 7 `kickstartCodex` and Phase 8's interactive
   * legacy flow — are responsible for shape validation. Bypassing the
   * canonical writers and calling `saveCodexIdentity` directly with a
   * malformed object is unsupported and may cause Phase 9
   * `buildRegisterCodexIdentityTx` to produce a malformed on-chain
   * registration.
   *
   * Pass `undefined` to clear (used only by Phase 6 delete-cascade flows, if
   * ever — Phase 3 never clears).
   */
  saveCodexIdentity(identity: ICodexIdentity | undefined): Promise<void>;

  // ----- metadata -----

  /** Mark the codex as just-updated; returns the new metadata values so
   *  callers can update in-memory state without a re-read. */
  touch(
    deviceVariant: DeviceVariant
  ): Promise<{ lastUpdatedAt: string; lastUpdatedDevice: DeviceVariant }>;

  /** Current schema version (in-band, not the v1.2 file format version —
   *  this is a CODEX-local upgrade counter for in-place migrations
   *  performed by hooks at boot). */
  getSchemaVersion(): Promise<number>;
  setSchemaVersion(v: number): Promise<void>;

  // ----- encrypted UI settings sidecar -----
  //
  // UI settings live as plain JSON in the main snapshot for backwards-
  // compat with existing OuronetUI codices. The encrypted variant is an
  // optional sidecar — populated by `useCodexAuth` after the user
  // authenticates, so settings can include private prefs without leaking.
  // Adapters that don't support encryption can throw `CodexAdapterError`
  // on these methods; the hook layer handles the absence gracefully.

  loadUiSettingsEncrypted(password: string): Promise<UiSettings | null>;
  saveUiSettingsEncrypted(
    settings: UiSettings,
    password: string
  ): Promise<void>;

  // ----- destructive -----

  /** Wipe ALL codex data from the backing store. Used by "reset codex"
   *  flows + by tests for cleanup between cases. */
  clearAll(): Promise<void>;
}

/** Sentinel empty snapshot. Adapters return this from `loadAll()` when
 *  nothing has been persisted yet. */
import { DEFAULT_UI_SETTINGS } from "../types/entities.js";

export function emptySnapshot(deviceVariant: DeviceVariant): CodexSnapshot {
  return {
    kadenaSeeds: [],
    ouroAccounts: [],
    pureKeypairs: [],
    addressBook: [],
    watchList: [],
    uiSettings: { ...DEFAULT_UI_SETTINGS },
    // Empty registry (NOT undefined): an empty consumer-settings container is
    // {}, so callers can spread into it without a null-guard. Individual
    // entries bring their own schemaVersion/settings — there is no
    // DEFAULT_CONSUMER_SETTINGS to spread (this is a container, not a value).
    consumerSettings: {},
    schemaVersion: 0,
    lastUpdatedAt: null,
    lastUpdatedDevice: deviceVariant,
  };
}
