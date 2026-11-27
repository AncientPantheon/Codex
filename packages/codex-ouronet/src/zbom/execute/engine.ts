/**
 * engine — `runMigrationChain`, THE UNINTERRUPTED LOOP.
 *
 * The owner's requirement, verbatim: *"once the chained transactions are sent
 * to the blockchain, the UI should be in a loop to send them all. There should
 * be no interrupting it."* So: ONE press runs design §2's chain —
 * A(1..9) → C → B → D → E → F → G — awaiting each confirmation before the
 * next, and never prompting for anything. The codex is unlocked ONCE, before
 * the loop (design §3: "a chain that stops halfway to ask for a password is
 * the interruption the owner ruled out").
 *
 * The order is the PLANNER's, and this loop only walks it. C sits ahead of B
 * because step C now merges `coin.C_URV|Collect` into its transaction and
 * Collect pays out NATIVE STOA — `C_Transmit` on the coin table
 * (`0_Stoa/coin-contract/coin-live.pact:1467-1488`, `:593-598`) — so its
 * rewards land in the balance B moves. See `migrationChain.ts`'s header for
 * the full reasoning; the consequence HERE is that a press which collects
 * reaches the new key in the same press, because this loop lays its toast rows
 * out ONCE and B's row would otherwise already be spent.
 *
 * ## MAINNET HAZARD — the highest in this topic
 *
 * This is the one caller that fires up to a dozen real transactions
 * unattended. It therefore imports NO chain module: not `getFailoverClient`,
 * not `pactRead`, not an `@ouronet/ouronet-core` interaction, not a signer.
 * Every submit, every read and the confirmation gate arrive on a REQUIRED
 * {@link MigrationChainDeps} member with no default to fall back to, and the
 * production assembly of that object lives at the React boundary. A `vi.mock`
 * that a refactor silently drops fails OPEN onto mainnet; an injected seam
 * with no default cannot. `tests/execute-engine.test.ts` builds `deps` out of
 * `vi.fn()`s and additionally asserts this module's import allowlist, over its
 * own source.
 *
 * `CodexSigningStrategy.execute()` is never on this path. Its own doc comment
 * (`@stoachain/stoa-core/dist/signing/codexStrategy.js:39-56`) records that it
 * "deliberately runs without failover (REQ-04) and therefore has NO built-in
 * dedup safety on retry … Better: use `getFailoverClient` directly". The
 * engine is a thing the user RE-PRESSES, so a pipeline without dedup is the
 * wrong pipeline: a `TIMEOUT` on submit may already have reached chainweb, a
 * re-press rebuilds with a fresh `creationTime`, and both land. For a transfer
 * that is paying twice. Every submitter this engine invokes goes through
 * `getFailoverClient` (plan decision 3); `execute()` stays in the modals,
 * driven by a human who can see the result and decide.
 *
 * ## The gate: only `"success"` unblocks. `"failure"` AND `"pending"` HALT
 *
 * Plan decision 4. A halt is RECOVERABLE — the user presses again and the
 * predicates skip whatever landed — so it costs one button press. Treating
 * `"pending"` as a green light does not: the case that makes it load-bearing
 * is C→D. C moves urSTOA out of the vault into liquid; D transfers the LIQUID
 * urSTOA. If a pending C unblocked D, D would read its amount from a balance
 * that does not yet reflect C, and either moves a stale amount or lands before
 * C does — leaving the unstaked funds liquid on the OLD key while the toast
 * reads "done". Both strand funds on a key the account no longer names.
 * Halting costs a press; guessing costs the user their money.
 *
 * ## Re-READ and RE-PLAN after every confirmation
 *
 * `planMigrationChain`'s predicates are read from a snapshot, so D's ("the old
 * key's LIQUID urSTOA > 0") cannot see the liquidity C is about to create, and
 * B's cannot see the chain-0 balance A(n) is about to deliver. A single-plan
 * engine would therefore need a second press for the back half of a fully
 * staked key's chain — which is exactly the interruption the owner ruled out.
 *
 * So after every CONFIRMED step this loop re-reads chain state and re-plans.
 * Planning is pure and free (`codex-core/src/codex/migrationChain.ts` imports
 * nothing), and the fresh plan is the only source of a step's AMOUNT: the
 * engine never guesses a quantity a prior step has not yet produced. The
 * toast's row count cannot change mid-flight, so the rows are laid out once
 * from a PROJECTED plan — see {@link projectChainState} — and each row is then
 * matched against the fresh plan by the step's stable `id`:
 *
 *   - present and executable  → run it, with the fresh amount;
 *   - absent                  → its predicate is no longer true (it landed, or
 *                               a previous press did it) → row marked done,
 *                               "Nothing to do", nothing submitted;
 *   - present, not executable → REPORTED, never run (criterion 9).
 *
 * This is also why re-entry needs no resume branch and no cursor: a second
 * press is byte-identical to the first — read, plan, execute (design §4).
 *
 * ## Steps that are REPORTED rather than run, and do NOT halt the chain
 *
 * FOUR cases, reported on the toast as `error` rows with the explanation in
 * the row's `result` field (the toast's `label` is a 70px ellipsised caption;
 * `result` is its collapsible text field,
 * `MultiStepToastContainer.tsx:128-140`), and then the chain CONTINUES. Say so
 * loudly, because an `error` row normally means a halt. The first three are
 * recorded with `state: "pending"` — never attempted, still owed:
 *
 *  1. **A `define-keyset` the planner marked NOT EXECUTABLE** — the account's
 *     guard is not a keyset-ref, the owner forfeited the update, or the chosen
 *     guard resolved to no keys. Nothing in A-G depends on this step: a
 *     keyset-ref update is a SIBLING of the guard rotation, not a prerequisite.
 *  2. **Dust.** Predicate B is `balance > 0`, but native STOA carries 12
 *     decimals and `drainAmountForPact` refuses a balance that truncates to
 *     zero — a `0.0` transfer burns gas and moves nothing. The threshold
 *     belongs in the predicate; until it lives there, the engine must not let
 *     a sub-picostoa crumb halt the chain, because a halt on dust is the one
 *     halt re-pressing cannot clear: the next press reads the same crumb and
 *     halts again, forever, and F and G never run.
 *  3. **No destination.** `planMigrationChain`'s fund predicates (A-E) read
 *     balances only — they do not know whether the user chose a new payment
 *     key. A guard-only migration therefore plans a drain with nowhere to
 *     drain TO. Running A-E then would be pointless gas at best (A) and
 *     actively harmful at worst (C unstakes, losing staking rewards, to move
 *     funds nowhere). They are reported and skipped; F is not planned at all
 *     in that case, and G still runs.
 *  4. **A `define-keyset` that was ATTEMPTED and did not succeed.** THE ONE
 *     CARVE-OUT IN THE GATE, and the only place in this engine where a
 *     `"failure"` verdict, a `"pending"` verdict, an unconfirmable submit and
 *     a THROW are all reported instead of halting. (The record keeps the
 *     truth: `"failed"` once something was submitted, `"pending"` only when
 *     nothing was.)
 *
 *     Why this kind and no other: a keyset in `ouronet-ns` cannot be redefined
 *     by a user AT ALL. That namespace's USER guard is the protocol's own
 *     `ns-operate-keyset` (`0_Stoa/genesis/stoa-genesis-1.pact:110-113`), and
 *     `guards/resolveGuardKeys.ts:76`'s worked example of a real account guard
 *     is `"ouronet-ns.dh_ah-keyset"`. The step sits LAST (the planner
 *     suppresses G for the same two selection kinds that create it) and
 *     nothing depends on it, so a halt here would report a migration whose
 *     every fund-moving step and rotation LANDED as failed — over a
 *     transaction its owner can never make succeed. That one rule is also
 *     what covers an unsatisfiable current keyset that slipped past the §5
 *     gate and any chain-side surprise, which is why no namespace read is
 *     needed anywhere in this topic.
 *
 *     It is a carve-out PER KIND, deliberately: `"pending"` on any other step
 *     halts because the NEXT step would read an amount from a balance this one
 *     has not changed yet. Nothing reads from this one.
 *
 * ## `execution.steps` is a RECORD, authoritative for NOTHING
 *
 * Every attempted step is recorded through `deps.recordStep`
 * (`store.ts:1895`'s `recordMigrationExecutionStep`, which merges by id). The
 * engine NEVER reads it back — design §4 settled that the chain is the only
 * authority and a recorded `txHash` is a hint. That is not a convention here
 * but a structural fact: `MigrationChainDeps` has no member that could return
 * a history. The recorded states mean:
 *
 *   `"running"`   submitted (or about to be), outcome not yet known;
 *   `"confirmed"` the chain said success;
 *   `"failed"`    submitted and the chain said no — OR the outcome is unknown
 *                 and a re-press must re-read it;
 *   `"pending"`   never attempted, still owed, with `error` saying why.
 */

