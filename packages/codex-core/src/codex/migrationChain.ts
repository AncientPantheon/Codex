// MIGRATION CHAIN — the brain of the payment-key/guard migration, and nothing
// else. `docs/work/migration-execute/design.md` §2 (the chain and its order),
// §4 (resume by predicate) and §5 (preconditions), plus
// `docs/work/migration-execute-keyset/design.md` §1 (the lossless unstake),
// §2 (the keyset-definition step) and §3 (forfeit as a precondition),
// expressed as pure functions over a snapshot.
//
// The engine that RUNS this (`codex-ouronet`'s `runMigrationChain`) is a loop
// that asks this module what to do next and calls an injected submitter.
// Everything decidable without the network is decided here, where a case costs
// microseconds instead of mainnet IGNIS — which is why this file has NO
// imports at all: no React, no `@stoachain`, no chain read, no `@ouronet`.
// (`codex-ouronet/tests/structural-guards.test.ts:295` enforces the React and
// `@stoachain` halves of that across all of `codex-core/src`; the local spec
// asserts the stronger "imports nothing" property, because a sibling import
// here is how a chain edge would eventually arrive.)
//
// ## Every step is a PREDICATE over chain state, not a position in a script
//
// Design §4's decision, and the reason this module exists in this shape:
//
//   | step | runs only if                                     |
//   |------|--------------------------------------------------|
//   | A(n) | the OLD key's balance on chain n > 0             |
//   | B    | the OLD key's chain-0 STOA balance > 0           |
//   | C    | the OLD key's STAKED urSTOA > 0                  |
//   | D    | the OLD key's LIQUID urSTOA > 0                  |
//   | E    | the NEW key's LIQUID urSTOA > 0                  |
//   | F    | the account's registered payment key != the new   |
//   | G    | the account's on-chain guard != the chosen guard  |
//
// One predicate is NOT a step of its own: the Collect that round 2 merges into
// C rides on C's transaction and is gated separately, by
// {@link MigrationChainStep.collectRewards}. Earnings with nothing staked
// therefore plan NOTHING — there is no transaction to merge the Collect into.
//
// Three consequences, all of them wanted. The chain is IDEMPOTENT: re-running
// a drain on an already-empty chain is a no-op, not a double-spend. RECOVERY
// NEEDS NO NEW UI: a dead browser is not a special state — the user presses
// the same button again and the engine skips whatever landed. And a recorded
// `txHash` (`migrationProgress.ts:118-125`) is a HINT, never authority —
// {@link MigrationChainStep.id} names a PREDICATE, not a position, which is
// also what lets a progress recorder merge by id across presses.
//
// ## The order is FORCED, not stylistic
//
// - **G is LAST.** The moment the guard rotation lands, the signing set
//   changes. Every step before it is authorised by the guard that exists
//   today; a G in the middle would leave the remaining steps needing a guard
//   the user has only just adopted, and a mistake there strands them with no
//   way to sign.
// - **The whole drain (A-E) precedes F.** A-E are signed by the OLD payment
//   key. F re-points the Ouronet account at the new one, so draining after F
//   means moving funds out of a key the account no longer names.
// - **A(n) all precede B.** The owner's decision: consolidate chains 1-9 onto
//   chain 0, then move once.
// - **C -> D -> E is forced by the primitives.** `executeStakeUrStoa` /
//   `executeUnstakeUrStoa` take `{ paymentKeyAddress, amount, gasStationKey }`
//   and NO destination — staking acts on the account itself. So "move staked
//   urSTOA" is necessarily unstake at the source, transfer, re-stake at the
//   destination. Nothing shortcuts it.
// - **C precedes B** (round 2's reorder, and the ONE position that moved).
//   Step C is no longer a bare unstake: it is `coin.C_URV|Collect` followed by
//   `coin.C_URV|Unstake` in ONE gas-station-sponsored transaction, so that no
//   reward dust is left uncollected. And `Collect` pays out in NATIVE STOA,
//   not urSTOA — its whole body (`0_Stoa/coin-contract/coin-live.pact:1467-1488`)
//   hands the rewards to `C_Transmit`, which is `debit` + `credit` on the
//   **coin table** (`:593-598`). The urSTOA ledger's mover is `X_UR|Transfer`,
//   which is what `C_URV|Stake:1415` and `C_URV|Unstake:1449` use instead.
//
//   So the rewards C releases land in the OLD key's chain-0 NATIVE balance.
//   The step that moves that balance is **B**, not D (D's predicate is
//   `oldKeyUrStoaLiquid`). With B planned before C, a press that collected
//   left the freshly-collected STOA sitting on a key F was about to orphan:
//   the engine re-reads and re-plans after every confirmation, but it walks
//   its toast rows ONCE, so B's row was already spent by the time C produced
//   the balance. No money was lost — the chain is idempotent and the next
//   press drains it — but "one press, uninterrupted" stopped being true for
//   exactly the account this is for.
//
//   Moving C does not disturb any other invariant: G is still last, the whole
//   drain still precedes F, every A(n) still precedes B, and C -> D -> E keeps
//   its relative order. All four are pinned as PROPERTIES over the generated
//   snapshot set in `tests/migration-chain.test.ts`.
//
// ## One consequence of the predicates a caller must know
//
// The snapshot is read BEFORE the first transaction, so D's predicate ("the
// old key's LIQUID urSTOA > 0") cannot see the liquidity C is about to create.
// A key whose urSTOA is entirely staked therefore plans C alone on the first
// press, and D/E on the next one — which is exactly design §4's resume path,
// not a gap: re-reading is free and re-pressing is the documented recovery
// mechanism. An engine that wants both in one press must RE-READ the snapshot
// after C confirmed and re-plan; this module is pure, so re-planning costs
// nothing. What it must never do is guess an amount C has not yet produced.
//
// ## The keyset-definition step — runnable, with three ways not to be
//
// Round 1 reported `define-keyset` as flatly non-executable. Round 2's design
// §2 overturned most of that: the target IS derivable from the account's live
// guard, with no new read and no new recorded field, because the account-guard
// read already expands a keyset-ref and annotates it with its qualified
// `"<ns>.<ksn>"` name (`codex-ouronet/src/guards/resolveGuardKeys.ts:93-105`
// reads that out of either real-world spelling). So the step is now a
// DECISION with four outcomes:
//
//   | condition                                 | outcome                  |
//   |-------------------------------------------|--------------------------|
//   | the guard is not a keyset-ref at all      | reported, no-ref reason  |
//   | the owner FORFEITED the update            | reported, forfeit reason |
//   | the chosen guard resolved to no keys      | reported, no-definition  |
//   | otherwise                                 | EXECUTABLE, ref carried  |
//
// "Reported" still means PRESENT with `executable: false` — never silently
// skipped. That distinction is a FIELD, not a reason string: "skipped because
// its predicate is false" means the step is ABSENT from the plan; "cannot be
// run at all" means it is PRESENT and not executable.
//
// Two things about this step that a future reader must not "simplify":
//
//  - **G stays suppressed for both `update-keyset-*` kinds**, exactly as in
//    round 1. "Update what the reference resolves to" is not an account-guard
//    rotation, and performing one would be the wrong transaction. Making the
//    step runnable changes nothing about that.
//  - **Its gas is neither the gas station's nor the patron's IGNIS.**
//    `DALOS.GAS_PAYER` (`1_SOVEREIGN/STAGE_01/2_Core/01_DALOS.pact:456-526`)
//    accepts exactly three transaction shapes — one `(coin.C_` / `(ouronet-ns.`
//    form, two `(coin.C_` forms, or a `≥25-IGNIS C_Transmute` donation
//    followed by a `(let …)` — and `(define-keyset "<ns>.<ksn>" (read-keyset
//    "ks"))` matches none of them. It is an ordinary self-paid transaction, so
//    it contributes nothing to {@link sumIgnisNeed}. This is the one
//    transaction in the whole chain the gas station cannot sponsor.

