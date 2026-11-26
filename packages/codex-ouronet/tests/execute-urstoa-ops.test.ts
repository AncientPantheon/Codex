// @vitest-environment node
//
// Run in the NODE environment, not this package's jsdom default: done-when
// criterion 1 is "callable with no React anywhere in the call stack", and a
// spec that passes with no DOM at all is the direct evidence. If a future edit
// drags a React hook or a `document` touch into `urStoaOps.ts`, this file
// stops loading rather than quietly passing under jsdom.

/**
 * execute-urstoa-ops — the urSTOA trio (C, D, E), headless.
 *
 * Covers `src/zbom/execute/urStoaOps.ts`: `unstakeUrStoa`, `transferUrStoa`
 * and `stakeUrStoa` — the migration engine's ONLY route to
 * `coin.C_URV|Unstake`, `coin.C_UR|Transfer` and `coin.C_URV|Stake`.
 *
 * ## MAINNET HAZARD — why every dependency here is INJECTED, never mocked
 *
 * The three `@ouronet/ouronet-core` executors these functions wrap submit REAL
 * transactions through `getFailoverClient(...).submit`
 * (`node_modules/@ouronet/ouronet-core/dist/interactions/urStoaFunctions.js:359,393,463`),
 * and `checkCoinAccountExists` reads through `pactRead`, which initialises to
 * the LIVE network (`@stoachain/stoa-core/dist/reads/pactReader.js`:
 * `let _reader = rawCalibratedDirtyRead`). The migration engine invokes this
 * trio unattended, so a test that reached the real module would move real
 * urSTOA on StoaChain mainnet.
 *
 * Therefore: `urStoaOps.ts` imports NO executor, NO reader and NO signer. Each
 * function takes its executor, its `getKeypair` and its receiver probe on an
 * explicit `deps` argument, and every spec below builds `deps` out of plain
 * `vi.fn()`s.
 *
 * **There is deliberately NOT ONE `vi.mock` in this file.** A reviewer can
 * delete every mock here (there are none to delete) and the suite still
 * passes, because there is no module-level chain edge to displace. A dropped
 * `vi.mock` fails OPEN onto mainnet; an injected seam cannot. The last
 * describe block enforces that structurally, by scanning the module's own
 * import statements.
 *
 * ## Three contracts restated, because they shape the signatures
 *
 * 1. **C→D→E is forced, not chosen** (design §2). `StakeUrStoaParams` /
 *    `UnstakeUrStoaParams` are `{ paymentKeyAddress, amount, gasStationKey }`
 *    and carry **no destination** — staking acts on the account itself. There
 *    is no primitive that moves staked urSTOA between keys, so "move the
 *    staked urSTOA" is necessarily unstake → transfer → re-stake, and these
 *    signatures must not pretend otherwise.
 * 2. **The family is patronless** (docs/work/stoa-urstoa-vault-actions/design.md
 *    decision #1). The payment key itself signs both `DALOS.GAS_PAYER` and the
 *    `coin.URV|*` capability; `gasStationKey` is a misleadingly-named
 *    parameter, not an invitation to wire an Ouronet patron in. For the
 *    transfer the SAME decrypted keypair is therefore `paymentKeypair` AND the
 *    sole `senderGuardKeys` entry.
 * 3. **The keypair is resolved at call time, never cached** (decision #2) —
 *    asserted below across two successive calls.
 *
 * The three vault-action modals (`UnstakeUrStoaModal.tsx`,
 * `TransferUrStoaModal.tsx`, `StakeUrStoaModal.tsx`) are deliberately NOT
 * re-pointed at these functions by this task, and their ~90 existing tests
 * stay green byte-for-byte. The duplication that leaves behind is bounded to a
 * CALL SHAPE (which argument object to build), not to a decision: the
 * receiver-existence rule, the `k:`-only refusal and the 3-decimal truncation
 * each now exist in exactly one place for every headless caller.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi } from "vitest";
import type { IKadenaKeypair } from "@stoachain/stoa-core/signing";
// TYPE-ONLY (erased — no runtime edge, see the header): the executors' own
// param interfaces, so the whole-object assertions below are checked against
// `@ouronet/ouronet-core`'s real shapes at `npm run typecheck` time too. A
// renamed or dropped field upstream then breaks the build instead of a
// transaction.
import type {
  StakeUrStoaParams,
  UnstakeUrStoaParams,
  ExecuteNativeUrStoaParams,
} from "@ouronet/ouronet-core/interactions/urStoaFunctions";

import {
  unstakeUrStoa,
  transferUrStoa,
  stakeUrStoa,
  RECEIVER_NOT_FOUND_MESSAGE,
} from "../src/zbom/execute/urStoaOps.js";

const SENDER_PUB = "aa".repeat(32);
const RECEIVER_PUB = "bb".repeat(32);
const SENDER = `k:${SENDER_PUB}`;
const RECEIVER = `k:${RECEIVER_PUB}`;

const keypair = (publicKey: string): IKadenaKeypair => ({
  publicKey,
  privateKey: `priv-${publicKey}`,
});

const SENDER_KEYPAIR = keypair(SENDER_PUB);

/** A `getKeypair` that answers only for the sender's public key — so a spec
 *  that resolves the WRONG key fails loudly instead of getting a stub. */
