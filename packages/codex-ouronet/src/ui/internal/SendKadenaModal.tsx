/**
 * <SendKadenaModal> — send against REAL Kadena mainnet, same-chain OR
 * cross-chain.
 *
 * SAME-CHAIN (source chain === target chain, the default and still the
 * common case): `coin.transfer` / `coin.transfer-create` (KIP-0002
 * lowercase-kebab names, confirmed live in `coin-v6.pact:329,356`) —
 * UNCHANGED from before this modal grew a chain-pair selector.
 *
 * CROSS-CHAIN (source chain !== target chain): `coin.transfer-crosschain` —
 * confirmed live, a genuine 2-step `defpact` (`coin-v6.pact:528-586`): step 0
 * debits the sender and yields `{receiver, receiver-guard, amount,
 * source-chain}` on the source chain; step 1 is a bare `(resume ...)` that
 * credits the receiver on the target chain, gated by an SPV proof of step 0's
 * inclusion.
 *
 * **LOAD-BEARING DISCOVERY (this topic's own research):**
 * `@ouronet/ouronet-core/interactions/crossChainFunctions` — the package
 * topic 1 (`stoachain-crosschain-transfer`) imported directly for StoaChain's
 * own crosschain mechanics — is NOT usable here. Every function in it
 * (`pollTransactionStatus`, `fetchSpvProof`, `buildCrossChainTransfer`,
 * `buildContinuationTransaction`, `submitContinuation`, ...) hardcodes
 * `networkId: KADENA_NETWORK`, and `KADENA_NETWORK` is itself re-exported
 * straight from `@stoachain/stoa-core/constants` — confirmed reading that
 * file's own import line. It means `"stoa"`, not `"mainnet01"`. The exact
 * same stale-name trap this project already hit twice (`KADENA_CHAIN_ID`,
 * `KADENA_CHAINS`). `buildContinuationTransaction` additionally hardcodes
 * `gasLimit: 850` (StoaChain's `stoa-xchain-gas` account's own on-chain cap
 * — meaningless here) and spreads `stoaGasMeta`'s own output (StoaChain's own rising
 * price floor — wrong for this file's fixed `KADENA_GAS_PRICE`). None of
 * that package is imported below; this file reimplements the crosschain
 * mechanics from scratch against Kadena's own client, mirroring exactly why
 * `kadenaReads.ts` reimplements reads instead of reusing `stoa-core`'s
 * `pactRead` — same trap, same fix.
 *
 * What Kadena's OWN client (`createClient(...)`, already used by this file's
 * same-chain path and by `kadenaReads.ts`) gives for free instead: `pollOne`
 * (blocks until a tx resolves or `options.timeout` elapses — the initiate
 * step's own confirmation wait) and `pollCreateSpv` (blocks until the SPV
 * proof is available or `options.timeout` elapses — the SPV-proof wait). No
 * hand-rolled retry loop needed for either.
 *
 * CAPABILITIES: the initiate step signs `coin.GAS` (no args, self-funded —
 * same as the same-chain path) + `coin.TRANSFER_XCHAIN` (`sender receiver
 * amount target-chain` — confirmed live, `coin-v6.pact:97-108`; note this is
 * NOT the same arg list as the function call itself, which additionally
 * takes `receiver-guard`). The continuation's own `resume` body needs no
 * signer-facing capability at all (an internal, unmanaged `CREDIT`) — but
 * unlike StoaChain's `stoa-xchain-gas` (a purpose-built, signature-less
 * gas-sponsor account — confirmed via `crossChainFunctions.ts`'s own doc
 * comment), the account submitting a Kadena continuation still pays REAL gas
 * and, if it's a normal keyset-guarded account, DOES need a real signature —
 * so unlike topic 1's never-signed StoaChain continuation, this file signs
 * its own continuation via the same `sign()` primitive (reusing the
 * already-resolved keypair from the initiate step).
 *
 * SELF-FUNDED, BOTH LEGS: the sender's own key pays gas on the SOURCE chain
 * for the initiate step and on the TARGET chain for the continuation, using
 * whatever KDA balance they already hold there — no shared gas station
 * anywhere in this file, matching the same-chain path.
 *
 * PENDING / UNCLAIMED: if the sender has no gas on the target chain, the
 * continuation's own simulation fails with an on-chain "insufficient
 * funds"/"balance" refusal (categorized via the SAME `createSimulationError`
 * helper already used elsewhere in this file, checked via its own
 * `error.code === "INSUFFICIENT_FUNDS"`). This is explicitly NOT a hard
 * failure — the initiate step already succeeded and the receiver's funds are
 * provably committed on-chain (yielded); only the *claim* is outstanding. The
 * modal surfaces a distinct "pending / unclaimed" state naming the target
 * chain and the pact id (== the initiate step's own `requestKey` — a
 * defpact's `pactId` is its originating transaction's hash) needed to
 * complete it later, and does NOT force-close the modal (the user can read
 * and copy that information first).
 */

