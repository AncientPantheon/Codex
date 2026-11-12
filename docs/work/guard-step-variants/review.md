# guard-step-variants — Review

Scope: the plan.md's `- files:` union across T1-T5 (all ticked, no struck tasks):
- `packages/codex-ouronet/src/ui/internal/LegacyPrimeMigrationWizard.tsx`
- `packages/codex-core/src/codex/migrationProgress.ts`
- `packages/codex-ouronet/src/ui/internal/migrationResume.ts`
- `packages/codex-ouronet/src/ui/internal/outstandingKeyChanges.ts`
- `packages/codex-core/tests/migration-progress.test.ts`
- `packages/codex-ouronet/tests/migration-resume-resolution.test.ts`
- `packages/codex-ouronet/tests/stage3a-outstanding-changes.test.ts`
- `packages/codex-ouronet/tests/ui-step3-payment-and-guard.test.tsx`
- `packages/codex-ouronet/tests/ui-legacy-prime-migration-wizard.test.tsx`
- `packages/codex-ouronet/tests/ui-migration-review-step.test.tsx`

Lenses: correctness, conventions, tests, security (10 files, 4-15 tier; security included because the diff is guard/key authorization selection and locking logic).

6 rounds were required — each of rounds 1-5 found genuine, confirmed defects (concentrated in the new `ExistingKeysetPicker` / "use an existing keyset" feature); round 6 came back clean. Every CONFIRMED in-scope finding below was fixed with a dedicated test proven red-before/green-after via a temporary revert.

## Findings fixed, by round

### Round 1

#### [MEDIUM] Re-clicking an already-selected "custom guard" option/tab silently wipes chosen keys
- **File:** `LegacyPrimeMigrationWizard.tsx` — `GuardVariantA`/`GuardVariantB` header buttons and `SubChoiceToggle`
- **Verdict:** CONFIRMED. **Outcome:** fixed — header `onClick`/tab `onSelect` now no-op when the target is already active.

#### [MEDIUM] `ExpertModeBadge` duplicates `NotRecommendedBadge`'s style verbatim
- **Verdict:** CONFIRMED. **Outcome:** fixed — both (and two further stray inline copies) now share one `MutedPillBadge({children})` component.

#### [LOW] Two more inline copies of the muted-pill style, one with a casing drift
- **Verdict:** CONFIRMED. **Outcome:** fixed in the same `MutedPillBadge` consolidation.

#### [MEDIUM] `ReviewStep`'s branches for the three newest guard kinds had zero test coverage
- **Verdict:** CONFIRMED. **Outcome:** fixed — `reachReview()` extended with `update-keyset-recommended`/`update-keyset-custom`/`use-existing-keyset`, three new tests added to `ui-migration-review-step.test.tsx`.

#### [CRITICAL] Guard "keep" resolves/locks the wrong account's keys when Page 2's "choose an existing account" is used
- **Verdict:** CONFIRMED — **PRE-EXISTING**, predates this topic (`guardResolution`/`currentGuardForResolution` always derived from `currentPrimeAccount`, never from the Page-2-chosen account). **Outcome:** NOT fixed here — reported to the user, deferred.

### Round 2

