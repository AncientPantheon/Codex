# CodexUI mobile — design

Making `@ancientpantheon/codex`'s whole UI surface (`codex-ui` + `codex-ouronet`'s UI +
`codex-arweave`'s panel — everything reachable under `CodexUiRoot`) Pantheonic-mobile compliant:
testable standalone (the playground app), and correctly degrading when embedded inside a bigger
host UI (OuronetUI) that only gives it a portion of the screen.

This follows the canonical spec at
`AncientPantheon/websites/Pantheon/docs/pantheonic-architecture/mobile/README.md` ("Pantheonic
Mobile UI") — read that first; this document is the CodexUI-specific application of it, grounded
in the reference implementation's actual code (`OuroborosNetwork/daimons/OuronetUI`), not just its
description. One genuinely new pattern this surfaced — container-relative framing for an embedded
package — has been folded back into the shared doc (§11 there) so the next conversion doesn't have
to rediscover it.

## 1. The one real architectural difference: container-relative, not viewport-relative

OuronetUI's mobile shell (`MainLayout`) anchors everything to the viewport: the frame height is
`calc(100dvh - var(--mobile-tabbar-h))`, the mobile/desktop split is `useIsMobile()` reading
`window.innerWidth`, the tab bar is `position: fixed` against the *window*. That's correct for
OuronetUI because it **owns the whole screen** — it's the top-level app.

CodexUI is not the top-level app when embedded in OuronetUI (`/app/codex-ui`) — it's handed a
rectangle of screen by a host that also has its own header/sidebar/nav around it. Every fixed-frame
rule from the Pantheonic doc (§0: fixed chrome, one scrolling stage, fixed zones, discrete swipe,
measured fill) still applies — **but every measurement anchors to `CodexUiRoot`'s own box, not the
viewport**:

- **Frame height**: not `100dvh`. `CodexUiRoot` (already the existing `.codex-ui` token-scope
  boundary every assembled component renders inside — `packages/codex-ui/src/ui/CodexUiRoot.tsx`)
  gets `height: 100%; overflow: hidden` and the mobile shell inside it sizes off ITS
  `getBoundingClientRect()`, tracked via `ResizeObserver`, not `dvh` units.
- **Mobile/tablet breakpoint**: not `window.innerWidth < 1280`. An embedded CodexUI can be
  mobile-shaped even inside a desktop-width host page (a narrow sidebar panel, a modal, a split
  view) — the reverse is also true (a phone's OuronetUI could theoretically hand Codex a wide
  strip). The breakpoint must read `CodexUiRoot`'s own measured width via `ResizeObserver`, never
  `window.innerWidth`/a media query. This is the one case in the whole paradigm where "detect with
  `window.innerWidth`, rock-solid" (§8 of the shared doc) is the WRONG tool — element measurement,
  which that same section calls unreliable for OuronetUI's own freshly-laid-out flex trees, is
  exactly right here because there is no other source of truth: the element's box IS the available
  space, the window is not.
- **Standalone parity, for free**: in `apps/codex-playground`, `CodexUiRoot` is mounted filling the
  page, so its measured box equals the viewport and the mobile shell behaves identically to
  OuronetUI's own viewport-anchored one — no special-casing needed, no "am I standalone or
  embedded" flag. One code path, two contexts, verified by construction.
- **Tab-bar riser positioning**: OuronetUI's Controls/footer risers use
  `position: fixed; bottom: var(--mobile-tabbar-h)` against the window. CodexUI's equivalent risers
  must be `position: absolute` against a `position: relative` `CodexUiRoot`, not `fixed` against the
  window — `fixed` would escape the host's rectangle entirely and stick to the browser viewport
  instead of Codex's own area.

Everything else in the Pantheonic doc — the `min-h-0` chain (§2), `SwipeDeck` (§3),
`AdaptiveFit`/`AdaptiveDeck` (§4), the Controls drawer concept (§5), full-screen modals (§7) — is
container-height-relative already (they measure `clientHeight`/`getBoundingClientRect()` of their
own slot, never the viewport directly), so they port with **zero logic changes** — only the outermost
frame needs the container-vs-viewport swap.

## 2. Live-code inventory: what plays each OuronetUI role, and what CodexUI's equivalent is

Read directly from `OuroborosNetwork/daimons/OuronetUI/src/{layouts,components,context,hooks}` —
not from the spec doc alone, per the instruction to learn from the actual implementation.

| OuronetUI piece | What it actually does (from the code) | CodexUI's role-equivalent | Verdict |
| --- | --- | --- | --- |
| `MainLayout` + `MobileHeader` + `MobileTabBar` | Fixed 3-row frame; header carries brand + AncientHub identity + a swipe rail (account card ⇄ debouncer); tab bar is the 7 tier-1 sections + a tier-2 drawer for sections with sub-views + the Controls riser + a footer riser. | `CodexUiRoot` + a new `CodexMobileShell` (header + tab bar) that CodexUI owns outright. | **New component**, same shape, built from Codex's own tab list (`CodexTabsShell.tsx`/`CodexTabs.tsx`), not OuronetUI's `nav-model.ts` (different data). |
| `useIsMobile()` (`src/hooks/use-mobile.ts`) | `window.matchMedia`, breakpoint 1280 (raised from 1024 because iPad Pro portrait is exactly 1024px). | A container-relative rewrite — see §1. | **Ported with a real logic change** (element-measured, not viewport-measured). |
| `HeaderAccountWidget` | ONE active-account switcher: a compact button (name + address + balances) opening a Radix `DropdownMenu` that becomes a full-screen sheet on mobile (`data-mobile-sheet`), listing every account with tap-to-select. | **Does not map 1:1.** Codex has no single "active account" concept — every chain tab (`OuronetAccountsTab`, `ArweaveAccountsArea`) already lists ALL its accounts as rows; there's nothing to "switch" at the header level. | **Do not port.** The mobile header should show identity/lock status (see `MainDebouncer`'s existing `CodexLockCell` concept) rather than force an account-switcher UI that doesn't correspond to anything Codex actually has. Building one anyway to match the visual pattern would invent a false affordance. |
| `MainDebouncer` (`src/components/debouncer/MainDebouncer.tsx`) | A FIXED 4×2 grid of tier medallions (T1–T7 + a Codex-lock cell) — the widget itself never reflows; only its PLACEMENT (swiped alongside the account widget in the header's row 3) is mobile-specific. | `codex-ouronet`'s own `zbom/debouncer/{ZbomDebouncer,CodexDebouncerPanel,DebouncerCircle}.tsx` — **this is already the same widget family**, cloned from the identical OuronetUI debouncer subsystem earlier in this package's history. | **Reuse as-is**, no rewrite — only needs a mobile-header placement decision (see §3). Its OWN internal grid is already the right shape (fixed cells, no adaptive fit needed — confirmed from `MainDebouncer`'s literal `CELL_W`/`CELL_H` constants, no responsive logic at all). |
| `DashboardInfoHeader` | 5 data zones. Phone: one zone per page (`SwipeDeck`, opens on the LAST page — Basic Controls). Tablet (`innerWidth ≥ 700`, own discrete check): 2+3 pages. Each zone registers its action buttons into Controls (data-only in-card, buttons relocated). | No direct equivalent (Codex has no single global "header stats" concept) — but the PATTERN (a `SwipeDeck` of fixed-content zones, tablet-vs-phone page grouping) is exactly what a chain's account-group header (seed name + collapse toggle + balance summary) should use if it ever needs more than one zone. | **Pattern reusable, no direct port** — revisit if/when a chain's Accounts tab grows a multi-zone header. |
| `AccountCards` | `SwipeDeck` of exactly 2 rectangles: (1) `AdaptiveFit`-wrapped `AccountOverview`, (2) an `AdaptiveDeck` grid of token cards (`AssetItem`, `optimalWidth=320 optimalHeight=230`). | **The direct structural analog is each chain's Accounts tab** (`OuronetAccountsTab.tsx`, `ArweaveAccountsArea.tsx`): a per-seed/per-group account LIST is exactly the "grid of cards" `AdaptiveDeck` exists for. | **Primary pilot target** — see §4. |
| `AccountOverview` | Mobile version is a HAND-REWRITTEN compact card (`StatChip`s, one-line addresses, `IconCopyBtn`/`IconStoaExplorerBtn`) wrapped in `AdaptiveFit`; its action buttons (Activate/Claim StoicTag) are pulled OUT of the card and registered into Controls via `useRegisterControls`, shown ONLY when `active` (the visible `SwipeDeck` pane). | Each account ROW in `OuronetAccountsTab`/`ArweaveAccountsArea` today (desktop-only currently) — same shape: identity + balance + a handful of write actions (Send/Stake/Watch/Delete). | **Same recipe**: a compact mobile row rewrite, `data-ghostable` region around its action buttons, `useRegisterControls` wired to a NEW Codex-local Controls context (§5). |
| `AssetItem` (with `data-ghostable`) | Each token card marks its action-button region `data-ghostable`; `useGhosted()` inside decides whether to render them or leave the space collapsed. | Each account row's Send/Stake/Transfer/Collect/Watch/Delete button cluster. | **Direct port of the pattern** — wrap each row's action cluster the same way. |
| `AdaptiveFit` / `AdaptiveDeck` / `SwipeDeck` (`src/components/ui/*.tsx`) | The whole measure-converge-ghost engine + the grid-paginate-by-divisor-trick engine + the snap-scroll primitive. Pure, dependency-free, no OuronetUI-specific imports at all. | Needed everywhere a chain lists more than a couple of accounts, and everywhere a modal/card needs to fill an unpredictable slot. | **Ported byte-for-byte into `codex-ui`** (they have zero external deps beyond React) — this is the single highest-leverage piece of work; everything else is built ON these three. |
| `ControlsProvider` / `useRegisterControls` / `ControlsDrawer` (`src/context/controls-context.tsx`, `src/components/core/ControlsDrawer.tsx`) | A registry keyed by `source`, sorted by `order`, deduped by a content signature so re-registering the same shape doesn't storm re-renders; a full-screen drawer reproducing each button's exact in-card styling. | Ghosted Send/Stake/Watch/Delete/etc. buttons across every chain tab. | **Ported near-verbatim** — this is generic, chain-agnostic infrastructure; only the riser's HOST anchor changes (container-`absolute`, not viewport-`fixed` — see §1). |
| Modals going full-screen (Pantheonic doc §7 — `ZbomLayout`'s `max-height: 82vh` cap fought off, `react-modal`'s default `bottom: 40px` top-anchored away) | ONE shared modal component change flips EVERY transaction modal in the app at once. | `CodexModalShell` (`packages/codex-ouronet/src/ui/internal/CodexModalShell.tsx`, also mirrored in `codex-ui/src/ui/internal/CodexModalShell.tsx` and used by literally every zbom/UrStoa/Send modal, `SendArweaveModal` included) is the EXACT SAME lever. | **Cheapest, highest-leverage single change** — fix `CodexModalShell` once, every modal (Stake/Unstake/Transfer/Collect UrStoa, Send Stoa, Send AR, Rotate\*, Activate\*, Register\*, …) goes full-screen-sheet on mobile simultaneously. Do this FIRST, before the account-deck work — it's self-contained and de-risks the biggest "did we miss a modal" class of bug. |
| Settings / Address Book / Seed Words / Pure Keypairs tabs | Not deck-based at all in OuronetUI's own tracker — these are the "reflow" (mechanical) pages, not "custom". | `codex-ui/src/ui/settings/*`, `codex-ouronet/src/ui/tabs/{AddressBookTab,SeedWordsTab,PureKeypairsTab}.tsx`. | **Plain reflow** (stack vertically, `AdaptiveFit` only where a card is genuinely dense) — no bespoke deck design needed, matches the OuronetUI tracker's own classification for the equivalent settings-shaped pages. |

