## Wave 1

- [x] T1: `codex-ouronet` side of the invariant. Read
      `packages/codex-ouronet/src/types/entities.ts` (`IOuroAccount`,
      `UiSettings`), `packages/codex-ouronet/src/errors/types.ts`
      (`CodexPrimeProtectedError` — mirror its exact shape), and
      `packages/codex-ouronet/src/state/store.ts`'s `deleteOuroAccount`
      (~line 1720, the existing `isPrime` guard) in full first.

      Add `hasEncryptedArweaveUpload?: boolean` to `IOuroAccount`
      (additive, optional, backward compatible — the same discipline every
      schema field addition in this whole project has used). Add a new
      override field to `UiSettings`, e.g.
      `allowDeletingArweaveEncryptedAccounts: boolean` (default `false` in
      `DEFAULT_UI_SETTINGS`), strongly documented as "allow deleting
      Ouronet accounts without the Arweave safety check — not
      recommended." Add a new error class
      `CodexArweaveEncryptionProtectedError` in `errors/types.ts`,
      mirroring `CodexPrimeProtectedError`'s exact structure (constructor
      shape, `name`, extends the same base). Add a new store action
      `markOuroAccountEncryptedArweaveUpload(id: string): Promise<void>`
      that sets `hasEncryptedArweaveUpload: true` on the matching account
      and persists it (mirror the exact persist/`persistAndTouch` pattern
      every other mutating store action in this file already uses — a
      missing id is a silent no-op, matching `deleteOuroAccount`'s own
      existing convention for a missing id). Update `deleteOuroAccount`:
      after the existing `isPrime` check, add a second check — if
      `target?.hasEncryptedArweaveUpload === true`, throw
      `CodexArweaveEncryptionProtectedError(id)` — synchronous, no network
      access, before any mutation.

      Follow TDD: write the failing tests first, confirm they fail, then
      implement, then refactor.

      Done when: `markOuroAccountEncryptedArweaveUpload` flips the flag and
      persists it; `deleteOuroAccount` on a flagged account throws
      `CodexArweaveEncryptionProtectedError` and performs no mutation/no
      persist call; an unflagged, non-prime account still deletes exactly
      as today (regression guard); `allowDeletingArweaveEncryptedAccounts`
      defaults to `false`.
  - files: `packages/codex-ouronet/src/types/entities.ts`,
    `packages/codex-ouronet/src/errors/types.ts`,
    `packages/codex-ouronet/src/state/store.ts`,
    `packages/codex-ouronet/tests/` (whichever existing file covers
    `deleteOuroAccount`/`UiSettings` — grep to confirm, extend it; add a
    new test file only if none already covers this action)

- [x] T2: A tag-only (no owner filter) GraphQL query in `arweave-core`.
      Read `packages/arweave-core/src/rebuild/query.ts` in full first —
      `queryOwnerUploads`'s GraphQL query takes `owners`/`tags` together;
      there is no existing path to query by tag alone. Add
      `queryUploadsByTag(pool: GatewayPool, tagName: string, tagValue:
      string, opts?: { first?: number; fetchFn?: typeof fetch }):
      Promise<OwnerUploadRecord[]>` — same response-parsing
      (`parsePage`)/error-handling/pool-execute conventions as
      `queryOwnerUploads`, but the GraphQL `transactions(...)` call uses
      ONLY a `tags: [{name: tagName, values: [tagValue]}]` filter, no
      `owners`. Default `first` low (e.g. 1) when the caller only needs an
      existence check — document that a caller wanting a full list should
      pass a larger `first` explicitly.

      Follow TDD: write the failing tests first, confirm they fail, then
      implement, then refactor.

      Done when: given a fixture GraphQL response with matching edges,
      `queryUploadsByTag` resolves the parsed records; given an empty
      `edges` array, resolves `[]` (never throws for "no matches"); the
      composed query body contains only the tag filter, no `owners` key.
  - files: `packages/arweave-core/src/rebuild/query.ts`,
    `packages/arweave-core/tests/rebuild-query.test.ts`

