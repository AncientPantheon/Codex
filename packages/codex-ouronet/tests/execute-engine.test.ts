/**
 * execute-engine — `runMigrationChain`, the UNINTERRUPTED loop
 * (docs/work/migration-execute/design.md §3, acceptance criteria 2-9).
 *
 * The owner's requirement, verbatim: *"once the chained transactions are sent
 * to the blockchain, the UI should be in a loop to send them all. There should
 * be no interrupting it."* One press runs the chain to completion, awaiting
 * each confirmation before starting the next, and never prompts for anything.
 *
 * ## THREE groups here were DELIBERATELY REWRITTEN in round 2
 *
 * `docs/work/migration-execute-keyset/` reordered the chain to
 * **A(1..9) → C → B → D → E → F → G** and gave `define-keyset` a submitter.
 * Both are the DESIGN's call, not a casualty, and each rewritten test carries
 * the reason. The reorder's reason, with its evidence:
 *
 *   **`coin.C_URV|Collect` pays out NATIVE STOA, not urSTOA.** Its body
 *   (`0_Stoa/coin-contract/coin-live.pact:1467-1488`) hands the rewards to
 *   `C_Transmit`, which is `debit` + `credit` on the **coin table**
 *   (`:593-598`); the urSTOA ledger's mover is `X_UR|Transfer`, used by
 *   `C_URV|Stake:1415` and `C_URV|Unstake:1449`. Step C now merges a Collect
 *   into its transaction, so its rewards land in the OLD key's chain-0 NATIVE
 *   balance — the balance step **B** moves, not D. With B before C, a press
 *   that collected stranded that STOA on a key F was about to orphan: this
 *   engine re-reads and re-plans after every confirmation, but it walks its
 *   toast rows ONCE, so B's row was already spent by the time C produced the
 *   balance.
 *
 * The three groups: the happy-chain order, the no-destination reported list,
 * and the whole `define-keyset` group (which previously pinned "there is no
 * builder anywhere in the repo").
 *
 * ## The ONE step whose failure does not halt the chain
 *
 * `define-keyset` is reported and the chain continues — on a `"failure"`
 * verdict, on a `"pending"` one, on a throw, and when no submitter is wired.
 * Every other kind halts on all four. The reason is not politeness: a keyset
 * in `ouronet-ns` cannot be redefined by a user AT ALL, because that
 * namespace's user guard is the protocol's own `ns-operate-keyset`
 * (`0_Stoa/genesis/stoa-genesis-1.pact:110-113`), and
 * `resolveGuardKeys.ts:76`'s worked example of a real account guard is
 * `"ouronet-ns.dh_ah-keyset"`. Nothing in A-G depends on this step, so a halt
 * there would report a COMPLETED migration as failed over a transaction its
 * owner cannot run under any circumstances.
 *
 * ## MAINNET HAZARD — the highest in this topic, and why this file has no
 * ## `vi.mock` doing any load-bearing work
 *
 * The engine is the one caller that fires up to a dozen REAL StoaChain
 * transactions unattended: nine cross-chain consolidations, a native drain, a
 * three-step urSTOA move, and the two rotations that change who controls the
 * account. Every one of those arrives on an explicit, REQUIRED `deps` member,
 * and every spec below builds `deps` entirely out of `vi.fn()`s. There is no
 * default anywhere in `MigrationChainDeps` that could reach a node.
 *
 * **A reviewer should be able to delete every `vi.mock` in this file and have
 * it still pass.** The one `vi.mock` present (`@stoachain/stoa-core/network`,
 * whose `getFailoverClient` THROWS) is a BELT, not the braces: it proves the
 * engine's import graph never resolves a submit client, and if a refactor
 * silently drops it nothing fails open, because the injected seams have no
 * live fallback to fall back to. That is the whole reason the engine takes its
 * chain edge rather than importing one — a dropped mock fails OPEN onto
 * mainnet; a required seam cannot.
 *
 * `engine-imports-no-chain-module` makes the same point structurally, over the
 * module's own source: the engine may import pure helpers and the display
 * toast, and nothing else.
 *
 * Round 2 adds a submitter that CHANGES WHO CONTROLS A KEYSET, which is the
 * sharpest thing in this file. It arrives on the same injected seam as every
 * other: `deps.submitDefineKeyset`, built from a `vi.fn()` here, with no
 * default in `MigrationChainDeps` that could reach a node. The no-`vi.mock`
 * property above therefore still holds verbatim — delete the one mock in this
 * file and every test still passes, because not one of them depends on it.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  runMigrationChain,
  describeMigrationChainPlan,
  type MigrationChainDeps,
  type MigrationChainRequest,
  type MigrationPreconditionFacts,
} from "../src/zbom/execute/engine.js";
import {
  planMigrationChain,
  KEYSET_UPDATE_NO_REF_REASON,
  KEYSET_UPDATE_FORFEITED_REASON,
  type ChainStateSnapshot,
  type MigrationChainIntent,
} from "@ancientpantheon/codex-core";
import type { ToastController } from "../src/zbom/toast/toastManager.js";

// A belt over the injection's braces — see this file's header. Nothing in the
// engine's graph may resolve a submit client; if anything does, it throws
// instead of broadcasting.
vi.mock("@stoachain/stoa-core/network", () => ({
  getFailoverClient: () => {
    throw new Error("the migration engine must never reach getFailoverClient");
  },
}));

const OLD_PUB = "a".repeat(64);
const OLD = `k:${OLD_PUB}`;
const NEW_PUB = "b".repeat(64);
const NEW = `k:${NEW_PUB}`;
const ACCOUNT = "Ѻ.migrating-account";
const CHOSEN_GUARD = { keys: [NEW_PUB], pred: "keys-all" } as const;
const LIVE_GUARD = { keys: [OLD_PUB], pred: "keys-all" } as const;
/** The qualified reference an account's keyset-ref guard points at — what the
 *  snapshot derives from the live guard and the `define-keyset` step targets. */
const KEYSET_REF = "free.my-keyset";

/** `ToastController.updateStep`'s shape, as the engine hands it to a hop —
 *  declared locally so the spec never depends on the engine's own re-export. */
type CrossChainStepReporterLike = (
  stepIdx: number,
  status: string,
  data?: { label?: string; requestKey?: string; result?: string },
) => void;

const INTENT: MigrationChainIntent = {
  newPaymentPublicKey: NEW_PUB,
  guard: { keys: [...CHOSEN_GUARD.keys], pred: CHOSEN_GUARD.pred },
};

const REQUEST: MigrationChainRequest = {
  intent: INTENT,
  oldPaymentAddress: OLD,
  accountAddress: ACCOUNT,
  seedType: "koala",
};

/** A snapshot that owes NOTHING: the migration already landed. */
function settled(over: Partial<ChainStateSnapshot> = {}): ChainStateSnapshot {
  return {
    oldKeyStoaPerChain: {},
    oldKeyUrStoaLiquid: 0,
    oldKeyUrStoaStaked: 0,
    newKeyUrStoaLiquid: 0,
    oldKeyUrStoaEarnings: 0,
    registeredPaymentKey: NEW,
    registeredGuard: { keys: [...CHOSEN_GUARD.keys], pred: CHOSEN_GUARD.pred },
    registeredKeysetRef: null,
    ...over,
  };
}

/** A snapshot that owes EVERYTHING: A(1..9), B, C, D, E, F and G. */
function owesEverything(over: Partial<ChainStateSnapshot> = {}): ChainStateSnapshot {
  return {
    oldKeyStoaPerChain: {
      "0": 10,
      "1": 1,
      "2": 2,
      "3": 3,
      "4": 4,
      "5": 5,
      "6": 6,
      "7": 7,
      "8": 8,
      "9": 9,
    },
    oldKeyUrStoaLiquid: 100,
    oldKeyUrStoaStaked: 200,
    newKeyUrStoaLiquid: 300,
    oldKeyUrStoaEarnings: 0,
    registeredPaymentKey: OLD,
    registeredGuard: { keys: [...LIVE_GUARD.keys], pred: LIVE_GUARD.pred },
    registeredKeysetRef: null,
    ...over,
  };
}

