import { create } from "zustand";
import type { StoreApi, UseBoundStore } from "zustand";
import type {
  IKadenaSeed,
  IOuroAccount,
  IPureKeypair,
  AddressBookEntry,
  WatchListEntry,
  UiSettings,
  DeviceVariant,
  IConsumerSettings,
  ICodexIdentity,
} from "../types/entities.js";
import { DEFAULT_UI_SETTINGS } from "../types/entities.js";
import type { CodexAdapter, CodexSnapshot } from "../adapters/types.js";
import {
  CodexLockedError,
  CodexPrimeProtectedError,
  CodexPrimeSeedProtectedError,
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
import { KadenaWalletBuilder } from "@stoachain/stoa-core/wallet";
import { Apollo, DalosGenesis } from "@stoachain/dalos-crypto/registry";
import type { FullKey } from "@stoachain/dalos-crypto/registry";
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

/** Generate a fresh random ED25519 keypair as Kadena-style 64-char hex strings.
 *  Kadena's `genKeyPair` (`@kadena/cryptography-utils`) is the canonical source
 *  but isn't resolvable under this package's test transform (its vendored .cjs
 *  `require()`s only resolve post-build). `@noble/curves/ed25519` — already a
 *  stoa-core transitive dep — is the documented fallback and produces identical
 *  32-byte ED25519 keys in hex. */
function freshKadenaKeypair(): { publicKey: string; secretKey: string } {
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
  seed: Omit<IKadenaSeed, "isPrime">;
  /** Pre-formed ouro account. MUST be a Standard Ouronet Account
   *  (`isSmart: false`) derived from the SAME mnemonic as `seed`. The
   *  package sets `isPrime: true` AND `parentSeedId: seed.id` on persist;
   *  throws `CodexKickstartError("smart-account-not-allowed")` if
   *  `isSmart === true`. */
  primeOuroAccount: Omit<IOuroAccount, "isPrime" | "parentSeedId">;
}

export interface KickstartResult {
  /** The installed prime kadena seed, with `isPrime: true`. */
  seed: IKadenaSeed;
  /** The installed prime ouro account, with `isPrime: true` and
   *  `parentSeedId === seed.id`. */
  primeOuro: IOuroAccount;
}

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

  // Codex content (mirrors adapter)
  kadenaSeeds: IKadenaSeed[];
  pureKeypairs: IPureKeypair[];
  ouroAccounts: IOuroAccount[];
  addressBook: AddressBookEntry[];
  watchList: WatchListEntry[];
  uiSettings: UiSettings;
  consumerSettings: Record<string, IConsumerSettings>;
  /** The codex's double-Apollo identity (v0.3.0+). `undefined` for v0.2
   *  codices and fresh codices that haven't run kickstart yet; the public
   *  `getCodexIdentity()` getter coalesces this to `null`. IMMUTABLE once set. */
  codexIdentity?: ICodexIdentity;

  // Runtime
  activeKadenaWalletId: string | null;
  activeOuroAccountId: string | null;
  dirty: boolean;
  schemaVersion: number;
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

  // ----- kadena seeds -----
  addKadenaSeed(seed: IKadenaSeed): Promise<void>;
  updateKadenaSeed(seed: IKadenaSeed): Promise<void>;
  deleteKadenaSeed(id: string): Promise<void>;

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
  setActiveKadenaWallet(id: string | null): void;
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
}

