/**
 * Codex entity types — single source of truth for the package.
 *
 * Ported verbatim from OuronetUI's `src/ouro.d.ts` so OuronetUI can migrate
 * to importing from here without changing semantics. Field shapes match
 * what's already persisted in every existing user's localStorage; no
 * runtime migration needed when OuronetUI swaps the import paths in
 * Phase 9.
 *
 * Future evolution policy:
 *   - Additive fields only at minor bumps (consumer can ignore unknown fields).
 *   - Breaking shape changes only at major bumps with explicit codex migration.
 *   - The v1.2 codex file format (defined in @stoachain/ouronet-core/codex)
 *     is the wire-level contract; these types are the in-memory contract
 *     that hydrates from it. They share the same shape but evolve
 *     independently from the wire format (which is frozen at 1.2).
 */

/** Wallet-software origin of a kadena HD seed. Determines which signing path
 *  the universal-sign pipeline routes to (koala/foreign → nacl,
 *  chainweaver/eckowallet → WASM). */
export type SeedType = "koala" | "chainweaver" | "eckowallet";

/** DALOS-family cryptographic curve that produced an ouro account's keys.
 *  Stamped at spawn time; legacy accounts without this field fall back to
 *  address-prefix sniffing (Ѻ./Σ. → dalos, ₱./Π. → apollo). */
export type OuronetOriginCurve = "dalos" | "apollo";

/** DALOS key-generation mode that produced an ouro account. Determines how
 *  the reveal modal re-derives the account and which representation tabs
 *  are shown. */
export type OuroOriginMode =
  | "seedWords"
  | "bitmap"
  | "bitString"
  | "integerBase10"
  | "integerBase49";

/** For seedWords-origin accounts, the sub-tab the user picked at creation
 *  (cosmetic — colors the reveal-modal word grid to match creation style). */
export type OuroOriginSeedTab = "12-words" | "write-seed" | "24-words";

export interface IKeyset {
  pred: "keys-all" | "keys-any" | "keys-2";
  keys: string[];
  /** Present when guard is a keyset-ref-guard (e.g. `"ouronet-ns.dh_sc_dpdc-keyset"`). */
  keysetRef?: string;
}

/** A single account derived from a kadena HD seed. */
export interface WalletAccount {
  index: number;
  publicKey: string;
  derivationPath: string;
  guard?: string[];
}

/** A kadena HD seed (one mnemonic) with all derived accounts. The `secret`
 *  is the encrypted mnemonic (encrypted at the codex password). */
export interface IKadenaSeed {
  id: string;
  name?: string;
  seedType: SeedType;
  version: string;
  index: number;
  secret: string;
  main: string;
  createdAt: string;
  accounts: WalletAccount[];
  /** Prime Codex Seed marker (spec §B1 — see docs/v0.2.0-design.md).
   *  True for the seed that kickstarted the codex; false (or absent) for
   *  additional seeds added later. The package's `deleteKadenaSeed`
   *  throws `CodexPrimeSeedProtectedError` on `isPrime: true` seeds.
   *  There is exactly one prime seed per codex, set atomically by
   *  `kickstartCodex`. Added v0.2.0. */
  isPrime?: boolean;
}

/** A single derived kadena account flattened with its seed linkage + live
 *  chain state. Cloned verbatim from OuronetUI `ouro.d.ts` — the ZBOM modals
 *  take `kadenaAccounts: IKadenaWallet[]` as a prop (payment-key / guard
 *  signing material lookup). */
export interface IKadenaWallet extends WalletAccount {
  address: string;
  secret: string;
  seedId: string;
  balance?: string;
  paired?: string[];
  seedType?: SeedType;
}

/** A raw Pact -g keypair stored directly in the codex (not derived from a
 *  seed). The `encryptedPrivateKey` is encrypted at the codex password,
 *  same envelope as seed secrets. Signed via the `seedType: "foreign"`
 *  path in universal-sign.
 *
 *  v0.3.0+ adds four optional marker flags (`isCodexGuard`, `wasCodexGuard`,
 *  `isDuoPurePrime`, `duoPurePrimeRole`) — these identify special-role pure
 *  keys that have lifecycle protections enforced by Phase 6+ rename/delete
 *  guards. */