import {
  planMigrationChain,
  checkMigrationPreconditions,
  paymentKeyAccountString,
  CONSOLIDATION_SOURCE_CHAINS,
  STOA_CONSOLIDATION_TARGET_CHAIN,
  type ChainStateSnapshot,
  type MigrationChainIntent,
  type MigrationChainPlan,
  type MigrationChainStep,
  type MigrationChainStepKind,
  type MigrationExecutionStep,
  type MigrationPreconditionFailure,
  type MigrationPreconditionInputs,
} from "@ancientpantheon/codex-core";
import { formatDecimalForPact } from "@stoachain/stoa-core/pact";
import {
  createMultiStepToast,
  type StepStatus,
  type ToastController,
} from "../toast/toastManager.js";
import {
  CROSSCHAIN_TOAST_STEPS,
  offsetStepReporter,
  type CrossChainStepReporter,
  type CrossChainStoaTransferResult,
} from "./crossChainStoaTransfer.js";
import { drainAmountForPact, STOA_DECIMALS } from "./nativeStoaTransfer.js";
import { URSTOA_PRECISION } from "./urStoaOps.js";
import type { TxVerdict } from "./awaitConfirmation.js";
import type { ChainStateQuery } from "./chainState.js";
import type { RotateSubmitResult } from "./rotateOps.js";

// ─── What the caller asks for ───────────────────────────────────────────────

/**
 * The migration, as the user's recorded choices describe it.
 *
 * `intent` is codex-core's own type, built from `MigrationPendingPlan`
 * (`paymentPublicKey` + `guardPublicKeys` + `guardPred` + the recorded
 * selection kind). The NEW payment key's ACCOUNT STRING is derived here rather
 * than passed, through `paymentKeyAccountString` — always `k:<bare>`, for
 * every seed type (see that function's own doc for the mainnet defect the
 * seed-type branch caused). There is deliberately NO seed-type member on this
 * request: nothing the engine does depends on one.
 */
export interface MigrationChainRequest {
  readonly intent: MigrationChainIntent;
  /** The payment-key ADDRESS funds are being moved OFF. */
  readonly oldPaymentAddress: string;
  /** The Ouronet account whose registered payment key and guard F and G
   *  change. */
  readonly accountAddress: string;
  /** Overrides the toast's title. */
  readonly toastTitle?: string;
}

/** The §5 precondition facts the caller has already gathered — guard
 *  analyses, the patron's IGNIS and the per-transaction `ignis-need` all live
 *  at the React boundary, so the engine asks for them instead of reading
 *  them. {@link MigrationPreconditionInputs} minus the plan, which is the
 *  engine's own. */
export type MigrationPreconditionFacts = Omit<MigrationPreconditionInputs, "steps">;

// ─── What each injected submitter is handed ─────────────────────────────────

/** A(n) — one consolidation hop, source chain 1-9 → chain 0, SAME key. */
export interface ConsolidateStoaStepRequest {
  readonly sourceChain: string;
  readonly targetChain: string;
  /** The OLD key, on both sides: consolidation moves a key's own funds
   *  between chains. */
  readonly sender: string;
  readonly receiver: string;
  /** Already a Pact decimal literal (`drainAmountForPact`). */
  readonly amount: string;
  /** This hop's three toast rows, mapped onto the engine's own toast by
   *  {@link offsetStepReporter}. */
  readonly onStep: CrossChainStepReporter;
}

/** B — the chain-0 drain, OLD key → NEW key. */
export interface DrainStoaStepRequest {
  readonly sender: string;
  readonly receiver: string;
  readonly amount: string;
  readonly chainId: string;
}

