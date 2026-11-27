/**
 * The ACCOUNT STRING the migration engine rotates an Ouronet account's
 * payment key TO — and the one mainnet defect this file exists to pin.
 *
 * ## What shipped, confirmed on chain
 *
 *   (ouronet-ns.TS01-C1.DALOS|C_RotateStoa
 *     "Ѻ.<patron>" "Ѻ.<account>"
 *     "225eb6d1b11f637b7f6014d9dd4ad5630d157540ef0fc47ce198bc6407ba8d28")
 *
 * The third argument is BARE HEX. It must be the account string
 * `k:225eb6d1…`. The two are DIFFERENT accounts on chain, so the owner's
 * Ouronet account was left naming a payment-key account nobody holds the keys
 * to. Nothing refused it: a bare 64-hex string is a syntactically legal
 * account name, so the chain accepted it.
 *
 * The cause was a `seedType === "stoic"` branch inside codex-core's
 * `paymentKeyAccountString`, copied from `store.ts`'s rule for a newly created
 * SEED's own `main` field — a different concept entirely. The owner's seed is
 * stoic, so it took the bare branch.
 *
 * The owner's ruling, verbatim: *"in our case we write from a single key a k:
 * based account. That's what the migration engine will do. The user may change
 * later however it pleases."* The engine's conversion is unconditional, and
 * the seed type has nothing to do with it.
 *
 * ## Why these tests go through the WHOLE route
 *
 * The conversion lives in codex-core and the argument is emitted in
 * `zbom/rotatePaymentKeyLive.ts`; a unit test of either end alone passed
 * throughout the defect's life (`migration-chain.test.ts` DID pass — it had
 * pinned the wrong rule). So each spec below drives the real
 * `runMigrationChain` → the real `executeRotatePaymentKey` → the real
 * Pact-code builder, which is the exact composition
 * `PendingKeyChangesSection.tsx:808-822` wires in production, and asserts the
 * string that would go on chain.
 *
 * ## MAINNET HAZARD
 *
 * This is the operation that changes who controls an account, plus the
 * transfers that move every balance. **This file contains ZERO `vi.mock`
 * calls** (a self-check at the bottom keeps it that way): every chain edge
 * arrives as an injected dependency with no default, so nothing here can fail
 * open onto a node. The live broadcaster `rotateStoaChainPaymentKeyLive` is
 * never called — only `rotateStoaPactCode`, its pure, non-broadcasting
 * Pact-code builder.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import type { IKadenaKeypair as IStoaChainKeypair } from "@stoachain/stoa-core/signing";

import {
  runMigrationChain,
  type MigrationChainDeps,
  type MigrationChainRequest,
  type MigrationPreconditionFacts,
} from "../src/zbom/execute/engine.js";
import {
  executeRotatePaymentKey,
  type GuardSignerAnalysis,
} from "../src/zbom/execute/rotateOps.js";
import { rotateStoaPactCode } from "../src/zbom/rotatePaymentKeyLive.js";
import type { ChainStateSnapshot, MigrationChainIntent } from "@ancientpantheon/codex-core";
import type { ToastController } from "../src/zbom/toast/toastManager.js";

// ─── The owner's case, verbatim ─────────────────────────────────────────────

/** The bare key the owner's STOIC prime seed derived — the one that reached
 *  mainnet unprefixed. */
const OWNER_NEW_PUB = "225eb6d1b11f637b7f6014d9dd4ad5630d157540ef0fc47ce198bc6407ba8d28";
/** What the account must be rotated TO. */
const OWNER_NEW_ACCOUNT = `k:${OWNER_NEW_PUB}`;

const OLD_PUB = "a".repeat(64);
const OLD_ACCOUNT = `k:${OLD_PUB}`;
const PATRON = "Ѻ.patron";
const ACCOUNT = "Ѻ.account";
const GUARD_PUB = "b".repeat(64);
const GAS_PUB = "e".repeat(64);
const LIVE_GUARD = { keys: [OLD_PUB], pred: "keys-all" } as const;

const INTENT: MigrationChainIntent = {
  newPaymentPublicKey: OWNER_NEW_PUB,
  guard: { keys: [GUARD_PUB], pred: "keys-all" },
};

/** The engine's request. It carries NO seed type: the conversion does not
 *  depend on one, and a parameter that may never affect the result is how the
 *  shipped defect was written in the first place. */
const REQUEST: MigrationChainRequest = {
  intent: INTENT,
  oldPaymentAddress: OLD_ACCOUNT,
  accountAddress: ACCOUNT,
};

const FACTS: MigrationPreconditionFacts = {
  oldPaymentKeypairPresent: true,
  chosenGuardKeysResolved: true,
  currentGuardSatisfiable: true,
  keysetUpdateSatisfiable: true,
  patronIgnisBalance: 1000,
  ignisCosts: { rotatePaymentKey: 10, rotateGuard: 10 },
};

