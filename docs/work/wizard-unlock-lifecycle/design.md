# Wizard Unlock Lifecycle — Design

Topic 1 of `docs/work/migration-completion/design.md`. Blocks the other two.

## Problem

The eligibility wizard is a long, multi-step, think-about-it flow. The codex's
unlock window is short and **absolute**. When the window closes mid-wizard,
every point that needs the password dead-ends on a raw error instead of asking
for it again. Two distinct failures, both observed on the owner's real codex:

- **Locked.** Clicking "View seed" on the chosen account:
  `Codex is locked; operation "getPassword" requires authentication. Call
  authenticate(password) first.` — the raw store error, surfaced verbatim to
  the user inside a modal titled with their account name.
- **Wrong password available.** Finalize:
  `Could not decrypt this account's words: AES-GCM auth-tag failure` — a
  password *was* present but did not decrypt that account, and the flow
  treats it as terminal.

Both end the run. The staged selections survive (they are in
`migrationProgress`), but the user is bounced out with a cryptic message and
no way forward from where they stood.

Owner: *"The codex needs to be kept unlocked for these processes, OR if it
gets locked, ask the password again, or once the wizard is started turn the
lock period to 15 minutes, or something like that."*

## Approach

**Prompt and resume at the point of need** — never extend the window — using
an **inline** prompt, not the global modal.

AMENDED AFTER GROUNDING (planning pass). This section originally named
`useEnsureCodexUnlocked()` (`src/zbom/hooks/useEnsureCodexUnlocked.ts`) as the
mechanism, since `CodexIdPage.tsx` already calls it before *opening* this
wizard. Verification found that path unusable here, for a concrete reason:

- That hook prompts via `useRequestPassword()` → `state.actions.requestPassword()`,
  which is resolved by a **`<PasswordModal>` the HOST app is expected to
  render**. Searching the tree, `<PasswordModal>` is **never actually mounted
  anywhere** — not by `CodexProvider`, not by `apps/codex-playground`. It is a
  headless export. So in the owner's real environment there is nothing to
  answer the request.
- `PasswordModal.tsx` also carries **no `zIndex`**, and this prompt would open
  from inside an already-open modal — the exact stacking hazard
  `CodexModalShell`'s own `zIndex` prop exists to fix.

The house pattern is instead an **inline prompt**, and this file already
contains a mature one: the Account step's
`legacy-prime-migration-account-probe-unlock` panel, which already
distinguishes the two failure modes by name —

> `"locked"` — `getPassword()` threw (no cache / TTL expired).
> `"wrong"` — `getPassword()` SUCCEEDED but nothing it decrypts works.

— takes a password, retries, and reports `"Incorrect password — try again."`
`ViewSeedModal.tsx`'s own `needsPassword` inline prompt is a second precedent.

So: give the remaining password touch points the same inline prompt-and-retry
treatment, and treat a failed decrypt as "ask again" rather than the end of
the road. This keeps the absolute window intact (a fresh password entry
legitimately *starts* a window; nothing slides an existing one), needs no host
wiring, and has no stacking hazard.

**Why not raise the lock period (the owner's third option).** That option is
explicitly rejected, and this is the one place the owner's instinct collides
with a deliberate prior decision. `useEnsureCodexUnlocked`'s own doc records
it:

> Unlock window is **absolute, not sliding.** […] (Previously this called
> `authenticate()` unconditionally, so every operation silently reset the
> timer to the full TTL — a sliding window that never enforced the displayed
> deadline.)

Extending or sliding the window for the wizard would re-introduce precisely
the bug that was fixed, and would make the visible "re-authenticate in X"
countdown lie. Prompting costs the user one password entry and keeps the
displayed deadline honest. Flagged here rather than quietly implemented.

### Touch points to route through the gate

All of these currently reach for the password directly:

- `resolveFinalizeDerivation` — `smartDecrypt(targetAccount.secret, getPassword())`
  (the AES-GCM failure above).
- The Settling Dashboard's two resolution effects — `actions?.getPassword()`
  for the Arweave decrypt-and-compare and the account-seed match. These
  already swallow failures into `password = null`, so they degrade to "unlit
  ticker" rather than crashing — correct, and left alone.
- `SeedRevealModal` / `AccountSeedRevealModal` — the "View seed" buttons (the
  locked error above).
- `ensurePrimeArweaveSeed` — `state.actions.getPassword()`, reached from
  Finalize.

### Alternatives considered

- **Extend/slide the TTL while the wizard is open** — rejected above: undoes a
  deliberate fix and makes the countdown dishonest.
- **Re-prompt once, up front, when the wizard opens** — rejected: a wizard run
  can outlive any window no matter how fresh it is at the start, so this
  narrows the failure without closing it.
- **Let the dashboard's silent degradation cover everything** — rejected: fine
  for a ticker that can honestly stay unlit, wrong for Finalize, which must
  either do the work or say why it cannot.

## Acceptance criteria

- [ ] With the codex locked, pressing "View seed" in the Settling Dashboard
      shows the password prompt, and reveals the seed after a correct entry —
      instead of the raw `Codex is locked; operation "getPassword"…` text.
- [ ] With the codex locked, pressing Finalize prompts for the password and
      then completes, instead of failing.
- [ ] Cancelling the password prompt leaves the wizard exactly where it was,
      with the staged selections intact and no partial write.
- [ ] A decrypt that fails because the supplied password was wrong offers
      another attempt, rather than ending the step.
- [ ] A user who never hits the lock window sees no prompt and no extra step
      anywhere in the flow.
- [ ] The codex's unlock countdown is not extended, reset, or made sliding by
      anything in this change.

## Out of scope

- Changing the unlock TTL's length, or where the user configures it.
- The mixed-password question — whether some entities in a real codex are
  encrypted under an older password than the codex currently uses. If a
  correct, freshly-entered password still fails to decrypt a given account,
  that is a genuine data situation to diagnose separately; this topic only
  guarantees the user is *asked* and told clearly which case they are in.
- Any change to `migrationProgress` or the stage boundaries.
