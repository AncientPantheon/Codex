# Wizard Keyset Scale & Sidebar — Design

## Problem

Live-testing this round surfaced three linked gaps in the migration wizard's
guard/payment step and its shared Settling Dashboard:

1. **Pure keys are invisible.** `CustomKeysetEditor` (`LegacyPrimeMigrationWizard.tsx`)
   builds its entire key picker from `allSeeds.flatMap(seed => seed.accounts)` —
   a codex's `pureKeypairs` (raw Pact `-g` keypairs stored directly on the
   codex, never derived from a seed) never appear as selectable options, even
   though they are perfectly valid guard/payment keys. The Settling Dashboard
   has the same blind spot: `computeSeedDashboardCards`/`SeedDashboardInput`
   are entirely seed-id-keyed, so a pure keypair backing payment or guard has
   nowhere to attribute to and is simply missing from the dashboard.
2. **The picker doesn't scale.** `CustomKeysetEditor` renders one flat
   `<label><input type="checkbox">` row per key with no search and no
   grouping. With a handful of keys this is fine; with hundreds (the owner's
   explicit concern) it becomes an unusable wall of checkboxes.
3. **The modal can't fit it.** When the picker list is long, the step content
   pushes the Settling Dashboard (currently rendered via `CodexModalShell`'s
   `topBar`, stacked above the scrolling body) down or off-screen inside the
   single-column `CodexModalShell`.

## Approach

### G — Pure keys join the picker and the dashboard

**Wizard props:** add `pureKeypairs?: readonly IPureKeypair[]` to
`LegacyPrimeMigrationWizardProps` (defaults to `[]`), threaded down to
`CustomKeysetEditor` and to the Settling Dashboard's input, the same
"optional, additive, defaults empty" pattern `allAccounts` already uses.

**Picker:** `CustomKeysetEditor`'s `available` list gains one entry per
`pureKeypairs[]` item, labelled using the same vocabulary `keySource.ts`'s
`identifyKeySource` already established elsewhere in this package
(`pk.label || "Pure Keypair"`) rather than inventing new wording. Each pure
key is still its OWN individually selectable checkbox — a predicate (e.g.
keys-2-of-3) needs real, distinct public keys, so "Pure Keys" cannot collapse
into one unselectable blob here, only in the dashboard (below). Under the
grouping scheme (see E), pure keys form their own group, labelled "Pure
Keys", alongside each seed's group.

