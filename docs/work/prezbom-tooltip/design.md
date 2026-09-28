# Pre-ZBOM Tooltip — Design

## Problem

Hovering a button that opens a ZBOM gives no preview of what it will actually call —
no function name, no declared parameters, no cost. OuronetUI already shipped this
(`ExecutionHint`/`ExecutionTooltip`, per `HANDOFF-prezbom-tooltip-CODEX.md`): hover a
launcher, see the entrypoint, its declared parameters, the arguments positionally
against them, and a live `/local` cost preview — "if the cost renders, the whole path
resolved: names, arity, types." It's a verification engine, not decoration. Codex has
no equivalent on any launcher today (confirmed live: `ExecutionTooltip.tsx` already
exists in `codex-ouronet` but is wired only onto a ZBOM's OWN execute button and its
Zone 2 header label — never onto the button that opens the ZBOM in the first place).
Separately, the per-consumer settings zone (`IConsumerSettings`) that this toggle
must live in is real and sound but has never been written to by anyone (confirmed
live: zero production `updateConsumerSettings` call sites anywhere in this
workspace) — this is the first feature to use it.

## Investigation already done (informs scope below)

**Consumer-settings zone**: `IConsumerSettings`/`getConsumerSettings`/
`updateConsumerSettings` live in `codex-ouronet`'s Zustand store (confirmed in the
prior `talos-registry-migration` round), exposed via `codex-ui`'s
`useConsumerSettings(name)` hook. Confirmed fresh: the only production reference to
any consumer name is `"OuronetUI"`, and it is only ever **read** (a debug-style
`ConsumerSettingsCard`, read-only by its own doc comment) — nothing writes under any
name, anywhere. The registry is unclaimed; there's no collision risk picking a name.

**`ExecutionTooltip.tsx` already exists in `codex-ouronet`** (`src/zbom/cfm/
ExecutionTooltip.tsx`) but is built on the OLD mechanism — a generated Pact-signature
manifest (`pactSignatures.generated.ts`) + this package's own `pactRead` — not
`@ouronet/talos-registry`. It's wired in exactly two places, both INSIDE an
already-open ZBOM: `ZbomLayout.tsx`'s own execute button, and `Zone2Wrapper.tsx`'s
header label. Per the brief's own ruling ("the tooltip belongs on the LAUNCHER, not
the ZBOM's own execute button — inside a ZBOM the information is already on the
page"), this migration is explicitly out of scope for this topic — those two sites
stay as they are. `ActionTooltip.tsx` (the Radix hover/portal shell
`ExecutionTooltip` builds on) lives at `src/zbom/ui/ActionTooltip.tsx`, is already
lazy-mounting (Radix `Tooltip.Content` unmounts its children when closed — confirmed
by reading its source), and is reused elsewhere in the package. This is the right
hover primitive to reuse for the new launcher tooltip too — it already gets the
pointer-events/positioning correctness the brief's 4th trap warns about, for free,
without reimplementing OuronetUI's own hand-rolled portal.

**Every ZBOM-opening launcher, re-verified live** (12 total, 3 files):

