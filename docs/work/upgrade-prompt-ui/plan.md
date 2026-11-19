## Wave 1

- [x] T1: Extend the Structural Migration Engine with live progress
      reporting, and add the `runStructuralUpgrade` store action that runs
      it against the live, already-unlocked codex and persists the result.
      In `packages/codex-ouronet/src/structural-migration/index.ts`, add
      to `StructuralMigrationOptions`:
      `onProgress?: (step: string) => void;` — purely additive, same
      backward-compatible contract as `ChangePasswordCard`'s own
      `onProgress` (`packages/codex-ui/src/ui/settings/ChangePasswordCard.tsx`):
      optional, callable any number of times, omitting it changes nothing.
      Call it at least once per checked entry (every `kadenaSeeds` entry
      with `seedType === "stoic"`, every `arweaveSeeds` entry) with a
      human-readable string that changes between calls (exact wording is
      the implementer's choice — e.g. progress through "checking" →
      outcome — the done-when below checks for VARIATION and a minimum
      call count, not literal text).
      In `packages/codex-ouronet/src/state/store.ts`: add to
      `CodexStoreState`'s action interface (near `changeCodexPassword`,
      ~line 352):
      `runStructuralUpgrade(options?: { requestMissingData?: (need: StructuralMigrationNeedsInput) => Promise<string | undefined>; onProgress?: (step: string) => void }): Promise<StructuralMigrationResult>;`
      (import `StructuralMigrationNeedsInput`/`StructuralMigrationResult`
      from `../structural-migration/index.js`). Implement it in the same
      closure as `changeCodexPassword` (~line 1311), mirroring that
      action's exact sequence: `const password = get().actions.getPassword();`
      (propagates `CodexLockedError` untouched if actually locked — no new
      password prompt, this never runs on a locked codex); assemble the
      live snapshot via the EXISTING `buildForeignKeySnapshot(get(), get().foreignKeys)`
      helper (~line 635, already includes `arweaveSeeds` per its own
      existing comment); call
      `const result = await runStructuralMigration(current, password, options);`;
      persist via the EXISTING `persistAndTouch((a) => a.saveAll(result.snapshot))`
      helper (~line 752); then `set({ kadenaSeeds: result.snapshot.kadenaSeeds, arweaveSeeds: result.snapshot.arweaveSeeds, Codex_Shape_Version: result.snapshot.Codex_Shape_Version })`;
      return `result`.
      done when:
      - A test on `runStructuralMigration` directly confirms `onProgress`
        (when supplied) is called at least twice with two DIFFERENT string
        values when the fixture has 2+ checked entries, and that omitting
        `onProgress` entirely changes no other return value compared to
        the existing Topic 2 test fixtures (re-run at least one existing
        `tests/structural-migration.test.ts` scenario with `onProgress`
        added and confirm `fixedSeedIds`/`skipped`/the resulting
        snapshot are byte-identical to the same scenario without it).
      - A test builds a store via `createCodexStore()` +
        `MemoryCodexAdapter`, kickstarts a codex, authenticates, adds a
        `"stoic"`-typed kadena seed whose `secret` is
        `encryptStringV2(<a real, valid DALOS word string>, password)`
        (via whatever existing store action adds a seed with an explicit
        pre-encrypted secret — check `tests/state-kickstart-codex-v3.test.ts`
        or `tests/rekey.test.ts`-adjacent store tests for the convention;
        if no such action exists, construct the scenario the same way
        `tests/state-store.test.ts`'s own `init()`-against-a-seeded-adapter
        tests do: seed a `MemoryCodexAdapter` directly via `saveAll()`
        before calling `actions.init(adapter)`), then calls
        `await actions.runStructuralUpgrade()`. Asserts: the resulting
        `store.getState().Codex_Shape_Version === STRUCTURAL_SHAPE_TARGET_VERSION`;
        `store.getState().kadenaSeeds[0].secret` now decrypts
        (`smartDecrypt` + the live password) to a valid 1024/1600-char
        bitstring; re-mounting a fresh store against the SAME adapter
        (`createCodexStore()` + `actions.init(sameAdapter)`) shows the
        fixed `secret` too (proves it was actually persisted, not just
        held in memory).
      - A test confirms calling `actions.runStructuralUpgrade()` on a
        LOCKED store (never authenticated, or past `passwordCache.expiresAt`)
        rejects with `CodexLockedError` and leaves the adapter's persisted
        data completely unchanged (verified by reading the adapter
        directly after the rejected call).
      - A test confirms `requestMissingData`, when supplied to
        `actions.runStructuralUpgrade({ requestMissingData })`, is
        actually invoked and its resolved value flows through to a fix —
        same end-to-end assertion style as Topic 2's own
        "garbage-plaintext + requestMissingData" test, but driven through
        the live store action instead of calling the pure engine directly.
      - `npx vitest run tests/structural-migration.test.ts tests/state-structural-upgrade.test.ts`
        (the second file is new) passes, and `npx tsc --noEmit` in
        `packages/codex-ouronet` is clean.
      - files: `packages/codex-ouronet/src/structural-migration/index.ts`,
        `packages/codex-ouronet/tests/structural-migration.test.ts`,
        `packages/codex-ouronet/src/state/store.ts`,
        `packages/codex-ouronet/tests/state-structural-upgrade.test.ts` (new)

