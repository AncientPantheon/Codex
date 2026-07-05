/**
 * RED-then-GREEN tests for the two GENERIC reference codex adapters.
 *
 * codex-core ships two chain-agnostic reference implementations of the generic
 * `CodexAdapter<TSnapshot, TUiSettings>` seam:
 *
 *   - `MemoryCodexAdapter` — the SSR/test reference impl: a pure `structuredClone`
 *     round-trip over an in-memory snapshot, with the encrypted-UI-settings sidecar
 *     kept as an in-memory slot. No Ouronet types, no crypto.
 *   - `LocalStorageCodexAdapter` — a GENERIC key-sharded storage adapter over an
 *     injected `StorageLike` seam (so core stays DOM-lib-free), with the sidecar
 *     encrypted through an injected `CryptoSeam` (so core imports no real crypto).
 *
 * These tests pin the BRANCHING logic that is TDD-required: the absent-storage
 * guard, the corrupt-JSON parse fallback, the sidecar encrypt/decrypt round-trip
 * through the injected seam, the sharded `clearAll` key-sweep, and the round-trip
 * fidelity of both adapters against a synthetic generic snapshot.
 *
 * RED: `MemoryCodexAdapter` / `LocalStorageCodexAdapter` are not exported from
 * `../src/adapters` yet, so this file fails to import until T7.5's GREEN lands them.
 */

import { describe, it, expect } from "vitest";
import {
  MemoryCodexAdapter,
  LocalStorageCodexAdapter,
  emptySnapshotBase,
  assertCodexAdapter,
  type CodexSnapshotBase,
  type StorageLike,
} from "../src/adapters/index.js";
import type { CryptoSeam } from "../src/vault/index.js";
import { CodexAdapterError } from "../src/codex/errors.js";

/**
 * A synthetic consumer snapshot: the generic base plus an opaque chain-specific
 * payload slot. Core never names `widgets` — it rides in the opaque JSON blob a
 * consumer persists, proving the adapters are Ouronet-free.
 */
interface TestSnapshot extends CodexSnapshotBase {
  widgets: Array<{ id: string; label: string }>;
}

/** A test UI-settings payload the sidecar carries opaquely. */
interface TestUiSettings {
  theme: "light" | "dark";
  locale: string;
}

function makeTestSnapshot(): TestSnapshot {
  return {
    ...emptySnapshotBase("main"),
    schemaVersion: 3,
    lastUpdatedAt: "2026-07-04T00:00:00.000Z",
    widgets: [
      { id: "w1", label: "alpha" },
      { id: "w2", label: "beta" },
    ],
  };
}

/**
 * A test-only `CryptoSeam` that "encrypts" by reversing the string and tagging it
 * with the key, so a test can assert (a) the stored sidecar is NOT plaintext and
 * (b) it round-trips back through `decrypt`. It is deliberately NOT real crypto —
 * the point is that core delegates to whatever seam the caller injects.
 */
function makeFakeSeam(): CryptoSeam {
  const tag = "enc::";
  return {
    encrypt(plaintext: string, key: string): string {
      return `${tag}${key}::${[...plaintext].reverse().join("")}`;
    },
    decrypt(ciphertext: string, key: string): string {
      const prefix = `${tag}${key}::`;
      if (!ciphertext.startsWith(prefix)) {
        throw new Error("bad ciphertext");
      }
      return [...ciphertext.slice(prefix.length)].reverse().join("");
    },
  };
}

/** A Map-backed in-memory `StorageLike` stub — a fake `localStorage`. */
function makeFakeStorage(): StorageLike & { size: () => number } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
    size: () => map.size,
  };
}

