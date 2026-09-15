/**
 * <CollectUrStoaModal> — vault action modal for `coin.C_URV|Collect`.
 *
 * No amount input (straight confirm) — same patronless / confirm-time-keypair
 * contract as Stake/Unstake (see ui-stake-urstoa-modal.test.tsx's header
 * comment for the full design.md rationale). This modal additionally probes
 * the payment key's own on-chain existence via `checkCoinAccountExists`
 * (mirroring OuronetUI's CollectUrStoaModal + `executeCollectUrStoa`'s own
 * internal accountExists branch) so the create-account-then-collect path is
 * selected correctly for a virgin payment key.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const getKeypairMock = vi.fn();
vi.mock("@ancientpantheon/codex-ouronet/hooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useGetKeypair: () => getKeypairMock };
});

const executeCollectUrStoaMock = vi.fn();
const checkCoinAccountExistsMock = vi.fn();
vi.mock("@ouronet/ouronet-core/interactions/urStoaFunctions", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    executeCollectUrStoa: (...args: unknown[]) => executeCollectUrStoaMock(...args),
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
import { CollectUrStoaModal } from "../src/ui/internal/CollectUrStoaModal";

const PUBLIC_KEY = "e".repeat(64);
const ADDRESS = `k:${PUBLIC_KEY}`;
const FAKE_KEYPAIR = { publicKey: PUBLIC_KEY, privateKey: "f".repeat(64) };

describe("<CollectUrStoaModal>", () => {
  beforeEach(() => {
    getKeypairMock.mockReset();
    executeCollectUrStoaMock.mockReset();
    checkCoinAccountExistsMock.mockReset();
    txPendingMock.mockClear();
    txSubmittedMock.mockClear();
    txFailMock.mockClear();
  });

  it("renders nothing when isOpen=false", () => {
    const { container } = render(
      <CollectUrStoaModal isOpen={false} onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />
    );
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("renders a straight confirm dialog with no amount input", () => {
    render(<CollectUrStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    expect(screen.getByRole("heading", { name: /collect/i })).toBeTruthy();
    expect(screen.queryByLabelText(/amount/i)).toBeNull();
    const submit = screen.getByRole("button", { name: /collect/i });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("probes on-chain existence and passes accountExists=true through to executeCollectUrStoa", async () => {
    checkCoinAccountExistsMock.mockResolvedValue(true);
    getKeypairMock.mockResolvedValue(FAKE_KEYPAIR);
    executeCollectUrStoaMock.mockResolvedValue({ requestKey: "req-key-collect" });
    const onSuccess = vi.fn();
    let closedCount = 0;
    render(
      <CollectUrStoaModal
        isOpen
        onClose={() => { closedCount++; }}
        onSuccess={onSuccess}
        publicKey={PUBLIC_KEY}
        address={ADDRESS}
      />
    );
    expect(getKeypairMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /collect/i }));

    await waitFor(() => expect(executeCollectUrStoaMock).toHaveBeenCalledTimes(1));
    expect(checkCoinAccountExistsMock).toHaveBeenCalledWith(ADDRESS);
    expect(executeCollectUrStoaMock).toHaveBeenCalledWith(
      expect.objectContaining({ paymentKeyAddress: ADDRESS, gasStationKey: FAKE_KEYPAIR, accountExists: true })
    );
    expect(onSuccess).toHaveBeenCalledWith("req-key-collect");
    expect(closedCount).toBe(1);
    // Regression: the modal submitted a real on-chain tx but showed NO toast
    // ("transaction submitted, waiting for confirmation") — this is that toast.
    expect(txPendingMock).toHaveBeenCalledWith("Collect UrStoa Earnings");
    expect(txSubmittedMock).toHaveBeenCalledWith("req-key-collect");
    expect(txFailMock).not.toHaveBeenCalled();
  });

  it("treats a virgin (never-existing) payment key as accountExists=false", async () => {
    checkCoinAccountExistsMock.mockResolvedValue(null); // null = uncertain/non-existent
    getKeypairMock.mockResolvedValue(FAKE_KEYPAIR);
    executeCollectUrStoaMock.mockResolvedValue({ requestKey: "req-key-virgin" });
    render(<CollectUrStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);

    fireEvent.click(screen.getByRole("button", { name: /collect/i }));

    await waitFor(() => expect(executeCollectUrStoaMock).toHaveBeenCalledTimes(1));
    expect(executeCollectUrStoaMock).toHaveBeenCalledWith(
      expect.objectContaining({ accountExists: false })
    );
  });

  it("shows a locked-codex message when useGetKeypair throws CodexLockedError, and does not close", async () => {
    checkCoinAccountExistsMock.mockResolvedValue(true);
    getKeypairMock.mockRejectedValue(new CodexLockedError("collect urstoa"));
    let closedCount = 0;
    render(
      <CollectUrStoaModal isOpen onClose={() => { closedCount++; }} publicKey={PUBLIC_KEY} address={ADDRESS} />
    );
    fireEvent.click(screen.getByRole("button", { name: /collect/i }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/locked/i));
    expect(executeCollectUrStoaMock).not.toHaveBeenCalled();
    expect(closedCount).toBe(0);
    // The toast must resolve to an error state too — never left hanging.
    expect(txFailMock).toHaveBeenCalledWith(expect.stringMatching(/locked/i));
  });

  it("surfaces the real on-chain failure message verbatim", async () => {
    checkCoinAccountExistsMock.mockResolvedValue(true);
    getKeypairMock.mockResolvedValue(FAKE_KEYPAIR);
    executeCollectUrStoaMock.mockRejectedValue(new Error("Simulation failed: no earnings to collect"));
    render(<CollectUrStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    fireEvent.click(screen.getByRole("button", { name: /collect/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/no earnings to collect/i)
    );
    // The tx toast must ALSO surface the real failure — never silently swallowed.
    expect(txFailMock).toHaveBeenCalledWith(expect.stringMatching(/no earnings to collect/i));
  });
});
