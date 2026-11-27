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
 *   5. **`readChainState` is injected on every mount, for the same reason.**
 *      The section takes ONE chain observation on MOUNT — the load-time
 *      reconciliation of the owner's stale card (2026-11-27) — and its
 *      production default is the real `readChainState`, three live reads. So
 *      {@link mount} always passes a synthetic one, whose default
 *      ({@link UNOBSERVED}) reconciles nothing; each load-time spec states
 *      its own.
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
  CodexMasterSeed,
  MigrationChainPlan,
  MigrationProgress,
} from "@ancientpantheon/codex-core";
import {
  MIGRATION_EXECUTOR_ANCHOR_ID,
  PendingKeyChangesSection,
  reconcileAccountFromChainState,
  createMigrationChainDeps,
  buildDefineKeysetRequest,
  buildRotateGuardRequest,
  keysetUpdatePreconditionFacts,
  resolveCollectRewards,
  type ChainObservedAccountKeys,
  type MigrationChainDepsInput,
  type RotateGuardContext,
} from "../src/ui/settings/PendingKeyChangesSection.js";
import type { KeysetUpdateSelection } from "../src/ui/settings/KeysetUpdateGate.js";
import type { ChainStateQuery } from "../src/zbom/execute/chainState.js";
import {
  runMigrationChain,
  type DefineKeysetStepRequest,
  type MigrationChainDeps,
  type MigrationChainOutcome,
  type MigrationChainRequest,
  type MigrationPreconditionFacts,
  type RotateGuardStepRequest,
} from "../src/zbom/execute/engine.js";
// The REAL G entry point, run over an INJECTED submitter: the defect of
// 2026-11-26 lived in the hand-off between this file's factory and this
// function, so a test that stubbed either half would have asserted a fiction.
// `liveRotateGuardSubmitter` is never named here.
import {
  executeRotateGuard,
  type RotateGuardSubmitter,
} from "../src/zbom/execute/rotateOps.js";
import type { TxVerdictKind } from "../src/zbom/execute/awaitConfirmation.js";
import { computeOutstandingKeyChanges } from "../src/ui/internal/outstandingKeyChanges.js";
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

/**
 * A read that observes NOTHING about the account's keys — `null` for all
 * three fields, which is what the selector's BAR sentinel, an unactivated
 * account and an unmodelled guard shape all collapse to
 * (`chainState.ts:160-167`).
 *
 * This is {@link mount}'s DEFAULT load-time read, deliberately: the
 * reconciliation now fires on mount for every codex with a plan pending, and
 * a default that reported {@link SETTLED} would silently rewrite the stored
 * account under every spec in this file that is about the PRESS. `null`
 * observes nothing, so nothing is written — the one property
 * `reconcileAccountFromChainState` guarantees for exactly this input — and
 * each spec below that cares about the load states its own read.
 */
const UNOBSERVED: ChainStateSnapshot = {
  ...SETTLED,
  registeredPaymentKey: null,
  registeredGuard: null,
  registeredKeysetRef: null,
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
  /** The codex's StoaChain seeds. Overridden only by the specs that need a
   *  seed of a DIFFERENT `seedType`, which is what decides `k:<pub>` vs bare
   *  `<pub>` for the new payment key's address. */
  readonly seeds?: readonly IStoaChainSeed[];
  /** The codex's settled Codex Master Seed row. Absent on a codex that never
   *  finalized — the positional fallback every other spec here exercises. */
  readonly codexMasterSeed?: CodexMasterSeed;
  /** The keyset gate's chain read. MUST be injected by any test that drives
   *  the gate: the production default is the REAL `getStoaChainAccountGuard`,
   *  and the gate's own effect fires the moment a keyset selection is
   *  recorded. The default here resolves to `null`, which the gate reads as
   *  "not a keyset reference" and renders without asking anything further. */
  readonly readAccountGuard?: (address: string) => Promise<unknown>;
  /**
   * The LOAD-TIME chain read. MUST be injected by every mount for the same
   * reason as `readAccountGuard` (header rule 4): the production default is
   * the real `readChainState`, and the section now takes it on MOUNT rather
   * than on the press, so merely rendering a codex with a plan pending would
   * reach a node. The default here is {@link UNOBSERVED} — a legitimate
   * snapshot that reconciles nothing.
   */
  readonly readChainState?: (query: ChainStateQuery) => Promise<ChainStateSnapshot>;
}

