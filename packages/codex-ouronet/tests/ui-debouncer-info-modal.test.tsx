/**
 * DebouncerInfoModal — the "What is this?" full-screen explainer opened by
 * `CodexDebouncerPanel`'s `onInfo` trigger (owner correction: "in the
 * OuronetUI implementation this also has an i infomatic, that brings up an
 * infomatic page. we need the same here, and that infomatic page must be a
 * full screen page with a x, from which you opt out via the x").
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { DebouncerInfoModal } from "@ancientpantheon/codex-ouronet/ui";

afterEach(() => cleanup());

// DebouncerSettingsCard mounts a LIVE CodexDebouncerPanel (see its own doc
// comment), whose Codex-lock cell needs a real store — same requirement
// every other test that renders it works around.
function renderModal(onClose: () => void = () => {}) {
  return render(
    <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
      <DebouncerInfoModal onClose={onClose} />
    </CodexProvider>,
  );
}

describe("DebouncerInfoModal", () => {
  it("renders full-screen, portaled to document.body, with the Debouncer explainer content", () => {
    renderModal();
    const dialog = screen.getByTestId("debouncer-info-modal");
    expect(document.body.contains(dialog)).toBe(true);
    expect(dialog.style.position).toBe("fixed");
    expect(dialog.style.inset).toBe("0px");
    // Reuses DebouncerSettingsCard verbatim — its "The seven tiers" section
    // heading (and at least one tier row) should be present.
    expect(screen.getByText("The seven tiers")).toBeTruthy();
    expect(screen.getByText("SLOW")).toBeTruthy();
  });

  it("calls onClose when the X button is clicked", () => {
    const onClose = vi.fn();
    renderModal(onClose);
    fireEvent.click(screen.getByTestId("debouncer-info-modal-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
