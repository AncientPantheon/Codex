# prezbom-tooltip-cycling — Review

**Scope:** the 4 files named in plan.md's T1/T2 `- files:` lists (both tasks ticked):
`packages/codex-ouronet/src/zbom/cfm/PreZbomHint.tsx`,
`packages/codex-ouronet/tests/zbom-prezbom-hint.test.tsx`,
`packages/codex-ouronet/src/ui/tabs/StoaAccountsTab.tsx`,
`packages/codex-ouronet/tests/zbom-prezbom-launcher-coverage.test.ts`.
4-file diff → 3 lenses (correctness, conventions, tests), dispatched as parallel `nectar:lens`
agents; findings deduplicated, then adversarially validated via 2 parallel `nectar:validator` agents
(one grouped on `PreZbomHint.tsx`, one grouped on the test-coverage findings).

## Round 1

### [MEDIUM] Cycle footer silently missing from the "not on chain" fallback branch
- **Where:** `packages/codex-ouronet/src/zbom/cfm/PreZbomHint.tsx` — `PreZbomTooltipCard`'s 3 return branches (native, unknown-entrypoint fallback, registry-resolved)
- **Evidence:** the depletion-bar/dot `CycleFooter` was rendered (via `{cycles && <CycleFooter .../>}`) in the native branch and the final registry-resolved branch, but NOT in the `!ep` "not on chain" fallback branch in between — a plain copy-paste gap between two structurally similar branches.
- **Why it matters:** a cycling launcher whose active slot lands on a stale/unresolvable key would have its depletion bar and dots (the only signal telling the user more variants exist and the panel is about to change) vanish for that one slot, then reappear once the cycle advances past it.
- **Verdict:** CONFIRMED (both the conventions lens and correctness-adjacent validation agreed; no current cycling launcher's variants are ever unresolvable — both of Codex's own 2 real cycling sets are always-native — so this is a real defect never yet hit live, but a genuine trap for the next cycling launcher whose variants might not all resolve).
- **Resolution:** Fixed — the footer is now computed ONCE (`const footer = cycles ? <CycleFooter .../> : null;`) above all 3 branches and rendered identically in each, including the `!ep` fallback. Verified by deliberately removing `{footer}` from the fallback branch, confirming RED against a new test that exercises exactly this branch while cycling (`"shows the cycle footer inside the 'not on chain' fallback card too..."`), then reverting and confirming GREEN.

### [MEDIUM] Widened `entrypoint` array not guarded against being empty
- **Where:** `packages/codex-ouronet/src/zbom/cfm/PreZbomHint.tsx` — the `keys`/`activeKey` derivation
- **Evidence:** `activeKey = keys[Math.min(slot, keys.length - 1)]`; with `entrypoint={[]}`, `keys.length` is `0`, so `Math.min(0, -1) === -1`, and `keys[-1]` is `undefined` in JS (no negative indexing) — falling through to the unknown-entrypoint branch with the key `undefined`, rendering a confusing card and a spurious `console.warn` naming the literal string `"undefined"`.
- **Why it matters:** no current caller passes an empty array (confirmed via grep of every `<PreZbomHint`/`<PreZbomTooltipCard` call site), but nothing in the type signature stops a future one from doing so, or from a conditional expression collapsing to `[]`.
- **Verdict:** CONFIRMED (validated: traced `isNativeKey`/`tryGetEntrypoint`'s actual property-lookup behavior on an `undefined` key, both return falsy/undefined rather than throwing, matching the claim exactly).
- **Resolution:** Fixed as part of the same edit that added `.filter(Boolean)` (see next finding) — `keys` now falls back to `[""]` when the filtered list is empty, guaranteeing `keys.length >= 1` always, so `Math.min(slot, keys.length - 1)` can never go negative.

### [LOW] `keys` memo drops the reference's defensive `.filter(Boolean)`, with no comment explaining the omission
- **Where:** `packages/codex-ouronet/src/zbom/cfm/PreZbomHint.tsx` — the `keys` memo
- **Evidence:** OuronetUI's own `ExecutionHint.tsx` (the explicitly-cited model for this feature) filters falsy/empty entries out of its own `keys` array; Codex's port omitted this with no comment, unlike this file's usual practice of documenting every deliberate deviation from the reference.
- **Verdict:** CONFIRMED, LOW (no current caller triggers it — same latent-only conclusion as the finding above, which shares its root cause).
- **Resolution:** Fixed together with the empty-array guard above — `keys` is now `(Array.isArray(entrypoint) ? entrypoint : [entrypoint]).filter(Boolean)`, falling back to `[""]` only if that filter empties the list entirely.

### [MEDIUM → partially mitigated] Cycling wiring in the one real production caller (Send/Transfer) was verified only by a source-text regex scan, never by rendering
- **Where:** `packages/codex-ouronet/tests/zbom-prezbom-launcher-coverage.test.ts` (the `stoa` Send/Transfer entry), `packages/codex-ouronet/src/ui/tabs/StoaAccountsTab.tsx` (the `isUrstoaMode ? [...] : [...]` ternary)
- **Evidence:** the coverage test's only assertion for this call site is a regex-extracted literal-string match against the raw JSX text — it never renders `StoaAccountsTab`, and no cycling test in `zbom-prezbom-hint.test.tsx` used the actual production array literals.
- **Verdict:** CONFIRMED, with a validation note that this is partially mitigated — a SIBLING test file (`ui-stoa-accounts-tab.test.tsx`) already renders the real component and asserts the mode-dependent MODAL that opens (`SendStoaModal` vs `TransferUrStoaModal`) is correct for each mode; only the tooltip's own displayed content was unverified by rendering.
- **Resolution:** Fixed with a targeted, lower-risk addition rather than a full `StoaAccountsTab` render: a new test in `zbom-prezbom-hint.test.tsx` (`"pins the EXACT production Send/Transfer arrays wired in StoaAccountsTab.tsx..."`) renders `PreZbomTooltipCard` with the two literal arrays copied verbatim from `StoaAccountsTab.tsx`'s own ternary (`["coin.C_Transfer", "coin.C_TransferAnew"]` and `["coin.C_UR|Transfer", "coin.C_UR|TransferAnew"]`), asserting each resolves to a correct native card with the right `exec` key and cycle footer. A full `StoaAccountsTab`-level render was considered and set aside: `ActionTooltip` is real (unmocked) Radix in that test file, and this project's own established, previously-documented limitation is that jsdom cannot reliably drive Radix's hover-to-open transition to assert on lazily-mounted tooltip content — mocking `ActionTooltip` inside that shared, heavily-used test file risked affecting its many other unrelated tests. This new test closes the "are the exact production literals actually wired to a working cycling card" gap without that risk; it does not catch a hypothetical future bug in `isUrstoaMode`'s own boolean computation, which remains covered structurally by the source-scan test's positional-comparison fix (from the prior topic's review) plus the sibling modal-opening test.