/** Owes F and G only — no balances anywhere, so no A-E and the assertions
 *  stay on the rotation. `over` opens the balances up for the transfer spec. */
function snapshot(over: Partial<ChainStateSnapshot> = {}): ChainStateSnapshot {
  return {
    oldKeyStoaPerChain: {},
    oldKeyUrStoaLiquid: 0,
    oldKeyUrStoaStaked: 0,
    newKeyUrStoaLiquid: 0,
    oldKeyUrStoaEarnings: 0,
    registeredPaymentKey: OLD_ACCOUNT,
    registeredGuard: { keys: [...LIVE_GUARD.keys], pred: LIVE_GUARD.pred },
    registeredKeysetRef: null,
    ...over,
  };
}

function kp(publicKey: string): IStoaChainKeypair {
  return { publicKey, privateKey: `priv-${publicKey}` };
}

function analysisFx(partial: Partial<GuardSignerAnalysis> = {}): GuardSignerAnalysis {
  return { codexKeys: [], resolvedForeignKeys: [], threshold: 0, ...partial };
}

/**
 * `deps`, with F wired the way PRODUCTION wires it — through the real
 * `executeRotatePaymentKey`, whose live-submitter slot is filled by a recorder
 * sitting at `rotateStoaChainPaymentKeyLive`'s own positional signature.
 *
 * `thirdArguments` therefore holds exactly the values
 * `rotatePaymentKeyLive.ts:83` interpolates into `C_RotateStoa`'s third slot.
 */
function harness(snapshots: readonly ChainStateSnapshot[]) {
  const thirdArguments: string[] = [];
  const receivers: Array<{ step: string; receiver: string }> = [];
  let reads = 0;
  let submits = 0;

  const controller = {
    id: "toast",
    updateStep: () => {},
    dismiss: () => {},
  } as unknown as ToastController;

  const deps: MigrationChainDeps = {
    ensureCodexUnlocked: async () => true,
    readChainState: async () => {
      const snap = snapshots[Math.min(reads, snapshots.length - 1)]!;
      reads += 1;
      return snap;
    },
    readPreconditionFacts: async () => FACTS,
    confirm: async () => ({ verdict: "success" as const }),
    submitConsolidateStoa: async () => ({
      ok: true as const,
      requestKey: `rk-${(submits += 1)}`,
      continuationRequestKey: `rk-cont-${submits}`,
    }),
    submitDrainStoa: async (req) => {
      receivers.push({ step: "drain-stoa", receiver: req.receiver });
      return { requestKey: `rk-${(submits += 1)}` };
    },
    submitUnstakeUrStoa: async () => ({ requestKey: `rk-${(submits += 1)}` }),
    submitTransferUrStoa: async (req) => {
      receivers.push({ step: "move-urstoa", receiver: req.receiverAddress });
      return { requestKey: `rk-${(submits += 1)}` };
    },
    submitStakeUrStoa: async (req) => {
      receivers.push({ step: "restake-urstoa", receiver: req.address });
      return { requestKey: `rk-${(submits += 1)}` };
    },
    // The production composition, in shape: the engine's named request goes
    // into `executeRotatePaymentKey`, which calls its injected submitter with
    // `rotateStoaChainPaymentKeyLive`'s own eight positional parameters.
    submitRotatePaymentKey: async (req) =>
      executeRotatePaymentKey(
        {
          patronAddress: PATRON,
          accountAddress: req.accountAddress,
          newPaymentKey: req.newPaymentKey,
          gasStationKey: kp(GAS_PUB),
          patronAnalysis: analysisFx(),
          accountAnalysis: analysisFx(),
          patronGuard: null,
          accountGuard: null,
        },
        {
          getKeypair: async () => null,
          submitRotatePaymentKey: async (_patron, _account, newPaymentKey) => {
            thirdArguments.push(newPaymentKey);
            return { requestKey: `rk-${(submits += 1)}` };
          },
        },
      ),
    submitRotateGuard: async () => ({ requestKey: `rk-${(submits += 1)}` }),
    recordStep: () => {},
    createToast: () => controller,
  };

  return { deps, thirdArguments, receivers };
}

