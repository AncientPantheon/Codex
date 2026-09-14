/**
 * ChainwebPanel specs — the Chainweb chain panel contributed into codex-ui's
 * generic `ForeignChainsTab` slot.
 *
 * The panel RE-PARENTS the three existing Chainweb tabs under three categories
 * (Seeds / Pure Keys / Accounts) and owns nothing else: each category must mount
 * the REAL `SeedWordsTab` / `PureKeypairsTab` / `StoaAccountsTab`, not a copy.
 * The specs therefore assert on each concrete tab's own empty-state text — a
 * re-parenting that duplicated logic, dropped a mount, or silently rendered a
 * blank panel would fail here. `accounts` is the landing category, so a default
 * regression (landing on Seeds) is pinned too.
 *
 * Balances flow through the `pactRead` seam (StoaAccountsTab), stubbed so the
 * specs stay hermetic.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { setPactReader } from "@stoachain/stoa-core/reads";

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { useCodex } from "@ancientpantheon/codex-ouronet/hooks";
import { ChainwebPanel } from "@ancientpantheon/codex-ouronet/ui";

// Stub the read seam so StoaAccountsTab's live-balance effect never hits network.
beforeEach(() => {
  setPactReader(async () => ({ result: { data: [] } }) as never);
});

function ReadyGate() {
  const { isReady } = useCodex();
  return <span data-testid="ready">{isReady ? "yes" : "no"}</span>;
}

/** Mounts the panel exactly as `ForeignChainsTab` does: the chain-agnostic
 *  `PanelProps` pair, both of which the panel ignores. */
async function renderPanel() {
  const adapter = new MemoryCodexAdapter("dev");
  const utils = render(
    <CodexProvider adapter={adapter}>
      <ReadyGate />
      <ChainwebPanel id="chainweb" ctx={{ opaque: true }} />
    </CodexProvider>,
  );
  await waitFor(() =>
    expect(screen.getByTestId("ready").textContent).toBe("yes"),
  );
  return utils;
}

describe("<ChainwebPanel>", () => {
  it("renders the three Chainweb categories", async () => {
    await renderPanel();
    expect(screen.getByRole("tab", { name: "Seeds" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Pure Keys" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Accounts" })).toBeTruthy();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("lands on Accounts, mounting the Stoa accounts surface", async () => {
    await renderPanel();
    expect(screen.getByRole("tab", { name: "Accounts" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText(/total addresses/i)).toBeTruthy();
    // Neither of the other two surfaces is mounted.
    expect(screen.queryByText(/no seeds in the codex/i)).toBeNull();
    expect(screen.queryByText(/no pure keypairs yet/i)).toBeNull();
  });

  it("mounts the seed-words surface when Seeds is selected", async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole("tab", { name: "Seeds" }));
    expect(await screen.findByText(/no seeds in the codex/i)).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Seeds" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByText(/total addresses/i)).toBeNull();
  });

  it("mounts the pure-keypairs surface when Pure Keys is selected", async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole("tab", { name: "Seeds" }));
    fireEvent.click(screen.getByRole("tab", { name: "Pure Keys" }));
    expect(await screen.findByText(/no pure keypairs yet/i)).toBeTruthy();
    expect(screen.queryByText(/no seeds in the codex/i)).toBeNull();
  });
});
