/**
 * STAGE 3A SECTION — the container that turns the recorded migration into an
 * offer to apply it, and THE ONE PRESS that executes it
 * (docs/work/migration-execute/design.md §3, `migration-execute` T11).
 *
 * Why a container here rather than in the Codex ID page: everything the chain
 * needs — the chain edge, the signer resolution, the toast — is INTERNAL to
 * this package (`zbom/*`), and exporting it would drag the whole ZBOM graph
 * into every consumer that merely wants to show this card. Keeping the mount
 * beside those modules means the page composes one prop-less section and the
 * dependency stays where it already was.
 *
 * {@link PendingKeyChangesCard} stays presentational and separately tested;
 * this supplies it with data, and owns the executor beside it.
 *
 * ## The per-change buttons are GONE (design §3)
 *
 * This section used to mount `RotateGuardModal` and `RotatePaymentKeyModal`
 * behind an "Apply" button per change — "send them one at a time". Design §3
 * replaced that with one uninterrupted chain from one press: the engine
 * performs BOTH rotations, in order, after the drain that must precede them,
 * and never prompts. So the two mounts and their launcher props are gone from
 * THIS surface. **The modals themselves are untouched** and still reachable
 * from `OuronetAccountsTab`; `PendingKeyChangesCard` still accepts both
 * launchers (its props are in `tests/ui-surface-stability.test.ts`'s pinned
 * type set and its own spec renders it with them) — only this section stops
 * supplying them.
 *
 * ## Why the executor is NOT gated on `outstanding.none`
 *
 * `computeOutstandingKeyChanges` models payment/guard ROTATIONS and knows
 * nothing about funds. A user who already rotated their payment key one at a
 * time has `outstanding.none === true` while STOA and urSTOA still sit on the
 * old key — precisely the case where finishing the chain matters most, and
 * precisely the case the old gate rendered nothing for. The executor is gated
 * on `hasMigrationPending(recordedRun)` instead, and the engine's own
 * pre-flight (a chain read, not a guess) is what decides there is nothing
 * left to do.
 *
 * ## What the chain READ writes back
 *
 * This component holds the store handle and the resolved master account, so it
 * binds BOTH of the engine's store-facing seams: `recordStep`, and a wrap
 * around the engine's `readChainState` that reconciles the account's recorded
 * keys with what that read reported ({@link reconcileAccountFromChainState}).
 * The card is pure — `computeOutstandingKeyChanges` compares the STORED
 * `stoaChainLedger` / `guard` against the recorded plan — and nothing else on
 * this surface ever refreshed those two fields, so a rotation already in force
 * on chain stayed listed as outstanding for the rest of the codex's life
 * (owner, mainnet, 2026-11-27: both keys in force across two runs, both still
 * listed, under a toast that said everything was done).
 *
 * Driving that write off the READ rather than off a confirmed step is what
 * makes the card structurally unable to disagree with the engine — both decide
 * from the same observation — and it is the ONLY writer of those two fields
 * here. There is deliberately no second route.
 *
 * That read has TWO call sites and one meaning. The press path wraps the
 * engine's own `readChainState`, so every observation taken DURING a run —
 * the re-read after each confirmation, and the closing read after a completed
 * chain — reconciles. {@link MigrationExecutor}'s load-time effect takes the
 * SAME read once on mount, because a press is not a way to correct a display:
 * on a fresh page load nothing read the chain, so the card listed both of the
 * owner's confirmed rotations and the Apply popup kept pointing here instead
 * of offering Seal (2026-11-27 — see that effect's own doc). One read
 * function, one writer, two moments.
 *
 * ## MAINNET HAZARD — this is the file where the real functions are named
 *
 * {@link createMigrationChainDeps} is the ONLY place in the tree that names
 * the live submitters, the live reads and the two rotations. It is a
 * separately exported factory taking every input as an argument precisely so
 * that it can be inspected without being invoked, and so that the component's
 * own spec can inject a synthetic one:
 * `tests/ui-pending-key-changes-section.test.tsx` never calls the production
 * factory with real modules, and contains no `vi.mock` at all.
 *
 * The signing primitive is `universalSignTransaction`, NOT
 * `CodexSigningStrategy` — `zbom/execute/awaitConfirmation.ts`'s header gives
 * the dedup reason for the submit side, and `sign()`'s own `onMissingKey`
 * foreign-key callback is a PROMPT, which design §3 rules out mid-chain. The
 * same primitive already backs `liveNativeStoaChainEdge().signTransaction`,
 * so both signing paths in the chain share one implementation.
 *
 * Round 2 (docs/work/migration-execute-keyset) adds two more live broadcasters
 * to that list — `collectAndUnstakeUrStoa` for step C and `submitDefineKeyset`
 * for the keyset update, the second of which rewrites who controls a keyset —
 * plus the keyset gate's one chain read. The discipline is unchanged and the
 * three decisions they carry are pulled OUT of the factory's closures into
 * {@link resolveCollectRewards}, {@link buildDefineKeysetRequest} and
 * {@link keysetUpdatePreconditionFacts}, each taking its seam as a required
 * argument, precisely so that the spec can assert them without invoking
 * anything that could reach a node.
 *
 * {@link buildRotateGuardRequest} is the fourth, and the one with a live
 * mainnet failure behind it: G's request was assembled inline inside the
 * closure that names `liveRotateGuardSubmitter`, where no test could reach
 * it, and it omitted the INCOMING guard's analysis — so the keyset being
 * adopted was sent with no signature and the chain refused it at simulation
 * (`Keyset failure ( keys-all ): 22ac9147…`, 2026-11-26, after step 0 had
 * already confirmed). That refusal is the chain stopping a user from locking
 * an account behind a keyset they do not hold, so the request is now built by
 * a value that resolves the chosen guard's keys from the codex and refuses
 * loudly when it cannot. See that function's own doc for why the threshold
 * must come from the NEW predicate.
 *
 * ## The keyset update, in three sentences
 *
 * The owner's choice of `update-keyset-recommended` / `update-keyset-custom`
 * is a `define-keyset` against the keyset the account's live guard REFERS to,
 * and it must be authorized by that keyset's CURRENT definition — so
 * {@link KeysetUpdateGate} resolves it BEFORE the press (design §3): it lists
 * every current key, verifies each pasted private key, and offers the forfeit.
 * Its whole report is held in component state for one press and folded into
 * the intent (`keysetUpdateForfeited`) and the §5 facts
 * (`keysetUpdateSatisfiable`); nothing is persisted and nothing is asked once
 * the chain starts. A keyset that cannot be satisfied and was not forfeited is
 * a PRECONDITION refusal that starts nothing, and a forfeited or non-ref one
 * is a REPORTED step with the rest of the migration running normally.
 *
 * ## The keyset update's gas payer is a PROVISIONAL DEFAULT
 *
 * This is the one transaction in the chain the Ouronet gas station cannot
 * sponsor, so it is self-paid and `payerAddress` must name a real STOA account
 * this codex can sign for. The engine supplies the migrated account's own
 * registered payment key off the fresh snapshot, which is the only such
 * account already resolved and in hand at that point — but the owner has NOT
 * answered which account should bear this cost, so that is a default awaiting
 * confirmation rather than a decided product rule. The alternative is
 * `DALOS.GAS_PAYER`'s Case 3 (a >=25-IGNIS `C_Transmute` donation plus a
 * `(let …)` wrapper), which would be a different builder. See
 * `submitDefineKeyset` below.
 */

import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCodexStoreOptional } from "../../provider/index.js";
import type { CodexStoreState } from "../../state/store.js";
import { flattenStoaChainAccounts } from "../../zbom/cfm/seam.js";
import { computeOutstandingKeyChanges } from "../internal/outstandingKeyChanges.js";
import { PendingKeyChangesCard } from "./PendingKeyChangesCard.js";
import type { IKeyset, IOuroAccount, IStoaChainSeed } from "../../types/entities.js";

import {
  bareKeyOf,
  hasMigrationPending,
  resolveMasterOuronetAccount,
  type ChainStateSnapshot,
  type MigrationChainIntent,
  type MigrationExecutionStep,
  type MigrationGuardTarget,
  type MigrationProgress,
} from "@ancientpantheon/codex-core";
import { analyzeGuard, buildCodexPubSet, selectCapsSigningKey } from "@stoachain/stoa-core/guard";
import type { GuardAnalysis } from "@stoachain/stoa-core/guard";
import { mayComeWithDeimal } from "@stoachain/stoa-core/pact";
import type { ICommand } from "@stoachain/kadena-stoic-legacy/client";
import type { IKadenaKeypair as IStoaChainKeypair } from "@stoachain/stoa-core/signing";