## 3. The CodexUI mobile shell

`CodexMobileShell` (new), mounted by `CodexTabsShell`/`CodexUiRoot` when the container-relative
`useIsMobile()` (§1) is true:

- **Header**: brand/identity row (thin — Codex doesn't need OuronetUI's AncientHub-login row at
  all) + a swipe rail with exactly what OuronetUI's row 3 has room for: the lock-status cell
  (`CodexLockCell`'s pattern — Codex already tracks `passwordCachedAt`/cache-minutes in its own
  store) swiped alongside `MainDebouncer`'s Codex-cloned equivalent (`ZbomDebouncer`/
  `CodexDebouncerPanel`). No account-switcher row (§2) — there's nothing to switch.
- **Tab bar**: tier-1 = the chain tabs Codex already has (Ouronet Accounts, Arweave, Address Book,
  Settings, …); tier-2 = a chain's own sub-categories where they exist (Arweave's five: Seeds / Pure
  Keys / Accounts / Upload / Library) via the identical tier-2 drawer pattern. The Controls riser
  bulges up from this bar exactly as in OuronetUI, `absolute` against `CodexUiRoot` (§1).
- **Stage**: `<main>` fills the remaining `CodexUiRoot` height, `overflow-y-auto`; whichever tab is
  active renders its OWN fixed-zone content inside it (§2's per-tab breakdown).

## 4. Pilot: a chain's Accounts tab as an `AdaptiveDeck`

The highest-value, most structurally complex conversion — proves the whole engine, matching how
OuronetUI's own Dashboard was the "fully-converted reference" everything else copied (Pantheonic
doc §11). Recommended pilot: `ArweaveAccountsArea.tsx` (smaller, more self-contained than
`OuronetAccountsTab.tsx`'s 910 lines and its seed/pure-key/unassigned three-way grouping — but the
SAME recipe applies to both, and to `OuronetAccountsTab` right after).