/** C and E — the vault operations, which have no destination: staking acts on
 *  the account itself. `address` is the OLD key for C and the NEW key for E. */
export interface UrStoaVaultStepRequest {
  readonly address: string;
  readonly amount: string;
  readonly chainId: string;
  /**
   * C only, and only when the OLD key has claimable rewards: build ONE
   * transaction carrying `(coin.C_URV|Collect …)` ahead of
   * `(coin.C_URV|Unstake …)`, so no reward dust is left behind (design §1).
   *
   * ABSENT rather than `false` when there is nothing to collect, because a
   * Collect with zero claimable rewards FAILS THE WHOLE TRANSACTION —
   * `coin-live.pact:708-721`'s `debit` enforces `(> amount 0.0)` (`:414-418`)
   * — which would take the unstake down with it. Not an amount: Collect takes
   * only the account and pays out whatever is claimable at execution time.
   */
  readonly collectRewards?: boolean;
}

/** D — liquid urSTOA, OLD key → NEW key. */
export interface TransferUrStoaStepRequest {
  readonly senderAddress: string;
  readonly receiverAddress: string;
  readonly amount: string;
  readonly chainId: string;
}

/** F — `TS01-C1.DALOS|C_RotateStoa`. `newPaymentKey` is the ACCOUNT-STRING
 *  form (design §5), already converted. */
export interface RotatePaymentKeyStepRequest {
  readonly accountAddress: string;
  readonly newPaymentKey: string;
  readonly chainId: string;
}

/**
 * The keyset-definition update —
 * `(define-keyset "<ns>.<ksn>" (read-keyset "ks"))`, with `.addData("ks", {
 * keys, pred })` carrying the NEW definition (design §2).
 *
 * `payerAddress` is NOT decoration. This is the one transaction in the whole
 * chain the Ouronet gas station cannot sponsor: `DALOS.GAS_PAYER`
 * (`1_SOVEREIGN/STAGE_01/2_Core/01_DALOS.pact:456-526`) accepts exactly three
 * transaction shapes and a bare `(define-keyset …)` matches none of them, so
 * the gas is self-paid by a real STOA sender account. The engine takes it from
 * the FRESH snapshot's registered payment key — after F that is the NEW key,
 * which is where B has just put every STOA.
 */
export interface DefineKeysetStepRequest {
  /** The qualified `"<ns>.<ksn>"` being redefined, from the live guard. */
  readonly keysetRef: string;
  /** The NEW definition. */
  readonly keys: readonly string[];
  readonly pred: string;
  /** The STOA account paying this transaction's own gas. */
  readonly payerAddress: string;
  readonly chainId: string;
}

/** G — `TS01-C1.DALOS|C_RotateGuard`, LAST. */
export interface RotateGuardStepRequest {
  readonly accountAddress: string;
  readonly guard: { readonly keys: readonly string[]; readonly pred: string };
  readonly chainId: string;
}

/** What a single-transaction submitter hands back. `requestKey` is the handle
 *  the confirmation gate polls — never evidence anything landed. */
export interface MigrationSubmission {
  readonly requestKey: string;
}

// ─── The injected world ─────────────────────────────────────────────────────

/**
 * Everything the engine cannot do itself. Every member is REQUIRED except the
 * toast factory (display only, no network) — see this module's header for why
 * there are no defaults on the chain side.
 */
export interface MigrationChainDeps {
  /**
   * The `ensureCodexUnlocked` gate (`zbom/hooks/useEnsureCodexUnlocked.ts`),
   * as a single callable. Called ONCE, before the loop. `false` means the user
   * declined, and nothing is read or submitted.
   */
  readonly ensureCodexUnlocked: () => Promise<boolean>;
  /** `readChainState` (`./chainState.ts`) — design §4's predicates, read from
   *  chain. Called once before the loop and again after every confirmation. */
  readonly readChainState: (query: ChainStateQuery) => Promise<ChainStateSnapshot>;
  /** The §5 facts, gathered once, for the plan that is about to run. */
  readonly readPreconditionFacts: (plan: MigrationChainPlan) => Promise<MigrationPreconditionFacts>;
  /** `awaitTxVerdict` (`./awaitConfirmation.ts`) — the verdict-returning gate.
   *  NEVER `pollStoaChainConfirmation`, whose timeout and success are
   *  indistinguishable from a caller's side. */
  readonly confirm: (requestKey: string, chainId: string) => Promise<TxVerdict>;
  readonly submitConsolidateStoa: (
    req: ConsolidateStoaStepRequest,
  ) => Promise<CrossChainStoaTransferResult>;
  readonly submitDrainStoa: (req: DrainStoaStepRequest) => Promise<MigrationSubmission>;
  readonly submitUnstakeUrStoa: (req: UrStoaVaultStepRequest) => Promise<MigrationSubmission>;
  readonly submitTransferUrStoa: (req: TransferUrStoaStepRequest) => Promise<MigrationSubmission>;
  readonly submitStakeUrStoa: (req: UrStoaVaultStepRequest) => Promise<MigrationSubmission>;
  readonly submitRotatePaymentKey: (
    req: RotatePaymentKeyStepRequest,
  ) => Promise<RotateSubmitResult>;
  readonly submitRotateGuard: (req: RotateGuardStepRequest) => Promise<RotateSubmitResult>;
  /**
   * The keyset-definition update. OPTIONAL — the only member that is, on the
   * chain side — because this interface ships one wave ahead of the React
   * boundary that names the real builder. Absent means the step is REPORTED
   * with {@link NO_KEYSET_SUBMITTER_MESSAGE} and the chain continues, which is
   * a legitimate state rather than a crash.
   *
   * Optional does NOT mean defaulted: there is still no fallback here that
   * could reach a node. An absent submitter submits nothing.
   */
  readonly submitDefineKeyset?: (req: DefineKeysetStepRequest) => Promise<RotateSubmitResult>;
  /** `recordMigrationExecutionStep` (`store.ts:1895`). Write-only — the engine
   *  never reads what it recorded, and this interface gives it no way to. */
  readonly recordStep: (step: MigrationExecutionStep) => void | Promise<void>;
  /** Injected only so a spec can observe the rows; defaults to the real
   *  `createMultiStepToast`, which touches no network. */
  readonly createToast?: (opts: {
    title: string;
    steps: Array<{ label: string }>;
  }) => ToastController;
}

