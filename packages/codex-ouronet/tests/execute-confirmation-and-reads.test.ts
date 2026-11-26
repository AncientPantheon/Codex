/**
 * execute-confirmation-and-reads — the migration engine's confirmation GATE
 * and its headless chain-state read.
 *
 * MAINNET HAZARD — why this file injects everything it can and registers a
 * reader for the rest (docs/work/migration-execute/plan.md, "THE MAINNET
 * HAZARD"):
 *
 *   • `pactRead` defaults to `rawCalibratedDirtyRead` — a REAL read against
 *     the live StoaChain node (`@stoachain/stoa-core/dist/reads/pactReader.js`
 *     initialises `let _reader = rawCalibratedDirtyRead`). Every test here
 *     that touches `readChainState` installs a reader in `beforeEach` via
 *     `setPactReader`, the same seam `ouronet-execute-wiring.test.ts:59-66`
 *     uses, OR passes a fully-synthetic `deps` object.
 *   • `awaitTxVerdict` NEVER reaches the network in this file: its poll is an
 *     injected dependency, so there is no `getFailoverClient` on the path.
 *
 * There is deliberately **no `vi.mock` anywhere in this file**. A dropped or
 * mistyped `vi.mock` fails OPEN onto mainnet; an injected seam cannot. Delete
 * every mock in this suite and it still never reaches a node — that property
 * is the test of the test.
 *
 * ROUND 2 (`docs/work/migration-execute-keyset/`) adds TWO fields to the
 * snapshot, both filled from reads this module ALREADY performs — no new read,
 * no new `CODEX_READ_REGISTRY` entry:
 *
 *   • `oldKeyUrStoaEarnings`, from the `earnings` field the batched urSTOA
 *     read has requested since round 1 and threw away. It decides whether
 *     step C emits its merged `coin.C_URV|Collect` at all, and a Collect of
 *     zero FAILS THE WHOLE TRANSACTION (`coin-live.pact:708-721`'s `debit`
 *     enforces `(> amount 0.0)` at `:414-418`) — taking the unstake with it.
 *   • `registeredKeysetRef`, from `keysetRefNameOf` over the SAME raw
 *     `ouronet-account-guard` value `guardOf` already reads. That is design
 *     §2's "the target is derivable from the account's live guard", and it is
 *     why the keyset step needs neither a new read nor a new recorded field.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setPactReader, getPactReader } from "@stoachain/stoa-core/reads";
import { STOA_CHAINS, getPactUrl } from "@stoachain/stoa-core/constants";
import { pollTransactionStatus } from "@ouronet/ouronet-core/interactions/crossChainFunctions";

import {
  awaitTxVerdict,
  awaitTxVerdictLiveDeps,
  type AwaitTxVerdictDeps,
  type PolledTxStatus,
} from "../src/zbom/execute/awaitConfirmation.js";
import { readChainState } from "../src/zbom/execute/chainState.js";

/** The reader stoa-core was booted with — restored after every test so this
 *  file leaves no global reader behind for whatever runs next. */
const ORIGINAL_READER = getPactReader();

/** Per the plan's mainnet-hazard section: EVERY test in this file starts with
 *  a registered reader, because `pactRead`'s default is
 *  `rawCalibratedDirtyRead` — a real call to a real StoaChain node. This one
 *  throws, so a test that forgot to install its own fails loudly instead of
 *  quietly reading mainnet. */
beforeEach(() => {
  setPactReader(() => { throw new Error("no reader registered by this test"); });
});

afterEach(() => {
  vi.restoreAllMocks();
  setPactReader(ORIGINAL_READER);
});

// ─── (a) awaitConfirmation.ts — the gate ────────────────────────────────────

/** A poll that returns a scripted sequence (last entry repeats forever), plus
 *  a `sleep` that records its delays instead of waiting — the whole reason
 *  `deps` exists: `ui-send-stoa-modal.test.tsx:716` has to reach for
 *  `vi.useFakeTimers()` precisely because the modal's copy bakes the budget in. */
function stubDeps(sequence: PolledTxStatus[]): AwaitTxVerdictDeps & {
  readonly delays: number[];
  readonly poll: ReturnType<typeof vi.fn>;
} {
  const delays: number[] = [];
  let i = 0;
  const poll = vi.fn(async () => sequence[Math.min(i++, sequence.length - 1)]);
  return {
    delays,
    poll,
    pollTransactionStatus: poll,
    sleep: async (ms: number) => { delays.push(ms); },
  };
}