1. Each seed's GROUP HEADER (label + count + collapse toggle) is a fixed zone (`flex-none`),
   unchanged — groups don't need adaptive fitting, they're already compact.
2. Each group's account LIST becomes an `AdaptiveDeck`: `renderItem` = a new compact mobile row
   (identity + balance, à la `AccountOverview`'s mobile rewrite), `optimalWidth`/`optimalHeight`
   tuned to that row's comfortable minimum size, `padItem` = a small chain-glyph tile for a
   trailing gap.
3. Each row's Send/Watch/Delete cluster gets `data-ghostable`; when the deck votes to ghost (any
   row can't fit its buttons — §2's `AdaptiveDeck` deck-wide OR), those buttons register into the
   new Codex Controls context instead of disappearing.
4. `SendArweaveModal` (already routes through `CodexModalShell`) goes full-screen automatically
   once §2's modal fix lands — no separate mobile variant needed for the modal itself, only for the
   row that opens it.

## 5. New primitives to add to `codex-ui`

All net-new files, ported from the OuronetUI reference with the container-relative adjustment
(§1) applied only where noted — mirrors this codebase's own established "cloned verbatim, data-seam
swapped" convention already used for `zbom/toast/toastManager.ts` and the `zbom/debouncer/*` family:

- `useIsMobile()` — container-relative (real logic change, not just a data-seam swap).
- `SwipeDeck.tsx`, `AdaptiveFit.tsx`, `AdaptiveDeck.tsx` — verbatim, zero OuronetUI-specific
  dependencies to swap.
