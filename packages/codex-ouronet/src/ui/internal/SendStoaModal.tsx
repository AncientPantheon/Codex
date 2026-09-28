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
 * Either crosschain path then auto-polls (`pollTransactionStatus`) for the
 * initiate step's confirmation, auto-polls (`pollSpvProof`) for the SPV
 * proof, and auto-submits the continuation (`buildContinuationTransaction` +
 * `submitContinuation` — UNSIGNED, "can be executed by anyone" per that
 * function's own doc comment) — the user never manually completes a second
 * step, matching OuronetUI's own UX exactly.
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
  pollTransactionStatus,
  pollSpvProof,
  buildContinuationTransaction,
  submitContinuation,
  type TransferStatus,
} from "@ouronet/ouronet-core/interactions/crossChainFunctions";
import type { IKeyset } from "@stoachain/stoa-core/guard";
import { useSignTransaction, useGetKeypair } from "../../hooks/index.js";
import { CodexLockedError } from "../../errors/index.js";
import { txPending, createMultiStepToast, pollStoaChainConfirmation, type ToastController } from "../../zbom/toast/toastManager.js";
import { useEnsureCodexUnlocked } from "../../zbom/hooks/useEnsureCodexUnlocked.js";
import { CodexModalShell, ModalExecuteRow, ModalFeedback, modalLabel, modalInput } from "./CodexModalShell.js";
import { ChainSelector } from "./ChainSelector.js";

const AMOUNT_RX = /^\d+(\.\d+)?$/;
const K_ACCOUNT_RX = /^k:[0-9a-fA-F]{64}$/;
/** Every real Pact/Chainweb account name is drawn from this charset (see
 *  `coin-live.pact`'s own `validate-account` regex, `^[a-zA-Z0-9_:-]{3,}$`,
 *  slightly widened here to also allow `.` for namespaced `c:`/`w:`-style
 *  accounts). `receiverAddr` is free-text user input that gets spliced
 *  directly into a Pact code STRING LITERAL below — a receiver containing a
 *  `"` could otherwise break out of that literal and append arbitrary Pact
 *  expressions, authorized by this same modal's own unscoped guard signer.
 *  Gating on this BEFORE any pact-code interpolation (and before the
 *  existence check, which also interpolates it) closes that off entirely. */
const SAFE_ACCOUNT_RX = /^[A-Za-z0-9_:.-]+$/;

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

/** Repeatedly checks the initiate step's own confirmation status — a single
 *  `pollTransactionStatus` call is a snapshot, not a wait; this bounds the
 *  retry the same way every other multi-step chain flow in this package
 *  waits for confirmation before moving on. 20 attempts / 5s = ~100s budget
 *  — same order of magnitude as `pollSpvProof`'s own default (30 × 5s), since
 *  an initiate step is a real on-chain confirmation with the same variance,
 *  not a fixed-latency call. Exhausting the budget returns `"pending"` —
 *  distinct from `"failure"` — so the caller never reports a merely-slow
 *  confirmation as a hard failure (which would invite a duplicate resubmit
 *  of a transfer that may still land). */
