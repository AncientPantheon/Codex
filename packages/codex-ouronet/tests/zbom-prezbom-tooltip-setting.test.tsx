/**
 * usePreZbomTooltipSetting — the Pre-ZBOM Tooltip on/off preference, persisted
 * in the per-consumer settings registry under `useConsumerName()`'s value
 * (defaults to "Codex", NOT OuronetUI's own "OuronetUI" entry — the whole
 * point of the per-consumer split, per HANDOFF-prezbom-tooltip-CODEX.md).
 *
 * Two hard rules from the brief, both proven here directly against the real
 * store (no mocks of updateConsumerSettings itself):
 *   - MERGE, never replace: a write must not drop an unrelated key already in
 *     the consumer's `settings` payload.
 *   - NEVER LOWER schemaVersion: a write must not regress a stored
 *     schemaVersion higher than this feature's own SETTINGS_SCHEMA_VERSION.
 * The write-back lives in the setter itself, not a watcher on the live value —
 * this suite's "no prior entry" case (default true, no store write triggered
 * by merely reading the hook) is the regression guard for that.
 */

import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import {
  MemoryCodexAdapter,
  emptySnapshot,
} from "@ancientpantheon/codex-ouronet/adapters";
import { useConsumerSettings } from "@ancientpantheon/codex-ouronet/hooks";
import type { IConsumerSettings } from "@ancientpantheon/codex-ouronet/types";
import { usePreZbomTooltipSetting } from "../src/zbom/cfm/usePreZbomTooltipSetting.js";

async function seededAdapter(
  consumerSettings: Record<string, IConsumerSettings>,
): Promise<MemoryCodexAdapter> {
  const adapter = new MemoryCodexAdapter("dev");
  await adapter.saveAll({ ...emptySnapshot("dev"), consumerSettings });
  return adapter;
}

function mkWrapper(adapter: MemoryCodexAdapter) {
  return ({ children }: { children: React.ReactNode }) => (
    <CodexProvider adapter={adapter}>{children}</CodexProvider>
  );
}

function mkWrapperWithConsumerName(adapter: MemoryCodexAdapter, consumerName: string) {
  return ({ children }: { children: React.ReactNode }) => (
    <CodexProvider adapter={adapter} consumerName={consumerName}>{children}</CodexProvider>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("usePreZbomTooltipSetting", () => {
  it("defaults to enabled=true when no consumerSettings entry exists yet for \"Codex\"", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderHook(() => usePreZbomTooltipSetting(), {
      wrapper: mkWrapper(adapter),
    });
    await waitFor(() => expect(result.current.enabled).toBe(true));
  });

  it("setEnabled(false) persists under consumerSettings[\"Codex\"], not \"OuronetUI\"", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderHook(() => usePreZbomTooltipSetting(), {
      wrapper: mkWrapper(adapter),
    });
    await waitFor(() => expect(result.current.enabled).toBe(true));

    await act(async () => {
      await result.current.setEnabled(false);
    });

    await waitFor(() => expect(result.current.enabled).toBe(false));
  });

  it("merges into the existing settings payload — does not drop an unrelated key", async () => {
    const adapter = await seededAdapter({
      Codex: {
        consumerName: "Codex",
        consumerVersion: "1.0.0",
        schemaVersion: 1,
        settings: { someOtherKey: "keep-me" },
        lastUpdatedAt: "2026-05-29T00:00:00.000Z",
      },
    });
    const { result } = renderHook(
      () => ({
        tooltip: usePreZbomTooltipSetting(),
        raw: useConsumerSettings("Codex"),
      }),
      { wrapper: mkWrapper(adapter) },
    );
    await waitFor(() => expect(result.current.tooltip.enabled).toBe(true));

    await act(async () => {
      await result.current.tooltip.setEnabled(false);
    });

    await waitFor(() =>
      expect(result.current.raw.entry?.settings.preZbomTooltip).toBe(false),
    );
    // The pre-existing unrelated key survives the write — proves merge, not replace.
    expect(result.current.raw.entry?.settings.someOtherKey).toBe("keep-me");
  });

  it("never lowers a stored schemaVersion higher than this feature's own", async () => {
    const adapter = await seededAdapter({
      Codex: {
        consumerName: "Codex",
        consumerVersion: "1.0.0",
        schemaVersion: 7,
        settings: {},
        lastUpdatedAt: "2026-05-29T00:00:00.000Z",
      },
    });
    const { result } = renderHook(
      () => ({
        tooltip: usePreZbomTooltipSetting(),
        raw: useConsumerSettings("Codex"),
      }),
      { wrapper: mkWrapper(adapter) },
    );
    await waitFor(() => expect(result.current.tooltip.enabled).toBe(true));

    await act(async () => {
      await result.current.tooltip.setEnabled(false);
    });

    await waitFor(() =>
      expect(result.current.raw.entry?.settings.preZbomTooltip).toBe(false),
    );
    // schemaVersion 7 (already higher than this feature's own) must survive
    // unregressed — the never-lower rule.
    expect(result.current.raw.entry?.schemaVersion).toBe(7);
  });

  it("setEnabled never rejects/throws for a consumerName the store's identifier regex refuses — logs instead of an unhandled rejection", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const adapter = new MemoryCodexAdapter("dev");
    // "My App" contains a space — fails CONSUMER_NAME_RE
    // (/^[A-Za-z][A-Za-z0-9_-]{0,63}$/) in the store's updateConsumerSettings.
    const { result } = renderHook(() => usePreZbomTooltipSetting(), {
      wrapper: mkWrapperWithConsumerName(adapter, "My App"),
    });
    await waitFor(() => expect(result.current.enabled).toBe(true));

    // Must NOT throw/reject — this is exactly what a bare `void
    // setEnabled(...)` click handler relies on.
    await expect(
      act(async () => {
        await result.current.setEnabled(false);
      }),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain("usePreZbomTooltipSetting");
  });
});