// ─── What the caller gets back ──────────────────────────────────────────────

/** Why the chain stopped. `"flow-failed"` is a cross-chain hop's own
 *  discriminated failure (`CrossChainStoaTransferFailureKind`), which the hop
 *  has ALREADY reported on its own toast row. */
export type MigrationChainHaltReason =
  | "failure"
  | "pending"
  | "threw"
  | "not-submitted"
  | "flow-failed";

export interface MigrationChainHalt {
  readonly stepId: string;
  readonly kind: MigrationChainStepKind;
  readonly reason: MigrationChainHaltReason;
  readonly message: string;
  /** The user's handle for checking a transaction themselves instead of
   *  resubmitting it. Absent when nothing was submitted. */
  readonly requestKey?: string;
}

/** A step that was REPORTED and never submitted — see this module's header. */
export interface MigrationChainReport {
  readonly stepId: string;
  readonly kind: MigrationChainStepKind;
  readonly message: string;
}

export type MigrationChainOutcome =
  | { readonly status: "locked"; readonly message: string }
  | { readonly status: "nothing-to-do"; readonly plan: MigrationChainPlan }
  | {
      readonly status: "refused";
      readonly plan: MigrationChainPlan;
      readonly message: string;
      readonly failures: readonly MigrationPreconditionFailure[];
    }
  | {
      readonly status: "completed";
      readonly plan: MigrationChainPlan;
      readonly confirmed: readonly string[];
      readonly skipped: readonly string[];
      readonly reported: readonly MigrationChainReport[];
    }
  | {
      readonly status: "halted";
      readonly plan: MigrationChainPlan;
      readonly confirmed: readonly string[];
      readonly skipped: readonly string[];
      readonly reported: readonly MigrationChainReport[];
      readonly halt: MigrationChainHalt;
    };

// ─── The step vocabulary, in ONE place ──────────────────────────────────────

/** One planned step, described for a human — the pre-press list and the
 *  toast's rows both come from here, so they cannot disagree. */
export interface MigrationChainStepDescription {
  readonly id: string;
  readonly kind: MigrationChainStepKind;
  /** One line, for the pre-press list. */
  readonly title: string;
  /** The quantity the predicate observed, when the step moves one. */
  readonly detail?: string;
  readonly executable: boolean;
  readonly notExecutableReason?: string;
  /** The toast rows this step occupies: THREE for a consolidation hop (it is
   *  a three-step flow), one for everything else. */
  readonly toastLabels: readonly string[];
}

function titleOf(step: MigrationChainStep): string {
  switch (step.kind) {
    case "consolidate-stoa":
      return `Consolidate chain ${step.chainId} onto chain ${STOA_CONSOLIDATION_TARGET_CHAIN}`;
    case "drain-stoa":
      return "Move native STOA to the new payment key";
    case "unstake-urstoa":
      return "Unstake urSTOA from the vault";
    case "move-urstoa":
      return "Move urSTOA to the new payment key";
    case "restake-urstoa":
      return "Re-stake urSTOA on the new payment key";
    case "rotate-payment-key":
      return "Rotate the account's payment key";
    case "rotate-guard":
      return "Rotate the account's guard";
    case "define-keyset":
      return "Update the keyset definition";
  }
}

function toastLabelsOf(step: MigrationChainStep): readonly string[] {
  if (step.kind === "consolidate-stoa") {
    // The modal's own three labels (`CROSSCHAIN_TOAST_STEPS`, pinned by
    // `tests/ui-send-stoa-modal.test.tsx`), prefixed with the chain so the
    // ninth hop's rows cannot be mistaken for the first's.
    return CROSSCHAIN_TOAST_STEPS.map((s) => `Chain ${step.chainId}: ${s.label}`);
  }
  return [titleOf(step)];
}

/**
 * Describe a plan for a human, BEFORE the press.
 *
 * Exported for T11's pre-press list: the UI renders what is about to happen
 * without re-inventing the step vocabulary the toast uses.
 */
export function describeMigrationChainPlan(
  plan: MigrationChainPlan,
): readonly MigrationChainStepDescription[] {
  return plan.steps.map((step) => ({
    id: step.id,
    kind: step.kind,
    title: titleOf(step),
    ...(step.amount !== undefined ? { detail: String(step.amount) } : {}),
    executable: step.executable,
    ...(step.notExecutableReason !== undefined
      ? { notExecutableReason: step.notExecutableReason }
      : {}),
    toastLabels: toastLabelsOf(step),
  }));
}

// ─── Amounts ────────────────────────────────────────────────────────────────

/**
 * The Pact decimal literal a step moves, or `null` when the observed balance
 * is DUST — below the token's own precision, so the transaction would move
 * nothing (see this module's header, case 2).
 *
 * Native STOA goes through `drainAmountForPact`, which owns the truncation
 * rule and the no-gas-reserve decision and REFUSES a zero amount; that throw
 * is the dust signal, caught here rather than re-implemented. urSTOA carries
 * `URSTOA_PRECISION` decimals and is canonicalised the same way the vault
 * operations canonicalise it.
 */
function movableAmount(step: MigrationChainStep): string | null {
  const balance = step.amount;
  if (typeof balance !== "number" || !Number.isFinite(balance) || balance <= 0) return null;
  if (step.kind === "consolidate-stoa" || step.kind === "drain-stoa") {
    try {
      return drainAmountForPact(balance);
    } catch {
      return null;
    }
  }
  // One digit more than the precision, so the truncation has a digit to drop
  // rather than a float rounding to inherit, and in FIXED notation because
  // Pact's decimal lexer rejects `"1e-7"`.
  const amount = formatDecimalForPact(balance.toFixed(URSTOA_PRECISION + 1), URSTOA_PRECISION);
  return Number(amount) === 0 ? null : amount;
}

// ─── Toast layout ───────────────────────────────────────────────────────────