- [x] T4: Thread `onAccountUsedForEncryption` from the panel into the
      wizard — pure plumbing, independent of T1/T2/T3. Read
      `packages/codex-arweave/src/panel/context.tsx`'s `ArweavePanelDeps`
      and `packages/codex-arweave/src/panel/ArweavePanel.tsx`'s current
      `UploadWizard` mount, and `packages/codex-arweave/src/library/
      flow.ts`'s `uploadAndTrack`/`uploadFilesAndTrack` (both already
      accept an `onAccountUsedForEncryption?: (accountId: string) => void`
      option from the completed `arweave-upload-encryption` topic — this
      task does not change that signature, only threads a real value into
      it). Add `onAccountUsedForEncryption?: (accountId: string) => void`
      to `ArweavePanelDeps`. In `ArweavePanel.tsx`'s `UploadWizard` mount,
      thread `deps.onAccountUsedForEncryption` through to wherever
      `UploadWizard`'s own props currently forward this option into its
      `uploadAndTrack`/`uploadFilesAndTrack` calls (read
      `UploadWizard.tsx`'s current props/call-construction to confirm
      whether it already has a slot for this or needs one added — if
      `UploadWizardProps` doesn't yet expose this, add it there too,
      consistent with how `revealAccountSecret`/`getBalance` were already
      added as props in a prior round).

      Follow TDD: write the failing test first (a fake
      `onAccountUsedForEncryption` injected into `ArweavePanel`'s `deps`,
      driven through a mocked encrypted upload via the wizard, asserting
      the fake was called with the correct account id), confirm it fails,
      then implement.

      Done when: a fake `onAccountUsedForEncryption` on `deps` is actually
      invoked, with the correct account id, when a mocked encrypted
      upload succeeds through the real `ArweavePanel` → `UploadWizard`
      mount — not just present on a type.
  - files: `packages/codex-arweave/src/panel/context.tsx`,
    `packages/codex-arweave/src/panel/ArweavePanel.tsx`,
    `packages/codex-arweave/src/panel/UploadWizard.tsx` (only if it
    doesn't already expose a slot for this option),
    `packages/codex-arweave/tests/e4-panel-categories.test.tsx`

## Wave 2 (depends on Wave 1)

- [x] T3: The chain-query safety-net function. Read T2's
      `queryUploadsByTag` (now built) and
      `packages/arweave-core/src/upload/tags.ts`'s `TAG_CODEX_ENCRYPTOR`/
      `TAG_CODEX_ENCRYPTED` constants. New function
      `checkAccountEncryptedArweaveUploads(pool: GatewayPool, address:
      string, opts?: { fetchFn?: typeof fetch }): Promise<boolean>` in
      `codex-arweave` — calls `queryUploadsByTag(pool,
      TAG_CODEX_ENCRYPTOR, address, { first: 1, fetchFn: opts?.fetchFn })`
      and resolves `true` iff at least one record is returned, `false`
      otherwise. Document prominently (module doc comment) that this is
      the SANCTIONED pre-flight check a future "delete this Ouronet
      account" UI MUST call when the local `hasEncryptedArweaveUpload`
      flag (a `codex-ouronet` concern, this function never touches it) is
      absent, before attempting deletion — mirror the explicit
      "sanctioned integration point" documentation style
      `SESSION_LIFECYCLE_CONTRACT.md`-type docs in this project already
      use, since this project has twice already seen a host app silently
      skip exactly this kind of seam.

      Follow TDD: write the failing tests first, confirm they fail, then
      implement.

      Done when: given a fake `queryUploadsByTag`-equivalent gateway
      response with a matching record, resolves `true`; given an empty
      response, resolves `false`; a genuine network/gateway failure
      propagates (never silently resolves `false`, which would be a
      fail-open bug for a safety check).
  - files: `packages/codex-arweave/src/library/checkEncryptionSafety.ts`
    (new), `packages/codex-arweave/tests/
    library-check-encryption-safety.test.ts` (new)

- [x] T5: Wire the real end-to-end path in the host app. Read
      `apps/codex-playground/src/realArweaveAdapter.ts` and
      `apps/codex-playground/src/App.tsx`'s existing cross-package
      wiring pattern (the `getExportJson`/`onBackupSuccess` wiring from
      `arweave-upload-categories` is the closest precedent — read it) in
      full first. Wire `realArweaveAdapter.ts`'s
      `onAccountUsedForEncryption` (threaded from T4's new
      `ArweavePanelDeps` field) to actually call the T1 store action
      `markOuroAccountEncryptedArweaveUpload` — reach the codex-ouronet
      store the same way this file/its callers already reach other store
      actions (do not invent a second access pattern; find and reuse the
      existing one). Update `mockArweaveAdapter.ts` with a working fake
      too (mirroring this file's own existing fake-wiring conventions for
      other deps), so mock mode exercises this path with no real network.

      Follow TDD: extend the existing playground test coverage for
      `realArweaveAdapter.ts`/`mockArweaveAdapter.ts` (grep for the
      existing `getExportJson`/backup-wiring test as the precedent to
      mirror), confirm the new test fails first, then implement.

      Done when: triggering a mocked encrypted upload through the real
      `App.tsx` component tree in real mode actually results in
      `markOuroAccountEncryptedArweaveUpload` being called on the correct
      account — traced and verified end to end, not assumed from type
      compatibility. The full `codex-ouronet`, `codex-arweave`,
      `arweave-core`, and `codex-playground` test suites pass (unscoped —
      check for and fix any gap outside this task's own file list,
      flagging explicitly if found, matching every prior task in this
      project). `npx tsc -b` is clean for all four packages. `npm run
      build --workspace=@ancientpantheon/codex-playground` succeeds
      (rebuild any touched package's own dist first if the playground
      build/typecheck seems to resolve a stale one — this has repeatedly
      bitten prior tasks in this project).
  - files: `apps/codex-playground/src/realArweaveAdapter.ts`,
    `apps/codex-playground/src/mockArweaveAdapter.ts`, plus whichever
    existing playground test file(s) cover this wiring (grep to confirm
    the right file(s) before adding a new one)