/**
 * The chain facts every predicate reads — structural and chain-agnostic, in
 * {@link MasterOuronetAccountCandidate}'s style, so a unit test builds one as
 * a literal instead of mounting a reader.
 *
 * Produced by `codex-ouronet`'s `readChainState`; consumed only here.
 */
export interface ChainStateSnapshot {
  /** chainId `"0"`..`"9"` -> native STOA balance on the OLD payment key. A
   *  chain the reader did not report is treated exactly like a zero balance:
   *  nothing to move. */
  readonly oldKeyStoaPerChain: Readonly<Record<string, number>>;
  /** Liquid (non-vaulted) urSTOA on the OLD payment key. urSTOA lives on
   *  chain 0 only. */
  readonly oldKeyUrStoaLiquid: number;
  /** urSTOA staked in the vault by the OLD payment key. */
  readonly oldKeyUrStoaStaked: number;
  /** Liquid urSTOA on the NEW payment key — what step E re-stakes. */
  readonly newKeyUrStoaLiquid: number;
  /**
   * `coin.URC_URV|ClaimableRewards` on the OLD key. Decides whether step C
   * emits the Collect expression at all — `coin-live.pact:708-721`'s `debit`
   * enforces `(> amount 0.0)` (`:414-418`), so a Collect with zero claimable
   * rewards FAILS THE WHOLE TRANSACTION and would take the unstake down with
   * it.
   *
   * REQUIRED, not optional: an absent figure would read as "no rewards" and
   * silently reintroduce the uncollected dust round 2 exists to close.
   *
   * One thing not to "fix": on a live chain this number can look far too big.
   * `URC_URV|ClaimableRewards` (`coin-live.pact:1489-1495`) returns the ENTIRE
   * `UR_URV|VaultSupply` when `UR_URV|VaultUnclaimedCount` is 1. Only the
   * `> 0` test is used here, and Collect recomputes the real payout on chain,
   * so the overstatement is harmless — but it must never become a DISPLAYED
   * balance.
   */
  readonly oldKeyUrStoaEarnings: number;
  /** The account's registered payment key as chain reports it: `k:<pub>` or,
   *  for a `"stoic"` seed, bare `<pub>` (`store.ts:2680`). `null` when the
   *  account has none. Compared through {@link bareKeyOf}, never raw. */
  readonly registeredPaymentKey: string | null;
  /** The account's live guard, or `null` when it has none. */
  readonly registeredGuard: MigrationGuardTarget | null;
  /**
   * The qualified `"<ns>.<ksn>"` the account's guard points at, or `null` when
   * the guard is not a keyset-ref. Design §2's "the target is derivable from
   * the account's live guard", as one field — `keysetRefNameOf`'s answer over
   * the SAME raw selector value {@link registeredGuard} is read from, so it
   * costs no extra read and needs no new recorded field.
   *
   * REQUIRED, not optional: an absent reference would read as "not a
   * keyset-ref" and silently suppress the step the owner asked for.
   */
  readonly registeredKeysetRef: string | null;
}

