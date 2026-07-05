/**
 * useConsumerSettings(name) (codex-ui) — thin per-consumer hook over the
 * consumerSettings registry slice + the updateConsumerSettings action.
 *
 * Ported from codex-ouronet with the carve's two changes: hook + provider from
 * codex-ui's src, and the store injected via the `createStore` seam. Pins
 * per-name selection, re-render-on-write, slot isolation, and error propagation.
 */

import * as React from "react";
import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

import { CodexProvider } from "../src/provider/index.js";
import { useConsumerSettings } from "../src/hooks/index.js";

import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import {
  MemoryCodexAdapter,
  emptySnapshot,
} from "@ancientpantheon/codex-ouronet/adapters";
import { CodexConsumerSettingsError } from "@ancientpantheon/codex-ouronet/errors";
import type { IConsumerSettings } from "@ancientpantheon/codex-ouronet/types";

const entryFx = (
  consumerName: string,
  overrides: Partial<IConsumerSettings> = {}
): IConsumerSettings => ({
  consumerName,
  consumerVersion: "1.0.0",
  schemaVersion: 1,
  settings: { theme: "dark" },
  lastUpdatedAt: "2026-05-29T00:00:00.000Z",
  ...overrides,
});

async function seededAdapter(
  consumerSettings: Record<string, IConsumerSettings>
): Promise<MemoryCodexAdapter> {
  const adapter = new MemoryCodexAdapter("dev");
  await adapter.saveAll({
    ...emptySnapshot("dev"),
    consumerSettings,
  });
  return adapter;
}

function mkWrapper(adapter: MemoryCodexAdapter) {
  return ({ children }: { children: React.ReactNode }) => (
    <CodexProvider createStore={createCodexStore} adapter={adapter}>
      {children}
    </CodexProvider>
  );
}

describe("useConsumerSettings", () => {
  it("entry is null for an unknown consumer name", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderHook(() => useConsumerSettings("Mnemosyne"), {
      wrapper: mkWrapper(adapter),
    });
    await waitFor(() => expect(result.current.entry).toBeNull());
  });

  it("entry reflects the named consumer's settings loaded from the snapshot", async () => {
    const adapter = await seededAdapter({
      OuronetUI: entryFx("OuronetUI", { settings: { theme: "light" } }),
    });
    const { result } = renderHook(() => useConsumerSettings("OuronetUI"), {
      wrapper: mkWrapper(adapter),
    });
    await waitFor(() =>
      expect(result.current.entry?.consumerName).toBe("OuronetUI")
    );
    expect(result.current.entry?.settings).toEqual({ theme: "light" });
  });

  it("setSettings writes the entry and the hook re-renders with it (server-stamped)", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderHook(() => useConsumerSettings("Mnemosyne"), {
      wrapper: mkWrapper(adapter),
    });
    await waitFor(() => expect(result.current.entry).toBeNull());

    await act(async () => {
      await result.current.setSettings(
        entryFx("Mnemosyne", { schemaVersion: 2 })
      );
    });

    expect(result.current.entry?.consumerName).toBe("Mnemosyne");
    expect(result.current.entry?.schemaVersion).toBe(2);
    expect(result.current.entry?.lastUpdatedAt).not.toBe(
      "2026-05-29T00:00:00.000Z"
    );
  });

  it("setSettings does not disturb another consumer's slot", async () => {
    const adapter = await seededAdapter({
      OuronetUI: entryFx("OuronetUI"),
    });
    const { result } = renderHook(
      () => ({
        mine: useConsumerSettings("Mnemosyne"),
        other: useConsumerSettings("OuronetUI"),
      }),
      { wrapper: mkWrapper(adapter) }
    );
    await waitFor(() =>
      expect(result.current.other.entry?.consumerName).toBe("OuronetUI")
    );

    await act(async () => {
      await result.current.mine.setSettings(entryFx("Mnemosyne"));
    });

    expect(result.current.mine.entry?.consumerName).toBe("Mnemosyne");
    expect(result.current.other.entry?.consumerName).toBe("OuronetUI");
    expect(result.current.other.entry?.settings).toEqual({ theme: "dark" });
  });

  it("setSettings propagates the action's invalid-consumer-name rejection", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderHook(() => useConsumerSettings("bad name!"), {
      wrapper: mkWrapper(adapter),
    });
    await waitFor(() => expect(result.current.entry).toBeNull());
    await expect(
      result.current.setSettings(entryFx("bad name!"))
    ).rejects.toBeInstanceOf(CodexConsumerSettingsError);
  });
});
