/**
 * execute-collect-unstake-urstoa — step C of the migration chain, as ONE
 * transaction (docs/work/migration-execute-keyset/design.md §1).
 *
 * Collect THEN Unstake, two `(coin.C_` forms on one gas-station-sponsored
 * transaction, with `DALOS.GAS_PAYER`, `coin.URV|COLLECT` and
 * `coin.URV|UNSTAKE` on the single signer. Three properties this spec exists
 * to pin, each of which is a real on-chain failure if it drifts:
 *
 *  1. **The ORDER.** Collect releases rewards into the account's NATIVE STOA
 *     balance and must land before the unstake row for the design's
 *     "nothing stranded" claim to hold. A swapped pair looks identical in a
 *     diff and is wrong.
 *  2. **The Collect row is CONDITIONAL.** `C_URV|Collect` → `C_Transmit` →
 *     `debit` → `UEV_Amount` enforces `(> amount 0.0)`
 *     (`coin-live.pact:1475,593-598,708-721,414-418`), so a Collect with zero
 *     claimable rewards fails the WHOLE transaction — it would take the
 *     unstake down with it for every account with no pending rewards, the
 *     common case.
 *  3. **Exactly TWO forms, both `(coin.C_`, never three.** That is the only
 *     gas-station case this shape fits (`01_DALOS.pact:487-496`, Case 2);
 *     three `(coin.C_` forms match no case at all, which is why
 *     `executeCollectUrStoa`'s `(coin.C_CreateAccount …)` prelude can never
 *     be bundled here.
 *
 * ## MAINNET HAZARD — why there is not one `vi.mock` in this file
 *
 * This module is a NEW real broadcaster: `getFailoverClient(chainId).submit`
 * sends a live StoaChain transaction that moves a user's staked urSTOA and
 * their claimable rewards. So the module imports nothing that can reach a
 * node: it takes its client factory and its signer on a REQUIRED
 * {@link CollectUnstakeChainEdge} argument with NO default, and this spec
 * passes a fully synthetic one. `vi.mock` is deliberately absent, and this
 * file passes with every `vi.mock` in the repo deleted — a mock a later
 * refactor silently drops fails OPEN onto mainnet (the module still resolves
 * and the real function runs); a required injected seam cannot, because there
 * is nothing to fall back to. The only real imports are
 * `calculateAutoGasLimit` (pure arithmetic), two constants, and the module
 * under test.
 */

import { describe, it, expect, vi } from "vitest";
import { calculateAutoGasLimit } from "@stoachain/stoa-core/gas";
import {
  KADENA_NAMESPACE as STOACHAIN_NAMESPACE,
  STOA_AUTONOMIC_OURONETGASSTATION,
} from "@ouronet/ouronet-core/constants";

import {
  buildCollectUnstakePactCode,
  collectAndUnstakeUrStoa,
  type CollectUnstakeChainEdge,
  type CollectUnstakeRequest,
} from "../src/zbom/execute/collectUnstakeUrStoa.js";

const PAYMENT_PUB = "a".repeat(64);
const PAYMENT_ADDRESS = `k:${PAYMENT_PUB}`;

interface CapturedCommand {
  code: string;
  data: Record<string, unknown>;
  meta: Record<string, unknown>;
  signers: Array<{ pubKey: string; clist?: Array<{ name: string; args: unknown[] }> }>;
}

function decode(tx: unknown): CapturedCommand {
  const parsed = JSON.parse((tx as { cmd: string }).cmd);
  return {
    code: parsed.payload.exec.code,
    data: parsed.payload.exec.data,
    meta: parsed.meta,
    signers: parsed.signers,
  };
}

/** A synthetic chain edge: the client is a pair of `vi.fn()`s and
 *  `signTransaction` hands the built command straight back, so the spec can
 *  decode exactly what WOULD have been signed and submitted. */
function vaultEdge(
  simulation: { result: { status: string; error?: unknown }; gas?: number } = {
    result: { status: "success" },
    gas: 1234,
  },
): CollectUnstakeChainEdge & {
  dirtyRead: ReturnType<typeof vi.fn>;
  submit: ReturnType<typeof vi.fn>;
  getClient: ReturnType<typeof vi.fn>;
  signTransaction: ReturnType<typeof vi.fn>;
} {
  const dirtyRead = vi.fn(async () => simulation);
  const submit = vi.fn(async () => ({ requestKey: "req-collect-unstake" }));
  const getClient = vi.fn(() => ({ dirtyRead, submit }));
  const signTransaction = vi.fn(async (tx: unknown) => tx);
  return { getClient, signTransaction, dirtyRead, submit } as never;
}

