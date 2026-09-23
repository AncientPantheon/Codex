/**
 * <CodexTabs> — mobile (docs/work/codex-ui-mobile/design.md §8): supersedes
 * codex-ui's generic CodexTabsShell bottom bar for this specific three-tab
 * set. Ouronet Accounts / Blockchain Accounts become two icon-only EdgeRails
 * (left/right edges); Address Book becomes a bottom stripe opening a
 * full-screen CodexModalShell popup.
 */
import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { useCodex } from "@ancientpantheon/codex-ouronet/hooks";
import { CodexTabs } from "@ancientpantheon/codex-ouronet/ui";
import { CodexUiRoot } from "@ancientpantheon/codex-ui/ui";

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

function ReadyGate() {
  const { isReady } = useCodex();
  return <span data-testid="ready">{isReady ? "yes" : "no"}</span>;
}

async function renderMobile(props: React.ComponentProps<typeof CodexTabs> = {}) {
  FakeResizeObserver.nextWidth = 390;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  const adapter = new MemoryCodexAdapter("dev");
  const utils = render(
    <CodexProvider adapter={adapter}>
      <ReadyGate />
      <CodexUiRoot>
        <CodexTabs {...props} />
      </CodexUiRoot>
    </CodexProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("yes"));
  return utils;
}

