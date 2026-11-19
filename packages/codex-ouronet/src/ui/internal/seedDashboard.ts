/**
 * Pure, React-free seed-attribution helpers for the migration wizard's
 * "Seed Dashboard" (`docs/work/wizard-seed-dashboard/design.md`).
 *
 * The dashboard shows, per seed actually in play, which of four roles that
 * seed backs: the chosen Ouronet account, the settled payment key, the
 * settled guard key(s) (with a count — a keys-all/keys-any keyset can draw
 * members from different seeds), and the codex's Prime Arweave address.
 * The first three are plain public-key string matches against each seed's
 * already-decrypted `accounts[].publicKey` list (no crypto needed). The
 * fourth needs a real decrypt-and-compare (see `resolveArweaveMatchSeedId`)
 * because `IArweaveSeed` carries no plaintext address at all — only the
 * encrypted bitstring. This module stays deliberately decoupled from the
 * wizard's own choice/preview types (`LegacyPrimeMigrationGuardChoice`,
 * `MasterKeyPreview`, neither exported, the latter not even exported from
 * that file) — callers resolve their own choices down to plain public key
 * strings before calling in here.
 */

import type { IOuroAccount, IStoaChainSeed, IArweaveSeed, IPureKeypair, SeedType } from "../../types/entities.js";
import { CODEX_MASTER_SEED } from "@ancientpantheon/codex-core";
import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";
import { normalizeSeedType } from "./keySource.js";
import { seedWordsToBitString } from "@ouronet/dalos-crypto/gen1";
import { bitStringOf } from "../../codex-identity/rebuildFullKey.js";

/** The derivation path named whenever new keys are defined, per
 *  `legacy-prime-migration-wizard/design.md`'s "Page 3" section — MOVED
 *  here (`wizard-seed-dashboard-refinements`) from
 *  `LegacyPrimeMigrationWizard.tsx`, which now imports it back, so this
 *  module can label the account role's sub-row with the SAME constant
 *  rather than a second, drifting copy of the string. */
export const STOIC_DALOS_DERIVATION_LABEL = "Stoic Dalos Derivation";

/** Owner (live testing, `wizard-page2-and-dashboard-fixes` round 7):
 *  "the seed responsible for it is the Seed that is called Prime Codex
 *  Seed, (not Initial Seed), (initial Seed was an ancient designation
 *  we used in the very beginning...)." `masterNames.ts` itself notes
 *  "Prime Codex Seed" as the FORMER name of what the codex now calls
 *  `MASTER_CHAINWEB_SEED` — reused here, deliberately NOT that constant
 *  (nor `CODEX_MASTER_SEED`, round 8's own rename — see that constant's
 *  own call site below), as this dashboard's own distinct label for a
 *  seed that genuinely IS the codex's historical prime/genesis seed
 *  (`isPrime: true`, or still carrying the legacy literal name "Initial
 *  Seed" — the SAME marker `seedNames.ts`'s own `getSeedDisplayName`
 *  already recognizes) but is NOT the seed backing THIS run's chosen
 *  account — `CODEX_MASTER_SEED` is reserved for that match
 *  specifically (round 5, renamed round 8). */
export const PRIME_CODEX_SEED = "Prime Codex Seed";

/** owner (live testing, this session): "when selecting option 2 (keep the
 *  same payment key), then the Derivation method changes automatically to
 *  the type of derivation that key is derived from. So it would be Koala,
 *  Chainweaver or PureKey (since that key is in the codex, you could know
 *  what to display here). If that payment key ISNT in the codex, or its
 *  another type of non k: address, we simply display a warning."
 *
 *  MOVED here (`wizard-seed-dashboard-refinements`) from
 *  `LegacyPrimeMigrationWizard.tsx`, which now imports it back — this
 *  module's own sub-row-label computation needs it too, and importing it
 *  FROM the wizard file would be circular (the wizard imports this file). */
export type PaymentKeyOrigin =
  | { kind: "seed"; seedType: SeedType }
  | { kind: "pure-keypair" }
  | { kind: "foreign" };

/** Display label for {@link PaymentKeyOrigin}'s `"seed"` case — the SAME
 *  vocabulary `entities.ts`'s own `SeedType`/`SEED_COLORS` already use,
 *  not new wording. "eckowallet" merges into "Chainweaver" (same wallet
 *  underneath, `keySource.ts`'s own documented reason they already share
 *  one color), and "stoic" (Stoic Dalos — this codex's OWN Ouronet seed,
 *  not a separate StoaChain mnemonic) is included as a fourth, real case
 *  beyond the owner's three named examples, rather than mislabelling it
 *  as one of the other three. */
export function paymentKeyOriginLabel(origin: PaymentKeyOrigin): string {
  if (origin.kind === "pure-keypair") return "PureKey";
  if (origin.kind === "foreign") return "";
  switch (origin.seedType) {
    case "koala": return "Koala";
    case "chainweaver":
    case "eckowallet": return "Chainweaver";
    case "stoic": return "Stoic Dalos";
  }
}

