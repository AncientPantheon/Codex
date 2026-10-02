## Wave 1

- [x] T1: Rewrite `UploadWizard.tsx` per the owner's correction pass — read
      the "Addendum" section of `docs/work/arweave-upload-wizard/design.md`
      in full first (it is the complete, detailed spec for every change
      below; this task text summarizes it but the addendum is the source
      of truth for exact wording/behavior). Read the CURRENT
      `packages/codex-arweave/src/panel/UploadWizard.tsx` in full before
      changing anything — this is a revision of real, working, tested
      code, not a rewrite from scratch; preserve every piece of correct
      underlying logic (the draft-state model, the final `uploadAndTrack`/
      `uploadFilesAndTrack` call with `encryptFor`, the cost-estimate
      call), only change what this task specifies.

      **Visual style**: read `packages/codex-arweave/src/panel/
      ArweaveAccountsArea.tsx`'s own style constants (`const ACCENT =
      "#ceac5f"`, the accent-tinted-background/border "selected" pill
      pattern used throughout that file) and apply the SAME convention to
      every control in the wizard — Next/Prev/Add File/Add Folder/Remove/
      Confirm, and every selectable row (account, category, mode). No bare
      default-chrome `<button>`/`<select>` anywhere.

      **Step order**: Account → Category+Mode (one combined step) → Files
      → Review & Cost. On the combined step: category selection drives a
      *recommended* (pre-selected but changeable) Public/Encrypted default
      — `nft-data` recommends Public; every other category's recommended
      default is your judgment call, document it in your report. Choosing
      Encrypted (by recommendation or manual override) reveals the
      Ouronet-account encryptor sub-picker in this SAME step, exactly as
      the previous version did in its old Mode step — reuse that existing
      sub-picker logic, just relocated.

      **File chooser rebuild**: two modes — "Add File" (repeatable button,
      each click adds one file via a native file-picker dialog, running
      list capped at 10; attempting an 11th shows a clear inline message
      directing the user to Folder mode, never silently drops/truncates)
      and "Add Folder" (repeatable `webkitdirectory` picker; EACH
      additional folder pick appends its files to the running selection
      with that folder's own name prefixed onto every one of its files'
      relative paths, so two different folder picks can never collide on
      path — e.g. picking "catA" then "catB", each containing
      "img1.png", must result in distinct paths like "catA/img1.png" and
      "catB/img1.png", not two files that silently overwrite each other in
      the running list). Every added file shows its own byte size; a
      running total sits above the list and updates live as files are
      added or removed; every added file (and, for folder-added files, the
      folder as a whole) can be removed individually.

      **Review & Cost step**: add the chosen account's live balance (call
      the new `getBalance` prop — see T2, which adds it to this
      component's own props and to `ArweavePanelDeps`/the `ArweavePanel.tsx`
      mount; if T2 hasn't landed yet when you run this task, add the prop
      to `UploadWizardProps` yourself as part of this task and let T2 just
      wire the mount side), the real cost estimate (already built, keep
      as-is), and a computed "estimated remaining balance" (balance minus
      cost, in AR) — show a clear warning state (not a hard block, unless
      the chosen account's balance is YES less than the cost, in which
      case Confirm should be disabled with a clear "insufficient balance"
      message) when the remainder would be negative. Add explanatory copy,
      exact wording your judgment but covering: this posts as one
      transaction (or one bundle transaction for multiple files), it
      appears in the Library immediately as "pending" (already true,
      existing behavior — just say so), Arweave's block time is roughly
      two minutes so full confirmation takes a little while. Add a plain
      statement that the shown tags/versioning are transaction metadata,
      separate from the file bytes, and can never alter or corrupt the
      uploaded content. Add a link-pattern line (e.g. "your files will be
      reachable at `https://<gateway>/<id>` — exact links appear once the
      upload completes") — do NOT attempt a true pre-signed link preview,
      that's explicitly out of scope per the addendum.

      **Commit gating**: add an optional `ensureCodexUnlocked?: () =>
      Promise<boolean>` prop. "Confirm & Upload" must call it FIRST (if
      provided) and only proceed to the real `uploadAndTrack`/
      `uploadFilesAndTrack` call if it resolves `true`; if it resolves
      `false` (user cancelled the password prompt), return to the Review
      step with no error shown (a cancel is not a failure) and do not
      attempt the upload. If `ensureCodexUnlocked` is undefined, proceed
      exactly as before (backward compatible with any caller that doesn't
      supply it).

      Follow TDD: extend/add the failing tests first for every behavior
      above (10-file cap + message, multi-folder path-prefixing with no
      collision, running total size updates, category-driven mode
      recommendation incl. the nft-data→Public case, remaining-balance
      computation incl. the insufficient-balance disable case,
      `ensureCodexUnlocked` gating both the true and false/cancel paths),
      confirm they fail, then implement, then refactor.

      Done when: every behavior above is covered by a passing test; the
      full `codex-arweave` test suite still passes (unscoped — check for
      and fix any gap outside this task's own file list, exactly like
      every prior task in this project has, flagging explicitly if found);
      `npx tsc -b packages/codex-arweave --force` is clean.
  - files: `packages/codex-arweave/src/panel/UploadWizard.tsx`,
    `packages/codex-arweave/tests/e4-panel-upload-wizard.test.tsx`

## Wave 2 (depends on Wave 1)

- [x] T2: Wire the two new props through. Read
      `packages/codex-arweave/src/panel/context.tsx`'s full
      `ArweavePanelDeps` (already has `getBalance: (address: string) =>
      Promise<bigint>` — confirm this yourself) and
      `packages/codex-arweave/src/panel/ArweavePanel.tsx`'s current
      `UploadWizard` mount call (added in the prior `arweave-upload-wizard`
      plan's T3). Add `ensureCodexUnlocked?: () => Promise<boolean>` to
      `ArweavePanelDeps` (optional, mirroring the exact shape already used
      on `ArweaveSeedsAreaProps`/`RsaParamsSectionProps` in this same
      package — read one of those for the precedent) — this is a NEW
      capability this panel doesn't currently expose anywhere, so also
      check whether `ArweavePanel.tsx`'s OTHER existing mounts (Seeds,
      PureKeys) already receive an `ensureCodexUnlocked` from this panel's
      own `deps` or get it some other way, and match whatever precedent
      you find rather than inventing a second path. Pass both `getBalance`
      and `ensureCodexUnlocked` from `deps` into the `UploadWizard` mount
      call.

      Follow TDD: extend the existing Upload-category mounting test
      (`tests/e4-panel-categories.test.tsx`) to assert both props are
      correctly wired, confirm it fails first, then implement.

      Done when: `UploadWizard` is mounted with real `getBalance`/
      `ensureCodexUnlocked` values sourced from `deps` (verified by test,
      not just visual inspection); the full `codex-arweave` test suite
      passes (unscoped); `npx tsc -b packages/codex-arweave --force` is
      clean; `npm run build --workspace=@ancientpantheon/codex-playground`
      succeeds (rebuild `codex-arweave`'s own dist first if needed, per
      this project's own recurring stale-dist gotcha).
  - files: `packages/codex-arweave/src/panel/context.tsx`,
    `packages/codex-arweave/src/panel/ArweavePanel.tsx`,
    `packages/codex-arweave/tests/e4-panel-categories.test.tsx`