/** A guard, as both chain and the recorded plan express one. */
export interface MigrationGuardTarget {
  readonly keys: readonly string[];
  readonly pred: string;
}

/**
 * What the user CHOSE — the recorded plan's side of every predicate.
 *
 * `newPaymentPublicKey` is BARE 64-hex, exactly as
 * `MigrationPendingPlan.paymentPublicKey` carries it; use
 * {@link paymentKeyAccountString} to get the account-string form
 * `C_RotateStoa` wants. `guard` is `pending.guardPublicKeys` +
 * `pending.guardPred`, already resolved (never user-asserted). Both are
 * nullable because "keep" is a real choice and must plan no step.
 */
export interface MigrationChainIntent {
  readonly newPaymentPublicKey: string | null;
  readonly guard: MigrationGuardTarget | null;
  /** `MigrationGuardSelection["kind"]`, when one was recorded. Only the two
   *  `"update-keyset-*"` kinds change the plan — see the header's last
   *  section. Kept as a plain string so the intent can be built from a
   *  selection this module does not have to import. */
  readonly guardSelection?: string;
  /**
   * The owner FORFEITED the keyset-definition update for THIS PRESS — design
   * §3's point 2, the second of the two resolutions the refusal offers.
   *
   * Carried on the intent and deliberately NOT persisted. A forfeit written to
   * `MigrationProgress` is a decision that silently outlives the session that
   * made it, and the codec's top-level allowlist would have to grow for a flag
   * whose whole lifetime is one button press. The UI holds it in component
   * state and hands it over here.
   *
   * When true the `define-keyset` step is still EMITTED, with
   * `executable: false` and {@link KEYSET_UPDATE_FORFEITED_REASON}, so the
   * engine's existing report-and-continue branch covers it with no new engine
   * path — which is criterion 8's "forfeit proceeds with every other step and
   * is reported, not an error". It has no effect on any other selection kind.
   */
  readonly keysetUpdateForfeited?: boolean;
}

/** The operations design §2 names, one kind each. `"define-keyset"` is the
 *  one whose gas the Ouronet gas station cannot pay — see the header. */
export type MigrationChainStepKind =
  | "consolidate-stoa"
  | "drain-stoa"
  | "unstake-urstoa"
  | "move-urstoa"
  | "restake-urstoa"
  | "rotate-payment-key"
  | "rotate-guard"
  | "define-keyset";

/**
 * One planned step.
 *
 * `id` is STABLE and derived from the step's IDENTITY, never from its position
 * — `"consolidate-3"`, `"drain-stoa"`, `"rotate-guard"`. That is what lets a
 * progress recorder merge the same step across presses, and it is the concrete
 * form of design §4's "a recorded `txHash` is a HINT": the id names the
 * PREDICATE that put the step in the plan, so the same id in two different
 * runs means the same work, even at a different index.
 */
