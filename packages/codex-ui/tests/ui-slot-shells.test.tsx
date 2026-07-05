/**
 * Slot-shell seam tests — the PURE-LAYOUT generic containers codex-ui owns.
 *
 * `CodexTabsShell` and `CodexSettingsSectionShell` are the seam through which
 * the Ouronet-side `CodexTabs` / `CodexSettingsSection` aggregators (T9.6) inject
 * their concrete tab/card children. The shells own ONLY the layout + the
 * active-tab/active-subtab switching state; they statically import NO concrete
 * tab or card (MOVE or STAY). These tests mount each shell with FAKE slot
 * children and assert:
 *   - every injected slot mounts,
 *   - clicking a tab/subtab swaps which slot's content is shown (the branching
 *     logic that makes these TDD-worthy),
 *   - the shell SOURCE contains no static import of a concrete tab/card, which is
 *     what keeps the STAY chain edge (and any MOVE-child coupling) out of the
 *     generic shell.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import { CodexTabsShell } from "../src/ui/CodexTabsShell.js";
import type { CodexTabsShellItem } from "../src/ui/CodexTabsShell.js";
import { CodexSettingsSectionShell } from "../src/ui/settings/CodexSettingsSectionShell.js";
import type { CodexSettingsSubtab } from "../src/ui/settings/CodexSettingsSectionShell.js";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// CodexTabsShell — injected tab list, active-tab switching
// ---------------------------------------------------------------------------

describe("CodexTabsShell — injected tab slots", () => {
  const tabs: CodexTabsShellItem[] = [
    { key: "alpha", label: "Alpha", content: <div>alpha-panel</div> },
    { key: "beta", label: "Beta", content: <div>beta-panel</div> },
    { key: "gamma", label: "Gamma", content: <div>gamma-panel</div> },
  ];

  it("renders a tab button for every injected item so the host controls the full tab set", () => {
    render(<CodexTabsShell tabs={tabs} />);
    // One tab button per injected item — the shell holds no hardcoded tab list.
    expect(screen.getByRole("tab", { name: "Alpha" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Beta" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Gamma" })).toBeTruthy();
  });

  it("shows the first injected tab's content on mount and hides the others", () => {
    render(<CodexTabsShell tabs={tabs} />);
    expect(screen.getByText("alpha-panel")).toBeTruthy();
    expect(screen.queryByText("beta-panel")).toBeNull();
    expect(screen.queryByText("gamma-panel")).toBeNull();
  });

  it("honours defaultTab so the host can open on a non-first slot", () => {
    render(<CodexTabsShell tabs={tabs} defaultTab="gamma" />);
    expect(screen.getByText("gamma-panel")).toBeTruthy();
    expect(screen.queryByText("alpha-panel")).toBeNull();
  });

  it("swaps the shown panel when a different tab is clicked (the active-tab branch)", () => {
    render(<CodexTabsShell tabs={tabs} />);
    fireEvent.click(screen.getByRole("tab", { name: "Beta" }));
    // Only the clicked tab's slot renders; the previous one unmounts.
    expect(screen.getByText("beta-panel")).toBeTruthy();
    expect(screen.queryByText("alpha-panel")).toBeNull();
  });

  it("marks exactly the active tab aria-selected so assistive tech tracks the switch", () => {
    render(<CodexTabsShell tabs={tabs} />);
    fireEvent.click(screen.getByRole("tab", { name: "Gamma" }));
    expect(screen.getByRole("tab", { name: "Gamma" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Alpha" }).getAttribute("aria-selected")).toBe("false");
  });
});

// ---------------------------------------------------------------------------
// CodexSettingsSectionShell — injected subtabs + card slots, active-subtab switch
// ---------------------------------------------------------------------------

describe("CodexSettingsSectionShell — injected subtab/card slots", () => {
  const subtabs: CodexSettingsSubtab[] = [
    { key: "ops", label: "Operations", color: "#ceac5f", cards: <div>ops-cards</div> },
    { key: "security", label: "Security", color: "#22c55e", cards: <div>security-cards</div> },
    { key: "advanced", label: "Advanced", color: "#f59e0b", cards: <div>advanced-cards</div> },
  ];

  it("renders a pill for every injected subtab so the Ouronet taxonomy lives host-side", () => {
    render(<CodexSettingsSectionShell subtabs={subtabs} />);
    expect(screen.getByRole("button", { name: "Operations" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Security" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Advanced" })).toBeTruthy();
  });

  it("shows the first subtab's injected cards on mount, hiding the rest", () => {
    render(<CodexSettingsSectionShell subtabs={subtabs} />);
    expect(screen.getByText("ops-cards")).toBeTruthy();
    expect(screen.queryByText("security-cards")).toBeNull();
    expect(screen.queryByText("advanced-cards")).toBeNull();
  });

  it("honours initialTab so the host can open on a chosen subtab", () => {
    render(<CodexSettingsSectionShell subtabs={subtabs} initialTab="advanced" />);
    expect(screen.getByText("advanced-cards")).toBeTruthy();
    expect(screen.queryByText("ops-cards")).toBeNull();
  });

  it("swaps the visible card group when another subtab pill is clicked (the active-subtab branch)", () => {
    render(<CodexSettingsSectionShell subtabs={subtabs} />);
    fireEvent.click(screen.getByRole("button", { name: "Security" }));
    expect(screen.getByText("security-cards")).toBeTruthy();
    expect(screen.queryByText("ops-cards")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// No-concrete-child-import proof — the seam's whole point
// ---------------------------------------------------------------------------

describe("slot shells — no concrete tab/card static import", () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, "..", rel), "utf8");
  const tabsShell = read("src/ui/CodexTabsShell.tsx");
  const settingsShell = read("src/ui/settings/CodexSettingsSectionShell.tsx");

  it("CodexTabsShell imports none of the five concrete tabs", () => {
    // A static import of any concrete tab would re-entangle the shell with a
    // STAY chain edge (or a MOVE-child coupling) — defeating the slot seam.
    for (const tab of [
      "OuronetAccountsTab",
      "SeedWordsTab",
      "PureKeypairsTab",
      "StoaAccountsTab",
      "AddressBookTab",
    ]) {
      expect(tabsShell.includes(tab)).toBe(false);
    }
  });

  it("CodexSettingsSectionShell imports no concrete settings card", () => {
    // Any card import — a MOVE card or a STAY zbom card — must be absent; the
    // aggregator injects them all through the slot prop.
    for (const card of [
      "ZbomSettingsCard",
      "DebouncerSettingsCard",
      "ReadFunctionsCard",
      "CodexInfoCard",
      "EncryptionCard",
      "GasSettingsCard",
    ]) {
      expect(settingsShell.includes(card)).toBe(false);
    }
  });

  it("neither shell carries a value @stoachain or zbom edge", () => {
    const valueStoachain = /^\s*import\s+(?!type\b)[^;]*from\s+["']@stoachain/m;
    const zbom = /from\s+["'][^"']*zbom/;
    for (const src of [tabsShell, settingsShell]) {
      expect(valueStoachain.test(src)).toBe(false);
      expect(zbom.test(src)).toBe(false);
    }
  });
});
