## Wave 1
- [x] T1: Add the three new guard-choice kinds to `MigrationGuardSelection`
      (the persisted/resumable form) and prove the no-secrets guarantee and
      export/import round trip still hold for all three.
      — done when: `MigrationGuardSelection` is
      `{kind:"keep"} | {kind:"recommended-single-key"} | {kind:"custom";keys;pred}
      | {kind:"update-keyset-recommended"} | {kind:"update-keyset-custom";keys;pred}
      | {kind:"use-existing-keyset";ns;ksn;keys;pred}` (all fields
      `readonly`, matching the existing three); `npx vitest run
      tests/migration-progress.test.ts` passes including three new cases
      (one per new kind) each asserting: (a) `containsSuspectedSecret` is
      `false` over a `MigrationProgress` row carrying that selection, (b) a
      round trip through whatever codec/serialization the existing
      `"custom"` case is already proven through in that file produces an
      identical value back; `npx tsc --noEmit` in `packages/codex-core` is
      clean.
  - files: `packages/codex-core/src/codex/migrationProgress.ts`,
    `packages/codex-core/tests/migration-progress.test.ts`

## Wave 2 (depends on Wave 1)
- [x] T2: Mirror the three new kinds onto the wizard's own
      `LegacyPrimeMigrationGuardChoice` type (so the direct object-literal
      assignment in `recordSelectionIfComplete` — `guard: nextGuard` into a
      `MigrationSelection.guard: MigrationGuardSelection` field — keeps
      typechecking with no cast), and add the three new recommendation-tier
      badge components the design calls for, visually distinct from the
      existing `RecommendedBadge` (which stays unchanged, still used
      verbatim everywhere it already appears — the payment step's "derive"
      option and the derivation-method options).
      — done when: `LegacyPrimeMigrationGuardChoice`'s union literally
      matches T1's `MigrationGuardSelection` (same kinds, same fields);
      three new functions exist near the existing `RecommendedBadge`/
      `OptionNumberBadge` (around line 669 today) —
      `DalosHighlyRecommendedBadge()` rendering the text "DALOS Highly
      Recommended", `DalosRecommendedBadge()` rendering "DALOS
      Recommended", `NotRecommendedBadge()` rendering "Not Recommended" —
      each a `React.ReactElement` with no props, styled consistently with
      the existing badge (pill shape, uppercase, bordered) but visually
      distinguishable from it (e.g. a different accent weight for the
      Highly-Recommended tier vs the Recommended tier); `npx tsc --noEmit`
      in `packages/codex-ouronet` is clean (this alone proves the type
      mirror, since `recordSelectionIfComplete`'s assignment would fail to
      compile otherwise).
  - files: `packages/codex-ouronet/src/ui/internal/LegacyPrimeMigrationWizard.tsx`
- [x] T3: Extend `resolveMigrationResume`'s guard WARN-ONLY check (today
      gated on `guardChoice?.kind === "custom"`, `migrationResume.ts` lines
      ~110-124) to also run for `"update-keyset-custom"` and
      `"use-existing-keyset"` — both carry an explicit `keys` array that can
      go stale the same way `"custom"`'s can. `"update-keyset-recommended"`
      needs no new check (same treatment `"recommended-single-key"`
      already gets — none, because it names no codex-specific key list to
      go stale).
      — done when: the condition becomes
      `guardChoice?.kind === "custom" || guardChoice?.kind === "update-keyset-custom"
      || guardChoice?.kind === "use-existing-keyset"` (all three read
      `.keys` identically, so the body is unchanged); `npx vitest run
      tests/migration-resume-resolution.test.ts` passes including two new
      tests mirroring the existing "keeps a custom keyset whose key the
      codex no longer holds, and warns" / "says nothing when every custom
      key is still held" pair, one each for `"update-keyset-custom"` and
      `"use-existing-keyset"`; plus one new test per ALL THREE new kinds
      (including `"update-keyset-recommended"`, which needs no warn logic)
      proving a clean resume (nothing missing) restores
      `p.guardChoice` as exactly the recorded value, unchanged — mirrors
      the existing "restores both decisions and re-opens on the payment
      step" test's own assertion style for `guardChoice`.
  - files: `packages/codex-ouronet/src/ui/internal/migrationResume.ts`,
    `packages/codex-ouronet/tests/migration-resume-resolution.test.ts`
