/**
 * The mobile scaffold wiring in App.tsx's Dashboard/DashboardBody
 * (docs/work/codex-ui-mobile/design.md §8): on a narrow (mobile) viewport,
 * "Export codex to JSON" / "Load a different codex" / the Codex UI-Settings
 * toggle are ghosted out of the header and relocated into OuronetShellMock's
 * Codex-tap tier-2 menu, and the whole dashboard renders wrapped in the
 * OuronetShellMock scaffold (the 7-icon mock bar). Desktop (the jsdom
 * default width) is asserted unaffected by e5-standalone-smoke.test.tsx
 * already — this file only covers the NEW mobile branch.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";

import { Dashboard } from "../src/App";
import { hydrateFromPlaintextSnapshot } from "../src/loadCodex";
import { populatedStoaChainSnapshot } from "../fixtures";

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { value: width, writable: true, configurable: true });
}

/**
 * `App.tsx`'s OWN mobile branching (`useOuronetMockMobile()`, driving Zone
 * 1/2/3 + OuronetShellMock) is VIEWPORT-based — `setViewportWidth` alone
 * covers it. But `CodexUiRoot`'s `useIsMobile()` (used inside CodexTabs /
 * ObservationalCodexIdDisplay to decide EdgeRails/SwipeDeck vs their desktop
 * shapes) is CONTAINER-relative, measured via a REAL `ResizeObserver` that
 * jsdom doesn't implement — without stubbing one, every `CodexUiRoot` in
 * this test file silently stays at its `isMobile: false` default forever,
 * regardless of viewport width, so CodexTabs would keep rendering its
 * DESKTOP `CodexTabsShell` (a `role="tab"` tablist including an "Address
 * Book" TAB) even at a narrow width — not the mobile EdgeRails + Address
 * Book stripe this file's own narrow-viewport tests are meant to exercise.
 */
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
  setViewportWidth(1024);
  vi.unstubAllGlobals();
});