### [LOW → downgraded from MEDIUM on validation] No test verified the cycle wraps back to slot 0 after the last variant
- **Where:** `packages/codex-ouronet/tests/zbom-prezbom-hint.test.tsx`
- **Evidence:** only one timing test existed, advancing one `CYCLE_MS` and asserting slot 0→1; nothing advanced a second cycle to confirm `(i + 1) % keys.length` actually wraps rather than stalling or going out of bounds.
- **Verdict:** CONFIRMED, downgraded to LOW on validation (a single-line modulo operation over a 2-length array is low complexity/risk, and the existing test already proves the interval/state-update mechanism works for one transition).
- **Resolution:** Fixed — added `"wraps back to the first entrypoint after a SECOND full cycle..."`, advancing two full `CYCLE_MS` periods and asserting the card is back to showing the first entrypoint.

### [LOW] No test coverage for a single-element ARRAY `entrypoint` (as opposed to a bare string)
- **Where:** `packages/codex-ouronet/src/zbom/cfm/PreZbomHint.tsx`/`tests/zbom-prezbom-hint.test.tsx`
- **Evidence:** `entrypoint={["only-one-key"]}` takes the array branch of `Array.isArray(entrypoint)` (a distinct code path from the bare-string case) but should converge to identical behavior (`cycles = false`, no footer) — never directly exercised by any test.
- **Verdict:** CONFIRMED, LOW (behavior is evident from reading the code — `cycles` only depends on `.length` — but the path itself was untested).
- **Resolution:** Fixed — added `"shows no cycle footer for a single-element ARRAY entrypoint..."`.

## Clean pass

- `npx vitest run tests/zbom-prezbom-hint.test.tsx` (after all fixes): `Test Files  1 passed (1)` / `Tests  28 passed (28)`.
- `npx vitest run` (full `codex-ouronet` suite): `Test Files  111 passed (111)` / `Tests  1317 passed (1317)`.
- `npm run typecheck` (root, all 6 workspaces): every workspace's `tsc --noEmit` completed with no output (clean).

## Behavioral verification

Exercised against design.md's acceptance criteria:

- A bare-string `entrypoint` renders byte-for-byte as before this topic — confirmed via the
  unmodified pre-existing tests in `zbom-prezbom-hint.test.tsx` (topics 1/2's tests) all still
  passing, plus the new `"shows no cycle footer at all for a bare-string entrypoint"` test.
- A 2-element array cycles: starts at slot 0, advances to slot 1 after one `CYCLE_MS` (10s, matching
  the reference's CURRENT value — re-read live during shaping, not the earlier round's stale `3200`),
  wraps back to slot 0 after a second cycle, and restarts at slot 0 on every fresh mount (proxying
  Radix's own lazy-mount-on-hover behavior, the load-bearing assumption this topic's design relies on).
- The cycle footer (depletion bar + dots) renders in all 3 of `PreZbomTooltipCard`'s return branches
  now, including the previously-missed "not on chain" fallback.
- The exact production Send/Transfer arrays (`["coin.C_Transfer", "coin.C_TransferAnew"]` /
  `["coin.C_UR|Transfer", "coin.C_UR|TransferAnew"]`) each resolve through the real cycling machinery
  to a correct native "STOA NATIVE" card.
- Deliberate-break verification (per this project's established discipline) confirmed the positional
  launcher-coverage check (fixed in topic 2's review) also catches a swapped 4-literal array, not only
  the earlier 2-literal case it was originally fixed for.

## Round count and disposition

1 round. All 6 CONFIRMED findings fixed (2 MEDIUM code defects in `PreZbomHint.tsx`, 1 LOW code
defect sharing the same root cause, 1 MEDIUM test-coverage gap closed with a targeted rendering test,
2 LOW test-coverage gaps closed with new tests). No STYLISTIC findings this round. The terminal
full-scope, full-lens-set pass (quoted above) postdates every fix.

Both plan.md's Wave 1/2 tasks are checked off. This closes topic 3 — the final topic of the
`codex-tooltip-v2` project (`docs/work/codex-tooltip-v2/design.md`). All 3 topics
(`prezbom-tooltip-registry-rebuild`, `codex-native-stoa-tooltips`, `prezbom-tooltip-cycling`) have
now reached a clean plan→build→review pass.
