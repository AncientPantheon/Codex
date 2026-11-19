# Migration Progress Row — Plan

Topic 1 of `docs/work/migration-three-stages/design.md`.

## Wave 1
- [x] T1: `MigrationProgress` + the persistable selection types in codex-core,
      with `toPersistableAccountSelection` as the ONE conversion from the live
      wizard choice (it drops the words), `isResumableSelection`, and
      `containsSuspectedSecret` for the suite to prove the guarantee.
      — done: `codex-core/tests/migration-progress.test.ts`, 10 tests,
      including one proving the scanner CATCHES smuggled words so the guard
      is not vacuous.
- [x] T2: Persist it end to end — codec emit + allow-list, the adapter shard,
      the store slice + hydrate, and `importFromCloud`.
      — done: `codex-ouronet/tests/adapter-migration-progress-shard.test.ts`
      (7 tests, incl. no-words-reach-storage) and the codex-ui export->import
      round trip.

## Decisions recorded while building

- **`migrationProgress` clears on an explicit `null`**, unlike every other
  shard, which refuses to erase on absence. Finishing or abandoning a run
  must actually remove the row, or a completed codex offers to resume a
  migration that already happened. `undefined` still means "this writer did
  not know about the field" and leaves the stored row alone.
- **On import the FILE's run wins** over the device's (`parsed ?? current`,
  not the reverse). Resuming on another machine is the stated reason the row
  travels at all, so an imported half-done run must take precedence.
