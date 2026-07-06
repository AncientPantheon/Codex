/**
 * RED matrix for the Arweave panel BALANCE area (E-10, N-10 — FIX-7).
 *
 * Pins the `BalanceArea` contract: the rendered NUMERIC token equals
 * `winstonToAr(w)` EXACTLY (the bare string, no `" AR"` suffix, no scientific
 * notation), and the `AR` unit label is a SEPARATE adjacent element — NOT folded
 * into the numeric equality. Balance is fetched via an injected fake `getBalance`
 * returning a winston bigint; no real network.
 *
 * FAILS RED because `../src/panel/BalanceArea` does not exist yet.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";

import { BalanceArea } from "../src/panel/BalanceArea";
import { winstonToAr } from "@ancientpantheon/arweave-core";

const THROWAWAY_ADDRESS = "tzXauR_QBlPW3ZRey3xBzaiDqPqLfiqWk1SWmk2BjM4";

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    address: THROWAWAY_ADDRESS,
    getBalance: vi.fn(async (_addr: string): Promise<bigint> => 1_500_000_000_000n),
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BalanceArea — display units (FIX-7)", () => {
  it("renders the numeric token === winstonToAr(w) exactly, with no suffix folded in", async () => {
    const props = makeProps();
    render(<BalanceArea {...props} />);

    const token = await screen.findByTestId("balance-amount");
    // winstonToAr(1_500_000_000_000n) === "1.5" — the bare string, no " AR", no sci-notation.
    expect(winstonToAr(1_500_000_000_000n)).toBe("1.5");
    expect(token.textContent).toBe(winstonToAr(1_500_000_000_000n));
    expect(token.textContent).not.toMatch(/AR/);
    expect(token.textContent).not.toMatch(/e\+?\d/i);
  });

  it("renders the AR unit label as a SEPARATE adjacent element (not part of the numeric token)", async () => {
    render(<BalanceArea {...makeProps()} />);
    const label = await screen.findByTestId("balance-unit");
    expect(label.textContent).toBe("AR");
    // The numeric token stays bare — the label is its own node.
    const token = screen.getByTestId("balance-amount");
    expect(token).not.toBe(label);
  });

  it("drives the display off the injected winston bigint (a different balance renders a different token)", async () => {
    const props = makeProps({
      getBalance: vi.fn(async (): Promise<bigint> => 2_250_000_000_000n),
    });
    render(<BalanceArea {...props} />);
    const token = await screen.findByTestId("balance-amount");
    expect(token.textContent).toBe(winstonToAr(2_250_000_000_000n)); // "2.25"
  });
});

describe("BalanceArea — copy + receive", () => {
  it("copies the 43-char address via a copy control", async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    render(<BalanceArea {...makeProps()} />);
    fireEvent.click(screen.getByTestId("balance-copy-address"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(THROWAWAY_ADDRESS));
  });

  it("surfaces the address via a receive affordance", () => {
    render(<BalanceArea {...makeProps()} />);
    const receive = screen.getByTestId("balance-receive");
    expect(receive.textContent).toContain(THROWAWAY_ADDRESS);
  });
});

describe("BalanceArea — load error", () => {
  it("shows a clear message and does not crash when getBalance rejects", async () => {
    const props = makeProps({
      getBalance: vi.fn(async () => {
        throw new Error("gateway pool exhausted");
      }),
    });
    render(<BalanceArea {...props} />);
    await waitFor(() => expect(screen.getByTestId("balance-error")).toBeInTheDocument());
    // No numeric token rendered on the error path.
    expect(screen.queryByTestId("balance-amount")).not.toBeInTheDocument();
  });
});
