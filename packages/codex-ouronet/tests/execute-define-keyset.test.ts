/**
 * execute-define-keyset — the keyset-ref update
 * (docs/work/migration-execute-keyset/design.md §2), headless.
 *
 *   (define-keyset "<ns>.<ksn>" (read-keyset "ks"))
 *
 * Three properties this spec exists to pin, each of which is a real on-chain
 * failure or a silent no-op if it drifts:
 *
 *  1. **`ks` carries the NEW definition.** Shipping the CURRENT keyset
 *     redefines the keyset as itself: it succeeds, costs gas, and achieves
 *     nothing — the single most expensive way for this step to look done.
 *  2. **Self-paid gas, never the gas station.** `DALOS.GAS_PAYER`
 *     (`1_SOVEREIGN/STAGE_01/2_Core/01_DALOS.pact:456-526`) accepts only one
 *     `(coin.C_`/TALOS/DSP/STOAICO form, two forms both `(coin.C_`, or
 *     `(namespace "ouronet-ns")` + a ≥25-IGNIS donation + a `(let`.
 *     `(define-keyset …)` matches none of the three, so the sender is the
 *     payer's own account with a `coin.GAS` signer.
 *  3. **Simulate before signing.** The current keyset must satisfy the
 *     redefinition, and in a protocol-guarded namespace the chain may refuse
 *     outright (`0_Stoa/genesis/stoa-genesis-1.pact:110-113`). A refusal must
 *     cost one read and NO signature.
 *
 * ## MAINNET HAZARD — why there is not one `vi.mock` in this file
 *
 * This module is a NEW real broadcaster, and the only one in this topic that
 * changes WHO CONTROLS A KEYSET: `getFailoverClient(chainId).submit` sends a
 * live StoaChain transaction that can hand an account's ownership keyset a new
 * key list. So the module imports nothing that can reach a node — it takes its
 * client factory, its signer and its `getKeypair` on a REQUIRED
 * {@link DefineKeysetDeps} argument with NO default — and this spec passes
 * fully synthetic ones. `vi.mock` is deliberately absent, and this file passes
 * with every `vi.mock` in the repo deleted: a mock a later refactor silently
 * drops fails OPEN onto mainnet (the module still resolves and the real
 * function runs); a required injected seam cannot, because there is nothing to
 * fall back to.
 */

import { describe, it, expect, vi } from "vitest";
import { calculateAutoGasLimit } from "@stoachain/stoa-core/gas";
import { STOA_AUTONOMIC_OURONETGASSTATION } from "@ouronet/ouronet-core/constants";

import {
  buildDefineKeysetPactCode,
  submitDefineKeyset,
  type DefineKeysetChainEdge,
  type DefineKeysetRequest,
} from "../src/zbom/execute/defineKeysetOps.js";
import type { GuardSignerAnalysis } from "../src/zbom/execute/rotateOps.js";

const PAYER_PUB = "a".repeat(64);
const PAYER_ADDRESS = `k:${PAYER_PUB}`;
const CURRENT_1 = "b".repeat(64);
const CURRENT_2 = "c".repeat(64);
const CURRENT_3 = "d".repeat(64);
const FOREIGN_1 = "e".repeat(64);
const NEW_1 = "f".repeat(64);
const NEW_2 = "1".repeat(64);
const KEYSET_REF = "ouronet-ns.dh_ah-keyset";

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
function keysetEdge(
  simulation: { result: { status: string; error?: unknown }; gas?: number } = {
    result: { status: "success" },
    gas: 1234,
  },
): DefineKeysetChainEdge & {
  dirtyRead: ReturnType<typeof vi.fn>;
  submit: ReturnType<typeof vi.fn>;
  getClient: ReturnType<typeof vi.fn>;
  signTransaction: ReturnType<typeof vi.fn>;
} {
  const dirtyRead = vi.fn(async () => simulation);
  const submit = vi.fn(async () => ({ requestKey: "req-define-keyset" }));
  const getClient = vi.fn(() => ({ dirtyRead, submit }));
  const signTransaction = vi.fn(async (tx: unknown) => tx);
  return { getClient, signTransaction, dirtyRead, submit } as never;
}

/** The CURRENT keyset, as the pre-press gate resolved it: two keys this codex
 *  holds, a 2-of-N predicate. */
const CURRENT_ANALYSIS: GuardSignerAnalysis = {
  codexKeys: [CURRENT_1, CURRENT_2],
  resolvedForeignKeys: [],
  threshold: 2,
};

function request(overrides: Partial<DefineKeysetRequest> = {}): DefineKeysetRequest {
  return {
    keysetRef: KEYSET_REF,
    // The NEW definition — what the keyset becomes.
    newKeyset: { keys: [NEW_1, NEW_2], pred: "keys-any" },
    payerAddress: PAYER_ADDRESS,
    payerKey: { publicKey: PAYER_PUB, privateKey: "payer-priv" },
    chainId: "0",
    currentKeysetAnalysis: CURRENT_ANALYSIS,
    ...overrides,
  };
}

