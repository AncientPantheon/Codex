/**
 * The Secure Master Account reconcile, kept pure.
 *
 * Given what the Codex Ouronet Master currently uses (its payment key and
 * its guard's keys) and what the codex currently has locked, work out which
 * locks to ADD and which to RELEASE. No chain access, no store access - so
 * every branch below is testable, which matters because the releasing half
 * can un-protect funds-bearing keys.
 *
 * ## `null` is not `[]`
 *
 * `paymentPublicKey: null` and `guardPublicKeys: null` mean "we could not
 * find out", NOT "there is none". An unresolved keyset reference (a flaky
 * chain read) surfaces exactly this way via `resolveGuardKeys`, and
 * treating it as an empty list would release every guard lock and silently
 * re-permit deleting the keys guarding the master account. So: a `null`
 * input suppresses releases for that reason entirely, and says so through
 * `guardUnresolved` / `paymentUnresolved` so the caller can report it.
 *
 * ## Over-locking is the safe direction
 *
 * If the same public key is held at several positions, EVERY one is locked.
 * Over-locking inconveniences; under-locking loses access.
 */

import type { MasterKeyLock, MasterKeyLockReason } from "@ancientpantheon/codex-core";
import type { IStoaChainSeed } from "../types/entities.js";

export interface MasterKeyLockDeltaInput {
  /** The master's payment key, or `null` when it could not be determined. */
  paymentPublicKey: string | null;
  /** The keys the master's guard authorizes, or `null` when the guard could
   *  not be resolved (see this module's header - `null` is not `[]`). */
  guardPublicKeys: readonly string[] | null;
  seeds: readonly IStoaChainSeed[];
  currentLocks: readonly MasterKeyLock[];
}

export interface MasterKeyLockDelta {
  /** Locks to add. Already filtered against `currentLocks`, so an unchanged
   *  re-run yields an empty array. */
  add: MasterKeyLock[];
  /** Locks to release - entries whose reason no longer applies. */
  release: MasterKeyLock[];
  /** Keys genuinely in use that this codex does not hold, so cannot lock.
   *  Reported rather than ignored: the user is relying on a key they may
   *  not actually control from here. */
  unmatchedKeys: { publicKey: string; reason: MasterKeyLockReason }[];
  /** True when the guard could not be resolved, so guard releases were
   *  deliberately suppressed. */
  guardUnresolved: boolean;
  /** True when the payment key could not be determined, so payment-key
   *  releases were deliberately suppressed. */
  paymentUnresolved: boolean;
}

const lockKey = (l: MasterKeyLock): string =>
  l.seedId + " " + String(l.position) + " " + l.reason;

/** Every `(seedId, position)` in the codex holding `publicKey`. */
function positionsHolding(
  seeds: readonly IStoaChainSeed[],
  publicKey: string
): { seedId: string; position: number }[] {
  const out: { seedId: string; position: number }[] = [];
  for (const s of seeds) {
    for (const a of s.accounts ?? []) {
      if (a.publicKey === publicKey) out.push({ seedId: s.id, position: a.index });
    }
  }
  return out;
}

export function computeMasterKeyLockDelta(
  input: MasterKeyLockDeltaInput
): MasterKeyLockDelta {
  const { paymentPublicKey, guardPublicKeys, seeds, currentLocks } = input;

  const paymentUnresolved = paymentPublicKey === null;
  const guardUnresolved = guardPublicKeys === null;

  const unmatchedKeys: { publicKey: string; reason: MasterKeyLockReason }[] = [];
  const desired: MasterKeyLock[] = [];

  const want = (publicKey: string, reason: MasterKeyLockReason): void => {
    const hits = positionsHolding(seeds, publicKey);
    if (hits.length === 0) {
      unmatchedKeys.push({ publicKey, reason });
      return;
    }
    for (const h of hits) desired.push({ ...h, reason });
  };

  if (paymentPublicKey !== null) want(paymentPublicKey, "master-payment-key");
  if (guardPublicKeys !== null) {
    // De-duplicated: a keyset naming the same key twice is still one lock.
    for (const k of new Set(guardPublicKeys)) want(k, "master-guard-key");
  }

  const desiredKeys = new Set(desired.map(lockKey));
  const currentKeys = new Set(currentLocks.map(lockKey));

  const add = desired.filter((d) => !currentKeys.has(lockKey(d)));

  const release = currentLocks.filter((l) => {
    if (desiredKeys.has(lockKey(l))) return false; // still wanted
    // Suppress releases for any reason whose inputs we could not determine -
    // we have no evidence the lock has lapsed, and absence of evidence must
    // not unlock a funds-bearing key.
    if (l.reason === "master-payment-key" && paymentUnresolved) return false;
    if (l.reason === "master-guard-key" && guardUnresolved) return false;
    return true;
  });

  return { add, release, unmatchedKeys, guardUnresolved, paymentUnresolved };
}