| File | Launchers | Registry key available? |
|---|---|---|
| `OuronetAccountsTab.tsx` | Rotate Payment Key, Rotate Guard, Release/Register StoicTag, Rotate Sovereign, Rotate Governor, Activate Standard, Activate Smart (7 distinct entrypoints; Release/Register share one op-family) | **No** — hand-built `functionName=` string literal only, no exported `_KEY` constant (these 8 belong to talos-registry-migration's still-unshipped "Topic 2 — codex-rotate-ops") |
| `OuronetAccountsTab.tsx` | Deploy Apollo Pythia Key | **Yes** — `DEPLOY_API_KEY_KEY` from `pythia/deployApiKey.ts` |
| `SingleApiPanel.tsx` | Link | **Yes** — `LINK_DUAL_API_KEY_KEY` from `pythia/linkDualApiKey.ts` |
| `DualApiPanel.tsx` | Rename lane, Revoke | **Yes** — `RENAME_DUAL_LANE_KEY`/`REVOKE_DUAL_LINK_KEY` from `pythia/dualLinkOps.ts` |

8 of 12 launchers don't yet have an exported registry-key constant. Per the brief's
own reference pattern (`<ExecutionHint entrypoint="TS01-C3.SWP|C_ToggleSwapCapability">`
— a bare string literal, not an imported constant), this doesn't block coverage: the
new tooltip component takes an `entrypoint` PROP (a string), resolved live against
`@ouronet/talos-registry` at render time (`tryGetEntrypoint`), and fails open with a
deduped console warning on an unknown key — exactly like the brief's own reference.
So all 12 launchers get wrapped in this topic, 4 using the existing exported
constants and 8 using the literal key string (each one verified live against the
registry before being written into source, and re-verified by this topic's own
enforcement test — see Acceptance criteria).

**Confirmed out of scope**: `src/components/{RotateGuardModal,RotatePaymentKeyModal,
RotateSovereignModal}.tsx` (the legacy headless-render-prop family) — re-confirmed
zero in-package JSX render sites; they're only ever launched by an EXTERNAL
consuming app supplying `ModalComponent` as a prop (`codex-ui`'s `RotateModals.tsx`
wraps them for exactly this). A launcher-coverage test scoped to buttons inside
`codex-ouronet` can't reach a button that doesn't exist in this package.

## Approach

**New, talos-registry-native component tree — not a reuse of `ExecutionTooltip.tsx`.**
That component's argument-rendering is fundamentally hand-built-string-shaped
(`ExecutionSpec.args: string[]`, pre-rendered Pact literals the CALLER computes) —
reusing it would mean hand-rendering Pact literals myself again, exactly what this
migration exists to stop doing. New files:

- **`PreZbomHint.tsx`** (`src/zbom/cfm/`) — the hover wrapper. Takes `entrypoint`
  (string key) + optional `values` (real values, keyed by the PREVIEW's own param
  names — never the exec's) + `children`. Reads the new setting; renders `children`
  alone when off, on mobile (no hover), or when the entrypoint doesn't resolve.
  Wraps `ActionTooltip` (existing, reused as-is) with a `PreZbomTooltipCard` as its
  `content`. Declared at MODULE SCOPE (never inline inside another component's
  render body — the brief's 4th trap: a component declared inside a render function
  gets a new identity every render, which is a new TYPE to React, which unmounts and
  remounts the whole subtree on every parent re-render — exactly what caused
  OuronetUI's flicker).
- **`PreZbomTooltipCard.tsx`** (or co-located in the same file) — the render body.
  Resolves `getEntrypoint(entrypoint)` for the declared EXEC signature (shown as a
  reference line, matching the brief's "arguments belong to the PREVIEW, not the
  execution" layout: exec signature on its own line, preview params below). Resolves
  `getPreview(entrypoint.preview)` for the preview's OWN param list. Builds the
  merged values object **by preview param name**: `ghost.args[previewParamName] ??
  "example"` as the base (ghost args are keyed by EXEC names — a name that happens
  to match on both sides, e.g. `patron`, resolves correctly; one that doesn't falls
  back to the registry's own `"example"` placeholder convention, never a guess),
  overridden by caller-supplied real `values`. Renders via `buildPreviewCall(execKey,
  mergedValues)` — never a hand-built string. Skips firing the live read entirely
  when every value is the `"example"` placeholder (mirrors the brief's own
  `isPlaceholder`/ghost-count-gate — an all-ghost call is a foregone refusal, not
  worth the latency), showing "no cost preview — no live example on chain" instead
  of a confusing raw error.
- **`usePreZbomPreview.ts`** (or a hook inside the same file) — the live-read
  effect. Keyed on the RENDERED CALL STRING (`buildPreviewCall`'s own output),
  computed in the render body and passed as the effect's dependency — never a
  `values` object literal (the brief's 3rd trap: an inline object is a new identity
  every render, so keying an effect on it re-fires the read every render, which sets
  state, which re-renders, forever). Debounced ~250ms, cached in a `Map` keyed on
  the same call string (repeated hovers of the same button with the same values
  reuse the cache). Uses this package's own `pactRead` seam (`@stoachain/stoa-core/
  reads`) — the same one `ExecutionTooltip.tsx` and every other live read in this
  package already uses; no new transport.

**Setting**: `usePreZbomTooltipSetting()` — mirrors OuronetUI's
`useCodexBackedSetting` shape but adapted to Codex's own architecture. Unlike
OuronetUI (a separate app syncing a live Redux copy from the codex via a bridge
component), Codex's settings UI reads directly from the SAME Zustand store the
preference is persisted in — there's no second "live copy" to bridge, so no
`CodexDataBridge`-equivalent is needed; `useConsumerSettings(CONSUMER_NAME).entry
?.settings?.preZbomTooltip ?? true` IS the live, reactive read, already hydrated by
the store's own `init()`. The setter still follows the brief's two hard rules
exactly: **merge, never replace** (`{ ...(existing?.settings ?? {}), preZbomTooltip:
next }`) and **never lower schemaVersion** (`Math.max(existing?.schemaVersion ?? 0,
OWN_SCHEMA_VERSION)`) — and the write-back lives in the setter itself, not a watcher
on the live value (a watcher can't tell a user's change from a hydration and would
write back what it just read).

**Consumer name — `"Codex"`, via a new optional `consumerName` prop on
`CodexProvider`, not a hardcoded literal.** `@ancientpantheon/codex` is a library
other apps besides the reference `codex-playground` will eventually embed (already
established in this session: `CodexProvider` currently has zero app-identity
concept). Hardcoding `"Codex"` inside the package would mean every future embedding
app collides on the same settings slot the moment a second one appears — silently
defeating the whole point of per-consumer namespacing, which is the exact thing this
feature is supposed to demonstrate ("on in one app, off in the other, one codex").
The prop defaults to `"Codex"`, so today's only consumer (`codex-playground`) needs
no change and gets exactly the separation the brief describes.

**Wiring**: each of the 12 launcher buttons gets wrapped in `<PreZbomHint
entrypoint="...">`. The 4 already-migrated ones use their exported `_KEY` constant;
the 8 not-yet-migrated ones use the literal string already present in each modal's
own `functionName=`/doc-comment (each individually re-verified live against
`tryGetEntrypoint` before being written, per Acceptance criteria — not assumed
correct just because it's already in a comment).

**Enforcement**: a new test, source-text-scan style (mirrors OuronetUI's own
`prezbom-tooltip.test.ts`, adapted to this package's actual launcher shape — a
shared `activeOpId`/`opModal` state setter per launcher, not JSX-attribute
`entrypoint=` on a shared button component the way OuronetUI's `ActionBtn` pattern
works). Walks every state-setter call in the 3 launcher files, excludes closes
(`setActiveOpId(null)`, `useState` declarations), and fails on any OPEN call not
textually inside a `<PreZbomHint>` region. A second test walks every `entrypoint=`
string literal used across the 3 files through `tryGetEntrypoint` (imported directly
from `@ouronet/talos-registry`) and asserts each resolves — so the next chain rename
fails this suite, not a user's tooltip.

## Acceptance criteria

- [ ] Hovering any of the 12 ZBOM-opening launcher buttons (desktop only) shows the
      entrypoint's declared EXEC parameters, the PREVIEW's own parameters with
      merged real/ghost values (never positionally mismatched against the exec
      signature), and a live cost preview that fires a real `buildPreviewCall`-built
      `/local` read — not a static string.
- [ ] The tooltip does NOT appear on any ZBOM's own execute button or Zone 2 header
      (those keep using the existing `ExecutionTooltip.tsx`, untouched).
- [ ] A "Pre-ZBOM Tooltip" toggle exists in Codex's ZBOM settings, default ON;
      turning it off stops the live read from firing at all (not just hides the
      UI) and the setting persists under `consumerSettings["Codex"]` (or whatever
      `CodexProvider`'s `consumerName` prop is set to), not `"OuronetUI"`.
- [ ] A write to the setting merges into the existing `settings` payload (doesn't
      drop unrelated keys) and never lowers the stored `schemaVersion`.
- [ ] Reloading the app reads the persisted setting back — the preference survives
      a refresh.
- [ ] `grep -rn` for every launcher's open-call across the 3 files, minus comments
      and close-calls, shows zero calls NOT textually inside a `<PreZbomHint>` —
      enforced by a test, not manual review.
- [ ] Every `entrypoint=` string literal used across the 3 files resolves via
      `tryGetEntrypoint` against the live installed `@ouronet/talos-registry` —
      enforced by a test.
- [ ] Typecheck clean, full suite green, across `codex-ouronet` and the aggregator.

## Out of scope

- Migrating `ExecutionTooltip.tsx` itself (the ZBOM-internal execute-button /
  Zone 2 tooltip) off `pactSignatures.generated.ts` onto talos-registry — explicitly
  a different surface per the brief's own "not the ZBOM's own execute button"
  ruling; a separate, future topic if ever wanted.
- Exporting registry-key constants for the 8 not-yet-migrated rotate/activate/
  stoic-tag entrypoints (that's talos-registry-migration's own "Topic 2 —
  codex-rotate-ops", tracked separately) — this topic only needs the KEY STRINGS,
  verified live, not the constants; wiring those constants in later is a drop-in
  swap for whoever picks up Topic 2, not a blocker here.
- The legacy `src/components/{RotateGuardModal,RotatePaymentKeyModal,
  RotateSovereignModal}.tsx` headless family — zero in-package launchers, nothing
  for a coverage test scoped to this package to wrap.
- A UI toggle for switching the Kadena balance source (REST vs. Pact) mentioned in
  an earlier unrelated round — untouched here.
- Mobile: no touch equivalent is built (matches OuronetUI's own "mobile keeps the
  ZBOM, which shows the same information once opened" reasoning) — the existing
  `useIsMobile()` gate already used elsewhere in this package applies.
