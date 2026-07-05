/**
 * CodexTabs shell specs (Phase 14, T14.6).
 *
 * The tab switcher composing the five assembled account tabs. Pins the shell
 * contract: it renders a tab strip, defaults to the Ouronet Accounts tab, and
 * switches the visible tab on click. (The v0.3.x clone rewrite of the Ouronet
 * Accounts tab dropped the injected-StoicTag props, so CodexTabs no longer
 * threads them — only `className` / `defaultTab` remain.)
 */

import * as React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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

describe("<CodexTabs>", () => {
  it("renders a tab strip with all five account tabs", async () => {
    await renderShell();
    expect(screen.getByRole("tab", { name: /ouronet accounts/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /seed words/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /pure key pairs/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /stoa accounts/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /address book/i })).toBeTruthy();
  });

  it("defaults to the Ouronet Accounts tab so its empty state shows on mount", async () => {
    await renderShell();
    expect(screen.getByText(/No standard accounts in Codex/i)).toBeTruthy();
    // The seed-words panel is NOT mounted by default.
    expect(screen.queryByText(/No seeds in the codex/i)).toBeNull();
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
    fireEvent.click(screen.getByRole("tab", { name: /seed words/i }));
    expect(await screen.findByText(/No seeds in the codex/i)).toBeTruthy();
    // The ouro-accounts panel is no longer mounted.
    expect(screen.queryByText(/No standard accounts in Codex/i)).toBeNull();
  });
});