export interface MigrationChainStep {
  readonly id: string;
  readonly kind: MigrationChainStepKind;
  /** Where the transaction is submitted and confirmed. For a consolidation
   *  hop this is the SOURCE chain; the target is always
   *  {@link STOA_CONSOLIDATION_TARGET_CHAIN}. */
  readonly chainId?: string;
  /** The amount the predicate observed, for the steps that move a quantity.
   *  Absent on the rotations, which move nothing. */
  readonly amount?: number;
  /** `false` ONLY for a step no code can perform. A step whose predicate is
   *  false is not in the plan at all, so this field never means "skipped". */
  readonly executable: boolean;
  /** Present iff `executable === false`: what to tell the user. */
  readonly notExecutableReason?: string;
  /**
   * Set on the `"unstake-urstoa"` step, and on nothing else, when the OLD key
   * has claimable rewards: the step's ONE transaction must carry
   * `(coin.C_URV|Collect …)` ahead of `(coin.C_URV|Unstake …)` so that no
   * reward dust is left behind (design §1).
   *
   * NOT an amount, and deliberately so. `C_URV|Collect` takes only the
   * account and pays out whatever is claimable at EXECUTION time, so a figure
   * recorded here would be a guess the chain overrides. The step's
   * {@link amount} stays the UNSTAKE amount, read from `UR_URV|UserSupply`,
   * which Collect provably does not touch: it never calls
   * `XI_URV|UpdateUserScore` (`coin-live.pact:1609-1625`), the only writer of
   * the `user-supply` field `UR_URV|UserSupply` (`:1300-1307`) reads.
   */
  readonly collectRewards?: boolean;
  /**
   * The qualified `"<ns>.<ksn>"` a `"define-keyset"` step targets. Present iff
   * that step is EXECUTABLE — a target on a step that must not run is an
   * invitation to run it.
   */
  readonly keysetRef?: string;
}

export interface MigrationChainPlan {
  readonly steps: readonly MigrationChainStep[];
  /** True when the plan is EMPTY — every predicate is false and there is
   *  nothing to report. The engine says "nothing left to do" rather than
   *  driving an empty loop. A plan holding only the non-executable
   *  `define-keyset` step is NOT `nothingToDo`: there is nothing to run, but
   *  there IS something the user must be told (criterion 9). */
  readonly nothingToDo: boolean;
}

/**
 * The per-transaction `ignis-need` the patron pays, read from chain by the
 * caller (`infoData?.ignis?.["ignis-need"]`, as
 * `zbom/modals/RotatePaymentKeyModal.tsx:145` and `RotateGuardModal.tsx:125`
 * already do).
 *
 * Both fields are REQUIRED so a caller cannot silently sum a real cost as
 * zero — the type is the guard, since an under-sum would be a chain that dies
 * at the rotation for a reason knowable before the first transaction.
 */
export interface MigrationIgnisCosts {
  readonly rotatePaymentKey: number;
  readonly rotateGuard: number;
}

export type MigrationPreconditionCode =
  | "old-payment-keypair-missing"
  | "guard-keys-unresolved"
  | "current-guard-unsatisfiable"
  | "keyset-update-unsatisfiable"
  | "insufficient-ignis";

export interface MigrationPreconditionFailure {
  readonly code: MigrationPreconditionCode;
  /** The human sentence; {@link MigrationPreconditionVerdict.message} is
   *  every one of these joined, so the user reads one refusal. */
  readonly detail: string;
}

/**
 * Facts the caller has ALREADY gathered. This function does no I/O — it is the
 * once-only §5 gate, not a reader.
 */
export interface MigrationPreconditionInputs {
  /** The plan {@link planMigrationChain} produced. Which preconditions apply
   *  depends on what is actually going to be submitted. */
  readonly steps: readonly MigrationChainStep[];
  /** The OLD payment key's keypair is present in the codex and decryptable.
   *  Without it, A-E cannot be signed at all (design §5). */
  readonly oldPaymentKeypairPresent: boolean;
  /** The chosen guard's keys resolved (`describeKeyset` at selection time for
   *  `"use-existing-keyset"`, the derived keys otherwise). */
  readonly chosenGuardKeysResolved: boolean;
  /** The CURRENT guard is satisfiable by keys this codex can sign with —
   *  `analyzeGuard(...).satisfied` in the rotate modals' terms. */
  readonly currentGuardSatisfiable: boolean;
  /**
   * The REFERENCED keyset's current keys can be satisfied — by this codex,
   * plus whatever private keys the owner supplied before pressing (design §3).
   * Checked ONLY when an EXECUTABLE `define-keyset` step is in the plan, so a
   * forfeited or no-ref run is never refused for a keyset it will not touch.
   *
   * Distinct from {@link currentGuardSatisfiable}: that one is the ACCOUNT's
   * guard, which authorises `C_RotateGuard`. A `define-keyset` is authorised by
   * the keyset's OWN current definition. For a keyset-ref account the two
   * usually coincide, and "usually" is not a thing to build a signature on.
   */
  readonly keysetUpdateSatisfiable: boolean;
  /**
   * The arithmetic behind {@link keysetUpdateSatisfiable}, for the sentence the
   * owner reads — criterion 5 asks the refusal to "name the shortfall", and
   * `analyzeGuard` already computes all three (`keys.length`, `threshold`, and
   * the codex-held plus manually-resolved keys).
   *
   * Optional because it is DISPLAY DETAIL, never the decision: the boolean
   * above is the single source of truth, so the two can never disagree about
   * whether to refuse. A refusal with no counts still names the alternative.
   */
  readonly keysetUpdateKeyCounts?: {
    readonly resolved: number;
    readonly total: number;
    readonly threshold: number;
  };
  /** The patron's IGNIS. `null` (not yet read) counts as zero, exactly as
   *  `(patronIgnisBalance ?? 0) >= ignisCost` already does. */
  readonly patronIgnisBalance: number | null;
  readonly ignisCosts: MigrationIgnisCosts;
}