import { useGetKeypair } from "../../hooks/index.js";
import { useEnsureCodexUnlocked } from "../../zbom/hooks/useEnsureCodexUnlocked.js";
import { getIgnisBalance, getStoaChainAccountGuard } from "../../zbom/debouncer/monitoredReads.js";
import {
  getRotateGuardInfoLive,
  getRotateStoaChainInfoLive,
} from "../../zbom/ouroSelectorReads.js";
import { createMultiStepToast } from "../../zbom/toast/toastManager.js";
import {
  describeMigrationChainPlan,
  runMigrationChain,
  type DefineKeysetStepRequest,
  type MigrationChainDeps,
  type MigrationChainOutcome,
  type MigrationChainRequest,
  type MigrationPreconditionFacts,
  type RotateGuardStepRequest,
  type UrStoaVaultStepRequest,
} from "../../zbom/execute/engine.js";
import { awaitTxVerdict, awaitTxVerdictLiveDeps } from "../../zbom/execute/awaitConfirmation.js";
import { readChainState, type ChainStateQuery } from "../../zbom/execute/chainState.js";
import {
  createSignedCrossChainInitiate,
  runCrossChainStoaTransfer,
} from "../../zbom/execute/crossChainStoaTransfer.js";
import {
  liveNativeStoaChainEdge,
  submitNativeStoaTransfer,
} from "../../zbom/execute/nativeStoaTransfer.js";
import { stakeUrStoa, transferUrStoa } from "../../zbom/execute/urStoaOps.js";
import {
  collectAndUnstakeUrStoa,
  liveCollectUnstakeChainEdge,
} from "../../zbom/execute/collectUnstakeUrStoa.js";
import {
  liveDefineKeysetChainEdge,
  submitDefineKeyset as submitDefineKeysetTransaction,
  type DefineKeysetKeypair,
  type DefineKeysetRequest,
} from "../../zbom/execute/defineKeysetOps.js";
import {
  KeysetUpdateGate,
  type KeysetUpdateSelection,
} from "./KeysetUpdateGate.js";
import {
  executeRotateGuard,
  executeRotatePaymentKey,
  liveRotateGuardSubmitter,
  liveRotatePaymentKeySubmitter,
  type GuardSignerAnalysis,
  type ResolvedKeysetLike,
  type RotateGuardRequest,
} from "../../zbom/execute/rotateOps.js";
// The leaf operations ouronet-core owns. Named HERE and nowhere else on the
// engine's path — every module under `zbom/execute` takes them as an injected
// dependency with no default, so a forgotten wiring fails closed instead of
// reaching mainnet by accident.
import {
  executeNativeUrStoaTransfer,
  executeStakeUrStoa,
  checkCoinAccountExists as checkUrStoaAccountExists,
} from "@ouronet/ouronet-core/interactions/urStoaFunctions";
// The NATIVE coin.get-balance probe, which is a DIFFERENT function from the
// urSTOA-scoped one of the same name above — the distinction
// `tests/ui-send-stoa-modal.test.tsx`'s own header calls out. The native drain
// uses this one, exactly as `SendStoaModal.tsx:102` does.
import { checkCoinAccountExists as checkStoaAccountExists } from "@ouronet/ouronet-core/interactions/ouroPriceFunctions";
import {
  buildCTransferAcross,
  buildContinuationTransaction,
  pollSpvProof,
  submitContinuation,
  submitCrossChainTransfer,
} from "@ouronet/ouronet-core/interactions/crossChainFunctions";

// ─── The deps factory — the one place the real functions are named ──────────

/**
 * What the React boundary knows and the engine deliberately does not: the
 * keypair resolver, the codex's own public keys (hence every guard analysis),
 * the patron, and the progress recorder.
 *
 * Everything else the engine needs is a module this factory names. Taken as
 * arguments rather than read from hooks so the factory is callable — and
 * inspectable — outside React.
 */
export interface MigrationChainDepsInput {
  /** The Ouronet account whose payment key and guard F and G change. */
  readonly accountAddress: string;
  /** Who pays the two rotations' IGNIS. Today always the master account
   *  itself, which is both the migration's subject and the Prime patron —
   *  `usePatronSelectionDefaults`' "prime" and "resident" modes coincide
   *  here. Taken as its own field so that stops being an assumption. */
  readonly patronAddress: string;
  /** The payment-key ADDRESS funds move OFF — `account.stoaChainLedger`,
   *  never `chainPublicKey` (design §7 defect 2). */
  readonly oldPaymentAddress: string;
  /** Whether the chosen guard's keys are resolved — known at selection time
   *  (`describeKeyset` for `use-existing-keyset`, derived otherwise), so the
   *  §5 gate is told rather than left to guess. */
  readonly chosenGuardKeysResolved: boolean;
  /** Every public key this codex holds — `buildCodexPubSet`'s output. */
  readonly codexPubs: Set<string>;
  /** The `ensureCodexUnlocked` gate as a single callable. Passed through
   *  UNWRAPPED: the engine calls it exactly once, before the loop. */
  readonly ensureCodexUnlocked: () => Promise<boolean>;
  /** `useGetKeypair()`'s resolver. A falsy answer means "this codex does not
   *  hold that key". */
  readonly getKeypair: (publicKey: string) => Promise<IStoaChainKeypair | null | undefined>;
  /** The store's `recordMigrationExecutionStep`. Passed through UNWRAPPED. */
  readonly recordStep: (step: MigrationExecutionStep) => void | Promise<void>;
  /**
   * {@link KeysetUpdateGate}'s whole resolution, lifted out of the gate and
   * held in component state for ONE press — design §3's precondition, settled
   * BEFORE the button rather than asked for mid-chain.
   *
   * Absent or `null` means "no keyset update was resolved", which
   * {@link keysetUpdatePreconditionFacts} reads as NOT satisfiable. That is
   * the safe direction: the alternative is a press that drains the account and
   * then fails a `define-keyset` the codex could never have signed.
   */
  readonly keysetUpdate?: KeysetUpdateSelection | null;
}

// ─── The three decisions round 2 adds, as values rather than as closures ────
//
// Each takes its one seam as a REQUIRED argument and is exported, for a reason
// this file's hazard header forces: {@link createMigrationChainDeps}'s
// closures name the real `collectAndUnstakeUrStoa`, the real
// `submitDefineKeyset` and the real `checkCoinAccountExists`, so no test may
// ever INVOKE one. Pulling the decisions out means they are asserted directly,
// by their own specs, with no module behind them to reach a node — and what is
// left in the factory is the naming, which the factory's spec inspects without
// calling.

/**
 * Step C's `collectRewards` argument — BOTH conditions, together, because each
 * guards a DIFFERENT chain-side failure of the SAME transaction:
 *
 *  - `req.collectRewards` is the planner's earnings flag, off the fresh
 *    snapshot's `URC_URV|ClaimableRewards`. Collecting zero rewards fails on
 *    `coin-live.pact`'s `debit` enforcement `(> amount 0.0)`;
 *  - the probe is the NATIVE `coin.get-balance` one. Collect credits the
 *    coin-table, so an address with no coin row fails on `UR_Guard`.
 *
 * Collect and Unstake share ONE transaction, so either failure takes the
 * unstake down with it — and the `(coin.C_CreateAccount …)` repair
 * `executeCollectUrStoa` would normally prepend is NOT available here, because
 * three `(coin.C_` forms match no `DALOS.GAS_PAYER` case at all
 * (`01_DALOS.pact:456-526`). A future reader WILL try to drop one half; this
 * is the comment that says which failure each one is holding back.
 *
 * `null` from the probe ("absent OR RPC error") collapses to does-not-exist,
 * the safe branch: a lone Unstake always lands, a Collect against a missing
 * coin row never does.
 */
export async function resolveCollectRewards(
  req: UrStoaVaultStepRequest,
  checkCoinAccountExists: (account: string) => Promise<boolean | null>,
): Promise<boolean> {
  // Short-circuit deliberately: with no rewards to collect there is nothing
  // for the probe to decide, and a read not spent is a read that cannot fail.
  if (req.collectRewards !== true) return false;
  return (await checkCoinAccountExists(req.address)) === true;
}

/** The keyset update was never resolved before the press, so the signer set is
 *  unknown. Thrown rather than returned: the engine REPORTS a throw from the
 *  keyset step and carries on with the rest of the migration. */
export const KEYSET_ANALYSIS_MISSING_MESSAGE =
  "The keyset update could not be prepared: the referenced keyset's current definition "
  + "was never resolved before the press, so there is no way to know which keys have to "
  + "sign it. Nothing was submitted for this step, and the rest of the migration ran "
  + "normally.";

/**
 * The engine's `define-keyset` request, turned into the builder's.
 *
 * Two halves from two places, and mixing them up is the defect worth guarding:
 *
 *  - the REFERENCE and the self-paid gas PAYER come from the engine, which
 *    reads both off the FRESH snapshot — the live guard's reference, and the
 *    registered payment key as of the moment the step actually runs;
 *  - the NEW `{ keys, pred }` is the engine's request too, carrying the
 *    RECORDED plan's `guardPublicKeys` + `guardPred`. It is emphatically NOT
 *    the current keyset: this transaction REPLACES the keyset, and posting its
 *    current definition back would simulate clean, submit, cost gas, achieve
 *    nothing and silently discard the choice the owner recorded;
 *  - the CURRENT keyset's analysis and the manual keys come from the gate,
 *    which resolved them before the press.
 *
 * **Note the asymmetry with `resolveGuards()` and do not "fix" it.** That
 * function analyses the PATRON's and the ACCOUNT's guards with `{}` for manual
 * keys, and its comment is still right: design §3 forbids prompting mid-chain
 * for THOSE. The keyset's own current keyset is a third guard, resolved BEFORE
 * the press by {@link KeysetUpdateGate}, and supplying keys for it is exactly
 * what §3 blesses — which is why `analyzeGuard(…, {})` sits a few lines from
 * an analysis built with real manual keys without either being an oversight.
 */
export function buildDefineKeysetRequest(
  req: DefineKeysetStepRequest,
  keysetUpdate: KeysetUpdateSelection | null | undefined,
  payerKey: DefineKeysetKeypair,
): DefineKeysetRequest {
  const analysis = keysetUpdate?.analysis ?? null;
  // With no analysis the threshold walk has no candidates, so the transaction
  // would go out signed by the gas payer alone — a guaranteed `Keyset failure`
  // and a wasted STOA gas spend.
  if (analysis === null) throw new Error(KEYSET_ANALYSIS_MISSING_MESSAGE);
  return {
    keysetRef: req.keysetRef,
    newKeyset: { keys: [...req.keys], pred: req.pred },
    payerAddress: req.payerAddress,
    payerKey,
    chainId: req.chainId,
    // Already `analyzeGuard(currentKeyset, codexPubs, manualKeys)` — the gate
    // re-analyses on every pasted key, which is what lets
    // `collectGuardSigners` reach them through `resolvedForeignKeys`.
    currentKeysetAnalysis: analysis,
    manualKeys: keysetUpdate?.manualKeys ?? {},
  };
}

// ─── G's request — the INCOMING keyset's own signature ──────────────────────

/**
 * The guard being ADOPTED cannot be signed from this codex, so the rotation
 * can never land. Named here, with the keys, because the chain's own words for
 * it are `Keyset failure ( keys-all ): 22ac9147…` — a key the owner then has
 * to recognise unaided.
 */
