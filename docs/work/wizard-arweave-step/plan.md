# Wizard Arweave Step — Plan

Design: `docs/work/wizard-arweave-step/design.md`. Builds on
`docs/work/arweave-master-accounts/` (the predicate and the generator already
exist — this topic makes them visible and binding).

## Before you start

1. **`@testing-library/jest-dom` is declared but never registered** in
   `packages/codex-ouronet/tests/setup.ts` — `toBeDisabled()` /
   `toHaveAttribute()` / `toBeInTheDocument()` throw `Invalid Chai property`,
   and inside `waitFor` that surfaces as an opaque *"Test timed out in
   5000ms"*. Use plain checks: `el.textContent`,
   `(el as HTMLButtonElement).disabled`, `screen.queryByTestId("x") === null`.
2. vitest `testTimeout` is 5000ms vs setup.ts's `asyncUtilTimeout: 15000` —
   re-run a RED with `--testTimeout=40000` to see the real error.

Baselines: `codex-ouronet` **2042/2043** (the one failure is the pre-existing
unrelated `tests/pact-signatures.test.ts` Pact-codegen drift guard);
`codex-arweave` **1060 passed, 0 failed, 1 skipped, 70/70 files**.

Already built, reuse as-is:
- `codexHoldsMasterArweaveAccounts({ masterBitString, arweaveSeeds, foreignKeys, password, smartDecrypt })`
  → `{ ok, seedId, missingIndexes }` in
  `packages/codex-ouronet/src/ui/internal/seedDashboard.ts`. Matches a seed by
  decrypted bitstring (NOT `isPrime`); keys with a different/absent `seedId`
  do not count; never throws; `{ok:false, seedId:null, missingIndexes:[0,1]}`
  for a null/empty bitstring or null password.
- `ensurePrimeArweaveSeed(words, opts?)` — the wizard's existing optional prop,
  `opts` = `{ missingIndexes?, onProgress? }`. **Partial delivery RESOLVES**;
  only a zero-key run rejects. So always re-evaluate the predicate after.
- `runFinalize`'s existing pre-check / derive / re-check block (search
  `heldBeforeDerivation`) — the model for calling both together.

Step tables to extend (all in `LegacyPrimeMigrationWizard.tsx`):
`LegacyPrimeMigrationWizardStep` (~line 276), `STEP_LABELS` (~480),
`STEP_DISPLAY_NUMBER` (~497), `STEP_ORDER` (~517).

## Wave 1

