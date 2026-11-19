# Wizard Resume — Plan

Topic 3 of `docs/work/migration-three-stages/design.md`.

Owner: *"if stage one was already done and the wizard wasnt finalised, we
need to be able to resume from where we were, showing the user what he
chose."*

## Shape

The resolution is a PURE function — recorded row + the codex's current
entities in, a plan out. The staleness rules are the part that can be subtly
wrong, so they are testable without mounting anything.

```
resolveMigrationResume(progress, { accounts, seeds }) -> {
  resumable, step, accountChoice, paymentChoice, guardChoice,
  startedAt, notices[]
}
```

## Staleness: demote vs warn

A recorded id can point at something since deleted or renamed. The two cases
are NOT the same and must not be treated alike:

- **DEMOTE** when the recorded choice becomes meaningless. An `existing`
  account that no longer exists cannot be promoted to master, so that
  decision returns to unchosen with a notice saying why.
- **WARN ONLY** when the choice is still valid but less useful. A `custom`
  guard key the codex no longer holds is still a perfectly good public key
  to guard with — it simply cannot be LOCKED, which `secureMasterAccount`
  already reports as `unmatchedKeys`. Demoting it would discard a real
  decision over a non-problem.

A `new-words` run is never resumable: its words were deliberately never
stored, so there is nothing to resume onto. It returns `resumable: false`
with a notice telling the user to re-enter them.

## Wave 1
- [x] T1: `resolveMigrationResume` — pure, with the demote/warn split above.
      — done when: `tests/migration-resume-resolution.test.ts` covers a clean
      resume, a deleted `existing` account (demoted, with a notice), a
      renamed seed (resumes, since the id still resolves), a custom guard key
      the codex no longer holds (kept + warned, NOT demoted), a `new-words`
      run (not resumable), and an absent row (nothing to resume).
  - files: `packages/codex-ouronet/src/ui/internal/migrationResume.ts`,
    `packages/codex-ouronet/tests/migration-resume-resolution.test.ts`

## Wave 2 (depends on Wave 1)
- [x] T2: Wire it into the wizard — on open with a recorded run, jump to the
      recorded stage with the choices pre-selected, and show a banner naming
      the run as RESUMED and when it started, plus any notices. Offer an
      explicit "start over" that abandons the row.
      — done when: `tests/ui-wizard-resume.test.tsx` proves a recorded run
      re-opens on step 3 with both choices already selected, that the banner
      names it as resumed, that a demoted choice is reported and blocks
      Continue until re-made, and that "start over" clears the row.
  - files: `packages/codex-ouronet/src/ui/internal/LegacyPrimeMigrationWizard.tsx`,
    `packages/codex-ouronet/tests/ui-wizard-resume.test.tsx`
