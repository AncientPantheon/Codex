/**
 * foreignKeys-shard round-trip (funds-critical, the D5 revisit / FIX-1).
 *
 * The Ouronet `LocalStorageCodexAdapter` overrides `saveAll`/`loadAll` wholesale
 * (it enumerates its own fixed key inventory rather than delegating to the D3
 * generic's opaque-payload-blob sharding). Before this shard was added it
 * enumerated every snapshot slice EXCEPT `foreignKeys` — so an Arweave (or any
 * foreign-chain) key would be silently dropped on a save→load round-trip,
 * losing the key on restore.
 *
 * This suite pins the shard against a FAKE in-memory `StorageLike` — a
 * Map-backed `window.localStorage` stand-in. `MemoryCodexAdapter` is
 * deliberately NOT used: its `structuredClone` whole-snapshot round-trip would
 * carry `foreignKeys` regardless of the sharding logic and thus false-pass this
 * exact gap. Driving the real localStorage-sharding adapter through a fake
 * storage seam is what proves the shard is actually written and read back.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  LocalStorageCodexAdapter,
  emptySnapshot,
  type CodexSnapshot,
} from "@ancientpantheon/codex-ouronet/adapters";
import { DEFAULT_UI_SETTINGS } from "@ancientpantheon/codex-ouronet/types";
import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";

/** A minimal Map-backed `localStorage` stand-in — the "fake in-memory
 *  StorageLike" the shard round-trip drives against. Structurally satisfies the
 *  subset of the Storage interface the adapter touches. */
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

const sampleForeignKey = (
  overrides: Partial<ForeignKeyEntry> = {},
): ForeignKeyEntry => ({
  id: "fk-1",
  label: "Arweave main",
  chainId: "arweave:mainnet",
  // Pre-encrypted ciphertext at rest — the adapter persists bytes verbatim and
  // NEVER encrypts/decrypts (N-06).
  encryptedKeyfile: "ENC(jwk-ciphertext-blob)",
  ...overrides,
});

const snapshotWithForeignKeys = (
  foreignKeys: ForeignKeyEntry[],
): CodexSnapshot => ({
  ...emptySnapshot("dev"),
  uiSettings: { ...DEFAULT_UI_SETTINGS },
  schemaVersion: 3,
  lastUpdatedAt: "2026-07-04T10:00:00.000Z",
  foreignKeys,
});

describe("LocalStorageCodexAdapter — foreignKeys shard round-trip (FIX-1)", () => {
  let realLocalStorage: Storage | undefined;

  beforeEach(() => {
    // Swap window.localStorage for the fake in-memory seam. The adapter reads
    // the ambient `window.localStorage`, so replacing it here injects the fake.
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

  it("persists foreignKeys through saveAll→loadAll (a dropped shard loses the Arweave key on restore)", async () => {
    const adapter = new LocalStorageCodexAdapter("dev");
    const entry = sampleForeignKey();

    await adapter.saveAll(snapshotWithForeignKeys([entry]));
    const loaded = await adapter.loadAll();

    expect(loaded.foreignKeys).toEqual([entry]);
  });

  it("round-trips multiple foreignKeys entries preserving each entry's fields", async () => {
    const adapter = new LocalStorageCodexAdapter("dev");
    const entries = [
      sampleForeignKey(),
      sampleForeignKey({
        id: "fk-2",
        label: undefined,
        chainId: "arweave:testnet",
        encryptedKeyfile: "ENC(second-blob)",
      }),
    ];

    await adapter.saveAll(snapshotWithForeignKeys(entries));
    const loaded = await adapter.loadAll();

    expect(loaded.foreignKeys).toEqual(entries);
  });

  it("persists ONLY the pre-encrypted encryptedKeyfile bytes (never decrypts)", async () => {
    const adapter = new LocalStorageCodexAdapter("dev");
    const entry = sampleForeignKey({ encryptedKeyfile: "ENC(opaque-ciphertext)" });

    await adapter.saveAll(snapshotWithForeignKeys([entry]));
    const loaded = await adapter.loadAll();

    expect(loaded.foreignKeys?.[0]?.encryptedKeyfile).toBe("ENC(opaque-ciphertext)");
  });

  it("loads foreignKeys as an empty array when nothing was persisted (v0.2 codex has no shard)", async () => {
    const adapter = new LocalStorageCodexAdapter("dev");

    const loaded = await adapter.loadAll();

    expect(loaded.foreignKeys).toEqual([]);
  });

  it("coalesces an absent foreignKeys field on save to an empty array on load", async () => {
    const adapter = new LocalStorageCodexAdapter("dev");
    const snapshot = snapshotWithForeignKeys([]);
    delete (snapshot as { foreignKeys?: ForeignKeyEntry[] }).foreignKeys;

    await adapter.saveAll(snapshot);
    const loaded = await adapter.loadAll();

    expect(loaded.foreignKeys).toEqual([]);
  });
});
