# prezbom-tooltip-canon-2.2 — Review

Scope: the tooltip-canon-2.2 diff — `packages/codex-ouronet/src/zbom/cfm/PreZbomHint.tsx`,
`packages/codex-ouronet/src/zbom/cfm/preZbomFillMap.ts` (new), `packages/codex-ouronet/src/ui/tabs/{OuronetAccountsTab,SingleApiPanel,DualApiPanel}.tsx`,
and their test files (`tests/zbom-prezbom-hint.test.tsx`, `tests/zbom-prezbom-fill-map.test.ts` (new),
`tests/ui-single-api-panel.test.tsx` (new), `tests/ui-dual-api-panel.test.tsx` (new),
`tests/ui-ouronet-accounts-tab-patron-fill.test.tsx` (new)).

Lens set used (16+ file diff across production + test code, but concentrated in one package):
correctness, tests, conventions — 3 lenses, run via `nectar:lens` agents in parallel, followed by
`nectar:validator` agents grouped by production-code vs test-coverage.

## Round 1 — findings, validation, resolution

### [MEDIUM → FIXED] `classifyRefusal`'s regex too broad
- **Where:** `packages/codex-ouronet/src/zbom/cfm/PreZbomHint.tsx`, `classifyRefusal`
- **Lens:** correctness
- **Evidence:** `/no value found in table .+ for key/i` matches ANY message with that shape,
  including one produced by a call into a retired/tombstoned module — `ouroSelectorReads.ts`'s own
  doc comment documents four separate historical bugs in this exact codebase where a stale module
  reference produced this exact string shape as a symptom of a real regression, not a benign
  "no row yet" answer.
- **Verdict:** CONFIRMED — validation note: read `ouroSelectorReads.ts`'s doc comment directly;
  confirmed the four cited historical bugs (`DALOS.UR_AccountKadena`, `INFO-ZERO` tombstones
  referenced by `RotateGuardModal.tsx`/`RenameDualLaneModal.tsx`/`ActivateApolloPythiaKeyModal.tsx`/
  `RegisterStoicTagModal.tsx`) genuinely produce the identical string shape; the friendly rendering
  as originally written discarded the raw message entirely, so a real regression of this class
  would be masked, not surfaced.
- **Resolution:** FIXED. The raw message is now always carried through via the `title` attribute on
  the friendly rendering (`<div title={classified.raw} ...>`), so the on-chain-vs-broken distinction
  the canon draws is preserved even in the classified case, and a "this looks wrong" report from a
  user still has the raw string to investigate.

### [MEDIUM → FIXED] "ONE fill map" doc-comment claim contradicted by two callers
- **Where:** `packages/codex-ouronet/src/ui/tabs/SingleApiPanel.tsx`,
  `packages/codex-ouronet/src/ui/tabs/DualApiPanel.tsx`
- **Lens:** conventions
- **Evidence:** both files filled `executor`/`patron` with hand-rolled object literals
  (`{executor: stdOwner}`, `{patron: rowOwner, executor: rowOwner}`) instead of calling the new
  `ouronetAccountFillValues` helper `preZbomFillMap.ts`'s own doc comment claims is the ONE shared
  fill map for this class of launcher.
- **Verdict:** CONFIRMED — validation note: grepped both files for
  `ouronetAccountFillValues`, found zero call sites prior to the fix; the doc comment's claim was
  false as written.
- **Resolution:** FIXED. Both files now import and call `ouronetAccountFillValues`. While
  investigating this fix (not part of the original finding), a deeper, self-discovered bug surfaced
  in `DualApiPanel.tsx` — see "Self-discovered fix" below — which changed what the correct `patron`
  argument actually is.

### [LOW → FIXED] Duplicated owner-lookup expression in `DualApiPanel.tsx`
- **Where:** `packages/codex-ouronet/src/ui/tabs/DualApiPanel.tsx`
- **Lens:** conventions
- **Evidence:** `apiKeyMap?.get(halves.standard)?.["owner-account"]` appeared twice — once in the
  per-row fill-value block, once in the `opModal` block further down — with no shared helper.
- **Verdict:** CONFIRMED — validation note: confirmed both occurrences are textually identical and
  read the same map with the same key; no divergence intended.
