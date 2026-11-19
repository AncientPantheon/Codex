# "Enter password, see first step, click Continue, nothing happens" — debug session (2026-10-31)

## Symptom (as reported)

User: open the eligibility wizard ("Make Codex Permaweb Eligible") → enter the
codex password → presented with the first step → click Continue → nothing
happens.

## Reproduction attempts

### Attempt 1 — static read of the intro step's own Continue handling

`LegacyPrimeMigrationWizard.tsx`: `continueBlockedReason()` returns `null`
unconditionally for `step === "intro"`; `handleContinue()`'s `"intro"` branch
unconditionally calls `setStep("account")` + `notifyStateChange(...)`. No
gating, no async work, nothing that could silently no-op. **Nothing wrong
found by reading alone** — matches the file's own history of a REAL prior
bug (a `console.debug` no-op) that was already fixed; this code is not that.

### Attempt 2 — jsdom test, real `<CodexProvider>` + real store, fresh codex

Wrote a test mirroring `ui-wizard-resume.test.tsx`'s harness (real
`MemoryCodexAdapter`, real store, `migrationProgress: undefined` — the
"never done this before" case): render the wizard open, wait for
`ready`, click `legacy-prime-migration-continue` on intro.

**Result: PASSED.** Intro step disappears, `legacy-prime-migration-account`
appears. The React-level logic is fine for this exact scenario.

### Attempt 3 — real browser, live dev server (:5199), real CDP drive

Headless Chromium via CDP (`ws`, `Runtime.evaluate` for clicks — DOM
events, not synthetic-only). Flow: Create a new Codex (fresh, single
account + auto-installed Prime Arweave seed) → Codex ID tab → "Make Codex
Permaweb Eligible" (no password prompt needed — codex was just created,
still authenticated) → wizard opens on **"Step 1 of 4 — Why & What"**
(intro) → click Continue.

**Result: WORKED.** Advanced cleanly to "Step 2 of 4 — Ouronet Codex
Master" (the account step), zero console errors, zero exceptions.

So on a **fresh, newly-created, single-account codex**, in the **real
running app**, the exact reported sequence does NOT reproduce. The bug
needs something about the user's actual codex (real history, multiple
seeds/accounts, prior migration attempts, prior password changes — all of
which this session has been testing against) that a fresh codex doesn't
have.

### A REAL bug found along the way (confirmed, but not yet proven to be THIS symptom)

While testing, closed the wizard (×) without finishing, then reopened it
(same page, no reload) — **it did NOT reopen on intro.** It reopened
directly on "Step 2 of 4 — Ouronet Codex Master", silently, with no resume
banner.

Root cause, confirmed by reading `CodexIdPage.tsx`: `<LegacyPrimeMigrationWizard
open={legacyPrimeMigrationWizardOpen} .../>` is **always mounted** — only
the `open` prop toggles; the component itself does `if (!open) return null`
rather than being conditionally rendered by the parent. Its `useState(step)`
etc. therefore **never reset** across a close → reopen within the same page
load, because the component instance never unmounts. Only the resume-check
ref (`resumeAppliedRef`) is explicitly re-armed on close
(`if (!open) { resumeAppliedRef.current = false; ... }`) — `step`,
`accountChoice`, `paymentChoice`, `guardChoice` are not.

This means: open the wizard, advance past intro, close it before finishing,
reopen it → you land wherever you last were, intro (with its lock-in
warning text) never shown again, and no "Resumed" banner either since
nothing was ever *recorded* (recording requires all three choices, not just
navigation).

**This is real and reproducible, but is a different shape than the
reported symptom** — it skips intro silently rather than showing intro and
then ignoring Continue. Not fixing it yet — flagging it, and not ruling it
out as related until the user confirms what they actually saw.

## Current frontier — need the user's input before guessing further

Three dead-end-ish results in a row on the literal symptom (code read clean,
unit test green, fresh-codex live repro green) — per the debug process,
broadening further without new information would be guessing. Need from the
user:

1. **Is this the very first time ever opening this wizard in this browser
   tab/session**, or had it been opened (and closed without finishing)
   earlier in the same browser session? (Tests the close/reopen bug above as
   the actual cause — if so, "first step" may mean "whatever step it lands
   on," not literally intro.)
2. **What does the screen actually say** on the step before the dead
   Continue click — specifically, does it show the paragraph starting "Some
   codexes aren't eligible for seed-words-only restore yet…" (true intro),
   or something else (e.g. "Choose which Ouronet account becomes your Prime
   Ouronet Account")?
3. Any error in the browser console (F12 → Console tab) at the moment of the
   click — even one that looks unrelated?
4. Does a **hard refresh** (Ctrl+Shift+R) before opening the wizard change
   anything? (Rules the close/reopen persistence bug in or out directly —
   a hard refresh fully remounts everything.)

## NOT the cause (ruled out)

- The intro step's own `handleContinue`/`continueBlockedReason` logic — read
  directly, unconditional, no gating.
- A stale/dead dev server — confirmed server up since 13:11, confirmed
  serving current source via `@fs` path diff against the working tree.
- The general class of bug this session already fixed once (silent
  `console.debug` no-op button) — that was a different step (`"keys"`), and
  intro was fixed for real back in T4; a dedicated regression test already
  pins intro's Continue working.
