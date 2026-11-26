/**
 * awaitConfirmation — the migration engine's CONFIRMATION GATE: the one
 * question "did this transaction land?" answered with a value a caller can
 * branch on.
 *
 * WHY THIS EXISTS AT ALL, when `pollStoaChainConfirmation` already polls
 * (`../toast/toastManager.ts:297-351`): that function returns
 * `Promise<void>` and ends in `ctrl.updateStep(stepIdx, 'done', …)` on BOTH
 * the confirmed path (`:333`, label `'Confirmed'`) AND the ~200s timeout
 * (`:350`, label `'Submitted'`). From a caller's side a timed-out step and a
 * confirmed step are therefore INDISTINGUISHABLE, and neither is reported
 * back. It is a DISPLAY function — it drives a toast, and it must never be
 * the engine's gate. This module is the gate; the toast stays the toast.
 *
 * The underlying primitive is `pollTransactionStatus` from
 * `@ouronet/ouronet-core/interactions/crossChainFunctions` — chain-generic
 * despite the file name (`crossChainFunctions.js:202-233` is just
 * `getFailoverClient(chainId).pollOne({ requestKey, chainId, networkId })`)
 * and already verdict-returning. A single call to it is a SNAPSHOT, not a
 * wait; this module is the bounded retry around it.
 *
 * This is a GENERALISATION of `ui/internal/SendStoaModal.tsx:176-188`'s
 * private `waitForInitiateConfirmation`, whose budget and whose
 * "pending"-is-not-"failure" discipline are reproduced here exactly. Its own
 * doc comment (`:166-175`), quoted because it is the rule:
 *
 *   "Repeatedly checks the initiate step's own confirmation status — a
 *    single `pollTransactionStatus` call is a snapshot, not a wait; this
 *    bounds the retry the same way every other multi-step chain flow in
 *    this package waits for confirmation before moving on. 20 attempts /
 *    5s = ~100s budget — same order of magnitude as `pollSpvProof`'s own
 *    default (30 × 5s), since an initiate step is a real on-chain
 *    confirmation with the same variance, not a fixed-latency call.
 *    Exhausting the budget returns `"pending"` — distinct from `"failure"`
 *    — so the caller never reports a merely-slow confirmation as a hard
 *    failure (which would invite a duplicate resubmit of a transfer that
 *    may still land)."
 *
 * T7 deletes that private copy and re-points the modal here. Until then two
 * copies exist, deliberately, for one wave.
 *
 * THERE IS NO FOURTH VALUE, and no "probably fine" (design §4,
 * docs/work/migration-execute/plan.md decision 4):
 *
 *   "success" → the step is done; run the NEXT step.
 *   "failure" → the step errored; HALT the chain.
 *   "pending" → the outcome is genuinely UNKNOWN; HALT the chain, label the
 *               step "Submitted — not confirmed", and tell the user that
 *               re-pressing re-reads the chain.
 *
 * Why `"pending"` halts, stated for the case that makes it load-bearing —
 * step C → step D. C (`coin.C_URV|Unstake`) moves urSTOA out of the vault
 * into liquid; D transfers the LIQUID urSTOA. If a `pending` C were treated
 * as a green light, D would read its amount from a balance that does not yet
 * reflect C: either D moves a stale amount, or C lands after D and the
 * unstaked funds sit liquid on the OLD key while the toast reads "done".
 * Both strand funds on a key the account no longer names. Halting costs one
 * more button press; guessing costs the user their money. Design §4's
 * idempotence is what makes the halt cheap — the next press re-reads chain
 * state, so a late-landing transaction is simply OBSERVED, never replayed.
 *
 * Nothing here signs or submits, and the poll is INJECTED (see the plan's
 * mainnet-hazard rule): a unit test of the gate reaches no node and needs no
 * fake timers, because `sleep` is injected too.
 */

/** The three-value verdict. There is deliberately no fourth value. */
export type TxVerdictKind = "success" | "failure" | "pending";

/**
 * A verdict plus the chain's own words for it, when there are any.
 *
 * `message` is passed through VERBATIM — on `"failure"` it is
 * `pollTransactionStatus`'s `error` (the Pact error message), and on an
 * exhausted `"pending"` it is the LAST poll's `error` if the node call itself
 * was failing (`crossChainFunctions.js:224-229` returns
 * `{ status: "pending", error }` when `pollOne` threw). A `"pending"` with no
 * message means the polls came back cleanly and the transaction simply had
 * not been included yet.
 */
export interface TxVerdict {
  readonly verdict: TxVerdictKind;
  readonly message?: string;
}