/**
 * The snapshot as it will look once every step the CURRENT plan contains has
 * landed — used for ONE thing only: counting the toast's rows.
 *
 * The engine re-plans after every confirmation (see this module's header), so
 * steps APPEAR mid-press: A(n) delivers the chain-0 balance B needs, C creates
 * the liquid urSTOA D needs, D creates the liquid urSTOA E needs. A toast's row
 * count cannot change once it is created, so the rows are laid out over this
 * projection — the superset of what may run this press — and each row is then
 * matched against the fresh plan by id.
 *
 * It is deliberately run through `planMigrationChain` rather than through a
 * hand-written list of step ids: the ORDER and the step vocabulary stay the
 * planner's, and a step added there appears here with no change.
 *
 * The projected AMOUNTS are never submitted. They exist to make a predicate
 * true, nothing more; every amount that reaches a submitter comes from a fresh
 * read. Only non-negative finite balances are summed, so one `NaN` from a
 * failed coercion cannot erase a row the real plan already holds.
 */
export function projectChainState(snapshot: ChainStateSnapshot): ChainStateSnapshot {
  const positive = (value: number | undefined): number =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
  const chains = snapshot.oldKeyStoaPerChain;
  const swept = CONSOLIDATION_SOURCE_CHAINS.reduce(
    (total, chainId) => total + positive(chains[chainId]),
    0,
  );
  const liquid = positive(snapshot.oldKeyUrStoaLiquid) + positive(snapshot.oldKeyUrStoaStaked);
  return {
    ...snapshot,
    oldKeyStoaPerChain: {
      ...chains,
      [STOA_CONSOLIDATION_TARGET_CHAIN]:
        positive(chains[STOA_CONSOLIDATION_TARGET_CHAIN]) + swept,
    },
    oldKeyUrStoaLiquid: liquid,
    newKeyUrStoaLiquid: positive(snapshot.newKeyUrStoaLiquid) + liquid,
  };
}

/**
 * The steps whose whole purpose is moving funds TO the new payment key — all
 * of A-E (design §2 calls them "the drain").
 *
 * A consolidation hop and an unstake act on the old key alone, so they look
 * destination-free, and they are included anyway: consolidating for a
 * migration that has no new key is pointless gas, and unstaking would GIVE UP
 * a staking position to move funds nowhere. `planMigrationChain`'s fund
 * predicates read balances only and cannot see whether a new key was chosen,
 * so the engine is where that is checked.
 */
const NEEDS_DESTINATION: readonly MigrationChainStepKind[] = [
  "consolidate-stoa",
  "drain-stoa",
  "unstake-urstoa",
  "move-urstoa",
  "restake-urstoa",
];

const NO_DESTINATION_MESSAGE =
  "This step moves funds to the new payment key, but no new payment key was chosen — "
  + "there is nothing to move them to. Reported rather than run: the guard rotation does "
  + "not depend on it.";

const NOTHING_TO_DO_LABEL = "Nothing to do";
const NOT_EXECUTABLE_LABEL = "Not executable";
/** The keyset step's own row label: it is NOT the chain failing, and the row
 *  must not read as if it were (see this module's header, case 4). */
const KEYSET_NOT_UPDATED_LABEL = "Keyset not updated";

/** `deps.submitDefineKeyset` is absent — nothing was attempted. */
const NO_KEYSET_SUBMITTER_MESSAGE =
  "The keyset update could not be attempted because no submitter is wired for it in this "
  + "build. Nothing was submitted for this step, and the rest of the migration ran "
  + "normally.";

/** The fresh snapshot has no registered payment key, so there is no STOA
 *  account to pay this step's self-paid gas. */
const NO_KEYSET_GAS_PAYER_MESSAGE =
  "The keyset update needs a STOA account to pay its own gas — it is the one transaction "
  + "in this chain the Ouronet gas station cannot sponsor — and this account has no "
  + "payment key on record. Nothing was submitted for this step, and the rest of the "
  + "migration ran normally.";

/** What is appended to a `define-keyset` outcome that would halt any other
 *  step. Keeps the chain's OWN words first and the house explanation after. */
function keysetContinuedMessage(detail: string): string {
  return (
    `${detail} — the keyset update is reported rather than halted on: nothing else in the `
    + `migration depends on it, and a keyset whose namespace is protocol-held cannot be `
    + `redefined by its owner at all. The rest of the migration ran normally. Press again `
    + `once the keyset's own signers are available; every other step is gated on chain `
    + `state and will simply be skipped.`
  );
}
const NO_DESTINATION_LABEL = "No destination";
const DUST_LABEL = "Nothing transferable";

/** Why a step the predicate selected moves nothing after all. The precision is
 *  named because the number the user can see in the UI is not the number the
 *  chain can represent. */
function dustMessage(step: MigrationChainStep): string {
  const decimals =
    step.kind === "consolidate-stoa" || step.kind === "drain-stoa"
      ? STOA_DECIMALS
      : URSTOA_PRECISION;
  return (
    `A balance of ${String(step.amount)} selected this step, but the token carries `
    + `${decimals} decimals and that amount truncates to zero — there is nothing `
    + `transferable here. A 0.0 transfer burns gas and moves nothing, so the step is `
    + `reported and the rest of the chain continues.`
  );
}

interface PlannedRow {
  readonly step: MigrationChainStep;
  /** Index of this step's FIRST row in the engine's toast. */
  readonly firstRow: number;
  readonly labels: readonly string[];
}

function layoutRows(steps: readonly MigrationChainStep[]): readonly PlannedRow[] {
  const rows: PlannedRow[] = [];
  let next = 0;
  for (const step of steps) {
    const labels = toastLabelsOf(step);
    rows.push({ step, firstRow: next, labels });
    next += labels.length;
  }
  return rows;
}

const DEFAULT_TOAST_TITLE = "Migrating keys and funds";

const LOCKED_MESSAGE =
  "The codex stayed locked, so nothing was read and nothing was submitted. "
  + "The migration chain unlocks once, before the first transaction, and never "
  + "asks again while it runs.";

// ─── The loop ───────────────────────────────────────────────────────────────

/**
 * Run design §2's chain to completion in one press.
 *
 * Never prompts, never opens a modal and never awaits user input: `deps`
 * carries nothing it could ask a question with. See this module's header for
 * the gate, the re-planning rule and the three cases that are reported rather
 * than run.
 */