const initialState: Omit<CodexStoreState, "actions"> = {
  ready: false,
  initError: null,
  locked: true,
  passwordCache: null,
  pendingPasswordRequest: null,
  kadenaSeeds: [],
  pureKeypairs: [],
  ouroAccounts: [],
  addressBook: [],
  watchList: [],
  uiSettings: { ...DEFAULT_UI_SETTINGS },
  consumerSettings: {},
  // Explicit undefined keeps initialState shape-complete (matches the
  // lastUpdatedAt: null precedent); value-type slot, undefined is its resting
  // state.
  codexIdentity: undefined,
  activeKadenaWalletId: null,
  activeOuroAccountId: null,
  dirty: false,
  schemaVersion: 0,
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
      const guardPair = freshKadenaKeypair();
      const codexGuard: IPureKeypair = {
        id: newId(),
        label: "CodexGuard",
        publicKey: guardPair.publicKey,
        encryptedPrivateKey: await encryptStringV2(guardPair.secretKey, ck),
        createdAt: new Date().toISOString(),
        isCodexGuard: true,
      };

      // 9. duoPrime FIRST — its pubkeys feed the CodexPrime guard keyset (F-008).
      let primeCodexSeed: IKadenaSeed | undefined;
      let duoPurePrime: [IPureKeypair, IPureKeypair] | undefined;
      let duoPaymentPubkey: string;
      let duoGuardPubkey: string;

      if (duoPrime.mode === "kadena-seed") {
        // Derive positions #0 (payment) + #1 (guard) from the mnemonic. The
        // seedType discriminator selects the derivation family inside the
        // stoa-core wallet builder (koala → BIP39/SLIP-10, chainweaver/eckowallet
        // → BIP32-Ed25519). secretKey is encrypted-at-mnemonic by the builder;
        // we don't store it — only the encrypted mnemonic goes on the seed.
        const pos0 = await KadenaWalletBuilder.createWalletPairFromMnemonic(
          duoPrime.mnemonic, duoPrime.mnemonic, 0, duoPrime.seedType
        );
        const pos1 = await KadenaWalletBuilder.createWalletPairFromMnemonic(
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
        const paymentPair = freshKadenaKeypair();
        const guardPair2 = freshKadenaKeypair();
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
      let primeOuroAccountSeed: IKadenaSeed | undefined;
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
      const codexPrime: IOuroAccount = {
        id: newId(),
        version: "2",
        name: "CodexPrime",
        isSmart: false,
        address: primeKey.standardAddress,
        publicKey: primeKey.keyPair.publ,
        secret: await encryptStringV2(primeKey.keyPair.priv, ck),
        guard: primeGuard,
        kadenaLedger: null,
        originMode:
          codexPrimeSeed.source === "fresh-dalos" ? "seedWords" : "bitString",
        originCurve: primeCurve,
        backup: "",
        isPrime: true,
        parentSeedId:
          duoPrime.mode === "kadena-seed" ? primeCodexSeed!.id : undefined,
      };

      // 11. Assemble the next slices and commit atomically in one set().
      const nextKadenaSeeds: IKadenaSeed[] = [];
      if (primeCodexSeed) nextKadenaSeeds.push(primeCodexSeed);
      if (primeOuroAccountSeed) nextKadenaSeeds.push(primeOuroAccountSeed);
      const nextPureKeypairs: IPureKeypair[] = [codexGuard];
      if (duoPurePrime) nextPureKeypairs.push(duoPurePrime[0], duoPurePrime[1]);
      const nextOuroAccounts: IOuroAccount[] = [codexPrime];

      set({
        codexIdentity,
        pureKeypairs: nextPureKeypairs,
        kadenaSeeds: nextKadenaSeeds,
        ouroAccounts: nextOuroAccounts,
        activeKadenaWalletId: nextKadenaSeeds[0]?.id ?? null,
        activeOuroAccountId: codexPrime.id,
      });

      // 12. Best-effort persistence — saveCodexIdentity LAST (F-001 ordering).
      await persistAndTouch(async (a) => {
        await a.saveKadenaSeeds(nextKadenaSeeds);
        await a.savePureKeypairs(nextPureKeypairs);
        await a.saveOuroAccounts(nextOuroAccounts);
        await a.saveCodexIdentity(codexIdentity);
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

      const seed: IKadenaSeed = { ...args.seed, isPrime: true };
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
        activeKadenaWalletId: seed.id,
        activeOuroAccountId: primeOuro.id,
      });
      await persistAndTouch(async (a) => {
        await a.saveKadenaSeeds(nextSeeds);
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
          let migratedKadenaSeeds = snap.kadenaSeeds;
          const needsSeedMigration =
            snap.kadenaSeeds.length > 0 &&
            !snap.kadenaSeeds.some((s) => s.isPrime);
          if (needsSeedMigration) {
            migratedKadenaSeeds = snap.kadenaSeeds.map((s, idx) =>
              idx === 0 ? { ...s, isPrime: true } : s
            );
            // Persist the flag eagerly so the protection takes effect
            // immediately (without waiting for any next mutation).
            try {
              await adapter.saveKadenaSeeds(migratedKadenaSeeds);
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
          const preMigration: CodexSnapshot = {
            kadenaSeeds: migratedKadenaSeeds,
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
            schemaVersion: snap.schemaVersion,
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
            schemaVersion: migrated.schemaVersion,
            lastUpdatedAt: migrated.lastUpdatedAt,
            lastUpdatedDevice: migrated.lastUpdatedDevice,
            ready: true,
            dirty: false,
            // First account is the default active. Consumers can override
            // via setActiveOuroAccount() after init.
            activeOuroAccountId: migrated.ouroAccounts[0]?.id ?? null,
            activeKadenaWalletId: migrated.kadenaSeeds[0]?.id ?? null,
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

      // ----- kadena seeds -----

      async addKadenaSeed(seed: IKadenaSeed) {
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
        if (get().activeKadenaWalletId === null) {
          set({ activeKadenaWalletId: enriched.id });
        }
        await persistAndTouch((a) => a.saveKadenaSeeds(next));
      },

      async updateKadenaSeed(seed: IKadenaSeed) {
        const next = get().kadenaSeeds.map((s) => (s.id === seed.id ? seed : s));
        set({ kadenaSeeds: next });
        await persistAndTouch((a) => a.saveKadenaSeeds(next));
      },

      async deleteKadenaSeed(id: string) {
        const target = get().kadenaSeeds.find((s) => s.id === id);
        // v0.2.0 §6.2: prime seed is structurally unremovable.
        if (target?.isPrime) {
          throw new CodexPrimeSeedProtectedError(id);
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
        if (get().activeKadenaWalletId === id) {
          set({ activeKadenaWalletId: nextSeeds[0]?.id ?? null });
        }
        if (get().activeOuroAccountId && !nextOuros.some((a) => a.id === get().activeOuroAccountId)) {
          set({ activeOuroAccountId: nextOuros[0]?.id ?? null });
        }
        await persistAndTouch(async (a) => {
          await a.saveKadenaSeeds(nextSeeds);
          await a.saveOuroAccounts(nextOuros);
        });
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

        const seed: IKadenaSeed = { ...args.seed, isPrime: true };
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
          await a.saveKadenaSeeds(nextSeeds);
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
        //    (freshKadenaKeypair + encryptStringV2 + label "CodexGuard"), the
        //    single source of truth for "how a CodexGuard is constructed".
        const pair = freshKadenaKeypair();
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
        const pair = freshKadenaKeypair();
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
        const next = get().ouroAccounts.filter((a) => a.id !== id);
        set({ ouroAccounts: next });
        if (get().activeOuroAccountId === id) {
          set({ activeOuroAccountId: next[0]?.id ?? null });
        }
        await persistAndTouch((a) => a.saveOuroAccounts(next));
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

      setActiveKadenaWallet(id: string | null) {
        set({ activeKadenaWalletId: id });
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
        const current: CodexSnapshot = {
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
          schemaVersion: state.schemaVersion,
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
          schemaVersion: migrated.schemaVersion,
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
