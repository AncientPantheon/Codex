/**
 * <SendKadenaModal> — same-chain send against real Kadena mainnet.
 *
 * Mirrors `ui-send-stoa-modal.test.tsx`'s hermetic mocking discipline: no
 * real network call, no real key material, ever. `createClient` (from
 * `@stoachain/kadena-stoic-legacy/client`) is mocked directly (the real
 * `Pact` builder runs unmocked, so the actual transaction-construction logic
 * is exercised) — same pattern `kadena-reads.test.ts` already established.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const signMock = vi.fn();
const getKeypairMock = vi.fn();
vi.mock("@ancientpantheon/codex-ouronet/hooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useSignTransaction: () => ({ execute: vi.fn(), sign: signMock, strategy: {} as any }),
    useGetKeypair: () => getKeypairMock,
  };
});

const ensureCodexUnlockedMock = vi.fn(async () => true);
vi.mock("../src/zbom/hooks/useEnsureCodexUnlocked", () => ({
  useEnsureCodexUnlocked: () => ensureCodexUnlockedMock,
}));

// Mocks `checkKadenaAccountExistsActive` (kadenaBalanceSource.js), not
// `checkKadenaAccountExists` (kadenaReads.js) — the modal now routes its
// receiver-existence gate through the ACTIVE balance source (REST by
// default) rather than always hitting the direct Pact node, a live bug fix
// (see `checkKadenaAccountExistsActive`'s own doc comment). Call shape is
// also now positional (`(account, chainId)`), not an options object.
const checkKadenaAccountExistsMock = vi.fn();
vi.mock("../src/kadena/kadenaBalanceSource.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    checkKadenaAccountExistsActive: (...args: unknown[]) => checkKadenaAccountExistsMock(...args),
  };
});

const { dirtyReadMock, submitOneMock, getStatusMock, pollOneMock, pollCreateSpvMock, createClientMock } = vi.hoisted(() => {
  const dirtyReadMock = vi.fn();
  const submitOneMock = vi.fn();
  const getStatusMock = vi.fn();
  const pollOneMock = vi.fn();
  const pollCreateSpvMock = vi.fn();
  const createClientMock = vi.fn(() => ({
    dirtyRead: dirtyReadMock,
    submitOne: submitOneMock,
    getStatus: getStatusMock,
    pollOne: pollOneMock,
    pollCreateSpv: pollCreateSpvMock,
  }));
  return { dirtyReadMock, submitOneMock, getStatusMock, pollOneMock, pollCreateSpvMock, createClientMock };
});
vi.mock("@stoachain/kadena-stoic-legacy/client", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, createClient: createClientMock };
});

const txSubmittedMock = vi.fn();
const txFailMock = vi.fn();
const txPendingMock = vi.fn((_title: string, _opts?: unknown) => ({
  start: vi.fn(),
  submitted: txSubmittedMock,
  fail: txFailMock,
  done: vi.fn(),
  dismiss: vi.fn(),
}));
// The crosschain path's own REAL multi-step toast (SendKadenaModal.tsx no
// longer uses the single-step txPending wrapper above for crosschain sends —
// see CROSSCHAIN_TOAST_STEPS's own doc comment). `updateStepMock` captures
// every step transition; `pollViaInjectedFnMock` captures the manually-driven
// continuation-confirmation poll (replaces the old `opts.pollFn` mechanism
// for the crosschain path specifically).
const updateStepMock = vi.fn();
const createMultiStepToastMock = vi.fn((_opts: unknown) => ({
  id: "mock-multi-step-toast",
  updateStep: updateStepMock,
  dismiss: vi.fn(),
}));
const pollViaInjectedFnMock = vi.fn(async (..._args: unknown[]) => {});
vi.mock("../src/zbom/toast/toastManager.js", () => ({
  txPending: (title: string, opts?: unknown) => txPendingMock(title, opts),
  createMultiStepToast: (opts: unknown) => createMultiStepToastMock(opts),
  pollViaInjectedFn: (...args: unknown[]) => pollViaInjectedFnMock(...args),
}));

import { CodexLockedError } from "@ancientpantheon/codex-ouronet/errors";
import { calculateAutoGasLimit } from "@stoachain/stoa-core/gas";
import { SendKadenaModal } from "../src/ui/internal/SendKadenaModal";

const PUBLIC_KEY = "a".repeat(64);
const ADDRESS = `k:${PUBLIC_KEY}`;
const RECEIVER_EXISTING = `k:${"c".repeat(64)}`;
const RECEIVER_NEW_K = `k:${"b".repeat(64)}`;
const RECEIVER_NEW_NON_K = "u:some-non-k-account";

function extractPactCode(tx: { cmd: string }): {
  code: string;
  data: Record<string, unknown>;
  meta: Record<string, unknown>;
  signers: Array<{ pubKey: string; clist: Array<{ name: string; args: unknown[] }> }>;
} {
  const parsed = JSON.parse(tx.cmd);
  return { code: parsed.payload.exec.code, data: parsed.payload.exec.data, meta: parsed.meta, signers: parsed.signers };
}

/** Same shape as `extractPactCode`, but for a `Pact.builder.continuation({...})`
 *  transaction — its own wire shape is `payload.cont.{pactId,proof,step,
 *  rollback}` (confirmed against the real, unmocked builder), not
 *  `payload.exec`. The continuation is the step that actually claims the
 *  receiver's funds on the target chain — a wrong pactId/proof/chainId/
 *  capability here would authorize the wrong claim while every
 *  execution-only assertion stays green. */
function extractContinuation(tx: { cmd: string }): {
  pactId: string;
  proof: string;
  step: number;
  rollback: boolean;
  meta: Record<string, unknown>;
  signers: Array<{ pubKey: string; clist: Array<{ name: string; args: unknown[] }> }>;
} {
  const parsed = JSON.parse(tx.cmd);
  return {
    pactId: parsed.payload.cont.pactId,
    proof: parsed.payload.cont.proof,
    step: parsed.payload.cont.step,
    rollback: parsed.payload.cont.rollback,
    meta: parsed.meta,
    signers: parsed.signers,
  };
}

