import { create } from "zustand";
import type { StoreApi, UseBoundStore } from "zustand";
import type {
  IStoaChainSeed,
  IArweaveSeed,
  IOuroAccount,
  IPureKeypair,
  AddressBookEntry,
  WatchListEntry,
  UiSettings,
  DeviceVariant,
  IConsumerSettings,
  ICodexIdentity,
  SeedType,
} from "../types/entities.js";
import { DEFAULT_UI_SETTINGS } from "../types/entities.js";
import type { CodexAdapter, CodexSnapshot } from "../adapters/types.js";
import type { MasterKeyLock, CodexMasterSeed, MigrationProgress, MigrationSelection, MigrationCommitRecord, MigrationPendingPlan, ForeignKeyEntry } from "@ancientpantheon/codex-core";
import { arweaveSeedLock, isMigrationSealed, recordFormerMasterIds } from "@ancientpantheon/codex-core";
import { computeMasterKeyLockDelta } from "./masterKeyLockDelta.js";
import type { MasterKeyLockDelta } from "./masterKeyLockDelta.js";
import {
  CodexError,
  CodexLockedError,
  CodexPrimeProtectedError,
  CodexArweaveEncryptionProtectedError,
  CodexMasterKeyLockedError,
  CodexPrimeSeedProtectedError,
  CodexMasterArweaveSeedProtectedError,
  CodexKickstartError,
  CodexIdentityError,
  CodexPasswordError,
  CodexMigrationError,
  CodexConsumerSettingsError,
  CodexGuardError,
} from "../errors/types.js";
import {
  applyMigrations,
  canConsumerWrite,
  CURRENT_SCHEMA_VERSION,
  SCHEMA_MIGRATIONS,
} from "./migrations.js";
import {
  deriveDoubleApollo,
  buildCodexIdentityFromDerivation,
  validateKickstartArgs,
} from "../codex-identity/index.js";
import type {
  KickstartArgsV3,
  KickstartResultV3,
} from "../codex-identity/index.js";
import type { IKeyset } from "../types/entities.js";
import { encryptStringV2 } from "@stoachain/stoa-core/crypto";
import { rekeyCodex, type RekeySkip } from "../rekey/index.js";
import {
  runStructuralMigration,
  type StructuralMigrationNeedsInput,
  type StructuralMigrationResult,
} from "../structural-migration/index.js";
import { KadenaWalletBuilder as StoaChainWalletBuilder } from "@stoachain/stoa-core/wallet";
import { deriveStoaDalosKeypairAtIndex } from "../wallet/stoaDalosKeygen.js";
import { Apollo, DalosGenesis } from "@ouronet/dalos-crypto/registry";
import type { FullKey } from "@ouronet/dalos-crypto/registry";
import { ed25519 } from "@noble/curves/ed25519";

/** Fresh UUID for a new codex entity. Mirrors the inline pattern already used
 *  for password-request ids — `crypto.randomUUID` everywhere it exists, with a
 *  timestamp+random fallback for the rare runtime without WebCrypto. */
function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/** Generate a fresh random ED25519 keypair as StoaChain-style 64-char hex strings.
 *  StoaChain's `genKeyPair` (`@kadena/cryptography-utils`) is the canonical source
 *  but isn't resolvable under this package's test transform (its vendored .cjs
 *  `require()`s only resolve post-build). `@noble/curves/ed25519` — already a
 *  stoa-core transitive dep — is the documented fallback and produces identical
 *  32-byte ED25519 keys in hex. */
function freshStoaChainKeypair(): { publicKey: string; secretKey: string } {
  const priv = ed25519.utils.randomPrivateKey();
  const pub = ed25519.getPublicKey(priv);
  return { publicKey: bytesToHex(pub), secretKey: bytesToHex(priv) };
}

/**
 * Internal Zustand store backing the CodexProvider. Consumers DO NOT
 * import from this module directly — they read state via hooks (which
 * subscribe to slices of this store) and mutate via the actions
 * exposed on those hooks.
 *
 * State shape mirrors §6 of the spec:
 *   - ready / locked     hydration + auth state
 *   - codex content      persisted entities (mirrors adapter state)
 *   - runtime            active wallet, password cache, dirty bit, schema
 *   - actions            namespace of mutators (each touches state + adapter)
 *
 * Why a namespaced actions object instead of flat-mutators-on-state:
 *   The state slice is what consumers subscribe to. Keeping actions in
 *   their own object means a subscriber that depends only on `kadenaSeeds`
 *   doesn't re-render when an unrelated action reference changes.
 *   (Zustand's selector-shallow check handles this either way, but the
 *   convention reads more clearly when state and actions are separated.)
 *
 * Why store the adapter on the store rather than as a hook closure:
 *   The provider injects exactly one adapter for the lifetime of the
 *   app. Storing it on the store means actions can call adapter methods
 *   without prop-drilling. The adapter is set once at `init()` time;
 *   re-mounting the provider with a different adapter requires a reset
 *   (intentional — adapter swap is a destructive operation).
 */

/** Tight identifier validation for a consumer-settings `consumerName`. Must
 *  start with an ASCII letter, then ASCII letters/digits/`_`/`-`, 1-64 chars
 *  total. Rejects empty/whitespace (ASCII + unicode), control + zero-width
 *  chars, path-injection (`/`, `\`, `..`, `.`), and length-DoS names. */
const CONSUMER_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/** Retirement-suffix pattern for a former CodexGuard's label. Matches a
 *  trailing ` (retired #N)` (space + parens + `#` + digits, anchored to the
 *  end of the string). `renamePureKeypair` allows renames whose new label
 *  matches this pattern even on protected keys — the controlled exception to
 *  the rename lock. Phase 8's `rotateCodexGuard` imports this constant to
 *  construct retirement labels (e.g. `${oldKey.label} (retired #${count})`),
 *  keeping the producer and the guard in sync from one source of truth.
 *
 *  Matches:   "CodexGuard (retired #1)", "Old Guard (retired #42)".
 *  Rejects:   "(retired #1)" (no leading space), "retired #1" (no parens),
 *             "X (retired #1) extra" (trailing text), "X (retired #abc)"
 *             (non-digit). */