function chosenGuardUnsignableMessage(analysis: GuardAnalysis): string {
  const missing = analysis.foreignKeys.join(", ");
  return (
    `The chosen guard cannot be co-signed by this codex: its predicate `
    + `(${analysis.predLabel}) needs ${analysis.threshold} of its `
    + `${analysis.keys.length} keys and only ${analysis.signable} can be signed `
    + `for. This codex does not hold ${missing}. A guard change must be signed by `
    + `the keyset being adopted — that is what proves you control what the `
    + `account is being moved to — so nothing was submitted for this step. `
    + `Nothing else in the migration is undone: press again once the missing key `
    + `is in this codex, or record a different guard.`
  );
}

/** What {@link buildRotateGuardRequest} needs that the engine's step request
 *  does not carry: the patron, the gas-station keypair, the two guard analyses
 *  {@link createMigrationChainDeps} resolved once for this press, and the
 *  codex's own public keys — which is what makes the NEW guard analysable. */
export interface RotateGuardContext {
  readonly patronAddress: string;
  readonly gasStationKey: IStoaChainKeypair;
  readonly patronAnalysis: GuardSignerAnalysis;
  readonly accountAnalysis: GuardSignerAnalysis;
  readonly codexPubs: Set<string>;
}

/**
 * G's whole request — including the INCOMING guard's own analysis, which is
 * the half the 2026-11-26 mainnet run was missing.
 *
 * ## Why the new guard must co-sign, and why that is not negotiable
 *
 * `C_RotateGuard` is submitted with `safe: true` (forced — `rotateOps.ts`'s
 * `GuardChangeTarget`), and the chain then requires the keyset in the `ks`
 * payload to sign its own adoption. That is the check that stops a user
 * locking an account behind a keyset they do not hold. `executeRotateGuard`
 * collects `newGuardKeys` ONLY from `newGuardAnalysis`, and this factory used
 * to pass just the patron's and the account's — so the incoming keyset went
 * out with no signer and the chain answered
 * `Keyset failure ( keys-all ): 22ac9147…` at SIMULATION, after step 0 had
 * already confirmed. The fix is to satisfy the check, never to send
 * `safe: false`.
 *
 * ## The threshold is the NEW predicate's
 *
 * `collectGuardSigners` stops at `analysis.threshold`, so the analysis is
 * built over `req.guard.{keys,pred}` — the keyset being adopted — and
 * `analyzeGuard` derives the number from THAT predicate and THAT key count
 * (`keys-all` → N, `keys-any` → 1). Reusing `context.accountAnalysis`, or its
 * threshold, would collect one key for a two-key `keys-all` guard and fail on
 * chain in exactly the way this function exists to prevent.
 *
 * ## No manual keys — and a THROW rather than a short signer set
 *
 * `{}`, for design §3's reason: the chain never stops to ask for a private
 * key. So a chosen guard this codex cannot satisfy is not something a prompt
 * can rescue, and the honest answer is to refuse. Thrown, which the engine
 * turns into a halt that names the step with nothing submitted for it — the
 * same shape as {@link buildDefineKeysetRequest}'s refusal.
 *
 * It is a SUBMIT-TIME refusal rather than a §5 precondition, deliberately.
 * Two reasons, in order: core's precondition vocabulary has no code for "the
 * chosen guard is unsignable" (`guard-keys-unresolved` means the keys are not
 * KNOWN, a different fact resolved at selection time), so reporting it there
 * would print a reason that is not the real one; and the plan — which decides
 * whether a `rotate-guard` step is even owed — is computed from fresh chain
 * reads inside the engine, so a gate at the press would refuse runs whose
 * guard is already in force, blocking the fund moves with it. G is also LAST
 * and independent: a halt here leaves every earlier step legitimately done,
 * and the chain is resumable.
 */
export function buildRotateGuardRequest(
  req: RotateGuardStepRequest,
  context: RotateGuardContext,
): RotateGuardRequest {
  const newGuardAnalysis = analyzeGuard(
    { keys: [...req.guard.keys], pred: req.guard.pred },
    context.codexPubs,
    {},
  );
  if (!newGuardAnalysis.satisfied) {
    throw new Error(chosenGuardUnsignableMessage(newGuardAnalysis));
  }
  return {
    patronAddress: context.patronAddress,
    accountAddress: req.accountAddress,
    gasStationKey: context.gasStationKey,
    patronAnalysis: context.patronAnalysis,
    accountAnalysis: context.accountAnalysis,
    newGuardAnalysis,
    // Always the `"define"` form — see the factory's G closure for why a REF
    // repoint is not expressible through this seam.
    target: { mode: "define", newKeys: [...req.guard.keys], newPred: req.guard.pred },
  };
}

/**
 * The keyset half of design §5's precondition facts.
 *
 * `false` for an absent resolution is the whole point: the safe direction for
 * a missing satisfiability signal is REFUSE, because the alternative is a
 * press that drains every balance and only then discovers that the keyset it
 * was asked to redefine cannot be signed. Core checks this ONLY when an
 * EXECUTABLE `define-keyset` step is in the plan, so a `false` left over from
 * a run that touches no keyset refuses nothing.
 *
 * `forfeited` is deliberately NOT consulted. It is ORTHOGONAL to `satisfied`,
 * and a forfeit proceeds through the PLANNER — which emits the step as
 * non-executable — not by claiming the keyset was satisfiable after all.
 *
 * The counts are display detail for criterion 5's "name the shortfall", never
 * the decision: the boolean above is the single source of truth, so the two
 * cannot disagree about whether to refuse.
 */
export function keysetUpdatePreconditionFacts(
  keysetUpdate: KeysetUpdateSelection | null | undefined,
): Pick<MigrationPreconditionFacts, "keysetUpdateSatisfiable" | "keysetUpdateKeyCounts"> {
  const analysis = keysetUpdate?.analysis ?? null;
  return {
    keysetUpdateSatisfiable: keysetUpdate?.satisfied === true,
    ...(analysis === null
      ? {}
      : {
          keysetUpdateKeyCounts: {
            resolved: analysis.signable,
            total: analysis.keys.length,
            threshold: analysis.threshold,
          },
        }),
  };
}

/** Why a submitter could not start: the codex does not hold the key the step
 *  must be signed with. Thrown, not returned — the engine turns a throw into
 *  a halt that names the step, and nothing is submitted. */
function keyMissingMessage(publicKey: string | null): string {
  return publicKey === null
    ? "No payment key could be derived from this account's payment address, so "
      + "this step cannot be signed. Nothing was submitted."
    : `This codex does not hold the key ${publicKey}, which this step must be `
      + `signed with. Nothing was submitted.`;
}

/** `infoData?.ignis?.["ignis-need"]` → a number. The same two-line coercion
 *  `zbom/modals/RotatePaymentKeyModal.tsx:66-70` and `RotateGuardModal.tsx`
 *  each carry; kept local because promoting it would touch files outside this
 *  change. */
function ignisNeedOf(infoData: unknown): number {
  const need = (infoData as { ignis?: Record<string, unknown> } | null)?.ignis?.["ignis-need"];
  if (need === null || need === undefined) return 0;
  const raw = mayComeWithDeimal(need as never);
  return typeof raw === "number" ? raw : parseFloat(String(raw)) || 0;
}

/** The guard facts every rotation and every gas-paying step needs, read once
 *  per press. */
interface ResolvedGuardFacts {
  readonly patronGuard: ResolvedKeysetLike | null;
  readonly accountGuard: ResolvedKeysetLike | null;
  readonly patronAnalysis: GuardSignerAnalysis & { readonly satisfied: boolean };
  readonly accountAnalysis: GuardSignerAnalysis & { readonly satisfied: boolean };
  /** The key that signs `DALOS.GAS_PAYER` for the Ouronet gas station, chosen
   *  by `selectCapsSigningKey` exactly as both rotate modals choose it. */
  readonly capsKeyPub: string | null;
}

/**
 * Assemble the engine's whole injected world.
 *
 * Synchronous and I/O-free: every member is a closure, and nothing is read,
 * resolved or submitted until the engine calls one. The chain reads the §5
 * gate needs happen inside `readPreconditionFacts`, once, which is where the
 * engine asks for them.
 */
