/**
 * <SendStoaModal> — self-contained modal for native Stoa (Kadena coin)
 * transfers, same-chain OR cross-chain.
 *
 * SAME-CHAIN (source chain === target chain, the default and still the
 * common case): `(coin.C_Transfer <sender> <receiver> <amount>)` when the
 * receiver account already exists on-chain, or
 * `(coin.C_TransferAnew <sender> <receiver> (read-keyset "ks") <amount>)`
 * (create + transfer, k: receivers only) when it doesn't — UNCHANGED from
 * before this modal grew a chain selector. Ported from OuronetUI's
 * `transfer-token.tsx` Send flow. Dispatches through the generic
 * `useSignTransaction()` seam (`CodexSigningStrategy.execute`) — gas is paid
 * by the Ouronet Gas Station; the sender's own key is added as a guard
 * signer (`guardPubs`) that EXPLICITLY declares the `coin.TRANSFER`
 * capability `C_Transfer`/`C_TransferAnew` require underneath
 * (`buildGasStationTransaction`'s own `guardCapabilities` — see its doc
 * comment for the live bug this corrects: an earlier version added this
 * signer BARE, on the mistaken assumption that an unscoped guard signer
 * auto-authorizes any capability requested for that key. That holds for a
 * plain `enforce-guard` check, not for a `@managed` capability — Pact only
 * pre-installs one when some signer's `clist` explicitly declares it with
 * matching arguments, confirmed against the deployed `coin-live.pact`
 * directly and cross-checked against OuronetUI's own working
 * `transfer-token.tsx`, which DOES declare it).
 *
 * CROSS-CHAIN (source chain !== target chain): `coin.C_TransferAcross`
 * (confirmed live, `coin-live.pact:589-592` — a thin wrapper over the real
 * `transfer-crosschain` defpact), then an automatic SPV-proof continuation,
 * exactly matching OuronetUI's own already-shipped `CrossChainTransfer.tsx`
 * flow. THE CROSSCHAIN MECHANICS THEMSELVES ARE NOT REIMPLEMENTED HERE —
 * `@ouronet/ouronet-core/interactions/crossChainFunctions` (already
 * installed at 4.6.0, already audited — 3 named audit-finding closures in
 * its own history) is the single source of truth for
 * build/submit/poll/continue; this file only wires it to Codex's own
 * key-resolution and UI state. Two distinct signing paths, matching
 * `buildCTransferAcross`'s own two branches:
 *
 *   - Source chain "0": gas paid by the Ouronet Gas Station. Built INLINE,
 *     via the SAME `execute()` pipeline the same-chain path already uses
 *     (auto-calibrated gas, auto-resolved `capsKeyPub`) — just swapping the
 *     pact code to `C_TransferAcross` and adding the target-chain argument +
 *     receiver keyset, which every crosschain call needs (a receiver may not
 *     exist on the TARGET chain yet even if it exists elsewhere).
 *   - Any other source chain: gas paid by `stoa-xchain-gas` (the CURRENT
 *     real account name — `kadena-xchain-gas` is stale, confirmed live in
 *     `ouronet-core`'s own source/changelog, and survives only in
 *     OuronetUI's own doc comments/UI copy for this same code path). This
 *     account's own on-chain guard hard-caps `gasLimit <= 850` —
 *     `buildCTransferAcross` itself already enforces this; this file never
 *     overrides it. No gas signer at all (unsigned `senderAccount`); the
 *     sender's own keypair — resolved via `useGetKeypair()` at confirm-time
 *     only, mirroring `StakeUrStoaModal.tsx`'s own pattern — signs via
 *     `CodexSigningStrategy.sign()` (the low-level, resolver/client-agnostic
 *     primitive), then `submitCrossChainTransfer` submits it directly,
 *     bypassing `execute()` entirely (that pipeline always injects a
 *     gas-station capsKeyPub — there is no "no gas signer" mode in it).
 *
 * Either crosschain path then awaits the initiate step's confirmation
 * (`awaitTxVerdict`), polls (`pollSpvProof`) for the SPV proof, and
 * auto-submits the continuation (`buildContinuationTransaction` +
 * `submitContinuation` — UNSIGNED, "can be executed by anyone" per that
 * function's own doc comment) — the user never manually completes a second
 * step, matching OuronetUI's own UX exactly.
 *
 * THAT THREE-STEP CHAIN NO LONGER LIVES IN THIS FILE. It was lifted whole
 * into `../../zbom/execute/crossChainStoaTransfer.ts`
 * (`runCrossChainStoaTransfer`) because the migration engine
 * (docs/work/migration-execute/design.md §2 step A) runs it up to NINE times
 * per press to consolidate chains 1-9 onto chain 0, and a second copy of a
 * ~110-line flow whose "pending" wording is deliberately chosen to prevent
 * duplicate resubmits is the "two independently-editable copies that can
 * silently disagree" trap this package already refused once for this exact
 * flow (`../../zbom/toast/toastManager.ts:287-295`). This modal is now one of
 * its two callers: it supplies the chain-0 `execute()` initiate below (which
 * is why `buildGasStationTransaction` stays here), its toast controller's
 * `updateStep` as the step reporter, and `pollStoaChainConfirmation` as the
 * continuation tracker. The same-chain path's two Pact strings moved with it,
 * to `../../zbom/execute/nativeStoaTransfer.ts`, and are imported back.
 *
 * In-flight/success/error state machine mirrors StakeUrStoaModal /
 * RotatePaymentKeyModal for the same-chain path: a `submitting` flag, a
 * `lastError` string cleared per-attempt, and `onSuccess`+`onClose` fired
 * together on success. The crosschain path adds a `status` machine
 * (`configure → submitting → confirming → waiting-spv → completing → done |
 * error`) so a flow that can take 100+ seconds never shows a single opaque
 * spinner.
 */

