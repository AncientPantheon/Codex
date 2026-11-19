/**
 * migrationProgress-shard round trip, and the no-seed-words guarantee at the
 * STORAGE boundary — where a plaintext word would actually land on disk.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  LocalStorageCodexAdapter,
  emptySnapshot,
  type CodexSnapshot,
} from "@ancientpantheon/codex-ouronet/adapters";
import { DEFAULT_UI_SETTINGS } from "@ancientpantheon/codex-ouronet/types";
import { toPersistableAccountSelection, containsSuspectedSecret } from "@ancientpantheon/codex-core";
import type { MigrationProgress } from "@ancientpantheon/codex-core";

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

const WORDS = "river stone ember ancient hodler vault";

const RUN: MigrationProgress = {
  stage: "selection",
  startedAt: "2026-10-29T10:00:00.000Z",
  updatedAt: "2026-10-29T10:01:00.000Z",
  selection: {
    account: { kind: "existing", accountId: "ouro-7" },
    payment: { kind: "stoic-dalos-position-0" },
    guard: { kind: "recommended-single-key" },
    derivationMethod: "stoic-dalos",
  },
};

const snap = (migrationProgress: MigrationProgress | undefined | null): CodexSnapshot => ({
  ...emptySnapshot("dev"),
  uiSettings: { ...DEFAULT_UI_SETTINGS },
  schemaVersion: 3,
  lastUpdatedAt: "2026-10-29T10:00:00.000Z",
  migrationProgress: migrationProgress as MigrationProgress | undefined,
});

describe("LocalStorageCodexAdapter — migrationProgress shard", () => {
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

  it("persists an unfinished run through saveAll -> loadAll", async () => {
    const a = new LocalStorageCodexAdapter("dev");
    await a.saveAll(snap(RUN));
    expect((await a.loadAll()).migrationProgress).toEqual(RUN);
  });

  it("reports undefined when no migration was ever started", async () => {
    const a = new LocalStorageCodexAdapter("dev");
    expect((await a.loadAll()).migrationProgress).toBeUndefined();
  });

  it("CLEARS the row on an explicit null — finishing must stop the resume offer", async () => {
    // Deliberately unlike the other shards: a completed codex that kept its
    // row would offer to resume a migration that already happened.
    const a = new LocalStorageCodexAdapter("dev");
    await a.saveAll(snap(RUN));
    await a.saveAll(snap(null));
    expect((await a.loadAll()).migrationProgress).toBeUndefined();
  });

  it("leaves the row alone on `undefined` (a writer that predates the field)", async () => {
    const a = new LocalStorageCodexAdapter("dev");
    await a.saveAll(snap(RUN));
    await a.saveAll(snap(undefined));
    expect((await a.loadAll()).migrationProgress).toEqual(RUN);
  });

  it("degrades corrupt JSON to undefined rather than crashing the load", async () => {
    const a = new LocalStorageCodexAdapter("dev");
    await a.saveAll(snap(RUN));
    window.localStorage.setItem("migrationProgress", "{broken");
    expect((await a.loadAll()).migrationProgress).toBeUndefined();
  });

  it("clearAll removes the row", async () => {
    const a = new LocalStorageCodexAdapter("dev");
    await a.saveAll(snap(RUN));
    await a.clearAll();
    expect((await a.loadAll()).migrationProgress).toBeUndefined();
  });

  it("NO SEED WORDS reach storage, even for a new-words run", async () => {
    // The guarantee asserted where it actually matters: the bytes written.
    const a = new LocalStorageCodexAdapter("dev");
    const newWordsRun: MigrationProgress = {
      ...RUN,
      selection: {
        ...RUN.selection!,
        account: toPersistableAccountSelection({ kind: "new-words", words: WORDS }),
      },
    };
    await a.saveAll(snap(newWordsRun));

    const written = window.localStorage.getItem("migrationProgress") ?? "";
    expect(written).not.toContain(WORDS);
    for (const w of WORDS.split(" ")) expect(written).not.toContain(w);
    expect(containsSuspectedSecret(JSON.parse(written))).toBe(false);
  });
});
