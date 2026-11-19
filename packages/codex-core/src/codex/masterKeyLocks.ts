/**
 * Master-key locks — the codex's record of which derived key POSITIONS are
 * in load-bearing use and therefore must not be removed.
 *
 * Why this exists at all: a key position (`WalletAccount`) carries no
 * protection field of any kind, and positions are not removed through a
 * delete action — they disappear through `updateStoaChainSeed`, a
 * whole-object replace with no guard. The "Cannot delete first key of Prime
 * seed" affordance in the seeds UI only DISABLES A BUTTON; nothing enforces
 * it. This module is the data half of making that guarantee real.
 *
 * ## Why a registry of entries, and not a boolean flag
 *
 * Two requirements from the owner's own spec rule a flag out:
 *
 *  1. A custom guard keyset may draw keys from MULTIPLE seeds at MULTIPLE
 *     positions ("5 of 7 over multiple keys of multiple seeds"). The locked
 *     set is therefore many-to-many; a single `isPrime`-style flag
 *     designates one seed and cannot express it.
 *  2. Locks must be RELEASED as well as added — "when that namespace keyset
 *     would change, so too should the not-remove tags". A bare boolean
 *     carries no provenance, so nothing could tell whether a position is
 *     still locked for some OTHER reason, and releasing it would silently
 *     unlock something still in use. Hence {@link MasterKeyLock.reason}:
 *     a position stays locked while ANY reason still applies.
 *
 * ## Why top-level, and not a field on the seed
 *
 * `updateStoaChainSeed` replaces the entire seed object. A lock stored ON
 * the seed would be destroyed by any caller that rebuilt that seed from
 * stale data — exactly the failure mode that lost `Codex_Shape_Version`
 * through a field-by-field snapshot rebuild earlier in this project. A
 * registry the seed-update path never carries cannot be clobbered by it.
 */

/** Why a position is locked. A position stays locked while ANY of its
 *  reasons still applies, which is what lets a re-scan release precisely
 *  the reasons that lapsed and nothing else. */
export type MasterKeyLockReason =
  /** This position's key is the Codex Ouronet Master's payment key. */
  | "master-payment-key"
  /** This position's key appears in the Codex Ouronet Master's guard —
   *  whether that guard is a direct keyset or an on-chain keyset
   *  reference whose keys were unfolded and matched back to this codex. */
  | "master-guard-key";

/**
 * One lock. Read two ways, both load-bearing:
 *
 *  - a POSITION is unremovable iff an entry matches `(seedId, position)`;
 *  - a SEED is undeletable iff it holds at least one entry.
 *
 * One structure, both guarantees.
 */
export interface MasterKeyLock {
  /** `IStoaChainSeed.id` of the seed holding the locked position. */
  readonly seedId: string;
  /** The derived key index — `WalletAccount.index`, the UI's "Key #N". */
  readonly position: number;
  /** Provenance. See {@link MasterKeyLockReason}. */
  readonly reason: MasterKeyLockReason;
}

/** True when `lock` refers to this exact seed + position. */
export function lockMatchesPosition(
  lock: MasterKeyLock,
  seedId: string,
  position: number
): boolean {
  return lock.seedId === seedId && lock.position === position;
}

/** Every distinct position locked on `seedId`, ascending. Deduplicated:
 *  one position locked under two reasons is ONE position. */
export function lockedPositionsOf(
  locks: readonly MasterKeyLock[] | undefined,
  seedId: string
): number[] {
  if (!locks) return [];
  const seen = new Set<number>();
  for (const l of locks) if (l.seedId === seedId) seen.add(l.position);
  return [...seen].sort((a, b) => a - b);
}

/** True when any lock names this seed — i.e. the seed is undeletable. */
export function seedIsLocked(
  locks: readonly MasterKeyLock[] | undefined,
  seedId: string
): boolean {
  return !!locks?.some((l) => l.seedId === seedId);
}
