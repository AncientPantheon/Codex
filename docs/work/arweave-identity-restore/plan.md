# ArWeave Identity Restore — Plan

Topic 6 of `docs/work/codex-master-seed-model/design.md`. The least-ready
topic, and this plan says so rather than pretending otherwise.

## Measured state (verified this session, not recalled)

**Already built and working:** the dual-source envelope. Every backup wraps
its IDEK and EDEK under BOTH the Master Seed bitstring and the Codex Stoic
Identity's Standard-Apollo bitstring, and posts four
`Codex-Backup-{IDEK,EDEK}-{MasterSeed,StandardApollo}-Default` tags.
`restoreCodexFromBackupEnvelope({ source, bitstring, … })` exists and is
unit-tested, with `BackupUnlockSource = "masterSeed" | "standardApollo"`.

**Three measured gaps:**

1. `restoreCodexFromBackupEnvelope` is **unreachable** — defined at
   `library/flow.ts:1695`, exported from no barrel, called by nothing.
2. The identity can **decrypt but not locate**. Finding a backup means
   querying ArWeave by owner address, which derives only from the Master
   Seed's ArWeave account at index 0.
3. **No backup records which codex it belongs to.** `deriveBackupLineage`
   sets `Codex-App-Id` from `codexIdentity.formatted`, but
   `buildBackupPayload` emits 14 fields and `codexIdentity` is not one of
   them (a deliberate privacy decision, `codec.ts:173-177`). The tag is
   therefore never written.

## What this topic does — and deliberately does not

Gap 1 is a plain omission with one correct answer, so it gets fixed.
Gap 2 needs an on-chain index, which is a feature, not a wiring fix.
Gap 3 is **blocked on an owner decision**, not on effort: putting any
identity-derived identifier on an ArWeave tag makes it PUBLIC and LINKABLE —
anyone who knows a codex's Stoic Identity could enumerate its backups. That
is the inherent cost of an index, and it is the owner's call to pay it, not
mine to assume. See "Decision required" below.

So this topic makes the reachable part reachable and pins the rest as
verified facts, so no future change can half-fix it silently.

## Wave 1
- [x] T1: Export `restoreCodexFromBackupEnvelope`, `BackupUnlockSource`,
      `BackupPinRequiredError`, `BackupSourceNotUsedError` and
      `determineBackupSourceRouting` from the library barrel and the package
      index, so a restore flow can be built on them at all.
      — done when: `tests/arweave-identity-restore-surface.test.ts` imports
      each through the public entry point and `tsc --noEmit` passes.
  - files: `packages/codex-arweave/src/library/index.ts`,
    `packages/codex-arweave/src/index.ts`,
    `packages/codex-arweave/tests/arweave-identity-restore-surface.test.ts`
- [x] T2: Pin the two remaining gaps as executable facts: that the export
      payload carries no `codexIdentity` (so `Codex-App-Id` is never
      written), and that `BackupUnlockSource` has exactly the two members.
      Each test states what would have to change for it to flip, so the
      gap is documented where it is enforced.
      — done when: the tests pass and fail loudly if either fact changes.
  - files: `packages/codex-arweave/tests/arweave-identity-restore-surface.test.ts`

## Decision required from the owner (blocks any further work)

To restore **via the Codex Stoic Identity alone**, a backup must be findable
by that identity. Three ways, with their costs:

- **(A) A public ArWeave tag** carrying an identity-derived fingerprint.
  Cheapest. Makes backups publicly linkable to an identity by anyone.
- **(B) An on-chain index** on StoaChain mapping identity → backup
  locations. The option the earlier design already deferred. More work;
  the link is still public, but it is deliberate and revocable.
- **(C) Leave it.** The identity stays an UNLOCK key, never a lookup key —
  you always locate a backup with the Master Seed, and the identity is a
  second way to open it. No privacy cost, and path 2 stays "optional"
  exactly as the informatics now describes it.

Until this is answered, the informatics text stays accurate as written: the
identity can unlock a backup you already have, not find one.
