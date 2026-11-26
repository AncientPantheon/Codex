/**
 * crossChainStoaTransfer — step A of the migration chain
 * (docs/work/migration-execute/design.md §2): one chain's native STOA moved to
 * another chain, for the SAME key. Consolidation runs it up to NINE times
 * (chains 1-9 → chain 0) in a single press.
 *
 * ## This is an EXTRACTION, not a re-implementation
 *
 * Every line below was lifted out of `ui/internal/SendStoaModal.tsx`'s
 * `handleSubmit` `useCallback` (the cross-chain branch, `:397-509` before the
 * lift), which has been shipping and landing real mainnet transfers. The
 * alternative — writing the flow a second time for the engine — was rejected
 * for the reason this package already recorded the first time it came up, for
 * THIS EXACT FLOW (`../toast/toastManager.ts:287-295`): duplicating the
 * fetch/retry/timeout logic a second time "would be exactly the 'two
 * independently-editable copies that can silently disagree' trap this
 * package's own conventions warn against". `pollStoaChainConfirmation` was
 * made public rather than copied. So is this.
 *
 * What is at stake in the duplicate is not plumbing but a JUDGEMENT: the flow
 * has four distinct failure modes, and one of them —
 * {@link CrossChainStoaTransferFailureKind} `"initiate-pending"` — is
 * deliberately worded so a user never resubmits a transfer that may still
 * land. Nine re-implementations of that judgement is nine chances to get it
 * wrong with money.
 *
 * ## The three steps, and why step 2 is never marked done here
 *
 *   0. initiate  — `coin.C_TransferAcross` on the source chain, then WAIT for
 *                  its own on-chain confirmation (not just mempool
 *                  acceptance): the SPV proof does not exist until it lands.
 *   1. SPV proof — `pollSpvProof`, ~100-150s on mainnet.
 *   2. continue  — `buildContinuationTransaction` + `submitContinuation` on
 *                  the TARGET chain. The continuation is what ACTUALLY lands
 *                  the funds, and `submitContinuation` only confirms mempool
 *                  acceptance (its own doc comment), so marking step 2 "done"
 *                  on submit would be a lie of exactly the kind the old
 *                  single-step toast told. This function reports step 2 to
 *                  nobody as done; it hands back
 *                  `continuationRequestKey` and lets the caller confirm it —
 *                  the modal by handing it to `pollStoaChainConfirmation`
 *                  (display), the engine by gating on `awaitTxVerdict`.
 *
 * ## Injected seams, and the mainnet hazard
 *
 * `submitCrossChainTransfer` (`crossChainFunctions.js:195`) and
 * `submitContinuation` (`:382`) are real mainnet broadcasts, and this is the
 * step that runs up to nine times per press. Neither is imported here: the
 * whole chain edge arrives on a REQUIRED {@link CrossChainStoaTransferDeps}.
 * `tests/execute-stoa-transfers.test.ts` passes a synthetic one and contains
 * not one `vi.mock` — a dropped mock fails OPEN onto mainnet (the module still
 * resolves and the real broadcast runs), a required seam with no default
 * cannot.
 *
 * Two of those seams exist so one function serves both callers:
 *
 * - **`submitInitiate`** — `buildCTransferAcross`'s own two branches are
 *   different pipelines, and only one of them belongs to the engine. Source
 *   chain "0" pays gas through the Ouronet Gas Station and is built with the
 *   modal's local `buildGasStationTransaction` + `CodexSigningStrategy.execute()`;
 *   that stays a MODAL concern (it is also the modal's only transaction-build
 *   site, which `tests/tx-gas-meta-surface.test.ts` deliberately keeps there —
 *   note this file must stay free of even the literal text that scan greps
 *   for, since its inventory is a source-text search).
 *   Source chains 1-9 pay gas through `stoa-xchain-gas` and sign+submit
 *   directly — and consolidation's source chain is 1-9 BY CONSTRUCTION, so
 *   the engine only ever needs that one. It is ready-made here:
 *   {@link createSignedCrossChainInitiate}.
 * - **`onStep`** — `ToastController.updateStep`'s signature verbatim
 *   (`../toast/toastManager.ts:125`), so the modal passes its controller's own
 *   method and the engine passes {@link offsetStepReporter}, which maps this
 *   flow's 0/1/2 onto its own toast's `n`..`n+2`.
 *
 * ## Outcomes are RETURNED, not thrown
 *
 * Every flow outcome is a {@link CrossChainStoaTransferResult} — the modal maps
 * it to the text it already showed, the engine maps it to HALT, and both get
 * the same facts. The message text lives HERE rather than in each caller
 * precisely because the `"initiate-pending"` wording is the judgement being
 * preserved; two callers phrasing it independently is the duplication this
 * extraction exists to prevent.
 *
 * A thrown error means something OUTSIDE the flow's own vocabulary happened (a
 * node that refused the submit, a locked codex). Those propagate untouched, so
 * the caller's own catch block reports them: the modal has one, and the engine
 * needs one anyway. Before returning any `ok: false`, this function has
 * ALREADY reported the error to `onStep` against the step that failed — a
 * caller must not report it a second time.
 */