describe("MemoryCodexAdapter (generic reference)", () => {
  it("conforms to CodexAdapter — assertCodexAdapter accepts it", () => {
    const adapter = new MemoryCodexAdapter<TestSnapshot, TestUiSettings>();
    // A conforming adapter passes the runtime guard without throwing; a broken
    // adapter would surface as a CodexAdapterError here.
    expect(() => assertCodexAdapter(adapter)).not.toThrow();
    expect(adapter.name).toBe("memory");
  });

  it("round-trips a snapshot deep-equal via save then load (structuredClone)", async () => {
    const adapter = new MemoryCodexAdapter<TestSnapshot, TestUiSettings>();
    const snapshot = makeTestSnapshot();
    await adapter.saveAll(snapshot);
    const loaded = await adapter.loadAll();
    expect(loaded).toEqual(snapshot);
  });

  it("returns a defensive copy so a caller cannot mutate internal state", async () => {
    const adapter = new MemoryCodexAdapter<TestSnapshot, TestUiSettings>();
    await adapter.saveAll(makeTestSnapshot());
    const first = await adapter.loadAll();
    first.widgets.push({ id: "w3", label: "gamma" });
    const second = await adapter.loadAll();
    // The mutation of the returned copy must NOT bleed into the stored snapshot.
    expect(second.widgets).toHaveLength(2);
  });

  it("touch stamps lastUpdatedAt and lastUpdatedDevice on the stored snapshot", async () => {
    const adapter = new MemoryCodexAdapter<TestSnapshot, TestUiSettings>();
    await adapter.saveAll(makeTestSnapshot());
    const result = await adapter.touch("dev");
    expect(result.lastUpdatedDevice).toBe("dev");
    expect(typeof result.lastUpdatedAt).toBe("string");
    const loaded = await adapter.loadAll();
    expect(loaded.lastUpdatedDevice).toBe("dev");
    expect(loaded.lastUpdatedAt).toBe(result.lastUpdatedAt);
  });

  it("get/setSchemaVersion reads back the written version", async () => {
    const adapter = new MemoryCodexAdapter<TestSnapshot, TestUiSettings>();
    await adapter.setSchemaVersion(7);
    expect(await adapter.getSchemaVersion()).toBe(7);
  });

  it("sidecar save then load round-trips the UI settings; unset reads null", async () => {
    const adapter = new MemoryCodexAdapter<TestSnapshot, TestUiSettings>();
    expect(await adapter.loadUiSettingsEncrypted()).toBeNull();
    const settings: TestUiSettings = { theme: "dark", locale: "en" };
    await adapter.saveUiSettingsEncrypted(settings);
    expect(await adapter.loadUiSettingsEncrypted()).toEqual(settings);
  });

  it("clearAll empties the snapshot back to a base skeleton and drops the sidecar", async () => {
    const adapter = new MemoryCodexAdapter<TestSnapshot, TestUiSettings>("main");
    await adapter.saveAll(makeTestSnapshot());
    await adapter.saveUiSettingsEncrypted({ theme: "dark", locale: "en" });
    await adapter.clearAll();
    const loaded = await adapter.loadAll();
    expect(loaded.schemaVersion).toBe(0);
    expect(loaded.lastUpdatedAt).toBeNull();
    expect(loaded.lastUpdatedDevice).toBe("main");
    expect(await adapter.loadUiSettingsEncrypted()).toBeNull();
  });
});