export function createMigrationChainDeps(input: MigrationChainDepsInput): MigrationChainDeps {
  const requireKeypair = async (publicKey: string | null): Promise<IStoaChainKeypair> => {
    if (publicKey === null || publicKey.length === 0) throw new Error(keyMissingMessage(null));
    const keypair = await input.getKeypair(publicKey);
    if (!keypair) throw new Error(keyMissingMessage(publicKey));
    return keypair;
  };

  /** A payment ADDRESS is an encoding of its own public key — `k:<pub>` or, for
   *  a stoic seed, the bare key (`store.ts:2680`). So the key a step must be
   *  signed with is derivable from the address the engine hands the submitter,
   *  which is what keeps the NEW key's re-stake (E) signed by the NEW key. */
  const signerOf = (address: string): string | null => bareKeyOf(address);

  // Resolved at most ONCE per factory — i.e. per press. Two chain reads, and
  // `readPreconditionFacts` always runs before any submit, so every later
  // consumer finds the cache warm.
  let guardFacts: Promise<ResolvedGuardFacts> | null = null;
  const resolveGuards = (): Promise<ResolvedGuardFacts> => {
    guardFacts ??= (async (): Promise<ResolvedGuardFacts> => {
      // `IOuroAccount.guard` is an UNRESOLVED keyset-REF carrying no `.keys`,
      // so it is read from chain first — the same `getStoaChainAccountGuard`
      // step both rotate modals take, and for the same reason: an unresolved
      // ref analyses as trivially `satisfied: true`.
      const accountGuard = ((await getStoaChainAccountGuard(
        input.accountAddress,
      )) as unknown as ResolvedKeysetLike | null) ?? null;
      const patronGuard =
        input.patronAddress === input.accountAddress
          ? accountGuard
          : ((await getStoaChainAccountGuard(
              input.patronAddress,
            )) as unknown as ResolvedKeysetLike | null) ?? null;

      // No manual foreign keys: design §3 forbids prompting mid-chain, so a
      // guard this codex cannot satisfy is a PRECONDITION refusal before the
      // first transaction, never a question asked at step 7.
      const patronAnalysis = analyzeGuard(patronGuard as never, input.codexPubs, {});
      const accountAnalysis = analyzeGuard(accountGuard as never, input.codexPubs, {});

      const pureSigningPubs = new Set<string>([
        ...patronAnalysis.codexKeys,
        ...patronAnalysis.resolvedForeignKeys,
        ...(input.patronAddress === input.accountAddress
          ? []
          : [...accountAnalysis.codexKeys, ...accountAnalysis.resolvedForeignKeys]),
      ]);
      const caps = selectCapsSigningKey(
        signerOf(input.oldPaymentAddress),
        input.codexPubs,
        pureSigningPubs,
      );
      return { patronGuard, accountGuard, patronAnalysis, accountAnalysis, capsKeyPub: caps.key };
    })();
    return guardFacts;
  };

  /** The gas-station caps signer, resolved to a keypair. */
  const gasStationKey = async (): Promise<IStoaChainKeypair> =>
    requireKeypair((await resolveGuards()).capsKeyPub);

  return {
    // Passed through UNWRAPPED — the engine owns the "exactly once" rule.
    ensureCodexUnlocked: input.ensureCodexUnlocked,
    recordStep: input.recordStep,

    readChainState: (query) => readChainState(query),

    confirm: (requestKey, chainId) => awaitTxVerdict(requestKey, chainId, awaitTxVerdictLiveDeps),

    // The §5 facts, gathered ONCE for the plan that is about to run. The
    // `plan` argument is deliberately unused: both rotations' `ignis-need` is
    // read unconditionally (two cheap INFO reads) and `sumIgnisNeed` is what
    // decides which of them the plan actually owes — duplicating that choice
    // here is how an aggregate gas check ends up short by one transaction.
    readPreconditionFacts: async (): Promise<MigrationPreconditionFacts> => {
      const guards = await resolveGuards();
      const oldSigner = signerOf(input.oldPaymentAddress);
      const [oldKeypair, ignis, rotateStoaInfo, rotateGuardInfo] = await Promise.all([
        // A codex that cannot produce the old payment key cannot sign A-E.
        // A throw here is the same answer as a `null`, not an escape: the §5
        // gate's job is to report it, once, before anything is submitted.
        oldSigner === null
          ? Promise.resolve(null)
          : input.getKeypair(oldSigner).catch(() => null),
        getIgnisBalance(input.patronAddress).catch(() => null),
        getRotateStoaChainInfoLive(input.patronAddress, input.accountAddress).catch(() => null),
        getRotateGuardInfoLive(input.patronAddress, input.accountAddress).catch(() => null),
      ]);
      return {
        oldPaymentKeypairPresent: Boolean(oldKeypair),
        chosenGuardKeysResolved: input.chosenGuardKeysResolved,
        // The keyset's CURRENT keys, as the gate resolved them before the
        // press. `chosenGuardKeysResolved` keeps its own meaning — the NEW
        // keys — and is deliberately not overloaded with this.
        ...keysetUpdatePreconditionFacts(input.keysetUpdate),
        // BOTH guards: the rotations enforce the patron's guard as well as the
        // account's, and a chain that cannot satisfy either signs nothing.
        currentGuardSatisfiable:
          guards.patronAnalysis.satisfied && guards.accountAnalysis.satisfied,
        patronIgnisBalance: ignis === null || ignis === undefined ? null : parseFloat(String(ignis)),
        ignisCosts: {
          rotatePaymentKey: ignisNeedOf(rotateStoaInfo),
          rotateGuard: ignisNeedOf(rotateGuardInfo),
        },
      };
    },

    // A(n) — one consolidation hop. The source chain is 1-9 by construction,
    // so the initiate is always the signed non-chain-0 one.
    submitConsolidateStoa: async (req) => {
      const senderPublicKey = signerOf(req.sender);
      if (senderPublicKey === null) throw new Error(keyMissingMessage(null));
      return runCrossChainStoaTransfer(
        {
          sender: req.sender,
          receiver: req.receiver,
          amount: req.amount,
          sourceChain: req.sourceChain,
          targetChain: req.targetChain,
        },
        {
          submitInitiate: createSignedCrossChainInitiate({
            senderPublicKey,
            getKeypair: (publicKey) => requireKeypair(publicKey),
            sign: async ({ tx, capsKey, guardKeypairs }) => {
              const { fromKeypair, universalSignTransaction } = await import(
                "@stoachain/stoa-core/signing"
              );
              // Deduped by public key, as `CodexSigningStrategy.sign` does —
              // and with NO foreign-key prompt, which is the whole reason the
              // strategy is not on this path.
              const seen = new Set<string>();
              const signers = [capsKey, ...guardKeypairs].filter((keypair) => {
                if (seen.has(keypair.publicKey)) return false;
                seen.add(keypair.publicKey);
                return true;
              });
              // `universalSignTransaction` is declared `IUnsignedCommand |
              // ICommand` only to preserve `@kadena/client`'s type contract —
              // its own doc comment says the result is "always an `ICommand`
              // in practice", which is why `CodexSigningStrategy.sign` is
              // declared `Promise<ICommand>` over the same call.
              const signed = await universalSignTransaction(
                tx,
                signers.map((k) => fromKeypair(k)),
              );
              return signed as ICommand;
            },
            buildCTransferAcross,
            submitCrossChainTransfer,
          }),
          awaitInitiateVerdict: (requestKey, chainId) =>
            awaitTxVerdict(requestKey, chainId, awaitTxVerdictLiveDeps),
          pollSpvProof,
          buildContinuationTransaction,
          submitContinuation,
          // The hop reports onto the engine's own toast rows; the engine has
          // already applied the offset.
          onStep: req.onStep,
        },
      );
    },

    // B — the chain-0 drain, old key → new key.
    submitDrainStoa: async (req) => {
      const [senderKey, gasKey] = await Promise.all([
        requireKeypair(signerOf(req.sender)),
        gasStationKey(),
      ]);
      // From chain, never assumed: it selects `C_Transfer` vs
      // `C_TransferAnew`, and a wrong guess fails the step on chain. `null`
      // ("absent OR RPC error") collapses to "does not exist", the safe
      // branch — `TransferAnew` is correct either way.
      const receiverExists = (await checkStoaAccountExists(req.receiver)) === true;
      return submitNativeStoaTransfer(
        {
          sender: req.sender,
          receiver: req.receiver,
          amount: req.amount,
          chainId: req.chainId,
          receiverExists,
          senderKey,
          gasStationKey: gasKey,
        },
        liveNativeStoaChainEdge(),
      );
    },

    // C — COLLECT then unstake at the OLD key, in ONE gas-station-sponsored
    // transaction (design §1). Patronless: the payment key signs
    // `DALOS.GAS_PAYER` as well as both `coin.URV|*` capabilities.
    //
    // Collect pays out NATIVE STOA onto this same key, which is why the
    // planner now emits C BEFORE B: B then drains the collected rewards too,
    // in the same press. The superseded single-expression `unstakeUrStoa` left
    // those rewards behind on a key the account stops naming at F.
    submitUnstakeUrStoa: async (req) => {
      const paymentPublicKey = signerOf(req.address);
      if (paymentPublicKey === null) throw new Error(keyMissingMessage(null));
      return collectAndUnstakeUrStoa(
        {
          paymentKeyAddress: req.address,
          amount: req.amount,
          collectRewards: await resolveCollectRewards(req, checkStoaAccountExists),
          paymentKey: await requireKeypair(paymentPublicKey),
        },
        liveCollectUnstakeChainEdge(),
      );
    },

    // D — move the liquid urSTOA to the NEW key.
    submitTransferUrStoa: async (req) => {
      const senderPublicKey = signerOf(req.senderAddress);
      if (senderPublicKey === null) throw new Error(keyMissingMessage(null));
      return transferUrStoa(
        {
          senderAddress: req.senderAddress,
          senderPublicKey,
          receiverAddress: req.receiverAddress,
          amount: req.amount,
        },
        {
          executeNativeUrStoaTransfer,
          checkCoinAccountExists: checkUrStoaAccountExists,
          getKeypair: requireKeypair,
        },
      );
    },

    // E — re-stake on the NEW key, which is why the signer is derived from the
    // address the engine passes rather than from the old one.
    submitStakeUrStoa: async (req) => {
      const paymentPublicKey = signerOf(req.address);
      if (paymentPublicKey === null) throw new Error(keyMissingMessage(null));
      return stakeUrStoa(
        { paymentKeyAddress: req.address, paymentPublicKey, amount: req.amount },
        { executeStakeUrStoa, getKeypair: requireKeypair },
      );
    },

    // F — rotate the payment key. AFTER the drain: every step above is signed
    // by the old payment key, which must still be the one the account names.
    submitRotatePaymentKey: async (req) => {
      const guards = await resolveGuards();
      return executeRotatePaymentKey(
        {
          patronAddress: input.patronAddress,
          accountAddress: req.accountAddress,
          newPaymentKey: req.newPaymentKey,
          gasStationKey: await gasStationKey(),
          patronAnalysis: guards.patronAnalysis,
          accountAnalysis: guards.accountAnalysis,
          patronGuard: guards.patronGuard,
          accountGuard: guards.accountGuard,
        },
        { getKeypair: input.getKeypair, submitRotatePaymentKey: liveRotatePaymentKeySubmitter },
      );
    },

    // G — rotate the guard, LAST: the moment it lands the signing set changes.
    //
    // Always the `"define"` form, i.e. `(read-keyset "ks")` with the chosen
    // keys. The engine's request carries keys+pred and no keyset reference, so
    // a REF repoint is not expressible through this seam at all — that remains
    // `RotateGuardModal`'s "existing" mode. The one guard choice that would
    // need a ref (`update-keyset-*`) is planned as the non-executable
    // `define-keyset` step and is reported, never submitted.
    //
    // The request — INCLUDING the incoming keyset's own analysis — is built by
    // {@link buildRotateGuardRequest} rather than inline here. That is not
    // tidiness: this closure names `liveRotateGuardSubmitter`, so no test may
    // invoke it, and the request assembled inline was where the 2026-11-26
    // mainnet failure lived. As a value, it is asserted directly.
    submitRotateGuard: async (req) => {
      const guards = await resolveGuards();
      return executeRotateGuard(
        buildRotateGuardRequest(req, {
          patronAddress: input.patronAddress,
          gasStationKey: await gasStationKey(),
          patronAnalysis: guards.patronAnalysis,
          accountAnalysis: guards.accountAnalysis,
          codexPubs: input.codexPubs,
        }),
        { getKeypair: input.getKeypair, submitRotateGuard: liveRotateGuardSubmitter },
      );
    },

    // The keyset-definition update — `(define-keyset "<ns>.<ksn>" (read-keyset
    // "ks"))`. A SIBLING of G, never a mode of it: `C_RotateGuard` cannot
    // express a keyset-DEFINITION update, which is why this is its own
    // transaction and its own submitter.
    //
    // GAS — SELF-PAID, AND THE PAYER IS A PROVISIONAL DEFAULT. This is the one
    // transaction in the chain the Ouronet gas station cannot sponsor:
    // `DALOS.GAS_PAYER` (`01_DALOS.pact:456-526`) accepts exactly three
    // transaction shapes and a bare `(define-keyset …)` matches none of them,
    // so `payerAddress` must name a real STOA account whose key this codex
    // holds. The engine supplies the FRESH snapshot's registered payment key —
    // i.e. the migrated account's own payment key, whose keypair is already
    // resolved and in hand by this point in the chain. **The owner has not
    // settled which account should pay, so that is a DEFAULT awaiting
    // confirmation, not a decided product rule.** The alternative on the table
    // is `DALOS.GAS_PAYER`'s Case 3, which costs the patron a >=25-IGNIS
    // `C_Transmute` donation and needs the define-keyset wrapped in a `(let …)`
    // — a different builder, not a flag. If the owner picks that, this is the
    // line that changes.
    submitDefineKeyset: async (req) => {
      const payerPublicKey = signerOf(req.payerAddress);
      if (payerPublicKey === null) throw new Error(keyMissingMessage(null));
      return submitDefineKeysetTransaction(
        buildDefineKeysetRequest(req, input.keysetUpdate, await requireKeypair(payerPublicKey)),
        // RAW `getKeypair`, not `requireKeypair`: for the current keyset's
        // co-signers a falsy answer means "this codex does not hold that key"
        // and must be SKIPPED by the threshold walk, exactly as G does it. A
        // throw there would turn a keyset the owner satisfied by hand into a
        // halt.
        { getKeypair: input.getKeypair, edge: liveDefineKeysetChainEdge() },
      );
    },

    // Display only, no network — and the ONE progress surface the owner gets
    // while the chain runs (criterion 8).
    createToast: createMultiStepToast,
  };
}