- [x] T1: Add the `"arweave"` step and its screen, gated on the predicate —
      done when: `"arweave"` exists in `LegacyPrimeMigrationWizardStep`
      between `"review"` and `"finalize"`, with `STEP_ORDER` renumbering
      `finalize` to 6, `STEP_LABELS.arweave = "Arweave Accounts"`, and
      `STEP_DISPLAY_NUMBER.arweave = "5"` (review stays `"4"`); the modal
      subtitle reads "of 5" rather than "of 4" for every numbered step (find
      the subtitle computation — it currently hardcodes the total).
      The step renders `data-testid="legacy-prime-migration-arweave-step"`
      containing three separately-testid'd check rows —
      `…-arweave-check-seed`, `…-arweave-check-key0`, `…-arweave-check-key1` —
      each showing satisfied/missing from one `codexHoldsMasterArweaveAccounts`
      evaluation (seed row satisfied when `seedId !== null`; key rows from
      `missingIndexes`). When `ok` is false it also renders a
      `…-arweave-generate` button; when `ok` is true it renders no button and
      states that nothing needs doing.
      Continue out of this step is BLOCKED while `ok` is false, via
      `continueBlockedReason()`'s existing mechanism, with a reason naming
      what is missing (no matching seed / account #0 / account #1).
      Evaluate the predicate with `arweaveSeeds`/`foreignKeys` read FRESH from
      `codexStore.getState()` (not render-closure snapshots — the step must
      see writes Generate just made), the master bitstring from the same
      source `runFinalize` uses (search `resolved.bitString` /
      `resolveFinalizeDerivation`; the step needs the chosen account's
      bitstring, so factor out or reuse that resolution rather than
      duplicating its decrypt), and the password via the `actions.getPassword()`
      in-try/catch idiom used elsewhere in this file.
      Tests (`packages/codex-ouronet/tests/ui-legacy-prime-migration-wizard.test.tsx`,
      reusing its existing harness — `driveToFinalizeViaKeepCurrent` and the
      `installMasterArweaveAccounts` / `fakeArweaveDerivation` helpers added by
      `arweave-master-accounts` T3): a codex already holding a matching seed
      with #0 and #1 shows all three rows satisfied, renders NO generate
      button, and Continue is enabled; a codex with no Arweave seed shows all
      three missing and Continue is disabled with a reason naming the missing
      seed; a codex holding a matching seed with only #0 shows the seed and #0
      satisfied and #1 missing; reaching Finalize is impossible while `ok` is
      false (Continue click does not advance the step).
  - files: `packages/codex-ouronet/src/ui/internal/LegacyPrimeMigrationWizard.tsx`,
    `packages/codex-ouronet/tests/ui-legacy-prime-migration-wizard.test.tsx`

## Wave 2 (depends on Wave 1 — T2 adds the action to T1's screen)

- [x] T2: Wire Generate to the existing generator, with progress, and re-check
      after — done when: pressing `…-arweave-generate` calls
      `ensurePrimeArweaveSeed({ bitString, words }, { missingIndexes, onProgress })`
      with the `missingIndexes` from the step's own current evaluation; while
      it runs the button is disabled and
      `data-testid="legacy-prime-migration-arweave-progress"` reports which
      position is being derived and how many are done, driven ONLY by
      `onProgress` (no timers, no synthetic percentages); when it settles the
      progress line disappears and the predicate is RE-EVALUATED, updating the
      three check rows and unblocking Continue only if `ok` is now true.
      A rejection, or a resolve that leaves `ok` false (partial delivery
      resolves — see the note above), shows an error naming what is still
      missing and leaves Continue blocked. An absent `ensurePrimeArweaveSeed`
      prop disables Generate with a stated reason rather than throwing.
      ALSO IN SCOPE (added after T1 reported it): a LOCKED codex — or one whose
      held password decrypts nothing — currently DEAD-ENDS on this step: the
      check cannot run, Continue is blocked, and the only way out is closing
      the wizard. The step must render the existing `InlineUnlockPrompt`
      (`packages/codex-ouronet/src/ui/internal/InlineUnlockPrompt.tsx`, already
      used by Finalize and the account step) in that case, and on a correct
      password re-run the check and proceed — authenticating ONLY when the
      codex was genuinely locked (snapshot `passwordCache.expiresAt > Date.now()`
      BEFORE authenticating; the unlock window is deliberately absolute, never
      sliding — see `src/zbom/hooks/useEnsureCodexUnlocked.ts`). Generate needs
      that password too, so both share one unlock path. T1's honest distinction
      between "these checks could not be run" and "the accounts are missing"
      must survive — a locked codex must never read as "missing".
      Tests (same file): generate on a codex missing both calls the prop with
      `missingIndexes: [0, 1]` and, once the stub performs the real writes,
      flips all three rows to satisfied and enables Continue; generate on a
      codex missing only #1 passes `missingIndexes: [1]`; a stub that resolves
      WITHOUT writing leaves Continue blocked and shows the error (the exact
      "resolved ≠ done" trap); progress text appears while in flight and is
      gone after.
  - files: `packages/codex-ouronet/src/ui/internal/LegacyPrimeMigrationWizard.tsx`,
    `packages/codex-ouronet/tests/ui-legacy-prime-migration-wizard.test.tsx`

## Wave 3 (depends on Wave 2 — same file as T1/T2, so it runs after them, not beside them)

- [x] T3: Rewire the violet ticker onto the same predicate — done when: the
      Settling Dashboard's Arweave ticker is driven by
      `codexHoldsMasterArweaveAccounts` instead of `resolveArweaveMatchSeedId`
      (the call at `LegacyPrimeMigrationWizard.tsx:5383`), so the square is lit
      if and only if the codex holds #0 AND #1 under the seed matching the
      Codex Master Seed. The existing request-id guard on that effect is kept
      exactly as-is (a superseded resolution must still be discarded), as is
      its `try/catch → password = null` degradation (a locked codex leaves the
      square dark, never prompts). `resolveArweaveMatchSeedId` is NOT deleted —
      other callers exist (grep before touching it); it merely stops driving
      this ticker.
      Which CARD the square lights on is unchanged: the seed id the predicate
      returns is matched against the dashboard's cards exactly as the previous
      seed id was.
      Tests (`packages/codex-ouronet/tests/ui-seed-dashboard.test.tsx`): a
      codex whose Arweave seed matches the master seed but holds NO accounts
      leaves the violet ticker DARK (this is the reported bug — the old
      function lit it on the seed alone); the same codex with #0 and #1
      present lights it; a locked codex leaves it dark without rendering any
      prompt (the existing silent-degradation pin must still pass).
  - files: `packages/codex-ouronet/src/ui/internal/LegacyPrimeMigrationWizard.tsx`,
    `packages/codex-ouronet/tests/ui-seed-dashboard.test.tsx`

## Design-criteria coverage

| design.md criterion | task |
|---|---|
| Step exists between Review and Finalize, numbered 5, subtitle "of 5" | T1 |
| Already-complete codex: all satisfied, nothing written, Continue enabled | T1 |
| No Arweave seed: all missing, Continue blocked until Generate completes | T1, T2 |
| Non-matching seed: says so, Generate adds a matching one, old survives | T1, T2 |
| Matching seed with only #0: Generate derives only #1 | T1, T2 |
| Per-key progress from worker events | T2 |
| Violet square lit iff #0 and #1 held under the master seed | T3 |
| Finalize unreachable while unsatisfied | T1 |
