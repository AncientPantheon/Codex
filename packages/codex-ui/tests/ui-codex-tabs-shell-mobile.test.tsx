/**
 * CodexTabsShell — the mobile bottom tab bar.
 *
 * Desktop keeps the existing big bordered icon-tile GRID at the top (a
 * "reflow" page in the Pantheonic-mobile classification would fail here: N
 * equal-width columns of large tiles genuinely can't survive 390px — the
 * desktop metaphor has to be replaced, not shrunk, matching the doc's own
 * "custom" vs "reflow" distinction). Mobile gets a bottom tab bar (icon +
 * short label, thumb-reachable) with the active tab's content filling the
 * space above it — the CodexUI-scoped equivalent of OuronetUI's
 * `MobileTabBar`.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { CodexUiRoot } from "../src/ui/CodexUiRoot";
import { CodexTabsShell, type CodexTabsShellItem } from "../src/ui/CodexTabsShell";

class FakeResizeObserver {
  callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element) {
    this.callback(
      [{ contentRect: { width: FakeResizeObserver.nextWidth } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
    void target;
  }
  unobserve() {}
  disconnect() {}
  static nextWidth = 1024;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const TABS: CodexTabsShellItem[] = [
  { key: "a", label: "Accounts", content: <div>Accounts panel</div> },
  { key: "b", label: "Settings", content: <div>Settings panel</div> },
];

function renderShell(width: number, tabs: CodexTabsShellItem[] = TABS) {
  FakeResizeObserver.nextWidth = width;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  return render(
    <CodexUiRoot>
      <CodexTabsShell tabs={tabs} />
    </CodexUiRoot>,
  );
}

describe("CodexTabsShell — mobile bottom tab bar", () => {
  it("desktop: unchanged — the tablist is a grid of large tiles, not a bottom bar", () => {
    renderShell(1920);
    const tablist = screen.getByRole("tablist");
    expect(tablist.style.display).toBe("grid");
  });

  it("mobile: the tablist becomes a bottom tab bar, sticky to the bottom of the shell", () => {
    renderShell(390);
    const tablist = screen.getByRole("tablist");
    expect(tablist.style.display).not.toBe("grid");
    expect(tablist.style.position).toBe("sticky");
    expect(tablist.style.bottom).toBe("0px");
  });

  it("mobile: still switches tabs on tap, same as desktop", () => {
    renderShell(390);
    expect(screen.getByText("Accounts panel")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Settings/i }));
    expect(screen.getByText("Settings panel")).toBeInTheDocument();
    expect(screen.queryByText("Accounts panel")).not.toBeInTheDocument();
  });

  it("mobile: every tab still renders its label (thumb-reachable, icon + short label, not icon-only)", () => {
    renderShell(390);
    expect(screen.getByText("Accounts")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });
});