export interface MigrationPreconditionVerdict {
  readonly ok: boolean;
  /** EVERYTHING missing, in a stable order — never just the first thing. */
  readonly failures: readonly MigrationPreconditionFailure[];
  /** The ONE refusal criterion 7 asks for, naming every failure. `""` when
   *  `ok`. */
  readonly message: string;
}

/** Native STOA is spread across chains 0-9 (`STOA_CHAINS`, 10 chains); the
 *  owner's decision is to consolidate onto chain 0 and then move once. */
export const STOA_CONSOLIDATION_TARGET_CHAIN = "0";

/** The source chains a consolidation hop can run on: everything except the
 *  target. Chain 0 is never consolidated onto itself — it is drained by B. */
export const CONSOLIDATION_SOURCE_CHAINS: readonly string[] = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
];

/** urSTOA is deployed on chain 0 only, and the Ouronet `C_*` calls live there
 *  too (`KADENA_CHAIN_ID === "0"`, used as `STOACHAIN_CHAIN_ID` by
 *  `zbom/rotatePaymentKeyLive.ts:95`). */
const OURONET_CHAIN = STOA_CONSOLIDATION_TARGET_CHAIN;

// The three reasons a `define-keyset` step is REPORTED instead of run.
// Exported so the engine and the UI quote ONE string each rather than two that
// can drift. They REPLACE round 1's single `DEFINE_KEYSET_NOT_EXECUTABLE_REASON`,
// four of whose five clauses round 2 disproved: there IS a builder, it IS
// executed, and the recorded choice DOES yield a target.

/** Criterion 4, exactly: the account's guard is not a keyset-ref, so there is
 *  no reference to redefine.
 *
 *  Gas note for whoever edits this next, because it is the one fact that did
 *  NOT change: this step is the single transaction in the whole chain the
 *  Ouronet gas station cannot sponsor. `DALOS.GAS_PAYER`
 *  (`1_SOVEREIGN/STAGE_01/2_Core/01_DALOS.pact:456-526`) accepts exactly three
 *  transaction shapes and `(define-keyset …)` matches none of them, so it is
 *  paid for by an ordinary STOA sender account. Do not re-add a "the gas
 *  station cannot pay for it" clause to the USER-FACING text: by the time the
 *  owner reads one of these, gas is not the thing standing in their way. */
export const KEYSET_UPDATE_NO_REF_REASON =
  "This choice updates a namespace keyset's own definition, but this account's guard "
  + "is not a keyset-ref — it holds its keys directly, so there is no referenced "
  + "keyset to redefine. Nothing was submitted for this step. It is reported here "
  + "rather than skipped, because you chose it: to change this account's keys, "
  + "rotate its guard instead. Every other step of the migration ran normally.";

/** Criterion 8: the owner chose to forfeit the update for this press. */
export const KEYSET_UPDATE_FORFEITED_REASON =
  "You chose to forfeit this keyset update, so the referenced keyset is left exactly "
  + "as it is and nothing was submitted for this step. This is a decision, not a "
  + "failure: every other step of the migration ran normally. To carry it out later, "
  + "supply enough private keys of the keyset's CURRENT keys to meet its predicate "
  + "and press again.";

/** The new definition is what `(read-keyset "ks")` carries, and it is the
 *  CHOSEN guard. With no keys there is nothing to define — and an executable
 *  step here would submit an EMPTY keyset and lock the reference out of its
 *  own owner's reach, which is the one outcome worse than not running. G
 *  already applies the same `keys.length > 0` gate to itself; this states it
 *  for the sibling step. */
export const KEYSET_UPDATE_NO_DEFINITION_REASON =
  "This choice updates a namespace keyset's own definition, but no keys were "
  + "resolved for the new definition — there is nothing to define it AS. Nothing was "
  + "submitted for this step: writing an empty keyset would lock the reference out of "
  + "everyone's reach, including yours. Re-run the guard selection so the new keys "
  + "resolve, then press again. Every other step of the migration ran normally.";