#### [HIGH] The "unsupported"/"unknown" fallback's own "Define a custom keyset" header had the same re-click-wipe bug, left unpatched
- **Verdict:** CONFIRMED. **Outcome:** fixed — same no-op guard applied to the fallback branch (no rendering-output change, confirmed consistent with the design's byte-identical-fallback requirement).

### Round 3

#### [LOW] Inconsistent one-line vs. multi-line arrow-function formatting across three identical guards
- **Verdict:** CONFIRMED. **Outcome:** fixed — reformatted to match.

#### [HIGH] "Use an existing keyset" could unblock Continue with a zero-key resolved keyset
- **Verdict:** CONFIRMED. **Outcome:** fixed — `resolve()` refuses a zero-key result (`status: "empty"`), plus a defensive `continueBlockedReason` backstop.

#### [HIGH] A stale, previously-resolved keyset could stay locked after editing ns/ksn without re-resolving
- **Verdict:** CONFIRMED. **Outcome:** fixed — `onInvalidate` callback resets the choice the instant typed ns/ksn diverges from what was resolved; the "Resolved" block now also shows `ns.ksn` and hides once stale.

### Round 4

#### [HIGH] Switching from "custom" to "use an existing keyset" sub-tab didn't reset the choice
- **Verdict:** CONFIRMED. **Outcome:** fixed — `SubChoiceToggle`'s `onSelect` now resets on both branches, symmetric with `GuardVariantA`.

#### [MEDIUM] The "does ns/ksn match resolved" comparison was written three separate times
- **Verdict:** CONFIRMED. **Outcome:** fixed — consolidated into one `matchesResolved` helper.

#### [HIGH] A `describeKeyset` call could land after ns/ksn changed again and silently commit stale data
- **Verdict:** CONFIRMED. **Outcome:** fixed — a `requestIdRef` token, bumped on every edit and every `resolve()` call, discards superseded responses.

#### [LOW] A failed re-resolve left the stale "Resolved" block showing alongside the new error
- **Verdict:** CONFIRMED. **Outcome:** fixed — the "Resolved" block's visibility now also excludes `status === "error"`.

### Round 5

#### [HIGH] The Resolve button got stuck on "Resolving…" forever after a discarded response
- **Verdict:** CONFIRMED. **Outcome:** fixed — `status` is now reset to `"idle"` immediately on every edit (not inside the discard branch, which could otherwise stomp on a newer in-flight request's own status).

#### [HIGH] Re-resolving an already-successful keyset to a now-empty result left the stale non-empty success state committed
- **Verdict:** CONFIRMED. **Outcome:** fixed — the zero-key branch now calls `onInvalidate()` whenever a prior resolution exists.

#### [LOW] `PaymentStep`'s inline "Not Recommended" badge didn't reuse the existing wrapper
- **Verdict:** CONFIRMED. **Outcome:** fixed.

#### [MEDIUM] Incomplete guard selections (zero-key custom/existing) are persisted as if complete
- **Verdict:** CONFIRMED — root cause (`recordSelectionIfComplete`'s null-only completeness check) is **PRE-EXISTING** (already applied identically to the original "custom" kind before this topic). **Outcome:** NOT fixed here — reported, deferred.

#### [MEDIUM] Guard-key preview JSX (ready/loading/error) duplicated three times
- **Verdict:** CONFIRMED. **Outcome:** fixed — lifted to a module-scope `GuardKeyPreviewBlock({preview})`, confirmed byte-identical output at all three call sites (including the fallback, which must stay byte-identical per design.md).

#### [MEDIUM] "use-existing-keyset" is never re-verified against the chain before being locked, including across resume
- **Verdict:** CONFIRMED (downgraded from HIGH — narrow edge case: abandon-wizard-then-resume-after-the-external-keyset-changed). Real gap unique to this kind (unlike "custom", whose keys are the codex's own, not an externally-mutable reference). **Outcome:** NOT fixed here — requires an architectural decision (re-verify before Finalize/Stage 3A, or demote on resume); reported, deferred.

#### [HIGH] `ExistingKeysetPicker`'s in-flight resolve could overwrite a later, unrelated guard choice after the user switches sub-tabs away
- **Verdict:** CONFIRMED. **Outcome:** fixed — `isMountedRef`, set false on unmount, checked before any callback into the parent.

#### [MEDIUM] Guard "keep"'s `guardResolution` is computed once at mount, never refreshed before Finalize
- **Verdict:** CONFIRMED — **PRE-EXISTING** (same `guardResolution`/`currentGuardForResolution` state as the CRITICAL finding above; the plan.md itself documents this state as "lifted earlier this session," i.e. before this topic). **Outcome:** NOT fixed here — same bucket as the CRITICAL finding.

### Round 6 — clean terminal pass

- Conventions: no findings.
- Tests: no findings.
- Security: no findings.
- Correctness: one finding (account-choice revision not re-persisted via `recordSelectionIfComplete`) — **REFUTED as in-scope**: confirmed technically accurate, but the cited code (`handleChooseAccount`, Page 2) predates this topic and is never touched by it (design.md's own "out of scope" line: "Any change to the payment step (3A) — this topic is Step 3B only," and Page 2 is two steps further removed still). Reported separately as a pre-existing issue for whichever topic owns Page 2/account-step persistence.

## Deferred findings — repaired in a follow-up pass

These five were real, confirmed defects that all predated the guard-step-variants topic (or, in one case, belonged to a different topic's code entirely). They were deliberately NOT fixed during the review's own fix loop (judged too architecturally significant to absorb into that cycle), then repaired afterward in a dedicated follow-up pass, with the same TDD discipline (regression test proven red-before/green-after for each).

1. **[CRITICAL] — FIXED.** Guard "keep" locked the wrong account's keys when Page 2's "choose an existing account" path was used instead of "keep current." `currentGuardForResolution` now reads `chosenAccountForPreview?.guard` (the Page-2-CHOSEN account, the same one `resolveFinalizeDerivation` itself resolves to) instead of unconditionally `currentPrimeAccount?.guard`. Regression test: `ui-legacy-prime-migration-wizard.test.tsx` — "guard 'keep' locks the CHOSEN existing account's own guard, never the old current account's...".
2. **[MEDIUM] — FIXED.** `recordSelectionIfComplete` no longer persists an incomplete, zero-key guard selection as if it were complete — a new `isGuardChoiceComplete` check (mirroring `continueBlockedReason`'s own rule) gates the write. Regression test: `ui-step3-payment-and-guard.test.tsx` — "merely opening the custom editor (no key picked yet) does NOT persist the selection; picking a key does".
3. **[MEDIUM] — FIXED** (the "re-verify before Finalize" option, not "demote on resume"). A "use-existing-keyset" choice is now re-resolved via `describeKeyset` immediately before Finalize's Write 3 locks it; any mismatch in keys or predicate (or a failed re-check) is treated as unresolved (`null`), never "lock the stale snapshot anyway." Scoped deliberately to the lock itself (the one truly irreversible action) — Stage 3A's "Apply" offer still reads the unverified choice, but that path already routes through `RotateGuardModal` for the user to review before signing, a materially lower-risk surface than the silent, automatic lock. Regression test: `ui-legacy-prime-migration-wizard.test.tsx` — "a 'use an existing keyset' choice that has DRIFTED by Finalize time is never locked using the stale snapshot".
4. **[MEDIUM] — FIXED**, same change as #1 plus one more: Write 3 now also re-resolves the "keep" fallback's guard freshly at Finalize time (via a direct `resolveGuardKeys` call) instead of trusting the `guardResolution` state captured at step-mount, closing the staleness window across review/password/Arweave-seed steps. Covered by the same regression test as #1 (uses a FRESH resolution, not the stale mount-time one, to prove the correct account's current guard — not a snapshot — gets locked).
5. **[HIGH, different topic] — FIXED.** `handleChooseAccount` now calls `recordSelectionIfComplete` too, but ONLY once a selection already exists (`recordedRun?.selection` truthy) — this re-syncs a REVISION of an already-complete selection without changing the established "arriving at a page via Continue alone never records anything on its own" invariant for a fresh, not-yet-complete run (verified by `ui-wizard-stage-boundaries.test.tsx`'s own "writes NOTHING merely by arriving at Step 3" test staying green). Regression test: `ui-legacy-prime-migration-wizard.test.tsx` — "revising the account choice after Stage 1 is already recorded re-persists the NEW account, not the old one".

#1 and #4 share one root cause and were fixed together. #5 is unrelated to this topic entirely but was repaired alongside it per explicit instruction.

## Clean-pass confirmation

After the review's own fix loop (round 5's fixes):
- `npx tsc --noEmit` in `packages/codex-ouronet`: clean.
- `npx vitest run` (full `codex-ouronet` suite): **1849 passed, 1 failed** — the one failure is `tests/pact-signatures.test.ts`'s pre-existing, unrelated pact-signature drift guard, present before this topic began.
- Round 6's full-scope, full-lens-set pass: zero CONFIRMED in-scope findings.

After the follow-up pass repairing all 5 deferred findings above:
- `npx tsc --noEmit` in `packages/codex-ouronet`: clean.
- `npx vitest run` (full `codex-ouronet` suite): **1852 passed, 1 failed** — same single pre-existing, unrelated failure.
- Each of the 5 fixes has its own dedicated regression test, proven red-before/green-after via a temporary revert, same as every fix in the review's own rounds.

## Round count

6 review rounds (terminal pass clean) + 1 follow-up repair pass (5 findings, all fixed and regression-proven).