/**
 * Locates `keyOrAddr` (an optional `k:` prefix is stripped first) among
 * `seeds[].accounts[].publicKey` and returns the owning seed's `id`, or
 * `null` if no seed holds it (including when `keyOrAddr` is `null`/empty —
 * never throws).
 */
export function findSeedIdForKey(
  keyOrAddr: string | null | undefined,
  seeds: readonly IStoaChainSeed[],
): string | null {
  if (!keyOrAddr) return null;
  const pub = keyOrAddr.startsWith("k:") ? keyOrAddr.slice(2) : keyOrAddr;
  for (const seed of seeds) {
    for (const acc of seed.accounts) {
      if (acc.publicKey === pub) return seed.id;
    }
  }
  return null;
}

/**
 * Reports whether `keyOrAddr` (an optional `k:` prefix is stripped first)
 * matches some `pureKeypairs[i].publicKey` — the same strip-then-compare
 * convention {@link findSeedIdForKey} uses, for the fourth, non-seed-backed
 * attribution role (`docs/work/wizard-keyset-scale-and-sidebar/design.md`'s
 * "Pure keys join the picker and the dashboard"). Returns `false` for
 * `null`/`undefined`/empty input — never throws.
 */
export function pureKeypairBacksRole(
  keyOrAddr: string | null | undefined,
  pureKeypairs: readonly IPureKeypair[],
): boolean {
  if (!keyOrAddr) return false;
  const pub = keyOrAddr.startsWith("k:") ? keyOrAddr.slice(2) : keyOrAddr;
  return pureKeypairs.some((pk) => pk.publicKey === pub);
}

/**
 * True iff `keyOrAddr` IS the given (seed-less) account's own direct
 * `publicKey` — the self-guard pattern a STOA-style account commonly uses
 * (its guard/keyset names its own identity key as one of its members, see
 * `docs/work/wizard-keyset-scale-and-sidebar/`'s follow-up: the real
 * AncientHodler test account's guard is a 2-key keyset where one member is
 * literally its own payment/identity key). This is a THIRD attribution
 * bucket alongside {@link findSeedIdForKey}/{@link pureKeypairBacksRole} —
 * a key that is neither recorded in any seed's `accounts[]` nor in
 * `pureKeypairs[]`, yet is still perfectly well-known (it IS the chosen
 * account itself), so it must not silently fall through unattributed the
 * way a genuinely-foreign key correctly would. Only meaningful for the
 * account-fallback card (`accountSeedId === null`) — a seed-matched
 * account's own key already lives inside that seed's own `accounts[]`
 * and is already found by `findSeedIdForKey`.
 */
export function accountOwnKeyBacksRole(
  keyOrAddr: string | null | undefined,
  account: Pick<IOuroAccount, "publicKey" | "stoaChainLedger"> | null,
): boolean {
  if (!keyOrAddr || !account) return false;
  // Defensive on BOTH sides, deliberately — owner (live testing): clicking
  // "keep the guard as is" crashed the whole wizard with `Cannot read
  // properties of undefined (reading 'startsWith')` from right here.
  // `IOuroAccount` TYPES `publicKey` as a required `string` and
  // `stoaChainLedger` as `string | null`, but REAL persisted accounts —
  // the legacy/imported ones this wizard exists to rescue — carry neither
  // reliably (absent entirely, i.e. `undefined`, which `!== null` happily
  // waves through). A dashboard attribution helper must never be able to
  // take the screen down over a missing optional field: anything that
  // isn't a usable string simply does not match.
  const strip = (k: unknown): string | null =>
    typeof k === "string" && k.length > 0 ? (k.startsWith("k:") ? k.slice(2) : k) : null;
  const pub = strip(keyOrAddr);
  if (pub === null) return false;
  // BOTH of the account's own key fields count as "its own":
  //
  //  - `publicKey` is the codex-local DALOS key (the Ouronet identity
  //    itself, the `Ѻ.`-addressed one).
  //  - `stoaChainLedger` is its StoaChain/Kadena PAYMENT key, stored as a
  //    `k:`-prefixed address.
  //
  // Owner (live testing, real-data report — the second round of this same
  // bug): the real AncientHodler account's 2-key guard names its own
  // PAYMENT key (`k:35d9be77…54f`, visible as "PAYMENT KEY" on the
  // account's own Codex row), NOT its DALOS `publicKey`. Checking only
  // `publicKey` (this function's first version) therefore still missed
  // it, and the dashboard still under-counted that keyset as 1-of-2.
  return strip(account.publicKey) === pub || strip(account.stoaChainLedger) === pub;
}

/** One sub-row within a {@link SeedDashboardCard} — one per distinct
 *  derivation LABEL actually in play for that seed this run (not one per
 *  role: a role sharing another role's exact label merges onto the SAME
 *  sub-row, see {@link computeSeedDashboardCards}). */
export interface SeedDashboardSubRow {
  label: string;
  accountMatch: boolean;
  paymentMatch: boolean;
  guardCount: number;
  arweaveMatch: boolean;
}

