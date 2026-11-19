# Complete the Commit Stage (everything but the transactions) — Plan

Owner: *"lets wire everything in except for the transactions … i need to make
sure the parts prior to it are all correct. The gathering of data and setup
of what the user chooses in the wizard."*

## The defect this fixes

`runFinalize` bails on `sweepNeeded` BEFORE the local writes:

```
pair + promote                      ✓ runs
if (sweepNeeded) { ...; return; }   ← bails
setCodexMasterSeed(...)             ✗ unreachable
secureMasterAccount(...)            ✗ unreachable
stampPrimeAlignmentAligned()        ✗ unreachable
```

`sweepNeeded` is hardcoded `true`, so **the Codex Master Seed row and the
master-key locks are never written** — every local thing topics 2-4 built is
dead in practice. The same bail also sits before the ArWeave step, so an
unavailable ArWeave seed silently prevents the row and locks too.

## The correct split

A sweep is STAGE 3. Nothing in stage 2 depends on it, so nothing in stage 2
should wait for it. Only ONE thing legitimately does: the alignment stamp,
because a codex whose funds are not yet under the new keys is not actually
eligible — stamping it would be a lie.

```
1. pair + promote                  ALWAYS
2. Codex Master Seed row           ALWAYS   (ouronet + chainweb faces)
3. master-key locks                ALWAYS
4. ArWeave seed, if available      -> merges the third face into the row
5. alignment stamp                 ONLY when nothing is outstanding
6. clear the row                   ONLY when aligned
```

The `migrationProgress` row therefore SURVIVES a stage-2 commit that ends
with transactions outstanding — that is precisely the state stage 3 resumes
from, and clearing it would lose the record of what was chosen.

## Wave 1
- [x] T1: Reorder `runFinalize` so every local write lands regardless of the
      sweep, with alignment and row-clearing gated on nothing being
      outstanding. New terminal state `"committed-pending-transactions"`
      distinguishing "your choices are written, money still has to move"
      from today's dead end.
      — done when: `tests/ui-migration-commit-order.test.tsx` proves the row
      and locks ARE written when `sweepNeeded: true`, that alignment is NOT
      stamped, that `migrationProgress` survives, and that the full success
      path still stamps and clears.
  - files: `packages/codex-ouronet/src/ui/internal/LegacyPrimeMigrationWizard.tsx`,
    `packages/codex-ouronet/tests/ui-migration-commit-order.test.tsx`

## Wave 2 (depends on Wave 1)
- [x] T2: A REVIEW step between stage 1 and stage 2 — everything chosen, on
      one screen, before anything is written: which account becomes master,
      the payment key FROM -> TO, the guard before -> after, and which seed +
      positions become non-removable as a result. Commit is explicit from
      here; Continue on step 3 no longer writes.
      — done when: `tests/ui-migration-review-step.test.tsx` proves the review
      names all four facts from the real choices, and that reaching it has
      written nothing to the codex.
  - files: same wizard,
    `packages/codex-ouronet/tests/ui-migration-review-step.test.tsx`
- [x] T3: A stage-2 RESULT screen listing what was written and what remains,
      naming the outstanding transactions as stage 3 rather than as failure.
      — done when: the commit-order suite asserts the result screen lists
      each completed write and states what is still outstanding.
  - files: same wizard + same suite

## NOT in this topic
- Stage 3's transactions themselves (blocked on the owner's resumability
  decision).