describe("awaitTxVerdict — only \"success\" unblocks; \"failure\" AND \"pending\" both halt", () => {
  it("returns \"success\" on the FIRST poll, without sleeping", async () => {
    // A first-poll success that kept polling would stall the engine ~100s per
    // step on a chain whose finality is "near-instant" (toastManager.ts:353-359).
    const deps = stubDeps([{ status: "success" }]);
    const out = await awaitTxVerdict("rk-success", "0", deps);
    expect(out).toEqual({ verdict: "success" });
    expect(deps.poll).toHaveBeenCalledTimes(1);
    expect(deps.poll).toHaveBeenCalledWith("rk-success", "0");
    expect(deps.delays).toEqual([]);
  });

  it("surfaces \"failure\" with the CHAIN'S OWN message, verbatim, and stops polling", async () => {
    // The engine HALTs on failure and the toast shows this string. Rewriting it
    // into a house message leaves the user with nothing to diagnose.
    const deps = stubDeps([{ status: "failure", error: "Insufficient funds for gas" }]);
    const out = await awaitTxVerdict("rk-fail", "3", deps);
    expect(out).toEqual({ verdict: "failure", message: "Insufficient funds for gas" });
    expect(deps.poll).toHaveBeenCalledTimes(1);
  });

  it("exhausting the budget returns \"pending\", NEVER \"failure\"", async () => {
    // THE load-bearing case (plan decision 4, C→D): C is `coin.C_URV|Unstake`,
    // D transfers the LIQUID urSTOA that C produces. A "pending" reported as
    // "failure" invites a duplicate resubmit of a tx that may still land; a
    // "pending" reported as "success" makes D read its amount from a
    // pre-unstake balance and strands funds on the old key. It is its own value.
    const deps = stubDeps([{ status: "pending" }]);
    const out = await awaitTxVerdict("rk-slow", "0", deps, { maxAttempts: 4, delayMs: 10 });
    expect(out).toEqual({ verdict: "pending" });
    expect(deps.poll).toHaveBeenCalledTimes(4);
    // maxAttempts polls, but no trailing sleep after the last one.
    expect(deps.delays).toEqual([10, 10, 10]);
  });

  it("treats ouronet-core's fourth status, \"not-found\", as not-yet-landed — never a failure", async () => {
    // `TransferStatus.status` is "pending" | "success" | "failure" | "not-found"
    // (crossChainFunctions.d.ts:42). A not-yet-mined requestKey mapped onto
    // "failure" would halt the chain with an error for a tx that then lands.
    const deps = stubDeps([{ status: "not-found" }, { status: "not-found" }, { status: "success" }]);
    const out = await awaitTxVerdict("rk-latemine", "0", deps, { maxAttempts: 5, delayMs: 1 });
    expect(out).toEqual({ verdict: "success" });
    expect(deps.poll).toHaveBeenCalledTimes(3);
  });

  it("carries the last poll's error message out with an exhausted \"pending\"", async () => {
    // `pollTransactionStatus` returns `{ status: "pending", error }` when the
    // node call THREW (crossChainFunctions.js:224-229). Dropping that message
    // leaves "Submitted — not confirmed" with no cause attached.
    const deps = stubDeps([{ status: "pending", error: "fetch failed" }]);
    const out = await awaitTxVerdict("rk-nonode", "0", deps, { maxAttempts: 2, delayMs: 1 });
    expect(out).toEqual({ verdict: "pending", message: "fetch failed" });
  });

  it("defaults to SendStoaModal.tsx:176-188's budget exactly — 20 attempts / 5000ms", async () => {
    // T7 deletes the modal's private `waitForInitiateConfirmation` and
    // re-points it here. If this budget silently shrank, the modal's own
    // ~100s confirmation window would shrink with it.
    const deps = stubDeps([{ status: "pending" }]);
    const out = await awaitTxVerdict("rk-default", "1", deps);
    expect(out).toEqual({ verdict: "pending" });
    expect(deps.poll).toHaveBeenCalledTimes(20);
    expect(deps.delays).toHaveLength(19);
    expect(new Set(deps.delays)).toEqual(new Set([5000]));
  });

  it("the live deps resolve ouronet-core's pollTransactionStatus by its documented name", async () => {
    // Name/path drift in @ouronet/ouronet-core is a SHIPPED bug class in this
    // package — `zbom/ouroSelectorReads.ts`'s whole header is the list. This
    // asserts the symbol the production wiring imports still exists (it does
    // NOT call it: the real one goes through `getFailoverClient`).
    expect(typeof pollTransactionStatus).toBe("function");
    expect(typeof awaitTxVerdictLiveDeps.pollTransactionStatus).toBe("function");
    await expect(awaitTxVerdictLiveDeps.sleep(0)).resolves.toBeUndefined();
  });
});