export interface IPureKeypair {
  id: string;
  label?: string;
  /** 64-char hex */
  publicKey: string;
  /** `encryptString(privateKey, codexPassword)` */
  encryptedPrivateKey: string;
  createdAt: string;

  /** Active CodexGuard marker.
   *  Exactly ONE pure key in the codex carries isCodexGuard: true at any time.
   *  That key's properties:
   *    - is the FIRST pure key created when the codex was kickstarted
   *    - has its label LOCKED to "CodexGuard" (codex rejects rename attempts)
   *    - is NEVER deletable (codex rejects delete attempts)
   *    - UI renders with the dark-cherry designation color (consumer-side hint
   *      to display this distinctively)
   *    - is the key whose public half is registered as the codex-guard field
   *      on the ouronet-ns.CODEX chain entry
   *  Set by kickstartCodex on creation; transferred by rotateCodexGuard. */
  isCodexGuard?: boolean;

  /** Historical CodexGuard marker.
   *  When the user rotates the CodexGuard (replaces with a new pure key):
   *    - the NEW pure key gets isCodexGuard: true (and isCodexGuard is
   *      cleared from the prior one)
   *    - the OLD pure key gets wasCodexGuard: true
   *    - the OLD pure key's delete-protection STAYS (it remains stored
   *      forever as a "former CodexGuard")
   *    - the OLD pure key's label remains "CodexGuard" but with a numeric
   *      suffix indicating retirement order: "CodexGuard (retired #1)"
   *      (rename guards relax to allow this controlled suffix; consumer UI
   *      makes the historical nature clear)
   *  This preserves the historical chain of CodexGuards forever — anyone
   *  inspecting the codex can see every key that ever held this role. */
  wasCodexGuard?: boolean;

  /** Duo Pure Prime marker (autopilot CodexPrime backing).
   *  When the user chooses "auto-pure-keys" mode at kickstart instead of
   *  providing a Kadena seed, the package generates two pure keys to back
   *  the CodexPrime Ouronet Account (one as Payment Key, one as the
   *  Ouronet account's keyset key). Both keys get isDuoPurePrime: true
   *  and are protected from deletion (same mechanism as CodexGuard).
   *  Their labels are locked to "Duo Pure Prime (Payment)" and
   *  "Duo Pure Prime (Guard)" respectively. */
  isDuoPurePrime?: boolean;

  /** Role within the Duo Pure Prime pair (only meaningful when
   *  isDuoPurePrime: true). */
  duoPurePrimeRole?: "payment" | "guard";
}

/** An ouro (Ѻ./Σ.) account on chain. Persisted in the codex with its
 *  encrypted secret + last-known chain state. */
