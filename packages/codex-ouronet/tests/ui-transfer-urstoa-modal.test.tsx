/**
 * <TransferUrStoaModal> — vault action modal for native UrStoa transfer
 * (`executeNativeUrStoaTransfer`, the coin.C_UR|Transfer/TransferAnew family).
 *
 * Same patronless / confirm-time-keypair contract as the other three vault
 * modals: the account IS the payment key, so the SAME decrypted keypair is
 * passed as `paymentKeypair` AND as the sole `senderGuardKeys` entry (design
 * decision #1 — "owning key" == the sender's own guard key here, since a
 * patronless sender is always its own payment key).
 *
 * Receiver existence is probed via `checkCoinAccountExists` (the SAME
 * urStoaFunctions export CollectUrStoaModal uses for its own payment key) —
 * mirroring OuronetUI's native-mode branch selection: an existing receiver
 * uses the plain Transfer, a non-existent k: receiver uses TransferAnew with
 * a derived single-key keyset, and a non-existent non-k: receiver is refused
 * before ever touching the network.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const getKeypairMock = vi.fn();
vi.mock("@ancientpantheon/codex-ouronet/hooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useGetKeypair: () => getKeypairMock };
});

const executeNativeUrStoaTransferMock = vi.fn();
const checkCoinAccountExistsMock = vi.fn();
vi.mock("@ouronet/ouronet-core/interactions/urStoaFunctions", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    executeNativeUrStoaTransfer: (...args: unknown[]) => executeNativeUrStoaTransferMock(...args),
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
import { TransferUrStoaModal } from "../src/ui/internal/TransferUrStoaModal";

const PUBLIC_KEY = "1".repeat(64);
const ADDRESS = `k:${PUBLIC_KEY}`;
const RECEIVER_PUB = "2".repeat(64);
const RECEIVER = `k:${RECEIVER_PUB}`;
const FAKE_KEYPAIR = { publicKey: PUBLIC_KEY, privateKey: "3".repeat(64) };

describe("<TransferUrStoaModal>", () => {
  beforeEach(() => {
    getKeypairMock.mockReset();
    executeNativeUrStoaTransferMock.mockReset();
    checkCoinAccountExistsMock.mockReset();
    txPendingMock.mockClear();
    txSubmittedMock.mockClear();
    txFailMock.mockClear();
  });

  it("renders nothing when isOpen=false", () => {
    const { container } = render(
      <TransferUrStoaModal isOpen={false} onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />
    );
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("renders receiver + amount inputs, submit disabled until both are valid", () => {
    render(<TransferUrStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    expect(screen.getByRole("heading", { name: /transfer urstoa/i })).toBeTruthy();
    const submit = screen.getByRole("button", { name: /transfer urstoa/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER } });
    expect((submit as HTMLButtonElement).disabled).toBe(true); // amount still empty

    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "4" } });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("rejects an invalid amount", () => {
    render(<TransferUrStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "0" } });
    expect(screen.getByRole("alert").textContent).toMatch(/greater than 0/i);
    expect((screen.getByRole("button", { name: /transfer urstoa/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("rejects sending to the sender's own address", () => {
    render(<TransferUrStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: ADDRESS } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "1" } });
    expect(screen.getByRole("alert").textContent).toMatch(/cannot be the same as sender/i);
    expect((screen.getByRole("button", { name: /transfer urstoa/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("existing receiver: calls executeNativeUrStoaTransfer with receiverExists=true and no receiverKeyset, using the SAME keypair as paymentKeypair + senderGuardKeys", async () => {
    checkCoinAccountExistsMock.mockResolvedValue(true);
    getKeypairMock.mockResolvedValue(FAKE_KEYPAIR);
    executeNativeUrStoaTransferMock.mockResolvedValue({ requestKey: "req-key-transfer" });
    const onSuccess = vi.fn();
    let closedCount = 0;
    render(
      <TransferUrStoaModal
        isOpen
        onClose={() => { closedCount++; }}
        onSuccess={onSuccess}
        publicKey={PUBLIC_KEY}
        address={ADDRESS}
      />
    );
    expect(getKeypairMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: /transfer urstoa/i }));

    await waitFor(() => expect(executeNativeUrStoaTransferMock).toHaveBeenCalledTimes(1));
    expect(getKeypairMock).toHaveBeenCalledWith(PUBLIC_KEY);
    expect(checkCoinAccountExistsMock).toHaveBeenCalledWith(RECEIVER);
    expect(executeNativeUrStoaTransferMock).toHaveBeenCalledWith(
      expect.objectContaining({
        senderAddress: ADDRESS,
        receiverAddress: RECEIVER,
        amount: "2.5",
        paymentKeyAddress: ADDRESS,
        paymentKeypair: FAKE_KEYPAIR,
        senderGuardKeys: [FAKE_KEYPAIR],
        isTransferFamily: true,
        receiverExists: true,
        receiverKeyset: undefined,
      })
    );
    expect(onSuccess).toHaveBeenCalledWith("req-key-transfer");
    expect(closedCount).toBe(1);
    // Regression: the modal submitted a real on-chain tx but showed NO toast
    // ("transaction submitted, waiting for confirmation") — this is that toast.
    expect(txPendingMock).toHaveBeenCalledWith("Transfer UrStoa");
    expect(txSubmittedMock).toHaveBeenCalledWith("req-key-transfer");
    expect(txFailMock).not.toHaveBeenCalled();
  });

  it("non-existent k: receiver: derives a single-key receiverKeyset and passes receiverExists=false", async () => {
    checkCoinAccountExistsMock.mockResolvedValue(null);
    getKeypairMock.mockResolvedValue(FAKE_KEYPAIR);
    executeNativeUrStoaTransferMock.mockResolvedValue({ requestKey: "req-key-anew" });
    render(<TransferUrStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);

    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /transfer urstoa/i }));

    await waitFor(() => expect(executeNativeUrStoaTransferMock).toHaveBeenCalledTimes(1));
    expect(executeNativeUrStoaTransferMock).toHaveBeenCalledWith(
      expect.objectContaining({
        receiverExists: false,
        receiverKeyset: { keys: [RECEIVER_PUB], pred: "keys-all" },
      })
    );
  });

  it("non-existent non-k: receiver: refuses to submit and never calls executeNativeUrStoaTransfer", async () => {
    checkCoinAccountExistsMock.mockResolvedValue(false);
    getKeypairMock.mockResolvedValue(FAKE_KEYPAIR);
    render(<TransferUrStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);

    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: "c:some-custom-account" } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /transfer urstoa/i }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/not found/i));
    expect(executeNativeUrStoaTransferMock).not.toHaveBeenCalled();
    // The toast was already started (right before submitting) — it must NOT
    // be left hanging in "Confirming…" forever just because this refusal
    // returns early instead of throwing.
    expect(txFailMock).toHaveBeenCalledWith(expect.stringMatching(/not found/i));
  });

  it("shows a locked-codex message when useGetKeypair throws CodexLockedError, and does not close", async () => {
    getKeypairMock.mockRejectedValue(new CodexLockedError("transfer urstoa"));
    let closedCount = 0;
    render(
      <TransferUrStoaModal isOpen onClose={() => { closedCount++; }} publicKey={PUBLIC_KEY} address={ADDRESS} />
    );
    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /transfer urstoa/i }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/locked/i));
    expect(executeNativeUrStoaTransferMock).not.toHaveBeenCalled();
    expect(closedCount).toBe(0);
    // The toast must resolve to an error state too — never left hanging.
    expect(txFailMock).toHaveBeenCalledWith(expect.stringMatching(/locked/i));
  });

  it("surfaces the real on-chain failure message verbatim", async () => {
    checkCoinAccountExistsMock.mockResolvedValue(true);
    getKeypairMock.mockResolvedValue(FAKE_KEYPAIR);
    executeNativeUrStoaTransferMock.mockRejectedValue(new Error("Simulation failed: insufficient balance"));
    render(<TransferUrStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);

    fireEvent.change(screen.getByLabelText(/receiver/i), { target: { value: RECEIVER } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /transfer urstoa/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/insufficient balance/i)
    );
    // The tx toast must ALSO surface the real failure — never silently swallowed.
    expect(txFailMock).toHaveBeenCalledWith(expect.stringMatching(/insufficient balance/i));
  });
});
