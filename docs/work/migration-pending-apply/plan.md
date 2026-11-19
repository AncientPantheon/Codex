# Migration Pending → Apply — Plan

Design: `docs/work/migration-pending-apply/design.md`.

**Scope narrowed by the owner for this pass:** add the Apply button, and make
sealing genuinely WORK for a pending state that needs **no** transactions. When
transactions ARE required, the system detects it and says so — execution is
wired later. Target: a working checkpoint to commit and cut a version from.

## Before you start

1. **`@testing-library/jest-dom` is declared but NEVER registered** in
   `packages/codex-ouronet/tests/setup.ts` — `toBeDisabled()` /
   `toHaveAttribute()` / `toBeInTheDocument()` throw `Invalid Chai property`,
   and inside `waitFor` that surfaces as an opaque *"Test timed out in
   5000ms"*. Use plain checks (`el.textContent`, `(el as
   HTMLButtonElement).disabled`, `screen.queryByTestId("x") === null`).
   `packages/codex-arweave/tests/setup.ts` DOES register it (line 11).
2. **Measured flake:** `tests/ui-legacy-prime-migration-wizard.test.tsx` fails
   ~10 tests with pure timeouts at the configured 5000ms on a loaded box, and
   passes fully at `--testTimeout=40000`. Always run that file with
   `--testTimeout=40000`; never classify a timeout as a regression without it.
3. Workspace packages are aliased to `src` in the vite configs — no rebuild
   needed between packages.

Baselines: `codex-core` typecheck clean; `codex-ouronet` **2072 passed**, 1
pre-existing unrelated failure (`tests/pact-signatures.test.ts`, Pact-codegen
drift guard); `codex-arweave` **71/71 files, 1083 passed, 1 skipped, 0 failed`.

Grounding facts already verified — do not re-derive, but do sanity-check:
- `MigrationProgress` — `packages/codex-core/src/codex/migrationProgress.ts:126-134`.
  `MigrationStage` (`:33`) already includes `"executing"` and `"done"`; both
  are **dead variants nobody writes**. `migrationResume.ts:70` already treats
  `stage === "done"` as "sealed, do not resume".
- `containsSuspectedSecret` (`migrationProgress.ts:174-194`) rejects any field
  name matching `/words|mnemonic|secret|private|bitstring|seedphrase/i` whose
  value is not a boolean. Test-enforced. Keep new field names clear of it.
- `completeMigration` (`store.ts:1825-1836`) DELETES the record (persists
  `null`, adapter removes the shard at `LocalStorageCodexAdapter.ts:200-207`).
  Called from `LegacyPrimeMigrationWizard.tsx:7152` on `"success"`.
- `stampPrimeAlignmentAligned` (`store.ts:2870-2874`) is the seal. Both
  `ensurePrimeSeedAccountPairingAndPromote` (`store.ts:2504-2510`) and
  `promoteSeedAndAccountToPrime` (`:2442-2447`) THROW once it is set.
- `computeOutstandingKeyChanges` (`packages/codex-ouronet/src/ui/internal/outstandingKeyChanges.ts`)
  returns `{ changes: PendingKeyChange[]; none: boolean }`; returns `NONE`
  when there is no progress, no master account, or no selection, and skips
  `update-keyset-recommended` / `update-keyset-custom` entirely (`:58-71`).
- The middle button is the step-2 card, `CodexIdPage.tsx:1040-1098`. Its
  "eligible" branch is a `<div role="status">` (`:1048-1055`), NOT a button.
  `step2Done = isEligible` (`:980`), `isEligible` comes solely from the
  injected `deps.checkArweaveRestoreEligibility()` (`:565-583`).
- Modal convention to copy: `backupWizardOpen` boolean + inline
  `CodexModalShell` on this very page (`CodexIdPage.tsx:586`, `:1163-1178`).

## Wave 1

