# Changelog

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
