/**
 * The canonical display names for the Codex Master Seed and its three
 * derivations. ONE source of truth, deliberately.
 *
 * Why a module and not inline strings: the names being replaced here had no
 * single home, and that is precisely why they drifted. The literal
 * `"CodexPrime"` was duplicated across 20+ call sites, most of them the same
 * positional expression copy-pasted into every ZBOM modal:
 *
 *     accounts.indexOf(acc) === 0 ? "CodexPrime" : acc.name
 *
 * Renaming those by hand would re-create the same problem one rename later,
 * so the positional RULE lives here too (see the helpers below), not just
 * the string.
 *
 * ## The model these names describe
 *
 * One set of seed words -> one 1600-bit DALOS bitstring -> three
 * deterministic derivations, all via Stoa Dalos:
 *
 *   1. the Ouronet account        (singular)   -> Codex Ouronet Master
 *   2. the Chainweb keys          (positions)  -> Master Chainweb Seed
 *   3. the ArWeave accounts       (positions)  -> Master ArWeave Seed
 *
 * Collectively: the Codex Master Seed.
 *
 * ## Scope: DISPLAY ONLY
 *
 * Internal identifiers (`isPrime`, `primeAlignment`,
 * `CodexPrimeProtectedError`, `kickstartPrimeArweaveSeed`, every
 * `data-testid`) keep their existing names. Renaming persisted field names
 * would be a codex-format migration for no user-visible gain.
 *
 * In particular the master Ouronet account is still STORED with the name
 * `"CodexPrime"` by `kickstartCodex`. {@link masterOuronetAccountName}
 * resolves the display name from the codex's SETTLED master when it has one
 * (`codexMasterSeed.ouroAccountId`) and positionally otherwise, so codices
 * created before and after this change read identically.
 */

/** The master Ouronet account - one per codex, the account the whole
 *  eligibility flow is about. Formerly displayed as "CodexPrime". */
export const OURONET_CODEX_MASTER = "Codex Ouronet Master";

/** The Chainweb seed whose positions supply the master's payment key
 *  (position 0) and guard key (position 1). Formerly "Prime Codex Seed". */
export const MASTER_CHAINWEB_SEED = "Master Chainweb Seed";

/**
 * The ArWeave seed deriving the codex's ArWeave accounts. Formerly
 * "Prime Arweave Seed".
 *
 * NOTE the intercapital W. "ArWeave" is deliberate and owner-confirmed:
 * "ar" for ARCHIVE and "weave" for the woven structure of its ledger, which
 * is not technically a blockchain. Do not auto-correct this to "Arweave".
 * (Unrelated pre-existing strings elsewhere still spell the NETWORK
 * "Arweave"; only this name carries the intercapital.)
 */
export const MASTER_ARWEAVE_SEED = "Master ArWeave Seed";

/** The one seed behind all three of the above, as a first-class concept. */
export const CODEX_MASTER_SEED = "Codex Master Seed";

/**
 * The designation of the Ouronet account that was this codex's CodexPrime
 * before it ever settled a master — the one account a codex can ever displace.
 *
 * Owner: *"The former Prime Ouronet Account is now 'Initial Seed'. It would
 * have to be 'Former Codex Prime', because that was its designation before:
 * Codex Prime."*
 *
 * WRITTEN OUT AS A LITERAL, and deliberately NOT derived from
 * {@link OURONET_CODEX_MASTER} the way {@link FORMER_MASTER_ARWEAVE_SEED} is
 * derived from its live sibling. "Codex Prime" is a RETIRED HISTORICAL
 * designation, not a re-wording of a live name: the account carried that
 * title at a point in the past, and that fact does not change if the master's
 * current name is re-worded tomorrow. Deriving it would silently rewrite
 * history on the next rename. The exact value is pinned in
 * `tests/master-names.test.ts`, like its siblings.
 *
 * This REPLACES the short-lived `FORMER_OURONET_CODEX_MASTER`. Owner decision
 * (1): a displacement can only happen once — *"only once we can apply the
 * pending settings"* — and it is always kickstart-prime -> settled master, so
 * an Ouronet account can never legitimately read "Former Codex Ouronet
 * Master". Rendered behind `isLegacyPrimeAccount`'s seal gate (see
 * `./masterSeed.ts`), in muted silver, never gold: exactly one gold row is the accounts tab's invariant.
 */
export const FORMER_CODEX_PRIME = "Former Codex Prime";

/**
 * The golden designation of an ArWeave seed that USED to be the master.
 *
 * Owner: *"the one that isn't anymore would be designated Former Master
 * Arweave Seed."*
 *
 * DERIVED from {@link MASTER_ARWEAVE_SEED}, so the pair cannot drift in
 * wording — and so this one CARRIES THE INTERCAPITAL W too. It first shipped
 * spelling it "Arweave", taken literally from the owner's sentence above;
 * asked directly, the owner's answer was *"Master ArWeave Seed — this is the
 * correct designation"*, i.e. the intercapital belongs to the designation
 * itself, not to one constant. A seed does not change how its own name is
 * spelled by ceasing to be the master.
 *
 * The exact resulting string is still pinned literally in
 * `tests/master-names.test.ts`, so a rename of the master has to break a test
 * before it can silently re-word this.
 */
