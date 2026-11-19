# Secure Master Account — Plan

Topic 4 of `docs/work/codex-master-seed-model/design.md`. Direct consumer of
topic 3's lock primitives (built, green).

Owner's words: *"when I know I changed said key, I would click that option,
the codex scans the Ouronet Master Account, and makes unremovable the keys
that are in its use, the payment key, and the keys that define its guard."*
And: *"when that namespace keyset would change, so too should the not-remove
tags of seeds and keys."* — so it RELEASES as well as adds.

## Shape

Split into a PURE core plus a thin store action, because the scan needs
chain reads (a keyset reference only resolves on chain) and nothing pure
should depend on the network. The reconcile is where the real logic is, so
the reconcile is what gets exhaustively tested without a chain.

## Wave 1
- [x] T1: `resolveGuardKeys(guard, deps)` — turn ANY guard shape into the key
      list it authorizes. Direct keyset returns its keys; a keyset REFERENCE
      (`{keysetref:{ns,ksn}}`) resolves through an injected `describeKeyset`;
      a capability/user guard reports that it has no enumerable keys; `null`
      reports none. A failed chain read reports the ref and the failure — it
      must never degrade to "no keys", which would silently release locks.
      Reuses `detectGuardKind` from `GuardTree.js`, the same way
      `zbom/cfm/governorSerialize.ts` already does.
      — done when: `tests/guards-resolve-guard-keys.test.ts` covers all five
      outcomes including a rejecting resolver, with no network.
  - files: `packages/codex-ouronet/src/guards/resolveGuardKeys.ts`,
    `packages/codex-ouronet/tests/guards-resolve-guard-keys.test.ts`
- [x] T2: `computeMasterKeyLockDelta({paymentPublicKey, guardPublicKeys,
      seeds, currentLocks})` — pure reconcile returning `{add, release,
      unmatchedKeys}`. Maps each key back to every `(seedId, position)` in
      the codex holding it; emits `master-payment-key` / `master-guard-key`
      reasons; releases locks whose key is no longer in use; reports keys
      that are in use but NOT in this codex rather than ignoring them.
      — done when: `tests/state-master-key-lock-delta.test.ts` covers add,
      release, no-op re-run (idempotence), a key moving from payment to
      guard, a key held in two seeds, and an unmatched key.
  - files: `packages/codex-ouronet/src/state/masterKeyLockDelta.ts`,
    `packages/codex-ouronet/tests/state-master-key-lock-delta.test.ts`

## Wave 2 (depends on Wave 1)
- [x] T3: Store action `secureMasterAccount({paymentPublicKey,
      guardPublicKeys})` — computes the delta against live seeds + locks,
      applies it through topic 3's `addMasterKeyLocks` /
      `releaseMasterKeyLocks`, persists once, and RETURNS the delta as the
      report ("never silently").
      — done when: `tests/state-secure-master-account.test.ts` proves, by
      calling the store directly: locks appear for payment + guard keys; a
      second identical run is a no-op returning an empty delta; changing the
      guard releases the stale lock and adds the new one in ONE call; and a
      position still needed under another reason survives.
  - files: `packages/codex-ouronet/src/state/store.ts`,
    `packages/codex-ouronet/tests/state-secure-master-account.test.ts`

## Explicitly NOT in this topic
- Any UI or button. The action is the deliverable; Step 3 and the Codex ID
  page wire it later.
- Reading the master account's payment key / guard FROM chain. The caller
  supplies the key material; `resolveGuardKeys` provides the unfolding half.
- Choosing WHICH account is the master (topic 5 / Step 3).
