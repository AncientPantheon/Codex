/**
 * migration-chain.test.ts — the MIGRATION CHAIN's brain, tested without a
 * chain.
 *
 * `docs/work/migration-execute/design.md` decided that every step of the
 * payment-key/guard migration is a PREDICATE OVER CHAIN STATE, not a position
 * in a script (§4). That decision is what makes the chain idempotent and what
 * makes crash recovery need no new UI — the user presses the same button again
 * and the engine skips whatever landed. All of it is decidable with no
 * network, so all of it is decided in `src/codex/migrationChain.ts` and pinned
 * here, exhaustively, where a case costs microseconds instead of mainnet IGNIS.
 *
 * What each group guards:
 *
 *   (ordering, as PROPERTIES over every generated snapshot) design §2's order
 *       is forced, not stylistic. `G` last because the moment it lands the
 *       signing set changes; `B` before `F` because A-E are signed by the OLD
 *       payment key that `F` re-points away from; `A(n)` before `B` because the
 *       owner chose consolidate-then-move-once. Three hand-picked examples
 *       would not catch a reorder that only shows up on the 512th subset of
 *       non-zero chains, so these are asserted over the whole product.
 *   (predicates) each step's true/false edge, including ZERO (the skip that
 *       criterion 4 names) and ABSENT (a chain the snapshot never reported).
 *   (nothing owed) an EMPTY plan, so the engine can say "nothing left to do"
 *       rather than drive an empty loop.
 *   (idempotence) the design's whole resume story: a snapshot taken AFTER a
 *       step landed must not re-emit that step. Asserted as a property, since
 *       this is the one that prevents moving money twice.
 *   (account-string conversion) `pending.paymentPublicKey` is bare 64-hex and
 *       `C_RotateStoa` wants the account-string form. Nothing in the repo
 *       converted it before; the seed-type rule lives at
 *       `codex-ouronet/src/state/store.ts:2680` and this is its only mirror.
 *   (preconditions) §5 is checked ONCE, and criterion 7 demands ONE refusal
 *       naming EVERYTHING missing — a verdict that stops at the first failure
 *       makes the user press, read, fix, press again.
 *   (aggregate gas) "nothing in the repo currently sums gas across N
 *       transactions" (§5). Only F and G cost the patron IGNIS; the `coin.*`
 *       steps are paid by the Ouronet gas station.
 *   (define-keyset) round 2's criteria 3, 4 and 8: the step is now RUNNABLE
 *       when the account's guard is a keyset-ref, and still REPORTED — never
 *       silently skipped — in the three cases it cannot run. The distinction
 *       between "its predicate is false" (absent) and "cannot be run at all"
 *       (present, `executable: false`) is still modelled as a FIELD.
 *
 * ## FOUR groups in this file were DELIBERATELY REWRITTEN in round 2
 *
 * `docs/work/migration-execute-keyset/` moved step C (the unstake) AHEAD of
 * step B (the chain-0 native drain), and made `define-keyset` executable. Both
 * are the DESIGN's call, not a casualty, and each rewritten test carries the
 * reason in its own comment. The reason for the reorder, in one sentence and
 * with its evidence:
 *
 *   **`coin.C_URV|Collect` pays out NATIVE STOA, not urSTOA.** Its body
 *   (`0_Stoa/coin-contract/coin-live.pact:1467-1488`) is `C_Transmit
 *   URV|KONTO account available-rewards`, and `C_Transmit` (`:593-598`) is
 *   `debit` + `credit` on the **coin table** — the native ledger. The urSTOA
 *   ledger's mover is `X_UR|Transfer`, which is what `C_URV|Stake:1415` and
 *   `C_URV|Unstake:1449` use. So the rewards step C now collects land in the
 *   OLD key's chain-0 NATIVE balance, which is the balance step **B** moves —
 *   not D, which moves urSTOA. With B planned before C, a press that collects
 *   left freshly-collected STOA on a key F is about to orphan.
 *
 * The four groups: the whole-chain order example, "keeps the keyset step out
 * of the drain", every `define-keyset` outcome, and the barrel's exported
 * reason names. The ordering PROPERTIES below (G last, the whole drain before
 * F, A(n) before B, C → D → E) are deliberately left UNCHANGED: they are what
 * proves the swap was safe, and a red one would mean the swap broke an
 * invariant.
 */

import { describe, it, expect } from "vitest";

import {
  planMigrationChain,
  paymentKeyAccountString,
  bareKeyOf,
  sumIgnisNeed,
  checkMigrationPreconditions,
  KEYSET_UPDATE_NO_REF_REASON,
  KEYSET_UPDATE_FORFEITED_REASON,
  KEYSET_UPDATE_NO_DEFINITION_REASON,
  STOA_CONSOLIDATION_TARGET_CHAIN,
  CONSOLIDATION_SOURCE_CHAINS,
} from "../src/codex/migrationChain.js";
import type {
  ChainStateSnapshot,
  MigrationChainIntent,
  MigrationChainStep,
} from "../src/codex/migrationChain.js";

const OLD_KEY = "a".repeat(64);
const NEW_KEY = "b".repeat(64);
const GUARD_KEY = "c".repeat(64);

/** A snapshot with nothing owed anywhere: every predicate false. */
const SETTLED: ChainStateSnapshot = {
  oldKeyStoaPerChain: {},
  oldKeyUrStoaLiquid: 0,
  oldKeyUrStoaStaked: 0,
  newKeyUrStoaLiquid: 0,
  oldKeyUrStoaEarnings: 0,
  registeredPaymentKey: `k:${NEW_KEY}`,
  registeredGuard: { keys: [GUARD_KEY], pred: "keys-all" },
  registeredKeysetRef: null,
};

/** A qualified keyset reference of the shape `resolveGuardKeys.ts:76`'s own
 *  worked example uses. The namespace matters on chain (a `ouronet-ns` keyset
 *  is protocol-guarded) but NOT here: the planner's only question is whether
 *  the account's guard names a reference at all. */
const KEYSET_REF = "free.my-keyset";

const INTENT: MigrationChainIntent = {
  newPaymentPublicKey: NEW_KEY,
  guard: { keys: [GUARD_KEY], pred: "keys-all" },
  guardSelection: "custom",
};

const snap = (over: Partial<ChainStateSnapshot> = {}): ChainStateSnapshot => ({
  ...SETTLED,
  ...over,
});
const intent = (over: Partial<MigrationChainIntent> = {}): MigrationChainIntent => ({
  ...INTENT,
  ...over,
});

const idsOf = (s: readonly MigrationChainStep[]): string[] => s.map((step) => step.id);
const has = (s: readonly MigrationChainStep[], id: string): boolean =>
  s.some((step) => step.id === id);
const indexOf = (s: readonly MigrationChainStep[], id: string): number =>
  s.findIndex((step) => step.id === id);

/**
 * Every subset of non-zero chains (2^9 = 512) crossed with the
 * staked/liquid/earnings combinations and both F/G states — the generated set
 * the plan asks the ordering, the `collectRewards` and the idempotence
 * properties to hold over.
 *
 * `earnings` is a round-2 dimension: `coin.URC_URV|ClaimableRewards` decides
 * whether step C emits the Collect expression at all, and a property claimed
 * over a set where it is always zero would be claimed vacuously.
 */
function generatedCases(): Array<{
  readonly label: string;
  readonly snapshot: ChainStateSnapshot;
  readonly intent: MigrationChainIntent;
}> {
  const out: Array<{ label: string; snapshot: ChainStateSnapshot; intent: MigrationChainIntent }> = [];
  for (let mask = 0; mask < 1024; mask += 1) {
    const perChain: Record<string, number> = {};
    for (let chain = 0; chain <= 9; chain += 1) {
      if (mask & (1 << chain)) perChain[String(chain)] = chain + 1;
    }
    for (const staked of [0, 7]) {
      for (const liquid of [0, 3]) {
        for (const newLiquid of [0, 5]) {
          for (const earnings of [0, 4]) {
            for (const payLive of [true, false]) {
              for (const guardLive of [true, false]) {
                out.push({
                  label:
                    `mask=${mask} staked=${staked} liquid=${liquid} new=${newLiquid} `
                    + `earnings=${earnings} pay=${payLive} guard=${guardLive}`,
                  snapshot: snap({
                    oldKeyStoaPerChain: perChain,
                    oldKeyUrStoaStaked: staked,
                    oldKeyUrStoaLiquid: liquid,
                    newKeyUrStoaLiquid: newLiquid,
                    oldKeyUrStoaEarnings: earnings,
                    registeredPaymentKey: payLive ? `k:${NEW_KEY}` : `k:${OLD_KEY}`,
                    registeredGuard: guardLive
                      ? { keys: [GUARD_KEY], pred: "keys-all" }
                      : { keys: [OLD_KEY], pred: "keys-all" },
                  }),
                  intent: INTENT,
                });
              }
            }
          }
        }
      }
    }
  }
  return out;
}

