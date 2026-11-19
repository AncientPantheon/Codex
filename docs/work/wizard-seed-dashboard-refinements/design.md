# Wizard Seed Dashboard Refinements — Design

## Problem

Live-testing round 3 found the just-shipped Settling Dashboard (nee "Seed
Dashboard") still isn't usable: the header region reads as three disconnected
pieces (title card, then a separate bordered Back/Continue rectangle, then the
dashboard) instead of one clean fixed region; the scroll area uses the
browser's plain native scrollbar instead of matching the app's own dark/gold
theme; the Account step has a genuine "nothing selected yet" state that
shouldn't exist (every other step in this wizard already defaults to its
recommended choice); and the dashboard's one-row-per-seed model can't express
the thing it exists to show — that the SAME seed's words can independently
back different roles via DIFFERENT derivation algorithms (e.g. the account via
Dalos, the payment key via Koala), which is exactly the "how many distinct
seed-word-sets are really in play" question the dashboard is supposed to
answer at a glance.

## Approach

### 1. Back/Next move into the title region, as icon buttons

`CodexModalShell` (the shared chrome behind 20 modals in this package) gets
one new optional prop, `headerExtra?: React.ReactNode`, rendered in its
existing title-bar flex row, between the title/subtitle block and the close
(×) button. Omitted (every other caller), rendering is byte-identical to
today — the same "optional prop, no-op unless supplied" convention every
other prop on this component already follows (`footer`/`topBar`/`fillBody`/
`zIndex`).

The wizard supplies `headerExtra` with two small icon buttons
(`ChevronLeft`/`ChevronRight` from `lucide-react`, already a dependency of
this exact file) styled to match the close button's own secondary treatment
(`30×30`, `#141414` fill, `#262626` border) for Back, and the existing
accent-gold fill for Next/Continue — replacing the old separate bordered nav
rectangle entirely. `data-testid="legacy-prime-migration-back"`/
`"legacy-prime-migration-continue"` are PRESERVED on the new buttons (dozens
of existing tests call these by name); `legacy-prime-migration-nav` (the old
wrapping rectangle) is retired — once Back/Next live in the modal's own title
bar, which is already outside the scrolling body by construction, the
`position: sticky` trick that rectangle needed no longer applies to anything,
so the handful of tests asserting sticky CSS on that specific testid are
rewritten to assert the new reality instead of kept as dead weight.

The `continue-blocked` reason (shown when Next is disabled) keeps its own
`data-testid="legacy-prime-migration-continue-blocked"`, now rendered as a
single thin line directly below the title bar (inside the wizard's own fixed
region, above the Settling Dashboard) rather than inline next to the buttons.

### 2. A themed scrollbar on `CodexModalShell`

`CodexModalShell.tsx` imports `../tokens.css` (already the established
pattern — `DalosSecretReveal.tsx` does the same for its own styling) and a
new rule set styles `::-webkit-scrollbar`/`scrollbar-color` for a class
applied to the shell's own two scroll-candidate elements (the outer card on
desktop, the inner body on the mobile footer-split layout) — dark track
(`#0a0a0a`/`#141414`), a muted-gold thumb (`#3a3420`/accent on hover),
matching the app's own existing dark/gold palette. This is new styling (no
"ZBOM" scrollbar exists anywhere to copy — confirmed by direct repo search),
scoped at the shared-shell level per the owner's own choice, so all 20 modals
built on this shell get it, not just this wizard.

### 3. The Account step always has a selection

`accountChoice`'s `useState` default changes from `null` to
`{ kind: "keep-current" }` — matching `paymentChoice`/`guardChoice`/
`keysChoice`, which already default to their own recommended choice rather
than starting unchosen. `AccountStep`'s "Keep your current account" option
reads as selected (green dot) from the very first render, with no click
required — there is no longer a "nothing picked yet" state to pass through.
This does NOT touch `recordSelectionIfComplete` or any store-write path — the
existing "writes nothing merely by arriving" invariant
(`ui-wizard-stage-boundaries.test.tsx`) governs RECORDING, not this local
preview state, and stays enforced exactly as today; this change is verified
against that specific test during build, not merely assumed safe.

### 4. The Settling Dashboard groups by seed words, then by derivation

