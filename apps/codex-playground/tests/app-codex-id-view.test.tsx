/**
 * The new top-level "Codex ID" view (promoted out of `ArweavePanel.tsx`'s
 * own internal `active === "codex-id"` tab, previously reachable only 3
 * clicks deep: Codex UI -> Blockchain Accounts -> Arweave -> Codex ID — real,
 * reported user confusion). Pins the DESKTOP `.cxpg-viewtabs` row: a third
 * "Codex ID" button alongside "Codex UI" / "Codex UI Settings", which
 * renders the extracted `CodexIdPage` directly when selected.
 *
 * Mirrors `network-settings-wiring.test.tsx`'s own `mountDashboard` pattern
 * (hydrate a plaintext snapshot, mount `<Dashboard />` under `<CodexProvider>`,
 * wait for the Class IA tab bar) — the same real dashboard shell, not a fake.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";

import { Dashboard } from "../src/App";
import { hydrateFromPlaintextSnapshot } from "../src/loadCodex";
import { populatedStoaChainSnapshot } from "../fixtures";

afterEach(() => {
  cleanup();
});

async function mountDashboard() {
  const adapter = await hydrateFromPlaintextSnapshot(populatedStoaChainSnapshot);
  render(
    <CodexProvider adapter={adapter} deviceVariant="dev">
      <Dashboard />
    </CodexProvider>,
  );
  await screen.findByRole("tab", { name: /blockchain accounts/i });
}

describe("Desktop '.cxpg-viewtabs' row — the new 'Codex ID' tab", () => {
  it("is present alongside 'Codex UI' / 'Codex UI Settings', mirroring their exact role/markup pattern", async () => {
    await mountDashboard();
    expect(screen.getByRole("tab", { name: "Codex UI" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Codex UI Settings" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Codex ID" })).toBeInTheDocument();
  });

  it("'Codex UI' is selected by default, 'Codex ID' is not", async () => {
    await mountDashboard();
    expect(screen.getByRole("tab", { name: "Codex UI" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Codex ID" })).toHaveAttribute("aria-selected", "false");
  });

  it("clicking 'Codex ID' selects it, deselects 'Codex UI', and renders the Codex ID page directly — no 3-click detour through Blockchain Accounts", async () => {
    await mountDashboard();
    fireEvent.click(screen.getByRole("tab", { name: "Codex ID" }));

    expect(screen.getByRole("tab", { name: "Codex ID" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Codex UI" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByTestId("arweave-codex-id-page")).toBeInTheDocument();
    // Blockchain Accounts' own Class IA tab bar (ForeignChainsWiring's
    // CodexTabs) is gone while this view is showing — a genuinely different
    // top-level view, not an overlay on top of the old one.
    expect(screen.queryByRole("tab", { name: /blockchain accounts/i })).toBeNull();
  });

  it("the Codex ID page's own informatics content (Part 1's expanded copy) is present", async () => {
    await mountDashboard();
    fireEvent.click(screen.getByRole("tab", { name: "Codex ID" }));
    expect(screen.getByTestId("codex-backup-informatics")).toBeInTheDocument();
    expect(screen.getByTestId("codex-migration-informatics")).toBeInTheDocument();
  });

  it("clicking back to 'Codex UI' restores the normal dashboard", async () => {
    await mountDashboard();
    fireEvent.click(screen.getByRole("tab", { name: "Codex ID" }));
    fireEvent.click(screen.getByRole("tab", { name: "Codex UI" }));

    expect(screen.getByRole("tab", { name: /blockchain accounts/i })).toBeInTheDocument();
    expect(screen.queryByTestId("arweave-codex-id-page")).toBeNull();
  });
});
