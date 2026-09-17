/**
 * <StakeUrStoaModal> — vault action modal for `coin.C_URV|Stake`.
 *
 * Per docs/work/stoa-urstoa-vault-actions/design.md's resolved decision #1:
 * the patronless flow means the SAME decrypted payment keypair is passed as
 * both `paymentKeyAddress`'s owning identity (the address string) and the
 * `gasStationKey` param — there is no second key-resolution path. Per
 * decision #2, the keypair is resolved via `useGetKeypair()` ONLY at
 * confirm-time (never eagerly on mount).
 *
 * These specs mock `useGetKeypair` and `executeStakeUrStoa` — no real
 * network call, no real key material, ever.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const getKeypairMock = vi.fn();
vi.mock("@ancientpantheon/codex-ouronet/hooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useGetKeypair: () => getKeypairMock };
});

// Pops the REAL password prompt when the codex is locked, per the reported
// bug: a locked-codex send/stake/etc must prompt-and-resume, never just
// dead-end on a text error. Defaults to "already unlocked" for every
// pre-existing test; the two new tests below override this per-case.
const ensureCodexUnlockedMock = vi.fn(async () => true);
vi.mock("../src/zbom/hooks/useEnsureCodexUnlocked", () => ({
  useEnsureCodexUnlocked: () => ensureCodexUnlockedMock,
}));

const executeStakeUrStoaMock = vi.fn();
vi.mock("@ouronet/ouronet-core/interactions/urStoaFunctions", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, executeStakeUrStoa: (...args: unknown[]) => executeStakeUrStoaMock(...args) };
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
import { StakeUrStoaModal } from "../src/ui/internal/StakeUrStoaModal";

const PUBLIC_KEY = "a".repeat(64);
const ADDRESS = `k:${PUBLIC_KEY}`;
const FAKE_KEYPAIR = { publicKey: PUBLIC_KEY, privateKey: "b".repeat(64) };

describe("<StakeUrStoaModal>", () => {
  beforeEach(() => {
    getKeypairMock.mockReset();
    executeStakeUrStoaMock.mockReset();
    txPendingMock.mockClear();
    txSubmittedMock.mockClear();
    txFailMock.mockClear();
    ensureCodexUnlockedMock.mockClear();
    ensureCodexUnlockedMock.mockResolvedValue(true);
  });

  it("renders nothing when isOpen=false", () => {
    const { container } = render(
      <StakeUrStoaModal isOpen={false} onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />
    );
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("renders the amount input and a disabled submit button when isOpen=true with no amount", () => {
    render(<StakeUrStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /stake urstoa/i })).toBeTruthy();
    const submit = screen.getByRole("button", { name: /stake urstoa/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it("rejects a non-numeric amount and keeps submit disabled", () => {
    render(<StakeUrStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    const input = screen.getByLabelText(/amount/i);
    fireEvent.change(input, { target: { value: "abc" } });
    expect(screen.getByRole("alert").textContent).toMatch(/valid positive amount/i);
    const submit = screen.getByRole("button", { name: /stake urstoa/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it("rejects a zero/negative amount", () => {
    render(<StakeUrStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    const input = screen.getByLabelText(/amount/i);
    fireEvent.change(input, { target: { value: "0" } });
    expect(screen.getByRole("alert").textContent).toMatch(/greater than 0/i);
  });

  it("enables submit for a valid positive amount", () => {
    render(<StakeUrStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    const input = screen.getByLabelText(/amount/i);
    fireEvent.change(input, { target: { value: "12.5" } });
    expect(screen.queryByRole("alert")).toBeNull();
    const submit = screen.getByRole("button", { name: /stake urstoa/i });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("on submit: resolves the keypair at confirm-time, calls executeStakeUrStoa with the SAME keypair as gasStationKey, and reports success", async () => {
    getKeypairMock.mockResolvedValue(FAKE_KEYPAIR);
    executeStakeUrStoaMock.mockResolvedValue({ requestKey: "req-key-1" });
    let closedCount = 0;
    const onSuccess = vi.fn();
    render(
      <StakeUrStoaModal
        isOpen
        onClose={() => { closedCount++; }}
        onSuccess={onSuccess}
        publicKey={PUBLIC_KEY}
        address={ADDRESS}
      />
    );

    // Not resolved eagerly on mount.
    expect(getKeypairMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "3.5" } });
    fireEvent.click(screen.getByRole("button", { name: /stake urstoa/i }));

    await waitFor(() => expect(executeStakeUrStoaMock).toHaveBeenCalledTimes(1));
    expect(getKeypairMock).toHaveBeenCalledWith(PUBLIC_KEY);
    expect(executeStakeUrStoaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentKeyAddress: ADDRESS,
        amount: "3.5",
        gasStationKey: FAKE_KEYPAIR,
      })
    );
    expect(onSuccess).toHaveBeenCalledWith("req-key-1");
    expect(closedCount).toBe(1);
    // Regression: the modal submitted a real on-chain tx but showed NO toast
    // ("transaction submitted, waiting for confirmation") — this is that toast.
    expect(txPendingMock).toHaveBeenCalledWith("Stake UrStoa");
    expect(txSubmittedMock).toHaveBeenCalledWith("req-key-1");
    expect(txFailMock).not.toHaveBeenCalled();
  });

  it("shows a locked-codex message (and does not close) when useGetKeypair throws CodexLockedError", async () => {
    getKeypairMock.mockRejectedValue(new CodexLockedError("stake urstoa"));
    let closedCount = 0;
    render(
      <StakeUrStoaModal isOpen onClose={() => { closedCount++; }} publicKey={PUBLIC_KEY} address={ADDRESS} />
    );
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /stake urstoa/i }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/locked/i));
    expect(executeStakeUrStoaMock).not.toHaveBeenCalled();
    expect(closedCount).toBe(0);
    // The toast must resolve to an error state too — never left hanging.
    expect(txFailMock).toHaveBeenCalledWith(expect.stringMatching(/locked/i));
  });

  it("surfaces the real on-chain failure message verbatim (never swallowed)", async () => {
    getKeypairMock.mockResolvedValue(FAKE_KEYPAIR);
    executeStakeUrStoaMock.mockRejectedValue(new Error("Simulation failed: insufficient UrStoa balance"));
    render(<StakeUrStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /stake urstoa/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/insufficient UrStoa balance/i)
    );
    // The tx toast must ALSO surface the real failure — never silently swallowed.
    expect(txFailMock).toHaveBeenCalledWith(expect.stringMatching(/insufficient UrStoa balance/i));
  });

  it("calls the codex-unlock gate BEFORE resolving the keypair on every submit — pops the REAL password prompt if locked, instead of erroring out", async () => {
    const callOrder: string[] = [];
    ensureCodexUnlockedMock.mockImplementation(async () => {
      callOrder.push("ensureUnlocked");
      return true;
    });
    getKeypairMock.mockImplementation(async () => {
      callOrder.push("getKeypair");
      return FAKE_KEYPAIR;
    });
    executeStakeUrStoaMock.mockResolvedValue({ requestKey: "req-key-gate" });
    render(<StakeUrStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);

    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /stake urstoa/i }));

    await waitFor(() => expect(executeStakeUrStoaMock).toHaveBeenCalledTimes(1));
    expect(callOrder).toEqual(["ensureUnlocked", "getKeypair"]);
  });

  it("when the user cancels the password prompt, stops quietly — no keypair resolution, no error toast, no alert", async () => {
    ensureCodexUnlockedMock.mockResolvedValueOnce(false);
    render(<StakeUrStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);

    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "2" } });
    const submit = screen.getByRole("button", { name: /stake urstoa/i });
    fireEvent.click(submit);

    await waitFor(() => expect(ensureCodexUnlockedMock).toHaveBeenCalledTimes(1));
    expect(getKeypairMock).not.toHaveBeenCalled();
    expect(executeStakeUrStoaMock).not.toHaveBeenCalled();
    expect(txFailMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("resets amount + error state each time the modal re-opens", () => {
    const { rerender } = render(
      <StakeUrStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />
    );
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "9" } });
    rerender(<StakeUrStoaModal isOpen={false} onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    rerender(<StakeUrStoaModal isOpen onClose={() => {}} publicKey={PUBLIC_KEY} address={ADDRESS} />);
    expect((screen.getByLabelText(/amount/i) as HTMLInputElement).value).toBe("");
  });
});
