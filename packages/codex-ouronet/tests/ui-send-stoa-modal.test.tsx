/**
 * <SendStoaModal> — native Stoa (Kadena coin) Send modal.
 *
 * Per docs/work/stoa-urstoa-vault-actions/design.md: Send's Pact code
 * mirrors OuronetUI's `transfer-token.tsx` — `coin.C_Transfer` when the
 * receiver account already exists on-chain, `coin.C_TransferAnew` (create +
 * transfer, k: receivers only) when it doesn't. Existence is probed via
 * `checkCoinAccountExists` (the NATIVE coin.get-balance probe exported from
 * `ouroPriceFunctions.ts` — NOT the UrStoa-scoped function of the same name
 * in `urStoaFunctions.ts`). Dispatch goes through `useSignTransaction()`'s
 * `execute` (CodexSigningStrategy), NOT `useGetKeypair` directly.
 *
 * These specs mock `useSignTransaction` and `checkCoinAccountExists` — no
 * real network call, no real key material, ever.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const executeMock = vi.fn();
const signMock = vi.fn();
const getKeypairMock = vi.fn();
vi.mock("@ancientpantheon/codex-ouronet/hooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useSignTransaction: () => ({ execute: executeMock, sign: signMock, strategy: {} as any }),
    useGetKeypair: () => getKeypairMock,
  };
});

// The crosschain build/poll/continue mechanics themselves are NOT reimplemented
// here — `@ouronet/ouronet-core/interactions/crossChainFunctions` (already
// installed, already audited) is the single source of truth. These specs
// mock its own functions the same hermetic way every other network call in
// this suite is mocked — no real chain polling, ever.
const buildCTransferAcrossMock = vi.fn();
const submitCrossChainTransferMock = vi.fn();
const pollTransactionStatusMock = vi.fn();
const pollSpvProofMock = vi.fn();
const buildContinuationTransactionMock = vi.fn();
const submitContinuationMock = vi.fn();
vi.mock("@ouronet/ouronet-core/interactions/crossChainFunctions", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    buildCTransferAcross: (...args: unknown[]) => buildCTransferAcrossMock(...args),
    submitCrossChainTransfer: (...args: unknown[]) => submitCrossChainTransferMock(...args),
    pollTransactionStatus: (...args: unknown[]) => pollTransactionStatusMock(...args),
    pollSpvProof: (...args: unknown[]) => pollSpvProofMock(...args),
    buildContinuationTransaction: (...args: unknown[]) => buildContinuationTransactionMock(...args),
    submitContinuation: (...args: unknown[]) => submitContinuationMock(...args),
  };
});

// Pops the REAL password prompt when the codex is locked, per the reported
// bug: a locked-codex send/stake/etc must prompt-and-resume, never just
// dead-end on a text error. Defaults to "already unlocked" for every
// pre-existing test; the two new tests below override this per-case.
const ensureCodexUnlockedMock = vi.fn(async () => true);
vi.mock("../src/zbom/hooks/useEnsureCodexUnlocked", () => ({
  useEnsureCodexUnlocked: () => ensureCodexUnlockedMock,
}));

const checkCoinAccountExistsMock = vi.fn();
vi.mock("@ouronet/ouronet-core/interactions/ouroPriceFunctions", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    checkCoinAccountExists: (...args: unknown[]) => checkCoinAccountExistsMock(...args),
  };
});

// The tx-status toast — real usage lives in zbom/modals/RotatePaymentKeyModal.tsx
// (txPending(title) → .submitted(requestKey) on success, .fail(msg) on error).
// Mocked here so specs stay hermetic (no real chain polling / global toast store).
const txSubmittedMock = vi.fn();
const txFailMock = vi.fn();
const txPendingMock = vi.fn((_title: string) => ({
  start: vi.fn(),
  submitted: txSubmittedMock,
  fail: txFailMock,
  done: vi.fn(),
  dismiss: vi.fn(),
}));
// The crosschain path's own REAL multi-step toast (SendStoaModal.tsx no
// longer uses the single-step txPending wrapper above for crosschain sends —
// see CROSSCHAIN_TOAST_STEPS's own doc comment). `updateStepMock` captures
// every step transition so a test can assert WHICH step reported success/
// error, not just that some generic toast fired.
const updateStepMock = vi.fn();
const createMultiStepToastMock = vi.fn((_opts: unknown) => ({
  id: "mock-multi-step-toast",
  updateStep: updateStepMock,
  dismiss: vi.fn(),
}));
const pollStoaChainConfirmationMock = vi.fn(async (..._args: unknown[]) => {});
vi.mock("../src/zbom/toast/toastManager", () => ({
  txPending: (title: string) => txPendingMock(title),
  createMultiStepToast: (opts: unknown) => createMultiStepToastMock(opts),
  pollStoaChainConfirmation: (...args: unknown[]) => pollStoaChainConfirmationMock(...args),
}));

import { CodexLockedError } from "@ancientpantheon/codex-ouronet/errors";
import { SendStoaModal } from "../src/ui/internal/SendStoaModal";

const PUBLIC_KEY = "a".repeat(64);
const ADDRESS = `k:${PUBLIC_KEY}`;
const RECEIVER_EXISTING = `k:${"c".repeat(64)}`;
const RECEIVER_NEW_K = `k:${"b".repeat(64)}`;
const RECEIVER_NEW_NON_K = "u:some-non-k-account";

/** Fake `build()` context — mirrors what CodexSigningStrategy.execute passes
 *  its `build` closure at runtime. Values are arbitrary placeholders; the
 *  builder never touches the network. */
