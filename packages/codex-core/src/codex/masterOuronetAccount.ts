// resolveMasterOuronetAccount — WHICH Ouronet account row is the codex's
// master. The account-side twin of `codex-arweave`'s
// `resolveMasterArweaveSeed`, deliberately the same shape and the same
// precedence, so the two faces of the Codex Master Seed cannot be resolved by
// two different conventions.
//
// The master row is the one pinned to the prime zone, painted gold (`#ceac5f`)
// and wearing the 🔒 Prime badge in `OuronetAccountsTab`. Until the eligibility
// wizard existed, "master" and "the account carrying `isPrime`" were the same
// thing, so that flag — and its positional stand-in, `index === 0` — answered
// both questions. They have come apart:
//
//   * `isPrime` is PROVENANCE in its own documentation: the "CodexPrime
//     non-deletion flag (spec §B2). True for the auto-created primary account
//     on every fresh codex; false (or absent) for all user-added accounts"
//     (`codex-ouronet/src/types/entities.ts:290-294`). It exists to make
//     `deleteAccount` throw `CodexPrimeProtectedError`, not to nominate a
//     master. It is not wholly frozen — `promoteSeedAndAccountToPrime`
//     (`codex-ouronet/src/state/store.ts:2515-2576`) does relocate it, but
//     exactly once and only while the codex is NOT yet aligned, since it
//     refuses outright on `primeAlignment === "aligned"`. So the flag is a
//     weaker signal than a settled identity, and must never outrank one.
//   * `codexMasterSeed.ouroAccountId` is the codex's settled IDENTITY of its
//     Codex Ouronet Master, written by the eligibility wizard's finalize step.
//
// Following the flag (or position) therefore left the DEMOTED account — the
// auto-created "Initial Seed" — pinned, gold and badged while the real new
// master sat grey under "Other standard accounts". That is the owner's
// screenshot, and it is the inverse of the requirement. Identity wins here,
// exactly the way `resolveOuronetAccountName` in `./masterNames.ts` already
// lets a settled `ouroAccountId` outrank the positional rule for NAMES, with
// the same backwards-compatibility promise: a codex with no settled master
// resolves EXACTLY as it always has.
//
// ## This function does NOT apply the seal gate
//
// Stated outright so no future reader assumes otherwise. The design's *"the
// designation follows the SEAL, not the finalize"* gate —
// `isMigrationSealed(migrationProgress)` — is the CALLER's responsibility, and
// a caller rendering the golden designation, the gold treatment or the badge
// must apply it. This resolver takes no `MigrationProgress` and will happily
// honour an id written by a finalize that was never applied.
//
// That is deliberate, and it is why this differs from `isFormerMasterAccount`,
// which takes the progress as a REQUIRED third parameter that fails closed:
// "is this account a FORMER master" is meaningless on an unsealed codex, so
// that predicate can gate itself. "Which account is the master" must still
// answer on an unsealed and never-migrated codex — that is the positional
// branch below — so gating here would strip every such codex of its master
// row. Keeping this a pure list-and-id resolver also keeps it unit-testable
// without constructing a migration, and keeps the gate visible at the one
// place that renders gold.

/** The two fields the master-row rule reads. Structural on purpose, so the
 *  helper is usable from a unit test without building a whole `IOuroAccount`
 *  (chain keys, guards, StoicTag included) per case. */
export interface MasterOuronetAccountCandidate {
  readonly id: string;
  /** `IOuroAccount.isPrime` — the auto-created primary account of a fresh
   *  codex, NOT "is the master". See the header. */
  readonly isPrime?: boolean;
}

/**
 * The codex's Codex Ouronet Master among `accounts`, or `undefined` when there
 * are no accounts at all. Returns the ELEMENT ITSELF, never a copy, so callers
 * can compare rows against it by identity.
 *
 * Precedence, highest first:
 *
 *   1. `masterAccountId` (`codexMasterSeed.ouroAccountId`), when it is set AND
 *      names an account that is actually in the list. A dangling id — an
 *      account since deleted, a half-restored codex — falls through rather
 *      than leaving the surface with no master row at all. A falsy id
 *      (`undefined`, `null`, `""`) counts as NOT SETTLED: a half-written row
 *      is not an identity.
 *   2. The account flagged `isPrime === true`. The pre-settlement rule, and
 *      the one every codex that has not run the eligibility wizard still
 *      needs.
 *   3. Position: the first account. The last-resort fallback for codexes that
 *      NEVER MIGRATED and carry no `isPrime` stamp on any account — it exists
 *      for backwards compatibility alone and must not be read as a rule about
 *      settled codexes.
 */
export function resolveMasterOuronetAccount<T extends MasterOuronetAccountCandidate>(
  accounts: readonly T[],
  masterAccountId?: string | null,
): T | undefined {
  if (masterAccountId) {
    const settled = accounts.find((account) => account.id === masterAccountId);
    if (settled !== undefined) return settled;
  }
  return accounts.find((account) => account.isPrime === true) ?? accounts[0];
}
