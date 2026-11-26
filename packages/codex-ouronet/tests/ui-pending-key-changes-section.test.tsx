/**
 * `PendingKeyChangesSection` — THE ONE PRESS
 * (docs/work/migration-execute/design.md §3, acceptance criteria 2, 7, 8, 9).
 *
 * This component had no spec at all before `migration-execute` T11: it was a
 * container that mounted two rotate modals. It is now the EXECUTOR surface —
 * the single place in the tree where the real chain functions are named — so
 * this file exists.
 *
 * ## MAINNET HAZARD — the last and the most literal in this topic
 *
 * The production `createMigrationChainDeps` names
 * `getFailoverClient`-backed submitters, `pactRead`-backed reads and the two
 * rotations that change who controls the account. A test that rendered this
 * component and clicked its button against the REAL factory would perform the
 * whole migration chain against StoaChain mainnet, with real money.
 *
 * So the rules this file holds itself to:
 *
 *   1. **No test here ever calls the production factory with real modules.**
 *      Every render injects `createDeps`, and the injected factory returns a
 *      fully synthetic `MigrationChainDeps` built from `vi.fn()`s. The
 *      factory's own specs at the bottom inspect its RESULT's shape and its
 *      pass-throughs — they never invoke a submitter, a read or a confirm.
 *   2. **There is deliberately ZERO `vi.mock` in this file**, and a self-check
 *      below keeps it that way. Delete every mock in this suite — there are
 *      none — and it still cannot reach a node, because the seams are
 *      injected and have no live default to fall back on. A dropped `vi.mock`
 *      fails OPEN onto mainnet; a required injected seam cannot.
 *   3. `pactRead` defaults to `rawCalibratedDirtyRead` (a REAL read), so every
 *      test starts with a THROWING reader registered through `setPactReader`
 *      — the same belt `tests/execute-confirmation-and-reads.test.ts:40-47`
 *      wears. Anything that slips past the injection fails loudly instead of
 *      quietly reading mainnet.
 *   4. **`readAccountGuard` is injected on every mount.** Round 2 mounts
 *      `KeysetUpdateGate` inside the executor, and the gate's effect fires on
 *      RENDER rather than on the press — so the production default
 *      (`getStoaChainAccountGuard`, a live `DALOS.UR_AccountGuard` read)
 *      would be reached by merely rendering a codex that recorded a keyset
 *      update. {@link mount} always passes a synthetic one.
 *
 * Round 2 also adds three exported DECISIONS —
 * `resolveCollectRewards`, `buildDefineKeysetRequest` and
 * `keysetUpdatePreconditionFacts`. They exist as values, each taking its one
 * seam as a required argument, exactly so that the judgements that move money
 * and rewrite keyset control are assertable under rule 1: the factory's own
 * closures name `collectAndUnstakeUrStoa`, `submitDefineKeyset` and the live
 * `checkCoinAccountExists`, so no test here may ever invoke one.
 *
 * Several specs below run the REAL `runMigrationChain` over synthetic deps
 * (exactly as `tests/execute-engine.test.ts` does) rather than a stubbed
 * engine: the refusal, the `define-keyset` report and the single unlock are
 * properties of the component's WIRING to the engine, and stubbing the engine
 * would assert them against a fiction.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { act, render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { setPactReader, getPactReader } from "@stoachain/stoa-core/reads";
import { analyzeGuard } from "@stoachain/stoa-core/guard";
import { ed25519 } from "@noble/curves/ed25519";

import { CodexProvider, useCodexStore } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter, emptySnapshot } from "@ancientpantheon/codex-ouronet/adapters";
import type {
  ChainStateSnapshot,
  MigrationChainPlan,
  MigrationProgress,
} from "@ancientpantheon/codex-core";
import {
  PendingKeyChangesSection,
  createMigrationChainDeps,
  buildDefineKeysetRequest,
  keysetUpdatePreconditionFacts,
  resolveCollectRewards,
  type MigrationChainDepsInput,
} from "../src/ui/settings/PendingKeyChangesSection.js";
import type { KeysetUpdateSelection } from "../src/ui/settings/KeysetUpdateGate.js";
import {
  runMigrationChain,
  type DefineKeysetStepRequest,
  type MigrationChainDeps,
  type MigrationChainOutcome,
  type MigrationChainRequest,
  type MigrationPreconditionFacts,
} from "../src/zbom/execute/engine.js";
import type { IOuroAccount, IStoaChainSeed } from "../src/types/entities.js";
import type { ToastController } from "../src/zbom/toast/toastManager.js";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const OLD_PUB = "a".repeat(64);
/** The account's live payment key, as `stoaChainLedger` carries it. */
const OLD_LEDGER = `k:${OLD_PUB}`;
const NEW_PUB = "b".repeat(64);
const GUARD_PUB = "c".repeat(64);
const OLD_GUARD_PUB = "9".repeat(64);
const ACCOUNT = "Ѻ.AncientHodler";

const account = (over: Partial<IOuroAccount> = {}): IOuroAccount => ({
  version: "1.0", isSmart: false, address: ACCOUNT, name: "AncientHodler",
  id: "a1", guard: null, stoaChainLedger: OLD_LEDGER, publicKey: "pub",
  secret: "ct", backup: "ct", originSeedTab: "write-seed", ...over,
});

const seeds: IStoaChainSeed[] = [{
  id: "seed-1", name: "Initial Seed", seedType: "koala", version: "1.0.0", index: 0,
  secret: "ct", main: "", createdAt: "2026-11-01T09:00:00.000Z", isPrime: true,
  accounts: [{ index: 0, publicKey: OLD_PUB, derivationPath: "m/0" }],
}];

/**
 * A recorded run with a FINALIZED plan — `hasMigrationPending` is true — whose
 * selection is `keep`/`keep`, so `computeOutstandingKeyChanges` reports
 * `none: true`.
 *
 * That combination is the whole point of T11(a): it is exactly the owner who
 * already rotated by hand while funds still sit on the old key, and the old
 * `outstanding.none` gate rendered NOTHING for them.
 */
const recorded = (over: Partial<MigrationProgress> = {}): MigrationProgress => ({
  stage: "executing",
  startedAt: "2026-11-01T09:00:00.000Z",
  updatedAt: "2026-11-01T09:05:00.000Z",
  selection: {
    account: { kind: "keep-current" },
    payment: { kind: "keep" },
    guard: { kind: "keep" },
  },
  pending: {
    finalizedAt: "2026-11-01T09:05:00.000Z",
    accountId: "a1",
    seedId: "seed-1",
    paymentPublicKey: NEW_PUB,
    guardPublicKeys: [GUARD_PUB],
    guardPred: "keys-all",
  },
  ...over,
});

/** A recorded run with NO finalized plan, but an outstanding payment change —
 *  so the CARD renders and only the executor's gate is under test. */
