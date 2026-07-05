/**
 * State store tests — exercise every action on the Zustand store using a
 * fresh MemoryCodexAdapter per test. Validates that each action:
 *   1. Updates the store's in-memory state correctly.
 *   2. Persists through to the adapter (round-tripped via adapter.loadAll()).
 *   3. Marks the codex dirty + updates lastUpdatedAt/Device.
 *   4. Throws the right typed error when preconditions aren't met
 *      (locked codex, CodexPrime delete, etc.).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import type { CodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import {
  CodexLockedError,
  CodexPrimeProtectedError,
} from "@ancientpantheon/codex-ouronet/errors";
import type {
  IKadenaSeed,
  IOuroAccount,
  IPureKeypair,
  AddressBookEntry,
  WatchListEntry,
} from "@ancientpantheon/codex-ouronet/types";

// --------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------

const seed = (id = "s1"): IKadenaSeed => ({
  id,
  name: "Seed",
  seedType: "koala",
  version: "1.0.0",
  index: 0,
  secret: "encrypted-secret",
  main: "k:" + "0".repeat(64),
  createdAt: "2026-05-24T10:00:00.000Z",
  accounts: [
    {
      index: 0,
      publicKey: "a".repeat(64),
      derivationPath: "m/44'/626'/0'/0/0",
    },
  ],
});

const ouro = (
  id = "o1",
  overrides: Partial<IOuroAccount> = {}
): IOuroAccount => ({
  id,
  name: "Ouro",
  version: "1.0.0",
  isSmart: false,
  address: "Ѻ." + id,
  guard: null,
  kadenaLedger: null,
  publicKey: "pk-" + id,
  secret: "secret-" + id,
  backup: "backup-" + id,
  ...overrides,
});

const pure = (id = "p1"): IPureKeypair => ({
  id,
  label: "Pure",
  publicKey: "f".repeat(64),
  encryptedPrivateKey: "enc-pk",
  createdAt: "2026-05-24T10:01:00.000Z",
});

const addr = (id = "a1"): AddressBookEntry => ({
  id,
  name: "Alice",
  address: "Ѻ.alice",
  type: "ouronet",
  createdAt: "2026-05-24T10:02:00.000Z",
  updatedAt: "2026-05-24T10:02:00.000Z",
});

const watch = (id = "w1"): WatchListEntry => ({
  id,
  label: "Treasury",
  address: "Ѻ.treasury",
  type: "ouronet",
  createdAt: "2026-05-24T10:03:00.000Z",
});

// --------------------------------------------------------------------
// Suite
// --------------------------------------------------------------------

describe("CodexStore", () => {
  let adapter: CodexAdapter;
  let store: ReturnType<typeof createCodexStore>;

  beforeEach(async () => {
    adapter = new MemoryCodexAdapter("dev");
    store = createCodexStore();
    await store.getState().actions.init(adapter, "dev");
  });

  describe("init()", () => {
    it("starts in the empty + locked state", async () => {
      // Fresh adapter + store; init was already called in beforeEach,
      // so the state should reflect an empty codex.
      const s = store.getState();
      expect(s.ready).toBe(true);
      expect(s.locked).toBe(true);
      expect(s.kadenaSeeds).toEqual([]);
      expect(s.ouroAccounts).toEqual([]);
      expect(s.activeKadenaWalletId).toBeNull();
      expect(s.activeOuroAccountId).toBeNull();
      expect(s.initError).toBeNull();
    });

    it("populates state from a non-empty adapter", async () => {
      const a2 = new MemoryCodexAdapter();
      await a2.saveAll({
        kadenaSeeds: [seed()],
        ouroAccounts: [ouro()],
        pureKeypairs: [],
        addressBook: [],
        watchList: [],
        uiSettings: store.getState().uiSettings,
        schemaVersion: 1,
        lastUpdatedAt: "2026-05-24T10:00:00.000Z",
        lastUpdatedDevice: "dev",
      });
      const s2 = createCodexStore();
      await s2.getState().actions.init(a2, "dev");

      const state = s2.getState();
      expect(state.kadenaSeeds).toHaveLength(1);
      expect(state.ouroAccounts).toHaveLength(1);
      expect(state.activeKadenaWalletId).toBe("s1");
      expect(state.activeOuroAccountId).toBe("o1");
      // init() auto-applies the full migration chain on load (1->2->3), so a
      // loaded schemaVersion:1 codex lands at the current 3.
      expect(state.schemaVersion).toBe(3);
    });
  });

  describe("auth", () => {
    it("authenticate() unlocks the codex and caches the password", () => {
      store.getState().actions.authenticate("hunter2", 60);
      const s = store.getState();
      expect(s.locked).toBe(false);
      expect(s.passwordCache?.value).toBe("hunter2");
      expect(s.passwordCache?.expiresAt).toBeGreaterThan(Date.now());
    });

    it("lock() clears the password cache", () => {
      store.getState().actions.authenticate("p", 60);
      store.getState().actions.lock();
      const s = store.getState();
      expect(s.locked).toBe(true);
      expect(s.passwordCache).toBeNull();
    });

    it("getPassword() throws CodexLockedError when locked", () => {
      expect(() => store.getState().actions.getPassword()).toThrow(
        CodexLockedError
      );
    });

    it("getPassword() returns the cached password when unlocked", () => {
      store.getState().actions.authenticate("hunter2", 60);
      expect(store.getState().actions.getPassword()).toBe("hunter2");
    });

    it("getPassword() throws CodexLockedError when cache expired", () => {
      // Authenticate with 0-minute TTL (immediate expiry).
      store.getState().actions.authenticate("p", 0);
      expect(() => store.getState().actions.getPassword()).toThrow(
        CodexLockedError
      );
    });
  });

  describe("kadena seeds", () => {
    it("addKadenaSeed persists + marks dirty + updates lastUpdatedAt", async () => {
      const before = store.getState().lastUpdatedAt;
      await store.getState().actions.addKadenaSeed(seed());
      const s = store.getState();
      expect(s.kadenaSeeds).toHaveLength(1);
      expect(s.dirty).toBe(true);
      expect(s.lastUpdatedAt).not.toBe(before);
      // Verify it actually reached the adapter:
      const snap = await adapter.loadAll();
      expect(snap.kadenaSeeds).toHaveLength(1);
    });

    it("updateKadenaSeed mutates the right entry only", async () => {
      await store.getState().actions.addKadenaSeed(seed("s1"));
      await store.getState().actions.addKadenaSeed(seed("s2"));
      await store
        .getState()
        .actions.updateKadenaSeed({ ...seed("s1"), name: "RENAMED" });
      const seeds = store.getState().kadenaSeeds;
      expect(seeds.find((s) => s.id === "s1")?.name).toBe("RENAMED");
      expect(seeds.find((s) => s.id === "s2")?.name).toBe("Seed");
    });

    it("deleteKadenaSeed removes + clears active if needed", async () => {
      // s1 is added first → auto-flagged as Prime Codex Seed (v0.2.0).
      // We delete s2 (non-prime) instead to exercise the non-prime path.
      await store.getState().actions.addKadenaSeed(seed("s1"));
      await store.getState().actions.addKadenaSeed(seed("s2"));
      store.getState().actions.setActiveKadenaWallet("s2");
      await store.getState().actions.deleteKadenaSeed("s2");
      const s = store.getState();
      expect(s.kadenaSeeds).toHaveLength(1);
      expect(s.kadenaSeeds[0]?.id).toBe("s1");
      expect(s.activeKadenaWalletId).toBe("s1"); // fell through to the prime
    });
  });

  describe("pure keypairs", () => {
    it("addPureKeypair persists through to adapter", async () => {
      await store.getState().actions.addPureKeypair(pure());
      expect(store.getState().pureKeypairs).toHaveLength(1);
      const snap = await adapter.loadAll();
      expect(snap.pureKeypairs).toHaveLength(1);
    });

    it("deletePureKeypair removes from store + adapter", async () => {
      await store.getState().actions.addPureKeypair(pure("p1"));
      await store.getState().actions.deletePureKeypair("p1");
      expect(store.getState().pureKeypairs).toEqual([]);
      const snap = await adapter.loadAll();
      expect(snap.pureKeypairs).toEqual([]);
    });
  });

  describe("ouro accounts + CodexPrime protection (§B2)", () => {
    it("first added ouro account auto-flags isPrime", async () => {
      await store.getState().actions.addOuroAccount(ouro("first"));
      const first = store.getState().ouroAccounts[0];
      expect(first?.isPrime).toBe(true);
    });

    it("subsequent ouro accounts default isPrime=false", async () => {
      await store.getState().actions.addOuroAccount(ouro("first"));
      await store.getState().actions.addOuroAccount(ouro("second"));
      const accounts = store.getState().ouroAccounts;
      expect(accounts.find((a) => a.id === "first")?.isPrime).toBe(true);
      expect(accounts.find((a) => a.id === "second")?.isPrime).toBe(false);
    });

    it("deleteOuroAccount on a non-prime account succeeds", async () => {
      await store.getState().actions.addOuroAccount(ouro("first"));
      await store.getState().actions.addOuroAccount(ouro("second"));
      await store.getState().actions.deleteOuroAccount("second");
      expect(store.getState().ouroAccounts).toHaveLength(1);
    });

    it("deleteOuroAccount on CodexPrime throws CodexPrimeProtectedError", async () => {
      await store.getState().actions.addOuroAccount(ouro("prime"));
      await expect(
        store.getState().actions.deleteOuroAccount("prime")
      ).rejects.toThrow(CodexPrimeProtectedError);
      // State unchanged.
      expect(store.getState().ouroAccounts).toHaveLength(1);
    });

    it("addOuroAccount auto-activates first account", async () => {
      expect(store.getState().activeOuroAccountId).toBeNull();
      await store.getState().actions.addOuroAccount(ouro("o1"));
      expect(store.getState().activeOuroAccountId).toBe("o1");
    });

    it("updateOuroAccount mutates only the targeted account", async () => {
      await store.getState().actions.addOuroAccount(ouro("o1"));
      await store.getState().actions.addOuroAccount(ouro("o2"));
      await store.getState().actions.updateOuroAccount({
        ...ouro("o1"),
        name: "RENAMED",
      });
      expect(
        store.getState().ouroAccounts.find((a) => a.id === "o1")?.name
      ).toBe("RENAMED");
      expect(
        store.getState().ouroAccounts.find((a) => a.id === "o2")?.name
      ).toBe("Ouro");
    });
  });

  describe("address book", () => {
    it("add + delete round-trip through adapter", async () => {
      await store.getState().actions.addAddressBookEntry(addr());
      expect(store.getState().addressBook).toHaveLength(1);
      await store.getState().actions.deleteAddressBookEntry("a1");
      expect(store.getState().addressBook).toEqual([]);
      const snap = await adapter.loadAll();
      expect(snap.addressBook).toEqual([]);
    });

    it("updateAddressBookEntry refreshes updatedAt", async () => {
      const original = addr("a1");
      await store.getState().actions.addAddressBookEntry(original);
      const before = store.getState().addressBook[0]!.updatedAt;
      await new Promise((r) => setTimeout(r, 5)); // ensure clock advances
      await store
        .getState()
        .actions.updateAddressBookEntry("a1", { name: "Renamed" });
      const after = store.getState().addressBook[0];
      expect(after?.name).toBe("Renamed");
      expect(after?.updatedAt).not.toBe(before);
    });
  });

  describe("watch list", () => {
    it("add + delete round-trip", async () => {
      await store.getState().actions.addWatchListEntry(watch());
      expect(store.getState().watchList).toHaveLength(1);
      await store.getState().actions.deleteWatchListEntry("w1");
      expect(store.getState().watchList).toEqual([]);
    });
  });

  describe("UI settings", () => {
    it("updateUiSettings merges a patch", async () => {
      await store
        .getState()
        .actions.updateUiSettings({ passwordCacheMinutes: 99 });
      const s = store.getState().uiSettings;
      expect(s.passwordCacheMinutes).toBe(99);
      // Other fields preserved.
      expect(s.selectedNode).toBe("node2");
    });
  });

  describe("active selection", () => {
    it("setActiveKadenaWallet updates state", () => {
      store.getState().actions.setActiveKadenaWallet("x");
      expect(store.getState().activeKadenaWalletId).toBe("x");
      store.getState().actions.setActiveKadenaWallet(null);
      expect(store.getState().activeKadenaWalletId).toBeNull();
    });

    it("setActiveOuroAccount updates state", () => {
      store.getState().actions.setActiveOuroAccount("y");
      expect(store.getState().activeOuroAccountId).toBe("y");
    });
  });

  describe("meta", () => {
    it("markDirty + clearDirty", () => {
      expect(store.getState().dirty).toBe(false);
      store.getState().actions.markDirty();
      expect(store.getState().dirty).toBe(true);
      store.getState().actions.clearDirty();
      expect(store.getState().dirty).toBe(false);
    });

    it("setSchemaVersion persists + updates state", async () => {
      await store.getState().actions.setSchemaVersion(7);
      expect(store.getState().schemaVersion).toBe(7);
      const adapterVersion = await adapter.getSchemaVersion();
      expect(adapterVersion).toBe(7);
    });
  });

  describe("reset()", () => {
    it("wipes state back to initial (locked + empty + no adapter)", async () => {
      await store.getState().actions.addOuroAccount(ouro());
      store.getState().actions.authenticate("p", 60);
      store.getState().actions.reset();
      const s = store.getState();
      expect(s.locked).toBe(true);
      expect(s.passwordCache).toBeNull();
      expect(s.ouroAccounts).toEqual([]);
      expect(s.adapter).toBeNull();
      expect(s.ready).toBe(false);
    });
  });

  // ----------------------------------------------------------------
  // v0.2.0 — Prime Codex Seed + kickstartCodex + recovery + migration
  // ----------------------------------------------------------------

  describe("v0.2.0 — Prime Codex Seed protection (§B1)", () => {
    it("first added seed auto-flags isPrime: true", async () => {
      await store.getState().actions.addKadenaSeed(seed("s1"));
      const s = store.getState().kadenaSeeds[0];
      expect(s?.isPrime).toBe(true);
    });

    it("subsequent seeds default isPrime: false", async () => {
      await store.getState().actions.addKadenaSeed(seed("s1"));
      await store.getState().actions.addKadenaSeed(seed("s2"));
      const seeds = store.getState().kadenaSeeds;
      expect(seeds.find((x) => x.id === "s1")?.isPrime).toBe(true);
      expect(seeds.find((x) => x.id === "s2")?.isPrime).toBeFalsy();
    });

    it("deleteKadenaSeed on the Prime Codex Seed throws CodexPrimeSeedProtectedError", async () => {
      const { CodexPrimeSeedProtectedError } = await import(
        "@ancientpantheon/codex-ouronet/errors"
      );
      await store.getState().actions.addKadenaSeed(seed("prime"));
      await expect(
        store.getState().actions.deleteKadenaSeed("prime")
      ).rejects.toThrow(CodexPrimeSeedProtectedError);
      expect(store.getState().kadenaSeeds).toHaveLength(1);
    });

    it("addKadenaSeed with explicit isPrime:true when prime exists throws id-conflict", async () => {
      const { CodexKickstartError } = await import(
        "@ancientpantheon/codex-ouronet/errors"
      );
      await store.getState().actions.addKadenaSeed(seed("s1")); // becomes prime
      const intruder = { ...seed("s2"), isPrime: true };
      await expect(
        store.getState().actions.addKadenaSeed(intruder)
      ).rejects.toThrow(CodexKickstartError);
    });

    it("deleteKadenaSeed on non-prime seed cascades to its derived ouro accounts", async () => {
      // s1 = prime (auto). s2 = non-prime. Add an ouro derived from s2.
      await store.getState().actions.addKadenaSeed(seed("s1"));
      await store.getState().actions.addKadenaSeed(seed("s2"));
      await store
        .getState()
        .actions.addOuroAccount(ouro("o-derived-from-s2", { parentSeedId: "s2" }));
      // Sanity: ouro exists with parent linked.
      expect(
        store.getState().ouroAccounts.find((a) => a.id === "o-derived-from-s2")?.parentSeedId
      ).toBe("s2");
      // Note: o-derived-from-s2 is the FIRST ouro added, so it auto-flags
      // isPrime: true. Cascade-delete must skip primes (defensive). To
      // exercise the actual cascade-delete path, first add a prime ouro
      // (which clears the "first" status for o-derived-from-s2):
      await store.getState().actions.deleteOuroAccount("o-derived-from-s2").catch(() => {
        // Will throw CodexPrimeProtectedError — that's fine, we're
        // about to reset and test the cascade path properly.
      });

      // Reset and try the actual cascade path with a non-prime ouro:
      const adapter2 = new MemoryCodexAdapter();
      const store2 = createCodexStore();
      await store2.getState().actions.init(adapter2);
      await store2.getState().actions.addKadenaSeed(seed("prime"));
      await store2.getState().actions.addOuroAccount(ouro("primeOuro")); // first → isPrime
      await store2.getState().actions.addKadenaSeed(seed("s2"));
      await store2.getState().actions.addOuroAccount(
        ouro("derived-from-s2", { parentSeedId: "s2" })
      );
      // derived-from-s2 should NOT be isPrime (primeOuro was first):
      expect(
        store2.getState().ouroAccounts.find((a) => a.id === "derived-from-s2")?.isPrime
      ).toBeFalsy();
      // Delete s2 → derived-from-s2 should be cascaded out.
      await store2.getState().actions.deleteKadenaSeed("s2");
      expect(store2.getState().kadenaSeeds.map((x) => x.id)).toEqual(["prime"]);
      expect(store2.getState().ouroAccounts.map((a) => a.id)).toEqual(["primeOuro"]);
    });
  });

  describe("v0.2.0 — kickstartCodex (§5.2)", () => {
    it("kickstart on empty codex installs prime seed + ouro atomically", async () => {
      const result = (await store.getState().actions.kickstartCodex({
        seed: seed("primeSeed"),
        primeOuroAccount: ouro("primeOuro"),
      })) as { seed: IKadenaSeed; primeOuro: IOuroAccount };
      expect(result.seed.isPrime).toBe(true);
      expect(result.primeOuro.isPrime).toBe(true);
      expect(result.primeOuro.parentSeedId).toBe("primeSeed");
      const s = store.getState();
      expect(s.kadenaSeeds).toHaveLength(1);
      expect(s.ouroAccounts).toHaveLength(1);
      expect(s.activeKadenaWalletId).toBe("primeSeed");
      expect(s.activeOuroAccountId).toBe("primeOuro");
    });

    it("kickstart on non-empty codex throws already-kickstarted", async () => {
      const { CodexKickstartError } = await import(
        "@ancientpantheon/codex-ouronet/errors"
      );
      await store.getState().actions.addKadenaSeed(seed("s1"));
      await expect(
        store.getState().actions.kickstartCodex({
          seed: seed("primeSeed"),
          primeOuroAccount: ouro("primeOuro"),
        })
      ).rejects.toThrow(CodexKickstartError);
    });

    it("kickstart with Smart ouro account throws smart-account-not-allowed", async () => {
      const { CodexKickstartError } = await import(
        "@ancientpantheon/codex-ouronet/errors"
      );
      await expect(
        store.getState().actions.kickstartCodex({
          seed: seed("primeSeed"),
          primeOuroAccount: ouro("smartPrime", { isSmart: true }),
        })
      ).rejects.toThrow(CodexKickstartError);
      // State unchanged.
      expect(store.getState().kadenaSeeds).toHaveLength(0);
    });

    it("kickstart persists both entities to the adapter", async () => {
      await store.getState().actions.kickstartCodex({
        seed: seed("primeSeed"),
        primeOuroAccount: ouro("primeOuro"),
      });
      const snap = await adapter.loadAll();
      expect(snap.kadenaSeeds).toHaveLength(1);
      expect(snap.kadenaSeeds[0]?.isPrime).toBe(true);
      expect(snap.ouroAccounts).toHaveLength(1);
      expect(snap.ouroAccounts[0]?.isPrime).toBe(true);
      expect(snap.ouroAccounts[0]?.parentSeedId).toBe("primeSeed");
    });
  });

  describe("v0.2.0 — recoverCodexFromMnemonic (§5.3)", () => {
    it("recover on empty codex behaves like kickstart", async () => {
      const result = await store.getState().actions.recoverCodexFromMnemonic({
        seed: seed("primeSeed"),
        primeOuroAccount: ouro("primeOuro"),
      });
      expect(result.seed.isPrime).toBe(true);
      expect(result.primeOuro.parentSeedId).toBe("primeSeed");
      expect(store.getState().kadenaSeeds).toHaveLength(1);
    });

    it("recover with same prime ids is idempotent", async () => {
      await store.getState().actions.kickstartCodex({
        seed: seed("primeSeed"),
        primeOuroAccount: ouro("primeOuro"),
      });
      // Same ids → idempotent re-install.
      await expect(
        store.getState().actions.recoverCodexFromMnemonic({
          seed: seed("primeSeed"),
          primeOuroAccount: ouro("primeOuro"),
        })
      ).resolves.toBeDefined();
      expect(store.getState().kadenaSeeds).toHaveLength(1);
      expect(store.getState().ouroAccounts).toHaveLength(1);
    });

    it("recover with different seed id throws id-conflict", async () => {
      const { CodexKickstartError } = await import(
        "@ancientpantheon/codex-ouronet/errors"
      );
      await store.getState().actions.kickstartCodex({
        seed: seed("existingPrime"),
        primeOuroAccount: ouro("primeOuro"),
      });
      await expect(
        store.getState().actions.recoverCodexFromMnemonic({
          seed: seed("differentPrime"),
          primeOuroAccount: ouro("primeOuro"),
        })
      ).rejects.toThrow(CodexKickstartError);
    });

    it("recover preserves unrelated non-prime entities", async () => {
      // Kickstart, then add a non-prime seed and a non-prime ouro,
      // then recover with the same prime ids — extras should survive.
      await store.getState().actions.kickstartCodex({
        seed: seed("primeSeed"),
        primeOuroAccount: ouro("primeOuro"),
      });
      await store.getState().actions.addKadenaSeed(seed("extraSeed"));
      await store
        .getState()
        .actions.addOuroAccount(ouro("extraOuro", { parentSeedId: "extraSeed" }));

      await store.getState().actions.recoverCodexFromMnemonic({
        seed: seed("primeSeed"),
        primeOuroAccount: ouro("primeOuro"),
      });

      expect(store.getState().kadenaSeeds.map((x) => x.id).sort()).toEqual(
        ["extraSeed", "primeSeed"]
      );
      expect(store.getState().ouroAccounts.map((a) => a.id).sort()).toEqual(
        ["extraOuro", "primeOuro"]
      );
    });
  });

  describe("v0.2.0 — addOuroAccount parentSeedId validation", () => {
    it("drops parentSeedId pointing to non-existent seed (with warning)", async () => {
      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (msg: string) => warnings.push(String(msg));
      try {
        await store
          .getState()
          .actions.addOuroAccount(
            ouro("orphan", { parentSeedId: "ghost-seed-id" })
          );
        const acc = store.getState().ouroAccounts.find((a) => a.id === "orphan");
        expect(acc?.parentSeedId).toBeUndefined();
        expect(warnings.some((w) => w.includes("ghost-seed-id"))).toBe(true);
      } finally {
        console.warn = origWarn;
      }
    });

    it("preserves parentSeedId when matching seed exists", async () => {
      await store.getState().actions.addKadenaSeed(seed("realSeed"));
      await store
        .getState()
        .actions.addOuroAccount(ouro("bound", { parentSeedId: "realSeed" }));
      const acc = store.getState().ouroAccounts.find((a) => a.id === "bound");
      expect(acc?.parentSeedId).toBe("realSeed");
    });
  });

  describe("v0.2.0 — legacy codex migration (§8)", () => {
    it("loading a legacy codex auto-flags first seed as prime", async () => {
      // Build a "pre-v0.2.0" snapshot — seed has no isPrime.
      const legacyAdapter = new MemoryCodexAdapter();
      await legacyAdapter.saveAll({
        kadenaSeeds: [
          seed("legacy-prime"),
          { ...seed("legacy-extra"), id: "legacy-extra" },
        ],
        ouroAccounts: [ouro("legacy-ouro")],
        pureKeypairs: [],
        addressBook: [],
        watchList: [],
        uiSettings: store.getState().uiSettings,
        schemaVersion: 0,
        lastUpdatedAt: "2026-05-01T10:00:00.000Z",
        lastUpdatedDevice: "dev",
      });

      // Fresh store, init from legacy adapter — migration should fire.
      const legacyStore = createCodexStore();
      await legacyStore.getState().actions.init(legacyAdapter);

      const seeds = legacyStore.getState().kadenaSeeds;
      expect(seeds.find((x) => x.id === "legacy-prime")?.isPrime).toBe(true);
      expect(seeds.find((x) => x.id === "legacy-extra")?.isPrime).toBeFalsy();

      // Persisted: adapter reflects the flag.
      const snap = await legacyAdapter.loadAll();
      expect(snap.kadenaSeeds.find((x) => x.id === "legacy-prime")?.isPrime).toBe(
        true
      );
    });

    it("loading a v0.2.0 codex (already has prime flag) is a no-op", async () => {
      const v2Adapter = new MemoryCodexAdapter();
      await v2Adapter.saveAll({
        kadenaSeeds: [{ ...seed("already-prime"), isPrime: true }],
        ouroAccounts: [{ ...ouro("o1"), isPrime: true, parentSeedId: "already-prime" }],
        pureKeypairs: [],
        addressBook: [],
        watchList: [],
        uiSettings: store.getState().uiSettings,
        schemaVersion: 1,
        lastUpdatedAt: "2026-05-26T10:00:00.000Z",
        lastUpdatedDevice: "dev",
      });
      const v2Store = createCodexStore();
      await v2Store.getState().actions.init(v2Adapter);
      // Still prime, no double-flagging, no errors.
      expect(v2Store.getState().kadenaSeeds[0]?.isPrime).toBe(true);
      expect(v2Store.getState().ouroAccounts[0]?.parentSeedId).toBe(
        "already-prime"
      );
    });

    it("loading an empty codex skips migration entirely", async () => {
      // beforeEach already initted with an empty adapter — no errors and
      // no spurious flags should appear.
      expect(store.getState().kadenaSeeds).toHaveLength(0);
      expect(store.getState().ouroAccounts).toHaveLength(0);
    });
  });
});