const REQUEST: CollectUnstakeRequest = {
  paymentKeyAddress: PAYMENT_ADDRESS,
  amount: "12.5",
  collectRewards: true,
  // Patronless family: the account's OWN payment keypair signs GAS_PAYER —
  // the gas STATION is the sender ACCOUNT, not the holder of this secret.
  paymentKey: { publicKey: PAYMENT_PUB, privateKey: "payment-priv" },
};

describe("collectUnstakeUrStoa — the pact code", () => {
  it("emits Collect THEN Unstake, exactly two lines, when rewards are being collected", () => {
    expect(buildCollectUnstakePactCode({ account: PAYMENT_ADDRESS, amount: "12.5", collectRewards: true })).toBe(
      `(coin.C_URV|Collect "${PAYMENT_ADDRESS}")\n(coin.C_URV|Unstake "${PAYMENT_ADDRESS}" 12.5)`,
    );
  });

  it("emits ONLY the Unstake line, with no Collect at all, when there are no rewards to collect", () => {
    const code = buildCollectUnstakePactCode({
      account: PAYMENT_ADDRESS,
      amount: "12.5",
      collectRewards: false,
    });
    expect(code).toBe(`(coin.C_URV|Unstake "${PAYMENT_ADDRESS}" 12.5)`);
    expect(code).not.toContain("Collect");
    expect(code.split("\n")).toHaveLength(1);
  });

  it("never emits C_CreateAccount, and every form starts `(coin.C_` — the gas station's Case-2 contract", () => {
    for (const collectRewards of [true, false]) {
      const lines = buildCollectUnstakePactCode({
        account: PAYMENT_ADDRESS,
        amount: "12.5",
        collectRewards,
      }).split("\n");
      // Three `(coin.C_` forms match NO gas-station case (`01_DALOS.pact:456-526`),
      // so the `C_CreateAccount` repair `executeCollectUrStoa` applies is
      // unavailable here — the caller passes `collectRewards: false` instead.
      expect(lines.length).toBeLessThanOrEqual(2);
      for (const line of lines) {
        expect(line.startsWith("(coin.C_")).toBe(true);
        expect(line).not.toContain("C_CreateAccount");
      }
    }
  });
});