- `controls-context.tsx` (`ControlsProvider`/`useControls`/`useRegisterControls`) + `ControlsDrawer.tsx`
  — near-verbatim; riser anchor changes from `fixed` to `absolute` against `CodexUiRoot` (§1).
- `CodexMobileShell.tsx` (header + tab bar) — new, built from Codex's own tab/nav data, not ported.
- `CodexModalShell.tsx` — existing file, gets the full-screen-sheet mobile branch added (§2's
  highest-leverage item) rather than being replaced.

## 6. Testing plan

Same device/width baselines the Pantheonic doc's own conformance checklist (§10) uses — 360px small
Android, 390px phone, 768px tablet, and 1024px iPad Pro portrait — PLUS one CodexUI-specific case
the reference implementation never had to cover: **embedded-container verification**. Render
`CodexUiRoot` inside a deliberately narrow fixed-size div (e.g. 375×640, simulating a host sidebar
panel) on an otherwise-desktop-width (1920px) viewport, and confirm the container-relative
`useIsMobile()` (§1) still correctly engages the mobile shell — proving breakpoint detection tracks
the box, not the window. Standalone testing in `apps/codex-playground` covers the "CodexUiRoot ==
viewport" case for free, per §1.

## 7. Phasing

Mirrors OuronetUI's own proven rollout order (chrome first, then the adaptive engine, then one
deep pilot, then breadth) rather than attempting every tab at once:

1. **Primitives**: `SwipeDeck`/`AdaptiveFit`/`AdaptiveDeck`/container-relative `useIsMobile()`/
   Controls context+drawer, ported into `codex-ui`. No visible change yet — infrastructure only.
2. **`CodexModalShell` full-screen-sheet flip** (§2, §5) — cheap, every modal in the app benefits
   simultaneously. Do this before touching any tab's layout.
3. **`CodexMobileShell`** (header + tab bar) mounted behind the container-relative breakpoint,
   feeding real tab data.
4. **Pilot**: `ArweaveAccountsArea` as an `AdaptiveDeck` (§4) — the reference conversion everything
   else copies, exactly as OuronetUI's Dashboard was.
5. **`OuronetAccountsTab`** (bigger, same recipe) + the UrStoa vault-action buttons through Controls.
6. **Remaining tabs** (Settings, Address Book, Seed Words, Pure Keypairs) as plain reflows — no
   bespoke deck design, per §2's classification.

Each step is independently shippable and testable — this should run as separate nectar plan waves,
not one build.

## 8. Refinement round (2026-09): the real 3-zone `CodexMobileShell`

Superseding §3's sketch with a concrete zone layout, worked out against a live screenshot
walkthrough of OuronetUI's own dashboard (owner-directed) plus the real production mount at
`OuroborosNetwork/daimons/OuronetUI/src/routes/logged-in/codex-ui.tsx` (read directly, not
theorized). This also **supersedes Wave 1's `CodexTabsShell` bottom icon-bar** for the specific
three-tab set `CodexTabs` injects (Ouronet Accounts / Blockchain Accounts / Address Book) — that
shell stays as the package's generic default for any OTHER tab set a future consumer builds, but
`CodexTabs`'s own three tabs now route through the zone layout below instead.

### Zone 1 — the debouncer/account rectangle (top)

The exact rectangle OuronetUI's `MobileHeader` row 3 reserves for its account-card ⇄ timers swipe
rail. Codex's own debouncer (`CodexDebouncerPanel`) is a **peer pane in that same rectangle**, not
a separate stacked block:

- **Embedded in real OuronetUI**: a 3rd swipe pane, "Codex Timers", alongside the existing account
  card and `MainDebouncer` panes — defaulting to shown whenever Codex is the active section. This
  is a HOST-SIDE change (`MobileHeader.tsx` doesn't render anything Codex-owned today, it only
  dims `MainDebouncer` on `codexUiActive`) — filed as a cross-repo request:
  `OuroborosNetwork/daimons/OuronetUI/docs/work/codex-mobile-debouncer-hook/request.md`, and
  flagged directly to the OuronetUI session. Not blocking — Codex-side work proceeds independent of
  when that lands.