import { K_ACCOUNT_RX, deriveKAccountKeyset } from "./nativeStoaTransfer.js";
import type { TxVerdict } from "./awaitConfirmation.js";
import type { GetKeypairFn } from "@ancientpantheon/codex-ui/hooks";
import type { ICommand, IUnsignedCommand } from "@stoachain/kadena-stoic-legacy/client";
import type { IKadenaKeypair } from "@stoachain/stoa-core/signing";
import type { IKeyset } from "@stoachain/stoa-core/guard";

/**
 * The flow's three toast steps. Lifted from `SendStoaModal.tsx`'s own
 * `CROSSCHAIN_TOAST_STEPS` so the engine's toast names the stages with the
 * same words the modal does — `tests/ui-send-stoa-modal.test.tsx:549-553`
 * pins them, and a cross-chain send genuinely takes several minutes end to
 * end, which is why it has a real multi-step toast rather than one opaque
 * spinner.
 */
export const CROSSCHAIN_TOAST_STEPS = [
  { label: "Confirming on source chain" },
  { label: "Waiting for cross-chain proof" },
  { label: "Completing on target chain" },
] as const;

/** `StepStatus` from `../toast/toastManager.ts:14`, structurally. */
export type CrossChainStepStatus = "pending" | "active" | "done" | "error";

/** `ToastController.updateStep`'s signature verbatim
 *  (`../toast/toastManager.ts:125`). */
export type CrossChainStepReporter = (
  stepIdx: number,
  status: CrossChainStepStatus,
  data?: { label?: string; requestKey?: string; result?: string },
) => void;

export interface CrossChainStoaTransferRequest {
  readonly sender: string;
  /** Must be a `k:` account: every cross-chain transfer supplies a receiver
   *  keyset (the receiver may not exist on the TARGET chain yet even if it
   *  exists elsewhere — chain accounts are independent), and only a `k:`
   *  address encodes the keyset to supply. */
  readonly receiver: string;
  /** Already a Pact decimal literal — `formatDecimalForPact` in the modal,
   *  `drainAmountForPact` in the engine. */
  readonly amount: string;
  readonly sourceChain: string;
  readonly targetChain: string;
}

/** What an initiate implementation is handed: the request plus the derived
 *  receiver guard, so neither caller re-derives it. */
export interface CrossChainInitiateRequest extends CrossChainStoaTransferRequest {
  readonly receiverGuard: IKeyset;
}

/** The step-0 submit. See this module's header for why it is a seam. */
export type CrossChainInitiate = (req: CrossChainInitiateRequest) => Promise<{ requestKey: string }>;

export interface CrossChainStoaTransferDeps {
  readonly submitInitiate: CrossChainInitiate;
  /** `awaitTxVerdict(requestKey, chainId, deps)` from `./awaitConfirmation.ts`
   *  — the bounded retry whose exhausted budget resolves `"pending"`, DISTINCT
   *  from `"failure"`. */
  readonly awaitInitiateVerdict: (requestKey: string, chainId: string) => Promise<TxVerdict>;
  readonly pollSpvProof: (
    requestKey: string,
    sourceChain: string,
    targetChain: string,
  ) => Promise<{ proof: string | null; error?: string }>;
  readonly buildContinuationTransaction: (requestKey: string, proof: string, targetChain: string) => unknown;
  readonly submitContinuation: (tx: unknown, targetChain: string) => Promise<{ requestKey: string }>;
  readonly onStep: CrossChainStepReporter;
  /**
   * Optional fire-and-forget hook for the continuation's own confirmation,
   * called with this flow's LOCAL step index (2). The modal passes
   * `pollStoaChainConfirmation` here, which drives the toast's last step.
   *
   * A caller reporting into an OFFSET toast must apply its own offset to the
   * index. The engine does not use this hook at all: it has
   * `continuationRequestKey` and gates on the real verdict instead of a
   * display poll whose timeout and success look identical
   * (`./awaitConfirmation.ts`'s header).
   */
  readonly onContinuationSubmitted?: (stepIdx: number, requestKey: string, targetChain: string) => void;
}

