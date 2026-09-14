/**
 * CodexTabs shell specs (Phase 14, T14.6; Class-IA restructure).
 *
 * The tab switcher composing the THREE Class tabs — Ouronet Accounts (Class 1),
 * Blockchain Accounts (Class 2), Address Book (Class 3). The three Chainweb
 * tabs (Seed Words / Pure Key Pairs / Stoa Accounts) are no longer top-level
 * peers: they are reached through the Chainweb panel inside Class 2, so the top
 * strip must NOT surface them.
 *
 * Class 2 renders codex-ui's chain-generic <ForeignChainsTab> fed from two
 * INJECTED optional props, so codex-ouronet gains no dependency on any concrete
 * foreign-chain package. The specs therefore pin both directions: the default
 * (no props) path degrades to the generic empty state rather than throwing, and
 * injected chains/panels are actually forwarded through to the shell.
 *
 * (The v0.3.x clone rewrite of the Ouronet Accounts tab dropped the
 * injected-StoicTag props, so CodexTabs no longer threads them — only
 * `className` / `defaultTab` plus the two foreign-chain slots remain.)
 */

import * as React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { useCodex } from "@ancientpantheon/codex-ouronet/hooks";
import { CodexTabs } from "@ancientpantheon/codex-ouronet/ui";

function ReadyGate() {
  const { isReady } = useCodex();
  return <span data-testid="ready">{isReady ? "yes" : "no"}</span>;
}

async function renderShell(props: React.ComponentProps<typeof CodexTabs> = {}) {
  const adapter = new MemoryCodexAdapter("dev");
  const utils = render(
    <CodexProvider adapter={adapter}>
      <ReadyGate />
      <CodexTabs {...props} />
    </CodexProvider>,
  );
  await waitFor(() =>
    expect(screen.getByTestId("ready").textContent).toBe("yes"),
  );
  return utils;
}

/** The top-level Class strip, scoped away from the nested tablists the panels
 *  themselves render (the Class 2 chain rail, the per-chain category strips). */
function classStrip() {
  return screen.getByRole("tablist", { name: /codex sections/i });
}

describe("<CodexTabs>", () => {
  it("renders exactly the three Class tabs", async () => {
    await renderShell();
    const labels = within(classStrip())
      .getAllByRole("tab")
      .map((el) => el.textContent?.trim());
    expect(labels).toEqual([
      "Ouronet Accounts",
      "Blockchain Accounts",
      "Address Book",
    ]);
  });

  it("no longer surfaces the three Chainweb tabs at the top level", async () => {
    await renderShell();
    const strip = within(classStrip());
    expect(strip.queryByRole("tab", { name: /seed words/i })).toBeNull();
    expect(strip.queryByRole("tab", { name: /pure key pairs/i })).toBeNull();
    expect(strip.queryByRole("tab", { name: /stoa accounts/i })).toBeNull();
  });

  it("defaults to the Ouronet Accounts tab so its empty state shows on mount", async () => {
    await renderShell();
    expect(screen.getByText(/No standard accounts in Codex/i)).toBeTruthy();
    // The blockchain-accounts panel is NOT mounted by default.
    expect(screen.queryByText(/No foreign chains/i)).toBeNull();
  });

  it("honors the defaultTab prop", async () => {
    await renderShell({ defaultTab: "address-book" });
    // The address-book search input is the unambiguous signal that tab mounted.
    expect(screen.getByLabelText(/search addresses/i)).toBeTruthy();
    // The ouro-accounts panel is NOT mounted.
    expect(screen.queryByText(/No standard accounts in Codex/i)).toBeNull();
  });

  it("switches the visible tab on click", async () => {
    await renderShell();
    fireEvent.click(within(classStrip()).getByRole("tab", { name: /address book/i }));
    expect(await screen.findByLabelText(/search addresses/i)).toBeTruthy();
    // The ouro-accounts panel is no longer mounted.
    expect(screen.queryByText(/No standard accounts in Codex/i)).toBeNull();
  });

  it("renders Class 2's generic empty state when no foreign chains are injected", async () => {
    // The default ([] / {}) must degrade to ForeignChainsTab's own empty state,
    // never throw — codex-ouronet ships no chain of its own.
    await renderShell();
    fireEvent.click(
      within(classStrip()).getByRole("tab", { name: /blockchain accounts/i }),
    );
    expect(await screen.findByText(/No foreign chains\./i)).toBeTruthy();
  });

  it("forwards injected chains and panels into Class 2", async () => {
    function StubPanel({ id }: { id: string; ctx?: unknown }) {
      return <div data-testid="stub-panel">{`panel for ${id}`}</div>;
    }
    await renderShell({
      defaultTab: "blockchain-accounts",
      foreignChains: ["chainweb", "stub-chain"],
      foreignChainPanels: { chainweb: StubPanel, "stub-chain": StubPanel },
    });
    const rail = screen.getByRole("tablist", { name: /foreign chains/i });
    expect(
      within(rail)
        .getAllByRole("tab")
        .map((el) => el.textContent?.trim()),
    // The rail Capitalises ids for display; the id stays the dispatch contract
    // (asserted by the panel's own `panel for <id>` text below).
    ).toEqual(["chainweb", "stub-chain"].map((id) => id.charAt(0).toUpperCase() + id.slice(1)));
    // The first injected chain's panel is dispatched with its own id.
    expect(screen.getByTestId("stub-panel").textContent).toBe("panel for chainweb");
    fireEvent.click(within(rail).getByRole("tab", { name: /^stub-chain$/i }));
    expect(screen.getByTestId("stub-panel").textContent).toBe("panel for stub-chain");
  });
});
