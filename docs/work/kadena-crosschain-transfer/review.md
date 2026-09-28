# kadena-crosschain-transfer — Review

Scope: both files touched by plan.md's 4 ticked tasks —
`packages/codex-ouronet/src/ui/internal/SendKadenaModal.tsx`,
`packages/codex-ouronet/tests/ui-send-kadena-modal.test.tsx`.

Lenses run: correctness, security, tests, conventions — 4 lenses via parallel
`nectar:lens` agents (this diff signs and submits real cross-chain
mainnet-money-moving transactions via a novel SPV-proof/continuation flow,
same justification as both sibling topics in this project), followed by
adversarial validation via 2 parallel `nectar:validator` agents (grouped:
implementation findings; test-coverage findings).

## Round 1 findings

### MEDIUM

**`crossChainStatus` stuck at "Submitting…" when the unlock prompt is cancelled in cross-chain mode**
- Where: `SendKadenaModal.tsx`'s `handleSubmit`, the `ensureCodexUnlocked()` branch
- Verdict: CONFIRMED — flagged independently by the correctness lens as HIGH ("stuck forever"), downgraded to MEDIUM on validation: the `isOpen` reset effect and a resubmit both clear it, so "forever" was overstated, but the underlying missing reset (unlike the adjacent charset-rejection branch, which correctly resets to `"error"`) is real and leaves a stale, misleading "Submitting the cross-chain transfer…" message visible with the button re-enabled.
- Resolution: **fixed**. The `!unlocked` branch now also resets `crossChainStatus` to `"configure"` when cross-chain, mirroring the charset-rejection branch's own reset discipline.