/** One card per seed actually backing a role this run — the Settling
 *  Dashboard's own unit of "one seed WORDS entry" (`wizard-seed-dashboard-
 *  refinements/design.md`), as opposed to the OLD one-flat-row-per-seed
 *  model this replaces. */
export interface SeedDashboardCard {
  seedId: string;
  seedName: string;
  subRows: SeedDashboardSubRow[];
}

/** Input to {@link computeSeedDashboardCards} — EVERY field is an
 *  already-resolved seed id (or array of them), never a raw key or
 *  wizard choice object; this module does no key-searching at all. Owner
 *  (live testing, `wizard-page2-and-dashboard-fixes` round 5): "with the
 *  default selection, this same Master Seed would be responsible for
 *  generation of the payment key... thus also green ticker" — payment/
 *  guard moved from raw public keys (searched via `findSeedIdForKey`) to
 *  pre-resolved ids for exactly the same reason `accountSeedId` already
 *  was: a freshly-DERIVED key (the wizard's own default "derive a new
 *  one from this account's words" choice) is never recorded in any
 *  seed's own `accounts[]` yet, so a key search could never attribute it
 *  anywhere — the caller must instead attribute it directly to whichever
 *  id the ACCOUNT role itself resolved to (deriving happens FROM that
 *  exact same material). For an EXISTING, already-recorded key (the
 *  "keep" choices), the caller still resolves it via the exported
 *  {@link findSeedIdForKey} first, same as always — just one level up,
 *  at the call site, not in here. */
export interface SeedDashboardInput {
  accountSeedId: string | null;
  paymentSeedId: string | null;
  /** True when the payment key is being newly DERIVED via Stoic Dalos
   *  (the "derive a new one from this account's words" choice, position
   *  0) rather than an EXISTING key the backing seed's own wallet
   *  produced historically. Changes the sub-row LABEL to
   *  {@link STOIC_DALOS_DERIVATION_LABEL} regardless of the backing
   *  seed's own `seedType` — matching the Payment step's own "Derivation
   *  method: Stoic Dalos Derivation" copy for this choice, which is
   *  method-fixed, never inherited from whatever wallet the seed itself
   *  came from. `false`/omitted (the "keep" choices) keeps the existing
   *  per-seed-type label via {@link derivationLabelForSeed}. */
  paymentIsStoicDerived?: boolean;
  guardSeedIds: readonly (string | null)[] | null;
  /** Same reasoning as {@link SeedDashboardInput.paymentIsStoicDerived},
   *  for the guard key's own "recommended-single-key" (position 1)
   *  derive choice. */
  guardIsStoicDerived?: boolean;
  arweaveMatchSeedId: string | null;
}

/**
 * The non-account-match half of `computeSeedDashboardCards`' own seed-name
 * decision (round 7/8's `PRIME_CODEX_SEED`/`isLegacyPrimeMarked` logic,
 * extracted here as the one source of truth — `wizard-page2-and-dashboard-
 * fixes`, live-testing round): `PRIME_CODEX_SEED` when `seed` genuinely IS
 * the codex's own prime/genesis seed (`isPrime: true`, or still carrying
 * the legacy literal name "Initial Seed"), otherwise the seed's own real
 * `name` (or the literal "Seed" when that name is missing/empty). Callers
 * that, unlike `computeSeedDashboardCards`, have no `accountSeedId` to test
 * against (e.g. `SeedRevealModal`, which only receives the `seed` prop) can
 * only ever replicate THIS half — never the full account-match branch,
 * which needs context this helper deliberately doesn't take.
 */
export function seedDisplayNameFallback(seed: IStoaChainSeed): string {
  const isLegacyPrimeMarked = seed.isPrime === true || seed.name === "Initial Seed";
  return isLegacyPrimeMarked ? PRIME_CODEX_SEED : (seed.name && seed.name.length > 0 ? seed.name : "Seed");
}

/** The sub-row label a given seed's own `seedType` produces for a
 *  payment/guard key backed by it — `paymentKeyOriginLabel` + " Derivation"
 *  (e.g. a `seedType: "stoic"` seed produces the LITERAL STRING
 *  {@link STOIC_DALOS_DERIVATION_LABEL} — the same one the account role
 *  always uses — so the two merge onto one sub-row when they coincide). */
function derivationLabelForSeed(seed: IStoaChainSeed): string {
  return `${paymentKeyOriginLabel({ kind: "seed", seedType: normalizeSeedType(seed.seedType) })} Derivation`;
}

/** Finds an existing sub-row with this EXACT label, or appends (and
 *  returns) a fresh one — the merge mechanism every role contribution
 *  below shares. */
function subRowFor(subRows: SeedDashboardSubRow[], label: string): SeedDashboardSubRow {
  const existing = subRows.find((r) => r.label === label);
  if (existing) return existing;
  const created: SeedDashboardSubRow = {
    label, accountMatch: false, paymentMatch: false, guardCount: 0, arweaveMatch: false,
  };
  subRows.push(created);
  return created;
}