describe("<CodexTabs> — mobile: no more generic bottom bar", () => {
  it("renders no 'Codex sections' tablist (CodexTabsShell's generic bar is superseded here)", async () => {
    await renderMobile();
    expect(screen.queryByRole("tablist", { name: /codex sections/i })).toBeNull();
  });

  it("defaults to Ouronet Accounts in the core zone", async () => {
    await renderMobile();
    expect(screen.getByText(/No standard accounts in Codex/i)).toBeTruthy();
  });

  it("two EdgeRails switch the core zone between Ouronet Accounts and Blockchain Accounts", async () => {
    await renderMobile();
    fireEvent.click(screen.getByRole("button", { name: "Blockchain Accounts" }));
    expect(await screen.findByText(/No foreign chains\./i)).toBeTruthy();
    expect(screen.queryByText(/No standard accounts in Codex/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Ouronet Accounts" }));
    expect(await screen.findByText(/No standard accounts in Codex/i)).toBeTruthy();
  });

  it("honors defaultTab='blockchain-accounts' as the initial EdgeRail selection", async () => {
    await renderMobile({ defaultTab: "blockchain-accounts" });
    expect(screen.getByText(/No foreign chains\./i)).toBeTruthy();
  });

  it("the Address Book stripe opens a full-screen popup, closed by default", async () => {
    await renderMobile();
    expect(screen.queryByLabelText(/search addresses/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Address Book" }));
    expect(await screen.findByLabelText(/search addresses/i)).toBeTruthy();
    // It's the full-screen CodexModalShell sheet, not inline in the core zone.
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Address Book")).toBeTruthy();
    expect(dialog.style.position).toBe("absolute");
  });

  it("closing the Address Book popup returns to the core zone underneath", async () => {
    await renderMobile();
    fireEvent.click(screen.getByRole("button", { name: "Address Book" }));
    await screen.findByRole("dialog");

    fireEvent.click(screen.getByLabelText("Close"));
    expect(screen.queryByRole("dialog")).toBeNull();
    // The core zone (Ouronet Accounts, the default) is still there underneath.
    expect(screen.getByText(/No standard accounts in Codex/i)).toBeTruthy();
  });

  it("without addressBookRiserTarget: the stripe positions itself relative to its OWN frame (the fallback, unaffected)", async () => {
    const { container } = await renderMobile();
    const btn = screen.getByRole("button", { name: "Address Book" });
    expect(container.contains(btn)).toBe(true);
    expect(btn.style.position).toBe("absolute");
  });

  it("WITH addressBookRiserTarget: the stripe portals into the target node as a PLAIN button (no position styling of its own — the target owns that)", async () => {
    const riserSlot = document.body.appendChild(document.createElement("div"));
    const { container } = await renderMobile({ addressBookRiserTarget: riserSlot });
    const btn = screen.getByRole("button", { name: "Address Book" });
    expect(container.contains(btn)).toBe(false);
    expect(riserSlot.contains(btn)).toBe(true);
    expect(btn.style.position).toBe("");
    // Still fully functional from its new home.
    fireEvent.click(btn);
    expect(await screen.findByLabelText(/search addresses/i)).toBeTruthy();
    document.body.removeChild(riserSlot);
  });

  it("the outer frame is bounded (height: 100%) and non-scrolling; only the inner content wrapper scrolls — so the EdgeRails (anchored to the outer frame) never move with content scroll", async () => {
    const { container } = await renderMobile();
    const outerFrame = screen.getByRole("button", { name: "Ouronet Accounts" }).parentElement as HTMLElement;
    expect(outerFrame.style.height).toBe("100%");
    expect(outerFrame.style.display).toBe("flex");
    expect(outerFrame.style.flexDirection).toBe("column");
    // The EdgeRails are DIRECT children of this outer, non-scrolling frame —
    // not nested inside the inner scrolling div.
    expect(outerFrame.contains(screen.getByRole("button", { name: "Blockchain Accounts" }))).toBe(true);

    // The inner content wrapper is the ONE flexible, scrolling child.
    const innerScroller = container.querySelector('[style*="overflow-y: auto"]') as HTMLElement | null;
    expect(innerScroller).not.toBeNull();
    expect(innerScroller!.style.flex).toBe("1 1 0%");
    expect(innerScroller!.style.minHeight).toBe("0px");
  });

  it("without fullScreenPortalTarget: the EdgeRails stay direct children of this component's own frame, edge=\"bottom\" (the fallback, unaffected)", async () => {
    const { container } = await renderMobile();
    const btn = screen.getByRole("button", { name: "Ouronet Accounts" });
    expect(container.contains(btn)).toBe(true);
    expect(btn.style.bottom).toBe("0px");
    expect(btn.style.top).toBe("");
  });

  it("WITH fullScreenPortalTarget: the EdgeRails portal there instead, edge=\"middle\" (design.md §8, 'shown in their entirety' fix), and stay fully functional", async () => {
    const portalTarget = document.body.appendChild(document.createElement("div"));
    const { container } = await renderMobile({ fullScreenPortalTarget: portalTarget });
    const ouronetBtn = screen.getByRole("button", { name: "Ouronet Accounts" });
    const blockchainBtn = screen.getByRole("button", { name: "Blockchain Accounts" });
    expect(container.contains(ouronetBtn)).toBe(false);
    expect(portalTarget.contains(ouronetBtn)).toBe(true);
    expect(portalTarget.contains(blockchainBtn)).toBe(true);
    expect(ouronetBtn.style.top).toBe("50%");
    expect(ouronetBtn.style.bottom).toBe("");
    // Still fully functional from its new home — switches the core zone.
    fireEvent.click(blockchainBtn);
    expect(blockchainBtn.getAttribute("aria-pressed")).toBe("true");
    document.body.removeChild(portalTarget);
  });

  it("WITH edgeRailAnchorTarget: the EdgeRails prefer it over fullScreenPortalTarget — 'I think we should add them higher' (docks at Zone 2's own bottom seam, edge=\"bottom\", not the whole-screen center)", async () => {
    const zone2Anchor = document.body.appendChild(document.createElement("div"));
    const wholeBodyTarget = document.body.appendChild(document.createElement("div"));
    await renderMobile({ edgeRailAnchorTarget: zone2Anchor, fullScreenPortalTarget: wholeBodyTarget });
    const ouronetBtn = screen.getByRole("button", { name: "Ouronet Accounts" });
    expect(zone2Anchor.contains(ouronetBtn)).toBe(true);
    expect(wholeBodyTarget.contains(ouronetBtn)).toBe(false);
    // edge="bottom" against the Zone 2 anchor — straddles ITS bottom seam
    // (the Zone 2/Zone 3 boundary), not centered against the whole body.
    expect(ouronetBtn.style.bottom).toBe("0px");
    expect(ouronetBtn.style.top).toBe("");
    document.body.removeChild(zone2Anchor);
    document.body.removeChild(wholeBodyTarget);
  });

  it("swipeIndicatorRiserTarget does NOT dock the EdgeRails (bullets-only target since the owner's later correction) — falls back to fullScreenPortalTarget instead", async () => {
    const bulletsTarget = document.body.appendChild(document.createElement("div"));
    const wholeBodyTarget = document.body.appendChild(document.createElement("div"));
    await renderMobile({ swipeIndicatorRiserTarget: bulletsTarget, fullScreenPortalTarget: wholeBodyTarget });
    const ouronetBtn = screen.getByRole("button", { name: "Ouronet Accounts" });
    expect(bulletsTarget.contains(ouronetBtn)).toBe(false);
    expect(wholeBodyTarget.contains(ouronetBtn)).toBe(true);
    expect(ouronetBtn.style.top).toBe("50%"); // edge="middle" fallback
    document.body.removeChild(bulletsTarget);
    document.body.removeChild(wholeBodyTarget);
  });

  it("carries a real, visible backdrop again — not transparent (reverted per explicit owner correction: 'i told you not to make transparent')", async () => {
    const portalTarget = document.body.appendChild(document.createElement("div"));
    await renderMobile({ fullScreenPortalTarget: portalTarget });
    const ouronetBtn = screen.getByRole("button", { name: "Ouronet Accounts" });
    expect(ouronetBtn.style.backgroundColor).not.toBe("transparent");
    document.body.removeChild(portalTarget);
  });

  it("forwards injected foreign chains/panels into the Blockchain Accounts EdgeRail view", async () => {
    function StubPanel({ id }: { id: string; ctx?: unknown }) {
      return <div data-testid="stub-panel">{`panel for ${id}`}</div>;
    }
    await renderMobile({
      defaultTab: "blockchain-accounts",
      foreignChains: ["chainweb"],
      foreignChainPanels: { chainweb: StubPanel },
    });
    expect(screen.getByTestId("stub-panel").textContent).toBe("panel for chainweb");
  });
});

describe("<CodexTabs> — desktop (no CodexUiRoot ancestor): unaffected", () => {
  it("still renders the generic 'Codex sections' bottom bar, not the mobile EdgeRail layout", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <ReadyGate />
        <CodexTabs />
      </CodexProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("yes"));
    expect(screen.getByRole("tablist", { name: /codex sections/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ouronet Accounts" })).toBeNull();
  });
});
