# codex-native-stoa-tooltips — Review

**Scope:** the 6 files named in plan.md's T1/T2/T3 `- files:` lists (all 3 tasks ticked):
`packages/codex-ouronet/src/zbom/cfm/nativeStoaSpecs.ts`,
`packages/codex-ouronet/tests/zbom-native-stoa-specs.test.ts`,
`packages/codex-ouronet/src/zbom/cfm/PreZbomHint.tsx`,
`packages/codex-ouronet/tests/zbom-prezbom-hint.test.tsx`,
`packages/codex-ouronet/src/ui/tabs/StoaAccountsTab.tsx`,
`packages/codex-ouronet/tests/zbom-prezbom-launcher-coverage.test.ts`.
6-file diff → 3 lenses (correctness, conventions, tests), dispatched as parallel `nectar:lens`
agents; findings deduplicated, then adversarially validated via parallel `nectar:validator` agents
grouped by file.

## Round 1

### [MEDIUM] `PreZbomTooltipCard` called a hook conditionally (Rules of Hooks)
- **Where:** `packages/codex-ouronet/src/zbom/cfm/PreZbomHint.tsx` (the `isNativeKey(entrypoint)` early return, ahead of `usePreZbomPreview`)
- **Evidence:** `if (isNativeKey(entrypoint)) { return <NativeStoaCard .../>; }` returned before `usePreZbomPreview(...)` (which internally calls `useState`/`useRef`/`useEffect`) was ever reached — so the hook was skipped entirely on the native branch, contradicting its own "called UNCONDITIONALLY every render" comment (which only covered the `shouldFireLive`/`null` branching inside the non-native path, not this earlier return).
- **Why it matters:** if a single mounted `PreZbomTooltipCard` instance's `entrypoint` prop ever flipped between a native and a registry key across renders, React would call a different number of hooks between renders of the same instance — a real Rules-of-Hooks violation (crash or corrupted hook state), not merely hypothetical, since `content={<PreZbomTooltipCard .../>}` is reconciled as the same instance at a fixed JSX position inside `ActionTooltip`/Radix `Tooltip.Content`.
- **Verdict:** CONFIRMED — validated against every current call site (`StoaAccountsTab.tsx`, `OuronetAccountsTab.tsx`, `DualApiPanel.tsx`, `SingleApiPanel.tsx`): every existing multi-value `entrypoint=` ternary toggles either between two native keys or between two registry keys, never native↔registry on one mounted instance — so this is a latent defect (a landmine for a future caller, e.g. topic 3's planned cycling), not a bug any current caller hits today. Severity MEDIUM ("maintainability trap") confirmed as claimed.
- **Resolution:** Fixed — `tryGetEntrypoint` is now only skipped (not returned-around) for a native key (`const ep = native ? undefined : tryGetEntrypoint(entrypoint);`), and `usePreZbomPreview` is called unconditionally before the native/registry render branch. Re-ran `tests/zbom-prezbom-hint.test.tsx` (20/20) and `tsc --noEmit` (clean) after the fix.

### [MEDIUM] Launcher-coverage test could not catch a swapped ternary within a single call site
- **Where:** `packages/codex-ouronet/tests/zbom-prezbom-launcher-coverage.test.ts` (the `every known open-call site is textually inside a <PreZbomHint> region...` test's actual-vs-expected comparison)
- **Evidence:** `extractEntrypointValues` extracts every quoted string literal inside an `entrypoint={...}` regardless of ternary branch, and the assertion compared `actualEntrypoints.sort()` against `[...expectedEntrypoints].sort()` — an order-insensitive SET comparison. A hypothetical swap of the Send/Transfer ternary's two branches (`coin.C_Transfer`/`coin.C_UR|Transfer`) would extract the same two literals in reversed order and still pass.
- **Why it matters:** the exact user-visible failure mode this whole coverage suite exists to catch (a swapped/mispaired entrypoint) would go undetected for this specific two-value call site.
- **Verdict:** CONFIRMED — validated by reading the extraction/assertion code directly, and separately confirmed the CURRENT wiring (`isUrstoaMode ? "coin.C_UR|Transfer" : "coin.C_Transfer"`) is correct today (cross-checked against the sibling `title=`/`onClick=`/`description=` ternaries in the same JSX block, all agreeing on the urstoa↔UrStoa / stoa↔plain-Stoa mapping) — this is a coverage gap, not a live bug.
- **Resolution:** Fixed — changed the comparison to positional (`toEqual([...expectedEntrypoints])`, no `.sort()` on either side), since `extractEntrypointValues` already scans left-to-right (true-branch literal first) and every existing multi-value `expectedEntrypoints` entry (including the pre-existing `DeploySmartAccount`/`DeployStandardAccount` one) is already written in that same true-branch-first order. Verified the fix actually catches a swap: deliberately reversed the Send/Transfer ternary's two branches in `StoaAccountsTab.tsx`, re-ran the test (RED, failure correctly named the mismatch), then reverted and re-ran (GREEN).

### [LOW] Stale "11 known ... three launcher files" header comment
- **Where:** `packages/codex-ouronet/tests/zbom-prezbom-launcher-coverage.test.ts` top-of-file doc comment
- **Evidence:** header said "11"/"three launcher files" while the code below it (and this same file's OWN later comments/test titles) already said "15"/implied four files, after `StoaAccountsTab.tsx` was added as a 4th enforced file in this diff.
- **Verdict:** CONFIRMED (both lenses that flagged it agreed; deduplicated to one finding, same file/line/root cause).
- **Resolution:** Fixed — header now reads "15 known ... across the four launcher files", consistent with the rest of the file.

### [LOW] Native decimal example rendered as an integer literal
- **Where:** `packages/codex-ouronet/src/zbom/cfm/nativeStoaSpecs.ts` (`const AMOUNT = 1.0;`), rendered via `String(spec.args[i])` in `PreZbomHint.tsx`'s `NativeStoaCard`
- **Evidence:** every `amount`/`urstoa-amount` slot is `decimal`-typed on chain, but `String(1.0)` evaluates to `"1"` in JavaScript, silently dropping the decimal marker.
- **Verdict:** CONFIRMED, LOW (cosmetic — no test or acceptance criterion depends on the exact example text).
- **Resolution:** Fixed — `AMOUNT` is now the string `"1.0"` (not the JS number `1.0`), with a comment explaining why a plain number was wrong here.

### [STYLISTIC] Tooltip description text duplicated between desktop and mobile
- **Where:** `packages/codex-ouronet/src/ui/tabs/StoaAccountsTab.tsx` — the new desktop `PreZbomHint description={...}` strings (Stake/Unstake/Collect) are word-for-word identical to the pre-existing, untouched mobile `ActionTooltip content={...}` strings in the same file's `leftEdgeStack`/`rightEdgeStack` blocks, differing only by `urBal` vs `selectedUrBal`.
- **Verdict:** Downgraded MEDIUM → STYLISTIC on validation — confirmed the duplication is REAL but (a) pre-existing (this diff only relocated the desktop copy from its own standalone `ActionTooltip` into the new `description=` prop; the mobile copy was never touched and was already independently maintained before this topic), and (b) the design doc for this exact topic explicitly reasoned through and rejected touching the mobile call sites ("Left untouched" — wrapping them in `PreZbomHint` would silently delete their existing text, since `PreZbomHint` no-ops on mobile). A shared-helper fix is real but is scope creep against this topic's own stated boundary, not a defect this diff introduced.
- **Resolution:** Presented as a choice rather than auto-fixed, per the STYLISTIC handling rule. Left unfixed for this topic — extracting `stakeDescription()`/`unstakeDescription()`/`collectDescription()` helpers (used from both the desktop and mobile call sites) would be a good, low-risk follow-up if/when the mobile call sites are next touched for any other reason, but doing it here would mean editing code this topic's own design doc explicitly scoped out.

## Clean pass

- `npx vitest run tests/zbom-prezbom-hint.test.tsx tests/zbom-native-stoa-specs.test.ts tests/zbom-prezbom-launcher-coverage.test.ts tests/zbom-prezbom-hint-real-hover.test.tsx tests/zbom-action-tooltip-unstyled.test.tsx` (after all fixes): `Test Files  5 passed (5)` / `Tests  30 passed (30)`.
- `npx vitest run` (full `codex-ouronet` suite, re-run twice to rule out the same pre-existing flakiness noted in topic 1's review — `ui-seed-words-tab.test.tsx` and one other file transiently failed on the first run under full-suite parallel load, both passed clean on immediate re-run): `Test Files  111 passed (111)` / `Tests  1309 passed (1309)`.
- `npm run typecheck` (root, all 6 workspaces): every workspace's `tsc --noEmit` completed with no output (clean).

## Behavioral verification

Exercised against design.md's acceptance criteria:

- `render(<PreZbomTooltipCard entrypoint="coin.C_URV|Stake" />)` shows `"STOA NATIVE"`, the bare key `"coin.C_URV|Stake"` (no `ouronet-ns.` prefix), a numbered `01 account`/`02 urstoa-amount` list with the Kadena `k:...` example account, and the `"no IGNIS — this costs native STOA gas, paid by the signer directly"` footer — no cost-preview/IGNIS-amount line at all (`container.textContent` asserted `not.toMatch(/\d\s*IGNIS/)`).
- `render(<PreZbomTooltipCard entrypoint="coin.C_TransferAnew" />)` shows exactly 4 numbered rows, with the `receiver-guard` row rendering the registry-style `(read-keyset "ks")` string, never `[object Object]`.
- `render(<PreZbomTooltipCard entrypoint="coin.C_URV|Stake" description="Stake your liquid UrStoa. 12.5 UrStoa available." />)` shows BOTH the description and the native section in one tooltip.
- A registry entrypoint (`TS01-C4.CODEX|C_ReleaseStoicTag`) renders byte-identically to topic 1's own behavior — the native-key branch changed nothing about the registry-resolution path.
- `zbom-native-stoa-specs.test.ts`'s source-comparison test was proven to actually run (not skip) and to fail loudly on a deliberately-wrong signature (verified live during T1's build step, reconfirmed unaffected by the review's fixes).
- The launcher-coverage test now demonstrably catches a swapped Send/Transfer ternary (proved by injection during the fix for the MEDIUM finding above), closing the exact gap the tests lens identified.

## Round count and disposition

1 round. 4 CONFIRMED findings fixed (hooks ordering, coverage-gap positional comparison, stale doc comment, decimal-string formatting); 1 STYLISTIC finding presented and left as-is per the design's own already-reasoned scope boundary. The terminal full-scope, full-lens-set pass (quoted above) postdates every fix.

Both plan.md's Wave 1/2/3 tasks are checked off. Ready to hand off to topic 3 (`prezbom-tooltip-cycling`).
