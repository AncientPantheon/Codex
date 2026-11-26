/**
 * execute-stoa-transfers — steps A and B of the migration chain
 * (docs/work/migration-execute/design.md §2), headless.
 *
 * A is the cross-chain mover that consolidation runs up to NINE times
 * (chains 1-9 → chain 0), extracted from `ui/internal/SendStoaModal.tsx`'s
 * `handleSubmit` rather than re-implemented: a ~110-line 3-step dependent
 * chain with four distinct failure modes, one of which ("pending") is
 * deliberately worded so a user never resubmits a transfer that may still
 * land. B is the same-chain drain, given the dedup-safe `getFailoverClient`
 * pipeline the modal's `execute()` path does not have.
 *
 * ## MAINNET HAZARD — why there is not one `vi.mock` in this file
 *
 * Every chain function these two modules touch is a REAL broadcast against
 * StoaChain mainnet:
 *   - `submitCrossChainTransfer` — `crossChainFunctions.js:195`
 *   - `submitContinuation`       — `crossChainFunctions.js:382`
 *   - `getFailoverClient(chainId).submit` — the pipeline B now uses
 * and A is the step that runs up to nine times in one press.
 *
 * So neither module imports any of them: both take their chain edge on an
 * explicit, REQUIRED `deps`/`edge` argument, and this spec passes fully
 * synthetic ones. `vi.mock` is deliberately absent — a mock that a later
 * refactor silently drops fails OPEN onto mainnet (the module still resolves,
 * the real function runs); a required injected seam cannot fail that way,
 * because there is no default to fall back to. The only real imports here are
 * `calculateAutoGasLimit` (pure arithmetic) and the modules under test.
 */

import { describe, it, expect, vi } from "vitest";
import { calculateAutoGasLimit } from "@stoachain/stoa-core/gas";
import {
  KADENA_NAMESPACE as STOACHAIN_NAMESPACE,
  STOA_AUTONOMIC_OURONETGASSTATION,
} from "@ouronet/ouronet-core/constants";

import {
  runCrossChainStoaTransfer,
  createSignedCrossChainInitiate,
  offsetStepReporter,
  type CrossChainStoaTransferDeps,
  type CrossChainStoaTransferRequest,
} from "../src/zbom/execute/crossChainStoaTransfer.js";
import {
  buildNativeStoaTransferPactCode,
  drainAmountForPact,
  submitNativeStoaTransfer,
  type NativeStoaChainEdge,
} from "../src/zbom/execute/nativeStoaTransfer.js";

const SENDER_PUB = "a".repeat(64);
const SENDER = `k:${SENDER_PUB}`;
const RECEIVER_PUB = "b".repeat(64);
const RECEIVER = `k:${RECEIVER_PUB}`;
const GAS_STATION_PUB = "c".repeat(64);

const CROSS_REQUEST: CrossChainStoaTransferRequest = {
  sender: SENDER,
  receiver: RECEIVER,
  amount: "5.0",
  sourceChain: "3",
  targetChain: "0",
};

/** A fully-synthetic chain edge for the cross-chain runner. Every member is
 *  a `vi.fn()` — nothing here can reach a node. */
function crossChainDeps(
  overrides: Partial<CrossChainStoaTransferDeps> = {},
): CrossChainStoaTransferDeps & { onStep: ReturnType<typeof vi.fn> } {
  return {
    submitInitiate: vi.fn(async () => ({ requestKey: "req-initiate" })),
    awaitInitiateVerdict: vi.fn(async () => ({ verdict: "success" as const })),
    pollSpvProof: vi.fn(async () => ({ proof: "spv-proof-blob" })),
    buildContinuationTransaction: vi.fn(() => ({ cont: true })),
    submitContinuation: vi.fn(async () => ({ requestKey: "req-continuation" })),
    onStep: vi.fn(),
    ...overrides,
  } as CrossChainStoaTransferDeps & { onStep: ReturnType<typeof vi.fn> };
}

