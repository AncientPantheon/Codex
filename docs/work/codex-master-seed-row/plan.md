# Codex Master Seed Row — Plan

Topic 2 of `docs/work/codex-master-seed-model/design.md`.

Owner: *"we would add it as a section in the Codex ID, as the Codex Master
Seed, which should also have a row in the thus new codex format (this doesnt
exist), as basically the Seed of the Codex."*

## What the row IS — and deliberately is not

It is **pure linkage**: which Ouronet account, which Chainweb seed and which
ArWeave seed are the three faces of the one seed, and when that was settled.

It carries **no secret and no words**. The three entities it names already
hold their own encrypted material; copying any of it here would create a
second at-rest copy that can drift from the first and must be re-keyed in
lockstep on every password change. The row answers "which three", not "what
are they" — the same discipline `masterKeyLocks` follows (it names
`(seedId, position)` pairs, never key material).

`arweaveSeedId` is optional: the ArWeave face is established separately and
may legitimately not exist yet.

## Wave 1
- [x] T1: `CodexMasterSeed` in codex-core (`codex/masterSeed.ts`) —
      `{ ouroAccountId, chainwebSeedId, arweaveSeedId?, establishedAt }` —
      surfaced as an optional field on `CodexSnapshotBase`, `PlaintextCodex`
      and the export envelope, exported from the barrel.
      — done when: `tests/master-seed-row.test.ts` pins the shape and the
      helper `describeCodexMasterSeed()` that reports which faces are
      established, and `tsc --noEmit` passes in all four packages.
  - files: `packages/codex-core/src/codex/masterSeed.ts`,
    `packages/codex-core/src/codex/types.ts`,
    `packages/codex-core/src/adapters/types.ts`,
    `packages/codex-core/src/index.ts`,
    `packages/codex-core/tests/master-seed-row.test.ts`

## Wave 2 (depends on Wave 1)
- [x] T2: Persist it end to end — store slice + hydrate, the
      `LocalStorageCodexAdapter` shard, the codec's conditional emit and
      allow-list entry, and `importFromCloud`'s assignment. Absent on import
      falls back to `current` (like the funds-critical shards): losing the
      row would orphan the lock registry's provenance.
      — done when: an adapter shard round-trip test and a codex-ui
      export -> import round-trip test both pass.
  - files: `packages/codex-ouronet/src/state/store.ts`,
    `packages/codex-ouronet/src/adapters/LocalStorageCodexAdapter.ts`,
    `packages/codex-core/src/codex/codec.ts`,
    `packages/codex-ui/src/hooks/useCodexBackup.ts`,
    `packages/codex-ouronet/tests/adapter-master-seed-row-shard.test.ts`,
    `packages/codex-ui/tests/hooks.test.tsx`

## Wave 3 (depends on Wave 2)
- [x] T3: The Codex ID page section — names all three faces of the one seed,
      each resolved to the entity it points at, and says honestly which are
      not established yet rather than rendering blanks.
      — done when: `tests/e4-panel-codex-master-seed-section.test.tsx` proves
      the section names all three, resolves established faces to their
      display names, and states the absent ones.
  - files: `packages/codex-arweave/src/panel/CodexMasterSeedSection.tsx`,
    `packages/codex-arweave/src/panel/CodexIdPage.tsx`,
    `packages/codex-arweave/tests/e4-panel-codex-master-seed-section.test.tsx`