describe("LocalStorageCodexAdapter (generic key-sharded reference)", () => {
  function makeAdapter(
    over: Partial<{
      storage: StorageLike;
      seam: CryptoSeam;
      key: string;
      device: "dev" | "main";
    }> = {},
  ): LocalStorageCodexAdapter<TestSnapshot, TestUiSettings> {
    return new LocalStorageCodexAdapter<TestSnapshot, TestUiSettings>({
      storage: over.storage ?? makeFakeStorage(),
      cryptoSeam: over.seam ?? makeFakeSeam(),
      cryptoKey: over.key ?? "CK",
      deviceVariant: over.device ?? "dev",
    });
  }

  it("conforms to CodexAdapter — assertCodexAdapter accepts it", () => {
    const adapter = makeAdapter();
    expect(() => assertCodexAdapter(adapter)).not.toThrow();
    expect(adapter.name).toBe("localStorage");
  });

  it("throws CodexAdapterError when no storage is available", async () => {
    const adapter = new LocalStorageCodexAdapter<TestSnapshot, TestUiSettings>({
      storage: null,
      cryptoSeam: makeFakeSeam(),
      cryptoKey: "CK",
      deviceVariant: "dev",
    });
    await expect(adapter.loadAll()).rejects.toBeInstanceOf(CodexAdapterError);
  });

  it("round-trips the sharded snapshot (base fields + opaque payload) via save then load", async () => {
    const storage = makeFakeStorage();
    const adapter = makeAdapter({ storage });
    const snapshot = makeTestSnapshot();
    await adapter.saveAll(snapshot);
    const loaded = await adapter.loadAll();
    expect(loaded.schemaVersion).toBe(3);
    expect(loaded.lastUpdatedAt).toBe("2026-07-04T00:00:00.000Z");
    expect(loaded.lastUpdatedDevice).toBe("main");
    expect(loaded.widgets).toEqual(snapshot.widgets);
  });

  it("returns a default base snapshot when storage is empty (never-persisted codex)", async () => {
    const adapter = makeAdapter({ device: "main" });
    const loaded = await adapter.loadAll();
    expect(loaded.schemaVersion).toBe(0);
    expect(loaded.lastUpdatedAt).toBeNull();
    expect(loaded.lastUpdatedDevice).toBe("main");
  });

  it("falls back to defaults on corrupt JSON in the payload slot instead of throwing", async () => {
    const storage = makeFakeStorage();
    const adapter = makeAdapter({ storage });
    await adapter.saveAll(makeTestSnapshot());
    // Simulate third-party tampering / a partial-write crash on the payload blob.
    storage.setItem("codex_payload", "{ this is not json");
    const loaded = await adapter.loadAll();
    // The corrupt payload degrades to the empty opaque object, not a throw.
    expect(loaded.widgets).toBeUndefined();
    // Base metadata (stored under separate keys) still loads intact.
    expect(loaded.schemaVersion).toBe(3);
  });

  it("touch persists lastUpdatedAt and device to the sharded keys", async () => {
    const storage = makeFakeStorage();
    const adapter = makeAdapter({ storage });
    const result = await adapter.touch("main");
    expect(result.lastUpdatedDevice).toBe("main");
    const loaded = await adapter.loadAll();
    expect(loaded.lastUpdatedAt).toBe(result.lastUpdatedAt);
    expect(loaded.lastUpdatedDevice).toBe("main");
  });

  it("get/setSchemaVersion round-trips through the sharded schema-version key", async () => {
    const adapter = makeAdapter();
    await adapter.setSchemaVersion(5);
    expect(await adapter.getSchemaVersion()).toBe(5);
  });

  it("sidecar encrypts via the injected seam (ciphertext stored, not plaintext) and decrypts on load", async () => {
    const storage = makeFakeStorage();
    const seam = makeFakeSeam();
    const adapter = makeAdapter({ storage, seam, key: "CK" });
    const settings: TestUiSettings = { theme: "dark", locale: "fr" };
    await adapter.saveUiSettingsEncrypted(settings);

    // The persisted sidecar must be ciphertext produced by the injected seam,
    // NOT the plaintext JSON — proving the adapter delegates encryption to it.
    const stored = storage.getItem("codex_ui_settings_enc");
    expect(stored).not.toBeNull();
    expect(stored).not.toContain("dark");
    expect(stored).toContain("enc::CK::");

    // And it round-trips back through the injected decrypt.
    expect(await adapter.loadUiSettingsEncrypted()).toEqual(settings);
  });

  it("sidecar load returns null when nothing has been encrypted yet", async () => {
    const adapter = makeAdapter();
    expect(await adapter.loadUiSettingsEncrypted()).toBeNull();
  });

  it("clearAll sweeps every configured sharded key", async () => {
    const storage = makeFakeStorage();
    const adapter = makeAdapter({ storage });
    await adapter.saveAll(makeTestSnapshot());
    await adapter.saveUiSettingsEncrypted({ theme: "light", locale: "en" });
    expect(storage.size()).toBeGreaterThan(0);
    await adapter.clearAll();
    expect(storage.size()).toBe(0);
  });

  it("honors a custom key map so a consumer can re-shard onto its own key names", async () => {
    const storage = makeFakeStorage();
    const adapter = new LocalStorageCodexAdapter<TestSnapshot, TestUiSettings>({
      storage,
      cryptoSeam: makeFakeSeam(),
      cryptoKey: "CK",
      deviceVariant: "dev",
      keys: { schemaVersion: "mych_ver", payload: "mych_blob" },
    });
    await adapter.setSchemaVersion(9);
    // The custom key is where the value lands — proving the map is honored.
    expect(storage.getItem("mych_ver")).toBe("9");
    expect(await adapter.getSchemaVersion()).toBe(9);
  });
});
