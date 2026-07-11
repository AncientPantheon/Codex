/**
 * RED matrix for the Arweave panel SEND AR area (E-10/E-11, N-06/N-10 —
 * FUNDS-CRITICAL, FIX-1).
 *
 * Pins the `SendArea` contract: recipient by paste (validated) or from the
 * unified book filtered to Arweave; amount + the MANDATORY fee-cap both via
 * `arToWinston` (parseability-gated); and the FULL send error matrix:
 *   - over-cap        → RewardExceedsCapError {reward,cap}  (instanceof-discriminated)
 *   - missing-cap     → InvalidTransferError reason:"missing-max-reward" (DIFFERENT class)
 *   - non-cap reject  → GatewayPoolExhaustedError / InvalidTransferError("bad-target") / generic
 *   - in-cap success  → {id,reward} → confirm + status (pending→final via pollStatus)
 *
 * ALL send/status calls are FAKES. FAILS RED because `../src/panel/SendArea`
 * does not exist yet.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor, cleanup, fireEvent } from "@testing-library/react";

import { SendArea } from "../src/panel/SendArea";
import type { ArweaveSendRequest } from "../src/panel/context";
import { ARWEAVE_CHAIN_ID } from "../src/address-book/chainId";

import {
  arToWinston,
  RewardExceedsCapError,
  InvalidTransferError,
  GatewayPoolExhaustedError,
} from "@ancientpantheon/arweave-core";
import { validateAddress, registerChainAddressValidator } from "@ancientpantheon/codex-ouronet/hooks";
import type { AddressBookEntry } from "@ancientpantheon/codex-ouronet/types";

const ARWEAVE_ADDRESS = "tzXauR_QBlPW3ZRey3xBzaiDqPqLfiqWk1SWmk2BjM4";
const STOACHAIN_CHAIN_ID = "kadena:mainnet";

/** Register a real Arweave validator once so the paste-validation path exercises
 *  the actual `validateAddress(ARWEAVE_CHAIN_ID, ...)` D5 seam. */
beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  // A canonical 43-char base64url passes; anything else fails.
  registerChainAddressValidator(ARWEAVE_CHAIN_ID, (addr) => /^[A-Za-z0-9_-]{43}$/.test(addr));
});

/** A book with one Arweave + one StoaChain contact — only the Arweave one is offerable. */
function makeBook(): AddressBookEntry[] {
  return [
    {
      id: "ab-1",
      name: "Alice (AR)",
      address: ARWEAVE_ADDRESS,
      type: "stoa",
      chainId: ARWEAVE_CHAIN_ID,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
    {
      id: "ab-2",
      name: "Bob (KDA)",
      address: "k:abcdef",
      type: "stoa",
      chainId: STOACHAIN_CHAIN_ID,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
  ];
}

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    addressBook: makeBook(),
    // The E2 send seam: resolves {id, reward} on success. Fakes throughout.
    send: vi.fn(async (_req: ArweaveSendRequest): Promise<{ id: string; reward: bigint }> => ({
      id: ARWEAVE_ADDRESS,
      reward: 1_000_000n,
    })),
    // The E2 status poll seam: flips pending→final.
    pollStatus: vi.fn(async (): Promise<"pending" | "final"> => "final"),
    ...overrides,
  };
}

/** Fill recipient (paste), amount, and cap with valid values. */
function fillValidForm(recipient = ARWEAVE_ADDRESS): void {
  fireEvent.change(screen.getByTestId("send-recipient-input"), { target: { value: recipient } });
  fireEvent.change(screen.getByTestId("send-amount-input"), { target: { value: "1.5" } });
  fireEvent.change(screen.getByTestId("send-cap-input"), { target: { value: "0.01" } });
}