/**
 * Builds one CARD per seed in `seeds` that backs at least one of the four
 * roles, preserving `seeds`' own order, each containing one SUB-ROW per
 * distinct derivation label actually in play for that seed this run. A
 * seed backing none of the four roles is OMITTED — the dashboard only
 * shows seeds actually "in play", never an inert full roster. A key that
 * matches no seed at all (a custom-typed guard key, a pure keypair, a
 * foreign/non-k: address) simply contributes to no card — it never throws
 * and never fabricates attribution.
 *
 * The account role always labels its contribution
 * {@link STOIC_DALOS_DERIVATION_LABEL} (an Ouronet account is Dalos-curve,
 * full stop — not produced via this wizard's internal position-0/1
 * scheme, so it needs its own fixed label rather than borrowing a seed's
 * own `seedType`). Payment/guard label via {@link derivationLabelForSeed}
 * (that key's OWN backing seed's `seedType`) UNLESS
 * `paymentIsStoicDerived`/`guardIsStoicDerived` says the key is being
 * newly derived via Stoic Dalos instead — then it labels
 * `STOIC_DALOS_DERIVATION_LABEL` too, same as the account role, which is
 * exactly why they merge onto ONE sub-row for the common case (deriving
 * both from the SAME account words). The Arweave role merges onto the
 * `STOIC_DALOS_DERIVATION_LABEL` sub-row (creating one if none exists
 * yet) — eligibility ties the Arweave address to the SAME Dalos-derived
 * words as the account, so that is the natural home for it even when
 * nothing else on this seed is Dalos-labelled.
 */
export function computeSeedDashboardCards(
  seeds: readonly IStoaChainSeed[],
  input: SeedDashboardInput,
): SeedDashboardCard[] {
  const {
    accountSeedId, paymentSeedId, paymentIsStoicDerived, guardSeedIds, guardIsStoicDerived, arweaveMatchSeedId,
  } = input;

  // Owner (round 7, screenshot 2): "the Master Seed must always be
  // shown on the first position... the Other Seeds that are responsible
  // for the Selected Keys, must follow beneath it." Tracked alongside
  // `cards` (not folded into `SeedDashboardCard` itself — that type is
  // the public return shape, with no reason to carry an internal
  // sorting flag) purely to sort the account-matching card first at the
  // end, while leaving every other card's relative order untouched.
  const cards: SeedDashboardCard[] = [];
  const cardIsAccountMatch: boolean[] = [];
  seeds.forEach((seed) => {
    const accountMatch = accountSeedId === seed.id;
    const paymentMatch = paymentSeedId === seed.id;
    const guardCount = (guardSeedIds ?? []).filter((id) => id === seed.id).length;
    const arweaveMatch = arweaveMatchSeedId === seed.id;
    if (!accountMatch && !paymentMatch && guardCount === 0 && !arweaveMatch) return;

    const subRows: SeedDashboardSubRow[] = [];
    if (accountMatch) subRowFor(subRows, STOIC_DALOS_DERIVATION_LABEL).accountMatch = true;
    if (paymentMatch) {
      const label = paymentIsStoicDerived === true ? STOIC_DALOS_DERIVATION_LABEL : derivationLabelForSeed(seed);
      subRowFor(subRows, label).paymentMatch = true;
    }
    if (guardCount > 0) {
      const label = guardIsStoicDerived === true ? STOIC_DALOS_DERIVATION_LABEL : derivationLabelForSeed(seed);
      subRowFor(subRows, label).guardCount = guardCount;
    }
    if (arweaveMatch) subRowFor(subRows, STOIC_DALOS_DERIVATION_LABEL).arweaveMatch = true;

    // Owner (live testing, `wizard-page2-and-dashboard-fixes` round 5):
    // "The Master Seed is the seed responsible for the Selected Ouronet
    // Account. PERIOD." — "Master Chainweb Seed" in THIS dashboard means
    // exactly that: the seed `accountMatch` is true for, never a seed
    // merely at array position 0 / flagged `isPrime`. That positional
    // convention (`masterChainwebSeedName`) is correct for the codex-WIDE
    // "Seeds" tab — a different context with no chosen-account ambiguity
    // (see `masterNames.ts`'s own doc comment) — but wrong here: during
    // migration the user can choose a DIFFERENT account than the codex's
    // historical prime one, and the OLD index-0/`isPrime` seed is simply
    // a separate, unrelated entity that must show under its OWN real
    // name, never relabeled "Codex Master Seed" just because it happens
    // to also back the payment/guard role this run.
    //
    // Owner (round 8): "The name is Codex Master Seed Not Master
    // Chainweb Seed." `MASTER_CHAINWEB_SEED` names only ONE of the three
    // Codex Master Seed derivations (`masterNames.ts`'s own model: "1.
    // the Ouronet account -> Codex Ouronet Master, 2. the Chainweb keys
    // -> Master Chainweb Seed, 3. the ArWeave accounts -> Master ArWeave
    // Seed. Collectively: the Codex Master Seed.") — this card represents
    // the FIRST-CLASS, collective concept (it can back the account AND
    // payment AND guard all at once), so `CODEX_MASTER_SEED` is the
    // correct label, not the narrower Chainweb-specific one.
    //
    // Owner (round 7): "the seed responsible for it is the Seed that is
    // called Prime Codex Seed, (not Initial Seed)... [that] was an
    // ancient designation we used in the very beginning, which may now
    // have lingered." A seed that IS the codex's own genuine prime/
    // genesis seed (`isPrime: true`, or still carrying the legacy
    // literal name "Initial Seed" from older codices — the SAME marker
    // `seedNames.ts`'s own `getSeedDisplayName` already recognizes) but
    // is NOT this run's `accountMatch` shows `PRIME_CODEX_SEED` — honest
    // about what it genuinely is, never the confusing raw legacy string,
    // and never "Codex Master Seed" either (reserved for the account's
    // own match).
    const seedName = accountMatch ? CODEX_MASTER_SEED : seedDisplayNameFallback(seed);
    cards.push({ seedId: seed.id, seedName, subRows });
    cardIsAccountMatch.push(accountMatch);
  });
  // The account-matching card (if any) always sorts first; every other
  // card keeps its existing relative order (a stable sort — guaranteed
  // by the spec since ES2019 — so pairing `cards`/`cardIsAccountMatch`
  // by index is enough; no need to carry the flag on the card itself).
  const order = cards.map((_, i) => i);
  order.sort((a, b) => (cardIsAccountMatch[b] ? 1 : 0) - (cardIsAccountMatch[a] ? 1 : 0));
  return order.map((i) => cards[i]!);
}