/** Every `getKeypair` answer is synthetic; a pubkey this codex does not hold
 *  answers `null`, exactly as the real resolver's "not mine" does. */
function getKeypairFor(held: readonly string[]) {
  return vi.fn(async (publicKey: string) =>
    held.includes(publicKey) ? { publicKey, privateKey: `${publicKey.slice(0, 1)}-priv` } : null,
  );
}

describe("defineKeysetOps — the pact code", () => {
  it("emits the single qualified form with the ref spliced in", () => {
    expect(buildDefineKeysetPactCode(KEYSET_REF)).toBe(
      `(define-keyset "${KEYSET_REF}" (read-keyset "ks"))`,
    );
  });
});

describe("defineKeysetOps — the keyset-ref update", () => {
  it("submits the qualified define-keyset with the NEW keys and pred in `ks`, self-paid, with the current keyset's signers", async () => {
    const edge = keysetEdge();
    const getKeypair = getKeypairFor([CURRENT_1, CURRENT_2, PAYER_PUB]);
    const result = await submitDefineKeyset(request(), { getKeypair, edge });

    expect(result).toEqual({ requestKey: "req-define-keyset" });
    expect(edge.getClient).toHaveBeenCalledWith("0");
    expect(edge.submit).toHaveBeenCalledTimes(1);

    const { code, data, meta, signers } = decode(edge.submit.mock.calls[0][0]);
    expect(code).toBe(`(define-keyset "${KEYSET_REF}" (read-keyset "ks"))`);
    // The NEW definition, and ONLY `{ keys, pred }` — a resolved guard also
    // carries a `keysetRef` annotation, which is not part of a keyset.
    expect(data?.ks).toEqual({ keys: [NEW_1, NEW_2], pred: "keys-any" });
    // Self-paid: the payer's own account, never the gas station, which cannot
    // sponsor this shape at all.
    expect(meta.sender).toBe(PAYER_ADDRESS);
    expect(meta.sender).not.toBe(STOA_AUTONOMIC_OURONETGASSTATION);
    expect(JSON.stringify(signers)).not.toContain("GAS_PAYER");

    expect(signers.map((s) => s.pubKey)).toEqual([PAYER_PUB, CURRENT_1, CURRENT_2]);
    expect(signers[0]?.clist).toEqual([{ name: "coin.GAS", args: [] }]);
    // The current keyset's keys are PURE signers: `define-keyset` is gated by
    // `enforce-keyset`, which reads the signer set, not a capability.
    expect(signers[1]?.clist ?? []).toEqual([]);
    expect(signers[2]?.clist ?? []).toEqual([]);
  });

  it("never ships the CURRENT keyset as the new definition — that would redefine the keyset as itself and look like success", async () => {
    const edge = keysetEdge();
    await submitDefineKeyset(request(), { getKeypair: getKeypairFor([CURRENT_1, CURRENT_2]), edge });

    const { data } = decode(edge.submit.mock.calls[0][0]);
    const ks = data?.ks as { keys: string[]; pred: string };
    expect(ks.keys).not.toContain(CURRENT_1);
    expect(ks.keys).not.toContain(CURRENT_2);
    expect(ks.pred).toBe("keys-any");
  });

  it("stops collecting the current keyset's signers at its predicate threshold", async () => {
    const edge = keysetEdge();
    const getKeypair = getKeypairFor([CURRENT_1, CURRENT_2, CURRENT_3, FOREIGN_1]);
    await submitDefineKeyset(
      request({
        // Four keys available, 2-of-4: signing with more keys than the guard
        // requires is how a transaction gets rejected for an unexpected
        // signer set. `collectGuardSigners` owns that rule — this asserts the
        // module did not write a second threshold walk.
        currentKeysetAnalysis: {
          codexKeys: [CURRENT_1, CURRENT_2, CURRENT_3],
          resolvedForeignKeys: [FOREIGN_1],
          threshold: 2,
        },
      }),
      { getKeypair, edge },
    );

    const { signers } = decode(edge.submit.mock.calls[0][0]);
    expect(signers.map((s) => s.pubKey)).toEqual([PAYER_PUB, CURRENT_1, CURRENT_2]);
    expect(getKeypair).not.toHaveBeenCalledWith(CURRENT_3);
  });

  it("prefers a hand-supplied private key over the codex's own for the same public key", async () => {
    const edge = keysetEdge();
    const getKeypair = getKeypairFor([CURRENT_1, CURRENT_2]);
    await submitDefineKeyset(
      request({
        currentKeysetAnalysis: { codexKeys: [CURRENT_1], resolvedForeignKeys: [FOREIGN_1], threshold: 2 },
        manualKeys: { [CURRENT_1]: "manual-priv-1", [FOREIGN_1]: "manual-priv-foreign" },
      }),
      { getKeypair, edge },
    );

    expect(getKeypair).not.toHaveBeenCalledWith(CURRENT_1);
    expect(edge.signTransaction.mock.calls[0][1]).toEqual([
      { publicKey: PAYER_PUB, privateKey: "payer-priv" },
      { publicKey: CURRENT_1, privateKey: "manual-priv-1" },
      { publicKey: FOREIGN_1, privateKey: "manual-priv-foreign" },
    ]);
  });

  it("lists a payer who is ALSO one of the current keyset's keys exactly once, and signs with that keypair once", async () => {
    const edge = keysetEdge();
    // The common real case: the account's registered payment key is also one
    // of its keyset's keys. Two signer entries for one public key, or a
    // duplicated keypair, breaks the signature/signer correspondence of the
    // submitted command.
    const getKeypair = getKeypairFor([PAYER_PUB, CURRENT_1]);
    await submitDefineKeyset(
      request({
        currentKeysetAnalysis: { codexKeys: [PAYER_PUB, CURRENT_1], resolvedForeignKeys: [], threshold: 2 },
      }),
      { getKeypair, edge },
    );

    const { signers } = decode(edge.submit.mock.calls[0][0]);
    expect(signers.map((s) => s.pubKey)).toEqual([PAYER_PUB, CURRENT_1]);
    // The payer's entry keeps `coin.GAS` — the gas grant must not be dropped
    // by the dedup.
    expect(signers[0]?.clist).toEqual([{ name: "coin.GAS", args: [] }]);
    const signedWith = edge.signTransaction.mock.calls[0][1] as Array<{ publicKey: string }>;
    expect(signedWith.map((k) => k.publicKey)).toEqual([PAYER_PUB, CURRENT_1]);
  });

  it("throws the chain's own simulation message and NEVER signs or submits — a closed namespace costs one read and no signature", async () => {
    const edge = keysetEdge({
      result: {
        status: "failure",
        error: { message: "Keyset failure (keys-all): 'ns-operate-keyset" },
      },
    });

    const thrown = await submitDefineKeyset(request(), {
      getKeypair: getKeypairFor([CURRENT_1, CURRENT_2]),
      edge,
    }).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(thrown).toBeInstanceOf(Error);
    const failure = thrown as Error;

    // The chain's OWN words must survive into the thrown message, because
    // they are the whole diagnosis: "Keyset failure" on a protocol-guarded
    // namespace and "Keyset failure" on an unsatisfied current keyset are
    // different problems with different fixes. `createSimulationError`
    // CLASSIFIES any message containing "keyset"/"guard" and REPLACES it with
    // a generic sentence (`transactionErrors.js`'s KEYSET_ERROR branch),
    // keeping the original only on `originalError` — which is why this module
    // re-surfaces it rather than throwing the factory's error as-is, the way
    // its siblings legitimately can.
    expect(failure.message).toMatch(/keyset failure \(keys-all\)/i);
    expect(failure.message).toMatch(/update keyset definition/i);
    // The classified error is still attached, with its code and suggestions.
    expect((failure.cause as { code?: string })?.code).toBe("KEYSET_ERROR");
    expect(edge.signTransaction).not.toHaveBeenCalled();
    expect(edge.submit).not.toHaveBeenCalled();
  });

  it("refuses a keyset reference carrying characters that could break out of the Pact string literal, before the client is even obtained", async () => {
    const edge = keysetEdge();
    await expect(
      submitDefineKeyset(
        request({ keysetRef: `free.x" (coin.C_Transfer "a" "b" 1.0) (define-keyset "y` }),
        { getKeypair: getKeypairFor([CURRENT_1, CURRENT_2]), edge },
      ),
    ).rejects.toThrow(/keyset reference/i);
    expect(edge.getClient).not.toHaveBeenCalled();
    expect(edge.submit).not.toHaveBeenCalled();
  });

  it("recalibrates the gas limit from the simulation's reported gas, and puts the live gas floor on the wire", async () => {
    const edge = keysetEdge({ result: { status: "success" }, gas: 1234 });
    await submitDefineKeyset(request(), { getKeypair: getKeypairFor([CURRENT_1, CURRENT_2]), edge });

    const simulated = decode(edge.dirtyRead.mock.calls[0][0]);
    const submitted = decode(edge.submit.mock.calls[0][0]);
    expect(submitted.meta.gasLimit).toBe(calculateAutoGasLimit(1234));
    expect(submitted.meta.gasLimit).not.toBe(simulated.meta.gasLimit);
    // Self-paid gas is the USER's STOA, so an under-priced command that
    // chainweb rejects wastes their money twice.
    expect(submitted.meta.gasPrice).toBeGreaterThan(0);
    expect(submitted.meta.creationTime).toBeGreaterThan(0);
  });
});
