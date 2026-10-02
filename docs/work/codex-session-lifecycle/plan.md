## Wave 1

- [x] T1: The `pendingLogoutRequest` store slice and action. Read
      `packages/codex-ui/src/hooks/useRequestPassword.ts` and
      `packages/codex-ouronet/src/state/store.ts`'s `pendingPasswordRequest`
      slice (~line 213) + `requestPassword()` action (~line 1114) +
      `resolvePasswordRequest`/`rejectPasswordRequest`-equivalent
      completion actions in full first — this task mirrors that exact
      three-part shape (state slice, requesting action that returns a
      Promise, completion action(s) a modal calls to settle it), not a
      new pattern. Add `pendingLogoutRequest: PendingLogoutRequest | null`
      to the store state (model `PendingLogoutRequest` on
      `PendingPasswordRequest`'s own shape — read its exact fields first;
      it will need at minimum `resolve`/`reject` callbacks captured from
      the Promise executor). Add a new action
      `requestLogoutConfirmation(): Promise<"backed-up" |
      "proceeded-without-backup" | "cancelled">`: if `get().dirty ===
      false`, do NOT create a pending request at all — this action is
      only ever called by the hook (T3) after it has already fast-pathed
      the clean case itself, so document that invariant rather than
      re-implementing the fast path here (mirror how `requestPassword`
      itself only handles the "needs prompting" path, with
      `useRequestPassword`'s own cache check as the fast path, per the
      file you just read). When called, create the pending entry
      (dedup concurrent calls the same way `requestPassword` already
      dedups — reuse that exact mechanism, do not invent a second one)
      and return the Promise. Add two new completion actions a modal
      calls: `completeLogoutRequest(outcome: "backed-up" |
      "proceeded-without-backup")` (resolves the pending promise with
      that outcome, clears `pendingLogoutRequest`; if `"backed-up"`, also
      calls the existing `clearDirty()` internally — a modal confirming a
      real backup completed should never need its own separate call to
      clear the flag) and `cancelLogoutRequest()` (resolves with
      `"cancelled"`, clears `pendingLogoutRequest`, does NOT touch
      `dirty`).

      Follow TDD: write the failing tests first (mirroring whichever
      existing test file covers `requestPassword`/`pendingPasswordRequest`
      — grep to find it and add parallel tests in the same file/style),
      confirm they fail, then implement.

      Done when: `requestLogoutConfirmation()` returns a pending Promise;
      `completeLogoutRequest("backed-up")` resolves it with that value AND
      leaves `dirty === false`; `completeLogoutRequest(
      "proceeded-without-backup")` resolves it with that value and leaves
      `dirty === true` (unchanged); `cancelLogoutRequest()` resolves with
      `"cancelled"` and leaves `dirty` unchanged either way; concurrent
      calls to `requestLogoutConfirmation()` share a single pending entry,
      mirroring `requestPassword`'s own dedup behavior exactly (verify by
      reading its test, then writing the parallel case).
  - files: `packages/codex-ouronet/src/state/store.ts`,
    `packages/codex-ouronet/tests/` (whichever file covers
    `requestPassword`/`pendingPasswordRequest` — extend it)