const notFinalized = (): MigrationProgress => ({
  stage: "selection",
  startedAt: "2026-11-01T09:00:00.000Z",
  updatedAt: "2026-11-01T09:01:00.000Z",
  selection: {
    account: { kind: "keep-current" },
    payment: { kind: "stoic-dalos-position-0" },
    guard: { kind: "keep" },
  },
  committed: { paymentPublicKey: NEW_PUB },
});

const SETTLED: ChainStateSnapshot = {
  oldKeyStoaPerChain: {},
  oldKeyUrStoaLiquid: 0,
  oldKeyUrStoaStaked: 0,
  newKeyUrStoaLiquid: 0,
  // Both REQUIRED as of `migration-execute-keyset` T3, and required ON PURPOSE:
  // an absent earnings figure reads as "nothing to collect" and would
  // reintroduce the uncollected reward dust round 2 exists to close, and an
  // absent reference reads as "not a keyset-ref" and would silently suppress
  // the step the owner asked for. `tsc` refusing an omission is the whole
  // point, so this fixture names both rather than spreading a partial.
  oldKeyUrStoaEarnings: 0,
  registeredKeysetRef: null,
  registeredPaymentKey: `k:${NEW_PUB}`,
  registeredGuard: { keys: [GUARD_PUB], pred: "keys-all" },
};

/** {@link SETTLED} for an account whose guard IS a keyset-ref — the only
 *  snapshot shape that plans an EXECUTABLE `define-keyset` step. */
const KEYSET_REF = "free.ancient-keyset";
const withKeysetRef = (over: Partial<ChainStateSnapshot> = {}): ChainStateSnapshot => ({
  ...SETTLED,
  registeredKeysetRef: KEYSET_REF,
  ...over,
});

const HAPPY_FACTS: MigrationPreconditionFacts = {
  oldPaymentKeypairPresent: true,
  chosenGuardKeysResolved: true,
  currentGuardSatisfiable: true,
  // REQUIRED as of T3: the safe direction for a missing satisfiability signal
  // is REFUSE, so the field carries no default and `undefined` is not a
  // spelling of "fine". A fixture that wants the chain to run says so here.
  keysetUpdateSatisfiable: true,
  patronIgnisBalance: 1000,
  ignisCosts: { rotatePaymentKey: 1, rotateGuard: 1 },
};

/** A toast controller that records nothing and touches no DOM. */
function stubToast(): ToastController {
  return {
    updateStep: vi.fn(),
    done: vi.fn(),
    fail: vi.fn(),
  } as unknown as ToastController;
}

/**
 * A fully synthetic {@link MigrationChainDeps} — every member a `vi.fn()`,
 * nothing reaching a module. This is what the injected factory returns, and it
 * is why the REAL engine can be run by the specs below.
 *
 * `ensureCodexUnlocked` is the SYNTHETIC gate, never the one the real
 * `useEnsureCodexUnlocked` hook returns: that one prompts for a password.
 */
function syntheticDeps(over: Partial<MigrationChainDeps> = {}): MigrationChainDeps {
  return {
    ensureCodexUnlocked: vi.fn(async () => true),
    readChainState: vi.fn(async () => SETTLED),
    readPreconditionFacts: vi.fn(async () => HAPPY_FACTS),
    confirm: vi.fn(async () => ({ verdict: "success" as const })),
    submitConsolidateStoa: vi.fn(async () => ({ ok: true as const, requestKey: "rk", continuationRequestKey: "ck" })),
    submitDrainStoa: vi.fn(async () => ({ requestKey: "rk" })),
    submitUnstakeUrStoa: vi.fn(async () => ({ requestKey: "rk" })),
    submitTransferUrStoa: vi.fn(async () => ({ requestKey: "rk" })),
    submitStakeUrStoa: vi.fn(async () => ({ requestKey: "rk" })),
    submitRotatePaymentKey: vi.fn(async () => ({ requestKey: "rk" })),
    submitRotateGuard: vi.fn(async () => ({ requestKey: "rk" })),
    recordStep: vi.fn(),
    createToast: vi.fn(() => stubToast()),
    ...over,
  };
}

/** Every injected submitter, for "nothing was submitted" assertions. */
function submitters(deps: MigrationChainDeps): Array<ReturnType<typeof vi.fn>> {
  return [
    deps.submitConsolidateStoa, deps.submitDrainStoa, deps.submitUnstakeUrStoa,
    deps.submitTransferUrStoa, deps.submitStakeUrStoa, deps.submitRotatePaymentKey,
    deps.submitRotateGuard,
  ] as unknown as Array<ReturnType<typeof vi.fn>>;
}

// ─── Mount ──────────────────────────────────────────────────────────────────

let store: ReturnType<typeof useCodexStore> | null = null;
function Grab(): null { store = useCodexStore(); return null; }

interface MountOptions {
  readonly progress?: MigrationProgress | undefined;
  readonly accounts?: readonly IOuroAccount[];
  readonly deps?: MigrationChainDeps;
  readonly runChain?: typeof runMigrationChain;
  /** The keyset gate's chain read. MUST be injected by any test that drives
   *  the gate: the production default is the REAL `getStoaChainAccountGuard`,
   *  and the gate's own effect fires the moment a keyset selection is
   *  recorded. The default here resolves to `null`, which the gate reads as
   *  "not a keyset reference" and renders without asking anything further. */
  readonly readAccountGuard?: (address: string) => Promise<unknown>;
}

async function mount(opts: MountOptions = {}) {
  const deps = opts.deps ?? syntheticDeps();
  const createDeps = vi.fn((_input: MigrationChainDepsInput) => deps);
  const runChain = opts.runChain;
  const readAccountGuard = vi.fn(opts.readAccountGuard ?? (async () => null));
  const adapter = new MemoryCodexAdapter("dev");
  await adapter.saveAll({
    ...emptySnapshot("dev"), schemaVersion: 1,
    ouroAccounts: [...(opts.accounts ?? [account()])],
    kadenaSeeds: seeds,
    migrationProgress: opts.progress,
  });
  store = null;
  render(
    <CodexProvider adapter={adapter}>
      <Grab />
      <PendingKeyChangesSection
        createDeps={createDeps}
        readAccountGuard={readAccountGuard}
        {...(runChain !== undefined ? { runChain } : {})}
      />
    </CodexProvider>,
  );
  await waitFor(() => expect(store!.getState().ready).toBe(true));
  return { deps, createDeps, adapter, readAccountGuard };
}

/** A recorded run whose guard choice is one of the two kinds that plan a
 *  `define-keyset` step. `update-keyset-custom` carries the NEW keys, which is
 *  what the transaction posts as the keyset's new definition. */