function getKeypairFn() {
  return vi.fn(async (publicKey: string): Promise<IKadenaKeypair> => {
    if (publicKey !== SENDER_PUB) throw new Error(`unexpected publicKey: ${publicKey}`);
    return SENDER_KEYPAIR;
  });
}

/** An executor stub that records the param object it was handed. Typed by the
 *  executor's REAL param interface so the assertions are type-checked too. */
const submitted = <P>(requestKey: string) =>
  vi.fn(async (_params: P) => ({ requestKey }));

describe("unstakeUrStoa (step C)", () => {
  it("calls the injected executor exactly once with the whole param object", async () => {
    // The money assertion is the WHOLE object: `gasStationKey` must be the
    // decrypted keypair (patronless — the payment key pays its own gas), and
    // `paymentKeyAddress` must be the account itself, since unstake has no
    // destination at all.
    const executeUnstakeUrStoa = submitted<UnstakeUrStoaParams>("req-unstake");
    const getKeypair = getKeypairFn();

    const result = await unstakeUrStoa(
      { paymentKeyAddress: SENDER, paymentPublicKey: SENDER_PUB, amount: "12.5" },
      { executeUnstakeUrStoa, getKeypair },
    );

    expect(executeUnstakeUrStoa).toHaveBeenCalledTimes(1);
    expect(executeUnstakeUrStoa.mock.calls[0]![0]).toEqual({
      paymentKeyAddress: SENDER,
      amount: "12.5",
      gasStationKey: SENDER_KEYPAIR,
    });
    expect(result).toEqual({ requestKey: "req-unstake" });
  });

  it("truncates a four-decimal amount to urSTOA's three places", async () => {
    // A fourth decimal place is a chain-side failure, and the chain-state
    // snapshot the engine reads is not precision-aware. Truncation (not
    // rounding) is `formatDecimalForPact`'s own contract: rounding UP could
    // ask the vault for more than is staked.
    const executeUnstakeUrStoa = submitted<UnstakeUrStoaParams>("req-unstake");

    await unstakeUrStoa(
      { paymentKeyAddress: SENDER, paymentPublicKey: SENDER_PUB, amount: "1.2345" },
      { executeUnstakeUrStoa, getKeypair: getKeypairFn() },
    );

    expect(executeUnstakeUrStoa.mock.calls[0]![0]!.amount).toBe("1.234");
  });

  it("appends `.0` to a whole amount so Pact lexes it as a decimal", async () => {
    // Pact distinguishes integer from decimal at the lexer level: `7` is
    // rejected where `7.0` is accepted, and a balance-derived whole number is
    // the common case for a full unstake.
    const executeUnstakeUrStoa = submitted<UnstakeUrStoaParams>("req-unstake");

    await unstakeUrStoa(
      { paymentKeyAddress: SENDER, paymentPublicKey: SENDER_PUB, amount: "7" },
      { executeUnstakeUrStoa, getKeypair: getKeypairFn() },
    );

    expect(executeUnstakeUrStoa.mock.calls[0]![0]!.amount).toBe("7.0");
  });

  it("resolves the keypair through the injected getKeypair, freshly per call", async () => {
    // Decision #2: resolved at call time, never cached. A cached keypair would
    // outlive the codex lock — and after step F the engine signs with a
    // DIFFERENT key, so a stale one is a wrong-signer failure, not just a
    // hygiene issue.
    const executeUnstakeUrStoa = submitted<UnstakeUrStoaParams>("req-unstake");
    const getKeypair = getKeypairFn();
    const input = { paymentKeyAddress: SENDER, paymentPublicKey: SENDER_PUB, amount: "1" };

    await unstakeUrStoa(input, { executeUnstakeUrStoa, getKeypair });
    await unstakeUrStoa(input, { executeUnstakeUrStoa, getKeypair });

    expect(getKeypair).toHaveBeenCalledTimes(2);
    expect(getKeypair.mock.calls).toEqual([[SENDER_PUB], [SENDER_PUB]]);
  });

  it("propagates an executor failure with its message intact", async () => {
    // The engine reports the chain's own words verbatim and HALTS; a swallowed
    // or reworded message is how a user ends up re-pressing into a failure
    // nobody can diagnose.
    const executeUnstakeUrStoa = vi.fn(async () => {
      throw new Error("Insufficient staked urSTOA");
    });

    await expect(
      unstakeUrStoa(
        { paymentKeyAddress: SENDER, paymentPublicKey: SENDER_PUB, amount: "1" },
        { executeUnstakeUrStoa, getKeypair: getKeypairFn() },
      ),
    ).rejects.toThrow("Insufficient staked urSTOA");
  });
});

