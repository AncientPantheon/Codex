# stoachain-crosschain-transfer — Review

Scope: `packages/codex-ouronet/src/ui/internal/SendStoaModal.tsx`,
`packages/codex-ouronet/src/ui/internal/ChainSelector.tsx`,
`packages/codex-ouronet/src/zbom/cfm/PreZbomHint.tsx`,
`packages/codex-ouronet/src/zbom/cfm/localStoaSignatures.ts`,
`packages/codex-ouronet/src/ui/tabs/StoaAccountsTab.tsx`,
`packages/codex-ouronet/tests/ui-send-stoa-modal.test.tsx`,
`packages/codex-ouronet/tests/ui-chain-selector.test.tsx`,
`packages/codex-ouronet/tests/zbom-prezbom-hint.test.tsx`,
`packages/codex-ouronet/tests/zbom-local-stoa-signatures.test.ts`
(all `- files:` from plan.md's four ticked tasks).

Lenses run: correctness, security (diff signs/submits real mainnet-money-moving
transactions), tests, conventions — 4 lenses via parallel `nectar:lens` agents,
followed by adversarial validation via 3 parallel `nectar:validator` agents.

## Round 1 findings

### CRITICAL

**Pact code injection via unescaped `receiverAddr`**
- Where: `SendStoaModal.tsx`, same-chain `C_Transfer`/`C_TransferAnew` build (pre-existing before this topic; also present in the new cross-chain branch)
- Verdict: CONFIRMED — no charset validation existed on the free-text receiver input before it was spliced into a Pact code string literal; a `"` character could break out of the literal and append arbitrary Pact expressions, authorized by the same unscoped guard signer this modal already uses.
- Resolution: **fixed**. Added `SAFE_ACCOUNT_RX = /^[A-Za-z0-9_:.-]+$/` and gated `receiverAddr` against it immediately after trimming, before `checkCoinAccountExists` or any pact-code interpolation in either the same-chain or cross-chain path.

### HIGH

**Cross-chain continuation never confirmed on-chain**
- Where: `SendStoaModal.tsx`, end of the cross-chain branch
- Verdict: CONFIRMED — `submitContinuation` only confirms mempool acceptance per its own doc comment; the flow reported "done" without ever checking the continuation actually executed.
- Resolution: **fixed**. Captured `submitContinuation`'s own returned descriptor and pass its `requestKey` + `targetChain` to `_tx.submitted(...)`, which drives the toast manager's real on-chain poll (`_pollConfirmation` against `/api/v1/poll`) against the correct chain/transaction — the step that actually lands the funds is now the one tracked for confirmation.

**Re-clicking the already-selected chain silently flips same-chain into cross-chain**
- Where: `ChainSelector.tsx`'s `onClick`
- Verdict: CONFIRMED — no guard against `chainId === value`, so re-clicking the source chain re-invoked `SendStoaModal`'s naive `chainId === targetChain` collision handler.
- Resolution: **fixed**. Added a `chainId !== value` guard to `onClick`, so re-selecting the current value is a genuine no-op.

**Displayed sender balance never tracks the selected source chain**
- Where: `SendStoaModal.tsx` props (`senderChainBalance`), `StoaAccountsTab.tsx` call sites
- Verdict: CONFIRMED — a single fixed chain-0 balance number was passed at both call sites, never re-derived when the user picked a different source chain.
- Resolution: **fixed**. Changed the prop to `senderBalanceByChain?: Record<string, {balance, exists}>`, derived `senderChainBalance` reactively via `senderBalanceByChain?.[sourceChain]?.balance`, and updated both `StoaAccountsTab.tsx` call sites to pass the full `perChain` map instead of one fixed-chain slice.

**Initiate-confirmation poll window too short, "pending" conflated with "failure"**
- Where: `SendStoaModal.tsx`'s `waitForInitiateConfirmation`
- Verdict: CONFIRMED — 5 attempts × 3s (~15s) budget vs. the file's own copy calling the overall flow "100+ seconds"; a merely-slow confirmation was worded identically to a hard failure.
- Resolution: **fixed**. Raised the budget to 20 attempts × 5s (~100s, matching `pollSpvProof`'s own order of magnitude) and worded the exhausted-budget ("pending") case distinctly from a reported "failure", explicitly telling the user it may still land and to check before resubmitting.

### MEDIUM

**Toast polls the wrong chain (missing `chainId` arg)**
- Where: `SendStoaModal.tsx`, both `_tx.submitted(requestKey)` call sites
- Verdict: CONFIRMED — `toastManager.ts`'s `submitted(requestKey, chainId?)` defaults to `STOACHAIN_CHAIN_ID` ("0") when omitted.
- Resolution: **fixed**. Same-chain path now passes `_tx.submitted(requestKey, sourceChain)`; cross-chain path passes the continuation's own `targetChain` (see the HIGH finding above — same fix covers both).

**`canSubmit` never validates the cross-chain k:-account requirement**
- Where: `SendStoaModal.tsx`'s `canSubmit`
- Verdict: CONFIRMED — an invalid receiver still enabled submit while cross-chain, triggering a real unlock prompt + pending toast before rejection deep inside `handleSubmit`.
- Resolution: **fixed**. Folded `(!isCrossChain || K_ACCOUNT_RX.test(receiver.trim()))` into `canSubmit`.

**Missing test: cross-chain non-k: receiver rejection**
- Resolution: **fixed**. Added a test asserting submit stays disabled and neither `ensureCodexUnlocked` nor `buildCTransferAcross` fire for a non-k: receiver once cross-chain is selected.

**Missing tests: initiate/SPV failure branches**
- Resolution: **fixed**. Added a "still confirming" (pending, not failure) test using `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync` wrapped in `act()`, and an SPV-timeout test asserting the failure message and that `buildContinuationTransaction` never fires.

**Missing test: visible cross-chain status text**
- Resolution: **fixed**. Added a test gating both `pollSpvProof` and `submitContinuation` behind manually-resolved promises to deterministically observe the "waiting for the SPV proof" and "completing the transfer" status text on screen before each resolves.

**Missing test: chain-selector collision-avoidance branch**
- Resolution: **fixed**. Added a test: move target to "1", then pick source "1" (a genuine value change colliding with the current target) and assert the target snaps away rather than staying equal to source.

**Duplicated ~25-line Pact-builder scaffold (same-chain vs. chain-0-crosschain)**
- Verdict: CONFIRMED
- Resolution: **fixed**. Factored the shared signer-wiring scaffold into `buildGasStationTransaction(ctx, opts)`; both `build:` closures still destructure `{gasLimit, capsKeyPub, guardPubs, gasPrice, creationTime}` inline (required by `tests/tx-gas-meta-surface.test.ts`'s source-scan invariant) and forward to the shared helper.

### LOW

**`LocalStopgapCard` silently drops the `description` prop**
- Resolution: **fixed**. Added a `description?: React.ReactNode` prop, rendered identically to `ModelCard`'s own description row; wired through `PreZbomTooltipCard`'s local-stopgap branch. Added a regression test.

**Tautological `gasStationPublicKey` test assertion**
- Resolution: **fixed**. Removed — the field is unconditionally absent from that call site's object literal regardless of correctness, so the assertion could never fail meaningfully.

**Misleading test title ("registry throws on it")**
- Where: `zbom-prezbom-hint.test.tsx`
- Verdict: CONFIRMED — the real mechanism is `tooltipModels` silently dropping the unresolvable key, never throwing.
- Resolution: **fixed**. Reworded to "tooltipModels silently drops it", consistent with the adjacent correctly-worded sibling test.

**`ChainSelector`'s doc comment overstates canonical parity with OuronetUI's own component**
- Resolution: **fixed**. Softened the doc comment to describe the two as independently-styled siblings sharing an interaction model, not one canonical shape.

### REFUTED

**`ChainSelector`'s `chainCount` prop is "speculative generality with no caller"**
- Validation note: refuted — `chainCount={20}` is explicitly documented as the prop topic 2 (`kadena-native-transfer`, same approved project design) will use; not speculative, deliberately pre-built for the very next topic.
- Resolution: discarded, no change.

## Round 2 (verification)

All CONFIRMED findings above were fixed in a single pass (the fixes were interdependent — e.g. the shared builder helper had to satisfy `tx-gas-meta-surface.test.ts`'s destructuring-shape invariant, discovered only after the refactor). Re-ran the full lens set's scope plus the full package suite and typecheck after all edits:

```
$ npx tsc -b packages/codex-ouronet --force
(no output — clean)

$ npx vitest run   # full packages/codex-ouronet suite
 Test Files  1 failed | 111 passed (112)
      Tests  1 failed | 1356 passed (1357)
```

The one failure (`tests/ui-seed-words-tab.test.tsx`, two intermittent sub-cases)
is a pre-existing flake unrelated to this diff — confirmed by running that file
in isolation twice, both times fully green:

```
$ npx vitest run tests/ui-seed-words-tab.test.tsx
 Test Files  1 passed (1)
      Tests  55 passed (55)
```

Targeted re-run of every file this topic touched, isolated from the flaky file:

```
$ npx vitest run tests/ui-send-stoa-modal.test.tsx tests/ui-chain-selector.test.tsx \
  tests/zbom-prezbom-hint.test.tsx tests/ui-stoa-accounts-tab.test.tsx \
  tests/zbom-local-stoa-signatures.test.ts tests/tx-gas-meta-surface.test.ts
 Test Files  6 passed (6)
      Tests  198 passed (198)
```

Zero CONFIRMED findings remain. Clean pass reached after 1 fix round (2 review
rounds total: initial findings, then verification).

## Behavioral verification

Exercised against design.md's acceptance criteria via the test suite's
end-to-end paths (mocked network boundary, real component/state wiring):
same-chain send unchanged; chain-0 cross-chain via the gas-station `execute()`
path; non-chain-0 cross-chain via direct `buildCTransferAcross` + `sign` +
`submitCrossChainTransfer`; automatic initiate→SPV→continuation chaining with
`onSuccess`/`onClose` firing only after the continuation call resolves;
receiver-charset and k:-account validation rejecting bad input before any
unlock prompt or network call; the Kadena 20-chain display fix (built and
verified in an earlier task within this same topic, retained here).