const HAPPY_FACTS: MigrationPreconditionFacts = {
  oldPaymentKeypairPresent: true,
  chosenGuardKeysResolved: true,
  currentGuardSatisfiable: true,
  keysetUpdateSatisfiable: true,
  patronIgnisBalance: 1000,
  ignisCosts: { rotatePaymentKey: 10, rotateGuard: 10 },
};

interface Harness {
  readonly deps: MigrationChainDeps;
  /** Submitter names in CALL ORDER — the design §2 order, observable. */
  readonly order: string[];
  /** Every submitter call, with the request object it was handed. */
  readonly calls: Array<{ name: string; req: unknown }>;
  /** `updateStep` argument LISTS, verbatim — arity included (see the
   *  arity test: `(1, "done", undefined)` is not `(1, "done")`). */
  readonly updates: unknown[][];
  readonly toasts: Array<{ title: string; steps: Array<{ label: string }> }>;
  readonly recorded: Array<{ id: string; state: string; txHash?: string; error?: string }>;
}

/**
 * A fully-synthetic `deps`. Every member is a `vi.fn()`; NOTHING here can
 * reach a node, and there is deliberately no prompt member of any kind — the
 * engine cannot ask the user anything because it is handed nothing to ask
 * with (criterion 2).
 */
function harness(
  opts: {
    snapshots?: ChainStateSnapshot[];
    facts?: Partial<MigrationPreconditionFacts>;
    unlocked?: boolean;
    verdicts?: Record<string, { verdict: "success" | "failure" | "pending"; message?: string }>;
    overrides?: Partial<MigrationChainDeps>;
  } = {},
): Harness {
  const snapshots = opts.snapshots ?? [owesEverything()];
  const order: string[] = [];
  const calls: Array<{ name: string; req: unknown }> = [];
  const updates: unknown[][] = [];
  const toasts: Array<{ title: string; steps: Array<{ label: string }> }> = [];
  const recorded: Array<{ id: string; state: string; txHash?: string; error?: string }> = [];
  let reads = 0;
  let submits = 0;

  const log = (name: string) => (req: unknown) => {
    order.push(name);
    calls.push({ name, req });
    submits += 1;
    return { requestKey: `rk-${name}-${submits}` };
  };

  const controller: ToastController = {
    id: "toast-migration",
    updateStep: (...args: unknown[]) => {
      updates.push(args);
    },
    dismiss: () => {},
  } as unknown as ToastController;

  const deps: MigrationChainDeps = {
    ensureCodexUnlocked: vi.fn(async () => opts.unlocked ?? true),
    readChainState: vi.fn(async () => {
      const snap = snapshots[Math.min(reads, snapshots.length - 1)];
      reads += 1;
      return snap;
    }),
    readPreconditionFacts: vi.fn(async () => ({ ...HAPPY_FACTS, ...opts.facts })),
    confirm: vi.fn(async (requestKey: string) => {
      for (const [fragment, verdict] of Object.entries(opts.verdicts ?? {})) {
        if (requestKey.includes(fragment)) return verdict;
      }
      return { verdict: "success" as const };
    }),
    submitConsolidateStoa: vi.fn(async (req) => {
      order.push("consolidate");
      calls.push({ name: "consolidate", req });
      submits += 1;
      return {
        ok: true as const,
        requestKey: `rk-initiate-${submits}`,
        continuationRequestKey: `rk-continuation-${submits}`,
      };
    }),
    submitDrainStoa: vi.fn(async (req) => log("drain")(req)),
    submitUnstakeUrStoa: vi.fn(async (req) => log("unstake")(req)),
    submitTransferUrStoa: vi.fn(async (req) => log("transfer")(req)),
    submitStakeUrStoa: vi.fn(async (req) => log("stake")(req)),
    submitRotatePaymentKey: vi.fn(async (req) => log("rotate-payment")(req)),
    submitRotateGuard: vi.fn(async (req) => log("rotate-guard")(req)),
    // OPTIONAL on `MigrationChainDeps` (the React boundary wires it in Wave
    // 2), so a spec can also hand over a `deps` WITHOUT it and assert the
    // "no submitter is wired" report.
    submitDefineKeyset: vi.fn(async (req) => log("define-keyset")(req)),
    recordStep: vi.fn((step) => {
      recorded.push({ ...step });
    }),
    createToast: vi.fn((o: { title: string; steps: Array<{ label: string }> }) => {
      toasts.push(o);
      return controller;
    }),
    ...opts.overrides,
  };

  return { deps, order, calls, updates, toasts, recorded };
}

const names = (h: Harness): string[] => h.order;