describe("crossChainStoaTransfer — step A, the 3-step dependent chain", () => {
  it("happy path: returns both request keys, and drives the flow in order through the injected seams", async () => {
    const deps = crossChainDeps();
    const result = await runCrossChainStoaTransfer(CROSS_REQUEST, deps);

    expect(result).toEqual({
      ok: true,
      requestKey: "req-initiate",
      continuationRequestKey: "req-continuation",
    });
    // The receiver keyset is derived from the receiver's own k: pubkey and
    // ALWAYS supplied — a receiver may not exist on the TARGET chain yet even
    // if it exists elsewhere (chain accounts are independent).
    expect(deps.submitInitiate).toHaveBeenCalledWith({
      ...CROSS_REQUEST,
      receiverGuard: { keys: [RECEIVER_PUB], pred: "keys-all" },
    });
    expect(deps.awaitInitiateVerdict).toHaveBeenCalledWith("req-initiate", "3");
    expect(deps.pollSpvProof).toHaveBeenCalledWith("req-initiate", "3", "0");
    expect(deps.buildContinuationTransaction).toHaveBeenCalledWith("req-initiate", "spv-proof-blob", "0");
    expect(deps.submitContinuation).toHaveBeenCalledWith({ cont: true }, "0");
  });

  it("drives onStep with exactly (0,active) (0,done) (1,done) and leaves step 2 un-done — `submitContinuation` only confirms mempool acceptance", async () => {
    const deps = crossChainDeps();
    await runCrossChainStoaTransfer(CROSS_REQUEST, deps);

    expect(deps.onStep.mock.calls).toEqual([
      // The real request key is attached the MOMENT one exists, so a user who
      // opens the toast mid-flow can already copy it.
      [0, "active", { requestKey: "req-initiate" }],
      [0, "done", { requestKey: "req-initiate" }],
      [1, "done"],
    ]);
    // Deliberate: the continuation landing the funds is confirmed by a
    // separate poll, never by the submit returning.
    expect(deps.onStep).not.toHaveBeenCalledWith(2, "done", expect.anything());
    expect(deps.onStep).not.toHaveBeenCalledWith(2, "done");
  });

  it("hands the continuation's request key to the injected tracker (fire-and-forget) rather than awaiting it", async () => {
    const onContinuationSubmitted = vi.fn();
    const deps = crossChainDeps({ onContinuationSubmitted });
    const result = await runCrossChainStoaTransfer(CROSS_REQUEST, deps);

    expect(result.ok).toBe(true);
    expect(onContinuationSubmitted).toHaveBeenCalledWith(2, "req-continuation", "0");
  });

  it("a `failure` verdict returns kind `initiate-failed`, carries the chain's own message verbatim, and never reaches the SPV wait", async () => {
    const deps = crossChainDeps({
      awaitInitiateVerdict: vi.fn(async () => ({
        verdict: "failure" as const,
        message: "insufficient funds in account k:aaa",
      })),
    });
    const result = await runCrossChainStoaTransfer(CROSS_REQUEST, deps);

    expect(result).toEqual({
      ok: false,
      kind: "initiate-failed",
      requestKey: "req-initiate",
      message: "insufficient funds in account k:aaa",
    });
    expect(deps.pollSpvProof).not.toHaveBeenCalled();
    expect(deps.onStep).toHaveBeenCalledWith(0, "error", { label: "insufficient funds in account k:aaa" });
  });

  it("a `pending` verdict is a DISTINCT kind from a failure, and its message must never read as a hard failure — a slow-but-still-landing initiate must not invite a resubmit", async () => {
    const deps = crossChainDeps({
      awaitInitiateVerdict: vi.fn(async () => ({ verdict: "pending" as const })),
    });
    const result = await runCrossChainStoaTransfer(CROSS_REQUEST, deps);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.kind).toBe("initiate-pending");
    // The wording discipline, asserted the same way
    // `ui-send-stoa-modal.test.tsx:740-741` asserts it on the DOM.
    expect(result.message).toMatch(/still confirming/i);
    expect(result.message).not.toMatch(/did not confirm/i);
    // The facts a user needs to check it themselves instead of resubmitting.
    expect(result.message).toContain("req-initiate");
    expect(result.message).toContain("chain 3");
    expect(deps.pollSpvProof).not.toHaveBeenCalled();
  });

  it("returns kind `spv-timeout` when no proof arrives, and NEVER builds or submits the continuation after that", async () => {
    const deps = crossChainDeps({
      pollSpvProof: vi.fn(async () => ({ proof: null, error: "Timed out waiting for the SPV proof." })),
    });
    const result = await runCrossChainStoaTransfer(CROSS_REQUEST, deps);

    expect(result).toEqual({
      ok: false,
      kind: "spv-timeout",
      requestKey: "req-initiate",
      message: "Timed out waiting for the SPV proof.",
    });
    // The initiate step already succeeded — step 1 is the one that failed.
    expect(deps.onStep).toHaveBeenCalledWith(1, "error", { label: "Timed out waiting for the SPV proof." });
    expect(deps.buildContinuationTransaction).not.toHaveBeenCalled();
    expect(deps.submitContinuation).not.toHaveBeenCalled();
  });

  it("refuses a non-k: receiver BEFORE any submit — the receiver is spliced into a Pact string literal downstream", async () => {
    const deps = crossChainDeps();
    const result = await runCrossChainStoaTransfer({ ...CROSS_REQUEST, receiver: "u:some-non-k-account" }, deps);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.kind).toBe("invalid-receiver");
    expect(deps.submitInitiate).not.toHaveBeenCalled();
    expect(deps.awaitInitiateVerdict).not.toHaveBeenCalled();
  });

  it("offsetStepReporter maps the flow's own 0/1/2 onto the engine's n..n+2, passing status and data through untouched", () => {
    const engineOnStep = vi.fn();
    const reporter = offsetStepReporter(engineOnStep, 4);

    reporter(0, "active", { requestKey: "rk" });
    reporter(1, "done");
    reporter(2, "error", { label: "boom" });

    expect(engineOnStep.mock.calls).toEqual([
      [4, "active", { requestKey: "rk" }],
      // No third argument, not an explicit `undefined` — see offsetStepReporter.
      [5, "done"],
      [6, "error", { label: "boom" }],
    ]);
  });

  it("the engine's ready-made initiate signs with the SENDER's own keypair and submits through the injected submitter — never through execute()", async () => {
    // Real command SHAPES (`cmd`/`hash`/`sigs`), so the injected seams match
    // the signer's own types without a cast weakening them.
    const unsignedTx = { cmd: "unsigned-tx", hash: "hash-unsigned", sigs: [] };
    const signedTx = { cmd: "signed-tx", hash: "hash-signed", sigs: [{ sig: "sig" }] };
    const keypair = { publicKey: SENDER_PUB, privateKey: "priv" };
    const getKeypair = vi.fn(async () => keypair);
    const sign = vi.fn(async () => signedTx);
    const buildCTransferAcross = vi.fn(() => unsignedTx);
    const submitCrossChainTransfer = vi.fn(async () => ({ requestKey: "req-xchain" }));

    const initiate = createSignedCrossChainInitiate({
      senderPublicKey: SENDER_PUB,
      getKeypair,
      sign,
      buildCTransferAcross,
      submitCrossChainTransfer,
    });

    const submission = await initiate({
      ...CROSS_REQUEST,
      receiverGuard: { keys: [RECEIVER_PUB], pred: "keys-all" },
    });

    expect(submission).toEqual({ requestKey: "req-xchain" });
    expect(buildCTransferAcross).toHaveBeenCalledWith({
      sender: SENDER,
      receiver: RECEIVER,
      receiverGuard: { keys: [RECEIVER_PUB], pred: "keys-all" },
      amount: "5.0",
      sourceChain: "3",
      targetChain: "0",
      senderPublicKey: SENDER_PUB,
    });
    expect(getKeypair).toHaveBeenCalledWith(SENDER_PUB);
    // `capsKey` is the sender's own keypair and there are NO guard keypairs:
    // off chain 0 the gas is paid by `stoa-xchain-gas` (unsigned), so the
    // sender is the only signer there is.
    expect(sign).toHaveBeenCalledWith({ tx: unsignedTx, capsKey: keypair, guardKeypairs: [] });
    expect(submitCrossChainTransfer).toHaveBeenCalledWith(signedTx, "3");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step B — the same-chain drain
// ─────────────────────────────────────────────────────────────────────────────

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

/** A synthetic chain edge: the client is a pair of `vi.fn()`s, and
 *  `signTransaction` hands the built command straight back so the spec can
 *  decode exactly what WOULD have been signed and submitted. */
function nativeEdge(
  simulation: { result: { status: string; error?: unknown }; gas?: number } = {
    result: { status: "success" },
    gas: 1234,
  },
): NativeStoaChainEdge & {
  dirtyRead: ReturnType<typeof vi.fn>;
  submit: ReturnType<typeof vi.fn>;
  getClient: ReturnType<typeof vi.fn>;
  signTransaction: ReturnType<typeof vi.fn>;
} {
  const dirtyRead = vi.fn(async () => simulation);
  const submit = vi.fn(async () => ({ requestKey: "req-drain" }));
  const getClient = vi.fn(() => ({ dirtyRead, submit }));
  const signTransaction = vi.fn(async (tx: unknown) => tx);
  return { getClient, signTransaction, dirtyRead, submit } as never;
}

const DRAIN_REQUEST = {
  sender: SENDER,
  receiver: RECEIVER,
  amount: "5.0",
  chainId: "0",
  receiverExists: true,
  senderKey: { publicKey: SENDER_PUB, privateKey: "sender-priv" },
  gasStationKey: { publicKey: GAS_STATION_PUB, privateKey: "gas-priv" },
};

describe("nativeStoaTransfer — step B pact code", () => {
  it("emits coin.C_Transfer when the receiver already exists", () => {
    expect(
      buildNativeStoaTransferPactCode({ sender: SENDER, receiver: RECEIVER, amount: "5.0", receiverExists: true }),
    ).toBe(`(coin.C_Transfer "${SENDER}" "${RECEIVER}" 5.0)`);
  });

  it("emits coin.C_TransferAnew with (read-keyset \"ks\") when the receiver does not exist — create + transfer", () => {
    expect(
      buildNativeStoaTransferPactCode({ sender: SENDER, receiver: RECEIVER, amount: "5.0", receiverExists: false }),
    ).toBe(`(coin.C_TransferAnew "${SENDER}" "${RECEIVER}" (read-keyset "ks") 5.0)`);
  });
});

describe("nativeStoaTransfer — step B, the dedup-safe submit", () => {
  it("submits C_Transfer with no keyset data for an existing receiver, gas paid by the Ouronet gas station, and the sender's own signer declaring an EXPLICIT coin.TRANSFER clist", async () => {
    const edge = nativeEdge();
    const result = await submitNativeStoaTransfer(DRAIN_REQUEST, edge);

    expect(result).toEqual({ requestKey: "req-drain" });
    expect(edge.getClient).toHaveBeenCalledWith("0");
    const { code, data, meta, signers } = decode(edge.submit.mock.calls[0][0]);
    expect(code).toBe(`(coin.C_Transfer "${SENDER}" "${RECEIVER}" 5.0)`);
    expect(data?.ks).toBeUndefined();
    // The sender's STOA balance is never the gas payer — this is what makes a
    // full-balance drain payable at all.
    expect(meta.sender).toBe(STOA_AUTONOMIC_OURONETGASSTATION);
    expect(meta.chainId).toBe("0");
    const gasSigner = signers.find((s) => s.pubKey === GAS_STATION_PUB);
    expect(gasSigner?.clist?.[0]?.name).toBe(`${STOACHAIN_NAMESPACE}.DALOS.GAS_PAYER`);
    // Live bug regression ("Managed capability coin.TRANSFER was not
    // installed"): Pact only pre-installs a @managed capability when SOME
    // signer's clist declares it with matching arguments. A bare guard signer
    // is not enough. `buildGasStationTransaction`'s own doc comment records
    // the live failure; this is the third caller it warns about.
    const senderSigner = signers.find((s) => s.pubKey === SENDER_PUB);
    expect(senderSigner?.clist).toEqual([
      { name: "coin.TRANSFER", args: [SENDER, RECEIVER, { decimal: "5.0" }] },
    ]);
  });

  it("submits C_TransferAnew with the receiver's derived `ks` keyset when the receiver does not exist", async () => {
    const edge = nativeEdge();
    await submitNativeStoaTransfer({ ...DRAIN_REQUEST, receiverExists: false }, edge);

    const { code, data } = decode(edge.submit.mock.calls[0][0]);
    expect(code).toBe(`(coin.C_TransferAnew "${SENDER}" "${RECEIVER}" (read-keyset "ks") 5.0)`);
    expect(data?.ks).toEqual({ keys: [RECEIVER_PUB], pred: "keys-all" });
  });

  it("recalibrates the gas limit from the simulation's reported gas rather than submitting the initial guess", async () => {
    const edge = nativeEdge({ result: { status: "success" }, gas: 1234 });
    await submitNativeStoaTransfer(DRAIN_REQUEST, edge);

    const simulated = decode(edge.dirtyRead.mock.calls[0][0]);
    const submitted = decode(edge.submit.mock.calls[0][0]);
    expect(submitted.meta.gasLimit).toBe(calculateAutoGasLimit(1234));
    expect(submitted.meta.gasLimit).not.toBe(simulated.meta.gasLimit);
    // The Yin Engine floor must be on the wire, not Pact's 1e-8 default.
    expect(submitted.meta.gasPrice).toBeGreaterThan(0);
    expect(submitted.meta.creationTime).toBeGreaterThan(0);
  });

  it("throws on a failed simulation and never reaches submit — a drain that cannot simulate must not be broadcast", async () => {
    const edge = nativeEdge({
      result: { status: "failure", error: { message: "insufficient funds" } },
    });

    await expect(submitNativeStoaTransfer(DRAIN_REQUEST, edge)).rejects.toThrow(/insufficient funds/i);
    expect(edge.submit).not.toHaveBeenCalled();
  });

  it("refuses a receiver carrying characters that could break out of the Pact string literal, before the client is even obtained", async () => {
    const edge = nativeEdge();
    await expect(
      submitNativeStoaTransfer({ ...DRAIN_REQUEST, receiver: `k:${RECEIVER_PUB}" (coin.transfer "x` }, edge),
    ).rejects.toThrow(/aren't allowed in an account name/i);
    expect(edge.getClient).not.toHaveBeenCalled();
    expect(edge.submit).not.toHaveBeenCalled();
  });

  it("refuses to auto-create a non-k: receiver that does not exist", async () => {
    const edge = nativeEdge();
    await expect(
      submitNativeStoaTransfer({ ...DRAIN_REQUEST, receiver: "u:some-non-k-account", receiverExists: false }, edge),
    ).rejects.toThrow(/only k: accounts can be auto-created/i);
    expect(edge.submit).not.toHaveBeenCalled();
  });
});

describe("nativeStoaTransfer — how much a drain moves", () => {
  it("moves the WHOLE balance: no gas reserve is withheld, because the Ouronet gas station pays the gas", () => {
    expect(drainAmountForPact("12.5")).toBe("12.5");
    expect(drainAmountForPact(12.5)).toBe("12.500000000000");
  });

  it("TRUNCATES at STOA's 12 decimals rather than rounding up — a rounded-up drain asks for more than the balance and fails as unpayable, stranding the whole step", () => {
    // 13 significant decimals: .toFixed(12) would round this UP to
    // 0.000000000002, which is MORE than the account holds.
    expect(drainAmountForPact("0.0000000000015")).toBe("0.000000000001");
    // The same hazard on the NUMBER path, which is the one the engine takes:
    // `ChainStateSnapshot` carries balances as numbers, and
    // `(1.0000000000005).toFixed(12)` is "1.000000000001" — one unpayable
    // picostoa more than the account holds, which fails the whole step on
    // chain for a rounding the client invented.
    expect(drainAmountForPact(1.0000000000005)).toBe("1.000000000000");
  });

  it("never emits exponent notation for a small balance — Pact's decimal lexer rejects `1e-7`", () => {
    expect(String(1e-7)).toBe("1e-7"); // what a naive String(balance) would produce
    expect(drainAmountForPact(1e-7)).toBe("0.000000100000");
  });

  it("refuses dust below the 12-decimal minimum instead of emitting a 0.0 transfer that would burn gas and move nothing", () => {
    expect(() => drainAmountForPact(1e-13)).toThrow(/below/i);
    expect(() => drainAmountForPact(0)).toThrow(/below/i);
  });
});