**Dashboard:** a new, always-last `AggregatedPureKeyCard`-style entry (named
literally "Pure Keys") appears whenever at least one pure keypair backs the
settled payment key and/or guard keyset this run — one card regardless of
how many distinct pure keys are involved, matching the owner's own framing
("Pure Keys should appear a single entry... with a disabled Reveal seed
button"). It reuses the existing fallback-card ticker layout
(account/payment/guard inside the group, Arweave outside): the account
ticker and Arweave ticker are permanently dark (an Ouronet account is always
Dalos/seed-derived, never a bare pure key; there's no Arweave bitstring to
decrypt-and-compare against a pure key), payment/guard light per the same
step-gating rules (`paymentStepReached`/`guardStepReached`) every other card
already obeys, and guard shows the same member-count the seed cards show
(how many of the guard's current keys are pure keys). "View seed" is
**permanently** disabled — not probe-gated like every other card's button,
unconditionally, since there is no seed entity to ever reveal.

Computing this needs one new pure helper in `seedDashboard.ts`,
`pureKeypairBacksRole(keyOrAddr, pureKeypairs)`, mirroring `findSeedIdForKey`'s
own signature/strip-`k:`-prefix convention but returning a boolean instead of
a seed id, called at the wizard's existing payment/guard attribution call
sites alongside the seed search.

### E — Search + collapsed-by-default grouping in the picker

`CustomKeysetEditor` gains:

- A text `<input>` (test id `legacy-prime-migration-guard-custom-search`)
  filtering the available list by label/seed-name/address substring
  (case-insensitive), above the list.
- The flat `available.map(...)` is replaced by grouping into sections — one
  per seed (`masterChainwebSeedName(i, seed.isPrime, seed.name)`, same
  naming this file already uses) plus one trailing "Pure Keys" section (see
  G) — each a collapsible disclosure (`<button>` toggle + chevron,
  `aria-expanded`), **collapsed by default**, except a section containing at
  least one already-`selectedKeys`-member, which starts expanded (so an
  existing custom keyset's chosen keys are never hidden on open). The filter
  text, when non-empty, force-expands every section with at least one
  matching row (so search results are never hidden behind a collapsed
  section) and collapses sections with zero matches.
- No change to `toggle`/predicate logic — grouping and search are purely
  presentational filters over the same `available` array and the same
  `selectedKeys`/`onChange` contract.

### F — `CodexModalShell` gains a desktop sidebar; wizard always uses it

`CodexModalShell` gains one new optional prop, `sidebar?: React.ReactNode`
(plus `sidebarWidth?: number`, default `260`) — same "omitted renders
byte-identical" convention every prop on this component already follows
(`footer`/`topBar`/`fillBody`/`splitOnDesktop`).

- **Desktop, `sidebar` supplied:** the card becomes a two-column flex row
  below the title bar: a left column (`sidebarWidth`px, its own
  `overflowY: auto`, right border) rendering `sidebar`, and a right column
  that is exactly today's single-column structure (`topBar` region +
  scrolling body + `footer`), unchanged internally. This reuses the existing
  `footerSplit` fixed-header mechanism for the right column's own
  header/body/footer split — `sidebar` simply adds a new outer row, it
  doesn't touch that logic.
- **Mobile, `sidebar` supplied:** rendered inline, stacked, in the same fixed
  region `topBar` already occupies (prepended before `topBar`) — so a caller
  passes `sidebar` once and the shell decides where it lands per viewport;
  no caller-side `useIsMobile` duplication needed.
- **Omitted (every existing caller):** no new column, no behavior change —
  byte-identical to today.

The wizard moves its Settling Dashboard (currently handed to `topBar`) to
this new `sidebar` prop, unconditionally, for every step past `"intro"` (same
gate `topBar` uses today) — applied to the whole wizard, not just the
payment/guard steps, so there is no layout shift mid-flow. `topBar` keeps
just the `continue-blocked` reason line. The wizard's own `maxWidth` widens
(560 → a wider value, e.g. 860, sized to comfortably fit `sidebarWidth` +
the existing step content width) only while `sidebar` is non-empty — i.e.
every step except `"intro"`, matching the existing `topBar` gate exactly, so
`"intro"`'s width is unaffected.

### Alternatives considered

- **E — virtualized flat list, no grouping:** rejected (owner's own pick) —
  a filtered flat list still can't answer "which wallet is this key from" at
  a glance, which matters when hand-picking members of a trust predicate.
- **E — paginated list:** rejected (owner's own pick) — paging while
  building one predicate is clunkier than scroll + filter.
- **F — sidebar only on payment/guard steps:** rejected (owner's own pick) —
  avoids a mid-wizard modal resize, at the cost of narrower-everywhere-else;
  owner chose consistency over narrowness.
- **G — one checkbox-less "Pure Keys" blob in the picker too:** rejected —
  the picker needs real, individually selectable public keys to build a
  predicate; only the *dashboard*'s attribution card collapses to one entry.

## Acceptance criteria

- [ ] `CustomKeysetEditor`'s picker lists every `pureKeypairs[]` entry as its
      own selectable checkbox, labelled with its own label (or "Pure
      Keypair" when unlabelled), in addition to every seed-derived key.
- [ ] The picker shows a search box; typing filters rows by label/seed
      name/address substring, case-insensitive.
- [ ] The picker groups rows into collapsible sections — one per seed, plus
      one "Pure Keys" section — collapsed by default except a section
      containing an already-selected key, which starts expanded.
- [ ] A non-empty search filter force-expands any section with a matching
      row and collapses sections with none.
- [ ] When at least one pure keypair backs the settled payment key and/or
      guard keyset, the Settling Dashboard shows exactly one "Pure Keys"
      card (never more than one, regardless of how many distinct pure keys
      are involved), with account and Arweave tickers permanently dark and
      a permanently-disabled "View seed" button.
- [ ] The Pure Keys card's payment/guard tickers obey the same
      `paymentStepReached`/`guardStepReached` step-gating every other
      dashboard card already obeys.
- [ ] `CodexModalShell` renders a left sidebar column on desktop when given
      a new `sidebar` prop; every existing caller that omits it renders
      byte-identical to before.
- [ ] On mobile, a supplied `sidebar` renders stacked above `topBar` inside
      the existing fixed-header region, not as a column.
- [ ] The migration wizard renders its Settling Dashboard via `sidebar`
      (not `topBar`) on every step past `"intro"`, with the modal visibly
      wider on those steps than on `"intro"`.

## Out of scope

- Mirroring `sidebar` back to `@ancientpantheon/codex-ui`'s own copy of
  `CodexModalShell` — this file already carries other local-only additions
  never synced back (same precedent as `headerExtra`/`dialogTestId`).
- Any change to how payment/guard attribution is computed for seed-derived
  keys — this round only adds the pure-keypair branch alongside the
  existing seed search, it doesn't touch `findSeedIdForKey` or the
  Stoic-Dalos-derive attribution logic from prior rounds.
- Virtualized rendering of very large (1000+) group sections — collapsed
  sections already keep the DOM small; true windowing inside an expanded
  section is a follow-up if it's ever actually needed.
- A dedicated "reveal a pure key's own secret" flow — the Pure Keys card's
  "View seed" stays permanently disabled, full stop; this round doesn't add
  any new reveal modal for pure keypairs.