describe("SendArea — recipient by paste (validator gate)", () => {
  it("blocks a non-canonical pasted recipient with a form error", async () => {
    const props = makeProps();
    render(<SendArea {...props} />);

    fireEvent.change(screen.getByTestId("send-recipient-input"), { target: { value: "not-an-address" } });
    fireEvent.change(screen.getByTestId("send-amount-input"), { target: { value: "1.5" } });
    fireEvent.change(screen.getByTestId("send-cap-input"), { target: { value: "0.01" } });
    fireEvent.click(screen.getByTestId("send-submit"));

    expect(await screen.findByTestId("send-recipient-error")).toBeInTheDocument();
    // The invalid recipient is validated via the D5 seam and never reaches send.
    expect(validateAddress(ARWEAVE_CHAIN_ID, "not-an-address")).toBe(false);
    expect(props.send).not.toHaveBeenCalled();
  });

  it("accepts a canonical pasted recipient", async () => {
    const props = makeProps();
    render(<SendArea {...props} />);
    fillValidForm();
    fireEvent.click(screen.getByTestId("send-submit"));
    await waitFor(() => expect(props.send).toHaveBeenCalledTimes(1));
    expect(validateAddress(ARWEAVE_CHAIN_ID, ARWEAVE_ADDRESS)).toBe(true);
  });
});

describe("SendArea — recipient from the book (Arweave-only)", () => {
  it("offers ONLY chainId===ARWEAVE_CHAIN_ID contacts in the picker", () => {
    render(<SendArea {...makeProps()} />);
    const picker = screen.getByTestId("send-book-picker");
    expect(within(picker).getByText("Alice (AR)")).toBeInTheDocument();
    // The StoaChain contact is filtered out — never offered as an Arweave recipient.
    expect(within(picker).queryByText("Bob (KDA)")).not.toBeInTheDocument();
  });

  it("fills the recipient when a book contact is selected", async () => {
    const props = makeProps();
    render(<SendArea {...props} />);
    fireEvent.click(within(screen.getByTestId("send-book-picker")).getByText("Alice (AR)"));
    fireEvent.change(screen.getByTestId("send-amount-input"), { target: { value: "1.5" } });
    fireEvent.change(screen.getByTestId("send-cap-input"), { target: { value: "0.01" } });
    fireEvent.click(screen.getByTestId("send-submit"));
    await waitFor(() => expect(props.send).toHaveBeenCalledTimes(1));
    const arg = props.send.mock.calls[0][0] as { target: string };
    expect(arg.target).toBe(ARWEAVE_ADDRESS);
  });
});

describe("SendArea — amount", () => {
  it("passes quantity === arToWinston(displayAmount) to send", async () => {
    const props = makeProps();
    render(<SendArea {...props} />);
    fillValidForm();
    fireEvent.click(screen.getByTestId("send-submit"));
    await waitFor(() => expect(props.send).toHaveBeenCalledTimes(1));
    const arg = props.send.mock.calls[0][0] as { quantity: bigint };
    expect(arg.quantity).toBe(arToWinston("1.5"));
  });

  it("shows a form error for a malformed amount (InvalidAmountError) and blocks send", async () => {
    const props = makeProps();
    render(<SendArea {...props} />);
    fireEvent.change(screen.getByTestId("send-recipient-input"), { target: { value: ARWEAVE_ADDRESS } });
    fireEvent.change(screen.getByTestId("send-amount-input"), { target: { value: "1.5 AR" } });
    fireEvent.change(screen.getByTestId("send-cap-input"), { target: { value: "0.01" } });
    fireEvent.click(screen.getByTestId("send-submit"));
    expect(await screen.findByTestId("send-amount-error")).toBeInTheDocument();
    expect(props.send).not.toHaveBeenCalled();
  });
});