/** Positive, finite and real: what "there is something to move" means. A
 *  reported balance can arrive as `NaN` or a negative through the Pact decimal
 *  coercions, and neither is a transfer. */
function movable(amount: number | undefined): boolean {
  return typeof amount === "number" && Number.isFinite(amount) && amount > 0;
}

/** Set equality, so key ORDER never makes an unchanged guard look pending.
 *  The same rule `codex-ouronet/src/ui/internal/outstandingKeyChanges.ts:42-46`
 *  and `:83-86` already encode for the Stage-3A listing — restated here (core
 *  must not import up the dependency graph), deliberately not re-invented. */
function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((key) => set.has(key));
}

/**
 * The §5 conversion: `pending.paymentPublicKey` is a bare 64-hex key, and
 * `TS01-C1.DALOS|C_RotateStoa` wants the ACCOUNT-STRING form.
 *
 * Source of truth, mirrored exactly:
 * `codex-ouronet/src/state/store.ts:2680` —
 * `main: seedType === "stoic" ? paymentPublicKey : \`k:${paymentPublicKey}\``.
 * Nothing else in the repo performs this conversion.
 *
 * `seedType` is taken as a plain string (structurally `SeedType`,
 * `codex-ouronet/src/types/entities.ts:35`) so core keeps no edge to that
 * package. A key that already arrives prefixed is returned unchanged rather
 * than double-prefixed.
 */
export function paymentKeyAccountString(
  paymentPublicKey: string,
  seedType: string | null | undefined,
): string {
  if (seedType === "stoic") return paymentPublicKey;
  return paymentPublicKey.startsWith("k:") ? paymentPublicKey : `k:${paymentPublicKey}`;
}

/**
 * The inverse: the bare public key inside an address, whichever form it
 * arrives in. Predicate F compares a bare chosen key against whatever chain
 * reports, so every comparison goes through this.
 *
 * `null` for a missing or empty address — a half-written field is not a key.
 */
export function bareKeyOf(address: string | null | undefined): string | null {
  if (typeof address !== "string" || address.length === 0) return null;
  return address.startsWith("k:") ? address.slice(2) : address;
}

/**
 * The `define-keyset` step's executability, as the ONE decision the header's
 * table describes. Split out so each outcome is named rather than nested, and
 * so {@link planMigrationChain} stays a list of steps.
 *
 * The order of the three refusals matters: "there is no reference" comes first
 * because it is a fact about the ACCOUNT and makes the other two moot, and the
 * forfeit comes before the missing definition because a forfeited step is not
 * going to run whatever the definition says — reporting "no keys resolved" for
 * a step the owner deliberately declined would be noise.
 */
function keysetUpdateOutcome(
  snapshot: ChainStateSnapshot,
  intent: MigrationChainIntent,
): Pick<MigrationChainStep, "executable" | "notExecutableReason" | "keysetRef"> {
  // `typeof`, not `!== null`: the snapshot comes from a chain READ, and the
  // direction a half-built or partially-decoded one fails in decides whether
  // the engine submits a `define-keyset` against a reference that does not
  // exist. An empty string is no reference either.
  const ref = snapshot.registeredKeysetRef;
  if (typeof ref !== "string" || ref.length === 0) {
    return { executable: false, notExecutableReason: KEYSET_UPDATE_NO_REF_REASON };
  }
  if (intent.keysetUpdateForfeited === true) {
    return { executable: false, notExecutableReason: KEYSET_UPDATE_FORFEITED_REASON };
  }
  if (intent.guard === null || intent.guard.keys.length === 0) {
    return { executable: false, notExecutableReason: KEYSET_UPDATE_NO_DEFINITION_REASON };
  }
  return { executable: true, keysetRef: ref };
}

/**
 * Design §2's step list, in §2's order, each gated on §4's predicate.
 *
 * Pure and total: the same snapshot always plans the same chain, and a
 * snapshot that owes nothing plans nothing. See the header for why the order
 * is forced and for the one thing D's predicate cannot see.
 */
