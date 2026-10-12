/**
 * OuronetShellMock — the playground's "embedded inside OuronetUI" mobile
 * testing harness (see src/OuronetShellMock.tsx's own doc comment). Pins:
 * the 7-tab mockup bar renders with only "Codex" live/enabled, the other six
 * are disabled mockups; the Controls riser only shows once something is
 * registered; and tapping "Codex" opens the tier-2 menu (Codex UI / Settings
 * / Export / Import — design.md §8) instead of navigating straight through.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ControlsProvider, useRegisterControls } from "@ancientpantheon/codex-ui/ui";
import { OuronetShellMock, type OuronetShellMockProps } from "../src/OuronetShellMock";

afterEach(() => cleanup());

const MOCK_TAB_LABELS = ["Home", "STOA ICO", "Cross-Chain", "Execute Code", "Assets", "Auxiliary"];

function shellProps(overrides: Partial<OuronetShellMockProps> = {}): OuronetShellMockProps {
  return {
    activeView: "ui",
    onSelectView: vi.fn(),
    onExport: vi.fn(),
    onImport: vi.fn(),
    children: <div>codex content</div>,
    ...overrides,
  };
}

describe("OuronetShellMock — the 7-icon mockup bar", () => {
  it("renders all 7 tabs, including the real OuronetUI section names", () => {
    render(
      <ControlsProvider>
        <OuronetShellMock {...shellProps()} />
      </ControlsProvider>,
    );
    for (const label of [...MOCK_TAB_LABELS, "Codex"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("only the Codex tab is live — the other six are disabled mockups", () => {
    render(
      <ControlsProvider>
        <OuronetShellMock {...shellProps()} />
      </ControlsProvider>,
    );
    const codexTab = screen.getByRole("button", { name: "Codex" });
    expect(codexTab).not.toBeDisabled();

    for (const label of MOCK_TAB_LABELS) {
      const tab = screen.getByRole("button", { name: new RegExp(`^${label}`) });
      expect(tab).toBeDisabled();
    }
  });

  it("renders the wired children (the real embedded Codex content) inside the constrained stage", () => {
    render(
      <ControlsProvider>
        <OuronetShellMock {...shellProps({ children: <div>the real codex dashboard</div> })} />
      </ControlsProvider>,
    );
    expect(screen.getByText("the real codex dashboard")).toBeInTheDocument();
  });
});

describe("OuronetShellMock — the Codex-tap tier-2 menu (design.md §8)", () => {
  it("has no Codex UI / Settings / Export / Import visible until 'Codex' is tapped", () => {
    render(
      <ControlsProvider>
        <OuronetShellMock {...shellProps()} />
      </ControlsProvider>,
    );
    expect(screen.queryByRole("menuitem", { name: "Codex UI" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Export" })).toBeNull();
  });

  it("tapping Codex opens the menu with all five items", () => {
    render(
      <ControlsProvider>
        <OuronetShellMock {...shellProps()} />
      </ControlsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Codex" }));
    expect(screen.getByRole("menuitem", { name: "Codex UI" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Codex ID" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Export" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Import" })).toBeInTheDocument();
  });

  // The "Codex ID" page was previously reachable only 3 clicks deep (Codex UI
  // -> Blockchain Accounts -> Arweave -> Codex ID category tab) — real,
  // reported user confusion. This pins the fix: it's a direct tier-2 menu
  // item, mirroring "Codex UI"/"Settings"'s own icon+label+aria-current
  // markup pattern exactly (not a bespoke shape for the new item).
  it("selecting 'Codex ID' calls onSelectView('codex-id') and closes the menu", () => {
    const onSelectView = vi.fn();
    render(
      <ControlsProvider>
        <OuronetShellMock {...shellProps({ onSelectView })} />
      </ControlsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Codex" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Codex ID" }));
    expect(onSelectView).toHaveBeenCalledWith("codex-id");
    expect(screen.queryByRole("menuitem", { name: "Codex ID" })).toBeNull();
  });

  it("marks 'Codex ID' active (aria-current) when activeView is 'codex-id', and the others not", () => {
    render(
      <ControlsProvider>
        <OuronetShellMock {...shellProps({ activeView: "codex-id" })} />
      </ControlsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Codex" }));
    expect(screen.getByRole("menuitem", { name: "Codex ID" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("menuitem", { name: "Codex UI" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("menuitem", { name: "Settings" })).not.toHaveAttribute("aria-current");
  });

  it("the 'Codex ID' menu item has its own icon (an icon+label cell, same pattern as every other item)", () => {
    render(
      <ControlsProvider>
        <OuronetShellMock {...shellProps()} />
      </ControlsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Codex" }));
    const item = screen.getByRole("menuitem", { name: "Codex ID" });
    expect(item.querySelector("svg")).not.toBeNull();
  });

  it("omits the Import item when onImport isn't provided (nothing loaded to replace yet)", () => {
    render(
      <ControlsProvider>
        <OuronetShellMock {...shellProps({ onImport: undefined })} />
      </ControlsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Codex" }));
    expect(screen.queryByRole("menuitem", { name: "Import" })).toBeNull();
  });

  it("selecting 'Codex UI' calls onSelectView('ui') and closes the menu", () => {
    const onSelectView = vi.fn();
    render(
      <ControlsProvider>
        <OuronetShellMock {...shellProps({ activeView: "settings", onSelectView })} />
      </ControlsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Codex" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Codex UI" }));
    expect(onSelectView).toHaveBeenCalledWith("ui");
    expect(screen.queryByRole("menuitem", { name: "Codex UI" })).toBeNull();
  });

  it("selecting 'Export' calls onExport and closes the menu", () => {
    const onExport = vi.fn();
    render(
      <ControlsProvider>
        <OuronetShellMock {...shellProps({ onExport })} />
      </ControlsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Codex" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Export" }));
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menuitem", { name: "Export" })).toBeNull();
  });

  it("marks the active view with aria-current in the menu", () => {
    render(
      <ControlsProvider>
        <OuronetShellMock {...shellProps({ activeView: "settings" })} />
      </ControlsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Codex" }));
    expect(screen.getByRole("menuitem", { name: "Settings" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("menuitem", { name: "Codex UI" })).not.toHaveAttribute("aria-current");
  });

  it("lays out as ONE ROW of icon+label cells (the grid-auto-flow: column CSS class), not four stacked full-width rows", () => {
    render(
      <ControlsProvider>
        <OuronetShellMock {...shellProps()} />
      </ControlsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Codex" }));
    const menu = screen.getByRole("menu", { name: "Codex" });
    // The one-row grid layout lives in ouronet-shell-mock.css (`display: grid;
    // grid-auto-flow: column`), not inline style — pin the class that carries
    // it, and that every item has an icon (not text-only).
    expect(menu.className).toBe("cxpg-osm-codex-menu");
    for (const item of screen.getAllByRole("menuitem")) {
      expect(item.querySelector("svg")).not.toBeNull();
    }
  });

  it("tapping outside the menu (the backdrop) closes it", () => {
    render(
      <ControlsProvider>
        <OuronetShellMock {...shellProps()} />
      </ControlsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Codex" }));
    expect(screen.getByRole("menuitem", { name: "Codex UI" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /close codex menu/i }));
    expect(screen.queryByRole("menuitem", { name: "Codex UI" })).toBeNull();
  });
});

describe("OuronetShellMock — the Controls riser + drawer", () => {
  function Registrar() {
    useRegisterControls("test", "Test Actions", true, [
      { id: "a", label: "Do A", onClick: () => {} },
    ]);
    return null;
  }

  it("shows [0] (a permanent fixture, not hidden) when nothing is registered, and opens the empty drawer", () => {
    render(
      <ControlsProvider>
        <OuronetShellMock {...shellProps()} />
      </ControlsProvider>,
    );
    const riser = screen.getByRole("button", { name: /controls — 0 actions/i });
    expect(riser).toBeInTheDocument();
    fireEvent.click(riser);
    expect(screen.getByRole("dialog", { name: "Controls" })).toBeInTheDocument();
    expect(screen.getByText(/no actions available/i)).toBeInTheDocument();
  });

  it("shows the riser with the live count once something registers, and opens the drawer", () => {
    render(
      <ControlsProvider>
        <Registrar />
        <OuronetShellMock {...shellProps()} />
      </ControlsProvider>,
    );
    const riser = screen.getByRole("button", { name: /controls — 1 actions/i });
    fireEvent.click(riser);
    expect(screen.getByRole("dialog", { name: "Controls" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Do A" })).toBeInTheDocument();
  });
});