export const RETIREMENT_SUFFIX_REGEX = / \(retired #\d+\)$/;

/** Capture-group variant of RETIREMENT_SUFFIX_REGEX, used by `rotateCodexGuard`
 *  to extract the retirement counter (N) when computing the next available
 *  suffix. The anchors and digit semantics MUST mirror RETIREMENT_SUFFIX_REGEX
 *  exactly — both are the canonical retirement-label pattern, differing only in
 *  the capture group around the integer. `m[1]` holds the matched digits. */
export const RETIREMENT_SUFFIX_CAPTURE_REGEX = / \(retired #(\d+)\)$/;

export interface PasswordCacheEntry {
  value: string;
  expiresAt: number; // epoch ms
}

/**
 * A pending request for the user to enter their password — the
 * mechanism by which <PasswordModal> "self-shows" when an operation
 * needs an unlocked codex.
 *
 * Lifecycle:
 *   1. A hook (e.g. useRequestPassword) calls actions.requestPassword().
 *      The store sets `pendingPasswordRequest` to a fresh entry.
 *   2. <PasswordModal> subscribes; when the slice becomes non-null it
 *      renders its form.
 *   3. User submits → actions.submitPasswordRequest(pw):
 *        - calls authenticate(pw, ttl)  (caches password, unlocks codex)
 *        - resolves the request's promise with `pw`
 *        - clears the slice
 *   4. User cancels → actions.cancelPasswordRequest():
 *        - rejects the request's promise with CodexLockedError
 *        - clears the slice
 *
 * Multiple concurrent requestPassword() calls dedup to a single
 * outstanding request (the slice is a single nullable, not a queue).
 * The first call sets the slice; subsequent calls receive a Promise
 * tied to the SAME pending request, so the user only sees one modal
 * regardless of how many places ask for the password simultaneously.
 */
export interface PendingPasswordRequest {
  id: string;
  createdAt: number;
  resolve: (password: string) => void;
  reject: (error: unknown) => void;
}

/** The three ways a logout-confirmation request can settle. See
 *  `PendingLogoutRequest` JSDoc for the full lifecycle. */
export type LogoutConfirmationOutcome =
  | "backed-up"
  | "proceeded-without-backup"
  | "cancelled";

/**
 * A pending request for the user to decide what to do about a
 * backup-divergent (`dirty === true`) codex before logging out — the
 * mechanism by which a future `<LogoutConfirmModal>` "self-shows" when
 * `requestLogoutConfirmation()` is called. Modeled directly on
 * `PendingPasswordRequest`'s own shape (same three-part pattern: state
 * slice, requesting action that returns a Promise, completion actions a
 * modal calls to settle it) — unlike the password prompt, there is no
 * `reject` path here: every outcome (back up, proceed anyway, cancel) is
 * a successful resolution with a tag, never a thrown error.
 *
 * Lifecycle:
 *   1. A hook (`useRequestLogout`, a later task) calls
 *      `actions.requestLogoutConfirmation()` — but ONLY after it has
 *      already fast-pathed `dirty === false` itself (this action never
 *      creates a pending request on a clean codex; see its own JSDoc).
 *      The store sets `pendingLogoutRequest` to a fresh entry.
 *   2. `<LogoutConfirmModal>` (a later task) subscribes; when the slice
 *      becomes non-null it renders its choice.
 *   3. User picks "back up now" or "continue without backing up" →
 *      `actions.completeLogoutRequest(outcome)`:
 *        - resolves the request's promise with `outcome`
 *        - if `outcome === "backed-up"`, also calls `clearDirty()`
 *        - clears the slice
 *   4. User picks "cancel" → `actions.cancelLogoutRequest()`:
 *        - resolves the request's promise with `"cancelled"`
 *        - does NOT touch `dirty`
 *        - clears the slice
 *
 * Multiple concurrent `requestLogoutConfirmation()` calls dedup to a
 * single outstanding request, exactly like `PendingPasswordRequest` —
 * the slice is a single nullable, not a queue.
 */
export interface PendingLogoutRequest {
  id: string;
  createdAt: number;
  resolve: (outcome: LogoutConfirmationOutcome) => void;
  reject: (error: unknown) => void;
}

/**
 * Args for `kickstartCodex` / `recoverCodexFromMnemonic` (v0.2.0+).
 *
 * The package owns the prime invariants but does NOT derive keys — DALOS
 * key-gen lives in @stoachain/stoa-core. Caller supplies pre-derived
 * entities (seed with encrypted mnemonic + Standard Ouronet Account with
 * encrypted private key, both derived from the SAME mnemonic) and the
 * package atomically installs them with `isPrime: true` flags and
 * `parentSeedId` linkage. See docs/v0.2.0-design.md §5.2.
 */
export interface KickstartArgs {
  /** Pre-formed kadena seed. Caller has already derived keypairs from
   *  the mnemonic + encrypted `secret` at the codex password. The package
   *  sets `isPrime: true` on persist. */
  seed: Omit<IStoaChainSeed, "isPrime">;
  /** Pre-formed ouro account. MUST be a Standard Ouronet Account
   *  (`isSmart: false`) derived from the SAME mnemonic as `seed`. The
   *  package sets `isPrime: true` AND `parentSeedId: seed.id` on persist;
   *  throws `CodexKickstartError("smart-account-not-allowed")` if
   *  `isSmart === true`. */
  primeOuroAccount: Omit<IOuroAccount, "isPrime" | "parentSeedId">;
}

export interface KickstartResult {
  /** The installed prime kadena seed, with `isPrime: true`. */
  seed: IStoaChainSeed;
  /** The installed prime ouro account, with `isPrime: true` and
   *  `parentSeedId === seed.id`. */
  primeOuro: IOuroAccount;
}

/**
 * The per-codex eligibility-shape marker (legacy-prime-migration/design.md's
 * "Marking a codex's alignment shape" section). `"legacy"` for any codex that
 * predates this field or hasn't yet completed the migration wizard;
 * `"aligned"` once its Prime Ouronet Account, Prime Chainweb Seed, and Prime
 * Arweave Seed are locked together as the same root. Mirrors
 * `schemaVersion`'s own top-level-state field pattern.
 */
export type PrimeAlignment = "legacy" | "aligned";

export interface CodexStoreState {
  // Hydration
  ready: boolean;
  initError: Error | null;

  // Auth
  locked: boolean;
  passwordCache: PasswordCacheEntry | null;

  // Password prompt — single outstanding request at a time. See
  // PendingPasswordRequest JSDoc for the lifecycle.
  pendingPasswordRequest: PendingPasswordRequest | null;

  // Logout-confirmation prompt — single outstanding request at a time.
  // See PendingLogoutRequest JSDoc for the lifecycle.
  pendingLogoutRequest: PendingLogoutRequest | null;

  // Codex content (mirrors adapter)
  kadenaSeeds: IStoaChainSeed[];
  /** Arweave seeds (docs/work/arweave-seeds/design.md). Each entry's `secret` is
   *  CIPHERTEXT — the slice never holds the 1600-bit plaintext. Persists via the
   *  full-snapshot `saveAll`, like `foreignKeys`: the seed is the ONLY thing that
   *  can reproduce its RSA keys, so it belongs to the codex, never to the panel
   *  that defined it (a chain-rail switch unmounts that panel). */
  arweaveSeeds: IArweaveSeed[];
  pureKeypairs: IPureKeypair[];
  ouroAccounts: IOuroAccount[];
  addressBook: AddressBookEntry[];
  watchList: WatchListEntry[];
  uiSettings: UiSettings;
  consumerSettings: Record<string, IConsumerSettings>;
  /** Seedless foreign-chain keyring (E-02). Each entry carries a PRE-ENCRYPTED
   *  `encryptedKeyfile` (ciphertext at rest, independently encrypted per key —
   *  N-07); the slice never holds plaintext key material. Mirrors the
   *  `pureKeypairs` slice shape but persists via `saveAll` (FIX-5). */
  foreignKeys: ForeignKeyEntry[];
  /** The codex's double-Apollo identity (v0.3.0+). `undefined` for v0.2
   *  codices and fresh codices that haven't run kickstart yet; the public
   *  `getCodexIdentity()` getter coalesces this to `null`. IMMUTABLE once set. */
  codexIdentity?: ICodexIdentity;

  // Runtime
  activeStoaChainWalletId: string | null;
  activeOuroAccountId: string | null;
  dirty: boolean;
  schemaVersion: number;
  /** Per-codex-instance semver shape stamp (docs/work/codex-shape-version-stamp/
   *  design.md) — "what shape is THIS specific codex's data in," DISTINCT from
   *  `schemaVersion` (device-local, does not travel in the export) and from
   *  `CODEX_PACKAGE_VERSION_OUTPUT` (a single global build constant).
   *  `undefined` for a codex that predates this field or hasn't yet been
   *  verified/migrated to the current shape — same value-type-slot resting
   *  state as `codexIdentity` above; `kickstartCodex` stamps `"1.0.0"` on a
   *  fresh codex only, never on an imported one. */
  Codex_Shape_Version: string | undefined;
  /** Master-key locks — which derived key positions the Codex Ouronet
   *  Master depends on and therefore may not be removed. A LIST, not a
   *  flag: a custom guard keyset may lock positions across several seeds,
   *  and each entry records WHY so a re-scan can release precisely the
   *  reasons that lapsed. Always an array (never undefined) in live state;
   *  `[]` is the resting value. See codex-core's `masterKeyLocks.ts`. */
  masterKeyLocks: MasterKeyLock[];
  /** The Codex Master Seed row - which three entities are the three faces of
   *  this codex's one seed. `undefined` until migration settles it; a VALUE
   *  slot (like codexIdentity), not a container, so absence is meaningful. */
  codexMasterSeed: CodexMasterSeed | undefined;
  /** An eligibility migration started and not finished, so the wizard can
   *  resume and show the user what he chose. Never carries seed words. */
  migrationProgress: MigrationProgress | undefined;
  primeAlignment: PrimeAlignment;
  lastUpdatedAt: string | null;
  lastUpdatedDevice: DeviceVariant;

  // Wired at init() time, used by actions for persistence.
  adapter: CodexAdapter | null;
  deviceVariant: DeviceVariant;

  actions: CodexStoreActions;
}

/**
 * Unsigned Pact transaction envelope produced by `buildRegisterCodexIdentityTx`.
 * PLACEHOLDER shape — `function` + `args` order are pending owner confirmation of
 * the on-chain `ouronet-ns.CODEX.register-codex-identity` signature. The Mnemosyne
 * backend signs this with the CodexGuard and submits it.
 */
export interface UnsignedPactTx {
  module: string;
  function: string;
  args: unknown[];
}

export interface CodexStoreActions {
  // ----- lifecycle -----
  init(adapter: CodexAdapter, deviceVariant?: DeviceVariant): Promise<void>;
  reset(): void;

  // ----- auth -----
  authenticate(password: string, ttlMinutes?: number): void;
  lock(): void;
  getPassword(): string;
  /** Rotate the codex password: re-encrypt EVERY secret from `oldPassword` to
   *  `newPassword` via the pure `rekeyCodex`, persist the re-keyed snapshot via
   *  `saveAll`, mirror the re-keyed slices into state, and re-cache the session
   *  under the new password. Throws `WrongPasswordError` (from rekeyCodex's
   *  pre-flight) on a bad old password BEFORE anything is persisted. Returns any
   *  fields that could not be re-keyed (skip-not-dropped, kept verbatim). */
  changeCodexPassword(oldPassword: string, newPassword: string): Promise<{ skipped: RekeySkip[] }>;
  /** Run the Structural Migration Engine (`runStructuralMigration`) against
   *  the live, already-unlocked codex and persist the result. Gets the
   *  current password via `getPassword()` — throws `CodexLockedError`
   *  untouched if the codex is actually locked; this action NEVER prompts
   *  for a password itself. Assembles the live snapshot via
   *  `buildForeignKeySnapshot`, persists the fixed snapshot via the
   *  full-snapshot `saveAll` (adapter-guarded + touch), then mirrors the
   *  changed slices (`kadenaSeeds`, `arweaveSeeds`, `Codex_Shape_Version`)
   *  into live state — the same persist-then-mirror-into-state sequence
   *  `changeCodexPassword` already follows. */
  /** Add master-key locks. Idempotent per `(seedId, position, reason)` —
   *  re-adding an identical entry is a no-op, so a re-scan can hand over the
   *  full computed set without growing the registry. */
  addMasterKeyLocks(entries: readonly MasterKeyLock[]): Promise<void>;
  /** Release every lock matching `predicate`. Reason-aware by construction:
   *  a position locked under two reasons survives the release of one of
   *  them, which is what makes a re-scan safe. */
  releaseMasterKeyLocks(predicate: (lock: MasterKeyLock) => boolean): Promise<void>;
  /** The live registry. */
  getMasterKeyLocks(): MasterKeyLock[];

  /**
   * Write the Codex Master Seed row — which three entities are the three
   * faces of this codex's one seed. Pure linkage, no secret material.
   *
   * MERGES, so establishing the ArWeave face later does not require
   * restating the other two (they are settled at different moments: the
   * ArWeave derivation is RSA-4096 and happens separately).
   *
   * Whenever a face id actually CHANGES, the displaced id is appended to the
   * matching former-holder list on the row (codex-core's
   * `recordFormerMasterIds`), which is what makes "Former Codex Ouronet
   * Master" / "Former Master ArWeave Seed" derivable at all. Callers never
   * pass those lists; this action maintains them.
   */
  setCodexMasterSeed(row: Partial<CodexMasterSeed> & { establishedAt?: string }): Promise<void>;

  // ----- unfinished-migration row (docs/work/migration-three-stages) -----
  /**
   * Record stage 1's selection. Called only once the selection is COMPLETE,
   * so abandoning a partial stage 1 writes nothing to the codex.
   *
   * EQUALITY-GATED: re-recording an identical selection is a no-op and does
   * not touch the adapter, so re-rendering or re-picking the same option
   * cannot churn the codex (or bump `lastUpdatedAt` and mark it dirty).
   */
  recordMigrationSelection(selection: MigrationSelection): Promise<void>;
  /** Move the recorded run from stage 1 into stage 2. */
  beginMigrationCommit(): Promise<void>;
  /**
   * Merge one stage-2 write into `committed`, so a resumed commit skips what
   * already landed. MERGES, never replaces: each call records one fact.
   */
  recordMigrationCommit(patch: Partial<MigrationCommitRecord>): Promise<void>;
  /**
   * Record what a completed FINALIZE decided — the pending state Apply will
   * seal (docs/work/migration-pending-apply/design.md).
   *
   * REPLACES any previous plan wholesale: a new finalize is a new plan,
   * exactly as re-partitioning replaces the previous layout. Never merges —
   * a merge would leave the previous run's keys on a plan the new run did
   * not derive. `selection`/`committed`/`execution` are preserved (they
   * power resume), and the row is created if absent.
   *
   * REFUSES (`CodexError`) once the migration is sealed: Apply makes
   * further modification impossible.
   */
  recordMigrationPending(plan: MigrationPendingPlan): Promise<void>;
  /**
   * APPLY — seal the pending state forever. Stamps `appliedAt` and
   * `stage: "done"`, and performs the alignment seal that used to happen at
   * finalize by going through {@link CodexActions.stampPrimeAlignmentAligned}
   * (one writer of `primeAlignment`, not two).
   *
   * Idempotent: a second call on an already-sealed migration returns
   * without writing. REFUSES (`CodexError`) when there is no `pending`
   * plan — you cannot seal nothing, and the alignment stamp is permanent.
   */
  sealMigration(): Promise<void>;
  /** Finished. CLEARS the row — a completed codex must never offer to
   *  resume a migration that already happened. */
  completeMigration(): Promise<void>;
  /** Abandoned by the user. Clears the row the same way. */
  abandonMigration(): Promise<void>;
  /**
   * Secure Master Account - the user-triggered rescan. Reconciles the lock
   * registry against what the Codex Ouronet Master actually uses right now,
   * applying additions and releases in ONE persisted write, and returning
   * the delta as the report ("never silently").
   *
   * The caller supplies the key material because determining it needs chain
   * reads (see `guards/resolveGuardKeys.ts` for the guard-unfolding half);
   * the store stays network-free. `null` for either input means "could not
   * determine", which SUPPRESSES releases for that reason rather than
   * treating it as "nothing in use" - see `masterKeyLockDelta.ts`.
   */
  secureMasterAccount(input: {
    paymentPublicKey: string | null;
    guardPublicKeys: readonly string[] | null;
  }): Promise<MasterKeyLockDelta>;

  runStructuralUpgrade(options?: {
    requestMissingData?: (
      need: StructuralMigrationNeedsInput
    ) => Promise<string | undefined>;
    onProgress?: (step: string) => void;
  }): Promise<StructuralMigrationResult>;

  // ----- password prompt -----
  /** Request the user enters their password. Returns a Promise that
   *  resolves when the user submits (via submitPasswordRequest) or
   *  rejects when cancelled (via cancelPasswordRequest). If a request
   *  is already outstanding, returns a Promise tied to that same
   *  request — multiple callers see the same modal. */
  requestPassword(): Promise<string>;
  /** Called by <PasswordModal> on submit. Authenticates with `pw`,
   *  resolves the outstanding request's promise with `pw`, clears
   *  the slice. */
  submitPasswordRequest(pw: string, ttlMinutes?: number): void;
  /** Called by <PasswordModal> on cancel (Esc, backdrop click, etc.).
   *  Rejects the outstanding request's promise with CodexLockedError. */
  cancelPasswordRequest(): void;

  // ----- logout confirmation prompt -----
  /** Request the user's decision on what to do about a backup-divergent
   *  codex before logging out. Returns a Promise that resolves with
   *  `"backed-up"` | `"proceeded-without-backup"` | `"cancelled"` once
   *  `completeLogoutRequest`/`cancelLogoutRequest` settles it.
   *
   *  INVARIANT: this action does NOT check `dirty` itself and will
   *  unconditionally create a pending request (or dedup into an
   *  existing one) every time it's called. The "codex is already
   *  clean, resolve instantly, no prompt" fast path is the CALLER's
   *  responsibility — `useRequestLogout()` (a later task) checks
   *  `get().dirty === false` itself before ever calling this action,
   *  exactly the same division of labor `useRequestPassword`'s own
   *  password-cache check has with `requestPassword()` (which likewise
   *  only handles the "needs prompting" path). Calling this action
   *  directly on a clean codex will still surface a prompt.
   *
   *  If a request is already outstanding, returns a Promise tied to
   *  that same request — multiple concurrent callers see the same
   *  modal, same dedup mechanism `requestPassword()` uses. */
  requestLogoutConfirmation(): Promise<LogoutConfirmationOutcome>;
  /** Called by <LogoutConfirmModal> when the user picks "back up now"
   *  or "continue without backing up". Resolves the outstanding
   *  request's promise with `outcome` and clears the slice. On
   *  `"backed-up"`, also calls `clearDirty()` — a modal confirming a
   *  real backup completed never needs its own separate call to clear
   *  the flag. */
  completeLogoutRequest(outcome: "backed-up" | "proceeded-without-backup"): void;
  /** Called by <LogoutConfirmModal> on cancel (Esc, backdrop click,
   *  "stay logged in", etc.). Resolves the outstanding request's
   *  promise with `"cancelled"` and clears the slice. Does NOT touch
   *  `dirty` either way. */
  cancelLogoutRequest(): void;

  // ----- kadena seeds -----
  addStoaChainSeed(seed: IStoaChainSeed): Promise<void>;
  updateStoaChainSeed(seed: IStoaChainSeed): Promise<void>;
  deleteStoaChainSeed(id: string): Promise<void>;

  // ----- arweave seeds -----
  /** Append (or replace-by-id) an Arweave seed. `seed.secret` MUST already be
   *  ciphertext — a raw bitstring is refused, never stored. The FIRST seed of a
   *  codex is auto-flagged `isPrime` (the Prime Arweave Seed); passing
   *  `isPrime: true` when another prime exists throws
   *  `CodexKickstartError("id-conflict")`. */
  addArweaveSeed(seed: IArweaveSeed): Promise<void>;
  /** Replace an Arweave seed by id (rename). Same ciphertext rule as add. */
  updateArweaveSeed(seed: IArweaveSeed): Promise<void>;
  /** Remove an Arweave seed by id. Deliberately NOT prime-protected: design.md
   *  keeps the Prime Arweave Seed deletable in development builds. The cascade
   *  that removes the keys derived from it is the consumer's (the store does not
   *  know which foreign keys a seed produced beyond their `seedId`). */
  deleteArweaveSeed(id: string): Promise<void>;

  // ----- codex lifecycle (kickstart / recover) -----
  /** Atomically install the Prime Codex Seed + CodexPrime ouro account
   *  on an empty codex. Throws `CodexKickstartError` if the codex
   *  already has a prime seed, or if `primeOuroAccount.isSmart === true`.
   *  See docs/v0.2.0-design.md §5.2. */
  kickstartCodex(
    args: KickstartArgs | KickstartArgsV3
  ): Promise<KickstartResult | KickstartResultV3>;
  /** Recovery-flow variant of kickstartCodex. Allows non-empty codex
   *  iff the existing prime seed has the same `id` as `args.seed.id`
   *  (idempotent re-install); throws `CodexKickstartError("id-conflict")`
   *  if the ids differ. Does NOT auto-activate (caller decides). */
  recoverCodexFromMnemonic(args: KickstartArgs): Promise<KickstartResult>;

  // ----- pure keypairs -----
  addPureKeypair(keypair: IPureKeypair): Promise<void>;
  /** Rename a pure keypair. Rejects renames on keys carrying `isCodexGuard`,
   *  `wasCodexGuard`, or `isDuoPurePrime` flags EXCEPT when `newLabel`
   *  matches the retirement-suffix pattern ` (retired #N)` (consumed by
   *  Phase 8 `rotateCodexGuard`). Missing id is a silent no-op. Throws
   *  `CodexGuardError("rename-rejected")` for non-suffix renames on
   *  protected keys. */
  renamePureKeypair(id: string, newLabel: string): Promise<void>;
  deletePureKeypair(id: string): Promise<void>;

  // ----- foreign keys (E-02) -----
  /** Append a PRE-ENCRYPTED foreign-key entry to the keyring. The slice NEVER
   *  encrypts — the `encryptedKeyfile` ciphertext arrives already-encrypted from
   *  the codex-arweave keyring logic. Persists via the complete-snapshot
   *  `saveAll` route (FIX-5), not a per-slice saver. */
  addForeignKey(entry: ForeignKeyEntry): Promise<void>;
  /** Relabel a foreign-key entry (labelless entries are valid). A missing id is
   *  a silent no-op. Persists via `saveAll`. */
  renameForeignKey(id: string, newLabel: string): Promise<void>;
  /** Remove a foreign-key entry. A missing id is a silent no-op. Persists via
   *  `saveAll`. */
  deleteForeignKey(id: string): Promise<void>;

  // ----- codex guard (v0.3.0+) -----
  /** Get the active CodexGuard's public key. Returns `null` for legacy/fresh
   *  codices that have no active CodexGuard (the contract is null, NOT a throw —
   *  callers asserting presence use the `missing-codex-guard` reason themselves).
   *  Read-only: does not mutate state or call the adapter. Throws
   *  `CodexGuardError("integrity-violated")` ONLY when more than one ACTIVE
   *  CodexGuard is detected (a corrupted codex), preferring loud failure to a
   *  silent first-match-wins. */
  getCodexGuardPublic(): string | null;
  /** Get the encrypted private half of the active CodexGuard. Caller decrypts
   *  with the codex CK and signs Pact txs with it. Same null/throw contract as
   *  `getCodexGuardPublic`. */
  getCodexGuardEncryptedPrivate(): string | null;
  /** One-shot CodexGuard generation for v0.2-migrated codices (v0.3.0+).
   *  Generates a fresh random ED25519 keypair, encrypts the private half at CK,
   *  flags `isCodexGuard: true`, label `"CodexGuard"`, prepends to pureKeypairs.
   *  Throws `CodexGuardError("already-exists")` if codex already has an active
   *  CodexGuard. Throws `CodexGuardError("integrity-violated")` if codex has
   *  MULTIPLE active CodexGuards (corrupted state). Auth pre-flight runs first —
   *  propagates `CodexLockedError` on a locked codex. Returns the freshly-built
   *  entry so the caller can surface the new public key to the user. */
  generateCodexGuardForLegacy(): Promise<IPureKeypair>;
  /** Rotate the active CodexGuard (v0.3.0+). Generates a new random ED25519
   *  keypair as the active CodexGuard; demotes the previous active CodexGuard
   *  with `isCodexGuard: false` + `wasCodexGuard: true` and a retirement-suffix
   *  label `"<oldLabel> (retired #N)"` (N = next available counter, scanning all
   *  labels). Throws `CodexGuardError("missing-codex-guard")` if no active guard
   *  exists (call `generateCodexGuardForLegacy()` first). Throws
   *  `CodexGuardError("integrity-violated")` if MULTIPLE active guards exist
   *  (corrupted state). The demoted entry remains undeletable via Phase 6's
   *  `wasCodexGuard` protection. ATOMIC — failure at any step leaves state
   *  unchanged. Returns both entities so the caller can display them. */
  rotateCodexGuard(): Promise<{ newGuard: IPureKeypair; retired: IPureKeypair }>;

  // ----- ouro accounts -----
  addOuroAccount(account: IOuroAccount): Promise<void>;
  updateOuroAccount(account: IOuroAccount): Promise<void>;
  deleteOuroAccount(id: string): Promise<void>;
  /** Promote an ALREADY-correctly-derived seed+account pair to Prime
   *  (docs/work/stoachain-prime-promotion/design.md). `accountId`'s own
   *  `parentSeedId` must already equal `seedId` — this action does NOT
   *  establish the derivation relationship itself, only re-points which
   *  existing pair carries `isPrime: true`. Validates first (zero
   *  mutation on any failure): `seedId` must reference an existing
   *  `IStoaChainSeed`, `accountId` must reference an existing
   *  `IOuroAccount`, and that account's `parentSeedId` must equal
   *  `seedId`. On success, ONE atomic `set()` call flips the target seed
   *  (and demotes every other seed in `kadenaSeeds`) and the target
   *  account (and demotes every other account in `ouroAccounts`) — never
   *  two sequential updates that could leave an inconsistent
   *  intermediate state observable. Promoting the current Prime pair
   *  again is a no-op (succeeds, leaves both collections unchanged). */
  promoteSeedAndAccountToPrime(
    seedId: string,
    accountId: string
  ): Promise<void>;
  /** Page 7 ("Finalize") of `legacy-prime-migration-wizard` — ensures the
   *  Step-2-chosen account has a PAIRED Chainweb seed (creating + linking
   *  one via `addStoaChainSeed`/`updateOuroAccount` when none exists yet,
   *  reusing an already-valid `parentSeedId` otherwise), determines
   *  whether a fund-moving sweep is needed, and promotes the pair to
   *  Prime via the EXISTING `promoteSeedAndAccountToPrime` ONLY when it
   *  isn't. Never performs any fund-moving sweep itself.
   *
   *  `derivation.bitString` is the 1600-bit DALOS bitstring backing
   *  whichever words the chosen account's keys derive from (never
   *  re-prompted here — see `legacy-prime-migration-wizard/design.md`'s
   *  "Page 3" section); `derivation.words`, when known, are persisted
   *  alongside it as a NEW seed's `wordsSecret` (mirrors
   *  `CreateStoaChainSeedModal.tsx`'s `finalizeStoicSeed` convention).
   *  `derivation.method` picks the derivation family: `"stoic-dalos"`
   *  (`deriveStoaDalosKeypairAtIndex` at positions 0/1 — payment + guard)
   *  or `"advanced-native"` (the mnemonic-based `chainweaver`/`koala`
   *  pipeline, chosen by the target account's own `originSeedTab`).
   *
   *  Algorithm (design.md "Page 7 — Finalize", plan.md T7):
   *   1. Refuses with the SAME lock-in `CodexError` as
   *      `promoteSeedAndAccountToPrime` when `primeAlignment ===
   *      "aligned"` — checked FIRST, zero mutation.
   *   2. Throws `CodexError` if `accountId` doesn't reference a real
   *      `IOuroAccount`.
   *   3. Reuses `accountId`'s own `parentSeedId` as the seed if it
   *      already points at a real `IStoaChainSeed`; otherwise creates one
   *      from `derivation` and links it via `updateOuroAccount`.
   *   4. Derives the payment (#0) + guard (#1) public keys `derivation`
   *      would produce.
   *   5. `guardRotationNeeded` is `false` only when the account's CURRENT
   *      `guard` is a non-null `keys-all` keyset whose `keys` (as a set)
   *      exactly equal those two derived public keys (as a set) — `true`
   *      otherwise. It describes the CHAIN, not this codex.
   *   6. ALWAYS calls `promoteSeedAndAccountToPrime(seedId, accountId)`.
   *      Promotion is structural and codex-local; it does not wait on an
   *      on-chain rotation. (It used to, and that made eligibility
   *      unreachable for every codex that actually needed migrating — see
   *      the implementation's own note.)
   *   7. Returns `{ guardRotationNeeded, seedId }` — the flag is
   *      INFORMATION for the caller, never a gate.
   *
   *  `derivation`'s shape mirrors whatever
   *  `LegacyPrimeMigrationKeysChoice` (`LegacyPrimeMigrationWizard.tsx`,
   *  T6 — a parallel task in the same wave) resolves to; this action's
   *  own file scope doesn't depend on that type, only on this literal
   *  shape. */
  ensurePrimeSeedAccountPairingAndPromote(
    accountId: string,
    derivation: {
      bitString: string;
      words?: readonly string[];
      method: "stoic-dalos" | "advanced-native";
    }
  ): Promise<{ guardRotationNeeded: boolean; seedId: string }>;
  /** Non-removable-account invariant (docs/work/arweave-non-removable-
   *  account/design.md). Sets `hasEncryptedArweaveUpload: true` on the
   *  matching account and persists it. The host app wires this to
   *  `library/flow.ts`'s `onAccountUsedForEncryption` callback after a
   *  successful encrypted Arweave upload. A missing id is a silent
   *  no-op, matching `deleteOuroAccount`'s own existing convention. */
  markOuroAccountEncryptedArweaveUpload(id: string): Promise<void>;

  // ----- address book -----
  addAddressBookEntry(entry: AddressBookEntry): Promise<void>;
  updateAddressBookEntry(
    id: string,
    updates: Partial<Omit<AddressBookEntry, "id" | "createdAt">>
  ): Promise<void>;
  deleteAddressBookEntry(id: string): Promise<void>;

  // ----- watch list -----
  addWatchListEntry(entry: WatchListEntry): Promise<void>;
  deleteWatchListEntry(id: string): Promise<void>;

  // ----- UI settings -----
  updateUiSettings(patch: Partial<UiSettings>): Promise<void>;

  // ----- consumer settings registry -----
  /** Read a consumer's namespaced settings entry. Returns the entry, or
   *  `null` for an unknown consumer (the contract is null, NOT a throw —
   *  callers asserting presence use the `missing-entry` reason themselves). */
  getConsumerSettings(name: string): IConsumerSettings | null;
  /** Write (insert or overwrite) a consumer's settings entry. Validates the
   *  `consumerName` against a tight identifier regex, rejects a strict schema
   *  downgrade, server-stamps `lastUpdatedAt`, preserves all other consumers'
   *  entries verbatim, and persists via the per-slice
   *  `adapter.saveConsumerSettings`. Throws `CodexConsumerSettingsError`. */
  updateConsumerSettings(entry: IConsumerSettings): Promise<void>;

  // ----- codex identity (v0.3.0+) -----
  /** Read the codex's double-Apollo identity. Returns the identity, or `null`
   *  for legacy/fresh codices that have none yet (the contract is null, NOT a
   *  throw — callers asserting presence use the `missing-codex-identity` reason
   *  themselves). Read-only: does not mutate state, call the adapter, or throw.
   *  Phase 3 exposes NO setter — the immutability invariant is preserved by
   *  there being no public API path to mutate an existing identity (Phase 7's
   *  kickstart writes it once via an internal `set`). */
  getCodexIdentity(): ICodexIdentity | null;

  /** Build the unsigned Pact tx that registers this codex's identity on chain
   *  (`ouronet-ns.CODEX.register-codex-identity`). Pure read + builder — no state
   *  mutation, no adapter call, no network. Throws
   *  `CodexIdentityError("missing-codex-identity")` if the codex has no identity,
   *  `CodexGuardError("missing-codex-guard")` if there is no active CodexGuard.
   *  PLACEHOLDER arg order (Standard pubkey, Smart pubkey, CodexGuard keyset,
   *  [registeredBy]) — pending owner confirmation of the real Pact signature. */
  buildRegisterCodexIdentityTx(opts?: { registeredBy?: string }): UnsignedPactTx;

  // ----- active selection -----
  setActiveStoaChainWallet(id: string | null): void;
  setActiveOuroAccount(id: string | null): void;

  // ----- meta -----
  markDirty(): void;
  clearDirty(): void;
  setSchemaVersion(v: number): Promise<void>;
  /** Run the schema-migration chain against the current in-memory snapshot
   *  up to CURRENT_SCHEMA_VERSION. If a migration runs, applies the migrated
   *  slices + schemaVersion to state and best-effort persists via
   *  `adapter.saveAll`. No-op when already current. */
  migrateToCurrent(): Promise<void>;
  /** Stamp this codex's `primeAlignment` as `"aligned"`
   *  (legacy-prime-migration/design.md's "Marking a codex's alignment
   *  shape" section). Persists via the full-snapshot `saveAll`, same as
   *  every other `buildForeignKeySnapshot`-backed write. Idempotent:
   *  a no-op (resolves without error, zero state/persistence change)
   *  when already `"aligned"`. */
  stampPrimeAlignmentAligned(): Promise<void>;
}

/**
 * `CodexSnapshot`, widened with the `primeAlignment` field.
 *
 * `primeAlignment` is NOT YET a declared field on the shared `CodexSnapshot`
 * type (`../adapters/types.ts`) — adding it there is out of this task's file
 * scope. This local intersection lets the snapshot builders below carry the
 * field on the object they return/persist (adapters round-trip it verbatim —
 * `structuredClone`/JSON persistence doesn't care about the static type) while
 * every call site that only knows about plain `CodexSnapshot` (e.g.
 * `adapter.saveAll`) stays assignable, since extra properties are fine for
 * structural subtyping outside a literal context.
 */
type CodexSnapshotWithPrimeAlignment = CodexSnapshot & {
  primeAlignment: PrimeAlignment;
};

/**
 * Read `primeAlignment` off a `CodexSnapshot` loaded from an adapter. The
 * field is absent on the static type (see {@link CodexSnapshotWithPrimeAlignment}
 * for why) but may be present at runtime on a snapshot a previous
 * `saveAll` wrote it onto. Coalesces a missing value — any codex that
 * predates this field — to `"legacy"`, the same safe-default discipline
 * `consumerSettings`/`foreignKeys`/`arweaveSeeds` already follow on read.
 */
function readPrimeAlignment(snapshot: CodexSnapshot): PrimeAlignment {
  return (
    (snapshot as Partial<CodexSnapshotWithPrimeAlignment>).primeAlignment ??
    "legacy"
  );
}

/**
 * Build a COMPLETE `CodexSnapshot` from live store state, carrying every slice
 * the Ouronet sharding adapter persists PLUS the updated `foreignKeys`.
 *
 * FUNDS-CRITICAL: the foreign-key slice persists via the full-snapshot `saveAll`
 * (FIX-5), which is a FULL overwrite re-sharding EVERY field. Omitting a slice
 * here would overwrite its on-disk shard with `undefined`/stale values — a
 * foreign-key mutation could WIPE the StoaChain seeds, the double-Apollo
 * `codexIdentity`, or the `consumerSettings`. Every field on `CodexSnapshot`
 * MUST be included (cascade rule — mirrors `migrateToCurrent`'s inline builder).
 */
/**
 * A complete `CodexSnapshot` from live state with NO slice overridden —
 * what a whole-snapshot write (e.g. a master-key-lock change) must persist.
 *
 * Deliberately delegates to {@link buildForeignKeySnapshot} rather than
 * enumerating the fields again: that builder carries the cascade rule
 * ("every field on CodexSnapshot MUST be included"), and a second inline
 * builder is exactly how a slice gets silently dropped on write.
 */
function buildFullSnapshot(state: CodexStoreState): CodexSnapshotWithPrimeAlignment {
  return buildForeignKeySnapshot(state, state.foreignKeys ?? []);
}

function buildForeignKeySnapshot(
  state: CodexStoreState,
  foreignKeys: ForeignKeyEntry[]
): CodexSnapshotWithPrimeAlignment {
  return {
    kadenaSeeds: state.kadenaSeeds,
    ouroAccounts: state.ouroAccounts,
    pureKeypairs: state.pureKeypairs,
    addressBook: state.addressBook,
    watchList: state.watchList,
    uiSettings: state.uiSettings,
    consumerSettings: state.consumerSettings,
    // Threaded from live state so a foreign-key write never overwrites the
    // on-disk identity/settings shards with a stale/undefined value.
    codexIdentity: state.codexIdentity,
    // Same rule for the Arweave seeds: omitting them here would let a
    // foreign-key write overwrite the seed shard — and a lost seed can never be
    // recovered, unlike a key it can regenerate.
    arweaveSeeds: state.arweaveSeeds,
    foreignKeys,
    schemaVersion: state.schemaVersion,
    // Per-codex-instance shape stamp, threaded from live state so a
    // foreign-key write never overwrites the on-disk Codex_Shape_Version with
    // a stale/undefined value — same cascade rule as codexIdentity above.
    Codex_Shape_Version: state.Codex_Shape_Version,
    // Master-key locks, threaded from live state for the same reason as the
    // shape stamp above: a per-slice write must never blank the on-disk
    // locks with a stale value and silently unlock the master's payment key.
    masterKeyLocks: state.masterKeyLocks,
    // Threaded from live state for the same reason as the locks above.
    codexMasterSeed: state.codexMasterSeed,
    migrationProgress: state.migrationProgress,
    // Per-codex eligibility-shape marker — same cascade rule as every other
    // field above (see CodexSnapshotWithPrimeAlignment for why this is
    // widened rather than a declared CodexSnapshot field).
    primeAlignment: state.primeAlignment,
    lastUpdatedAt: state.lastUpdatedAt,
    lastUpdatedDevice: state.lastUpdatedDevice,
  };
}

/**
 * The same COMPLETE snapshot, with the Arweave seeds overridden — the builder
 * behind every `arweaveSeeds` write. Delegates to {@link buildForeignKeySnapshot}
 * so there is ONE every-field inventory to keep in sync (the cascade rule).
 */
function buildArweaveSeedSnapshot(
  state: CodexStoreState,
  arweaveSeeds: IArweaveSeed[]
): CodexSnapshotWithPrimeAlignment {
  return { ...buildForeignKeySnapshot(state, state.foreignKeys), arweaveSeeds };
}

/** The shape of a raw DALOS bitstring: the 1600-bit PLAINTEXT an Arweave seed
 *  is derived from. Anything matching this is unencrypted key material. */
const RAW_BITSTRING_RE = /^[01]{64,}$/;

/**
 * Refuse an Arweave seed whose `secret` is still plaintext.
 *
 * The seed reproduces EVERY RSA key under it, so storing it unencrypted would
 * put private key material in the snapshot and in localStorage. Callers encrypt
 * at the codex password (`encryptStringV2`) before the store sees it — the same
 * seam `IStoaChainSeed.secret` uses — and this is the last line of defence when
 * a caller forgets. The thrown message names the SEED, never the secret.
 */
function assertArweaveSeedSecretIsCiphertext(seed: IArweaveSeed): void {
  if (seed.secret.length === 0 || RAW_BITSTRING_RE.test(seed.secret)) {
    throw new CodexError(
      `Arweave seed ${seed.id}: secret must be ciphertext (encrypted at the ` +
        `codex password), never the plaintext bitstring.`
    );
  }
}

const initialState: Omit<CodexStoreState, "actions"> = {
  ready: false,
  initError: null,
  locked: true,
  passwordCache: null,
  pendingPasswordRequest: null,
  pendingLogoutRequest: null,
  kadenaSeeds: [],
  arweaveSeeds: [],
  pureKeypairs: [],
  ouroAccounts: [],
  addressBook: [],
  watchList: [],
  uiSettings: { ...DEFAULT_UI_SETTINGS },
  consumerSettings: {},
  foreignKeys: [],
  // Explicit undefined keeps initialState shape-complete (matches the
  // lastUpdatedAt: null precedent); value-type slot, undefined is its resting
  // state.
  codexIdentity: undefined,
  activeStoaChainWalletId: null,
  activeOuroAccountId: null,
  dirty: false,
  schemaVersion: 0,
  // Explicit undefined, same resting-state discipline as codexIdentity above:
  // a brand-new store (before kickstart/init runs) has no shape stamp yet.
  Codex_Shape_Version: undefined,
  // Empty, not undefined: a lock registry is a container (like
  // consumerSettings), not a value slot (like codexIdentity) — callers
  // always iterate it, never test it for presence.
  masterKeyLocks: [],
  codexMasterSeed: undefined,
  migrationProgress: undefined,
  primeAlignment: "legacy",
  lastUpdatedAt: null,
  lastUpdatedDevice: "dev",
  adapter: null,
  deviceVariant: "dev",
};

/** Factory function for the Zustand store. Exported as a factory rather
 *  than a singleton instance so each `<CodexProvider>` mount creates its
 *  own store. Two providers in the same React tree are nonsensical (one
 *  codex per app) but tests benefit from per-test isolation. */
export function createCodexStore(): UseBoundStore<StoreApi<CodexStoreState>> {
  return create<CodexStoreState>((set, get) => {
    // (note: per-action unlock checks are gated at the hook layer via
    // `_internal_requireUnlocked` — kept out of the store internals so the
    // store stays a pure state container. The store's own actions that
    // touch secrets — none today; everything secret-related is in hooks
    // — will gate at their call sites.)

    /** Helper — persist a per-entity slice via the adapter, then update
     *  metadata. Wrapped in try/catch — adapter errors surface as-is
     *  (already CodexAdapterError per the contract). */
    const persistAndTouch = async (
      saver: (a: CodexAdapter) => Promise<void>
    ): Promise<void> => {
      const adapter = get().adapter;
      if (!adapter) {
        throw new Error(
          "Codex store has no adapter wired. Call actions.init(adapter) first."
        );
      }
      await saver(adapter);
      const meta = await adapter.touch(get().deviceVariant);
      set({
        dirty: true,
        lastUpdatedAt: meta.lastUpdatedAt,
        lastUpdatedDevice: meta.lastUpdatedDevice,
      });
    };

    /**
     * v0.3 atomic kickstart — produces ICodexIdentity + CodexGuard + CodexPrime
     * + exactly one of (Prime Codex Seed | Duo Pure Prime pair), optionally also
     * a fresh-dalos backing seed. See design doc §4.2.
     *
     * Atomicity (F-001): every derivation/encryption/entity-build happens in
     * local vars FIRST; a SINGLE `set({...})` is the atomic in-memory commit.
     * Persistence is best-effort — the post-set `persistAndTouch` saves slices
     * in a fail-recoverable order (`saveCodexIdentity` LAST) so a mid-flight
     * write failure leaves disk WITHOUT an identity, letting the user retry
     * kickstart cleanly (no `already-exists` fires on the next init).
     *
     * Captured-password semantic (F-007): `ck` is read ONCE up front via
     * getPassword() and reused through the slow crypto — a TTL expiry that lands
     * mid-flight does NOT abort the kickstart.
     */
    const _kickstartV3 = async (
      args: KickstartArgsV3
    ): Promise<KickstartResultV3> => {
      // 1. Shape validation (throws CodexKickstartError("invalid-args")).
      validateKickstartArgs(args);
      const { codexIdSeed, codexPrimeSeed, duoPrime, createdByUsername } = args;

      // 2. Auth pre-flight — captured once; reused for every encryption below.
      const ck = actions.getPassword();

      // 3. Empty-codex pre-flight (extended beyond v0.2's kadenaSeeds check).
      if (get().kadenaSeeds.length > 0 || get().ouroAccounts.length > 0) {
        throw new CodexKickstartError("already-kickstarted");
      }
      if (get().codexIdentity !== undefined) {
        throw new CodexIdentityError("already-exists");
      }
      if (get().pureKeypairs.some((k) => k.isCodexGuard)) {
        throw new CodexGuardError("already-exists");
      }

      // 4. Cross-validation that needs the tokenised word count (F-006 + F-010).
      let words: string[] = [];
      if (codexIdSeed.mode === "words") {
        words = codexIdSeed.value.trim().split(/\s+/).filter(Boolean);
        if (words.length < 2 || words.length > 512) {
          throw new CodexKickstartError(
            "invalid-args",
            `words mode requires 2..512 words; got ${words.length}`
          );
        }
        if (codexPrimeSeed.source === "reuse-codexid-whole" && words.length > 256) {
          throw new CodexKickstartError(
            "invalid-args",
            `reuse-codexid-whole requires codexIdSeed wordCount <= 256; got ${words.length}`
          );
        }
      }

      // 5. Derive the double-Apollo identity material.
      const derivation = deriveDoubleApollo(
        codexIdSeed.value,
        codexIdSeed.mode,
        codexIdSeed.splitIndex
      );

      // 6. Encrypt into the ICodexIdentity (all 9 secret fields at CK).
      const codexIdentity = await buildCodexIdentityFromDerivation(derivation, ck, {
        codexIdSeed,
        createdByUsername,
      });

      // 7. CodexGuard — fresh random ED25519, first pure key, label locked.
      const guardPair = freshStoaChainKeypair();
      const codexGuard: IPureKeypair = {
        id: newId(),
        label: "CodexGuard",
        publicKey: guardPair.publicKey,
        encryptedPrivateKey: await encryptStringV2(guardPair.secretKey, ck),
        createdAt: new Date().toISOString(),
        isCodexGuard: true,
      };

      // 9. duoPrime FIRST — its pubkeys feed the CodexPrime guard keyset (F-008).
      let primeCodexSeed: IStoaChainSeed | undefined;
      let duoPurePrime: [IPureKeypair, IPureKeypair] | undefined;
      let duoPaymentPubkey: string;
      let duoGuardPubkey: string;

      if (duoPrime.mode === "kadena-seed") {
        // Derive positions #0 (payment) + #1 (guard) from the mnemonic. The
        // seedType discriminator selects the derivation family inside the
        // stoa-core wallet builder (koala → BIP39/SLIP-10, chainweaver/eckowallet
        // → BIP32-Ed25519). secretKey is encrypted-at-mnemonic by the builder;
        // we don't store it — only the encrypted mnemonic goes on the seed.
        const pos0 = await StoaChainWalletBuilder.createWalletPairFromMnemonic(
          duoPrime.mnemonic, duoPrime.mnemonic, 0, duoPrime.seedType
        );
        const pos1 = await StoaChainWalletBuilder.createWalletPairFromMnemonic(
          duoPrime.mnemonic, duoPrime.mnemonic, 1, duoPrime.seedType
        );
        duoPaymentPubkey = pos0.publicKey;
        duoGuardPubkey = pos1.publicKey;
        primeCodexSeed = {
          id: newId(),
          seedType: duoPrime.seedType,
          version: "2",
          index: 0,
          secret: await encryptStringV2(duoPrime.mnemonic, ck),
          main: `k:${pos0.publicKey}`,
          // Pre-populate positions #0 + #1 so the Prime Codex Seed's "unremovable
          // first two accounts" invariant is materialised at creation (v0.2 left
          // accounts to be added later; the Prime seed needs them present).
          accounts: [
            { index: 0, publicKey: pos0.publicKey, derivationPath: "m/44'/626'/0'/0/0" },
            { index: 1, publicKey: pos1.publicKey, derivationPath: "m/44'/626'/0'/0/1" },
          ],
          createdAt: new Date().toISOString(),
          isPrime: true,
        };
      } else {
        // auto-pure-keys: two fresh pure ED25519 keypairs, both unremovable.
        const paymentPair = freshStoaChainKeypair();
        const guardPair2 = freshStoaChainKeypair();
        const paymentKey: IPureKeypair = {
          id: newId(),
          label: "DuoPurePrime (payment)",
          publicKey: paymentPair.publicKey,
          encryptedPrivateKey: await encryptStringV2(paymentPair.secretKey, ck),
          createdAt: new Date().toISOString(),
          isDuoPurePrime: true,
          duoPurePrimeRole: "payment",
        };
        const guardKey: IPureKeypair = {
          id: newId(),
          label: "DuoPurePrime (guard)",
          publicKey: guardPair2.publicKey,
          encryptedPrivateKey: await encryptStringV2(guardPair2.secretKey, ck),
          createdAt: new Date().toISOString(),
          isDuoPurePrime: true,
          duoPurePrimeRole: "guard",
        };
        duoPurePrime = [paymentKey, guardKey];
        duoPaymentPubkey = paymentPair.publicKey;
        duoGuardPubkey = guardPair2.publicKey;
      }

      // 10. fresh-dalos backing seed (F-012 — always persisted, non-prime).
      let primeOuroAccountSeed: IStoaChainSeed | undefined;
      if (codexPrimeSeed.source === "fresh-dalos") {
        primeOuroAccountSeed = {
          id: newId(),
          seedType: "koala",
          version: "2",
          index: 0,
          secret: await encryptStringV2(codexPrimeSeed.words, ck),
          main: "",
          accounts: [],
          createdAt: new Date().toISOString(),
          isPrime: false,
        };
      }

      // 8a/8b. CodexPrime payment key + address per codexPrimeSeed.source.
      // F-005: standard/smart RE-DERIVE from the respective half-seed; whole uses
      // the full-seed derivation; fresh-dalos uses DALOS Genesis (Ѻ. prefix).
      let primeKey: FullKey;
      let primeCurve: "apollo" | "dalos" = "apollo";
      if (codexPrimeSeed.source === "reuse-codexid-whole") {
        primeKey =
          codexIdSeed.mode === "words"
            ? Apollo.generateFromSeedWords(words)
            : Apollo.generateFromBitString(derivation.standard.formats.bitstring);
      } else if (codexPrimeSeed.source === "reuse-codexid-standard") {
        primeKey =
          codexIdSeed.mode === "words"
            ? Apollo.generateFromSeedWords(words.slice(0, derivation.splitIndex))
            : Apollo.generateFromBitString(derivation.standard.formats.bitstring);
      } else if (codexPrimeSeed.source === "reuse-codexid-smart") {
        primeKey =
          codexIdSeed.mode === "words"
            ? Apollo.generateFromSeedWords(words.slice(derivation.splitIndex))
            : Apollo.generateFromBitString(derivation.smart.formats.bitstring);
      } else {
        // fresh-dalos → DALOS Genesis default primitive (Ѻ. standard prefix).
        primeKey = DalosGenesis.generateFromSeedWords(
          codexPrimeSeed.words.trim().split(/\s+/).filter(Boolean)
        );
        primeCurve = "dalos";
      }

      // 8c. Guard keyset is ALWAYS the duo pubkeys (F-008) — never the codex
      // identity Apollo keys and never the CodexGuard. This makes CodexPrime
      // spendable via the Duo pair regardless of the chosen primeSeed source.
      const primeGuard: IKeyset = {
        pred: "keys-all",
        keys: [duoPaymentPubkey, duoGuardPubkey],
      };

      // 8d. Build the CodexPrime Standard Ouronet account.
      //
      // `docs/work/codex-backup-bitstring-reveal-bug/`: `IOuroAccount.secret`
      // holds the representation the account's OWN `originMode` names (see
      // `OuroOriginMode`'s doc: "Determines how the reveal modal re-derives
      // the account", and `SpawnAccountModal.tsx`'s canonical
      // `secret = the original input` / `backup = keyPair.priv` split) —
      // every consumer re-derives through it (`bitStringOf`/`rebuildFullKey`,
      // `signApolloOwnership`, `ArweaveSeedsArea`'s Option 2, `LibraryArea`,
      // `CreateStoaChainSeedModal`). For `fresh-dalos` this records
      // `originMode: "seedWords"` just below, so `secret` must be the WORDS —
      // writing `keyPair.priv` there instead (a base-49 scalar) made every one
      // of those consumers silently re-derive a DIFFERENT key, and crashed the
      // codex-backup eligibility check outright ("seed bitstring must be
      // exactly 1024 (APOLLO) or 1600 (DALOS Genesis) characters"). Nothing is
      // lost: `keyPair.priv` is fully re-derivable from the words through the
      // same `rebuildFullKey` path, and the account's spending material is the
      // Duo pure keypairs (F-008), never this field.
      //
      // The other three sources keep their existing plaintext — none of them
      // can reach the Arweave-seed path at all (an Arweave seed is always a
      // 1600-bit DALOS bitstring, so `kickstartAndInstallPrimeArweaveSeed`
      // refuses every source but `fresh-dalos`), and their own
      // `secret`/`originMode` relationship is a separate, untouched question.
      const primeSecretPlaintext =
        codexPrimeSeed.source === "fresh-dalos"
          ? codexPrimeSeed.words
          : primeKey.keyPair.priv;
      const codexPrime: IOuroAccount = {
        id: newId(),
        version: "2",
        name: "CodexPrime",
        isSmart: false,
        address: primeKey.standardAddress,
        publicKey: primeKey.keyPair.publ,
        secret: await encryptStringV2(primeSecretPlaintext, ck),
        guard: primeGuard,
        stoaChainLedger: null,
        originMode:
          codexPrimeSeed.source === "fresh-dalos" ? "seedWords" : "bitString",
        originCurve: primeCurve,
        backup: "",
        isPrime: true,
        parentSeedId:
          duoPrime.mode === "kadena-seed" ? primeCodexSeed!.id : undefined,
      };

      // 11. Assemble the next slices and commit atomically in one set().
      const nextStoaChainSeeds: IStoaChainSeed[] = [];
      if (primeCodexSeed) nextStoaChainSeeds.push(primeCodexSeed);
      if (primeOuroAccountSeed) nextStoaChainSeeds.push(primeOuroAccountSeed);
      const nextPureKeypairs: IPureKeypair[] = [codexGuard];
      if (duoPurePrime) nextPureKeypairs.push(duoPurePrime[0], duoPurePrime[1]);
      const nextOuroAccounts: IOuroAccount[] = [codexPrime];

      set({
        codexIdentity,
        pureKeypairs: nextPureKeypairs,
        kadenaSeeds: nextStoaChainSeeds,
        ouroAccounts: nextOuroAccounts,
        activeStoaChainWalletId: nextStoaChainSeeds[0]?.id ?? null,
        activeOuroAccountId: codexPrime.id,
        // 2026-09-27: a freshly-kickstarted codex's data shape already matches
        // CURRENT_SCHEMA_VERSION today -- there is no 0->1 migration to run --
        // but nothing previously stamped the counter to say so. The migration
        // runner's cursor advance is strict `fromVersion === current` (see
        // state-migrations.test.ts's own lock-in test), and there is no 0->1
        // step, so a fresh codex sat at the pre-versioning sentinel 0 forever
        // (the "Schema Version: 0" the Codex Info card showed for every wallet
        // ever created on current code). Stamping it here, at creation, is the
        // safe fix: CURRENT_SCHEMA_VERSION is exactly the terminal state every
        // migrated legacy codex already converges to, so this introduces no
        // state that init()'s own gating (`canConsumerWrite`) doesn't already
        // accept.
        schemaVersion: CURRENT_SCHEMA_VERSION,
        // docs/work/codex-shape-version-stamp/design.md: a freshly-kickstarted
        // codex IS already in the current data shape -- stamp it immediately,
        // not deferred to any future migration step. Unlike schemaVersion
        // above, this is a hardcoded literal (not CURRENT_SCHEMA_VERSION):
        // Codex_Shape_Version tracks the migration engine's own shape
        // counter (Topic 2, out of this task's scope), which happens to
        // start at "1.0.0" too but is a DISTINCT counter.
        Codex_Shape_Version: "1.0.0",
      });

      // 12. Best-effort persistence — saveCodexIdentity LAST (F-001 ordering).
      await persistAndTouch(async (a) => {
        await a.saveStoaChainSeeds(nextStoaChainSeeds);
        await a.savePureKeypairs(nextPureKeypairs);
        await a.saveOuroAccounts(nextOuroAccounts);
        await a.saveCodexIdentity(codexIdentity);
        // Persist the schemaVersion stamp too -- see the `set({...})` comment
        // above. Without this, a reload would re-load the adapter's own
        // still-0 on-disk value and silently regress the in-memory fix.
        await a.setSchemaVersion(CURRENT_SCHEMA_VERSION);
      });

      // 13. Return the full v0.3 result.
      return {
        codexIdentity,
        codexGuard,
        codexPrime,
        primeCodexSeed,
        duoPurePrime,
        primeOuroAccountSeed,
      };
    };

    /**
     * v0.2 legacy kickstart — PURE-PASSTHROUGH (F-004 LOCKED). Installs ONLY the
     * pre-formed seed + Standard ouro account; `codexIdentity` stays undefined and
     * NO CodexGuard is auto-created. v0.3 features reach a legacy codex later via
     * Phase 8's interactive `generateCodexGuardForLegacy`.
     *
     * PAT-003: a genuine v0.2 caller CANNOT have produced a v0.3 codexIdentity or
     * CodexGuard (the v0.3 path is the only writer). Encountering one here means
     * tampered/imported/partial state, so the legacy path refuses to install v0.2
     * entities on top — that would yield a hybrid codex downstream consumers can't
     * reason about. These checks fire BEFORE any state mutation.
     */
    const _kickstartV2Legacy = async (
      args: KickstartArgs
    ): Promise<KickstartResult> => {
      if (get().kadenaSeeds.length > 0) {
        throw new CodexKickstartError("already-kickstarted");
      }
      if (get().codexIdentity !== undefined) {
        throw new CodexIdentityError(
          "already-exists",
          "v0.2 legacy kickstart called on a codex that already has a v0.3 " +
            "codexIdentity; this is tampered/imported state — manual review required."
        );
      }
      if (get().pureKeypairs.some((k) => k.isCodexGuard === true)) {
        throw new CodexGuardError("already-exists");
      }
      if (args.primeOuroAccount.isSmart === true) {
        throw new CodexKickstartError("smart-account-not-allowed");
      }

      const seed: IStoaChainSeed = { ...args.seed, isPrime: true };
      const primeOuro: IOuroAccount = {
        ...args.primeOuroAccount,
        isPrime: true,
        parentSeedId: seed.id,
      };

      const nextSeeds = [seed];
      const nextOuros = [primeOuro];
      set({
        kadenaSeeds: nextSeeds,
        ouroAccounts: nextOuros,
        activeStoaChainWalletId: seed.id,
        activeOuroAccountId: primeOuro.id,
      });
      await persistAndTouch(async (a) => {
        await a.saveStoaChainSeeds(nextSeeds);
        await a.saveOuroAccounts(nextOuros);
      });

      return { seed, primeOuro };
    };

    const actions: CodexStoreActions = {
      // ----- lifecycle -----

      async init(adapter: CodexAdapter, deviceVariant: DeviceVariant = "dev") {
        set({ adapter, deviceVariant, initError: null });
        try {
          const snap = await adapter.loadAll();

          // v0.3.0 boundary check (runs FIRST, before any adapter mutation):
          // if the loaded codex is at a NEWER schema than this package writes,
          // we cannot safely read/write it. Throw before the legacy migration
          // so it never mutates a future-version codex.
          if (!canConsumerWrite(snap.schemaVersion)) {
            throw new CodexMigrationError(
              "unknown-schema-version",
              `loaded=${snap.schemaVersion}, max=${CURRENT_SCHEMA_VERSION}`
            );
          }

          // v0.2.0 legacy migration (eager half): if the loaded codex has
          // at least one kadena seed but NO seed is flagged isPrime, this
          // is a pre-v0.2.0 codex. Flag seeds[0] as the Prime Codex Seed.
          // The ouro half of the migration is deferred to authenticate()
          // because matching an ouro to a seed requires decrypting the
          // ouro's secret with the codex password (not known at init).
          // See docs/v0.2.0-design.md §8.
          let migratedStoaChainSeeds = snap.kadenaSeeds;
          const needsSeedMigration =
            snap.kadenaSeeds.length > 0 &&
            !snap.kadenaSeeds.some((s) => s.isPrime);
          if (needsSeedMigration) {
            migratedStoaChainSeeds = snap.kadenaSeeds.map((s, idx) =>
              idx === 0 ? { ...s, isPrime: true } : s
            );
            // Persist the flag eagerly so the protection takes effect
            // immediately (without waiting for any next mutation).
            try {
              await adapter.saveStoaChainSeeds(migratedStoaChainSeeds);
            } catch {
              // Best-effort: if persistence fails (e.g. quota), the flag
              // still applies in-memory for this session. Next successful
              // save will pick it up.
            }
          }

          // v0.3.0 schema migration: build a snapshot from the post-legacy
          // values and run the migration chain to CURRENT_SCHEMA_VERSION. Every
          // field on CodexSnapshot MUST be included here; future phases adding
          // a snapshot field must extend this builder (see migrateToCurrent).
          const preMigration: CodexSnapshotWithPrimeAlignment = {
            kadenaSeeds: migratedStoaChainSeeds,
            ouroAccounts: snap.ouroAccounts,
            pureKeypairs: snap.pureKeypairs,
            addressBook: snap.addressBook,
            watchList: snap.watchList,
            uiSettings: snap.uiSettings,
            // v0.2 codices have no consumerSettings; Phase 10's migration
            // initializes it. Coalesce to {} either way.
            consumerSettings: snap.consumerSettings ?? {},
            // v0.2 codices have no codexIdentity field; the v0.2->v0.3 migration
            // leaves it undefined (Phase 8's interactive flow populates it
            // later). No `?? {}` — this is a value-type slot, undefined is valid.
            codexIdentity: snap.codexIdentity,
            // Seedless foreign-key keyring (Arweave et al.). Absent on codices
            // written before the keyring shipped; coalesce to []. Threading it
            // through the migration builder keeps a foreign-key mutation/restore
            // from silently dropping the key on the next load (funds-critical).
            foreignKeys: snap.foreignKeys ?? [],
            // Arweave seeds. Absent on codices written before the slice existed;
            // coalesce to []. Threading it through the migration builder is what
            // keeps a migrating load from persisting a snapshot with no seeds.
            arweaveSeeds: snap.arweaveSeeds ?? [],
            schemaVersion: snap.schemaVersion,
            // Per-codex-instance shape stamp (docs/work/codex-shape-version-stamp/
            // design.md). A REAL declared field on CodexSnapshot (unlike
            // primeAlignment below), so this reads directly off the raw
            // loaded snapshot -- same value-type-slot discipline as
            // codexIdentity above: absent on every codex that predates it,
            // and `undefined` is a valid (not coalesced-away) resting state.
            Codex_Shape_Version: snap.Codex_Shape_Version,
            // Coalesced to [] for a codex that predates locks — absent means
            // "no locks recorded", which is the correct resting state here
            // (unlike the shape stamp, where absence is itself the datum).
            masterKeyLocks: snap.masterKeyLocks ?? [],
            // Value slot: `undefined` is a valid resting state (a codex that
            // has never been migrated), so it is NOT coalesced away.
            codexMasterSeed: snap.codexMasterSeed,
            // `null` on the wire means REMOVED (the sharding adapter's marker,
            // which a whole-snapshot adapter stores verbatim). Live state is
            // declared `| undefined`, so normalize rather than leak a null.
            migrationProgress: snap.migrationProgress ?? undefined,
            // Per-codex eligibility-shape marker. Not yet a declared field on
            // CodexSnapshot (see CodexSnapshotWithPrimeAlignment); coalesced
            // from the raw loaded snapshot the same way foreignKeys/
            // arweaveSeeds are above — absent on every codex that predates it.
            primeAlignment: readPrimeAlignment(snap),
            lastUpdatedAt: snap.lastUpdatedAt,
            lastUpdatedDevice: snap.lastUpdatedDevice,
          };
          const migrated = applyMigrations(
            preMigration,
            SCHEMA_MIGRATIONS,
            CURRENT_SCHEMA_VERSION
          );
          if (migrated.schemaVersion !== preMigration.schemaVersion) {
            // Persist eagerly so the upgrade sticks. Best-effort per design:
            // if persistence fails the migration still applies in-memory.
            try {
              await adapter.saveAll(migrated);
            } catch {
              // swallow — next successful save picks up the migrated shape.
            }
          }

          set({
            // Use the MIGRATED values for all entity slices + schemaVersion so a
            // migration that synthesizes/transforms a field is reflected in
            // state (reading raw `snap.X` would silently discard it).
            kadenaSeeds: migrated.kadenaSeeds,
            pureKeypairs: migrated.pureKeypairs,
            ouroAccounts: migrated.ouroAccounts,
            addressBook: migrated.addressBook,
            watchList: migrated.watchList,
            uiSettings: migrated.uiSettings,
            // Read from the post-migration snapshot, NOT raw loaded: a Phase 10
            // migration that synthesizes consumerSettings would otherwise be
            // silently discarded. v0.2 codices coalesce to {}.
            consumerSettings: migrated.consumerSettings ?? {},
            // Read from migrated (not loaded); future migrations (Phase 8's
            // interactive flow) may synthesize this field — reading loaded would
            // silently discard the migration's output. No `?? null` here: the
            // state slot stays undefined-typed; the getter does the null
            // coalesce at the public boundary.
            codexIdentity: migrated.codexIdentity,
            // Hydrate the master-key locks into live state. Without this the
            // locks ride the adapter correctly but live state stays at its
            // initial [], so the very next `exportForCloud` emits an empty
            // registry and the guarantee is lost on the next round trip —
            // the same class of silent drop this builder's own header warns
            // about ("Every field on CodexSnapshot MUST be included here").
            masterKeyLocks: migrated.masterKeyLocks ?? [],
            codexMasterSeed: migrated.codexMasterSeed,
            migrationProgress: migrated.migrationProgress ?? undefined,
            // Hydrate the foreign-key keyring into live state so a restored (or
            // adapter-persisted) Arweave key is in memory after init — without
            // this the key rides the backup and the adapter but never reappears
            // in the store, silently lost on the next export (funds-critical).
            foreignKeys: migrated.foreignKeys ?? [],
            // Hydrate the Arweave seeds so a seed defined in an earlier session
            // is present after init — this is what makes a seed survive the
            // chain-rail switch that unmounts the Arweave panel.
            arweaveSeeds: migrated.arweaveSeeds ?? [],
            schemaVersion: migrated.schemaVersion,
            // Read from migrated (not loaded), same reason as codexIdentity
            // above: a future Topic 2 migration may synthesize/transform this
            // field, and reading `snap` here would silently discard that
            // output. No current migration touches it, so this is a no-op
            // pass-through today.
            Codex_Shape_Version: migrated.Codex_Shape_Version,
            // Read from the ORIGINALLY loaded `snap`, not `migrated`: no
            // registered schema migration transforms primeAlignment (it's
            // independent of the schemaVersion chain), and `applyMigrations`'
            // declared return type doesn't know about this field at all —
            // sourcing it from the raw load is what's actually correct here,
            // not merely convenient.
            primeAlignment: readPrimeAlignment(snap),
            lastUpdatedAt: migrated.lastUpdatedAt,
            lastUpdatedDevice: migrated.lastUpdatedDevice,
            ready: true,
            dirty: false,
            // First account is the default active. Consumers can override
            // via setActiveOuroAccount() after init.
            activeOuroAccountId: migrated.ouroAccounts[0]?.id ?? null,
            activeStoaChainWalletId: migrated.kadenaSeeds[0]?.id ?? null,
          });
        } catch (e) {
          set({
            ready: false,
            initError: e instanceof Error ? e : new Error(String(e)),
          });
          throw e;
        }
      },

      reset() {
        set({ ...initialState });
      },

      // ----- auth -----

      authenticate(password: string, ttlMinutes?: number) {
        const ttl = ttlMinutes ?? get().uiSettings.passwordCacheMinutes;
        const expiresAt = Date.now() + ttl * 60_000;
        set({
          passwordCache: { value: password, expiresAt },
          locked: false,
        });
      },

      lock() {
        set({ passwordCache: null, locked: true });
      },

      async changeCodexPassword(oldPassword: string, newPassword: string) {
        // Assemble the COMPLETE current snapshot (all slices) from live state,
        // then re-key it purely. rekeyCodex verifies oldPassword pre-flight and
        // throws WrongPasswordError BEFORE we touch the adapter, so a wrong
        // password never persists a partial state.
        const current = buildForeignKeySnapshot(get(), get().foreignKeys);
        const { snapshot: rekeyed, skipped } = await rekeyCodex(
          current,
          oldPassword,
          newPassword,
        );
        // Persist the fully re-keyed snapshot (adapter-guarded + touch), then
        // mirror the re-keyed secret slices into state and re-cache the session
        // under the new password so signing / seed-reveal keep working.
        await persistAndTouch((a) => a.saveAll(rekeyed));
        set({
          kadenaSeeds: rekeyed.kadenaSeeds,
          ouroAccounts: rekeyed.ouroAccounts,
          pureKeypairs: rekeyed.pureKeypairs,
          foreignKeys: rekeyed.foreignKeys ?? [],
          codexIdentity: rekeyed.codexIdentity,
        });
        get().actions.authenticate(newPassword);
        return { skipped };
      },

      async runStructuralUpgrade(options) {
        // getPassword() throws CodexLockedError untouched if the codex is
        // actually locked — this action never prompts for a password,
        // it only ever runs against an already-unlocked codex.
        const password = get().actions.getPassword();
        const current = buildForeignKeySnapshot(get(), get().foreignKeys);
        const result = await runStructuralMigration(current, password, options);
        await persistAndTouch((a) => a.saveAll(result.snapshot));
        set({
          kadenaSeeds: result.snapshot.kadenaSeeds,
          arweaveSeeds: result.snapshot.arweaveSeeds,
          Codex_Shape_Version: result.snapshot.Codex_Shape_Version,
        });
        return result;
      },

      getPassword(): string {
        const cache = get().passwordCache;
        const now = Date.now();
        if (!cache || cache.expiresAt <= now) {
          throw new CodexLockedError("getPassword");
        }
        return cache.value;
      },

      // ----- password prompt -----

      requestPassword(): Promise<string> {
        // If a request is already outstanding, return a Promise tied to
        // the SAME pending request. This is the dedup-to-one-modal
        // contract documented in PendingPasswordRequest's JSDoc — without
        // it, two parallel hooks asking for the password would stack up
        // two modals.
        const existing = get().pendingPasswordRequest;
        if (existing) {
          return new Promise<string>((resolve, reject) => {
            // Wrap the existing handlers: when the existing request
            // resolves/rejects, fan out to this Promise too.
            const prevResolve = existing.resolve;
            const prevReject = existing.reject;
            existing.resolve = (pw) => {
              prevResolve(pw);
              resolve(pw);
            };
            existing.reject = (err) => {
              prevReject(err);
              reject(err);
            };
          });
        }

        return new Promise<string>((resolve, reject) => {
          const req: PendingPasswordRequest = {
            id:
              typeof crypto !== "undefined" && "randomUUID" in crypto
                ? crypto.randomUUID()
                : `pwd-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            createdAt: Date.now(),
            resolve,
            reject,
          };
          set({ pendingPasswordRequest: req });
        });
      },

      submitPasswordRequest(pw: string, ttlMinutes?: number) {
        const req = get().pendingPasswordRequest;
        if (!req) return; // no-op if no request is outstanding
        // Authenticate (caches pw + unlocks codex), then resolve the
        // promise so the awaiting code gets the password it asked for.
        actions.authenticate(pw, ttlMinutes);
        set({ pendingPasswordRequest: null });
        req.resolve(pw);
      },

      cancelPasswordRequest() {
        const req = get().pendingPasswordRequest;
        if (!req) return;
        set({ pendingPasswordRequest: null });
        req.reject(new CodexLockedError("requestPassword"));
      },

      // ----- logout confirmation prompt -----

      requestLogoutConfirmation(): Promise<LogoutConfirmationOutcome> {
        // NOTE: does NOT check `dirty` here — see this action's own
        // JSDoc on CodexStoreActions. The "clean codex, resolve
        // instantly" fast path is the caller's (useRequestLogout's)
        // responsibility, not this action's.
        //
        // Dedup mechanism mirrors requestPassword() exactly: if a
        // request is already outstanding, return a Promise tied to the
        // SAME pending request rather than creating a second one — two
        // concurrent callers only ever see one modal.
        const existing = get().pendingLogoutRequest;
        if (existing) {
          return new Promise<LogoutConfirmationOutcome>((resolve, reject) => {
            const prevResolve = existing.resolve;
            const prevReject = existing.reject;
            existing.resolve = (outcome) => {
              prevResolve(outcome);
              resolve(outcome);
            };
            existing.reject = (err) => {
              prevReject(err);
              reject(err);
            };
          });
        }

        return new Promise<LogoutConfirmationOutcome>((resolve, reject) => {
          const req: PendingLogoutRequest = {
            id:
              typeof crypto !== "undefined" && "randomUUID" in crypto
                ? crypto.randomUUID()
                : `lgt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            createdAt: Date.now(),
            resolve,
            reject,
          };
          set({ pendingLogoutRequest: req });
        });
      },

      completeLogoutRequest(outcome: "backed-up" | "proceeded-without-backup") {
        const req = get().pendingLogoutRequest;
        if (!req) return; // no-op if no request is outstanding
        set({ pendingLogoutRequest: null });
        req.resolve(outcome);
        // A modal confirming a real backup completed never needs its
        // own separate call to clear the flag.
        if (outcome === "backed-up") {
          actions.clearDirty();
        }
      },

      cancelLogoutRequest() {
        const req = get().pendingLogoutRequest;
        if (!req) return;
        set({ pendingLogoutRequest: null });
        req.resolve("cancelled");
      },

      // ----- kadena seeds -----

      async addStoaChainSeed(seed: IStoaChainSeed) {
        const existing = get().kadenaSeeds;
        const existingPrime = existing.find((s) => s.isPrime);

        // v0.2.0 §6.1: auto-prime on the very first seed. If the codex
        // is empty AND caller didn't explicitly set isPrime, flag this
        // seed as the Prime Codex Seed. If caller passed isPrime: true
        // when a prime already exists, throw id-conflict.
        let enriched = seed;
        if (seed.isPrime === true && existingPrime && existingPrime.id !== seed.id) {
          throw new CodexKickstartError(
            "id-conflict",
            `A prime seed (${existingPrime.id}) already exists.`
          );
        }
        if (seed.isPrime === undefined && existing.length === 0) {
          enriched = { ...seed, isPrime: true };
        }

        const next = [...existing.filter((s) => s.id !== enriched.id), enriched];
        set({ kadenaSeeds: next });
        // Auto-activate first seed if none is selected.
        if (get().activeStoaChainWalletId === null) {
          set({ activeStoaChainWalletId: enriched.id });
        }
        await persistAndTouch((a) => a.saveStoaChainSeeds(next));
      },

      async updateStoaChainSeed(seed: IStoaChainSeed) {
        // THE position-removal guard. This action is a whole-object replace
        // and is the ONLY route by which a derived key position disappears
        // (there is no deleteDerivedKey action) — so this is the one place
        // the invariant can actually be enforced. The seeds UI's disabled
        // delete button is cosmetic; this is the real thing.
        const keptIndices = new Set((seed.accounts ?? []).map((a) => a.index));
        const violated = get().masterKeyLocks.find(
          (l) => l.seedId === seed.id && !keptIndices.has(l.position)
        );
        if (violated) {
          throw new CodexMasterKeyLockedError(
            violated.seedId,
            violated.position,
            violated.reason
          );
        }
        const next = get().kadenaSeeds.map((s) => (s.id === seed.id ? seed : s));
        set({ kadenaSeeds: next });
        await persistAndTouch((a) => a.saveStoaChainSeeds(next));
      },

      async addMasterKeyLocks(entries: readonly MasterKeyLock[]) {
        const current = get().masterKeyLocks;
        const key = (l: MasterKeyLock) => `${l.seedId}\u0000${l.position}\u0000${l.reason}`;
        const seen = new Set(current.map(key));
        const added = entries.filter((e) => !seen.has(key(e)));
        if (added.length === 0) return; // idempotent: nothing to write
        const next = [...current, ...added];
        set({ masterKeyLocks: next });
        await persistAndTouch((a) => a.saveAll(buildFullSnapshot(get())));
      },

      async releaseMasterKeyLocks(predicate: (lock: MasterKeyLock) => boolean) {
        const current = get().masterKeyLocks;
        const next = current.filter((l) => !predicate(l));
        if (next.length === current.length) return;
        set({ masterKeyLocks: next });
        await persistAndTouch((a) => a.saveAll(buildFullSnapshot(get())));
      },

      getMasterKeyLocks() {
        return get().masterKeyLocks;
      },

      async setCodexMasterSeed(row: Partial<CodexMasterSeed> & { establishedAt?: string }) {
        const current = get().codexMasterSeed;
        const merged = {
          ...(current ?? {}),
          ...row,
          establishedAt: current?.establishedAt ?? row.establishedAt ?? new Date().toISOString(),
        } as CodexMasterSeed;
        if (!merged.ouroAccountId || !merged.chainwebSeedId) {
          // Refuse a row that cannot name its two mandatory faces rather than
          // storing a half-row that the Codex ID page would render as broken.
          throw new CodexError(
            "setCodexMasterSeed: a Codex Master Seed row needs both an Ouronet account and a Chainweb seed.",
          );
        }
        // Remember who the master WAS. Append-only, outgoing id only,
        // de-duplicated — the rule itself is a pure function in codex-core
        // (`recordFormerMasterIds`), unit-tested there. It records nothing on
        // a first-ever settlement and nothing when no face id actually
        // changes, so it cannot disturb the no-change short-circuit below.
        const withHistory = recordFormerMasterIds(current, merged);
        if (JSON.stringify(current) === JSON.stringify(withHistory)) return;
        set({ codexMasterSeed: withHistory });
        await persistAndTouch((a) => a.saveAll(buildFullSnapshot(get())));
      },

      async recordMigrationSelection(selection: MigrationSelection) {
        const current = get().migrationProgress;
        // Equality gate — see the declaration's doc comment.
        if (
          current?.stage === "selection" &&
          JSON.stringify(current.selection) === JSON.stringify(selection)
        ) {
          return;
        }
        const now = new Date().toISOString();
        const next: MigrationProgress = {
          stage: "selection",
          startedAt: current?.startedAt ?? now,
          updatedAt: now,
          selection,
          ...(current?.committed ? { committed: current.committed } : {}),
          ...(current?.execution ? { execution: current.execution } : {}),
        };
        set({ migrationProgress: next });
        await persistAndTouch((a) => a.saveAll(buildFullSnapshot(get())));
      },

      async beginMigrationCommit() {
        const current = get().migrationProgress;
        if (!current) return;
        if (current.stage === "committing") return;
        set({
          migrationProgress: {
            ...current,
            stage: "committing",
            updatedAt: new Date().toISOString(),
          },
        });
        await persistAndTouch((a) => a.saveAll(buildFullSnapshot(get())));
      },

      async recordMigrationCommit(patch: Partial<MigrationCommitRecord>) {
        const current = get().migrationProgress;
        if (!current) return;
        set({
          migrationProgress: {
            ...current,
            // MERGE: each call records one fact about what landed.
            committed: { ...(current.committed ?? {}), ...patch },
            updatedAt: new Date().toISOString(),
          },
        });
        await persistAndTouch((a) => a.saveAll(buildFullSnapshot(get())));
      },

      async recordMigrationPending(plan: MigrationPendingPlan) {
        const current = get().migrationProgress;
        if (isMigrationSealed(current)) {
          throw new CodexError(
            "this migration was already applied — recordMigrationPending refuses once sealed"
          );
        }
        const now = new Date().toISOString();
        const next: MigrationProgress = {
          stage: "committing",
          startedAt: current?.startedAt ?? now,
          updatedAt: now,
          ...(current?.selection ? { selection: current.selection } : {}),
          ...(current?.committed ? { committed: current.committed } : {}),
          ...(current?.execution ? { execution: current.execution } : {}),
          // REPLACE, never merge — see the declaration's doc comment.
          pending: plan,
        };
        set({ migrationProgress: next });
        await persistAndTouch((a) => a.saveAll(buildFullSnapshot(get())));
      },

      async sealMigration() {
        const current = get().migrationProgress;
        // Idempotent no-op: already sealed, nothing to set or persist.
        if (isMigrationSealed(current)) return;
        if (!current?.pending) {
          throw new CodexError(
            "there is no pending migration to apply — sealMigration refuses to seal nothing"
          );
        }
        // The alignment seal, moved here from finalize. Goes through the ONE
        // writer of `primeAlignment` rather than setting it by hand.
        //
        // FIRST, deliberately: if the second write below failed, the row
        // would still read as pending and Apply would still be offered, so
        // a retry completes the seal (the stamp itself is idempotent). The
        // other order would mark the migration applied over a codex that
        // never got aligned, and the idempotent early return above would
        // then make that state permanent.
        await get().actions.stampPrimeAlignmentAligned();
        const now = new Date().toISOString();
        set({
          migrationProgress: {
            ...current,
            stage: "done",
            appliedAt: now,
            updatedAt: now,
          },
        });
        await persistAndTouch((a) => a.saveAll(buildFullSnapshot(get())));
      },

      async completeMigration() {
        if (get().migrationProgress === undefined) return;
        set({ migrationProgress: undefined });
        // `null` is what tells the sharding adapter to REMOVE the row;
        // `undefined` would mean "writer did not know about it" and leave it.
        await persistAndTouch((a) =>
          a.saveAll({
            ...buildFullSnapshot(get()),
            migrationProgress: null,
          } as unknown as CodexSnapshotWithPrimeAlignment)
        );
      },

      async abandonMigration() {
        await get().actions.completeMigration();
      },

      async secureMasterAccount(input: {
        paymentPublicKey: string | null;
        guardPublicKeys: readonly string[] | null;
      }) {
        const current = get().masterKeyLocks;
        const delta = computeMasterKeyLockDelta({
          paymentPublicKey: input.paymentPublicKey,
          guardPublicKeys: input.guardPublicKeys,
          seeds: get().kadenaSeeds,
          currentLocks: current,
        });
        if (delta.add.length === 0 && delta.release.length === 0) {
          // Nothing changed - do not touch the adapter at all, so a routine
          // re-scan does not bump `lastUpdatedAt` and mark the codex dirty.
          return delta;
        }
        // Applied as ONE set + ONE persist rather than add-then-release, so
        // the registry is never briefly in a half-reconciled state on disk.
        const releasing = new Set(
          delta.release.map((l) => l.seedId + " " + String(l.position) + " " + l.reason)
        );
        const next = [
          ...current.filter(
            (l) => !releasing.has(l.seedId + " " + String(l.position) + " " + l.reason)
          ),
          ...delta.add,
        ];
        set({ masterKeyLocks: next });
        await persistAndTouch((a) => a.saveAll(buildFullSnapshot(get())));
        return delta;
      },

      async deleteStoaChainSeed(id: string) {
        const target = get().kadenaSeeds.find((s) => s.id === id);
        // v0.2.0 §6.2: prime seed is structurally unremovable.
        if (target?.isPrime) {
          throw new CodexPrimeSeedProtectedError(id);
        }
        // A seed holding ANY lock is undeletable — otherwise deleting the
        // seed would remove the locked position by the back door, and this
        // action additionally CASCADE-deletes the seed's derived ouro
        // accounts, so the blast radius is wider than the position itself.
        const held = get().masterKeyLocks.find((l) => l.seedId === id);
        if (held) {
          throw new CodexMasterKeyLockedError(id, null, held.reason);
        }
        const nextSeeds = get().kadenaSeeds.filter((s) => s.id !== id);

        // Cascade-delete ouro accounts whose parentSeedId === id. This
        // matches the user model (removing a seed removes its derived
        // accounts) and prevents orphaned ouros that can no longer sign.
        // Note: any prime ouro would have parentSeedId === primeSeed.id,
        // and the prime seed is protected above, so we'll never cascade
        // a prime here under normal v0.2.0 semantics. Defensive: if it
        // happens (e.g. legacy data with isPrime: true but no parent),
        // skip that one ouro to honor CodexPrime protection.
        const nextOuros = get().ouroAccounts.filter((a) => {
          if (a.parentSeedId !== id) return true; // unrelated, keep
          if (a.isPrime) return true; // defensive: never cascade-delete a prime
          return false;
        });

        set({
          kadenaSeeds: nextSeeds,
          ouroAccounts: nextOuros,
        });
        if (get().activeStoaChainWalletId === id) {
          set({ activeStoaChainWalletId: nextSeeds[0]?.id ?? null });
        }
        if (get().activeOuroAccountId && !nextOuros.some((a) => a.id === get().activeOuroAccountId)) {
          set({ activeOuroAccountId: nextOuros[0]?.id ?? null });
        }
        await persistAndTouch(async (a) => {
          await a.saveStoaChainSeeds(nextSeeds);
          await a.saveOuroAccounts(nextOuros);
        });
      },

      // ----- arweave seeds -----
      //
      // Mirrors the kadena-seed actions above, with two deliberate divergences:
      //   - persistence goes through the full-snapshot `saveAll` (like
      //     `foreignKeys`), because adding a `saveArweaveSeeds` method would
      //     extend the adapter CONTRACT; `buildArweaveSeedSnapshot` therefore
      //     builds a COMPLETE snapshot so no other shard is wiped.
      //   - deletion is guarded by `arweaveSeedLock`, NOT by `isPrime` alone:
      //     the settled `codexMasterSeed.arweaveSeedId` counts too. (Until
      //     owner decision 3, locked-entities-and-former-prime/design.md §B3,
      //     the prime seed here was deliberately UNPROTECTED — "deletable in
      //     development builds" — which is what left the row dangling.)

      async addArweaveSeed(seed: IArweaveSeed) {
        assertArweaveSeedSecretIsCiphertext(seed);
        const existing = get().arweaveSeeds;
        const existingPrime = existing.find((s) => s.isPrime);

        // Exactly one Prime Arweave Seed per codex — same rule (and same error)
        // as the Prime Codex Seed: the first seed ever defined is the prime, and
        // a second explicit prime is a conflict, not a silent overwrite.
        if (seed.isPrime === true && existingPrime && existingPrime.id !== seed.id) {
          throw new CodexKickstartError(
            "id-conflict",
            `A prime Arweave seed (${existingPrime.id}) already exists.`
          );
        }
        const enriched =
          seed.isPrime === undefined && existing.length === 0
            ? { ...seed, isPrime: true }
            : seed;

        const next = [...existing.filter((s) => s.id !== enriched.id), enriched];
        set({ arweaveSeeds: next });
        await persistAndTouch((a) => a.saveAll(buildArweaveSeedSnapshot(get(), next)));
      },

      async updateArweaveSeed(seed: IArweaveSeed) {
        assertArweaveSeedSecretIsCiphertext(seed);
        const next = get().arweaveSeeds.map((s) => (s.id === seed.id ? seed : s));
        set({ arweaveSeeds: next });
        await persistAndTouch((a) => a.saveAll(buildArweaveSeedSnapshot(get(), next)));
      },

      async deleteArweaveSeed(id: string) {
        // THE Master ArWeave Seed guard (locked-entities-and-former-prime
        // design.md §B3, owner decision 3). This action used to be an
        // unguarded filter, so the codex's own ArWeave face was deletable at
        // every layer: the row kept naming a seed that no longer existed while
        // `describeCodexMasterSeed` still reported that face established.
        //
        // The rule is NOT restated here. `arweaveSeedLock` is the one place it
        // lives — settled `codexMasterSeed.arweaveSeedId` first, the seed's own
        // `isPrime` second — and the medallion that withholds the delete
        // control reads the SAME function, so the UI cannot promise a deletion
        // this guard refuses (parity: tests/state-locked-entities-parity.test.ts).
        const target = get().arweaveSeeds.find((s) => s.id === id);
        if (arweaveSeedLock(target, get().codexMasterSeed?.arweaveSeedId)) {
          throw new CodexMasterArweaveSeedProtectedError(id);
        }
        // Missing id falls through to a no-op filter (mirrors deleteForeignKey).
        const next = get().arweaveSeeds.filter((s) => s.id !== id);
        set({ arweaveSeeds: next });
        await persistAndTouch((a) => a.saveAll(buildArweaveSeedSnapshot(get(), next)));
      },

      // ----- codex lifecycle (kickstart / recover) -----

      async kickstartCodex(
        args: KickstartArgs | KickstartArgsV3
      ): Promise<KickstartResult | KickstartResultV3> {
        // Discriminated dispatch by shape: v0.3 carries `codexIdSeed`; v0.2
        // carries `seed` + `primeOuroAccount`.
        const isObj = typeof args === "object" && args !== null;
        const hasV3Fields = isObj && "codexIdSeed" in args;
        const hasV2Fields =
          isObj && ("seed" in args || "primeOuroAccount" in args);

        // Mixed-shape: a misconfigured caller mixing both shapes gets a clean
        // error instead of silent v3-path-wins behavior (defense-in-depth).
        if (hasV3Fields && hasV2Fields) {
          throw new CodexKickstartError(
            "invalid-args",
            "args contains both v0.2 (seed/primeOuroAccount) and v0.3 " +
              "(codexIdSeed) fields; pick one shape"
          );
        }
        if (hasV3Fields) {
          return _kickstartV3(args as KickstartArgsV3);
        }
        if (hasV2Fields) {
          return _kickstartV2Legacy(args as KickstartArgs);
        }
        throw new CodexKickstartError(
          "invalid-args",
          "args matches neither the v0.2 nor the v0.3 kickstart shape"
        );
      },

      async recoverCodexFromMnemonic(args: KickstartArgs): Promise<KickstartResult> {
        // v0.2.0 §6.3: recovery semantics
        //   - Empty codex → identical to kickstart.
        //   - Non-empty codex with same prime-seed id → idempotent
        //     re-install (overwrites both prime entities).
        //   - Non-empty codex with different prime-seed id → id-conflict.
        if (args.primeOuroAccount.isSmart === true) {
          throw new CodexKickstartError("smart-account-not-allowed");
        }
        const existingPrimeSeed = get().kadenaSeeds.find((s) => s.isPrime);
        if (existingPrimeSeed && existingPrimeSeed.id !== args.seed.id) {
          throw new CodexKickstartError(
            "id-conflict",
            `Existing prime seed has id "${existingPrimeSeed.id}", recovery ` +
              `args provided seed id "${args.seed.id}". Reset the codex first ` +
              `or align the ids.`
          );
        }
        const existingPrimeOuro = get().ouroAccounts.find((a) => a.isPrime);
        if (
          existingPrimeOuro &&
          existingPrimeOuro.id !== args.primeOuroAccount.id
        ) {
          throw new CodexKickstartError(
            "id-conflict",
            `Existing prime ouro has id "${existingPrimeOuro.id}", recovery ` +
              `args provided ouro id "${args.primeOuroAccount.id}". Reset the ` +
              `codex first or align the ids.`
          );
        }

        const seed: IStoaChainSeed = { ...args.seed, isPrime: true };
        const primeOuro: IOuroAccount = {
          ...args.primeOuroAccount,
          isPrime: true,
          parentSeedId: seed.id,
        };

        // Overwrite the prime entities; preserve any non-prime entities
        // already in the codex (recovery should not nuke unrelated data
        // such as additional seeds, pure keypairs, address book, etc.).
        const nextSeeds = [
          seed,
          ...get().kadenaSeeds.filter((s) => s.id !== seed.id && !s.isPrime),
        ];
        const nextOuros = [
          primeOuro,
          ...get().ouroAccounts.filter((a) => a.id !== primeOuro.id && !a.isPrime),
        ];

        // Recovery does NOT auto-activate — caller decides.
        set({
          kadenaSeeds: nextSeeds,
          ouroAccounts: nextOuros,
        });
        await persistAndTouch(async (a) => {
          await a.saveStoaChainSeeds(nextSeeds);
          await a.saveOuroAccounts(nextOuros);
        });

        return { seed, primeOuro };
      },

      // ----- pure keypairs -----

      async addPureKeypair(keypair: IPureKeypair) {
        const next = [
          ...get().pureKeypairs.filter((k) => k.id !== keypair.id),
          keypair,
        ];
        set({ pureKeypairs: next });
        await persistAndTouch((a) => a.savePureKeypairs(next));
      },

      async renamePureKeypair(id: string, newLabel: string) {
        const target = get().pureKeypairs.find((k) => k.id === id);
        if (!target) {
          // Missing id is a silent no-op (mirrors deletePureKeypair).
          return;
        }
        // Same flag-priority cascade as deletePureKeypair so detail strings
        // report consistently across the two protection surfaces.
        const protectingFlag =
          target.isCodexGuard === true
            ? "isCodexGuard"
            : target.wasCodexGuard === true
              ? "wasCodexGuard"
              : target.isDuoPurePrime === true
                ? "isDuoPurePrime"
                : null;
        // Protected keys are rename-locked EXCEPT the controlled retirement
        // suffix, which Phase 8's rotation applies automatically. Label text
        // is otherwise opaque to the store (length/whitespace validation is a
        // UI concern, out of scope here).
        if (protectingFlag !== null && !RETIREMENT_SUFFIX_REGEX.test(newLabel)) {
          throw new CodexGuardError(
            "rename-rejected",
            `id=${target.id}, label=${target.label}, flag=${protectingFlag}, newLabel=${newLabel}`
          );
        }
        const next = get().pureKeypairs.map((k) =>
          k.id === id ? { ...k, label: newLabel } : k
        );
        set({ pureKeypairs: next });
        await persistAndTouch((a) => a.savePureKeypairs(next));
      },

      async deletePureKeypair(id: string) {
        const target = get().pureKeypairs.find((k) => k.id === id);
        if (target) {
          // Structural-integrity protection (v0.3.0+). A pure key carrying
          // any CodexGuard or DuoPurePrime marker is tied to the codex's
          // identity and cannot be deleted. The flag-priority order
          // (isCodexGuard > wasCodexGuard > isDuoPurePrime) is observable in
          // the detail string so downstream UI can explain the rejection.
          const protectingFlag =
            target.isCodexGuard === true
              ? "isCodexGuard"
              : target.wasCodexGuard === true
                ? "wasCodexGuard"
                : target.isDuoPurePrime === true
                  ? "isDuoPurePrime"
                  : null;
          if (protectingFlag !== null) {
            throw new CodexGuardError(
              "delete-rejected",
              `id=${target.id}, label=${target.label}, flag=${protectingFlag}`
            );
          }
        }
        // Missing id falls through to a no-op filter (preserves the prior
        // silent-no-op-on-missing-id semantics).
        const next = get().pureKeypairs.filter((k) => k.id !== id);
        set({ pureKeypairs: next });
        await persistAndTouch((a) => a.savePureKeypairs(next));
      },

      // ----- foreign keys (E-02) -----
      //
      // FIX-5 (deliberate divergence): the foreign-key slice persists via the
      // full-snapshot `saveAll`, NOT a per-slice `saveForeignKeys`. WHY — adding
      // a `saveForeignKeys` method would extend the D5-owned `CodexAdapter`
      // interface (a scope-fence violation), so the slice reuses the existing
      // `saveAll` slot, which the Ouronet sharding adapter routes through the
      // `foreignKeys` shard. The tradeoff (a full-snapshot write per low-frequency
      // keyring change) is accepted.
      //
      // COMPLETE-SNAPSHOT SAFETY (funds-critical): `saveAll` is a FULL overwrite
      // that re-shards EVERY snapshot field, so a partial snapshot would WIPE the
      // other shards (the StoaChain seeds, the double-Apollo `codexIdentity`, the
      // `consumerSettings`) on disk. `buildForeignKeySnapshot` therefore builds a
      // COMPLETE snapshot from live `get()` state carrying ALL slices plus the
      // updated `foreignKeys` — mirroring `migrateToCurrent`'s every-field builder.

      async addForeignKey(entry: ForeignKeyEntry) {
        const next = [
          ...get().foreignKeys.filter((k) => k.id !== entry.id),
          entry,
        ];
        set({ foreignKeys: next });
        await persistAndTouch((a) =>
          a.saveAll(buildForeignKeySnapshot(get(), next))
        );
      },

      async renameForeignKey(id: string, newLabel: string) {
        const target = get().foreignKeys.find((k) => k.id === id);
        if (!target) {
          // Missing id is a silent no-op (mirrors deleteForeignKey).
          return;
        }
        const next = get().foreignKeys.map((k) =>
          k.id === id ? { ...k, label: newLabel } : k
        );
        set({ foreignKeys: next });
        await persistAndTouch((a) =>
          a.saveAll(buildForeignKeySnapshot(get(), next))
        );
      },

      async deleteForeignKey(id: string) {
        // Missing id falls through to a no-op filter (silent-no-op semantics).
        const next = get().foreignKeys.filter((k) => k.id !== id);
        set({ foreignKeys: next });
        await persistAndTouch((a) =>
          a.saveAll(buildForeignKeySnapshot(get(), next))
        );
      },

      // ----- codex guard (v0.3.0+) -----

      getCodexGuardPublic(): string | null {
        const active = get().pureKeypairs.filter(
          // A hybrid entry carrying both flags is a mid-rotation artifact —
          // treat it as retired-not-active so the exactly-one invariant holds.
          (k) => k.isCodexGuard === true && k.wasCodexGuard !== true
        );
        if (active.length > 1) {
          // Defensive integrity check — surfaces a corrupted codex loudly
          // instead of silently picking the first of several active guards.
          throw new CodexGuardError(
            "integrity-violated",
            `Codex has ${active.length} active CodexGuards; exactly 1 expected.`
          );
        }
        return active[0]?.publicKey ?? null;
      },

      getCodexGuardEncryptedPrivate(): string | null {
        const active = get().pureKeypairs.filter(
          (k) => k.isCodexGuard === true && k.wasCodexGuard !== true
        );
        if (active.length > 1) {
          throw new CodexGuardError(
            "integrity-violated",
            `Codex has ${active.length} active CodexGuards; exactly 1 expected.`
          );
        }
        return active[0]?.encryptedPrivateKey ?? null;
      },

      async generateCodexGuardForLegacy(): Promise<IPureKeypair> {
        // 1. Auth pre-flight — throws CodexLockedError BEFORE any generation, so
        //    a locked codex never wastes entropy on a discarded keypair.
        const ck = actions.getPassword();

        // 2. Integrity-aware active-CodexGuard count. Mirrors Phase 5's canonical
        //    active-detection filter (strict `=== true`, wasCodexGuard excluded).
        const active = get().pureKeypairs.filter(
          (k) => k.isCodexGuard === true && k.wasCodexGuard !== true
        );
        if (active.length > 1) {
          throw new CodexGuardError(
            "integrity-violated",
            `Codex has ${active.length} active CodexGuards; exactly 1 expected.`
          );
        }
        if (active.length === 1) {
          throw new CodexGuardError(
            "already-exists",
            "Use rotateCodexGuard() to replace the existing active CodexGuard."
          );
        }

        // 3. Build the CodexGuard — same shape as _kickstartV3's guard block
        //    (freshStoaChainKeypair + encryptStringV2 + label "CodexGuard"), the
        //    single source of truth for "how a CodexGuard is constructed".
        const pair = freshStoaChainKeypair();
        const codexGuard: IPureKeypair = {
          id: newId(),
          label: "CodexGuard",
          publicKey: pair.publicKey,
          encryptedPrivateKey: await encryptStringV2(pair.secretKey, ck),
          createdAt: new Date().toISOString(),
          isCodexGuard: true,
        };

        // 4. Prepend (position 0) — matches kickstart's CodexGuard-first
        //    convention. addPureKeypair is bypassed: it appends (position last)
        //    and this action needs the guard at the head of the slice.
        const next = [codexGuard, ...get().pureKeypairs];

        // 5. Atomic in-memory commit, then per-slice persist.
        set({ pureKeypairs: next });
        await persistAndTouch((a) => a.savePureKeypairs(next));

        return codexGuard;
      },

      async rotateCodexGuard(): Promise<{
        newGuard: IPureKeypair;
        retired: IPureKeypair;
      }> {
        // 1. Auth pre-flight — throws CodexLockedError BEFORE any generation.
        const ck = actions.getPassword();

        // 2. Find the active CodexGuard (canonical filter). length===0 means the
        //    caller must run generateCodexGuardForLegacy first; length>1 is a
        //    corrupted codex (same loud-failure semantic as Phase 5's getters).
        const allKeys = get().pureKeypairs;
        const active = allKeys.filter(
          (k) => k.isCodexGuard === true && k.wasCodexGuard !== true
        );
        if (active.length > 1) {
          throw new CodexGuardError(
            "integrity-violated",
            `Codex has ${active.length} active CodexGuards; exactly 1 expected.`
          );
        }
        if (active.length === 0) {
          throw new CodexGuardError(
            "missing-codex-guard",
            "Call generateCodexGuardForLegacy() to create an initial CodexGuard before rotating."
          );
        }
        const oldGuard = active[0]!;

        // 3. Build the new active CodexGuard — same shape as generateCodexGuard
        //    ForLegacy / _kickstartV3 (single source of truth).
        const pair = freshStoaChainKeypair();
        const newGuard: IPureKeypair = {
          id: newId(),
          label: "CodexGuard",
          publicKey: pair.publicKey,
          encryptedPrivateKey: await encryptStringV2(pair.secretKey, ck),
          createdAt: new Date().toISOString(),
          isCodexGuard: true,
        };

        // 4. Next retirement counter = max(existing N across ALL labels) + 1.
        //    Scanning every label (not just retired guards) defends against a
        //    user-labeled key that happens to match the retirement pattern.
        let maxN = 0;
        for (const k of allKeys) {
          const m = k.label?.match(RETIREMENT_SUFFIX_CAPTURE_REGEX);
          if (m) {
            const n = parseInt(m[1]!, 10);
            if (Number.isFinite(n) && n > maxN) maxN = n;
          }
        }
        const nextN = maxN + 1;
        // Old label PRE-rotation; explicit isCodexGuard: false makes the demotion
        // observable in JSON snapshots and matches Phase 5's strict-equality
        // filter. Nested suffixes (re-rotating an already-retired label) are
        // accepted as-is — simplest semantics, no special-case stripping.
        const retired: IPureKeypair = {
          ...oldGuard,
          isCodexGuard: false,
          wasCodexGuard: true,
          label: `${oldGuard.label} (retired #${nextN})`,
        };

        // 5. Project: prepend the new guard, replace the old one in place. The
        //    label rewrite happens directly here (NOT via renamePureKeypair) —
        //    internal lifecycle actions own their own writes; Phase 6's rename
        //    guard is the EXTERNAL protection surface.
        const next: IPureKeypair[] = [
          newGuard,
          ...allKeys.map((k) => (k.id === oldGuard.id ? retired : k)),
        ];

        // 6. Single atomic in-memory commit + single per-slice persist.
        set({ pureKeypairs: next });
        await persistAndTouch((a) => a.savePureKeypairs(next));

        return { newGuard, retired };
      },

      // ----- ouro accounts -----

      async addOuroAccount(account: IOuroAccount) {
        const existing = get().ouroAccounts;
        const existingPrime = existing.find((a) => a.isPrime);

        // v0.2.0 §6.1: prime invariants
        //   - If caller passes isPrime: true when a prime ouro already
        //     exists with a different id → id-conflict.
        //   - If caller passes parentSeedId that doesn't match any seed,
        //     drop it (defensive — guards against typos; logged as a
        //     warning via console.warn so consumers can detect).
        //   - Auto-prime on first add preserved (backward compat with
        //     v0.1.0); subsequent adds default isPrime: false.
        if (account.isPrime === true && existingPrime && existingPrime.id !== account.id) {
          throw new CodexKickstartError(
            "id-conflict",
            `A prime ouro account (${existingPrime.id}) already exists.`
          );
        }
        let cleanedParentSeedId = account.parentSeedId;
        if (cleanedParentSeedId !== undefined) {
          const matchingSeed = get().kadenaSeeds.find((s) => s.id === cleanedParentSeedId);
          if (!matchingSeed) {
            // eslint-disable-next-line no-console
            console.warn(
              `[ouronet-codex] addOuroAccount: parentSeedId "${cleanedParentSeedId}" ` +
                `does not match any kadena seed in the codex — dropping the field. ` +
                `If this account was derived from a seed not yet added, add the seed first.`
            );
            cleanedParentSeedId = undefined;
          }
        }
        const isFirst = existing.length === 0;
        const enriched: IOuroAccount = {
          ...account,
          isPrime: account.isPrime ?? isFirst,
          parentSeedId: cleanedParentSeedId,
        };
        const next = [...existing.filter((a) => a.id !== enriched.id), enriched];
        set({ ouroAccounts: next });
        // Auto-activate first account if none is selected.
        if (get().activeOuroAccountId === null) {
          set({ activeOuroAccountId: enriched.id });
        }
        await persistAndTouch((a) => a.saveOuroAccounts(next));
      },

      async updateOuroAccount(account: IOuroAccount) {
        const next = get().ouroAccounts.map((a) =>
          a.id === account.id ? { ...a, ...account } : a
        );
        set({ ouroAccounts: next });
        await persistAndTouch((a) => a.saveOuroAccounts(next));
      },

      async deleteOuroAccount(id: string) {
        const target = get().ouroAccounts.find((a) => a.id === id);
        if (target?.isPrime) {
          throw new CodexPrimeProtectedError(id);
        }
        // Non-removable-account invariant (docs/work/arweave-non-removable-
        // account/design.md) — LOCAL-FLAG-ONLY check, synchronous, no
        // network access. A known-true flag blocks deletion
        // unconditionally; there is no override for this check (the
        // `allowDeletingArweaveEncryptedAccounts` UiSettings override only
        // ever suppresses the separate chain-query safety net in
        // codex-arweave, never this local check).
        if (target?.hasEncryptedArweaveUpload === true) {
          throw new CodexArweaveEncryptionProtectedError(id);
        }
        const next = get().ouroAccounts.filter((a) => a.id !== id);
        set({ ouroAccounts: next });
        if (get().activeOuroAccountId === id) {
          set({ activeOuroAccountId: next[0]?.id ?? null });
        }
        await persistAndTouch((a) => a.saveOuroAccounts(next));
      },

      async markOuroAccountEncryptedArweaveUpload(id: string) {
        const next = get().ouroAccounts.map((a) =>
          a.id === id ? { ...a, hasEncryptedArweaveUpload: true } : a
        );
        set({ ouroAccounts: next });
        await persistAndTouch((a) => a.saveOuroAccounts(next));
      },

      async promoteSeedAndAccountToPrime(seedId: string, accountId: string) {
        // Lock-in rule (legacy-prime-migration/design.md "The lock-in
        // rule") — checked FIRST, before any other validation/mutation.
        // Once a codex is aligned, its Prime Ouronet Account and Prime
        // Chainweb Seed can never change again; re-derived eligibility is
        // never recomputed here, only this recorded, stamped fact is read.
        if (get().primeAlignment === "aligned") {
          throw new CodexError(
            "this codex's Prime trio is already locked — promoteSeedAndAccountToPrime refuses once aligned"
          );
        }
        // Validate first — zero mutation on any failure (mirrors the
        // existingPrime pre-flight style of addStoaChainSeed/addOuroAccount).
        const targetSeed = get().kadenaSeeds.find((s) => s.id === seedId);
        if (!targetSeed) {
          throw new CodexError(
            `promoteSeedAndAccountToPrime: no StoaChain seed with id "${seedId}" exists.`
          );
        }
        const targetAccount = get().ouroAccounts.find((a) => a.id === accountId);
        if (!targetAccount) {
          throw new CodexError(
            `promoteSeedAndAccountToPrime: no ouro account with id "${accountId}" exists.`
          );
        }
        // The causal link must already be true — this action promotes an
        // existing, already-correctly-derived pair; it does not establish
        // the derivation relationship itself.
        if (targetAccount.parentSeedId !== seedId) {
          throw new CodexError(
            `promoteSeedAndAccountToPrime: ouro account "${accountId}" is not ` +
              `derived from seed "${seedId}" (its parentSeedId is ` +
              `"${targetAccount.parentSeedId ?? "undefined"}"). This action only ` +
              `promotes an already-correctly-derived seed+account pair.`
          );
        }

        // Build both next collections in local vars first, then commit both
        // in ONE set() call — mirrors kickstartCodex's atomic in-memory
        // commit discipline (one state transition, one persisted snapshot,
        // never two sequential updates that could leave an inconsistent
        // intermediate state observable).
        const nextSeeds = get().kadenaSeeds.map((s) => {
          if (s.id === seedId) return s.isPrime ? s : { ...s, isPrime: true };
          return s.isPrime ? { ...s, isPrime: false } : s;
        });
        const nextAccounts = get().ouroAccounts.map((a) => {
          if (a.id === accountId) return a.isPrime ? a : { ...a, isPrime: true };
          return a.isPrime ? { ...a, isPrime: false } : a;
        });

        set({ kadenaSeeds: nextSeeds, ouroAccounts: nextAccounts });
        await persistAndTouch(async (a) => {
          await a.saveStoaChainSeeds(nextSeeds);
          await a.saveOuroAccounts(nextAccounts);
        });
      },

      async ensurePrimeSeedAccountPairingAndPromote(
        accountId: string,
        derivation: {
          bitString: string;
          words?: readonly string[];
          method: "stoic-dalos" | "advanced-native";
        }
      ) {
        // Step 1 — the SAME lock-in refusal promoteSeedAndAccountToPrime
        // itself leads with, checked first, zero mutation.
        if (get().primeAlignment === "aligned") {
          throw new CodexError(
            "this codex's Prime trio is already locked — " +
              "ensurePrimeSeedAccountPairingAndPromote refuses once aligned"
          );
        }

        // Step 2 — resolve the target account.
        const targetAccount = get().ouroAccounts.find((a) => a.id === accountId);
        if (!targetAccount) {
          throw new CodexError(
            `ensurePrimeSeedAccountPairingAndPromote: no ouro account with id "${accountId}" exists.`
          );
        }

        // Step 4 (computed ahead of step 3 — needed either way, whether a
        // seed ends up getting created or an existing one is reused).
        // `nativeSeedType` only matters for "advanced-native"; chosen off
        // the target account's own known word origin (mirrors
        // `SeedWordsTab.tsx`'s own `createWalletPairFromMnemonic` seedType
        // selection — "12-words" -> chainweaver, "24-words" -> koala).
        const nativeSeedType: SeedType =
          targetAccount.originSeedTab === "24-words" ? "koala" : "chainweaver";
        let paymentPublicKey: string;
        let guardPublicKey: string;
        if (derivation.method === "stoic-dalos") {
          paymentPublicKey = deriveStoaDalosKeypairAtIndex(derivation.bitString, 0).publicKey;
          guardPublicKey = deriveStoaDalosKeypairAtIndex(derivation.bitString, 1).publicKey;
        } else {
          const mnemonic = (derivation.words ?? []).join(" ");
          const pos0 = await StoaChainWalletBuilder.createWalletPairFromMnemonic(
            mnemonic, mnemonic, 0, nativeSeedType
          );
          const pos1 = await StoaChainWalletBuilder.createWalletPairFromMnemonic(
            mnemonic, mnemonic, 1, nativeSeedType
          );
          paymentPublicKey = pos0.publicKey;
          guardPublicKey = pos1.publicKey;
        }

        // Step 3 — reuse the account's own parentSeedId if it already
        // points at a real seed; otherwise create + link a new one.
        const pairedSeed = targetAccount.parentSeedId
          ? get().kadenaSeeds.find((s) => s.id === targetAccount.parentSeedId)
          : undefined;
        let seedId: string;
        if (pairedSeed) {
          seedId = pairedSeed.id;
        } else {
          const ck = get().actions.getPassword();
          const seedType: SeedType = derivation.method === "stoic-dalos" ? "stoic" : nativeSeedType;
          const newSeed: IStoaChainSeed = {
            id: newId(),
            version: "1.0",
            index: 0,
            // Same persistence shape `CreateStoaChainSeedModal.tsx`'s
            // `finalizeStoicSeed` already uses: the derived bitstring
            // itself is `secret` (one-way — there's no deriving back from
            // it to words), `wordsSecret` is a SEPARATE encrypted pass,
            // only present when the real words are actually known.
            secret: await encryptStringV2(derivation.bitString, ck),
            wordsSecret:
              derivation.words && derivation.words.length > 0
                ? await encryptStringV2(derivation.words.join(" "), ck)
                : undefined,
            seedType,
            main: seedType === "stoic" ? paymentPublicKey : `k:${paymentPublicKey}`,
            createdAt: new Date().toISOString(),
            accounts: [
              {
                index: 0,
                publicKey: paymentPublicKey,
                derivationPath:
                  seedType === "stoic" ? "m'/44'/626'/0'" : "m/44'/626'/0'/0/0",
              },
              {
                index: 1,
                publicKey: guardPublicKey,
                derivationPath:
                  seedType === "stoic" ? "m'/44'/626'/1'" : "m/44'/626'/0'/0/1",
              },
            ],
          };
          await get().actions.addStoaChainSeed(newSeed);
          await get().actions.updateOuroAccount({
            ...targetAccount,
            parentSeedId: newSeed.id,
          });
          seedId = newSeed.id;
        }

        // Step 5 — sweepNeeded is false only when the account's CURRENT
        // guard already is exactly this keys-all pair.
        const derivedKeys = new Set([paymentPublicKey, guardPublicKey]);
        const guard = targetAccount.guard;
        const guardMatches =
          guard !== null &&
          guard.pred === "keys-all" &&
          guard.keys.length === derivedKeys.size &&
          guard.keys.every((k) => derivedKeys.has(k));
        const guardRotationNeeded = !guardMatches;

        // Step 6 — ALWAYS promote.
        //
        // CORRECTED (owner, 2026-10-30). This used to promote only when the
        // guard already matched, and the consequence was severe: a legacy
        // codex's on-chain guard does not match until a rotation happens,
        // which is the very thing migrating is for — so the account was
        // never promoted, and since eligibility reads the PRIME account's
        // bitstring and the PRIME ArWeave address, eligibility could never
        // be reached on exactly the codices that needed it.
        //
        // Promotion is STRUCTURAL and codex-local. Rotating the on-chain
        // guard is a separate, optional act (stage 3A), and asset movement
        // is another (stage 3B). Neither determines eligibility:
        // `checkArweaveRestoreEligibility` compares a derived ArWeave
        // address against the stored prime one and reads nothing from chain.
        await get().actions.promoteSeedAndAccountToPrime(seedId, accountId);

        // Step 7. `guardRotationNeeded` is now INFORMATION for the caller —
        // "your chosen keys are not yet the ones on chain" — not a gate.
        return { guardRotationNeeded, seedId };
      },

      // ----- address book -----

      async addAddressBookEntry(entry: AddressBookEntry) {
        const next = [
          ...get().addressBook.filter((e) => e.id !== entry.id),
          entry,
        ];
        set({ addressBook: next });
        await persistAndTouch((a) => a.saveAddressBook(next));
      },

      async updateAddressBookEntry(
        id: string,
        updates: Partial<Omit<AddressBookEntry, "id" | "createdAt">>
      ) {
        const now = new Date().toISOString();
        const next = get().addressBook.map((e) =>
          e.id === id ? { ...e, ...updates, updatedAt: now } : e
        );
        set({ addressBook: next });
        await persistAndTouch((a) => a.saveAddressBook(next));
      },

      async deleteAddressBookEntry(id: string) {
        const next = get().addressBook.filter((e) => e.id !== id);
        set({ addressBook: next });
        await persistAndTouch((a) => a.saveAddressBook(next));
      },

      // ----- watch list -----

      async addWatchListEntry(entry: WatchListEntry) {
        const next = [
          ...get().watchList.filter((e) => e.id !== entry.id),
          entry,
        ];
        set({ watchList: next });
        await persistAndTouch((a) => a.saveWatchList(next));
      },

      async deleteWatchListEntry(id: string) {
        const next = get().watchList.filter((e) => e.id !== id);
        set({ watchList: next });
        await persistAndTouch((a) => a.saveWatchList(next));
      },

      // ----- UI settings -----

      async updateUiSettings(patch: Partial<UiSettings>) {
        const next: UiSettings = { ...get().uiSettings, ...patch };
        set({ uiSettings: next });
        await persistAndTouch((a) => a.saveUiSettings(next));
      },

      // ----- consumer settings registry -----

      getConsumerSettings(name: string): IConsumerSettings | null {
        return get().consumerSettings[name] ?? null;
      },

      async updateConsumerSettings(entry: IConsumerSettings) {
        // Validation (cheap-first): name shape, then schema-downgrade.
        if (!CONSUMER_NAME_RE.test(entry.consumerName)) {
          throw new CodexConsumerSettingsError(
            "invalid-consumer-name",
            `consumerName=${JSON.stringify(entry.consumerName)}`
          );
        }
        const existing = get().consumerSettings[entry.consumerName];
        if (existing && entry.schemaVersion < existing.schemaVersion) {
          throw new CodexConsumerSettingsError(
            "schema-downgrade",
            `existing=${existing.schemaVersion}, attempted=${entry.schemaVersion}`
          );
        }

        // Server-stamp lastUpdatedAt so it is a trustworthy last-write marker;
        // the caller-supplied value is intentionally overridden.
        const stamped: IConsumerSettings = {
          ...entry,
          lastUpdatedAt: new Date().toISOString(),
        };
        // Object spread preserves every other consumer's entry verbatim.
        const next = {
          ...get().consumerSettings,
          [stamped.consumerName]: stamped,
        };
        set({ consumerSettings: next });
        await persistAndTouch((a) => a.saveConsumerSettings(next));
      },

      // ----- codex identity (v0.3.0+) -----

      getCodexIdentity(): ICodexIdentity | null {
        // `?? null` coalesce at the read boundary: state slot is undefined for
        // legacy/fresh codices, the public contract is null. Non-cloning —
        // short-circuits to the underlying immutable slot.
        return get().codexIdentity ?? null;
      },

      buildRegisterCodexIdentityTx(opts?: { registeredBy?: string }): UnsignedPactTx {
        const identity = get().codexIdentity;
        if (!identity) {
          throw new CodexIdentityError("missing-codex-identity");
        }
        // Reuses the exactly-one-active-guard integrity defense.
        const guardPub = get().actions.getCodexGuardPublic();
        if (!guardPub) {
          throw new CodexGuardError("missing-codex-guard");
        }
        // PLACEHOLDER — arg order pending owner confirmation of the on-chain
        // ouronet-ns.CODEX.register-codex-identity signature. When the owner pins
        // the real arg order, update here + the test assertions in lockstep.
        const args: unknown[] = [
          identity.standardPublicKey,
          identity.smartPublicKey,
          { keys: [guardPub], pred: "keys-all" },
        ];
        if (opts?.registeredBy !== undefined) {
          args.push(opts.registeredBy);
        }
        return {
          module: "ouronet-ns.CODEX",
          function: "register-codex-identity",
          args,
        };
      },

      // ----- active selection (no persistence — runtime only) -----

      setActiveStoaChainWallet(id: string | null) {
        set({ activeStoaChainWalletId: id });
      },

      setActiveOuroAccount(id: string | null) {
        set({ activeOuroAccountId: id });
      },

      // ----- meta -----

      markDirty() {
        set({ dirty: true });
      },

      clearDirty() {
        set({ dirty: false });
      },

      async setSchemaVersion(v: number) {
        const adapter = get().adapter;
        if (!adapter) {
          throw new Error("Codex store has no adapter wired.");
        }
        await adapter.setSchemaVersion(v);
        set({ schemaVersion: v });
      },

      async migrateToCurrent() {
        const state = get();
        const adapter = state.adapter;
        if (!adapter) {
          throw new Error("Codex store has no adapter wired.");
        }

        // Build a CodexSnapshot from the current in-memory state. Every field
        // on CodexSnapshot MUST be included; future phases adding a snapshot
        // field must extend this builder (cascade rule — see init's builder).
        const current: CodexSnapshotWithPrimeAlignment = {
          kadenaSeeds: state.kadenaSeeds,
          ouroAccounts: state.ouroAccounts,
          pureKeypairs: state.pureKeypairs,
          addressBook: state.addressBook,
          watchList: state.watchList,
          uiSettings: state.uiSettings,
          consumerSettings: state.consumerSettings,
          // Source from live store state so a migration that touches
          // codexIdentity (e.g. Phase 8's flow) sees the real identity, not
          // undefined. Without this the runner would receive stale input and
          // the subsequent saveAll could overwrite the on-disk identity.
          codexIdentity: state.codexIdentity,
          // Live seeds, same reason as codexIdentity: the saveAll below writes
          // whatever this builder produced.
          arweaveSeeds: state.arweaveSeeds,
          // Live foreign-chain keyring, same reason as arweaveSeeds: omitting
          // it here would make the saveAll below wipe the on-disk foreignKeys
          // shard (LocalStorageCodexAdapter.saveAll writes
          // `snapshot.foreignKeys ?? []` unconditionally).
          foreignKeys: state.foreignKeys,
          schemaVersion: state.schemaVersion,
          // Source from live store state, same reason as codexIdentity above:
          // a future Topic 2 migration that touches Codex_Shape_Version
          // should see the real live value, not a stale one.
          Codex_Shape_Version: state.Codex_Shape_Version,
          // Per-codex eligibility-shape marker — same cascade rule as every
          // other field above (see CodexSnapshotWithPrimeAlignment).
          primeAlignment: state.primeAlignment,
          lastUpdatedAt: state.lastUpdatedAt,
          lastUpdatedDevice: state.lastUpdatedDevice,
        };

        const migrated = applyMigrations(
          current,
          SCHEMA_MIGRATIONS,
          CURRENT_SCHEMA_VERSION
        );

        if (migrated.schemaVersion === current.schemaVersion) {
          // No migration applied — nothing to set, nothing to persist.
          return;
        }

        set({
          kadenaSeeds: migrated.kadenaSeeds,
          ouroAccounts: migrated.ouroAccounts,
          pureKeypairs: migrated.pureKeypairs,
          addressBook: migrated.addressBook,
          watchList: migrated.watchList,
          uiSettings: migrated.uiSettings,
          // Reflect a migration that synthesizes/transforms the registry; v0.2
          // codices coalesce to {}.
          consumerSettings: migrated.consumerSettings ?? {},
          // Reflect a migration that synthesizes/transforms codexIdentity;
          // value-type slot stays undefined-typed (getter coalesces to null).
          codexIdentity: migrated.codexIdentity,
          arweaveSeeds: migrated.arweaveSeeds ?? [],
          foreignKeys: migrated.foreignKeys ?? [],
          schemaVersion: migrated.schemaVersion,
          // Reflect a migration that synthesizes/transforms it; same
          // read-from-migrated reasoning as codexIdentity above.
          Codex_Shape_Version: migrated.Codex_Shape_Version,
          lastUpdatedAt: migrated.lastUpdatedAt,
          lastUpdatedDevice: migrated.lastUpdatedDevice,
        });

        // Best-effort persist per design — swallow failures.
        try {
          await adapter.saveAll(migrated);
        } catch {
          // swallow — next successful save picks up the migrated shape.
        }
      },

      async stampPrimeAlignmentAligned() {
        // Idempotent no-op: already aligned, nothing to set or persist.
        if (get().primeAlignment === "aligned") return;
        set({ primeAlignment: "aligned" });
        await persistAndTouch((a) =>
          a.saveAll(buildForeignKeySnapshot(get(), get().foreignKeys))
        );
      },
    };

    return {
      ...initialState,
      actions,
    };
  });
}

/** Quiet the lint about unused requireUnlocked — kept available for the
 *  Phase 5 hooks (useSignTransaction, useGetKeypair) which need to gate
 *  on unlock state. Will be referenced from src/hooks/* once Phase 5
 *  lands; exporting from the store makes that wiring clean. */
export function _internal_requireUnlocked(
  store: UseBoundStore<StoreApi<CodexStoreState>>,
  operation: string
): string {
  const cache = store.getState().passwordCache;
  const now = Date.now();
  if (!cache || cache.expiresAt <= now) {
    throw new CodexLockedError(operation);
  }
  return cache.value;
}

/** Helper exported for hooks that need to detect a wrong password — e.g.
 *  useCodexAuth.authenticate may want to attempt decryption of a known
 *  encrypted secret to validate the password before caching it. The store
 *  itself doesn't enforce password correctness (that's a crypto operation
 *  the hooks own); this export ties the error class to the store layer
 *  for consistent imports. */
export { CodexPasswordError };