import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Pact, createClient } from "@stoachain/kadena-stoic-legacy/client";
import { calculateAutoGasLimit } from "@stoachain/stoa-core/gas";
import { safeCreationTime, formatDecimalForPact } from "@stoachain/stoa-core/pact";
import { createSimulationError, logDetailedError } from "@stoachain/stoa-core/errors";
import type { IKeyset } from "@stoachain/stoa-core/guard";
import {
  KADENA_MAINNET_NETWORK_ID,
  KADENA_MAINNET_DEFAULT_CHAIN_ID,
  KADENA_CHAIN_COUNT,
  KADENA_DIRECT_NODE_URL,
  getActiveKadenaNodeUrl,
  kadenaPactUrl,
  withKadenaTimeout,
} from "../../kadena/kadenaReads.js";
// Live bug fix: the receiver-existence check now goes through the ACTIVE
// Kadena balance source (REST by default — the one confirmed to work from a
// browser) instead of always hitting the direct, documented-flaky Pact node
// — see `checkKadenaAccountExistsActive`'s own doc comment for the full
// story. Same true/false/null contract as the function it replaces.
import { checkKadenaAccountExistsActive } from "../../kadena/kadenaBalanceSource.js";
import { useSignTransaction, useGetKeypair } from "../../hooks/index.js";
import { CodexLockedError } from "../../errors/index.js";
import {
  txPending,
  createMultiStepToast,
  pollViaInjectedFn,
  type ArweavePollResult,
  type ToastController,
} from "../../zbom/toast/toastManager.js";
import { useEnsureCodexUnlocked } from "../../zbom/hooks/useEnsureCodexUnlocked.js";
import { CodexModalShell, ModalExecuteRow, ModalFeedback, modalLabel, modalInput } from "./CodexModalShell.js";
import { ChainSelector } from "./ChainSelector.js";

const AMOUNT_RX = /^\d+(\.\d+)?$/;
const K_ACCOUNT_RX = /^k:[0-9a-fA-F]{64}$/;
/** Same allowlist class as `SendStoaModal.tsx`'s own `SAFE_ACCOUNT_RX` — a
 *  receiver is free-text user input spliced directly into a Pact code string
 *  literal below; gating the charset BEFORE any interpolation or existence
 *  check closes off the same injection class that topic's own CRITICAL
 *  review finding fixed after the fact. Built in from the start here. */
const SAFE_ACCOUNT_RX = /^[A-Za-z0-9_:.-]+$/;

/** The fixed Kadena mainnet gas price floor for this project — see this
 *  file's own module doc comment for why this is a literal, not
 *  `stoaGasMeta`'s own derived StoaChain value. */
const KADENA_GAS_PRICE = 10000;

/**
 * Live bug report follow-up (revised 2026-09-28, gateway rollout): a raw
 * `fetch()` failure or a `withKadenaTimeout` timeout against whichever
 * Kadena node is currently active surfaces as an opaque, unhelpful string —
 * "Failed to fetch" in Chromium (browsers deliberately hide WHY: CORS
 * block, DNS failure, connection refused all look identical from JS), or
 * `withKadenaTimeout`'s own generic "<label> timed out after 10000ms" — and
 * critically, NEITHER names which node was actually being tried. This
 * embeds `getActiveKadenaNodeUrl()` into both cases so a live tester (or a
 * future round of this same investigation) can immediately tell whether the
 * app is even pointed at the right node, instead of re-deriving that from
 * scratch every time.
 *
 * As of the 2026-09-28 gateway rollout, `KADENA_MAINNET_DEFAULT_NODE_URL`
 * is `https://denascan.ancientholdings.eu` — HTTPS, confirmed live (see
 * `kadenaReads.ts`'s own doc comment on that constant) — so a mixed-content
 * block is no longer the LIKELY cause the way it was against the old
 * plain-HTTP direct-node default; a persistent failure now more likely
 * means either a stale/overridden Network-tab URL (e.g. a browser that
 * still has the OLD direct-node default, `KADENA_DIRECT_NODE_URL`,
 * persisted from before this round — check the Network tab's Kadena row
 * against the URL this message names), or a genuine, transient gateway
 * issue (it proxies to one real node and is rate-limited 100 req/min/IP by
 * design, per its own operator).
 */
