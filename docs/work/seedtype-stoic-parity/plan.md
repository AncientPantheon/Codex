## Wave 1
- [x] T1: Split `StoaChainSeedType` into a widened data-label type and a new
  `MnemonicSeedType` capability type in codex-core's headless resolver, and
  add the stoic skip-guard to the derived-account loop.
  - Widen `StoaChainSeedType` (currently `"koala" | "chainweaver" | "eckowallet"`)
    to `"koala" | "chainweaver" | "eckowallet" | "stoic"`.
  - Add new exported type `MnemonicSeedType = "koala" | "chainweaver" | "eckowallet"`
    (the pre-existing 3-member list, under a new name).
  - Change `HeadlessResolverDeps.deriveStoaChainKeypair`'s `seedType` parameter
    type from `StoaChainSeedType` to `MnemonicSeedType`.
  - Change `ResolvedStoaChainKeypair.seedType` from `StoaChainSeedType | "foreign"`
    to `MnemonicSeedType | "foreign"`.
  - In `getKeyPairByPublicKey`'s derived-account loop (the
    `for (const seed of kadenaSeeds)` block), add `if (seed.seedType === "stoic") continue;`
    immediately after the `for` line and before the `account.publicKey === publicKey`
    lookup, so `seed.seedType` narrows to `MnemonicSeedType` for the rest of the
    loop body (no cast needed at the `deps.deriveStoaChainKeypair(...)` call).
  - Replace the stale doc comment above `StoaChainSeedType` (currently claims to
    mirror codex-ouronet's `SeedType` "verbatim") with one stating: `StoaChainSeedType`
    is every real seed label a codex can hold (kept in parity with
    codex-ouronet's `SeedType` by a compile-time test, not by this comment);
    `MnemonicSeedType` is the derivable subset this factory's
    `deriveStoaChainKeypair` seam actually handles.
  - done when:
    - `StoaChainSeedLike.seedType: StoaChainSeedType` accepts a `"stoic"` value
      with no cast (a snapshot object literal `{ secret: "x", seedType: "stoic",
      accounts: [] }` type-checks as `StoaChainSeedLike`).
    - `npm run typecheck --workspace=@ancientpantheon/codex-core` passes.
    - A new test in the same file proves the guard: constructing a `SnapshotSlice`
      whose sole `kadenaSeeds` entry has `seedType: "stoic"` and an account
      matching the requested `publicKey`, then calling
      `getKeyPairByPublicKey(snapshot, publicKey, password)` rejects with
      `CodexKeyMissingError` (not a resolved keypair), and the injected
      `deriveStoaChainKeypair` mock's call count is asserted `0` (proves the
      guard skipped derivation rather than merely happening to fail elsewhere).
    - Existing koala/chainweaver/eckowallet/pure-foreign test cases already in
      `headless-resolver.test.ts` pass unchanged (no assertion edits).
  - files: `packages/codex-core/src/resolver/headlessResolver.ts`,
    `packages/codex-core/tests/headless-resolver.test.ts`

## Wave 2 (depends on Wave 1)
- [x] T2: Add a compile-time parity test between codex-ouronet's `SeedType` and
  codex-core's `StoaChainSeedType`, following this codebase's existing
  "compile-time assignability proof" idiom (see the `const asContract: X = y;`
  pattern already used in `InternalCodexResolver.ts` and
  `headlessKadenaResolver.ts`) rather than a new mechanism.
  - New file `packages/codex-ouronet/tests/type-seedtype-parity.test.ts`:
    imports `SeedType` from `../src/types/entities.js` and `StoaChainSeedType`
    from `@ancientpantheon/codex-core`; declares a type-level mutual-assignability
    check (e.g. `type AssertExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;`
    and `const _seedTypeParity: AssertExact<SeedType, StoaChainSeedType> = true;`)
    plus one runtime `it(...)` (e.g. asserting a small fixture array of all four
    literal values type-checks as both `SeedType` and `StoaChainSeedType`) so the
    file isn't a type-only no-op under a test runner that skips type-only files.
    Include a doc comment stating the check exists so a future member added to
    either union without the other fails `tsc`, not just this test's runtime
    assertion.
  - done when:
    - `npm run typecheck --workspace=@ancientpantheon/codex-ouronet` passes with
      the new file present.
    - `npm run test --workspace=@ancientpantheon/codex-ouronet` passes, including
      the new file's runtime assertion.
    - Manually confirmed (documented in the task's completion note, not a
      committed change): temporarily removing `"stoic"` from one of the two
      unions and re-running typecheck fails with a type error pointing at this
      file's assertion line, then the temporary edit is reverted.
  - files: `packages/codex-ouronet/tests/type-seedtype-parity.test.ts`

## Wave 3 (depends on Wave 1, Wave 2)
- [x] T3: Version bump + CHANGELOG entries across the three affected packages,
  plus full-workspace verification.
  - Bump `packages/codex-core/package.json` version `0.4.0` → `0.5.0` (minor:
    additive type-surface change — `StoaChainSeedType` gains `"stoic"`, new
    exported `MnemonicSeedType`).
  - Bump `packages/codex-ouronet/package.json` version `0.17.0` → `0.18.0`.
  - Bump `packages/codex/package.json` (the published aggregator) version
    `0.17.0` → `0.18.0`.
  - Add a top entry to each of `packages/codex-core/CHANGELOG.md`,
    `packages/codex-ouronet/CHANGELOG.md`, `packages/codex/CHANGELOG.md`
    (matching each file's existing heading style, e.g. `## 0.5.0 — 2026-09-27`)
    describing: the `StoaChainSeedType`/`SeedType` divergence that broke every
    headless-resolver consumer's typecheck on `"stoic"`-bearing snapshots
    (external symptom: Pythia's `keyResolver.ts:88` `TS2322` on every deploy
    that bumps to `@latest`), the `MnemonicSeedType` split fix, the added
    stoic skip-guard, and the new parity test.
  - done when:
    - `npm run typecheck` (root) exits 0 across all workspaces.
    - `npm run test` (root) exits 0 across all workspaces, with zero assertion
      changes to any pre-existing test file outside
      `packages/codex-core/tests/headless-resolver.test.ts` (T1) and the new
      `packages/codex-ouronet/tests/type-seedtype-parity.test.ts` (T2) — in
      particular `headless-resolver-parity.test.ts`, `resolver-internal.test.ts`,
      `resolver-live-parity.test.ts`, and `headless-kadena-resolver.test.ts`
      are unmodified and green.
    - All three `package.json` files show the bumped versions; all three
      `CHANGELOG.md` files have the new top entry.
  - files: `packages/codex-core/package.json`, `packages/codex-core/CHANGELOG.md`,
    `packages/codex-ouronet/package.json`, `packages/codex-ouronet/CHANGELOG.md`,
    `packages/codex/package.json`, `packages/codex/CHANGELOG.md`
