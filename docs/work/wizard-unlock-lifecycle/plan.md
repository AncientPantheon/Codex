# Wizard Unlock Lifecycle — Plan

Design: `docs/work/wizard-unlock-lifecycle/design.md`. Project context:
`docs/work/migration-completion/design.md`.

## Before you start — two traps that have already cost real time

1. **`@testing-library/jest-dom` is declared in `package.json` but never
   registered** in `packages/codex-ouronet/tests/setup.ts`. Matchers like
   `toBeDisabled()` / `toHaveAttribute()` throw `Invalid Chai property`, and
   inside `waitFor` that surfaces as an opaque *"Test timed out in 5000ms"*
   with no hint of the real cause. Use plain property checks:
   `(screen.getByTestId("x") as HTMLButtonElement).disabled`.
2. **Do not call `authenticate()` on a codex that is already unlocked.** The
   unlock window is deliberately absolute, not sliding;
   `src/zbom/hooks/useEnsureCodexUnlocked.ts` documents a prior bug where
   unconditional `authenticate()` reset the TTL on every operation. Only a
   genuinely locked codex may start a new window. T4 enforces this.

Baseline: the package suite is **1980/1981** passing. The single failure,
`tests/pact-signatures.test.ts` ("a fresh run reproduces the committed file
byte-for-byte"), is pre-existing and unrelated — "suite green" below means
"that one failure and nothing else".

Reference implementation to mirror throughout: the Account step's existing
inline prompt in `src/ui/internal/LegacyPrimeMigrationWizard.tsx` —
`legacy-prime-migration-account-probe-unlock` (panel),
`-unlock-input`, `-unlock-submit`, its `"locked" | "wrong"` state, its
`handleUnlockAndProbe()` retry, and its `"Incorrect password — try again."`
error. Its existing tests live in
`tests/ui-legacy-prime-migration-wizard.test.tsx` (~lines 860–930 and
1070–1090) and are the harness to copy for driving a prompt.

## Wave 1

- [x] T1: Create a reusable inline unlock prompt component, extracted in shape
      (not by refactor) from the Account step's existing panel — done when:
      a new `InlineUnlockPrompt` renders a password `<input>`, a submit
      button, a caller-supplied message, and an optional error line; calling
      submit invokes an injected
      `onUnlock(password: string) => Promise<{ ok: boolean; error?: string }>`;
      while that promise is pending the input and submit button are both
      `disabled`; a resolved `{ ok: false, error }` renders `error` and leaves
      the typed password in place for another attempt; a resolved
      `{ ok: true }` clears the input. Pressing Enter in the input submits,
      matching the existing panel. Test ids: `wizard-unlock-prompt`,
      `wizard-unlock-prompt-input`, `wizard-unlock-prompt-submit`,
      `wizard-unlock-prompt-error`.
      Tests (`packages/codex-ouronet/tests/ui-inline-unlock-prompt.test.tsx`):
      renders the supplied message; submit calls `onUnlock` with the typed
      value; input+submit are disabled while pending; a failed result shows
      the error and keeps the typed value; a successful result clears it;
      Enter submits. Use plain `.disabled` property checks, not jest-dom.
      **Do NOT modify the Account step's existing panel in this task** — it is
      delicate and already covered; this is a new component standing beside
      it.
  - files: `packages/codex-ouronet/src/ui/internal/InlineUnlockPrompt.tsx`,
    `packages/codex-ouronet/tests/ui-inline-unlock-prompt.test.tsx`

## Wave 2 (depends on Wave 1 — both tasks import `InlineUnlockPrompt`)

- [x] T2: Make Finalize recoverable instead of a dead end — done when:
      `runFinalize` in
      `packages/codex-ouronet/src/ui/internal/LegacyPrimeMigrationWizard.tsx`
      no longer terminates on a password problem. Today
      `resolveFinalizeDerivation` calls
      `smartDecrypt(targetAccount.secret, getPassword())` and returns
      `{ ok: false, error: "Could not decrypt this account's words: …" }`,
      which the finalize panel renders as a terminal red line (the owner's
      observed `AES-GCM auth-tag failure`). After this task, BOTH password
      failure modes render `InlineUnlockPrompt` inside the finalize panel
      instead: (a) `getPassword()` throwing (locked) shows the message
      *"Your codex is locked — enter your password to finish."*; (b) a
      `getPassword()` that succeeds but whose decrypt throws shows *"The
      password this codex currently holds could not decrypt this account.
      Re-enter it to finish."*. Submitting a password calls
      `authenticate(pw, ttl)` **only when the codex was locked** (snapshot the
      cache's `expiresAt > Date.now()` before authenticating — see trap 2) and
      then re-runs the finalize attempt; a wrong password re-renders the
      prompt with `"Incorrect password — try again."` and the wizard stays on
      the finalize step with its staged selections untouched; a correct
      password completes finalize normally. `ensurePrimeArweaveSeed` (which
      itself calls `getPassword()` inside `packages/codex-arweave`) is invoked
      only after a successful decrypt in this same path, so it needs no change
      in its own package.
      Tests (`packages/codex-ouronet/tests/ui-legacy-prime-migration-wizard.test.tsx`):
      reaching finalize with the codex locked renders `wizard-unlock-prompt`
      and no terminal error; submitting the correct password completes
      finalize; submitting a wrong password shows
      `wizard-unlock-prompt-error` and leaves the step on finalize;
      a run where the codex is never locked renders no `wizard-unlock-prompt`
      at all.
  - files: `packages/codex-ouronet/src/ui/internal/LegacyPrimeMigrationWizard.tsx`,
    `packages/codex-ouronet/tests/ui-legacy-prime-migration-wizard.test.tsx`

- [x] T3: Make both "View seed" modals recoverable instead of showing the raw
      store error — done when: `SeedRevealModal` and `AccountSeedRevealModal`
      render `InlineUnlockPrompt` in place of their current error text
      whenever the failure is a password problem, and submitting a correct
      password reveals the seed without reopening the modal. Today both
      receive a `getPassword?: () => string` prop and surface whatever it
      throws verbatim — the owner saw
      `Codex is locked; operation "getPassword" requires authentication. Call
      authenticate(password) first.` inside a modal titled with their account
      name. Distinguish the same two cases as T2: a throw from `getPassword()`
      is "locked"; a successful `getPassword()` whose `smartDecrypt` throws is
      "wrong password". Non-password failures (e.g. a stoic seed with no
      recoverable `wordsSecret`) keep their existing messages unchanged.
      Authenticate only when genuinely locked (trap 2).
      Tests (`packages/codex-ouronet/tests/ui-seed-reveal-modal.test.tsx` for
      `SeedRevealModal`, `packages/codex-ouronet/tests/ui-account-seed-reveal-modal.test.tsx`
      for `AccountSeedRevealModal` — create the latter if absent): with a
      `getPassword` that throws, the modal shows `wizard-unlock-prompt` and
      never renders the raw `Codex is locked; operation "getPassword"` string;
      submitting the correct password reveals the seed; submitting a wrong one
      shows `wizard-unlock-prompt-error`; an unrelated failure still shows its
      own existing message and no prompt.
  - files: `packages/codex-ouronet/src/ui/internal/SeedRevealModal.tsx`,
    `packages/codex-ouronet/src/ui/internal/AccountSeedRevealModal.tsx`,
    `packages/codex-ouronet/tests/ui-seed-reveal-modal.test.tsx`,
    `packages/codex-ouronet/tests/ui-account-seed-reveal-modal.test.tsx`

## Wave 3 (depends on Wave 2 — asserts the behaviour T2 and T3 introduce)

- [x] T4: Prove the unlock window is never extended, and that the Settling
      Dashboard still degrades silently — done when: a test asserts that
      completing a finalize on an **already-unlocked** codex leaves
      `passwordCache.expiresAt` **unchanged** (capture it before, compare
      after — no `authenticate()` may fire on the unlocked path), and that
      unlocking from a **locked** state sets an `expiresAt` in the future
      exactly once. A second test asserts the dashboard's two resolution
      effects (`resolveArweaveMatchSeedId` / `resolveAccountSeedId` call
      sites in the wizard) still swallow a locked codex into `password = null`
      and render their tickers unlit — rendering **no** `wizard-unlock-prompt`
      from the dashboard itself. Per the design these effects are correct as
      they stand and must not start prompting; this task only pins that.
      Finally, `npm test` in `packages/codex-ouronet` reports the suite green
      (the single pre-existing `pact-signatures.test.ts` failure and nothing
      else), and `npm run typecheck` is clean.
  - files: `packages/codex-ouronet/tests/ui-seed-dashboard.test.tsx`

## Design-criteria coverage

| design.md criterion | task |
|---|---|
| Locked "View seed" prompts, then reveals | T3 |
| Locked Finalize prompts, then completes | T2 |
| Cancelling leaves the wizard where it was, nothing partially written | T2 (stays on finalize, selections untouched) |
| A wrong password offers another attempt | T1 (component), T2, T3 |
| A user who never locks sees no prompt | T2 (explicit test), T3 |
| The countdown is never extended/reset/slid | T4 |
