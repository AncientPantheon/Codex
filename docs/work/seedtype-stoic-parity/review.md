# seedtype-stoic-parity — Review

Scope: `packages/codex-core/src/index.ts`, `packages/codex-core/src/resolver/index.ts`,
`packages/codex-core/src/resolver/headlessResolver.ts`,
`packages/codex-core/tests/headless-resolver.test.ts`,
`packages/codex-core/tests/headless-resolver-parity.test.ts`,
`packages/codex-ouronet/tests/type-seedtype-parity.test.ts`, plus the version/CHANGELOG
bumps in `codex-core`, `codex-ouronet`, `codex` (12 files — the 4–15 file tier: 4 lenses run).

## Lens findings

- **correctness** — no findings. Traced the `StoaChainSeedType`/`MnemonicSeedType` split,
  the guard's narrowing, and branch precedence; all consistent and unchanged elsewhere.
- **conventions** — no findings. New code follows this file's own doc-comment discipline
  and the existing "compile-time assignability proof" idiom; barrel re-exports consistent
  at all three levels.
- **security** — no findings. Independently confirmed the guard executes before any
  account match or mnemonic-path crypto call, that the widened type doesn't leak "stoic"
  into any other codex-core path, and that no real secrets appear in any test fixture.
- **tests** — 1 finding (below).

### [MEDIUM → STYLISTIC] Golden-fixture parity replay never exercises the new stoic skip-guard
- **Where:** `packages/codex-core/tests/headless-resolver-parity.test.ts:198-199`;
  `packages/codex-core/tests/fixtures/resolver-parity-golden.json:16-31`
- **Evidence:** the transcription's added `if (seed.seedType === "stoic") continue;` is
  never hit by any of the fixture's four replayed cases (fixture has one seed,
  `seedType: "koala"`).
- **Verdict: STYLISTIC** (validator downgraded from MEDIUM). The correctness lens
  independently reached the opposite conclusion on the same fact ("not a gap, since the
  dedicated tests already cover it directly"), which is exactly what validation exists to
  resolve. The validator found: the transcription's own inline comment explicitly
  documents *why* the guard is there without fixture coverage (mirroring
  `InternalCodexResolver.ts`'s pre-check, outside this file's stated L124-198 scope); the
  file's own header already carries a formal, tracked "RESIDUAL GAP (plan P-001)" note
  acknowledging the transcription is a surrogate that can drift, deferred by design to a
  separate live-resolver cross-check; and `headless-resolver.test.ts`'s dedicated
  "STOIC SEED GUARD" tests already assert the *stronger* guarantee against the actual
  production code path (the factory) — that `decryptSecret`/`deriveStoaChainKeypair` are
  never called at all, not just that output matches. A competent reviewer could argue
  either side — hence STYLISTIC, not a defect.
- **Resolution: left as-is.** Offered to the user as a take-it-or-leave-it improvement
  (add a stoic case to the golden fixture for completeness), not applied — the funds-
  critical guarantee is already proven, more strongly, elsewhere.

No other findings survived or were raised.

## Fix loop

Zero CONFIRMED findings on the first full-scope, full-lens-set pass. No edits applied
during review (the one finding resolved to STYLISTIC, and the user's standing instruction
was to only apply CONFIRMED fixes / surface STYLISTIC choices without pausing on
mechanical items — this one is left as a documented backlog-style option below, not
silently dropped).

## Verification

- `npm run typecheck` (root, all 6 workspaces): exit 0, no output — quoted output above
  during build; re-confirmed post-review with no further edits.
- `npm run test` (root): `arweave-core` 383/383, `codex-core` 205/205, `codex-ui` 252/252,
  `codex-ouronet` 1258/1258 (one pre-existing flake — `ui-seed-words-tab.test.tsx` —
  confirmed identical on unmodified `main` via `git stash`, not a regression),
  `codex-arweave` 536 passed + 1 skipped with 6 pre-existing environment failures
  (`node:sqlite` Vite-bundling error, confirmed identical on unmodified `main` via
  `git stash`, untouched by this diff), aggregator `codex` has no tests of its own.
- **Behavioral verification** (feature-scale requirement): reproduced Pythia's exact
  reported failure directly — a real `CodexSnapshot` (whose `kadenaSeeds` carry the full
  4-member `SeedType` including `"stoic"`) assigned to codex-core's `SnapshotSlice`, and a
  real `CodexSnapshot` with a stoic seed fed through the actual public
  `createHeadlessKadenaResolver` factory Pythia/Khronoton consume. Compiled via the
  package's real `tsconfig.json` (path-mapped to `src`, the same resolution a production
  typecheck uses): `npx tsc --noEmit` → exit 0, no errors. Confirms AC1 directly, not just
  by inference from the unit tests.

## Outcome

All 6 acceptance criteria in `design.md` are met:
- [x] A `CodexSnapshot` with a `"stoic"` seed assigns to `SnapshotSlice` with no cast —
  reproduced and confirmed via the behavioral-verification probe above.
- [x] The factory's derived-account loop never calls `deriveStoaChainKeypair` with
  `seedType: "stoic"` — compiler-enforced (narrowing) and unit-tested (mock call-count
  assertions in `headless-resolver.test.ts`).
- [x] Existing koala/chainweaver/eckowallet/pure-foreign behavior unchanged — all
  pre-existing assertions in `headless-resolver.test.ts`,
  `headless-resolver-parity.test.ts`, `resolver-internal.test.ts`,
  `resolver-live-parity.test.ts`, and `headless-kadena-resolver.test.ts` pass unmodified.
- [x] New compile-time parity test (`type-seedtype-parity.test.ts`) fails `tsc` if
  `SeedType`/`StoaChainSeedType` diverge.
- [x] `StoaChainSeedType`'s doc comment now accurately describes its relationship to
  `SeedType` and `MnemonicSeedType`.
- [x] Full workspace typecheck + test green; `codex-core` (0.5.0), `codex-ouronet`
  (0.18.0), and the `@ancientpantheon/codex` aggregator (0.18.0) version-bumped with
  CHANGELOG entries — not yet published (publish is a separate, explicit step per the
  user's standing rule).

Round count: 1. Clean pass confirmed.