describe("runMigrationChain — before the first transaction", () => {
  it("reports nothing-to-do over a settled snapshot, and submits nothing", async () => {
    // WHY: re-pressing is the documented recovery path (design §4). A press
    // after everything landed must be a no-op, not a second chain of
    // transactions over already-rotated keys.
    const h = harness({ snapshots: [settled()] });

    const outcome = await runMigrationChain(REQUEST, h.deps);

    expect(outcome.status).toBe("nothing-to-do");
    expect(names(h)).toEqual([]);
    expect(h.toasts).toEqual([]);
    expect(h.deps.readPreconditionFacts).not.toHaveBeenCalled();
  });

  it("refuses on preconditions with ONE message naming every missing thing, and no submitter runs", async () => {
    // WHY criterion 7: "a chain that dies at step 7 of 20 for a reason
    // knowable at step 0 is a bug". A refusal that names only the first
    // problem makes the user press, read, fix and press again once per
    // missing thing — with real money half-moved each time.
    const h = harness({
      facts: {
        oldPaymentKeypairPresent: false,
        chosenGuardKeysResolved: false,
        currentGuardSatisfiable: false,
        patronIgnisBalance: 0,
      },
    });

    const outcome = await runMigrationChain(REQUEST, h.deps);

    expect(outcome.status).toBe("refused");
    if (outcome.status !== "refused") throw new Error("unreachable");
    expect(outcome.failures.map((f) => f.code)).toEqual([
      "old-payment-keypair-missing",
      "guard-keys-unresolved",
      "current-guard-unsatisfiable",
      "insufficient-ignis",
    ]);
    expect(outcome.message).toMatch(/old payment key/i);
    expect(outcome.message).toMatch(/guard's keys/i);
    expect(outcome.message).toMatch(/current guard/i);
    expect(outcome.message).toMatch(/IGNIS/);
    expect(names(h)).toEqual([]);
  });

  it("unlocks the codex exactly ONCE for a 12-step chain, before any submit", async () => {
    // WHY criterion 2's whole point: "a chain that stops halfway to ask for a
    // password is the interruption the owner ruled out". A per-step unlock
    // would be ~14 prompts in one press.
    const h = harness();

    const outcome = await runMigrationChain(REQUEST, h.deps);

    expect(outcome.status).toBe("completed");
    expect(h.deps.ensureCodexUnlocked).toHaveBeenCalledTimes(1);
    // 9 consolidations + drain + unstake + transfer + stake + F + G.
    expect(names(h)).toHaveLength(15);
    const unlockOrder = (h.deps.ensureCodexUnlocked as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    const firstSubmit = (h.deps.submitConsolidateStoa as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    expect(unlockOrder).toBeLessThan(firstSubmit);
  });

  it("stops before reading chain state when the codex stays locked", async () => {
    // WHY: a refused password must not leave a half-planned chain or a toast
    // counting down. Nothing was attempted, so nothing is reported.
    const h = harness({ unlocked: false });

    const outcome = await runMigrationChain(REQUEST, h.deps);

    expect(outcome.status).toBe("locked");
    expect(h.deps.readChainState).not.toHaveBeenCalled();
    expect(names(h)).toEqual([]);
    expect(h.toasts).toEqual([]);
  });

  it("creates ONE toast with three rows per consolidation hop and one per other step", async () => {
    // WHY criterion 8: each consolidation hop IS a three-step flow (initiate,
    // SPV proof, continuation). One row per hop would overwrite the first
    // chain's progress with the ninth's and hide ~2 minutes of waiting per hop.
    const h = harness({
      snapshots: [
        owesEverything({
          oldKeyStoaPerChain: { "0": 10, "3": 3 },
          oldKeyUrStoaLiquid: 0,
          oldKeyUrStoaStaked: 0,
          newKeyUrStoaLiquid: 0,
        }),
      ],
    });

    await runMigrationChain(REQUEST, h.deps);

    expect(h.toasts).toHaveLength(1);
    // consolidate-3 (×3) + drain + F + G = 6 rows.
    expect(h.toasts[0].steps).toHaveLength(6);
    expect(h.toasts[0].steps.slice(0, 3).map((s) => s.label)).toEqual([
      "Chain 3: Confirming on source chain",
      "Chain 3: Waiting for cross-chain proof",
      "Chain 3: Completing on target chain",
    ]);
  });
});

describe("describeMigrationChainPlan", () => {
  it("describes every planned step, with the toast rows each one occupies", async () => {
    // WHY: T11 renders this BEFORE the press. If it invented its own step
    // vocabulary the pre-press list and the toast could disagree about what
    // the chain is going to do.
    const plan = planMigrationChain(
      {
        ...settled(),
        oldKeyStoaPerChain: { "0": 5, "7": 7 },
        registeredPaymentKey: OLD,
      },
      INTENT,
    );

    const described = describeMigrationChainPlan(plan);

    expect(described.map((d) => d.id)).toEqual([
      "consolidate-7",
      "drain-stoa",
      "rotate-payment-key",
    ]);
    expect(described[0].toastLabels).toHaveLength(3);
    expect(described[1].toastLabels).toHaveLength(1);
    expect(described[0].title).toMatch(/chain 7/i);
    expect(described[0].detail).toMatch(/7/);
    expect(described.every((d) => d.executable)).toBe(true);
  });

  it("carries the keyset-ref update's own not-executable reason", async () => {
    // WHY criterion 9: `define-keyset` must be REPORTED, never silently
    // skipped, and the reason the user reads must be the one codex-core
    // supplies rather than a second phrasing that can drift from it.
    const plan = planMigrationChain(settled({ registeredPaymentKey: NEW }), {
      ...INTENT,
      newPaymentPublicKey: NEW_PUB,
      guardSelection: "update-keyset-custom",
    });

    const described = describeMigrationChainPlan(plan);
    const keyset = described.find((d) => d.kind === "define-keyset");

    expect(keyset).toBeDefined();
    // DELIBERATE REWRITE (round 2): the fixture's guard is not a keyset-ref,
    // so the reason is now the SPECIFIC no-ref one (criterion 4) rather than
    // round 1's single blanket string — four of whose five clauses are false
    // now that the step has a builder and a derivable target.
    expect(keyset?.executable).toBe(false);
    expect(keyset?.notExecutableReason).toBe(KEYSET_UPDATE_NO_REF_REASON);
    expect(keyset?.toastLabels).toHaveLength(1);
  });
});

describe("the engine's own module graph", () => {
  it("imports no chain module, no React and no modal — only pure helpers and the display toast", () => {
    // WHY: this is the structural half of the mainnet rule. Every real submit
    // in this package reaches `getFailoverClient`/`pactRead` through a
    // module-level import, and such an import is exactly what a test cannot
    // displace. If a future edit adds one here, the engine can broadcast from
    // a unit test — so the allowlist is asserted, not assumed.
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "../src/zbom/execute/engine.ts"), "utf8");
    const specifiers = [...source.matchAll(/^import[\s\S]*?from\s+"([^"]+)";$/gm)].map(
      (m) => m[1],
    );

    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers.sort()).toEqual(
      [
        "@ancientpantheon/codex-core",
        "@stoachain/stoa-core/pact",
        "../toast/toastManager.js",
        "./awaitConfirmation.js",
        "./chainState.js",
        "./crossChainStoaTransfer.js",
        "./nativeStoaTransfer.js",
        "./rotateOps.js",
        "./urStoaOps.js",
      ].sort(),
    );
    // Over the CODE only: the header quotes `getFailoverClient` and
    // `pactRead` by name, deliberately, to say why neither is reachable.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/getFailoverClient|pactRead|ouronet-core|from "react"/);
  });
});

