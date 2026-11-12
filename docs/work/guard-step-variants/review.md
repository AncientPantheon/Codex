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

## Deferred — pre-existing issues reported, not fixed in this pass

These five are real, confirmed defects, but all predate the guard-step-variants topic (or, in one case, belong to a different topic's code entirely) and were judged too architecturally significant to absorb into this review's fix loop:

1. **[CRITICAL]** Guard "keep" locks the wrong account's keys when Page 2's "choose an existing account" path is used instead of "keep current." (`currentGuardForResolution`/`guardResolution` always derived from `currentPrimeAccount`, never the chosen account.)
2. **[MEDIUM]** `recordSelectionIfComplete` persists an incomplete, zero-key guard selection as if it were complete (affects the original "custom" kind too, not just the two new kinds).
3. **[MEDIUM]** "use-existing-keyset" choices are never re-verified against the chain before being locked or offered for rotation, including across a resumed session.
4. **[MEDIUM]** Guard "keep"'s resolved keys are a one-time snapshot taken at step-mount, never refreshed before the (potentially much later) Finalize write. Same root state as #1.
5. **[HIGH, different topic]** Revising the Page-2 account choice after Stage 1 is already recorded doesn't re-persist the selection, so a later account switch can be silently overridden by resume. Unrelated to guard-step-variants; belongs to whichever topic owns Page 2.

#1 and #4 share one root cause and would likely be fixed together. #5 is unrelated to this topic entirely.

## Clean-pass confirmation

After the last applied edit (round 5's fixes):
- `npx tsc --noEmit` in `packages/codex-ouronet`: clean.
- `npx vitest run` (full `codex-ouronet` suite): **1849 passed, 1 failed** — the one failure is `tests/pact-signatures.test.ts`'s pre-existing, unrelated pact-signature drift guard, present before this topic began.
- Round 6's full-scope, full-lens-set pass: zero CONFIRMED in-scope findings.

## Round count

6 rounds. Terminal pass (round 6): clean.