- **Resolution:** FIXED. Hoisted to a component-scope `standardOwnerOf(halves)` helper, called from
  both sites.

### [HIGH → FIXED] No test exercises the real launcher components' actual wiring
- **Where:** all of `SingleApiPanel.tsx`, `DualApiPanel.tsx`, `OuronetAccountsTab.tsx`
- **Lens:** tests
- **Evidence:** every existing test for the rule-7 fix asserted against the shared helper functions
  directly (`preZbomFillMap.ts`'s own unit tests) or against a source-text regex — nothing rendered
  the real components and captured what `PreZbomHint` actually received.
- **Verdict:** CONFIRMED — validation note: confirmed by grep across `tests/` for a render of
  `SingleApiPanel`/`DualApiPanel` with a mocked `PreZbomHint` capturing `values` — none existed
  before this round.
- **Resolution:** FIXED. New `tests/ui-single-api-panel.test.tsx` and `tests/ui-dual-api-panel.test.tsx`
  render the real components, mock `PreZbomHint` to capture its `values` prop, and assert the
  captured values contain the real, live-resolved account addresses.

### [HIGH → FIXED] Stale `CASES` test block didn't verify the actual patron/executor fix
- **Where:** `packages/codex-ouronet/tests/zbom-prezbom-hint.test.tsx`
- **Lens:** tests
- **Evidence:** the pre-existing `PreZbomHint launcher wiring` test block's `CASES` array supplied
  either a single shared blob object or a stale `{account: "Σ.testaccount"}`-only shape per
  entrypoint — neither exercises whether `patron`/`executor` (the REAL exec param names this round's
  fix corrected) are present.
- **Verdict:** CONFIRMED — validation note: read the pre-fix `CASES` array; none of its 12 entries
  included both `patron` and `executor` for the 6 launchers that declare both.
- **Resolution:** FIXED. `CASES` rewritten to per-entrypoint-scoped, confirmed-real alias subsets:
  explicit `patron`+`executor` for the 6 DALOS/CODEX launchers with a patron slot, `executor`/
  `account` only for the 2 Deploy launchers (no patron slot), the full 4-alias set for
  `DEPLOY_API_KEY_KEY`, `executor`-only for `LINK_DUAL_API_KEY_KEY`, `patron`+`executor` for
  `RENAME_DUAL_LANE_KEY`/`REVOKE_DUAL_LINK_KEY`.

### [MEDIUM → FIXED] Source-text guard covered only 1 of 3 files, and only checked identifier presence
- **Where:** `packages/codex-ouronet/tests/zbom-prezbom-fill-map.test.ts`
- **Lens:** tests
- **Evidence:** the original guard test regexed only `OuronetAccountsTab.tsx` for the absence of the
  old broken pattern; `SingleApiPanel.tsx`/`DualApiPanel.tsx` had no equivalent guard at all, and no
  test checked that the shared helper was actually CALLED (only that certain identifiers appeared
  in source).
- **Verdict:** CONFIRMED — validation note: confirmed the guard test file's `describe` block
  pre-fix contained exactly 2 `it`s, both scoped to `OuronetAccountsTab.tsx`.
- **Resolution:** FIXED. Extended with a third test asserting `SingleApiPanel.tsx`/`DualApiPanel.tsx`
  both import AND call `ouronetAccountFillValues` (regex on the import statement plus a call-site
  pattern). The deeper "correctness, not just presence" gap is covered by the new render-level tests
  from the HIGH finding above, not by strengthening the regex further.

### [MEDIUM → LOW, FIXED] `classifyRefusal` regex boundary untested
- **Where:** `packages/codex-ouronet/tests/zbom-prezbom-hint.test.tsx`
- **Lens:** tests
- **Evidence:** no test exercised a near-miss message (e.g. missing the "for key" clause) to prove
  the regex's boundary — only the fully-matching and a fully-unrelated case were tested.
- **Verdict:** CONFIRMED, severity adjusted MEDIUM → LOW during validation — validation note: the
  regex itself was already re-scoped by the first finding's fix (raw message always preserved via
  `title`), which substantially lowers the cost of a false-positive classification; a boundary test
  is still real coverage, just no longer guarding against a silent-masking failure mode.
- **Resolution:** FIXED. Added a near-miss test asserting a message without the "for key" clause
  falls through to the raw/red rendering.

