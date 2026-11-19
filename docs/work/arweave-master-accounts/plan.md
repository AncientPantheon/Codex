# Arweave Master Accounts — Plan

Design: `docs/work/arweave-master-accounts/design.md`.

## Before you start

1. **`@testing-library/jest-dom` is declared but never registered** in
   `packages/codex-ouronet/tests/setup.ts` — `toBeDisabled()` /
   `toHaveAttribute()` / `toBeInTheDocument()` throw `Invalid Chai property`,
   and inside `waitFor` that surfaces as an opaque *"Test timed out in
   5000ms"*. Use plain property/DOM checks. (`packages/codex-arweave` DOES
   register it — check that package's `tests/setup.ts` before assuming.)
2. vitest `testTimeout` is 5000ms in both packages; a failing `findBy*` hides
   the real error. Re-run with `--testTimeout=40000` when diagnosing a RED.
3. Workspace packages are aliased to `src` in the vite configs — no rebuild
   needed after changing another package.

Baselines: `codex-ouronet` **2024/2025** (the one failure is the pre-existing
unrelated `tests/pact-signatures.test.ts` Pact-codegen drift guard);
`codex-arweave` **1053 passed, 0 failed, 1 skipped** (fully green).

Shapes you will need (verify each):
- `IArweaveSeed { id, name?, secret /* encryptStringV2(bitString) */, createdAt, isPrime?, wordsSecret? }`
  — `packages/codex-ouronet/src/types/entities.ts`.
- `ForeignKeyEntry { id, label?, chainId, encryptedKeyfile, seedId?, index?, address? }`
  — `packages/codex-core/src/codex/foreignKeys.ts`. `(seedId, index)` addresses
  a key; `index` is per-seed and is rejected without a `seedId`.
- `SeededKey { index, jwk, address }` and
  `runSeededBatch({ bits, ranges, workerFactory, onKey, onProgress, onBatchProgress, signal })`
  — `packages/codex-arweave/src/keygen/KeygenRunner.ts`.
- The existing persist composition to copy, `persistKey` in
  `packages/codex-arweave/src/panel/ArweavePanel.tsx` (~line 874):
  `const encrypted = await deps.generateArweaveKey({ jwk, label: \`#${index}\` });`
  then `await deps.addForeignKey({ ...encrypted, seedId, index, address });`

## Wave 1

- [x] T1: Add the eligibility predicate beside the dashboard's existing Arweave
      check — done when: `packages/codex-ouronet/src/ui/internal/seedDashboard.ts`
      exports `codexHoldsMasterArweaveAccounts(input)` taking
      `{ masterBitString: string | null; arweaveSeeds: readonly IArweaveSeed[];
      foreignKeys: readonly ForeignKeyEntry[]; password: string | null;
      smartDecrypt: (ct: string, pw: string) => Promise<string> }` and resolving
      to `{ ok: boolean; seedId: string | null; missingIndexes: number[] }`.
      `ok` is true iff some `arweaveSeeds[i]` decrypts to exactly
      `masterBitString` AND `foreignKeys` contains an entry with that seed's
      `id` at `index === 0` and another at `index === 1`. `seedId` names the
      matching seed when one decrypts (even if accounts are missing), else
      `null`. `missingIndexes` lists which of `[0, 1]` are absent for that seed
      (`[0, 1]` when no seed matched at all). Returns
      `{ ok: false, seedId: null, missingIndexes: [0, 1] }` for a null
      `masterBitString` or null `password`, and never throws — a seed whose
      decrypt fails is skipped exactly as `resolveArweaveMatchSeedId` already
      skips one. The module is deliberately pure/React-free (read its header);
      `smartDecrypt` stays injected, no import of a crypto lib.
      Tests (`packages/codex-ouronet/tests/seed-dashboard-rows.test.ts`,
      extending its existing `resolveArweaveMatchSeedId` fixtures): no Arweave
      seed → `ok:false, seedId:null, missingIndexes:[0,1]`; matching seed with
      both indexes → `ok:true, missingIndexes:[]`; matching seed with only
      index 0 → `ok:false, missingIndexes:[1]`; matching seed with keys that
      carry a DIFFERENT `seedId` → those keys do not count, `missingIndexes:[0,1]`;
      a non-matching seed holding both indexes → `ok:false, seedId:null`; a
      seed whose decrypt throws is skipped without throwing; null password →
      `ok:false` without calling `smartDecrypt`.
  - files: `packages/codex-ouronet/src/ui/internal/seedDashboard.ts`,
    `packages/codex-ouronet/tests/seed-dashboard-rows.test.ts`