// ─── What the owner reads when it stops ─────────────────────────────────────

interface ReportedLine {
  readonly id: string;
  readonly title: string;
  readonly message: string;
}

interface OutcomeView {
  readonly heading: string;
  readonly body: readonly string[];
  /** True ONLY for a `"pending"` halt: the outcome is genuinely UNKNOWN, and
   *  wording it as a failure is what invites a duplicate resubmit of money
   *  already in flight. */
  readonly unknownOutcome: boolean;
  /** True ONLY for a refusal carrying `"keyset-update-unsatisfiable"`: the one
   *  refusal the owner can clear from this very screen, so it is the one that
   *  earns a second paragraph naming both of design §3's resolutions. */
  readonly keysetRefusal: boolean;
  readonly confirmed: readonly string[];
  readonly skipped: readonly string[];
  readonly reported: readonly ReportedLine[];
}

const EMPTY_VIEW = {
  body: [] as readonly string[],
  unknownOutcome: false,
  keysetRefusal: false,
  confirmed: [] as readonly string[],
  skipped: [] as readonly string[],
  reported: [] as readonly ReportedLine[],
};

/**
 * Every outcome status, in words. The step VOCABULARY comes from
 * `describeMigrationChainPlan` — the engine's own, so this surface and the
 * toast cannot drift apart.
 */
function describeOutcome(outcome: MigrationChainOutcome): OutcomeView {
  if (outcome.status === "locked") {
    return { ...EMPTY_VIEW, heading: "Nothing was submitted", body: [outcome.message] };
  }

  const titles = new Map(describeMigrationChainPlan(outcome.plan).map((s) => [s.id, s.title]));
  const titleOf = (id: string): string => titles.get(id) ?? id;

  if (outcome.status === "nothing-to-do") {
    return {
      ...EMPTY_VIEW,
      heading: "Nothing left to do",
      body: [
        "The chain was read first, and every step your recorded plan asks for is "
        + "already in force. Nothing was submitted.",
      ],
    };
  }

  if (outcome.status === "refused") {
    return {
      ...EMPTY_VIEW,
      // One refusal naming everything missing (criterion 7) — the chain was
      // never started, so nothing needs undoing.
      heading: "The chain did not start",
      body: [outcome.message],
      // Criterion 5. The message already NAMES the shortfall — core builds it
      // from the gate's own counts — so the extra paragraph's job is only to
      // point at the two resolutions, which for this one failure code are both
      // already on screen directly above the report.
      keysetRefusal: outcome.failures.some((f) => f.code === "keyset-update-unsatisfiable"),
    };
  }

  const common = {
    confirmed: outcome.confirmed.map(titleOf),
    skipped: outcome.skipped.map(titleOf),
    reported: outcome.reported.map((r) => ({
      id: r.stepId,
      title: titleOf(r.stepId),
      message: r.message,
    })),
  };

  if (outcome.status === "completed") {
    return {
      ...common,
      heading: "Every remaining transaction is done",
      body: [],
      unknownOutcome: false,
      keysetRefusal: false,
    };
  }

  const { halt } = outcome;
  const unknownOutcome = halt.reason === "pending";
  return {
    ...common,
    unknownOutcome,
    keysetRefusal: false,
    heading: unknownOutcome
      ? `Stopped with an UNKNOWN outcome at: ${titleOf(halt.stepId)}`
      : `Stopped at: ${titleOf(halt.stepId)}`,
    body: [halt.message],
  };
}

// ─── Styles ─────────────────────────────────────────────────────────────────

/**
 * THE DOM ANCHOR the Apply popup navigates to — a cross-package contract.
 *
 * `codex-arweave`'s Apply popup (`panel/CodexIdPage.tsx`) is the SEAL surface:
 * it refuses to seal while anything is outstanding (`applyHasOutstandingWork`)
 * and carries NO execute button, by design. Its one control therefore has to
 * lead HERE, to the single press. That control cannot import this module —
 * this package's `./ui` barrel is a NEGATIVE export lock
 * (`tests/ui-surface-stability.test.ts`) so the name cannot be published
 * through it, and every consumer's vitest/tsc path mapping resolves
 * `@ancientpantheon/codex-ouronet/<x>` to `src/<x>/index.ts`, never to a file
 * this deep. So the seam is a DOM one, and it is exactly two facts:
 *
 *   1. this `id` sits on the box that holds the execute button — never on an
 *      ancestor, never on the section wrapper, because a user sent to a card
 *      with no button has been sent nowhere;
 *   2. FOCUSING that element highlights it ({@link executorBoxStyle}'s
 *      `focused` variant), so a caller only has to `getElementById(...)` and
 *      `.focus()` to put the owner's eye on the right card. The highlight is
 *      owned here rather than reached into from outside.
 *
 * The consumer transcribes this string literally (and pins the literal in its
 * own spec, as it already does for the execute button's LABEL), so a rename
 * here is a deliberate two-sided edit. `tests/ui-pending-key-changes-section
 * .test.tsx`'s "the navigation anchor the Apply popup targets" block holds
 * both facts on this side of the boundary.
 */
export const MIGRATION_EXECUTOR_ANCHOR_ID = "codex-migration-executor";

/** The executor box. `focused` is the navigation highlight — see
 *  {@link MIGRATION_EXECUTOR_ANCHOR_ID}. Nothing else changes: an arriving
 *  user must recognise the SAME card, lit up, not a different one. */
const executorBoxStyle = (focused: boolean): React.CSSProperties => ({
  padding: 12,
  borderRadius: 8,
  backgroundColor: "#18181B",
  border: `1px solid ${focused ? "#ceac5f" : "#262626"}`,
  ...(focused ? { boxShadow: "0 0 0 3px rgba(206, 172, 95, 0.25)" } : {}),
  display: "flex",
  flexDirection: "column",
  gap: 8,
});

const buttonStyle = (busy: boolean): React.CSSProperties => ({
  alignSelf: "flex-start",
  padding: "8px 14px",
  borderRadius: 6,
  border: "none",
  backgroundColor: busy ? "#262626" : "#ceac5f",
  color: busy ? "#8b8b96" : "#0a0a0a",
  fontWeight: 700,
  fontSize: 12,
  cursor: busy ? "default" : "pointer",
});

const noteStyle: React.CSSProperties = { margin: 0, fontSize: 12, color: "#8b8b96" };
const headingStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  fontWeight: 700,
  color: "#d2d3d4",
};

// ─── The planned payment key, and the reconciliation of the registered one ──

/**
 * The payment key the recorded plan intends — the BARE key and the seed type
 * that decides its address form, resolved once, together.
 *
 * Deliberately does NOT carry the account-string form. There is exactly one
 * implementation of design §5's seed-type rule (`paymentKeyAccountString`,
 * `migrationChain.ts:490`, mirroring `state/store.ts:2680`) and exactly one
 * caller that needs it: the ENGINE, which performs the conversion itself
 * because the transaction is what needs the account string. The stored
 * `stoaChainLedger` is no longer derived from the plan at all — it is
 * reconciled from what the chain reports
 * ({@link reconcileAccountFromChainState}), so there is no second
 * derivation left here to drift from the first.
 *
 * `pending` before `committed`, the same precedence the engine's own intent
 * assembly uses: `pending` is what the last finalize decided Apply would
 * execute, so it is what is about to be sent.
 */
export interface PlannedPaymentKey {
  /** Bare hex, as `MigrationPendingPlan.paymentPublicKey` stores it. */
  readonly publicKey: string | null;
  /** The paired seed's type, which is what decides the address form. */
  readonly seedType: string | null;
}