**Continuation transaction's own `pactId`/`proof`/`chainId`/capability list was never inspected by any test**
- Where: `tests/ui-send-kadena-modal.test.tsx`'s happy-path crosschain test
- Verdict: CONFIRMED — flagged as HIGH by the tests lens, downgraded to MEDIUM on validation: the current implementation is in fact correct (verified against the real, unmocked `Pact.builder.continuation(...)` output shape), so this was a missing regression safety net on a fund-moving step, not a live incorrect behavior.
- Resolution: **fixed**. Added `extractContinuation` (mirrors `extractPactCode` but for `payload.cont`), and extended the happy-path test to assert the exact `pactId` (the initiate step's own requestKey), `proof`, `step`, `rollback`, `meta.chainId` (the target, not source), and the signer's `clist` (`coin.GAS`, no args).

**Continuation step's own gas-limit calibration guard had no negative/malformed-value test coverage**
- Where: `SendKadenaModal.tsx`'s continuation-build gas calibration
- Verdict: CONFIRMED — the exact positive-number guard a sibling topic's own review already found and fixed for the same-chain path exists for the continuation too (added this round), but had zero coverage.
- Resolution: **fixed**. Added a test supplying `gas: -50` for the continuation's own simulation (a genuinely successful envelope, not a refusal) and asserting the signed continuation still carries `gasLimit === SIMULATION_GAS_LIMIT` (150000), never a value derived from the bad input.

### LOW

**Redundant/tautological second assertion in the collision-avoidance test**
- Verdict: CONFIRMED.
- Resolution: **fixed**. Replaced the logically-implied `not.toEqual(["1","1"])` check with two assertions that actually add signal: which specific selector (source vs. target) shows "1" pressed, queried via `within()` on each `<ChainSelector>`'s own container.

### STYLISTIC (offered, not auto-applied)

**Gas-calibration logic (guard → `calculateAutoGasLimit` → rebuild) is duplicated verbatim across the same-chain, initiate, and continuation builds**
- Validation note: genuine duplication, and a `calibrateGasLimit(requiredGas): number | null` extraction would not break any test — but this is a small, well-commented, self-contained block, and reasonable reviewers could disagree on whether the extraction is worth the added indirection. Downgraded from the lens's initial MEDIUM.
- Resolution: not applied — offered to the user as a choice, per nectar's own rule that STYLISTIC findings are the user's call, not auto-fixed.

**Cross-chain non-k: receiver rejection inside `handleSubmit` is unreachable through the UI (the submit button is already disabled by `canSubmit`'s own identical check)**
- Validation note: confirmed technically dead code from the UI's perspective (same render's `canSubmit` and `handleSubmit` compute the k:-account check from the same `receiver` value, so they cannot diverge) — but this mirrors a defense-in-depth pattern this same file already uses elsewhere (the `SAFE_ACCOUNT_RX` check is similarly redundant with input constraints), so a competent reviewer could reasonably keep it as cheap insurance against `canSubmit`'s gate changing independently later. Downgraded from MEDIUM.
- Resolution: not applied — offered to the user as a choice (keep as defensive dead code vs. remove, or add a direct-invocation test bypassing `canSubmit`).

### REFUTED

**Overly broad "balance" substring match in the pending-unclaimed classifier**
- Validation note: refuted — the upstream `createSimulationError` helper (`@stoachain/stoa-core/errors`) already does the identical bare-`"balance"` substring match itself; this file's own regex is documented as compensating for that helper's case-*sensitivity*, not introducing a broader category, and the project's own approved design.md explicitly calls for reusing that exact classification. The lens's illustrative counter-example (`"TRANSFER_XCHAIN exceeded for balance"`) cannot actually occur on the code path this check guards — that message is used elsewhere in the test suite for the *initiate* step's on-chain-failure branch, which never touches this classifier, and the continuation's own pact code (a bare `resume` + `coin.GAS`) never invokes `TRANSFER_XCHAIN` at all.
- Resolution: discarded, no change.

## Self-caught fix (discovered while cross-checking the built code against plan.md, before closing the topic)

**The cross-chain toast had no `pollFn` — `.submitted()` would have marked it "Submitted" on mere continuation-mempool-acceptance, never confirming it actually landed on-chain**
- This is the exact class of gap a sibling topic's own review (`stoachain-crosschain-transfer`) already found and fixed for StoaChain's equivalent continuation step. It was not caught by any of the 4 lenses in this round, but surfaced while verifying the built code matched plan.md's own T3 spec ("tracks via `txPending(...)` where `pollFn` wraps `targetClient.getStatus(...)` the same way the same-chain path's own `pollFn` already does").
- Fixed: `targetClient` is now created upfront (before the toast, since `targetChain` is already known at that point) so the toast's own `pollFn` can close over it and poll the continuation's real on-chain status on the TARGET chain, matching the same-chain path's own established pattern. Added two tests: the happy-path test now asserts the toast was created with a real `pollFn`; a new dedicated test drives that `pollFn` directly against mocked `getStatus` responses and confirms it's bound to the target chain, not the source.

## Round 2 (verification)

All CONFIRMED findings, plus the self-caught pollFn gap, fixed in one pass. Re-ran the full suite and typecheck after every edit:

```
$ npx tsc -b packages/codex-ouronet --force
(no output — clean)

$ npx vitest run   # full packages/codex-ouronet suite
 Test Files  113 passed (113)
      Tests  1401 passed (1401)
```

Zero CONFIRMED findings remain. Clean pass reached after 1 fix round (2 review
rounds total: initial findings, then verification).

## Behavioral verification

Exercised against design.md's acceptance criteria via the test suite's
end-to-end paths (mocked network boundary at `createClient`, real component/
state wiring, real unmocked `Pact.builder`): the source/target chain-selector
pair renders and collision-avoids correctly; the same-chain path is byte-for-
byte unchanged; picking different chains fires `coin.transfer-crosschain`,
signs `coin.GAS` + `coin.TRANSFER_XCHAIN` with the confirmed live argument
order, waits for real confirmation via the Kadena client's own `pollOne`,
fetches the SPV proof via `pollCreateSpv`, builds and SIGNS a continuation
(unlike a sibling topic's unsigned StoaChain continuation) with the exact
`pactId`/`proof`/`step`/`rollback`/target-`chainId` fields verified against
the real builder's own wire shape, and tracks it via a toast whose `pollFn`
genuinely confirms on the target chain. When the sender lacks gas on the
target chain, the flow reaches a distinct, honest "pending / unclaimed" state
— never a false "done", never a bare "error" — naming the chain and request
key, without force-closing the modal.

## Closing status for the `chainweb-crosschain-transfers` project

All three topics are now built and reviewed to a clean pass:
1. `stoachain-crosschain-transfer` — done (`docs/work/stoachain-crosschain-transfer/review.md`).
2. `kadena-native-transfer` — done (`docs/work/kadena-native-transfer/review.md`).
3. `kadena-crosschain-transfer` — done (this file).

The project's own design.md acceptance criteria are now all satisfied.
