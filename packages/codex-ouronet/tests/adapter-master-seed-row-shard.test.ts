/**
 * codexMasterSeed-shard round trip. Same omission class as the dropped
 * `foreignKeys` shard, the dropped `Codex_Shape_Version` stamp and the
 * dropped `masterKeyLocks` registry before it.
 *
 * What this one costs if it goes missing: the codex forgets WHICH of its
 * seeds everything derives from. The lock registry would still name
 * `(seedId, position)` pairs, but nothing would say why those ids are the
 * load-bearing ones.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  LocalStorageCodexAdapter,
  emptySnapshot,
  type CodexSnapshot,
} from "@ancientpantheon/codex-ouronet/adapters";
import { DEFAULT_UI_SETTINGS } from "@ancientpantheon/codex-ouronet/types";
import type { CodexMasterSeed } from "@ancientpantheon/codex-core";

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

const ROW: CodexMasterSeed = {
  ouroAccountId: "ouro-1",
  chainwebSeedId: "seed-1",
  arweaveSeedId: "arw-1",
  establishedAt: "2026-10-28T10:00:00.000Z",
};

const snap = (codexMasterSeed: CodexMasterSeed | undefined): CodexSnapshot => ({
  ...emptySnapshot("dev"),
  uiSettings: { ...DEFAULT_UI_SETTINGS },
  schemaVersion: 3,
  lastUpdatedAt: "2026-10-28T10:00:00.000Z",
  codexMasterSeed,
});

describe("LocalStorageCodexAdapter — codexMasterSeed shard round trip", () => {
  let real: Storage | undefined;
  beforeEach(() => {
    real = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      value: makeFakeStorage(), configurable: true, writable: true,
    });
  });
  afterEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: real, configurable: true, writable: true,
    });
  });

  it("persists the row through saveAll -> loadAll", async () => {
    const a = new LocalStorageCodexAdapter("dev");
    await a.saveAll(snap(ROW));
    expect((await a.loadAll()).codexMasterSeed).toEqual(ROW);
  });

  it("round-trips a TWO-FACE row (ArWeave not derived yet)", async () => {
    const a = new LocalStorageCodexAdapter("dev");
    const twoFace: CodexMasterSeed = {
      ouroAccountId: "ouro-1",
      chainwebSeedId: "seed-1",
      establishedAt: "2026-10-28T10:00:00.000Z",
    };
    await a.saveAll(snap(twoFace));
    expect((await a.loadAll()).codexMasterSeed).toEqual(twoFace);
  });

  it("round-trips the FORMER-holder history, both lists", async () => {
    // Added with `former-master-record` T3. The shard is written as one JSON
    // object, so this passes by construction TODAY — it is pinned because the
    // history is the ONLY record of who the master was (the ids are
    // overwritten in place), and an adapter that ever started projecting the
    // row's fields explicitly would drop it silently, exactly as the
    // `foreignKeys` / `arweaveSeeds` / `masterKeyLocks` shards were dropped
    // before it.
    const a = new LocalStorageCodexAdapter("dev");
    const withHistory: CodexMasterSeed = {
      ...ROW,
      ouroAccountId: "ouro-2",
      arweaveSeedId: "arw-2",
      formerOuroAccountIds: ["ouro-1"],
      formerArweaveSeedIds: ["arw-1"],
    };
    await a.saveAll(snap(withHistory));
    expect((await a.loadAll()).codexMasterSeed).toEqual(withHistory);
  });

  it("reports undefined when nothing was ever persisted (never-migrated codex)", async () => {
    const a = new LocalStorageCodexAdapter("dev");
    expect((await a.loadAll()).codexMasterSeed).toBeUndefined();
  });

  it("leaves a stored row UNTOUCHED when the field is absent on write", async () => {
    // Absence means "this writer did not know about the row", not "there is
    // no master seed" — erasing would make the codex forget its own origin.
    const a = new LocalStorageCodexAdapter("dev");
    await a.saveAll(snap(ROW));
    await a.saveAll(snap(undefined));
    expect((await a.loadAll()).codexMasterSeed).toEqual(ROW);
  });

  it("degrades corrupt JSON to undefined rather than crashing the load", async () => {
    const a = new LocalStorageCodexAdapter("dev");
    await a.saveAll(snap(ROW));
    window.localStorage.setItem("codexMasterSeed", "{not json");
    expect((await a.loadAll()).codexMasterSeed).toBeUndefined();
  });

  it("clearAll removes the row", async () => {
    const a = new LocalStorageCodexAdapter("dev");
    await a.saveAll(snap(ROW));
    await a.clearAll();
    expect((await a.loadAll()).codexMasterSeed).toBeUndefined();
  });
});