Replaces the current one-row-per-seed/four-ticker-columns model with: one
CARD per seed (same `seed.id` keying as today), and inside each card, one or
more SUB-ROWS — one per distinct derivation label actually producing a role
from that seed's words this run. A sub-row's layout, left to right: an
expand/chevron button, the four ticker checkboxes (only the ticker(s)
relevant to THIS row's derivation lit), then the label — e.g. "Master Seed -
24 Words (Stoa Dalos Derivation)".

- The account role is always labelled **"Stoa Dalos Derivation"** (an Ouronet
  account is Dalos-curve, full stop — confirmed by this wizard's own "DALOS"
  badges; it isn't produced via this wizard's internal position-0/1 scheme,
  so it needs its own fixed label rather than borrowing `SeedType`).
- Payment/guard are labelled via the ALREADY-BUILT `SeedType`/
  `paymentKeyOriginLabel` vocabulary (Koala / Chainweaver / Stoic Dalos) from
  this session's earlier Payment-step work — reused, not reinvented.
- When payment/guard use this wizard's OWN "Stoic Dalos Derivation" default
  (freshly deriving at position 0/1 of the SAME seed the account uses), they
  land on the SAME sub-row as the account (identical label, identical
  words) — a sub-row only splits off when the label genuinely differs (e.g.
  payment traces to a Koala-derived key from these same words instead). This
  directly matches the owner's own framing: fewer rows when things really do
  coincide is the readable, "congratulations" case, not something to split
  apart for symmetry.
- The chevron reveals the SAME non-word-revealing detail the current
  dashboard already shows (which key/position backs each lit ticker on that
  row) — never the seed's plaintext words, keeping this file's established
  "already securely stored, not re-displayed here" convention.
- A seed backing nothing this run still renders no card at all (unchanged
  from today).
- The card's own header names the seed ("Master Chainweb Seed" for index 0/
  `isPrime`, same `masterChainwebSeedName` convention already used
  everywhere else in this file); each sub-row's label is the part that
  varies per derivation.

### Alternatives considered

- **Keep nav as its own rectangle, just restyle it** — rejected: doesn't
  address "part of the region where steps are presented," which explicitly
  asks for Back/Next to live IN the title area, not beside it.
  `CodexModalShell`'s shared title bar is the only "region where the steps
  are presented" (it already shows "Step X of 4") that both the title and
  nav could actually occupy together.
- **One ticker-row per ROLE always, never merged, even on identical labels**
  — rejected per the owner's own Question 2/3 answers; contradicts "fewer
  rows when words coincide is the ideal case."
- **Scope the themed scrollbar to just this wizard (nested scroll div)** —
  rejected per the owner's own Question 1 answer; double-nested scrollboxes
  inside `CodexModalShell`'s own already-scrolling container is a real UX
  smell, and 19 other modals would be left inconsistent for no reason.

## Acceptance criteria

- [ ] Back and Next render as icon buttons inside the modal's own title bar
      (via `CodexModalShell`'s new `headerExtra` prop), not as a separate
      bordered rectangle below it; every other existing `CodexModalShell`
      consumer renders byte-identical to before (prop omitted).
- [ ] The modal's scrolling area shows a themed (dark track, muted-gold
      thumb) scrollbar instead of the browser's native one, on every modal
      built on `CodexModalShell`, not just this wizard.
- [ ] Landing on the Account step for the first time already shows "Keep
      your current account" selected (green dot), with no click needed —
      `accountChoice` is never `null` once the wizard has mounted past intro.
- [ ] The "writes nothing merely by arriving" invariant
      (`ui-wizard-stage-boundaries.test.tsx`) still passes unmodified after
      the Account-step default change.
- [ ] The Settling Dashboard renders one card per seed actually backing a
      role this run, each containing one sub-row per distinct derivation
      label in play for that seed (not one flat row with four ticker
      columns).
- [ ] When the account and the default-derived payment key use the literal
      same derivation label on the literal same seed, they appear on ONE
      shared sub-row, not two.
- [ ] When payment/guard trace to a DIFFERENT derivation label on the same
      seed (e.g. Koala) than the account's Dalos label, that seed's card
      shows a second, separate sub-row for it.
- [ ] Expanding a sub-row's chevron shows which key/position it backs, and
      never the seed's plaintext words.

## Out of scope

- Mirroring the new `headerExtra` prop back to `@ancientpantheon/codex-ui`'s
  own copy of `CodexModalShell` — this file already carries other
  local-only additions (`dialogTestId`/`closeTestId`) that were never
  synced back, same precedent applies here.
- Any change to the Arweave (violet) ticker's own matching logic — this
  round only changes how existing attribution is grouped/displayed, not how
  any of the four roles are computed.
- A JS-driven custom scroll-thumb component (drag handles, etc.) — CSS-only
  `::-webkit-scrollbar`/`scrollbar-color` theming is the full scope of "a
  built-in scrolling of the same thematic."