- [ ] T1: The persisted pending/applied model and its store actions — done
      when: `MigrationProgress` carries a new optional `pending?:
      MigrationPendingPlan` and an `appliedAt?: string`, both exported from
      `packages/codex-core/src/index.ts`. `MigrationPendingPlan` records what
      the last completed Finalize decided and is deliberately
      secret-free: `{ readonly finalizedAt: string; readonly accountId: string;
      readonly seedId?: string; readonly arweaveSeedId?: string; readonly
      paymentPublicKey?: string; readonly guardPublicKeys?: readonly string[];
      readonly guardPred?: string }`. Add a unit-tested predicate
      `isMigrationSealed(progress): boolean` returning true iff `appliedAt` is
      set, and `hasMigrationPending(progress): boolean` returning true iff a
      `pending` plan exists and it is not sealed.
      Two new store actions in `packages/codex-ouronet/src/state/store.ts`,
      declared on the actions interface and persisted via the existing
      `saveAll(buildFullSnapshot(get()))` idiom:
      (a) `recordMigrationPending(plan: MigrationPendingPlan): Promise<void>` —
      REPLACES any previous `pending` wholesale (a new finalize is a new plan),
      preserves `selection`/`committed`/`execution`, sets `stage: "committing"`,
      and creates the record if absent. It must REFUSE (throw `CodexError`) when
      the migration is already sealed.
      (b) `sealMigration(): Promise<void>` — sets `appliedAt` to now and
      `stage: "done"`, AND performs the seal that used to happen at finalize by
      calling the same path `stampPrimeAlignmentAligned` uses so
      `primeAlignment` becomes `"aligned"`. Idempotent: a second call on an
      already-sealed migration returns without writing. It must REFUSE
      (throw `CodexError`) when there is no `pending` plan — you cannot seal
      nothing.
      Do NOT change `completeMigration`/`abandonMigration` semantics, and do
      NOT weaken the `primeAlignment === "aligned"` guards in
      `ensurePrimeSeedAccountPairingAndPromote` / `promoteSeedAndAccountToPrime`
      — those stay exactly as they are; they simply now trip at Apply rather
      than at Finalize.
      Tests (`packages/codex-core/tests/` for the types/predicates — find the
      existing `migrationProgress` spec and extend it; and
      `packages/codex-ouronet/tests/` for the actions — find the existing store
      spec covering `recordMigrationCommit`/`completeMigration` and extend
      that file): `containsSuspectedSecret` returns false for a fully-populated
      `MigrationPendingPlan` (the guarantee test must still pass);
      `recordMigrationPending` replaces a previous plan rather than merging and
      leaves `committed` intact; it throws once sealed; `sealMigration` sets
      `appliedAt`, `stage: "done"` and `primeAlignment: "aligned"`; a second
      `sealMigration` is a no-op rather than an error; `sealMigration` with no
      pending plan throws; `hasMigrationPending`/`isMigrationSealed` over all
      four combinations of pending/sealed.
  - files: `packages/codex-core/src/codex/migrationProgress.ts`,
    `packages/codex-core/src/index.ts`,
    `packages/codex-ouronet/src/state/store.ts`,
    `packages/codex-core/tests/` (existing migrationProgress spec),
    `packages/codex-ouronet/tests/` (existing store spec)

## Wave 2 (depends on Wave 1 — T2 and T3 both call T1's actions; disjoint files, run in parallel)

- [ ] T2: Finalize writes a pending plan and stops sealing — done when:
      `runFinalize` in
      `packages/codex-ouronet/src/ui/internal/LegacyPrimeMigrationWizard.tsx`
      (a) no longer calls `stampPrimeAlignmentAligned` (the seal moves to
      Apply) and no longer calls `completeMigration()` on the `"success"` path
      — the record IS the pending state and must survive;
      (b) at the end of a successful commit calls
      `actions.recordMigrationPending({...})` with the account id, the seed id,
      the arweave seed id, and the payment/guard public keys it just derived,
      sourced from the SAME values already passed to `recordMigrationCommit`
      (do not re-derive or re-scan — reuse what is in scope);
      (c) keeps every existing terminal status working, with the
      `"arweave-unavailable"` path still NOT writing a pending plan (an
      incomplete migration has nothing to apply);
      (d) keeps the existing five writes, their ordering, and their
      resume/`committed` recording exactly as they are.
      Because alignment is no longer stamped at finalize, a second run of the
      wizard must now succeed end-to-end: that is the behaviour to pin.
      Tests (`packages/codex-ouronet/tests/ui-legacy-prime-migration-wizard.test.tsx`,
      reusing `renderFinalizeWizard`, `driveToArweaveStepViaKeepCurrent`,
      `passArweaveStep`, `driveToFinalizeViaKeepCurrent`,
      `installMasterArweaveAccounts(For)`, `fakeArweaveDerivation`; assert
      against the STORE): a successful finalize leaves `migrationProgress`
      present with a `pending` plan naming the chosen account and the derived
      keys; it does NOT set `primeAlignment` to `"aligned"`; running the whole
      wizard a SECOND time succeeds and REPLACES the pending plan (this is the
      regression test for the dead-end the owner would have hit); the
      `"arweave-unavailable"` path writes no pending plan.
  - files: `packages/codex-ouronet/src/ui/internal/LegacyPrimeMigrationWizard.tsx`,
    `packages/codex-ouronet/tests/ui-legacy-prime-migration-wizard.test.tsx`

