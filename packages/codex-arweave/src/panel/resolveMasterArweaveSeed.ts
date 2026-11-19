// resolveMasterArweaveSeed — WHICH Arweave seed row is the codex's master.
//
// The master row is the one that sits at position one and wears the gold
// treatment (`#ceac5f` border/name/lock) in `ArweaveSeedsArea`. Until the
// eligibility wizard existed, "master" and "the seed carrying `isPrime`" were
// the same thing, so that flag answered both questions. They have come apart:
//
//   * `isPrime` is a CREATION-TIME PROVENANCE marker — "the first seed ever
//     added". It is deliberately NOT moved when the wizard derives a new
//     Master ArWeave Seed (`CodexIdPage.tsx`'s own comment says so, and
//     `addArweaveSeed` throws `CodexKickstartError("id-conflict")` on a second
//     explicit prime, so it CANNOT simply be relocated).
//   * `codexMasterSeed.arweaveSeedId` is the codex's settled IDENTITY of its
//     Master ArWeave Seed, written by the wizard's finalize step.
//
// Following `isPrime` therefore left the DEMOTED seed ("Arweave Seed 1") gold
// and first while the real new master sat grey further down — the inverse of
// the requirement. Identity wins here, exactly the way
// `codex-core`'s `resolveOuronetAccountName` already lets a settled
// `codexMasterSeed.ouroAccountId` outrank the positional rule for names, with
// the same backwards-compatibility promise: a codex with no settled master
// resolves EXACTLY as it always has.

/** The two fields the master-row rule reads. Structural on purpose, so the
 *  helper is usable from a unit test without building a whole
 *  `ArweaveSeedRecord` (bits included) per case. */
export interface MasterArweaveSeedCandidate {
  readonly id: string;
  /** `IArweaveSeed.isPrime` — the first seed ever added, NOT "is the master". */
  readonly isPrime?: boolean;
}

/**
 * The codex's Master ArWeave Seed among `seeds`, or `undefined` when there are
 * no seeds at all.
 *
 * Precedence, highest first:
 *
 *   1. `masterArweaveSeedId` (`codexMasterSeed.arweaveSeedId`), when it is set
 *      AND names a seed that is actually in the list. A dangling id — a seed
 *      since deleted, a half-restored codex — falls through rather than
 *      leaving the surface with no master row at all.
 *   2. The seed flagged `isPrime === true`. The pre-settlement rule, and the
 *      one every codex that has not re-run the eligibility wizard still needs.
 *   3. Position: the first seed. The last-resort fallback, unchanged — a codex
 *      can have seeds with no `isPrime` stamp on any of them.
 */
export function resolveMasterArweaveSeed<T extends MasterArweaveSeedCandidate>(
  seeds: readonly T[],
  masterArweaveSeedId?: string | null,
): T | undefined {
  if (masterArweaveSeedId) {
    const settled = seeds.find((seed) => seed.id === masterArweaveSeedId);
    if (settled !== undefined) return settled;
  }
  return seeds.find((seed) => seed.isPrime === true) ?? seeds[0];
}
