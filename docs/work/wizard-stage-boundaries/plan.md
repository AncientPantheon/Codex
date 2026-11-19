# Wizard Stage Boundaries — Plan

Topic 2 of `docs/work/migration-three-stages/design.md`.

## An ambiguity in the design, resolved here

The design says both *"abandoning stage 1 writes nothing to the codex"* and
*"closing the wizard after choosing … restores the recorded choices"*. Those
conflict unless the write moment is pinned. It is pinned here:

**The selection is recorded the moment it is COMPLETE** — account, payment
and guard all chosen — and not before. So:

- abandoning a *partial* stage 1 writes nothing, as the design requires;
- abandoning a *finished* stage 1 resumes with the choices shown, which is
  what the owner asked for (*"if stage one was already done and the wizard
  wasnt finalised"*).

Writes are equality-gated, so re-rendering or re-picking the same option
does not churn the codex.

## Stage 2 ordering, and why

Stage 2 performs four writes. `alignmentStamped` is **last**, deliberately:
a codex must never read as eligible on a partial commit. Each is recorded in
`committed` as it lands so a resumed commit skips it instead of redoing it.

1. pair + promote the seed      -> `committed.seedId` / `.accountId`
2. write the Codex Master Seed row -> `committed.rowWritten`
3. write the master-key locks    -> `committed.locksWritten`
4. stamp alignment               -> `committed.alignmentStamped`

## Wave 1
- [x] T1: Store actions for the row — `recordMigrationSelection(selection)`
      (upsert, stage `"selection"`, equality-gated), `beginMigrationCommit()`,
      `recordMigrationCommit(patch)` (merges into `committed`),
      `completeMigration()` and `abandonMigration()` (both clear the row).
      — done when: `tests/state-migration-progress.test.ts` proves, by
      calling the STORE directly: the selection round-trips; an identical
      re-record does not touch the adapter; commit patches merge rather than
      replace; and both terminal actions clear the row so a finished codex
      never offers to resume.
  - files: `packages/codex-ouronet/src/state/store.ts`,
    `packages/codex-ouronet/tests/state-migration-progress.test.ts`

## Wave 2 (depends on Wave 1)
- [x] T2: Wire the boundaries into the wizard — stage 1 records its selection
      on completion and otherwise writes nothing; the former `finalize` step
      becomes an explicit stage-2 COMMIT that performs the four writes in the
      order above, recording each, and stamping alignment last.
      — done when: `tests/ui-wizard-stage-boundaries.test.tsx` proves that
      abandoning a partial stage 1 leaves `migrationProgress` undefined, that
      a completed stage 1 records it, and that a commit records each write in
      order with alignment last.
  - files: `packages/codex-ouronet/src/ui/internal/LegacyPrimeMigrationWizard.tsx`,
    `packages/codex-ouronet/tests/ui-wizard-stage-boundaries.test.tsx`

## NOT in this topic
- Restoring the UI from a recorded run (topic 3).
- Stage 3's transactions (topic 4, blocked on the resumability decision).
