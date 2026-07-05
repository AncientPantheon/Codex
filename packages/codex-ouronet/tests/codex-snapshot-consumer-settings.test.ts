/**
 * CodexSnapshot.consumerSettings field + per-slice adapter persistence tests.
 *
 * Pins the storage contract Phase 2's store action (T2.3) writes through:
 *   - emptySnapshot() initializes consumerSettings to an empty registry ({}),
 *     NOT undefined, so a fresh codex has a concrete container.
 *   - MemoryCodexAdapter round-trips the registry verbatim via the new
 *     saveConsumerSettings per-slice method AND via saveAll.
 *   - LocalStorageCodexAdapter shards the registry to its own localStorage key
 *     and reads it back verbatim — this is the spec that catches the per-key
 *     sharding the MemoryCodexAdapter's structuredClone masks (without a
 *     per-slice adapter method, LocalStorage would silently drop the field).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  MemoryCodexAdapter,
  LocalStorageCodexAdapter,
  emptySnapshot,
} from "@ancientpantheon/codex-ouronet/adapters";
import type { IConsumerSettings } from "@ancientpantheon/codex-ouronet/types";

const populatedRegistry = (): Record<string, IConsumerSettings> => ({
  OuronetUI: {
    consumerName: "OuronetUI",
    consumerVersion: "1.0.0",
    schemaVersion: 1,
    settings: { theme: "dark", zbomProfile: "fast" },
    lastUpdatedAt: "2026-05-29T00:00:00.000Z",
  },
  AncientHoldings: {
    consumerName: "AncientHoldings",
    consumerVersion: "2.3.1",
    schemaVersion: 4,
    settings: { ledgerMode: "hardware" },
    lastUpdatedAt: "2026-05-30T12:00:00.000Z",
  },
});

describe("emptySnapshot consumerSettings", () => {
  it("initializes consumerSettings to an empty registry, not undefined", () => {
    const snap = emptySnapshot("dev");
    // A registry container's empty state is {} — concrete, so callers can spread
    // into it without a null-guard. undefined would force every reader to coalesce.
    expect(snap.consumerSettings).toEqual({});
    expect(snap.consumerSettings).not.toBeUndefined();
  });
});

describe("MemoryCodexAdapter consumerSettings round-trip", () => {
  it("saveConsumerSettings writes the registry; loadAll reads it back verbatim", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const reg = populatedRegistry();

    await adapter.saveConsumerSettings(reg);
    const loaded = await adapter.loadAll();

    expect(loaded.consumerSettings).toEqual(reg);
  });

  it("saveAll persists consumerSettings as part of the full snapshot", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const reg = populatedRegistry();

    await adapter.saveAll({ ...emptySnapshot("dev"), consumerSettings: reg });
    const loaded = await adapter.loadAll();

    expect(loaded.consumerSettings).toEqual(reg);
  });
});

describe("LocalStorageCodexAdapter consumerSettings round-trip", () => {
  // Minimal Map-backed localStorage mock — enough surface for the adapter.
  function makeLocalStorageMock(): Storage {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
      setItem: (k: string, v: string) => void m.set(k, String(v)),
      removeItem: (k: string) => void m.delete(k),
      clear: () => m.clear(),
      key: (i: number) => Array.from(m.keys())[i] ?? null,
      get length() {
        return m.size;
      },
    } as Storage;
  }

  beforeEach(() => {
    vi.stubGlobal("localStorage", makeLocalStorageMock());
    // The adapter reads `window.localStorage` directly; stub window too.
    vi.stubGlobal("window", { localStorage: globalThis.localStorage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saveConsumerSettings writes a consumerSettings localStorage key, loadAll reads it back verbatim", async () => {
    const adapter = new LocalStorageCodexAdapter("dev");
    const reg = populatedRegistry();

    await adapter.saveConsumerSettings(reg);

    // The registry is sharded to its own key as JSON — proves the per-slice
    // write reaches localStorage (the failure mode this spec exists to catch).
    expect(window.localStorage.getItem("consumerSettings")).toBe(
      JSON.stringify(reg)
    );

    const loaded = await adapter.loadAll();
    expect(loaded.consumerSettings).toEqual(reg);
  });

  it("saveAll fans out consumerSettings to its localStorage key", async () => {
    const adapter = new LocalStorageCodexAdapter("dev");
    const reg = populatedRegistry();

    await adapter.saveAll({ ...emptySnapshot("dev"), consumerSettings: reg });

    expect(window.localStorage.getItem("consumerSettings")).toBe(
      JSON.stringify(reg)
    );
    const loaded = await adapter.loadAll();
    expect(loaded.consumerSettings).toEqual(reg);
  });

  it("loadAll returns an empty registry when no consumerSettings key is set (v0.2 back-compat)", async () => {
    const adapter = new LocalStorageCodexAdapter("dev");
    const loaded = await adapter.loadAll();
    expect(loaded.consumerSettings).toEqual({});
  });
});