- [x] T2: Derive BOTH master positions and actually persist them — done when:
      `ensurePrimeArweaveSeed` in `packages/codex-arweave/src/panel/CodexIdPage.tsx`
      stops discarding its derivation. Today it `await`s
      `deriveArweaveSeedAtPositionZero(...)` (which runs
      `ranges: [{ start: 0, end: 0 }]`), never captures the returned
      `SeededKey`, and writes only the seed row via `addArweaveSeed` — so the
      codex gains an Arweave seed and ZERO Arweave accounts. After this task it:
      (a) resolves/creates the seed whose decrypted bitstring equals the passed
      `bitString` — reusing the existing early-return when a prime seed already
      matches, but capturing that seed's `id` instead of returning blind;
      (b) derives the positions in `missingIndexes` (defaulting to `[0, 1]`)
      in ONE `runSeededBatch` call with `ranges` covering them, not two batches;
      (c) persists EACH delivered key as it arrives via the existing
      composition — `deps.generateArweaveKey({ jwk, label: \`#${index}\` })`
      then `deps.addForeignKey({ ...encrypted, seedId, index, address })` —
      copying `persistKey` in `ArweavePanel.tsx` (~line 874) rather than
      inventing a second path; (d) accepts an OPTIONAL
      `onProgress?: (p: { index: number; delivered: number; total: number }) => void`
      argument driven by the batch's own `onKey`/`onBatchProgress` events, never
      a timer; (e) accepts an OPTIONAL `missingIndexes?: readonly number[]` so a
      caller that already knows only #1 is missing derives only #1.
      Its signature becomes
      `(words: { bitString: string; words?: readonly string[] }, opts?: { missingIndexes?: readonly number[]; onProgress?: … }) => Promise<void>`
      — the extra argument is optional so the existing wizard prop type and
      every current call site still compile.
      Tests (`packages/codex-arweave/tests/e4-panel-codex-id.test.tsx`, which
      already captures the wizard's props and has a `FakeWorker`): invoking the
      captured `ensurePrimeArweaveSeed` on a codex with no Arweave seed emits
      BOTH keys and results in two `addForeignKey` entries carrying the new
      seed's `seedId` with `index` 0 and 1 and their `address`es; passing
      `missingIndexes: [1]` derives and persists only index 1; `onProgress` is
      called for each delivered key; a derivation that delivers zero keys
      rejects rather than silently writing a seed with no accounts.
  - files: `packages/codex-arweave/src/panel/CodexIdPage.tsx`,
    `packages/codex-arweave/tests/e4-panel-codex-id.test.tsx`

## Wave 2 (depends on Wave 1 — T3 calls T1's predicate and T2's new options)

- [x] T3: Finalize verifies before it claims, and shows real progress while
      deriving — done when: `runFinalize` in
      `packages/codex-ouronet/src/ui/internal/LegacyPrimeMigrationWizard.tsx`
      (a) evaluates `codexHoldsMasterArweaveAccounts` against the resolved
      master bitstring BEFORE deriving, and skips derivation entirely when
      `ok` is already true; (b) otherwise calls `ensurePrimeArweaveSeed` with
      that result's `missingIndexes` and an `onProgress` handler, rendering the
      progress in the finalize panel while it runs (a `data-testid`
      `legacy-prime-migration-finalize-arweave-progress` naming which position
      is being derived and how many are done); (c) RE-EVALUATES the predicate
      after derivation and claims eligibility — the "This codex is now
      eligible." panel and the `primeAlignment: "aligned"` stamp — ONLY when
      the re-evaluation returns `ok: true`; (d) when it returns `ok: false`, or
      `ensurePrimeArweaveSeed` is absent/throws, keeps today's
      `arweave-unavailable` status, does NOT stamp alignment, and does not
      print the eligible panel. The existing non-Arweave writes (the master
      seed row, the locks) keep their current behaviour and ordering.
      Tests (`packages/codex-ouronet/tests/ui-legacy-prime-migration-wizard.test.tsx`):
      a codex already holding #0 and #1 under the master seed reaches the
      eligible panel WITHOUT `ensurePrimeArweaveSeed` being called; a codex
      missing both has it called with `missingIndexes: [0, 1]` and reaches the
      eligible panel once the predicate passes; a codex whose
      `ensurePrimeArweaveSeed` resolves but leaves the predicate false does NOT
      show the eligible panel and does NOT stamp `primeAlignment: "aligned"`
      (this is the exact bug reported — a success message over a dark violet
      ticker); an absent `ensurePrimeArweaveSeed` still yields
      `arweave-unavailable`.
  - files: `packages/codex-ouronet/src/ui/internal/LegacyPrimeMigrationWizard.tsx`,
    `packages/codex-ouronet/tests/ui-legacy-prime-migration-wizard.test.tsx`

## Design-criteria coverage

| design.md criterion | task |
|---|---|
| Finalize on a seedless codex yields seed + index 0 AND 1 | T2, T3 |
| Violet ticker lit exactly when eligibility is claimed | T1 (one predicate), T3 |
| Already-complete codex derives nothing | T1, T3 |
| Codex holding only #0 derives exactly #1 | T1 (`missingIndexes`), T2, T3 |
| Different-seed codex gains #0/#1; pre-existing seeds/keys survive | T1 (seed match by bitstring), T2 (additive writes only) |
| Cannot generate ⇒ says so, claims nothing, stamps nothing | T3 |
| Progress driven by worker events, not a timer | T2 (`onProgress`), T3 (renders it) |
