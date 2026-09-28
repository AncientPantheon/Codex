# kadena-native-transfer — Review

Scope: all 5 tasks in plan.md, ticked:
`packages/codex-ouronet/src/zbom/toast/toastManager.ts`,
`packages/codex-ouronet/src/zbom/toast/MultiStepToastContainer.tsx`,
`packages/codex-ouronet/src/kadena/kadenaReads.ts`,
`packages/codex-ouronet/src/ui/internal/SendKadenaModal.tsx` (new),
`packages/codex-ouronet/src/ui/tabs/StoaAccountsTab.tsx`,
`packages/codex-ouronet/tests/zbom-toast-chain-theme.test.tsx`,
`packages/codex-ouronet/tests/kadena-reads.test.ts`,
`packages/codex-ouronet/tests/ui-send-kadena-modal.test.tsx` (new),
`packages/codex-ouronet/tests/tx-gas-meta-surface.test.ts`,
`packages/codex-ouronet/tests/ui-stoa-accounts-tab.test.tsx`,
`packages/codex-ouronet/tests/zbom-prezbom-launcher-coverage.test.ts` (touched during build to keep its own inventory lock in sync — folded into this review's scope).

Lenses run: correctness, security, tests, conventions — 4 lenses via parallel
`nectar:lens` agents (this diff signs and submits real mainnet-money-moving
transactions, same justification as the sibling `stoachain-crosschain-transfer`
topic), followed by adversarial validation via 2 parallel `nectar:validator`
agents (grouped: SendKadenaModal implementation findings; test-coverage
findings).

## Round 1 findings

### HIGH

**Simulate/submit/poll calls bypass the timeout guard the sibling reads apply to the same flaky node**
- Where: `SendKadenaModal.tsx`'s `dirtyRead`/`submitOne`/`getStatus` calls
- Verdict: CONFIRMED — `kadenaReads.ts`'s own `kadenaDirtyRead` races every read against `KADENA_READ_TIMEOUT_MS` specifically because the default Kadena node is documented as having a real hang failure mode; `SendKadenaModal.tsx` built a separate `createClient(...)` instance and called `dirtyRead`/`submitOne`/`getStatus` with bare `await`, none of it protected. Traced the exact consequence: `submitting` stays `true` forever, no error surfaces, and — since every `txPending` caller in this codebase lazily starts the toast only inside `.submitted()`/`.fail()` — no toast is ever created either.
- Resolution: **fixed**. Extracted the race-against-timeout logic from `kadenaDirtyRead` into a new exported `withKadenaTimeout(promise, label)` helper in `kadenaReads.ts` (refactoring `kadenaDirtyRead` to use it, zero behavior change — no test asserted on its exact error string). `SendKadenaModal.tsx` now wraps all three network calls (`dirtyRead`, `submitOne`, and `getStatus` inside the poll callback) with this same helper.

### MEDIUM

**Negative/malformed simulated gas silently collapses the real submitted transaction's gasLimit to 0**
- Where: `SendKadenaModal.tsx`'s `if (requiredGas) { gasLimit = calculateAutoGasLimit(requiredGas); ... }`
- Verdict: CONFIRMED — `if (requiredGas)` is bare truthiness; a negative `simulation.gas` (the node is plain HTTP, so a tampered response is a real if narrow possibility) is truthy, and `calculateAutoGasLimit` returns `0` for any `<=0`/non-finite input, so a real transaction could be signed and submitted with `gasLimit: 0`.
- Resolution: **fixed**. Guard changed to `typeof requiredGas === "number" && Number.isFinite(requiredGas) && requiredGas > 0`, plus a defense-in-depth `calibrated > 0` check on `calculateAutoGasLimit`'s own return value before ever rebuilding the transaction with it — a real transaction can never carry `gasLimit: 0` regardless of how a bad value got there.

**The modal's real `pollFn` (getStatus → pending/confirmed/failed mapping) was never invoked in tests**
- Verdict: CONFIRMED (downgraded from the lens's initial HIGH — a real, reachable, untested branch of production logic, but no demonstrated production defect, so it doesn't clear the HIGH bar of "incorrect behavior a user will hit").
- Resolution: **fixed**. Added a test that extracts `txPendingMock.mock.calls[0][1].pollFn` after a real submit and drives it directly against mocked `getStatus` responses: not-yet-mined → `"pending"`, `status:"success"` → `"confirmed"`, `status:"failure"` → `"failed"`, a thrown error → `"pending"`.

**`checkKadenaAccountExists` returning `null` (existence-check network failure) was never tested**
- Verdict: CONFIRMED (downgraded from HIGH for the same reason as above).
- Resolution: **fixed**. Added a test asserting the distinct "Could not verify the receiver account" message (never conflated with the "not found" message), and that `dirtyRead`/`sign`/`submitOne` never fire.

**`ui-stoa-accounts-tab.test.tsx`'s new Send KDA tests only covered the desktop path — mobile fullscreen mount untested**
- Verdict: CONFIRMED (downgraded from HIGH for the same reason). Validator confirmed the fix was low-effort: a working mobile-viewport pattern already exists in a sibling describe block in the same file and could be reused near-verbatim.
- Resolution: **fixed**. Added a `mobile fullscreen path` sub-describe block (mirroring the established `FakeResizeObserver`/`CodexUiRoot` pattern) with 2 tests: Kadena mode shows "Send KDA" in the mobile edge stack and opens `SendKadenaModal` there too; Stoa mode's mobile edge stack does not show it.

**Gas-limit calibration test only asserted "not 150000" and "is a number", never the exact calibrated value**
- Verdict: CONFIRMED — an off-by-factor bug or swapped argument into `calculateAutoGasLimit` would still have passed.
- Resolution: **fixed**. Imported `calculateAutoGasLimit` into the test and asserted `realMeta.gasLimit === calculateAutoGasLimit(50)` directly.

**No test asserted on the actual capability-signer shape (`coin.GAS`/`coin.TRANSFER` args) — only the pact-code string**
- Verdict: CONFIRMED — a bug signing a wrong capability argument (stale amount, swapped sender/receiver) would have passed every existing assertion.
- Resolution: **fixed**. Extended `extractPactCode` to also return `signers`, verified the real (unmocked) `Pact.builder`'s actual output shape (`signers[].clist` with `{name, args}`), and added an exact-shape assertion to the `coin.transfer` success test: `coin.GAS` with no args, `coin.TRANSFER` with `[sender, receiver, {decimal}]`.

### LOW

**`dirtyRead` rejecting (thrown network error) was untested, distinct from the tested on-chain-refusal envelope**
- Verdict: CONFIRMED — a real, distinct code path (the outer generic `catch`, not `createSimulationError`) with no coverage.
- Resolution: **fixed**. Added a test with `dirtyReadMock.mockRejectedValue(...)`, asserting the message surfaces and `sign`/`submitOne` never fire.

**`SendKadenaModal` hardcodes chain-id defaults as literals instead of importing this package's own already-exported constants**
- Where: `useState("0")` ×2, `chainCount={20}`, vs. `kadenaReads.ts`'s own exported `KADENA_MAINNET_DEFAULT_CHAIN_ID`/`KADENA_CHAIN_COUNT` (already reused elsewhere in the package)
- Verdict: CONFIRMED, downgraded from the lens's initial MEDIUM to LOW — real inconsistency, but both constants are stable real-world blockchain facts unlikely to change; not a functioning defect.
- Resolution: **fixed**. Imported both constants (`SendKadenaModal.tsx` already imported 4 other names from the same module) and replaced all three literal usages.

### STYLISTIC

**`pollFn` closure lacked a doc comment explaining why `catch` maps to `"pending"` rather than `"give-up"`**
- Validation note: the lens's framing ("unlike every other block in this file") was refuted by a direct counterexample (the receiver-existence-check block is equally uncommented) — comment density in this file is uneven, not a rule this one spot uniquely broke. The specific reasoning is also already documented at the shared call site (`toastManager.ts`'s own `ArweavePollResult` doc comment).
- Resolution: **partially addressed as a side effect** — the HIGH timeout fix added a comment directly above this closure explaining the new `withKadenaTimeout` wrap, but did not add the specific "why pending not give-up" clarification the lens requested. Offered to the user as a choice, not auto-applied (STYLISTIC findings require the user's pick per nectar's own rule); left as-is pending that choice.

