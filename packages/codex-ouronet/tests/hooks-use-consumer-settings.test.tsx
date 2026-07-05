/**
 * useConsumerSettings(name) — thin per-consumer hook over the consumerSettings
 * registry slice + the updateConsumerSettings action.
 *
 * entry is the named consumer's IConsumerSettings (or null when absent) read
 * from a subscription to s.consumerSettings, so a write re-renders the hook.
 * setSettings is the store action verbatim — it validates (name shape,
 * schema-downgrade) and server-stamps lastUpdatedAt. These specs pin
 * per-name selection, re-render-on-write, slot isolation, and error
 * propagation, not the validation internals (covered in the state tests).
 */

import * as React from "react";
import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import {
  MemoryCodexAdapter,
  emptySnapshot,
} from "@ancientpantheon/codex-ouronet/adapters";
import { useConsumerSettings } from "@ancientpantheon/codex-ouronet/hooks";
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
    <CodexProvider adapter={adapter}>{children}</CodexProvider>
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
      await result.current.setSettings(entryFx("Mnemosyne", { schemaVersion: 2 }));
    });

    expect(result.current.entry?.consumerName).toBe("Mnemosyne");
    expect(result.current.entry?.schemaVersion).toBe(2);
    // lastUpdatedAt is server-stamped by the action (caller value overridden).
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
    // The pre-existing OuronetUI slot is untouched by the Mnemosyne write.
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