function describeKadenaNetworkError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const nodeUrl = getActiveKadenaNodeUrl();
  if (error instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(message)) {
    return (
      `Could not reach the Kadena network node (${nodeUrl}). ` +
      "If this URL still shows the old plain-HTTP direct node " +
      `(${KADENA_DIRECT_NODE_URL}) rather than the gateway above, check the Network tab's Kadena ` +
      "row — that node is known to be unreachable from outside its own LAN and to trip a " +
      "browser's mixed content block when loaded over HTTPS. Otherwise this is a real " +
      "connectivity problem reaching the node, not something fixable from this screen."
    );
  }
  if (/timed out after \d+ms/i.test(message)) {
    return (
      `${message} — against ${nodeUrl}. If this URL still shows the old plain-HTTP direct node ` +
      `(${KADENA_DIRECT_NODE_URL}) rather than the gateway above, check the Network tab's Kadena ` +
      "row; that node is known to be slow/unreachable from outside its own LAN. Against the " +
      "gateway itself, a timeout is more likely transient network congestion or its own rate " +
      "limit (100 requests/minute/IP, by design) — retrying in a moment may simply work."
    );
  }
  return message;
}

/** A conservative placeholder gas limit for the FIRST (simulation) build —
 *  matches `kadenaReads.ts`'s own dirty-read convention. Replaced by
 *  `calculateAutoGasLimit`'s calibrated value for the SECOND (real) build. */
const SIMULATION_GAS_LIMIT = 150000;

/** How long to wait for the initiate step's own on-chain confirmation before
 *  reporting "still confirming" — same order of magnitude as
 *  `SendStoaModal.tsx`'s own `waitForInitiateConfirmation` budget. */
const INITIATE_POLL_TIMEOUT_MS = 100_000;
/** How long to wait for the SPV proof — Kadena's own proof becomes available
 *  ~100-120s after the source-chain submit commits (matches
 *  `crossChainFunctions.ts`'s own documented window for the equivalent
 *  StoaChain wait). */
const SPV_POLL_TIMEOUT_MS = 150_000;
const KADENA_POLL_INTERVAL_MS = 5_000;

function validateAmount(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!AMOUNT_RX.test(trimmed)) return "Enter a valid positive amount (digits and an optional decimal point).";
  if (parseFloat(trimmed) <= 0) return "Amount must be greater than 0.";
  return null;
}

export interface SendKadenaModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Sender's public key — signs the `coin.GAS`/`coin.TRANSFER`/
   *  `coin.TRANSFER_XCHAIN` capabilities (self-funded, no gas station). */
  publicKey: string;
  /** Sender's Kadena address, e.g. `k:<publicKey>`. */
  address: string;
  /** Per-chain balance map, keyed by chain id string (e.g. `"0"`, `"7"`) —
   *  Kadena is a braided 20-chain coin same as native Stoa; a balance on
   *  chain 7 doesn't fund a send that runs on chain 0. Undefined for the
   *  selected chain renders as "—" (unknown), never a stale/misleading 0.
   *  The caller (StoaAccountsTab) already has this from useKadenaBalances's
   *  own `perChain` map — no extra read here. */
  senderBalanceByChain?: Record<string, { balance: number; exists: boolean }>;
  onSuccess?: (requestKey: string) => void;
  /** MOBILE ONLY — mirrors `SendStoaModal.tsx`'s identical prop. */
  fullScreenPortalTarget?: Element | null;
}

const fmt12 = (n: number): string => n.toFixed(12);

/** Portals `children` into `target` when supplied, renders inline otherwise
 *  — mirrors `SendStoaModal.tsx`'s own `MobilePortal`. */
function MobilePortal({ target, children }: { target?: Element | null; children: React.ReactNode }) {
  return target ? createPortal(children, target) : <>{children}</>;
}

type CrossChainStatus =
  | "configure"
  | "submitting"
  | "confirming"
  | "waiting-spv"
  | "completing"
  | "done"
  | "pending-unclaimed"
  | "error";

const CROSSCHAIN_STATUS_LABEL: Record<CrossChainStatus, string | null> = {
  configure: null,
  submitting: "Submitting the cross-chain transfer…",
  confirming: "Confirming on the source chain…",
  "waiting-spv": "Waiting for the SPV proof (this can take 100+ seconds)…",
  completing: "Completing the transfer on the target chain…",
  done: null,
  "pending-unclaimed": null,
  error: null,
};

/** Same live UX fix as `SendStoaModal.tsx`'s own `CROSSCHAIN_TOAST_STEPS`
 *  (see its doc comment for the full story) — a Kadena cross-chain send is
 *  the same multi-minute, multi-stage real-world process, and the toast
 *  used to be just as silent through the two long waits. */
const CROSSCHAIN_TOAST_STEPS = [
  { label: "Confirming on source chain" },
  { label: "Waiting for cross-chain proof" },
  { label: "Completing on target chain" },
] as const;

