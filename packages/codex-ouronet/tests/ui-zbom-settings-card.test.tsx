/**
 * ZbomSettingsCard — "Pre-ZBOM Tooltip" toggle.
 *
 * Unlike every other row in this card (Patron Selection, Zone Expansion,
 * Execute Button Position — all bound to `useCodex().uiSettings`/
 * `updateUiSettings`, the shared UI-settings slice), this ONE toggle is bound
 * to `usePreZbomTooltipSetting()` — the per-consumer settings registry — so
 * it persists under `consumerSettings["Codex"]`, separate from the shared
 * slice every other row in this card writes to.
 */
import * as React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter, emptySnapshot } from "@ancientpantheon/codex-ouronet/adapters";
import type { IConsumerSettings } from "@ancientpantheon/codex-ouronet/types";
import { ZbomSettingsCard } from "../src/ui/settings/ZbomSettingsCard.js";

function mkWrapper(adapter: MemoryCodexAdapter) {
  return ({ children }: { children: React.ReactNode }) => (
    <CodexProvider adapter={adapter}>{children}</CodexProvider>
  );
}

describe("ZbomSettingsCard — Pre-ZBOM Tooltip toggle", () => {
  it("is ON by default when nothing has been persisted yet", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    render(<ZbomSettingsCard />, { wrapper: mkWrapper(adapter) });

    await waitFor(() => expect(screen.getByText("Pre-ZBOM Tooltip")).toBeTruthy());
    expect(screen.getByTestId("prezbom-tooltip-toggle").getAttribute("aria-pressed")).toBe("true");
  });

  it("clicking the toggle persists false under consumerSettings[\"Codex\"] and reflects it", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    render(<ZbomSettingsCard />, { wrapper: mkWrapper(adapter) });

    await waitFor(() => expect(screen.getByTestId("prezbom-tooltip-toggle")).toBeTruthy());
    fireEvent.click(screen.getByTestId("prezbom-tooltip-toggle"));

    await waitFor(() =>
      expect(screen.getByTestId("prezbom-tooltip-toggle").getAttribute("aria-pressed")).toBe("false"),
    );
  });

  it("reads back false on a fresh mount against the same persisted adapter state", async () => {
    const entry: IConsumerSettings = {
      consumerName: "Codex",
      consumerVersion: "1.0.0",
      schemaVersion: 1,
      settings: { preZbomTooltip: false },
      lastUpdatedAt: "2026-05-29T00:00:00.000Z",
    };
    const adapter = new MemoryCodexAdapter("dev");
    await adapter.saveAll({ ...emptySnapshot("dev"), consumerSettings: { Codex: entry } });

    render(<ZbomSettingsCard />, { wrapper: mkWrapper(adapter) });

    await waitFor(() =>
      expect(screen.getByTestId("prezbom-tooltip-toggle").getAttribute("aria-pressed")).toBe("false"),
    );
  });
});