describe("stakeUrStoa (step E)", () => {
  it("calls the injected executor exactly once with the whole param object", async () => {
    // Same shape as C — and note the address is the one being staked ON.
    // Step E stakes over the NEW payment key, which is only reachable because
    // D already moved the liquid urSTOA there.
    const executeStakeUrStoa = submitted<StakeUrStoaParams>("req-stake");
    const getKeypair = getKeypairFn();

    const result = await stakeUrStoa(
      { paymentKeyAddress: RECEIVER, paymentPublicKey: SENDER_PUB, amount: "4.2" },
      { executeStakeUrStoa, getKeypair },
    );

    expect(executeStakeUrStoa).toHaveBeenCalledTimes(1);
    expect(executeStakeUrStoa.mock.calls[0]![0]).toEqual({
      paymentKeyAddress: RECEIVER,
      amount: "4.2",
      gasStationKey: SENDER_KEYPAIR,
    });
    expect(result).toEqual({ requestKey: "req-stake" });
  });

  it("truncates a four-decimal amount to urSTOA's three places", async () => {
    const executeStakeUrStoa = submitted<StakeUrStoaParams>("req-stake");

    await stakeUrStoa(
      { paymentKeyAddress: RECEIVER, paymentPublicKey: SENDER_PUB, amount: "9.8765" },
      { executeStakeUrStoa, getKeypair: getKeypairFn() },
    );

    expect(executeStakeUrStoa.mock.calls[0]![0]!.amount).toBe("9.876");
  });

  it("propagates an executor failure with its message intact", async () => {
    const executeStakeUrStoa = vi.fn(async () => {
      throw new Error("urSTOA vault rejected the stake");
    });

    await expect(
      stakeUrStoa(
        { paymentKeyAddress: RECEIVER, paymentPublicKey: SENDER_PUB, amount: "1" },
        { executeStakeUrStoa, getKeypair: getKeypairFn() },
      ),
    ).rejects.toThrow("urSTOA vault rejected the stake");
  });
});