export function plannedPaymentKey(
  run: MigrationProgress | null | undefined,
  seeds: readonly IStoaChainSeed[],
): PlannedPaymentKey {
  const publicKey = run?.pending?.paymentPublicKey ?? run?.committed?.paymentPublicKey ?? null;
  const seedId = run?.pending?.seedId ?? run?.committed?.seedId;
  const seedType = seeds.find((seed) => seed.id === seedId)?.seedType ?? null;
  return { publicKey, seedType };
}

/** The non-throwing store handle, structurally — so this writer is callable
 *  from a spec with a synthetic store and no provider. */
interface CodexStoreHandle {
  getState: () => CodexStoreState;
}

/** Exactly the three fields of a {@link ChainStateSnapshot} this writer reads,
 *  so a spec can state an observation as a literal and the full snapshot stays
 *  assignable to it. All three come off the SAME selector row
 *  (`zbom/execute/chainState.ts`), which is why they travel together. */
export type ChainObservedAccountKeys = Pick<
  ChainStateSnapshot,
  "registeredPaymentKey" | "registeredGuard" | "registeredKeysetRef"
>;

/** Set equality, so key ORDER never makes an unchanged guard look changed and
 *  rewrite the account on every press. Mirrors `outstandingKeyChanges.ts:42`'s
 *  rule — the comparison the CARD makes — rather than a structural compare. */
function sameKeySet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((key) => set.has(key));
}

/**
 * Reconcile the master account's recorded keys with what the chain just said.
 *
 * ## Why this is driven by the READ, and not by a confirmed step
 *
 * `readChainState` is the engine's one observation of the truth, taken on
 * every press (and again before every step that follows a confirmation). It
 * carries `registeredPaymentKey` and `registeredGuard`, read live. Writing
 * from THAT covers every case at once — a rotation confirmed moments ago, one
 * already in force before the press, one performed from another surface
 * entirely, the payment key AND the guard — and it makes the card
 * structurally unable to disagree with the engine, because
 * `computeOutstandingKeyChanges` and `planMigrationChain` then compare the
 * same two values against the same recorded plan.
 *
 * The write-back this replaced fired only for a CONFIRMED `rotate-payment-key`
 * step, and the owner hit both of its blind spots on mainnet (2026-11-27):
 * run 1 confirmed the payment-key rotation before that write-back existed, so
 * run 2's engine SKIPPED the step — and a skipped step fires no `recordStep`
 * at all — while the guard had no write-back on any path. Two mechanisms are
 * also one too many for one field, so there is now exactly this one.
 *
 * ## What it may and may not write
 *
 * ONLY what the chain reported. A `null` `registeredPaymentKey` or
 * `registeredGuard` means NOT OBSERVED — the selector's BAR sentinel, an
 * unactivated account, a guard shape this code does not model — never
 * "cleared". Nothing here erases a stored value on the strength of an absent
 * one, and nothing here invents a value: the ledger is stored in the chain's
 * OWN account-string form (`k:<pub>`, or bare for a stoic seed — the
 * `state.ts:2680` rule `paymentKeyAccountString` owns), never re-derived from
 * the plan, so this surface cannot disagree with what funds are actually
 * registered to.
 *
 * Reads the account FRESH from the store rather than from a render's closure,
 * because `updateOuroAccount` merges the whole object by id: a stale copy
 * would revert any other field written since. No-ops when the observation
 * already matches, so a re-press — which re-reads the same chain state —
 * touches no storage, flips no `dirty` flag and prompts no sync the owner did
 * not earn.
 *
 * Writes `stoaChainLedger` and never the legacy `kadenaLedger` alias, which is
 * read-only by this package's own rule (`types/entities.ts:285` — "new code
 * must write `stoaChainLedger`"); a legacy account's `kadenaLedger` is left
 * exactly as stored (skip-not-drop) and is outranked by the field written here
 * in `resolveOuroAccountLedger`'s one reconciliation.
 *
 * KNOWN COUPLING, pre-existing and deliberately not widened here: the executor
 * hands the engine `masterAccount.stoaChainLedger` as the drain's SOURCE
 * address, so once a rotation is in force that address becomes the new key —
 * which is correct for "the account's registered payment key" (the field's
 * documented meaning, and what `OuronetAccountsTab.tsx:115` hydrates it from)
 * but makes the old key's leftovers invisible to a LATER press. Every press
 * drains from the address the stored field held when it started, so no run in
 * progress is affected; a migration that halts mid-drain and is re-pressed
 * after the key rotated elsewhere is the gap. The fix for that is to record
 * the drain source explicitly instead of inferring it from the registered key
 * — a change to what the wizard persists, i.e. its own topic.
 *
 * A failed write is SWALLOWED, deliberately, and that property is now MORE
 * load-bearing than it was: this runs inside the engine's chain read, so a
 * rejection would surface as "chain state could not be read" and halt a
 * migration whose transactions are fine. `updateOuroAccount` sets state before
 * it persists, so the card is already correct in memory either way. Degrading
 * to the stale card the owner already lives with is survivable; stopping the
 * chain over a cache write is not.
 */
export async function reconcileAccountFromChainState(
  store: CodexStoreHandle,
  accountId: string,
  observed: ChainObservedAccountKeys,
): Promise<void> {
  const fresh = store.getState().ouroAccounts.find((account) => account.id === accountId);
  if (fresh === undefined) return;

  const next: IOuroAccount = { ...fresh };
  let changed = false;

  // The payment key. `registeredPaymentKey` is ALREADY an account string —
  // `chainState.ts` passes the selector's `payment-key` through verbatim, the
  // same field `OuronetAccountsTab.tsx:115` hydrates `stoaChainLedger` from —
  // so there is nothing to convert, and converting would be how the stored
  // address and the registered one come apart.
  if (observed.registeredPaymentKey !== null
    && observed.registeredPaymentKey !== fresh.stoaChainLedger) {
    next.stoaChainLedger = observed.registeredPaymentKey;
    changed = true;
  }

  // The guard. `registeredGuard` is `{ keys, pred }` — `IKeyset` minus the
  // `keysetRef` annotation, which rides on `registeredKeysetRef`: BOTH are
  // read off the one raw `ouronet-account-guard` value, so carrying the
  // annotation over costs no second observation and keeps the keyset-ref
  // affordances (`resolveGuardKeys`' `viaRef`, the badge) pointing at the
  // reference the chain actually reports. The `pred` is stored as the chain
  // spells it and is never defaulted: the card compares `pred` as well as the
  // keys, so a substituted one would silently change what it compares. The
  // cast is load-bearing and deliberate — `IKeyset` declares the three
  // predicates this app OFFERS while Pact allows any `keys-N`, and coercing an
  // unlisted one into the union would be inventing a guard; the raw chain
  // value rides through exactly as `OuronetAccountsTab.tsx:106` passes the
  // selector's `any`-typed guard through on the display path.
  const guard = observed.registeredGuard;
  if (guard !== null && !sameStoredGuard(fresh.guard, guard, observed.registeredKeysetRef)) {
    next.guard = {
      pred: guard.pred as IKeyset["pred"],
      keys: [...guard.keys],
      ...(observed.registeredKeysetRef !== null
        ? { keysetRef: observed.registeredKeysetRef }
        : {}),
    };
    changed = true;
  }

  if (!changed) return;
  try {
    await store.getState().actions.updateOuroAccount(next);
  } catch {
    // See the doc above: never allowed to halt the chain.
  }
}

/** Whether the stored guard already says exactly what the chain reported —
 *  the no-churn test. Compares the keys as a SET, the predicate, and the
 *  keyset-ref annotation this writer would carry over. */
function sameStoredGuard(
  stored: IKeyset | null | undefined,
  observed: MigrationGuardTarget,
  observedRef: string | null,
): boolean {
  if (stored === null || stored === undefined) return false;
  return (
    stored.pred === observed.pred
    && sameKeySet(stored.keys, observed.keys)
    && (stored.keysetRef ?? null) === observedRef
  );
}

// ─── The executor ───────────────────────────────────────────────────────────

/** Injected by the spec; the defaults are the production wiring. See this
 *  file's mainnet-hazard header. */
export interface PendingKeyChangesSectionProps {
  readonly createDeps?: (input: MigrationChainDepsInput) => MigrationChainDeps;
  readonly runChain?: (
    req: MigrationChainRequest,
    deps: MigrationChainDeps,
  ) => Promise<MigrationChainOutcome>;
  /** {@link KeysetUpdateGate}'s one chain read. Defaults to the real
   *  `getStoaChainAccountGuard`, which is why the gate itself takes it as a
   *  required prop with no default: this is the ONE place it is named, and the
   *  component's spec injects a synthetic one. */
  readonly readAccountGuard?: (address: string) => Promise<unknown>;
  /**
   * The chain observation taken ON MOUNT — see
   * {@link MigrationExecutor}'s load-time effect. Defaults to the engine's
   * own `readChainState`, which is the SAME function
   * {@link createMigrationChainDeps} wires onto `deps.readChainState`: there
   * is one read of the account's registered key and guard in this package and
   * both call sites use it.
   *
   * MAINNET HAZARD, the same one `readAccountGuard` carries: the default is a
   * live read and this one fires on RENDER rather than on the press, so every
   * spec that mounts this section injects a synthetic one (that file's header
   * rule 4).
   */
  readonly readChainState?: (query: ChainStateQuery) => Promise<ChainStateSnapshot>;
}

interface ExecutorProps extends PendingKeyChangesSectionProps {
  readonly recordedRun: MigrationProgress;
  readonly masterAccount: IOuroAccount;
  readonly seeds: readonly IStoaChainSeed[];
  readonly recordStep: (step: MigrationExecutionStep) => void | Promise<void>;
  /**
   * {@link reconcileAccountFromChainState}, bound to the store and to the
   * resolved master — the second injected seam, alongside `recordStep`, for
   * the same reason: this component holds no store handle of its own, and the
   * engine deliberately owns none either. Must never reject; see the writer's
   * doc, where swallowing is the documented property.
   */
  readonly reconcileChainState: (observed: ChainStateSnapshot) => Promise<void>;
}

/**
 * The single control. Rendered only when a store is mounted and a plan is
 * pending, which is also what keeps the throwing hooks below off the
 * no-provider path.
 */