export function planMigrationChain(
  snapshot: ChainStateSnapshot,
  intent: MigrationChainIntent,
): MigrationChainPlan {
  const steps: MigrationChainStep[] = [];

  // A(n) — consolidate chains 1-9 onto chain 0, skipping zero balances
  // (criterion 4). Ascending chain order: the hops are independent, so the
  // only requirement is that the order be STABLE, and ascending is the order
  // the user sees their balances in.
  for (const chainId of CONSOLIDATION_SOURCE_CHAINS) {
    const amount = snapshot.oldKeyStoaPerChain[chainId];
    if (!movable(amount)) continue;
    steps.push({
      id: `consolidate-${chainId}`,
      kind: "consolidate-stoa",
      chainId,
      amount,
      executable: true,
    });
  }

  // C — Collect + Unstake in ONE transaction, BEFORE B. See the header: the
  // Collect pays out NATIVE STOA, and B is the step that moves it. The merged
  // Collect is a flag, not an amount, and is emitted only when there is
  // something to collect — a Collect of zero fails the whole transaction.
  if (movable(snapshot.oldKeyUrStoaStaked)) {
    steps.push({
      id: "unstake-urstoa",
      kind: "unstake-urstoa",
      chainId: OURONET_CHAIN,
      amount: snapshot.oldKeyUrStoaStaked,
      executable: true,
      ...(movable(snapshot.oldKeyUrStoaEarnings) ? { collectRewards: true } : {}),
    });
  }

  // B — the chain-0 drain, old key -> new key. After A and C, this is all the
  // native STOA there is.
  const chainZero = snapshot.oldKeyStoaPerChain[STOA_CONSOLIDATION_TARGET_CHAIN];
  if (movable(chainZero)) {
    steps.push({
      id: "drain-stoa",
      kind: "drain-stoa",
      chainId: STOA_CONSOLIDATION_TARGET_CHAIN,
      amount: chainZero,
      executable: true,
    });
  }

  // D -> E — move the now-liquid urSTOA, then re-stake it at the destination.
  if (movable(snapshot.oldKeyUrStoaLiquid)) {
    steps.push({
      id: "move-urstoa",
      kind: "move-urstoa",
      chainId: OURONET_CHAIN,
      amount: snapshot.oldKeyUrStoaLiquid,
      executable: true,
    });
  }
  if (movable(snapshot.newKeyUrStoaLiquid)) {
    steps.push({
      id: "restake-urstoa",
      kind: "restake-urstoa",
      chainId: OURONET_CHAIN,
      amount: snapshot.newKeyUrStoaLiquid,
      executable: true,
    });
  }

  // F — the payment-key rotation, after the whole drain and before the guard.
  const chosenPaymentKey = bareKeyOf(intent.newPaymentPublicKey);
  if (chosenPaymentKey !== null && bareKeyOf(snapshot.registeredPaymentKey) !== chosenPaymentKey) {
    steps.push({
      id: "rotate-payment-key",
      kind: "rotate-payment-key",
      chainId: OURONET_CHAIN,
      executable: true,
    });
  }

  // The keyset-definition update, when that is what was chosen. It SUPPRESSES
  // G: "update what the reference resolves to" is not an account-guard
  // rotation, and performing one would be the wrong transaction — the
  // discipline `outstandingKeyChanges.ts:60-72` already states for the same
  // two selection kinds. Placed before G so "G is last" holds over the whole
  // plan, AND because a keyset update must be satisfied by the CURRENT keyset
  // — i.e. before the guard rotation changes the signing set.
  //
  // Round 2 made it a four-way decision; see the header's table for why each
  // outcome is what it is.
  const isKeysetDefinitionUpdate =
    intent.guardSelection === "update-keyset-recommended"
    || intent.guardSelection === "update-keyset-custom";
  if (isKeysetDefinitionUpdate) {
    steps.push({
      id: "define-keyset",
      kind: "define-keyset",
      chainId: OURONET_CHAIN,
      ...keysetUpdateOutcome(snapshot, intent),
    });
  }

  // G — LAST, always. The moment it lands the signing set changes.
  const chosenGuard = intent.guard;
  if (!isKeysetDefinitionUpdate && chosenGuard !== null && chosenGuard.keys.length > 0) {
    const live = snapshot.registeredGuard;
    const alreadyInForce =
      live !== null && live.pred === chosenGuard.pred && sameKeys(live.keys, chosenGuard.keys);
    if (!alreadyInForce) {
      steps.push({
        id: "rotate-guard",
        kind: "rotate-guard",
        chainId: OURONET_CHAIN,
        executable: true,
      });
    }
  }

  return { steps, nothingToDo: steps.length === 0 };
}

/**
 * The patron's TOTAL IGNIS need across the whole plan — the thing design §5
 * says nothing in the repo does today, where the check is
 * `(patronIgnisBalance ?? 0) >= ignisCost` for ONE transaction
 * (`zbom/modals/RotatePaymentKeyModal.tsx:145`).
 *
 * Only F and G cost the patron IGNIS. Every `coin.*` step (A, B, C, D, E) is
 * paid by the Ouronet gas station (`STOA_AUTONOMIC_OURONETGASSTATION`, used at
 * `SendStoaModal.tsx:238` and `rotatePaymentKeyLive.ts:94`), so a future
 * reader must NOT add gas-station IGNIS to this sum. Non-executable steps
 * contribute nothing: they are never submitted.
 */
