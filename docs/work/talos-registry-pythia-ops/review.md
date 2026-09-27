# Talos Registry Migration — Pythia Ops — Review

Scope: the union of plan.md's ticked tasks' `- files:` lists (10 files) —
`src/zbom/pythia/{dualLinkOps,linkDualApiKey,deployApiKey}.ts`,
`src/zbom/modals/{RenameDualLaneModal,RevokeDualLinkModal,LinkDualApiKeyModal,
ActivateApolloPythiaKeyModal}.tsx`, and three new test files
(`tests/zbom-pythia-{dual-link-ops,link-dual-api-key,deploy-api-key}.test.ts`).
Lenses: correctness, conventions, tests, security (4–15 file tier; security
included because the diff touches Pact call construction for real
capability-bearing financial operations).

## Round 1

### [MEDIUM] Missing `.toThrow` proof that the exec/preview param distinction is load-bearing (dualLinkOps)
- **Where:** tests/talos-registry-dual-link-ops.test.ts (whole file)
- **Verdict:** CONFIRMED (validator adjusted HIGH → MEDIUM: a real regression would still fail the suite via an uncaught `RegistryError`, just not with a clearly-labeled proof — a documentation-parity gap, not a silent hole)
- **Resolution:** fixed — added two tests asserting `buildCall(RENAME_DUAL_LANE_KEY, <preview's 3-key shape>)` / `buildCall(REVOKE_DUAL_LINK_KEY, <preview's 2-key shape>)` throw `/missing: executor/`, matching the pattern already proven in `zbom-pythia-link-dual-api-key.test.ts`/`zbom-pythia-deploy-api-key.test.ts`.

### [MEDIUM] `let*`-wrapped composite readers untested in both files that have them
- **Where:** `dualLinkOps.ts`'s `getRenameDualLaneInfo`, `deployApiKey.ts`'s `getDeployApiKeyInfo`
- **Verdict:** CONFIRMED — neither function was imported or exercised by any test; a malformed interpolation in the hand-composed `let*`/`map`/`at` wrapper would go fully undetected.
- **Resolution:** fixed — added a test per file asserting the reader receives pact code containing the exact spliced preview-builder output plus the `let*`/`DALOS.UR_AccountStoa`/`kadena-targets` structure, and the parsed `{info, receivers}` result; plus a missing-params-returns-null-without-calling-reader test per file.