- [ ] T3: The Apply button, its popup, and the four-state middle button — done
      when: the step-2 card in `packages/codex-arweave/src/panel/CodexIdPage.tsx`
      renders four mutually exclusive states —
      (1) `!step2Enabled` → today's disabled button, unchanged;
      (2) no pending plan → today's gold "Make Codex Permaweb Eligible" button,
      unchanged;
      (3) a pending plan exists and is NOT sealed → a GREEN **button** reading
      "Retry the Eligibility Wizard" (`data-testid="arweave-codex-id-retry-eligibility"`)
      that opens the same wizard through the same `ensureCodexUnlocked` gate,
      PLUS an Apply button BENEATH it
      (`data-testid="arweave-codex-id-apply-migration"`);
      (4) sealed → a locked green "✓ Permaweb Eligible" status with NO
      launcher and NO Apply button.
      State (3)'s green must reuse the existing `DONE_STEP_STYLE` palette
      (`CodexIdPage.tsx:397-401`) so it reads as the same green, applied to a
      real `<button>`.
      Pending/sealed are read from the codex store via the page's existing
      store access (check how `CodexIdPage` already reaches the store before
      adding a new path) using T1's `hasMigrationPending`/`isMigrationSealed`.
      Clicking Apply opens a popup built with the page's OWN existing modal
      convention — a boolean `useState` plus an inline `CodexModalShell`,
      copying `backupWizardOpen` (`CodexIdPage.tsx:586`, `:1163-1178`) —
      with `dialogTestId="codex-apply-migration-modal"`. The popup:
      - computes outstanding transactions with the EXISTING
        `computeOutstandingKeyChanges` from
        `packages/codex-ouronet/src/ui/internal/outstandingKeyChanges.ts`
        (import it; do not reimplement, so the popup and
        `PendingKeyChangesSection` cannot disagree);
      - when there are NONE: states plainly that this pending state needs no
        on-chain transactions, and offers a working **Seal** button
        (`data-testid="codex-apply-migration-seal"`) that calls T1's
        `sealMigration()` and closes, after which the middle button is state
        (4). THIS PATH MUST GENUINELY WORK — it is the owner's target for this
        pass;
      - when there ARE outstanding changes: lists each one (kind, FROM → TO)
        and states that this pending state needs transactions to be executed,
        which are not wired yet. The Seal button is NOT offered on this path.
        Do not fake an execution;
      - renders the two guard kinds `update-keyset-recommended` /
        `update-keyset-custom` as explicitly "nothing executable" rather than
        omitting them silently (`computeOutstandingKeyChanges` skips them at
        `:58-71`), so a user who picked one is not shown an empty popup with no
        explanation.
      Tests (`packages/codex-arweave/tests/` — extend the existing
      `e4-panel-codex-id*.test.tsx` harness, which already renders the panel
      and mocks the wizard): no pending plan → gold "Make Codex Permaweb
      Eligible", no Apply button; pending + no outstanding changes → green
      "Retry the Eligibility Wizard" + Apply, and pressing Apply then Seal
      calls `sealMigration` and flips the card to the locked state; pending +
      outstanding changes → the popup lists them and offers NO seal button;
      sealed → locked green, no retry button, no Apply button; a pending plan
      whose guard choice is `update-keyset-custom` shows the explicit
      "nothing executable" note.
  - files: `packages/codex-arweave/src/panel/CodexIdPage.tsx`,
    `packages/codex-arweave/tests/e4-panel-codex-id.test.tsx`

## Design-criteria coverage

| design.md criterion | task |
|---|---|
| Finalize writes pending, does not seal; record survives | T2 |
| Re-running the wizard succeeds and replaces the pending state | T1 (replace semantics), T2 |
| Cancelling leaves the pending state untouched | T1 (`pending` separate from `selection`) |
| Green "Retry the Eligibility Wizard" + Apply beneath | T3 |
| Apply popup lists the transactions that would execute | T3 |
| No-transaction pending state still seals | T1 (`sealMigration`), T3 |
| Sealing locks the middle button permanently | T1 (`appliedAt`), T3 |
| `update-keyset-*` reported as nothing executable | T3 |

Deferred by the owner for this pass: actually executing the transactions
(T3 detects and reports instead).

## Wave 3 (owner addition, after live testing — depends on Waves 1-2)

- [ ] T4: The wizard ends with an explicit "Settle Choices" button, gated on
      all four ticker colours — done when: the commit is no longer fired as a
      side effect of a step transition. Owner: *"the wizard has to end with a
      finalize button 'Settle Choices'. This button must be clickable once all
      the squares are lit (there might be some moment where the squares are
      not lit, as readings are being done). Once all the squares are lit at the
      end, the user clicks Settle Choices, which is the finalize button, and
      clicking it is the final action that settles the selected choices."*
      Clarified by the owner: *"all squares lit, by this i mean, one blue one
      red one brown one pink, in the sense that we have all the colour lit"* —
      i.e. each ROLE lit somewhere on the dashboard, NOT every square on every
      card (roles legitimately split across cards).
  - files: `packages/codex-ouronet/src/ui/internal/LegacyPrimeMigrationWizard.tsx`,
    `packages/codex-ouronet/tests/ui-legacy-prime-migration-wizard.test.tsx`,
    `packages/codex-ouronet/tests/ui-wizard-stage-boundaries.test.tsx`
