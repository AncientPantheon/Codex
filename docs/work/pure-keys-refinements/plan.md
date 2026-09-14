## Wave 1

- [ ] T1: Extract `RsaParamsSection` (exported) out of `ArweaveKeyRow` in
      `ArweaveSeedsArea.tsx` — same test ids, same behavior, zero regressions
      in the existing `e5-seeds-area.test.tsx` (run it unmodified first to
      confirm it still fully passes after the extraction, before touching
      anything else).
  - files: `packages/codex-arweave/src/panel/ArweaveSeedsArea.tsx`

- [ ] T2: Pure Keys refinements — reuse `RsaParamsSection` in `PureKeyRow`;
      distinct default labels for random-generate and import; the balance
      "Unprotected" delete guard (always-unprotected tier, since every Pure
      Keys row is seedless by definition); the elapsed-time progress bar
      replacing "Generating key…". Wire `getBalance` through
      `PureKeysAreaProps` and from `ArweavePanel.tsx`
      (`getBalance={deps?.getBalance}`). See design.md §1, §2, §3
      (Unprotected tier only), §4.
  - files: `packages/codex-arweave/src/panel/PureKeysArea.tsx`,
    `packages/codex-arweave/src/panel/ArweavePanel.tsx`,
    `packages/codex-arweave/tests/e4-panel-pure-keys.test.tsx`

- [ ] T3: Accounts balance delete guard — `ArweaveAccountsSeed.hasWords`,
      `ArweaveAccountsAreaProps.getBalance`, the two-tier (Protected/
      Unprotected) `AccountRow` delete-confirm panel per design.md §3. Wire
      `accountsSeeds`'s `hasWords` and `getBalance={deps?.getBalance}` from
      `ArweavePanel.tsx` (coordinate with T2 — both tasks touch
      `ArweavePanel.tsx`; apply sequentially, not as conflicting parallel
      edits).
  - files: `packages/codex-arweave/src/panel/ArweaveAccountsArea.tsx`,
    `packages/codex-arweave/src/panel/ArweavePanel.tsx`,
    `packages/codex-arweave/tests/e5-accounts-area.test.tsx`

- [ ] T4: Rework `PureKeysArea`'s random-key creation into the two-step
      Generate→Save flow per design.md §5 (matching
      `packages/codex-ouronet/src/ui/tabs/PureKeypairsTab.tsx`'s
      `GenerateSubtab`), REPLACING the current single-click
      `handleCreate`/`RandomKeygenProgress`-on-click behavior and its
      `arweave-pure-key-create`/`arweave-pure-key-progress-bar` tests with
      the new open-panel → generate → (reroll freely) → label → save/cancel
      flow. Keep `RsaParamsSection` and `RandomKeygenProgress` (both already
      built) — reuse them inside the new panel, don't rebuild them. Keep
      Import Keyfile untouched.
  - files: `packages/codex-arweave/src/panel/PureKeysArea.tsx`,
    `packages/codex-arweave/tests/e4-panel-pure-keys.test.tsx`

- [ ] T5: Restructure `PureKeysArea` around a persistent 3-pill subtab bar
      (List/Generate/Import), per design.md §6 — matching
      `PureKeypairsTab.tsx`'s `sub`/`TABS`/pill-bar STRUCTURE (not its
      colors). The Generate subtab reuses T4's panel content verbatim as a
      conditionally-mounted child (so its state resets for free on
      navigation away); the Import subtab reuses the existing file-upload
      flow verbatim, just relocated out from behind the removed "Import
      Keyfile" trigger button into the always-visible subtab body. Remove
      the now-obsolete "Create Random Key"/"Import Keyfile" trigger buttons
      and `panelOpen`/`importOpen` gating in favor of `subTab` navigation.
  - files: `packages/codex-arweave/src/panel/PureKeysArea.tsx`,
    `packages/codex-arweave/tests/e4-panel-pure-keys.test.tsx`

Done when every acceptance criterion in design.md is met and covered by a
passing test; `npx vitest run --root packages/codex-arweave` shows no new
failures beyond the six documented pre-existing `node:sqlite` load failures;
`npx tsc --noEmit -p packages/codex-arweave/tsconfig.json` and the same for
`apps/codex-playground` are clean.