describe("transferUrStoa (step D) — an EXISTING receiver", () => {
  it("calls the injected executor exactly once with the whole param object", async () => {
    // Asserting the WHOLE object, not a subset, is deliberate: a dropped
    // `isTransferFamily` silently switches which Pact family runs (Transfer vs
    // OuronetUI's Transmit), and a dropped `senderGuardKeys` entry is an
    // unsatisfied guard. `paymentKeyAddress` equals the sender because the
    // flow is patronless, and `receiverKeyset` is ABSENT (not `undefined`) for
    // an existing receiver, so the plain Transfer branch is taken.
    const executeNativeUrStoaTransfer = submitted<ExecuteNativeUrStoaParams>("req-transfer");
    const checkCoinAccountExists = vi.fn(async () => true);
    const getKeypair = getKeypairFn();

    const result = await transferUrStoa(
      {
        senderAddress: SENDER,
        senderPublicKey: SENDER_PUB,
        receiverAddress: RECEIVER,
        amount: "3.001",
      },
      { executeNativeUrStoaTransfer, checkCoinAccountExists, getKeypair },
    );

    expect(checkCoinAccountExists).toHaveBeenCalledWith(RECEIVER);
    expect(executeNativeUrStoaTransfer).toHaveBeenCalledTimes(1);
    expect(executeNativeUrStoaTransfer.mock.calls[0]![0]).toEqual({
      senderAddress: SENDER,
      receiverAddress: RECEIVER,
      amount: "3.001",
      paymentKeyAddress: SENDER,
      paymentKeypair: SENDER_KEYPAIR,
      senderGuardKeys: [SENDER_KEYPAIR],
      isTransferFamily: true,
      receiverExists: true,
    });
    expect(result).toEqual({ requestKey: "req-transfer" });
  });

  it("truncates a four-decimal amount to urSTOA's three places", async () => {
    const executeNativeUrStoaTransfer = submitted<ExecuteNativeUrStoaParams>("req-transfer");

    await transferUrStoa(
      {
        senderAddress: SENDER,
        senderPublicKey: SENDER_PUB,
        receiverAddress: RECEIVER,
        amount: "0.0009",
      },
      {
        executeNativeUrStoaTransfer,
        checkCoinAccountExists: vi.fn(async () => true),
        getKeypair: getKeypairFn(),
      },
    );

    expect(executeNativeUrStoaTransfer.mock.calls[0]![0]!.amount).toBe("0.000");
  });

  it("propagates an executor failure with its message intact", async () => {
    const executeNativeUrStoaTransfer = vi.fn(async () => {
      throw new Error("Insufficient urSTOA balance");
    });

    await expect(
      transferUrStoa(
        {
          senderAddress: SENDER,
          senderPublicKey: SENDER_PUB,
          receiverAddress: RECEIVER,
          amount: "1",
        },
        {
          executeNativeUrStoaTransfer,
          checkCoinAccountExists: vi.fn(async () => true),
          getKeypair: getKeypairFn(),
        },
      ),
    ).rejects.toThrow("Insufficient urSTOA balance");
  });
});

