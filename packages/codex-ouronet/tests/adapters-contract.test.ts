/**
 * Adapter contract tests — shared assertions every CodexAdapter implementation
 * must satisfy. Both shipped adapters (MemoryCodexAdapter,
 * LocalStorageCodexAdapter) run through the same suite via a parameterized
 * describe block, so adding a new adapter (IndexedDB, Tauri, etc.) means
 * just plugging it into the table at the bottom of this file.
 *
 * Test environment: jsdom (set in vitest.config.ts). jsdom provides a
 * `window.localStorage` shim, so LocalStorageCodexAdapter works under
 * vitest without mocking.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  MemoryCodexAdapter,
  LocalStorageCodexAdapter,
  emptySnapshot,
  type CodexAdapter,
  type CodexSnapshot,
} from "@ancientpantheon/codex-ouronet/adapters";
import {
  DEFAULT_UI_SETTINGS,
  type IStoaChainSeed,
  type IOuroAccount,
  type IPureKeypair,
  type AddressBookEntry,
  type UiSettings,
  type WatchListEntry,
} from "@ancientpantheon/codex-ouronet/types";

// --------------------------------------------------------------------
// Test fixtures — small but realistic shapes mirroring what OuronetUI
// actually persists. Used by every adapter through the shared contract.
// --------------------------------------------------------------------

const sampleSeed = (): IStoaChainSeed => ({
  id: "seed-1",
  name: "Test seed",
  seedType: "koala",
  version: "1.0.0",
  index: 0,
  secret: "encrypted-mnemonic-blob-here",
  main: "k:abcd1234ef567890abcd1234ef567890abcd1234ef567890abcd1234ef567890",
  createdAt: "2026-05-24T10:00:00.000Z",
  accounts: [
    {
      index: 0,
      publicKey: "abcd1234ef567890abcd1234ef567890abcd1234ef567890abcd1234ef567890",
      derivationPath: "m/44'/626'/0'/0/0",
    },
  ],
});

const sampleOuro = (overrides: Partial<IOuroAccount> = {}): IOuroAccount => ({
  id: "ouro-1",
  name: "CodexPrime",
  version: "1.0.0",
  isSmart: false,
  address: "Ѻ.testaddress",
  guard: { pred: "keys-all", keys: ["abcd…"] },
  stoaChainLedger: null,
  publicKey: "40.somepubkey",
  secret: "encrypted-ouro-secret",
  backup: "encrypted-backup",
  isPrime: true,
  ...overrides,
});

const samplePureKeypair = (): IPureKeypair => ({
  id: "pure-1",
  label: "Imported foreign key",
  publicKey: "ff00ee11dd22cc33bb44aa55009988776655443322110099aabbccddeeff0011",
  encryptedPrivateKey: "encrypted-private-key-blob",
  createdAt: "2026-05-24T10:01:00.000Z",
});

const sampleAddressBookEntry = (): AddressBookEntry => ({
  id: "addr-1",
  name: "Alice",
  address: "Ѻ.aliceaddress",
  type: "ouronet",
  createdAt: "2026-05-24T10:02:00.000Z",
  updatedAt: "2026-05-24T10:02:00.000Z",
});

const sampleWatchListEntry = (): WatchListEntry => ({
  id: "watch-1",
  label: "Treasury",
  address: "Ѻ.treasury",
  type: "ouronet",
  createdAt: "2026-05-24T10:03:00.000Z",
});

const fullSnapshot = (): CodexSnapshot => ({
  kadenaSeeds: [sampleSeed()],
  ouroAccounts: [sampleOuro(), sampleOuro({ id: "ouro-2", name: "Second", isPrime: false, address: "Ѻ.second" })],
  pureKeypairs: [samplePureKeypair()],
  addressBook: [sampleAddressBookEntry()],
  watchList: [sampleWatchListEntry()],
  uiSettings: { ...DEFAULT_UI_SETTINGS, passwordCacheMinutes: 5 },
  schemaVersion: 1,
  lastUpdatedAt: "2026-05-24T10:00:00.000Z",
  lastUpdatedDevice: "dev",
});

// --------------------------------------------------------------------
// The shared contract — runs against any CodexAdapter implementation.
// --------------------------------------------------------------------

function adapterContract(name: string, makeAdapter: () => CodexAdapter): void {
  describe(`CodexAdapter contract — ${name}`, () => {
    let adapter: CodexAdapter;

    beforeEach(async () => {
      adapter = makeAdapter();
      await adapter.clearAll();
    });

    it("exposes a stable `name` field", () => {
      expect(typeof adapter.name).toBe("string");
      expect(adapter.name.length).toBeGreaterThan(0);
    });

    describe("loadAll() on an empty store", () => {
      it("returns the empty snapshot shape", async () => {
        const snap = await adapter.loadAll();
        expect(snap.kadenaSeeds).toEqual([]);
        expect(snap.ouroAccounts).toEqual([]);
        expect(snap.pureKeypairs).toEqual([]);
        expect(snap.addressBook).toEqual([]);
        expect(snap.watchList).toEqual([]);
        expect(snap.schemaVersion).toBe(0);
        expect(snap.lastUpdatedAt).toBeNull();
      });

      it("returns DEFAULT_UI_SETTINGS for empty UI settings", async () => {
        const snap = await adapter.loadAll();
        expect(snap.uiSettings.passwordCacheMinutes).toBe(
          DEFAULT_UI_SETTINGS.passwordCacheMinutes
        );
        expect(snap.uiSettings.selectedNode).toBe(DEFAULT_UI_SETTINGS.selectedNode);
      });
    });

    describe("saveAll + loadAll round-trip", () => {
      it("preserves every field of a full snapshot", async () => {
        const original = fullSnapshot();
        await adapter.saveAll(original);
        const loaded = await adapter.loadAll();

        expect(loaded.kadenaSeeds).toEqual(original.kadenaSeeds);
        expect(loaded.ouroAccounts).toEqual(original.ouroAccounts);
        expect(loaded.pureKeypairs).toEqual(original.pureKeypairs);
        expect(loaded.addressBook).toEqual(original.addressBook);
        expect(loaded.watchList).toEqual(original.watchList);
        expect(loaded.uiSettings).toEqual(original.uiSettings);
        expect(loaded.schemaVersion).toBe(original.schemaVersion);
        expect(loaded.lastUpdatedAt).toBe(original.lastUpdatedAt);
        expect(loaded.lastUpdatedDevice).toBe(original.lastUpdatedDevice);
      });

      it("doesn't share state with the caller (defensive copy)", async () => {
        const original = fullSnapshot();
        await adapter.saveAll(original);
        // Mutate the caller-side snapshot after save.
        original.kadenaSeeds[0]!.name = "MUTATED";
        // Loaded data should NOT reflect the mutation.
        const loaded = await adapter.loadAll();
        expect(loaded.kadenaSeeds[0]!.name).toBe("Test seed");
      });
    });

    describe("per-entity convenience writes", () => {
      it("saveStoaChainSeeds round-trips through loadAll", async () => {
        const seeds = [sampleSeed()];
        await adapter.saveStoaChainSeeds(seeds);
        const loaded = await adapter.loadAll();
        expect(loaded.kadenaSeeds).toEqual(seeds);
      });

      it("saveOuroAccounts round-trips through loadAll", async () => {
        const accounts = [sampleOuro()];
        await adapter.saveOuroAccounts(accounts);
        const loaded = await adapter.loadAll();
        expect(loaded.ouroAccounts).toEqual(accounts);
      });

      it("savePureKeypairs round-trips through loadAll", async () => {
        const keypairs = [samplePureKeypair()];
        await adapter.savePureKeypairs(keypairs);
        const loaded = await adapter.loadAll();
        expect(loaded.pureKeypairs).toEqual(keypairs);
      });

      it("saveAddressBook round-trips through loadAll", async () => {
        const entries = [sampleAddressBookEntry()];
        await adapter.saveAddressBook(entries);
        const loaded = await adapter.loadAll();
        expect(loaded.addressBook).toEqual(entries);
      });

      it("saveWatchList round-trips through loadAll", async () => {
        const entries = [sampleWatchListEntry()];
        await adapter.saveWatchList(entries);
        const loaded = await adapter.loadAll();
        expect(loaded.watchList).toEqual(entries);
      });

      it("saveUiSettings round-trips through loadAll", async () => {
        const settings: UiSettings = { ...DEFAULT_UI_SETTINGS, selectedNode: "node1" };
        await adapter.saveUiSettings(settings);
        const loaded = await adapter.loadAll();
        expect(loaded.uiSettings.selectedNode).toBe("node1");
      });
    });

    describe("metadata", () => {
      it("getSchemaVersion + setSchemaVersion round-trip", async () => {
        expect(await adapter.getSchemaVersion()).toBe(0);
        await adapter.setSchemaVersion(3);
        expect(await adapter.getSchemaVersion()).toBe(3);
      });

      it("touch() updates lastUpdatedAt + lastUpdatedDevice and returns them", async () => {
        const before = Date.now();
        const result = await adapter.touch("main");
        const after = Date.now();

        expect(result.lastUpdatedDevice).toBe("main");
        const ts = new Date(result.lastUpdatedAt).getTime();
        expect(ts).toBeGreaterThanOrEqual(before);
        expect(ts).toBeLessThanOrEqual(after);

        const loaded = await adapter.loadAll();
        expect(loaded.lastUpdatedAt).toBe(result.lastUpdatedAt);
        expect(loaded.lastUpdatedDevice).toBe("main");
      });
    });

    describe("encrypted UI settings sidecar", () => {
      it("loadUiSettingsEncrypted returns null when nothing is stored", async () => {
        const result = await adapter.loadUiSettingsEncrypted("anypassword");
        expect(result).toBeNull();
      });

      it("save + load round-trip with the correct password", async () => {
        const settings: UiSettings = { ...DEFAULT_UI_SETTINGS, passwordCacheMinutes: 99 };
        await adapter.saveUiSettingsEncrypted(settings, "correct-password");
        const loaded = await adapter.loadUiSettingsEncrypted("correct-password");
        expect(loaded).not.toBeNull();
        expect(loaded!.passwordCacheMinutes).toBe(99);
      });

      it("load with wrong password returns null (not throw)", async () => {
        const settings: UiSettings = { ...DEFAULT_UI_SETTINGS };
        await adapter.saveUiSettingsEncrypted(settings, "correct-password");
        const loaded = await adapter.loadUiSettingsEncrypted("wrong-password");
        expect(loaded).toBeNull();
      });
    });

    describe("clearAll()", () => {
      it("wipes every persisted field", async () => {
        await adapter.saveAll(fullSnapshot());
        await adapter.setSchemaVersion(5);
        await adapter.clearAll();

        const after = await adapter.loadAll();
        expect(after.kadenaSeeds).toEqual([]);
        expect(after.ouroAccounts).toEqual([]);
        expect(after.pureKeypairs).toEqual([]);
        expect(after.addressBook).toEqual([]);
        expect(after.watchList).toEqual([]);
        expect(after.schemaVersion).toBe(0);
        expect(after.lastUpdatedAt).toBeNull();
      });
    });
  });
}

// --------------------------------------------------------------------
// Adapter registry — add new adapters here.
// --------------------------------------------------------------------

adapterContract("MemoryCodexAdapter", () => new MemoryCodexAdapter());
adapterContract("LocalStorageCodexAdapter", () => {
  // Each test gets a fresh adapter; localStorage is shared per jsdom doc
  // so we call clearAll() in beforeEach (already done by the contract).
  return new LocalStorageCodexAdapter();
});

// --------------------------------------------------------------------
// emptySnapshot helper test (separate — not adapter-bound)
// --------------------------------------------------------------------

describe("emptySnapshot()", () => {
  it("returns the documented empty shape", () => {
    const snap = emptySnapshot("main");
    expect(snap.kadenaSeeds).toEqual([]);
    expect(snap.ouroAccounts).toEqual([]);
    expect(snap.pureKeypairs).toEqual([]);
    expect(snap.addressBook).toEqual([]);
    expect(snap.watchList).toEqual([]);
    expect(snap.schemaVersion).toBe(0);
    expect(snap.lastUpdatedAt).toBeNull();
    expect(snap.lastUpdatedDevice).toBe("main");
  });

  it("returns a fresh copy of DEFAULT_UI_SETTINGS each call", () => {
    const a = emptySnapshot("dev");
    const b = emptySnapshot("dev");
    expect(a.uiSettings).not.toBe(b.uiSettings); // different references
    expect(a.uiSettings).toEqual(b.uiSettings); // same content
  });
});