import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Pact } from "@stoachain/kadena-stoic-legacy/client";
import {
  KADENA_CHAIN_ID as STOACHAIN_CHAIN_ID,
  KADENA_NETWORK as STOACHAIN_NETWORK,
} from "@stoachain/stoa-core/constants";
import {
  KADENA_NAMESPACE as STOACHAIN_NAMESPACE,
  STOA_AUTONOMIC_OURONETGASSTATION,
} from "@ouronet/ouronet-core/constants";
import { formatDecimalForPact } from "@stoachain/stoa-core/pact";
import { checkCoinAccountExists } from "@ouronet/ouronet-core/interactions/ouroPriceFunctions";
import {
  buildCTransferAcross,
  submitCrossChainTransfer,
  pollSpvProof,
  buildContinuationTransaction,
  submitContinuation,
} from "@ouronet/ouronet-core/interactions/crossChainFunctions";
import type { IKeyset } from "@stoachain/stoa-core/guard";
import { useSignTransaction, useGetKeypair } from "../../hooks/index.js";
import { CodexLockedError } from "../../errors/index.js";
import { awaitTxVerdict, awaitTxVerdictLiveDeps } from "../../zbom/execute/awaitConfirmation.js";
import {
  runCrossChainStoaTransfer,
  createSignedCrossChainInitiate,
  CROSSCHAIN_TOAST_STEPS,
  type CrossChainInitiate,
  type CrossChainStepReporter,
} from "../../zbom/execute/crossChainStoaTransfer.js";
import {
  buildNativeStoaTransferPactCode,
  deriveKAccountKeyset,
  K_ACCOUNT_RX,
  RECEIVER_NOT_AUTOCREATABLE_MESSAGE,
  SAFE_ACCOUNT_RX,
  UNSAFE_RECEIVER_MESSAGE,
} from "../../zbom/execute/nativeStoaTransfer.js";
import { txPending, createMultiStepToast, pollStoaChainConfirmation, type ToastController } from "../../zbom/toast/toastManager.js";
import { useEnsureCodexUnlocked } from "../../zbom/hooks/useEnsureCodexUnlocked.js";
import { CodexModalShell, ModalExecuteRow, ModalFeedback, modalLabel, modalInput } from "./CodexModalShell.js";
import { ChainSelector } from "./ChainSelector.js";

