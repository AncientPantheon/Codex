## Wave 1
- [x] T1: New reusable `ChainSelector` component — a 10-button (0-9) chain picker, mirroring
  OuronetUI's own `CrossChainTransfer.tsx` inline component.
  - Create `packages/codex-ouronet/src/ui/internal/ChainSelector.tsx`:
    ```tsx
    export interface ChainSelectorProps {
      label: string;
      value: string;
      onChange: (chainId: string) => void;
      /** This one chain cannot be picked here — the OTHER selector's current
       *  value, so source and target can never collide. */
      disabledChain?: string;
      chainCount?: number; // default 10 (StoaChain); Kadena's own modal passes 20
    }
    export function ChainSelector({ label, value, onChange, disabledChain, chainCount = 10 }: ChainSelectorProps) {
      return (
        <div>
          <label style={modalLabel}>{label}</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {Array.from({ length: chainCount }, (_, i) => String(i)).map((chainId) => {
              const isSelected = value === chainId;
              const isDisabled = disabledChain === chainId;
              return (
                <button
                  key={chainId}
                  type="button"
                  disabled={isDisabled}
                  aria-pressed={isSelected}
                  onClick={() => !isDisabled && onChange(chainId)}
                  style={{ width: 30, height: 30, borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: isDisabled ? "not-allowed" : "pointer", border: isSelected ? "2px solid #ceac5f" : "1px solid #262626", backgroundColor: isSelected ? "#ceac5f" : isDisabled ? "#141414" : "#0a0a0a", color: isSelected ? "#0a0a0a" : isDisabled ? "#444" : "#d2d3d4" }}
                >
                  {chainId}
                </button>
              );
            })}
          </div>
        </div>
      );
    }
    ```
    (import `modalLabel` from `./CodexModalShell.js`, matching every other modal's own label style.)
  - Create `packages/codex-ouronet/tests/ui-chain-selector.test.tsx`:
    - Renders `chainCount` buttons (default 10) labelled "0".."9".
    - Clicking an enabled chain calls `onChange` with that chain id.
    - The `disabledChain` button has `disabled` set and clicking it does NOT call `onChange`.
    - The `value` chain has `aria-pressed="true"`; every other button has `aria-pressed="false"`.
    - `chainCount={20}` renders buttons "0".."19" (locks in the prop Kadena's own modal will use).
  - done when: `npx vitest run tests/ui-chain-selector.test.tsx` passes; `npx tsc --noEmit` clean.
  - files: `packages/codex-ouronet/src/ui/internal/ChainSelector.tsx`, `packages/codex-ouronet/tests/ui-chain-selector.test.tsx`

- [x] T2: Hand-author + source-verify a `coin.C_TransferAcross` tooltip spec — the registry gap
  (confirmed live: absent from the installed `STOA_SIGNATURES` table) this topic's own acceptance
  criterion needs filled.
  - Create `packages/codex-ouronet/src/zbom/cfm/localStoaSignatures.ts`:
    ```ts
    /**
     * A stopgap for STOA entrypoints the installed `@ouronet/talos-registry`
     * doesn't describe yet — confirmed live: `coin.C_TransferAcross` is absent
     * from its `STOA_SIGNATURES` table (same class of gap as the previously
     * -found-and-reported `coin.C_UR|TransferAnew`). Deleted once the registry
     * adds this entry upstream — mirrors this file's own now-deleted
     * `nativeStoaSpecs.ts` precedent: hand-transcribed, line-numbered, and
     * verified against the deployed contract by a dedicated test that fails
     * loudly on drift.
     */
    export interface LocalStoaSignature {
      exec: string;
      signature: string[];
    }
    export const LOCAL_STOA_SIGNATURES: Readonly<Record<string, LocalStoaSignature>> = {
      "coin.C_TransferAcross": {
        exec: "coin.C_TransferAcross",
        signature: ["sender", "receiver", "receiver-guard", "target-chain", "amount"], // coin-live.pact:589-592
      },
    };
    ```
  - Create `packages/codex-ouronet/tests/zbom-local-stoa-signatures.test.ts`, mirroring
    `tests/zbom-native-stoa-specs.test.ts`'s (now-deleted, but same-shaped) pattern exactly: read the
    sibling `coin-live.pact` checkout (same 6-levels-up path already established this session),
    regex-parse every `(defun NAME:type (...))`, assert `LOCAL_STOA_SIGNATURES["coin.C_TransferAcross"].signature`
    equals the parsed `C_TransferAcross` params exactly; skip visibly (console.warn, not silent
    green) when the sibling checkout is absent.
  - done when: `npx vitest run tests/zbom-local-stoa-signatures.test.ts` passes (verified running,
    not skipped, same "temporarily break one signature, confirm RED, revert" discipline as every
    prior signature-verification test this session); `npx tsc --noEmit` clean.
  - files: `packages/codex-ouronet/src/zbom/cfm/localStoaSignatures.ts`, `packages/codex-ouronet/tests/zbom-local-stoa-signatures.test.ts`

## Wave 2 (depends on Wave 1's T1)
- [x] T3: Wire the chain selector + crosschain build/sign/submit/poll/continue into
  `SendStoaModal.tsx`, importing `@ouronet/ouronet-core/interactions/crossChainFunctions` directly
  (already installed at 4.6.0, matching Codex's own peer range — no reimplementation).
  - In `packages/codex-ouronet/src/ui/internal/SendStoaModal.tsx`:
    - Add `sourceChain`/`targetChain` state (default `"0"`/`"1"`), reset alongside the existing
      `receiver`/`amount`/`submitting`/`lastError` reset-on-open effect.
    - Render two `<ChainSelector>` instances (source, target — target's `disabledChain={sourceChain}`)
      above the existing receiver/amount inputs. Add a `useEffect` that snaps `targetChain` off
      `sourceChain` automatically if they'd collide (mirrors OuronetUI's own guard — pick the lowest
      chain id that isn't `sourceChain`).
    - Add a `status` state machine:
      `"configure" | "submitting" | "confirming" | "waiting-spv" | "completing" | "done" | "error"`
      (matches the imported functions' own vocabulary), plus a `statusDetail` string for the
      per-step message shown in `ModalFeedback`/a new small status line.
    - In `handleSubmit`, branch on `sourceChain === targetChain`:
      - **Same chain** (the existing path): UNCHANGED — the current `isNew`/`C_Transfer`/
        `C_TransferAnew`/`execute()` logic, byte-for-byte, just now reading `sourceChain` wherever
        the old code read the hardcoded `STOACHAIN_CHAIN_ID` constant (still used as this component's
        OWN default state, not removed).
      - **Different chains**: `setStatus("submitting")`, then:
        - `sourceChain === "0"`: build INLINE via `execute()`'s own `build` callback (mirrors the
          existing same-chain `execute()` call immediately above it in this same file) with pact
          code `(coin.C_TransferAcross "${address}" "${receiverAddr}" (read-keyset "ks") "${targetChain}" ${decimalStr})`,
          `addData("ks", { keys: [receiverAddr.slice(2)], pred: "keys-all" })` (same derivation the
          same-chain `isNew` branch already does), the same `DALOS.GAS_PAYER` capsKeyPub signer, and
          the same unscoped `guardPubs` loop for the sender's own key — `chainId: "0"`.
        - `sourceChain !== "0"`: resolve the sender's keypair via `useGetKeypair()` (imported
          alongside `useSignTransaction`, mirrors `StakeUrStoaModal.tsx`'s own "resolved at
          confirm-time" pattern), call `buildCTransferAcross({ sender: address, receiver: receiverAddr, receiverGuard: { keys: [receiverAddr.slice(2)], pred: "keys-all" }, amount: decimalStr, sourceChain, targetChain, senderPublicKey: publicKey })`
          (no `gasStationPublicKey` — only required for chain 0, per that function's own
          `throw new Error("gasStationPublicKey is required for chain 0 transfers")` guard, which
          this branch never triggers since `sourceChain !== "0"` here), sign with
          `strategy.sign({ tx: builtTx, capsKey: keypair, guardKeypairs: [] })`, then
          `submitCrossChainTransfer(signed, sourceChain)`.
        - Either way: `setStatus("confirming")`, `pollTransactionStatus(requestKey, sourceChain)` in
          a bounded retry loop (5 attempts, matching the imported functions' own
          `TIMEOUT-is-pending-not-failed` contract — a `SigningError(code: "TIMEOUT")` from
          `listenForCompletion`-adjacent calls means "poll again", not "failed"); on confirmed
          success, `setStatus("waiting-spv")`, `pollSpvProof(requestKey, sourceChain, targetChain, 30, 5000, (attempt, max) => setStatusDetail(...))`;
          on proof arrival, `setStatus("completing")`,
          `buildContinuationTransaction(pactId, proof, targetChain, sourceChain === "0" ? undefined : "stoa-xchain-gas")`
          (the function's own default param already is `"stoa-xchain-gab"` — pass nothing extra for
          the non-chain-0 case, matching its own default; chain-0's own continuation ALSO uses
          `stoa-xchain-gas` per the imported function's unconditional default — confirmed live in its
          source, there's no separate chain-0 continuation gas payer), `submitContinuation(contTx, targetChain)`
          (UNSIGNED — no `strategy.sign` call for this step, matching the imported function's own doc
          comment), `setStatus("done")`, `onSuccess?.(requestKey)`, `onClose()`.
        - On any step's failure (not a `TIMEOUT`-class error): `setStatus("error")`, `setLastError(...)`,
          `_tx.fail(...)` — the existing toast-lifecycle pattern this file already uses, unchanged.
    - Update the `subtitle`/footer copy to mention `coin.C_TransferAcross` when `sourceChain !==
      targetChain` is selected (still `"coin.C_Transfer / coin.C_TransferAnew"` for the same-chain
      case, unchanged).
  - In `packages/codex-ouronet/tests/ui-send-stoa-modal.test.tsx` (new or extended, whichever exists
    — check first): mock `@ouronet/ouronet-core/interactions/crossChainFunctions`'s
    `buildCTransferAcross`/`submitCrossChainTransfer`/`pollTransactionStatus`/`pollSpvProof`/
    `buildContinuationTransaction`/`submitContinuation` (`vi.mock`, matching this suite's own
    established partial-mock convention), and:
    - Same-chain (default 0/1... no, default differs, source=target set explicitly to the SAME
      value in this test) send still calls `execute()` with the SAME pact code
      (`coin.C_Transfer`/`coin.C_TransferAnew`) as before this topic — a regression lock proving the
      chain-selector addition didn't change the existing path.
    - Selecting source=0, target=1 calls `execute()` (not `buildCTransferAcross`) with pact code
      containing `coin.C_TransferAcross` and `"1"` as the target-chain argument.
    - Selecting source=3, target=5 calls `buildCTransferAcross` (not `execute()`) with
      `sourceChain: "3"`, `targetChain: "5"`, and NO `gasStationPublicKey`; asserts
      `strategy.sign`/`useGetKeypair` were used, `useSignTransaction`'s `execute` was NOT called for
      this branch.
    - After a successful initiate + confirm + SPV proof, `buildContinuationTransaction` and
      `submitContinuation` are both called with the request's `pactId`/`proof`/`targetChain`, and
      `onSuccess`/`onClose` fire only after the continuation succeeds (not right after the initiate
      step) — proves the auto-continuation, not a fire-and-forget initiate.
    - The non-chain-0 gas-payer path's built transaction meta never exceeds `gasLimit: 850` (a
      direct check on the mocked `buildCTransferAcross` call's own args, since the function itself
      already enforces this — this test locks that CALLER never overrides it upward).
  - done when: `npx vitest run tests/ui-send-stoa-modal.test.tsx` (or the pre-existing equivalent
    file, extended) passes; `npx tsc --noEmit` clean; the pre-existing same-chain-only tests in this
    same file (if any) still pass unmodified.
  - files: `packages/codex-ouronet/src/ui/internal/SendStoaModal.tsx`, `packages/codex-ouronet/tests/ui-send-stoa-modal.test.tsx` (or the pre-existing file covering this modal — confirm exact name during build)

## Wave 3 (depends on Wave 1's T2 and Wave 2's T3)
- [x] T4: Wire the `PreZbomHint` tooltip for the crosschain case onto the Send launcher in
  `StoaAccountsTab.tsx`, and render `coin.C_TransferAcross`'s signature via the local stopgap spec
  when the registry itself can't describe it.
  - In `packages/codex-ouronet/src/zbom/cfm/PreZbomHint.tsx`: before the `chainOf`-based fail-open
    check, also treat a key present in `LOCAL_STOA_SIGNATURES` (imported from
    `./localStoaSignatures.js`) as describable, and — when `tooltipModels`/`tooltipModel` itself
    would throw or drop it (confirmed: it does, for `coin.C_TransferAcross` today) — render a
    minimal native-shaped card DIRECTLY from the local spec (gold `stoa` border/label, same
    `ModelCard`-adjacent styling, numbered `signature` list with illustrative example values — no
    live preview, matching every other `stoa`-kind card's own "no IGNIS" footer) instead of falling
    through to the registry call. This is intentionally the ONLY place `LOCAL_STOA_SIGNATURES` is
    consulted — everything else in this file keeps consulting `tooltipModels` exclusively.
  - In `packages/codex-ouronet/src/ui/tabs/StoaAccountsTab.tsx`: the Send/Transfer `PreZbomHint`'s
    `entrypoint` cycling array is unaffected by this topic (it already cycles `C_Transfer`/
    `C_TransferAnew` for same-chain) — this task does NOT add `C_TransferAcross` to that cycling set
    (the crosschain case is a user CHOICE via the chain selector inside the modal, not a
    hover-time-unknowable runtime branch the way exists/doesn't-exist is — showing it in the
    pre-open cycling tooltip would describe a call the user hasn't opted into yet). Instead, add a
    SEPARATE, small `PreZbomHint` (or an inline tooltip trigger) INSIDE the opened `SendStoaModal`
    itself, next to the chain selectors, showing `coin.C_TransferAcross`'s signature ONLY once
    `sourceChain !== targetChain` — this is the ZBOM's own execute-adjacent surface, so per the
    owner's standing ruling ("on the LAUNCHER, never the ZBOM's execute button") this is NOT the
    execute button itself; it's informational context beside the chain pickers, same spirit as the
    ZBOM's own already-visible input-zone parameter list for every other modal.
  - In `packages/codex-ouronet/tests/zbom-prezbom-hint.test.tsx`: add a test rendering
    `<PreZbomTooltipCard entrypoint="coin.C_TransferAcross" />` and asserting the local-stopgap
    branch renders `STOA NATIVE`/gold border/the real 5-parameter signature — proves the fallback
    path works before the registry itself ever adds this entry.
  - done when: `npx vitest run tests/zbom-prezbom-hint.test.tsx` passes; `npx tsc --noEmit` clean;
    full `packages/codex-ouronet` suite green; full workspace `npm run typecheck` clean.
  - files: `packages/codex-ouronet/src/zbom/cfm/PreZbomHint.tsx`, `packages/codex-ouronet/src/ui/tabs/StoaAccountsTab.tsx`, `packages/codex-ouronet/tests/zbom-prezbom-hint.test.tsx`