// ─── (b) chainState.ts — the headless predicate reads ───────────────────────

const OLD = "k:1111111111111111111111111111111111111111111111111111111111111111";
const NEW = "k:2222222222222222222222222222222222222222222222222222222222222222";
const ACCT = "Ѻ.OLDMAN";
const QUERY = { oldPaymentAddress: OLD, newPaymentAddress: NEW, accountAddress: ACCT };

/** A selector row shaped like `O-UI-SEVEN.URC_01|Accounts` returns one. */
function selectorRow(over: Record<string, unknown> = {}) {
  return {
    result: {
      status: "success",
      data: [{
        "ouronet-account": ACCT,
        "payment-key": OLD,
        "ouronet-account-guard": { keys: ["abc"], pred: "keys-all" },
        ...over,
      }],
    },
  };
}

/** Wrap rows the way a dirty-read envelope does (`rowsOf` unwraps either). */
const env = (rows: unknown[]) => ({ result: { status: "success", data: rows } });

interface ReaderScript {
  /** Per-chain `coin.get-balance` response, keyed by the chainId read. */
  readonly perChain?: (chainId: string | undefined) => unknown;
  readonly urStoa?: unknown;
  readonly selector?: unknown;
}

/** Installs a reader that DISPATCHES on the Pact code it is handed and records
 *  every call — the `ouronet-execute-wiring.test.ts:59-66` idiom, extended to
 *  serve three different reads from one reader. An unrecognised read THROWS
 *  rather than returning something benign: a silent zero is the one lie this
 *  topic cannot afford. */
function installReader(script: ReaderScript = {}) {
  const calls: Array<{ code: string; options?: Record<string, unknown> }> = [];
  const reader = vi.fn(async (code: string, options?: Record<string, unknown>) => {
    calls.push({ code, options });
    if (code.includes("URC_01|Accounts")) return script.selector ?? selectorRow();
    if (code.includes("UR_UR|Balance")) {
      return script.urStoa ?? env([
        { account: OLD, balance: 0, staked: 0, earnings: 0, exists: true },
        { account: NEW, balance: 0, staked: 0, earnings: 0, exists: true },
      ]);
    }
    if (code.includes("coin.get-balance")) {
      return script.perChain?.(options?.chainId as string | undefined)
        ?? env([{ account: OLD, balance: 0, exists: true }]);
    }
    throw new Error(`unexpected read: ${code}`);
  });
  setPactReader(reader);
  return { reader, calls };
}

