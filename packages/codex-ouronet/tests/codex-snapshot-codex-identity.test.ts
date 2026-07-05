/**
 * CodexSnapshot.codexIdentity field + per-slice adapter persistence tests.
 *
 * Pins the storage contract Phase 3's store getter (T3.3) reads through:
 *   - emptySnapshot() leaves codexIdentity undefined (a VALUE type, not a
 *     registry container — contrasts with consumerSettings which is {}).
 *   - MemoryCodexAdapter round-trips a populated identity verbatim via the new
 *     saveCodexIdentity per-slice method, and clears it on undefined.
 *   - LocalStorageCodexAdapter shards the identity to its own localStorage key
 *     and reads it back verbatim — the spec that catches the per-key sharding
 *     the MemoryCodexAdapter's structuredClone masks (without a per-slice
 *     adapter method, LocalStorage would silently drop the field).
 *   - LocalStorage loadAll hardens JSON.parse: malformed / non-object values
 *     resolve to undefined (no throw), so corrupted storage can't crash init
 *     nor falsely satisfy a downstream truthy presence check.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  MemoryCodexAdapter,
  LocalStorageCodexAdapter,
  emptySnapshot,
} from "@ancientpantheon/codex-ouronet/adapters";
import type { ICodexIdentity } from "@ancientpantheon/codex-ouronet/types";

const populatedIdentity = (): ICodexIdentity => ({
  formatted: "₱.STANDARD:Π.SMART",
  standardPublicKey: "S".repeat(160),
  smartPublicKey: "Z".repeat(160),
  encryptedSeedWords: "enc-seed-words",
  encryptedStandardBitstring: "enc-std-bits",
  encryptedSmartBitstring: "enc-smart-bits",
  encryptedStandardBase10: "enc-std-b10",
  encryptedSmartBase10: "enc-smart-b10",
  encryptedStandardBase49: "enc-std-b49",
  encryptedSmartBase49: "enc-smart-b49",
  totalWordCount: 12,
  splitIndex: 6,
  createdAt: "2026-05-29T00:00:00.000Z",
});

describe("emptySnapshot codexIdentity", () => {
  it("leaves codexIdentity undefined (value type, not a {} container)", () => {
    const snap = emptySnapshot("dev");
    // A value-typed slot has no concrete empty state — undefined is the resting
    // value. null or {} would be wrong: the getter coalesces undefined to null
    // at the public boundary, and {} would be a malformed identity.
    expect(snap.codexIdentity).toBeUndefined();
    expect(snap.codexIdentity).not.toBeNull();
    expect(snap.codexIdentity).not.toEqual({});
  });
});

describe("MemoryCodexAdapter codexIdentity round-trip", () => {
  it("saveCodexIdentity writes the identity; loadAll reads it back verbatim", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const identity = populatedIdentity();

    await adapter.saveCodexIdentity(identity);
    const loaded = await adapter.loadAll();

    expect(loaded.codexIdentity).toEqual(identity);
  });

  it("saveCodexIdentity(undefined) clears a previously-written identity", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    await adapter.saveCodexIdentity(populatedIdentity());
    await adapter.saveCodexIdentity(undefined);
    const loaded = await adapter.loadAll();
    // undefined-clear must yield strictly undefined, not a deep-cloned undefined
    // wrapper nor a stale prior identity.
    expect(loaded.codexIdentity).toBeUndefined();
  });
});

describe("LocalStorageCodexAdapter codexIdentity round-trip", () => {
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saveCodexIdentity shards to its own key; loadAll reads it back verbatim", async () => {
    const adapter = new LocalStorageCodexAdapter("dev");
    const identity = populatedIdentity();

    await adapter.saveCodexIdentity(identity);

    // The identity is sharded to its own key as JSON — proves the per-slice
    // write reaches localStorage (the failure mode this spec exists to catch).
    expect(window.localStorage.getItem("codexIdentity")).toBe(
      JSON.stringify(identity)
    );

    const loaded = await adapter.loadAll();
    expect(loaded.codexIdentity).toEqual(identity);
  });

  it("saveAll fans out codexIdentity to its localStorage key", async () => {
    const adapter = new LocalStorageCodexAdapter("dev");
    const identity = populatedIdentity();

    await adapter.saveAll({ ...emptySnapshot("dev"), codexIdentity: identity });

    expect(window.localStorage.getItem("codexIdentity")).toBe(
      JSON.stringify(identity)
    );
    const loaded = await adapter.loadAll();
    expect(loaded.codexIdentity).toEqual(identity);
  });

  it("loadAll returns undefined when no codexIdentity key is set (v0.2 back-compat)", async () => {
    const adapter = new LocalStorageCodexAdapter("dev");
    const loaded = await adapter.loadAll();
    expect(loaded.codexIdentity).toBeUndefined();
  });

  it("loadAll treats malformed JSON as absent (undefined, no throw)", async () => {
    const adapter = new LocalStorageCodexAdapter("dev");
    const malformed = ["{not valid json", "", "undefined", '{"formatted":'];
    for (const bad of malformed) {
      window.localStorage.setItem("codexIdentity", bad);
      const loaded = await adapter.loadAll();
      // Corrupted storage (tampering, partial-write crash) must not crash init
      // nor surface a half-parsed value — it reads as absent.
      expect(loaded.codexIdentity).toBeUndefined();
    }
  });

  it("loadAll rejects non-object JSON values (scalars and arrays) as absent", async () => {
    const adapter = new LocalStorageCodexAdapter("dev");
    const nonObjects = ["123", "true", '"hello"', "[1,2,3]"];
    for (const bad of nonObjects) {
      window.localStorage.setItem("codexIdentity", bad);
      const loaded = await adapter.loadAll();
      // A bare number/string/bool/array is not an ICodexIdentity; the shape
      // guard rejects it so a downstream truthy presence check can't be fooled.
      expect(loaded.codexIdentity).toBeUndefined();
    }
  });
});