async function mount(opts: MountOptions = {}) {
  const deps = opts.deps ?? syntheticDeps();
  const createDeps = vi.fn((_input: MigrationChainDepsInput) => deps);
  const runChain = opts.runChain;
  const readAccountGuard = vi.fn(opts.readAccountGuard ?? (async () => null));
  const readChainState = vi.fn(opts.readChainState ?? (async () => UNOBSERVED));
  const adapter = new MemoryCodexAdapter("dev");
  await adapter.saveAll({
    ...emptySnapshot("dev"), schemaVersion: 1,
    ouroAccounts: [...(opts.accounts ?? [account()])],
    kadenaSeeds: [...(opts.seeds ?? seeds)],
    migrationProgress: opts.progress,
    ...(opts.codexMasterSeed !== undefined ? { codexMasterSeed: opts.codexMasterSeed } : {}),
  });
  store = null;
  render(
    <CodexProvider adapter={adapter}>
      <Grab />
      <PendingKeyChangesSection
        createDeps={createDeps}
        readAccountGuard={readAccountGuard}
        readChainState={readChainState}
        {...(runChain !== undefined ? { runChain } : {})}
      />
    </CodexProvider>,
  );
  await waitFor(() => expect(store!.getState().ready).toBe(true));
  return { deps, createDeps, adapter, readAccountGuard, readChainState };
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

// ─── (a2) the navigation anchor — the Apply popup's destination ─────────────

/**
 * `codex-arweave`'s Apply popup (`panel/CodexIdPage.tsx`) is the SEAL surface
 * and deliberately carries no execute button. Its one control navigates HERE.
 * That control lives in another package, which cannot import this module (the
 * `./ui` barrel is a negative export lock — `tests/ui-surface-stability.test.ts`
 * — and the consumers' vitest aliases resolve subpaths to `src/<dir>/index.ts`
 * only), so the seam between them is a DOM contract: one documented element
 * `id`, and "focus it to highlight it".
 *
 * Both halves are asserted here, on this side of the boundary, because this
 * is the side that can break them silently: renaming the id or dropping the
 * `tabIndex` turns the popup's control into a no-op that reports success,
 * which is precisely the dead-end this round exists to remove. The same
 * cross-package-contract discipline the execute button's LABEL is already
 * held to above.
 */
describe("the navigation anchor the Apply popup targets", () => {
  it("puts the exported DOM id on the box that holds the execute button, resolvable by getElementById", () => {
    // Pinned literal: the consumer transcribes this string, so a rename must
    // be a loud, deliberate edit on both sides rather than a silent one here.
    expect(MIGRATION_EXECUTOR_ANCHOR_ID).toBe("codex-migration-executor");
  });

  it("resolves that id to the executor box itself — never to some ancestor that merely contains it", async () => {
    await mount({ progress: recorded() });

    const anchored = document.getElementById(MIGRATION_EXECUTOR_ANCHOR_ID);
    expect(anchored).toBe(screen.getByTestId("pending-key-changes-executor"));
    // The destination must be the card that can ACT: a user sent to a box
    // with no button has been sent nowhere.
    expect(anchored!.contains(screen.getByTestId("pending-key-changes-execute-all"))).toBe(true);
  });

  it("makes the anchor programmatically focusable WITHOUT entering the tab order", async () => {
    await mount({ progress: recorded() });
    const anchored = document.getElementById(MIGRATION_EXECUTOR_ANCHOR_ID)!;

    // -1: a caller can `.focus()` it (the jsdom-safe half of "scroll it into
    // view", and what moves a screen reader's cursor), but it must not become
    // a keyboard tab stop on a page nobody asked to navigate differently.
    expect(anchored.tabIndex).toBe(-1);
    anchored.focus();
    expect(document.activeElement).toBe(anchored);
  });

  it("highlights itself while focused and goes back to normal on blur", async () => {
    // The owner's requirement that the executor be FINDABLE, not merely
    // scrolled to. Driven by focus so the indication is owned by this
    // component — the cross-package caller only has to focus the id, and
    // cannot reach into this component's styling to fake it.
    await mount({ progress: recorded() });
    const anchored = document.getElementById(MIGRATION_EXECUTOR_ANCHOR_ID)!;
    const restingBorder = anchored.style.borderColor;

    expect(anchored.style.boxShadow).toBe("");

    act(() => { anchored.focus(); });
    expect(anchored.style.boxShadow).not.toBe("");
    expect(anchored.style.borderColor).not.toBe(restingBorder);

    act(() => { anchored.blur(); });
    expect(anchored.style.boxShadow).toBe("");
    expect(anchored.style.borderColor).toBe(restingBorder);
  });

  it("has NO anchor at all when the executor is not offered", async () => {
    // Requirement 4's trigger. The id marks the EXECUTOR, not the section, so
    // on a codex with no finalized plan the card still renders and the id
    // resolves to nothing — which is what lets the popup's control report
    // honestly instead of scrolling to a card with no button.
    await mount({ progress: notFinalized() });

    expect(screen.getByTestId("pending-key-changes-card")).toBeTruthy();
    expect(document.getElementById(MIGRATION_EXECUTOR_ANCHOR_ID)).toBeNull();
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

  it("hands the engine the RECORDED plan's intent, the LEDGER address and NO seed type", async () => {
    // Two defects live in this one assembly, plus the one that shipped. The
    // old payment address is `stoaChainLedger` and NOT `chainPublicKey`
    // (design §7 defect 2 — the account's identity key says nothing about
    // which payment key is in force), and the chosen payment key is the
    // recorded plan's.
    //
    // The `seedType` member this used to assert is GONE, deliberately: it fed
    // a conversion that returned the key BARE for a stoic seed, rotating the
    // owner's mainnet account to an account nobody holds the keys to. The
    // account string is `k:<bare>` for every seed type, so the request carries
    // no seed type at all — asserted here, because a re-added member would be
    // that defect's route back in.
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
    expect(Object.keys(seen!)).not.toContain("seedType");
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

// ─── (c3) the rotation the chain REPORTS, cached into the codex ─────────────

/**
 * The owner's mainnet run, 2026-11-26. He rotated his payment key; the
 * transaction CONFIRMED on chain (request key `w-sXLOaDhNnhZ…`); nothing wrote
 * it back into the codex. So `computeOutstandingKeyChanges` — which is pure
 * and reads the STORED `account.stoaChainLedger` — kept listing
 * "Payment key FROM e20f26… TO 225eb6d…" as outstanding, while the engine,
 * which decides every step from a LIVE chain read, correctly skipped it. The
 * card and the engine disagreed about what was left, and the card was the one
 * that was wrong.
 *
 * The accounts tab hides this because it hydrates `stoaChainLedger` from a
 * chain read on mount (`OuronetAccountsTab.tsx:115`); this surface does not.
 *
 * Chain state stays the authority — these specs never make the stored value a
 * second source of truth, they assert that a FACT THE CHAIN REPORTED is
 * cached rather than discarded. Which is why the fixture below is a chain
 * rather than a constant: what the codex stores is what a read returned, so a
 * spec that fixed the read's answer for all time could not tell a cache from
 * an invention.
 */

/** A finalized plan that rotates ONLY the payment key: the guard choice is
 *  `keep` and the plan carries no guard keys, so `intent.guard` is null and
 *  the chain plans exactly one step (F). */
const rotationPending = (): MigrationProgress => recorded({
  selection: {
    account: { kind: "keep-current" },
    payment: { kind: "stoic-dalos-position-0" },
    guard: { kind: "keep" },
  },
  // What stage 2 DERIVED — the value `computeOutstandingKeyChanges` compares
  // the stored ledger against, and therefore the value the card's TO line
  // shows.
  committed: { seedId: "seed-1", accountId: "a1", paymentPublicKey: NEW_PUB },
  pending: {
    finalizedAt: "2026-11-01T09:05:00.000Z",
    accountId: "a1",
    seedId: "seed-1",
    paymentPublicKey: NEW_PUB,
  },
});

/**
 * A fake chain, as the one dep the engine reads state through: it reports the
 * OLD payment key until a rotation is CONFIRMED, and whatever the rotation
 * actually submitted after that — which is what a real node does.
 *
 * A `pending` verdict registers NOTHING, deliberately: the chain has not said
 * the transaction landed, so the next read still reports the old key. That is
 * what keeps "writes nothing on a pending verdict" a property of the CODE
 * rather than of the fixture.
 *
 * Fully synthetic — `syntheticDeps` under the hood, nothing here reaches a
 * node (hazard rule 1 is untouched).
 */
function fakeChainDeps(verdict: TxVerdictKind = "success"): MigrationChainDeps {
  let registeredPaymentKey: string | null = OLD_LEDGER;
  let submittedPaymentKey: string | null = null;
  return syntheticDeps({
    readChainState: vi.fn(async () => ({ ...SETTLED, registeredPaymentKey })),
    submitRotatePaymentKey: vi.fn(async (req: { readonly newPaymentKey: string }) => {
      submittedPaymentKey = req.newPaymentKey;
      return { requestKey: "rk" };
    }),
    confirm: vi.fn(async () => {
      if (verdict === "success" && submittedPaymentKey !== null) {
        registeredPaymentKey = submittedPaymentKey;
      }
      return { verdict };
    }),
  });
}

/** Mounts the section over {@link fakeChainDeps}. */
async function mountOverFakeChain(opts: {
  readonly progress: MigrationProgress;
  readonly verdict?: TxVerdictKind;
  readonly seeds?: readonly IStoaChainSeed[];
  readonly accounts?: readonly IOuroAccount[];
  readonly codexMasterSeed?: CodexMasterSeed;
}): Promise<{ readonly deps: MigrationChainDeps }> {
  const deps = fakeChainDeps(opts.verdict ?? "success");
  await mount({
    progress: opts.progress,
    deps,
    ...(opts.seeds !== undefined ? { seeds: opts.seeds } : {}),
    ...(opts.accounts !== undefined ? { accounts: opts.accounts } : {}),
    ...(opts.codexMasterSeed !== undefined ? { codexMasterSeed: opts.codexMasterSeed } : {}),
  });
  return { deps };
}

/** The account as the CODEX now stores it, by id. */
const storedAccount = (id = "a1"): IOuroAccount =>
  store!.getState().ouroAccounts.find((a) => a.id === id)!;

/** The kinds `computeOutstandingKeyChanges` still reports over the codex's own
 *  current state — the card's data, recomputed from what was persisted. */
const stillOutstanding = (id = "a1"): string[] =>
  computeOutstandingKeyChanges(store!.getState().migrationProgress, storedAccount(id))
    .changes.map((change) => change.kind);

/** The address a rotation was actually submitted with. */
const submittedPaymentKey = (deps: MigrationChainDeps): string =>
  ((deps.submitRotatePaymentKey as unknown as ReturnType<typeof vi.fn>)
    .mock.calls[0]![0] as { newPaymentKey: string }).newPaymentKey;

describe("a payment-key rotation the chain CONFIRMED", () => {
  it("stops being listed as outstanding, because the codex records what landed", async () => {
    // THE OWNER'S DEFECT. Without the reconciliation the card lists a rotation
    // that is already in force on chain for the rest of the codex's life:
    // nothing else on this surface ever refreshes `stoaChainLedger`.
    await mountOverFakeChain({ progress: rotationPending() });
    expect(screen.getByTestId("pending-key-change-payment")).toBeTruthy();
    pressExecute();

    await waitFor(() => expect(stillOutstanding()).not.toContain("payment"));
    // ...and the card itself drops the row, which is what the owner sees.
    await waitFor(() => expect(screen.queryByTestId("pending-key-change-payment")).toBeNull());
  });

  it("stores EXACTLY the address the chain reports, never a second encoding", async () => {
    // The hazard the task names: `stoaChainLedger` is an ADDRESS (`k:<pub>`,
    // or bare for a stoic seed — `state/store.ts:2680`) while the chosen key
    // is bare hex. Writing the bare key for a `k:` seed would swap a stale
    // card for a PERMANENTLY WRONG stored address, and the address is what
    // other surfaces send funds to. So the cached value is pinned to the one
    // value the chain reports as registered, not to a re-derivation.
    const { deps } = await mountOverFakeChain({ progress: rotationPending() });
    pressExecute();

    await waitFor(() => expect(deps.submitRotatePaymentKey).toHaveBeenCalledTimes(1));
    expect(submittedPaymentKey(deps)).toBe(`k:${NEW_PUB}`);
    await waitFor(() => expect(storedAccount().stoaChainLedger).toBe(submittedPaymentKey(deps)));
  });

  it("submits and stores the SAME k: account for a stoic seed — the shipped defect", async () => {
    // DELIBERATELY REWRITTEN. This spec used to require the BARE key here,
    // pinning `paymentKeyAccountString`'s `seedType === "stoic"` branch — and
    // that branch is what put `225eb6d1…` (no sigil) into a real
    // `C_RotateStoa` on mainnet, naming an account nobody holds the keys to.
    // The chain accepted it: 64 hex chars are a legal account name.
    //
    // The owner's ruling, verbatim: *"in our case we write from a single key a
    // k: based account. That's what the migration engine will do. The user may
    // change later however it pleases."*
    //
    // So a stoic seed must be indistinguishable from any other HERE, at the
    // top of the press, which is the only place the conversion happens.
    const stoicSeeds: IStoaChainSeed[] = [{ ...seeds[0]!, seedType: "stoic" }];
    const { deps } = await mountOverFakeChain({
      progress: rotationPending(), seeds: stoicSeeds,
    });
    pressExecute();

    await waitFor(() => expect(deps.submitRotatePaymentKey).toHaveBeenCalledTimes(1));
    expect(submittedPaymentKey(deps)).toBe(`k:${NEW_PUB}`);
    await waitFor(() => expect(storedAccount().stoaChainLedger).toBe(`k:${NEW_PUB}`));
    expect(stillOutstanding()).not.toContain("payment");
  });

  it("writes NOTHING on a PENDING verdict, whose outcome is genuinely unknown", async () => {
    // The engine halts on `pending` deliberately: the transaction may still
    // land, and nothing is known. Caching a key the chain has not reported as
    // registered would be worse than staleness — it would report a rotation
    // as done that may never have happened, on the one surface that tells the
    // owner what is left to do.
    await mountOverFakeChain({ progress: rotationPending(), verdict: "pending" });
    pressExecute();

    await waitFor(() => expect(resultText()).resolves.toMatch(/unknown/i));
    expect(storedAccount().stoaChainLedger).toBe(OLD_LEDGER);
    expect(stillOutstanding()).toContain("payment");
    expect(screen.getByTestId("pending-key-change-payment")).toBeTruthy();
  });
});

/** A store handle with just the two members
 *  {@link reconcileAccountFromChainState} touches. Synthetic: no provider, no
 *  adapter, nothing persisted. */
function fakeStore(
  accounts: readonly IOuroAccount[],
  updateOuroAccount: (next: IOuroAccount) => Promise<void>,
): Parameters<typeof reconcileAccountFromChainState>[0] {
  return {
    getState: () => ({ ouroAccounts: accounts, actions: { updateOuroAccount } }),
  } as unknown as Parameters<typeof reconcileAccountFromChainState>[0];
}

/** One chain observation, as the three snapshot fields the writer reads. */
const observed = (
  over: Partial<ChainObservedAccountKeys> = {},
): ChainObservedAccountKeys => ({
  registeredPaymentKey: null,
  registeredGuard: null,
  registeredKeysetRef: null,
  ...over,
});

describe("reconcileAccountFromChainState — a cache that may never halt the chain", () => {
  it("resolves even when the persist REJECTS", async () => {
    // This now runs INSIDE the engine's chain read, so an escaping rejection
    // is worse than it was under the per-step write-back: the engine would
    // report "chain state could not be re-read", halt a migration whose
    // transactions are fine, and tell the owner to press again. The in-memory
    // state is correct either way, because `updateOuroAccount` sets before it
    // persists.
    const updateOuroAccount = vi.fn(async () => { throw new Error("quota exceeded"); });
    const store = fakeStore([account()], updateOuroAccount);

    await expect(reconcileAccountFromChainState(
      store, "a1", observed({ registeredPaymentKey: `k:${NEW_PUB}` }),
    )).resolves.toBeUndefined();
    expect(updateOuroAccount).toHaveBeenCalledTimes(1);
  });

  it("writes nothing when the chain reports exactly what is stored", async () => {
    // The engine re-reads chain on every press and after every confirmation,
    // so this runs several times per press. Each pointless write touches
    // `lastUpdatedAt` and flips `dirty`, which is a sync prompt the owner did
    // not earn.
    const updateOuroAccount = vi.fn(async () => {});
    const store = fakeStore(
      [account({ stoaChainLedger: `k:${NEW_PUB}`, guard: { keys: [GUARD_PUB], pred: "keys-all" } })],
      updateOuroAccount,
    );

    await reconcileAccountFromChainState(store, "a1", observed({
      registeredPaymentKey: `k:${NEW_PUB}`,
      registeredGuard: { keys: [GUARD_PUB], pred: "keys-all" },
    }));
    expect(updateOuroAccount).not.toHaveBeenCalled();
  });

  it("writes nothing when the chain reports the same guard keys in a DIFFERENT order", async () => {
    // Pact returns a keyset's keys in whatever order the chain holds them, and
    // key ORDER is not meaning — `outstandingKeyChanges.ts:42` compares them
    // as a SET for exactly this reason. A structural compare here would
    // rewrite the account on every single press, forever.
    const updateOuroAccount = vi.fn(async () => {});
    const store = fakeStore(
      [account({ guard: { keys: [GUARD_PUB, OLD_GUARD_PUB], pred: "keys-any" } })],
      updateOuroAccount,
    );

    await reconcileAccountFromChainState(store, "a1", observed({
      registeredGuard: { keys: [OLD_GUARD_PUB, GUARD_PUB], pred: "keys-any" },
    }));
    expect(updateOuroAccount).not.toHaveBeenCalled();
  });

  it("never erases a stored key or guard on the strength of an ABSENT one", async () => {
    // `null` means NOT OBSERVED — the selector's BAR sentinel for "no payment
    // key on record", an unactivated account, a guard shape `guardOf` does not
    // model (`chainState.ts:160-167`). Reading any of those as "cleared" would
    // destroy the codex's record of the account's keys off a read that said
    // nothing, and `stoaChainLedger` is the address other surfaces send funds
    // to.
    const updateOuroAccount = vi.fn(async () => {});
    const stored = account({ guard: { keys: [OLD_GUARD_PUB], pred: "keys-any" } });
    const store = fakeStore([stored], updateOuroAccount);

    await reconcileAccountFromChainState(store, "a1", observed());
    expect(updateOuroAccount).not.toHaveBeenCalled();
  });

  it("stores the chain's OWN predicate, never a substituted default", async () => {
    // The card compares `pred` as well as the keys
    // (`outstandingKeyChanges.ts:107`), so a hardcoded `keys-all` here would
    // silently change what it compares: an account genuinely held under
    // `keys-any` would read as already carrying the chosen keys-all guard, and
    // a rotation that never happened would vanish from the card.
    const updateOuroAccount = vi.fn(async (_next: IOuroAccount) => {});
    const store = fakeStore([account()], updateOuroAccount);

    await reconcileAccountFromChainState(store, "a1", observed({
      registeredGuard: { keys: [GUARD_PUB, OLD_GUARD_PUB], pred: "keys-2" },
    }));
    expect(updateOuroAccount).toHaveBeenCalledTimes(1);
    expect(updateOuroAccount.mock.calls[0]![0].guard)
      .toEqual({ keys: [GUARD_PUB, OLD_GUARD_PUB], pred: "keys-2" });
  });

  it("carries the keyset-ref annotation from the SAME observation", async () => {
    // `registeredGuard` and `registeredKeysetRef` are two readings of the one
    // raw `ouronet-account-guard` value (`chainState.ts:269-275`), so the
    // annotation costs no second read — and dropping it would blank the
    // keyset-ref affordances that read it back off the stored guard
    // (`resolveGuardKeys`' `viaRef`, the badge beside it).
    const updateOuroAccount = vi.fn(async (_next: IOuroAccount) => {});
    const store = fakeStore([account()], updateOuroAccount);

    await reconcileAccountFromChainState(store, "a1", observed({
      registeredGuard: { keys: [GUARD_PUB], pred: "keys-all" },
      registeredKeysetRef: "free.ancient-keyset",
    }));
    expect(updateOuroAccount.mock.calls[0]![0].guard)
      .toEqual({ keys: [GUARD_PUB], pred: "keys-all", keysetRef: "free.ancient-keyset" });
  });

  it("leaves every OTHER field of the account exactly as stored", async () => {
    // `updateOuroAccount` merges the whole object by id, so a writer that
    // rebuilt the row from a render's closure would revert anything written
    // since — the reason this reads the account FRESH out of the store.
    const updateOuroAccount = vi.fn(async (_next: IOuroAccount) => {});
    const stored = account({ name: "Renamed", stoicTag: "ancient" });
    const store = fakeStore([stored], updateOuroAccount);

    await reconcileAccountFromChainState(store, "a1", observed({
      registeredPaymentKey: `k:${NEW_PUB}`,
    }));
    expect(updateOuroAccount.mock.calls[0]![0])
      .toEqual({ ...stored, stoaChainLedger: `k:${NEW_PUB}` });
  });

  it("writes nothing at all for an account id the codex does not hold", async () => {
    const updateOuroAccount = vi.fn(async () => {});
    const store = fakeStore([account()], updateOuroAccount);

    await reconcileAccountFromChainState(store, "nope", observed({
      registeredPaymentKey: `k:${NEW_PUB}`,
    }));
    expect(updateOuroAccount).not.toHaveBeenCalled();
  });
});

// ─── (c3b) the CHAIN READ reconciles the stored account ─────────────────────

/**
 * The owner's mainnet run, 2026-11-27 — the state the per-step write-back
 * above could not reach, and the reason this surface now reconciles from the
 * READ instead.
 *
 * He ran the chain twice. Run 1 rotated the payment key and it CONFIRMED on
 * chain. Run 2 rotated the guard and it CONFIRMED on chain. Both keys are in
 * force, the toast said "Every remaining transaction is done" — and the card
 * still listed BOTH as outstanding, because `computeOutstandingKeyChanges` is
 * pure and reads the STORED `stoaChainLedger` / `guard`.
 *
 * Two holes, both of them hit:
 *
 *  1. a SKIPPED step never fires `recordStep` at all. On run 2 the engine
 *     re-read chain, saw the payment key already in force (run 1 landed it
 *     before any write-back existed) and planned no F — so nothing wrote it
 *     back, ever.
 *  2. the guard had no write-back at all. And it never could have had the
 *     per-step one: G is LAST in every plan and the engine's re-read is lazy
 *     (taken at the top of the next iteration), so a confirmed final step is
 *     followed by no read.
 *
 * `readChainState` already returns both registered values on every press.
 * These specs pin that the observation — not the step record — is what the
 * codex stores, which is also what makes the card structurally unable to
 * disagree with the engine: both now read the same read.
 */

/** The account as the owner's codex had it: BOTH fields pre-migration. */
const staleAccount = (): IOuroAccount =>
  account({ stoaChainLedger: OLD_LEDGER, guard: { keys: [OLD_GUARD_PUB], pred: "keys-any" } });

/** A finalized plan that rotates BOTH the payment key and the guard — the
 *  owner's selection. `recommended-single-key` carries no keys of its own, so
 *  the card's chosen guard comes from `committed.guardPublicKeys` under
 *  `keys-all`, exactly as the engine's intent takes it from `pending`. */
const bothRotated = (): MigrationProgress => recorded({
  selection: {
    account: { kind: "keep-current" },
    payment: { kind: "stoic-dalos-position-0" },
    guard: { kind: "recommended-single-key" },
  },
  committed: {
    seedId: "seed-1", accountId: "a1",
    paymentPublicKey: NEW_PUB, guardPublicKeys: [GUARD_PUB],
  },
  pending: {
    finalizedAt: "2026-11-01T09:05:00.000Z",
    accountId: "a1",
    seedId: "seed-1",
    paymentPublicKey: NEW_PUB,
    guardPublicKeys: [GUARD_PUB],
    guardPred: "keys-all",
  },
});

describe("a codex whose stored keys are BOTH stale", () => {
  it("drops both rows on a press that submits nothing, because the read is what reconciles", async () => {
    // THE OWNER'S END STATE. Nothing is owed on chain — `SETTLED` carries the
    // new payment key and the new guard — and the only thing that happens
    // this press is a chain READ. If that read does not reconcile, the card
    // lists two changes that are in force for the rest of the codex's life.
    const deps = syntheticDeps();
    await mount({ progress: bothRotated(), accounts: [staleAccount()], deps });

    expect(screen.getByTestId("pending-key-change-payment")).toBeTruthy();
    expect(screen.getByTestId("pending-key-change-guard")).toBeTruthy();
    pressExecute();

    await waitFor(() => expect(stillOutstanding()).toEqual([]));
    await waitFor(() => expect(screen.queryByTestId("pending-key-change-payment")).toBeNull());
    expect(screen.queryByTestId("pending-key-change-guard")).toBeNull();
    // What was stored is EXACTLY what the chain reported, in the chain's own
    // form — never a re-derivation of either field.
    expect(storedAccount().stoaChainLedger).toBe(`k:${NEW_PUB}`);
    expect(storedAccount().guard).toEqual({ keys: [GUARD_PUB], pred: "keys-all" });
    // ...and the chain owed nothing, so nothing was sent to make this true.
    for (const submit of submitters(deps)) expect(submit).not.toHaveBeenCalled();
  });

  it("records a payment key the planner SKIPPED and a guard confirmed on the LAST step", async () => {
    // Run 2, exactly: the payment key is already in force (so F is never
    // planned and `recordStep` never fires for it) and the guard rotation is
    // the last — and only — step of the plan. A fake chain, so the second
    // read reports what the rotation did, as a real node would.
    let registeredGuard: ChainStateSnapshot["registeredGuard"] =
      { keys: [OLD_GUARD_PUB], pred: "keys-any" };
    const deps = syntheticDeps({
      readChainState: vi.fn(async () => ({ ...SETTLED, registeredGuard })),
      confirm: vi.fn(async () => {
        registeredGuard = { keys: [GUARD_PUB], pred: "keys-all" };
        return { verdict: "success" as const };
      }),
    });
    await mount({ progress: bothRotated(), accounts: [staleAccount()], deps });
    pressExecute();

    await waitFor(() => expect(deps.submitRotateGuard).toHaveBeenCalledTimes(1));
    expect(await resultText()).toMatch(/every remaining transaction is done/i);
    await waitFor(() => expect(stillOutstanding()).toEqual([]));
    expect(storedAccount().guard).toEqual({ keys: [GUARD_PUB], pred: "keys-all" });
    // The skipped rotation, cached off the SAME read that decided to skip it.
    expect(storedAccount().stoaChainLedger).toBe(`k:${NEW_PUB}`);
    expect(deps.submitRotatePaymentKey).not.toHaveBeenCalled();
  });
});

// ─── (c3c) the LOAD, with NO PRESS AT ALL ───────────────────────────────────

/**
 * The owner, mainnet, 2026-11-27 — the SAME two confirmed rotations as the
 * block above, seen from a FRESH PAGE LOAD.
 *
 * His export after the migration:
 *
 *     stoaChainLedger: k:e20f2672…f231                      (the OLD key)
 *     guard:           { pred: "keys-any", keys: [1a4e15d3…, b29b7242…] }
 *
 * Both rotations are in force on chain. The press path reconciles — and only
 * the press path did, so on load `computeOutstandingKeyChanges` read the stale
 * stored account, the card listed both rows, and `applyHasOutstandingWork`
 * kept the Apply popup pointing at the executor instead of offering Seal:
 *
 * > *"i cannot apply, because it takes me to the transactions, and both
 * > transactions are already done … i cannot finalize the migration."*
 *
 * He could unstick it by pressing Execute (which submits nothing and
 * reconciles), but a button that looks like it spends money is not a way to
 * correct a display. So the reconciliation happens on MOUNT, through the same
 * read and the same single writer, and these specs press NOTHING.
 */

/** The owner's ledger, verbatim from his export. */
const OWNER_OLD_LEDGER =
  "k:e20f267264634c5bc76e15dd5a9df6703fc3c06726e7674aa6217edeb064f231";
/**
 * The two keys of his OLD `keys-any` guard. His report elides the middle of
 * each (`1a4e15d3…350a5`, `b29b7242…71a144`), so the prefix and the suffix are
 * verbatim and the unreported middle is filled to a real 64-hex length — the
 * only two things any of this code reads are the length-ish shape and the fact
 * that these are NOT the keys the chain now reports.
 */
const OWNER_OLD_GUARD_KEYS = [
  `1a4e15d3${"e".repeat(51)}350a5`,
  `b29b7242${"f".repeat(50)}71a144`,
];

/** His account exactly as the codex stored it: BOTH fields pre-migration. */
const ownerStaleAccount = (): IOuroAccount => account({
  stoaChainLedger: OWNER_OLD_LEDGER,
  guard: { keys: [...OWNER_OLD_GUARD_KEYS], pred: "keys-any" },
});

describe("a stale card on a FRESH LOAD, with no press at all", () => {
  it("reconciles BOTH of the owner's confirmed rotations on MOUNT, so the card lists nothing", async () => {
    // The fixture is genuinely the owner's defect BEFORE anything runs: two
    // rows outstanding, computed from the stored account alone.
    expect(
      computeOutstandingKeyChanges(bothRotated(), ownerStaleAccount())
        .changes.map((change) => change.kind),
    ).toEqual(["guard", "payment"]);

    const deps = syntheticDeps();
    await mount({
      progress: bothRotated(),
      accounts: [ownerStaleAccount()],
      deps,
      // The chain, reporting what is actually in force: the new payment key
      // and the new guard.
      readChainState: async () => SETTLED,
    });

    await waitFor(() => expect(stillOutstanding()).toEqual([]));
    expect(screen.queryByTestId("pending-key-change-payment")).toBeNull();
    expect(screen.queryByTestId("pending-key-change-guard")).toBeNull();
    // Stored EXACTLY as the chain reported it — `registeredPaymentKey` is
    // already an account string and the `pred` is the chain's own.
    expect(storedAccount().stoaChainLedger).toBe(`k:${NEW_PUB}`);
    expect(storedAccount().guard).toEqual({ keys: [GUARD_PUB], pred: "keys-all" });
    // NOTHING was pressed: the engine never ran, so it took no read of its
    // own and submitted nothing.
    expect(deps.readChainState).not.toHaveBeenCalled();
    for (const submit of submitters(deps)) expect(submit).not.toHaveBeenCalled();
  });

  it("takes exactly ONE read per mount, across the re-render its own write causes", async () => {
    // THE LOOP HAZARD. The write updates the store, which re-renders this
    // component — so an effect that re-fires on that change is an unbounded
    // read loop against mainnet, issued by merely opening the page.
    const { readChainState } = await mount({
      progress: bothRotated(),
      accounts: [ownerStaleAccount()],
      readChainState: async () => SETTLED,
    });

    // The write landed, which is the proof that the re-render this guards
    // against actually happened.
    await waitFor(() => expect(storedAccount().stoaChainLedger).toBe(`k:${NEW_PUB}`));
    await act(async () => { await Promise.resolve(); });
    expect(readChainState).toHaveBeenCalledTimes(1);

    // ...and an UNRELATED store write — another re-render with the same plan
    // still pending — buys no further read either.
    await act(async () => {
      await store!.getState().actions.updateOuroAccount({
        ...storedAccount(), name: "Renamed",
      });
    });
    expect(readChainState).toHaveBeenCalledTimes(1);
  });

  it("leaves the card EXACTLY as it was when the load-time read throws, and stays usable", async () => {
    // This runs on page load, so a read that fails — offline, a dead node, a
    // selector row that is not there — may not take the surface with it. The
    // owner keeps the stale card he already had, and the press that works
    // today still works.
    const deps = syntheticDeps();
    await mount({
      progress: bothRotated(),
      accounts: [ownerStaleAccount()],
      deps,
      readChainState: async () => { throw new Error("getaddrinfo ENOTFOUND"); },
    });

    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("pending-key-change-payment")).toBeTruthy();
    expect(screen.getByTestId("pending-key-change-guard")).toBeTruthy();
    expect(storedAccount().stoaChainLedger).toBe(OWNER_OLD_LEDGER);
    expect(storedAccount().guard)
      .toEqual({ keys: OWNER_OLD_GUARD_KEYS, pred: "keys-any" });
    // No spinner that never settles, and the one press is still live.
    expect(executeButton().disabled).toBe(false);
    // The swallow in the effect is load-bearing beyond these assertions: with
    // it removed this spec's own injected rejection escapes as an unhandled
    // promise rejection, which vitest reports as an error and exits non-zero
    // on (verified by deleting the `catch` — "Unhandled Rejection", exit 1).
    pressExecute();
    await waitFor(() => expect(deps.readChainState).toHaveBeenCalledTimes(1));
  });

  it("erases nothing when the load-time read OBSERVES nothing", async () => {
    // `null` is NOT OBSERVED — the selector's BAR sentinel, an unactivated
    // account, a guard shape `guardOf` does not model. Reading it as
    // "cleared" on page load would destroy the codex's record of the address
    // other surfaces send funds to, for every codex that loads while a node
    // is unhealthy.
    await mount({
      progress: bothRotated(),
      accounts: [ownerStaleAccount()],
      readChainState: async () => UNOBSERVED,
    });

    await act(async () => { await Promise.resolve(); });
    expect(storedAccount().stoaChainLedger).toBe(OWNER_OLD_LEDGER);
    expect(storedAccount().guard)
      .toEqual({ keys: OWNER_OLD_GUARD_KEYS, pred: "keys-any" });
    expect(stillOutstanding()).toEqual(["guard", "payment"]);
  });

  it("reads NOTHING on a codex with no plan pending", async () => {
    // Gated on `hasMigrationPending` — the condition the executor itself
    // renders under. Every other codex that merely opens this page must cost
    // no chain read at all.
    const { readChainState } = await mount({ progress: notFinalized() });

    expect(screen.getByTestId("pending-key-changes-section")).toBeTruthy();
    expect(screen.queryByTestId("pending-key-changes-executor")).toBeNull();
    await act(async () => { await Promise.resolve(); });
    expect(readChainState).not.toHaveBeenCalled();
  });
});

// ─── (c4) WHICH account the section calls the master ────────────────────────

/** A second account, at POSITION 0, that is NOT the codex's master and whose
 *  payment key differs from the master's — so a positional read is visible in
 *  every assertion rather than coincidentally right. */
const OTHER_PUB = "d".repeat(64);
const otherAccount = (): IOuroAccount => account({
  id: "a0", name: "Spawned", address: "Ѻ.Spawned", stoaChainLedger: `k:${OTHER_PUB}`,
});

const settledMaster = (): CodexMasterSeed => ({
  ouroAccountId: "a1",
  chainwebSeedId: "seed-1",
  establishedAt: "2026-11-01T09:05:00.000Z",
});

describe("the master account this section resolves", () => {
  it("follows the codex's SETTLED master id, not array position", async () => {
    // The sixth positional-master assumption (`accounts[0] ?? null`), after
    // the gold/pinning/badge, the account sort, `outstandingKeyChanges`' field
    // read and `currentPaymentKeyOf`. On a codex whose master is not first —
    // every codex that migrated onto a different account — the card described
    // ANOTHER account's keys and the engine was handed another account's
    // address to rotate.
    //
    // SEAL GATING: this codex is UNSEALED (no `appliedAt` — stage 3A is by
    // definition before the seal), and the settled id must still win here.
    // `OuronetAccountsTab` gates the golden DESIGNATION on `isMigrationSealed`
    // because an unapplied finalize must not repaint rows; "which account is
    // the master" is a different question, which is why
    // `resolveMasterOuronetAccount` carries no seal gate. Gating it here would
    // pin this surface to `accounts[0]` for the whole window in which it is
    // the only surface that matters.
    let seen: MigrationChainRequest | null = null;
    const runChain = vi.fn(async (req: MigrationChainRequest): Promise<MigrationChainOutcome> => {
      seen = req;
      return { status: "nothing-to-do", plan: { steps: [], nothingToDo: true } };
    });
    await mount({
      progress: rotationPending(),
      accounts: [otherAccount(), account()],
      codexMasterSeed: settledMaster(),
      runChain,
    });

    // The CARD: the FROM line is the master's live payment key.
    const card = screen.getByTestId("pending-key-change-payment").textContent ?? "";
    expect(card).toContain(OLD_PUB);
    expect(card).not.toContain(OTHER_PUB);

    // The ENGINE: the account it is told to rotate is the master.
    pressExecute();
    await waitFor(() => expect(runChain).toHaveBeenCalledTimes(1));
    expect(seen!.accountAddress).toBe(ACCOUNT);
    expect(seen!.oldPaymentAddress).toBe(OLD_LEDGER);
  });

  it("writes the registered key onto the MASTER, never onto whatever is first", async () => {
    // The two fixes meet here: a reconciliation aimed by position would move
    // another account's recorded payment key to a key that account does not
    // hold — a corruption of a row the migration never touched.
    await mountOverFakeChain({
      progress: rotationPending(),
      accounts: [otherAccount(), account()],
      codexMasterSeed: settledMaster(),
    });
    pressExecute();

    await waitFor(() => expect(storedAccount("a1").stoaChainLedger).toBe(`k:${NEW_PUB}`));
    expect(storedAccount("a0").stoaChainLedger).toBe(`k:${OTHER_PUB}`);
  });

  it("still answers POSITIONALLY on a codex that never settled a master", async () => {
    // Backwards compatibility, and the reason `resolveMasterOuronetAccount`
    // keeps a positional branch at all: a codex with no master row and no
    // `isPrime` stamp must resolve exactly as it always has.
    let seen: MigrationChainRequest | null = null;
    const runChain = vi.fn(async (req: MigrationChainRequest): Promise<MigrationChainOutcome> => {
      seen = req;
      return { status: "nothing-to-do", plan: { steps: [], nothingToDo: true } };
    });
    await mount({
      progress: rotationPending(),
      accounts: [otherAccount(), account()],
      runChain,
    });
    pressExecute();

    await waitFor(() => expect(runChain).toHaveBeenCalledTimes(1));
    expect(seen!.accountAddress).toBe("Ѻ.Spawned");
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

// ─── (d0b) G's own request — the INCOMING keyset signs its own adoption ─────
//
// THE MAINNET DEFECT THIS BLOCK EXISTS FOR (2026-11-26). Step 0
// (`rotate-payment-key`) confirmed on chain; step 1 (`rotate-guard`) died at
// SIMULATION with `Keyset failure ( keys-all ): 22ac91471a…` and signed
// nothing. Cause: this factory's `submitRotateGuard` closure passed
// `patronAnalysis` and `accountAnalysis` but NO `newGuardAnalysis`, and
// `executeRotateGuard` collects `newGuardKeys` only when one is supplied — so
// the keyset being adopted went out with no signer at all.
//
// The chain's refusal is correct and load-bearing: `C_RotateGuard` with
// `safe: true` makes the INCOMING keyset prove the owner controls what the
// account is being moved to. Without it a user could lock an account behind a
// keyset they do not hold. These tests exist to satisfy it, never to bypass it.

/** The owner's chosen guard key, carried here as the incident reported it:
 *  the 48 hex digits of `22ac91471a5ceebcd60da35d1d2587461bd6ac2064473ccc…`,
 *  padded to a full 64. A PUBLIC key — nothing secret is pinned — and it is
 *  spelled out rather than reduced to another `"c".repeat(64)` so the case
 *  this block reproduces is recognisable as the owner's own. */
const OWNER_GUARD_PUB = "22ac91471a5ceebcd60da35d1d2587461bd6ac2064473ccc" + "0".repeat(16);
/** A second key the codex also holds, for the multi-key threshold case. */
const OWNER_GUARD_PUB_2 = "d".repeat(64);
/** A key NO codex in these tests holds — the "chosen a guard I cannot sign
 *  for" case. */
const UNHELD_GUARD_PUB = "e".repeat(64);

/** The owner's CURRENT account guard: `keys-any` over TWO keys, of which this
 *  codex holds one. Its threshold is 1 — which is exactly what makes it a
 *  trap for a new-guard analysis that inherits the old guard's threshold. */
const CURRENT_ACCOUNT_GUARD = { keys: [OLD_PUB, OLD_GUARD_PUB], pred: "keys-any" };

const OWNER_CODEX_PUBS = new Set([OLD_PUB, OWNER_GUARD_PUB, OWNER_GUARD_PUB_2]);

/** `useGetKeypair()`'s contract: a keypair for a key this codex holds, a falsy
 *  answer for one it does not (which `collectGuardSigners` SKIPS). */
const ownerResolver = () =>
  vi.fn(async (publicKey: string) =>
    OWNER_CODEX_PUBS.has(publicKey) ? { publicKey, privateKey: `priv-${publicKey}` } : null,
  );

const currentAnalysis = (): ReturnType<typeof analyzeGuard> =>
  analyzeGuard(CURRENT_ACCOUNT_GUARD, OWNER_CODEX_PUBS, {});

const guardContext = (over: Partial<RotateGuardContext> = {}): RotateGuardContext => ({
  patronAddress: ACCOUNT,
  gasStationKey: { publicKey: OLD_PUB, privateKey: `priv-${OLD_PUB}` },
  patronAnalysis: currentAnalysis(),
  accountAnalysis: currentAnalysis(),
  codexPubs: OWNER_CODEX_PUBS,
  ...over,
});

const guardStep = (
  guard: { readonly keys: readonly string[]; readonly pred: string },
): RotateGuardStepRequest => ({ accountAddress: ACCOUNT, guard, chainId: "0" });

describe("buildRotateGuardRequest — the guard being ADOPTED must co-sign", () => {
  it("puts a signer for the NEW key on the submitted transaction — the owner's keys-any → keys-all rotation", async () => {
    // The live failure, end to end over the REAL `executeRotateGuard` with only
    // the broadcasting submitter injected: current guard `keys-any` over two
    // keys, rotating to `keys-all` over the single `22ac9147…` the codex holds.
    // Before this fix `newGuardKeys` was `[]` and the chain answered
    // `Keyset failure ( keys-all )`.
    const submit = vi.fn(async (..._args: Parameters<RotateGuardSubmitter>) => ({
      requestKey: "req-rotate-guard",
    }));

    await executeRotateGuard(
      buildRotateGuardRequest(
        guardStep({ keys: [OWNER_GUARD_PUB], pred: "keys-all" }),
        guardContext(),
      ),
      { getKeypair: ownerResolver(), submitRotateGuard: submit },
    );

    const params = submit.mock.calls[0]![0];
    expect(params.newGuardKeys).toEqual([
      { publicKey: OWNER_GUARD_PUB, privateKey: `priv-${OWNER_GUARD_PUB}` },
    ]);
    // In its OWN slot: folding the incoming key into `accountGuardKeys` would
    // prove ownership with a key that does not yet own anything, and the
    // `ks` payload the chain enforces would still have no signature.
    expect(params.accountGuardKeys.map((k) => k.publicKey)).not.toContain(OWNER_GUARD_PUB);
    // And the keyset actually posted is still the CHOSEN one, safe forced.
    expect(params.newKeys).toEqual([OWNER_GUARD_PUB]);
    expect(params.newPred).toBe("keys-all");
    expect(params.safe).toBe(true);
  });

  it("takes the threshold from the NEW predicate, never from the guard being replaced", async () => {
    // The silent-breakage case. `collectGuardSigners` stops at
    // `analysis.threshold`; the OLD guard here is `keys-any` (threshold 1) and
    // the NEW one is `keys-all` over TWO keys (threshold 2). An analysis that
    // inherited the old threshold would collect ONE key and fail on chain
    // exactly as the un-fixed code did — with everything looking wired.
    const submit = vi.fn(async (..._args: Parameters<RotateGuardSubmitter>) => ({
      requestKey: "req-rotate-guard",
    }));
    const req = buildRotateGuardRequest(
      guardStep({ keys: [OWNER_GUARD_PUB, OWNER_GUARD_PUB_2], pred: "keys-all" }),
      guardContext(),
    );

    expect(req.newGuardAnalysis!.threshold).toBe(2);
    // Demonstrably NOT the old guard's number, which is what was in scope here.
    expect(currentAnalysis().threshold).toBe(1);

    await executeRotateGuard(req, { getKeypair: ownerResolver(), submitRotateGuard: submit });

    expect(submit.mock.calls[0]![0].newGuardKeys.map((k) => k.publicKey)).toEqual([
      OWNER_GUARD_PUB,
      OWNER_GUARD_PUB_2,
    ]);
  });

  it("leaves the patron's and the account's own analyses exactly as the factory resolved them", async () => {
    // The new analysis is an ADDITION. If it displaced either of the other two
    // the transaction would lose the signatures that authorize the call itself
    // — the `C_RotateGuard` ownership proof and `DALOS.GAS_PAYER`.
    const context = guardContext();
    const req = buildRotateGuardRequest(
      guardStep({ keys: [OWNER_GUARD_PUB], pred: "keys-all" }),
      context,
    );

    expect(req.patronAnalysis).toBe(context.patronAnalysis);
    expect(req.accountAnalysis).toBe(context.accountAnalysis);
    expect(req.gasStationKey).toBe(context.gasStationKey);
    expect(req.patronAddress).toBe(ACCOUNT);
    expect(req.accountAddress).toBe(ACCOUNT);
    expect(req.target).toEqual({
      mode: "define",
      newKeys: [OWNER_GUARD_PUB],
      newPred: "keys-all",
    });
  });

  it("REFUSES to build one for a chosen guard this codex cannot satisfy, naming the key", async () => {
    // The owner must learn this from a refusal that names the key, not from
    // `Keyset failure ( keys-all ): e8f1…` after a confirmed payment-key
    // rotation. Thrown before any transaction for this step is built, so
    // nothing is submitted; the chain is resumable, so the halt is recoverable.
    expect(() =>
      buildRotateGuardRequest(
        guardStep({ keys: [OWNER_GUARD_PUB, UNHELD_GUARD_PUB], pred: "keys-all" }),
        guardContext(),
      ),
    ).toThrow(new RegExp(UNHELD_GUARD_PUB));
    expect(() =>
      buildRotateGuardRequest(
        guardStep({ keys: [UNHELD_GUARD_PUB], pred: "keys-all" }),
        guardContext(),
      ),
    ).toThrow(/does not hold/i);
  });

  it("still builds when a key short of the OLD guard's threshold — only the NEW guard gates it", async () => {
    // A `keys-any` chosen guard over one held and one unheld key is satisfiable
    // (threshold 1), and refusing it would block a legitimate rotation. The
    // refusal above must come from the NEW predicate's arithmetic, not from
    // "every chosen key must be held".
    const req = buildRotateGuardRequest(
      guardStep({ keys: [OWNER_GUARD_PUB, UNHELD_GUARD_PUB], pred: "keys-any" }),
      guardContext(),
    );

    expect(req.newGuardAnalysis!.threshold).toBe(1);
    expect(req.newGuardAnalysis!.codexKeys).toEqual([OWNER_GUARD_PUB]);
  });

  it("is the function the factory's own G closure routes through", async () => {
    // The one assertion in this file that has to be made on SOURCE. Header
    // rule 1 forbids invoking `submitRotateGuard` — its closure names
    // `liveRotateGuardSubmitter`, a real broadcast — so the wiring that the
    // 2026-11-26 defect broke cannot be reached by calling it. The defect was
    // precisely an inline request object in that closure; this fails if one
    // comes back.
    const source = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../src/ui/settings/PendingKeyChangesSection.tsx",
      ),
      "utf8",
    );
    const closure = source.slice(
      source.indexOf("submitRotateGuard: async (req)"),
      source.indexOf("submitDefineKeyset: async (req)"),
    );
    expect(closure).not.toBe("");
    expect(closure).toContain("buildRotateGuardRequest(");
    // The inline shape the defect shipped: a `target:` literal assembled in
    // the closure, with no new-guard analysis anywhere near it.
    expect(closure).not.toMatch(/target:\s*\{\s*mode:/);
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
