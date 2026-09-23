/**
 * CodexDebouncerPanel — two owner-reported fixes (screenshot: the "SLOW
 * (T5)" hover tooltip rendering cut off, half-hidden behind the header
 * card; and "in the OuronetUI implementation this also has an i infomatic
 * that brings up an infomatic page... maybe instead of an i, maybe a short
 * medallion... with the text What is This?"):
 *
 *   1. The per-medallion hover tooltip now portals to `document.body` with
 *      fixed positioning (computed from the trigger's own
 *      `getBoundingClientRect()`) instead of rendering `position: absolute`
 *      locally — it was getting clipped by whatever `overflow: hidden`
 *      ancestor the panel happens to be mounted inside (e.g. the mock
 *      host's own bounded stage).
 *   2. The tiny 16px "?" info trigger is now a labeled "What is This?" pill
 *      — same `onInfo` contract, just a harder-to-miss affordance.
 */
import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { CodexDebouncerPanel } from "@ancientpantheon/codex-ouronet/ui";

afterEach(() => cleanup());

function renderPanel(props: React.ComponentProps<typeof CodexDebouncerPanel> = {}) {
  const adapter = new MemoryCodexAdapter("dev");
  return render(
    <CodexProvider adapter={adapter}>
      <CodexDebouncerPanel {...props} />
    </CodexProvider>,
  );
}

describe("CodexDebouncerPanel — 'What is this?' trigger", () => {
  it("renders nothing when onInfo is omitted (every pre-existing caller, e.g. DebouncerSettingsCard's live panel)", () => {
    renderPanel();
    expect(screen.queryByTestId("debouncer-info-trigger")).toBeNull();
  });

  it("renders a labeled 'What is This?' pill (not a bare icon) when onInfo is supplied, and calls it on click", () => {
    const onInfo = vi.fn();
    renderPanel({ onInfo });
    const trigger = screen.getByTestId("debouncer-info-trigger");
    expect(trigger.textContent).toBe("What is This?");
    fireEvent.click(trigger);
    expect(onInfo).toHaveBeenCalledTimes(1);
  });
});

describe("CodexDebouncerPanel — hover tooltip escapes overflow-clipped ancestors", () => {
  it("portals the tooltip to document.body (not a descendant of an overflow:hidden wrapper) once a medallion is hovered", () => {
    render(
      <div style={{ overflow: "hidden", width: 320, height: 80 }} data-testid="clip-ancestor">
        <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
          <CodexDebouncerPanel />
        </CodexProvider>
      </div>,
    );
    const clipAncestor = screen.getByTestId("clip-ancestor");
    const t1Cell = screen.getByTestId("debouncer-tier-T1");
    fireEvent.mouseEnter(t1Cell);
    // The tooltip text ("INSTANT (T1)" for the T1 cell) must now be in the
    // document, but NOT inside the overflow:hidden ancestor.
    const tooltipText = screen.getByText(/\(T1\)/);
    expect(tooltipText).toBeTruthy();
    expect(clipAncestor.contains(tooltipText)).toBe(false);
    expect(document.body.contains(tooltipText)).toBe(true);
  });

  it("hides the tooltip again on mouse leave", () => {
    renderPanel();
    const t1Cell = screen.getByTestId("debouncer-tier-T1");
    fireEvent.mouseEnter(t1Cell);
    expect(screen.getByText(/\(T1\)/)).toBeTruthy();
    fireEvent.mouseLeave(t1Cell);
    expect(screen.queryByText(/\(T1\)/)).toBeNull();
  });
});