describe("transferUrStoa (step D) — a receiver that does NOT exist on chain", () => {
  // This is the lifted logic from `TransferUrStoaModal.tsx:142-154`, and the
  // engine needs all of it: step D's receiver is the NEW payment key's
  // address, which on a fresh codex has never existed on chain.

  it("derives a single-key keyset for a `k:` receiver and reports receiverExists: false", async () => {
    const executeNativeUrStoaTransfer = submitted<ExecuteNativeUrStoaParams>("req-anew");
    const checkCoinAccountExists = vi.fn(async () => false);

    await transferUrStoa(
      {
        senderAddress: SENDER,
        senderPublicKey: SENDER_PUB,
        receiverAddress: RECEIVER,
        amount: "5",
      },
      { executeNativeUrStoaTransfer, checkCoinAccountExists, getKeypair: getKeypairFn() },
    );

    const params = executeNativeUrStoaTransfer.mock.calls[0]![0]!;
    expect(params.receiverExists).toBe(false);
    // The bare public key — `k:` stripped. Ship the prefix and the keyset
    // guards an account nobody holds the key for.
    expect(params.receiverKeyset).toEqual({ keys: [RECEIVER_PUB], pred: "keys-all" });
  });

  it("treats an inconclusive `null` probe as does-not-exist, never as exists", async () => {
    // `checkCoinAccountExists` returns `null` for "absent OR RPC error" — both
    // collapse to uncertainty. Assuming existence on uncertainty picks the
    // plain-Transfer branch, which fails on chain for a receiver that is not
    // there; assuming non-existence picks TransferAnew, which is correct
    // either way.
    const executeNativeUrStoaTransfer = submitted<ExecuteNativeUrStoaParams>("req-anew");
    const checkCoinAccountExists = vi.fn(async () => null);

    await transferUrStoa(
      {
        senderAddress: SENDER,
        senderPublicKey: SENDER_PUB,
        receiverAddress: RECEIVER,
        amount: "5",
      },
      { executeNativeUrStoaTransfer, checkCoinAccountExists, getKeypair: getKeypairFn() },
    );

    const params = executeNativeUrStoaTransfer.mock.calls[0]![0]!;
    expect(params.receiverExists).toBe(false);
    expect(params.receiverKeyset).toEqual({ keys: [RECEIVER_PUB], pred: "keys-all" });
  });

  it("REFUSES a non-`k:` receiver before the executor is ever reached", async () => {
    // The money assertion. Only `k:` accounts can be created automatically
    // from a bare public key; for anything else there is no keyset to derive,
    // so a transaction built anyway would move urSTOA toward an account that
    // cannot be created — and, with `receiverExists: true` guessed, into a
    // Transfer that burns gas and fails. Refuse before building.
    const executeNativeUrStoaTransfer = submitted<ExecuteNativeUrStoaParams>("req-never");
    const checkCoinAccountExists = vi.fn(async () => false);

    await expect(
      transferUrStoa(
        {
          senderAddress: SENDER,
          senderPublicKey: SENDER_PUB,
          receiverAddress: "w:someWebauthnAccount:keys-all",
          amount: "5",
        },
        { executeNativeUrStoaTransfer, checkCoinAccountExists, getKeypair: getKeypairFn() },
      ),
    ).rejects.toThrow(RECEIVER_NOT_FOUND_MESSAGE);

    expect(executeNativeUrStoaTransfer).not.toHaveBeenCalled();
  });

  it("refuses a non-`k:` receiver on an inconclusive probe too", async () => {
    const executeNativeUrStoaTransfer = submitted<ExecuteNativeUrStoaParams>("req-never");

    await expect(
      transferUrStoa(
        {
          senderAddress: SENDER,
          senderPublicKey: SENDER_PUB,
          receiverAddress: "stoicname",
          amount: "5",
        },
        {
          executeNativeUrStoaTransfer,
          checkCoinAccountExists: vi.fn(async () => null),
          getKeypair: getKeypairFn(),
        },
      ),
    ).rejects.toThrow(RECEIVER_NOT_FOUND_MESSAGE);

    expect(executeNativeUrStoaTransfer).not.toHaveBeenCalled();
  });

  it("does NOT refuse an EXISTING non-`k:` receiver — the refusal is about CREATION", async () => {
    // A stoic-name account that already exists needs no keyset derived, so the
    // plain Transfer is valid. Over-refusing here would strand funds on the old
    // key for every non-`k:` account on the chain.
    const executeNativeUrStoaTransfer = submitted<ExecuteNativeUrStoaParams>("req-transfer");

    await transferUrStoa(
      {
        senderAddress: SENDER,
        senderPublicKey: SENDER_PUB,
        receiverAddress: "stoicname",
        amount: "5",
      },
      {
        executeNativeUrStoaTransfer,
        checkCoinAccountExists: vi.fn(async () => true),
        getKeypair: getKeypairFn(),
      },
    );

    expect(executeNativeUrStoaTransfer).toHaveBeenCalledTimes(1);
    expect(executeNativeUrStoaTransfer.mock.calls[0]![0]!.receiverExists).toBe(true);
  });
});