- [x] T4: Stop `computeOutstandingKeyChanges` from offering an action it
      cannot actually perform. Today it treats any non-`"keep"` guard
      selection as "apply via Rotate Guard" — correct for
      `"recommended-single-key"`/`"custom"`/`"use-existing-keyset"` (all
      three are real account-guard rotations `RotateGuardModal` already
      supports), but WRONG for `"update-keyset-recommended"`/
      `"update-keyset-custom"`: no code anywhere updates an existing
      namespace keyset's own on-chain definition (confirmed by research
      during design — see `docs/work/guard-step-variants/design.md`), so
      surfacing these as a pending "Rotate Guard" action would offer a
      button that performs the wrong operation. Also fixes a predicate bug
      the new kinds would otherwise hit: the `pred` computation
      (`outstandingKeyChanges.ts` line ~68) hardcodes `"keys-all"` for
      every non-`"custom"` kind, which is wrong for `"use-existing-keyset"`
      (the existing keyset's real predicate, resolved via `describeKeyset`
      at selection time — see T5 — is carried on the choice itself, not
      necessarily `keys-all"`).
      — done when: the guard branch excludes
      `"update-keyset-recommended"`/`"update-keyset-custom"` from
      `changes` entirely (no entry is pushed for either, regardless of
      `committed` state); `"use-existing-keyset"` still produces a
      `{kind:"guard", from, to, pred}` entry, with `pred` taken from
      `selection.guard.pred` (same as `"custom"` already does) instead of
      the hardcoded fallback; `npx vitest run
      tests/stage3a-outstanding-changes.test.ts` passes including three
      new cases: `"update-keyset-recommended"` and `"update-keyset-custom"`
      each produce `{changes: [], none: true}` regardless of `committed`
      contents, and `"use-existing-keyset"` produces an entry whose `pred`
      equals the choice's own `pred` (tested with a non-`"keys-all"`
      predicate to prove the fallback is really gone).
  - files: `packages/codex-ouronet/src/ui/internal/outstandingKeyChanges.ts`,
    `packages/codex-ouronet/tests/stage3a-outstanding-changes.test.ts`

## Wave 3 (depends on Wave 2)
- [x] T5: Rebuild `GuardSection`/`GuardStep` as variant-aware per
      `docs/work/guard-step-variants/design.md`'s "UI structure" section —
      Variant A (4 options) when `resolution.kind` is `"keyset-ref"` or
      `"keyset-ref-unresolved"`, Variant B (3 options) when `"keyset"` or
      `"none"`, today's existing fallback copy/options unchanged when
      `"unsupported"`/`"unknown"`. Build the new "use an existing keyset"
      input (Variant B option 3B): a plain text field for an `ns.ksn` name
      plus a resolve action that calls the `describeKeyset` prop (threaded
      back down to `GuardStep`/`GuardSection`, removed from both when
      `guardResolution` was lifted earlier this session — restore it as an
      explicit prop, NOT by re-adding the account-guard-resolving effect
      this step no longer owns) — mirrors the existing plain-`<input>`
      style already used elsewhere in this file (not the CodeMirror-based
      `GuardEntryInput` in `zbom/cfm/inputs.tsx`, deliberately avoided
      there for its bundle weight, per this file's own established
      precedent of lifting shared pieces out rather than importing it
      wholesale). A failed/unresolved `describeKeyset` call shows the same
      "could not be read — unknown, not empty" treatment
      `CurrentGuardBlock`'s existing `"keyset-ref-unresolved"` branch
      already renders; Continue stays blocked (reuse
      `continueBlockedReason`'s existing "guard" branch, extended with one
      more condition) until a real resolution lands. Extend `runFinalize`'s
      guard-lock computation (today: `custom` → its keys,
      `recommended-single-key` → the derived key #1, else `null`) with the
      three new kinds: `"update-keyset-recommended"` → the SAME derived
      key #1 single-element array `"recommended-single-key"` already
      produces (locks the intended key now, exactly like every other
      not-yet-executed choice already does per the design's locking
      principle); `"update-keyset-custom"` → its own `keys`;
      `"use-existing-keyset"` → its own `keys` (already resolved via
      `describeKeyset` before the choice became selectable, never
      re-resolved here).
      — done when: on an account whose `guardResolution.kind` is
      `"keyset-ref"` or `"keyset-ref-unresolved"`, the guard step renders
      exactly 4 options tagged (in order) Not Recommended / DALOS Highly
      Recommended / DALOS Recommended / Expert Mode, with option 4
      expanding a 3A/3B toggle (keep-ref-custom vs direct-custom); on an
      account whose `guardResolution.kind` is `"keyset"` or `"none"`, it
      renders exactly 3 options tagged DALOS Recommended / Not Recommended
      / Expert Mode, with its own 3A/3B toggle (direct-custom vs
      use-existing-keyset); on `"unsupported"`/`"unknown"`, rendering is
      byte-identical to before this task (proven by the EXISTING tests in
      `ui-step3-payment-and-guard.test.tsx` for those two shapes still
      passing unmodified); choosing "use an existing keyset", typing a
      real `ns.ksn`, and resolving it successfully enables Continue and
      records `{kind:"use-existing-keyset", ns, ksn, keys, pred}` with
      `keys`/`pred` exactly what the injected `describeKeyset` returned;
      choosing it with a `describeKeyset` that rejects shows the unresolved
      state and Continue stays blocked; `runFinalize` driven end-to-end
      (real store, `MemoryCodexAdapter`, mirroring
      `ui-legacy-prime-migration-wizard.test.tsx`'s existing finalize
      fixtures) with each of the three new guard kinds chosen produces a
      `master-guard-key` lock at the position holding the expected key, the
      same way the existing "choosing KEEP for both payment and guard
      still LOCKS the actual current keys" test already proves for
      `"keep"`; full `codex-ouronet` suite passes (`npx vitest run`, 0 new
      failures beyond the one pre-existing pact-signature drift already
      present before this topic); `npx tsc --noEmit` in
      `packages/codex-ouronet` is clean.
  - files: `packages/codex-ouronet/src/ui/internal/LegacyPrimeMigrationWizard.tsx`,
    `packages/codex-ouronet/tests/ui-step3-payment-and-guard.test.tsx`,
    `packages/codex-ouronet/tests/ui-legacy-prime-migration-wizard.test.tsx`
