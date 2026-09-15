## Wave 1 (parallel — independent files)

- [ ] T1: `useUrStoaBalances` hook — done when: a new
      `packages/codex-ouronet/src/ui/internal/useUrStoaBalances.ts` mirrors
      `useStoaChainBalances.ts`'s shape (`byAddress`/`loading`/`error`/
      `refresh`, `enabled` gating, `codexClock.report` wrapping) but reads
      ONLY chain `"0"` and returns `{balance, staked, earnings, exists}` per
      address via the batched `map`/`try` Pact expression in design.md; unit
      tests cover batching, field mapping, and the `enabled=false` no-op
      case; `npx vitest run packages/codex-ouronet/tests/use-urstoa-balances.test.ts --root packages/codex-ouronet` passes; `npx tsc --noEmit -p packages/codex-ouronet/tsconfig.json` clean.
  - files: `packages/codex-ouronet/src/ui/internal/useUrStoaBalances.ts`,
    `packages/codex-ouronet/tests/use-urstoa-balances.test.ts`

- [ ] T2: UrStoa vault action modals — done when: four new self-contained
      modal components exist (`TransferUrStoaModal.tsx`, `StakeUrStoaModal.tsx`,
      `UnstakeUrStoaModal.tsx`, `CollectUrStoaModal.tsx`), each: takes the
      account's public key + address as props, resolves the signing keypair
      via `useGetKeypair()` ONLY at confirm-time, calls the matching
      `@ouronet/ouronet-core/interactions/urStoaFunctions` export
      (`executeNativeUrStoaTransfer`/`executeStakeUrStoa`/
      `executeUnstakeUrStoa`/`executeCollectUrStoa`) passing the SAME
      decrypted keypair as both the owning key and `gasStationKey`/
      `paymentKeypair` (per design.md's resolved decision — do not add a
      second key-resolution path), renders via `CodexModalShell`, has
      in-flight/success/error states mirroring
      `packages/codex-ouronet/src/components/RotatePaymentKeyModal.tsx`. Amount
      validation, a locked-codex message on `CodexLockedError`, and a real
      on-chain-failure message (never swallowed) are all required. Tests
      mock `useGetKeypair`/the `urStoaFunctions` exports — no real network,
      no real key, ever. `npx vitest run packages/codex-ouronet/tests/ui-transfer-urstoa-modal.test.tsx packages/codex-ouronet/tests/ui-stake-urstoa-modal.test.tsx packages/codex-ouronet/tests/ui-unstake-urstoa-modal.test.tsx packages/codex-ouronet/tests/ui-collect-urstoa-modal.test.tsx --root packages/codex-ouronet` passes; `npx tsc --noEmit -p packages/codex-ouronet/tsconfig.json` clean.
  - files: `packages/codex-ouronet/src/ui/internal/TransferUrStoaModal.tsx`,
    `packages/codex-ouronet/src/ui/internal/StakeUrStoaModal.tsx`,
    `packages/codex-ouronet/src/ui/internal/UnstakeUrStoaModal.tsx`,
    `packages/codex-ouronet/src/ui/internal/CollectUrStoaModal.tsx`,
    `packages/codex-ouronet/tests/ui-transfer-urstoa-modal.test.tsx`,
    `packages/codex-ouronet/tests/ui-stake-urstoa-modal.test.tsx`,
    `packages/codex-ouronet/tests/ui-unstake-urstoa-modal.test.tsx`,
    `packages/codex-ouronet/tests/ui-collect-urstoa-modal.test.tsx`

- [ ] T3: Native Stoa Send modal — done when: a new
      `SendStoaModal.tsx` builds `coin.C_Transfer` (receiver exists) or
      `coin.C_TransferAnew` (receiver doesn't — probe existence first,
      mirroring `checkCoinAccountExists`'s pattern for the native-coin case),
      dispatches via `useSignTransaction()`'s `execute` (NOT
      `useGetKeypair` directly — this one goes through
      `CodexSigningStrategy`, per design.md), same
      `CodexModalShell`/in-flight/success/error shape as T2's modals. Tests
      cover both the exists/doesn't-exist Pact-code branches and mock
      `useSignTransaction`. `npx vitest run packages/codex-ouronet/tests/ui-send-stoa-modal.test.tsx --root packages/codex-ouronet` passes; `npx tsc --noEmit -p packages/codex-ouronet/tsconfig.json` clean.
  - files: `packages/codex-ouronet/src/ui/internal/SendStoaModal.tsx`,
    `packages/codex-ouronet/tests/ui-send-stoa-modal.test.tsx`

## Wave 2 (sequential — depends on T1+T2+T3 existing)

- [ ] T4: Wire into `StoaAccountsTab.tsx` — done when: a Stoa/UrStoa toggle
      is added near the existing header controls; toggling to UrStoa swaps
      the balance source to T1's hook and renders `"{wallet} [{staked}]"`
      per row (same number-formatting helper this file already uses for
      Stoa) plus four small square icon buttons per row opening T2's four
      modals; a Send button (always visible) opens T3's modal; every
      modal's success calls the active balance hook's `refresh()`; done when
      every acceptance criterion in design.md is met and covered by a
      passing test; `npx vitest run --root packages/codex-ouronet` shows no
      new failures beyond whatever pre-existing failures already exist in
      that suite (check the baseline first); `npx tsc --noEmit -p
      packages/codex-ouronet/tsconfig.json` and `npx tsc --noEmit -p
      apps/codex-playground/tsconfig.json` are both clean.
  - files: `packages/codex-ouronet/src/ui/tabs/StoaAccountsTab.tsx`,
    `packages/codex-ouronet/tests/ui-stoa-accounts-tab.test.tsx` (or
    whichever existing test file already covers this tab — extend it, don't
    fork a parallel one if one already exists)