describe("the module carries no React and no chain edge (the hazard, structurally)", () => {
  const SOURCE = readFileSync(
    resolve(__dirname, "../src/zbom/execute/urStoaOps.ts"),
    "utf8",
  );

  /** Import/export…from statements, flattened across newlines. Mirrors
   *  `structural-guards.test.ts:195-208`'s own coarse-but-sufficient scan. */
  function importStatements(src: string): string[] {
    const flat = src.replace(/\r?\n/g, " ");
    const re = /\b(?:import|export)\b[\s\S]*?\bfrom\s*["']([^"']+)["']/g;
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(flat)) !== null) out.push(m[0]!);
    return out;
  }

  /** FALSE when the statement is fully type-only (erased at compile, so no
   *  runtime edge). Same rule as `structural-guards.test.ts:218-248`. */
  function isValueImport(raw: string): boolean {
    if (/^\s*(?:import|export)\s+type\b/.test(raw)) return false;
    const braces = raw.match(/\{([\s\S]*)\}/);
    if (!braces) return true;
    const specifiers = braces[1]!.split(",").map((s) => s.trim()).filter(Boolean);
    return specifiers.some((s) => !/^type\s+/.test(s));
  }

  const moduleOf = (raw: string): string => raw.match(/from\s*["']([^"']+)["']/)![1]!;

  it("the scan DISTINGUISHES import type from value import (self-check)", () => {
    // Without this the guard below could pass vacuously on a broken classifier.
    expect(isValueImport('import type { A } from "@ouronet/ouronet-core"')).toBe(false);
    expect(isValueImport('import { type A } from "@ouronet/ouronet-core"')).toBe(false);
    expect(isValueImport('import { executeStakeUrStoa } from "@ouronet/ouronet-core"')).toBe(true);
    expect(isValueImport('import * as X from "@ouronet/ouronet-core"')).toBe(true);
  });

  it("has NO value import of an executor, a reader, a signer or React", () => {
    // The injection contract, made structural. Someone "simplifying" this
    // module by importing `executeUnstakeUrStoa` directly would re-open the
    // mainnet path for every unit test in the topic — this fails instead.
    const forbidden = (mod: string): boolean =>
      mod.startsWith("@ouronet/") ||
      mod === "react" ||
      mod === "react-dom" ||
      mod.startsWith("react/") ||
      mod.startsWith("react-dom/") ||
      /^@stoachain\/stoa-core\/(reads|network|signing)$/.test(mod) ||
      /\/hooks(\/index\.js)?$/.test(mod);

    const offenders = importStatements(SOURCE)
      .filter(isValueImport)
      .map(moduleOf)
      .filter(forbidden);

    expect(offenders).toEqual([]);
  });

  it("finds the one value import it DOES need — the Pact decimal formatter", () => {
    // Proof the scan sees real statements rather than finding nothing at all,
    // and a note on the single permitted runtime edge: `formatDecimalForPact`
    // is pure string canonicalisation with no network of any kind.
    const valueModules = importStatements(SOURCE).filter(isValueImport).map(moduleOf);
    expect(valueModules).toEqual(["@stoachain/stoa-core/pact"]);
  });
});
