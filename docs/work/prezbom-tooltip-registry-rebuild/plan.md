## Wave 1
- [x] T1: Rewrite `buildMergedPreviewValues`'s data model to a per-param row model,
  respecting registry 1.2.0's `ghost.use` tags and detecting the literal `"example"`
  sentinel as a placeholder; remove the exec-based display helpers it's replacing.
  - In `packages/codex-ouronet/src/zbom/cfm/PreZbomHint.tsx`:
    - Add `const PLACEHOLDER = "example";` and `function isPlaceholderValue(v: unknown): boolean { return v === PLACEHOLDER; }` — a raw ghost/caller value that IS this exact string counts as a placeholder, same bucket as this file's own `placeholderForType()` synthesized fallback (which also returns `"example"` for string/time params — both paths now converge on the same predicate).
    - Change `MergedPreviewValues` to:
      ```ts
      interface PreviewArgRow {
        name: string;
        /** undefined = no safe value at all (no ghost, no caller value, no
         *  type-appropriate placeholder possible — e.g. `guard` with no ghost
         *  match) OR this param's `ghost.use.tooltip === false` and it has no
         *  ghost value to fall back on for the live call either. */
        value: unknown | undefined;
        /** The string to SHOW for this row. `ghost.use[name].display` when
         *  present (verbatim, registry-authoritative), else `shorten(String(value))`
         *  computed at render time — this field only carries the override. */
        displayOverride: string | undefined;
        isPlaceholder: boolean;
        /** `ghost.use[name].tooltip === false` — row must not be rendered at
         *  all (registry's own contract: "tooltip:false = must not be
         *  rendered"). Its `value` (if any) still contributes to the live
         *  read below — a `/local` read submits nothing, so the `tooltip`
         *  restriction (governs rendering) is a narrower rule than `zbom`
         *  (governs prefilling a submittable input), and only the latter
         *  would need to block this. */
        hidden: boolean;
      }
      interface MergedPreviewValues {
        /** Every preview param, in the preview's own declared order. */
        rows: PreviewArgRow[];
        /** Values object for `buildPreviewCall` — includes hidden rows' real
         *  values (see `hidden` doc above), excludes nothing a real call needs. */
        values: Record<string, unknown>;
        /** True iff ANY row has `value === undefined` — the call cannot be
         *  built at all (a required argument has no renderable value). */
        unresolved: boolean;
        /** True iff ANY non-hidden row `isPlaceholder` — firing the live read
         *  is a foregone refusal (one bad argument already fails the call).
         *  Replaces the prior "ALL placeholder" gate — a hidden/tooltip-false
         *  row's placeholder-ness (if any) does not count here, since it was
         *  never shown as a placeholder in the first place. */
        anyPlaceholder: boolean;
      }
      ```
    - Rewrite `buildMergedPreviewValues(entrypointKey, ep, callerValues)` to build one `PreviewArgRow` per `pv.params` entry: resolve `raw = callerValues?.[p.name] ?? ep.ghost?.args?.[p.name]`; if `raw === undefined`, try `placeholderForType(p.type)`; `value = raw ?? placeholderForType(p.type)` (`undefined` if neither); `isPlaceholder = isPlaceholderValue(raw ?? undefined) || (raw === undefined && value !== undefined)` (true when the resolved value came from `placeholderForType`, OR the raw ghost/caller value was itself literally `"example"`); look up `use = ep.ghost?.use?.[p.name]`; `hidden = use?.tooltip === false`; `displayOverride = use?.display`. Populate `values[p.name] = value` whenever `value !== undefined` (regardless of `hidden`). Set `unresolved = rows.some(r => r.value === undefined)`; `anyPlaceholder = rows.some(r => !r.hidden && r.isPlaceholder)`.
    - Delete `buildDisplayArguments`, `formatArgValue` — dead once T2 (Wave 2) stops calling them. Keep `placeholderForType` (still used by the rewritten function above).
  - done when:
    - `npx vitest run tests/zbom-prezbom-hint.test.tsx` (run from `packages/codex-ouronet`) — new/updated tests below pass; `npx tsc --noEmit` clean.
    - Test in `packages/codex-ouronet/tests/zbom-prezbom-hint.test.tsx`: calling `buildMergedPreviewValues("TS01-C4.CODEX|C_ReleaseStoicTag", ep, undefined)` (real, live-resolved `ep`) returns exactly 2 rows named `patron`, `tag-name` (the preview's own params, confirmed live: `CODEX.INFO_CODEX|ReleaseStoicTag` preview = `[patron, tag-name]`), both `isPlaceholder: false` (both have real ghost values), `unresolved: false`, `anyPlaceholder: false`.
    - Test: same call for `TS01-C1.DALOS|C_RotateGuard` (preview = `[patron, account]`) returns 2 rows; `account`'s row has `isPlaceholder: true` (no ghost match for "account", falls to `placeholderForType("string")` = `"example"`), `value: "example"`; `anyPlaceholder: true`.
    - Test: a raw ghost/caller value that is literally the string `"example"` (construct via a synthetic `Entrypoint` — spread a real resolved `ep` and override `ghost.args` for one preview param to the literal string `"example"`) produces `isPlaceholder: true` for that row, distinct from a param with no ghost match at all reaching the same placeholder value via `placeholderForType` — both count as placeholders, proving the two paths converge.
    - Test: a synthetic `Entrypoint` (spread a real `ep`, override `ghost.use` to add `{ "patron": { tooltip: false, display: "REDACTED" } }` for one of `ReleaseStoicTag`'s 2 preview params) produces that row with `hidden: true`, `displayOverride: "REDACTED"`, and its real ghost value STILL present in the returned `values` object (available to the live call) even though `hidden` is true.
    - Test: `anyPlaceholder` is `true` when even ONE row is a placeholder and the rest are real (not just when ALL are) — construct a synthetic `ep` with one preview param's ghost value present (real) and one absent (falls to placeholder), assert `anyPlaceholder: true`.
    - Test: `unresolved` is `true` when a row's type has no safe placeholder and no ghost value (e.g. synthetic `ep` with a preview param of type `"guard"` and no ghost entry for it) — `value: undefined` for that row.
  - files: `packages/codex-ouronet/src/zbom/cfm/PreZbomHint.tsx`, `packages/codex-ouronet/tests/zbom-prezbom-hint.test.tsx`

## Wave 2 (depends on Wave 1)
- [x] T2: Rewrite `PreZbomTooltipCard`'s render body to consume the new row model
  (restoring preview-param-based display, matching the reference implementation's
  layout and styling exactly), and fix the duplicated doc-comment block left in
  `PreZbomHint`'s default export from an earlier round.
  - In `packages/codex-ouronet/src/zbom/cfm/PreZbomHint.tsx`:
    - Remove the current exec-based numbered-list block (the one iterating `displayArgs` from the now-deleted `buildDisplayArguments`).
    - Keep the exec signature line unchanged (`({ep.params.map(p=>p.name).join(" ")})`, names only, no values — this is the "what actually runs" reference line, per the reference implementation's own layout).
    - Add a numbered list rendering `merged.rows` (skip any row with `hidden: true` — rendered nowhere at all, not even as a numbered gap; index the visible rows sequentially starting at `01`): for each visible row, `displayOverride ?? shorten(String(row.value))` as the shown value (`title={String(row.value)}` for the full value on hover, `shorten()` only applied when there's no `displayOverride` — a `display` string from the registry is already the intended exact rendering and should not be re-elided); style: red (`#8b1a1a`) when `row.value === undefined` showing literal text `MISSING`, italic gray (`#5a5a4a`, matching the reference's placeholder tone) showing `<no live example>` when `row.isPlaceholder`, else the normal gray (`#9a9a9a`) real-value styling.
    - Restore, directly below the numbered list: `{ep.preview}` (green, unchanged) followed by a caption line `the arguments above are this preview's` (small, muted — matches the reference's own wording and placement now that the list is genuinely preview-based again).
    - Change the live-read gating text/branches: `merged.unresolved` → "no cost preview — a required argument has no renderable type" (unchanged wording); `!merged.unresolved && merged.anyPlaceholder` → "no cost preview — no live example on chain" (unchanged wording, now driven by the renamed field); the live-read fire condition in `PreZbomTooltipCard` becomes `shouldFireLive = !!merged && !merged.unresolved && !merged.anyPlaceholder`.
    - Fix the duplicated `/* ActionTooltip's Radix Tooltip.Trigger... */` comment block in the default-exported `PreZbomHint` function (currently appears twice, verbatim, back to back) — keep one copy.
  - done when:
    - `npx tsc --noEmit` clean; `npx vitest run tests/zbom-prezbom-hint.test.tsx tests/zbom-prezbom-hint-real-hover.test.tsx tests/zbom-action-tooltip-unstyled.test.tsx` all pass (from `packages/codex-ouronet`).
    - Rewrite the 3 tests added in the previous round for the (now-reverted) exec-based display in `packages/codex-ouronet/tests/zbom-prezbom-hint.test.tsx` ("shows a numbered argument line for EVERY exec param...", "renders a guard-typed ghost value...", "shows all 3 exec params for Release StoicTag...") to instead assert: rendering `PreZbomTooltipCard entrypoint="TS01-C4.CODEX|C_ReleaseStoicTag"` shows exactly 2 numbered rows (`01 patron = `, `02 tag-name = `), NOT 3; rendering `entrypoint="TS01-C1.DALOS|C_RotateGuard"` shows exactly 2 numbered rows (`01 patron = `, `02 account`), with the `account` row showing the italicized `<no live example>` text (not the literal string `"example"`, not `[object Object]`); the exec signature line still shows all of `(patron executor new-guard safe)`/`(patron executor tag-name)` unchanged.
    - New test: a synthetic entrypoint (spread a real resolved `ep`, override `ghost.args`/`ghost.use` for one preview param to `{ readKeyset: "ks" }` / `{ tooltip: true, display: '(read-keyset "ks")' }`) renders that row as `(read-keyset "ks")` — the registry's own `display` string — not a hand-derived guess.
    - New test: a synthetic entrypoint with one preview param's `ghost.use.tooltip` set to `false` does NOT render that row at all (its name never appears in the numbered list), while the other preview param(s) still render normally.
    - `container.textContent` includes the string `the arguments above are this preview's` whenever `merged` resolves (i.e. whenever a preview exists) — restored from the prior round.
    - No pre-existing test in `zbom-prezbom-hint-real-hover.test.tsx`/`zbom-action-tooltip-unstyled.test.tsx` needs a behavior change (both test structural/hover-wiring concerns unaffected by the render-body rewrite) — confirm both files pass unmodified.
  - files: `packages/codex-ouronet/src/zbom/cfm/PreZbomHint.tsx`, `packages/codex-ouronet/tests/zbom-prezbom-hint.test.tsx`
