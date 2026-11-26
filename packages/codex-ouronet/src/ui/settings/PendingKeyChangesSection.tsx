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
import { useCallback, useMemo, useRef, useState } from "react";
import { useCodexStoreOptional } from "../../provider/index.js";
import type { CodexStoreState } from "../../state/store.js";
import { flattenStoaChainAccounts } from "../../zbom/cfm/seam.js";
import { computeOutstandingKeyChanges } from "../internal/outstandingKeyChanges.js";
import { PendingKeyChangesCard } from "./PendingKeyChangesCard.js";
import type { IOuroAccount, IStoaChainSeed } from "../../types/entities.js";

import {
  bareKeyOf,
  hasMigrationPending,
  type MigrationChainIntent,
  type MigrationExecutionStep,
  type MigrationProgress,
} from "@ancientpantheon/codex-core";
import { analyzeGuard, buildCodexPubSet, selectCapsSigningKey } from "@stoachain/stoa-core/guard";
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
  type UrStoaVaultStepRequest,
} from "../../zbom/execute/engine.js";
import { awaitTxVerdict, awaitTxVerdictLiveDeps } from "../../zbom/execute/awaitConfirmation.js";
import { readChainState } from "../../zbom/execute/chainState.js";
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
    submitRotateGuard: async (req) => {
      const guards = await resolveGuards();
      return executeRotateGuard(
        {
          patronAddress: input.patronAddress,
          accountAddress: req.accountAddress,
          gasStationKey: await gasStationKey(),
          patronAnalysis: guards.patronAnalysis,
          accountAnalysis: guards.accountAnalysis,
          target: { mode: "define", newKeys: [...req.guard.keys], newPred: req.guard.pred },
        },
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

const executorBoxStyle: React.CSSProperties = {
  padding: 12,
  borderRadius: 8,
  backgroundColor: "#18181B",
  border: "1px solid #262626",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

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
}

interface ExecutorProps extends PendingKeyChangesSectionProps {
  readonly recordedRun: MigrationProgress;
  readonly masterAccount: IOuroAccount;
  readonly seeds: readonly IStoaChainSeed[];
  readonly recordStep: (step: MigrationExecutionStep) => void | Promise<void>;
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
  createDeps = createMigrationChainDeps,
  runChain = runMigrationChain,
  readAccountGuard = getStoaChainAccountGuard,
}: ExecutorProps): React.ReactElement {
  const ensureCodexUnlocked = useEnsureCodexUnlocked();
  const getKeypair = useGetKeypair();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<OutcomeView | null>(null);
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

  const onPress = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setOutcome(null);
    try {
      const pending = recordedRun.pending;
      const committed = recordedRun.committed;
      const guardKeys = pending?.guardPublicKeys ?? [];
      const intent: MigrationChainIntent = {
        newPaymentPublicKey: pending?.paymentPublicKey ?? committed?.paymentPublicKey ?? null,
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
      // The seed the plan was derived from decides `k:<pub>` vs bare `<pub>`
      // for the new payment key's address (design §5). The engine performs
      // that conversion; this only has to pair the plan with its seed.
      const seedId = pending?.seedId ?? committed?.seedId;
      const seedType = seeds.find((s) => s.id === seedId)?.seedType ?? null;

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

      const result = await runChain(
        {
          intent,
          oldPaymentAddress: masterAccount.stoaChainLedger ?? "",
          accountAddress: masterAccount.address,
          seedType,
        },
        deps,
      );
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
    recordedRun, masterAccount, seeds, recordStep, createDeps, runChain,
    ensureCodexUnlocked, getKeypair, guardSelectionKind, codexPubs, keysetUpdate,
  ]);

  return (
    <div data-testid="pending-key-changes-executor" style={executorBoxStyle}>
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

  // The master account is resolved POSITIONALLY, the same rule the accounts
  // tab and the wizard use — a stray `isPrime` stamp can sit on a non-first
  // account, and this must agree with what the rest of the UI calls master.
  const masterAccount = accounts[0] ?? null;
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
          recordStep={(step) => codexStore.getState().actions.recordMigrationExecutionStep(step)}
        />
      ) : null}
    </div>
  );
}

export default PendingKeyChangesSection;