- **Standalone playground**: no account card / Ouronet timers exist to swipe between, so Zone 1 is
  just the Codex Timers pane alone — but occupying the SAME structural slot/rectangle, so the two
  contexts share one shape (no "am I standalone or embedded" branching in the layout itself, only
  in what fills the pane — same principle as §1's container-relative measurement).

### Zone 2 — Codex Identity, a `SwipeDeck`

The CodexID surface (`ObservationalCodexIdDisplay` — identity header + Copy/Lock, Standard Public
Key, Smart Public Key, Guard panels, per its current single-scroll card) becomes a `SwipeDeck` of
those same panes, mirroring OuronetUI's own Zone-2/3 card-per-swipe pattern (`AccountCards`, §2's
table). **Constant** across both core-zone regions below — visible whether CodexUI or Settings is
the active core content, exactly as the CodexID card is today (unified into one body card
regardless of `activeView` — see `codex-ui.tsx`'s own body card in the production file above, and
`apps/codex-playground/src/App.tsx`'s equivalent).

### Core zone — the rest of the screen: CodexUI ⇄ Settings

Two regions (unchanged as concepts — `CodexTabs`'s tab content vs `CodexSettingsSection`), but the
switch between them, and `CodexTabs`'s own three tabs, all move OFF persistent chrome:

- **CodexUI ⇄ Settings ⇄ Export ⇄ Import** — no persistent bar. Reachable via the SAME tier-2 drawer
  mechanic OuronetUI's own `MobileTabBar` already uses for a section with sub-items (`openSubs`/
  `tier2Meta`, popping a drawer up from the bar on tap rather than navigating straight through) —
  applied to the outer shell's "Codex" tab, with 4 items instead of that pattern's usual sub-pages.
  "Import" reuses the existing reset→re-upload flow (today's "Load a different codex"), renamed for
  symmetry with "Export".
- **Address Book** → a bottom stripe, same visual family as the Controls riser (§5), opening a
  **full-screen popup** — confirmed, not a one-line drawer (Address Book can be a long list). See
  §9 below for what fills it (the address-book rehaul).
- **Ouronet Accounts / Blockchain Accounts** → two icon-only semicircle buttons docked on the
  left/right screen edges, at the seam between Zone 2 and the core zone (owner noted this seam is
  flexible — could sit lower, at a future zone-3/core seam, if one exists by the time this is
  built). Tapping one switches which of the two is shown in the core zone (a plain binary toggle —
  these are the two Class tabs `CodexTabs` already has, Class 3 (Address Book) having moved to its
  own stripe above).

  **Reference pattern, confirmed live from `claudstermind`'s own mobile cockpit** (`.mc-rail`,
  `dashboard/public/mobile-cockpit.{js,css}`, scoped under `.ws-mobile2`) — the half-disc shape is
  pure one-sided `border-radius` (`--l`: `left:0; border-left:0; border-radius:0 999px 999px 0`;
  `--r`: mirrored), `position: absolute; top: 0; transform: translateY(-50%)` so it straddles the
  seam it's docked to. It floats OVER the zone's corner rather than reserving a content gutter — a
  deliberate fix over an earlier version that sat across the middle of the content and had to be
  paid for with width. Base box 22×64px (their icon-only `--arc` variant is 26×52px — comfortably
  above the ~44px tap-target minimum); `touch-action: manipulation` +
  `-webkit-tap-highlight-color: transparent` for a clean mobile tap; click wires a plain tap
  handler that opens a slide-in panel (`translateX` off-screen → `.open` → `translateX(0)`), a
  CSS-transition slide with no JS animation. Their own explicit design note, worth keeping here
  too: the rails were built as an ADDITIONAL affordance, never the only door — their footer
  controls reach the same two panes. Codex's Address Book stripe (this same section, previous
  bullet) already plays that "other door" role for one of Codex's two semicircle-gated views'
  neighbors — worth double-checking once built that neither Ouronet Accounts nor Blockchain
  Accounts ends up reachable ONLY via its semicircle.

### Status

**Built** (this wave), all tested + typechecked, zero regressions in every consuming package's full
suite:

- `SwipeDeck` (§5) ported into `codex-ui/src/ui/mobile/SwipeDeck.tsx` — logic verbatim, styling
  translated from the reference's Tailwind into this package's inline-style convention.
- `EdgeRail` (the Core-zone semicircle primitive) ported into `codex-ui/src/ui/mobile/EdgeRail.tsx`
  from claudstermind's concrete `.mc-rail` reference.
- Zone 2: `ObservationalCodexIdDisplay` (`codex-ui`) now renders its identity-overview +
  Standard/Smart Public Key + Guard panes as a `SwipeDeck` on mobile (the desktop "details"
  disclosure toggle is unaffected — mobile just doesn't have a toggle any more, since swiping
  already reveals every pane).
- Core zone: `CodexTabs` (`codex-ouronet`) supersedes `CodexTabsShell`'s generic bottom bar for its
  own three tabs on mobile — two `EdgeRail`s (Ouronet Accounts / Blockchain Accounts) + an Address
  Book bottom stripe opening a full-screen `CodexModalShell` popup (reusing the existing
  full-screen-sheet mobile flip, no new popup mechanism needed).