export async function runMigrationChain(
  req: MigrationChainRequest,
  deps: MigrationChainDeps,
): Promise<MigrationChainOutcome> {
  // 1 — unlock ONCE, up front (design §3).
  if (!(await deps.ensureCodexUnlocked())) {
    return { status: "locked", message: LOCKED_MESSAGE };
  }

  // The NEW payment key's ACCOUNT STRING — `k:<bare>`, derived once here and
  // used for F's third argument AND for every transfer's destination.
  const newPaymentAddress =
    req.intent.newPaymentPublicKey === null
      ? null
      : paymentKeyAccountString(req.intent.newPaymentPublicKey);

  const query: ChainStateQuery = {
    oldPaymentAddress: req.oldPaymentAddress,
    // With no new payment key there is nothing to move funds TO, so every
    // A-E row is reported rather than run; the read is pointed at the old
    // address rather than at an invented one the chain would reject.
    newPaymentAddress: newPaymentAddress ?? req.oldPaymentAddress,
    accountAddress: req.accountAddress,
  };

  // 2 — read once, plan once, check preconditions once (design §5).
  const snapshot = await deps.readChainState(query);
  const plan = planMigrationChain(snapshot, req.intent);
  if (plan.nothingToDo) return { status: "nothing-to-do", plan };

  // The §5 gate runs over the PROJECTED steps — everything that may be
  // submitted this press — so the aggregate gas check cannot be short by a
  // rotation the re-plan is about to add.
  const projected = planMigrationChain(projectChainState(snapshot), req.intent);
  const facts = await deps.readPreconditionFacts(projected);
  const verdict = checkMigrationPreconditions({ steps: projected.steps, ...facts });
  if (!verdict.ok) {
    return {
      status: "refused",
      plan,
      message: verdict.message,
      failures: verdict.failures,
    };
  }

  // 3 — ONE toast, one row per step that MAY run this press (see
  // `projectChainState`), three per consolidation hop.
  const rows = layoutRows(projected.steps);
  const toast = (deps.createToast ?? createMultiStepToast)({
    title: req.toastTitle ?? DEFAULT_TOAST_TITLE,
    steps: rows.flatMap((row) => row.labels.map((label) => ({ label }))),
  });

  /** Reported WITHOUT a third argument when there is no data, never with an
   *  explicit `undefined`: a caller (and its spec) compares the whole
   *  argument list, and `(1, "done", undefined)` is not `(1, "done")`. */
  const report = (
    row: number,
    status: StepStatus,
    data?: { label?: string; requestKey?: string; result?: string },
  ): void => {
    if (data === undefined) toast.updateStep(row, status);
    else toast.updateStep(row, status, data);
  };

  /** Write-only: the engine records what it DID and never reads it back
   *  (design §4 — authoritative for nothing). */
  const record = async (step: MigrationExecutionStep): Promise<void> => {
    await deps.recordStep(step);
  };

  const confirmed: string[] = [];
  const skipped: string[] = [];
  const reported: MigrationChainReport[] = [];

  // The plan the row under consideration is matched against, and whether a
  // confirmation has made it stale. Declared before the gate, which sets the
  // flag the moment a step confirms.
  let current = plan;
  // The snapshot `current` was planned from. Kept because one step needs a
  // FACT from it and not just an amount: the keyset update's self-paid gas
  // payer is the account's registered payment key, which F changes mid-chain.
  let currentSnapshot = snapshot;
  let stale = false;

  const haltedWith = (halt: MigrationChainHalt): MigrationChainOutcome => ({
    status: "halted",
    plan,
    confirmed,
    skipped,
    reported,
    halt,
  });

  /**
   * The GATE (plan decision 4), applied identically to every step: poll the
   * verdict, and let ONLY `"success"` through.
   *
   * `pollRequestKey` is what the chain is asked about — for a consolidation hop
   * that is the CONTINUATION key, because the continuation is what lands the
   * funds on chain 0. `recordTxHash` is what the record carries, which for a
   * hop is the INITIATE key: the handle for the whole transfer.
   *
   * @returns the halt, or `null` when the step confirmed and the next may run.
   */
  const gate = async (args: {
    step: MigrationChainStep;
    row: number;
    pollRequestKey: string;
    chainId: string;
    recordTxHash: string;
  }): Promise<MigrationChainHalt | null> => {
    const { step, row, pollRequestKey, chainId, recordTxHash } = args;
    if (pollRequestKey === "") {
      report(row, "error", { label: NOT_CONFIRMABLE_LABEL, result: NOT_SUBMITTED_MESSAGE });
      await record({ id: step.id, state: "failed", error: NOT_SUBMITTED_MESSAGE });
      return {
        stepId: step.id,
        kind: step.kind,
        reason: "not-submitted",
        message: NOT_SUBMITTED_MESSAGE,
      };
    }

    const verdict = await deps.confirm(pollRequestKey, chainId);

    if (verdict.verdict === "success") {
      report(row, "done", { label: CONFIRMED_LABEL, requestKey: pollRequestKey });
      await record({ id: step.id, state: "confirmed", txHash: recordTxHash });
      confirmed.push(step.id);
      // Something on chain changed, so the next row's predicate — and its
      // amount — must come from a fresh read.
      stale = true;
      return null;
    }

    if (verdict.verdict === "failure") {
      const message = verdict.message ?? STEP_FAILED_MESSAGE;
      report(row, "error", { label: STEP_FAILED_LABEL, result: message });
      await record({ id: step.id, state: "failed", txHash: recordTxHash, error: message });
      return {
        stepId: step.id,
        kind: step.kind,
        reason: "failure",
        message,
        requestKey: pollRequestKey,
      };
    }

    // "pending" — the budget ran out and the outcome is genuinely UNKNOWN.
    // NOT an error row: nothing is known to have gone wrong, and phrasing it
    // as a failure is what invites a duplicate resubmit of money in flight.
    const message = pendingMessage(pollRequestKey, chainId);
    report(row, "done", { label: PENDING_LABEL, requestKey: pollRequestKey });
    await record({ id: step.id, state: "failed", txHash: recordTxHash, error: message });
    return {
      stepId: step.id,
      kind: step.kind,
      reason: "pending",
      message,
      requestKey: pollRequestKey,
    };
  };

  /** Mark every row of a step's group done — nothing was submitted. */
  const reportNothingToDo = (row: PlannedRow): void => {
    row.labels.forEach((_label, index) => {
      if (index === 0) report(row.firstRow, "done", { label: NOTHING_TO_DO_LABEL });
      else report(row.firstRow + index, "done");
    });
  };

  /** Report a step that is NOT going to run, and let the chain continue. The
   *  long explanation goes in the row's collapsible `result` field; the
   *  `label` is a 70px ellipsised caption. */
  const reportNotRun = async (
    row: PlannedRow,
    step: MigrationChainStep,
    label: string,
    message: string,
  ): Promise<void> => {
    report(row.firstRow, "error", { label, result: message });
    await record({ id: step.id, state: "pending", error: message });
    reported.push({ stepId: step.id, kind: step.kind, message });
  };

  /**
   * A `define-keyset` outcome that would HALT any other step — see this
   * module's header, case 4. The gate (or the `catch`) has already recorded
   * what happened, truthfully; this only re-labels the row so it does not read
   * as a stopped chain, and adds the step to `reported`.
   */
  const reportKeysetAndContinue = (row: PlannedRow, step: MigrationChainStep, detail: string): void => {
    const message = keysetContinuedMessage(detail);
    report(row.firstRow, "error", { label: KEYSET_NOT_UPDATED_LABEL, result: message });
    reported.push({ stepId: step.id, kind: step.kind, message });
  };

  // 4 — walk the rows in design §2's order.
  //
  // `current` is the plan the row being considered is matched against: the
  // first row uses the plan the preconditions were checked over, and every row
  // after a CONFIRMED step uses a freshly read one. The read is lazy — taken
  // at the top of the next iteration rather than after the confirmation — so
  // the last step of a chain costs no extra read.
  for (const row of rows) {
    if (stale) {
      // A failed re-read is an ORDINARY RPC blip, and it arrives after real
      // transactions have already landed — exactly the state the user most
      // needs reported. Halting is safe (the next press re-reads everything);
      // an escaped rejection would leave the toast spinning and the caller
      // with no outcome at all.
      try {
        currentSnapshot = await deps.readChainState(query);
        current = planMigrationChain(currentSnapshot, req.intent);
      } catch (error) {
        const message = readFailedMessage(error);
        report(row.firstRow, "error", { label: READ_FAILED_LABEL, result: message });
        await record({ id: row.step.id, state: "pending", error: message });
        return haltedWith({
          stepId: row.step.id,
          kind: row.step.kind,
          reason: "threw",
          message,
        });
      }
      stale = false;
    }

    // Matched by the step's STABLE id, never by position: that is what lets
    // the fresh plan answer "is this still owed, and for how much?".
    const step = current.steps.find((candidate) => candidate.id === row.step.id);
    if (step === undefined) {
      // The predicate is no longer true — it landed, an earlier press did it,
      // or the balance moved. Design §4: the chain is the authority, so this
      // is not an error and nothing is submitted.
      reportNothingToDo(row);
      skipped.push(row.step.id);
      continue;
    }

    const amount = movableAmount(step);
    report(row.firstRow, "active");

    // Reported, never run, and NOT a halt — see this module's header.
    if (!step.executable) {
      await reportNotRun(
        row,
        step,
        NOT_EXECUTABLE_LABEL,
        step.notExecutableReason ?? "This step is not executable.",
      );
      continue;
    }
    if (NEEDS_DESTINATION.includes(step.kind) && newPaymentAddress === null) {
      await reportNotRun(row, step, NO_DESTINATION_LABEL, NO_DESTINATION_MESSAGE);
      continue;
    }
    if (step.amount !== undefined && amount === null) {
      await reportNotRun(row, step, DUST_LABEL, dustMessage(step));
      continue;
    }
    // The two ways an EXECUTABLE keyset step still cannot be attempted. Both
    // are checked before anything is recorded as `"running"`, so the record
    // keeps saying "never attempted, still owed".
    if (step.kind === "define-keyset") {
      if (deps.submitDefineKeyset === undefined) {
        await reportNotRun(row, step, KEYSET_NOT_UPDATED_LABEL, NO_KEYSET_SUBMITTER_MESSAGE);
        continue;
      }
      if (currentSnapshot.registeredPaymentKey === null) {
        await reportNotRun(row, step, KEYSET_NOT_UPDATED_LABEL, NO_KEYSET_GAS_PAYER_MESSAGE);
        continue;
      }
    }

    // Every step that MOVES a quantity has a real, non-dust amount by here —
    // the two branches above are the only ways `amount` can be null for one.
    // The rotations move nothing and ignore this value.
    const amountToMove = amount ?? MOVES_NOTHING;

    try {
      if (step.kind === "consolidate-stoa") {
        await record({ id: step.id, state: "running" });
        const result = await deps.submitConsolidateStoa({
          sourceChain: step.chainId ?? STOA_CONSOLIDATION_TARGET_CHAIN,
          targetChain: STOA_CONSOLIDATION_TARGET_CHAIN,
          sender: req.oldPaymentAddress,
          receiver: req.oldPaymentAddress,
          amount: amountToMove,
          onStep: offsetStepReporter(report, row.firstRow),
        });
        if (!result.ok) {
          // The hop has ALREADY reported its own failing row, and its four
          // failure kinds are a judgement this engine must not re-phrase:
          // `spv-timeout` in particular means the initiate LANDED and the
          // funds are in escrow, so nothing may be re-sent.
          await record({
            id: step.id,
            state: "failed",
            ...(result.requestKey !== undefined ? { txHash: result.requestKey } : {}),
            error: result.message,
          });
          return haltedWith({
            stepId: step.id,
            kind: step.kind,
            reason: "flow-failed",
            message: result.message,
            ...(result.requestKey !== undefined ? { requestKey: result.requestKey } : {}),
          });
        }
        await record({ id: step.id, state: "running", txHash: result.requestKey });
        const halt = await gate({
          step,
          row: row.firstRow + 2,
          pollRequestKey: result.continuationRequestKey,
          chainId: STOA_CONSOLIDATION_TARGET_CHAIN,
          recordTxHash: result.requestKey,
        });
        if (halt) return haltedWith(halt);
        continue;
      }

      await record({ id: step.id, state: "running" });
      const submission = await submitSingleStep(step, {
        req,
        deps,
        newPaymentAddress,
        amount: amountToMove,
        snapshot: currentSnapshot,
      });
      const requestKey = submission.requestKey ?? "";
      if (requestKey !== "") await record({ id: step.id, state: "running", txHash: requestKey });
      const halt = await gate({
        step,
        row: row.firstRow,
        pollRequestKey: requestKey,
        chainId: step.chainId ?? STOA_CONSOLIDATION_TARGET_CHAIN,
        recordTxHash: requestKey,
      });
      if (halt) {
        if (step.kind === "define-keyset") {
          reportKeysetAndContinue(row, step, halt.message);
          continue;
        }
        return haltedWith(halt);
      }
    } catch (error) {
      // Something OUTSIDE the flow's own vocabulary: a locked codex, a refused
      // node, a failed simulation. Letting it escape would leave the toast
      // spinning and the caller with no outcome to report.
      const message = error instanceof Error ? error.message : String(error);
      await record({ id: step.id, state: "failed", error: message });
      // The keyset step's throw is REPORTED, not a halt — the builder
      // simulates before it signs, so a closed namespace and an unsatisfiable
      // current keyset both arrive here, and neither may block a migration
      // that has otherwise completed.
      if (step.kind === "define-keyset") {
        reportKeysetAndContinue(row, step, message);
        continue;
      }
      report(row.firstRow, "error", { label: STEP_FAILED_LABEL, result: message });
      return haltedWith({ stepId: step.id, kind: step.kind, reason: "threw", message });
    }
  }

  return { status: "completed", plan, confirmed, skipped, reported };
}