function MigrationExecutor({
  recordedRun,
  masterAccount,
  seeds,
  recordStep,
  reconcileChainState,
  createDeps = createMigrationChainDeps,
  runChain = runMigrationChain,
  readAccountGuard = getStoaChainAccountGuard,
  readChainState: readLiveChainState = readChainState,
}: ExecutorProps): React.ReactElement {
  const ensureCodexUnlocked = useEnsureCodexUnlocked();
  const getKeypair = useGetKeypair();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<OutcomeView | null>(null);
  /**
   * Lit while the box itself holds focus — i.e. while someone was just sent
   * here. Purely presentational, and deliberately NOT a "was navigated to"
   * flag: tying it to focus means it clears the moment the owner interacts
   * with anything, and it cannot get stuck on.
   */
  const [arrivedFocus, setArrivedFocus] = useState(false);
  /**
   * The keyset update's resolution, held for ONE press. Design §3's whole
   * point: the keys and the forfeit are settled BEFORE the button, so the
   * chain never stops to ask. Deliberately not persisted — see
   * `MigrationChainIntent.keysetUpdateForfeited`.
   */
  const [keysetUpdate, setKeysetUpdate] = useState<KeysetUpdateSelection | null>(null);
  /** The two selection kinds that plan a `define-keyset` step — the same two
   *  the planner keys on (`migrationChain.ts:417-419`). Anything else neither
   *  reads the keyset nor asks for its keys. */
  const guardSelectionKind = recordedRun.selection?.guard?.kind;
  const keysetUpdateChosen =
    guardSelectionKind === "update-keyset-recommended"
    || guardSelectionKind === "update-keyset-custom";
  // Memoised because it is the gate's `codexPubs` as well as the factory's: a
  // fresh Set per render would re-run the gate's analysis on every keystroke.
  const codexPubs = useMemo(
    () => buildCodexPubSet([...seeds], flattenStoaChainAccounts([...seeds])),
    [seeds],
  );
  // A hard re-entry guard, independent of render timing: a double-press is a
  // double chain, i.e. every remaining transaction submitted twice.
  const running = useRef(false);

  // ─── The LOAD-TIME observation — the same read, before any press ──────────

  /**
   * One chain read on MOUNT, reconciled through
   * {@link reconcileAccountFromChainState}, so the card is right before the
   * owner touches anything.
   *
   * ## Why a press was not enough (owner, mainnet, 2026-11-27)
   *
   * Both of his rotations were confirmed on chain and his stored codex still
   * held the old values (`stoaChainLedger: k:e20f2672…f231`, a `keys-any`
   * guard over the two superseded keys). The reconciliation existed, but only
   * inside `onPress`' wrap of the engine's read — so on a fresh load nothing
   * read the chain, `computeOutstandingKeyChanges` compared the stale stored
   * account against the recorded plan, the card listed both rotations as
   * outstanding, and `applyHasOutstandingWork` kept the Apply popup pointing
   * at this executor instead of offering Seal: *"i cannot apply, because it
   * takes me to the transactions, and both transactions are already done …
   * i cannot finalize the migration."* He could unstick it by pressing
   * Execute — which submits nothing and reconciles — but requiring a press on
   * a button that looks like it spends money, in order to correct a DISPLAY,
   * is the defect.
   *
   * ## Not a second mechanism
   *
   * Same read (`readChainState`, the one this package has), same single
   * writer, same three observed fields. The press path's wrap is NOT redundant
   * and stays: it reconciles the observations taken DURING a run — the
   * engine's re-read after each confirmation, and the closing read after a
   * completed chain — which a read taken at load cannot know about. Two call
   * sites of one read and one writer; there is still no second route to
   * `stoaChainLedger` or `guard`.
   *
   * It deliberately does NOT go through {@link createMigrationChainDeps}:
   * that factory names every live submitter and the two rotations, and its
   * input is all press-time material (the unlock gate, the keypair resolver,
   * the keyset gate's one-press resolution). Assembling it on page load to
   * take a display read would be the wrong coupling, and it is why the read
   * is its own injected prop.
   *
   * ## At most ONE read, and never a loop
   *
   * The write updates the store, which re-renders this component. An effect
   * that re-fired on that change would be an unbounded read loop against
   * mainnet, opened by merely loading the page. Two things prevent it: the
   * effect has NO dependencies (so React never re-runs it for this mount),
   * and `observedOnMount` is a ref — which survives both a re-render and
   * StrictMode's deliberate mount/unmount/remount — so even a re-setup takes
   * no second read. The reader and the reconciler are held in refs, updated
   * in their own effect, exactly as {@link KeysetUpdateGate} holds its
   * injected read: the parent passes inline arrows, and depending on their
   * identity is the same loop by another name.
   *
   * ## A read failure changes NOTHING
   *
   * This runs on load, so it may never break the surface. A read that throws,
   * times out or reports nothing leaves the card exactly as it was — the
   * swallow below, plus the writer's own "`null` means NOT OBSERVED, never
   * cleared" rule. No busy state is published and nothing is gated on this
   * read, so there is no spinner to get stuck and the section stays fully
   * usable offline: the one press still works, and it reconciles as before.
   *
   * Gated by this component existing at all, which is `hasMigrationPending`
   * (see the file header) — a codex with no plan pending costs no read.
   */
  const loadReadRef = useRef(readLiveChainState);
  const reconcileRef = useRef(reconcileChainState);
  useEffect(() => {
    loadReadRef.current = readLiveChainState;
    reconcileRef.current = reconcileChainState;
  }, [readLiveChainState, reconcileChainState]);

  // The query, as of mount. Only `accountAddress` decides anything here: the
  // three fields the reconciliation reads all come off that account's selector
  // row, and the snapshot's balance halves are discarded. So the payment
  // address rides in BOTH slots rather than re-deriving the planned new
  // address — the engine owns design §5's seed-type conversion, and a second
  // spelling of it on a path that reads no balance would be pure risk.
  const ledgerAddress = masterAccount.stoaChainLedger ?? "";
  const accountAddress = masterAccount.address;
  const observedOnMount = useRef(false);
  useEffect(() => {
    if (observedOnMount.current) return;
    observedOnMount.current = true;
    let aborted = false;
    void (async () => {
      try {
        const snapshot = await loadReadRef.current({
          oldPaymentAddress: ledgerAddress,
          newPaymentAddress: ledgerAddress,
          accountAddress,
        });
        // Nothing is written after unmount: the surface the observation was
        // for is gone, and the next mount takes its own read.
        if (aborted) return;
        await reconcileRef.current(snapshot);
      } catch {
        // Deliberately silent — see the doc above. A failed load-time read
        // leaves the owner with the stale card he already had, which is
        // survivable; a page that breaks because a node is unhealthy is not.
      }
    })();
    return () => { aborted = true; };
    // No dependencies, on purpose: one read per mount. See the doc above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPress = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setOutcome(null);
    try {
      const pending = recordedRun.pending;
      const guardKeys = pending?.guardPublicKeys ?? [];
      // The ONE resolution of the planned payment key — see
      // {@link plannedPaymentKey}. The engine gets the BARE key and the seed
      // type, and performs the address conversion itself.
      const planned = plannedPaymentKey(recordedRun, seeds);
      const intent: MigrationChainIntent = {
        newPaymentPublicKey: planned.publicKey,
        guard:
          guardKeys.length > 0
            ? { keys: [...guardKeys], pred: pending?.guardPred ?? "keys-all" }
            : null,
        ...(guardSelectionKind !== undefined ? { guardSelection: guardSelectionKind } : {}),
        // Criterion 8: a forfeit still EMITS the keyset step, as
        // non-executable with its own reason, so the engine's existing
        // report-and-continue branch covers it and every other step runs.
        // Spread rather than passed as `false`, so a run that forfeited
        // nothing carries no flag at all.
        ...(keysetUpdate?.forfeited === true ? { keysetUpdateForfeited: true } : {}),
      };
      const deps = createDeps({
        accountAddress: masterAccount.address,
        // Patron and subject are the same account here — see the input type.
        patronAddress: masterAccount.address,
        oldPaymentAddress: masterAccount.stoaChainLedger ?? "",
        // The NEW keys. Keeps its own meaning and is NOT overloaded with the
        // keyset's CURRENT keys, which is what `keysetUpdate` carries.
        chosenGuardKeysResolved: guardKeys.length > 0,
        codexPubs,
        ensureCodexUnlocked,
        getKeypair,
        recordStep,
        keysetUpdate,
      });

      // The engine's own observation of the chain, wrapped so that every read
      // it takes ALSO reconciles the stored account
      // ({@link reconcileAccountFromChainState}). Wrapping the injected read
      // rather than writing from a recorded step is what covers the skipped
      // rotation, the one that was already in force, and the one performed
      // elsewhere — see that writer's doc. The query is REMEMBERED rather
      // than rebuilt: the engine composes it (`engine.ts:691`) and a second
      // spelling here is exactly how the read that reconciles and the read
      // that plans come apart.
      let lastQuery: ChainStateQuery | null = null;
      const observe = async (query: ChainStateQuery): Promise<ChainStateSnapshot> => {
        lastQuery = query;
        const snapshot = await deps.readChainState(query);
        await reconcileChainState(snapshot);
        return snapshot;
      };

      const result = await runChain(
        {
          intent,
          oldPaymentAddress: masterAccount.stoaChainLedger ?? "",
          accountAddress: masterAccount.address,
          // The seed the plan was derived from decides `k:<pub>` vs bare
          // `<pub>` for the new payment key's address (design §5). The engine
          // performs that conversion; this only pairs the plan with its seed.
          seedType: planned.seedType,
        },
        { ...deps, readChainState: observe },
      );

      // ONE closing observation, and only when the chain actually landed
      // something. The engine's re-read is LAZY — taken at the top of the row
      // AFTER a confirmation, so "the last step of a chain costs no extra
      // read" (`engine.ts:875-877`) — and the guard rotation is LAST in every
      // plan. Without this, a press whose final step confirmed would leave
      // the card describing the state the chain was in BEFORE it, which is
      // precisely the guard the owner saw listed under a toast that said
      // everything was done. A halt needs none: the step that halted did not
      // confirm, so the read at the top of its own row already observed
      // whatever confirmed before it.
      if (lastQuery !== null && result.status === "completed" && result.confirmed.length > 0) {
        try {
          await observe(lastQuery);
        } catch {
          // A display refresh, never the run's verdict: the transactions are
          // in, and a failed extra read may not turn a completed chain into a
          // reported failure.
        }
      }
      setOutcome(describeOutcome(result));
    } catch (error) {
      // Nothing that escapes the engine is a flow outcome — a refused node, a
      // locked codex at keypair resolution. Reporting it beats a button that
      // silently goes idle.
      setOutcome({
        ...EMPTY_VIEW,
        heading: "The chain could not be run",
        body: [error instanceof Error ? error.message : String(error)],
      });
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [
    recordedRun, masterAccount, seeds, recordStep, reconcileChainState, createDeps, runChain,
    ensureCodexUnlocked, getKeypair, guardSelectionKind, codexPubs, keysetUpdate,
  ]);

  return (
    <div
      data-testid="pending-key-changes-executor"
      // See `MIGRATION_EXECUTOR_ANCHOR_ID`. `tabIndex={-1}` makes the box
      // programmatically focusable — which is what a cross-package caller
      // uses to move the viewport AND the screen reader's cursor here —
      // WITHOUT adding a keyboard tab stop to a page that did not ask for one.
      id={MIGRATION_EXECUTOR_ANCHOR_ID}
      tabIndex={-1}
      onFocus={() => setArrivedFocus(true)}
      onBlur={() => setArrivedFocus(false)}
      style={executorBoxStyle(arrivedFocus)}
    >
      <p style={headingStyle}>Finish the migration</p>
      <p style={noteStyle}>
        One press sends every transaction still needed, in order, without stopping to
        ask you anything. Each step is decided by reading the chain, so pressing again
        later is safe: whatever already landed is observed, never re-sent.
      </p>
      {/* Design §3: the precondition, resolved BEFORE the press. Mounted
          unconditionally and gated on `active`, which is what keeps the chain
          read off every codex that chose no keyset update. */}
      <KeysetUpdateGate
        active={keysetUpdateChosen}
        accountAddress={masterAccount.address}
        codexPubs={codexPubs}
        readAccountGuard={readAccountGuard}
        onChange={setKeysetUpdate}
      />
      <button
        type="button"
        data-testid="pending-key-changes-execute-all"
        onClick={() => { void onPress(); }}
        disabled={busy}
        aria-busy={busy}
        style={buttonStyle(busy)}
      >
        Execute all remaining transactions
      </button>
      {outcome !== null ? <OutcomeReport view={outcome} /> : null}
    </div>
  );
}

function OutcomeReport({ view }: { view: OutcomeView }): React.ReactElement {
  return (
    <div
      data-testid="pending-key-changes-execute-result"
      style={{ display: "flex", flexDirection: "column", gap: 6 }}
    >
      <p style={headingStyle}>{view.heading}</p>
      {view.body.map((line) => (
        <p key={line} style={noteStyle}>{line}</p>
      ))}
      {view.unknownOutcome ? (
        <p data-testid="pending-key-changes-halt-unknown" style={noteStyle}>
          The outcome of this step is UNKNOWN &mdash; it may still land, and nothing is
          known to have gone wrong. Do not treat it as a loss. Press &ldquo;Execute all
          remaining transactions&rdquo; again when you are ready: the next press re-reads
          the chain, so anything that landed in the meantime is simply observed rather
          than sent a second time.
        </p>
      ) : null}
      {view.keysetRefusal ? (
        <p data-testid="pending-key-changes-keyset-refusal" style={noteStyle}>
          Nothing was submitted, so there is nothing to undo. You have exactly two ways
          forward, both of them in the keyset panel above: enter the private key for the
          keyset&rsquo;s current keys until its predicate is met, or press &ldquo;Forfeit the
          update&rdquo; &mdash; the keyset then stays exactly as it is, and every other step of
          the migration runs on the next press.
        </p>
      ) : null}
      {view.confirmed.length > 0 ? (
        <p data-testid="pending-key-changes-confirmed" style={noteStyle}>
          Confirmed on chain: {view.confirmed.join("; ")}.
        </p>
      ) : null}
      {view.skipped.length > 0 ? (
        <p data-testid="pending-key-changes-skipped" style={noteStyle}>
          Already in force, so not sent: {view.skipped.join("; ")}.
        </p>
      ) : null}
      {view.reported.length > 0 ? (
        <div
          data-testid="pending-key-changes-reported"
          style={{ display: "flex", flexDirection: "column", gap: 4 }}
        >
          {/* Criterion 9: a step no code can perform is REPORTED, never
              dropped into the "already in force" list — the user must be able
              to see that it was deliberately not run. */}
          <p style={headingStyle}>Reported, not run</p>
          {view.reported.map((line) => (
            <p key={line.id} style={noteStyle}>
              <strong>{line.title}</strong> &mdash; not executable, and not run:{" "}
              {line.message}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ─── The section ────────────────────────────────────────────────────────────

export function PendingKeyChangesSection(
  props: PendingKeyChangesSectionProps = {},
): React.ReactElement | null {
  const codexStore = useCodexStoreOptional();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const recordedRun = codexStore
    ? codexStore((s: CodexStoreState) => s.migrationProgress)
    : undefined;
  // Read through the NON-throwing store handle, never the throwing
  // `useOuroAccounts()` / `useStoaChainSeeds()` hooks: `CodexIdPage` is
  // deliberately mountable with NO `<CodexProvider>` ancestor (its own
  // extraction suite asserts it "degrades honestly (no crash)"), and a
  // throwing hook here took the whole page down with it. The executor's own
  // hooks DO throw without a provider, which is why it is a child component
  // rendered only when the store is there.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const accounts = codexStore ? codexStore((s: CodexStoreState) => s.ouroAccounts) : [];
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const seeds = codexStore ? codexStore((s: CodexStoreState) => s.kadenaSeeds) : [];
  // Read off the STORE, not `useCodex()`: that hook throws without a provider,
  // which is the one thing this component may not do (see above).
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const codexMasterSeed = codexStore
    ? codexStore((s: CodexStoreState) => s.codexMasterSeed)
    : undefined;

  /**
   * The master account, by IDENTITY — `codexMasterSeed.ouroAccountId` first,
   * then `isPrime`, then position (`resolveMasterOuronetAccount`). This read
   * was `accounts[0] ?? null`, the sixth positional-master assumption in the
   * tree after the gold/pinning/badge, the account sort,
   * `outstandingKeyChanges`' field read and the wizard's
   * `currentPaymentKeyOf`. On a codex that migrated ONTO a different account —
   * precisely the codex this surface exists for — the card described another
   * account's keys and the engine was handed another account's address to
   * rotate.
   *
   * ## No seal gate here, on purpose
   *
   * `OuronetAccountsTab` gates its golden DESIGNATION on
   * `isMigrationSealed(migrationProgress)` (`useMasterOuronetIdentity`), and
   * must: an unapplied finalize may not repaint rows gold. "Which account is
   * the master" is a different question, and `resolveMasterOuronetAccount`
   * carries no seal gate for exactly that reason (see its header: the
   * positional branch exists so an unsealed, never-migrated codex still has a
   * master row). Stage 3A is by definition BEFORE the seal — `hasMigrationPending`
   * is false once sealed — so copying the tab's gate here would pin this
   * surface to `accounts[0]` for the entire window in which it is the only
   * surface that matters, i.e. would not fix the defect at all.
   */
  // The type argument is EXPLICIT on purpose. `resolveMasterOuronetAccount`
  // is generic over `<T extends MasterOuronetAccountCandidate>`, and under
  // the BUILD tsconfig (which resets `paths`, so codex-core resolves to its
  // emitted .d.ts rather than src) inference falls back to the CONSTRAINT —
  // yielding a `MasterOuronetAccountCandidate`, which lacks every field
  // `computeOutstandingKeyChanges` and `MigrationExecutor` need. It compiled
  // under `npm run typecheck` and broke `npm run build`, i.e. CI only.
  const masterAccount =
    resolveMasterOuronetAccount<IOuroAccount>(accounts, codexMasterSeed?.ouroAccountId) ?? null;
  const outstanding = computeOutstandingKeyChanges(recordedRun, masterAccount);
  // The CARD's rule is unchanged: a user with nothing pending in KEY terms is
  // shown no card. The EXECUTOR's is `hasMigrationPending` — see the header.
  const showExecutor =
    codexStore !== null
    && codexStore !== undefined
    && masterAccount !== null
    && recordedRun !== undefined
    && hasMigrationPending(recordedRun);

  if (!masterAccount) return null;
  if (outstanding.none && !showExecutor) return null;

  return (
    <div
      data-testid="pending-key-changes-section"
      style={{ display: "flex", flexDirection: "column", gap: 10 }}
    >
      <PendingKeyChangesCard changes={outstanding.changes} />
      {showExecutor ? (
        <MigrationExecutor
          {...props}
          recordedRun={recordedRun}
          masterAccount={masterAccount}
          seeds={seeds}
          // The ONE binding of the engine's write-only step record to the
          // store. It lives HERE, not in `zbom/execute/*`: the engine
          // deliberately owns no store access beyond this injected function
          // (`engine.ts:357-359`), and giving it one would hand the module
          // that submits mainnet transactions a reason to write the codex.
          recordStep={async (step) => {
            await codexStore.getState().actions.recordMigrationExecutionStep(step);
          }}
          // The SECOND store binding, and the only writer of the account's
          // recorded keys: every chain read the engine takes is reconciled
          // against the master account — see
          // {@link reconcileAccountFromChainState} for why the observation,
          // rather than a confirmed step, is what the codex stores. Bound in
          // the same place and for the same reason as `recordStep`: this
          // component holds the store handle and the resolved master, and
          // neither the engine nor the executor holds either.
          reconcileChainState={async (observed) => {
            await reconcileAccountFromChainState(codexStore, masterAccount.id, observed);
          }}
        />
      ) : null}
    </div>
  );
}

export default PendingKeyChangesSection;