- Zone 1 + the Codex-tap tier-2 menu: `apps/codex-playground`'s `App.tsx` (Zone 1: the debouncer
  alone in its own rectangle, above Zone 2) and `OuronetShellMock.tsx` (tapping "Codex" in the
  outer 7-icon bar opens a 4-item menu — Codex UI / Settings / Export / Import — reusing OuronetUI's
  own tier-2-drawer mechanic; Export/Import replace the earlier turn's Controls-drawer relocation of
  the same two buttons, which is what design.md's own §8 Core-zone bullet calls for instead).
- The Address Book Tier 1/Tier 2 rehaul (§9) — done, see that section.

**Not yet built**: the real embedded-OuronetUI side of Zone 1 (the 3rd "Codex Timers" swipe pane in
`MobileHeader`'s own rail) — filed as a cross-repo request, queued on the OuronetUI session's side,
not blocking anything here. `AdaptiveDeck`/the account-list-as-deck pilot (§4) hasn't been started —
today's Ouronet/Blockchain Accounts panes still render their existing (desktop-shaped) content
inside the new EdgeRail-switched core zone, not yet reflowed for a phone-width list.

### Zone 3 feedback round (2026-09): separation, 12-per-page, adaptive swipe, icon badges

Six owner-flagged corrections to the Zone 3 round above:

1. **Zone 3 no longer sits flush against the stripe row** — `.cxpg-zone3`'s bottom margin grew
   from 14px to 28px (the risers' own ~18px height + the SAME 10px gap Zone 3 already keeps
   from Zone 2 above it), so there's real separation instead of touching it.
2. **The fixed button row is now 4 filters LEFT + 2 spawn actions RIGHT** (a `flex: 1` spacer
   between them, mirroring desktop's own `marginLeft: "auto"` split) — Expand All is DROPPED
   from mobile entirely (row expansion is already disabled there, so a toggle for it had
   nothing to do).
3. **`ACCOUNTS_PER_PAGE` is now 12** (was 10, on BOTH desktop and mobile) — 10 didn't split
   evenly into a 2-swipe mobile layout (6 + 4); 12 divides cleanly.
4. **The mobile swipe split is now ADAPTIVE, not fixed** — a new `useSwipeDivisor` hook
   (ResizeObserver + `clientHeight`, the same measurement technique `CompactHalf`/
   `MiddleEllipsis` use elsewhere) picks the LARGEST of `[12, 6, 4, 3]` (fewest swipes) that
   actually fits Zone 3's measured height, exactly the owner's own "6+6, or 4+4+4, or 3+3+3+3
   for smaller displays" spec. The CodexPrime pinned row + "Other … accounts" separator (only
   present on swipe-pane 0) shrinks the CANDIDATE POOL for that one pane specifically
   (`MOBILE_PRIME_EXTRA`), so the chosen divisor is safe for every pane, not just the plain
   ones — "we need to account for the line separating the Codex Prime account."
5. **`AccountRow` gained a `compact` prop** — Prime/Standard-Smart/Selected/Active-Inactive
   render as small icon badges (`IconBadge`, `title`/`aria-label` carrying the full text)
   instead of text pills on mobile; Standard/Smart reuse the EXACT `User`/`Sparkles` icons the
   filter row already uses, per the owner's own directive. StoicTag/APOLLO badges are
   unchanged (not named in the directive). Desktop is untouched either way (`compact` defaults
   `false`).
6. **`EdgeRail` gained an `edge: "top" | "bottom"` prop** (default `"top"`, every existing
   caller unaffected) — the owner flagged the Ouronet/Blockchain Accounts semicircles as
   "locked in Zone 3" (docked at ITS top corner, i.e. visually inside the bordered box).
   `CodexTabs` now docks them at `edge="bottom"` instead — straddling the SAME new separation
   gap from point 1, "the perfect place," mirroring the room OuronetUI's own dashboard leaves
   below its equivalent card for exactly this.

### Zone 3 feedback round #2 (2026-09): full-body escape hatches for the rails + Spawn, prime colour-coding, tighter spacing

A second round of owner-flagged corrections, comparing OuronetUI's own dashboard (generous gap
below its "Account Overview" card) and claudstermind's real `.mc-rail` reference against the
round above:

1. **Even `edge="bottom"` still wasn't enough — the rails needed to leave Zone 3 entirely.**
   `edge="bottom"`'s 26px overhang (half the rail's own 52px height, via `translateY(50%)`) was
   competing with the riser stripe's ~18px for the SAME 28px margin — a 2px margin of error that
   read as "still too little room." The owner's own framing: "the side buttons are tied into
   zone 3, which is incorrect... they should look like on the claudstermind mobile
   implementation, docked to the screen, on top of everything, shown in their entirety." Fix:
   `EdgeRail` gained a THIRD `edge: "middle"` mode (vertically centers against its anchor,
   `top: 50%; transform: translateY(-50%)`, no seam-straddling), and `CodexTabs` gained a
   `fullScreenPortalTarget` prop — when supplied, the two EdgeRails portal OUT of Zone 3
   entirely into that full-mobile-body node (the SAME `.cxpg-modal-portal-root` node
   `ObservationalCodexIdDisplay`'s `fullScreenPortalTarget` already uses in Zone 2), so they are
   never clipped by, or bounded to, Zone 3's own frame/overflow again. Omitted (the default)
   falls back to the ORIGINAL `edge="bottom"` inline rendering — safe for any consumer (or test)
   that hasn't wired a target.
2. **The Spawn interface now opens full-screen too.** "When clicking the spawning of new
   accounts, doing so shows the spawning interface, on the whole screen, not only on zone 3."
   `OuronetAccountsTab` gained the SAME `fullScreenPortalTarget` prop (forwarded from
   `CodexTabs`, threaded down `App.tsx` → `ForeignChainsWiring` → `CodexTabs` →
   `OuronetAccountsTab`, mirroring `paginationRiserTarget`'s own chain exactly); when supplied,
   `SpawnAccountModal` portals there instead of mounting inline inside Zone 3's frame.
3. **A real gap between the fixed button row and the account entries.** "The buttons on the top
   sit flush to the account entries, this is a no go, must have some sort of spacing between
   them." Added `marginBottom: 10` to the button row.
4. **The CodexPrime separator bar is gone — colour-coding carries the designation instead.**
   "Note how entries sit at different levels, due to the bar separating the prime account — that
   bar needs to be removed, and the prime account must be designated as such via colour coding...
   for swipes the entries must sit... at the same level." `PrimeSeparator` is no longer rendered
   on mobile (desktop unchanged) — `AccountRow`'s own existing per-row `rowBorderColor`/
   `rowBgColor`/`nameColor` already colour-codes CodexPrime (gold) and APOLLO-prime (Apollo
   accent) rows distinctly, so nothing new was needed there. `useSwipeDivisor`'s prime-row height
   carve-out (renamed `MOBILE_PRIME_ROW_COST`) now accounts for exactly the pinned row(s)' OWN
   height instead of a `+ 28` separator-bar estimate, which is what makes every swipe pane's row
   COUNT uniform again ("at the same level") now that the uneven-height separator is gone.

### Zone 3 round (2026-09): the Ouronet Accounts tab, encircled + swipeable + paginated

Zone 3 (the core zone) is now its OWN encircled area (`.cxpg-zone3` gained a real border/
radius, matching OuronetUI's own bordered "Account Overview" card) instead of a borderless
scroll region. Inside it, `OuronetAccountsTab` gained a real mobile shape, mirroring the
Zone1/Zone2 fixed-row + swipeable-content pattern:

- **A fixed, single-line icon-only button row** (`flex: none`) — the Standard/Smart/Single
  API/Dual API filter tabs + Spawn Standard/Spawn Smart + Expand All, all condensed to icon
  medallions (`MobileFilterIconBtn`) instead of desktop's wide labeled buttons. Never scrolls
  away.
- **Two-level pagination**: the EXISTING outer pagination (`ACCOUNTS_PER_PAGE = 10`) is
  unchanged, but its Prev/Next cluster now portals to a NEW middle riser slot
  (`.cxpg-osm-pagination-riser-slot`), centered between the Controls and Address Book risers,
  flush against the tab bar — same `addressBookRiserTarget` contract, threaded the same way
  (`App.tsx` → `OuronetShellMock` → `ForeignChainsWiring` → `CodexTabs` →
  `OuronetAccountsTab`). WITHIN one outer page, a NEW inner split
  (`ACCOUNTS_PER_SWIPE = 5`) breaks the ≤10 accounts into a `SwipeDeck` of 5-account panes —
  the owner's own "10 per page → 5 and 5 via 2 swipe pages" spec.
- **Row expansion is disabled on mobile** (`AccountRow` gained an `expandable` prop, default
  `true`/desktop-unchanged) — the owner's own directive is that the detail breakdown "must be
  shown on the whole screen... instead of expanding it on Zone 3", explicitly filed as the
  NEXT refinement step. Building that full-screen expand view is NOT done yet — this round
  only makes sure the OLD (Zone-3-breaking) inline-expand behavior doesn't ship in the
  meantime.

Single/Dual API sub-tabs get a plain scrollable mobile treatment (no swipe/pagination — they
don't share the 10-per-page pagination concept the Standard/Smart lists do).

**Not yet built**: the full-screen account-detail expand view (explicitly the next round, per
the owner). Account rows' OWN internal badge layout (name + Prime/StoicTag/Standard/APOLLO/
Selected/Active pills) is unchanged and may still wrap awkwardly at narrow widths — out of
scope for this round, which was about the outer zone/pagination/swipe structure, not each
row's internal responsiveness.

### Correction round (2026-09): fixed-frame geometry + Zone 2 rebuild

The first pass got the PIECES right but the GEOMETRY wrong — owner-flagged and fixed:

- **Zone 1 / Zone 2 are genuinely reserved now**: `apps/codex-playground/src/App.tsx`'s mobile body
  is a real fixed-frame flex column (`.cxpg-container--mobile`) — Zone 1 (`flex: none`) → its
  separator → Zone 2 (`flex: none`) → Zone 3 (`flex: 1; min-height: 0`, the ONLY scrolling region).
  Previously Zone 1/2 lived inside the same scrolling block as Zone 3 and scrolled away with it.
- **`CodexTabs`' `EdgeRail`s are anchored to the right box now**: its own root div is the bounded,
  non-scrolling frame (`height: "100%"`, filled exactly by Zone 3's slot); only an INNER child
  scrolls (`flex: 1; min-height: 0; overflow-y: auto`). The rails, as direct children of the outer
  (non-scrolling) frame, stay pinned regardless of how far the inner content scrolls — mirrors
  claudstermind's own rail-anchored-to-a-non-scrolling-zone relationship.
- **Address Book is a small right-side riser now**, not a full-width bottom bar — same visual family
  as the Controls riser, mirrored to the opposite corner.
- **The Codex-tap tier-2 menu is one row of icon+label cells** (`grid-auto-flow: column`), matching
  `MobileTabBar`'s real markup — was 4 stacked full-width rows.
- **Zone 1 shows one static dot** (`SwipeDeck`'s new `showSingleDot` prop) — the same structural
  shape a real embedded host's 2-pane rail has, just with one pane.
- **Zone 2 rebuilt**: bounded to a fixed box (`.cxpg-zone2`, `height: 190px`) matching OuronetUI's
  own card proportions — `ObservationalCodexIdDisplay`'s root fills it exactly (`height: "100%"` on
  mobile) and its title row (`flex: none`) + `SwipeDeck` (`flex: 1`) split that fixed height, instead
  of growing with content and overflowing the box. The Lock control ghosts into Controls (a NEW
  `useControlsOptional`/`useRegisterControlsOptional` pair in `controls-context.tsx` — a safe,
  non-throwing variant, since this component is also mounted in real production OuronetUI today
  with NO `ControlsProvider` ancestor; falls back to inline rendering there instead of vanishing).
  `PublicKeyFieldBox`/`GuardFieldBox` gained a `compact` mode (one line, CSS end-ellipsis, icon-only
  Reveal Seed) so nothing pokes out of the pane. The Guard pane gets a bounded/scrollable preview
  plus a "Show CodexID Guard" Controls entry opening the same content full-screen. Reveal Seed now
  actually works — `renderViewSeedModal` is wired to the real `ViewSeedModal` (newly exported from
  `codex-ouronet`'s barrel), the exact same secret-reveal UI a real Ouronet account uses, full-screen
  on mobile for free via `CodexModalShell`'s existing flip.
- **A real infinite-loop bug** was caught and fixed in the new `useRegisterControlsOptional` hook
  mid-build (a register→unregister ping-pong from depending on the whole Controls-context object
  instead of its individually-stable `register`/`unregister` functions) — verified via a hung test
  run, root-caused, fixed, and re-verified clean.

## 9. Address Book rehaul: Tier 1 / Tier 2 categories

The Address Book (`AddressBookTab.tsx`, `packages/codex-ouronet/src/ui/tabs/`) is today a flat
4-tab strip (`TAB_ORDER = ["ouronet", "stoa", "stoic-tag", "arweave"]`). Owner-directed rehaul into
two Tier 1 categories, each with exactly two Tier 2 sub-categories:

- **Ouronet**
  - **Accounts** — today's `"ouronet"` `AddressKind` (Ѻ. addresses), unchanged.
  - **StoicTags** — today's `"stoic-tag"` `AddressKind`, unchanged.
- **Foreign Blockchains**
  - **Chainweb** — today's `"stoa"` `AddressKind` (k:/c:/w:/u: addresses, `STOACHAIN_CHAIN_ID =
    "kadena:mainnet"`), display-relabeled from "StoaChain™" to "Chainweb". Grounded directly in the
    production mount (`codex-ui.tsx`): `CodexTabs`'s OWN "Blockchain Accounts" Class already groups
    Seed Words / Pure Keys / Stoa Accounts under a foreign-chain rail entry literally id'd
    `"chainweb"` (`CHAINWEB_ONLY_CHAINS`/`ChainwebPanel`) — the exact same underlying chain as the
    `"stoa"` `AddressKind`, just reached via the Ouronet-branded path vs the generic multi-chain
    path. This rehaul only extends that SAME existing Ouronet-vs-foreign split into the Address
    Book's own categorization — it does not invent a new one.
  - **Arweave** — today's `"arweave"` `AddressKind`, unchanged, re-parented out of the flat
    top-level strip.

**No `AddressBookEntry.type` union change, no data migration** — `"ouronet" | "stoa" | "stoic-tag" |
"arweave"` is unchanged (persisted entries stay valid as-is); this is purely a presentation-layer
Tier 1 / Tier 2 nav on top of the same four kinds. Layout (owner left to implementor's judgment):
the Tier 1 / Tier 2 selector sits at the top, the existing search bar + "Add {kind}" button
underneath — i.e. one extra nav level above the CURRENT tab-strip position, not a replacement for
the search/add row. This whole rehaul lives inside the Address Book's new full-screen popup (see
§8's Core-zone bullet above) — it is not shown inline in the core zone any more.
