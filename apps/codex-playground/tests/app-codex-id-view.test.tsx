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
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

import { CodexProvider, useCodexStore } from "@ancientpantheon/codex-ouronet/provider";
import { STRUCTURAL_SHAPE_TARGET_VERSION } from "@ancientpantheon/codex-ouronet/structural-migration";

import { Dashboard } from "../src/App";
import { hydrateFromPlaintextSnapshot } from "../src/loadCodex";
import { populatedStoaChainSnapshot } from "../fixtures";

afterEach(() => {
  cleanup();
});

// Exposes the per-mount store so a test can set Codex_Shape_Version
// directly, same convention as codex-ouronet's own
// tests/hooks-needs-structural-upgrade.test.tsx.
let capturedStore: ReturnType<typeof useCodexStore> | null = null;
function StoreGrabber() {
  capturedStore = useCodexStore();
  return null;
}

async function mountDashboardWithStore() {
  const adapter = await hydrateFromPlaintextSnapshot(populatedStoaChainSnapshot);
  render(
    <CodexProvider adapter={adapter} deviceVariant="dev">
      <StoreGrabber />
      <Dashboard />
    </CodexProvider>,
  );
  await screen.findByRole("tab", { name: /blockchain accounts/i });
}

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

  it("the Codex ID page's own informatics content is present, now split across three tabs", async () => {
    await mountDashboard();
    fireEvent.click(screen.getByRole("tab", { name: "Codex ID" }));
    // Default informatics tab ("How Backup Works") shows immediately; the
    // other two are a click away (owner correction, 2026-10-12: split the
    // single growing wall of text into tabs).
    expect(screen.getByTestId("codex-backup-informatics")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("codex-id-informatics-tab-encryption"));
    expect(screen.getByTestId("codex-encryption-informatics")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("codex-id-informatics-tab-migration"));
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

// The flashing structural-upgrade badge on the "Codex ID" tab (docs/work/
// upgrade-prompt-ui, T3) — driven by useNeedsStructuralUpgrade(), the same
// hook/boolean the mobile OuronetShellMock menu item and CodexIdPage's own
// gating use, so all three can never disagree.
describe("Desktop '.cxpg-viewtab' \"Codex ID\" tab — the structural-upgrade badge", () => {
  it("shows the badge when the live codex needs a structural upgrade (fresh/unversioned Codex_Shape_Version)", async () => {
    await mountDashboardWithStore();
    // populatedStoaChainSnapshot never stamps Codex_Shape_Version, leaving
    // it at its default `undefined` — the exact "Unversioned" case the
    // hook exists to flag.
    expect(screen.getByTestId("codex-id-upgrade-badge")).toBeInTheDocument();
  });

  it("hides the badge once Codex_Shape_Version is stamped at the current structural target", async () => {
    await mountDashboardWithStore();
    act(() => {
      capturedStore!.setState({ Codex_Shape_Version: STRUCTURAL_SHAPE_TARGET_VERSION });
    });
    expect(screen.queryByTestId("codex-id-upgrade-badge")).toBeNull();
  });
});