- [x] T2: The generic backup-divergence `beforeunload` guard. Read
      `packages/codex-arweave/src/panel/ArweavePanel.tsx`'s existing
      `beforeunload` effect (~line 702) for the exact native pattern to
      reuse (`event.preventDefault(); event.returnValue = "";`,
      add/remove via `useEffect`), and
      `packages/codex-ui/src/hooks/useCodexBackup.ts` for how `isDirty`
      is already read from the store. Add a new hook
      `useCodexUnsavedChangesGuard(): void` in a new file —
      installs/removes the identical native `beforeunload` handler keyed
      off `store((s) => s.dirty)` (not the Arweave-specific
      `activeGeneration` this task must not touch or duplicate logic
      from — `ArweavePanel.tsx`'s own upload-in-flight guard stays
      exactly as is, this is a separate, additive concern. Do not
      refactor `ArweavePanel.tsx` to use this hook in this task — that's
      a follow-on, not part of this topic's declared scope).

      Follow TDD: write the failing test first (render a test harness
      calling the hook inside a `<CodexProvider>` with a controllable
      store, set `dirty: true`, dispatch a synthetic `beforeunload` event
      via jsdom, assert `preventDefault` was called and `returnValue` was
      set; then set `dirty: false` and assert it is not), confirm it
      fails, then implement.

      Done when: the native `beforeunload` prompt is armed while
      `dirty === true` and disarmed while `dirty === false`, verified by
      a real event dispatch against a real hook render, not a mocked
      `addEventListener` call.
  - files: `packages/codex-ui/src/hooks/useCodexUnsavedChangesGuard.ts`
    (new), `packages/codex-ui/tests/` (new test file matching this
    package's existing hook-test naming convention — grep an existing
    hook test file first and mirror its filename style)

## Wave 2 (depends on Wave 1)

- [x] T3: The logout-confirmation modal and the public `useRequestLogout`
      hook. Read `packages/codex-ui/src/components/PasswordModal.tsx` in
      full first (its `render` prop / headless-render-args pattern,
      `PasswordModalProps`, how it reads the pending-request slice and
      calls the store's completion actions) — this task's new
      `LogoutConfirmModal` mirrors that component's shape exactly: same
      headless/render-prop convention, same "reads a pending-X slice,
      calls completion actions" responsibility split. Also read
      `packages/codex-ui/src/hooks/useCodexBackup.ts`'s
      `downloadAsJson`/`exportForCloud` — the modal's "back up now"
      control needs SOME concrete backup action to call; for this task,
      wire it to `downloadAsJson()` specifically (the one backup path
      that needs no host-supplied Arweave wiring and works in every
      consumer unconditionally — an Arweave-backup "back up now" option
      is explicitly out of scope here, since that requires
      `codex-arweave`-specific deps `codex-ui` must not depend on; a host
      that wants the Arweave path can build its own confirmation UI
      against the raw store actions from T1 instead of using this
      component). On a successful `downloadAsJson()` call, call
      `completeLogoutRequest("backed-up")`; a "continue without backing
      up" control calls `completeLogoutRequest(
      "proceeded-without-backup")`; a "cancel" control calls
      `cancelLogoutRequest()`.

      Add `useRequestLogout(): () => Promise<"clean" | "backed-up" |
      "proceeded-without-backup" | "cancelled">` in a new hook file,
      mirroring `useRequestPassword.ts`'s exact shape: the fast path
      (`store.getState().dirty === false` → resolve `"clean"`
      immediately, no pending request created) lives HERE, in the hook,
      not in the store action (per T1's documented invariant) — then
      falls through to `state.actions.requestLogoutConfirmation()`.

      Follow TDD: write the failing tests first — one for
      `useRequestLogout`'s fast path and delegation (mirror
      `useRequestPassword`'s own test file/pattern), one for
      `LogoutConfirmModal` rendering nothing when `pendingLogoutRequest`
      is null and rendering/wiring correctly when it's set (mirror
      `PasswordModal`'s own test file/pattern) — confirm both fail, then
      implement.

      Done when: `useRequestLogout()`'s returned function resolves
      `"clean"` instantly on a clean codex with no modal state touched;
      on a dirty codex it creates a pending request that
      `LogoutConfirmModal` picks up and renders; clicking each of the
      three controls resolves the original promise with the matching
      outcome and leaves `dirty` in the state documented in T1.
  - files: `packages/codex-ui/src/components/LogoutConfirmModal.tsx`
    (new), `packages/codex-ui/src/hooks/useRequestLogout.ts` (new),
    `packages/codex-ui/src/components/index.ts` and
    `packages/codex-ui/src/hooks/index.ts` (or wherever this package's
    existing barrels export `PasswordModal`/`useRequestPassword` — mirror
    exactly), `packages/codex-ui/tests/` (two new test files matching
    this package's existing component/hook test naming conventions)

- [x] T4: `SESSION_LIFECYCLE_CONTRACT.md`. Read
      `packages/codex/IMPORT_EXPORT_CONTRACT.md` first for this package's
      established spec-document style and mirror it exactly. Content:
      what `dirty` actually tracks (divergence from the last external
      backup via `clearDirty()` — NOT unsaved-to-local-storage; local
      storage is already durable via `persistAndTouch` on every mutating
      action, ground this claim by citing `store.ts`'s actual
      `persistAndTouch` helper), the two existing `clearDirty()` call
      sites and what "external backup" means in practice (JSON download,
      Arweave codex-backup), the native `beforeunload` guard's
      browser-chrome limitation (no custom copy possible, same
      disclosure `ArweavePanel.tsx`'s own comment already makes),
      `useRequestLogout()`'s four possible outcomes and exactly what each
      one does/doesn't do to `dirty`, and an explicit, prominent
      disclaimer section stating this mechanism has NO role in the
      `arweave-non-removable-account` invariant (Topic 1 of the parent
      project), which is independently chain-truth-backed and unaffected
      by anything in this document.

      Ship it: add `"SESSION_LIFECYCLE_CONTRACT.md"` to `packages/codex/
      package.json`'s `files` array, and a short pointer line to it in
      `packages/codex/README.md` near the existing
      `IMPORT_EXPORT_CONTRACT.md`/`ARWEAVE_TAG_SCHEMA.md` pointers.

      Done when: `npm pack --dry-run` on the `codex` package confirms
      `SESSION_LIFECYCLE_CONTRACT.md` is included; every claim about
      `dirty`/`persistAndTouch`/`clearDirty` call sites is verified
      against the actual current source, not written from memory.
  - files: `packages/codex/SESSION_LIFECYCLE_CONTRACT.md` (new),
    `packages/codex/package.json`, `packages/codex/README.md`

## Wave 3 (depends on Wave 2)

- [x] T5: Wire it into the real playground app. Investigate first and
      report findings before changing anything (this is genuinely open):
      read `packages/codex-ui/src/ui/CodexLockControl.tsx` (the existing
      `PasswordModal` mount site — confirm whether "lock" in this
      single-codex-per-browser app is the closest existing equivalent to
      "logout", since no separate multi-account logout concept was found
      during this topic's own grounding) and `apps/codex-playground/
      src/App.tsx`'s current lock/auth flow (`useCodexAuth()`, the
      `isLocked` gate around line 661/704). Determine the right call
      site for `useRequestLogout()` — likely wherever the user explicitly
      triggers re-locking the codex — and wire it in: call the returned
      function BEFORE the actual lock/session-teardown happens, and only
      proceed to lock if the outcome isn't `"cancelled"`. Mount
      `<LogoutConfirmModal>` the same way `<PasswordModal>` is already
      mounted (find its real mount site via grep — `CodexLockControl.tsx`
      or wherever `App.tsx`/`CodexProvider` composes it — and mirror that
      exact placement). Also mount `useCodexUnsavedChangesGuard()` (T2)
      somewhere real and always-active in the playground (e.g. `App.tsx`
      top level), not left uncalled.

      Follow TDD where the composition itself is unit-testable (the
      "dirty codex + user triggers lock → modal appears, lock is
      deferred until a non-cancel outcome" behavior); for the beforeunload
      guard's mounting, a smoke-level render test confirming the hook is
      actually invoked is sufficient (full native browser-close behavior
      isn't meaningfully testable beyond what T2 already covers).

      Done when: manually triggering lock on a dirty codex in the running
      playground shows the new confirm modal before the password screen
      reappears (describe exactly how you verified this — a built app
      you ran, not an assumption); a clean codex locks with no modal, same
      as today. The full `codex-ouronet`, `codex-ui`, and
      `codex-playground` test suites pass (unscoped — check for and fix
      any gap outside this task's own file list, flagging explicitly if
      found, matching every prior task in this project; the one known
      pre-existing unrelated failure, if touching `codex-arweave`,
      is `tests/e3-library-store.test.ts`'s documented `node:sqlite`
      sandbox limitation — not a regression). `npx tsc -b` is clean for
      all three packages. `npm run build
      --workspace=@ancientpantheon/codex-playground` succeeds (rebuild
      any touched package's own dist first if stale-dist resolution bites
      — a repeatedly-hit gotcha in this project).
  - files: `apps/codex-playground/src/App.tsx`,
    `packages/codex-ui/src/ui/CodexLockControl.tsx` (only if
    investigation shows the mount/call site genuinely belongs there
    rather than in the playground app — justify in your report if you
    deviate), plus whichever test files your investigation determines are
    the right home for the new coverage