export interface IOuroAccount {
  id: string;
  name?: string;
  version: string;
  isSmart: boolean;
  address: string;
  guard: IKeyset | null;
  kadenaLedger: string | null;
  /** Codex-local public key (the value the UI itself produced — source of
   *  truth for what we minted). Compare to `chainPublicKey` for the live
   *  chain-side value. */
  publicKey: string;
  secret: string;
  backup: string;
  isActive?: boolean;
  /** DALOS mode used to derive this account. */
  originMode?: OuroOriginMode;
  /** Seed-words sub-tab used at creation. Only set when `originMode === "seedWords"`. */
  originSeedTab?: OuroOriginSeedTab;
  /** On-chain public key as returned by `URC_0027_AccountSelectorMapper`.
   *  Populated live from the sync cycle. Mismatch with `publicKey`
   *  indicates an admin-level rotation or codex corruption. */
  chainPublicKey?: string;
  /** Smart-account only — the Ѻ. standard account holding sovereignty. */
  sovereign?: string;
  /** Smart-account only — the account's governor guard (any Pact shape). */
  governor?: unknown;
  /** Live payment-key guard from the URC_0027 selector (any Pact shape). */
  paymentKeyGuard?: unknown;
  /** DALOS-family curve that produced this account's keys. */
  originCurve?: OuronetOriginCurve;
  /** Last-known StoicTag bound to this account on chain (no § sigil), as
   *  surfaced by the URC_0027 selector / sync cycle. Chain state mirrored
   *  into the codex for display; absent when the account has no tag. The
   *  CodexUI account row renders the StoicTag pillar + Add/Release from this. */
  stoicTag?: string;
  /** CodexPrime non-deletion flag (spec §B2). True for the auto-created
   *  primary account on every fresh codex; false (or absent) for all
   *  user-added accounts. The package's `useOuroAccounts().deleteAccount`
   *  hook throws `CodexPrimeProtectedError` when called on a `isPrime: true`
   *  account. */
  isPrime?: boolean;
  /** ID of the IKadenaSeed this account was derived from (v0.2.0+).
   *  Undefined for pure-keypair-derived accounts (which have no parent
   *  seed) and for legacy accounts imported from v0.1.0 backups. Set by
   *  `kickstartCodex` on the CodexPrime account so the prime-account
   *  invariant is causal ("derived from the prime seed") rather than
   *  positional ("first added wins"). See docs/v0.2.0-design.md §4.2. */
  parentSeedId?: string;
}

/** Address-book entry — a labeled recipient address for the address picker.
 *  `stoic-tag` entries store the BARE tag name (no `§` sigil) in `address`;
 *  the sigil is added for display/copy and the name is resolved on-chain. */
export interface AddressBookEntry {
  id: string;
  name: string;
  address: string;
  notes?: string;
  type: "ouronet" | "stoa" | "stoic-tag";
  /** Chain this recipient lives on (D-10). OPTIONAL and additive: an entry
   *  persisted before the field existed has no `chainId` and reads as the
   *  Kadena default (`entry.chainId ?? KADENA_CHAIN_ID`) — the stored entry is
   *  never rewritten. Shares the string namespace with codex-core's
   *  `ForeignKeyEntry.chainId` / `ForeignChainAdapter.id`, so a foreign entry
   *  (e.g. `"arweave:mainnet"`) uses that same vocabulary. */
  chainId?: string;
  /** ISO timestamp */
  createdAt: string;
  /** ISO timestamp */
  updatedAt: string;
}

/** The address-KIND of an {@link AddressBookEntry} — ORTHOGONAL to `chainId`
 *  (which is the CHAIN). The per-chain validator dispatches on this to pick the
 *  right per-kind check. */
export type AddressKind = AddressBookEntry["type"];

/** Patron-picker default mode. Matches OuronetUI's persisted vocabulary
 *  (`wallet.uiSettings.patronSelectionMode`) for 1:1 ZBOM parity:
 *    - `wealthiest` — auto-pick the codex account with the most IGNIS whose
 *                     guard the codex can satisfy.
 *    - `prime`      — prefer the CodexPrime account as patron.
 *    - `resident`   — prefer the currently-active ("resident") account. */
export type PatronSelectionMode = "wealthiest" | "prime" | "resident";

/** ZBOM popup profile — preset bundle of which zones open by default.
 *  `custom` means the individual `zbomZone0..3` flags are authoritative. */
export type ZbomProfile = "simple" | "basic" | "advanced" | "custom";

/** Codex-level UI preferences. Subset of OuronetUI's existing
 *  `walletsSlice.uiSettings` that's codex-scoped. As of v0.5.0 the ZBOM
 *  operation settings (`zbomProfile`, `zbomZone0..3`, `zbomExecutePosition`)
 *  are first-class here so the package's ported ZBOM modals are configurable
 *  1:1 with My Codex. */