/** Input to {@link resolveArweaveMatchSeedId}. `smartDecrypt` is injected
 *  (never imported directly here) so this module stays crypto-library
 *  agnostic and trivially testable with a stub. */
export interface ResolveArweaveMatchSeedIdInput {
  arweaveSeeds: readonly IArweaveSeed[];
  candidateSeeds: readonly IStoaChainSeed[];
  password: string | null;
  smartDecrypt: (ciphertext: string, password: string) => Promise<string>;
}

/**
 * Finds which of `candidateSeeds` shares origin with the codex's Prime
 * Arweave Seed, by decrypting both and comparing the DECRYPTED bitstrings
 * for exact equality — both `IStoaChainSeed.secret` and `IArweaveSeed.secret`
 * are documented to hold the derived 1600-bit bitstring directly (never
 * re-hashed further), so no RSA re-derivation is needed, just a decrypt and
 * a string compare.
 *
 * Returns `null` (never throws/rejects) when: there is no password to
 * decrypt with, no `arweaveSeeds` entry has `isPrime: true`, or any decrypt
 * call rejects — a decrypt failure degrades to "no match", it does not abort
 * the scan or propagate an error.
 */
export async function resolveArweaveMatchSeedId(
  input: ResolveArweaveMatchSeedIdInput,
): Promise<string | null> {
  const { arweaveSeeds, candidateSeeds, password, smartDecrypt } = input;
  if (password === null) return null;
  const primeArweaveSeed = arweaveSeeds.find((s) => s.isPrime === true);
  if (!primeArweaveSeed) return null;

  let primeBits: string;
  try {
    primeBits = await smartDecrypt(primeArweaveSeed.secret, password);
  } catch {
    return null;
  }

  for (const candidate of candidateSeeds) {
    try {
      const candidateBits = await smartDecrypt(candidate.secret, password);
      if (candidateBits === primeBits) return candidate.id;
    } catch {
      // This candidate's decrypt failed — treat as "not a match", keep scanning.
      continue;
    }
  }
  return null;
}

/** The two Arweave positions a codex must hold under the Codex Master Seed
 *  to be eligible — owner (`arweave-master-accounts/design.md`): "the codex
 *  holds #0 and #1 arweave accounts derived from the Codex Master Seed.
 *  That's the last step that would make it eligible." Deliberately a named
 *  constant rather than two literals sprinkled across the predicate and its
 *  callers (the wizard derives exactly the positions this reports missing),
 *  and deliberately NOT extended beyond #1 — design.md's own "out of
 *  scope". */
export const MASTER_ARWEAVE_ACCOUNT_INDEXES: readonly number[] = [0, 1];

/** Input to {@link codexHoldsMasterArweaveAccounts}. `smartDecrypt` is
 *  injected, same reasoning as {@link ResolveArweaveMatchSeedIdInput} — this
 *  module imports no crypto library (see the file header). */
export interface CodexHoldsMasterArweaveAccountsInput {
  /** The Codex Master Seed's own 1600-bit bitstring, already resolved by the
   *  caller. `null` when it could not be resolved (locked codex, failed
   *  derivation) — which is "not proven eligible", never a free pass. */
  masterBitString: string | null;
  arweaveSeeds: readonly IArweaveSeed[];
  foreignKeys: readonly ForeignKeyEntry[];
  password: string | null;
  smartDecrypt: (ciphertext: string, password: string) => Promise<string>;
}