export function sumIgnisNeed(
  steps: readonly MigrationChainStep[],
  costs: MigrationIgnisCosts,
): number {
  return steps.reduce((total, step) => {
    if (!step.executable) return total;
    if (step.kind === "rotate-payment-key") return total + costs.rotatePaymentKey;
    if (step.kind === "rotate-guard") return total + costs.rotateGuard;
    return total;
  }, 0);
}

/** The steps signed by the OLD payment key — design §5's "without it, A-E
 *  cannot be signed at all". */
const OLD_KEY_SIGNED_KINDS: readonly MigrationChainStepKind[] = [
  "consolidate-stoa",
  "drain-stoa",
  "unstake-urstoa",
  "move-urstoa",
  "restake-urstoa",
];

/**
 * Design §5, checked ONCE before the first transaction — "a chain that dies at
 * step 7 of 20 for a reason knowable at step 0 is a bug".
 *
 * Returns EVERY failure, not the first: criterion 7 asks for "a single clear
 * refusal naming what is missing", and a verdict that stops early makes the
 * user press, read, fix and press again once per missing thing.
 *
 * Each precondition applies only when the plan actually needs it — a
 * guard-only run must not be refused for a payment keypair it never signs
 * with, a plan whose only step is a NON-executable `define-keyset` submits
 * nothing and so requires nothing, and the keyset check applies only when an
 * EXECUTABLE one is in the plan.
 */
export function checkMigrationPreconditions(
  inputs: MigrationPreconditionInputs,
): MigrationPreconditionVerdict {
  const failures: MigrationPreconditionFailure[] = [];
  const executable = inputs.steps.filter((step) => step.executable);

  const needsOldPaymentKey = executable.some((step) =>
    OLD_KEY_SIGNED_KINDS.includes(step.kind),
  );
  if (needsOldPaymentKey && !inputs.oldPaymentKeypairPresent) {
    failures.push({
      code: "old-payment-keypair-missing",
      detail:
        "the old payment key's keypair is not available in this codex, so the "
        + "fund-moving steps cannot be signed",
    });
  }

  const rotatesGuard = executable.some((step) => step.kind === "rotate-guard");
  if (rotatesGuard && !inputs.chosenGuardKeysResolved) {
    failures.push({
      code: "guard-keys-unresolved",
      detail: "the chosen guard's keys could not be resolved",
    });
  }

  if (executable.length > 0 && !inputs.currentGuardSatisfiable) {
    failures.push({
      code: "current-guard-unsatisfiable",
      detail:
        "the account's current guard cannot be satisfied by any key this codex "
        + "holds, so no transaction in the chain can be signed",
    });
  }

  // Design §3: the keyset's current keys are a PRECONDITION, resolved before
  // the first transaction — never a mid-chain prompt. Checked only when an
  // EXECUTABLE `define-keyset` step is in the plan, so a forfeited run and a
  // guard that is not a keyset-ref are never refused for a keyset the chain
  // will not touch. The detail names BOTH halves of design §3's point 2:
  // the shortfall, and the forfeit that is the alternative to closing it.
  const updatesKeyset = executable.some((step) => step.kind === "define-keyset");
  if (updatesKeyset && !inputs.keysetUpdateSatisfiable) {
    const counts = inputs.keysetUpdateKeyCounts;
    const shortfall =
      counts === undefined
        ? "the referenced keyset's current keys cannot be satisfied by the keys this "
          + "codex holds"
        : `only ${counts.resolved} of the referenced keyset's ${counts.total} current `
          + `keys could be resolved and its predicate needs ${counts.threshold}`;
    failures.push({
      code: "keyset-update-unsatisfiable",
      detail:
        `${shortfall} — a keyset update must be signed by the keyset's CURRENT keys. `
        + "Supply the missing private keys before pressing, or forfeit the keyset "
        + "update and the rest of the migration will run with the keyset left as it is",
    });
  }

  const ignisNeed = sumIgnisNeed(executable, inputs.ignisCosts);
  const ignisHeld = inputs.patronIgnisBalance ?? 0;
  if (ignisNeed > 0 && ignisHeld < ignisNeed) {
    const txCount = executable.filter(
      (step) => step.kind === "rotate-payment-key" || step.kind === "rotate-guard",
    ).length;
    failures.push({
      code: "insufficient-ignis",
      detail:
        `the patron holds ${ignisHeld} IGNIS but ${ignisNeed} is needed across `
        + `${txCount} transaction${txCount === 1 ? "" : "s"}`,
    });
  }

  return {
    ok: failures.length === 0,
    failures,
    message:
      failures.length === 0
        ? ""
        : `Cannot start the migration chain: ${failures.map((f) => f.detail).join("; ")}.`,
  };
}
