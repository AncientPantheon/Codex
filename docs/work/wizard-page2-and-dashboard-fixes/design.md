# Wizard Page 2 and Dashboard Fixes — Design

## Problem

Live-testing round 4 found a real bug and a layout problem, both on the
wizard's Account step and carrying through to later steps:

1. **The Settling Dashboard's blue (account) ticker never lights once the
   user picks an "existing" (non-default) account.** `seedDashboardAccountSeedId`
   only has a reliable attribution path for "keep current" (the structural
   `currentPrimeSeed` shortcut, fixed two rounds ago); choosing a DIFFERENT
   account falls back to raw key-matching against that account's own stored
   `.publicKey` — the same unreliable-on-legacy-data comparison already
   proven to fail. The effect reads as "the dashboard disappeared" the
   instant an account is chosen, and produces a wrong, single, mislabelled
   card on the Payment step instead of the two distinct seed cards (the
   account's own seed, and the Koala seed backing a kept payment key) the
   dashboard exists to show.
2. **The chevron/expand button is the wrong interaction entirely.** It
   toggles a one-line inline "position N" text; the owner wants it to open
   this codex's own real seed-reveal modal (Seed/Bitmap/BitString/Base-10/
   Base-49 tabs) — the SAME one already used elsewhere for accounts and
   seeds — not a rebuilt, thinner view.
3. **The Account step's layout forces the whole popup to scroll** once
   there are more than a couple of candidate accounts, and buries option 3
   ("type new words") and the Settling Dashboard itself below that scroll.

## Approach

### 1. A reliable account-to-seed match for ANY chosen account

New `resolveAccountSeedId` in `seedDashboard.ts`, mirroring
`resolveArweaveMatchSeedId`'s own exact mechanism: decrypt the chosen
account's own `secret` (already available via the SAME `smartDecrypt`
this file already imports) to get its bitstring, decrypt each candidate
seed's own `secret` the same way, and return the `id` of the first exact
match — no RSA/derivation needed, since both fields are already-the-
bitstring by this codebase's documented convention. The wizard tries, in
order: (a) `currentPrimeSeed?.id` when the choice is "keep current" and
that prop is supplied (synchronous, zero decrypt cost, already correct);
(b) this new async bitstring match, for every other case (`"existing"`,
and as the fallback for "keep current" when `currentPrimeSeed` is
absent). This reuses the request-token-guarded `useEffect` pattern the
violet ticker's own resolution already established in this file.

### 2. Replace the inline expand panel with the real seed-reveal modal

New `SeedRevealModal` component (`packages/codex-ouronet/src/ui/internal/
SeedRevealModal.tsx`), mirroring `ViewSeedModal.tsx`/`SeedWordsTab.tsx`'s
own inline reveal pattern but for a plain `IStoaChainSeed`: decrypts
`seed.secret` (always) and `seed.wordsSecret` (when `seedType === "stoic"`
and present) via the wizard's own prop-driven `getPassword`/`authenticate`
(matching `AccountStep`'s existing testable convention — no new hook
usage), then mounts `CodexModalShell` + the ALREADY-REUSABLE
`DalosSecretReveal` — `originMode="seedWords"` when `wordsSecret` decrypted,
else `"bitString"`. Nothing is rebuilt; `DalosSecretReveal` itself is used
as-is, exactly like every other caller.

Each sub-row's button (`-expand` testid retained) now opens this modal for
**the card's own `IStoaChainSeed`** — not an `IArweaveSeed`, even for a
sub-row whose violet ticker is lit. Cards are already keyed by Chainweb
seed identity (the violet ticker merges ONTO an existing Chainweb seed's
card, never its own separate Arweave-seed card), so this naturally reveals
real words when the attributed Chainweb seed has them, sidestepping the
pre-existing (and out-of-scope) "Arweave seed's own native reveal can lack
words" case entirely. The button is enabled whenever its card exists at
all — a card is only ever created for a seed actually present in `allSeeds`,
so there is no "card exists but nothing to reveal" state to separately
guard against. The old inline "position N" detail text is dropped — the
real reveal modal supersedes it; a sub-row's own ticker row (chevron +
tickers + label) stays, just without the toggled block beneath it.

### 3. Account step: four fixed regions, one scrollable

Restructure `AccountStep`'s render into four always-visible blocks: 0)
the Settling Dashboard (unchanged mechanism, already fixed via the
existing sticky wrapper one level up — just confirmed to keep working now
that cards stop vanishing); 1) "Keep your current account" — condensed
(its own explanatory paragraph trimmed to one line, matching option 3's
new compactness); 2) "Choose an existing account" — gets its own
internally-scrolling list (a fixed-height box, independent `overflowY`,
not the whole popup) plus a name-search input filtering that list
client-side (every candidate's name is already loaded in memory by this
point — the probe pass already ran); 3) "Type new words" — shown expanded
by default (its input visible immediately, not behind an extra click),
also condensed. Only region 2's own list scrolls; the popup's own outer
scroll (from `CodexModalShell`) is no longer forced by a long candidate
list.

### Alternatives considered

- **Keep key-matching for "existing", just prevent total dashboard
  blankness** — rejected (the owner's own Question 1 answer): doesn't fix
  the actual bug, the two-seed case on the Payment step would still never
  render correctly.
- **Build a new `IArweaveSeed`-specific reveal path for the violet
  ticker** — rejected: unnecessary: the card is already keyed by the
  Chainweb seed, which already has the real words when available; building
  a second reveal path would duplicate `ViewSeedModal`'s/`SeedWordsTab`'s
  own pattern for no benefit.
- **A dedicated search-bar component library** — rejected: this is a
  plain controlled `<input>` filtering an already-in-memory list; no new
  dependency needed.

## Acceptance criteria

- [ ] Choosing an "existing" (non-default) account on the Account step
      still shows the Settling Dashboard's blue ticker on that account's
      own seed, when a real bitstring match exists.
- [ ] On the Payment step, keeping a payment key backed by a DIFFERENT
      seed than the chosen account's own seed shows TWO cards — one for
      each seed — not one mislabelled, incomplete card.
- [ ] Clicking a sub-row's button opens the real seed-reveal modal (Seed/
      Bitmap/BitString/Base-10/Base-49 tabs, the same component used
      elsewhere in this codex), never an inline "position N" line.
- [ ] The reveal modal shows real seed words whenever the attributed
      Chainweb seed has them on record, even for a sub-row whose violet
      (Arweave) ticker is the one that's lit.
- [ ] The Account step's candidate-account list scrolls within its own
      bounded region; the modal's own outer scroll is not forced open by a
      long candidate list.
- [ ] A name-search input filters the candidate-account list client-side.
- [ ] "Type new words" (option 3) is visible and usable without an extra
      click to expand it.
- [ ] Options 1 and 3 render with shorter explanatory text than today.

## Out of scope

- Any change to `ArweaveSeedsArea.tsx`'s own, pre-existing "View Prime
  Arweave Seed" reveal — untouched; the dashboard's own reveal button
  never opens it.
- A full `ViewSeedModal`-style public export of the new `SeedRevealModal`
  for other packages to use — internal to the wizard for now, extracted
  later only if a second consumer appears.
- Virtualizing the candidate-account list — a bounded-height scroll
  region is sufficient at the sizes this wizard deals with.