/** Result of {@link codexHoldsMasterArweaveAccounts}. */
export interface CodexHoldsMasterArweaveAccountsResult {
  /** True ONLY when the master's Arweave seed exists AND both #0 and #1 are
   *  held under it — i.e. `missingIndexes` is empty. */
  ok: boolean;
  /** The Arweave seed whose decrypted bitstring IS the master's, even when
   *  its accounts are missing (so a caller can derive the missing positions
   *  under the seed that already exists rather than creating a second one);
   *  `null` when no seed matched. */
  seedId: string | null;
  /** Which of {@link MASTER_ARWEAVE_ACCOUNT_INDEXES} are absent for that
   *  seed — all of them when no seed matched at all. */
  missingIndexes: number[];
}

/**
 * Whether the codex holds the Arweave accounts #0 and #1 DERIVED FROM the
 * Codex Master Seed — the single verified predicate behind both the Settling
 * Dashboard's violet ticker and the migration wizard's "This codex is now
 * eligible." claim (`docs/work/arweave-master-accounts/design.md`), so the
 * two can no longer disagree. The reported bug was exactly that
 * disagreement: the wizard printed the eligible panel while the ticker — the
 * independent check of the very same fact — stayed dark, because eligibility
 * was inferred from "the derivation call didn't throw" instead of from the
 * codex's end state (and the derivation was in fact discarding its key,
 * leaving the codex with an Arweave seed row and ZERO Arweave accounts).
 *
 * `ok` is true iff BOTH halves hold:
 *  1. some `arweaveSeeds[i]` decrypts to exactly `masterBitString` —
 *     the same decrypt-and-compare as {@link resolveArweaveMatchSeedId}
 *     (an `IArweaveSeed.secret` is the derived bitstring directly, never
 *     re-hashed, so no RSA re-derivation is needed), and
 *  2. `foreignKeys` holds an entry with THAT seed's `id` at `index: 0` and
 *     another at `index: 1`.
 *
 * Deliberately NOT filtered by `isPrime`, unlike
 * {@link resolveArweaveMatchSeedId}: this is about DERIVATION, not a flag.
 * design.md's "different seed" case explicitly leaves pre-existing Arweave
 * seeds untouched, so the codex's FIRST (hence prime-flagged) Arweave seed
 * is commonly an unrelated one, and the seed that genuinely derives from
 * the master may carry no flag at all.
 *
 * Also deliberately strict about `(seedId, index)`: `ForeignKeyEntry`'s own
 * doc states `index` is per-seed (never global) and is meaningless without a
 * `seedId`, so an entry at `index: 0` bearing a DIFFERENT `seedId` — or none
 * — does not count. Counting those is precisely how eligibility could be
 * claimed off unrelated keys while the ticker stayed dark.
 *
 * MULTIPLE matching seeds (possible after a re-import: two seed rows holding
 * the same bitstring) resolve to the FIRST in `arweaveSeeds` order — a fixed,
 * documented tie-break (pinned by its own test) so the answer cannot drift
 * between the ticker and the wizard, which must agree exactly.
 *
 * Never throws/rejects. `{ ok: false, seedId: null, missingIndexes: [0, 1] }`
 * for a null/empty `masterBitString` or a null `password` (without
 * attempting a single decrypt — the predicate runs on the wizard's finalize
 * path and each decrypt is a real 600,000-iteration PBKDF2), and a seed
 * whose decrypt rejects is skipped exactly as
 * {@link resolveArweaveMatchSeedId} already skips one.
 */
export async function codexHoldsMasterArweaveAccounts(
  input: CodexHoldsMasterArweaveAccountsInput,
): Promise<CodexHoldsMasterArweaveAccountsResult> {
  const { masterBitString, arweaveSeeds, foreignKeys, password, smartDecrypt } = input;
  // "Nothing proven" — the shape returned whenever no seed can be matched.
  // A fresh array every call: `missingIndexes` is handed to callers that
  // may well pass it onward, and sharing the module-level constant's own
  // array would let one of them mutate the constant.
  const nothingHeld: CodexHoldsMasterArweaveAccountsResult = {
    ok: false, seedId: null, missingIndexes: [...MASTER_ARWEAVE_ACCOUNT_INDEXES],
  };
  // An EMPTY `masterBitString` is an unresolved master, not a value to
  // compare: a decrypt that legitimately returns "" would otherwise equal
  // it and hand back a false `seedId`.
  if (masterBitString === null || masterBitString.length === 0) return nothingHeld;
  if (password === null) return nothingHeld;

  let masterSeedId: string | null = null;
  for (const candidate of arweaveSeeds) {
    try {
      const candidateBits = await smartDecrypt(candidate.secret, password);
      if (candidateBits === masterBitString) {
        // First match in array order wins — see the doc comment's tie-break.
        masterSeedId = candidate.id;
        break;
      }
    } catch {
      // This seed's decrypt failed — treat as "not a match", keep scanning.
      continue;
    }
  }
  if (masterSeedId === null) return nothingHeld;

  const missingIndexes = MASTER_ARWEAVE_ACCOUNT_INDEXES.filter(
    (index) => !foreignKeys.some((key) => key.seedId === masterSeedId && key.index === index),
  );
  return { ok: missingIndexes.length === 0, seedId: masterSeedId, missingIndexes };
}