- [x] T2: Add `useNeedsStructuralUpgrade()` — the single source of truth
      for "does this codex need a structural upgrade," used by both the
      nav indicator and the Codex ID page gating so they can never
      disagree. New file
      `packages/codex-ouronet/src/hooks/useNeedsStructuralUpgrade.ts`:
      ```ts
      import { useCodex } from "@ancientpantheon/codex-ui/hooks";
      import { STRUCTURAL_SHAPE_TARGET_VERSION } from "../structural-migration/index.js";

      /** True when the live codex's `Codex_Shape_Version` is not the
       *  current structural target — covers both `undefined`
       *  ("Unversioned") and any older stamped value. Lives in
       *  codex-ouronet (not codex-ui) because it needs
       *  `STRUCTURAL_SHAPE_TARGET_VERSION`, which is a codex-ouronet-owned
       *  constant — codex-ui must not import from codex-ouronet (the
       *  established core <- ui <- ouronet dependency direction). */
      export function useNeedsStructuralUpgrade(): boolean {
        const { Codex_Shape_Version } = useCodex();
        return Codex_Shape_Version !== STRUCTURAL_SHAPE_TARGET_VERSION;
      }
      ```
      Export it from `packages/codex-ouronet/src/hooks/index.ts` as a
      LOCAL export (same pattern that file's own doc comment already
      describes for the address-book validation registry — "STAYS
      Ouronet-side... exported LOCALLY below" — do not add it to the "16
      hooks re-exported from codex-ui" block/comment, it is a genuinely
      new, codex-ouronet-local hook).
      done when:
      - A test renders a component using `useNeedsStructuralUpgrade()`
        inside a `<CodexProvider>` wired to a store whose
        `Codex_Shape_Version` is `undefined` ("Unversioned") and asserts
        the hook returns `true`.
      - The same test harness with `Codex_Shape_Version` explicitly set to
        some OLDER value (e.g. `"0.9.0"`) also returns `true`.
      - The same test harness with `Codex_Shape_Version` set to the real
        `STRUCTURAL_SHAPE_TARGET_VERSION` constant's own value returns
        `false`.
      - `npx vitest run tests/hooks-needs-structural-upgrade.test.tsx`
        (new) passes, `npx tsc --noEmit` clean.
      - files: `packages/codex-ouronet/src/hooks/useNeedsStructuralUpgrade.ts` (new),
        `packages/codex-ouronet/src/hooks/index.ts`,
        `packages/codex-ouronet/tests/hooks-needs-structural-upgrade.test.tsx` (new)

## Wave 2 (depends on Wave 1)

