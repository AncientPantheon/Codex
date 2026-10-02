## Wave 1

- [x] T1: Add a reusable upload-cost-estimate helper. New function
      `estimateUploadCostAr(pool: GatewayPool, byteSize: number, opts?: {
      target?: string; fetchFn?: typeof fetch }): Promise<{ winston: bigint;
      ar: string }>` wrapping `estimateFee` (already exported from
      `@ancientpantheon/arweave-core`, `target` already optional per
      earlier work) and `winstonToAr` (same package) — call `estimateFee`
      with the given `byteSize` and forward `target`/`fetchFn` verbatim,
      then convert the resolved Winston bigint to its AR display string via
      `winstonToAr`, returning both. No new price-quote logic — this is a
      thin convenience wrapper so the wizard doesn't have to compose
      `estimateFee` + `winstonToAr` inline itself. Follow TDD: write the
      failing test first (inject a fake `apiFactory`/`fetchFn` — read
      `packages/arweave-core/tests/reads-fee.test.ts` first for this
      package's existing fee-quote test-fake conventions and mirror them),
      confirm it fails, then implement.

      Done when: given a fake price quote, `estimateUploadCostAr` resolves
      `{ winston, ar }` where `ar` is exactly `winstonToAr(winston)`'s own
      output for that value (not a separately-reimplemented conversion);
      omitting `target` still resolves a quote (byte-size-only, no
      recipient — exactly like the existing optional-target behavior this
      wraps).
  - files: `packages/codex-arweave/src/panel/estimateUploadCost.ts` (new),
    `packages/codex-arweave/tests/estimate-upload-cost.test.ts` (new)

## Wave 2 (depends on Wave 1)

- [x] T2: Build the `UploadWizard` component — the full 5-step guided
      flow. Read `packages/codex-arweave/src/panel/UploadArea.tsx` IN FULL
      first (every piece of existing logic: file/folder picking,
      `previewTags`, the category `<select>` + conditional `nft-data`
      asset-type picker + optional app-id/version fields + optional
      metadata attachment + `NFT_METADATA_DISCLAIMER`, the permanence
      confirm dialog, the upload-then-result/error phase machine) — this
      task REUSES all of it, restructured into steps; it does not
      reimplement any of this logic from scratch. Where a piece is cleanly
      reusable as-is (e.g. `previewTags`, the category `<optgroup>`
      construction), import/reuse it directly from `UploadArea.tsx` rather
      than copy-pasting a second copy — if something isn't currently
      exported that needs to be, export it from that file (a minimal,
      additive change, not a rewrite of that file's own logic).

      Also read `packages/codex-ouronet/src/ui/internal/CodexModalShell.tsx`
      (the modal chrome — `title`/`subtitle`/`onClose`/`children`/`accent`/
      `maxWidth` props) and one existing consumer of it in this package
      (`PureKeysArea.tsx`, grep for its `CodexModalShell` usage) to match
      this package's own established import path
      (`@ancientpantheon/codex-ouronet/ui`) and modal-invocation style
      exactly.

      New component `UploadWizard.tsx`, props (your judgment on exact
      naming, but must include all of): `accounts: ForeignKeyEntry[]`
      (this codex's own Arweave accounts — reuse `ArweavePanel.tsx`'s
      existing `arweaveKeys` state shape; each entry's `.id` IS its
      canonical Arweave address, confirmed via `keyring/foreignKeys.ts`'s
      `toEncryptedEntry`, no decryption needed just to list accounts),
      `ouronetAccounts: ArweaveSeedAccountSource[]` (for the step-2
      encrypting-account sub-picker — same shape `LibraryArea.tsx`'s
      `findEncryptorAccount` already consumes), `pool: GatewayPool` (for
      T1's cost estimate), `uploadAndTrack`, `uploadFilesAndTrack`,
      `openUrl` (same shapes `UploadArea.tsx` already takes — this
      component calls the SAME underlying upload functions, no new upload
      logic), `onClose: () => void`.

      Step state: one internal step index (0-4) plus one "draft" object
      accumulating every selection — changing steps (forward or Back) must
      NEVER reset a previously-made selection.

      - **Step 0 (Account):** a selectable list of `accounts`, each row
        showing its address/label; must pick exactly one before Next
        enables.
      - **Step 1 (Mode):** Public / Encrypted choice. Choosing Encrypted
        reveals, in the SAME step, a picker over `ouronetAccounts`
        (defaulting to whichever entry is flagged Prime, if that flag is
        present on this shape — check `ArweaveSeedAccountSource`'s actual
        fields; if no prime flag exists on this exact type, default to the
        first entry and note that as a judgment call). Next requires an
        encrypting account chosen whenever Encrypted is selected.
      - **Step 2 (Files):** the existing file/folder pickers, reused,
        restyled. Next requires at least one file.
      - **Step 3 (Category):** the existing mandatory category picker +
        conditional `nft-data` asset-type picker + optional app-id/version
        + optional metadata attachment for `nft-data`, reused, restyled.
        Next requires the same gating `UploadArea.tsx` already enforces
        (category chosen; asset-type chosen when category is `nft-data`).
      - **Step 4 (Review & Cost):** show the chosen account, mode (+
        encryptor if applicable), file count, total byte size (sum of
        every selected file's size), a live `estimateUploadCostAr` result
        (call it when this step is entered, show a loading state while the
        quote resolves, and a clear error state if the quote fails — never
        block the review from rendering just because the price quote is
        still in flight or failed), and the existing tag preview. Fold the
        existing `UPLOAD_PERMANENCE_WARNING` text into this step's own
        copy (this step already functions as the "are you sure" moment —
        do not also show a SECOND separate permanence-confirm popup on top
        of it). A single "Confirm & Upload" button here triggers the
        actual upload (calling `uploadAndTrack`/`uploadFilesAndTrack` with
        every draft selection — category, assetType, appId, appVersion,
        and, when Encrypted, the `encryptFor` shape `flow.ts` already
        accepts from the completed `arweave-upload-encryption` topic — read
        `library/flow.ts`'s current `uploadAndTrack`/`uploadFilesAndTrack`
        signatures to confirm the exact `encryptFor` shape before wiring
        this call).

      After a successful upload, show the existing result view (manifest
      link / single-file link, reused from `UploadArea.tsx`'s existing
      result rendering) inside the same modal, with a "Done" button calling
      `onClose`. A failed upload shows the existing error view with an
      option to go back to Step 4 and retry (not force the user back to
      Step 0).

      Follow TDD: write the failing tests first (one test per step's
      gating behavior, one for Back preserving prior selections, one for
      the cost estimate loading/error/success states, one for the final
      upload call receiving every draft field correctly — including the
      `encryptFor` shape when Encrypted was chosen), confirm they fail,
      then implement, then refactor.

      Done when: stepping through all 5 steps with a full set of valid
      selections and clicking "Confirm & Upload" results in
      `uploadAndTrack`/`uploadFilesAndTrack` being called with every
      selection correctly threaded through (category, assetType, appId,
      appVersion, and — when Encrypted was chosen — the correct
      `encryptFor` shape naming the chosen Ouronet account); clicking Back
      at any step preserves every previously-entered value, never resets
      it; each step's Next is disabled until that step's own required
      selection(s) are made; Step 4 shows a real cost estimate sourced from
      `estimateUploadCostAr`, not a hardcoded or placeholder value.
  - files: `packages/codex-arweave/src/panel/UploadWizard.tsx` (new),
    `packages/codex-arweave/src/panel/UploadArea.tsx` (only if exporting an
    existing internal helper/constant that was not already exported — no
    behavioral change to this file itself),
    `packages/codex-arweave/tests/e4-panel-upload-wizard.test.tsx` (new)

## Wave 3 (depends on Wave 2)

- [x] T3: Mount the wizard. Read `packages/codex-arweave/src/panel/
      ArweavePanel.tsx`'s current `active === "upload"` branch (its exact
      current shape — it mounts `UploadArea` directly today) and
      `packages/codex-arweave/src/panel/context.tsx`'s `ArweavePanelDeps`
      in full first. Replace the Upload category's content with two
      buttons: "Start Upload" (opens `UploadWizard` inside a controlled
      open/close state, passing `deps.pool` and whatever `accounts`/
      `ouronetAccounts` are already available on this panel's own state —
      reuse `arweaveKeys`/`deps.ouronetAccounts`, do not add a second way
      to fetch either list) and a second button/link, "Back Up Codex to
      Arweave" — this one does NOT need to open anything yet (the Codex
      Upload wizard it should eventually open lives on a not-yet-built
      page, a later topic); render it as a visibly-disabled or "coming
      soon"-labeled affordance for now rather than silently doing nothing
      on click, and say so explicitly in your report.

      `ArweavePanelDeps` likely needs `estimateUploadCostAr` (T1) added as
      a new field so `ArweavePanel.tsx` can thread it (or `pool`, if
      `UploadWizard` calls T1's function itself given just `pool` — your
      judgment on whether `context.tsx` needs a new field at all, given
      `pool` is already present; if `UploadWizard` only needs `pool` +
      T1's plain exported function, no new context field is required — only
      add one if you find a real reason to).

      Follow TDD: update/extend `ArweavePanel.tsx`'s existing test coverage
      for the Upload category (grep for whichever test file already covers
      `active === "upload"` mounting, likely `e4-panel-categories.test.tsx`
      per this project's own established convention) to assert the new
      two-button structure, confirm the updated test fails against the old
      mount, then implement.

      Done when: selecting the Upload category with real `deps` shows two
      buttons, not the old always-visible flat form; clicking "Start
      Upload" opens `UploadWizard` in a modal; the full `codex-arweave`
      test suite passes (unscoped — check for and fix any gap outside this
      task's own file list the same way every prior task in this project
      has, flagging it explicitly if found); `npx tsc -b packages/codex-
      arweave --force` is clean; `npm run build --workspace=@ancientpantheon/
      codex-playground` succeeds.
  - files: `packages/codex-arweave/src/panel/ArweavePanel.tsx`,
    `packages/codex-arweave/src/panel/context.tsx` (only if a new field is
    genuinely needed — justify in your report if you add one),
    `packages/codex-arweave/tests/e4-panel-categories.test.tsx`