/**
 * The four ways this flow fails, as four values — because the caller must act
 * differently on each:
 *
 * - `invalid-receiver` — nothing was submitted. Fix the receiver.
 * - `initiate-failed`  — the chain reported a real failure. Nothing moved.
 * - `initiate-pending` — the confirmation budget ran out with NO failure
 *   reported. The transfer may still land. **Never phrase this as a failure**:
 *   that invites a duplicate resubmit of money that is already in flight.
 * - `spv-timeout`      — the initiate LANDED; only the proof is missing. The
 *   funds are in escrow on the source chain and the continuation can be
 *   completed later with the same request key. Nothing is lost and nothing
 *   should be re-sent.
 */
export type CrossChainStoaTransferFailureKind =
  | "invalid-receiver"
  | "initiate-failed"
  | "initiate-pending"
  | "spv-timeout";

export type CrossChainStoaTransferResult =
  | {
      readonly ok: true;
      /** The initiate's request key — the handle for the whole transfer. */
      readonly requestKey: string;
      /** Mempool-accepted, NOT confirmed. See this module's header, step 2. */
      readonly continuationRequestKey: string;
    }
  | {
      readonly ok: false;
      readonly kind: CrossChainStoaTransferFailureKind;
      readonly message: string;
      /** Present once an initiate request key exists — the user's only handle
       *  for checking a transfer themselves instead of resubmitting it. */
      readonly requestKey?: string;
    };

/** `SendStoaModal.tsx:400` verbatim. */
const NON_K_RECEIVER_MESSAGE = "Cross-chain transfers currently support k: receivers only.";
/** `SendStoaModal.tsx:467` verbatim — the fallback when the chain reports a
 *  failure without words of its own. */
const INITIATE_FAILED_MESSAGE = "The cross-chain transfer's initiate step did not confirm.";
/** `SendStoaModal.tsx:479` verbatim — the fallback when `pollSpvProof` yields
 *  no proof and no error. */
const SPV_TIMEOUT_MESSAGE = "Timed out waiting for the SPV proof.";

/** `SendStoaModal.tsx:464-466` verbatim. The deliberate wording: "still
 *  confirming", "may still complete", "check its status before resubmitting"
 *  — and the request key and chain so the user CAN check. */
function initiatePendingMessage(sourceChain: string, requestKey: string): string {
  return (
    `The transfer is still confirming on chain ${sourceChain} (request key ${requestKey}). ` +
    `It may still complete — check its status before resubmitting.`
  );
}

/**
 * Run one cross-chain native-STOA transfer: initiate → confirm → SPV proof →
 * continuation.
 *
 * Reports progress through `deps.onStep` and returns a discriminated result.
 * Reports the failing step as `"error"` itself before returning any
 * `ok: false`.
 */
export async function runCrossChainStoaTransfer(
  req: CrossChainStoaTransferRequest,
  deps: CrossChainStoaTransferDeps,
): Promise<CrossChainStoaTransferResult> {
  const fail = (
    stepIdx: number,
    kind: CrossChainStoaTransferFailureKind,
    message: string,
    requestKey?: string,
  ): CrossChainStoaTransferResult => {
    deps.onStep(stepIdx, "error", { label: message });
    return requestKey === undefined
      ? { ok: false, kind, message }
      : { ok: false, kind, message, requestKey };
  };

  if (!K_ACCOUNT_RX.test(req.receiver)) {
    return fail(0, "invalid-receiver", NON_K_RECEIVER_MESSAGE);
  }

  const { requestKey } = await deps.submitInitiate({
    ...req,
    receiverGuard: deriveKAccountKeyset(req.receiver),
  });
  // Step 0 is already showing (created "active"); this attaches the REAL
  // request key the moment one exists, so a user who opens the toast mid-flow
  // can already copy it instead of waiting for the whole flow to finish.
  deps.onStep(0, "active", { requestKey });

  const verdict = await deps.awaitInitiateVerdict(requestKey, req.sourceChain);
  if (verdict.verdict === "pending") {
    // NOT a failure. The budget was exhausted with nothing reported — see
    // CrossChainStoaTransferFailureKind. The chain's own last message (a
    // failing node call, say) is deliberately NOT appended: it would read as
    // an error about the transfer itself, which is exactly the inference this
    // wording exists to prevent.
    return fail(0, "initiate-pending", initiatePendingMessage(req.sourceChain, requestKey), requestKey);
  }
  if (verdict.verdict !== "success") {
    return fail(0, "initiate-failed", verdict.message ?? INITIATE_FAILED_MESSAGE, requestKey);
  }
  // `updateStep`'s own auto-activate-next-pending logic flips step 1 to
  // "active" for free (`../toast/toastManager.ts`).
  deps.onStep(0, "done", { requestKey });

  const { proof, error: spvError } = await deps.pollSpvProof(requestKey, req.sourceChain, req.targetChain);
  if (!proof) {
    return fail(1, "spv-timeout", spvError ?? SPV_TIMEOUT_MESSAGE, requestKey);
  }
  deps.onStep(1, "done");

  const continuation = deps.buildContinuationTransaction(requestKey, proof, req.targetChain);
  const { requestKey: continuationRequestKey } = await deps.submitContinuation(continuation, req.targetChain);
  // Step 2 stays un-done on purpose — see this module's header.
  deps.onContinuationSubmitted?.(2, continuationRequestKey, req.targetChain);

  return { ok: true, requestKey, continuationRequestKey };
}