export const FORMER_MASTER_ARWEAVE_SEED = `Former ${MASTER_ARWEAVE_SEED}` as const;

/** The codex's StoaChain identity (two Apollo halves). Formerly displayed
 *  as "Codex ID" / "Codex Identity". */
export const CODEX_STOIC_IDENTITY = "Codex Stoic Identity";

/**
 * Who the codex settled on as its master, as far as naming is concerned.
 *
 * Both fields are optional because a codex that never ran the eligibility
 * wizard has no settled master at all, and because a call site that cannot
 * reach the account's id still deserves today's positional answer rather than
 * a type error.
 */
export interface MasterOuronetAccountOpts {
  /** `IOuroAccount.id` of the account being named. */
  readonly accountId?: string;
  /** `codexMasterSeed.ouroAccountId` - the settled master's id, or null/empty
   *  on a codex that has not settled one. */
  readonly settledMasterAccountId?: string | null;
}

/**
 * The two halves of an Ouronet account's display name, for callers with the
 * vertical room to render both (account rows, the Codex ID card).
 */
export interface MasterOuronetAccountParts {
  /** The name to render as the account's primary label. */
  readonly name: string;
  /** The stored name `name` displaced, when there was one - rendered as
   *  secondary text beneath. Undefined when nothing was displaced, so a
   *  caller never has to decide whether an empty string means "no line". */
  readonly formerName?: string;
}

/**
 * Display name for an Ouronet account, in two halves - see
 * {@link masterOuronetAccountName} for the precedence, which lives here once
 * and is shared by both exports so the two can never disagree.
 */
export function masterOuronetAccountParts(
  index: number,
  storedName?: string,
  explicitName?: string | null,
  opts?: MasterOuronetAccountOpts
): MasterOuronetAccountParts {
  const name = resolveOuronetAccountName(index, storedName, explicitName, opts);
  // A name is "displaced" only when the account is reading under some OTHER
  // label than its own stored one; `name === storedName` is the ordinary
  // fallback case, which has nothing to demote.
  const displaced =
    name !== storedName && !!storedName && storedName.length > 0
      ? storedName
      : undefined;
  return displaced === undefined ? { name } : { name, formerName: displaced };
}

/**
 * Display name for an Ouronet account at list position `index`.
 *
 * Precedence, highest first:
 *
 *   1. `explicitName` - the caller's already-resolved override (e.g. the
 *      APOLLO CodexID prime name), which outranks every rule below.
 *   2. The SETTLED master, when `opts.settledMasterAccountId` names one: that
 *      account - and only that account - gets {@link OURONET_CODEX_MASTER}.
 *      Every other account, *including the one at index 0*, falls through to
 *      its own stored name. Two accounts reading as the master at once would
 *      be worse than naming the wrong one.
 *   3. Position: index 0 is the master. This is the pre-settlement rule and
 *      applies verbatim whenever no master has been settled - a codex that
 *      never ran the eligibility wizard must read exactly as it always has.
 *
 * The master is never identified by matching the stored name: that is still
 * the legacy `"CodexPrime"` on every codex, old and new, so matching it would
 * be both redundant and fragile.
 */
export function masterOuronetAccountName(
  index: number,
  storedName?: string,
  explicitName?: string | null,
  opts?: MasterOuronetAccountOpts
): string {
  return resolveOuronetAccountName(index, storedName, explicitName, opts);
}

/** The one copy of the precedence documented on
 *  {@link masterOuronetAccountName}. */
function resolveOuronetAccountName(
  index: number,
  storedName?: string,
  explicitName?: string | null,
  opts?: MasterOuronetAccountOpts
): string {
  if (explicitName) return explicitName;
  const settled = opts?.settledMasterAccountId;
  if (settled) {
    if (opts?.accountId === settled) return OURONET_CODEX_MASTER;
  } else if (index === 0) {
    return OURONET_CODEX_MASTER;
  }
  return storedName && storedName.length > 0
    ? storedName
    : "Account #" + String(index + 1);
}

/**
 * Display name for a Chainweb seed at list position `index`.
 *
 * Mirrors the rule the seeds UI already used (`seed.isPrime === true ||
 * index === 0`), so a codex whose first seed was never explicitly flagged
 * still shows the master name.
 */
export function masterChainwebSeedName(
  index: number,
  isPrime: boolean | undefined,
  storedName?: string
): string {
  if (isPrime === true || index === 0) return MASTER_CHAINWEB_SEED;
  return storedName && storedName.length > 0
    ? storedName
    : "Seed #" + String(index + 1);
}
