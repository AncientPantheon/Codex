# Changelog

## 0.8.0 — 2026-09-26

**MINOR — `ForeignChainsTab` gained an optional `chainLabels` prop. Owner
ruling: "Chainweb that we are supporting now, is basically Stoa-Chainweb,
but it isnt named as such, so it should be named, Stoa-Chainweb."**

- The shell's own auto-derived rail label (`chainLabel()`) only title-cases
  the FIRST character of an id — correct for a single word ("arweave" →
  "Arweave"), wrong for a hyphenated one ("stoa-chainweb" would render
  "Stoa-chainweb", lowercase second word). Renaming the underlying rail id
  itself was rejected as unnecessarily risky for a cosmetic ask (ids are
  referenced by tests/persisted state); `chainLabels?: Record<string, string>`
  lets a consumer override the DISPLAYED text for specific ids while every
  id absent from the map keeps the original auto-capitalize behavior —
  fully backward compatible, the shell stays id-blind either way (it never
  branches on what an override MEANS, only on whether one was supplied).

**PATCH — `ExperimentalCurvesCard` retired as a toggle. Owner ruling: "the
Apollo Curve is always on because it represents both Pythia APIs and Codex
halves. so its graduated from experimental to in use. so the page at
advanced must reflect this."**

- The card's own copy already said Apollo was unconditionally available
  regardless of the toggle, but it still rendered a clickable "Enable/Disable
  Experimental Curves" button wired to `uiSettings.experimentalCurvesEnabled`
  — actively misleading, since clicking it flipped a flag nothing reads
  anymore and implied a control the user does not actually have.
- Now a static status display: a "Graduated · Always On" badge (success
  color) plus explanatory copy — no button, no store read/write. The
  underlying `uiSettings.experimentalCurvesEnabled` flag and its `false`
  default are untouched (`@ancientpantheon/codex-ouronet`'s `types/entities.ts`)
  — still reserved as an inert seam for a genuinely future experimental
  curve, per the original design; only this card's presentation changed.

## 0.7.0 — 2026-09-25

**MINOR — `CodexModalShell` gained an optional `zIndex` override prop
(defaults to 9999, every existing caller byte-identical), and
`CodexPasswordPrompt` now uses it. Owner-reported bug: a signed action on a
locked codex hung forever on "Processing…" with no visible unlock dialog.**

- **Root cause**: a ZBOM action modal (`codex-ouronet`'s `ZbomModalFrame`,
  z-index 10050) calls `ensureCodexUnlocked()` / `requestPassword()` from
  INSIDE itself when the codex is locked, opening `CodexPasswordPrompt` — a
  `CodexModalShell` at the shared default z-index of 9999. Opened from
  inside an already-open, higher-z-index ZBOM modal, the prompt rendered
  INVISIBLY BEHIND it: the promise the caller was awaiting could never
  resolve because the user could never see or reach the password input.
- **Fix**: `CodexPasswordPrompt` now passes `zIndex={2147483647}` — the
  same "always topmost" sentinel already used elsewhere in this codebase for
  "must win the stack over literally everything" popups — so the global
  password prompt can never again render invisibly behind whatever modal
  triggered it, regardless of that modal's own z-index.
- New regression tests (`ui-codex-password-prompt-zindex.test.tsx`, and a
  new describe block in `ui-codex-modal-shell-mobile.test.tsx`) lock in both
  the default (9999, unchanged) and the override behavior.

## 0.6.0 — 2026-09-24

**MINOR — new shared mobile-UI primitives underpinning Pantheonic-mobile
compliance across the whole `@ancientpantheon/codex` UI surface. No
breaking changes. Still `"private": true` — internal interface layer.**

- **`useIsMobile` / `MobileContext`** — container-relative mobile detection
  (reads `CodexUiRoot`'s own box via `ResizeObserver`, not the viewport),
  the architectural difference from OuronetUI's own viewport-relative
  `MainLayout`: this package is handed a rectangle of screen by a host, not
  guaranteed the whole window.
- **`SwipeDeck`** — paginated/gesture swipeable panes with
  `useSnapScrollCorrection` for reliable snap-to-page behavior.
- **Controls riser/drawer pattern** (`controls-context.tsx`,
  `ControlsDrawer.tsx`) and **`EdgeRail`** — the shared mobile chrome
  primitives every packaged tab's mobile layout composes from.
- **`MobileCategoryIconBtn`** — the icon-only sticky category/sub-tab button
  shape reused across every mobile tab bar in `codex-ouronet`/`codex-arweave`.
- **`CodexModalShell`**: mobile flip to a full-bleed, full-screen sheet
  (`position: absolute`, anchored to the nearest `CodexUiRoot`, no rounded
  corners/max-width cap) — every modal built on this shell inherits it for
  free. New `footer`/`topBar`/`fillBody` slots split a mobile popup into a
  fixed header, an independently-scrolling body, and a footer pinned to the
  card's own bottom edge.
- **`CodexTabsShell`**, **`ObservationalCodexId`**, **`CodexLockControl`**,
  **`CodexIdField`**: mobile-specific layout passes (full-width controls,
  icon-first badges, condensed spacing) to match the same compliance pass.

## 0.0.1 — 2026-07-04

- Initial package skeleton: empty ESM entry point (`export {};`), layered tsconfig with browser support (`lib: ["ES2023", "DOM"]` + `jsx: "react-jsx"`), build/typecheck/test/clean scripts, and vitest config. Marked `"private": true` — internal interface layer, never published to npm.