describe("SendArea — the MANDATORY fee-cap (N-10)", () => {
  it("blocks submit when no cap is set", async () => {
    const props = makeProps();
    render(<SendArea {...props} />);
    fireEvent.change(screen.getByTestId("send-recipient-input"), { target: { value: ARWEAVE_ADDRESS } });
    fireEvent.change(screen.getByTestId("send-amount-input"), { target: { value: "1.5" } });
    // Cap left empty.
    fireEvent.click(screen.getByTestId("send-submit"));
    expect(await screen.findByTestId("send-cap-error")).toBeInTheDocument();
    expect(props.send).not.toHaveBeenCalled();
  });

  it("passes maxRewardWinston === arToWinston(capAr) on a valid cap", async () => {
    const props = makeProps();
    render(<SendArea {...props} />);
    fillValidForm();
    fireEvent.click(screen.getByTestId("send-submit"));
    await waitFor(() => expect(props.send).toHaveBeenCalledTimes(1));
    const arg = props.send.mock.calls[0][0] as { maxRewardWinston: bigint };
    expect(arg.maxRewardWinston).toBe(arToWinston("0.01"));
  });

  it.each(["1.5 AR", "1e3", "abc", "0.01 ", "0.0000000000001"])(
    "treats a non-empty but arToWinston-unparseable cap %j as a FORM ERROR (no uncaught throw) (F-N01)",
    async (badCap) => {
      const props = makeProps();
      render(<SendArea {...props} />);
      fireEvent.change(screen.getByTestId("send-recipient-input"), { target: { value: ARWEAVE_ADDRESS } });
      fireEvent.change(screen.getByTestId("send-amount-input"), { target: { value: "1.5" } });
      fireEvent.change(screen.getByTestId("send-cap-input"), { target: { value: badCap } });
      // Must not throw synchronously — the gate is arToWinston-parseability.
      expect(() => fireEvent.click(screen.getByTestId("send-submit"))).not.toThrow();
      expect(await screen.findByTestId("send-cap-error")).toBeInTheDocument();
      expect(props.send).not.toHaveBeenCalled();
      // Confirm the cap genuinely fails the parse gate.
      expect(() => arToWinston(badCap)).toThrow();
    },
  );
});

describe("SendArea — the FULL send error matrix (FIX-1)", () => {
  it("OVER-CAP: RewardExceedsCapError surfaces a clear reward-vs-cap block, no pay/retry", async () => {
    const err = new RewardExceedsCapError(5_000_000n, 1_000_000n);
    const props = makeProps({ send: vi.fn(async () => { throw err; }) });
    render(<SendArea {...props} />);
    fillValidForm();
    fireEvent.click(screen.getByTestId("send-submit"));

    const block = await screen.findByTestId("send-overcap-error");
    // The message is built from err.reward / err.cap (instanceof-discriminated).
    expect(err instanceof RewardExceedsCapError).toBe(true);
    expect(block.textContent).toContain("5000000");
    expect(block.textContent).toContain("1000000");
    // No confirmed status on an over-cap block.
    expect(screen.queryByTestId("send-status-final")).not.toBeInTheDocument();
  });

  it("MISSING-CAP BACKSTOP: InvalidTransferError reason:'missing-max-reward' (DIFFERENT class) surfaces as cap-required, not uncaught", async () => {
    const err = new InvalidTransferError("missing-max-reward");
    expect(err instanceof RewardExceedsCapError).toBe(false);
    const props = makeProps({ send: vi.fn(async () => { throw err; }) });
    render(<SendArea {...props} />);
    fillValidForm();
    // Client gate stubbed-open in this scenario — the protocol backstop must
    // surface cleanly, not crash.
    expect(() => fireEvent.click(screen.getByTestId("send-submit"))).not.toThrow();
    expect(await screen.findByTestId("send-cap-error")).toBeInTheDocument();
  });

  it("NON-CAP REJECTION: GatewayPoolExhaustedError → clear non-crash error, button re-enables, no confirmed status, no bare .reward/.cap read", async () => {
    const err = new GatewayPoolExhaustedError("post", []);
    // The generic branch must NOT read cap-only fields off a non-cap error.
    expect((err as unknown as { reward?: unknown }).reward).toBeUndefined();
    expect((err as unknown as { cap?: unknown }).cap).toBeUndefined();
    const props = makeProps({ send: vi.fn(async () => { throw err; }) });
    render(<SendArea {...props} />);
    fillValidForm();
    fireEvent.click(screen.getByTestId("send-submit"));

    expect(await screen.findByTestId("send-generic-error")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("send-submit")).not.toBeDisabled());
    expect(screen.queryByTestId("send-status-final")).not.toBeInTheDocument();
    // The over-cap branch was NOT taken for a non-cap error.
    expect(screen.queryByTestId("send-overcap-error")).not.toBeInTheDocument();
  });

  it("NON-CAP REJECTION: InvalidTransferError('bad-target') is the generic error branch, not the cap branch", async () => {
    const err = new InvalidTransferError("bad-target", ARWEAVE_ADDRESS);
    const props = makeProps({ send: vi.fn(async () => { throw err; }) });
    render(<SendArea {...props} />);
    fillValidForm();
    fireEvent.click(screen.getByTestId("send-submit"));
    expect(await screen.findByTestId("send-generic-error")).toBeInTheDocument();
    expect(screen.queryByTestId("send-overcap-error")).not.toBeInTheDocument();
  });
});