### [LOW] `zbom-pythia-deploy-api-key.test.ts`'s resolution test didn't pin live param names/order
- **Where:** tests/zbom-pythia-deploy-api-key.test.ts:21-23
- **Verdict:** CONFIRMED (low impact — a real drift would already break the file's hardcoded-string assertions, but this test itself contributed no independent signal)
- **Resolution:** fixed — extended to assert `ep?.params.map(p => p.name)` and `ep?.preview` explicitly, matching the sibling `zbom-pythia-link-dual-api-key.test.ts` pattern.

### [LOW→MEDIUM verdict, LOW severity] Test file naming inconsistency
- **Where:** `tests/talos-registry-dual-link-ops.test.ts` vs. its two `zbom-pythia-*`-prefixed siblings
- **Verdict:** CONFIRMED, severity MEDIUM → LOW (zero behavioral/tooling impact — no lint rule or vitest glob depends on the prefix; pure discoverability)
- **Resolution:** fixed — renamed to `tests/zbom-pythia-dual-link-ops.test.ts`.

### [LOW] `X_KEY` constant placement order inconsistent across the three ops files
- **Verdict:** STYLISTIC — declaration order, no functional consequence, no documented codebase convention either way.
- **Resolution:** left as-is (user's call if they want it normalized later).

### [LOW] "Not a registered entrypoint" comment reworded between dualLinkOps.ts and deployApiKey.ts
- **Verdict:** STYLISTIC — both convey the same fact correctly; "mirror" in the doc comment describes the STOA-split resolution structure, not a requirement for verbatim comment parity.
- **Resolution:** left as-is.

### Correctness, security: zero findings in round 1.

## Round 2 (terminal, full-scope, full-lens-set)

Re-ran all 4 lenses fresh against the current state (post round-1 fixes).

### [MEDIUM] `dualLinkOps.test.ts`'s resolution tests still didn't pin param names/order (the round-1 fix for deploy-api-key wasn't mirrored here)
- **Verdict:** CONFIRMED — a real gap in content added during round 1's own fix, inconsistent with the pattern its two siblings now both use.
- **Resolution:** fixed — added `expect(ep?.params.map(p => p.name)).toEqual([...])` for both `RENAME_DUAL_LANE_KEY` and `REVOKE_DUAL_LINK_KEY`, values re-verified live against the installed registry before writing (`["patron","executor","dual-link-key","new-name"]` / `["patron","executor","dual-link-key"]`).

### [MEDIUM] `LinkDualApiKeyModal.tsx`: guard-loaded state never settles when an owner is empty (correctness lens)
- **Verdict:** real bug, but **out of this diff's scope** — verified via `git diff HEAD -- .../LinkDualApiKeyModal.tsx`: the only hunks are the import-line addition and the `pactCall={...}` replacement; lines 108-132 (the affected `useEffect`s and `blockerReason`) are untouched by this migration. Not fixed here — flagged for a separate topic/backlog entry.

### [MEDIUM] `ActivateApolloPythiaKeyModal.tsx`: leftover verbose `console.log` dumps of guard/signer routing details (raised independently by both security and conventions lenses)
- **Verdict:** real, but **out of this diff's scope** — verified via `git diff HEAD -- .../ActivateApolloPythiaKeyModal.tsx`: no `console.log` line appears in any hunk; the only changes are the import addition, the `pactCall`/`functionName` lines, and the exclusion comment. Not fixed here — flagged for a separate topic/backlog entry (worth noting: two independent lenses converged on the same pre-existing issue, which is a reasonable signal it's worth fixing soon, just not as part of this migration).

### Tests, security (source files): zero findings in round 2 beyond the two out-of-scope items above.

## Clean pass

After round 2's one in-scope fix:
- `cd packages/codex-ouronet && npx tsc --noEmit` — exit 0, no output.
- `cd packages/codex-ouronet && npx vitest run` — `Test Files 99 passed (99)` / `Tests 1226 passed (1226)`.
- Full-scope, full-lens-set (correctness, conventions, tests, security) pass: zero CONFIRMED findings remaining within this diff's scope.

**Behavioral verification:** the three new/updated test files exercise `buildCall`/`buildPreviewCall` against the real, unmocked, installed `@ouronet/talos-registry` package (confirmed by the correctness-lens agent independently reading `node_modules/@ouronet/talos-registry/dist/data/registry.json` and matching every asserted param name/order against it), asserting exact byte-for-byte rendered Pact call strings — e.g. `buildLinkDualApiKeyPactCode(...)` → `` `(ouronet-ns.TS01-C4.PYTHIA|C_Link "Ѻ.EXEC" "₱.A" "Π.B" "Explorer")` ``. This is the real command for a library-level migration; no separate live-UI exercise was available in this headless environment.

## Out-of-scope items surfaced during review (not fixed, not blocking this topic)

1. `LinkDualApiKeyModal.tsx` (`src/zbom/modals/`, lines ~108-132): when `standardOwner`/`smartOwner` is empty, `stdGuardLoaded`/`smtGuardLoaded` never flip true, so `blockerReason` gets stuck on "Resolving owner guards…" instead of surfacing the clear "half not in this Codex" message its sibling modals (`RenameDualLaneModal`, `RevokeDualLinkModal`) show in the same situation. Pre-existing, confirmed untouched by this diff.
2. `ActivateApolloPythiaKeyModal.tsx` (lines ~353-365, 400-403): two `console.log` calls dumping full guard/signer/routing details on every deploy — inconsistent with every sibling modal in this same migration, none of which log this way. Pre-existing, confirmed untouched by this diff.

Both are real and worth a follow-up fix; recommend a backlog entry.

## Round count: 2. Clean pass confirmed.
