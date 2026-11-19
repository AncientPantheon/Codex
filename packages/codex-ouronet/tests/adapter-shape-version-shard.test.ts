/**
 * Codex_Shape_Version-shard round-trip — the SAME omission class as FIX-1's
 * dropped `foreignKeys` shard (see adapter-foreignkeys-shard.test.ts), found
 * while chasing the owner's incident: "i loaded a codex, upgraded it, then
 * exported it. It is now versioned. I loaded again, it still says its not
 * versioned."
 *
 * The Ouronet `LocalStorageCodexAdapter` overrides `saveAll`/`loadAll` wholesale,
 * enumerating its own FIXED key inventory rather than delegating to the D3
 * generic's opaque-payload-blob sharding. That generic carries any unknown
 * snapshot field for free (everything outside BASE_FIELDS rides in the blob) —
 * this subclass does not: a field it does not name is a field it silently drops.
 * `Codex_Shape_Version` was not named, so the migration engine's success stamp
 * never survived a browser reload and an already-migrated codex kept presenting
 * itself as unmigrated.
 *
 * Driven against a FAKE in-memory `StorageLike` for the reason FIX-1 documents:
 * `MemoryCodexAdapter`'s `structuredClone` whole-snapshot round-trip would carry
 * the stamp regardless of the sharding logic and false-pass this exact gap.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  LocalStorageCodexAdapter,
  emptySnapshot,
  type CodexSnapshot,
} from "@ancientpantheon/codex-ouronet/adapters";
import { DEFAULT_UI_SETTINGS } from "@ancientpantheon/codex-ouronet/types";

/** Map-backed `localStorage` stand-in (mirrors FIX-1's seam). */
function makeFakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => {
      map.clear();
    },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

const snapshotStamped = (stamp: string | undefined): CodexSnapshot => ({
  ...emptySnapshot("dev"),
  uiSettings: { ...DEFAULT_UI_SETTINGS },
  schemaVersion: 3,
  lastUpdatedAt: "2026-10-27T11:00:40.654Z",
  Codex_Shape_Version: stamp,
});

describe("LocalStorageCodexAdapter — Codex_Shape_Version shard round-trip", () => {
  let realLocalStorage: Storage | undefined;

  beforeEach(() => {
    realLocalStorage = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      value: makeFakeStorage(),
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: realLocalStorage,
      configurable: true,
      writable: true,
    });
  });

  it("persists Codex_Shape_Version through saveAll→loadAll (owner incident: an upgraded codex reloads as 'not versioned')", async () => {
    const adapter = new LocalStorageCodexAdapter("dev");

    await adapter.saveAll(snapshotStamped("1.0.0"));
    const loaded = await adapter.loadAll();

    expect(loaded.Codex_Shape_Version).toBe("1.0.0");
  });

  it("reports an unstamped codex as undefined when nothing was ever persisted (legacy codex, migration must still run)", async () => {
    const adapter = new LocalStorageCodexAdapter("dev");

    const loaded = await adapter.loadAll();

    expect(loaded.Codex_Shape_Version).toBeUndefined();
  });

  it("CLEARS a previously-stored stamp when an unstamped snapshot is saved over it", async () => {
    // Deliberately the OPPOSITE discipline to the funds-critical `arweaveSeeds`
    // shard (absent field → leave stored bytes untouched, because nothing can
    // reconstruct a lost seed). This stamp is not a secret, it is a CLAIM ABOUT
    // THE SHAPE of the data now stored. Keeping a stale claim over freshly
    // written legacy-shaped data would mark unmigrated data as migrated and make
    // the structural upgrade skip the very codex that needs it. Re-running an
    // idempotent, postcondition-checked migration is the strictly cheaper error.
    const adapter = new LocalStorageCodexAdapter("dev");

    await adapter.saveAll(snapshotStamped("1.0.0"));
    await adapter.saveAll(snapshotStamped(undefined));
    const loaded = await adapter.loadAll();

    expect(loaded.Codex_Shape_Version).toBeUndefined();
  });

  it("clearAll removes the stamp (a wiped codex must not reload as versioned)", async () => {
    const adapter = new LocalStorageCodexAdapter("dev");

    await adapter.saveAll(snapshotStamped("1.0.0"));
    await adapter.clearAll();
    const loaded = await adapter.loadAll();

    expect(loaded.Codex_Shape_Version).toBeUndefined();
  });
});