async function waitForInitiateConfirmation(
  requestKey: string,
  chainId: string,
  maxAttempts = 20,
  delayMs = 5000,
): Promise<TransferStatus> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await pollTransactionStatus(requestKey, chainId);
    if (status.status === "success" || status.status === "failure") return status;
    if (attempt < maxAttempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return { status: "pending" };
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
 */
const CROSSCHAIN_TOAST_STEPS = [
  { label: "Confirming on source chain" },
  { label: "Waiting for cross-chain proof" },
  { label: "Completing on target chain" },
] as const;

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
        const message = "Receiver address contains characters that aren't allowed in an account name.";
        setLastError(message);
        if (isCrossChain) setCrossChainStatus("error");
        reportFailure(message);
        return;
      }
      const isKAccount = K_ACCOUNT_RX.test(receiverAddr);
      const decimalStr = formatDecimalForPact(amount.trim());

      if (isCrossChain) {
        // Every crosschain call needs a receiver keyset regardless of
        // whether the receiver exists elsewhere — the account may not exist
        // on THIS target chain yet (chain accounts are independent).
        if (!isKAccount) {
          const message = "Cross-chain transfers currently support k: receivers only.";
          setLastError(message);
          setCrossChainStatus("error");
          reportFailure(message);
          return;
        }
        const receiverGuard: IKeyset = { keys: [receiverAddr.slice(2)], pred: "keys-all" };

        let requestKey: string;
        if (sourceChain === "0") {
          const result = await execute({
            build: ({ gasLimit, capsKeyPub, guardPubs, gasPrice, creationTime }) =>
              buildGasStationTransaction(
                { gasLimit, capsKeyPub, guardPubs, gasPrice, creationTime },
                {
                  pactCode: `(coin.C_TransferAcross "${address}" "${receiverAddr}" (read-keyset "ks") "${targetChain}" ${decimalStr})`,
                  chainId: sourceChain,
                  keysetData: receiverGuard,
                  // (coin.TRANSFER_XCHAIN sender receiver amount target-chain)
                  // — confirmed live, coin-live.pact's own `defcap
                  // TRANSFER_XCHAIN`; note the arg ORDER (amount BEFORE
                  // target-chain) differs from C_TransferAcross's own
                  // function signature (target-chain before amount) — this
                  // mirrors SendKadenaModal.tsx's own identical
                  // `coin.TRANSFER_XCHAIN` capability call exactly (same
                  // arg order, same {decimal} wrapping), the two chains'
                  // crosschain protocols sharing the same capability shape.
                  guardCapabilities: (w: any) => [
                    w("coin.TRANSFER_XCHAIN", address, receiverAddr, { decimal: decimalStr }, targetChain),
                  ],
                },
              ),
            guards: [{ keys: [publicKey], pred: "keys-all" }],
            paymentKey: null,
          });
          requestKey = result.requestKey;
        } else {
          const unsignedTx = buildCTransferAcross({
            sender: address,
            receiver: receiverAddr,
            receiverGuard,
            amount: decimalStr,
            sourceChain,
            targetChain,
            senderPublicKey: publicKey,
          });
          const keypair = await getKeypair(publicKey);
          const signedTx = await sign({ tx: unsignedTx, capsKey: keypair, guardKeypairs: [] });
          const descriptor = await submitCrossChainTransfer(signedTx, sourceChain);
          requestKey = descriptor.requestKey;
        }
        // Step 0 was already showing (created "active" by default) — this
        // just attaches the real requestKey to it now that one exists, so a
        // user who opens the toast mid-flow can already see/copy it instead
        // of waiting for the whole flow to finish.
        (_tx as ToastController).updateStep(0, "active", { requestKey });

        setCrossChainStatus("confirming");
        const initiateStatus = await waitForInitiateConfirmation(requestKey, sourceChain);
        if (initiateStatus.status !== "success") {
          // "pending" (budget exhausted, no failure reported) is NOT the
          // same as "failure" — a slow-but-still-landing initiate step must
          // never be worded so a user thinks it's safe to resubmit. Only a
          // real reported `"failure"` gets the harder framing.
          const message =
            initiateStatus.status === "pending"
              ? `The transfer is still confirming on chain ${sourceChain} (request key ${requestKey}). It may still complete — check its status before resubmitting.`
              : (initiateStatus.error ?? "The cross-chain transfer's initiate step did not confirm.");
          setLastError(message);
          setCrossChainStatus("error");
          reportFailure(message);
          return;
        }
        // Step 0 done — `updateStep`'s own auto-activate-next-pending logic
        // (toastManager.ts) flips step 1 to "active" for free.
        (_tx as ToastController).updateStep(0, "done", { requestKey });
        activeCrossChainStep = 1;

        setCrossChainStatus("waiting-spv");
        const { proof, error: spvError } = await pollSpvProof(requestKey, sourceChain, targetChain);
        if (!proof) {
          const message = spvError ?? "Timed out waiting for the SPV proof.";
          setLastError(message);
          setCrossChainStatus("error");
          reportFailure(message);
          return;
        }
        (_tx as ToastController).updateStep(1, "done");
        activeCrossChainStep = 2;

        setCrossChainStatus("completing");
        const contTx = buildContinuationTransaction(requestKey, proof, targetChain);
        const contDescriptor = await submitContinuation(contTx, targetChain);

        setCrossChainStatus("done");
        // The continuation is what ACTUALLY lands the funds on the target
        // chain — `submitContinuation` only confirms mempool acceptance
        // (see its own doc comment), so marking step 2 "done" here would be
        // exactly as premature as the OLD single-step toast's own
        // `.submitted()` call was for the whole flow. Deliberately NOT
        // awaited (fire-and-forget, matching `.submitted()`'s own original
        // behavior) — the continuation's own on-chain confirmation keeps
        // polling in the background after this modal closes, using the SAME
        // shared poller `.submitted()` itself calls for a single-step toast
        // (`pollStoaChainConfirmation`, `toastManager.ts` — no second,
        // independently-editable copy of this fetch/retry/timeout logic).
        void pollStoaChainConfirmation(_tx as ToastController, 2, contDescriptor.requestKey, targetChain);
        onSuccess?.(requestKey);
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
        const message = "Receiver account not found — only k: accounts can be auto-created.";
        setLastError(message);
        reportFailure(message);
        return;
      }

      const isNew = !exists;
      const pactCode = isNew
        ? `(coin.C_TransferAnew "${address}" "${receiverAddr}" (read-keyset "ks") ${decimalStr})`
        : `(coin.C_Transfer "${address}" "${receiverAddr}" ${decimalStr})`;

      const guard: IKeyset = { keys: [publicKey], pred: "keys-all" };
      // Receiver's keyset is derived from its own k: address pubkey —
      // required for the on-chain (read-keyset "ks") in C_TransferAnew.
      const keysetData: IKeyset | undefined = isNew
        ? { keys: [receiverAddr.slice(2)], pred: "keys-all" }
        : undefined;

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