const CASES = generatedCases();

describe("planMigrationChain — design §2's order, as properties over every generated snapshot", () => {
  it("covers the whole product the properties are claimed over (self-check)", () => {
    // A property that holds vacuously proves nothing: confirm the generator
    // really produced every chain subset AND both states of every predicate.
    expect(CASES.length).toBe(1024 * 2 * 2 * 2 * 2 * 2 * 2);
    const plans = CASES.map((c) => planMigrationChain(c.snapshot, c.intent));
    expect(plans.some((p) => has(p.steps, "rotate-guard"))).toBe(true);
    expect(plans.some((p) => has(p.steps, "rotate-payment-key"))).toBe(true);
    expect(plans.some((p) => has(p.steps, "consolidate-9"))).toBe(true);
    expect(plans.some((p) => p.steps.length === 0)).toBe(true);
    // Round 2: both states of the earnings dimension really occur, so the
    // `collectRewards` property below is not claimed vacuously.
    const unstakes = plans.flatMap((p) => p.steps.filter((x) => x.id === "unstake-urstoa"));
    expect(unstakes.some((x) => x.collectRewards === true)).toBe(true);
    expect(unstakes.some((x) => x.collectRewards === undefined)).toBe(true);
  });

  it("NEVER emits G before any other step — the signing set changes the moment it lands", () => {
    const offenders = CASES.filter(({ snapshot, intent: i }) => {
      const steps = planMigrationChain(snapshot, i).steps;
      const g = indexOf(steps, "rotate-guard");
      return g !== -1 && g !== steps.length - 1;
    }).map((c) => c.label);
    expect(offenders).toEqual([]);
  });

  it("NEVER emits F before the drain (B) — A-E are signed by the OLD payment key F re-points away from", () => {
    const offenders = CASES.filter(({ snapshot, intent: i }) => {
      const steps = planMigrationChain(snapshot, i).steps;
      const b = indexOf(steps, "drain-stoa");
      const f = indexOf(steps, "rotate-payment-key");
      return b !== -1 && f !== -1 && b > f;
    }).map((c) => c.label);
    expect(offenders).toEqual([]);
  });

  it("NEVER emits F before ANY of A-E — the whole drain precedes the rotation", () => {
    const DRAIN = ["drain-stoa", "unstake-urstoa", "move-urstoa", "restake-urstoa"];
    const offenders = CASES.filter(({ snapshot, intent: i }) => {
      const steps = planMigrationChain(snapshot, i).steps;
      const f = indexOf(steps, "rotate-payment-key");
      if (f === -1) return false;
      const drainIds = [
        ...CONSOLIDATION_SOURCE_CHAINS.map((c) => `consolidate-${c}`),
        ...DRAIN,
      ];
      return drainIds.some((id) => {
        const at = indexOf(steps, id);
        return at !== -1 && at > f;
      });
    }).map((c) => c.label);
    expect(offenders).toEqual([]);
  });

  it("emits C BEFORE B — Collect pays out NATIVE STOA, which is the balance B moves", () => {
    // ROUND 2's reorder, as a property over the whole generated set rather
    // than one example. `coin.C_URV|Collect`'s body is `C_Transmit` on the
    // COIN TABLE (`coin-live.pact:1467-1488`, `:593-598`) — native STOA, not
    // urSTOA — so step C's rewards land in the OLD key's chain-0 native
    // balance. B is the step that moves that balance; D moves urSTOA and
    // cannot. With B before C, a press that collected stranded the fresh STOA
    // on a key F was about to orphan: the engine re-plans after every
    // confirmation but walks its toast rows ONCE, so B's row was already
    // spent by the time C produced the balance.
    const offenders = CASES.filter(({ snapshot, intent: i }) => {
      const steps = planMigrationChain(snapshot, i).steps;
      const b = indexOf(steps, "drain-stoa");
      const c = indexOf(steps, "unstake-urstoa");
      return b !== -1 && c !== -1 && c > b;
    }).map((c) => c.label);
    expect(offenders).toEqual([]);
  });

  it("emits every A(n) BEFORE B — consolidate onto chain 0, then move once", () => {
    const offenders = CASES.filter(({ snapshot, intent: i }) => {
      const steps = planMigrationChain(snapshot, i).steps;
      const b = indexOf(steps, "drain-stoa");
      if (b === -1) return false;
      return CONSOLIDATION_SOURCE_CHAINS.some((chain) => {
        const at = indexOf(steps, `consolidate-${chain}`);
        return at !== -1 && at > b;
      });
    }).map((c) => c.label);
    expect(offenders).toEqual([]);
  });

  it("keeps C → D → E in that order wherever more than one of them is emitted", () => {
    // Forced by the primitives, not chosen: executeStakeUrStoa /
    // executeUnstakeUrStoa take no destination, so moving staked urSTOA IS
    // unstake-at-source → transfer → re-stake-at-destination (design §2).
    const offenders = CASES.filter(({ snapshot, intent: i }) => {
      const steps = planMigrationChain(snapshot, i).steps;
      const present = ["unstake-urstoa", "move-urstoa", "restake-urstoa"]
        .map((id) => indexOf(steps, id))
        .filter((at) => at !== -1);
      return present.some((at, k) => k > 0 && at < present[k - 1]);
    }).map((c) => c.label);
    expect(offenders).toEqual([]);
  });

  it("emits consolidation hops in ascending chain order, 1 → 9", () => {
    const offenders = CASES.filter(({ snapshot, intent: i }) => {
      const hops = planMigrationChain(snapshot, i)
        .steps.filter((s) => s.kind === "consolidate-stoa")
        .map((s) => Number(s.chainId));
      return hops.some((n, k) => k > 0 && n <= hops[k - 1]);
    }).map((c) => c.label);
    expect(offenders).toEqual([]);
  });
});

/**
 * "That step landed": the snapshot change each confirmed step produces. The
 * design's idempotence claim IS this table — if a landed step's own predicate
 * does not go false, the next press re-sends it, and for a transfer that is
 * paying twice.
 */
function afterLanding(
  snapshot: ChainStateSnapshot,
  step: MigrationChainStep,
  i: MigrationChainIntent,
): ChainStateSnapshot {
  const zeroChain = (chainId: string): ChainStateSnapshot => ({
    ...snapshot,
    oldKeyStoaPerChain: { ...snapshot.oldKeyStoaPerChain, [chainId]: 0 },
  });
  switch (step.kind) {
    case "consolidate-stoa":
      return zeroChain(step.chainId as string);
    case "drain-stoa":
      return zeroChain(STOA_CONSOLIDATION_TARGET_CHAIN);
    case "unstake-urstoa":
      // Round 2: C is Collect + Unstake in ONE transaction, so it empties the
      // claimable rewards as well as the stake (`XI_URV|ResetPendingRewards`,
      // `coin-live.pact:1477`).
      return { ...snapshot, oldKeyUrStoaStaked: 0, oldKeyUrStoaEarnings: 0 };
    case "move-urstoa":
      return { ...snapshot, oldKeyUrStoaLiquid: 0 };
    case "restake-urstoa":
      return { ...snapshot, newKeyUrStoaLiquid: 0 };
    case "rotate-payment-key":
      return { ...snapshot, registeredPaymentKey: `k:${i.newPaymentPublicKey}` };
    case "rotate-guard":
      return { ...snapshot, registeredGuard: i.guard };
    default:
      return snapshot;
  }
}