## Round 2 (verification)

All CONFIRMED findings fixed in one pass. Re-ran the full suite and typecheck after every edit:

```
$ npx tsc -b packages/codex-ouronet --force
(no output — clean)

$ npx vitest run   # full packages/codex-ouronet suite
 Test Files  113 passed (113)
      Tests  1390 passed (1390)
```

Zero CONFIRMED findings remain. Clean pass reached after 1 fix round (2 review
rounds total: initial findings, then verification).

## Behavioral verification

Exercised against design.md's acceptance criteria via the test suite's
end-to-end paths (mocked network boundary, real component/state wiring, real
unmocked `Pact.builder`): a "Send KDA" action appears only in Kadena mode
(both desktop and mobile), with a working `PreZbomHint` tooltip via the
already-registry-covered `coin.transfer`/`coin.transfer-create` keys; the
20-chain selector renders and re-derives the displayed balance per selected
chain; `coin.transfer` fires for an existing receiver, `coin.transfer-create`
with a derived keyset for a new k: receiver; both `coin.GAS` (no args) and
`coin.TRANSFER` (real sender/receiver/amount) are signed by the sender's own
key — no gas-station signer anywhere in this flow; gas price is the fixed
`10000` constant on every built transaction; gas limit is calibrated from a
real (mocked-network, real-builder) simulation via `calculateAutoGasLimit`;
the toast tracks the send with a distinct green `'kadena'` theme and polls via
an injected callback against the real Kadena `getStatus` shape, never
StoaChain's own poll.
