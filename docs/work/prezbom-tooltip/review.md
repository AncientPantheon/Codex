# prezbom-tooltip — Review

Scope: 16 files (5 lenses run — 16+ file tier per the review skill's scaling rule):
`packages/codex-ui/src/provider/CodexProvider.tsx`, `packages/codex-ui/src/provider/index.ts`,
`packages/codex-ui/tests/provider.test.tsx`, `packages/codex-ouronet/src/provider/CodexProvider.tsx`,
`packages/codex-ouronet/src/provider/index.ts`, `packages/codex-ouronet/src/zbom/cfm/usePreZbomTooltipSetting.ts`,
`packages/codex-ouronet/tests/zbom-prezbom-tooltip-setting.test.tsx`, `packages/codex-ouronet/src/zbom/cfm/PreZbomHint.tsx`,
`packages/codex-ouronet/tests/zbom-prezbom-hint.test.tsx`, `packages/codex-ouronet/src/ui/settings/ZbomSettingsCard.tsx`,
`packages/codex-ouronet/tests/ui-zbom-settings-card.test.tsx`, `packages/codex-ouronet/src/ui/tabs/OuronetAccountsTab.tsx`,
`packages/codex-ouronet/src/ui/tabs/SingleApiPanel.tsx`, `packages/codex-ouronet/src/ui/tabs/DualApiPanel.tsx`,
`packages/codex-ouronet/tests/zbom-prezbom-launcher-coverage.test.ts`, `packages/codex-ouronet/tests/zbom-prezbom-entrypoint-resolution.test.ts`
— plus, added during the fix loop, `packages/codex-ouronet/src/zbom/cfm/previewFormatting.ts` (new) and
`packages/codex-ouronet/tests/zbom-preview-formatting.test.ts` (new), with mechanical follow-on edits to
`packages/codex-ouronet/src/zbom/cfm/ExecutionTooltip.tsx` (import-only + one bugfix side-effect, its
call-building mechanism untouched, matching the design's "out of scope" boundary).

## Round 1 — initial full-scope pass (5 lenses)

- correctness: 0 findings. conventions: 0 findings. security: 0 findings.
- performance: 3 findings (1 MEDIUM re-render fan-out — downgraded to STYLISTIC on validation, pre-existing
  hook, not reachable in today's single-writer/single-key scenario; 1 LOW redundant `tryGetEntrypoint` lookup —
  CONFIRMED, fixed; 1 MEDIUM unbounded `liveReadCache` — downgraded to STYLISTIC, mirrors an existing
  identically-shaped cache in `ExecutionTooltip.tsx`, fixing one in isolation would leave them inconsistent).
- tests: 3 findings, all CONFIRMED and fixed (swapped/mispaired entrypoint blind spot in the coverage test;
  comment-text bracket-matching blind spot; "setting off" test didn't assert the live read never fires).
- correctness (separately raised, MEDIUM): a stale `preview` registry reference silently drops the cost
  section with no warning — CONFIRMED, fixed.
- correctness (MEDIUM): `usePreZbomTooltipSetting`'s `setEnabled` could produce an unhandled promise
  rejection for a `consumerName` that fails the store's identifier regex — CONFIRMED, fixed.

All 6 CONFIRMED findings from round 1 fixed; 2 STYLISTIC left as documented backlog notes (not silently
dropped — recorded in this file and in the PR/commit description).

## Round 2 — terminal full-scope pass (5 lenses, post round-1 fixes)

- security: 0. performance: 0.
- conventions: 2 new findings — 1 MEDIUM (`readablePreview` duplicated between `PreZbomHint.tsx` and
  `ExecutionTooltip.tsx` had ALREADY drifted: the original silently mishandled a genuine `decimal: 0` cost),
  1 LOW (duplicated style constants). Both CONFIRMED.
- tests: 1 LOW (the coverage test's comment-blanking didn't extend to the `openTagText` slice used for
  entrypoint-value extraction — inert today, but the guarantee didn't cover what it claimed to). CONFIRMED.
- correctness: 1 MEDIUM (`allPlaceholder` defaulted to `true` and never flipped for a preview with zero
  declared params, permanently suppressing its live read — not reachable in today's registry data, a latent
  trap for a future zero-arg preview). CONFIRMED.

All 4 CONFIRMED findings fixed: extracted `readablePreview`/`mono`/`previewCardStyle` into a new shared
`previewFormatting.ts` (fixing the `decimal: 0` drift in `ExecutionTooltip.tsx` as a direct side effect —
verified by hand-tracing `{decimal: 0}` through both the old and new logic, and by a deliberate
revert-and-confirm-RED check on the coverage test's mispairing catch, and on the `allPlaceholder` fix);
fixed `allPlaceholder`'s zero-param initialization; fixed the coverage test's blanking gap.

## Round 3 — final full-scope pass (5 lenses, post round-2 fixes)

- security: 0. performance: 0. tests: 0.
- conventions: 3 new findings — 2 MEDIUM (`Preview` union type still duplicated between the two cfm files
  even after the round-2 extraction; the new `previewFormatting.ts` reimplemented an existing, already-tested
  `coercePactDecimal` helper — `zbom/debouncer/parseIgnisInfo.ts` — instead of reusing it), 1 LOW (leftover
  multi-line JSX formatting inconsistent with the sibling card).
- correctness: 1 MEDIUM (the `decimal: 0` fix itself had zero direct test coverage protecting it).

**Validation surfaced an important correction**: the "reuse `coercePactDecimal`" finding's own suggested fix
(`String(coercePactDecimal(need))`) was checked by hand-tracing realistic inputs and found to be UNSAFE — it
would silently reformat a valid decimal STRING like `"1.0"` to `"1"` (stripping the trailing zero,
`coercePactDecimal` coerces to a `number` and back), which would break the existing
`execution-tooltip.test.tsx` assertion pinning `"1.0 IGNIS"` verbatim. `coercePactDecimal` is built for
numeric math elsewhere in the package; this call site needs string-fidelity preservation, a fundamentally
different concern its return type can't carry. **Fixed**: extracted the shared `Preview` type into
`previewFormatting.ts`; collapsed the leftover multi-line JSX; added a direct regression test for
`readablePreview`'s `decimal: 0` handling (`tests/zbom-preview-formatting.test.ts`). **Not mechanically
fixed**: the `coercePactDecimal` reuse — the duplication is real and acknowledged, but no safe minimal edit
exists without either changing `coercePactDecimal`'s contract (used elsewhere, out of scope) or designing a
new shared decimal-formatting primitive (a real design decision, not a targeted fix). Documented here as a
deliberate, investigated non-fix rather than silently dropped.

## Fix loop summary

11 CONFIRMED findings across 3 rounds; 10 fixed, 1 investigated and left unfixed with reasoning recorded
(above); 3 findings downgraded to STYLISTIC on adversarial validation and left as documented backlog notes,
not applied.

## Verification

- `npm run typecheck` across `codex-ui`, `codex-ouronet`, `codex` (root, all three): exit 0, no output, run
  fresh after the very last edit of this loop.
- `npx vitest run` in `codex-ouronet` (full package suite, post round-3 fixes): `Test Files 106 passed (106)` /
  `Tests 1284 passed (1284)` on a clean run; a separate run hit 1 pre-existing, already-documented flake
  (`ui-seed-words-tab.test.tsx`, a real-KDF-timing race under full-suite parallel load, listed in
  `docs/work/backlog.md` before this topic started) — confirmed identical/unrelated by re-running that file
  alone (`55/55` passed in isolation).
- `codex-ui`: `Test Files 26 passed (26)` / `Tests 255 passed (255)`.
- Deliberate mispairing check (behavioral verification of the coverage-test fix): temporarily swapped two
  `entrypoint=` values between adjacent `<PreZbomHint>` wraps in `OuronetAccountsTab.tsx`, confirmed
  `zbom-prezbom-launcher-coverage.test.ts` failed with the exact expected mismatch message, then reverted.
  (One recovery note: a `git checkout --` used to revert this deliberately-corrupted state instead reverted
  the file's ENTIRE T4 wiring diff — caught immediately via `grep -c PreZbomHint`, and the 8 launcher wraps
  in that file were re-applied from scratch and re-verified.)
- Deliberate pre-fix-state check (behavioral verification of the `allPlaceholder` fix): temporarily reverted
  the one-line initialization fix, confirmed the new zero-param regression test failed with the exact
  expected assertion mismatch, then restored the fix.

## Outcome

All 8 design.md acceptance criteria met — hover shows exec params + preview's own params + live cost;
`ExecutionTooltip.tsx`'s ZBOM-internal surface untouched (only its private duplicated helper was
consolidated, not its Pact-call-building mechanism); toggle defaults ON, persists under
`consumerSettings["Codex"]`, merges without dropping keys, never lowers schemaVersion; the two enforcement
tests (launcher coverage, entrypoint resolution) both proven to have teeth via deliberate-break-then-confirm
checks; full workspace typecheck + test green.

Round count (build/review lifecycle proper): 3. Clean pass confirmed.

## Round 4 — post-ship live-bug report (owner tested the shipped feature)

After round 3 closed, the owner tested the live feature and reported two real bugs against a screenshot
(the ZBOM's own execute button — pre-existing, out of this topic's original scope — showed a hover tooltip
occluding the modal, with unelided 162-character account glyphs overflowing the card), plus three
"while you're in there" hardening reminders from a reference implementation. Investigation confirmed:

- **The tooltip-on-execute-button bug was PRE-EXISTING** (`ZbomLayout.tsx`'s `ExecuteZone` conditionally
  wrapped the button in `ExecutionTooltip` whenever a modal passed `executionSpec` — only 2 modals did:
  `ReleaseStoicTagModal.tsx`, `RegisterStoicTagModal.tsx`). Round 1-3's design explicitly declared
  `ExecutionTooltip.tsx` "untouched, out of scope" without recognizing this specific wiring already violated
  the very rule (`PreZbomHint` belongs on the launcher, never the execute button) the whole topic exists to
  establish. Fixed: removed `executionSpec`/`ExecutionTooltip` entirely from `ZbomLayout.tsx` (not deprecated
  — deleted, with a new class-wide guard test, `zbom-execute-button-no-tooltip.test.ts`, asserting neither the
  identifier nor the pattern can reappear anywhere in `src`) and both modals.
- **The long-string overflow bug applied to `PreZbomHint.tsx`, not `ExecutionTooltip.tsx`** (the latter's
  only surviving caller, `Zone2Wrapper.tsx`, always passes `args: []`, so it was never exposed to this).
  Fixed: added a `shorten(rendered, keep=14)` middle-elision helper (keeps head+tail, preserves quotes
  outside the elision) to the shared `previewFormatting.ts`, wired into `PreZbomHint.tsx`'s value rendering
  with `title={raw}` for the full value on hover.
- **Review found a third bug this round's own fix surfaced**: removing the execute button's `ExecutionTooltip`
  wiring left `Zone2Wrapper.tsx`'s signature-only usage (`args: []`, deliberately) as `ExecutionTooltipCard`'s
  *only* remaining caller — and that component's per-argument comparison block renders every declared
  parameter as red "MISSING" whenever `args` is empty, which is now the permanent, sole behavior instead of
  an edge case. Fixed: gated the comparison block on `spec.args.length > 0`, preserving all prior behavior
  for a real args-populated spec (verified against the pre-existing "flags a MISSING argument" test) while
  showing just the plain signature line for the zero-arg case.
- The three "while you're in there" reminders (bind preview values by NAME not position; key the live-read
  effect on the rendered call string, not a values object; module-scope components + pointer events) were
  already correctly implemented in `PreZbomHint.tsx` from round 1's original design — re-verified, no changes
  needed.

**3-lens review** (correctness, conventions, tests — the 4-15 file tier) surfaced 6 findings across two
passes (one pair of lens dispatches hit a session rate limit mid-round and was retried once it cleared):
conventions found the `ExecutionTooltipCard` MISSING-flag bug above (MEDIUM, fixed); tests found 2 MEDIUM
(a vacuous "custom keep length" test that couldn't actually distinguish a working `keep` parameter from a
silently-ignored one — verified by deliberately breaking `shorten()` to ignore `keep` and confirming the
strengthened test catches it, then reverting; a regression guard scoped only to `zbom/modals/` with a regex
blind to shorthand-property reintroduction — widened to the whole `src` tree with a broader `\bexecutionSpec\b`
pattern) and 2 LOW (boundary test only proved one side of the elision threshold — added a 30-char
elides-now case; a `container.textContent` test rewrite — downgraded to STYLISTIC on validation, traced the
actual JSX and found no realistic cross-row collision risk, left as-is) plus 1 LOW noted as pre-existing/
out-of-scope (an unused `mockReader` call in a test this diff didn't touch). Correctness and security-adjacent
concerns (multi-byte glyph slicing safety) came back clean — independently verified the DALOS glyph charset
is entirely single-UTF-16-unit codepoints, so `shorten()`'s `.slice()` cannot split a character.

## Round 5 — second post-ship live test (owner: "hover Release StoicTag, no tooltip at all")

Round 4's fixes shipped no live-hover verification of my own (every automated test either mocked
`ActionTooltip` away entirely or tested the card's content in isolation) — the owner's follow-up live test
caught exactly the gap that left: hovering the "Release StoicTag" LAUNCHER (not the execute button — that
part of round 4's fix was confirmed working) showed nothing.

**Root cause**: `ActionTooltip`'s Radix `Tooltip.Trigger asChild` clones its child and injects the ref +
hover/focus event handlers directly onto it — this only works when the child is a real DOM element or a
`forwardRef` component that spreads its received props. `GoldenBtn`/`VioletBtn`/`GreenBtn`
(`ui/internal/accountFields.tsx`) are plain functions with a fixed, narrow prop signature (`icon, label,
onClick, disabled`) and no `...rest` spread — Radix's injected props landed on them as unrecognized extras
and were silently dropped before ever reaching the real `<button>`. Affects exactly the 6 of 11 launchers
built on those three shared components (Rotate Payment Key/Guard/Sovereign/Governor, Release/Register
StoicTag); the other 5 (Activate ×2, Deploy Pythia, Link, Rename lane, Revoke) use plain `<button>` directly
and were never affected.

**Fix**: wrap `children` in a plain `<span style={{display:"inline-block"}}>` inside `PreZbomHint` itself,
before handing off to `ActionTooltip` — guarantees Radix always has a real host element to attach to
regardless of what the caller passes, fixed once for every current and future launcher, rather than making
every shared button component in this package `forwardRef`+prop-spreading (a much wider blast radius for a
component family used throughout the app, not just here).

**Regression lock** (`zbom-prezbom-hint-real-hover.test.tsx`, new): renders the REAL `ActionTooltip` (not
mocked) wrapping a REAL `GreenBtn`, and asserts Radix's own `data-state` attribute — its trigger-wiring
marker, injected via `asChild`'s `cloneElement` — actually lands on a real element in the tree. Verified by
hand both directions: with the span removed, `data-state` appears NOWHERE in the rendered output (props
silently dropped, exactly reproducing the reported bug); with it restored, it lands on the wrapping `<span>`,
never the inner `<button>`. Note on test design: a `fireEvent.pointerEnter` + `waitFor(tooltip visible)`
version was tried first and doesn't work in jsdom in *either* state (a known jsdom limitation simulating
Radix's full hover-intent-to-open animation, not a signal of anything) — the `data-state`-presence check is
the reliable, actually-diagnostic signal, confirmed to flip on the exact fix.

Full workspace typecheck green; `codex-ouronet` full suite 1294/1294 on a clean run (zero flakes this pass).

Round count (including both post-ship rounds): 5. Clean pass confirmed.

## Round 6 — visual parity request (owner compared screenshots against the OuronetUI reference)

Now that hover worked, the owner compared side-by-side screenshots and asked for three things, all
cosmetic (no logic change): (1) the card was visibly narrower than OuronetUI's reference — root cause:
a Radix `Tooltip.Content` is absolutely-positioned and shrink-to-fits its content by default, so a card
with fewer/shorter lines renders narrower even at the same `maxWidth`; added an explicit `minWidth: 320px`
alongside a widened `maxWidth: 480px` (was 440px) to `previewCardStyle` (shared with `ExecutionTooltip.tsx`,
intentionally — keeps both cards visually consistent with each other, not just with the reference).
(2) Content structure didn't match the reference's layout: added a numbered index prefix (`01`, `02`, …) to
each preview-argument line and an explicit "the arguments above are this preview's" caption directly under
them — both present in the reference, both make the "these are PREVIEW params, not positioned against the
EXEC signature above" distinction visible to the reader, not just correct under the hood (this card already
bound values by preview-param name from round 1; this only makes that fact visually explicit, matching the
reference's own framing). (3) A deliberate graphical differentiator was requested (content otherwise
matches the reference on purpose): a small `CODEX` corner badge, purple (`#a78bfa`, this package's own
established "Codex-family" accent, distinct from the gold/green the two tooltips otherwise share).

No behavioral change — full workspace typecheck clean, `codex-ouronet` suite 1294/1294 unchanged.

## Round 7 — third live-test round: numbered list wrong, card visually overflowing its own tooltip shell

Two more concrete, screenshot-driven reports:

**Bug A — numbered argument list didn't match the exec signature.** ReleaseStoicTag (3 exec params:
patron/executor/tag-name) showed only 2 numbered rows; RotateGuard (4 exec params) showed 2, one of them
("account") not even one of the 4 signature names. Root cause: round 6's numbered list iterated the
PREVIEW's own (often smaller, differently-named) param list, not the EXEC's — correct for the underlying
`buildPreviewCall` mechanism (unchanged, still preview-name-bound), wrong for what a reader expects a
"signature" listing to show. Fixed: the numbered list now iterates `ep.params` (the EXEC's own declared
params, in EXEC order — always matching the "(...)" line above it 1:1), each resolved by NAME via
`ep.ghost.args` (exhaustively keyed by EXEC names, unlike the preview's own ghost coverage) with a
type-appropriate placeholder as a last resort. The live-cost mechanism (`buildMergedPreviewValues`,
`buildPreviewCall`) is completely unchanged — still correctly bound to the preview's own param names, per
the original "arguments belong to the preview" design; only the DISPLAY list changed. The now-inapplicable
"the arguments above are this preview's" caption was removed (the numbered list is the exec's own signature
now, not a claim about the preview).

Investigating this surfaced a second, real bug in the same code path: a `guard`-typed exec param's ghost
value is a real OBJECT (`{ readKeyset: "ks" }`, confirmed live for `RotateGuard`'s `new-guard`), which a
bare `String(value)` would have rendered as `"[object Object]"`. Added `formatArgValue()`, recognizing this
shape and rendering it the way Pact actually expects (`(read-keyset "ks")`), with a safe `JSON.stringify`
fallback for any other unexpected object shape instead of `[object Object]`. (The owner separately noted
some ghost values — e.g. the guard field's real content — aren't well-populated yet; that's a registry/
OuronetUI-side data-quality item they're addressing independently, out of scope here. This fix only ensures
whatever ghost value IS present renders sensibly, however incomplete the underlying data is today.)

**Bug B — the card visually overflowed the tooltip's own background ("bulged out of" it).** Root cause:
`ActionTooltip.tsx` (a SHARED component, used elsewhere for short single-line explanatory hovers) hardcodes
its own `max-w-[220px]` dark-card box (`#1a1a1a` background) on `Tooltip.Content`. `PreZbomTooltipCard`
renders AS THE CHILD of that box, with its own, much larger box (`previewCardStyle`, up to 480px wide,
`#0b0b0b` background) — round 6's width fix (adding `minWidth: 320px`) made this overflow consistently
visible rather than occasional. Fixed: added an `unstyled` prop to `ActionTooltip` (default `false` —
every existing caller, StoaAccountsTab/codex-arweave, keeps today's box unchanged) that skips the built-in
box/background/arrow entirely, letting the caller's own content supply its complete visual box.
`PreZbomHint` now passes `unstyled`.

Both bugs are cosmetic/display-only; the underlying `buildPreviewCall`/live-read/entrypoint-resolution
machinery was untouched by either fix. New/updated tests: 3 tests directly reproducing the reported
ReleaseStoicTag/RotateGuard cases (numbered rows match signature 1:1, "account" never appears, the
`{readKeyset}` guard value renders correctly, no `[object Object]`), 3 tests locking `ActionTooltip`'s new
`unstyled` prop and its default-unchanged behavior for existing callers.

Full workspace typecheck clean; `codex-ouronet` suite 1299/1299 on a clean re-run (one flake on the first
run, a different pre-existing password/KDF-timing test than previously seen — same documented class,
confirmed non-reproducing on isolation/re-run, not a regression).
