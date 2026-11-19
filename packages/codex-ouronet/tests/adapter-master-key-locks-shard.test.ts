/**
 * masterKeyLocks-shard round trip — the SAME omission class as the dropped
 * `foreignKeys` shard (FIX-1) and the dropped `Codex_Shape_Version` stamp
 * (the owner's "upgraded it, exported it, loaded it again, still says it's
 * not versioned" incident).
 *
 * This one is funds-adjacent in a way those were not: a codex that forgets
 * its locks on reload silently re-permits deleting the very key position its
 * Codex Ouronet Master pays with. The lock is only a guarantee if it
 * survives a round trip.
 *
 * Driven against a FAKE in-memory `StorageLike` for the reason FIX-1
 * documents: `MemoryCodexAdapter`'s `structuredClone` whole-snapshot round
 * trip would carry the registry regardless of the sharding logic and
 * false-pass this exact gap.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  LocalStorageCodexAdapter,
  emptySnapshot,
  type CodexSnapshot,
} from "@ancientpantheon/codex-ouronet/adapters";
import { DEFAULT_UI_SETTINGS } from "@ancientpantheon/codex-ouronet/types";
import type { MasterKeyLock } from "@ancientpantheon/codex-core";

function makeFakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => { map.clear(); },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() { return map.size; },
  } as Storage;
}

const snapshotWithLocks = (masterKeyLocks: MasterKeyLock[] | undefined): CodexSnapshot => ({
  ...emptySnapshot("dev"),
  uiSettings: { ...DEFAULT_UI_SETTINGS },
  schemaVersion: 3,
  lastUpdatedAt: "2026-10-27T11:00:40.654Z",
  masterKeyLocks,
});

const PAYMENT: MasterKeyLock = { seedId: "seed-1", position: 0, reason: "master-payment-key" };
const GUARD: MasterKeyLock = { seedId: "seed-1", position: 1, reason: "master-guard-key" };
/** A custom keyset drawing a key from a DIFFERENT seed — the many-to-many
 *  case a boolean `isPrime` flag could never have expressed. */
const CROSS_SEED: MasterKeyLock = { seedId: "seed-2", position: 7, reason: "master-guard-key" };

describe("LocalStorageCodexAdapter — masterKeyLocks shard round trip", () => {
  let realLocalStorage: Storage | undefined;

  beforeEach(() => {
    realLocalStorage = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      value: makeFakeStorage(), configurable: true, writable: true,
    });
  });
  afterEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: realLocalStorage, configurable: true, writable: true,
    });
  });

  it("persists locks through saveAll→loadAll (a dropped shard silently re-permits deleting the master's payment key)", async () => {
    const adapter = new LocalStorageCodexAdapter("dev");
    await adapter.saveAll(snapshotWithLocks([PAYMENT, GUARD]));
    const loaded = await adapter.loadAll();
    expect(loaded.masterKeyLocks).toEqual([PAYMENT, GUARD]);
  });

  it("round-trips locks spanning MULTIPLE seeds (the custom-keyset case)", async () => {
    const adapter = new LocalStorageCodexAdapter("dev");
    await adapter.saveAll(snapshotWithLocks([PAYMENT, GUARD, CROSS_SEED]));
    const loaded = await adapter.loadAll();
    expect(loaded.masterKeyLocks).toEqual([PAYMENT, GUARD, CROSS_SEED]);
  });

  it("preserves BOTH reasons when one position is locked twice (releasing one must not unlock it)", async () => {
    const adapter = new LocalStorageCodexAdapter("dev");
    const doubly: MasterKeyLock[] = [
      { seedId: "seed-1", position: 1, reason: "master-payment-key" },
      { seedId: "seed-1", position: 1, reason: "master-guard-key" },
    ];
    await adapter.saveAll(snapshotWithLocks(doubly));
    const loaded = await adapter.loadAll();
    expect(loaded.masterKeyLocks).toEqual(doubly);
  });

  it("loads an empty array when nothing was ever persisted (a codex with no master yet)", async () => {
    const adapter = new LocalStorageCodexAdapter("dev");
    const loaded = await adapter.loadAll();
    expect(loaded.masterKeyLocks).toEqual([]);
  });

  it("CLEARS stored locks when an empty registry is saved over them (release must actually release)", async () => {
    const adapter = new LocalStorageCodexAdapter("dev");
    await adapter.saveAll(snapshotWithLocks([PAYMENT]));
    await adapter.saveAll(snapshotWithLocks([]));
    const loaded = await adapter.loadAll();
    expect(loaded.masterKeyLocks).toEqual([]);
  });

  it("leaves stored locks UNTOUCHED when the field is absent (a stale snapshot builder must never silently unlock)", async () => {
    // Same discipline as the funds-critical `arweaveSeeds` shard, and the
    // OPPOSITE of `Codex_Shape_Version`: absence here means "this writer did
    // not know about locks", not "there are no locks". Erasing on absence
    // would let any pre-locks code path quietly strip the guarantee.
    const adapter = new LocalStorageCodexAdapter("dev");
    await adapter.saveAll(snapshotWithLocks([PAYMENT]));
    await adapter.saveAll(snapshotWithLocks(undefined));
    const loaded = await adapter.loadAll();
    expect(loaded.masterKeyLocks).toEqual([PAYMENT]);
  });

  it("clearAll removes the registry (a wiped codex must not reload with locks)", async () => {
    const adapter = new LocalStorageCodexAdapter("dev");
    await adapter.saveAll(snapshotWithLocks([PAYMENT]));
    await adapter.clearAll();
    const loaded = await adapter.loadAll();
    expect(loaded.masterKeyLocks).toEqual([]);
  });
});