- [x] T3: Add a visibly-flashing indicator to both real "Codex ID" nav
      entries when `useNeedsStructuralUpgrade()` is true. Desktop:
      `apps/codex-playground/src/App.tsx`'s `.cxpg-viewtab` "Codex ID" tab
      button (~line 660-668) — add a small badge element (e.g. a `<span>`
      with `data-testid="codex-id-upgrade-badge"`) rendered only when
      `useNeedsStructuralUpgrade()` is true, with a CSS class
      (`.cxpg-viewtab-upgrade-badge`, new, in `apps/codex-playground/src/app.css`
      near the existing `.cxpg-viewtab` rules ~line 267) that applies a
      visible flashing/pulsing animation (a `@keyframes` opacity or color
      pulse — reuse the `prefers-reduced-motion` discipline already used
      elsewhere in this app's CSS if present, check `app.css` for an
      existing `@media (prefers-reduced-motion: reduce)` block and respect
      it if found). Mobile: `apps/codex-playground/src/OuronetShellMock.tsx`'s
      `.cxpg-osm-codex-menu-item` "Codex ID" entry (~line 214-223) — same
      badge pattern, same `data-testid`, a mirrored CSS class in
      `apps/codex-playground/src/ouronet-shell-mock.css` near
      `.cxpg-osm-codex-menu-item` (~line 168).
      done when:
      - A test renders `App`'s desktop nav (or a scoped subtree, matching
        this file's existing test conventions — check for an existing
        `tests/app-*.test.tsx` that renders the view-tabs row) with a
        `CodexProvider` store whose `Codex_Shape_Version` is current:
        `screen.queryByTestId("codex-id-upgrade-badge")` is `null`.
      - The same with `Codex_Shape_Version` `undefined`: the badge is
        present.
      - The same two scenarios repeated for `OuronetShellMock`'s mobile
        menu item (its own existing test file, if one exists — check
        before creating a new one).
      - `npx tsc --noEmit` in `apps/codex-playground` is clean and the
        relevant test file(s) pass.
      - files: `apps/codex-playground/src/App.tsx`,
        `apps/codex-playground/src/app.css`,
        `apps/codex-playground/src/OuronetShellMock.tsx`,
        `apps/codex-playground/src/ouronet-shell-mock.css`,
        and whichever existing or new test file(s) in
        `apps/codex-playground/tests/` cover these two components (check
        first; add new test files only if none exist for the relevant
        render paths)

