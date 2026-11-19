# Former Master Record — Plan

Topic 3 of `docs/work/prime-two-name-model/design.md`. **Promoted ahead of
topic 2** because half of it is a live data-loss fix.

## Before you start

1. `@testing-library/jest-dom` is declared but NEVER registered in
   `packages/codex-ouronet/tests/setup.ts` — its matchers throw `Invalid Chai
   property`, surfacing inside `waitFor` as an opaque *"Test timed out in
   5000ms"*. Use plain checks there. `packages/codex-arweave/tests/setup.ts`
   DOES register it (line 12).
2. **Measured flake:** `packages/codex-ouronet/tests/ui-legacy-prime-migration-wizard.test.tsx`
   gives ~10 pure-timeout failures at the configured 5000ms on a loaded box and
   passes fully at `--testTimeout=40000`. Always use that flag for this package.
3. Workspace packages are aliased to `src` — no rebuild between packages.

Baselines (after topic 1's rename lands): `codex-core` 275 passed;
`codex-ouronet` 2094 passed + 1 pre-existing unrelated failure
(`tests/pact-signatures.test.ts`, Pact-codegen drift guard); `codex-arweave`
71/71 files, 1094 passed, 1 skipped.

Verified grounding — sanity-check, do not re-derive:
- `CodexMasterSeed` — `packages/codex-core/src/codex/masterSeed.ts:31-40`:
  `ouroAccountId`, `chainwebSeedId`, `arweaveSeedId?`, `establishedAt`.
  Writer `setCodexMasterSeed` (`packages/codex-ouronet/src/state/store.ts:1782-1801`)
  MERGES, keeps `establishedAt` sticky, refuses a row missing either mandatory
  face, short-circuits on no-change.
- **Nothing anywhere records a former master.** The only genuine former-role
  marker in the codebase is `IPureKeypair.wasCodexGuard`
  (`packages/codex-ouronet/src/types/entities.ts:216-233`) — retired
  CodexGuards are kept "stored forever" with a retirement-ordered label, and
  `store.ts:125` holds its suffix regex. That is the precedent to follow.
- The Arweave demotion block — `packages/codex-arweave/src/panel/CodexIdPage.tsx:886-908`.
  Its predicate is `seed.name === PRIME_SEED_LABEL`, a NAME-STRING match, and
  it overwrites the displaced seed's stored `name` with
  `nextGenericArweaveSeedName(...)` ("Arweave Seed N",
  `GENERIC_ARWEAVE_SEED_NAME_PREFIX` at `:159-185`).
- Name destruction at creation: `CodexIdPage.tsx:880` writes
  `name: PRIME_SEED_LABEL` into the new row;
  `packages/codex-arweave/src/panel/ArweaveSeedsArea.tsx:1476-1478` and
  `:1596-1603` discard the user's typed `labelText` when `isPrime`.
- Arweave seeds have NO rename UI at all
  (`ArweaveSeedsArea.tsx:2536-2537`), so a destroyed name is unrecoverable.
- `resolveMasterArweaveSeed`
  (`packages/codex-arweave/src/panel/resolveMasterArweaveSeed.ts:50-59`) already
  resolves the master seed by id with an `isPrime` → position fallback. Reuse
  it; do not write a second resolver.
- `addArweaveSeed`'s `id-conflict` guard (`store.ts:2015-2020`) means
  `IArweaveSeed.isPrime` is structurally un-relocatable — it is PROVENANCE
  ("first seed ever added"), never "is the master". Do not touch it.
- `isMigrationSealed(progress)` / `hasMigrationPending(progress)` —
  `packages/codex-core/src/codex/migrationProgress.ts:219-237`.

## Wave 1

- [x] T1: Stop destroying user-chosen Arweave seed names — done when: a name
      the user typed survives a seed becoming, or ceasing to be, the Master
      ArWeave Seed. Three sites currently destroy it and all three must stop:
      (a) `CodexIdPage.tsx:880` — the created master row no longer writes
      `name: PRIME_SEED_LABEL`; it carries the user's name when there is one
      and otherwise leaves `name` unset, since the golden designation is
      derived, not stored (design: "the golden designation is DERIVED from the
      role; it is never stored on the entity");
      (b) `ArweaveSeedsArea.tsx:1476-1478` and `:1596-1603` — stop discarding
      `labelText` when `isPrime`; the typed name is stored as the seed's own
      `name` regardless of role;
      (c) `CodexIdPage.tsx:886-908` — the demotion no longer rewrites the
      displaced seed's `name` at all. Delete `nextGenericArweaveSeedName` and
      `GENERIC_ARWEAVE_SEED_NAME_PREFIX` if nothing else uses them (grep
      first; report if anything does).
      Because the designation stops living in `name`, the rendered master label
      must come from the resolver instead: `ArweaveSeedsArea`'s master row
      (already `resolveMasterArweaveSeed`-driven, `:1229-1240`, `:1780`)
      displays `MASTER_ARWEAVE_SEED` as its golden designation and the seed's
      own `name` as its normal name, on the existing two-line pattern used by
      `OuronetAccountsTab.tsx:681-692`. A seed with no stored name shows the
      designation alone.
      Tests (`packages/codex-arweave/tests/e4-panel-codex-id.test.tsx` — note
      its describe block at ~`:1483-1627` currently asserts exactly-one-seed-
      titled-master plus the generic rename, and must be REWRITTEN to the new
      model rather than deleted; and
      `packages/codex-arweave/tests/e5-seeds-area.test.tsx`): a seed created
      with a user-typed name keeps that name while it is master; the displaced
      seed keeps its own stored name and is NOT renamed; a seed with no stored
      name renders the designation alone; exactly one row still renders the
      gold master treatment (via the resolver, not via a name match).
  - files: `packages/codex-arweave/src/panel/CodexIdPage.tsx`,
    `packages/codex-arweave/src/panel/ArweaveSeedsArea.tsx`,
    `packages/codex-arweave/tests/e4-panel-codex-id.test.tsx`,
    `packages/codex-arweave/tests/e5-seeds-area.test.tsx`

## Wave 2 (depends on Wave 1 — T2's demotion predicate replaces what T1 deleted)

- [x] T3: Record the former master, and derive the "Former …" designations —
      done when: `CodexMasterSeed` carries the displaced holders' ids, and both
      former designations are computed from them rather than stored as names.
      Add to `packages/codex-core/src/codex/masterSeed.ts`:
      `formerOuroAccountIds?: readonly string[]` and
      `formerArweaveSeedIds?: readonly string[]` — append-only history, most
      recent LAST, following `wasCodexGuard`'s "stored forever" discipline.
      `setCodexMasterSeed` (`store.ts:1782-1801`) appends the OUTGOING id to
      the matching list whenever a face id actually changes, de-duplicating and
      never recording the incoming id. Keep its merge semantics, its sticky
      `establishedAt`, its two-mandatory-faces refusal and its no-change
      short-circuit exactly as they are.
      Export from `packages/codex-core/src/index.ts` two pure, unit-tested
      helpers alongside the existing `masterOuronetAccountParts`:
      `isFormerMasterAccount(accountId, row)` and
      `isFormerMasterArweaveSeed(seedId, row)`, each true iff the id appears in
      the corresponding former list AND is not the current holder.
      The displaced Ouronet account then renders the golden designation
      "Former Codex Ouronet Master" and the displaced Arweave seed renders
      "Former Master Arweave Seed" — both DERIVED, both alongside the entity's
      own stored name, never overwriting it.
      Gate both on the seal: `isMigrationSealed(progress)`, per the design's
      "the designation follows the SEAL, not the finalize". A
      finalized-but-unapplied codex shows no former designation.
      Add the two designation strings to
      `packages/codex-core/src/codex/masterNames.ts` beside the existing
      constants, and pin their exact values in
      `packages/codex-core/tests/master-names.test.ts` the same way
      `OURONET_CODEX_MASTER` is pinned — these are product names, and a silent
      change should have to break a test.
      Tests (`packages/codex-core/tests/master-seed-row.test.ts` and
      `master-names.test.ts`; `packages/codex-ouronet/tests/` store spec
      covering `setCodexMasterSeed`): moving the master appends exactly the
      outgoing id; moving it twice yields both, in order, no duplicates;
      re-setting the same id appends nothing; a first-ever settlement records
      no former; `isFormerMasterAccount`/`isFormerMasterArweaveSeed` are false
      for the current holder even if it appears in the list; both are false on
      an unsealed codex.
  - files: `packages/codex-core/src/codex/masterSeed.ts`,
    `packages/codex-core/src/codex/masterNames.ts`,
    `packages/codex-core/src/index.ts`,
    `packages/codex-ouronet/src/state/store.ts`,
    `packages/codex-core/tests/master-seed-row.test.ts`,
    `packages/codex-core/tests/master-names.test.ts`,
    `packages/codex-ouronet/tests/` (existing setCodexMasterSeed spec)

- [x] T2: Demote by id, not by name — done when: the Arweave demotion in
      `CodexIdPage.tsx` identifies the displaced seed by the PREVIOUS
      `codexMasterSeed.arweaveSeedId` instead of matching
      `seed.name === PRIME_SEED_LABEL`. T1 removed the stored title, so a
      name-string predicate would silently match nothing and the demotion would
      become an undetectable no-op — that is the specific failure this task
      prevents, and it must be covered by a test that would catch it.
      Nothing is written to the displaced seed; demotion is now purely the
      master id moving, with the former id appended by T3's
      `setCodexMasterSeed`. Keep the existing ordering guarantee — the master
      row is established BEFORE anything about the displaced seed is decided,
      so a failed add leaves the codex untouched.
      Tests (`packages/codex-arweave/tests/e4-panel-codex-id.test.tsx`): taking
      over the master role records the previous holder as former and leaves its
      stored name untouched; a seed whose name happens to equal the master
      designation string is NOT treated as the master (the name-match
      regression guard); the first-ever master records no former.
  - files: `packages/codex-arweave/src/panel/CodexIdPage.tsx`,
    `packages/codex-arweave/tests/e4-panel-codex-id.test.tsx`

## Design-criteria coverage

| design.md criterion | task |
|---|---|
| A prime entity shows golden designation AND its own stored name | T1 |
| A user-typed Arweave seed name survives the role changing | T1 |
| Stored name never overwritten on disk | T1, T2 |
| Displaced Arweave seed reads "Former Master Arweave Seed" | T3 |
| Displaced Ouronet account reads "Former Codex Ouronet Master" | T3 |
| Finalized-but-unapplied codex shows no former designation | T3 |

The account-side gold, pinning and Prime badge remain topic 2
(`prime-identity-display`).