const AMOUNT_RX = /^\d+(\.\d+)?$/;
// `K_ACCOUNT_RX` (the only receiver shape that can be auto-created) and
// `SAFE_ACCOUNT_RX` (the Pact-string-literal injection guard — `receiverAddr`
// is free-text user input spliced directly into a code STRING LITERAL, and a
// receiver containing a `"` could break out of that literal and append
// arbitrary Pact expressions authorized by this modal's own signer) both now
// live beside the pact-code builders they protect, in
// `../../zbom/execute/nativeStoaTransfer.ts`, so the headless engine enforces
// the SAME two rules rather than a second transcription of them. Gating on
// `SAFE_ACCOUNT_RX` BEFORE any pact-code interpolation (and before the
// existence check, which also interpolates the receiver) is unchanged.

function validateAmount(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!AMOUNT_RX.test(trimmed)) return "Enter a valid positive amount (digits and an optional decimal point).";
  if (parseFloat(trimmed) <= 0) return "Amount must be greater than 0.";
  return null;
}

export interface SendStoaModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Sender's public key — added as an unscoped guard signer so it can
   *  authorize both its own keyset AND the coin.TRANSFER capability. */
  publicKey: string;
  /** Sender's native Stoa (Kadena) address, e.g. `k:<publicKey>`. */
  address: string;
  /** Per-chain balance map, keyed by chain id string (e.g. `"0"`, `"3"`) —
   *  NOT an aggregate across all 10 Stoa chains. Native Stoa is a braided
   *  multi-chain coin; a balance on chain 3 doesn't fund a send that runs on
   *  chain 0, and this modal now lets the user PICK the source chain via
   *  `<ChainSelector>` — so the displayed balance must be looked up by
   *  whichever chain is currently selected, not fixed to one chain at mount.
   *  A missing entry for the selected chain renders as "—" (unknown), never
   *  a stale/misleading 0. The caller (StoaAccountsTab) already has this
   *  whole map from useStoaChainBalances's own `perChain` — no extra read
   *  here. */
  senderBalanceByChain?: Record<string, { balance: number; exists: boolean }>;
  onSuccess?: (requestKey: string) => void;
  /**
   * MOBILE ONLY — a DOM node spanning the host's WHOLE mobile body, via
   * `createPortal` — round 10 owner correction: "the buttons, stake unstake
   * collect transfer, must expand on the full screen, and once executed,
   * they get out of the full screen." Mirrors `TransferUrStoaModal.tsx`'s
   * identical fix. Omitted (the default) falls back to the bounded-to-
   * this-component behavior every `CodexModalShell` caller has without it.
   */
  fullScreenPortalTarget?: Element | null;
}

const fmt12 = (n: number): string => n.toFixed(12);

/** Portals `children` into `target` when supplied, renders inline
 *  otherwise — duplicated per this package's own "self-contained module"
 *  convention (see `SeedWordsTab.tsx`). */
function MobilePortal({ target, children }: { target?: Element | null; children: React.ReactNode }) {
  return target ? createPortal(children, target) : <>{children}</>;
}

/**
 * Shared scaffold for the two `execute()`-driven builders (same-chain, and
 * chain-0 cross-chain) — both need a gas-station capability signer plus a
 * signer per guard pubkey (the sender, in every real call site today), on
 * top of whatever pact code/chainId/keyset-data the caller supplies.
 * Factored out so the two callers can't drift on the signer wiring, which
 * is the security-relevant part.
 *
 * Live bug fix: `guardPubs` used to be added as BARE signers — no `clist` at
 * all — on the theory (this file's own earlier module doc comment,
 * corrected alongside this fix) that an unscoped guard signer "authorizes
 * ANY capability requested for that key during execution." That is true for
 * a plain `enforce-guard` check, but Pact only pre-installs a `@managed`
 * capability (like `coin.TRANSFER`/`coin.TRANSFER_XCHAIN`, both `coin-live.
 * pact`'s own real capabilities — confirmed reading the deployed contract
 * directly, not guessed) when SOME signer's `clist` explicitly declares it
 * with matching arguments. Omitting it here is exactly what produced the
 * live-reported "Managed capability coin.TRANSFER was not installed" —
 * confirmed by diffing against OuronetUI's own working
 * `transfer-token.tsx`, which DOES attach `coin.TRANSFER` to the sender's
 * own signer. `guardCapabilities` is REQUIRED (not optional) specifically so
 * a third caller of this helper can't reintroduce the same silent gap by
 * forgetting to pass it.
 */