describe("readChainState — the §4 predicates' chain state, read headlessly", () => {
  it("issues one coin.get-balance read per STOA_CHAINS entry, each on its own chainId", async () => {
    // Consolidation (step A(n)) covers chains 1-9 and must SKIP zero balances
    // (acceptance criterion 4). A missed chain is STOA left behind on the old
    // key forever; a read sent to the wrong node answers for the wrong chain.
    const { calls } = installReader();
    await readChainState(QUERY);
    const balanceCalls = calls.filter((c) => c.code.includes("coin.get-balance"));
    expect(balanceCalls).toHaveLength(STOA_CHAINS.length);
    expect(balanceCalls.map((c) => c.options?.chainId)).toEqual([...STOA_CHAINS]);
    for (const c of balanceCalls) {
      expect(c.options?.pactUrl).toBe(getPactUrl(c.options?.chainId as string));
      expect(c.options?.tier).toBe("T5");
      expect(c.code).toContain(`"${OLD}"`);
    }
  });

  it("carries the `earnings` field out of the urSTOA read into the snapshot", async () => {
    // WHY: round 1 REQUESTED `earnings` in the batched read and then dropped
    // it on the floor, so pending rewards sat on the old key forever (design
    // §1: "this closes a real hole"). The figure is now a predicate: step C
    // merges a Collect iff it is > 0, and a Collect with nothing claimable
    // fails C's whole transaction — unstake included.
    installReader({
      urStoa: env([
        { account: OLD, balance: 1, staked: 2, earnings: { decimal: "0.75" }, exists: true },
        { account: NEW, balance: 0, staked: 0, earnings: 99, exists: true },
      ]),
    });
    const snap = await readChainState(QUERY);
    // Coerced from the `{ decimal }` shape, and taken from the OLD key — the
    // NEW key's rewards are not a predicate of anything and must not leak in.
    expect(snap.oldKeyUrStoaEarnings).toBe(0.75);
  });

  it("reads an `exists: false` urSTOA row as 0 earnings, never NaN", async () => {
    // WHY: `NaN > 0` is false, so a NaN would silently SKIP the Collect and
    // re-open the dust hole — the exact failure mode that is invisible until
    // someone audits a vault. The pact-side `try` default is
    // `{ …, "earnings": 0.0, "exists": false }`, and a node can also answer
    // with no row for the address at all.
    installReader({
      urStoa: env([{ account: OLD, balance: 0, staked: 0, earnings: 5, exists: false }]),
    });
    const absent = await readChainState(QUERY);
    expect(absent.oldKeyUrStoaEarnings).toBe(0);
    expect(Number.isNaN(absent.oldKeyUrStoaEarnings)).toBe(false);

    installReader({ urStoa: env([]) });
    const noRow = await readChainState(QUERY);
    expect(noRow.oldKeyUrStoaEarnings).toBe(0);
  });

  it("reads urSTOA ONCE, on chain \"0\" only, batching both addresses", async () => {
    // urSTOA is only deployed on chain 0 (useUrStoaBalances.ts:4-7). Ten reads
    // would be nine errors; a per-address read would be two round trips for
    // one answer. Both addresses in one call is the shipped read's shape.
    const { calls } = installReader();
    await readChainState(QUERY);
    const ur = calls.filter((c) => c.code.includes("UR_UR|Balance"));
    expect(ur).toHaveLength(1);
    expect(ur[0].options?.chainId).toBe("0");
    expect(ur[0].options?.pactUrl).toBe(getPactUrl("0"));
    expect(ur[0].code).toContain("(coin.UR_UR|Balance a)");
    expect(ur[0].code).toContain("(coin.UR_URV|UserSupply a)");
    // Round 2 reads this field rather than discarding it, so the expression
    // has to stay in the batch — one read, three predicates.
    expect(ur[0].code).toContain("(coin.URC_URV|ClaimableRewards a)");
    expect(ur[0].code).toContain(`"${OLD}"`);
    expect(ur[0].code).toContain(`"${NEW}"`);
  });

  it("coerces a Pact decimal — { decimal } and string — to a number", async () => {
    // The Pact decimal arrives as number | string | { decimal }
    // (useStoaChainBalances.ts:51-60). An uncoerced { decimal } reads as 0 or
    // NaN, and 0 in this topic means "skip the drain" — funds left behind.
    installReader({
      perChain: (chainId) =>
        chainId === "2"
          ? env([{ account: OLD, balance: { decimal: "12.5" }, exists: true }])
          : env([{ account: OLD, balance: "0.0", exists: true }]),
      urStoa: env([
        { account: OLD, balance: "3.25", staked: { decimal: "7.5" }, exists: true },
        { account: NEW, balance: 1.5, staked: 0, exists: true },
      ]),
    });
    const snap = await readChainState(QUERY);
    expect(snap.oldKeyStoaPerChain["2"]).toBe(12.5);
    expect(snap.oldKeyUrStoaLiquid).toBe(3.25);
    expect(snap.oldKeyUrStoaStaked).toBe(7.5);
    expect(snap.newKeyUrStoaLiquid).toBe(1.5);
  });

  it("reads an absent row — and an exists:false row — as 0, never NaN", async () => {
    // `NaN > 0` is false, so a NaN would silently skip the step; worse, a NaN
    // amount reaching a transfer builder is a malformed transaction. The
    // pact-side `try` default is {balance:0,exists:false} and a node can also
    // answer with no row at all for that address.
    installReader({
      perChain: (chainId) =>
        chainId === "5" ? env([]) : env([{ account: OLD, balance: 9, exists: false }]),
      urStoa: env([]),
    });
    const snap = await readChainState(QUERY);
    expect(snap.oldKeyStoaPerChain["5"]).toBe(0);
    expect(snap.oldKeyStoaPerChain["3"]).toBe(0);
    expect(Object.values(snap.oldKeyStoaPerChain).some(Number.isNaN)).toBe(false);
    expect(snap.oldKeyUrStoaLiquid).toBe(0);
    expect(snap.oldKeyUrStoaStaked).toBe(0);
    expect(snap.newKeyUrStoaLiquid).toBe(0);
  });

  it("does not swap the old key's and the new key's urSTOA figures", async () => {
    // Steps C/D read the OLD key, step E reads the NEW one. Swapped, the
    // engine would re-stake on the wrong key and transfer an amount that
    // isn't there — the one read mistake no later step can recover from.
    installReader({
      urStoa: env([
        { account: NEW, balance: 40, staked: 50, exists: true },
        { account: OLD, balance: 10, staked: 20, exists: true },
      ]),
    });
    const snap = await readChainState(QUERY);
    expect(snap.oldKeyUrStoaLiquid).toBe(10);
    expect(snap.oldKeyUrStoaStaked).toBe(20);
    expect(snap.newKeyUrStoaLiquid).toBe(40);
  });

  it("lands `payment-key` and `ouronet-account-guard` in the right snapshot fields", async () => {
    // Predicate F compares the REGISTERED payment key against the chosen one
    // and predicate G the registered guard; `chainPublicKey` vs
    // `stoaChainLedger` is exactly the field confusion design §7 documents as
    // a shipped defect. The key is passed through VERBATIM — T3's `bareKeyOf`
    // owns normalisation, not this read.
    installReader({
      selector: selectorRow({
        "payment-key": OLD,
        "ouronet-account-guard": { keys: ["key-a", "key-b"], pred: "keys-any" },
      }),
    });
    const snap = await readChainState(QUERY);
    expect(snap.registeredPaymentKey).toBe(OLD);
    expect(snap.registeredGuard).toEqual({ keys: ["key-a", "key-b"], pred: "keys-any" });
  });

  it("reads the keyset reference out of the NESTED `{ keysetref: { ns, ksn } }` spelling", async () => {
    // WHY two spellings and not one: this codebase genuinely has both, and
    // real persisted data uses both — `GuardTree.tsx`'s `KeysetRefGuard` is
    // the raw Pact wire shape `{ keysetref: { ns, ksn } }`, which is what an
    // UNEXPANDED selector row carries. `keysetRefNameOf`'s doc comment
    // (`resolveGuardKeys.ts:66-92`) is the record of the owner-reported
    // defect that forced shape-tolerance. If this read saw only one spelling,
    // half of all keyset-ref accounts would be told their guard is not a
    // keyset-ref at all — criterion 4's reason, on a false premise.
    installReader({
      selector: selectorRow({
        "ouronet-account-guard": { keysetref: { ns: "ouronet-ns", ksn: "dh_ah-keyset" } },
      }),
    });
    const snap = await readChainState(QUERY);
    expect(snap.registeredKeysetRef).toBe("ouronet-ns.dh_ah-keyset");
    // `guardOf` is deliberately LEFT ALONE: an unexpanded ref has no `keys`
    // array, so there is still no guard on record for predicate G. That is
    // fine here precisely because G is suppressed for the keyset kinds.
    expect(snap.registeredGuard).toBeNull();
  });

  it("reads it out of the camelCase already-qualified `keysetRef` spelling too", async () => {
    // WHY: `getKadenaAccountGuard`
    // (`@ouronet/ouronet-core/.../ouroAccountFunctions.js:158-170`) EXPANDS a
    // keyset-ref and annotates the expanded keyset with
    // `keysetRef: "<ns>.<ksn>"`. That is the shape the live account-guard read
    // hands back, so it is the shape the production path most often sees.
    installReader({
      selector: selectorRow({
        "ouronet-account-guard": {
          keys: ["key-a", "key-b"],
          pred: "keys-any",
          keysetRef: "free.my-keyset",
        },
      }),
    });
    const snap = await readChainState(QUERY);
    expect(snap.registeredKeysetRef).toBe("free.my-keyset");
    // An EXPANDED ref has both: the reference name AND a usable key list.
    expect(snap.registeredGuard).toEqual({ keys: ["key-a", "key-b"], pred: "keys-any" });
  });

  it("reports null for a plain keyset guard — the fact criterion 4's refusal rests on", async () => {
    // WHY: the planner's whole decision is "is the account's guard a keyset-ref
    // at all". A plain keyset holds its keys directly and has no reference to
    // redefine, so a non-null here would make the engine submit a
    // `define-keyset` against a target that does not exist.
    installReader({
      selector: selectorRow({
        "ouronet-account-guard": { keys: ["key-a"], pred: "keys-all" },
      }),
    });
    expect((await readChainState(QUERY)).registeredKeysetRef).toBeNull();
  });

  it("reports null for a malformed or absent annotation rather than throwing", async () => {
    // WHY: `keysetRefNameOf` "never throws on a malformed one — an unreadable
    // annotation is simply 'no annotation', never a crash". A throw here would
    // turn a cosmetic data defect into a migration that cannot even be read,
    // and `readChainState` propagates every rejection by design.
    for (const guard of [
      false,
      { keysetref: { ns: "free" } },
      { keysetref: "" },
      { keysetRef: 7 },
    ]) {
      installReader({ selector: selectorRow({ "ouronet-account-guard": guard }) });
      const snap = await readChainState(QUERY);
      expect(snap.registeredKeysetRef).toBeNull();
    }
  });

  it("maps the BAR sentinel and a `false` guard to null, not to a bogus value", async () => {
    // Post-DPL-UR, `payment-key` comes back as the literal "|" for "none on
    // record" (ouroSelectorReads.ts's own header) and a guard as `false` for
    // an unactivated account. Passing "|" through would make predicate F
    // compare a chosen key against a sentinel and rotate on a lie.
    installReader({
      selector: selectorRow({ "payment-key": "|", "ouronet-account-guard": false }),
    });
    const snap = await readChainState(QUERY);
    expect(snap.registeredPaymentKey).toBeNull();
    expect(snap.registeredGuard).toBeNull();
  });

  it("propagates a read failure as an ERROR, never as a snapshot of zeroes", async () => {
    // THE worst possible lie in this topic: a zero snapshot means "nothing to
    // move", so a swallowed network error would report the migration complete
    // while every balance is still sitting on the old key.
    setPactReader(async () => { throw new Error("node unreachable"); });
    await expect(readChainState(QUERY)).rejects.toThrow("node unreachable");
  });

  it("refuses when the account selector returns no row for the account", async () => {
    // `getAccountSelectorDataLive` answers `[]` on a FAILED read envelope
    // (ouroSelectorReads.ts:93) — indistinguishable, at its own call site,
    // from "this account has no row". Either way the registered key and guard
    // are UNKNOWN, and unknown is not `null`: null would fire predicates F
    // and G off a read that never happened.
    installReader({ selector: { result: { status: "failure", data: null } } });
    await expect(readChainState(QUERY)).rejects.toThrow(ACCT);
  });

  it("takes its whole chain edge from `deps` — a fully-synthetic deps object reaches no node", async () => {
    // The seam T9's engine test and T11's production wiring both use. No
    // `setPactReader`, no `vi.mock`, no module-level default in play: proof
    // that the read layer is INJECTABLE and cannot fail open onto mainnet.
    setPactReader(() => { throw new Error("the module-level reader must not be reached"); });
    const snap = await readChainState(QUERY, {
      pactRead: async (code: string, options?: Record<string, unknown>) =>
        code.includes("UR_UR|Balance")
          ? env([{ account: OLD, balance: 2, staked: 3, earnings: 6, exists: true }])
          : env([{ account: OLD, balance: options?.chainId === "7" ? 4 : 0, exists: true }]),
      readAccountSelector: async () => [
        {
          "ouronet-account": ACCT,
          "payment-key": NEW,
          "ouronet-account-guard": {
            keys: ["z"],
            pred: "keys-all",
            keysetRef: "free.injected-keyset",
          },
        },
      ],
    });
    expect(snap.oldKeyStoaPerChain["7"]).toBe(4);
    expect(snap.oldKeyUrStoaLiquid).toBe(2);
    expect(snap.oldKeyUrStoaStaked).toBe(3);
    expect(snap.oldKeyUrStoaEarnings).toBe(6);
    expect(snap.registeredPaymentKey).toBe(NEW);
    expect(snap.registeredKeysetRef).toBe("free.injected-keyset");
  });
});