/** The chain edge of the non-chain-0 initiate. Every member injected, for the
 *  reason in this module's header. */
export interface SignedCrossChainInitiateDeps {
  /** The sender's own public key — the only signer off chain 0. */
  readonly senderPublicKey: string;
  /** `useGetKeypair()`'s function. Resolved at call time, per call, never
   *  cached: the engine's later steps sign with a different key, and a cached
   *  keypair would outlive the codex lock. */
  readonly getKeypair: GetKeypairFn;
  /** `CodexSigningStrategy.sign()` — the low-level, resolver-agnostic
   *  primitive, NOT `execute()`: that pipeline always injects a gas-station
   *  capsKeyPub and has no "no gas signer" mode, which is what chains 1-9
   *  need (`stoa-xchain-gas` pays, unsigned). Typed with the signer's own
   *  vocabulary rather than `unknown` so the real `useSignTransaction().sign`
   *  is assignable to it under `strictFunctionTypes`. */
  readonly sign: (args: {
    tx: IUnsignedCommand;
    capsKey: IKadenaKeypair;
    guardKeypairs: IKadenaKeypair[];
  }) => Promise<ICommand>;
  /** `buildCTransferAcross` from
   *  `@ouronet/ouronet-core/interactions/crossChainFunctions` — the single
   *  source of truth for the cross-chain mechanics, including the
   *  `stoa-xchain-gas` guard's hard `gasLimit <= 850` cap, which it enforces
   *  itself and no caller overrides. */
  readonly buildCTransferAcross: (params: {
    sender: string;
    receiver: string;
    receiverGuard: IKeyset;
    amount: string;
    sourceChain: string;
    targetChain: string;
    senderPublicKey: string;
  }) => IUnsignedCommand;
  /** `submitCrossChainTransfer` — a REAL broadcast, through
   *  `getFailoverClient` and therefore already dedup-safe on retry, which is
   *  what makes this the engine's path (plan decision 3). */
  readonly submitCrossChainTransfer: (signedTx: ICommand, sourceChain: string) => Promise<{ requestKey: string }>;
}

/**
 * The ready-made non-chain-0 initiate: `buildCTransferAcross` → resolve the
 * sender's keypair → `sign` → `submitCrossChainTransfer`.
 *
 * Both callers use it. The engine uses ONLY this one, because consolidation's
 * source chain is 1-9 by construction (chains 1-9 are swept onto chain 0); the
 * modal uses it whenever the user picks a non-zero source chain, which is what
 * keeps `tests/ui-send-stoa-modal.test.tsx:573-603` — "source chain 3
 * signs+submits directly and never through `execute()`" — a live test of the
 * engine's own path.
 */
export function createSignedCrossChainInitiate(deps: SignedCrossChainInitiateDeps): CrossChainInitiate {
  return async (req: CrossChainInitiateRequest): Promise<{ requestKey: string }> => {
    const unsignedTx = deps.buildCTransferAcross({
      sender: req.sender,
      receiver: req.receiver,
      receiverGuard: req.receiverGuard,
      amount: req.amount,
      sourceChain: req.sourceChain,
      targetChain: req.targetChain,
      senderPublicKey: deps.senderPublicKey,
    });
    const keypair = await deps.getKeypair(deps.senderPublicKey);
    const signedTx = await deps.sign({ tx: unsignedTx, capsKey: keypair, guardKeypairs: [] });
    const descriptor = await deps.submitCrossChainTransfer(signedTx, req.sourceChain);
    return { requestKey: descriptor.requestKey };
  };
}

/**
 * Maps this flow's own step indices (0, 1, 2) onto a longer toast's
 * `offset`..`offset + 2`.
 *
 * The engine's toast has one step per migration step, and consolidation
 * contributes a 3-step flow per chain; without this the ninth chain's progress
 * would overwrite the first chain's rows. `offset` is the index the flow's
 * step 0 occupies in the caller's toast.
 */
export function offsetStepReporter(onStep: CrossChainStepReporter, offset: number): CrossChainStepReporter {
  return (stepIdx, status, data) => {
    // Forwarded WITHOUT a third argument when there is no data, not with an
    // explicit `undefined`: callers (and their tests) compare the whole
    // argument list, and `(1, "done", undefined)` is not `(1, "done")`.
    if (data === undefined) onStep(stepIdx + offset, status);
    else onStep(stepIdx + offset, status, data);
  };
}