- [x] T4: Build `StructuralUpgradeWizard`, the modal that actually runs
      the upgrade. New file
      `packages/codex-ouronet/src/ui/internal/StructuralUpgradeWizard.tsx`,
      props `{ open: boolean; onClose: () => void }` (no external seed/
      account data needed — unlike `LegacyPrimeMigrationWizard`, this
      wizard only needs the store's own `runStructuralUpgrade` action and
      `Codex_Shape_Version`, both reachable via `useCodexStore()` from
      `../../provider/index.js` (the same seam
      `CodexSettingsSection.tsx:125`'s `useCodexStore()((s) => s.actions)`
      already uses) and `useCodex()`/`formatCodexShapeVersionLabel`
      (Topic 1) for display). Render inside a `CodexModalShell`
      (`@ancientpantheon/codex-ouronet/ui`) when `open`, following
      `LegacyPrimeMigrationWizard`'s general step-machine shape (a `step`
      state: `"confirm" | "running" | "needs-input" | "result"`):
      - `"confirm"`: shows the current shape label and an explanation,
        with a "Start Upgrade" button that calls
        `actions.runStructuralUpgrade({ onProgress, requestMissingData })`
        and moves to `"running"`.
      - `"running"`: shows the LATEST string `onProgress` has reported
        (component state updated on each call), live.
      - `"needs-input"`: rendered when the `requestMissingData` callback
        passed into the action fires. Implement `requestMissingData` as a
        closure that, when called with a `need`, sets component state to
        `{ step: "needs-input", need }` and returns a `new Promise<string | undefined>((resolve) => { pendingResolveRef.current = resolve; })`
        — i.e. the Promise's `resolve` is stashed in a ref, NOT in global
        store state (this is a single in-flight request scoped entirely
        to this one wizard instance, unlike the store's own
        `PendingPasswordRequest`, which is deliberately global because ANY
        write action anywhere might need a password — this upgrade flow
        has exactly one caller). Render a text input + "Submit" button
        (calls `pendingResolveRef.current?.(inputValue)`, clears the ref,
        returns to `"running"`) and a "Skip this seed" button (calls
        `pendingResolveRef.current?.(undefined)`, same return-to-"running").
      - `"result"`: once `runStructuralUpgrade`'s returned Promise
        resolves, shows the fixed count, and for each `skipped` entry its
        `slice`/`id`/`reason`. A "Close" button calls `onClose`.
      - If `runStructuralUpgrade`'s Promise rejects (e.g.
        `CodexLockedError` in some edge case), show the error message on
        the `"confirm"` step instead of advancing, so the user can retry.
      Export it from `packages/codex-ouronet/src/components/index.ts`
      alongside `LegacyPrimeMigrationWizard` (same file, same pattern:
      `export { StructuralUpgradeWizard } from "../ui/internal/StructuralUpgradeWizard.js";`
      plus its props type).
      done when:
      - A test mounts `<StructuralUpgradeWizard open onClose={...} />`
        inside a `CodexProvider` wired to a store/adapter seeded with a
        stoic seed whose `secret` is word-shaped ciphertext (same fixture
        convention as T1's own store test). Clicking "Start Upgrade"
        eventually (via `findByText`/`waitFor`) shows a "result" step
        reporting that seed as fixed, and the LIVE progress text rendered
        at some point during the run differed from the initial
        pre-upgrade text (proves live progress actually reached the DOM,
        not just the callback).
      - A test with a store/adapter seeded with an UNRESOLVABLE stoic seed
        (garbage plaintext, same convention as Topic 2's own test) shows
        the `"needs-input"` step naming that seed; typing a real valid
        DALOS word string and clicking Submit leads to a "result" step
        reporting that seed as fixed (not skipped); a second run of the
        same scenario where "Skip this seed" is clicked instead leads to a
        "result" step reporting it as skipped, with its reason shown.
      - `npx vitest run tests/ui-structural-upgrade-wizard.test.tsx` (new)
        passes, `npx tsc --noEmit` clean.
      - files: `packages/codex-ouronet/src/ui/internal/StructuralUpgradeWizard.tsx` (new),
        `packages/codex-ouronet/src/components/index.ts`,
        `packages/codex-ouronet/tests/ui-structural-upgrade-wizard.test.tsx` (new)

## Wave 3 (depends on Wave 2)

- [x] T5: Wire a "Codex Upgrade" action card into
      `packages/codex-arweave/src/panel/CodexIdPage.tsx`, as a sibling to
      the existing "Make This Codex Eligible" card (same file, copying its
      exact pattern — read the existing card's JSX, ~line 297-314,
      `ENABLED_PRIMARY_BUTTON_STYLE`/`CODEX_ID_ALREADY_ELIGIBLE_STYLE`/
      `CODEX_ID_ACTION_EXPLANATION_STYLE`, all already defined in this
      file and reused verbatim, not redefined). Import
      `useNeedsStructuralUpgrade` from `@ancientpantheon/codex-ouronet/hooks`,
      `useCodex` for the current `Codex_Shape_Version`, and
      `formatCodexShapeVersionLabel` (Topic 1, already exported from
      `@ancientpantheon/codex-core`) to show the current shape label.
      Import `StructuralUpgradeWizard` from
      `@ancientpantheon/codex-ouronet/components`. Add a `structuralUpgradeWizardOpen`
      boolean state (mirrors the existing `legacyPrimeMigrationWizardOpen`
      state a few lines above). Render: when `useNeedsStructuralUpgrade()`
      is true, an enabled button ("Upgrade Codex Now", reusing
      `ENABLED_PRIMARY_BUTTON_STYLE`) that sets
      `structuralUpgradeWizardOpen(true)`, with explanatory copy below it
      (reusing `CODEX_ID_ACTION_EXPLANATION_STYLE`) naming what this fixes;
      when false, a green note reusing `CODEX_ID_ALREADY_ELIGIBLE_STYLE`'s
      exact style object, text along the lines of "Your codex structure is
      up to date." Render `<StructuralUpgradeWizard open={structuralUpgradeWizardOpen} onClose={() => setStructuralUpgradeWizardOpen(false)} />`
      alongside the existing `<LegacyPrimeMigrationWizard .../>` render.
      done when:
      - A test renders `<CodexIdPage deps={...} />` inside a
        `CodexProvider` wired to a store whose `Codex_Shape_Version` is
        `undefined`: the "Upgrade Codex Now" button is present and
        enabled; clicking it opens the wizard (its modal content becomes
        visible, e.g. via a testid/role the wizard itself exposes).
      - The same with `Codex_Shape_Version` set to the current target: no
        "Upgrade Codex Now" button; the "up to date" note is shown
        instead.
      - The pre-existing "Make This Codex Eligible" card's own tests (in
        whichever existing CodexIdPage test file covers it — check
        `packages/codex-arweave/tests/e4-panel-codex-id*.test.tsx`) still
        pass unmodified — this task adds a sibling card, it does not touch
        the Permaweb-eligibility one.
      - `npx vitest run` on the relevant `e4-panel-codex-id*.test.tsx`
        file(s) plus any new test file for this card passes;
        `npx tsc --noEmit` in `packages/codex-arweave` is clean.
      - files: `packages/codex-arweave/src/panel/CodexIdPage.tsx`,
        and whichever `packages/codex-arweave/tests/e4-panel-codex-id*.test.tsx`
        file(s) already cover this page (extend in place) plus a new test
        file only if the new card's scenarios don't fit naturally into an
        existing one
