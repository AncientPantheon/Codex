# prezbom-tooltip-registry-rebuild — Review

**Scope:** `packages/codex-ouronet/src/zbom/cfm/PreZbomHint.tsx`,
`packages/codex-ouronet/tests/zbom-prezbom-hint.test.tsx` (the two files named in
plan.md's T1/T2 `- files:` lists — both tasks ticked). 2-file diff → 2 lenses
(correctness + conventions), run inline, validated inline.

## Round 1

### [LOW] Whole placeholder row italicized instead of only the placeholder value
- **Where:** `packages/codex-ouronet/src/zbom/cfm/PreZbomHint.tsx` (row style block in `PreZbomTooltipCard`)
- **Evidence:** Initial rewrite set `fontStyle: "italic"` on the outer row `<div>` whenever `row.isPlaceholder`, so the index number and param name inherited the italic style too. The reference implementation (`ExecutionTooltip.tsx:284-290`) only italicizes the inner `<span>` around `<no live example>` — the row's `color` changes, but the index/name/`=` stay upright.
- **Why it matters:** Design's acceptance criteria call for "matching the reference implementation's exact layout" — visibly italicizing the row number and param name is a small but real deviation a side-by-side comparison would catch.
- **Suggested fix:** Move `fontStyle: "italic"` off the row `<div>` and onto the `<no live example>` `<span>` only, matching the reference exactly.
- **Verdict:** CONFIRMED (self-caught during inline correctness/conventions pass, verified against the reference file's exact line range quoted above).
- **Resolution:** Fixed — row `<div>` now only sets `color`; the placeholder `<span>` carries its own `fontStyle: "italic"`. Re-ran `tests/zbom-prezbom-hint.test.tsx`, `tests/zbom-prezbom-hint-real-hover.test.tsx`, `tests/zbom-action-tooltip-unstyled.test.tsx` (20/20 passing) and `tsc --noEmit` (clean) after the fix.

No other CONFIRMED findings from the correctness or conventions lens. Specifically checked and cleared:
- `raw = callerValues?.[p.name] ?? ep.ghost?.args?.[p.name]` uses `??`, not `||` — a caller-supplied `false`/`0`/`""` is preserved, never overridden by ghost data.
- `unresolved`/`anyPlaceholder` computed from `rows` only after the loop completes — no stale aggregate-boolean special-casing left over from the prior `allPlaceholder` model (the zero-param-preview test, `merged!.rows` empty, confirms `.some()` vacuously returns `false` for both with no init-value hack needed).
- `ghostUseTag`'s narrow cast is documented in place (installed registry 1.2.0's own `.d.ts` doesn't yet declare `Ghost.use`, confirmed by reading `node_modules/@ouronet/talos-registry/dist/types.d.ts` directly) — not a silent `any`, and not reachable without going through the one helper.
- `buildDisplayArguments`/`formatArgValue`/the old `allPlaceholder`-based `MergedPreviewValues` shape are fully removed (`grep` confirms zero remaining references) — no dead code left over from the revert.
- The duplicated `/* ActionTooltip's Radix Tooltip.Trigger... */` doc-comment block in the default-exported `PreZbomHint` is de-duplicated to one copy.

## Clean pass

- `npx vitest run tests/zbom-prezbom-hint.test.tsx tests/zbom-prezbom-hint-real-hover.test.tsx tests/zbom-action-tooltip-unstyled.test.tsx` (from `packages/codex-ouronet`, after the italics fix): `Test Files  3 passed (3)` / `Tests  20 passed (20)`.
- `npx vitest run` (full `codex-ouronet` suite): `Test Files  110 passed (110)` / `Tests  1302 passed (1302)`.
- `npm run typecheck` (root, all 6 workspaces — arweave-core, codex-core, codex-ui, codex-ouronet, codex-arweave, codex): every workspace's `tsc --noEmit` completed with no output (clean).
- `npm run test` (root, all 6 workspaces): 1 pre-existing failure in `tests/ui-seed-words-tab.test.tsx` (`findByText("8 words")` timeout) — **not in this topic's scope** (no relationship to `PreZbomHint.tsx`/registry preview binding) and confirmed flaky, not a regression: re-running that file alone (`npx vitest run tests/ui-seed-words-tab.test.tsx`) passes clean, `Test Files  1 passed (1)` / `Tests  55 passed (55)`. Everything else across all 6 workspaces passed.

## Behavioral verification

Exercised against design.md's acceptance criteria, live against the installed registry 1.2.0 (not mocked, except the two `TEST-ONLY.*` synthetic preview keys used solely for the zero-param/no-ghost-coverage edge cases):

- `ReleaseStoicTag` (`TS04-C4.CODEX|C_ReleaseStoicTag`): tooltip's numbered list shows exactly `01 patron`, `02 tag-name` — the PREVIEW's own 2 params — while the exec signature line above still shows all 3 (`patron executor tag-name`) unlabelled, for reference. (`tests/zbom-prezbom-hint.test.tsx`, "shows exactly the PREVIEW's own 2 params for Release StoicTag...".)
- `RotateGuard` (`TS01-C1.DALOS|C_RotateGuard`): numbered list shows exactly `01 patron`, `02 account`; `account` (no ghost match) renders the italicized `<no live example>` note, not the literal string `"example"`; the card shows "no cost preview — no live example on chain" — proving the any-placeholder gate blocks the read even though `patron` itself has a real ghost value.
- A ghost value that IS the literal sentinel string `"example"` (confirmed live: `TS04-C4.PYTHIA|C_Link`'s own installed ghost data already has this for `consumer-lane`) is detected via the same `isPlaceholderValue` path as the synthesized fallback, not a separate/missed code path.
- `ghost.use[param].display` (confirmed live on `RotateGuard`'s own `new-guard` ghost tag: `{"zbom":false,"display":"(read-keyset \"ks\")"}`) renders verbatim when exercised via a synthetic preview-param override, not a hand-derived `{readKeyset}` guess.
- `ghost.use[param].tooltip === false` hides that row from the numbered list entirely (sequential renumbering, no gap) while its real value still reaches `values` for the live call.

## Round count and disposition

1 round. The one CONFIRMED finding (italics scope) was fixed inline before this report; the terminal full-scope pass (both lenses, zero-file diff remaining) is the clean pass quoted above, postdating that fix.

Both plan.md tasks (T1, T2) are checked off. Ready to hand off to topic 2 (`codex-native-stoa-tooltips`).
