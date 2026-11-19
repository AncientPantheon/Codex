# Position Lock Invariant — Plan

Topic 3 of `docs/work/codex-master-seed-model/design.md`. Started first, on
recommendation: a key position has NO lock of any kind today and
`updateStoaChainSeed` will silently drop one, so this is a live hole under
everything else in that design — and Step 3's "keep the existing keyset"
option cannot be honest without it.

## The shape, and why

A lock is one entry: `{ seedId, position, reason }`.

- A **position** is unremovable iff an entry matches `(seedId, position)`.
- A **seed** is undeletable iff it holds at least one entry.

One structure satisfies both of the owner's requirements, and carries the
provenance that makes "Secure Master Account" able to RELEASE safely.

**Stored as a top-level codex registry, NOT as a flag on `WalletAccount`.**
Decisive reason: `updateStoaChainSeed` is a whole-object replace. A flag
living on the seed would be clobbered by any caller that rebuilt the seed
from stale data — precisely the failure that lost `Codex_Shape_Version`
through a field-by-field rebuild earlier in this project. A registry the
seed-update path does not carry cannot be destroyed by that path.

## Wave 1
- [x] T1: Define the lock entry type and surface it on every type that
      describes a codex — `MasterKeyLock { seedId: string; position: number;
      reason: MasterKeyLockReason }` with
      `MasterKeyLockReason = "master-payment-key" | "master-guard-key"`, plus
      an optional `masterKeyLocks?: MasterKeyLock[]` field on the snapshot /
      plaintext / export types. Types only — no behavior, no persistence.
      — done when: `npx tsc --noEmit` passes in codex-core, codex-ouronet and
      codex-ui with the new field present on all four type surfaces.
  - files: `packages/codex-ouronet/src/types/entities.ts`,
    `packages/codex-ouronet/src/adapters/types.ts`,
    `packages/codex-core/src/adapters/types.ts`,
    `packages/codex-core/src/codex/types.ts`
- [x] T2: Add `CodexMasterKeyLockedError`, carrying which seed, which
      position (or `null` when a whole seed is refused), and the reason that
      blocked it — following the existing `CodexPrimeSeedProtectedError`
      construction and export convention exactly.
      — done when: `tests/errors-master-key-locked.test.ts` asserts the error
      is exported from the package barrel, is an `instanceof CodexError`, and
      its message names the seed, the position and the reason.
  - files: `packages/codex-ouronet/src/errors/types.ts`,
    `packages/codex-ouronet/src/errors/index.ts`,
    `packages/codex-ouronet/tests/errors-master-key-locked.test.ts`

## Wave 2 (depends on Wave 1)
- [x] T3: Persist the registry end to end — store state slice + hydrate,
      the `LocalStorageCodexAdapter` shard (`"masterKeyLocks"` key, written
      faithfully including absence), the codec's conditional emit and
      top-level allow-list entry, and `importFromCloud`'s assignment.
      — done when: `tests/adapter-master-key-locks-shard.test.ts` proves a
      `saveAll → loadAll` round trip against the fake storage seam, and a
      codex-ui test proves an export → import round trip preserves the
      registry (both modelled on the `Codex_Shape_Version` tests that already
      exist for this exact plumbing).
  - files: `packages/codex-ouronet/src/state/store.ts`,
    `packages/codex-ouronet/src/adapters/LocalStorageCodexAdapter.ts`,
    `packages/codex-core/src/codex/codec.ts`,
    `packages/codex-ui/src/hooks/useCodexBackup.ts`,
    `packages/codex-ouronet/tests/adapter-master-key-locks-shard.test.ts`,
    `packages/codex-ui/tests/hooks.test.tsx`

## Wave 3 (depends on Wave 2)
- [x] T4: Enforce the invariant in the store and expose the primitives —
      `updateStoaChainSeed` rejects an update whose `accounts` no longer
      contains a locked position; `deleteStoaChainSeed` rejects a seed
      holding any lock; plus `addMasterKeyLocks(entries)` /
      `releaseMasterKeyLocks(predicate)` / `getMasterKeyLocks()` as the
      primitives "Secure Master Account" will later call.
      — done when: `tests/state-master-key-lock-enforcement.test.ts` proves,
      by calling the STORE DIRECTLY (never the UI): (a) dropping a locked
      position from `accounts` throws `CodexMasterKeyLockedError` and leaves
      the stored seed byte-identical; (b) deleting a seed holding a lock
      throws and deletes nothing; (c) an UNlocked position on the same seed
      still removes normally; (d) releasing the lock then allows both; (e) a
      position locked under two reasons stays locked when only one is
      released.
  - files: `packages/codex-ouronet/src/state/store.ts`,
    `packages/codex-ouronet/tests/state-master-key-lock-enforcement.test.ts`

## Explicitly NOT in this topic
- The "Secure Master Account" rescan action itself (topic 4) — this topic
  builds only the primitives it will call.
- Any UI. The existing cosmetic disable in `SeedWordsTab.tsx:353` is left
  exactly as it is; this topic makes the guarantee real underneath it.
- Locking ouro accounts or ArWeave seeds (they have their own flags).
