## Wave 1
- [x] T1: Fix `migrateToCurrent()`'s snapshot builder so it no longer wipes the
      `foreignKeys` keyring shard on a schema migration — done when: (1) the
      inline `current: CodexSnapshot` object built at the top of
      `migrateToCurrent()` (~`packages/codex-ouronet/src/state/store.ts:1883`)
      includes `foreignKeys: state.foreignKeys` (it currently omits the field
      entirely, unlike `buildForeignKeySnapshot` and `init()`'s own
      `preMigration` builder, which both thread it through); (2) the subsequent
      `set({...})` call inside the same action (~line 1915) includes
      `foreignKeys: migrated.foreignKeys ?? []`, mirroring the existing
      `arweaveSeeds: migrated.arweaveSeeds ?? []` line right next to it; (3) a
      new test case in
      `packages/codex-ouronet/tests/state-migrate-to-current.with-synthetic.test.ts`
      (same file/pattern as the existing "migrateToCurrent() advances
      schemaVersion to 2 and persists the migrated snapshot" case) seeds the
      store with one `foreignKeys` entry (e.g. via `store.getState().actions.addForeignKey(...)`
      or by constructing the initial snapshot with a `foreignKeys` array before
      `init()`) before dropping schema to version 1, calls
      `migrateToCurrent()`, and asserts BOTH `store.getState().foreignKeys` and
      the snapshot object passed to the spied `adapter.saveAll` still contain
      that entry — this test must fail before the fix (wipes to `[]`) and pass
      after; (4) `npx vitest run --root packages/codex-ouronet tests/state-migrate-to-current.with-synthetic.test.ts` passes, and the full
      `npx vitest run --root packages/codex-ouronet` shows no new failures
      beyond the suite's existing baseline.
  - files: `packages/codex-ouronet/src/state/store.ts`, `packages/codex-ouronet/tests/state-migrate-to-current.with-synthetic.test.ts`

- [x] T2: Add a value cell, copy button, explorer link, and confirm-then-delete
      control to each Arweave account row — done when: (1) `AccountRow` in
      `packages/codex-arweave/src/panel/ArweaveAccountsArea.tsx` renders, after
      the existing position badge and address, in this order: a value span
      reading exactly `"Empty"` (static text, no store/network read — balances
      are out of scope per design.md), a copy button, an explorer link, and
      (only when the new `onDeleteKey` prop is supplied) a delete button —
      mirroring `StoaAccountsTab.tsx`'s row cluster order (value, then
      copy/explorer/delete); (2) new local inline-SVG glyphs (`CopyGlyph`,
      `ExternalLinkGlyph`, `TrashGlyph`) are added to this file following its
      existing `svgBase`/`EyeGlyph` convention — no `lucide-react` import
      anywhere in the file; (3) the copy button's `onClick` calls
      `navigator.clipboard.writeText(address)` where `address` is the same
      value already computed for the row (`entry.address ?? entry.id`); (4) the
      explorer control is an `<a>` with
      `href={\`https://viewblock.io/arweave/address/${address}\`}`,
      `target="_blank"`, `rel="noopener noreferrer"`; (5) `ArweaveAccountsAreaProps`
      gains an OPTIONAL `onDeleteKey?: (entry: ForeignKeyEntry) => Promise<void> | void`,
      threaded through `GroupSection` (which currently takes only `{ group }`)
      down to each `AccountRow`; (6) the delete button, on first click, does
      NOT call `onDeleteKey` — it reveals a confirm/cancel pair (matching the
      two-step pattern already used for seed deletion in
      `ArweaveSeedsArea.tsx`'s `SeedRow`); clicking confirm calls
      `onDeleteKey(entry)` exactly once with that row's own `entry`; clicking
      cancel dismisses the confirm state and calls `onDeleteKey` zero times;
      (7) when `onDeleteKey` is omitted entirely, no delete button renders for
      any row (mirrors Stoa's `onRemove &&` gating) — the copy and explorer
      controls still render regardless; (8) new tests are added to
      `packages/codex-arweave/tests/e5-accounts-area.test.tsx` covering points
      (1)-(7) above, each rendering `<ArweaveAccountsArea>` directly with a
      built `ForeignKeyEntry`, using `data-testid`s
      `arweave-account-value-<id>`, `arweave-account-copy-<id>`,
      `arweave-account-explorer-<id>`, `arweave-account-delete-<id>`,
      `arweave-account-delete-confirm-<id>`, `arweave-account-delete-cancel-<id>`
      (where `<id>` is the entry's `id`); (9) the existing "never renders an
      encryptedKeyfile value into the DOM" test in the same file still passes
      unmodified with the new controls present; (10)
      `npx vitest run --root packages/codex-arweave tests/e5-accounts-area.test.tsx`
      passes in full, and `npx tsc --noEmit -p packages/codex-arweave/tsconfig.json`
      is clean.
  - files: `packages/codex-arweave/src/panel/ArweaveAccountsArea.tsx`, `packages/codex-arweave/tests/e5-accounts-area.test.tsx`

- [x] T3: Wire the playground's `deleteForeignKey` seam to the real codex store
      action, in both wiring modes, instead of the hardcoded no-op stubs —
      done when: (1) `ArweaveKeyPersistenceOptions` and `ArweaveKeyPersistence`
      in `apps/codex-playground/src/realArweaveAdapter.ts` each gain an
      OPTIONAL `deleteForeignKey?: (id: string) => Promise<void>` member; (2)
      `createArweaveKeyPersistence` (same file, ~line 167) includes
      `deleteForeignKey` on its returned object when the option was supplied
      (undefined otherwise — do not synthesize a no-op inside this function);
      (3) `buildRealPanelDeps` (same file, ~line 204) accepts an OPTIONAL
      `deleteForeignKey` param, passes it into its internal
      `createArweaveKeyPersistence({...})` call, and its returned
      `ArweavePanelDeps.deleteForeignKey` becomes
      `persistence?.deleteForeignKey ?? (async () => {})` — replacing the
      current unconditional `async () => {}` stub at line 277, the same
      pattern `generateArweaveKey`/`addForeignKey` already use in that same
      return object; (4) `BuildArweaveWiringOptions` and `buildArweaveWiring`
      in `apps/codex-playground/src/ForeignChainsWiring.tsx` (~line 490 /
      ~line 527) accept the same optional `deleteForeignKey` param and thread
      it: into `buildRealPanelDeps({..., deleteForeignKey})` for
      `mode === "real"`, and into the top-level `persistence` object
      (`createArweaveKeyPersistence({getPassword, addForeignKey, deleteForeignKey})`)
      used by the `mode === "mock"` branch's `{...buildMockPanelDeps(...), ...(persistence ?? {})}`
      spread; (5) the call site in `ForeignChainsWiring.tsx` (~line 761, the
      `buildArweaveWiring({...})` invocation inside the component that also
      passes `addForeignKey: actions.addForeignKey`) adds
      `deleteForeignKey: actions.deleteForeignKey`; (6) two new tests in
      `apps/codex-playground/tests/e5-foreign-chains-mock.test.tsx`, mirroring
      the existing "wires that persist path into REAL-mode panel deps instead
      of the old throwing stub" / "wires the SAME persist path + worker
      factory in MOCK mode" pair in the same file: one calls
      `buildRealPanelDeps({..., deleteForeignKey: async (id) => { calls.push(id); }})`
      and asserts `await deps.deleteForeignKey("some-id")` records `"some-id"`
      in `calls`; the other calls
      `buildArweaveWiring({mode: ARWEAVE_WIRING_MODE_MOCK, ..., deleteForeignKey: async (id) => { calls.push(id); }})`
      and asserts the same via `panelDeps.deleteForeignKey`; (7)
      `npx vitest run --root apps/codex-playground tests/e5-foreign-chains-mock.test.tsx`
      passes, and `npx tsc --noEmit -p apps/codex-playground/tsconfig.json` is
      clean.
  - files: `apps/codex-playground/src/realArweaveAdapter.ts`, `apps/codex-playground/src/ForeignChainsWiring.tsx`, `apps/codex-playground/tests/e5-foreign-chains-mock.test.tsx`

## Wave 2 (depends on Wave 1)
- [x] T4: Have `ArweavePanel` forward a per-key delete handler into
      `ArweaveAccountsArea` that prunes its own session overlay before calling
      the host seam, so a this-session-generated key cannot resurrect after
      deletion — done when: (1) `ArweavePanel.tsx` defines a
      `handleDeleteKey` callback (same shape/placement as the existing
      `handleDeleteSeed`, ~line 242) that: removes the deleted id from
      `sessionKeys` state, THEN calls `deps?.deleteForeignKey(entry.id)`; (2)
      `<ArweaveAccountsArea entries={arweaveKeys} seeds={accountsSeeds} />`
      (~line 329) is updated to also pass `onDeleteKey={handleDeleteKey}`,
      using the prop T2 added to `ArweaveAccountsAreaProps`; (3) a new test is
      added to the `"ArweavePanel — the wired Seeds and Accounts categories (T7)"`
      describe block in `packages/codex-arweave/tests/e5-seeds-area.test.tsx`
      that: wraps `<ArweavePanel id={ARWEAVE_CHAIN_ID} />` in an
      `ArweavePanelProvider` (imported from `../src/panel/context`, following
      the full-deps-object convention already used in
      `packages/codex-arweave/tests/e4-panel-categories.test.tsx`'s `makeDeps`)
      supplying `workerFactory: () => new FakeWorker() as unknown as Worker`
      (the file's own existing `FakeWorker` class), working
      `generateArweaveKey`/`addForeignKey`/`decryptArweaveKey`/`deleteForeignKey`
      fakes (each recording their calls), and `foreignKeys: []`; defines the
      Prime seed via Free Seed Input (same steps as the existing "keeps a
      just-defined seed..." test in the same describe block), opens it, starts
      a single-position generate run, emits `keyMsg(0)` then
      `{kind:"batch-done"}` on the fake worker (per this file's established
      `FakeWorker`/`keyMsg` helpers), switches to the Accounts tab and confirms
      the generated address row renders; clicks that row's delete button, then
      its confirm button; and asserts BOTH that the row is gone from the DOM
      AND that the test's `deleteForeignKey` fake was called exactly once with
      the generated key's id — proving the delete is not merely cosmetic and
      does not depend on the (unchanged, still-`[]`) `foreignKeys` prop ever
      being echoed back by the host; (4)
      `npx vitest run --root packages/codex-arweave tests/e5-seeds-area.test.tsx`
      passes in full, and the full `npx vitest run --root packages/codex-arweave`
      shows no new failures beyond the six documented pre-existing
      `node:sqlite` load failures.
  - files: `packages/codex-arweave/src/panel/ArweavePanel.tsx`, `packages/codex-arweave/tests/e5-seeds-area.test.tsx`