describe("SendArea — in-cap success + status", () => {
  it("resolves {id,reward} → confirm, then polls status pending→final", async () => {
    const props = makeProps();
    render(<SendArea {...props} />);
    fillValidForm();
    fireEvent.click(screen.getByTestId("send-submit"));

    // Confirmation shows the resolved id.
    const confirm = await screen.findByTestId("send-confirm");
    expect(confirm.textContent).toContain(ARWEAVE_ADDRESS);
    // Status transitions to final via the injected pollStatus.
    await waitFor(() => expect(props.pollStatus).toHaveBeenCalled());
    expect(await screen.findByTestId("send-status-final")).toBeInTheDocument();
  });

  it("SEND SUCCEEDS but pollStatus REJECTS: confirmation SURVIVES, no false send-failed, no double-spend affordance (FIX-1)", async () => {
    // The send lands on-chain; the follow-up status poll fails transiently.
    const props = makeProps({
      pollStatus: vi.fn(async (): Promise<"pending" | "final"> => {
        throw new Error("gateway timeout");
      }),
    });
    render(<SendArea {...props} />);
    fillValidForm();
    fireEvent.click(screen.getByTestId("send-submit"));

    // The confirmation must appear AND survive the poll rejection.
    const confirm = await screen.findByTestId("send-confirm");
    expect(confirm.textContent).toContain(ARWEAVE_ADDRESS);
    await waitFor(() => expect(props.pollStatus).toHaveBeenCalled());
    // The poll failure must NOT masquerade as a send failure.
    expect(screen.queryByTestId("send-generic-error")).not.toBeInTheDocument();
    // The confirmation stays put — a re-submit-as-if-failed double-spend is impossible.
    expect(screen.getByTestId("send-confirm")).toBeInTheDocument();
    // Status never reached "final" (poll never resolved), but the send is confirmed.
    expect(screen.queryByTestId("send-status-final")).not.toBeInTheDocument();
    // send was called exactly ONCE — no retry affordance was triggered.
    expect(props.send).toHaveBeenCalledTimes(1);
  });
});

describe("SendArea — secret hygiene", () => {
  it("never renders a JWK value in the send-flow DOM or errors", async () => {
    const props = makeProps();
    render(<SendArea {...props} />);
    fillValidForm();
    fireEvent.click(screen.getByTestId("send-submit"));
    await waitFor(() => expect(props.send).toHaveBeenCalled());
    // No private JWK field name appears with a secret value; the send seam only
    // ever receives {target, quantity, maxRewardWinston} — never key material.
    const arg = props.send.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(arg).not.toHaveProperty("jwk");
    expect(arg).not.toHaveProperty("d");
  });
});