/** The amount a step that moves nothing is handed — the rotations, which take
 *  no amount at all and ignore it. */
const MOVES_NOTHING = "0.0";

const CONFIRMED_LABEL = "Confirmed";
/** Plan decision 4's exact words for an exhausted confirmation budget. */
const PENDING_LABEL = "Submitted — not confirmed";
const STEP_FAILED_LABEL = "Failed";
const NOT_CONFIRMABLE_LABEL = "Not confirmable";
const READ_FAILED_LABEL = "Chain read failed";

/** A mid-chain re-read that failed. The steps that already confirmed stay
 *  confirmed in the outcome — a halt reports where the chain stopped, never
 *  un-does what landed. */
function readFailedMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return (
    `Chain state could not be re-read before this step, so its amount is unknown: `
    + `${detail}. Nothing further was submitted. Press again: every step is gated on `
    + `chain state, so whatever already landed is skipped.`
  );
}

/** The fallback when the chain reports a failure without words of its own. */
const STEP_FAILED_MESSAGE = "The chain reported this transaction as failed.";

const NOT_SUBMITTED_MESSAGE =
  "This step produced no request key, so there is nothing to confirm — the chain "
  + "stopped here rather than treat an unconfirmable step as a confirmed one. "
  + "Press again: the next press re-reads chain state and skips whatever landed.";