/** Input to {@link resolveAccountSeedId}. `smartDecrypt` is injected, same
 *  reasoning as {@link ResolveArweaveMatchSeedIdInput}. `account` needs
 *  more than just `secret`: an `IOuroAccount`'s own `secret` is whatever
 *  its `originMode` says it is (`SpawnAccountModal.tsx`'s five tabs —
 *  seedWords/bitmap/bitString/integerBase10/integerBase49), never
 *  unconditionally the typed words — so re-deriving its canonical
 *  bitstring needs `originMode`/`originCurve`/`address` too (the exact
 *  shape {@link bitStringOf} already requires). A caller can still pass a
 *  minimal `{secret, address}` object (every other field optional,
 *  defaulting the same way `bitStringOf`'s own callers already do)
 *  without importing the full `IOuroAccount` type here. */
export interface ResolveAccountSeedIdInput {
  account:
    | (Pick<IOuroAccount, "secret" | "address">
      & Partial<Pick<IOuroAccount, "originMode" | "originCurve" | "parentSeedId">>)
    | null;
  candidateSeeds: readonly IStoaChainSeed[];
  password: string | null;
  smartDecrypt: (ciphertext: string, password: string) => Promise<string>;
  /** Optional, CALLER-OWNED memo of each candidate seed's computed
   *  bitstring, keyed by seed id (`settled-master-identity/design.md`:
   *  "each seed's decrypted bitstring is memoised for the wizard's
   *  lifetime. Seeds cannot change mid-run, so re-deriving them on every
   *  account switch is pure waste"). Read before a candidate is
   *  decrypted and written after — a hit skips {@link smartDecrypt}
   *  entirely for that seed. Omitting it leaves behaviour exactly as it
   *  was. Deliberately a parameter rather than a module-level mutable:
   *  this module is pure and React-free (see the file header), and a
   *  module-level cache would leak across callers and across tests.
   *
   *  A `null` VALUE means "this seed could not be decrypted/derived" —
   *  the failure is memoised too, so a broken seed is not re-attempted
   *  at 600,000 PBKDF2 iterations on every single account switch.
   *
   *  PASSWORD EPOCH — the caller's responsibility. The key is the seed
   *  id alone, with no password identity in it. A SUCCESSFUL value is
   *  password-independent (a seed's bitstring is a property of the seed,
   *  not of the password it was unlocked with), but a `null` is NOT: it
   *  may mean nothing worse than "the password in force at the time was
   *  wrong", and replaying it later would wrongly report a perfectly
   *  good seed as unresolvable. The caller must therefore DISCARD the
   *  map whenever the password epoch changes (a fresh `Map` per wizard
   *  mount / per unlock, never one shared across unlocks). This
   *  function never clears or re-validates it — it cannot, as it has no
   *  way to tell one password from another. */
  seedBitsCache?: Map<string, string | null>;
}

/**
 * `candidateSeeds` reordered so the seed named by `parentSeedId` (when it
 * names one actually present) is scanned FIRST, every other candidate
 * keeping its original relative order behind it and the named seed never
 * appearing twice. Returns `candidateSeeds` untouched when `parentSeedId`
 * is absent/empty or names nothing in the list.
 *
 * This is ONLY a reordering, and that is the entire point
 * (`settled-master-identity/design.md` §2). `parentSeedId` is a
 * provenance stamp written at account-SPAWN time — structurally identical
 * to the wizard's own `originSeedTab`, which that file documents as
 * "never derived from, or verified against, the actual stored secret" and
 * which misreported BOTH ways on the owner's real codex. So the claimed
 * parent still faces the same decrypt-and-compare as everyone else; if it
 * does not match, the scan simply continues. Trusting the stamp as a
 * shortcut would mis-attribute the seed behind a funds-bearing account.
 */
function candidateSeedsParentFirst(
  candidateSeeds: readonly IStoaChainSeed[],
  parentSeedId: string | undefined,
): readonly IStoaChainSeed[] {
  if (!parentSeedId) return candidateSeeds;
  const at = candidateSeeds.findIndex((s) => s.id === parentSeedId);
  if (at < 0) return candidateSeeds;
  return [
    candidateSeeds[at]!,
    ...candidateSeeds.slice(0, at),
    ...candidateSeeds.slice(at + 1),
  ];
}