const FAKE_BUILD_CTX = {
  gasLimit: 500_000,
  capsKeyPub: "gas-station-pub".padEnd(64, "0"),
  guardPubs: [PUBLIC_KEY],
  gasPrice: 1e-8,
  creationTime: 1_770_000_000,
};

function extractPactCode(
  tx: { cmd: string },
): { code: string; data: Record<string, unknown>; signers: Array<{ pubKey: string; clist?: Array<{ name: string; args: unknown[] }> }> } {
  const parsed = JSON.parse(tx.cmd);
  return { code: parsed.payload.exec.code, data: parsed.payload.exec.data, signers: parsed.signers };
}

describe("<SendStoaModal>", () => {
  beforeEach(() => {
    executeMock.mockReset();
    signMock.mockReset();
    getKeypairMock.mockReset();
    buildCTransferAcrossMock.mockReset();
    submitCrossChainTransferMock.mockReset();
    pollTransactionStatusMock.mockReset();
    pollSpvProofMock.mockReset();
    buildContinuationTransactionMock.mockReset();
    submitContinuationMock.mockReset();
    checkCoinAccountExistsMock.mockReset();
    txPendingMock.mockClear();
    txSubmittedMock.mockClear();
    txFailMock.mockClear();
    createMultiStepToastMock.mockClear();
    updateStepMock.mockClear();
    pollStoaChainConfirmationMock.mockReset().mockResolvedValue(undefined);
    ensureCodexUnlockedMock.mockClear();
    ensureCodexUnlockedMock.mockResolvedValue(true);
  });

  it("renders nothing when isOpen=false", () => {
    const { container } = render(
      <SendStoaModal isOpen={false} onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />
    );
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("renders the receiver/amount inputs and a disabled submit button when isOpen=true with no input", () => {
    render(<SendStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /send stoa/i })).toBeTruthy();
    expect(screen.getByLabelText(/receiver/i)).toBeTruthy();
    expect(screen.getByLabelText(/amount/i)).toBeTruthy();
    const submit = screen.getByRole("button", { name: /send stoa/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the sending chain and the sender's balance on that chain when senderBalanceByChain has an entry for it", () => {
    render(
      <SendStoaModal
        isOpen
        onClose={() => {}}
        publicKey={PUBLIC_KEY}
        address={ADDRESS}
        senderBalanceByChain={{ "0": { balance: 42.5, exists: true }, "3": { balance: 99, exists: true } }}
      />
    );
    expect(screen.getAllByText(/chain 0/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/42\.5/)).toBeTruthy();
    // The address stays visible too — a complete send popup names sender
    // chain, sender balance, sender address, AND (same-chain transfer)
    // receiving chain together, not just the bare address.
    expect(screen.getByText(ADDRESS)).toBeTruthy();
  });

  it("re-derives the displayed balance when the user picks a different source chain — never sticks to chain 0's value", () => {
    render(
      <SendStoaModal
        isOpen
        onClose={() => {}}
        publicKey={PUBLIC_KEY}
        address={ADDRESS}
        senderBalanceByChain={{ "0": { balance: 42.5, exists: true }, "3": { balance: 99, exists: true } }}
      />
    );
    expect(screen.getByText(/42\.5/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "3" })[0]); // source chain selector's "3" button
    expect(screen.getByText(/99\.0/)).toBeTruthy();
    expect(screen.queryByText(/42\.5/)).toBeNull();
  });

  it("shows a balance-unknown state (never a crash or a stale zero) when senderBalanceByChain is omitted", () => {
    render(<SendStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    expect(screen.getAllByText(/chain 0/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/—/).length).toBeGreaterThan(0);
  });

  it("rejects a non-numeric amount and keeps submit disabled", () => {
    render(<SendStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_EXISTING } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "abc" } });
    expect(screen.getByRole("alert").textContent).toMatch(/valid positive amount/i);
    const submit = screen.getByRole("button", { name: /send stoa/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it("rejects a zero amount", () => {
    render(<SendStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_EXISTING } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "0" } });
    expect(screen.getByRole("alert").textContent).toMatch(/greater than 0/i);
  });

  it("keeps submit disabled while the receiver field is too short, even with a valid amount", () => {
    render(<SendStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: "k:a" } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
    const submit = screen.getByRole("button", { name: /send stoa/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables submit for a valid receiver + positive amount", () => {
    render(<SendStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_EXISTING } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
    expect(screen.queryByRole("alert")).toBeNull();
    const submit = screen.getByRole("button", { name: /send stoa/i });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("builds coin.C_Transfer (no keyset data) when the receiver account already exists", async () => {
    checkCoinAccountExistsMock.mockResolvedValue(true);
    let captured: any = null;
    executeMock.mockImplementation(async ({ build }: any) => {
      captured = build(FAKE_BUILD_CTX);
      return { requestKey: "req-exists" };
    });

    render(<SendStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_EXISTING } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /send stoa/i }));

    await waitFor(() => expect(executeMock).toHaveBeenCalledTimes(1));
    expect(checkCoinAccountExistsMock).toHaveBeenCalledWith(RECEIVER_EXISTING);
    const { code, data, signers } = extractPactCode(captured);
    expect(code).toBe(`(coin.C_Transfer "${ADDRESS}" "${RECEIVER_EXISTING}" 5.0)`);
    expect(data?.ks).toBeUndefined();
    // Live bug fix regression lock: the sender's own signer must explicitly
    // declare `coin.TRANSFER` (coin-live.pact's own real `@managed`
    // capability C_Transfer requires underneath) — an earlier version added
    // this signer BARE (no clist at all), which produced the live-reported
    // "Managed capability coin.TRANSFER was not installed" on real chain.
    const senderSigner = signers.find((s) => s.pubKey === PUBLIC_KEY);
    expect(senderSigner?.clist).toEqual([
      { name: "coin.TRANSFER", args: [ADDRESS, RECEIVER_EXISTING, { decimal: "5.0" }] },
    ]);
  });

  it("builds coin.C_TransferAnew with the receiver's derived keyset when the receiver doesn't exist and is a k: account", async () => {
    checkCoinAccountExistsMock.mockResolvedValue(false);
    let captured: any = null;
    executeMock.mockImplementation(async ({ build }: any) => {
      captured = build(FAKE_BUILD_CTX);
      return { requestKey: "req-new" };
    });

    render(<SendStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_NEW_K } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /send stoa/i }));

    await waitFor(() => expect(executeMock).toHaveBeenCalledTimes(1));
    const { code, data, signers } = extractPactCode(captured);
    expect(code).toBe(`(coin.C_TransferAnew "${ADDRESS}" "${RECEIVER_NEW_K}" (read-keyset "ks") 5.0)`);
    expect(data?.ks).toEqual({ keys: ["b".repeat(64)], pred: "keys-all" });
    // Same live-bug-fix regression lock as the C_Transfer case above —
    // C_TransferAnew requires the SAME coin.TRANSFER capability underneath
    // (transfer-create's own body is also `(with-capability (TRANSFER ...))`).
    const senderSigner = signers.find((s) => s.pubKey === PUBLIC_KEY);
    expect(senderSigner?.clist).toEqual([
      { name: "coin.TRANSFER", args: [ADDRESS, RECEIVER_NEW_K, { decimal: "5.0" }] },
    ]);
  });

  it("does not submit when the receiver doesn't exist and isn't a k: account", async () => {
    checkCoinAccountExistsMock.mockResolvedValue(false);
    render(<SendStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_NEW_NON_K } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /send stoa/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/only k: accounts can be auto-created/i)
    );
    expect(executeMock).not.toHaveBeenCalled();
    // The toast was already started (right before submitting) — it must NOT
    // be left hanging in "Confirming…" forever just because this refusal
    // returns early instead of throwing.
    expect(txFailMock).toHaveBeenCalledWith(expect.stringMatching(/only k: accounts can be auto-created/i));
  });

  it("does not submit when receiver existence can't be verified", async () => {
    checkCoinAccountExistsMock.mockResolvedValue(null);
    render(<SendStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_EXISTING } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /send stoa/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/could not verify/i)
    );
    expect(executeMock).not.toHaveBeenCalled();
    expect(txFailMock).toHaveBeenCalledWith(expect.stringMatching(/could not verify/i));
  });

  it("on success: calls onSuccess with the request key and closes", async () => {
    checkCoinAccountExistsMock.mockResolvedValue(true);
    executeMock.mockResolvedValue({ requestKey: "req-key-1" });
    let closedCount = 0;
    const onSuccess = vi.fn();
    render(
      <SendStoaModal
        isOpen
        onClose={() => { closedCount++; }}
        onSuccess={onSuccess}
        publicKey={PUBLIC_KEY}
        address={ADDRESS}
      />
    );
    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_EXISTING } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "3.5" } });
    fireEvent.click(screen.getByRole("button", { name: /send stoa/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("req-key-1"));
    expect(closedCount).toBe(1);
    // Regression: the modal submitted a real on-chain tx but showed NO toast
    // ("transaction submitted, waiting for confirmation") — this is that toast.
    expect(txPendingMock).toHaveBeenCalledWith("Send Stoa");
    // The chainId arg matters: omitting it defaults the toast's own polling
    // to chain 0 regardless of which chain the tx actually executed on.
    expect(txSubmittedMock).toHaveBeenCalledWith("req-key-1", "0");
    expect(txFailMock).not.toHaveBeenCalled();
  });

  it("shows a locked-codex message (and does not close) when execute throws CodexLockedError", async () => {
    checkCoinAccountExistsMock.mockResolvedValue(true);
    executeMock.mockRejectedValue(new CodexLockedError("send stoa"));
    let closedCount = 0;
    render(
      <SendStoaModal isOpen onClose={() => { closedCount++; }} publicKey={PUBLIC_KEY} address={ADDRESS} />
    );
    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_EXISTING } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /send stoa/i }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/locked/i));
    expect(closedCount).toBe(0);
    // The toast must resolve to an error state too — never left hanging.
    expect(txFailMock).toHaveBeenCalledWith(expect.stringMatching(/locked/i));
  });

  it("surfaces the real on-chain failure message verbatim (never swallowed)", async () => {
    checkCoinAccountExistsMock.mockResolvedValue(true);
    executeMock.mockRejectedValue(new Error("Simulation failed: insufficient STOA balance"));
    render(<SendStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_EXISTING } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /send stoa/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/insufficient STOA balance/i)
    );
    // The tx toast must ALSO surface the real failure — never silently swallowed.
    expect(txFailMock).toHaveBeenCalledWith(expect.stringMatching(/insufficient STOA balance/i));
  });

  it("calls the codex-unlock gate BEFORE execute on every submit — pops the REAL password prompt if locked, instead of erroring out", async () => {
    checkCoinAccountExistsMock.mockResolvedValue(true);
    const callOrder: string[] = [];
    ensureCodexUnlockedMock.mockImplementation(async () => {
      callOrder.push("ensureUnlocked");
      return true;
    });
    executeMock.mockImplementation(async () => {
      callOrder.push("execute");
      return { requestKey: "req-key-gate" };
    });
    render(<SendStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);

    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_EXISTING } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /send stoa/i }));

    await waitFor(() => expect(executeMock).toHaveBeenCalledTimes(1));
    expect(callOrder).toEqual(["ensureUnlocked", "execute"]);
  });

  it("when the user cancels the password prompt, stops quietly — no execute call, no error toast, no alert", async () => {
    ensureCodexUnlockedMock.mockResolvedValueOnce(false);
    render(<SendStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);

    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_EXISTING } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "2" } });
    const submit = screen.getByRole("button", { name: /send stoa/i });
    fireEvent.click(submit);

    await waitFor(() => expect(ensureCodexUnlockedMock).toHaveBeenCalledTimes(1));
    expect(checkCoinAccountExistsMock).not.toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
    expect(txFailMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("resets receiver/amount/error state each time the modal re-opens", () => {
    const { rerender } = render(
      <SendStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />
    );
    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_EXISTING } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "9" } });
    rerender(<SendStoaModal isOpen={false} onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    rerender(<SendStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    expect((screen.getByLabelText(/receiver/i) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(/amount/i) as HTMLInputElement).value).toBe("");
  });

  describe("crosschain (source chain !== target chain)", () => {
    it("defaults source and target to the SAME chain (0/0) — every pre-existing test above relies on this default staying same-chain", () => {
      render(<SendStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
      const sourceButtons = screen.getAllByRole("button", { name: "0" });
      // At least one "0" button (source) is pressed; target defaults to the
      // SAME chain too, so there is exactly one selected chain overall, not two.
      const pressed = screen.getAllByRole("button", { pressed: true });
      expect(pressed.length).toBe(2); // source's "0" AND target's "0", same chain id, two selectors
      expect(sourceButtons.length).toBeGreaterThan(0);
    });

    it("choosing the SAME chain on both selectors keeps the existing same-chain path (C_Transfer via execute) unchanged", async () => {
      checkCoinAccountExistsMock.mockResolvedValue(true);
      executeMock.mockResolvedValue({ requestKey: "req-samechain" });
      render(<SendStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
      fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_EXISTING } });
      fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
      fireEvent.click(screen.getByRole("button", { name: /send stoa/i }));

      await waitFor(() => expect(executeMock).toHaveBeenCalledTimes(1));
      expect(buildCTransferAcrossMock).not.toHaveBeenCalled();
    });

    it("same-chain is reachable on a NON-default chain too (e.g. chain 3) — picking source chain 3 does not permanently disable target chain 3, and the same-chain path (C_Transfer) is used, not C_TransferAcross", async () => {
      checkCoinAccountExistsMock.mockResolvedValue(true);
      executeMock.mockResolvedValue({ requestKey: "req-samechain-3" });
      render(<SendStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);

      // Pick source chain 3 first (Source selector is the first "3" button).
      fireEvent.click(screen.getAllByRole("button", { name: "3" })[0]);
      // Target chain 3's button must still be clickable.
      const targetThree = screen.getAllByRole("button", { name: "3" })[1] as HTMLButtonElement;
      expect(targetThree.disabled).toBe(false);
      fireEvent.click(targetThree);
      expect(targetThree.getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByText("coin.C_Transfer / coin.C_TransferAnew")).toBeTruthy();

      fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_EXISTING } });
      fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
      fireEvent.click(screen.getByRole("button", { name: /send stoa/i }));

      await waitFor(() => expect(executeMock).toHaveBeenCalledTimes(1));
      expect(buildCTransferAcrossMock).not.toHaveBeenCalled();
    });

    it("source=0, target=1: fires C_TransferAcross through the SAME gas-station execute() pipeline (chain 0 path)", async () => {
      let captured: any = null;
      executeMock.mockImplementation(async ({ build }: any) => {
        captured = build(FAKE_BUILD_CTX);
        return { requestKey: "req-across-0" };
      });
      pollTransactionStatusMock.mockResolvedValue({ status: "success" });
      pollSpvProofMock.mockResolvedValue({ proof: "spv-proof-blob" });
      buildContinuationTransactionMock.mockReturnValue({ cont: true });
      submitContinuationMock.mockResolvedValue({ requestKey: "req-cont-0" });

      render(<SendStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
      fireEvent.click(screen.getAllByRole("button", { name: "1" })[1]); // target selector's "1"
      fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_NEW_K } });
      fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
      fireEvent.click(screen.getByRole("button", { name: /send stoa/i }));

      await waitFor(() => expect(executeMock).toHaveBeenCalledTimes(1));
      expect(buildCTransferAcrossMock).not.toHaveBeenCalled();
      const { code, signers } = extractPactCode(captured);
      expect(code).toContain("coin.C_TransferAcross");
      expect(code).toContain('"1"'); // target-chain argument
      // Same live-bug-fix regression lock as the same-chain path: the
      // sender's own signer must explicitly declare `coin.TRANSFER_XCHAIN`
      // (coin-live.pact's own real `@managed` capability
      // `transfer-crosschain` requires) — note the arg order is
      // sender/receiver/amount/target-chain, NOT the function call's own
      // sender/receiver/target-chain/amount order.
      const senderSigner = signers.find((s) => s.pubKey === PUBLIC_KEY);
      expect(senderSigner?.clist).toEqual([
        { name: "coin.TRANSFER_XCHAIN", args: [ADDRESS, RECEIVER_NEW_K, { decimal: "5.0" }, "1"] },
      ]);
      await waitFor(() => expect(submitContinuationMock).toHaveBeenCalled());
    });

    // Live UX report: a real cross-chain send took several minutes end to
    // end, and the ONLY visible progress was static text inside the modal —
    // no toast appeared until the very end, so a user who looked away saw
    // nothing. This locks in the fix: a REAL 3-step toast, created up front
    // and updated at each actual stage transition, never the single-step
    // txPending wrapper.
    it("creates a REAL 3-step toast for a crosschain send (not the single-step txPending wrapper), and drives every step as the flow actually progresses", async () => {
      executeMock.mockImplementation(async ({ build }: any) => {
        build(FAKE_BUILD_CTX);
        return { requestKey: "req-init-steps" };
      });
      pollTransactionStatusMock.mockResolvedValue({ status: "success" });
      pollSpvProofMock.mockResolvedValue({ proof: "spv-proof-blob" });
      buildContinuationTransactionMock.mockReturnValue({ cont: true });
      submitContinuationMock.mockResolvedValue({ requestKey: "req-cont-steps" });

      render(<SendStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
      fireEvent.click(screen.getAllByRole("button", { name: "1" })[1]);
      fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_NEW_K } });
      fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
      fireEvent.click(screen.getByRole("button", { name: /send stoa/i }));

      await waitFor(() => expect(submitContinuationMock).toHaveBeenCalled());

      // The toast was created ONCE, up front, with 3 real step labels — not
      // the generic single "Processing" step txPending always uses.
      expect(createMultiStepToastMock).toHaveBeenCalledTimes(1);
      expect(txPendingMock).not.toHaveBeenCalled();
      const createArgs = createMultiStepToastMock.mock.calls[0][0] as { steps: Array<{ label: string }> };
      expect(createArgs.steps.map((s) => s.label)).toEqual([
        "Confirming on source chain",
        "Waiting for cross-chain proof",
        "Completing on target chain",
      ]);

      // Step 0 got the REAL initiate requestKey attached as soon as it
      // existed — not only once the whole flow finished.
      expect(updateStepMock).toHaveBeenCalledWith(0, "active", { requestKey: "req-init-steps" });
      // Step 0 completed once the initiate step actually confirmed.
      expect(updateStepMock).toHaveBeenCalledWith(0, "done", { requestKey: "req-init-steps" });
      // Step 1 (SPV proof) completed once the proof arrived.
      expect(updateStepMock).toHaveBeenCalledWith(1, "done");
      // Step 2's own on-chain confirmation is delegated to the SAME shared
      // poller `.submitted()` uses for a single-step toast — never a second,
      // independently-editable copy of the fetch/retry/timeout logic.
      expect(pollStoaChainConfirmationMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: "mock-multi-step-toast" }),
        2,
        "req-cont-steps",
        "1",
      );
    });

    it("source=3, target=5: signs+submits directly (buildCTransferAcross + useGetKeypair + sign), never through execute()", async () => {
      const keypair = { publicKey: PUBLIC_KEY, privateKey: "priv" } as any;
      getKeypairMock.mockResolvedValue(keypair);
      buildCTransferAcrossMock.mockReturnValue({ cmd: "unsigned-tx" });
      signMock.mockResolvedValue({ cmd: "signed-tx" });
      submitCrossChainTransferMock.mockResolvedValue({ requestKey: "req-across-35" });
      pollTransactionStatusMock.mockResolvedValue({ status: "success" });
      pollSpvProofMock.mockResolvedValue({ proof: "spv-proof-blob" });
      buildContinuationTransactionMock.mockReturnValue({ cont: true });
      submitContinuationMock.mockResolvedValue({ requestKey: "req-cont-35" });

      render(<SendStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
      fireEvent.click(screen.getAllByRole("button", { name: "3" })[0]); // source selector's "3"
      fireEvent.click(screen.getAllByRole("button", { name: "5" })[1]); // target selector's "5"
      fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_NEW_K } });
      fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
      fireEvent.click(screen.getByRole("button", { name: /send stoa/i }));

      await waitFor(() => expect(submitCrossChainTransferMock).toHaveBeenCalledTimes(1));
      expect(executeMock).not.toHaveBeenCalled();
      const buildArgs = buildCTransferAcrossMock.mock.calls[0][0];
      expect(buildArgs.sourceChain).toBe("3");
      expect(buildArgs.targetChain).toBe("5");
      expect(getKeypairMock).toHaveBeenCalledWith(PUBLIC_KEY);
      expect(signMock).toHaveBeenCalledWith(
        expect.objectContaining({ tx: { cmd: "unsigned-tx" }, capsKey: keypair }),
      );
      expect(submitCrossChainTransferMock).toHaveBeenCalledWith({ cmd: "signed-tx" }, "3");
      await waitFor(() => expect(submitContinuationMock).toHaveBeenCalled());
    });

    it("auto-submits the SPV-proof continuation after the initiate step confirms — onSuccess/onClose fire only after the continuation succeeds, not right after initiate", async () => {
      getKeypairMock.mockResolvedValue({ publicKey: PUBLIC_KEY, privateKey: "priv" } as any);
      buildCTransferAcrossMock.mockReturnValue({ cmd: "unsigned-tx" });
      signMock.mockResolvedValue({ cmd: "signed-tx" });
      submitCrossChainTransferMock.mockResolvedValue({ requestKey: "req-init" });
      pollTransactionStatusMock.mockResolvedValue({ status: "success" });
      pollSpvProofMock.mockResolvedValue({ proof: "the-spv-proof" });
      buildContinuationTransactionMock.mockReturnValue({ cont: true });
      // Gate the FINAL step behind a manually-resolved promise, so the test
      // can deterministically observe "everything up to the continuation
      // ran, but onSuccess/onClose have not fired yet" without racing a
      // waitFor against an all-synchronous-resolution chain.
      let resolveContinuation!: (v: { requestKey: string }) => void;
      submitContinuationMock.mockReturnValue(
        new Promise((resolve) => { resolveContinuation = resolve; }),
      );

      const onSuccess = vi.fn();
      let closedCount = 0;
      render(
        <SendStoaModal isOpen onClose={() => { closedCount++; }} onSuccess={onSuccess} publicKey={PUBLIC_KEY} address={ADDRESS} />,
      );
      fireEvent.click(screen.getAllByRole("button", { name: "3" })[0]);
      fireEvent.click(screen.getAllByRole("button", { name: "5" })[1]);
      fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_NEW_K } });
      fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
      fireEvent.click(screen.getByRole("button", { name: /send stoa/i }));

      await waitFor(() => expect(submitContinuationMock).toHaveBeenCalledWith({ cont: true }, "5"));
      // Every step up to (and including calling) the continuation has run —
      // but it hasn't RESOLVED yet, so onSuccess/onClose must not have fired.
      expect(onSuccess).not.toHaveBeenCalled();
      expect(closedCount).toBe(0);

      resolveContinuation({ requestKey: "req-final" });
      await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("req-init"));
      expect(closedCount).toBe(1);
    });

    it("surfaces a crosschain failure (e.g. the initiate step itself fails) without a silent hang", async () => {
      getKeypairMock.mockResolvedValue({ publicKey: PUBLIC_KEY, privateKey: "priv" } as any);
      buildCTransferAcrossMock.mockReturnValue({ cmd: "unsigned-tx" });
      signMock.mockResolvedValue({ cmd: "signed-tx" });
      submitCrossChainTransferMock.mockRejectedValue(new Error("insufficient STOA balance on chain 3"));

      render(<SendStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
      fireEvent.click(screen.getAllByRole("button", { name: "3" })[0]);
      fireEvent.click(screen.getAllByRole("button", { name: "5" })[1]);
      fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_NEW_K } });
      fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
      fireEvent.click(screen.getByRole("button", { name: /send stoa/i }));

      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toMatch(/insufficient STOA balance on chain 3/i),
      );
      // Crosschain sends use the real multi-step toast now, not the
      // single-step txPending wrapper — this failure happened before the
      // initiate step ever confirmed, so step 0 (of CROSSCHAIN_TOAST_STEPS)
      // is the one that reports the error.
      expect(txFailMock).not.toHaveBeenCalled();
      expect(updateStepMock).toHaveBeenCalledWith(
        0,
        "error",
        expect.objectContaining({ label: expect.stringMatching(/insufficient STOA balance on chain 3/i) }),
      );
    });

    it("rejects a non-k: receiver for a cross-chain send BEFORE ever unlocking or building a transaction — submit stays disabled", () => {
      render(<SendStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
      fireEvent.click(screen.getAllByRole("button", { name: "1" })[1]); // target selector's "1" -> cross-chain
      fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_NEW_NON_K } });
      fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
      const submit = screen.getByRole("button", { name: /send stoa/i });
      expect((submit as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(submit);
      expect(ensureCodexUnlockedMock).not.toHaveBeenCalled();
      expect(executeMock).not.toHaveBeenCalled();
      expect(buildCTransferAcrossMock).not.toHaveBeenCalled();
    });

    it("shows the human-readable status text on screen as the crosschain flow progresses", async () => {
      getKeypairMock.mockResolvedValue({ publicKey: PUBLIC_KEY, privateKey: "priv" } as any);
      buildCTransferAcrossMock.mockReturnValue({ cmd: "unsigned-tx" });
      signMock.mockResolvedValue({ cmd: "signed-tx" });
      submitCrossChainTransferMock.mockResolvedValue({ requestKey: "req-status" });
      pollTransactionStatusMock.mockResolvedValue({ status: "success" });
      // Gate BOTH the SPV step and the continuation submit, so "waiting-spv"
      // and "completing" are each observable before the flow races past them
      // — `submitContinuation` resolving synchronously-fast would otherwise
      // flip straight to "done" (whose label is null) before a `waitFor`
      // poll ever catches "completing".
      let resolveSpv!: (v: { proof: string }) => void;
      pollSpvProofMock.mockReturnValue(new Promise((resolve) => { resolveSpv = resolve; }));
      buildContinuationTransactionMock.mockReturnValue({ cont: true });
      let resolveContinuation!: (v: { requestKey: string }) => void;
      submitContinuationMock.mockReturnValue(new Promise((resolve) => { resolveContinuation = resolve; }));

      render(<SendStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
      fireEvent.click(screen.getAllByRole("button", { name: "3" })[0]);
      fireEvent.click(screen.getAllByRole("button", { name: "5" })[1]);
      fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_NEW_K } });
      fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
      fireEvent.click(screen.getByRole("button", { name: /send stoa/i }));

      await waitFor(() => expect(screen.getByText(/waiting for the SPV proof/i)).toBeTruthy());
      resolveSpv({ proof: "spv-proof" });
      await waitFor(() => expect(screen.getByText(/completing the transfer/i)).toBeTruthy());
      resolveContinuation({ requestKey: "req-cont-status" });
      await waitFor(() => expect(submitContinuationMock).toHaveBeenCalled());
    });

    it("surfaces a distinct, non-alarming message (not a hard failure) when the initiate step is merely slow to confirm, not actually failed", async () => {
      vi.useFakeTimers();
      try {
        getKeypairMock.mockResolvedValue({ publicKey: PUBLIC_KEY, privateKey: "priv" } as any);
        buildCTransferAcrossMock.mockReturnValue({ cmd: "unsigned-tx" });
        signMock.mockResolvedValue({ cmd: "signed-tx" });
        submitCrossChainTransferMock.mockResolvedValue({ requestKey: "req-slow" });
        // Every poll attempt reports "pending" — the budget (20 attempts x
        // 5s = 100s) exhausts without a reported failure.
        pollTransactionStatusMock.mockResolvedValue({ status: "pending" });

        render(<SendStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
        fireEvent.click(screen.getAllByRole("button", { name: "3" })[0]);
        fireEvent.click(screen.getAllByRole("button", { name: "5" })[1]);
        fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_NEW_K } });
        fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
        fireEvent.click(screen.getByRole("button", { name: /send stoa/i }));

        // React 18 doesn't flush state updates made inside a bare timer
        // callback until the next `act()` — wrap the virtual-clock advance
        // so the resulting `setLastError` actually reaches the DOM before
        // we assert on it.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(100_000);
        });
        expect(screen.getByRole("alert").textContent).toMatch(/still confirming/i);
        expect(screen.getByRole("alert").textContent).not.toMatch(/did not confirm/i);
        expect(pollSpvProofMock).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("surfaces a timeout message (never a silent hang) when the SPV proof never arrives", async () => {
      getKeypairMock.mockResolvedValue({ publicKey: PUBLIC_KEY, privateKey: "priv" } as any);
      buildCTransferAcrossMock.mockReturnValue({ cmd: "unsigned-tx" });
      signMock.mockResolvedValue({ cmd: "signed-tx" });
      submitCrossChainTransferMock.mockResolvedValue({ requestKey: "req-spv-timeout" });
      pollTransactionStatusMock.mockResolvedValue({ status: "success" });
      pollSpvProofMock.mockResolvedValue({ proof: null, error: "Timed out waiting for the SPV proof." });

      render(<SendStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
      fireEvent.click(screen.getAllByRole("button", { name: "3" })[0]);
      fireEvent.click(screen.getAllByRole("button", { name: "5" })[1]);
      fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER_NEW_K } });
      fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
      fireEvent.click(screen.getByRole("button", { name: /send stoa/i }));

      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toMatch(/timed out waiting for the spv proof/i),
      );
      expect(buildContinuationTransactionMock).not.toHaveBeenCalled();
      // The initiate step (step 0) already succeeded here — the SPV wait
      // (step 1) is the one that failed.
      expect(txFailMock).not.toHaveBeenCalled();
      expect(updateStepMock).toHaveBeenCalledWith(
        1,
        "error",
        expect.objectContaining({ label: expect.stringMatching(/timed out waiting for the spv proof/i) }),
      );
    });

    it("picking a new source chain that collides with the current target leaves them equal — same-chain is a valid, reachable state, not one the UI snaps away from", () => {
      render(<SendStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
      // Move target to "1" first (source stays "0").
      fireEvent.click(screen.getAllByRole("button", { name: "1" })[1]);
      // Now pick source = "1" too — a genuine value change that collides
      // with the CURRENT target on purpose: same-chain (1 -> 1) is a valid
      // transfer, so the modal must NOT fight the user back out of it.
      fireEvent.click(screen.getAllByRole("button", { name: "1" })[0]);
      const pressed = screen.getAllByRole("button", { pressed: true });
      const pressedLabels = pressed.map((b) => b.textContent);
      expect(pressedLabels.filter((l) => l === "1").length).toBe(2); // both source and target are "1"
      expect(screen.getByText("coin.C_Transfer / coin.C_TransferAnew")).toBeTruthy();
    });
  });
});