describe("planMigrationChain — idempotence, the design's resume decision", () => {
  it("drops EXACTLY the landed step from the next plan, and keeps every other one", () => {
    // Property over the whole generated product: for every case and every step
    // it emits, a snapshot reflecting that step having confirmed re-plans to
    // the same list minus that step. This is what makes re-pressing the button
    // the recovery path (design §4) instead of a double-spend.
    const offenders: string[] = [];
    for (const { label, snapshot, intent: i } of CASES) {
      const before = planMigrationChain(snapshot, i).steps;
      for (const step of before) {
        if (!step.executable) continue;
        const next = planMigrationChain(afterLanding(snapshot, step, i), i).steps;
        const expected = idsOf(before).filter((id) => id !== step.id);
        if (idsOf(next).join(",") !== expected.join(",")) {
          offenders.push(`${label} / ${step.id} → ${idsOf(next).join(",")}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("is deterministic — the same snapshot always plans the same chain", () => {
    const offenders = CASES.filter(({ snapshot, intent: i }) => {
      const a = idsOf(planMigrationChain(snapshot, i).steps);
      const b = idsOf(planMigrationChain(snapshot, i).steps);
      return a.join(",") !== b.join(",");
    }).map((c) => c.label);
    expect(offenders).toEqual([]);
  });

  it("re-plans to NOTHING once the whole chain has landed", () => {
    const owing = snap({
      oldKeyStoaPerChain: { "0": 1, "4": 2 },
      oldKeyUrStoaStaked: 3,
      oldKeyUrStoaLiquid: 4,
      newKeyUrStoaLiquid: 5,
      registeredPaymentKey: `k:${OLD_KEY}`,
      registeredGuard: { keys: [OLD_KEY], pred: "keys-all" },
    });
    expect(planMigrationChain(owing, INTENT).steps.length).toBe(7);
    let landed = owing;
    for (const step of planMigrationChain(owing, INTENT).steps) {
      landed = afterLanding(landed, step, INTENT);
    }
    expect(planMigrationChain(landed, INTENT).steps).toEqual([]);
  });

  it("drops ONLY the landed hop when one consolidation of several has confirmed", () => {
    const owing = snap({ oldKeyStoaPerChain: { "3": 5, "7": 9 } });
    expect(idsOf(planMigrationChain(owing, INTENT).steps)).toEqual([
      "consolidate-3",
      "consolidate-7",
    ]);
    const afterThree = snap({ oldKeyStoaPerChain: { "3": 0, "7": 9 } });
    expect(idsOf(planMigrationChain(afterThree, INTENT).steps)).toEqual(["consolidate-7"]);
  });

  it("plans nothing at all when nothing is owed, and says so", () => {
    const plan = planMigrationChain(SETTLED, INTENT);
    expect(plan.steps).toEqual([]);
    expect(plan.nothingToDo).toBe(true);
  });
});

describe("planMigrationChain — A(n): consolidate chains 1-9, skip zero balances", () => {
  it("emits one hop per chain 1-9 with a positive balance, carrying chain and amount", () => {
    const plan = planMigrationChain(snap({ oldKeyStoaPerChain: { "2": 1.5, "5": 40 } }), INTENT);
    expect(plan.steps.map((s) => [s.id, s.kind, s.chainId, s.amount])).toEqual([
      ["consolidate-2", "consolidate-stoa", "2", 1.5],
      ["consolidate-5", "consolidate-stoa", "5", 40],
    ]);
    expect(plan.steps.every((s) => s.executable)).toBe(true);
  });

  it("skips a chain reporting exactly 0 and a chain the snapshot never reported (criterion 4)", () => {
    const plan = planMigrationChain(snap({ oldKeyStoaPerChain: { "4": 0 } }), INTENT);
    expect(plan.steps).toEqual([]);
  });

  it("never consolidates chain 0 onto itself — chain 0 is the destination, drained by B", () => {
    const plan = planMigrationChain(snap({ oldKeyStoaPerChain: { "0": 12 } }), INTENT);
    expect(idsOf(plan.steps)).toEqual(["drain-stoa"]);
    expect(STOA_CONSOLIDATION_TARGET_CHAIN).toBe("0");
    expect(CONSOLIDATION_SOURCE_CHAINS).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  });

  it("treats a negative or non-finite reported balance as nothing to move", () => {
    // `coerce` in the balance reads can yield surprises; a bad number must not
    // become a transfer of NaN STOA.
    const plan = planMigrationChain(
      snap({ oldKeyStoaPerChain: { "1": -1, "2": Number.NaN, "3": 2 } }),
      INTENT,
    );
    expect(idsOf(plan.steps)).toEqual(["consolidate-3"]);
  });
});

describe("planMigrationChain — B, C, D, E: the drain predicates", () => {
  it("emits B for a positive chain-0 balance, with chain 0 and the amount", () => {
    const plan = planMigrationChain(snap({ oldKeyStoaPerChain: { "0": 8.25 } }), INTENT);
    expect(plan.steps).toEqual([
      { id: "drain-stoa", kind: "drain-stoa", chainId: "0", amount: 8.25, executable: true },
    ]);
  });

  it("skips B on a zero chain-0 balance and on an unreported chain 0", () => {
    expect(planMigrationChain(snap({ oldKeyStoaPerChain: { "0": 0 } }), INTENT).steps).toEqual([]);
    expect(planMigrationChain(snap({ oldKeyStoaPerChain: {} }), INTENT).steps).toEqual([]);
  });

  it("emits C only when the OLD key has staked urSTOA, carrying the staked amount", () => {
    expect(
      planMigrationChain(snap({ oldKeyUrStoaStaked: 11 }), INTENT).steps,
    ).toEqual([
      { id: "unstake-urstoa", kind: "unstake-urstoa", chainId: "0", amount: 11, executable: true },
    ]);
    expect(planMigrationChain(snap({ oldKeyUrStoaStaked: 0 }), INTENT).steps).toEqual([]);
  });

  it("emits D only when the OLD key has LIQUID urSTOA, carrying the liquid amount", () => {
    expect(planMigrationChain(snap({ oldKeyUrStoaLiquid: 2.5 }), INTENT).steps).toEqual([
      { id: "move-urstoa", kind: "move-urstoa", chainId: "0", amount: 2.5, executable: true },
    ]);
    expect(planMigrationChain(snap({ oldKeyUrStoaLiquid: 0 }), INTENT).steps).toEqual([]);
  });

  it("emits E only when the NEW key has liquid urSTOA to re-stake", () => {
    expect(planMigrationChain(snap({ newKeyUrStoaLiquid: 6 }), INTENT).steps).toEqual([
      { id: "restake-urstoa", kind: "restake-urstoa", chainId: "0", amount: 6, executable: true },
    ]);
    expect(planMigrationChain(snap({ newKeyUrStoaLiquid: 0 }), INTENT).steps).toEqual([]);
  });

  it("emits C, D and E in that order when all three are owed", () => {
    const plan = planMigrationChain(
      snap({ oldKeyUrStoaStaked: 4, oldKeyUrStoaLiquid: 1, newKeyUrStoaLiquid: 2 }),
      INTENT,
    );
    expect(idsOf(plan.steps)).toEqual(["unstake-urstoa", "move-urstoa", "restake-urstoa"]);
  });
});

describe("planMigrationChain — F: the payment-key predicate, across both address forms", () => {
  it("emits F when the registered payment key is a DIFFERENT key", () => {
    const plan = planMigrationChain(snap({ registeredPaymentKey: `k:${OLD_KEY}` }), INTENT);
    expect(plan.steps).toEqual([
      { id: "rotate-payment-key", kind: "rotate-payment-key", chainId: "0", executable: true },
    ]);
  });

  it("skips F when the chosen key is already in force as `k:<pub>`", () => {
    expect(planMigrationChain(snap({ registeredPaymentKey: `k:${NEW_KEY}` }), INTENT).steps).toEqual([]);
  });

  it("skips F when the chosen key is already in force in BARE (stoic) form", () => {
    // `store.ts:2680`'s stoic branch writes the key with no `k:` prefix, so a
    // bare-vs-prefixed mismatch must not read as an outstanding rotation.
    expect(planMigrationChain(snap({ registeredPaymentKey: NEW_KEY }), INTENT).steps).toEqual([]);
  });

  it("emits F when the account has NO registered payment key at all", () => {
    expect(idsOf(planMigrationChain(snap({ registeredPaymentKey: null }), INTENT).steps)).toEqual([
      "rotate-payment-key",
    ]);
  });

  it("emits no F when the intent names no payment key — nothing was chosen", () => {
    const plan = planMigrationChain(
      snap({ registeredPaymentKey: `k:${OLD_KEY}` }),
      intent({ newPaymentPublicKey: null }),
    );
    expect(plan.steps).toEqual([]);
  });
});

describe("planMigrationChain — G: the guard predicate, set equality plus pred", () => {
  it("emits G when the on-chain guard holds different keys", () => {
    const plan = planMigrationChain(
      snap({ registeredGuard: { keys: [OLD_KEY], pred: "keys-all" } }),
      INTENT,
    );
    expect(plan.steps).toEqual([
      { id: "rotate-guard", kind: "rotate-guard", chainId: "0", executable: true },
    ]);
  });

  it("emits G when the keys match but the PREDICATE differs", () => {
    const plan = planMigrationChain(
      snap({ registeredGuard: { keys: [GUARD_KEY], pred: "keys-any" } }),
      INTENT,
    );
    expect(idsOf(plan.steps)).toEqual(["rotate-guard"]);
  });

  it("skips G when the same keys are in force in a DIFFERENT ORDER — order is not a change", () => {
    // The rule `outstandingKeyChanges.ts:42-46` already encodes: set equality,
    // so key order never makes an unchanged guard look pending.
    const plan = planMigrationChain(
      snap({ registeredGuard: { keys: [GUARD_KEY, OLD_KEY], pred: "keys-all" } }),
      intent({ guard: { keys: [OLD_KEY, GUARD_KEY], pred: "keys-all" } }),
    );
    expect(plan.steps).toEqual([]);
  });

  it("emits G when the account has NO guard on chain", () => {
    expect(idsOf(planMigrationChain(snap({ registeredGuard: null }), INTENT).steps)).toEqual([
      "rotate-guard",
    ]);
  });

  it("emits no G when the intent keeps the guard (null) or resolved to no keys", () => {
    const kept = planMigrationChain(snap({ registeredGuard: null }), intent({ guard: null }));
    expect(kept.steps).toEqual([]);
    const empty = planMigrationChain(
      snap({ registeredGuard: null }),
      intent({ guard: { keys: [], pred: "keys-all" } }),
    );
    expect(empty.steps).toEqual([]);
  });
});

describe("planMigrationChain — collectRewards: step C merges Collect into the unstake", () => {
  it("sets collectRewards iff the earnings are movable, and ONLY on the unstake step", () => {
    // WHY this is a property and not an example: `coin.C_URV|Collect` goes
    // through `debit`, which enforces `(> amount 0.0)`
    // (`coin-live.pact:708-721`, `:414-418`). A Collect emitted with ZERO
    // claimable rewards therefore FAILS THE WHOLE TRANSACTION and takes the
    // unstake down with it — so the flag must be exactly as true as the
    // earnings are, over every snapshot, not merely on a happy one. And it
    // must appear on no other step: the only merged transaction is C.
    const offenders: string[] = [];
    for (const { label, snapshot, intent: i } of CASES) {
      const steps = planMigrationChain(snapshot, i).steps;
      const wanted = snapshot.oldKeyUrStoaEarnings > 0;
      for (const step of steps) {
        if (step.id === "unstake-urstoa") {
          if (step.collectRewards !== (wanted ? true : undefined)) {
            offenders.push(`${label} / C.collectRewards=${String(step.collectRewards)}`);
          }
        } else if (step.collectRewards !== undefined) {
          offenders.push(`${label} / ${step.id}.collectRewards=${String(step.collectRewards)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("omits collectRewards for a NaN or negative earnings figure", () => {
    // The Pact decimal coercions can produce either, and neither is a
    // collectable reward — `movable` is the one rule, reused.
    for (const earnings of [Number.NaN, -1, 0]) {
      const steps = planMigrationChain(
        snap({ oldKeyUrStoaStaked: 5, oldKeyUrStoaEarnings: earnings }),
        INTENT,
      ).steps;
      expect(idsOf(steps)).toEqual(["unstake-urstoa"]);
      expect(steps[0].collectRewards).toBeUndefined();
    }
  });

  it("plans NO step for earnings alone — Collect rides on C, it is not a step of its own", () => {
    // Collect takes no amount and has no step id: it is an expression merged
    // into C's transaction. Earnings with nothing staked means C's predicate
    // is false, so there is no transaction to merge it into and the next
    // press (after a stake) picks it up.
    const plan = planMigrationChain(snap({ oldKeyUrStoaEarnings: 9 }), INTENT);
    expect(plan.steps).toEqual([]);
    expect(plan.nothingToDo).toBe(true);
  });

  it("carries no AMOUNT for the collect — the step's amount is still the STAKE", () => {
    // `C_URV|Collect` takes only the account: it pays out whatever is
    // claimable at EXECUTION time, so a recorded figure would be a guess the
    // chain overrides. The step's `amount` stays the unstake amount, read
    // from `UR_URV|UserSupply`, which `Collect` provably does not touch — it
    // never calls `XI_URV|UpdateUserScore` (`coin-live.pact:1609-1625`), the
    // only writer of the `user-supply` field (`:1300-1307`).
    const steps = planMigrationChain(
      snap({ oldKeyUrStoaStaked: 12.5, oldKeyUrStoaEarnings: 3 }),
      INTENT,
    ).steps;
    expect(steps[0].amount).toBe(12.5);
    expect(steps[0].collectRewards).toBe(true);
  });
});

describe("planMigrationChain — define-keyset: a THREE-way decision, and runnable (criteria 3, 4, 8)", () => {
  // DELIBERATE REWRITE (round 2). This group previously pinned ONE outcome:
  // `executable: false` with `DEFINE_KEYSET_NOT_EXECUTABLE_REASON`. Four of
  // that reason's five clauses are now false — there IS a builder, it IS
  // executed, and the recorded choice DOES yield a target, because
  // `getKadenaAccountGuard` already annotates an expanded keyset-ref guard
  // with `keysetRef: "<ns>.<ksn>"` and `keysetRefNameOf`
  // (`codex-ouronet/src/guards/resolveGuardKeys.ts:93-105`) reads it out of
  // either real-world spelling. So the design replaced the single outcome
  // with a decision, and the constant with reason-specific ones.
  for (const kind of ["update-keyset-recommended", "update-keyset-custom"] as const) {
    it(`reports a NON-executable define-keyset step for "${kind}" when the guard is not a keyset-ref`, () => {
      // Criterion 4, exactly: "when the guard is not a keyset-ref, the step
      // reports non-executable with that specific reason". There is no
      // reference to update, so there is nothing to run — and the step is
      // still PRESENT, because the user chose it and must be told.
      const plan = planMigrationChain(
        snap({
          registeredGuard: { keys: [OLD_KEY], pred: "keys-all" },
          registeredKeysetRef: null,
        }),
        intent({ guardSelection: kind }),
      );
      const step = plan.steps.find((s) => s.id === "define-keyset");
      expect(step).toBeDefined();
      expect(step?.kind).toBe("define-keyset");
      expect(step?.executable).toBe(false);
      expect(step?.notExecutableReason).toBe(KEYSET_UPDATE_NO_REF_REASON);
      expect(step?.keysetRef).toBeUndefined();
    });

    it(`reports a NON-executable define-keyset step for "${kind}" when the owner FORFEITED it`, () => {
      // Criterion 8: "forfeit proceeds with every other step and is reported,
      // not an error". It travels on the INTENT, per press, and the step is
      // emitted non-executable so the engine's existing report-and-continue
      // branch covers it with no new engine path.
      const plan = planMigrationChain(
        snap({
          registeredGuard: { keys: [OLD_KEY], pred: "keys-all" },
          registeredKeysetRef: KEYSET_REF,
        }),
        intent({ guardSelection: kind, keysetUpdateForfeited: true }),
      );
      const step = plan.steps.find((s) => s.id === "define-keyset");
      expect(step?.executable).toBe(false);
      expect(step?.notExecutableReason).toBe(KEYSET_UPDATE_FORFEITED_REASON);
      // The reference is NOT carried on a forfeited step: nothing may submit
      // it, and a target on a step that must not run is an invitation.
      expect(step?.keysetRef).toBeUndefined();
    });

    it(`reports a NON-executable define-keyset step for "${kind}" when no new definition resolved`, () => {
      // The new definition IS the chosen guard — `(read-keyset "ks")` carries
      // `{ keys, pred }`. With no keys there is nothing to define, and an
      // executable step here would submit an EMPTY keyset and lock the
      // reference out of its own owner's reach. Same gate G already applies
      // to itself (`chosenGuard.keys.length > 0`), stated for this step too.
      const plan = planMigrationChain(
        snap({
          registeredGuard: { keys: [OLD_KEY], pred: "keys-all" },
          registeredKeysetRef: KEYSET_REF,
        }),
        intent({ guardSelection: kind, guard: null }),
      );
      const step = plan.steps.find((s) => s.id === "define-keyset");
      expect(step?.executable).toBe(false);
      expect(step?.notExecutableReason).toBe(KEYSET_UPDATE_NO_DEFINITION_REASON);
      expect(step?.keysetRef).toBeUndefined();

      const empty = planMigrationChain(
        snap({ registeredKeysetRef: KEYSET_REF }),
        intent({ guardSelection: kind, guard: { keys: [], pred: "keys-all" } }),
      );
      expect(empty.steps.find((x) => x.id === "define-keyset")?.notExecutableReason).toBe(
        KEYSET_UPDATE_NO_DEFINITION_REASON,
      );
    });

    it(`treats a MISSING or empty reference as "no keyset-ref" for "${kind}", not as a target`, () => {
      // WHY this is tested past the edge of the type system: the snapshot is
      // produced by a chain READ, and the direction a half-built or
      // partially-decoded one fails in decides whether the engine submits a
      // `define-keyset` against a reference that does not exist. `=== null`
      // alone would let `undefined` and `""` through to the executable branch
      // and hand the submitter an empty target.
      for (const ref of [undefined, "", null]) {
        const plan = planMigrationChain(
          snap({ registeredKeysetRef: ref as unknown as string | null }),
          intent({ guardSelection: kind }),
        );
        const step = plan.steps.find((x) => x.id === "define-keyset");
        expect(step?.executable).toBe(false);
        expect(step?.notExecutableReason).toBe(KEYSET_UPDATE_NO_REF_REASON);
        expect(step?.keysetRef).toBeUndefined();
      }
    });

    it(`emits an EXECUTABLE define-keyset step for "${kind}", carrying the live reference`, () => {
      // Criterion 3. The target needs no new read and no new recorded field:
      // the reference name comes out of the SAME selector read the snapshot
      // already performs.
      const plan = planMigrationChain(
        snap({
          registeredGuard: { keys: [OLD_KEY], pred: "keys-all" },
          registeredKeysetRef: KEYSET_REF,
        }),
        intent({ guardSelection: kind }),
      );
      const step = plan.steps.find((s) => s.id === "define-keyset");
      expect(step?.executable).toBe(true);
      expect(step?.keysetRef).toBe(KEYSET_REF);
      expect(step?.notExecutableReason).toBeUndefined();
      expect(step?.chainId).toBe(STOA_CONSOLIDATION_TARGET_CHAIN);
    });

    it(`keeps the step LAST-but-one and G suppressed in all three outcomes for "${kind}"`, () => {
      // The suppression of G is NOT affected by the step becoming runnable:
      // "update what the reference resolves to" is still not an account-guard
      // rotation. And the step still sits BEFORE G's slot, because a keyset
      // update must be satisfied by the CURRENT keyset and G is what changes
      // the signing set.
      const variants = [
        snap({ registeredKeysetRef: null }),
        snap({ registeredKeysetRef: KEYSET_REF }),
      ];
      for (const snapshot of variants) {
        for (const forfeited of [true, false]) {
          const steps = planMigrationChain(
            snapshot,
            intent({ guardSelection: kind, keysetUpdateForfeited: forfeited }),
          ).steps;
          expect(has(steps, "rotate-guard")).toBe(false);
          expect(idsOf(steps).at(-1)).toBe("define-keyset");
        }
      }
    });

    it(`does NOT rotate the account guard for "${kind}" — that is a different operation`, () => {
      // `outstandingKeyChanges.ts:60-72` states the reason: an
      // "update the referenced keyset's own definition" choice is not an
      // account-guard rotation, and performing one would be the wrong tx.
      const plan = planMigrationChain(
        snap({
          registeredGuard: { keys: [OLD_KEY], pred: "keys-all" },
          registeredKeysetRef: KEYSET_REF,
        }),
        intent({ guardSelection: kind }),
      );
      expect(has(plan.steps, "rotate-guard")).toBe(false);
      expect(plan.nothingToDo).toBe(false);
    });
  }

  it('emits NO define-keyset step for "use-existing-keyset" — that one is a real rotation', () => {
    // Asserted WITH a live reference present, so the absence is the selection
    // kind's doing and not an accident of the fixture: "point the account's
    // guard at an existing keyset" IS a `C_RotateGuard`, not a redefinition.
    const plan = planMigrationChain(
      snap({
        registeredGuard: { keys: [OLD_KEY], pred: "keys-all" },
        registeredKeysetRef: KEYSET_REF,
      }),
      intent({ guardSelection: "use-existing-keyset" }),
    );
    expect(has(plan.steps, "define-keyset")).toBe(false);
    expect(idsOf(plan.steps)).toEqual(["rotate-guard"]);
  });

  it("emits no define-keyset step when the intent records no guard selection", () => {
    // Again with a reference present: a keyset-ref account that chose NO
    // guard change must not be handed a keyset update it never asked for.
    const plan = planMigrationChain(
      snap({ registeredKeysetRef: KEYSET_REF }),
      intent({ guardSelection: undefined }),
    );
    expect(has(plan.steps, "define-keyset")).toBe(false);
  });

  it("ignores a forfeit flag entirely when no keyset update was selected", () => {
    // `keysetUpdateForfeited` is per-press state lifted out of the gate. It
    // must not conjure a step, or suppress one, for any other selection.
    const forfeited = planMigrationChain(
      snap({
        registeredGuard: { keys: [OLD_KEY], pred: "keys-all" },
        registeredKeysetRef: KEYSET_REF,
      }),
      intent({ guardSelection: "custom", keysetUpdateForfeited: true }),
    );
    expect(idsOf(forfeited.steps)).toEqual(["rotate-guard"]);
  });

  it("keeps the keyset step out of the drain — it sits with the guard work, at the end", () => {
    // DELIBERATE REWRITE (round 2), twice over. The expected list is
    // order-sensitive and the fixture has a chain-0 balance, so the C-before-B
    // reorder shows up here even though nothing is staked; and the step now
    // asserts its specific non-executable reason, because this fixture's
    // `registeredKeysetRef` is `null`. Reorder reason: Collect pays NATIVE
    // STOA (`coin-live.pact:1467-1488` → `C_Transmit`, `:593-598`), the
    // balance B moves.
    const plan = planMigrationChain(
      snap({
        oldKeyStoaPerChain: { "0": 3, "2": 1 },
        oldKeyUrStoaStaked: 4,
        registeredPaymentKey: `k:${OLD_KEY}`,
      }),
      intent({ guardSelection: "update-keyset-custom" }),
    );
    expect(idsOf(plan.steps)).toEqual([
      "consolidate-2",
      "unstake-urstoa",
      "drain-stoa",
      "rotate-payment-key",
      "define-keyset",
    ]);
    const keyset = plan.steps.at(-1);
    expect(keyset?.executable).toBe(false);
    expect(keyset?.notExecutableReason).toBe(KEYSET_UPDATE_NO_REF_REASON);
  });

  it("gives each of the three reasons words the owner can act on", () => {
    // Criterion 4 asks for "that specific reason", and criterion 8 for a
    // forfeit that reads as a decision rather than a failure. Asserted on the
    // CONTENT, because an exported constant that says nothing useful passes
    // every identity check above.
    expect(KEYSET_UPDATE_NO_REF_REASON).toMatch(/keyset[- ]ref/i);
    expect(KEYSET_UPDATE_FORFEITED_REASON).toMatch(/forfeit/i);
    expect(KEYSET_UPDATE_NO_DEFINITION_REASON).toMatch(/no keys|no new/i);
    // Each one names the step, so a toast row quoting it is self-describing.
    for (const reason of [
      KEYSET_UPDATE_NO_REF_REASON,
      KEYSET_UPDATE_FORFEITED_REASON,
      KEYSET_UPDATE_NO_DEFINITION_REASON,
    ]) {
      expect(reason).toContain("keyset");
      expect(reason.length).toBeGreaterThan(40);
    }
    // And none of them repeats the four claims round 2 disproved.
    for (const reason of [KEYSET_UPDATE_NO_REF_REASON, KEYSET_UPDATE_FORFEITED_REASON]) {
      expect(reason).not.toMatch(/no builder|gas station cannot pay/i);
    }
  });
});

describe("planMigrationChain — the whole chain, in design §2's order as round 2 reordered it", () => {
  it("plans A(1..9), C, B, D, E, F, G in exactly that order when everything is owed", () => {
    // DELIBERATE REWRITE (round 2), title included. `"drain-stoa"` and
    // `"unstake-urstoa"` have SWAPPED, and that is the design's call, not a
    // casualty. Evidence: `coin.C_URV|Collect`
    // (`0_Stoa/coin-contract/coin-live.pact:1467-1488`) pays out with
    // `C_Transmit` (`:593-598`) — `debit` + `credit` on the COIN TABLE, i.e.
    // NATIVE STOA. The urSTOA ledger's mover is `X_UR|Transfer`
    // (`C_URV|Stake:1415`, `C_URV|Unstake:1449`). So the rewards C collects
    // land in the OLD key's chain-0 NATIVE balance, which only B moves — D
    // moves urSTOA. B before C stranded them on a key F then orphaned.
    const perChain: Record<string, number> = {};
    for (let chain = 0; chain <= 9; chain += 1) perChain[String(chain)] = chain + 1;
    const plan = planMigrationChain(
      snap({
        oldKeyStoaPerChain: perChain,
        oldKeyUrStoaStaked: 10,
        oldKeyUrStoaLiquid: 5,
        newKeyUrStoaLiquid: 2,
        oldKeyUrStoaEarnings: 1,
        registeredPaymentKey: `k:${OLD_KEY}`,
        registeredGuard: { keys: [OLD_KEY], pred: "keys-all" },
      }),
      INTENT,
    );
    expect(idsOf(plan.steps)).toEqual([
      "consolidate-1",
      "consolidate-2",
      "consolidate-3",
      "consolidate-4",
      "consolidate-5",
      "consolidate-6",
      "consolidate-7",
      "consolidate-8",
      "consolidate-9",
      "unstake-urstoa",
      "drain-stoa",
      "move-urstoa",
      "restake-urstoa",
      "rotate-payment-key",
      "rotate-guard",
    ]);
    expect(plan.nothingToDo).toBe(false);
    // The merged Collect rides on C, and B is downstream of it.
    expect(plan.steps[9].collectRewards).toBe(true);
  });

  it("gives every step a chainId the engine can confirm against", () => {
    const plan = planMigrationChain(
      snap({
        oldKeyStoaPerChain: { "0": 1, "6": 2 },
        oldKeyUrStoaStaked: 1,
        registeredPaymentKey: null,
        registeredGuard: null,
      }),
      INTENT,
    );
    expect(plan.steps.every((s) => typeof s.chainId === "string" && s.chainId.length > 0)).toBe(true);
  });
});

describe("paymentKeyAccountString / bareKeyOf — the §5 conversion nothing else performs", () => {
  it('leaves a "stoic" seed\'s key BARE, mirroring store.ts:2680', () => {
    expect(paymentKeyAccountString(NEW_KEY, "stoic")).toBe(NEW_KEY);
  });

  it('prefixes "k:" for every non-stoic seed type', () => {
    expect(paymentKeyAccountString(NEW_KEY, "koala")).toBe(`k:${NEW_KEY}`);
    expect(paymentKeyAccountString(NEW_KEY, "chainweaver")).toBe(`k:${NEW_KEY}`);
    expect(paymentKeyAccountString(NEW_KEY, "eckowallet")).toBe(`k:${NEW_KEY}`);
    expect(paymentKeyAccountString(NEW_KEY, undefined)).toBe(`k:${NEW_KEY}`);
    expect(paymentKeyAccountString(NEW_KEY, null)).toBe(`k:${NEW_KEY}`);
  });

  it("never double-prefixes a key that already arrives in account-string form", () => {
    expect(paymentKeyAccountString(`k:${NEW_KEY}`, "koala")).toBe(`k:${NEW_KEY}`);
  });

  it("strips a leading k: and leaves a bare key untouched", () => {
    expect(bareKeyOf(`k:${NEW_KEY}`)).toBe(NEW_KEY);
    expect(bareKeyOf(NEW_KEY)).toBe(NEW_KEY);
    expect(bareKeyOf(null)).toBe(null);
    expect(bareKeyOf("")).toBe(null);
  });

  it("round-trips both forms", () => {
    expect(bareKeyOf(paymentKeyAccountString(NEW_KEY, "stoic"))).toBe(NEW_KEY);
    expect(bareKeyOf(paymentKeyAccountString(NEW_KEY, "koala"))).toBe(NEW_KEY);
  });
});

describe("sumIgnisNeed — aggregate gas across N transactions", () => {
  const COSTS = { rotatePaymentKey: 1.5, rotateGuard: 2.25 };

  it("sums F and G only — the coin.* steps are paid by the Ouronet gas station", () => {
    const plan = planMigrationChain(
      snap({
        oldKeyStoaPerChain: { "0": 1, "1": 1, "2": 1 },
        oldKeyUrStoaStaked: 1,
        oldKeyUrStoaLiquid: 1,
        newKeyUrStoaLiquid: 1,
        registeredPaymentKey: `k:${OLD_KEY}`,
        registeredGuard: { keys: [OLD_KEY], pred: "keys-all" },
      }),
      INTENT,
    );
    expect(sumIgnisNeed(plan.steps, COSTS)).toBe(3.75);
  });

  it("charges nothing for a plan of coin.* steps alone", () => {
    const plan = planMigrationChain(
      snap({ oldKeyStoaPerChain: { "0": 1, "1": 1 }, oldKeyUrStoaLiquid: 2 }),
      INTENT,
    );
    expect(plan.steps.length).toBe(3);
    expect(sumIgnisNeed(plan.steps, COSTS)).toBe(0);
  });

  it("charges each rotation exactly once", () => {
    const onlyF = planMigrationChain(snap({ registeredPaymentKey: null }), INTENT).steps;
    expect(sumIgnisNeed(onlyF, COSTS)).toBe(1.5);
    const onlyG = planMigrationChain(snap({ registeredGuard: null }), INTENT).steps;
    expect(sumIgnisNeed(onlyG, COSTS)).toBe(2.25);
  });

  it("charges nothing for the non-executable define-keyset step — it is never submitted", () => {
    const plan = planMigrationChain(
      snap({ registeredGuard: { keys: [OLD_KEY], pred: "keys-all" } }),
      intent({ guardSelection: "update-keyset-custom" }),
    );
    expect(idsOf(plan.steps)).toEqual(["define-keyset"]);
    expect(sumIgnisNeed(plan.steps, COSTS)).toBe(0);
  });

  it("charges NO patron IGNIS for an EXECUTABLE define-keyset either — its gas is self-paid STOA", () => {
    // Round 2's gas finding: `DALOS.GAS_PAYER`
    // (`1_SOVEREIGN/STAGE_01/2_Core/01_DALOS.pact:456-526`) accepts exactly
    // three transaction shapes, and `(define-keyset "<ns>.<ksn>" (read-keyset
    // "ks"))` matches none of them. So this step is NOT gas-station
    // sponsored, and it is NOT a patron-IGNIS `C_*` call either: it is an
    // ordinary self-paid transaction. Adding it to the patron's IGNIS sum
    // would refuse chains for gas the patron never spends.
    const plan = planMigrationChain(
      snap({
        registeredGuard: { keys: [OLD_KEY], pred: "keys-all" },
        registeredKeysetRef: KEYSET_REF,
      }),
      intent({ guardSelection: "update-keyset-custom" }),
    );
    expect(plan.steps.at(-1)?.executable).toBe(true);
    expect(sumIgnisNeed(plan.steps, COSTS)).toBe(0);
  });

  it("sums an empty plan to zero", () => {
    expect(sumIgnisNeed([], COSTS)).toBe(0);
  });
});

describe("checkMigrationPreconditions — ONE refusal naming EVERYTHING missing (criterion 7)", () => {
  const FULL_PLAN = planMigrationChain(
    snap({
      oldKeyStoaPerChain: { "0": 1, "3": 1 },
      oldKeyUrStoaStaked: 1,
      registeredPaymentKey: `k:${OLD_KEY}`,
      registeredGuard: { keys: [OLD_KEY], pred: "keys-all" },
    }),
    INTENT,
  ).steps;

  const OK_INPUTS = {
    steps: FULL_PLAN,
    oldPaymentKeypairPresent: true,
    chosenGuardKeysResolved: true,
    currentGuardSatisfiable: true,
    keysetUpdateSatisfiable: true,
    patronIgnisBalance: 10,
    ignisCosts: { rotatePaymentKey: 1, rotateGuard: 2 },
  };

  /** An EXECUTABLE `define-keyset` plan — the only shape the keyset
   *  precondition applies to. */
  const keysetPlan = (over: Partial<MigrationChainIntent> = {}) =>
    planMigrationChain(
      snap({
        registeredGuard: { keys: [OLD_KEY], pred: "keys-all" },
        registeredKeysetRef: KEYSET_REF,
      }),
      intent({ guardSelection: "update-keyset-custom", ...over }),
    ).steps;

  it("passes when every precondition holds, and names nothing", () => {
    const verdict = checkMigrationPreconditions(OK_INPUTS);
    expect(verdict.ok).toBe(true);
    expect(verdict.failures).toEqual([]);
    expect(verdict.message).toBe("");
  });

  it("names THREE simultaneous failures in ONE message rather than stopping at the first", () => {
    // The whole point of §5: a user who presses, reads, fixes and presses again
    // for each separate missing thing is the bug this function exists to stop.
    const verdict = checkMigrationPreconditions({
      ...OK_INPUTS,
      oldPaymentKeypairPresent: false,
      chosenGuardKeysResolved: false,
      patronIgnisBalance: 0.5,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.map((f) => f.code)).toEqual([
      "old-payment-keypair-missing",
      "guard-keys-unresolved",
      "insufficient-ignis",
    ]);
    expect(verdict.message).toContain("payment key");
    expect(verdict.message).toContain("guard");
    expect(verdict.message).toContain("IGNIS");
  });

  it("names all FOUR when the current guard is unsatisfiable too", () => {
    const verdict = checkMigrationPreconditions({
      ...OK_INPUTS,
      oldPaymentKeypairPresent: false,
      chosenGuardKeysResolved: false,
      currentGuardSatisfiable: false,
      patronIgnisBalance: null,
    });
    expect(verdict.failures.map((f) => f.code)).toEqual([
      "old-payment-keypair-missing",
      "guard-keys-unresolved",
      "current-guard-unsatisfiable",
      "insufficient-ignis",
    ]);
  });

  it("requires the OLD payment keypair only when a step is signed by it (A-E)", () => {
    const guardOnly = planMigrationChain(snap({ registeredGuard: null }), INTENT).steps;
    expect(idsOf(guardOnly)).toEqual(["rotate-guard"]);
    const verdict = checkMigrationPreconditions({
      ...OK_INPUTS,
      steps: guardOnly,
      oldPaymentKeypairPresent: false,
    });
    expect(verdict.ok).toBe(true);
  });

  it("refuses when the old payment keypair is missing and ANY of A-E is planned, one at a time", () => {
    // Each of A-E is signed by the old payment key, so each one ALONE is
    // enough to require it. Planned individually rather than together, so a
    // check that only looks at (say) the first step cannot pass.
    const drainOnlyPlans: Array<[string, ChainStateSnapshot]> = [
      ["consolidate-3", snap({ oldKeyStoaPerChain: { "3": 1 } })],
      ["drain-stoa", snap({ oldKeyStoaPerChain: { "0": 1 } })],
      ["unstake-urstoa", snap({ oldKeyUrStoaStaked: 1 })],
      ["move-urstoa", snap({ oldKeyUrStoaLiquid: 1 })],
      ["restake-urstoa", snap({ newKeyUrStoaLiquid: 1 })],
    ];
    for (const [id, snapshot] of drainOnlyPlans) {
      const steps = planMigrationChain(snapshot, INTENT).steps;
      expect(idsOf(steps)).toEqual([id]);
      const verdict = checkMigrationPreconditions({
        ...OK_INPUTS,
        steps,
        oldPaymentKeypairPresent: false,
      });
      expect(verdict.failures.map((f) => f.code)).toEqual(["old-payment-keypair-missing"]);
    }
  });

  it("requires resolved guard keys only when G is planned", () => {
    const drainOnly = planMigrationChain(snap({ oldKeyUrStoaLiquid: 3 }), INTENT).steps;
    expect(idsOf(drainOnly)).toEqual(["move-urstoa"]);
    expect(
      checkMigrationPreconditions({ ...OK_INPUTS, steps: drainOnly, chosenGuardKeysResolved: false }).ok,
    ).toBe(true);
  });

  it("checks the AGGREGATE gas, not one transaction's — the sum of F and G", () => {
    // `RotatePaymentKeyModal.tsx:145` is `(patronIgnisBalance ?? 0) >= ignisCost`
    // for ONE tx. A balance that covers F alone must not pass a plan with F AND G.
    const bothRotations = planMigrationChain(
      snap({ registeredPaymentKey: null, registeredGuard: null }),
      INTENT,
    ).steps;
    const inputs = {
      ...OK_INPUTS,
      steps: bothRotations,
      patronIgnisBalance: 1.2,
      ignisCosts: { rotatePaymentKey: 1, rotateGuard: 1 },
    };
    const verdict = checkMigrationPreconditions(inputs);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.map((f) => f.code)).toEqual(["insufficient-ignis"]);
    expect(verdict.message).toContain("2");
    expect(verdict.message).toContain("1.2");
  });

  it("accepts a balance exactly equal to the aggregate need", () => {
    const bothRotations = planMigrationChain(
      snap({ registeredPaymentKey: null, registeredGuard: null }),
      INTENT,
    ).steps;
    expect(
      checkMigrationPreconditions({
        ...OK_INPUTS,
        steps: bothRotations,
        patronIgnisBalance: 2,
        ignisCosts: { rotatePaymentKey: 1, rotateGuard: 1 },
      }).ok,
    ).toBe(true);
  });

  it("does not demand IGNIS the plan does not need — a null balance passes a gas-station-only plan", () => {
    const drainOnly = planMigrationChain(snap({ oldKeyStoaPerChain: { "0": 4 } }), INTENT).steps;
    expect(
      checkMigrationPreconditions({ ...OK_INPUTS, steps: drainOnly, patronIgnisBalance: null }).ok,
    ).toBe(true);
  });

  it("passes an empty plan with nothing available at all — there is nothing to refuse", () => {
    const verdict = checkMigrationPreconditions({
      steps: [],
      oldPaymentKeypairPresent: false,
      chosenGuardKeysResolved: false,
      currentGuardSatisfiable: false,
      keysetUpdateSatisfiable: false,
      patronIgnisBalance: null,
      ignisCosts: { rotatePaymentKey: 5, rotateGuard: 5 },
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.message).toBe("");
  });

  it("does not refuse a plan whose only step is the non-executable keyset update", () => {
    // Nothing is submitted, so no keypair, no guard and no IGNIS is required —
    // the step is REPORTED, which is criterion 9's whole requirement.
    const keysetOnly = planMigrationChain(
      snap({ registeredGuard: { keys: [OLD_KEY], pred: "keys-all" } }),
      intent({ guardSelection: "update-keyset-recommended" }),
    ).steps;
    expect(idsOf(keysetOnly)).toEqual(["define-keyset"]);
    const verdict = checkMigrationPreconditions({
      ...OK_INPUTS,
      steps: keysetOnly,
      oldPaymentKeypairPresent: false,
      chosenGuardKeysResolved: false,
      currentGuardSatisfiable: false,
      patronIgnisBalance: null,
    });
    expect(verdict.ok).toBe(true);
  });

  it("refuses an unsatisfiable keyset update, naming the shortfall AND the forfeit alternative", () => {
    // Criterion 5: "when the keyset cannot be satisfied, the chain REFUSES
    // and starts nothing, offering forfeit or supply". A `define-keyset` is
    // satisfied by the keyset's CURRENT keyset, which this codex may hold only
    // part of — and discovering that at step 14 of 15 is the bug §5 exists to
    // stop. The numbers come from `analyzeGuard`'s own fields, so the sentence
    // the owner reads is the same arithmetic the gate used.
    const steps = keysetPlan();
    expect(steps.at(-1)?.executable).toBe(true);
    const verdict = checkMigrationPreconditions({
      ...OK_INPUTS,
      steps,
      keysetUpdateSatisfiable: false,
      keysetUpdateKeyCounts: { resolved: 3, total: 9, threshold: 5 },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.map((f) => f.code)).toEqual(["keyset-update-unsatisfiable"]);
    const detail = verdict.failures[0].detail;
    expect(detail).toContain("3");
    expect(detail).toContain("9");
    expect(detail).toContain("5");
    expect(detail).toMatch(/forfeit/i);
    expect(verdict.message).toContain(detail);
  });

  it("still names the alternative when the key counts were not supplied", () => {
    // The counts are display detail, not the decision. A caller that has the
    // boolean but not the arithmetic must still produce a refusal the owner
    // can act on, rather than "undefined of undefined".
    const verdict = checkMigrationPreconditions({
      ...OK_INPUTS,
      steps: keysetPlan(),
      keysetUpdateSatisfiable: false,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures[0].detail).not.toMatch(/undefined|NaN/);
    expect(verdict.failures[0].detail).toMatch(/forfeit/i);
  });

  it("does NOT refuse a FORFEITED keyset update, however unsatisfiable it is", () => {
    // Criterion 8's load-bearing half: a forfeit is a legitimate outcome, so
    // the rest of the migration must still run. The step is non-executable,
    // so the precondition it would trip is not checked at all.
    const steps = keysetPlan({ keysetUpdateForfeited: true });
    expect(steps.at(-1)?.executable).toBe(false);
    expect(
      checkMigrationPreconditions({ ...OK_INPUTS, steps, keysetUpdateSatisfiable: false }).ok,
    ).toBe(true);
  });

  it("does NOT refuse when the guard is not a keyset-ref — there is no keyset to satisfy", () => {
    // Criterion 4's step is reported, never submitted. Refusing the whole
    // chain for a keyset it is not going to touch would block F and G for a
    // sibling's sake.
    const steps = planMigrationChain(
      snap({
        registeredGuard: { keys: [OLD_KEY], pred: "keys-all" },
        registeredKeysetRef: null,
      }),
      intent({ guardSelection: "update-keyset-custom" }),
    ).steps;
    expect(steps.at(-1)?.executable).toBe(false);
    expect(
      checkMigrationPreconditions({ ...OK_INPUTS, steps, keysetUpdateSatisfiable: false }).ok,
    ).toBe(true);
  });

  it("does not check the keyset at all for a plan with no define-keyset step", () => {
    // An ordinary drain-and-rotate run has no keyset to satisfy, and a gate
    // that demanded one would refuse every migration in the repo.
    const ordinary = planMigrationChain(snap({ oldKeyUrStoaLiquid: 3 }), INTENT).steps;
    expect(idsOf(ordinary)).toEqual(["move-urstoa"]);
    expect(
      checkMigrationPreconditions({ ...OK_INPUTS, steps: ordinary, keysetUpdateSatisfiable: false })
        .ok,
    ).toBe(true);
  });

  it("reports the keyset shortfall in the ONE combined message alongside two other failures", () => {
    // Criterion 7, which round 2 does not get to relax: the user reads ONE
    // refusal naming everything, in a stable order, not one per press.
    const steps = [
      ...planMigrationChain(
        snap({
          oldKeyUrStoaStaked: 2,
          registeredPaymentKey: `k:${OLD_KEY}`,
          registeredKeysetRef: KEYSET_REF,
        }),
        intent({ guardSelection: "update-keyset-custom" }),
      ).steps,
    ];
    expect(idsOf(steps)).toEqual(["unstake-urstoa", "rotate-payment-key", "define-keyset"]);
    const verdict = checkMigrationPreconditions({
      ...OK_INPUTS,
      steps,
      oldPaymentKeypairPresent: false,
      keysetUpdateSatisfiable: false,
      keysetUpdateKeyCounts: { resolved: 0, total: 9, threshold: 5 },
      patronIgnisBalance: 0,
    });
    expect(verdict.failures.map((f) => f.code)).toEqual([
      "old-payment-keypair-missing",
      "keyset-update-unsatisfiable",
      "insufficient-ignis",
    ]);
    for (const failure of verdict.failures) expect(verdict.message).toContain(failure.detail);
  });

  it("requires the CURRENT guard to be satisfiable whenever anything will be submitted", () => {
    const verdict = checkMigrationPreconditions({ ...OK_INPUTS, currentGuardSatisfiable: false });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.map((f) => f.code)).toEqual(["current-guard-unsatisfiable"]);
  });

  it("gives every failure a human detail, and the message is those details joined", () => {
    const verdict = checkMigrationPreconditions({
      ...OK_INPUTS,
      oldPaymentKeypairPresent: false,
      currentGuardSatisfiable: false,
    });
    expect(verdict.failures.every((f) => f.detail.length > 0)).toBe(true);
    for (const failure of verdict.failures) {
      expect(verdict.message).toContain(failure.detail);
    }
  });
});

describe("purity — the brain reaches no chain, no React, no @stoachain", () => {
  it("imports nothing at all", async () => {
    // codex-ouronet's structural guard (tests/structural-guards.test.ts:295)
    // enforces the React/@stoachain rule across codex-core/src; this is the
    // local, file-level statement of the same thing, and it also catches an
    // import of a sibling module that would later grow a chain edge.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../src/codex/migrationChain.ts", import.meta.url),
      "utf8",
    );
    const imports = src.match(/^\s*import\s[^;]+;/gm) ?? [];
    expect(imports).toEqual([]);
  });
});

describe("the package barrel — the engine imports this through the package, not a deep path", () => {
  it("re-exports the chain brain from src/index.ts", async () => {
    // `codex-ouronet`'s engine consumes these as
    // `@ancientpantheon/codex-core` names (its vitest config aliases the
    // package to this `src/` tree). A forgotten barrel line is therefore a
    // build break in another package that this suite would otherwise miss.
    const barrel = await import("../src/index.js");
    expect(typeof barrel.planMigrationChain).toBe("function");
    expect(typeof barrel.checkMigrationPreconditions).toBe("function");
    expect(typeof barrel.sumIgnisNeed).toBe("function");
    expect(typeof barrel.paymentKeyAccountString).toBe("function");
    expect(typeof barrel.bareKeyOf).toBe("function");
    expect(barrel.STOA_CONSOLIDATION_TARGET_CHAIN).toBe("0");
    expect(barrel.CONSOLIDATION_SOURCE_CHAINS).toEqual([
      "1", "2", "3", "4", "5", "6", "7", "8", "9",
    ]);
    // DELIBERATE REWRITE (round 2): `DEFINE_KEYSET_NOT_EXECUTABLE_REASON` is
    // GONE, replaced by three reason-specific constants. Four of its five
    // clauses became false once the step got a builder and a target, and a
    // stale reason on a step that now runs is worse than no reason at all.
    expect(barrel.KEYSET_UPDATE_NO_REF_REASON).toBe(KEYSET_UPDATE_NO_REF_REASON);
    expect(barrel.KEYSET_UPDATE_FORFEITED_REASON).toBe(KEYSET_UPDATE_FORFEITED_REASON);
    expect(barrel.KEYSET_UPDATE_NO_DEFINITION_REASON).toBe(KEYSET_UPDATE_NO_DEFINITION_REASON);
    expect(
      (barrel as Record<string, unknown>).DEFINE_KEYSET_NOT_EXECUTABLE_REASON,
    ).toBeUndefined();
  });

  it("re-exports the same function objects, not copies", () => {
    // A second implementation reachable through the barrel would be two
    // independently-editable copies of the predicates.
    return import("../src/index.js").then((barrel) => {
      expect(barrel.planMigrationChain).toBe(planMigrationChain);
      expect(barrel.checkMigrationPreconditions).toBe(checkMigrationPreconditions);
    });
  });
});