beforeEach(() => {
  setViewportWidth(1024);
  FakeResizeObserver.nextWidth = 1024;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

async function mountDashboard() {
  const adapter = await hydrateFromPlaintextSnapshot(populatedStoaChainSnapshot);
  const utils = render(
    <CodexProvider adapter={adapter} deviceVariant="dev">
      <Dashboard />
    </CodexProvider>,
  );
  // A role-AGNOSTIC readiness signal — Zone 2's own "CodexID" title, which
  // renders regardless of whether CodexTabs (Zone 3, a separate component)
  // is showing its desktop shape (a `role="tab"` tablist) or its mobile
  // shape (EdgeRails, no `role="tab"` at all).
  await screen.findByText("CodexID");
  return utils;
}

describe("Dashboard — mobile viewport (< 700px): the OuronetUI mock scaffold", () => {
  it("wraps the dashboard in the 7-icon mock bar, with the Codex tab live", async () => {
    setViewportWidth(390);
    FakeResizeObserver.nextWidth = 390;
    await mountDashboard();
    expect(screen.getByRole("button", { name: "Codex" })).toBeInTheDocument();
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("STOA ICO")).toBeInTheDocument();
  });

  it("ghosts Export/Load out of the header and into the Codex-tap tier-2 menu instead", async () => {
    setViewportWidth(390);
    FakeResizeObserver.nextWidth = 390;
    await mountDashboard();

    // Not inline in the header any more.
    expect(screen.queryByRole("button", { name: /export.*json/i })).toBeNull();
    expect(screen.queryByRole("tab", { name: /codex ui/i })).toBeNull();

    // Reachable via tapping "Codex" in the outer bottom bar.
    fireEvent.click(screen.getByRole("button", { name: "Codex" }));
    expect(screen.getByRole("menuitem", { name: "Export" })).toBeInTheDocument();
    // Dashboard() (no onReset) omits Import — nothing loaded to replace yet.
    expect(screen.queryByRole("menuitem", { name: "Import" })).toBeNull();
  });

  it("switching Codex UI / Settings via the tier-2 menu still swaps the core zone", async () => {
    setViewportWidth(390);
    FakeResizeObserver.nextWidth = 390;
    await mountDashboard();

    fireEvent.click(screen.getByRole("button", { name: "Codex" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Settings" }));
    // Settings mounts (Network card is part of CodexSettingsSection); the
    // Codex UI view (Zone 3's "ui" content) is no longer mounted — checked
    // via the Address Book stripe/EdgeRails, which only CodexTabs renders
    // (Settings has neither).
    expect(screen.queryByRole("button", { name: "Address Book" })).toBeNull();
  });

  it("Zone 1 (debouncer) and Zone 2 (CodexID) are RESERVED — separate, flex-none elements ABOVE the scrolling Zone 3, not glued into one scrolling card", async () => {
    setViewportWidth(390);
    FakeResizeObserver.nextWidth = 390;
    const { container } = await mountDashboard();

    const zone1 = container.querySelector(".cxpg-zone1");
    const separator = container.querySelector(".cxpg-zone1-separator");
    const zone2 = container.querySelector(".cxpg-zone2");
    const zone3 = container.querySelector(".cxpg-zone3");
    expect(zone1).not.toBeNull();
    expect(separator).not.toBeNull();
    expect(zone2).not.toBeNull();
    expect(zone3).not.toBeNull();

    // DOM order: Zone 1, its separator, Zone 2, THEN Zone 3 — matching the
    // owner's "Zone 1 has a fixed bar separator from everything else, and
    // everything else has itself 2 regions: Zone 2, and the remainder is
    // Zone 3" description.
    const order = Array.from(container.querySelectorAll(".cxpg-zone1, .cxpg-zone1-separator, .cxpg-zone2, .cxpg-zone3")).map(
      (el) => el.className,
    );
    expect(order).toEqual(["cxpg-zone1", "cxpg-zone1-separator", "cxpg-zone2", "cxpg-zone3"]);

    // Zone 1/2 are no longer part of the SAME scrolling card as Zone 3 (the
    // old `.cxpg-bodycard` wrapper, which glued CodexID + core content
    // together, is mobile's OLD/wrong shape — desktop still uses it).
    expect(container.querySelector(".cxpg-bodycard")).toBeNull();
  });

  it("the Controls riser is a PERMANENT fixture, flush to the tab bar, showing [1] — Zone 2's Codex Lock control, ghosted there by default since Zone 2 itself is collapsed by default", async () => {
    // WHY [1] not [0]: the "Zone 2 collapse" round made Zone 2 collapsed by
    // default (a single line, no room for its own Lock control inline), so
    // that control ghosts into Controls immediately on mount — same
    // mechanism that already ghosted it once a CodexID was populated, now
    // ALSO covering the collapsed-empty-state case (see
    // `ObservationalCodexIdDisplay`'s `lockRegistered` gate:
    // `isMobile && (populated || collapsed)`).
    setViewportWidth(390);
    FakeResizeObserver.nextWidth = 390;
    await mountDashboard();
    const riser = screen.getByRole("button", { name: /controls — 1 action/i });
    expect(riser).toBeInTheDocument();
    fireEvent.click(riser);
    expect(screen.getByRole("dialog", { name: "Controls" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /lock codex/i })).toBeInTheDocument();
  });

  it("the Address Book stripe is flush to the tab bar (inside OuronetShellMock's riser slot), not floating in the scrolling core content", async () => {
    setViewportWidth(390);
    FakeResizeObserver.nextWidth = 390;
    const { container } = await mountDashboard();

    const riserSlot = container.querySelector(".cxpg-osm-addressbook-riser-slot");
    expect(riserSlot).not.toBeNull();

    const addressBookBtn = screen.getByRole("button", { name: "Address Book" });
    // It's INSIDE the riser slot (flush to the tab bar)...
    expect(riserSlot!.contains(addressBookBtn)).toBe(true);
    // ...and NOT inside Zone 3's scrolling core content, where the old
    // (bounded-to-CodexTabs'-own-frame) riser used to float with a gap
    // above the tab bar.
    const zone3 = container.querySelector(".cxpg-zone3");
    expect(zone3!.contains(addressBookBtn)).toBe(false);

    // Still fully functional from its new home.
    fireEvent.click(addressBookBtn);
    expect(await screen.findByLabelText(/search addresses/i)).toBeInTheDocument();
  });
});

describe("Dashboard — desktop viewport (>= 700px): unaffected", () => {
  it("keeps Export inline in the header, no mock shell", async () => {
    setViewportWidth(1024);
    await mountDashboard();
    expect(screen.getByRole("button", { name: /export.*json/i })).toBeInTheDocument();
    expect(screen.queryByText("STOA ICO")).toBeNull();
  });
});
