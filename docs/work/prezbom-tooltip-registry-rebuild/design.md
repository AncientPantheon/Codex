# prezbom-tooltip-registry-rebuild — Design

(Topic 1 of 3 in `docs/work/codex-tooltip-v2/design.md` — read that first for the full picture.)

## Problem

`@ouronet/talos-registry` upgraded to 1.2.0 (installed via `npx npm@11`, confirmed live: this repo's npm
9.2.0 cannot resolve the manifest's `@rollup/wasm-node` override — "Invalid comparator" — matching the
handoff's own warning verbatim; `devDependencies` now read `^1.2.0` in `codex-ouronet`/`codex`, surface hash
`9091592ba15520f4` confirmed via `registry.surfaceHash`).

Separately, and more importantly: this session's own prior round rebuilt `PreZbomTooltipCard`'s numbered
argument list to iterate the EXEC's own declared parameters (in response to a live complaint that
`ReleaseStoicTag`'s tooltip showed only 2 numbered rows against its own 3-parameter signature). A follow-up
handoff supplies OuronetUI's current, shipped `ExecutionTooltip.tsx` as the authoritative reference — and its
own extensive doc comments prove that fix was wrong: previews differ from their execs in name, order, and
arity for 410 of 423 entrypoints, and binding by the exec's own names/positions instead of the preview's own
was a REAL, previously-shipped bug ("`executor = <the pool id>`, `swpair = true`, `toggle = MISSING` for a
call that was entirely correct"). Confirmed live against the newly-installed 1.2.0 registry: both disputed
entrypoints' preview signatures are STILL narrower than their execs (`ReleaseStoicTag`: exec has 3 params,
preview has 2; `RotateGuard`: exec has 4, preview has 2) — the registry upgrade does not change this, because
it was never wrong. The correct fix was never in the display logic; it's a real, permanent difference in
what the two calls actually need, and the tooltip's job is to say so honestly, not to paper over it by
displaying data that doesn't correspond to what actually gets read.

Two more real, registry-confirmed-live gaps:

- Registry 1.2.0 adds a `ghost.use` block for parameters with restricted use (6 of 423 entrypoints, all
  `guard`-typed — confirmed live for `RotateGuard`'s `new-guard`: `{"zbom":false,"display":"(read-keyset
  \"ks\")"}`). Nothing currently reads this — `PreZbomHint`'s own hand-rolled `formatArgValue()` (from the
  prior, now-being-reverted round) guesses at the `{readKeyset}` shape instead of using the registry's own
  authoritative `display` string.
- A ghost value that is ITSELF the literal string `"example"` (225 argument slots across 147 entrypoints,
  per the handoff — always an entity id for something absent from mainnet) isn't currently distinguished
  from a real value; `buildMergedPreviewValues`'s placeholder tracking only recognizes this codebase's OWN
  synthesized fallback, and the live-read gate only blocks when EVERY arg is a placeholder, not when ANY is
  (the reference gates on `ghostCount === 0` — any single placeholder blocks the whole read, since one
  bad argument still fails the call).

## Approach

Revert the numbered-list rendering to iterate the PREVIEW's own declared params (as `buildMergedPreviewValues`
already correctly resolves — that function was never wrong; only the DISPLAY choice was), restoring:

- The full exec signature shown once, unlabelled, for reference (`(patron executor tag-name)`) — unchanged,
  already correct.
- A numbered list of the PREVIEW's own params below it, each row: real/ghost value in gray, a genuine
  placeholder ("example"-sentinel OR this session's own synthesized fallback) shown as an italicized
  `<no live example>` rather than a raw value, a truly-missing value (no ghost, no placeholder possible —
  e.g. `tooltip:false`) shown as red "MISSING". Arity mismatch (rare; the registry always keeps `args`/
  `params` the same length for a resolved call, but defensive) flagged.
- The `ep.preview` name plus "the arguments above are this preview's" caption restored beneath the numbered
  list — accurate again once the list is genuinely preview-based.

New/changed logic in `buildMergedPreviewValues`:
- A `use = ep.ghost?.use?.[paramName]` lookup per param. If `use?.tooltip === false`, treat the param as
  unresolved for DISPLAY purposes (never render its value, never let it satisfy `allPlaceholder → false`) —
  matches `useNote`'s own stated contract ("`tooltip:false` = must not be rendered"). `use?.display`, when
  present, is what's SHOWN for that param (verbatim string) regardless of the raw ghost value underneath —
  this replaces the prior round's hand-rolled `formatArgValue()` guard-shape guess entirely; the registry is
  now the single source of truth for how to render a restricted value.
- A raw ghost/caller value that is exactly the string `"example"` is treated as a placeholder (not a real
  value) — same bucket as this file's own `placeholderForType()` fallback, sharing one `isPlaceholder()`
  predicate.
- Replace the "all args are placeholders" live-read gate with "any arg is a placeholder" — one bad argument
  already dooms the whole preview call (the reference's `ghostCount === 0` condition), so waiting for every
  argument to be bad before refusing was too permissive; a single placeholder argument was still firing a
  request known to fail.

Note the `zbom:false` tag (RotateGuard's `new-guard`) has NO code path to enforce in this package today: this
tooltip's `values` prop is never populated by any of Codex's 11 current callers, and nothing in this codebase
prefills a ghost value into a real, submittable ZBOM input from this feature — `PreZbomHint` is read-only by
construction (a hover affordance, never wired to any modal's actual form state). Documented here as
"confirmed inapplicable, not silently ignored" rather than added as unused code — if a future feature ever
does ghost-driven ZBOM autofill, that's where `zbom:false` needs to be checked, not here.

**Alternatives considered:**
- *Keep the exec-based list, and add a second, separate preview-based section below it.* Rejected: doubles
  the card's height for no benefit — the reference's own layout (exec signature once, for reference; preview
  args numbered, for what's actually happening) already covers both concerns without duplication, and is the
  handed-over authoritative design.
- *Only respect `ghost.use` when explicitly testing for it, defer general "any-placeholder" gating to a
  later topic.* Rejected: both fixes touch the exact same `buildMergedPreviewValues` function and the same
  live-reported entrypoints (`RotateGuard`); splitting them into separate topics would mean re-touching the
  same lines twice for no isolation benefit.

## Acceptance criteria

- [ ] `ReleaseStoicTag`'s tooltip shows a numbered list of exactly 2 rows (patron, tag-name — the PREVIEW's
      own params), not 3.
- [ ] `RotateGuard`'s tooltip shows a numbered list of exactly 2 rows (patron, account — the PREVIEW's own
      params), and its `account` row (no ghost match) renders as an italicized "no live example" placeholder,
      not the literal string `"example"`.
- [ ] A DIFFERENT entrypoint whose preview includes a `guard`-typed param with a `ghost.use.display` tag
      (confirmed live: none of Codex's current 12 launchers have one today, since the 6 restricted-guard
      entrypoints — DeploySmartAccount/DeployStandardAccount/RotateGovernor/RotateGuard/RotateCodexGuard —
      all have guard params on the EXEC side but the affected params aren't part of any of their PREVIEWS'
      own signatures, confirmed live) is exercised via a synthetic/unit-level test proving `display` is used
      verbatim when present, so the logic is locked in even though no live entrypoint currently exercises it
      end-to-end.
- [ ] A ghost value equal to the literal string `"example"` is treated identically to this package's own
      synthesized placeholder (renders as `<no live example>`, counts toward the placeholder gate).
- [ ] A call with one real ghost value and one placeholder value does NOT fire its live read (any-placeholder
      gating, not all-placeholder).
- [ ] Full workspace typecheck + test green.

## Out of scope

- Everything in topics 2 (native STOA tooltips) and 3 (cycling) — shaped separately, in turn.
- Enforcing `ghost.use.zbom` anywhere — confirmed inapplicable to this read-only feature (see Approach).
- Any change to `ExecutionTooltip.tsx`'s own wiring or its Zone2Wrapper usage.
