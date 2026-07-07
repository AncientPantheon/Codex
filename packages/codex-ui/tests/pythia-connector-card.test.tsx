// @vitest-environment jsdom
/**
 * PythiaConnectorCard — the GLOBAL connector row for the Network settings tab.
 * Pins: the three status states (not connected / set-no-coverage / live-covered),
 * the edit seam, and the locked read-only override.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { PythiaConnectorCard } from "../src/ui/settings/PythiaConnectorCard";

afterEach(cleanup);

describe("PythiaConnectorCard", () => {
  it("shows 'Not connected' with no URL and no coverage", () => {
    render(<PythiaConnectorCard url="" onSetUrl={() => {}} coveredChains={[]} />);
    expect(screen.getByTestId("pythia-status").textContent).toMatch(/not connected/i);
    expect((screen.getByTestId("pythia-url") as HTMLInputElement).value).toBe("");
  });

  it("shows 'Set — no coverage advertised' when a URL is set but nothing is covered", () => {
    render(
      <PythiaConnectorCard url="https://pythia.example" onSetUrl={() => {}} coveredChains={[]} />,
    );
    expect(screen.getByTestId("pythia-status").textContent).toMatch(/no coverage/i);
  });

  it("shows the covered chains when Pythia advertises coverage", () => {
    render(
      <PythiaConnectorCard
        url="https://pythia.example"
        onSetUrl={() => {}}
        coveredChains={["stoachain"]}
      />,
    );
    expect(screen.getByTestId("pythia-status").textContent).toMatch(/covers stoachain/i);
  });

  it("calls onSetUrl when the (unlocked) field is edited", () => {
    const onSetUrl = vi.fn();
    render(<PythiaConnectorCard url="" onSetUrl={onSetUrl} coveredChains={[]} />);
    fireEvent.change(screen.getByTestId("pythia-url"), {
      target: { value: "https://pythia.new" },
    });
    expect(onSetUrl).toHaveBeenCalledWith("https://pythia.new");
  });

  it("is read-only when locked", () => {
    const onSetUrl = vi.fn();
    render(
      <PythiaConnectorCard url="https://x" onSetUrl={onSetUrl} coveredChains={[]} locked />,
    );
    const input = screen.getByTestId("pythia-url") as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    fireEvent.change(input, { target: { value: "https://y" } });
    expect(onSetUrl).not.toHaveBeenCalled();
  });
});