export interface UiSettings {
  /** How long to cache the unlocked password in memory after authenticate(). */
  passwordCacheMinutes: number;
  /** Default behavior for the ZBOM patron-picker (v0.5.0 vocabulary). */
  patronSelectionMode: PatronSelectionMode;
  /** Active node preset. */
  selectedNode: "node1" | "node2" | "custom";
  customNodeUrl: string;
  customNodeGasLimit: number;
  /** Pre-v0.30.x koala signing path. Legacy users may still need this on. */
  legacyKoalaSigning: boolean;
  /** Experimental APOLLO curve opt-in. */
  experimentalCurvesEnabled: boolean;
  /** ZBOM popup zone-default profile (v0.5.0+). */
  zbomProfile: ZbomProfile;
  /** ZONE 0 (INFO) open-by-default. */
  zbomZone0: boolean;
  /** ZONE 1 (PATRON) open-by-default. */
  zbomZone1: boolean;
  /** ZONE 2 (INPUTS) open-by-default. */
  zbomZone2: boolean;
  /** ZONE 3 (SIGNING) open-by-default. */
  zbomZone3: boolean;
  /** Execute button position in the ZBOM popup. */
  zbomExecutePosition: "top" | "bottom";
  /** Allow consumer-specific keys without forcing a typed extension here.
   *  OuronetUI stashes its DEX-specific UI settings under the same
   *  `uiSettings` umbrella historically; this escape hatch keeps that
   *  working without bloating the package's canonical type. */
  [extra: string]: unknown;
}

/** Sensible UiSettings defaults — used by adapters on first boot when
 *  nothing has been persisted yet. ZBOM defaults mirror OuronetUI's
 *  `walletsSlice.ts` (profile `basic`, only INFO open, execute on top). */
export const DEFAULT_UI_SETTINGS: UiSettings = {
  passwordCacheMinutes: 1,
  patronSelectionMode: "wealthiest",
  selectedNode: "node2",
  customNodeUrl: "",
  customNodeGasLimit: 1_600_000,
  legacyKoalaSigning: false,
  experimentalCurvesEnabled: false,
  zbomProfile: "basic",
  zbomZone0: true,
  zbomZone1: false,
  zbomZone2: false,
  zbomZone3: false,
  zbomExecutePosition: "top",
};

/** Device-variant marker — Vite consumers usually read this from
 *  `import.meta.env.VITE_APP_VARIANT`. Adapters that don't have a Vite
 *  context (Next.js, Node tests) accept it as a constructor parameter. */
export type DeviceVariant = "dev" | "main";

/** Watchlist entry — read-only observation of a chain account whose keys
 *  live elsewhere. Persisted at the codex level (round-trips with backups)
 *  but distinct from the address book (which is for transfer recipients). */
export interface WatchListEntry {
  id: string;
  label: string;
  address: string;
  type: "ouronet" | "stoa";
  createdAt: string;
}

/** A single consumer's namespaced settings registry entry (v0.3.0+).
 *
 *  The codex stores a `Record<string, IConsumerSettings>` keyed by
 *  `consumerName`, letting multiple consumer apps (OuronetUI,
 *  AncientHoldings, Mnemosyne, ...) each stash their own settings under
 *  the same codex without colliding. The `settings` payload is the escape
 *  hatch (mirrors `UiSettings[extra]`): consumer-defined keys that the
 *  package treats as opaque, keeping the canonical type unbloated. The
 *  registry container itself is the structured part; each entry's own
 *  schema evolves under the consumer's `schemaVersion`. */
export interface IConsumerSettings {
  /** Canonical consumer identifier (e.g. "OuronetUI", "AncientHoldings",
   *  "Mnemosyne"). Used as the registry key. The store action validates
   *  this against a tight ASCII identifier regex on write. */
  consumerName: string;
  /** The consumer app's own semver at the time of the write. */
  consumerVersion: string;
  /** The consumer's own settings-schema version. The store action rejects
   *  a write whose schemaVersion is strictly less than the stored entry's
   *  (downgrade protection); equal is allowed (same-version re-save). */
  schemaVersion: number;
  /** Consumer-defined opaque payload. The package never inspects these
   *  keys — they round-trip verbatim. */
  settings: Record<string, unknown>;
  /** ISO timestamp of the last write. Server-stamped by the store action
   *  (caller-supplied value is overridden) so it is a trustworthy
   *  last-write marker. */
  lastUpdatedAt: string;
}