describe("C_RotateStoa's third argument — the account string, never a bare key", () => {
  it("is k:225eb6d1… for the owner's STOIC seed, the key that shipped bare", async () => {
    // THE DEFECT, as it reached mainnet. A stoic seed took the bare branch, so
    // the account was repointed at `225eb6d1…` — a legal account name nobody
    // holds the keys to, and not the account the derived key controls.
    const h = harness([snapshot()]);

    // There is no seed type to set: the request has no such member, which is
    // the structural half of the fix. `REQUEST` IS the owner's case — a bare
    // key derived from a stoic seed.
    const outcome = await runMigrationChain(REQUEST, h.deps);

    expect(outcome.status).toBe("completed");
    expect(h.thirdArguments).toEqual([OWNER_NEW_ACCOUNT]);
  });

  it("is idempotent — an already-prefixed chosen key is not double-prefixed", async () => {
    // `MigrationPendingPlan.paymentPublicKey` is bare by contract, but the
    // intent is assembled from recorded state that has carried address forms
    // before now. `k:k:…` would be a third wrong account.
    const h = harness([snapshot()]);

    await runMigrationChain(
      { ...REQUEST, intent: { ...INTENT, newPaymentPublicKey: OWNER_NEW_ACCOUNT } },
      h.deps,
    );

    expect(h.thirdArguments).toEqual([OWNER_NEW_ACCOUNT]);
  });

  it("sends every balance of the SAME press to that same k: account", async () => {
    // The identical conversion feeds B, D and E's destination (the engine's
    // one `newPaymentAddress`), so the shipped defect did not stop at the
    // rotation: a stoic seed's drain, urSTOA move and re-stake were all
    // pointed at the bare-hex account too — real funds, not a registration.
    const h = harness([
      snapshot({ oldKeyStoaPerChain: { "0": 5 }, oldKeyUrStoaLiquid: 7, newKeyUrStoaLiquid: 7 }),
    ]);

    await runMigrationChain(REQUEST, h.deps);

    expect(h.receivers.map((r) => r.step)).toEqual([
      "drain-stoa",
      "move-urstoa",
      "restake-urstoa",
    ]);
    for (const { receiver } of h.receivers) expect(receiver).toBe(OWNER_NEW_ACCOUNT);
  });
});

describe("rotateStoaPactCode — the emitted transaction, and what it refuses to express", () => {
  it("emits the owner's case as the exact expression the chain would read", async () => {
    // The whole route, end to end, down to the literal Pact text: the engine's
    // conversion, F's positional hand-off and the one `.execution(...)`
    // argument of the live builder. The shipped transaction differed from this
    // string by two characters.
    const h = harness([snapshot()]);
    await runMigrationChain(REQUEST, h.deps);

    expect(rotateStoaPactCode(PATRON, ACCOUNT, h.thirdArguments[0]!)).toBe(
      `(ouronet-ns.TS01-C1.DALOS|C_RotateStoa "${PATRON}" "${ACCOUNT}" "${OWNER_NEW_ACCOUNT}")`,
    );
  });

  it("REFUSES a bare 64-hex account, the one shape no client should be able to send", () => {
    // The chain cannot help here: 64 hex chars are a legal account name, so
    // the defect landed as a success. This is the client-side half of the fix
    // — the argument is interpolated in exactly one place, so one guard there
    // means no path (engine, modal or a future caller) can express it.
    expect(() => rotateStoaPactCode(PATRON, ACCOUNT, OWNER_NEW_PUB)).toThrow(
      /\bk:/,
    );
    // ...and the message carries the offending value, because the person
    // reading it has to recognise their own key in it.
    expect(() => rotateStoaPactCode(PATRON, ACCOUNT, OWNER_NEW_PUB)).toThrow(
      new RegExp(OWNER_NEW_PUB),
    );
  });

  it("REFUSES a blank account name", () => {
    // `(… "")` is a rotation to the empty account. Nothing upstream can
    // legitimately produce it, which is exactly why it should not survive to
    // a dirty read.
    expect(() => rotateStoaPactCode(PATRON, ACCOUNT, "   ")).toThrow();
  });

  it("passes EVERY sigilled and custom form the manual modal supports, untouched", () => {
    // The guard must not become a whitelist. `RotatePaymentKeyModal` takes a
    // free string precisely so a user can nominate an account they already
    // hold — `c:`/`u:`/`w:` principal accounts, a named vault, anything the
    // chain itself accepts. The owner's ruling covers the ENGINE ("we write
    // from a single key a k: based account… the user may change later however
    // it pleases"), not the user's own choice.
    const accepted = [
      `k:${OWNER_NEW_PUB}`,
      "c:LKCaLdWW2pSRyvxQCLBxLWC9j2JyaGaGGaGGaGGaGGa",
      "u:some-guard-principal:abcdef0123456789",
      "w:yHnnXDwDJ7Vmsu0ZJ8z0nTXBvYbXhBJkDQyV8FLQRnQ:keys-all",
      "ouronet-gas-station",
      "Ѻ.named-account",
    ];
    for (const account of accepted) {
      expect(rotateStoaPactCode(PATRON, ACCOUNT, account)).toContain(`"${account}"`);
    }
  });
});

describe("this spec's own mainnet discipline", () => {
  it("contains no `vi.mock` call anywhere — every chain edge is injected", () => {
    // The engine fires up to a dozen real transactions unattended. A dropped
    // `vi.mock` fails OPEN onto mainnet; a required injected seam cannot. The
    // assertion is over this file's own source so the property survives edits.
    // Matches a real call site only, so the prose above can keep naming it.
    const self = readFileSync(
      resolve(__dirname, "execute-payment-key-account-string.test.ts"),
      "utf8",
    );
    expect(self).not.toMatch(/vi\s*\.\s*mock\s*\(/);
  });
});
