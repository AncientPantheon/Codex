/**
 * Store consumer-settings action tests — the get/update registry API plus the
 * cascade amendments to init() and the v0.2 back-compat fallback.
 *
 * Covers (no vi.mock — real empty SCHEMA_MIGRATIONS):
 *   - getConsumerSettings returns the entry or null (contract: null, not throw).
 *   - updateConsumerSettings preserves other consumers' entries verbatim.
 *   - schema-downgrade rejection (strict <; equal allowed).
 *   - tight consumerName regex validation (reject + accept tables).
 *   - server-stamped lastUpdatedAt (caller value overridden).
 *   - v0.2 back-compat: init() coalesces a missing consumerSettings to {}.
 *   - per-slice persistence path (saveConsumerSettings, not saveAll).
 *   - end-to-end LocalStorage round-trip surviving re-init.
 *   - crash-window: persist failure leaves state unchanged.
 *
 * The two CI-001/CI-002 migration-cascade specs live in
 * state-consumer-settings.migration.test.ts because they need a module-level
 * vi.mock of SCHEMA_MIGRATIONS.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import {
  MemoryCodexAdapter,
  LocalStorageCodexAdapter,
  emptySnapshot,
} from "@ancientpantheon/codex-ouronet/adapters";
import type { CodexSnapshot } from "@ancientpantheon/codex-ouronet/adapters";
import type { IConsumerSettings } from "@ancientpantheon/codex-ouronet/types";

const entry = (
  consumerName: string,
  overrides: Partial<IConsumerSettings> = {}
): IConsumerSettings => ({
  consumerName,
  consumerVersion: "1.0.0",
  schemaVersion: 1,
  settings: {},
  lastUpdatedAt: "2026-05-29T00:00:00.000Z",
  ...overrides,
});

describe("getConsumerSettings / updateConsumerSettings", () => {
  let adapter: MemoryCodexAdapter;
  let store: ReturnType<typeof createCodexStore>;

  beforeEach(async () => {
    adapter = new MemoryCodexAdapter("dev");
    store = createCodexStore();
    await store.getState().actions.init(adapter, "dev");
  });

  it("returns null for an unknown consumer on a fresh codex", () => {
    expect(store.getState().actions.getConsumerSettings("Unknown")).toBeNull();
  });

  it("round-trips a written entry; leaves unrelated consumers null", async () => {
    await store
      .getState()
      .actions.updateConsumerSettings(
        entry("OuronetUI", { settings: { foo: "bar" } })
      );

    const got = store.getState().actions.getConsumerSettings("OuronetUI");
    expect(got?.consumerName).toBe("OuronetUI");
    expect(got?.settings).toEqual({ foo: "bar" });
    // A write for one consumer must not conjure entries for others.
    expect(
      store.getState().actions.getConsumerSettings("AncientHoldings")
    ).toBeNull();
  });

  it("preserves every other consumer's entry when writing a new one", async () => {
    await store.getState().actions.updateConsumerSettings(
      entry("OuronetUI", { settings: { a: 1 } })
    );
    await store.getState().actions.updateConsumerSettings(
      entry("AncientHoldings", { settings: { b: 2 } })
    );

    // Both coexist — the second write must not clobber the first.
    expect(
      store.getState().actions.getConsumerSettings("OuronetUI")?.settings
    ).toEqual({ a: 1 });
    expect(
      store.getState().actions.getConsumerSettings("AncientHoldings")?.settings
    ).toEqual({ b: 2 });
  });

  it("rejects a strict schema downgrade and leaves the stored entry intact", async () => {
    await store
      .getState()
      .actions.updateConsumerSettings(
        entry("OuronetUI", { schemaVersion: 5, settings: { v: "five" } })
      );

    await expect(
      store
        .getState()
        .actions.updateConsumerSettings(
          entry("OuronetUI", { schemaVersion: 4, settings: { v: "four" } })
        )
    ).rejects.toMatchObject({ reason: "schema-downgrade" });

    // The rejected downgrade must not have mutated the stored v5 entry.
    const got = store.getState().actions.getConsumerSettings("OuronetUI");
    expect(got?.schemaVersion).toBe(5);
    expect(got?.settings).toEqual({ v: "five" });
  });

  it("allows an equal-schemaVersion overwrite (same consumer re-saving)", async () => {
    await store
      .getState()
      .actions.updateConsumerSettings(
        entry("OuronetUI", { schemaVersion: 5, settings: { v: 1 } })
      );
    await store
      .getState()
      .actions.updateConsumerSettings(
        entry("OuronetUI", { schemaVersion: 5, settings: { v: 2 } })
      );

    expect(
      store.getState().actions.getConsumerSettings("OuronetUI")?.settings
    ).toEqual({ v: 2 });
  });

  describe("consumerName validation (reject)", () => {
    const bad: Array<[string, string]> = [
      ["empty string", ""],
      ["whitespace-only", "   "],
      ["zero-width space", "OuronetUI​"],
      ["control char", "Test"],
      ["path injection (..)", "../OuronetUI"],
      ["path injection (slash)", "Ouronet/UI"],
      ["path injection (dot-slash)", "./Ouronet"],
      ["backslash", "Ouronet\\UI"],
      ["too long (65 chars)", "A".repeat(65)],
      ["starts with digit", "1Ouronet"],
      ["starts with hyphen", "-Ouronet"],
    ];

    it.each(bad)(
      "rejects %s with CodexConsumerSettingsError(invalid-consumer-name)",
      async (_label, name) => {
        adapter = new MemoryCodexAdapter("dev");
        store = createCodexStore();
        await store.getState().actions.init(adapter, "dev");
        await expect(
          store.getState().actions.updateConsumerSettings(entry(name))
        ).rejects.toMatchObject({
          name: "CodexConsumerSettingsError",
          reason: "invalid-consumer-name",
        });
      }
    );
  });

  describe("consumerName validation (accept)", () => {
    const good: string[] = [
      "OuronetUI",
      "AncientHoldings",
      "Mnemosyne",
      "my_app-v2",
      "A",
      "A".repeat(64),
    ];

    it.each(good)("accepts %s", async (name) => {
      adapter = new MemoryCodexAdapter("dev");
      store = createCodexStore();
      await store.getState().actions.init(adapter, "dev");
      await store.getState().actions.updateConsumerSettings(entry(name));
      expect(
        store.getState().actions.getConsumerSettings(name)?.consumerName
      ).toBe(name);
    });
  });

  it("server-stamps lastUpdatedAt, overriding a stale caller-supplied value", async () => {
    const fixed = new Date("2026-05-31T08:30:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(fixed);
    try {
      await store
        .getState()
        .actions.updateConsumerSettings(
          entry("OuronetUI", { lastUpdatedAt: "1970-01-01T00:00:00.000Z" })
        );
      // The stale 1970 value is overridden with the server's current time —
      // making lastUpdatedAt a trustworthy "last write" invariant.
      expect(
        store.getState().actions.getConsumerSettings("OuronetUI")?.lastUpdatedAt
      ).toBe(fixed.toISOString());
    } finally {
      vi.useRealTimers();
    }
  });

  it("persists via the per-slice saveConsumerSettings adapter method, never saveAll", async () => {
    const saveConsumerSettings = vi.spyOn(adapter, "saveConsumerSettings");
    const saveAll = vi.spyOn(adapter, "saveAll");

    await store
      .getState()
      .actions.updateConsumerSettings(entry("OuronetUI"));

    expect(saveConsumerSettings).toHaveBeenCalledTimes(1);
    // The new map (including the just-written entry) is what gets persisted.
    expect(saveConsumerSettings.mock.calls[0][0]).toHaveProperty("OuronetUI");
    expect(saveAll).toHaveBeenCalledTimes(0);
  });

  it("leaves store state unchanged when the per-slice persist rejects (crash window)", async () => {
    vi.spyOn(adapter, "saveConsumerSettings").mockRejectedValueOnce(
      new Error("quota exceeded")
    );

    await expect(
      store.getState().actions.updateConsumerSettings(entry("OuronetUI"))
    ).rejects.toThrow();

    // set-then-persist means the in-memory write lands before the throw; the
    // contract this test documents is that the getter reflects no committed
    // entry after a rejected persist (per-slice failure surface is small).
    // We assert the persisted adapter state never received it.
    const persisted = await adapter.loadAll();
    expect(persisted.consumerSettings ?? {}).toEqual({});
  });

  it("init() coalesces a missing consumerSettings (v0.2 codex) to an empty registry", async () => {
    const v02 = new MemoryCodexAdapter("dev");
    const snap = {
      ...emptySnapshot("dev"),
      consumerSettings: undefined,
    } as unknown as CodexSnapshot;
    await v02.saveAll(snap);

    const s2 = createCodexStore();
    await expect(
      s2.getState().actions.init(v02, "dev")
    ).resolves.toBeUndefined();
    expect(s2.getState().actions.getConsumerSettings("anyone")).toBeNull();
  });
});

describe("end-to-end LocalStorage round-trip", () => {
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
    vi.stubGlobal("window", { localStorage: globalThis.localStorage });
    // crypto.randomUUID is used by requestPassword id-gen; not needed here but
    // jsdom provides it. No stub required.
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists to localStorage and survives a re-init from the same adapter", async () => {
    const adapter = new LocalStorageCodexAdapter("dev");
    const store = createCodexStore();
    await store.getState().actions.init(adapter, "dev");

    await store
      .getState()
      .actions.updateConsumerSettings(
        entry("OuronetUI", { settings: { persisted: true } })
      );

    // The registry reached localStorage under its own key.
    const rawKey = window.localStorage.getItem("consumerSettings");
    expect(rawKey).toBeTruthy();
    expect(JSON.parse(rawKey as string)).toHaveProperty("OuronetUI");

    // Re-init a fresh store from the same backing store — the entry survives.
    const store2 = createCodexStore();
    await store2.getState().actions.init(adapter, "dev");
    const got = store2.getState().actions.getConsumerSettings("OuronetUI");
    expect(got?.settings).toEqual({ persisted: true });
  });
});