### [LOW → FIXED] `accounts[0]` undefined only proven at the pure-function level
- **Where:** `packages/codex-ouronet/src/ui/tabs/OuronetAccountsTab.tsx`
- **Lens:** tests
- **Evidence:** `resolvePatronFillValue`'s "no prime address" branch was proven by a direct unit
  test in `zbom-prezbom-fill-map.test.ts`, but no test rendered the real component with a
  single-account (or otherwise `accounts[0]`-degenerate) codex to prove the wiring around it holds.
- **Verdict:** CONFIRMED — validation note: "a single-account or momentarily-empty codex is a real,
  reachable state... if the ternary were ever inverted or the optional-chaining removed, no test in
  this suite would catch it." A genuinely EMPTY `accounts` array never reaches `AccountRow` at all
  (confirmed: `OuronetAccountsTab.tsx` only renders rows for a non-empty list), so the real reachable
  edge is the single-account case, where `accounts[0]` equals the row's own account.
- **Resolution:** FIXED. New `tests/ui-ouronet-accounts-tab-patron-fill.test.tsx` seeds exactly one
  activated, guarded account, expands its row (so the guard-gated `C_RotateGuard` launcher renders),
  mocks `PreZbomHint` to capture `values`, and asserts `patron`/`executor` are both defined and equal
  to the account's own address — proving the `withPatron` ternary produces a real value rather than
  `undefined` or a crash in this edge case.

## Self-discovered fix (beyond any lens finding)

While fixing the "ONE fill map" conventions finding above, reading `DualApiPanel.tsx`'s original
`patron: rowOwner` fill (added by analogy with `OuronetAccountsTab.tsx`'s own `resident → self`
pattern) against the REAL patron-resolution logic in `RevokeDualLinkModal.tsx` revealed the analogy
was wrong: that modal's "resident" means the codex's globally ACTIVE account
(`activeOuroAccount`), a wallet-wide concept `DualApiPanel.tsx` has no access to — not the dual-link
pair's own Standard-half owner (`rowOwner`). The original fix was therefore wrong in every mode, not
just the resident case. Corrected to use `accounts[0]?.address` (prime) consistently, with a doc
comment explaining the deliberate simplification (no "active account" concept in scope in this
file). Covered by `tests/ui-dual-api-panel.test.tsx`'s own assertion that `patron === PRIME_ADDR`,
not the row's owner.

## Terminal clean pass

All 8 findings FIXED (7 lens-sourced + 1 self-discovered), full-scope full-lens-set re-review found
no further CONFIRMED findings. Both commands below were run after the last applied edit (the
`ui-ouronet-accounts-tab-patron-fill.test.tsx` render-level fix, including its own TS2538 fix for
the mocked `PreZbomHint`'s `entrypoint` narrowing, applied identically to `ui-dual-api-panel.test.tsx`
where the same pattern already existed):

```
$ npx tsc -b packages/codex-ouronet --force
(no output — clean)
```

```
$ npx vitest run   # packages/codex-ouronet
 Test Files  117 passed (117)
      Tests  1430 passed (1430)
   Duration  60.55s
```

Behavioral verification against design.md's acceptance criteria:
- `@ouronet/talos-registry@2.2.0` installed and imported (`tooltipModel`, `unfilledFillable`,
  `paramRole` all resolve and are exercised live in `zbom-prezbom-fill-map.test.ts`) — criterion met.
- `LocalStopgapCard` footer text verified by its own test (`toContain("Gas is still sponsored")`) —
  criterion met.
- `classifyRefusal`'s friendly/raw split verified by 3 dedicated tests (missing-row → friendly with
  raw preserved on `title`; near-miss → raw/red; unclassified → raw/red) — criterion met.
- `unfilledFillable(model)` empty for all 11 launchers, Send's `receiver` proven intentionally
  exempt — verified by `zbom-prezbom-fill-map.test.ts`'s full `it.each` suite plus the exemption
  test — criterion met.
- Full workspace typecheck + test green (quoted above), review at a clean pass with zero open
  CONFIRMED findings — criterion met.

Review round count: 1 round of lensing + validation, 8 findings, all fixed in one fix-loop pass, 0
findings surviving to a second round.
