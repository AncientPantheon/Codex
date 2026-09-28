## Wave 1
- [x] T1: Install `@ouronet/talos-registry@2.2.0`, verify `surfaceHash`. — done when: `node_modules/@ouronet/talos-registry/package.json` reports `2.2.0`; `surfaceHash` (imported live) equals `8107265a0be6edc3`.
  - files: `packages/codex-ouronet/package.json` (unchanged — `^2.1.0` already permits 2.2.0), `packages/codex/package.json` (same), lockfile.
- [x] T2: Fix the gas-sponsorship retraction in `LocalStopgapCard`'s footer. — done when: the footer text ends with "Gas is still sponsored.", matching `ModelCard`'s own stoa-kind footer; a test asserts it.
  - files: `packages/codex-ouronet/src/zbom/cfm/PreZbomHint.tsx`, `packages/codex-ouronet/tests/zbom-prezbom-hint.test.tsx`
- [x] T3: Implement rule 8 — classify a live-read refusal before rendering it. — done when: `classifyRefusal(message)` returns a friendly message for `/no value found in table .+ for key/i`, raw text otherwise; the friendly case renders in a non-red (grey/amber) style, the raw case stays red; two tests cover both branches.
  - files: `packages/codex-ouronet/src/zbom/cfm/PreZbomHint.tsx`, `packages/codex-ouronet/tests/zbom-prezbom-hint.test.tsx`

## Wave 2 (depends on Wave 1's registry install, independent of T2/T3)
- [x] T4: Build the shared fill map (`ouronetAccountFillValues`, `resolvePatronFillValue`). — done when: both functions exist with the exact behavior described in design.md; unit tests cover the alias set, the resident/prime/custom branching, and the "no silent fallback to self" guarantee.
  - files: `packages/codex-ouronet/src/zbom/cfm/preZbomFillMap.ts` (new), `packages/codex-ouronet/tests/zbom-prezbom-fill-map.test.ts` (new)

## Wave 3 (depends on Wave 2)
- [x] T5: Wire the fill map into all 8 `OuronetAccountsTab.tsx` launchers. — done when: every one of `C_RotateStoa`/`C_RotateGuard`/`C_ReleaseStoicTag`/`C_RegisterStoicTag`/`C_RotateSovereign`/`C_RotateGovernor`/`C_DeploySmartAccount`/`C_DeployStandardAccount`/`DEPLOY_API_KEY_KEY` passes `patron`+`executor` (or `executor` alone where no `patron` slot exists) via the shared helper; the old `values={{ account: account.address }}` pattern is gone from the file; `unfilledFillable` is empty for all of them (proven in T4's test file against the real entrypoint keys).
  - files: `packages/codex-ouronet/src/ui/tabs/OuronetAccountsTab.tsx`
- [x] T6: Wire the fill map into `SingleApiPanel.tsx`'s Link launcher and `DualApiPanel.tsx`'s Rename/Revoke launchers. — done when: `LINK_DUAL_API_KEY_KEY` fills `executor` via the already-computed `stdOwner` (only when a Standard half is selected); `RENAME_DUAL_LANE_KEY`/`REVOKE_DUAL_LINK_KEY` fill `patron`+`executor` via the pair's Standard-half owner-account; `unfilledFillable` is empty for all three (proven in T4's test file).
  - files: `packages/codex-ouronet/src/ui/tabs/SingleApiPanel.tsx`, `packages/codex-ouronet/src/ui/tabs/DualApiPanel.tsx`
- [x] T7: Verify the two "still open in your build" canon items against the real, current code rather than trusting the claim. — done when: `shorten()`'s elision behavior and its `title`-carries-full-value usage are read directly and confirmed already correct; `tests/zbom-execute-button-no-tooltip.test.ts` is read directly and confirmed already a genuine whole-`src`-tree guard (not a single-file check); both findings are recorded in design.md rather than silently assumed.
  - files: none (verification only, already complete — see design.md's own "still open" section)

## Wave 4 (depends on Wave 3)
- [x] T8: Full-suite verification pass. — done when: `npx tsc -b packages/codex-ouronet --force` and the full `npx vitest run` (whole package) are both green.
  - files: none (verification only).