/** Why a `"pending"` verdict halts, in the words the user reads. Deliberately
 *  never phrased as a failure: the transaction may still land, and calling it a
 *  failure invites a duplicate resubmit of money already in flight. */
function pendingMessage(requestKey: string, chainId: string): string {
  return (
    `Submitted (request key ${requestKey} on chain ${chainId}) but not confirmed within `
    + `the polling budget, so the outcome is UNKNOWN — it may still land. The chain stopped `
    + `here rather than guess an amount the next step would read from a balance this one has `
    + `not changed yet. Press again when you are ready: the next press re-reads chain state, `
    + `so anything that landed in the meantime is simply observed, never re-sent.`
  );
}

/** Dispatch one single-transaction step to its injected submitter. */
async function submitSingleStep(
  step: MigrationChainStep,
  ctx: {
    req: MigrationChainRequest;
    deps: MigrationChainDeps;
    newPaymentAddress: string | null;
    amount: string;
    /** The FRESH snapshot `step` was planned from — the keyset update reads
     *  its gas payer out of it, and the engine re-reads before every step
     *  precisely so that figure is current. */
    snapshot: ChainStateSnapshot;
  },
): Promise<RotateSubmitResult> {
  const { req, deps, newPaymentAddress, amount, snapshot } = ctx;
  const chainId = step.chainId ?? STOA_CONSOLIDATION_TARGET_CHAIN;
  const receiver = newPaymentAddress ?? req.oldPaymentAddress;
  switch (step.kind) {
    case "drain-stoa":
      return deps.submitDrainStoa({
        sender: req.oldPaymentAddress,
        receiver,
        amount,
        chainId,
      });
    case "unstake-urstoa":
      return deps.submitUnstakeUrStoa({
        address: req.oldPaymentAddress,
        amount,
        chainId,
        // Forwarded from the PLAN, which set it from the fresh earnings read.
        // Spread rather than passed as `undefined`: the builder sends one
        // expression unless it is told to send two.
        ...(step.collectRewards === true ? { collectRewards: true } : {}),
      });
    case "move-urstoa":
      return deps.submitTransferUrStoa({
        senderAddress: req.oldPaymentAddress,
        receiverAddress: receiver,
        amount,
        chainId,
      });
    case "restake-urstoa":
      return deps.submitStakeUrStoa({ address: receiver, amount, chainId });
    case "rotate-payment-key":
      return deps.submitRotatePaymentKey({
        accountAddress: req.accountAddress,
        newPaymentKey: receiver,
        chainId,
      });
    case "rotate-guard":
      return deps.submitRotateGuard({
        accountAddress: req.accountAddress,
        guard: req.intent.guard ?? { keys: [], pred: "keys-all" },
        chainId,
      });
    case "define-keyset": {
      // Both of these are guaranteed by the loop's pre-submit checks and by
      // the planner (an executable keyset step always carries a `keysetRef`
      // and is only emitted with a non-empty chosen guard). They are re-read
      // rather than asserted because a `!` here would be the one place a
      // refactor could send an EMPTY keyset definition to chain.
      const submit = deps.submitDefineKeyset;
      const guard = req.intent.guard;
      if (submit === undefined || step.keysetRef === undefined || guard === null) return {};
      if (snapshot.registeredPaymentKey === null) return {};
      return submit({
        keysetRef: step.keysetRef,
        keys: guard.keys,
        pred: guard.pred,
        payerAddress: snapshot.registeredPaymentKey,
        chainId,
      });
    }
    default:
      return {};
  }
}