describe("collectUnstakeUrStoa — step C, one sponsored transaction", () => {
  it("submits both rows with all three capabilities on ONE signer, gas paid by the gas-station ACCOUNT", async () => {
    const edge = vaultEdge();
    const result = await collectAndUnstakeUrStoa(REQUEST, edge);

    expect(result).toEqual({ requestKey: "req-collect-unstake" });
    // urSTOA is chain-0-only by contract (`UEV_ChainZero`), so the chain is
    // not a parameter a caller can get wrong.
    expect(edge.getClient).toHaveBeenCalledWith("0");
    const { code, meta, signers } = decode(edge.submit.mock.calls[0][0]);
    expect(code).toBe(
      `(coin.C_URV|Collect "${PAYMENT_ADDRESS}")\n(coin.C_URV|Unstake "${PAYMENT_ADDRESS}" 12.5)`,
    );
    expect(meta.sender).toBe(STOA_AUTONOMIC_OURONETGASSTATION);
    expect(meta.chainId).toBe("0");
    // ONE signer, three capabilities. Both `URV|*` capabilities are @managed
    // with no manager function (`coin-live.pact:1251,1269`), so each is
    // brought into scope once per transaction and both on one signer is
    // correct.
    expect(signers).toHaveLength(1);
    expect(signers[0]?.pubKey).toBe(PAYMENT_PUB);
    expect(signers[0]?.clist).toEqual([
      { name: `${STOACHAIN_NAMESPACE}.DALOS.GAS_PAYER`, args: ["", { int: 0 }, { decimal: "0.0" }] },
      { name: "coin.URV|COLLECT", args: [PAYMENT_ADDRESS] },
      { name: "coin.URV|UNSTAKE", args: [PAYMENT_ADDRESS, { decimal: "12.5" }] },
    ]);
  });

  it("omits coin.URV|COLLECT from the signer when the Collect row is omitted — never a signature over a capability the code does not require", async () => {
    const edge = vaultEdge();
    await collectAndUnstakeUrStoa({ ...REQUEST, collectRewards: false }, edge);

    const { code, signers } = decode(edge.submit.mock.calls[0][0]);
    expect(code).toBe(`(coin.C_URV|Unstake "${PAYMENT_ADDRESS}" 12.5)`);
    expect(signers[0]?.clist).toEqual([
      { name: `${STOACHAIN_NAMESPACE}.DALOS.GAS_PAYER`, args: ["", { int: 0 }, { decimal: "0.0" }] },
      { name: "coin.URV|UNSTAKE", args: [PAYMENT_ADDRESS, { decimal: "12.5" }] },
    ]);
    expect(signers[0]?.clist?.map((c) => c.name)).not.toContain("coin.URV|COLLECT");
  });

  it("truncates a fourth decimal off the amount, and puts the SAME string in the code and in the capability", async () => {
    const edge = vaultEdge();
    // urSTOA carries 3 decimals; `formatDecimalForPact` TRUNCATES rather than
    // rounds, because rounding UP would ask the vault for more than is staked.
    await collectAndUnstakeUrStoa({ ...REQUEST, amount: "12.5679" }, edge);

    const { code, signers } = decode(edge.submit.mock.calls[0][0]);
    expect(code).toContain(`(coin.C_URV|Unstake "${PAYMENT_ADDRESS}" 12.567)`);
    expect(code).not.toContain("12.5679");
    expect(signers[0]?.clist?.[2]).toEqual({
      name: "coin.URV|UNSTAKE",
      args: [PAYMENT_ADDRESS, { decimal: "12.567" }],
    });
  });

  it("recalibrates the gas limit from the simulation's reported gas rather than submitting the initial guess", async () => {
    const edge = vaultEdge({ result: { status: "success" }, gas: 1234 });
    await collectAndUnstakeUrStoa(REQUEST, edge);

    const simulated = decode(edge.dirtyRead.mock.calls[0][0]);
    const submitted = decode(edge.submit.mock.calls[0][0]);
    expect(submitted.meta.gasLimit).toBe(calculateAutoGasLimit(1234));
    expect(submitted.meta.gasLimit).not.toBe(simulated.meta.gasLimit);
    // The Yin Engine floor must be on the wire, not Pact's 1e-8 default.
    expect(submitted.meta.gasPrice).toBeGreaterThan(0);
    expect(submitted.meta.creationTime).toBeGreaterThan(0);
  });

  it("throws on a failed simulation and never signs or submits — a vault move that cannot simulate must not be broadcast", async () => {
    const edge = vaultEdge({
      result: { status: "failure", error: { message: "At least 1.0 URSTOA must remain in the URSTOA-Vault" } },
    });

    await expect(collectAndUnstakeUrStoa(REQUEST, edge)).rejects.toThrow(/at least 1\.0 urstoa must remain/i);
    expect(edge.signTransaction).not.toHaveBeenCalled();
    expect(edge.submit).not.toHaveBeenCalled();
  });

  it("refuses an account name carrying characters that could break out of the Pact string literal, before the client is even obtained", async () => {
    const edge = vaultEdge();
    await expect(
      collectAndUnstakeUrStoa(
        { ...REQUEST, paymentKeyAddress: `k:${PAYMENT_PUB}" (coin.C_Transfer "x` },
        edge,
      ),
    ).rejects.toThrow(/aren't allowed in an account name/i);
    expect(edge.getClient).not.toHaveBeenCalled();
    expect(edge.submit).not.toHaveBeenCalled();
  });

  it("signs with the payment keypair only — the single signer the sponsored shape declares", async () => {
    const edge = vaultEdge();
    await collectAndUnstakeUrStoa(REQUEST, edge);

    expect(edge.signTransaction).toHaveBeenCalledTimes(1);
    expect(edge.signTransaction.mock.calls[0][1]).toEqual([REQUEST.paymentKey]);
  });
});

describe("the execute barrel reaches both new builders", () => {
  it("re-exports step C's merged builder and the keyset-ref update, with their live edges", async () => {
    // WHY: `./zbom` is the ONLY subpath this topic ships through (no new
    // `package.json` `exports` entry — `guard-subpath-resolution.test.ts`
    // imports every declared one from a `dist/` the test env does not build).
    // A module missing from this barrel is reachable only by a deep relative
    // path into another package's `src/`, which is exactly what the barrel
    // exists to prevent. `execute-engine.test.ts`'s own barrel test pins the
    // same invariant for every module that predates these two.
    const barrel = await import("../src/zbom/execute/index.js");

    expect(Object.keys(barrel)).toEqual(
      expect.arrayContaining([
        "collectAndUnstakeUrStoa",
        "buildCollectUnstakePactCode",
        "liveCollectUnstakeChainEdge",
        "submitDefineKeyset",
        "buildDefineKeysetPactCode",
        "liveDefineKeysetChainEdge",
      ]),
    );
  });
});