const keysetRecorded = (): MigrationProgress =>
  recorded({
    selection: {
      account: { kind: "keep-current" },
      payment: { kind: "keep" },
      guard: { kind: "update-keyset-custom", keys: [GUARD_PUB], pred: "keys-all" },
    },
  });

const executeButton = (): HTMLButtonElement =>
  screen.getByTestId("pending-key-changes-execute-all") as HTMLButtonElement;

const pressExecute = (): void => { fireEvent.click(executeButton()); };

const resultText = async (): Promise<string> => {
  const el = await screen.findByTestId("pending-key-changes-execute-result");
  return el.textContent ?? "";
};

/** The reader stoa-core booted with — restored so this file leaves no global
 *  reader behind for whatever runs next. */
const ORIGINAL_READER = getPactReader();

beforeEach(() => {
  // See this file's header, rule 3.
  setPactReader(() => { throw new Error("no reader registered by this test"); });
});

afterEach(() => {
  cleanup();
  setPactReader(ORIGINAL_READER);
});

// ─── (a) the gate — T11(a), the gap this task closes ────────────────────────

describe("when the executor is offered", () => {
  it("renders the single control for a pending plan EVEN THOUGH outstanding.none is true", async () => {
    // The regression this catches is the one the task exists for: a user who
    // rotated their payment key by hand has `outstanding.none === true` while
    // STOA still sits on the old key, and the old `outstanding.none` gate
    // showed them nothing at all. `computeOutstandingKeyChanges` models key
    // rotations and knows nothing about funds; the engine's own pre-flight is
    // what decides there is nothing left to do.
    await mount({ progress: recorded() });

    const button = screen.getByTestId("pending-key-changes-execute-all");
    // The LABEL is a cross-package contract: `codex-arweave`'s Apply popup
    // (`CodexIdPage.tsx`, T10) tells the user to press this exact phrase, and
    // nothing in-tree can enforce it across the package boundary. Asserted on
    // `textContent` rather than through `toHaveTextContent`: this package's
    // `tests/setup.ts` deliberately installs no jest-dom matchers.
    expect(button.textContent).toBe("Execute all remaining transactions");
    // The card itself is absent — nothing is outstanding in key terms.
    expect(screen.queryByTestId("pending-key-changes-card")).toBeNull();
  });

  it("does NOT render the executor when no plan was ever finalized", async () => {
    await mount({ progress: notFinalized() });
    expect(screen.getByTestId("pending-key-changes-card")).toBeTruthy();
    expect(screen.queryByTestId("pending-key-changes-execute-all")).toBeNull();
  });

  it("does NOT render the executor once the migration is SEALED", async () => {
    // A sealed row KEEPS its plan as the record of what was applied, so "has
    // a plan" alone would offer the chain forever.
    await mount({
      progress: {
        ...notFinalized(),
        pending: recorded().pending,
        appliedAt: "2026-11-02T10:00:00.000Z",
      },
    });
    expect(screen.getByTestId("pending-key-changes-card")).toBeTruthy();
    expect(screen.queryByTestId("pending-key-changes-execute-all")).toBeNull();
  });

  it("mounts NEITHER rotate modal any more — the engine performs both", async () => {
    // design §3 replaced "send them one at a time" with one uninterrupted
    // chain. The per-change launchers are gone from THIS surface; the modals
    // themselves are untouched and still reachable from the accounts tab.
    await mount({ progress: notFinalized() });
    expect(screen.queryByTestId("pending-key-change-apply-payment")).toBeNull();
    expect(screen.queryByTestId("pending-key-change-apply-guard")).toBeNull();
    expect(screen.queryByText("Rotate Payment Key")).toBeNull();
    expect(screen.queryByText("Rotate Guard")).toBeNull();
  });

  it("renders without the executor, and does NOT throw, with no <CodexProvider> ancestor", async () => {
    // `CodexIdPage` is deliberately mountable with no provider and its own
    // suite asserts it "degrades honestly (no crash)" — a throwing hook here
    // took the whole page down with it. A button that threw on press would be
    // just as dishonest.
    expect(() => render(<PendingKeyChangesSection />)).not.toThrow();
    expect(screen.queryByTestId("pending-key-changes-execute-all")).toBeNull();
  });
});

// ─── (b) the press — one unlock, one chain, no interaction ──────────────────

describe("the press", () => {
  it("unlocks the codex exactly ONCE and submits nothing when the chain owes nothing", async () => {
    // Run against the REAL engine: "the codex is unlocked once, up front" is
    // a property of the wiring, and a stubbed engine would assert a fiction.
    const { deps } = await mount({ progress: recorded() });
    pressExecute();

    await waitFor(() => expect(deps.readChainState).toHaveBeenCalledTimes(1));
    expect(deps.ensureCodexUnlocked).toHaveBeenCalledTimes(1);
    for (const submit of submitters(deps)) expect(submit).not.toHaveBeenCalled();
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(await resultText()).toMatch(/nothing left to do/i);
  });

  it("hands the engine the RECORDED plan's intent, the LEDGER address and the paired seed's type", async () => {
    // Three defects live in this one assembly. The old payment address is
    // `stoaChainLedger` and NOT `chainPublicKey` (design §7 defect 2 — the
    // account's identity key says nothing about which payment key is in
    // force); the chosen payment key is the recorded plan's; and `seedType`
    // decides `k:<pub>` vs bare `<pub>` for the new address (design §5).
    let seen: MigrationChainRequest | null = null;
    const runChain = vi.fn(async (req: MigrationChainRequest): Promise<MigrationChainOutcome> => {
      seen = req;
      return { status: "nothing-to-do", plan: { steps: [], nothingToDo: true } };
    });
    await mount({ progress: recorded(), runChain });
    pressExecute();

    await waitFor(() => expect(runChain).toHaveBeenCalledTimes(1));
    expect(seen!.oldPaymentAddress).toBe(OLD_LEDGER);
    expect(seen!.accountAddress).toBe(ACCOUNT);
    expect(seen!.seedType).toBe("koala");
    expect(seen!.intent.newPaymentPublicKey).toBe(NEW_PUB);
    expect(seen!.intent.guard).toEqual({ keys: [GUARD_PUB], pred: "keys-all" });
  });

  it("starts NOTHING when the unlock is cancelled", async () => {
    const deps = syntheticDeps({ ensureCodexUnlocked: vi.fn(async () => false) });
    await mount({ progress: recorded(), deps });
    pressExecute();

    expect(await resultText()).toMatch(/nothing was submitted/i);
    expect(deps.readChainState).not.toHaveBeenCalled();
    for (const submit of submitters(deps)) expect(submit).not.toHaveBeenCalled();
  });

  it("goes busy and runs the chain ONCE across two rapid presses", async () => {
    // A double-press is a double-chain: ~27 transactions submitted twice.
    let release: ((outcome: MigrationChainOutcome) => void) | null = null;
    const runChain = vi.fn(
      () => new Promise<MigrationChainOutcome>((resolve) => { release = resolve; }),
    );
    await mount({ progress: recorded(), runChain });

    pressExecute();
    pressExecute();
    expect(runChain).toHaveBeenCalledTimes(1);
    expect(executeButton().disabled).toBe(true);

    release!({ status: "nothing-to-do", plan: { steps: [], nothingToDo: true } });
    await waitFor(() => expect(executeButton().disabled).toBe(false));
  });

  it("runs the chain ONCE even for two presses batched into one render", async () => {
    // `disabled` alone cannot carry this guarantee: it only takes effect once
    // React has re-rendered, and two presses inside a single batch are
    // dispatched before that happens. Without a render-independent re-entry
    // guard this is two chains — every remaining transaction submitted twice.
    const runChain = vi.fn(() => new Promise<MigrationChainOutcome>(() => {}));
    await mount({ progress: recorded(), runChain });

    const button = executeButton();
    await act(async () => { button.click(); button.click(); });

    expect(runChain).toHaveBeenCalledTimes(1);
  });
});