describe("runMigrationChain — the happy chain", () => {
  it("submits the steps in EXACTLY round 2's order: A(1..9), C, B, D, E, F, G last", async () => {
    // WHY this is the most load-bearing test in the file. The order is forced,
    // not stylistic: G rotates the guard and changes who can sign, so every
    // step must already be authorised by today's guard; and the whole drain
    // precedes F, because F re-points the account at the new key and a drain
    // after it moves funds out of a key the account no longer names. A reorder
    // here strands real money.
    //
    // DELIBERATE REWRITE (round 2): `"drain"` and `"unstake"` have SWAPPED.
    // Step C merges `coin.C_URV|Collect` into its transaction, and Collect
    // pays out NATIVE STOA — `C_Transmit` on the coin table
    // (`coin-live.pact:1467-1488`, `:593-598`) — so its rewards land in the
    // balance B moves. C before B is what makes the collected rewards reach
    // the new key in the SAME press.
    const h = harness();

    const outcome = await runMigrationChain(REQUEST, h.deps);

    expect(outcome.status).toBe("completed");
    expect(names(h)).toEqual([
      "consolidate",
      "consolidate",
      "consolidate",
      "consolidate",
      "consolidate",
      "consolidate",
      "consolidate",
      "consolidate",
      "consolidate",
      "unstake",
      "drain",
      "transfer",
      "stake",
      "rotate-payment",
      "rotate-guard",
    ]);
    // The three invariants round 2 did NOT touch, restated over the real
    // submitter call order rather than over a plan: if any of these goes red
    // the swap broke something, and the swap must be backed out.
    expect(names(h).indexOf("unstake")).toBeLessThan(names(h).indexOf("drain"));
    expect(names(h).indexOf("drain")).toBeLessThan(names(h).indexOf("rotate-payment"));
    expect(names(h).indexOf("unstake")).toBeLessThan(names(h).indexOf("transfer"));
    expect(names(h).indexOf("transfer")).toBeLessThan(names(h).indexOf("stake"));
    expect(names(h).lastIndexOf("consolidate")).toBeLessThan(names(h).indexOf("drain"));
    expect(names(h).at(-1)).toBe("rotate-guard");
  });

  it("forwards collectRewards to the unstake submitter ONLY when the old key has earnings", async () => {
    // WHY design §1, and the hole it closes: round 1 READ
    // `URC_URV|ClaimableRewards` and never collected it, so pending rewards
    // sat on the old key forever. And why the flag has to be exactly as true
    // as the earnings are: `coin.C_URV|Collect` goes through `debit`, which
    // enforces `(> amount 0.0)` (`coin-live.pact:708-721`, `:414-418`), so a
    // Collect merged in with nothing claimable FAILS THE WHOLE TRANSACTION —
    // and takes the unstake down with it. Over-collecting costs the owner
    // their unstake; under-collecting costs them the rewards.
    const withEarnings = harness({
      snapshots: [owesUrStoaAndRotations({ oldKeyUrStoaEarnings: 0.5 })],
    });
    await runMigrationChain(REQUEST, withEarnings.deps);
    const collected = withEarnings.calls.find((c) => c.name === "unstake")?.req as {
      address: string;
      amount: string;
      collectRewards?: boolean;
    };
    expect(collected.collectRewards).toBe(true);
    // The AMOUNT is still the stake, not the stake plus the rewards: Collect
    // takes no argument and pays out whatever is claimable on chain, and
    // `UR_URV|UserSupply` is provably untouched by it (Collect never calls
    // `XI_URV|UpdateUserScore`, `coin-live.pact:1609-1625`).
    expect(collected.address).toBe(OLD);
    expect(Number(collected.amount)).toBe(200);

    const noEarnings = harness({ snapshots: [owesUrStoaAndRotations()] });
    await runMigrationChain(REQUEST, noEarnings.deps);
    const plain = noEarnings.calls.find((c) => c.name === "unstake")?.req as {
      collectRewards?: boolean;
    };
    // ABSENT, not `false`: the submitter builds a one-expression transaction
    // unless it is told otherwise, and `(1, "done", undefined)` is not
    // `(1, "done")` — the same arity discipline this file applies to the toast.
    expect(plain.collectRewards).toBeUndefined();
  });

  it("consolidates the nine source chains in ascending order, each onto chain 0, old key both sides", async () => {
    // WHY criterion 4 + design §2: consolidation moves a KEY'S OWN funds
    // between chains. A hop that named the new key as receiver would move
    // funds cross-chain to a key that cannot yet sign the continuation's
    // follow-ups, and the sweep's whole point is to leave one balance on
    // chain 0 for B to drain.
    const h = harness();

    await runMigrationChain(REQUEST, h.deps);

    const hops = h.calls.filter((c) => c.name === "consolidate").map((c) => c.req as {
      sourceChain: string;
      targetChain: string;
      sender: string;
      receiver: string;
      amount: string;
    });
    expect(hops.map((x) => x.sourceChain)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    expect(hops.every((x) => x.targetChain === "0")).toBe(true);
    expect(hops.every((x) => x.sender === OLD && x.receiver === OLD)).toBe(true);
    // Native STOA carries 12 decimals, TRUNCATED (`drainAmountForPact`).
    expect(hops[2].amount).toBe("3.000000000000");
  });

  it("skips chains with nothing on them — no consolidation call for a zero balance", async () => {
    // WHY criterion 4: a hop over an empty chain burns gas, occupies three
    // toast rows and waits ~2 minutes for an SPV proof of nothing.
    const h = harness({
      snapshots: [owesEverything({ oldKeyStoaPerChain: { "0": 1, "4": 4, "7": 0 } })],
    });

    await runMigrationChain(REQUEST, h.deps);

    const hops = h.calls
      .filter((c) => c.name === "consolidate")
      .map((c) => (c.req as { sourceChain: string }).sourceChain);
    expect(hops).toEqual(["4"]);
  });

  it("hands every fund-moving step the right parties and the right precision", async () => {
    // WHY: the direction is the migration. A drain with the parties swapped
    // moves the new key's funds onto the old one; a urSTOA amount formatted at
    // 12 decimals instead of 3 is rejected on chain. Both are silent in a test
    // that only counts calls.
    const h = harness();

    await runMigrationChain(REQUEST, h.deps);

    const byName = (name: string): Record<string, unknown> =>
      h.calls.find((c) => c.name === name)?.req as Record<string, unknown>;

    expect(byName("drain")).toEqual({
      sender: OLD,
      receiver: NEW,
      amount: "10.000000000000",
      chainId: "0",
    });
    // C and E have NO destination — staking acts on the account itself — so
    // the only address each carries is the one it acts on.
    expect(byName("unstake")).toEqual({ address: OLD, amount: "200.000", chainId: "0" });
    expect(byName("transfer")).toEqual({
      senderAddress: OLD,
      receiverAddress: NEW,
      amount: "100.000",
      chainId: "0",
    });
    expect(byName("stake")).toEqual({ address: NEW, amount: "300.000", chainId: "0" });
    // Design §5's account-string conversion, performed by the engine and
    // nothing else: a `"koala"` seed's payment key is `k:<pub>`.
    expect(byName("rotate-payment")).toEqual({
      accountAddress: ACCOUNT,
      newPaymentKey: NEW,
      chainId: "0",
    });
    expect(byName("rotate-guard")).toEqual({
      accountAddress: ACCOUNT,
      guard: { keys: [NEW_PUB], pred: "keys-all" },
      chainId: "0",
    });
  });

  it("confirms a hop's CONTINUATION key on the TARGET chain, and every other step on its own chain", async () => {
    // WHY: the continuation is what actually lands the funds, and it lands on
    // the target chain. Confirming the initiate key again, or polling the
    // SOURCE chain for the continuation, never resolves — the budget would
    // expire and the engine would halt a transfer that completed perfectly.
    const h = harness({
      snapshots: [
        owesEverything({
          oldKeyStoaPerChain: { "5": 5 },
          oldKeyUrStoaLiquid: 0,
          oldKeyUrStoaStaked: 0,
          newKeyUrStoaLiquid: 0,
          registeredPaymentKey: NEW,
          registeredGuard: { keys: [...CHOSEN_GUARD.keys], pred: CHOSEN_GUARD.pred },
        }),
      ],
    });

    await runMigrationChain(REQUEST, h.deps);

    const confirmCalls = (h.deps.confirm as ReturnType<typeof vi.fn>).mock.calls;
    expect(confirmCalls).toHaveLength(1);
    expect(confirmCalls[0][0]).toMatch(/^rk-continuation-/);
    expect(confirmCalls[0][1]).toBe("0");
  });

  it("gives each hop its own three toast rows, offset so the ninth cannot overwrite the first", async () => {
    // WHY: `offsetStepReporter` exists for exactly this, and an un-offset
    // reporter is invisible in a passing happy-path test — every hop would
    // just repaint rows 0-2 while the user watches the wrong chain's progress.
    const h = harness({
      snapshots: [
        owesEverything({
          oldKeyStoaPerChain: { "1": 1, "2": 2 },
          oldKeyUrStoaLiquid: 0,
          oldKeyUrStoaStaked: 0,
          newKeyUrStoaLiquid: 0,
        }),
      ],
    });

    await runMigrationChain(REQUEST, h.deps);

    const hops = h.calls
      .filter((c) => c.name === "consolidate")
      .map((c) => (c.req as { onStep: CrossChainStepReporterLike }).onStep);
    h.updates.length = 0;
    hops[0](1, "done");
    hops[1](1, "done");
    hops[1](0, "active", { requestKey: "rk" });
    // Hop 0 owns rows 0-2, hop 1 owns rows 3-5.
    expect(h.updates).toEqual([
      [1, "done"],
      [4, "done"],
      [3, "active", { requestKey: "rk" }],
    ]);
  });

  it("reports a step 'active' with TWO arguments, never a trailing undefined", async () => {
    // WHY (and this is not pedantry): `offsetStepReporter` forwards two
    // arguments when it has no data precisely because callers and their specs
    // compare whole argument lists — `(1, "done", undefined)` is not
    // `(1, "done")`. The engine is the reporter those callers see.
    const h = harness({
      snapshots: [
        owesEverything({
          oldKeyStoaPerChain: {},
          oldKeyUrStoaLiquid: 0,
          oldKeyUrStoaStaked: 0,
          newKeyUrStoaLiquid: 0,
          registeredPaymentKey: NEW,
        }),
      ],
    });

    await runMigrationChain(REQUEST, h.deps);

    expect(h.updates[0]).toEqual([0, "active"]);
    expect(h.updates[0]).toHaveLength(2);
  });

  it("records every attempted step by its STABLE id: running, then running with the txHash, then confirmed", async () => {
    // WHY criterion 8: `execution.steps` is the support record of what the
    // engine DID. A record written only after confirmation loses exactly the
    // case it exists for — the tab that dies mid-transaction — and an id
    // derived from a step's POSITION would stop merging across presses.
    const h = harness({
      snapshots: [
        owesEverything({
          oldKeyStoaPerChain: { "0": 2 },
          oldKeyUrStoaLiquid: 0,
          oldKeyUrStoaStaked: 0,
          newKeyUrStoaLiquid: 0,
          registeredPaymentKey: NEW,
          registeredGuard: { keys: [...CHOSEN_GUARD.keys], pred: CHOSEN_GUARD.pred },
        }),
      ],
    });

    await runMigrationChain(REQUEST, h.deps);

    expect(h.recorded).toEqual([
      { id: "drain-stoa", state: "running" },
      { id: "drain-stoa", state: "running", txHash: "rk-drain-1" },
      { id: "drain-stoa", state: "confirmed", txHash: "rk-drain-1" },
    ]);
  });
});

/** A snapshot owing only the urSTOA trio plus the two rotations. */
function owesUrStoaAndRotations(over: Partial<ChainStateSnapshot> = {}): ChainStateSnapshot {
  return owesEverything({
    oldKeyStoaPerChain: {},
    oldKeyUrStoaLiquid: 100,
    oldKeyUrStoaStaked: 200,
    newKeyUrStoaLiquid: 300,
    ...over,
  });
}

describe("runMigrationChain — the halt", () => {
  it("a 'failure' on C means D, E, F and G are NEVER called", async () => {
    // WHY: this is the halt that keeps funds where they are. C unstakes; D
    // transfers the LIQUID urSTOA that C was supposed to create. If a failed C
    // did not stop the chain, D would transfer a stale amount, E would stake on
    // the wrong balance, and F would then rotate the payment key away from the
    // account holding what is left.
    const h = harness({
      snapshots: [owesUrStoaAndRotations()],
      verdicts: { "rk-unstake": { verdict: "failure", message: "vault: insufficient balance" } },
    });

    const outcome = await runMigrationChain(REQUEST, h.deps);

    expect(names(h)).toEqual(["unstake"]);
    expect(outcome.status).toBe("halted");
    if (outcome.status !== "halted") throw new Error("unreachable");
    expect(outcome.halt).toMatchObject({
      stepId: "unstake-urstoa",
      kind: "unstake-urstoa",
      reason: "failure",
      requestKey: "rk-unstake-1",
    });
    // The CHAIN's own words, not a paraphrase: the user needs the Pact error.
    expect(outcome.halt.message).toContain("vault: insufficient balance");
    expect(h.recorded.at(-1)).toEqual({
      id: "unstake-urstoa",
      state: "failed",
      txHash: "rk-unstake-1",
      error: expect.stringContaining("vault: insufficient balance") as unknown as string,
    });
    expect(h.updates.at(-1)?.[1]).toBe("error");
  });

  it("a 'pending' on C halts the SAME way but says the outcome is UNKNOWN", async () => {
    // WHY plan decision 4: an exhausted confirmation budget is not a failure —
    // the transaction may still land. Reporting it as a failure invites a
    // duplicate resubmit of money already in flight; reporting it as success
    // feeds D an amount C has not produced yet. So: halt, but with a message
    // that says re-pressing re-reads the chain, and a toast row that reads
    // "Submitted — not confirmed" rather than "error".
    const h = harness({
      snapshots: [owesUrStoaAndRotations()],
      verdicts: { "rk-unstake": { verdict: "pending" } },
    });

    const outcome = await runMigrationChain(REQUEST, h.deps);

    expect(names(h)).toEqual(["unstake"]);
    expect(outcome.status).toBe("halted");
    if (outcome.status !== "halted") throw new Error("unreachable");
    expect(outcome.halt.reason).toBe("pending");
    expect(outcome.halt.message).toMatch(/not confirm/i);
    expect(outcome.halt.message).toMatch(/press/i);
    expect(outcome.halt.message).not.toMatch(/failed/i);
    const recorded = h.recorded.at(-1);
    expect(recorded?.state).toBe("failed");
    expect(recorded?.error).toMatch(/unknown|not confirm/i);
    expect(recorded?.error).toMatch(/press/i);
    // The row is "done" with the honest label — NOT "error": nothing is known
    // to have gone wrong.
    expect(h.updates.at(-1)).toEqual([
      0,
      "done",
      { label: "Submitted — not confirmed", requestKey: "rk-unstake-1" },
    ]);
  });

  it("halts on a cross-chain hop's own failure, without reporting the row a second time", async () => {
    // WHY: `runCrossChainStoaTransfer` reports the failing row itself before
    // returning `ok: false` ("a caller must not report it a second time"), and
    // its four failure kinds are a JUDGEMENT — `spv-timeout` means the
    // initiate LANDED and the funds are in escrow, so nothing may be re-sent.
    // The engine's job is to stop and pass the words through.
    const h = harness({
      snapshots: [owesEverything({ oldKeyStoaPerChain: { "0": 5, "2": 2 } })],
      overrides: {
        submitConsolidateStoa: vi.fn(async () => ({
          ok: false as const,
          kind: "spv-timeout" as const,
          message: "Timed out waiting for the SPV proof.",
          requestKey: "rk-initiate-escrowed",
        })),
      },
    });

    const outcome = await runMigrationChain(REQUEST, h.deps);

    expect(names(h)).toEqual([]);
    expect(h.deps.submitDrainStoa).not.toHaveBeenCalled();
    expect(outcome.status).toBe("halted");
    if (outcome.status !== "halted") throw new Error("unreachable");
    expect(outcome.halt).toMatchObject({
      stepId: "consolidate-2",
      reason: "flow-failed",
      message: "Timed out waiting for the SPV proof.",
      requestKey: "rk-initiate-escrowed",
    });
    // The hop owns rows 0-2 and already reported its own error there.
    expect(h.updates.some((u) => u[1] === "error")).toBe(false);
    expect(h.recorded.at(-1)).toEqual({
      id: "consolidate-2",
      state: "failed",
      txHash: "rk-initiate-escrowed",
      error: "Timed out waiting for the SPV proof.",
    });
  });

  it("halts when a submitter hands back no request key — an unconfirmable step is not a confirmed one", async () => {
    // WHY: `rotateStoaChainPaymentKeyLive` declares `requestKey` OPTIONAL, so
    // "" is a reachable value. Polling "" can only ever time out, and treating
    // its absence as success would run G — the guard rotation that changes the
    // signing set — over a payment-key rotation nobody knows landed.
    const h = harness({
      snapshots: [settled({ registeredPaymentKey: OLD, registeredGuard: null })],
      overrides: { submitRotatePaymentKey: vi.fn(async () => ({})) },
    });

    const outcome = await runMigrationChain(REQUEST, h.deps);

    expect(outcome.status).toBe("halted");
    if (outcome.status !== "halted") throw new Error("unreachable");
    expect(outcome.halt.reason).toBe("not-submitted");
    expect(outcome.halt.stepId).toBe("rotate-payment-key");
    expect(h.deps.confirm).not.toHaveBeenCalled();
    expect(h.deps.submitRotateGuard).not.toHaveBeenCalled();
  });

  it("halts on a thrown submitter instead of letting the rejection escape", async () => {
    // WHY: a locked codex, a refused node or a failed simulation throws rather
    // than returning a verdict (`submitNativeStoaTransfer`'s own contract). An
    // unhandled rejection here would leave the toast spinning forever and the
    // caller with no outcome to report — and the next press would be the user's
    // only clue that anything happened.
    const h = harness({
      snapshots: [owesUrStoaAndRotations()],
      overrides: {
        submitUnstakeUrStoa: vi.fn(async () => {
          throw new Error("Codex is locked");
        }),
      },
    });

    const outcome = await runMigrationChain(REQUEST, h.deps);

    expect(outcome.status).toBe("halted");
    if (outcome.status !== "halted") throw new Error("unreachable");
    expect(outcome.halt.reason).toBe("threw");
    expect(outcome.halt.message).toContain("Codex is locked");
    expect(h.deps.submitTransferUrStoa).not.toHaveBeenCalled();
    expect(h.recorded.at(-1)).toMatchObject({
      id: "unstake-urstoa",
      state: "failed",
      error: expect.stringContaining("Codex is locked") as unknown as string,
    });
  });
});

describe("runMigrationChain — one press, re-read and re-planned after every confirmation", () => {
  it("runs C, D and E in ONE press, each with an amount re-read from chain", async () => {
    // WHY this is the whole point of the loop. D's predicate is "the OLD key's
    // LIQUID urSTOA > 0", and at press time a fully-staked key has none: the
    // liquidity is what C is about to create. A single-snapshot engine plans C
    // alone and needs a SECOND press for D and E — the interruption the owner
    // ruled out. And the amounts must come from the re-read, never from
    // arithmetic over the old snapshot: guessing a quantity a prior step has
    // not yet produced is how urSTOA gets stranded on the old key.
    const h = harness({
      snapshots: [
        settled({ oldKeyUrStoaStaked: 200 }),
        settled({ oldKeyUrStoaLiquid: 200 }),
        settled({ newKeyUrStoaLiquid: 200 }),
      ],
    });

    const outcome = await runMigrationChain(REQUEST, h.deps);

    expect(names(h)).toEqual(["unstake", "transfer", "stake"]);
    expect(h.calls.map((c) => (c.req as { amount: string }).amount)).toEqual([
      "200.000",
      "200.000",
      "200.000",
    ]);
    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") throw new Error("unreachable");
    expect(outcome.confirmed).toEqual([
      "unstake-urstoa",
      "move-urstoa",
      "restake-urstoa",
    ]);
    // Three rows reserved up front — the toast's row count cannot change
    // mid-flight, so D and E must have had rows before the re-plan found them.
    expect(h.toasts[0].steps.map((s) => s.label)).toEqual([
      "Unstake urSTOA from the vault",
      "Move urSTOA to the new payment key",
      "Re-stake urSTOA on the new payment key",
    ]);
    // One read up front, then one after each confirmation that another row
    // still needs — never a wasted read after the last step.
    expect(h.deps.readChainState).toHaveBeenCalledTimes(3);
  });

  it("drains chain 0 in the SAME press that consolidated onto it", async () => {
    // WHY: B's predicate is the chain-0 balance, which at press time is zero
    // precisely because the funds are still spread over chains 1-9. Without a
    // re-plan the consolidation would land and the drain would wait for a
    // second press — with every consolidated coin sitting on the OLD key.
    const h = harness({
      snapshots: [
        settled({ oldKeyStoaPerChain: { "3": 3 } }),
        settled({ oldKeyStoaPerChain: { "0": 3 } }),
      ],
    });

    const outcome = await runMigrationChain(REQUEST, h.deps);

    expect(names(h)).toEqual(["consolidate", "drain"]);
    expect((h.calls[1].req as { amount: string }).amount).toBe("3.000000000000");
    expect(outcome.status).toBe("completed");
  });

  it("marks a row whose predicate is no longer true as done, and submits nothing for it", async () => {
    // WHY design §4: re-pressing after a crash must SKIP what landed rather
    // than re-send it. The same mechanism covers a balance that moved for any
    // other reason between the press and the step — the chain is the authority,
    // so a step whose predicate went false is simply not run.
    const h = harness({
      snapshots: [
        settled({ oldKeyUrStoaStaked: 200, oldKeyUrStoaLiquid: 100 }),
        settled(),
      ],
    });

    const outcome = await runMigrationChain(REQUEST, h.deps);

    expect(names(h)).toEqual(["unstake"]);
    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") throw new Error("unreachable");
    expect(outcome.skipped).toEqual(["move-urstoa", "restake-urstoa"]);
    expect(h.updates.filter((u) => u[1] === "error")).toEqual([]);
    expect(h.updates.at(-2)).toEqual([1, "done", { label: "Nothing to do" }]);
  });

  it("halts when the mid-chain re-read fails, instead of letting the rejection escape", async () => {
    // WHY: the re-read is the engine's only source of truth for the next
    // step's amount, and an RPC blip between two steps is ordinary. An escaped
    // rejection would leave the toast spinning with no outcome, after real
    // transactions had already landed — the one state the user most needs
    // reported. Halting is safe: the next press re-reads everything.
    let reads = 0;
    const h = harness({
      snapshots: [settled({ oldKeyUrStoaStaked: 200 })],
      overrides: {
        readChainState: vi.fn(async () => {
          reads += 1;
          if (reads > 1) throw new Error("node refused the balance read");
          return settled({ oldKeyUrStoaStaked: 200 });
        }),
      },
    });

    const outcome = await runMigrationChain(REQUEST, h.deps);

    expect(names(h)).toEqual(["unstake"]);
    expect(outcome.status).toBe("halted");
    if (outcome.status !== "halted") throw new Error("unreachable");
    expect(outcome.halt.reason).toBe("threw");
    expect(outcome.halt.message).toContain("node refused the balance read");
    // The unstake DID confirm — the halt must not erase that.
    expect(outcome.confirmed).toEqual(["unstake-urstoa"]);
    expect(h.deps.submitTransferUrStoa).not.toHaveBeenCalled();
  });

  it("a second press over a snapshot reflecting the first one re-submits nothing", async () => {
    // WHY: idempotence is what makes a halt cheap and a crash unremarkable. If
    // a second press re-sent a landed transfer, every recovery would cost the
    // user a double spend.
    const first = harness({ snapshots: [owesEverything(), settled()] });
    await runMigrationChain(REQUEST, first.deps);
    expect(names(first).length).toBeGreaterThan(0);

    const second = harness({ snapshots: [settled()] });
    const outcome = await runMigrationChain(REQUEST, second.deps);

    expect(outcome.status).toBe("nothing-to-do");
    expect(names(second)).toEqual([]);
  });
});

describe("runMigrationChain — reported, never silently skipped, and never a halt", () => {
  /** A press that owes F and the keyset update, with F confirming first so the
   *  keyset step is reached through a FRESH read. */
  const keysetHarness = (
    opts: {
      ref?: string | null;
      verdicts?: Record<string, { verdict: "success" | "failure" | "pending"; message?: string }>;
      overrides?: Partial<MigrationChainDeps>;
    } = {},
  ) =>
    harness({
      snapshots: [
        // Read 1: F is owed, and the account's guard names a keyset.
        // `=== undefined`, not `??`: `ref: null` is the no-keyset-ref CASE and
        // must survive, where `??` would silently restore the default.
        settled({
          registeredPaymentKey: OLD,
          registeredKeysetRef: opts.ref === undefined ? KEYSET_REF : opts.ref,
        }),
        // Read 2, after F confirmed: the account now names the NEW key.
        settled({
          registeredPaymentKey: NEW,
          registeredKeysetRef: opts.ref === undefined ? KEYSET_REF : opts.ref,
        }),
      ],
      ...(opts.verdicts !== undefined ? { verdicts: opts.verdicts } : {}),
      ...(opts.overrides !== undefined ? { overrides: opts.overrides } : {}),
    });

  const KEYSET_REQUEST: MigrationChainRequest = {
    ...REQUEST,
    intent: { ...INTENT, guardSelection: "update-keyset-recommended" },
  };

  it("submits `define-keyset` ONCE, with the live reference, the new keys and the pred", async () => {
    // WHY criterion 3, and why this group was REWRITTEN: round 1 pinned
    // "there is no builder for `define-keyset` anywhere in the repo". Round 2
    // found the target needs no new read and no new recorded field — the
    // account-guard read already expands a keyset-ref and annotates it with
    // `keysetRef: "<ns>.<ksn>"` (`ouroAccountFunctions.js:158-170`), which
    // `keysetRefNameOf` (`resolveGuardKeys.ts:93-105`) reads out of either
    // real-world spelling. So the step runs, and ONCE: a keyset redefinition
    // sent twice is one transaction that cannot be undone and a second that
    // burns self-paid gas for nothing.
    const h = keysetHarness();

    const outcome = await runMigrationChain(KEYSET_REQUEST, h.deps);

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") throw new Error("unreachable");
    expect(names(h)).toEqual(["rotate-payment", "define-keyset"]);
    expect(h.deps.submitDefineKeyset).toHaveBeenCalledTimes(1);
    expect(h.calls.find((c) => c.name === "define-keyset")?.req).toEqual({
      keysetRef: KEYSET_REF,
      keys: [...CHOSEN_GUARD.keys],
      pred: CHOSEN_GUARD.pred,
      payerAddress: NEW,
      chainId: "0",
    });
    expect(outcome.confirmed).toEqual(["rotate-payment-key", "define-keyset"]);
    expect(outcome.reported).toEqual([]);
    // G is NOT submitted: `planMigrationChain` suppresses it for both
    // `update-keyset-*` kinds, because "update what the reference resolves
    // to" is not an account-guard rotation.
    expect(names(h)).not.toContain("rotate-guard");
  });

  it("takes the gas payer from the FRESH snapshot — the NEW key, after F confirmed", async () => {
    // WHY this is read LATE and not from the plan's first read: this is the
    // ONE transaction in the chain the Ouronet gas station cannot sponsor.
    // `DALOS.GAS_PAYER` (`01_DALOS.pact:456-526`) accepts exactly three
    // transaction shapes and `(define-keyset …)` matches none of them, so the
    // gas is self-paid by a real STOA account — and by the time this step
    // runs, B has moved every STOA onto the NEW key. Paying from the old key
    // would pay from the address the chain just emptied.
    const h = keysetHarness();

    await runMigrationChain(KEYSET_REQUEST, h.deps);

    const req = h.calls.find((c) => c.name === "define-keyset")?.req as {
      payerAddress: string;
    };
    expect(req.payerAddress).toBe(NEW);
    expect(req.payerAddress).not.toBe(OLD);
    // Read 1 said OLD, read 2 said NEW: the figure came from the re-read, not
    // from the snapshot the preconditions were checked over.
    expect(h.deps.readChainState).toHaveBeenCalledTimes(2);
  });

  it("reports a `define-keyset` FAILURE and COMPLETES — the one halt carve-out", async () => {
    // THE money assertion of this task. A keyset in `ouronet-ns` cannot be
    // redefined by a user AT ALL: that namespace's user guard is the
    // protocol's own `ns-operate-keyset`
    // (`0_Stoa/genesis/stoa-genesis-1.pact:110-113`), and
    // `resolveGuardKeys.ts:76`'s worked example of a real account guard is
    // `"ouronet-ns.dh_ah-keyset"`. The step sits last and nothing in A-G
    // depends on it, so a halt here would report a migration whose every
    // fund-moving step and rotation LANDED as failed — over a transaction its
    // owner can never make succeed. It is reported instead.
    const h = keysetHarness({
      verdicts: { "define-keyset": { verdict: "failure", message: "Keyset guard failure" } },
    });

    const outcome = await runMigrationChain(KEYSET_REQUEST, h.deps);

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") throw new Error("unreachable");
    // Everything before it stands, and the keyset step is REPORTED with the
    // chain's own words rather than a house rewrite.
    expect(outcome.confirmed).toEqual(["rotate-payment-key"]);
    expect(outcome.reported.map((r) => r.stepId)).toEqual(["define-keyset"]);
    expect(outcome.reported[0].message).toContain("Keyset guard failure");
    expect(outcome.reported[0].message).toMatch(/rest of the migration|chain continued/i);
  });

  it("halts on the SAME failure for any other step kind — the carve-out is per-KIND", async () => {
    // WHY paired with the test above: a carve-out written as "do not halt"
    // rather than "do not halt for THIS kind" would turn every failure in the
    // chain into a shrug, and the C→D halt is what keeps a stale amount from
    // reaching a transfer builder. Same verdict, same harness shape, opposite
    // outcome — that contrast IS the rule.
    const h = harness({
      snapshots: [settled({ registeredPaymentKey: OLD, oldKeyStoaPerChain: { "0": 5 } })],
      verdicts: { drain: { verdict: "failure", message: "Keyset guard failure" } },
    });

    const outcome = await runMigrationChain(REQUEST, h.deps);

    expect(outcome.status).toBe("halted");
    if (outcome.status !== "halted") throw new Error("unreachable");
    expect(outcome.halt.stepId).toBe("drain-stoa");
    expect(outcome.halt.reason).toBe("failure");
    expect(names(h)).toEqual(["drain"]);
  });

  it("reports an UNCONFIRMED `define-keyset` rather than halting on it", async () => {
    // WHY `"pending"` is in the carve-out too: a pending verdict halts every
    // other step because the NEXT step would read an amount from a balance
    // this one has not changed yet. Nothing follows this step and nothing
    // reads from it, so the only thing a halt buys is telling the owner their
    // completed migration failed. The row still says "may still land", never
    // "failed" — that wording is what stops a duplicate resubmit.
    const h = keysetHarness({
      verdicts: { "define-keyset": { verdict: "pending" } },
    });

    const outcome = await runMigrationChain(KEYSET_REQUEST, h.deps);

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") throw new Error("unreachable");
    expect(outcome.reported.map((r) => r.stepId)).toEqual(["define-keyset"]);
    expect(outcome.reported[0].message).toMatch(/not confirmed|may still land/i);
  });

  it("reports a THROWN `define-keyset` rather than halting on it", async () => {
    // WHY: the builder SIMULATES before it signs, so a closed namespace, an
    // unsatisfiable current keyset that slipped past the gate, and any
    // chain-side surprise all arrive here as a throw rather than as a verdict.
    // That one rule is what makes a namespace read unnecessary anywhere.
    const h = keysetHarness({
      overrides: {
        submitDefineKeyset: vi.fn(async () => {
          throw new Error("simulation refused: keyset guard not satisfied");
        }),
      },
    });

    const outcome = await runMigrationChain(KEYSET_REQUEST, h.deps);

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") throw new Error("unreachable");
    expect(outcome.confirmed).toEqual(["rotate-payment-key"]);
    expect(outcome.reported.map((r) => r.stepId)).toEqual(["define-keyset"]);
    expect(outcome.reported[0].message).toContain("simulation refused");
    expect(h.recorded).toContainEqual({
      id: "define-keyset",
      state: "failed",
      error: expect.stringContaining("simulation refused") as unknown as string,
    });
  });

  it("reports a MISSING submitter rather than halting — `submitDefineKeyset` is optional", async () => {
    // WHY optional at all: `MigrationChainDeps` is assembled at the React
    // boundary, and this submitter lands there a wave later than the engine.
    // "No submitter is wired" is a legitimate state, not a crash — and it
    // records `"pending"` (never attempted, still owed) rather than
    // `"failed"`, because nothing was submitted.
    const h = keysetHarness({ overrides: { submitDefineKeyset: undefined } });

    const outcome = await runMigrationChain(KEYSET_REQUEST, h.deps);

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") throw new Error("unreachable");
    expect(names(h)).toEqual(["rotate-payment"]);
    expect(outcome.reported.map((r) => r.stepId)).toEqual(["define-keyset"]);
    expect(outcome.reported[0].message).toMatch(/no submitter/i);
    expect(h.recorded).toContainEqual({
      id: "define-keyset",
      state: "pending",
      error: expect.stringContaining("submitter") as unknown as string,
    });
  });

  it("reports a FORFEITED keyset update and never submits it", async () => {
    // WHY criterion 8: "forfeit proceeds with every other step and is
    // reported, not an error". The forfeit resolves BEFORE the chain starts
    // (design §3) and travels on the intent, so the engine needs no new path
    // at all — the step arrives already non-executable and the existing
    // report-and-continue branch handles it. The engine must never prompt,
    // and it is handed nothing it could prompt with.
    const h = keysetHarness();

    const outcome = await runMigrationChain(
      {
        ...KEYSET_REQUEST,
        intent: { ...KEYSET_REQUEST.intent, keysetUpdateForfeited: true },
      },
      h.deps,
    );

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") throw new Error("unreachable");
    expect(h.deps.submitDefineKeyset).not.toHaveBeenCalled();
    expect(names(h)).toEqual(["rotate-payment"]);
    expect(outcome.reported).toEqual([
      {
        stepId: "define-keyset",
        kind: "define-keyset",
        message: KEYSET_UPDATE_FORFEITED_REASON,
      },
    ]);
  });

  it("reports a guard that is NOT a keyset-ref, and still completes the rest of the chain", async () => {
    // DELIBERATE REWRITE (round 2) of round 1's "there is no builder
    // anywhere" test. Criterion 4: when the guard is not a keyset-ref there is
    // no reference to update, so the step reports THAT specific reason —
    // reported rather than skipped, because the owner chose it, and never a
    // halt, because the payment-key rotation does not depend on it.
    const h = keysetHarness({ ref: null });

    const outcome = await runMigrationChain(KEYSET_REQUEST, h.deps);

    expect(names(h)).toEqual(["rotate-payment"]);
    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") throw new Error("unreachable");
    expect(outcome.confirmed).toEqual(["rotate-payment-key"]);
    expect(outcome.reported).toEqual([
      {
        stepId: "define-keyset",
        kind: "define-keyset",
        message: KEYSET_UPDATE_NO_REF_REASON,
      },
    ]);
    // Reported on its own row as an error, with the long reason in the row's
    // collapsible `result` field rather than its 70px caption.
    const keysetRow = h.updates.find((u) => u[1] === "error");
    expect(keysetRow?.[0]).toBe(1);
    expect((keysetRow?.[2] as { result: string }).result).toBe(KEYSET_UPDATE_NO_REF_REASON);
    expect(h.recorded).toContainEqual({
      id: "define-keyset",
      state: "pending",
      error: KEYSET_UPDATE_NO_REF_REASON,
    });
  });

  it("refuses the whole press when the keyset cannot be satisfied, and submits NOTHING", async () => {
    // WHY criterion 5, as the engine's BACKSTOP: the panel computes
    // satisfiability before the press, so the normal path is
    // press-once-and-run. But "the chain REFUSES and starts nothing" has to be
    // true literally, not merely by convention — and the refusal has to name
    // the shortfall and the alternative, because a user who is only told "no"
    // presses again.
    const h = keysetHarness({});
    const refusing: MigrationChainDeps = {
      ...h.deps,
      readPreconditionFacts: vi.fn(async () => ({
        ...HAPPY_FACTS,
        keysetUpdateSatisfiable: false,
        keysetUpdateKeyCounts: { resolved: 2, total: 9, threshold: 5 },
      })),
    };

    const outcome = await runMigrationChain(KEYSET_REQUEST, refusing);

    expect(outcome.status).toBe("refused");
    if (outcome.status !== "refused") throw new Error("unreachable");
    expect(outcome.failures.map((f) => f.code)).toEqual(["keyset-update-unsatisfiable"]);
    expect(outcome.message).toContain("2");
    expect(outcome.message).toContain("9");
    expect(outcome.message).toContain("5");
    expect(outcome.message).toMatch(/forfeit/i);
    expect(names(h)).toEqual([]);
  });

  it("does NOT refuse a forfeited press, however unsatisfiable the keyset is", async () => {
    // The other half of criterion 8: forfeiting is the way THROUGH the
    // refusal, so a forfeited press with nothing resolved must run everything
    // else. If this went red, a user whose keyset cannot be satisfied could
    // never rotate their payment key at all.
    const h = keysetHarness({});
    const deps: MigrationChainDeps = {
      ...h.deps,
      readPreconditionFacts: vi.fn(async () => ({
        ...HAPPY_FACTS,
        keysetUpdateSatisfiable: false,
      })),
    };

    const outcome = await runMigrationChain(
      {
        ...KEYSET_REQUEST,
        intent: { ...KEYSET_REQUEST.intent, keysetUpdateForfeited: true },
      },
      deps,
    );

    expect(outcome.status).toBe("completed");
    expect(names(h)).toEqual(["rotate-payment"]);
  });

  it("does not let DUST halt the chain — a sub-precision balance is reported, and F still runs", async () => {
    // WHY: predicate B is `balance > 0`, but native STOA carries 12 decimals
    // and `drainAmountForPact` REFUSES a balance that truncates to zero. A
    // crumb would otherwise select the step and then halt everything — and it
    // is the one halt re-pressing cannot clear, because the next press reads
    // the same crumb and halts again, forever, with F and G never running.
    const h = harness({
      snapshots: [
        settled({
          registeredPaymentKey: OLD,
          oldKeyStoaPerChain: { "0": 1e-15 },
          oldKeyUrStoaLiquid: 0.0004,
        }),
      ],
    });

    const outcome = await runMigrationChain(REQUEST, h.deps);

    expect(names(h)).toEqual(["rotate-payment"]);
    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") throw new Error("unreachable");
    expect(outcome.reported.map((r) => r.stepId)).toEqual(["drain-stoa", "move-urstoa"]);
    expect(outcome.reported[0].message).toMatch(/nothing transferable|truncat/i);
    expect(h.recorded).toContainEqual({
      id: "drain-stoa",
      state: "pending",
      error: expect.stringContaining("12") as unknown as string,
    });
  });

  it("reports the whole drain when there is no new payment key to drain TO, and still rotates the guard", async () => {
    // WHY: `planMigrationChain`'s fund predicates read balances only — they do
    // not know whether a new payment key was chosen. A guard-only migration
    // therefore plans a drain with no destination. Running it anyway would be
    // pointless gas (A), and actively harmful for C, which would unstake —
    // losing the staking position — to move funds nowhere.
    const h = harness({
      snapshots: [
        settled({
          oldKeyStoaPerChain: { "0": 5, "2": 2 },
          oldKeyUrStoaStaked: 10,
          registeredGuard: { keys: [...LIVE_GUARD.keys], pred: LIVE_GUARD.pred },
        }),
      ],
    });

    const outcome = await runMigrationChain(
      { ...REQUEST, intent: { ...INTENT, newPaymentPublicKey: null } },
      h.deps,
    );

    expect(names(h)).toEqual(["rotate-guard"]);
    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") throw new Error("unreachable");
    // DELIBERATE REWRITE (round 2): `"unstake-urstoa"` now precedes
    // `"drain-stoa"`, because step C's merged Collect pays out NATIVE STOA
    // and B is what moves it (`coin-live.pact:1467-1488` → `C_Transmit`,
    // `:593-598`). The LIST is the design, so it is reordered rather than
    // relaxed into a set comparison.
    expect(outcome.reported.map((r) => r.stepId)).toEqual([
      "consolidate-2",
      "unstake-urstoa",
      "drain-stoa",
    ]);
    expect(outcome.reported[0].message).toMatch(/no new payment key/i);
  });
});

describe("runMigrationChain — the recorded history is authoritative for NOTHING", () => {
  it("runs exactly the same chain whatever the recorder hands back", async () => {
    // WHY design §4, made a test: `execution.steps` is for display and support
    // only, and "no code may read it to decide what to do next". A recorder
    // that claims the drain and the guard rotation already happened must change
    // nothing at all — the engine asks the chain, and `MigrationChainDeps` has
    // no member that could even return a history.
    const control = harness();
    await runMigrationChain(REQUEST, control.deps);

    const lying = harness({
      overrides: {
        // The cast is the point: `recordStep` is declared
        // `=> void | Promise<void>`, so a recorder CANNOT hand a history back
        // through the type system at all. This forces one in anyway, to prove
        // the runtime ignores it too.
        recordStep: vi.fn(async () => [
          "drain-stoa",
          "rotate-guard",
          "unstake-urstoa",
        ]) as unknown as MigrationChainDeps["recordStep"],
      },
    });
    await runMigrationChain(REQUEST, lying.deps);

    expect(names(lying)).toEqual(names(control));
    expect(names(lying)).toContain("drain");
    expect(names(lying).at(-1)).toBe("rotate-guard");
  });
});

describe("the execute barrel", () => {
  it("re-exports the engine and every headless operation it drives", async () => {
    // WHY: T11 assembles `MigrationChainDeps` at the React boundary and needs
    // the engine AND each operation's live wiring. If the barrel forgets a
    // module, the only way to reach it is a deep relative path into another
    // package's `src/` — which is exactly what `./zbom` exists to prevent, and
    // what no `package.json` subpath may be added for (the subpath guard
    // imports from a `dist/` the test env does not build).
    const barrel = await import("../src/zbom/execute/index.js");

    expect(Object.keys(barrel)).toEqual(
      expect.arrayContaining([
        // the engine
        "runMigrationChain",
        "describeMigrationChainPlan",
        // A, B — native STOA
        "runCrossChainStoaTransfer",
        "createSignedCrossChainInitiate",
        "offsetStepReporter",
        "submitNativeStoaTransfer",
        "liveNativeStoaChainEdge",
        "drainAmountForPact",
        // C, D, E — urSTOA
        "unstakeUrStoa",
        "transferUrStoa",
        "stakeUrStoa",
        // F, G — the rotations
        "executeRotatePaymentKey",
        "executeRotateGuard",
        "collectGuardSigners",
        "liveRotatePaymentKeySubmitter",
        "liveRotateGuardSubmitter",
        // the gate and the predicate read
        "awaitTxVerdict",
        "awaitTxVerdictLiveDeps",
        "readChainState",
        "liveChainStateDeps",
      ]),
    );
  });

  it("is reachable from the `./zbom` subpath, which is how another package imports it", async () => {
    // WHY: `codex-arweave` and the playground consume this package through its
    // `exports` map, and `./zbom` is the only subpath this topic may ship
    // through. An engine that is not on that barrel is unreachable from the
    // page that presses the button.
    const zbom = await import("../src/zbom/index.js");

    expect(typeof (zbom as { runMigrationChain?: unknown }).runMigrationChain).toBe("function");
    expect(typeof (zbom as { awaitTxVerdict?: unknown }).awaitTxVerdict).toBe("function");
    // The seven lines that were already there still resolve.
    expect(typeof (zbom as { createMultiStepToast?: unknown }).createMultiStepToast).toBe(
      "function",
    );
  });
});
