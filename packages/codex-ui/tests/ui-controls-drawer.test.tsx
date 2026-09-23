/**
 * ControlsDrawer — the full-screen list of every registered ControlItem.
 * Renders `position: absolute; inset: 0` so it fills the nearest positioned
 * ancestor (never `position: fixed` against the viewport — docs/work/
 * codex-ui-mobile/design.md §1); closed by default; a disabled/"notimpl" item
 * never fires its onClick.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ControlsProvider, useControls, useRegisterControls } from "../src/ui/mobile/controls-context";
import { ControlsDrawer } from "../src/ui/mobile/ControlsDrawer";

afterEach(() => cleanup());

function Registrar({ onSend, onDisabled }: { onSend: () => void; onDisabled: () => void }) {
  useRegisterControls("send-source", "Send Actions", true, [
    { id: "send", label: "Send", onClick: onSend },
    { id: "disabled-send", label: "Locked", onClick: onDisabled, disabled: true, kind: "notimpl" },
  ]);
  return null;
}

function Opener() {
  const { setOpen } = useControls();
  return (
    <button type="button" onClick={() => setOpen(true)}>
      Open Controls
    </button>
  );
}

describe("ControlsDrawer", () => {
  it("renders nothing when closed", () => {
    render(
      <ControlsProvider>
        <ControlsDrawer />
      </ControlsProvider>,
    );
    expect(screen.queryByRole("dialog", { name: "Controls" })).toBeNull();
  });

  it("when open, absolutely positions itself (fills the nearest positioned ancestor, never fixed against the viewport)", () => {
    render(
      <ControlsProvider>
        <Opener />
        <ControlsDrawer />
      </ControlsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Controls" }));
    const dialog = screen.getByRole("dialog", { name: "Controls" });
    expect(dialog.style.position).toBe("absolute");
    expect(dialog.style.inset).toBe("0px");
  });

  it("lists every registered item, grouped by source title, with the live count in the header", () => {
    const onSend = vi.fn();
    const onDisabled = vi.fn();
    render(
      <ControlsProvider>
        <Registrar onSend={onSend} onDisabled={onDisabled} />
        <Opener />
        <ControlsDrawer />
      </ControlsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Controls" }));
    expect(screen.getByText("Send Actions")).toBeInTheDocument();
    expect(screen.getByText(/\[2\]/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Locked" })).toBeInTheDocument();
  });

  it("tapping a live item fires its onClick and closes the drawer", () => {
    const onSend = vi.fn();
    const onDisabled = vi.fn();
    render(
      <ControlsProvider>
        <Registrar onSend={onSend} onDisabled={onDisabled} />
        <Opener />
        <ControlsDrawer />
      </ControlsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Controls" }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "Controls" })).toBeNull();
  });

  it("tapping a disabled/notimpl item never fires its onClick", () => {
    const onSend = vi.fn();
    const onDisabled = vi.fn();
    render(
      <ControlsProvider>
        <Registrar onSend={onSend} onDisabled={onDisabled} />
        <Opener />
        <ControlsDrawer />
      </ControlsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Controls" }));
    fireEvent.click(screen.getByRole("button", { name: "Locked" }));
    expect(onDisabled).not.toHaveBeenCalled();
    // Drawer stays open — a disabled tap doesn't close it.
    expect(screen.getByRole("dialog", { name: "Controls" })).toBeInTheDocument();
  });

  it("empty registry shows the empty-state message instead of a bare list", () => {
    render(
      <ControlsProvider>
        <Opener />
        <ControlsDrawer />
      </ControlsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Controls" }));
    expect(screen.getByText(/no actions available/i)).toBeInTheDocument();
  });
});