// ─── (c) what the owner sees when it stops ──────────────────────────────────

const DRAIN_PLAN: MigrationChainPlan = {
  steps: [{
    id: "drain-stoa", kind: "drain-stoa", chainId: "0", amount: 5, executable: true,
  }],
  nothingToDo: false,
};

const haltedWith = (
  reason: "pending" | "failure",
  message: string,
): MigrationChainOutcome => ({
  status: "halted",
  plan: DRAIN_PLAN,
  confirmed: [],
  skipped: [],
  reported: [],
  halt: { stepId: "drain-stoa", kind: "drain-stoa", reason, message, requestKey: "rk-77" },
});

describe("a halt", () => {
  it("names the step that stopped it and quotes the chain's own message verbatim", async () => {
    const message = "The chain reported this transaction as failed: insufficient funds.";
    await mount({ progress: recorded(), runChain: vi.fn(async () => haltedWith("failure", message)) });
    pressExecute();

    const text = await resultText();
    // The step's title comes from `describeMigrationChainPlan` — the engine's
    // own vocabulary, so the UI and the toast cannot disagree.
    expect(text).toContain("Move native STOA to the new payment key");
    expect(text).toContain(message);
  });

  it("calls a PENDING halt unknown — never failed — and says a re-press re-reads the chain", async () => {
    // The most dangerous wording in the whole topic: a `pending` verdict means
    // the transaction MAY STILL LAND. Calling it a failure invites a duplicate
    // resubmit of money already in flight.
    const message =
      "Submitted (request key rk-77 on chain 0) but not confirmed within the polling "
      + "budget, so the outcome is UNKNOWN — it may still land.";
    await mount({ progress: recorded(), runChain: vi.fn(async () => haltedWith("pending", message)) });
    pressExecute();

    const text = await resultText();
    expect(screen.getByTestId("pending-key-changes-halt-unknown")).toBeTruthy();
    expect(text).toMatch(/unknown/i);
    expect(text).toMatch(/re-?read/i);
    expect(text).not.toMatch(/fail/i);
  });

  it("does NOT show the re-press guidance for a FAILURE halt", async () => {
    await mount({
      progress: recorded(),
      runChain: vi.fn(async () => haltedWith("failure", "The chain reported this transaction as failed.")),
    });
    pressExecute();

    await resultText();
    expect(screen.queryByTestId("pending-key-changes-halt-unknown")).toBeNull();
  });
});

