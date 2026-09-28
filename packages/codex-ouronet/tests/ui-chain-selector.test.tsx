/**
 * <ChainSelector> — a numbered chain-picker button grid, shared between
 * StoaChain's (10 chains) and Kadena's (20 chains) crosschain-transfer UI.
 * Mirrors OuronetUI's own inline `ChainSelector` component in
 * `CrossChainTransfer.tsx` (a 0-9 button grid, the source/target selectors
 * mutually excluding each other's current value).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { ChainSelector } from "../src/ui/internal/ChainSelector.js";

describe("<ChainSelector>", () => {
  it("renders 10 chain buttons by default, labelled 0..9", () => {
    render(<ChainSelector label="Source Chain" value="0" onChange={() => {}} />);
    for (let i = 0; i < 10; i++) {
      expect(screen.getByRole("button", { name: String(i) })).toBeTruthy();
    }
    expect(screen.queryByRole("button", { name: "10" })).toBeNull();
  });

  it("renders 20 chain buttons (0..19) when chainCount=20 — Kadena's own modal will use this", () => {
    render(<ChainSelector label="Source Chain" value="0" onChange={() => {}} chainCount={20} />);
    for (let i = 0; i < 20; i++) {
      expect(screen.getByRole("button", { name: String(i) })).toBeTruthy();
    }
    expect(screen.queryByRole("button", { name: "20" })).toBeNull();
  });

  it("marks the current value's button aria-pressed=true, every other false", () => {
    render(<ChainSelector label="Source Chain" value="3" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "3" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "4" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("clicking an enabled chain calls onChange with that chain id", () => {
    const onChange = vi.fn();
    render(<ChainSelector label="Source Chain" value="0" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "4" }));
    expect(onChange).toHaveBeenCalledWith("4");
  });

  it("disables the disabledChain button and clicking it does NOT call onChange", () => {
    const onChange = vi.fn();
    render(<ChainSelector label="Target Chain" value="1" onChange={onChange} disabledChain="0" />);
    const disabledBtn = screen.getByRole("button", { name: "0" }) as HTMLButtonElement;
    expect(disabledBtn.disabled).toBe(true);
    fireEvent.click(disabledBtn);
    expect(onChange).not.toHaveBeenCalled();
  });
});