export function SendKadenaModal({
  isOpen,
  onClose,
  publicKey,
  address,
  senderBalanceByChain,
  onSuccess,
  fullScreenPortalTarget,
}: SendKadenaModalProps): React.JSX.Element | null {
  const { sign } = useSignTransaction();
  const getKeypair = useGetKeypair();
  const ensureCodexUnlocked = useEnsureCodexUnlocked();

  const [sourceChain, setSourceChain] = useState(KADENA_MAINNET_DEFAULT_CHAIN_ID);
  const [targetChain, setTargetChain] = useState(KADENA_MAINNET_DEFAULT_CHAIN_ID);
  const [receiver, setReceiver] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [crossChainStatus, setCrossChainStatus] = useState<CrossChainStatus>("configure");
  const [pendingUnclaimedInfo, setPendingUnclaimedInfo] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSourceChain(KADENA_MAINNET_DEFAULT_CHAIN_ID);
      setTargetChain(KADENA_MAINNET_DEFAULT_CHAIN_ID);
      setReceiver("");
      setAmount("");
      setSubmitting(false);
      setLastError(null);
      setCrossChainStatus("configure");
      setPendingUnclaimedInfo(null);
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
    setPendingUnclaimedInfo(null);
    setCrossChainStatus(isCrossChain ? "submitting" : "configure");
    const receiverAddr = receiver.trim();
    if (!SAFE_ACCOUNT_RX.test(receiverAddr)) {
      setLastError("Receiver address contains characters that aren't allowed in an account name.");
      if (isCrossChain) setCrossChainStatus("error");
      setSubmitting(false);
      return;
    }
    // Pop the REAL password prompt here, BEFORE any read/build, if the codex
    // is locked — a cancelled prompt just stops quietly (no toast, no
    // error): declining to unlock isn't a failure. Mirrors SendStoaModal.tsx.
    const unlocked = await ensureCodexUnlocked();
    if (!unlocked) {
      // Reset crossChainStatus too, not just submitting — otherwise a
      // cancelled prompt in cross-chain mode leaves the visible
      // "Submitting the cross-chain transfer…" message stuck on screen
      // (statusMessage renders off crossChainStatus alone, independent of
      // the submitting flag) until the modal is closed/reopened or the
      // user resubmits.
      if (isCrossChain) setCrossChainStatus("configure");
      setSubmitting(false);
      return;
    }
    const isKAccount = K_ACCOUNT_RX.test(receiverAddr);
    const decimalStr = formatDecimalForPact(amount.trim());

    if (isCrossChain) {
      if (!isKAccount) {
        const message = "Cross-chain transfers currently support k: receivers only.";
        setLastError(message);
        setCrossChainStatus("error");
        setSubmitting(false);
        return;
      }
      const receiverGuard: IKeyset = { keys: [receiverAddr.slice(2)], pred: "keys-all" };
      const sourceClient = createClient(kadenaPactUrl(getActiveKadenaNodeUrl(), sourceChain));
      // Created upfront (targetChain is already known) so the toast's own
      // pollFn — which must confirm the CONTINUATION on the target chain,
      // not the initiate step on the source chain — can close over it here,
      // before the continuation itself is built further down.
      const targetClient = createClient(kadenaPactUrl(getActiveKadenaNodeUrl(), targetChain));
      // Real multi-step toast — same live UX fix as SendStoaModal.tsx's own
      // crosschain path (see CROSSCHAIN_TOAST_STEPS's doc comment): a
      // Kadena cross-chain send is the same multi-minute, multi-stage
      // process, and the OLD single-step txPending wrapper only ever showed
      // a toast at the very end (or on hard failure) — nothing during the
      // two long waits.
      const _tx: ToastController = createMultiStepToast({
        title: "Send KDA (cross-chain)",
        steps: [...CROSSCHAIN_TOAST_STEPS],
        chain: "kadena",
      });
      // Confirms the CONTINUATION landed on the TARGET chain (not the
      // initiate step on the source chain) — without this, step 2 would
      // read "done" the instant `submitContinuation`-equivalent mempool
      // acceptance happens, never confirming it actually landed. Driven
      // manually via `pollViaInjectedFn` (step 2) at the end of this flow,
      // instead of `txPending`'s own `.submitted()` — this toast is a raw
      // `ToastController`, not the single-step convenience wrapper.
      const pollContinuation = async (requestKey: string): Promise<ArweavePollResult> => {
        try {
          const resp = await withKadenaTimeout(
            targetClient.getStatus({ requestKey, chainId: targetChain, networkId: KADENA_MAINNET_NETWORK_ID } as any),
            "Kadena continuation poll",
          );
          const cmdResult = (resp as any)[requestKey];
          if (!cmdResult) return "pending";
          if (cmdResult.result?.status === "failure") return "failed";
          return "confirmed";
        } catch {
          return "pending";
        }
      };
      // Tracks which step is currently active, so a failure caught in the
      // generic catch block below (which has no other way to know which
      // stage was in flight) marks the RIGHT step red instead of always
      // step 0.
      let activeCrossChainStep = 0;
      try {
        // ── Step 0: initiate — coin.transfer-crosschain, self-funded on
        // the source chain. Same simulate→calibrate→sign→submit shape as
        // the same-chain path, different pact-code/capability shape.
        const creationTime = safeCreationTime();
        const buildInitiate = (gasLimit: number) => {
          const pactCode = `(coin.transfer-crosschain "${address}" "${receiverAddr}" (read-keyset "ks") "${targetChain}" ${decimalStr})`;
          let builder: any = Pact.builder.execution(pactCode).addData("ks", receiverGuard);
          builder = builder
            .setMeta({ senderAccount: address, chainId: sourceChain, gasLimit, gasPrice: KADENA_GAS_PRICE, creationTime })
            .setNetworkId(KADENA_MAINNET_NETWORK_ID)
            .addSigner(publicKey, (withCapability: any) => [
              withCapability("coin.GAS"),
              withCapability("coin.TRANSFER_XCHAIN", address, receiverAddr, { decimal: decimalStr }, targetChain),
            ]);
          return builder.createTransaction();
        };

        let initiateTx = buildInitiate(SIMULATION_GAS_LIMIT);
        const initiateSim = await withKadenaTimeout(sourceClient.dirtyRead(initiateTx as any), "Kadena crosschain simulation");
        if ((initiateSim as any).result?.status === "failure") {
          const error = createSimulationError(
            "Send KDA (cross-chain)",
            (initiateSim as any).result,
            `Sender: ${address} | Receiver: ${receiverAddr} | Source: ${sourceChain} | Target: ${targetChain}`,
          );
          logDetailedError(error);
          throw error;
        }
        const initiateRequiredGas = (initiateSim as any).gas;
        let initiateGasLimit = SIMULATION_GAS_LIMIT;
        if (typeof initiateRequiredGas === "number" && Number.isFinite(initiateRequiredGas) && initiateRequiredGas > 0) {
          const calibrated = calculateAutoGasLimit(initiateRequiredGas);
          if (calibrated > 0) {
            initiateGasLimit = calibrated;
            initiateTx = buildInitiate(initiateGasLimit);
          }
        }

        const keypair = await getKeypair(publicKey);
        const signedInitiate = await sign({ tx: initiateTx, capsKey: keypair, guardKeypairs: [] });
        const initiateDescriptor = await withKadenaTimeout(sourceClient.submitOne(signedInitiate as any), "Kadena crosschain submit");
        const requestKey = initiateDescriptor.requestKey;
        // Step 0 already showing (created "active" by default) — attach the
        // real requestKey now that one exists.
        _tx.updateStep(0, "active", { requestKey });

        // ── Wait for the initiate step's own on-chain confirmation.
        setCrossChainStatus("confirming");
        try {
          const confirmResult = await withKadenaTimeout(
            sourceClient.pollOne(
              { requestKey, chainId: sourceChain, networkId: KADENA_MAINNET_NETWORK_ID } as any,
              { timeout: INITIATE_POLL_TIMEOUT_MS, interval: KADENA_POLL_INTERVAL_MS } as any,
            ),
            "Kadena crosschain confirmation",
          );
          if ((confirmResult as any)?.result?.status === "failure") {
            const message = (confirmResult as any).result.error?.message ?? "The cross-chain transfer's initiate step failed on-chain.";
            setLastError(message);
            setCrossChainStatus("error");
            _tx.updateStep(0, "error", { label: message, requestKey });
            return;
          }
        } catch {
          // A thrown/timed-out poll means "still pending, not confirmed
          // yet" — NOT a failure. The transaction may still land; the user
          // just can't be told it's confirmed within this session's wait.
          const message = `The transfer is still confirming on chain ${sourceChain} (request key ${requestKey}). It may still complete — check its status before resubmitting.`;
          setLastError(message);
          setCrossChainStatus("error");
          _tx.updateStep(0, "error", { label: message, requestKey });
          return;
        }
        // Step 0 done — `updateStep`'s own auto-activate-next-pending logic
        // (toastManager.ts) flips step 1 to "active" for free.
        _tx.updateStep(0, "done", { requestKey });
        activeCrossChainStep = 1;

        // ── Step 0 confirmed — fetch the SPV proof.
        setCrossChainStatus("waiting-spv");
        let proof: string;
        try {
          proof = await sourceClient.pollCreateSpv(
            { requestKey, chainId: sourceChain, networkId: KADENA_MAINNET_NETWORK_ID } as any,
            targetChain as any,
            { timeout: SPV_POLL_TIMEOUT_MS, interval: KADENA_POLL_INTERVAL_MS } as any,
          );
        } catch (spvError) {
          const message = spvError instanceof Error ? spvError.message : "Timed out waiting for the SPV proof.";
          setLastError(message);
          setCrossChainStatus("error");
          _tx.updateStep(1, "error", { label: message });
          return;
        }
        _tx.updateStep(1, "done");
        activeCrossChainStep = 2;

        // ── Step 1: continuation — self-funded on the TARGET chain. A
        // LOCAL builder (NOT ouronet-core's buildContinuationTransaction —
        // see this file's own module doc comment for why). Unlike
        // StoaChain's continuation, this one IS signed.
        setCrossChainStatus("completing");
        const contCreationTime = safeCreationTime();
        const buildContinuation = (gasLimit: number) =>
          Pact.builder
            .continuation({ pactId: requestKey, rollback: false, step: 1, proof } as any)
            .setMeta({ senderAccount: address, chainId: targetChain, gasLimit, gasPrice: KADENA_GAS_PRICE, creationTime: contCreationTime })
            .setNetworkId(KADENA_MAINNET_NETWORK_ID)
            .addSigner(publicKey, (withCapability: any) => [withCapability("coin.GAS")])
            .createTransaction();

        let contTx = buildContinuation(SIMULATION_GAS_LIMIT);
        const contSim = await withKadenaTimeout(targetClient.dirtyRead(contTx as any), "Kadena continuation simulation");
        if ((contSim as any).result?.status === "failure") {
          const error = createSimulationError(
            "Send KDA (cross-chain completion)",
            (contSim as any).result,
            `Sender: ${address} | Target: ${targetChain} | Pact id: ${requestKey}`,
          );
          // Own case-INSENSITIVE check on the raw message, rather than
          // trusting `error.code === "INSUFFICIENT_FUNDS"` alone —
          // `createSimulationError`'s own pattern-match is case-sensitive
          // (confirmed: a real-looking "Insufficient funds..." message,
          // capitalized, falls through to its generic SIMULATION_FAILED
          // branch instead). A real Kadena gas-buy failure message's exact
          // casing isn't something this file controls, so the "is this a
          // funding issue" decision must not depend on matching it exactly.
          const rawMessage = (contSim as any).result?.error?.message ?? "";
          const isFundingIssue = /insufficient funds|balance/i.test(rawMessage) || error.code === "INSUFFICIENT_FUNDS";
          if (isFundingIssue) {
            // NOT a hard failure — the initiate step already succeeded and
            // the receiver's funds are provably committed on-chain (yielded
            // in step 0); only the CLAIM (this continuation) is outstanding,
            // blocked on the sender having gas on the target chain. Never
            // frame this as "done" (it isn't complete) or "error" (nothing
            // failed irrecoverably) — a distinct, honest third state.
            const message = `Committed on-chain, but not yet claimed: you need KDA on chain ${targetChain} to complete this transfer. Request key: ${requestKey}`;
            setPendingUnclaimedInfo(message);
            setCrossChainStatus("pending-unclaimed");
            _tx.updateStep(2, "done", { label: "Pending — needs gas on target chain", requestKey });
            onSuccess?.(requestKey);
            return;
          }
          logDetailedError(error);
          throw error;
        }
        const contRequiredGas = (contSim as any).gas;
        let contGasLimit = SIMULATION_GAS_LIMIT;
        if (typeof contRequiredGas === "number" && Number.isFinite(contRequiredGas) && contRequiredGas > 0) {
          const calibrated = calculateAutoGasLimit(contRequiredGas);
          if (calibrated > 0) {
            contGasLimit = calibrated;
            contTx = buildContinuation(contGasLimit);
          }
        }

        const signedCont = await sign({ tx: contTx, capsKey: keypair, guardKeypairs: [] });
        const contDescriptor = await withKadenaTimeout(targetClient.submitOne(signedCont as any), "Kadena continuation submit");

        setCrossChainStatus("done");
        // Deliberately NOT awaited (fire-and-forget, matching the OLD
        // single-step toast's own `.submitted()` behavior) — the
        // continuation's own on-chain confirmation keeps polling in the
        // background after this modal closes, via the SAME shared poller
        // `.submitted()` itself uses for a single-step kadena/arweave toast
        // (`pollViaInjectedFn`, `toastManager.ts`).
        void pollViaInjectedFn(_tx, 2, contDescriptor.requestKey, pollContinuation);
        onSuccess?.(requestKey);
        onClose();
      } catch (e) {
        if (e instanceof CodexLockedError) {
          const message = "Codex is locked. Unlock your codex to sign this transaction.";
          setLastError(message);
          setCrossChainStatus("error");
          _tx.updateStep(activeCrossChainStep, "error", { label: message });
        } else {
          const message = describeKadenaNetworkError(e);
          setLastError(message);
          setCrossChainStatus("error");
          _tx.updateStep(activeCrossChainStep, "error", { label: message });
        }
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Same-chain path — unchanged from before this modal grew a chain-pair
    // selector.
    const client = createClient(kadenaPactUrl(getActiveKadenaNodeUrl(), sourceChain));
    const _tx = txPending("Send KDA", {
      chain: "kadena",
      pollFn: async (requestKey: string): Promise<ArweavePollResult> => {
        try {
          // `withKadenaTimeout` — same bounded-hang protection as the
          // simulation/submit calls below (this same node has a documented
          // real hang failure mode); a timeout here is caught the same way
          // as any other transient poll error, below.
          const resp = await withKadenaTimeout(
            client.getStatus({ requestKey, chainId: sourceChain, networkId: KADENA_MAINNET_NETWORK_ID } as any),
            "Kadena poll",
          );
          const cmdResult = (resp as any)[requestKey];
          if (!cmdResult) return "pending";
          if (cmdResult.result?.status === "failure") return "failed";
          return "confirmed";
        } catch {
          return "pending";
        }
      },
    });
    try {
      const exists = await checkKadenaAccountExistsActive(receiverAddr, sourceChain);
      if (exists === null) {
        const message = "Could not verify the receiver account — try again.";
        setLastError(message);
        _tx.fail(message);
        return;
      }
      if (!exists && !isKAccount) {
        const message = "Receiver account not found — only k: accounts can be auto-created.";
        setLastError(message);
        _tx.fail(message);
        return;
      }

      const isNew = !exists;
      const pactCode = isNew
        ? `(coin.transfer-create "${address}" "${receiverAddr}" (read-keyset "ks") ${decimalStr})`
        : `(coin.transfer "${address}" "${receiverAddr}" ${decimalStr})`;
      const keysetData: IKeyset | undefined = isNew
        ? { keys: [receiverAddr.slice(2)], pred: "keys-all" }
        : undefined;

      const creationTime = safeCreationTime();
      const buildTransaction = (gasLimit: number) => {
        let builder: any = Pact.builder.execution(pactCode);
        if (keysetData) builder = builder.addData("ks", keysetData);
        builder = builder
          .setMeta({
            senderAccount: address,
            chainId: sourceChain,
            gasLimit,
            gasPrice: KADENA_GAS_PRICE,
            creationTime,
          })
          .setNetworkId(KADENA_MAINNET_NETWORK_ID)
          .addSigner(publicKey, (withCapability: any) => [
            withCapability("coin.GAS"),
            withCapability("coin.TRANSFER", address, receiverAddr, { decimal: decimalStr }),
          ]);
        return builder.createTransaction();
      };

      let transaction = buildTransaction(SIMULATION_GAS_LIMIT);
      const simulation = await withKadenaTimeout(client.dirtyRead(transaction as any), "Kadena simulation");
      if ((simulation as any).result?.status === "failure") {
        // `createSimulationError` reads `.error.message` straight off its
        // second arg — pass the `result` sub-object (where Pact actually put
        // the error), not the whole `{result, gas, ...}` envelope. Mirrors
        // `rotatePaymentKeyLive.ts`'s own identical call shape.
        const error = createSimulationError(
          "Send KDA",
          (simulation as any).result,
          `Sender: ${address} | Receiver: ${receiverAddr} | Chain: ${sourceChain}`,
        );
        logDetailedError(error);
        throw error;
      }
      const requiredGas = (simulation as any).gas;
      let gasLimit = SIMULATION_GAS_LIMIT;
      // Guard on a genuinely usable positive number, not bare truthiness —
      // `if (requiredGas)` would also be true for a negative value (the
      // node's own default is plain HTTP, so a tampered or buggy response
      // is a real possibility, not just a hypothetical). `calculateAutoGasLimit`
      // itself returns 0 for any non-finite/<=0 input; the `calibrated > 0`
      // check below is defense-in-depth so a real transaction can NEVER be
      // built with gasLimit 0 regardless of how a bad value got here.
      if (typeof requiredGas === "number" && Number.isFinite(requiredGas) && requiredGas > 0) {
        const calibrated = calculateAutoGasLimit(requiredGas);
        if (calibrated > 0) {
          gasLimit = calibrated;
          transaction = buildTransaction(gasLimit);
        }
      }

      const keypair = await getKeypair(publicKey);
      const signedTx = await sign({ tx: transaction, capsKey: keypair, guardKeypairs: [] });
      const descriptor = await withKadenaTimeout(client.submitOne(signedTx as any), "Kadena submit");

      _tx.submitted(descriptor.requestKey, sourceChain);
      onSuccess?.(descriptor.requestKey);
      onClose();
    } catch (e) {
      if (e instanceof CodexLockedError) {
        const message = "Codex is locked. Unlock your codex to sign this transaction.";
        setLastError(message);
        _tx.fail(message);
      } else {
        const message = describeKadenaNetworkError(e);
        setLastError(message);
        _tx.fail(message);
      }
    } finally {
      setSubmitting(false);
    }
  }, [
    canSubmit, isCrossChain, sourceChain, targetChain, receiver, amount, address, publicKey,
    sign, getKeypair, ensureCodexUnlocked, onSuccess, onClose,
  ]);

  if (!isOpen) return null;

  const statusMessage = CROSSCHAIN_STATUS_LABEL[crossChainStatus];

  return (
    <MobilePortal target={fullScreenPortalTarget}>
      <CodexModalShell
        title="Send KDA"
        subtitle={isCrossChain ? "coin.transfer-crosschain" : "coin.transfer / coin.transfer-create"}
        onClose={onClose}
        footer={<ModalExecuteRow onCancel={onClose} onSubmit={handleSubmit} submitting={submitting} canSubmit={canSubmit} label="Send KDA" />}
      >
        <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
          {/* Source and target are allowed to collide on purpose — a
              same-chain transfer (coin.transfer/coin.transfer-create) is
              just as valid as a cross-chain one (coin.transfer-crosschain),
              so neither selector excludes the other's current value.
              Earlier versions mutually excluded them (mirroring OuronetUI's
              cross-chain-ONLY picker, where a collision made no sense) —
              once same-chain support was added, that exclusion silently
              made same-chain unreachable for any non-default source chain,
              since the target could never be clicked back onto it. */}
          <ChainSelector
            label="Source Chain"
            value={sourceChain}
            onChange={setSourceChain}
            chainCount={KADENA_CHAIN_COUNT}
          />
          <ChainSelector
            label="Target Chain"
            value={targetChain}
            onChange={setTargetChain}
            chainCount={KADENA_CHAIN_COUNT}
          />
        </div>

        <div style={{ fontSize: 12, color: "#888", margin: "0 0 12px", padding: "10px 12px", borderRadius: 8, border: "1px solid #1a1a1a", backgroundColor: "#0a0a0a" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
            <span>Sending on <strong style={{ color: "#22c55e" }}>Kadena — Chain {sourceChain}</strong></span>
            <span>
              Balance: <strong style={{ color: "#d2d3d4", fontFamily: "var(--codex-font-mono, ui-monospace, monospace)" }}>
                {senderChainBalance === undefined ? "—" : `${fmt12(senderChainBalance)} KDA`}
              </strong>
            </span>
          </div>
          <div style={{ marginTop: 6, overflowWrap: "anywhere" }}>
            From <code style={{ wordBreak: "break-all" }}>{address}</code>{" "}
            {isCrossChain
              ? <>to a receiver on <strong style={{ color: "#22c55e" }}>Chain {targetChain}</strong> — a cross-chain transfer (coin.transfer-crosschain), completed automatically in two on-chain steps.</>
              : <>to a receiver on the same chain (Chain {sourceChain}) — native Kadena transfers don't cross chains unless you pick a different target above.</>}
          </div>
          <div style={{ marginTop: 6, color: "#666" }}>
            Gas is paid by your own account on {isCrossChain ? "BOTH chains" : "this chain"} — Kadena mainnet has no shared gas station.
          </div>
        </div>
        <label style={modalLabel} htmlFor="send-kadena-receiver">Receiver address</label>
        <input
          id="send-kadena-receiver"
          type="text"
          value={receiver}
          onChange={(e) => setReceiver(e.target.value)}
          placeholder="k: account"
          autoComplete="off"
          style={modalInput}
        />
        <label style={{ ...modalLabel, marginTop: 12 }} htmlFor="send-kadena-amount">Amount</label>
        <input
          id="send-kadena-amount"
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
          <div style={{ marginTop: 8, fontSize: 12, color: "#22c55e" }}>{statusMessage}</div>
        )}
        {pendingUnclaimedInfo && (
          <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 8, fontSize: 12, backgroundColor: "#eab30815", border: "1px solid #eab30840", color: "#eab308" }}>
            {pendingUnclaimedInfo}
          </div>
        )}
        <ModalFeedback error={lastError} requestKey={null} />
      </CodexModalShell>
    </MobilePortal>
  );
}

export default SendKadenaModal;