describe("a precondition refusal", () => {
  it("renders ONE message naming everything missing, and submits nothing", async () => {
    // Criterion 7: "§5's preconditions checked ONCE, one refusal naming
    // everything missing" — a verdict that stopped at the first failure makes
    // the user press, read, fix and press again once per missing thing. Run
    // against the REAL engine so the message is the real verdict's.
    const deps = syntheticDeps({
      readChainState: vi.fn(async () => ({
        ...SETTLED,
        oldKeyStoaPerChain: { "0": 7 },
        registeredPaymentKey: OLD_LEDGER,
      })),
      readPreconditionFacts: vi.fn(async () => ({
        oldPaymentKeypairPresent: false,
        chosenGuardKeysResolved: true,
        currentGuardSatisfiable: false,
        // Satisfiable, so the three failures this test names are the ONLY
        // three in the refusal — the keyset clause has its own test below.
        keysetUpdateSatisfiable: true,
        patronIgnisBalance: 0,
        ignisCosts: { rotatePaymentKey: 3, rotateGuard: 2 },
      })),
    });
    await mount({ progress: recorded(), deps });
    pressExecute();

    const text = await resultText();
    expect(text).toMatch(/old payment key's keypair is not available/i);
    expect(text).toMatch(/current guard cannot be satisfied/i);
    expect(text).toMatch(/IGNIS/);
    for (const submit of submitters(deps)) expect(submit).not.toHaveBeenCalled();
    expect(deps.confirm).not.toHaveBeenCalled();
    // The keyset resolutions are NOT offered for a refusal that has nothing to
    // do with a keyset — pointing at a key list and a Forfeit button that are
    // not on screen would be noise at best and misdirection at worst.
    expect(screen.queryByTestId("pending-key-changes-keyset-refusal")).toBeNull();
  });
});

describe("a step that cannot be executed", () => {
  it("shows `define-keyset` as REPORTED-not-run, never as skipped", async () => {
    // Criterion 4 (round 2), and criterion 9 of round 1.
    //
    // DELIBERATELY REWRITTEN for docs/work/migration-execute-keyset. This test
    // used to assert the reported text matched `/define-keyset/`, which held
    // of round 1's single `DEFINE_KEYSET_NOT_EXECUTABLE_REASON` — a sentence
    // whose premise was "no code in this repo can perform this operation".
    // Round 2 made the step EXECUTABLE and T3 deleted that constant, so the
    // old assertion now pins a string the production path can no longer
    // produce. The BEHAVIOUR under test is unchanged and is still the point: a
    // step the planner will not run is REPORTED, with its own specific reason,
    // and is never folded into the "already in force, so not sent" list.
    //
    // This snapshot's guard is not a keyset-ref (`registeredKeysetRef: null`),
    // which is criterion 4's case exactly — and the one the owner is most
    // likely to hit, because `rotate-guard` is suppressed for these two
    // selection kinds, so a silently dropped step would mean NO key change at
    // all while the UI claimed success.
    const deps = syntheticDeps();
    await mount({
      progress: recorded({
        selection: {
          account: { kind: "keep-current" },
          payment: { kind: "keep" },
          guard: { kind: "update-keyset-custom", keys: [GUARD_PUB], pred: "keys-all" },
        },
      }),
      deps,
    });
    pressExecute();

    const reported = await screen.findByTestId("pending-key-changes-reported");
    const text = reported.textContent ?? "";
    expect(text).toContain("Update the keyset definition");
    // The reason names the FACT (the guard holds its keys directly) and the
    // way out (rotate the guard instead) — T3's `KEYSET_UPDATE_NO_REF_REASON`.
    expect(text).toMatch(/not a keyset-ref/i);
    expect(text).toMatch(/rotate its guard instead/i);
    expect(text).toMatch(/not executable/i);
    // Never SKIPPED: the chain's "already in force, so not sent" list is the
    // one place a step may be silently absent from the work, and criterion 9
    // keeps `define-keyset` out of it. (The reason text itself says the words
    // "rather than skipped", which is why this asserts over the skipped
    // BLOCK rather than over the sentence.)
    expect(screen.queryByTestId("pending-key-changes-skipped")).toBeNull();
    for (const submit of submitters(deps)) expect(submit).not.toHaveBeenCalled();
  });
});

describe("a completed chain", () => {
  it("says so, and still lists what was reported rather than run", async () => {
    await mount({
      progress: recorded(),
      runChain: vi.fn(async () => ({
        status: "completed" as const,
        plan: DRAIN_PLAN,
        confirmed: ["drain-stoa"],
        skipped: [],
        reported: [{
          stepId: "define-keyset",
          kind: "define-keyset" as const,
          message: "This step is not executable.",
        }],
      })),
    });
    pressExecute();

    expect(await resultText()).toMatch(/every remaining transaction|all .*done|completed/i);
    expect((await screen.findByTestId("pending-key-changes-reported")).textContent ?? "")
      .toContain("This step is not executable.");
  });
});

// ─── (c2) the keyset gate — resolved BEFORE the press, never during ─────────

/** The private-key field for one of the current keyset's keys, inside the
 *  gate's own row for it. */
const keysetField = (index: number): HTMLElement =>
  within(screen.getByTestId(`keyset-update-gate-row-${index}`)).getByPlaceholderText(
    /private key/i,
  );

describe("the keyset update gate", () => {
  it("is mounted for BOTH update-keyset-* selections and for NOTHING else", async () => {
    // The gate performs a chain read and asks for private keys. Mounting it
    // for a selection that plans no `define-keyset` step would spend a read
    // and demand the keyset's keys from an owner whose migration does not
    // touch a keyset at all. The two kinds here are exactly the two the
    // planner keys on (`migrationChain.ts:417-419`), and keeping the two
    // lists in step is the regression this catches.
    for (const guard of [
      { kind: "update-keyset-recommended" } as const,
      { kind: "update-keyset-custom", keys: [GUARD_PUB], pred: "keys-all" } as const,
    ]) {
      const { readAccountGuard } = await mount({
        progress: recorded({
          selection: { account: { kind: "keep-current" }, payment: { kind: "keep" }, guard },
        }),
        readAccountGuard: async () => refGuard(),
      });
      expect(await screen.findByTestId("keyset-update-gate")).toBeTruthy();
      await waitFor(() => expect(readAccountGuard).toHaveBeenCalledWith(ACCOUNT));
      cleanup();
    }

    for (const guard of [
      { kind: "keep" } as const,
      { kind: "recommended-single-key" } as const,
      { kind: "custom", keys: [GUARD_PUB], pred: "keys-all" } as const,
      { kind: "use-existing-keyset", ns: "free", ksn: "k", keys: [GUARD_PUB], pred: "keys-all" } as const,
    ]) {
      const { readAccountGuard } = await mount({
        progress: recorded({
          selection: { account: { kind: "keep-current" }, payment: { kind: "keep" }, guard },
        }),
        readAccountGuard: async () => refGuard(),
      });
      expect(screen.queryByTestId("keyset-update-gate")).toBeNull();
      // And the read is never spent: the gate's effect is gated on `active`.
      expect(readAccountGuard).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("hands the press the keys the owner pasted, and reports the keyset as satisfiable", async () => {
    // The whole §3 path end to end: the gate lists every key of the CURRENT
    // keyset, verifies a pasted private key by deriving its public key, and
    // the resolution reaches `createDeps` — where the factory turns it into
    // `submitDefineKeyset`'s signer analysis and into the §5 fact that decides
    // whether the chain may start at all. The press is what reads the state,
    // so a gate whose report never reached the component would refuse a keyset
    // the owner HAD satisfied.
    const { createDeps } = await mount({
      progress: keysetRecorded(),
      readAccountGuard: async () => refGuard(),
    });

    // One of the three is held by this codex (the seed's own account key), so
    // the 2-of-3 predicate is one key short until the owner pastes one.
    const progress = await screen.findByTestId("keyset-update-gate-progress");
    expect(progress.textContent).toContain("1 of 2");

    fireEvent.change(keysetField(CURRENT_KEYSET.keys.indexOf(CUR_A.pub)), {
      target: { value: CUR_A.priv },
    });
    await waitFor(() => expect(progress.textContent).toContain("2 of 2"));

    pressExecute();
    await waitFor(() => expect(createDeps).toHaveBeenCalledTimes(1));
    const passed = createDeps.mock.calls[0]![0].keysetUpdate;
    expect(passed?.ref).toBe(KEYSET_REF);
    expect(passed?.satisfied).toBe(true);
    expect(passed?.forfeited).toBe(false);
    expect(passed?.manualKeys).toEqual({ [CUR_A.pub]: CUR_A.priv });
    // The analysis counts the pasted key, which is what carries the threshold
    // walk to two signers instead of one.
    expect(passed?.analysis?.resolvedForeignKeys).toContain(CUR_A.pub);
  });

  it("puts a FORFEIT on the intent, and keeps `chosenGuardKeysResolved` out of it", async () => {
    // Criterion 8. A forfeit is carried on the INTENT for one press and never
    // persisted — a forfeit written to `MigrationProgress` is a decision that
    // silently outlives the session that made it. `chosenGuardKeysResolved`
    // keeps its own meaning (the NEW keys resolved) and must not be overloaded
    // with this one: they answer different questions and a press can need
    // opposite answers to them.
    let seen: MigrationChainRequest | null = null;
    const runChain = vi.fn(async (req: MigrationChainRequest): Promise<MigrationChainOutcome> => {
      seen = req;
      return { status: "nothing-to-do", plan: { steps: [], nothingToDo: true } };
    });
    const { createDeps } = await mount({
      progress: keysetRecorded(),
      runChain,
      readAccountGuard: async () => refGuard(),
    });

    fireEvent.click(await screen.findByTestId("keyset-update-gate-forfeit"));
    await screen.findByTestId("keyset-update-gate-forfeited");

    pressExecute();
    await waitFor(() => expect(runChain).toHaveBeenCalledTimes(1));
    expect(seen!.intent.keysetUpdateForfeited).toBe(true);
    expect(createDeps.mock.calls[0]![0].chosenGuardKeysResolved).toBe(true);
    // Forfeit discards the private keys it collected, and says so upward.
    expect(createDeps.mock.calls[0]![0].keysetUpdate?.manualKeys).toEqual({});
  });

  it("leaves `keysetUpdateForfeited` OFF the intent when nothing was forfeited", async () => {
    // The negative half of the same wiring: an always-true flag would forfeit
    // every keyset update the owner never declined.
    let seen: MigrationChainRequest | null = null;
    const runChain = vi.fn(async (req: MigrationChainRequest): Promise<MigrationChainOutcome> => {
      seen = req;
      return { status: "nothing-to-do", plan: { steps: [], nothingToDo: true } };
    });
    await mount({
      progress: keysetRecorded(),
      runChain,
      readAccountGuard: async () => refGuard(),
    });
    await screen.findByTestId("keyset-update-gate-progress");

    pressExecute();
    await waitFor(() => expect(runChain).toHaveBeenCalledTimes(1));
    expect(seen!.intent.keysetUpdateForfeited).toBeUndefined();
  });
});

// ─── (c3) the keyset outcomes the owner reads ───────────────────────────────

describe("an unsatisfiable keyset update", () => {
  it("REFUSES the whole chain, names the shortfall, offers both ways out, and submits NOTHING", async () => {
    // Criterion 5, and the money assertion of this topic. The account here has
    // 7 STOA on chain 0 and an old payment key still on record, so the plan
    // carries a real drain and a real rotation — and the refusal must still
    // start NOTHING. A chain that drained first and only then discovered it
    // could not sign the keyset would leave the owner mid-migration with the
    // one step they chose impossible, which is exactly what §3 moved to a
    // precondition to prevent. Run against the REAL engine, so the refusal is
    // the real verdict's and the message is `checkMigrationPreconditions`'.
    const deps = syntheticDeps({
      readChainState: vi.fn(async () =>
        withKeysetRef({ oldKeyStoaPerChain: { "0": 7 }, registeredPaymentKey: OLD_LEDGER }),
      ),
      readPreconditionFacts: vi.fn(async () => ({
        ...HAPPY_FACTS,
        keysetUpdateSatisfiable: false,
        keysetUpdateKeyCounts: { resolved: 1, total: 3, threshold: 2 },
      })),
    });
    await mount({
      progress: keysetRecorded(),
      deps,
      readAccountGuard: async () => refGuard(),
    });
    pressExecute();

    const text = await resultText();
    // The number, not just the fact — "supply the missing keys" is unactionable
    // if the owner cannot see how many are missing.
    expect(text).toMatch(/only 1 of the referenced keyset's 3 current keys/i);
    expect(text).toMatch(/predicate needs 2/i);
    // Both resolutions, as their own surface: the key list and the Forfeit
    // button are already on screen above this report, so the refusal's job is
    // to point at them.
    const refusal = screen.getByTestId("pending-key-changes-keyset-refusal");
    expect(refusal.textContent ?? "").toMatch(/private key/i);
    expect(refusal.textContent ?? "").toMatch(/forfeit/i);

    for (const submit of submitters(deps)) expect(submit).not.toHaveBeenCalled();
    expect(deps.submitDefineKeyset).toBeUndefined();
    expect(deps.confirm).not.toHaveBeenCalled();
  });
});

describe("a FORFEITED keyset update", () => {
  it("runs every other step and REPORTS the keyset, as a decision rather than an error", async () => {
    // Criterion 8, end to end: forfeit is a legitimate outcome, so the chain
    // proceeds. The two failure modes this catches are opposite and both bad —
    // a forfeit that blocks the migration (the owner can then never finish
    // it), and a forfeit folded into the "already in force, so not sent" list
    // (the owner is told nothing was pending when a choice they recorded was
    // silently dropped).
    const deps = syntheticDeps({
      readChainState: vi.fn(async () => withKeysetRef({ oldKeyStoaPerChain: { "0": 7 } })),
    });
    await mount({
      progress: keysetRecorded(),
      deps,
      readAccountGuard: async () => refGuard(),
    });

    fireEvent.click(await screen.findByTestId("keyset-update-gate-forfeit"));
    await screen.findByTestId("keyset-update-gate-forfeited");
    pressExecute();

    const reported = await screen.findByTestId("pending-key-changes-reported");
    const text = reported.textContent ?? "";
    expect(text).toContain("Update the keyset definition");
    expect(text).toMatch(/you chose to forfeit/i);
    expect(text).toMatch(/not a failure/i);
    // Reported-not-run stays its own surface and is never folded into skipped.
    expect(screen.queryByTestId("pending-key-changes-skipped")).toBeNull();
    // And the rest of the migration actually ran: the drain was submitted and
    // the chain reports as complete rather than as stopped.
    expect(deps.submitDrainStoa).toHaveBeenCalledTimes(1);
    expect(await resultText()).toMatch(/every remaining transaction is done/i);
    expect(screen.queryByTestId("pending-key-changes-halt-unknown")).toBeNull();
  });
});

describe("a chain that stops before the keyset step", () => {
  it("leaves the keyset step OUTSTANDING — neither confirmed, nor skipped, nor reported", async () => {
    // The step is last but one, so any earlier halt leaves it un-attempted.
    // Listing it anywhere would tell the owner it was dealt with: under
    // "confirmed" it reads as applied, and under "already in force, so not
    // sent" or "reported, not run" it reads as settled. It is none of those —
    // it is still owed, and the next press is what performs it.
    const deps = syntheticDeps({
      readChainState: vi.fn(async () => withKeysetRef({ oldKeyStoaPerChain: { "0": 7 } })),
      confirm: vi.fn(async () => ({
        verdict: "failure" as const,
        message: "The chain reported this transaction as failed: insufficient funds.",
      })),
    });
    await mount({
      progress: keysetRecorded(),
      deps,
      readAccountGuard: async () => refGuard(),
    });
    await screen.findByTestId("keyset-update-gate-progress");
    pressExecute();

    const text = await resultText();
    expect(text).toMatch(/stopped at: move native stoa/i);
    expect(text).not.toContain("Update the keyset definition");
    expect(screen.queryByTestId("pending-key-changes-reported")).toBeNull();
    expect(screen.queryByTestId("pending-key-changes-skipped")).toBeNull();
    expect(deps.submitDefineKeyset).toBeUndefined();
  });
});

// ─── (d0) the three decisions round 2 adds, as values ───────────────────────
//
// Each of these is a PURE function taking its one seam as a required argument
// with no default, exported for exactly that reason: the decisions they carry
// are the ones that move money and rewrite keyset control, and they must be
// assertable without `createMigrationChainDeps` — whose closures name the real
// `collectAndUnstakeUrStoa`, the real `submitDefineKeyset` and the real
// `checkCoinAccountExists`, and so can never be INVOKED by a test in this
// file (header rule 1).

describe("resolveCollectRewards — step C's Collect row, gated on BOTH facts", () => {
  const step = (over: Partial<{ collectRewards: boolean }> = {}) => ({
    address: OLD_LEDGER, amount: "5.0", chainId: "0", ...over,
  });

  it("collects when the plan's earnings flag AND the coin-account probe both say so", async () => {
    const probe = vi.fn(async () => true);

    expect(await resolveCollectRewards(step({ collectRewards: true }), probe)).toBe(true);
    // The probe must be asked about the OLD payment address — the account the
    // Collect row credits — and not, say, the receiver.
    expect(probe).toHaveBeenCalledWith(OLD_LEDGER);
  });

  it("does NOT collect when the earnings flag is set but the address has no coin row", async () => {
    // The regression this catches is a future reader dropping one half as
    // redundant. They guard DIFFERENT chain-side failures and both are
    // required: zero claimable rewards make `coin.C_URV|Collect` fail on
    // `UEV_Amount`, while a missing coin row makes it fail on `UR_Guard` —
    // and the `coin.C_CreateAccount` repair is unavailable, because three
    // `(coin.C_` forms match no `DALOS.GAS_PAYER` case at all. Either failure
    // takes the UNSTAKE down with it, since they share one transaction.
    //
    // `null` is the probe's "absent OR RPC error" answer, and it must collapse
    // to does-not-exist: guessing "exists" on uncertainty is what sends the
    // three-form transaction nothing can sponsor.
    const probe = vi.fn(async () => null);

    expect(await resolveCollectRewards(step({ collectRewards: true }), probe)).toBe(false);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("does NOT collect, and spends no read, when the plan reported no earnings", async () => {
    // The engine SPREADS `collectRewards` only when the fresh snapshot's
    // earnings are positive, so absent is the real shape of "nothing to
    // collect" — and there is then nothing for the probe to decide.
    const probe = vi.fn(async () => true);

    expect(await resolveCollectRewards(step(), probe)).toBe(false);
    expect(probe).not.toHaveBeenCalled();
  });
});

/** A real ed25519 pair, so the gate's `tryDerivePublicKey(priv) === pub`
 *  verification is exercised rather than faked. Same construction (and the
 *  same reason) as `tests/ui-keyset-update-gate.test.tsx:65-69`. */
const pairFor = (byte: string): { priv: string; pub: string } => {
  const priv = byte.repeat(32);
  const bytes = Uint8Array.from(priv.match(/../g)!.map((b) => parseInt(b, 16)));
  return {
    priv,
    pub: Array.from(ed25519.getPublicKey(bytes), (b) => b.toString(16).padStart(2, "0")).join(""),
  };
};

/** The CURRENT keyset the account's guard refers to: 2-of-3, of which this
 *  codex holds exactly ONE (the seed's own account key). So the predicate is
 *  UNMET until the owner pastes one private key — the owner's 5-of-9 worked
 *  example in miniature. */
const CUR_A = pairFor("11");
const CUR_B = pairFor("12");
const CURRENT_KEYSET = { keys: [OLD_PUB, CUR_A.pub, CUR_B.pub], pred: "keys-2" };
/** What `getKadenaAccountGuard` hands back for a keyset-REF guard: the
 *  EXPANDED keyset annotated with the qualified reference name
 *  (`ouroAccountFunctions.js:164-168`). */
const refGuard = (ref: string = KEYSET_REF) => ({ ...CURRENT_KEYSET, keysetRef: ref });

const CODEX_PUBS = new Set([OLD_PUB]);
/** The gate's own report shape, for the unit tests below. The analysis is the
 *  REAL `analyzeGuard` over the real keyset: a hand-built one could claim a
 *  threshold the predicate does not have. */
const gateReport = (manualKeys: Record<string, string> = {}): KeysetUpdateSelection => {
  const analysis = analyzeGuard(CURRENT_KEYSET, CODEX_PUBS, manualKeys);
  return {
    ref: KEYSET_REF,
    analysis,
    manualKeys,
    satisfied: analysis.satisfied,
    forfeited: false,
  };
};

describe("buildDefineKeysetRequest — the NEW definition, authorized by the CURRENT keyset", () => {
  const PAYER_KEY = { publicKey: NEW_PUB, privateKey: "priv-new" };
  const stepReq: DefineKeysetStepRequest = {
    keysetRef: KEYSET_REF,
    keys: [GUARD_PUB],
    pred: "keys-all",
    payerAddress: `k:${NEW_PUB}`,
    chainId: "0",
  };

  it("posts the CHOSEN keys and pred as the new definition, never the current keyset's", async () => {
    // The whole transaction REPLACES the keyset. Posting the current
    // definition back would simulate clean, submit, cost gas and achieve
    // nothing — while silently discarding the guard choice the owner recorded,
    // which is the one failure mode here that looks like success.
    const req = buildDefineKeysetRequest(stepReq, gateReport(), PAYER_KEY);

    expect(req.newKeyset).toEqual({ keys: [GUARD_PUB], pred: "keys-all" });
    for (const current of CURRENT_KEYSET.keys) {
      expect(req.newKeyset.keys).not.toContain(current);
    }
  });

  it("hands the gate's analysis AND its manual keys to the signer walk", async () => {
    // `collectGuardSigners` prefers `manualKeys[pub]` over `getKeypair` and
    // stops at `analysis.threshold`. Dropping either here is what turns a
    // keyset the owner HAS satisfied by hand into a `Keyset failure` on chain
    // — after the gate told them they were ready to press.
    const report = gateReport({ [CUR_A.pub]: CUR_A.priv });
    const req = buildDefineKeysetRequest(stepReq, report, PAYER_KEY);

    expect(req.currentKeysetAnalysis).toBe(report.analysis);
    expect(req.manualKeys).toEqual({ [CUR_A.pub]: CUR_A.priv });
    // And the analysis it carries genuinely counts the pasted key, which is
    // what makes the threshold walk reach 2 signers rather than 1.
    expect(req.currentKeysetAnalysis.resolvedForeignKeys).toContain(CUR_A.pub);
  });

  it("takes the reference and the SELF-PAID gas payer from the engine's own request", async () => {
    // Both come from the engine rather than from component state on purpose:
    // the reference is read from the FRESH snapshot's live guard, and the
    // payer is the registered payment key as of the moment the step runs —
    // this is the one transaction in the chain the Ouronet gas station cannot
    // sponsor, so a stale payer is a transaction nobody pays for.
    const req = buildDefineKeysetRequest(stepReq, gateReport(), PAYER_KEY);

    expect(req.keysetRef).toBe(KEYSET_REF);
    expect(req.payerAddress).toBe(`k:${NEW_PUB}`);
    expect(req.payerKey).toBe(PAYER_KEY);
    expect(req.chainId).toBe("0");
  });

  it("REFUSES to build one when the current keyset was never resolved", async () => {
    // With no analysis there is no signer set, so the transaction would go out
    // signed by the gas payer alone — which cannot satisfy the keyset. That is
    // a guaranteed `Keyset failure` and a wasted STOA gas spend. Thrown rather
    // than returned: the engine REPORTS a throw from the keyset step and
    // carries on with the rest of the migration.
    expect(() => buildDefineKeysetRequest(stepReq, null, PAYER_KEY)).toThrow(/never resolved/i);
    expect(() => buildDefineKeysetRequest(stepReq, undefined, PAYER_KEY)).toThrow(/never resolved/i);
    expect(() =>
      buildDefineKeysetRequest(
        stepReq,
        { ref: KEYSET_REF, analysis: null, manualKeys: {}, satisfied: false, forfeited: false },
        PAYER_KEY,
      ),
    ).toThrow(/never resolved/i);
  });
});

describe("keysetUpdatePreconditionFacts — the §5 fact the gate supplies", () => {
  it("reports NOT satisfiable, with no counts, when nothing was resolved", async () => {
    // The safe direction for a missing satisfiability signal is REFUSE. If
    // this returned `true` by default, a press with a keyset this codex cannot
    // sign would start the chain, drain the funds and fail the keyset step on
    // chain — i.e. criterion 5 inverted.
    expect(keysetUpdatePreconditionFacts(null)).toEqual({ keysetUpdateSatisfiable: false });
    expect(keysetUpdatePreconditionFacts(undefined)).toEqual({ keysetUpdateSatisfiable: false });
  });

  it("reports the SHORTFALL counts the refusal names when the predicate is unmet", async () => {
    // Criterion 5's "naming the shortfall": the counts are display detail, so
    // they are optional in core — but a refusal that cannot say "1 of 3, and 2
    // are needed" leaves the owner guessing how many keys to go and find.
    expect(keysetUpdatePreconditionFacts(gateReport())).toEqual({
      keysetUpdateSatisfiable: false,
      keysetUpdateKeyCounts: { resolved: 1, total: 3, threshold: 2 },
    });
  });

  it("reports satisfiable once the pasted key carries the analysis over the threshold", async () => {
    expect(keysetUpdatePreconditionFacts(gateReport({ [CUR_A.pub]: CUR_A.priv }))).toEqual({
      keysetUpdateSatisfiable: true,
      keysetUpdateKeyCounts: { resolved: 2, total: 3, threshold: 2 },
    });
  });

  it("reports NOT satisfiable for a FORFEIT, because forfeit is not satisfaction", async () => {
    // The two are ORTHOGONAL (`KeysetUpdateSelection`'s own doc), and the
    // planner is what makes a forfeit proceed: it emits the step as
    // non-executable, so core never consults this fact. Claiming "satisfiable"
    // for a forfeit would be a lie that only looks harmless while that
    // ordering holds.
    const report = { ...gateReport(), forfeited: true };
    expect(keysetUpdatePreconditionFacts(report).keysetUpdateSatisfiable).toBe(false);
  });
});

// ─── (d) the factory — the WIRING, asserted without invoking anything ───────

describe("createMigrationChainDeps — the one place the real functions are named", () => {
  const input = (over: Partial<MigrationChainDepsInput> = {}): MigrationChainDepsInput => ({
    accountAddress: ACCOUNT,
    patronAddress: ACCOUNT,
    oldPaymentAddress: OLD_LEDGER,
    chosenGuardKeysResolved: true,
    codexPubs: new Set([OLD_PUB, OLD_GUARD_PUB]),
    ensureCodexUnlocked: async () => true,
    getKeypair: async () => null,
    recordStep: () => {},
    ...over,
  });

  /** Every member `runMigrationChain` requires, plus the optional toast. A
   *  member the factory forgets is a member the engine would find `undefined`
   *  and crash on mid-chain — after real transactions have landed.
   *
   *  DELIBERATELY EXTENDED for docs/work/migration-execute-keyset:
   *  `submitDefineKeyset` is new. The engine declares it OPTIONAL only because
   *  its interface shipped one wave ahead of this boundary, and an absent one
   *  means the keyset step is REPORTED with "no submitter is wired" — a
   *  silent, legitimate-looking non-event. The design made the step
   *  executable, so for THIS factory the dep is part of the engine's required
   *  world, not an absent optional, and this list is what says so. */
  const REQUIRED: readonly string[] = [
    "confirm", "createToast", "ensureCodexUnlocked", "readChainState",
    "readPreconditionFacts", "recordStep", "submitConsolidateStoa",
    "submitDefineKeyset", "submitDrainStoa", "submitRotateGuard",
    "submitRotatePaymentKey", "submitStakeUrStoa", "submitTransferUrStoa",
    "submitUnstakeUrStoa",
  ];

  it("supplies EVERY dep the engine requires, each a function", () => {
    const deps = createMigrationChainDeps(input());
    expect(Object.keys(deps).sort()).toEqual([...REQUIRED]);
    for (const key of REQUIRED) {
      expect(typeof (deps as unknown as Record<string, unknown>)[key]).toBe("function");
    }
  });

  it("passes the unlock gate and the progress recorder straight through", () => {
    // These two are the caller's, not the factory's: a factory that wrapped
    // the gate could call it twice, and a wrapped recorder could drop a step.
    const ensureCodexUnlocked = vi.fn(async () => true);
    const recordStep = vi.fn();
    const deps = createMigrationChainDeps(input({ ensureCodexUnlocked, recordStep }));
    expect(deps.ensureCodexUnlocked).toBe(ensureCodexUnlocked);
    expect(deps.recordStep).toBe(recordStep);
  });

  it("performs NO I/O at assembly time — building deps must submit nothing", () => {
    // The factory is called on every press before the engine runs. If merely
    // assembling it read the chain or resolved a keypair, the reader
    // registered in `beforeEach` would throw and this would fail.
    const getKeypair = vi.fn(async () => null);
    const recordStep = vi.fn();
    expect(() => createMigrationChainDeps(input({ getKeypair, recordStep }))).not.toThrow();
    expect(getKeypair).not.toHaveBeenCalled();
    expect(recordStep).not.toHaveBeenCalled();
  });
});

// ─── (e) the test of the test ───────────────────────────────────────────────

describe("this file's own hazard discipline", () => {
  it("contains ZERO vi.mock calls — every seam here is injected", () => {
    // See the header. A mock a refactor silently drops fails OPEN onto
    // mainnet; an injected seam with no live default cannot. This assertion
    // is what keeps rule 2 true for the next editor.
    const self = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "ui-pending-key-changes-section.test.tsx"),
      "utf8",
    );
    const calls = self.match(/vi\s*\.\s*mock\s*\(/g) ?? [];
    expect(calls).toEqual([]);
  });
});