/** The codex's double-Apollo identity (v0.3.0+).
 *
 *  Every codex created or upgraded under v0.3.0 has exactly one Codex
 *  Identity. It is **IMMUTABLE post-creation**. Mutation attempts throw
 *  `CodexIdentityError('immutable-field')`. The on-chain `ouronet-ns.CODEX`
 *  registration depends on this immutability — once the identity is on chain,
 *  the codex's locally-cached copy must match it byte-for-byte forever.
 *
 *  All encrypted-at-CK derivation caches below are derivable from
 *  `encryptedSeedWords` alone; the other representations are cached to avoid
 *  re-running HKDF/PBKDF derivation on every sign, and to let the user export
 *  the seed in whichever format they want without re-deriving in the SPA. */
export interface ICodexIdentity {
  /** Display-only formatted address.
   *  Format: ₱.STANDARD-payload:Π.SMART-payload
   *  Where each payload is 160 glyphs from the Dalos character set encoding
   *  the corresponding Apollo public key. The ':' between halves matches the
   *  styling of the prefix dots so the whole identifier reads cohesively. */
  formatted: string;

  /** Apollo Standard public key (160-glyph Dalos encoding of 1024 bits). */
  standardPublicKey: string;

  /** Apollo Smart public key (160-glyph Dalos encoding of 1024 bits). */
  smartPublicKey: string;

  // ─── Encrypted-at-CK private material ─────────────────────────────────
  // ALL of these are derivable from `encryptedSeedWords` alone; the other
  // representations are cached for two reasons:
  //   1. Avoid re-running HKDF/PBKDF derivation on every sign
  //   2. Let the user export the seed in whichever format they want without
  //      re-running derivation in the SPA

  /** Full seed word sequence (1-512 words, 1-256 glyphs/word from the Dalos
   *  character set). UTF-8 string, space-separated. */
  encryptedSeedWords: string;

  /** 1024-bit Standard half as a binary string. */
  encryptedStandardBitstring: string;

  /** 1024-bit Smart half as a binary string. */
  encryptedSmartBitstring: string;

  /** Standard half as a base-10 scalar (up to ~309 decimal digits). */
  encryptedStandardBase10: string;

  /** Smart half as a base-10 scalar. */
  encryptedSmartBase10: string;

  /** Standard half as a base-49 scalar (Apollo's natural base). */
  encryptedStandardBase49: string;

  /** Smart half as a base-49 scalar. */
  encryptedSmartBase49: string;

  /** Optional cached Apollo private keys (re-derivable from bitstrings).
   *  Populated to avoid Apollo-curve derivation on every sign operation. */
  encryptedStandardPrivateKey?: string;
  encryptedSmartPrivateKey?: string;

  // ─── Plaintext metadata ───────────────────────────────────────────────

  /** Total seed-word count, 1 to 512.
   *  Combined with splitIndex this reconstructs the half boundaries. */
  totalWordCount: number;

  /** The index where the Smart half starts.
   *  Rule (deterministic, no user override at v0.3.0):
   *    splitIndex = Math.floor(totalWordCount / 2)
   *  So:
   *    totalWordCount=6  → splitIndex=3 → Standard=3 words, Smart=3 words
   *    totalWordCount=7  → splitIndex=3 → Standard=3 words, Smart=4 words (Smart bigger)
   *    totalWordCount=11 → splitIndex=5 → Standard=5 words, Smart=6 words (Smart bigger)
   *  Smart half ALWAYS gets the larger share when word count is odd. */
  splitIndex: number;

  createdAt: string;

  /** Mnemosyne account username that triggered this Codex's creation.
   *  Empty string for codices created outside Mnemosyne (e.g. via OuronetUI
   *  directly). Stored for audit; not used for authorization. */
  createdBy?: string;
}
