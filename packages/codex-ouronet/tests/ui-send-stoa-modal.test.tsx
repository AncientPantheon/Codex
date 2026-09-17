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
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const executeMock = vi.fn();
vi.mock("@ancientpantheon/codex-ouronet/hooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useSignTransaction: () => ({ execute: executeMock, sign: vi.fn(), strategy: {} as any }),
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
vi.mock("../src/zbom/toast/toastManager", () => ({
  txPending: (title: string) => txPendingMock(title),
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

function extractPactCode(tx: { cmd: string }): { code: string; data: Record<string, unknown> } {
  const parsed = JSON.parse(tx.cmd);
  return { code: parsed.payload.exec.code, data: parsed.payload.exec.data };
}

describe("<SendStoaModal>", () => {
  beforeEach(() => {
    executeMock.mockReset();
    checkCoinAccountExistsMock.mockReset();
    txPendingMock.mockClear();
    txSubmittedMock.mockClear();
    txFailMock.mockClear();
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

  it("shows the sending chain and the sender's balance on that chain when senderChainBalance is provided", () => {
    render(
      <SendStoaModal
        isOpen
        onClose={() => {}}
        publicKey={PUBLIC_KEY}
        address={ADDRESS}
        senderChainBalance={42.5}
      />
    );
    expect(screen.getAllByText(/chain 0/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/42\.5/)).toBeTruthy();
    // The address stays visible too — a complete send popup names sender
    // chain, sender balance, sender address, AND (same-chain transfer)
    // receiving chain together, not just the bare address.
    expect(screen.getByText(ADDRESS)).toBeTruthy();
  });

  it("shows a balance-unknown state (never a crash or a stale zero) when senderChainBalance is omitted", () => {
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
    const { code, data } = extractPactCode(captured);
    expect(code).toBe(`(coin.C_Transfer "${ADDRESS}" "${RECEIVER_EXISTING}" 5.0)`);
    expect(data?.ks).toBeUndefined();
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
    const { code, data } = extractPactCode(captured);
    expect(code).toBe(`(coin.C_TransferAnew "${ADDRESS}" "${RECEIVER_NEW_K}" (read-keyset "ks") 5.0)`);
    expect(data?.ks).toEqual({ keys: ["b".repeat(64)], pred: "keys-all" });
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
    expect(txSubmittedMock).toHaveBeenCalledWith("req-key-1");
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
});