function buildGasStationTransaction(
  { gasLimit, capsKeyPub, guardPubs, gasPrice, creationTime }: {
    gasLimit: number;
    capsKeyPub: string;
    guardPubs: string[];
    gasPrice: number;
    creationTime: number;
  },
  opts: {
    pactCode: string;
    chainId: string;
    keysetData?: IKeyset;
    /** Builds the capability list EVERY guard signer declares — the same
     *  `(withCapability, ...) => [...]` shape `addSigner` already takes
     *  elsewhere in this package (e.g. `SendKadenaModal.tsx`'s own
     *  `coin.TRANSFER`/`coin.TRANSFER_XCHAIN` calls) — not a per-pubkey map,
     *  since every real call site's `guardPubs` is exactly one entry (the
     *  sender) today; a future caller with a genuinely different guard set
     *  would need to extend this, not silently reuse the wrong capability. */
    guardCapabilities: (withCapability: any) => unknown[];
  },
) {
  let builder = Pact.builder
    .execution(opts.pactCode)
    .setMeta({
      senderAccount: STOA_AUTONOMIC_OURONETGASSTATION,
      creationTime,
      chainId: opts.chainId,
      gasLimit,
      gasPrice,
    })
    .setNetworkId(STOACHAIN_NETWORK);
  if (opts.keysetData) {
    builder = (builder as any).addData("ks", opts.keysetData);
  }
  builder = builder.addSigner(capsKeyPub, (w: any) => [
    w(`${STOACHAIN_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
  ]);
  for (const pub of guardPubs) {
    builder = (builder as any).addSigner(pub, opts.guardCapabilities);
  }
  return (builder as any).createTransaction();
}

type CrossChainStatus =
  | "configure"
  | "submitting"
  | "confirming"
  | "waiting-spv"
  | "completing"
  | "done"
  | "error";

const CROSSCHAIN_STATUS_LABEL: Record<CrossChainStatus, string | null> = {
  configure: null,
  submitting: "Submitting the cross-chain transfer…",
  confirming: "Confirming on the source chain…",
  "waiting-spv": "Waiting for the SPV proof (this can take 100+ seconds)…",
  completing: "Completing the transfer on the target chain…",
  done: null,
  error: null,
};

/**
 * Live UX report: a cross-chain send genuinely takes 100+ seconds for
 * initiate confirmation, then another ~100-150s for the SPV proof, then a
 * continuation submit — several minutes end to end (confirmed against a
 * real send that DID land, just slowly). The ONLY progress indicator during
 * that whole window used to be `CROSSCHAIN_STATUS_LABEL`'s static text
 * INSIDE the modal — which disappears the moment the modal closes, and
 * which a user who looks away from the page has no way to check on. The
 * toast (`_tx`) existed, but only ever appeared at the very END of the
 * whole flow (`.submitted()`, right before `onClose()`) or on a hard
 * failure — during the two long waits there was NO toast at all, which is
 * indistinguishable from "nothing is happening" to anyone not staring at
 * the modal the whole time.
 *
 * Fix: the crosschain path uses `createMultiStepToast` directly (not the
 * single-step `txPending` convenience wrapper every other modal in this
 * package uses) with a REAL 3-step `steps` array, driven at each of the
 * flow's actual stage transitions — MultiStepToastContainer.tsx already
 * renders a numbered "Step i" row per entry once `steps.length > 1`; this
 * is simply the first crosschain flow in this package to actually supply
 * more than one.
 *
 * The three labels themselves moved to `crossChainStoaTransfer.ts` with the
 * flow that drives them — the migration engine's own toast names these same
 * three stages, and they are the flow's vocabulary, not this modal's.
 */

export function SendStoaModal({
  isOpen,
  onClose,
  publicKey,
  address,
  senderBalanceByChain,
  onSuccess,
  fullScreenPortalTarget,
}: SendStoaModalProps): React.JSX.Element | null {
  const { execute, sign } = useSignTransaction();
  const getKeypair = useGetKeypair();
  const ensureCodexUnlocked = useEnsureCodexUnlocked();

  const [sourceChain, setSourceChain] = useState(STOACHAIN_CHAIN_ID);
  const [targetChain, setTargetChain] = useState(STOACHAIN_CHAIN_ID);
  const [receiver, setReceiver] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [crossChainStatus, setCrossChainStatus] = useState<CrossChainStatus>("configure");

  useEffect(() => {
    if (isOpen) {
      setSourceChain(STOACHAIN_CHAIN_ID);
      setTargetChain(STOACHAIN_CHAIN_ID);
      setReceiver("");
      setAmount("");
      setSubmitting(false);
      setLastError(null);
      setCrossChainStatus("configure");
    }
  }, [isOpen]);

  const isCrossChain = sourceChain !== targetChain;
  const senderChainBalance = senderBalanceByChain?.[sourceChain]?.balance;

  const validationMessage = validateAmount(amount);
  const canSubmit =
    !submitting &&
    receiver.trim().length > 5 &&
    amount.trim() !== "" &&
    validationMessage === null &&
    // Cross-chain currently only supports k: receivers (see handleSubmit) —
    // catch that here too so an invalid receiver never even reaches the
    // unlock prompt / pending toast before being rejected.
    (!isCrossChain || K_ACCOUNT_RX.test(receiver.trim()));

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setLastError(null);
    setCrossChainStatus(isCrossChain ? "submitting" : "configure");
    // Pop the REAL password prompt here, BEFORE touching sendFrom/execute at
    // all, if the codex is locked — a cancelled prompt just stops quietly (no
    // toast, no error): declining to unlock isn't a failure.
    const unlocked = await ensureCodexUnlocked();
    if (!unlocked) {
      setSubmitting(false);
      return;
    }
    // Crosschain gets a REAL multi-step toast (see CROSSCHAIN_TOAST_STEPS's
    // own doc comment) — same-chain keeps the single-step `txPending`
    // convenience wrapper every other modal in this package already uses,
    // since a same-chain send is fast enough that a single "Confirming…"
    // step has never been a visibility problem.
    const _tx = isCrossChain
      ? createMultiStepToast({ title: "Send Stoa (cross-chain)", steps: [...CROSSCHAIN_TOAST_STEPS], chain: "stoachain" })
      : txPending("Send Stoa");
    // Tracks which crosschain step is currently active, so a failure at ANY
    // point (including the shared catch block below, which has no other way
    // to know which stage was in flight) marks the RIGHT step red instead of
    // always step 0.
    let activeCrossChainStep = 0;
    function reportFailure(message: string) {
      if (isCrossChain) {
        (_tx as ToastController).updateStep(activeCrossChainStep, "error", { label: message });
      } else {
        (_tx as ReturnType<typeof txPending>).fail(message);
      }
    }
    try {
      const receiverAddr = receiver.trim();
      if (!SAFE_ACCOUNT_RX.test(receiverAddr)) {
        const message = UNSAFE_RECEIVER_MESSAGE;
        setLastError(message);
        if (isCrossChain) setCrossChainStatus("error");
        reportFailure(message);
        return;
      }
      const isKAccount = K_ACCOUNT_RX.test(receiverAddr);
      const decimalStr = formatDecimalForPact(amount.trim());

      if (isCrossChain) {
        // The whole 3-step chain — initiate, confirm, SPV proof, continuation
        // — now lives in `runCrossChainStoaTransfer`; see this file's module
        // doc comment for why it was lifted. What stays HERE is the half that
        // is genuinely this modal's: the chain-0 `execute()` initiate, the
        // toast controller, and the user-facing status machine.
        //
        // `submitInitiate` is the seam between the two signing paths that
        // `buildCTransferAcross` itself distinguishes. Source chain "0" pays
        // gas through the Ouronet Gas Station and is built INLINE via the SAME
        // `execute()` pipeline the same-chain path uses (auto-calibrated gas,
        // auto-resolved `capsKeyPub`). Any other source chain pays through
        // `stoa-xchain-gas` (no gas signer at all) and signs+submits directly
        // — which is also the ONLY path the migration engine ever takes, so it
        // is the module's own ready-made factory rather than a local closure.
        const submitInitiate: CrossChainInitiate =
          sourceChain === "0"
            ? async ({ sender, receiver: receiverAccount, receiverGuard, amount: decimalAmount, targetChain: target }) => {
                const result = await execute({
                  build: ({ gasLimit, capsKeyPub, guardPubs, gasPrice, creationTime }) =>
                    buildGasStationTransaction(
                      { gasLimit, capsKeyPub, guardPubs, gasPrice, creationTime },
                      {
                        pactCode: `(coin.C_TransferAcross "${sender}" "${receiverAccount}" (read-keyset "ks") "${target}" ${decimalAmount})`,
                        chainId: sourceChain,
                        keysetData: receiverGuard,
                        // (coin.TRANSFER_XCHAIN sender receiver amount target-chain)
                        // — confirmed live, coin-live.pact's own `defcap
                        // TRANSFER_XCHAIN`; note the arg ORDER (amount BEFORE
                        // target-chain) differs from C_TransferAcross's own
                        // function signature (target-chain before amount) —
                        // this mirrors SendKadenaModal.tsx's own identical
                        // `coin.TRANSFER_XCHAIN` capability call exactly (same
                        // arg order, same {decimal} wrapping), the two chains'
                        // crosschain protocols sharing the same capability
                        // shape.
                        guardCapabilities: (w: any) => [
                          w("coin.TRANSFER_XCHAIN", sender, receiverAccount, { decimal: decimalAmount }, target),
                        ],
                      },
                    ),
                  guards: [{ keys: [publicKey], pred: "keys-all" }],
                  paymentKey: null,
                });
                return { requestKey: result.requestKey };
              }
            : createSignedCrossChainInitiate({
                senderPublicKey: publicKey,
                getKeypair,
                sign,
                buildCTransferAcross,
                submitCrossChainTransfer,
              });

        // The flow reports its own step transitions; this adapter is where
        // they become BOTH a toast row and the on-screen status text, and
        // where `activeCrossChainStep` keeps tracking which stage is in
        // flight so the shared catch block below still marks the right step
        // red (a THROWN error — a refused submit, a locked codex — is not a
        // flow outcome and still arrives there).
        const onStep: CrossChainStepReporter = (stepIdx, status, data) => {
          if (status === "done") activeCrossChainStep = stepIdx + 1;
          if (stepIdx === 0 && status === "active") setCrossChainStatus("confirming");
          if (stepIdx === 0 && status === "done") setCrossChainStatus("waiting-spv");
          if (stepIdx === 1 && status === "done") setCrossChainStatus("completing");
          // Third argument omitted when there is none — `updateStep(1, "done")`
          // and `updateStep(1, "done", undefined)` are the same call at
          // runtime but not to a caller comparing argument lists.
          if (data === undefined) (_tx as ToastController).updateStep(stepIdx, status);
          else (_tx as ToastController).updateStep(stepIdx, status, data);
        };

        const outcome = await runCrossChainStoaTransfer(
          { sender: address, receiver: receiverAddr, amount: decimalStr, sourceChain, targetChain },
          {
            submitInitiate,
            awaitInitiateVerdict: (requestKey, chainId) =>
              awaitTxVerdict(requestKey, chainId, awaitTxVerdictLiveDeps),
            pollSpvProof,
            buildContinuationTransaction,
            submitContinuation,
            onStep,
            // The continuation is what ACTUALLY lands the funds on the target
            // chain — `submitContinuation` only confirms mempool acceptance
            // (see its own doc comment), so step 2 is deliberately NOT marked
            // done by the flow. Its real on-chain confirmation keeps polling
            // in the background after this modal closes, using the SAME
            // shared poller `.submitted()` itself calls for a single-step
            // toast (`pollStoaChainConfirmation`, `toastManager.ts` — no
            // second, independently-editable copy of this fetch/retry/timeout
            // logic). Fire-and-forget, matching `.submitted()`'s own original
            // behavior.
            onContinuationSubmitted: (stepIdx, continuationRequestKey, chainId) => {
              void pollStoaChainConfirmation(_tx as ToastController, stepIdx, continuationRequestKey, chainId);
            },
          },
        );

        if (!outcome.ok) {
          // The flow has already marked the failing step red with this same
          // message — `reportFailure` here would be a second, duplicate
          // report. All four `kind`s are user-visible text, including the
          // deliberately non-alarming "still confirming" wording for an
          // initiate that may yet land.
          setLastError(outcome.message);
          setCrossChainStatus("error");
          return;
        }

        setCrossChainStatus("done");
        onSuccess?.(outcome.requestKey);
        onClose();
        return;
      }

      // Same-chain path — same shape as before this modal grew a chain
      // selector; the receiver-charset validation above and the shared
      // `buildGasStationTransaction` helper below are the only changes.
      const exists = await checkCoinAccountExists(receiverAddr);
      if (exists === null) {
        const message = "Could not verify the receiver account — try again.";
        setLastError(message);
        reportFailure(message);
        return;
      }
      if (!exists && !isKAccount) {
        const message = RECEIVER_NOT_AUTOCREATABLE_MESSAGE;
        setLastError(message);
        reportFailure(message);
        return;
      }

      const isNew = !exists;
      // The two Pact strings now live with the headless drain that shares
      // them (`../../zbom/execute/nativeStoaTransfer.ts`) — ONE copy, so the
      // engine cannot emit a subtly different transfer than this modal does.
      const pactCode = buildNativeStoaTransferPactCode({
        sender: address,
        receiver: receiverAddr,
        amount: decimalStr,
        receiverExists: exists,
      });

      const guard: IKeyset = { keys: [publicKey], pred: "keys-all" };
      // Receiver's keyset is derived from its own k: address pubkey —
      // required for the on-chain (read-keyset "ks") in C_TransferAnew.
      const keysetData: IKeyset | undefined = isNew ? deriveKAccountKeyset(receiverAddr) : undefined;

      const { requestKey } = await execute({
        build: ({ gasLimit, capsKeyPub, guardPubs, gasPrice, creationTime }) =>
          buildGasStationTransaction(
            { gasLimit, capsKeyPub, guardPubs, gasPrice, creationTime },
            {
              pactCode,
              chainId: sourceChain,
              keysetData,
              // (coin.TRANSFER sender receiver amount) — confirmed live,
              // coin-live.pact's own `defcap TRANSFER`, the SAME capability
              // both C_Transfer and C_TransferAnew require underneath (both
              // call the base `transfer`/`transfer-create`, which both wrap
              // their body in `(with-capability (TRANSFER sender receiver
              // amount) ...)`).
              guardCapabilities: (w: any) => [w("coin.TRANSFER", address, receiverAddr, { decimal: decimalStr })],
            },
          ),
        guards: [guard],
        paymentKey: null,
      });

      // Only reachable on the SAME-CHAIN path (the crosschain branch above
      // always returns before here) — `_tx` is guaranteed to be the
      // txPending wrapper at runtime, TS just can't narrow a union on a
      // separately-tracked boolean.
      (_tx as ReturnType<typeof txPending>).submitted(requestKey, sourceChain);
      onSuccess?.(requestKey);
      onClose();
    } catch (e) {
      if (e instanceof CodexLockedError) {
        const message = "Codex is locked. Unlock your codex to sign this transaction.";
        setLastError(message);
        setCrossChainStatus("error");
        reportFailure(message);
      } else {
        const message = e instanceof Error ? e.message : String(e);
        setLastError(message);
        setCrossChainStatus("error");
        reportFailure(message);
      }
    } finally {
      setSubmitting(false);
    }
  }, [
    canSubmit, isCrossChain, sourceChain, targetChain, receiver, amount, address, publicKey,
    execute, sign, getKeypair, ensureCodexUnlocked, onSuccess, onClose,
  ]);

  if (!isOpen) return null;

  const statusMessage = CROSSCHAIN_STATUS_LABEL[crossChainStatus];

  return (
    <MobilePortal target={fullScreenPortalTarget}>
      <CodexModalShell
        title="Send STOA"
        subtitle={isCrossChain ? "coin.C_TransferAcross" : "coin.C_Transfer / coin.C_TransferAnew"}
        onClose={onClose}
        footer={<ModalExecuteRow onCancel={onClose} onSubmit={handleSubmit} submitting={submitting} canSubmit={canSubmit} label="Send STOA" />}
      >
        <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
          {/* Source and target are allowed to collide on purpose — a
              same-chain transfer (coin.C_Transfer/coin.C_TransferAnew) is
              just as valid as a cross-chain one (coin.C_TransferAcross), so
              neither selector excludes the other's current value. Earlier
              versions mutually excluded them (mirroring OuronetUI's
              cross-chain-ONLY picker, where a collision made no sense) —
              once same-chain support was added, that exclusion silently
              made same-chain unreachable for any non-default source chain,
              since the target could never be clicked back onto it. */}
          <ChainSelector
            label="Source Chain"
            value={sourceChain}
            onChange={setSourceChain}
          />
          <ChainSelector
            label="Target Chain"
            value={targetChain}
            onChange={setTargetChain}
          />
        </div>

        <div style={{ fontSize: 12, color: "#888", margin: "0 0 12px", padding: "10px 12px", borderRadius: 8, border: "1px solid #1a1a1a", backgroundColor: "#0a0a0a" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
            <span>Sending on <strong style={{ color: "#ceac5f" }}>StoaChain — Chain {sourceChain}</strong></span>
            <span>
              Balance: <strong style={{ color: "#d2d3d4", fontFamily: "var(--codex-font-mono, ui-monospace, monospace)" }}>
                {senderChainBalance === undefined ? "—" : `${fmt12(senderChainBalance)} STOA`}
              </strong>
            </span>
          </div>
          <div style={{ marginTop: 6, overflowWrap: "anywhere" }}>
            From <code style={{ wordBreak: "break-all" }}>{address}</code>{" "}
            {isCrossChain
              ? <>to a receiver on <strong style={{ color: "#ceac5f" }}>Chain {targetChain}</strong> — a cross-chain transfer (coin.C_TransferAcross), completed automatically in two on-chain steps.</>
              : <>to a receiver on the same chain (Chain {sourceChain}) — native Stoa transfers don't cross chains unless you pick a different target above.</>}
          </div>
          <div style={{ marginTop: 6, color: "#666" }}>
            {isCrossChain && sourceChain !== "0"
              ? "Gas on both chains is paid by StoaChain's own stoa-xchain-gas account."
              : "Gas is paid by the Ouronet Gas Station."}
          </div>
        </div>
        <label style={modalLabel} htmlFor="send-stoa-receiver">Receiver address</label>
        <input
          id="send-stoa-receiver"
          type="text"
          value={receiver}
          onChange={(e) => setReceiver(e.target.value)}
          placeholder="k:, c:, u:, w:, or custom account"
          autoComplete="off"
          style={modalInput}
        />
        <label style={{ ...modalLabel, marginTop: 12 }} htmlFor="send-stoa-amount">Amount</label>
        <input
          id="send-stoa-amount"
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.000000000000"
          autoComplete="off"
          aria-invalid={validationMessage ? "true" : undefined}
          style={modalInput}
        />
        {validationMessage && <p role="alert" style={{ marginTop: 8, fontSize: 12, color: "#f87171" }}>{validationMessage}</p>}
        {statusMessage && (
          <div style={{ marginTop: 8, fontSize: 12, color: "#ceac5f" }}>{statusMessage}</div>
        )}
        <ModalFeedback error={lastError} requestKey={null} />
      </CodexModalShell>
    </MobilePortal>
  );
}

export default SendStoaModal;
