/**
 * <UnstakeUrStoaModal> — vault action modal for `coin.C_URV|Unstake`.
 *
 * Same patronless / confirm-time-keypair contract as StakeUrStoaModal (see
 * that test file's header comment for the full rationale) — only the
 * on-chain function differs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const getKeypairMock = vi.fn();
vi.mock("@ancientpantheon/codex-ouronet/hooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useGetKeypair: () => getKeypairMock };
});

const executeUnstakeUrStoaMock = vi.fn();
vi.mock("@ouronet/ouronet-core/interactions/urStoaFunctions", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, executeUnstakeUrStoa: (...args: unknown[]) => executeUnstakeUrStoaMock(...args) };
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
import { UnstakeUrStoaModal } from "../src/ui/internal/UnstakeUrStoaModal";

const PUBLIC_KEY = "c".repeat(64);
const ADDRESS = `k:${PUBLIC_KEY}`;
const FAKE_KEYPAIR = { publicKey: PUBLIC_KEY, privateKey: "d".repeat(64) };

describe("<UnstakeUrStoaModal>", () => {
  beforeEach(() => {
    getKeypairMock.mockReset();
    executeUnstakeUrStoaMock.mockReset();
    txPendingMock.mockClear();
    txSubmittedMock.mockClear();
    txFailMock.mockClear();
  });

  it("renders nothing when isOpen=false", () => {
    const { container } = render(
      <UnstakeUrStoaModal isOpen={false} onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />
    );
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("renders the amount input with a disabled submit until a valid amount is entered", () => {
    render(<UnstakeUrStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    expect(screen.getByRole("heading", { name: /unstake urstoa/i })).toBeTruthy();
    const submit = screen.getByRole("button", { name: /unstake urstoa/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "-5" } });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "2.25" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("resolves the keypair at confirm-time and calls executeUnstakeUrStoa with it as gasStationKey", async () => {
    getKeypairMock.mockResolvedValue(FAKE_KEYPAIR);
    executeUnstakeUrStoaMock.mockResolvedValue({ requestKey: "req-key-unstake" });
    const onSuccess = vi.fn();
    let closedCount = 0;
    render(
      <UnstakeUrStoaModal
        isOpen
        onClose={() => { closedCount++; }}
        onSuccess={onSuccess}
        publicKey={PUBLIC_KEY}
        address={ADDRESS}
      />
    );
    expect(getKeypairMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: /unstake urstoa/i }));

    await waitFor(() => expect(executeUnstakeUrStoaMock).toHaveBeenCalledTimes(1));
    expect(getKeypairMock).toHaveBeenCalledWith(PUBLIC_KEY);
    expect(executeUnstakeUrStoaMock).toHaveBeenCalledWith(
      expect.objectContaining({ paymentKeyAddress: ADDRESS, amount: "7.0", gasStationKey: FAKE_KEYPAIR })
    );
    expect(onSuccess).toHaveBeenCalledWith("req-key-unstake");
    expect(closedCount).toBe(1);
    // Regression: the modal submitted a real on-chain tx but showed NO toast
    // ("transaction submitted, waiting for confirmation") — this is that toast.
    expect(txPendingMock).toHaveBeenCalledWith("Unstake UrStoa");
    expect(txSubmittedMock).toHaveBeenCalledWith("req-key-unstake");
    expect(txFailMock).not.toHaveBeenCalled();
  });

  it("shows a locked-codex message when useGetKeypair throws CodexLockedError, and does not close", async () => {
    getKeypairMock.mockRejectedValue(new CodexLockedError("unstake urstoa"));
    let closedCount = 0;
    render(
      <UnstakeUrStoaModal isOpen onClose={() => { closedCount++; }} publicKey={PUBLIC_KEY} address={ADDRESS} />
    );
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /unstake urstoa/i }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/locked/i));
    expect(executeUnstakeUrStoaMock).not.toHaveBeenCalled();
    expect(closedCount).toBe(0);
    // The toast must resolve to an error state too — never left hanging.
    expect(txFailMock).toHaveBeenCalledWith(expect.stringMatching(/locked/i));
  });

  it("surfaces the real on-chain failure message verbatim", async () => {
    getKeypairMock.mockResolvedValue(FAKE_KEYPAIR);
    executeUnstakeUrStoaMock.mockRejectedValue(new Error("Simulation failed: must leave 1.0 UrStoa staked"));
    render(<UnstakeUrStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /unstake urstoa/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/must leave 1\.0 UrStoa staked/i)
    );
    // The tx toast must ALSO surface the real failure — never silently swallowed.
    expect(txFailMock).toHaveBeenCalledWith(expect.stringMatching(/must leave 1\.0 UrStoa staked/i));
  });
});