/**
 * One candidate seed's CANONICAL bitstring — the value
 * {@link resolveAccountSeedId} compares against the account's own — or
 * `null` when it cannot be produced (decrypt rejects, or the words fail
 * to convert). Served from `cache` when present, and written back to it
 * either way.
 *
 * A seed's own `secret` is ALREADY the bitstring directly ONLY for
 * `seedType: "stoic"` (`entities.ts`'s own doc comment); for koala/
 * chainweaver/eckowallet it is the real MNEMONIC, which needs
 * {@link seedWordsToBitString} run on it first. Preserved here verbatim
 * from the inline version this replaces — see
 * {@link resolveAccountSeedId}'s own doc comment for the live-testing bug
 * that distinction fixed.
 */
async function candidateSeedBits(
  candidate: IStoaChainSeed,
  password: string,
  smartDecrypt: (ciphertext: string, password: string) => Promise<string>,
  cache: Map<string, string | null> | undefined,
): Promise<string | null> {
  // `has`, never `get() ?? compute()` — a memoised FAILURE is a real
  // cached answer, and must not be re-decrypted on every call.
  if (cache?.has(candidate.id) === true) return cache.get(candidate.id) ?? null;
  let bits: string | null;
  try {
    const decrypted = await smartDecrypt(candidate.secret, password);
    bits = normalizeSeedType(candidate.seedType) === "stoic"
      ? decrypted
      : seedWordsToBitString(decrypted.trim().split(/\s+/).filter(Boolean));
  } catch {
    bits = null;
  }
  cache?.set(candidate.id, bits);
  return bits;
}

/**
 * Finds which of `candidateSeeds` is the SAME seed backing `account`'s own
 * material — for ANY chosen account (`"keep current"` or `"existing"`),
 * reliably, by decrypting and comparing CANONICAL bitstrings rather than
 * trusting a stored public key that is known to drift from any seed's own
 * bookkeeping on legacy/imported codices (the whole reason this wizard
 * exists).
 *
 * Both sides need canonicalizing before comparison, each for its own
 * reason:
 * - The ACCOUNT side: `account.secret` decrypts to whatever its
 *   `originMode` says (NOT always words) — re-derived via
 *   {@link bitStringOf} (`codex-identity/rebuildFullKey.ts`, the SAME
 *   helper the real seed-reveal flows already use), which handles every
 *   origin mode correctly instead of assuming "words" and corrupting
 *   anything that isn't.
 * - The CANDIDATE side: a seed's own `secret` is ALREADY the bitstring
 *   directly ONLY for `seedType: "stoic"` (`entities.ts`'s own doc
 *   comment) — for koala/chainweaver/eckowallet it is the real MNEMONIC
 *   directly, so it needs {@link seedWordsToBitString} run on it first.
 *   Owner (live testing, `wizard-page2-and-dashboard-fixes` round 2):
 *   "when i choose another ouronet account as being selected, the same
 *   seed displays, which is incorrect" — comparing a non-stoic
 *   candidate's raw decrypted WORDS against the account's own derived
 *   BITSTRING could never equal, so a real match against exactly that
 *   class of seed silently failed every time, every "existing" selection
 *   falling through to whatever (wrong/stale) id a PRIOR resolution had
 *   last settled on.
 *
 * The SCAN ORDER (not the verification) is biased by
 * `account.parentSeedId` via {@link candidateSeedsParentFirst}, and each
 * candidate's bitstring can be memoised in the caller-owned
 * {@link ResolveAccountSeedIdInput.seedBitsCache} — together collapsing
 * the common case from N+1 serial 600,000-iteration PBKDF2 decrypts to
 * two, and a repeat visit to one (`settled-master-identity/design.md`
 * §2: the owner's "why is there a latency period between when i choose
 * the Ouronet Account and when the Blue square gets light up?"). Neither
 * changes WHAT counts as a match: every candidate the scan reaches,
 * claimed parent included, is still proven by decrypt-and-compare.
 *
 * Returns `null` (never throws/rejects) when: `account` is `null`, there
 * is no password to decrypt with, the account's own decrypt/derivation
 * fails, or a candidate's decrypt/derivation rejects — a single
 * candidate's failure degrades to "not a match for that one," it does not
 * abort the scan.
 */
export async function resolveAccountSeedId(
  input: ResolveAccountSeedIdInput,
): Promise<string | null> {
  const { account, candidateSeeds, password, smartDecrypt, seedBitsCache } = input;
  if (account === null || password === null) return null;

  let accountBits: string;
  try {
    const plain = await smartDecrypt(account.secret, password);
    const bits = bitStringOf(account, plain);
    if (bits === null) return null;
    accountBits = bits;
  } catch {
    return null;
  }

  // The account's OWN secret is never cached — `seedBitsCache` is keyed
  // by SEED id, and the account is not a seed.
  for (const candidate of candidateSeedsParentFirst(candidateSeeds, account.parentSeedId)) {
    // `null` (undecryptable/underivable) is simply "not a match for this
    // one" — it never aborts the scan, exactly as the per-candidate
    // try/catch this replaces never did.
    const candidateBits = await candidateSeedBits(candidate, password, smartDecrypt, seedBitsCache);
    if (candidateBits !== null && candidateBits === accountBits) return candidate.id;
  }
  return null;
}