function mockSimulationSuccess(gas = 400) {
  dirtyReadMock.mockResolvedValue({ result: { status: "success", data: "ok" }, gas });
}
function mockSimulationFailure(message = "refused") {
  dirtyReadMock.mockResolvedValue({ result: { status: "failure", error: { message } } });
}

describe("<SendKadenaModal>", () => {
  beforeEach(() => {
    signMock.mockReset();
    getKeypairMock.mockReset();
    ensureCodexUnlockedMock.mockClear();
    ensureCodexUnlockedMock.mockResolvedValue(true);
    checkKadenaAccountExistsMock.mockReset();
    dirtyReadMock.mockReset();
    submitOneMock.mockReset();
    getStatusMock.mockReset();
    pollOneMock.mockReset();
    pollCreateSpvMock.mockReset();
    createClientMock.mockClear();
    txPendingMock.mockClear();
    txSubmittedMock.mockClear();
    txFailMock.mockClear();
    createMultiStepToastMock.mockClear();
    updateStepMock.mockClear();
    pollViaInjectedFnMock.mockReset().mockResolvedValue(undefined);
  });

  it("renders nothing when isOpen=false", () => {
    const { container } = render(
      <SendKadenaModal isOpen={false} onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />
    );
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("renders the receiver/amount inputs, two 20-chain selectors (source+target), and a disabled submit button when isOpen=true with no input", () => {
    render(<SendKadenaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /send kda/i })).toBeTruthy();
    expect(screen.getByLabelText(/receiver/i)).toBeTruthy();
    expect(screen.getByLabelText(/amount/i)).toBeTruthy();
    for (const n of ["0", "5", "19"]) {
      expect(screen.getAllByRole("button", { name: n }).length).toBe(2); // source + target
    }
    expect(screen.queryByRole("button", { name: "20" })).toBeNull();
    const submit = screen.getByRole("button", { name: /send kda/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the sending chain and re-derives the displayed balance when a different SOURCE chain is picked", () => {
    render(
      <SendKadenaModal
        isOpen
        onClose={() => {}}
        publicKey={PUBLIC_KEY}
        address={ADDRESS}
        senderBalanceByChain={{ "0": { balance: 12.5, exists: true }, "7": { balance: 3, exists: true } }}
      />
    );
    expect(screen.getByText(/12\.5/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "7" })[0]); // source selector's "7"
    expect(screen.getByText(/3\.0/)).toBeTruthy();
    expect(screen.queryByText(/12\.5/)).toBeNull();
  });

  it("shows a balance-unknown state when senderBalanceByChain is omitted", () => {
    render(<SendKadenaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    expect(screen.getAllByText(/—/).length).toBeGreaterThan(0);
  });

  it("rejects a receiver with a disallowed character — no unlock prompt, no dirtyRead call", async () => {
    render(<SendKadenaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: 'k:"; (evil-code) ;"' } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /send kda/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/aren't allowed in an account name/i)
    );
    expect(ensureCodexUnlockedMock).not.toHaveBeenCalled();
    expect(dirtyReadMock).not.toHaveBeenCalled();
  });

  it("builds coin.transfer (no keyset data) when the receiver account already exists, gas price fixed at 10000", async () => {
    checkKadenaAccountExistsMock.mockResolvedValue(true);
    mockSimulationSuccess(400);
    getKeypairMock.mockResolvedValue({ publicKey: PUBLIC_KEY, privateKey: "priv" } as any);
    signMock.mockResolvedValue({ cmd: "signed" });
    submitOneMock.mockResolvedValue({ requestKey: "req-1" });

    render(<SendKadenaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_EXISTING } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /send kda/i }));

    await waitFor(() => expect(submitOneMock).toHaveBeenCalledTimes(1));
    expect(checkKadenaAccountExistsMock).toHaveBeenCalledWith(RECEIVER_EXISTING, "0");
    const { code, data, meta, signers } = extractPactCode(dirtyReadMock.mock.calls[0][0]);
    expect(code).toBe(`(coin.transfer "${ADDRESS}" "${RECEIVER_EXISTING}" 5.0)`);
    expect(data?.ks).toBeUndefined();
    expect(meta.gasPrice).toBe(10000);
    // The builder's `setMeta({senderAccount})` param is an alias — the real
    // wire field is `meta.sender` (confirmed reading
    // createTransactionBuilder.d.cts's own `setMeta` signature).
    expect(meta.sender).toBe(ADDRESS);
    // The signed CAPABILITY list is independent of the pact-code string — a
    // bug that gets the code right but signs a wrong/stale capability
    // argument would authorize something the code string doesn't show.
    // `coin.GAS` takes no args; `coin.TRANSFER` must carry the SAME
    // sender/receiver/amount actually executed.
    expect(signers).toEqual([
      {
        pubKey: PUBLIC_KEY,
        scheme: "ED25519",
        clist: [
          { name: "coin.GAS", args: [] },
          { name: "coin.TRANSFER", args: [ADDRESS, RECEIVER_EXISTING, { decimal: "5.0" }] },
        ],
      },
    ]);
  });

  it("builds coin.transfer-create with the receiver's derived keyset when the receiver doesn't exist and is a k: account", async () => {
    checkKadenaAccountExistsMock.mockResolvedValue(false);
    mockSimulationSuccess(400);
    getKeypairMock.mockResolvedValue({ publicKey: PUBLIC_KEY, privateKey: "priv" } as any);
    signMock.mockResolvedValue({ cmd: "signed" });
    submitOneMock.mockResolvedValue({ requestKey: "req-2" });

    render(<SendKadenaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_NEW_K } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /send kda/i }));

    await waitFor(() => expect(submitOneMock).toHaveBeenCalledTimes(1));
    const { code, data } = extractPactCode(dirtyReadMock.mock.calls[0][0]);
    expect(code).toBe(`(coin.transfer-create "${ADDRESS}" "${RECEIVER_NEW_K}" (read-keyset "ks") 5.0)`);
    expect(data?.ks).toEqual({ keys: ["b".repeat(64)], pred: "keys-all" });
  });

  it("refuses a new non-k: receiver — no submit", async () => {
    checkKadenaAccountExistsMock.mockResolvedValue(false);
    render(<SendKadenaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_NEW_NON_K } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /send kda/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/only k: accounts can be auto-created/i)
    );
    expect(submitOneMock).not.toHaveBeenCalled();
    expect(txFailMock).toHaveBeenCalledWith(expect.stringMatching(/only k: accounts can be auto-created/i));
  });

  it("surfaces a simulation failure (via createSimulationError, same helper rotatePaymentKeyLive.ts uses) without ever calling sign/submit", async () => {
    checkKadenaAccountExistsMock.mockResolvedValue(true);
    // A message with no recognized keyword ("gas limit", "row not found",
    // "balance", "keyset"/"guard") hits createSimulationError's generic
    // fallback branch, which embeds the original message verbatim.
    mockSimulationFailure("some unrecognized on-chain refusal xyz");

    render(<SendKadenaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_EXISTING } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /send kda/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/some unrecognized on-chain refusal xyz/i)
    );
    expect(signMock).not.toHaveBeenCalled();
    expect(submitOneMock).not.toHaveBeenCalled();
  });

  it("surfaces a network-error message (dirtyRead REJECTS, distinct from an on-chain refusal envelope) without ever calling sign/submit", async () => {
    checkKadenaAccountExistsMock.mockResolvedValue(true);
    dirtyReadMock.mockRejectedValue(new Error("network down"));

    render(<SendKadenaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_EXISTING } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /send kda/i }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/network down/i));
    expect(signMock).not.toHaveBeenCalled();
    expect(submitOneMock).not.toHaveBeenCalled();
    expect(txFailMock).toHaveBeenCalledWith(expect.stringMatching(/network down/i));
  });

  // Live bug report follow-up: a raw browser fetch failure against the
  // direct Kadena Pact node (plain HTTP — mixed-content-blockable from an
  // HTTPS page, or genuinely unreachable) surfaces as the cryptic,
  // non-actionable "Failed to fetch" — a live tester saw exactly this after
  // the receiver-existence check itself was fixed to use the REST gateway.
  // Simulating/signing/submitting has no REST fallback (the gateway is
  // documented read-only), so this can't be "fixed" by rerouting — only the
  // MESSAGE can be made actionable instead of cryptic.
  it("classifies a raw 'Failed to fetch' TypeError (the literal browser fetch-rejection message) as an actionable network-reachability message, not the cryptic raw string", async () => {
    checkKadenaAccountExistsMock.mockResolvedValue(true);
    dirtyReadMock.mockRejectedValue(new TypeError("Failed to fetch"));

    render(<SendKadenaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_EXISTING } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /send kda/i }));

    const alert = await waitFor(() => screen.getByRole("alert"));
    expect(alert.textContent).toMatch(/could not reach the kadena network node/i);
    expect(alert.textContent).toMatch(/mixed content/i);
    expect(alert.textContent).not.toContain("Failed to fetch");
    expect(signMock).not.toHaveBeenCalled();
    expect(submitOneMock).not.toHaveBeenCalled();
  });

  it("classifies Firefox's and Safari's own fetch-rejection wording too, not just Chromium's", async () => {
    checkKadenaAccountExistsMock.mockResolvedValue(true);
    dirtyReadMock.mockRejectedValue(new TypeError("NetworkError when attempting to fetch resource."));

    render(<SendKadenaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_EXISTING } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /send kda/i }));

    const alert = await waitFor(() => screen.getByRole("alert"));
    expect(alert.textContent).toMatch(/could not reach the kadena network node/i);
  });

  // Live bug report (2026-09-28, AFTER the gateway rollout): a real tester
  // got "Kadena simulation timed out after 10000ms" — the literal message
  // `withKadenaTimeout`'s own Promise.race produces — with NO way to tell
  // from that message alone which node was actually being tried. Turned out
  // the tester's browser very likely still had the OLD default (the direct
  // duckdns node) persisted from before the gateway rollout (see
  // `networkSettings.ts`'s own third migration, added specifically because
  // of this). This locks in the fix: the timeout message now names the
  // active node.
  it("classifies a 'timed out after Nms' rejection (withKadenaTimeout's own message shape) by naming the ACTIVE node — the exact ambiguity a live tester hit after the gateway rollout", async () => {
    checkKadenaAccountExistsMock.mockResolvedValue(true);
    dirtyReadMock.mockRejectedValue(new Error("Kadena simulation timed out after 10000ms"));

    render(<SendKadenaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_EXISTING } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /send kda/i }));

    const alert = await waitFor(() => screen.getByRole("alert"));
    expect(alert.textContent).toMatch(/kadena simulation timed out after 10000ms/i);
    // Names the CURRENTLY ACTIVE node — the default gateway in this test's
    // hermetic setup, never hardcoded to the old direct node.
    expect(alert.textContent).toContain("https://denascan.ancientholdings.eu");
  });

  it("does NOT reclassify a generic TypeError that merely happens to be a TypeError but isn't a fetch-rejection shape — only the specific browser wordings match", async () => {
    checkKadenaAccountExistsMock.mockResolvedValue(true);
    dirtyReadMock.mockRejectedValue(new TypeError("Cannot read properties of undefined"));

    render(<SendKadenaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_EXISTING } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /send kda/i }));

    const alert = await waitFor(() => screen.getByRole("alert"));
    expect(alert.textContent).toMatch(/cannot read properties of undefined/i);
    expect(alert.textContent).not.toMatch(/could not reach the kadena network node/i);
  });

  it("does not submit when receiver existence can't be verified (checkKadenaAccountExists returns null, a real distinct outcome from 'not found')", async () => {
    checkKadenaAccountExistsMock.mockResolvedValue(null);

    render(<SendKadenaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_EXISTING } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /send kda/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/could not verify the receiver account/i)
    );
    // Must NOT be conflated with the "not found, only k: accounts can be
    // auto-created" message — null (verification failed) and false (really
    // doesn't exist) are different outcomes with different messages.
    expect(screen.getByRole("alert").textContent).not.toMatch(/only k: accounts/i);
    expect(dirtyReadMock).not.toHaveBeenCalled();
    expect(signMock).not.toHaveBeenCalled();
    expect(submitOneMock).not.toHaveBeenCalled();
    expect(txFailMock).toHaveBeenCalledWith(expect.stringMatching(/could not verify the receiver account/i));
  });

  it("calibrates gasLimit via calculateAutoGasLimit from the simulated gas value — the real (second) build differs from the placeholder", async () => {
    checkKadenaAccountExistsMock.mockResolvedValue(true);
    mockSimulationSuccess(50); // small simulated gas -> a large multiplier per calculateAutoGasLimit's own table
    getKeypairMock.mockResolvedValue({ publicKey: PUBLIC_KEY, privateKey: "priv" } as any);
    signMock.mockResolvedValue({ cmd: "signed" });
    submitOneMock.mockResolvedValue({ requestKey: "req-3" });

    render(<SendKadenaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_EXISTING } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /send kda/i }));

    await waitFor(() => expect(submitOneMock).toHaveBeenCalledTimes(1));
    // First call is the simulation (placeholder gasLimit); sign is called with
    // whatever the SECOND (calibrated) build produced.
    const simulatedTx = dirtyReadMock.mock.calls[0][0];
    const { meta: simMeta } = extractPactCode(simulatedTx);
    expect(simMeta.gasLimit).toBe(150000);
    const signedArgs = signMock.mock.calls[0][0];
    const { meta: realMeta } = extractPactCode(signedArgs.tx);
    expect(realMeta.gasLimit).not.toBe(150000);
    expect(realMeta.gasLimit).toBe(calculateAutoGasLimit(50));
  });

  it("signs via sign({capsKey: <resolved keypair>, guardKeypairs: []}), never execute()", async () => {
    checkKadenaAccountExistsMock.mockResolvedValue(true);
    mockSimulationSuccess(400);
    const keypair = { publicKey: PUBLIC_KEY, privateKey: "priv" } as any;
    getKeypairMock.mockResolvedValue(keypair);
    signMock.mockResolvedValue({ cmd: "signed" });
    submitOneMock.mockResolvedValue({ requestKey: "req-4" });

    render(<SendKadenaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_EXISTING } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /send kda/i }));

    await waitFor(() => expect(submitOneMock).toHaveBeenCalledTimes(1));
    expect(getKeypairMock).toHaveBeenCalledWith(PUBLIC_KEY);
    expect(signMock).toHaveBeenCalledWith(
      expect.objectContaining({ capsKey: keypair, guardKeypairs: [] }),
    );
  });

  it("on success: tracks the toast with chain:'kadena', calls .submitted(requestKey, chainId), onSuccess, and closes", async () => {
    checkKadenaAccountExistsMock.mockResolvedValue(true);
    mockSimulationSuccess(400);
    getKeypairMock.mockResolvedValue({ publicKey: PUBLIC_KEY, privateKey: "priv" } as any);
    signMock.mockResolvedValue({ cmd: "signed" });
    submitOneMock.mockResolvedValue({ requestKey: "req-5" });
    const onSuccess = vi.fn();
    let closedCount = 0;

    render(
      <SendKadenaModal
        isOpen
        onClose={() => { closedCount++; }}
        onSuccess={onSuccess}
        publicKey={PUBLIC_KEY}
        address={ADDRESS}
      />
    );
    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_EXISTING } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /send kda/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("req-5"));
    expect(closedCount).toBe(1);
    expect(txPendingMock).toHaveBeenCalledWith("Send KDA", expect.objectContaining({ chain: "kadena" }));
    expect(txSubmittedMock).toHaveBeenCalledWith("req-5", "0");
    expect(txFailMock).not.toHaveBeenCalled();
  });

  it("the pollFn given to txPending correctly maps real getStatus responses to pending/confirmed/failed", async () => {
    checkKadenaAccountExistsMock.mockResolvedValue(true);
    mockSimulationSuccess(400);
    getKeypairMock.mockResolvedValue({ publicKey: PUBLIC_KEY, privateKey: "priv" } as any);
    signMock.mockResolvedValue({ cmd: "signed" });
    submitOneMock.mockResolvedValue({ requestKey: "req-poll" });

    render(<SendKadenaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_EXISTING } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /send kda/i }));

    await waitFor(() => expect(submitOneMock).toHaveBeenCalledTimes(1));
    const pollFn = (txPendingMock.mock.calls[0][1] as { pollFn: (rk: string) => Promise<string> }).pollFn;
    expect(typeof pollFn).toBe("function");

    // Not yet mined — the requestKey isn't a key in the poll response yet.
    getStatusMock.mockResolvedValueOnce({});
    await expect(pollFn("req-poll")).resolves.toBe("pending");

    // Mined and succeeded.
    getStatusMock.mockResolvedValueOnce({ "req-poll": { result: { status: "success" } } });
    await expect(pollFn("req-poll")).resolves.toBe("confirmed");

    // Mined and failed on-chain — must be reported as a REAL failure, never
    // as a false "confirmed" or an ambiguous "give-up".
    getStatusMock.mockResolvedValueOnce({ "req-poll": { result: { status: "failure" } } });
    await expect(pollFn("req-poll")).resolves.toBe("failed");

    // A thrown/network error is treated as transient, not a hard failure.
    getStatusMock.mockRejectedValueOnce(new Error("network blip"));
    await expect(pollFn("req-poll")).resolves.toBe("pending");
  });

  it("same-chain: submits on the client bound to the (default) chain 0", async () => {
    checkKadenaAccountExistsMock.mockResolvedValue(true);
    mockSimulationSuccess(400);
    getKeypairMock.mockResolvedValue({ publicKey: PUBLIC_KEY, privateKey: "priv" } as any);
    signMock.mockResolvedValue({ cmd: "signed" });
    submitOneMock.mockResolvedValue({ requestKey: "req-6" });

    render(<SendKadenaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_EXISTING } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /send kda/i }));

    await waitFor(() => expect(submitOneMock).toHaveBeenCalledTimes(1));
    expect(createClientMock).toHaveBeenCalledWith(expect.stringContaining("/chain/0/pact"));
  });

  it("same-chain is reachable on a NON-default chain too — picking source chain 2 does not permanently disable target chain 2, and re-selecting it submits on chain 2 (not cross-chain)", async () => {
    checkKadenaAccountExistsMock.mockResolvedValue(true);
    mockSimulationSuccess(400);
    getKeypairMock.mockResolvedValue({ publicKey: PUBLIC_KEY, privateKey: "priv" } as any);
    signMock.mockResolvedValue({ cmd: "signed" });
    submitOneMock.mockResolvedValue({ requestKey: "req-same-chain-2" });

    render(<SendKadenaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);

    // Pick source chain 2 (Source selector is the first "2" button).
    fireEvent.click(screen.getAllByRole("button", { name: "2" })[0]);
    // Target chain 2's button must still be clickable — a same-chain (2->2)
    // transfer is a real, valid case, not one the UI should structurally
    // block just because the user happened to pick source first.
    const targetTwo = screen.getAllByRole("button", { name: "2" })[1] as HTMLButtonElement;
    expect(targetTwo.disabled).toBe(false);
    fireEvent.click(targetTwo);
    expect(targetTwo.getAttribute("aria-pressed")).toBe("true");
    // Same-chain, not cross-chain: the modal's own subtitle reflects which
    // Pact function will be used.
    expect(screen.getByText("coin.transfer / coin.transfer-create")).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_EXISTING } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /send kda/i }));

    await waitFor(() => expect(submitOneMock).toHaveBeenCalledTimes(1));
    expect(createClientMock).toHaveBeenCalledWith(expect.stringContaining("/chain/2/pact"));
  });

  it("shows a locked-codex message (and does not close) when sign throws CodexLockedError", async () => {
    checkKadenaAccountExistsMock.mockResolvedValue(true);
    mockSimulationSuccess(400);
    getKeypairMock.mockResolvedValue({ publicKey: PUBLIC_KEY, privateKey: "priv" } as any);
    signMock.mockRejectedValue(new CodexLockedError("send kda"));
    let closedCount = 0;

    render(<SendKadenaModal isOpen onClose={() => { closedCount++; }} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_EXISTING } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /send kda/i }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/locked/i));
    expect(closedCount).toBe(0);
    expect(txFailMock).toHaveBeenCalledWith(expect.stringMatching(/locked/i));
  });

  it("when the user cancels the password prompt, stops quietly — no dirtyRead call, no error toast, no alert", async () => {
    ensureCodexUnlockedMock.mockResolvedValueOnce(false);
    render(<SendKadenaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);

    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_EXISTING } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "2" } });
    const submit = screen.getByRole("button", { name: /send kda/i });
    fireEvent.click(submit);

    await waitFor(() => expect(ensureCodexUnlockedMock).toHaveBeenCalledTimes(1));
    expect(checkKadenaAccountExistsMock).not.toHaveBeenCalled();
    expect(dirtyReadMock).not.toHaveBeenCalled();
    expect(txFailMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("resets receiver/amount/error/chain state each time the modal re-opens", () => {
    const { rerender } = render(
      <SendKadenaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />
    );
    fireEvent.click(screen.getAllByRole("button", { name: "9" })[0]); // SOURCE chain 9
    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_EXISTING } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "9" } });
    rerender(<SendKadenaModal isOpen={false} onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    rerender(<SendKadenaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    expect((screen.getByLabelText(/receiver/i) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(/amount/i) as HTMLInputElement).value).toBe("");
    // Both source AND target reset to chain "0" — two selectors, both pressed.
    const zeroButtons = screen.getAllByRole("button", { name: "0" });
    expect(zeroButtons.length).toBe(2);
    for (const btn of zeroButtons) expect(btn.getAttribute("aria-pressed")).toBe("true");
  });

  describe("crosschain (source chain !== target chain)", () => {
    function pickSourceTarget(sourceLabel: string, targetLabel: string) {
      // Target FIRST (its own disabledChain only excludes the CURRENT
      // source, "0", so any other value including targetLabel is pickable),
      // THEN source (source's own collision-avoidance only fires when the
      // NEW source equals the CURRENT target — picking source after target
      // is already the desired final target avoids ever colliding).
      fireEvent.click(screen.getAllByRole("button", { name: targetLabel })[1]);
      fireEvent.click(screen.getAllByRole("button", { name: sourceLabel })[0]);
    }

    it("picking a different source/target enables cross-chain — a non-k: receiver keeps submit disabled and never unlocks/builds anything", () => {
      render(<SendKadenaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
      pickSourceTarget("3", "5");
      fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_NEW_NON_K } });
      fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
      const submit = screen.getByRole("button", { name: /send kda/i });
      expect((submit as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(submit);
      expect(ensureCodexUnlockedMock).not.toHaveBeenCalled();
      expect(dirtyReadMock).not.toHaveBeenCalled();
    });

    it("builds coin.transfer-crosschain with the right pact code and the right signed capability list (coin.GAS + coin.TRANSFER_XCHAIN)", async () => {
      mockSimulationSuccess(400);
      getKeypairMock.mockResolvedValue({ publicKey: PUBLIC_KEY, privateKey: "priv" } as any);
      signMock.mockResolvedValue({ cmd: "signed" });
      submitOneMock.mockResolvedValue({ requestKey: "req-x1" });
      pollOneMock.mockResolvedValue({ result: { status: "success" } });
      pollCreateSpvMock.mockResolvedValue("spv-proof-blob");

      render(<SendKadenaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
      pickSourceTarget("3", "5");
      fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_NEW_K } });
      fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
      fireEvent.click(screen.getByRole("button", { name: /send kda/i }));

      await waitFor(() => expect(submitOneMock).toHaveBeenCalledTimes(2)); // initiate + continuation
      const { code, data, signers } = extractPactCode(dirtyReadMock.mock.calls[0][0]);
      expect(code).toBe(`(coin.transfer-crosschain "${ADDRESS}" "${RECEIVER_NEW_K}" (read-keyset "ks") "5" 5.0)`);
      expect(data?.ks).toEqual({ keys: ["b".repeat(64)], pred: "keys-all" });
      expect(signers).toEqual([
        {
          pubKey: PUBLIC_KEY,
          scheme: "ED25519",
          clist: [
            { name: "coin.GAS", args: [] },
            { name: "coin.TRANSFER_XCHAIN", args: [ADDRESS, RECEIVER_NEW_K, { decimal: "5.0" }, "5"] },
          ],
        },
      ]);
      expect(createClientMock).toHaveBeenCalledWith(expect.stringContaining("/chain/3/pact")); // source
      expect(createClientMock).toHaveBeenCalledWith(expect.stringContaining("/chain/5/pact")); // target
    });

    it("full happy path: initiate confirms, SPV proof fetched, continuation is SIGNED and submitted on the target chain, reaches done", async () => {
      mockSimulationSuccess(400);
      const keypair = { publicKey: PUBLIC_KEY, privateKey: "priv" } as any;
      getKeypairMock.mockResolvedValue(keypair);
      signMock.mockResolvedValue({ cmd: "signed" });
      submitOneMock.mockResolvedValueOnce({ requestKey: "req-init" }).mockResolvedValueOnce({ requestKey: "req-cont" });
      pollOneMock.mockResolvedValue({ result: { status: "success" } });
      pollCreateSpvMock.mockResolvedValue("spv-proof-blob");
      const onSuccess = vi.fn();
      let closedCount = 0;

      render(
        <SendKadenaModal isOpen onClose={() => { closedCount++; }} onSuccess={onSuccess} publicKey={PUBLIC_KEY} address={ADDRESS} />,
      );
      pickSourceTarget("3", "5");
      fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_NEW_K } });
      fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
      fireEvent.click(screen.getByRole("button", { name: /send kda/i }));

      await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("req-init"));
      expect(closedCount).toBe(1);
      // Continuation is SIGNED (unlike StoaChain's — see this file's own
      // module doc comment) — sign() must be called twice: once for the
      // initiate, once for the continuation.
      expect(signMock).toHaveBeenCalledTimes(2);
      expect(getKeypairMock).toHaveBeenCalledTimes(1); // reused, not re-resolved
      expect(pollCreateSpvMock).toHaveBeenCalledWith(
        expect.objectContaining({ requestKey: "req-init", chainId: "3" }),
        "5",
        expect.anything(),
      );
      // Crosschain sends use the real multi-step toast now (see
      // CROSSCHAIN_TOAST_STEPS's own doc comment) — `.submitted()` is never
      // called for a crosschain send; the continuation's own confirmation is
      // driven manually via `pollViaInjectedFn` on step 2 instead.
      expect(txSubmittedMock).not.toHaveBeenCalled();
      expect(txFailMock).not.toHaveBeenCalled();
      // The continuation is the step that actually claims the funds — its
      // own pactId/proof/step/rollback/chainId/capability must be exactly
      // right, not just "some tx got submitted twice".
      const continuationArgs = signMock.mock.calls[1][0]; // [0]=initiate, [1]=continuation
      const cont = extractContinuation(continuationArgs.tx);
      expect(cont.pactId).toBe("req-init"); // the INITIATE step's own requestKey
      expect(cont.proof).toBe("spv-proof-blob");
      expect(cont.step).toBe(1);
      expect(cont.rollback).toBe(false);
      expect(cont.meta.chainId).toBe("5"); // the TARGET chain, not source
      expect(cont.signers).toEqual([{ pubKey: PUBLIC_KEY, scheme: "ED25519", clist: [{ name: "coin.GAS", args: [] }] }]);
      // The toast is a REAL multi-step one (3 steps, not the generic
      // single-step txPending wrapper) — created up front, not only at the
      // very end of the flow.
      expect(createMultiStepToastMock).toHaveBeenCalledTimes(1);
      const createArgs = createMultiStepToastMock.mock.calls[0][0] as { steps: Array<{ label: string }> };
      expect(createArgs.steps.map((s) => s.label)).toEqual([
        "Confirming on source chain",
        "Waiting for cross-chain proof",
        "Completing on target chain",
      ]);
      // The continuation MUST get a real poll callback — without one,
      // step 2 would report "done" on mere mempool acceptance, never
      // confirming the continuation actually landed on-chain (the exact gap
      // a sibling topic's own review already found and fixed for
      // StoaChain's equivalent continuation step).
      expect(pollViaInjectedFnMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: "mock-multi-step-toast" }),
        2,
        "req-cont",
        expect.any(Function),
      );
    });

    // Live UX report: a real cross-chain send took several minutes end to
    // end, and the ONLY visible progress was static text inside the modal —
    // no toast appeared until the very end. This locks in the fix: step 0
    // gets the real requestKey attached as soon as it exists (not only once
    // the whole flow finishes), and each step reports "done" as the flow
    // actually reaches it.
    it("drives every step of the multi-step toast as the crosschain flow actually progresses — requestKey attached early, each step done in order", async () => {
      mockSimulationSuccess(400);
      getKeypairMock.mockResolvedValue({ publicKey: PUBLIC_KEY, privateKey: "priv" } as any);
      signMock.mockResolvedValue({ cmd: "signed" });
      submitOneMock.mockResolvedValueOnce({ requestKey: "req-init-3" }).mockResolvedValueOnce({ requestKey: "req-cont-3" });
      pollOneMock.mockResolvedValue({ result: { status: "success" } });
      pollCreateSpvMock.mockResolvedValue("spv-proof-blob");

      render(<SendKadenaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
      pickSourceTarget("3", "5");
      fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_NEW_K } });
      fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
      fireEvent.click(screen.getByRole("button", { name: /send kda/i }));

      await waitFor(() => expect(submitOneMock).toHaveBeenCalledTimes(2));

      // Step 0 got the REAL initiate requestKey attached as soon as it
      // existed, THEN completed once confirmed.
      expect(updateStepMock).toHaveBeenCalledWith(0, "active", { requestKey: "req-init-3" });
      expect(updateStepMock).toHaveBeenCalledWith(0, "done", { requestKey: "req-init-3" });
      // Step 1 (SPV proof) completed once the proof arrived.
      expect(updateStepMock).toHaveBeenCalledWith(1, "done");
    });

    it("the crosschain toast's pollFn confirms the CONTINUATION on the TARGET chain, not the initiate step on the source chain", async () => {
      mockSimulationSuccess(400);
      getKeypairMock.mockResolvedValue({ publicKey: PUBLIC_KEY, privateKey: "priv" } as any);
      signMock.mockResolvedValue({ cmd: "signed" });
      submitOneMock.mockResolvedValueOnce({ requestKey: "req-init-2" }).mockResolvedValueOnce({ requestKey: "req-cont-2" });
      pollOneMock.mockResolvedValue({ result: { status: "success" } });
      pollCreateSpvMock.mockResolvedValue("spv-proof-blob");

      render(<SendKadenaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
      pickSourceTarget("3", "5");
      fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_NEW_K } });
      fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
      fireEvent.click(screen.getByRole("button", { name: /send kda/i }));

      await waitFor(() => expect(submitOneMock).toHaveBeenCalledTimes(2));
      // The crosschain path drives its own confirmation poll manually via
      // `pollViaInjectedFn(_tx, 2, requestKey, pollContinuation)` now (no
      // longer `opts.pollFn` passed into `txPending`) — capture the SAME
      // callback from that call's own arguments instead.
      expect(pollViaInjectedFnMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: "mock-multi-step-toast" }),
        2,
        "req-cont-2",
        expect.any(Function),
      );
      const pollFn = pollViaInjectedFnMock.mock.calls[0][3] as (rk: string) => Promise<string>;

      getStatusMock.mockResolvedValueOnce({ "req-cont-2": { result: { status: "success" } } });
      await expect(pollFn("req-cont-2")).resolves.toBe("confirmed");
      // Bound to the TARGET chain (5), not the source (3).
      expect(getStatusMock).toHaveBeenLastCalledWith(expect.objectContaining({ requestKey: "req-cont-2", chainId: "5" }));

      getStatusMock.mockResolvedValueOnce({ "req-cont-2": { result: { status: "failure" } } });
      await expect(pollFn("req-cont-2")).resolves.toBe("failed");
    });

    it("when the initiate step's own confirmation poll rejects/times out, surfaces a distinct 'still confirming' message and never fetches an SPV proof", async () => {
      mockSimulationSuccess(400);
      getKeypairMock.mockResolvedValue({ publicKey: PUBLIC_KEY, privateKey: "priv" } as any);
      signMock.mockResolvedValue({ cmd: "signed" });
      submitOneMock.mockResolvedValue({ requestKey: "req-slow" });
      pollOneMock.mockRejectedValue(new Error("timed out"));

      render(<SendKadenaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
      pickSourceTarget("3", "5");
      fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_NEW_K } });
      fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
      fireEvent.click(screen.getByRole("button", { name: /send kda/i }));

      await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/still confirming/i));
      expect(pollCreateSpvMock).not.toHaveBeenCalled();
      // Crosschain sends use the real multi-step toast now — step 0
      // (initiate) is the one that reports this.
      expect(txFailMock).not.toHaveBeenCalled();
      expect(updateStepMock).toHaveBeenCalledWith(
        0,
        "error",
        expect.objectContaining({ label: expect.stringMatching(/still confirming/i) }),
      );
    });

    it("when the initiate step fails on-chain (pollOne reports a real failure), surfaces that failure and never fetches an SPV proof", async () => {
      mockSimulationSuccess(400);
      getKeypairMock.mockResolvedValue({ publicKey: PUBLIC_KEY, privateKey: "priv" } as any);
      signMock.mockResolvedValue({ cmd: "signed" });
      submitOneMock.mockResolvedValue({ requestKey: "req-onchain-fail" });
      pollOneMock.mockResolvedValue({ result: { status: "failure", error: { message: "TRANSFER_XCHAIN exceeded for balance" } } });

      render(<SendKadenaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
      pickSourceTarget("3", "5");
      fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_NEW_K } });
      fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
      fireEvent.click(screen.getByRole("button", { name: /send kda/i }));

      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toMatch(/TRANSFER_XCHAIN exceeded for balance/i)
      );
      expect(pollCreateSpvMock).not.toHaveBeenCalled();
    });

    it("when the SPV proof times out, surfaces its own message and never builds a continuation", async () => {
      mockSimulationSuccess(400);
      getKeypairMock.mockResolvedValue({ publicKey: PUBLIC_KEY, privateKey: "priv" } as any);
      signMock.mockResolvedValue({ cmd: "signed" });
      submitOneMock.mockResolvedValue({ requestKey: "req-spv-timeout" });
      pollOneMock.mockResolvedValue({ result: { status: "success" } });
      pollCreateSpvMock.mockRejectedValue(new Error("SPV proof not ready yet"));

      render(<SendKadenaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
      pickSourceTarget("3", "5");
      fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_NEW_K } });
      fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
      fireEvent.click(screen.getByRole("button", { name: /send kda/i }));

      await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/SPV proof not ready yet/i));
      expect(signMock).toHaveBeenCalledTimes(1); // only the initiate — no continuation ever built/signed
    });

    it("when the sender has no gas on the target chain, reaches a distinct PENDING/UNCLAIMED state (not done, not error) naming the chain and request key — onSuccess still fires, modal stays open", async () => {
      getKeypairMock.mockResolvedValue({ publicKey: PUBLIC_KEY, privateKey: "priv" } as any);
      signMock.mockResolvedValue({ cmd: "signed" });
      submitOneMock.mockResolvedValue({ requestKey: "req-unclaimed" });
      pollOneMock.mockResolvedValue({ result: { status: "success" } });
      pollCreateSpvMock.mockResolvedValue("spv-proof-blob");
      // First dirtyRead call = initiate simulation (succeeds); second =
      // continuation simulation (fails: sender has no gas on target chain).
      dirtyReadMock
        .mockResolvedValueOnce({ result: { status: "success", data: "ok" }, gas: 400 })
        // Deliberately CAPITALIZED "Insufficient" — proves the modal's own
        // case-insensitive funding-issue check, not just
        // createSimulationError's own case-sensitive one (a real Kadena gas-
        // buy failure message's exact casing isn't this file's to control).
        .mockResolvedValueOnce({ result: { status: "failure", error: { message: "Insufficient funds to buy gas" } } });
      const onSuccess = vi.fn();
      let closedCount = 0;

      render(
        <SendKadenaModal isOpen onClose={() => { closedCount++; }} onSuccess={onSuccess} publicKey={PUBLIC_KEY} address={ADDRESS} />,
      );
      pickSourceTarget("3", "5");
      fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_NEW_K } });
      fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
      fireEvent.click(screen.getByRole("button", { name: /send kda/i }));

      await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("req-unclaimed"));
      expect(closedCount).toBe(0); // stays open — user can read/copy the info
      const infoBox = screen.getByText(/committed on-chain, but not yet claimed/i);
      expect(infoBox).toBeTruthy();
      expect(infoBox.textContent).toMatch(/chain 5/i);
      expect(infoBox.textContent).toMatch(/req-unclaimed/);
      // Never signed/submitted a continuation — the simulation refused it.
      expect(signMock).toHaveBeenCalledTimes(1);
      expect(submitOneMock).toHaveBeenCalledTimes(1);
      expect(txFailMock).not.toHaveBeenCalled();
      // Step 2 (completing) reports the pending-unclaimed state as a "done"
      // with a distinct label — never "error" (nothing failed irrecoverably)
      // and never the generic "Confirmed".
      expect(updateStepMock).toHaveBeenCalledWith(
        2,
        "done",
        expect.objectContaining({ label: "Pending — needs gas on target chain", requestKey: "req-unclaimed" }),
      );
    });

    it("a continuation simulation failure UNRELATED to gas/funds is a genuine hard error, not pending-unclaimed", async () => {
      getKeypairMock.mockResolvedValue({ publicKey: PUBLIC_KEY, privateKey: "priv" } as any);
      signMock.mockResolvedValue({ cmd: "signed" });
      submitOneMock.mockResolvedValue({ requestKey: "req-cont-error" });
      pollOneMock.mockResolvedValue({ result: { status: "success" } });
      pollCreateSpvMock.mockResolvedValue("spv-proof-blob");
      dirtyReadMock
        .mockResolvedValueOnce({ result: { status: "success", data: "ok" }, gas: 400 })
        .mockResolvedValueOnce({ result: { status: "failure", error: { message: "some unrelated on-chain refusal xyz" } } });

      render(<SendKadenaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
      pickSourceTarget("3", "5");
      fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_NEW_K } });
      fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
      fireEvent.click(screen.getByRole("button", { name: /send kda/i }));

      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toMatch(/some unrelated on-chain refusal xyz/i)
      );
      expect(screen.queryByText(/committed on-chain, but not yet claimed/i)).toBeNull();
    });

    it("classifies a raw 'Failed to fetch' network rejection on the INITIATE step's own simulation the same way the same-chain path does", async () => {
      dirtyReadMock.mockRejectedValue(new TypeError("Failed to fetch"));

      render(<SendKadenaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
      pickSourceTarget("3", "5");
      fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_NEW_K } });
      fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
      fireEvent.click(screen.getByRole("button", { name: /send kda/i }));

      const alert = await waitFor(() => screen.getByRole("alert"));
      expect(alert.textContent).toMatch(/could not reach the kadena network node/i);
      expect(alert.textContent).not.toContain("Failed to fetch");
      expect(signMock).not.toHaveBeenCalled();
    });

    it("the continuation's OWN gas-limit calibration guard falls back to SIMULATION_GAS_LIMIT for a negative/malformed simulated-gas value — never derives a bogus gasLimit for the real submitted continuation", async () => {
      getKeypairMock.mockResolvedValue({ publicKey: PUBLIC_KEY, privateKey: "priv" } as any);
      signMock.mockResolvedValue({ cmd: "signed" });
      submitOneMock.mockResolvedValueOnce({ requestKey: "req-init-neg" }).mockResolvedValueOnce({ requestKey: "req-cont-neg" });
      pollOneMock.mockResolvedValue({ result: { status: "success" } });
      pollCreateSpvMock.mockResolvedValue("spv-proof-blob");
      // Initiate simulation: valid gas. Continuation simulation: SUCCEEDS
      // (not a refusal) but reports a bogus negative gas figure — the exact
      // "tampered/buggy node response" scenario this guard exists for
      // (the node is plain HTTP, no TLS).
      dirtyReadMock
        .mockResolvedValueOnce({ result: { status: "success", data: "ok" }, gas: 400 })
        .mockResolvedValueOnce({ result: { status: "success", data: "ok" }, gas: -50 });

      render(<SendKadenaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
      pickSourceTarget("3", "5");
      fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_NEW_K } });
      fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
      fireEvent.click(screen.getByRole("button", { name: /send kda/i }));

      await waitFor(() => expect(submitOneMock).toHaveBeenCalledTimes(2));
      const continuationArgs = signMock.mock.calls[1][0];
      const cont = extractContinuation(continuationArgs.tx);
      expect(cont.meta.gasLimit).toBe(150000); // SIMULATION_GAS_LIMIT — never a negative/derived-from-garbage value
    });

    it("picking a new source chain that collides with the current target leaves them equal — same-chain is a valid, reachable state, not one the UI snaps away from", () => {
      render(<SendKadenaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
      fireEvent.click(screen.getAllByRole("button", { name: "1" })[1]); // target -> 1
      fireEvent.click(screen.getAllByRole("button", { name: "1" })[0]); // source -> 1 (collides on purpose)
      const sourceGroup = screen.getByText("Source Chain").parentElement as HTMLElement;
      const targetGroup = screen.getByText("Target Chain").parentElement as HTMLElement;
      expect(within(sourceGroup).getByRole("button", { name: "1" }).getAttribute("aria-pressed")).toBe("true");
      expect(within(targetGroup).getByRole("button", { name: "1" }).getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByText("coin.transfer / coin.transfer-create")).toBeTruthy();
    });
  });
});