/**
 * The shape `pollTransactionStatus` resolves to, narrowed to the two fields
 * this module reads. Structural on purpose: `@ouronet/ouronet-core`'s
 * `TransferStatus` (`crossChainFunctions.d.ts:41-50`) is assignable to it,
 * and a test can build one as a literal.
 *
 * Note the FOURTH status, `"not-found"` — a requestKey the node has no record
 * of yet. It is "not landed yet", never a failure.
 */
export interface PolledTxStatus {
  readonly status: "pending" | "success" | "failure" | "not-found";
  readonly error?: string;
}

/** The gate's injected chain edge. Both members exist so the engine's suite
 *  needs neither a network nor `vi.useFakeTimers()`. */
export interface AwaitTxVerdictDeps {
  /** `pollTransactionStatus(requestKey, chainId)` — one snapshot of status. */
  readonly pollTransactionStatus: (requestKey: string, chainId: string) => Promise<PolledTxStatus>;
  /** Delay between polls. Injected so a spec runs in milliseconds. */
  readonly sleep: (ms: number) => Promise<void>;
}

export interface AwaitTxVerdictOptions {
  /** Polls to issue before returning `"pending"`. Default 20. */
  readonly maxAttempts?: number;
  /** Delay between polls, ms. Default 5000. */
  readonly delayMs?: number;
}

/** SendStoaModal.tsx:176-188's budget, to the number: 20 × 5s ≈ 100s. */
const DEFAULT_MAX_ATTEMPTS = 20;
const DEFAULT_DELAY_MS = 5000;

/**
 * Poll `requestKey` on `chainId` until the chain gives a definitive answer or
 * the budget runs out.
 *
 * Returns as soon as the status is `"success"` or `"failure"`. Every other
 * status (`"pending"`, `"not-found"`) is "not landed yet" and is retried;
 * exhausting the budget resolves `"pending"` — NOT `"failure"`.
 */
export async function awaitTxVerdict(
  requestKey: string,
  chainId: string,
  deps: AwaitTxVerdictDeps,
  opts?: AwaitTxVerdictOptions,
): Promise<TxVerdict> {
  const maxAttempts = opts?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const delayMs = opts?.delayMs ?? DEFAULT_DELAY_MS;

  let lastMessage: string | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await deps.pollTransactionStatus(requestKey, chainId);
    lastMessage = status.error ?? undefined;
    if (status.status === "success") return { verdict: "success" };
    if (status.status === "failure") {
      return lastMessage === undefined
        ? { verdict: "failure" }
        : { verdict: "failure", message: lastMessage };
    }
    if (attempt < maxAttempts - 1) await deps.sleep(delayMs);
  }
  return lastMessage === undefined ? { verdict: "pending" } : { verdict: "pending", message: lastMessage };
}

/**
 * The PRODUCTION wiring of {@link AwaitTxVerdictDeps} — the only place in the
 * engine's confirmation path where the real chain function is named, so every
 * leaf executor (T5/T6/T7) and the engine itself share ONE gate instead of
 * growing private copies of it.
 *
 * `pollTransactionStatus` is reached through a dynamic import, the same way
 * `toastManager.ts:299` and `:342` reach their chain imports — the module
 * graph stays lazy, and a consumer that never confirms anything never pulls
 * `getFailoverClient` in.
 *
 * NOTE on the submit side, for the executors that will import this file:
 * every operation the engine invokes submits through `getFailoverClient`,
 * never `CodexSigningStrategy.execute()`. That strategy's own doc comment
 * (`@stoachain/stoa-core/dist/signing/codexStrategy.js:39-56`) says it
 * "deliberately runs without failover (REQ-04) and therefore has NO built-in
 * dedup safety on retry … Better: use `getFailoverClient` directly". The
 * engine is a thing the user RE-PRESSES: a `TIMEOUT` on submit may already
 * have reached chainweb, and a rebuild carries a fresh `creationTime`, so the
 * two copies hash differently, chainweb cannot dedup them, and both land. For
 * a transfer that is paying twice. `getFailoverClient.submit` keeps the same
 * signed-tx reference across primary and fallback, so the dedup contract
 * holds.
 */
export const awaitTxVerdictLiveDeps: AwaitTxVerdictDeps = {
  pollTransactionStatus: async (requestKey: string, chainId: string): Promise<PolledTxStatus> => {
    const { pollTransactionStatus } = await import(
      "@ouronet/ouronet-core/interactions/crossChainFunctions"
    );
    return (await pollTransactionStatus(requestKey, chainId)) as PolledTxStatus;
  },
  sleep: (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }),
};
