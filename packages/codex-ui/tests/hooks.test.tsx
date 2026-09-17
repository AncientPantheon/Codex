/**
 * Hook tests (codex-ui) — the relocated store-consuming hooks under the
 * seam-driven <CodexProvider>.
 *
 * Ported from codex-ouronet's hooks.test.tsx. Two changes vs the source:
 *   - Hooks + provider import from codex-ui's OWN src (the carve target), not
 *     from @ancientpantheon/codex-ouronet/{hooks,provider}.
 *   - The provider's store factory is now an INJECTED `createStore` seam, so the
 *     wrapper passes `createStore={createCodexStore}` — codex-ouronet's real
 *     Zustand store, injected (never value-imported by codex-ui/src).
 *
 * The 14 generic hooks read the store via useCodexStore(); their behaviour is
 * unchanged by the move, so these specs re-pin the read/write contract against
 * the real store to prove the relocation is byte-behaviour-stable.
 *
 * The two StoaChain-bound hooks (useGetKeypair / useSignTransaction) are covered in
 * hooks-kadena-seam.test.tsx against a FAKE resolver seam — they hold no real
 * resolver in codex-ui.
 */

import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

import { CodexProvider, useCodexStore } from "../src/provider/index.js";
import {
  useCodex,
  useActiveWallet,
  useCodexAuth,
  useStoaChainSeeds,
  usePureKeypairs,
  useOuroAccounts,
  useAddressBook,
  useWatchList,
  useCodexBackup,
} from "../src/hooks/index.js";

// codex-ui's OWN import-failure error (a plain Error subclass local to this
// package — NOT the Ouronet CodexImportError; the carve drops the value edge to
// codex-ouronet/errors). Consumers catch it as an Error; these tests assert the
// hook throws THIS local class.
import { CodexImportError } from "../src/hooks/errors.js";

// Value imports here are TEST-only (tests/ is not scanned by the graph guard).
// codex-ui/src carries no value edge to these — the store is injected.
import {
  createCodexStore,
  type CodexStoreState,
} from "@ancientpantheon/codex-ouronet/state";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { CodexPrimeProtectedError } from "@ancientpantheon/codex-ouronet/errors";
import type {
  IStoaChainSeed,
  IOuroAccount,
  IPureKeypair,
  AddressBookEntry,
  WatchListEntry,
} from "@ancientpantheon/codex-ouronet/types";

/** The seed entity, reached through the store state rather than the `/types`
 *  barrel: `IArweaveSeed` is declared in `types/entities.ts` but the barrel
 *  that re-exports the entity names does not (yet) include it — mirrors
 *  codex-ouronet's own `state-arweave-seeds.test.ts` workaround. */
type IArweaveSeed = CodexStoreState["arweaveSeeds"][number];

// --------------------------------------------------------------------
// Fixtures + shared wrapper (createStore seam injected)
// --------------------------------------------------------------------

function mkWrapper(adapter: MemoryCodexAdapter) {
  return ({ children }: { children: React.ReactNode }) => (
    <CodexProvider createStore={createCodexStore} adapter={adapter}>
      {children}
    </CodexProvider>
  );
}

const seedFx = (id = "s1"): IStoaChainSeed => ({
  id,
  name: "Test Seed",
  seedType: "koala",
  version: "1.0.0",
  index: 0,
  secret: "encrypted-secret",
  main: "k:" + "0".repeat(64),
  createdAt: "2026-05-25T10:00:00.000Z",
  accounts: [
    {
      index: 0,
      publicKey: "a".repeat(64),
      derivationPath: "m/44'/626'/0'/0/0",
    },
  ],
});

const ouroFx = (
  id = "o1",
  overrides: Partial<IOuroAccount> = {}
): IOuroAccount => ({
  id,
  name: "Test Ouro",
  version: "1.0.0",
  isSmart: false,
  address: "Ѻ." + id,
  guard: null,
  stoaChainLedger: null,
  publicKey: "pk-" + id,
  secret: "secret-" + id,
  backup: "backup-" + id,
  ...overrides,
});

const pureFx = (id = "p1"): IPureKeypair => ({
  id,
  label: "Test Pure",
  publicKey: "f".repeat(64),
  encryptedPrivateKey: "enc-pk",
  createdAt: "2026-05-25T10:01:00.000Z",
});

const arweaveSeedFx = (id = "ar-seed-1"): IArweaveSeed => ({
  id,
  name: "Prime Arweave Seed",
  secret: "encrypted-arweave-seed",
  createdAt: "2026-05-25T10:00:30.000Z",
  isPrime: true,
});

const watchEntryFx = (id = "watch-1"): WatchListEntry => ({
  id,
  label: "BigMoney",
  address: "kvxXYE6q7v6LrmQJLBEQZ2abWDdVyjQDERqM1YeMvf0",
  type: "arweave",
  createdAt: "2026-05-25T10:00:45.000Z",
});

const addrFx = (id = "a1"): AddressBookEntry => ({
  id,
  name: "Alice",
  address: "Ѻ.alice",
  type: "ouronet",
  createdAt: "2026-05-25T10:02:00.000Z",
  updatedAt: "2026-05-25T10:02:00.000Z",
});

const watchFx = (id = "w1"): WatchListEntry => ({
  id,
  label: "Treasury",
  address: "Ѻ.treasury",
  type: "ouronet",
  createdAt: "2026-05-25T10:03:00.000Z",
});

describe("useCodex", () => {
  let adapter: MemoryCodexAdapter;
  beforeEach(() => {
    adapter = new MemoryCodexAdapter("dev");
  });

  it("starts in not-ready/locked state, transitions to ready after init", async () => {
    const { result } = renderHook(() => useCodex(), {
      wrapper: mkWrapper(adapter),
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.isLocked).toBe(true);
    expect(result.current.isDirty).toBe(false);
    expect(result.current.kadenaSeeds).toEqual([]);
    expect(result.current.ouroAccounts).toEqual([]);
    expect(result.current.initError).toBeNull();
  });

  it("reflects defaults from DEFAULT_UI_SETTINGS", async () => {
    const { result } = renderHook(() => useCodex(), {
      wrapper: mkWrapper(adapter),
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.uiSettings.selectedNode).toBe("node2");
    expect(result.current.uiSettings.passwordCacheMinutes).toBe(1);
  });
});

describe("useCodexAuth", () => {
  let adapter: MemoryCodexAdapter;
  beforeEach(() => {
    adapter = new MemoryCodexAdapter("dev");
  });

  it("authenticate() unlocks the codex and caches password", async () => {
    const { result } = renderHook(() => useCodexAuth(), {
      wrapper: mkWrapper(adapter),
    });
    await waitFor(() => expect(result.current.isLocked).toBe(true));
    act(() => result.current.authenticate("password", 60));
    expect(result.current.isLocked).toBe(false);
    expect(result.current.passwordCacheExpiresAt).toBeGreaterThan(Date.now());
  });

  it("lock() clears the cache", async () => {
    const { result } = renderHook(() => useCodexAuth(), {
      wrapper: mkWrapper(adapter),
    });
    act(() => result.current.authenticate("p", 60));
    expect(result.current.isLocked).toBe(false);
    act(() => result.current.lock());
    expect(result.current.isLocked).toBe(true);
  });
});

describe("useStoaChainSeeds", () => {
  let adapter: MemoryCodexAdapter;
  beforeEach(() => {
    adapter = new MemoryCodexAdapter("dev");
  });

  it("addSeed persists + reflects in state", async () => {
    const { result } = renderHook(() => useStoaChainSeeds(), {
      wrapper: mkWrapper(adapter),
    });
    await waitFor(() => expect(result.current.seeds).toEqual([]));
    await act(async () => {
      await result.current.addSeed(seedFx("s1"));
    });
    expect(result.current.seeds).toHaveLength(1);
    const snap = await adapter.loadAll();
    expect(snap.kadenaSeeds).toHaveLength(1);
  });

  it("deleteSeed removes a non-prime entry", async () => {
    const { result } = renderHook(() => useStoaChainSeeds(), {
      wrapper: mkWrapper(adapter),
    });
    await waitFor(() => expect(result.current.seeds).toEqual([]));
    await act(async () => {
      await result.current.addSeed(seedFx("s1"));
      await result.current.addSeed(seedFx("s2"));
    });
    expect(result.current.seeds).toHaveLength(2);
    await act(async () => {
      await result.current.deleteSeed("s2");
    });
    expect(result.current.seeds.map((s) => s.id)).toEqual(["s1"]);
  });
});

describe("usePureKeypairs", () => {
  it("add + delete roundtrips through adapter", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderHook(() => usePureKeypairs(), {
      wrapper: mkWrapper(adapter),
    });
    await waitFor(() => expect(result.current.keypairs).toEqual([]));
    await act(async () => {
      await result.current.addKeypair(pureFx("p1"));
    });
    expect(result.current.keypairs).toHaveLength(1);
    await act(async () => {
      await result.current.deleteKeypair("p1");
    });
    expect(result.current.keypairs).toEqual([]);
  });
});

describe("useOuroAccounts", () => {
  it("first added account auto-flags isPrime", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderHook(() => useOuroAccounts(), {
      wrapper: mkWrapper(adapter),
    });
    await waitFor(() => expect(result.current.accounts).toEqual([]));
    await act(async () => {
      await result.current.addAccount(ouroFx("first"));
    });
    expect(result.current.accounts[0]?.isPrime).toBe(true);
  });

  it("deleting CodexPrime throws CodexPrimeProtectedError", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderHook(() => useOuroAccounts(), {
      wrapper: mkWrapper(adapter),
    });
    await waitFor(() => expect(result.current.accounts).toEqual([]));
    await act(async () => {
      await result.current.addAccount(ouroFx("prime"));
    });
    await expect(result.current.deleteAccount("prime")).rejects.toThrow(
      CodexPrimeProtectedError
    );
  });
});

describe("useAddressBook", () => {
  it("add + update + delete cycle works", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderHook(() => useAddressBook(), {
      wrapper: mkWrapper(adapter),
    });
    await waitFor(() => expect(result.current.entries).toEqual([]));
    await act(async () => {
      await result.current.addEntry(addrFx("a1"));
    });
    expect(result.current.entries).toHaveLength(1);

    await act(async () => {
      await result.current.updateEntry("a1", { name: "Renamed" });
    });
    expect(result.current.entries[0]?.name).toBe("Renamed");

    await act(async () => {
      await result.current.deleteEntry("a1");
    });
    expect(result.current.entries).toEqual([]);
  });
});

describe("useWatchList", () => {
  it("add + delete roundtrips through adapter", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderHook(() => useWatchList(), {
      wrapper: mkWrapper(adapter),
    });
    await waitFor(() => expect(result.current.entries).toEqual([]));
    await act(async () => {
      await result.current.addEntry(watchFx("w1"));
    });
    expect(result.current.entries).toHaveLength(1);
    await act(async () => {
      await result.current.deleteEntry("w1");
    });
    expect(result.current.entries).toEqual([]);
  });
});

describe("useActiveWallet", () => {
  it("returns null active wallet/account on empty codex", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderHook(() => useActiveWallet(), {
      wrapper: mkWrapper(adapter),
    });
    await waitFor(() => {
      expect(result.current.activeStoaChainWalletId).toBeNull();
      expect(result.current.activeOuroAccountId).toBeNull();
    });
    expect(result.current.activeStoaChainWallet).toBeNull();
    expect(result.current.activeOuroAccount).toBeNull();
  });

  it("setActive*() updates id + resolved entity", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderHook(
      () => ({
        active: useActiveWallet(),
        seeds: useStoaChainSeeds(),
      }),
      { wrapper: mkWrapper(adapter) }
    );
    await waitFor(() => expect(result.current.seeds.seeds).toEqual([]));
    await act(async () => {
      await result.current.seeds.addSeed(seedFx("s1"));
      await result.current.seeds.addSeed(seedFx("s2"));
    });
    act(() => result.current.active.setActiveStoaChainWallet("s2"));
    expect(result.current.active.activeStoaChainWalletId).toBe("s2");
    expect(result.current.active.activeStoaChainWallet?.id).toBe("s2");
  });
});

describe("useCodexBackup", () => {
  it("exportForCloud emits the 1.3 codec envelope with pureKeypairs as a bare array (E-02 rewire; no longer the bypassed 1.2 format)", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderHook(
      () => ({
        backup: useCodexBackup(),
        pure: usePureKeypairs(),
        seeds: useStoaChainSeeds(),
      }),
      { wrapper: mkWrapper(adapter) }
    );
    await waitFor(() => expect(result.current.backup.isDirty).toBe(false));

    await act(async () => {
      await result.current.pure.addKeypair(pureFx("p1"));
      await result.current.seeds.addSeed(seedFx("s1"));
    });

    let json = "";
    await act(async () => {
      json = await result.current.backup.exportForCloud();
    });
    const parsed = JSON.parse(json);
    // The rewire routes the export through buildCodexExport → "1.3" envelope.
    expect(parsed.version).toBe("1.3");
    expect(parsed.kadenaWallets).toHaveLength(1);
    // pureKeypairs travels as a BARE ARRAY (unlike the foreignKeys block).
    expect(Array.isArray(parsed.pureKeypairs)).toBe(true);
    expect(parsed.pureKeypairs).toHaveLength(1);
    expect(parsed.pureKeypairs[0].id).toBe("p1");
  });

  it("foreignKeys round-trip: a 1.3 import unwraps the block to the store's bare array, and a re-export re-wraps it into a block (funds-critical: the Arweave key rides the backup, never silently lost)", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderHook(
      () => ({
        backup: useCodexBackup(),
        codex: useCodex(),
      }),
      { wrapper: mkWrapper(adapter) }
    );
    await waitFor(() => expect(result.current.codex.isReady).toBe(true));

    const fkEntry = {
      id: "ar-1",
      chainId: "arweave" as const,
      label: "AR key",
      encryptedKeyfile: "ENC::arweave-ciphertext",
    };
    // A 1.3 backup on the wire carries foreignKeys as a BLOCK.
    const payload = JSON.stringify({
      version: "1.3",
      exportedAt: "2026-05-25T10:00:00.000Z",
      kadenaWallets: [],
      ouronetWallets: [],
      addressBook: [],
      uiSettings: {
        passwordCacheMinutes: 1,
        patronSelectionMode: "wealthiest" as const,
        selectedNode: "node2" as const,
        customNodeUrl: "",
        customNodeGasLimit: 1_600_000,
        legacyKoalaSigning: false,
        experimentalCurvesEnabled: false,
      },
      foreignKeys: { schemaVersion: 1, keys: [fkEntry] },
    });

    await act(async () => {
      await result.current.backup.importFromCloud(payload);
    });

    // BLOCK → BARE-ARRAY UNWRAP: the in-memory store holds a bare ForeignKeyEntry[]
    // (not the {schemaVersion,keys} object). A non-unwrapped bug would leave a
    // non-array here → the Arweave key silently lost = funds loss.
    const restoredFk = await adapter.loadAll();
    expect(Array.isArray(restoredFk.foreignKeys)).toBe(true);
    expect(restoredFk.foreignKeys).toEqual([fkEntry]);

    // Re-export re-wraps the bare array into a block (writer discipline).
    let json = "";
    await act(async () => {
      json = await result.current.backup.exportForCloud();
    });
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe("1.3");
    expect(Array.isArray(parsed.foreignKeys)).toBe(false);
    expect(parsed.foreignKeys.keys).toEqual([fkEntry]);
    expect(parsed.foreignKeys.keys[0].encryptedKeyfile).toBe(fkEntry.encryptedKeyfile);
  });

  it("importFromCloud rehydrates seeds + ouroAccounts + pureKeypairs", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderHook(
      () => ({
        backup: useCodexBackup(),
        codex: useCodex(),
      }),
      { wrapper: mkWrapper(adapter) }
    );
    await waitFor(() => expect(result.current.codex.isReady).toBe(true));

    const payload = JSON.stringify({
      version: "1.2",
      exportedAt: "2026-05-25T10:00:00.000Z",
      kadenaWallets: [seedFx("imported-seed")],
      ouronetWallets: [ouroFx("imported-ouro")],
      addressBook: [addrFx("imported-addr")],
      pureKeypairs: [pureFx("imported-pure")],
      uiSettings: {
        passwordCacheMinutes: 99,
        patronSelectionMode: "wealthiest" as const,
        selectedNode: "node2" as const,
        customNodeUrl: "",
        customNodeGasLimit: 1_600_000,
        legacyKoalaSigning: false,
        experimentalCurvesEnabled: false,
      },
    });
    await act(async () => {
      await result.current.backup.importFromCloud(payload);
    });
    expect(result.current.codex.kadenaSeeds).toHaveLength(1);
    expect(result.current.codex.ouroAccounts).toHaveLength(1);
    expect(result.current.codex.pureKeypairs).toHaveLength(1);
    expect(result.current.codex.uiSettings.passwordCacheMinutes).toBe(99);
  });

  it("importFromCloud PRESERVES codexIdentity + consumerSettings (a restore must NOT wipe the double-Apollo identity when the backup omits them, N-09)", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    // Pre-seed the adapter so the provider's init hydrates a codexIdentity +
    // consumerSettings into live store state BEFORE the import runs.
    const identity = { apolloA: "AAA", apolloB: "BBB", totalWordCount: 24 };
    const settings = { library: { schemaVersion: 1, settings: {} } };
    await adapter.saveCodexIdentity(identity as never);
    await adapter.saveConsumerSettings(settings as never);

    const { result } = renderHook(
      () => ({
        backup: useCodexBackup(),
        codex: useCodex(),
      }),
      { wrapper: mkWrapper(adapter) }
    );
    await waitFor(() => expect(result.current.codex.isReady).toBe(true));

    // A backup that carries NO codexIdentity / consumerSettings.
    const payload = JSON.stringify({
      version: "1.3",
      exportedAt: "2026-05-25T10:00:00.000Z",
      kadenaWallets: [seedFx("imported-seed")],
      ouronetWallets: [],
      addressBook: [],
      uiSettings: {
        passwordCacheMinutes: 1,
        patronSelectionMode: "wealthiest" as const,
        selectedNode: "node2" as const,
        customNodeUrl: "",
        customNodeGasLimit: 1_600_000,
        legacyKoalaSigning: false,
        experimentalCurvesEnabled: false,
      },
    });
    await act(async () => {
      await result.current.backup.importFromCloud(payload);
    });

    // The restore must PRESERVE the live identity/settings, not wipe them to
    // undefined/{} just because the backup file omitted them.
    const snap = await adapter.loadAll();
    expect(snap.codexIdentity).toEqual(identity);
    expect(snap.consumerSettings).toEqual(settings);
  });

  it("importFromCloud accepts a 1.3 backup (READER-BEFORE-WRITER: the reader takes BOTH 1.2 and the emitted 1.3)", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderHook(
      () => ({ backup: useCodexBackup(), codex: useCodex() }),
      { wrapper: mkWrapper(adapter) }
    );
    await waitFor(() => expect(result.current.codex.isReady).toBe(true));
    const payload = JSON.stringify({
      version: "1.3",
      exportedAt: "2026-05-25T10:00:00.000Z",
      kadenaWallets: [seedFx("v13-seed")],
      ouronetWallets: [],
      addressBook: [],
      pureKeypairs: [pureFx("v13-pure")],
      uiSettings: {
        passwordCacheMinutes: 1,
        patronSelectionMode: "wealthiest" as const,
        selectedNode: "node2" as const,
        customNodeUrl: "",
        customNodeGasLimit: 1_600_000,
        legacyKoalaSigning: false,
        experimentalCurvesEnabled: false,
      },
    });
    await act(async () => {
      await result.current.backup.importFromCloud(payload);
    });
    expect(result.current.codex.kadenaSeeds).toHaveLength(1);
    expect(result.current.codex.pureKeypairs.map((p) => p.id)).toEqual(["v13-pure"]);
  });

  it("importFromCloud tolerates missing pureKeypairs (pre-v1.0.9 backups)", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderHook(
      () => ({
        backup: useCodexBackup(),
        codex: useCodex(),
      }),
      { wrapper: mkWrapper(adapter) }
    );
    await waitFor(() => expect(result.current.codex.isReady).toBe(true));
    const payload = JSON.stringify({
      version: "1.2",
      exportedAt: "2026-01-01T00:00:00.000Z",
      kadenaWallets: [],
      ouronetWallets: [],
      addressBook: [],
      uiSettings: {
        passwordCacheMinutes: 1,
        patronSelectionMode: "wealthiest" as const,
        selectedNode: "node2" as const,
        customNodeUrl: "",
        customNodeGasLimit: 1_600_000,
        legacyKoalaSigning: false,
        experimentalCurvesEnabled: false,
      },
    });
    await act(async () => {
      await result.current.backup.importFromCloud(payload);
    });
    expect(result.current.codex.pureKeypairs).toEqual([]);
  });

  it("arweaveSeeds round-trip: exportForCloud → importFromCloud into a FRESH store restores the Prime Arweave Seed byte-for-byte, isPrime included (funds-critical: fixes the reported save+reload seed-vanishes incident)", async () => {
    const sourceAdapter = new MemoryCodexAdapter("dev");
    const source = renderHook(
      () => ({
        backup: useCodexBackup(),
        store: useCodexStore(),
      }),
      { wrapper: mkWrapper(sourceAdapter) }
    );
    await waitFor(() => expect(source.result.current.backup.isDirty).toBe(false));

    const primeSeed = arweaveSeedFx("ar-seed-1");
    await act(async () => {
      await source.result.current.store.getState().actions.addArweaveSeed(primeSeed);
    });

    let json = "";
    await act(async () => {
      json = await source.result.current.backup.exportForCloud();
    });
    // The exported envelope actually carries arweaveSeeds as a bare array —
    // before the fix, buildCodexExport had no awareness of the field and
    // never emitted it (the export-side half of the reported loss).
    const exported = JSON.parse(json);
    expect(exported.arweaveSeeds).toEqual([primeSeed]);

    // Import into a FRESH, independent store/adapter (simulates the reload).
    const targetAdapter = new MemoryCodexAdapter("dev");
    const target = renderHook(() => useCodexBackup(), {
      wrapper: mkWrapper(targetAdapter),
    });
    await act(async () => {
      await target.result.current.importFromCloud(json);
    });

    const restored = await targetAdapter.loadAll();
    expect(restored.arweaveSeeds).toEqual([primeSeed]);
    expect(restored.arweaveSeeds?.[0].isPrime).toBe(true);
  });

  it("importFromCloud PRESERVES existing arweaveSeeds when the backup omits the field (a pre-Arweave-seed backup must not wipe a live Prime Arweave Seed)", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    // Pre-seed the live store with a Prime Arweave Seed before the import runs.
    const primeSeed = arweaveSeedFx("ar-seed-live");
    const { result } = renderHook(
      () => ({
        backup: useCodexBackup(),
        store: useCodexStore(),
        codex: useCodex(),
      }),
      { wrapper: mkWrapper(adapter) }
    );
    await waitFor(() => expect(result.current.codex.isReady).toBe(true));
    await act(async () => {
      await result.current.store.getState().actions.addArweaveSeed(primeSeed);
    });

    // A "1.2" backup — written before Arweave seeds existed — carries no
    // arweaveSeeds field at all.
    const payload = JSON.stringify({
      version: "1.2",
      exportedAt: "2024-11-02T09:14:33.000Z",
      kadenaWallets: [],
      ouronetWallets: [],
      addressBook: [],
      uiSettings: {
        passwordCacheMinutes: 1,
        patronSelectionMode: "wealthiest" as const,
        selectedNode: "node2" as const,
        customNodeUrl: "",
        customNodeGasLimit: 1_600_000,
        legacyKoalaSigning: false,
        experimentalCurvesEnabled: false,
      },
    });
    await act(async () => {
      await result.current.backup.importFromCloud(payload);
    });

    // The restore must PRESERVE the live Prime Arweave Seed, not wipe it to []
    // just because the backup file omitted the field entirely — this is
    // exactly the reported incident's wipe mechanism.
    const restored = await adapter.loadAll();
    expect(restored.arweaveSeeds).toEqual([primeSeed]);
  });

  it("watchList round-trip: exportForCloud → importFromCloud into a FRESH store restores a watched address (fixes the reported codex-save vanishes incident)", async () => {
    const sourceAdapter = new MemoryCodexAdapter("dev");
    const source = renderHook(
      () => ({
        backup: useCodexBackup(),
        store: useCodexStore(),
      }),
      { wrapper: mkWrapper(sourceAdapter) }
    );
    await waitFor(() => expect(source.result.current.backup.isDirty).toBe(false));

    const watched = watchEntryFx("watch-1");
    await act(async () => {
      await source.result.current.store.getState().actions.addWatchListEntry(watched);
    });

    let json = "";
    await act(async () => {
      json = await source.result.current.backup.exportForCloud();
    });
    // The exported envelope actually carries watchList as a bare array —
    // before the fix, buildBackupPayload never threaded it into
    // buildCodexExport at all (the export-side half of the reported loss).
    const exported = JSON.parse(json);
    expect(exported.watchList).toEqual([watched]);

    // Import into a FRESH, independent store/adapter (simulates the reload).
    const targetAdapter = new MemoryCodexAdapter("dev");
    const target = renderHook(() => useCodexBackup(), {
      wrapper: mkWrapper(targetAdapter),
    });
    await act(async () => {
      await target.result.current.importFromCloud(json);
    });

    const restored = await targetAdapter.loadAll();
    expect(restored.watchList).toEqual([watched]);
  });

  it("importFromCloud PRESERVES existing watchList when the backup omits the field (a pre-watchlist backup must not wipe a live watched address)", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const watched = watchEntryFx("watch-live");
    const { result } = renderHook(
      () => ({
        backup: useCodexBackup(),
        store: useCodexStore(),
        codex: useCodex(),
      }),
      { wrapper: mkWrapper(adapter) }
    );
    await waitFor(() => expect(result.current.codex.isReady).toBe(true));
    await act(async () => {
      await result.current.store.getState().actions.addWatchListEntry(watched);
    });

    // A "1.2" backup — written before watchList existed in the codec — carries
    // no watchList field at all.
    const payload = JSON.stringify({
      version: "1.2",
      exportedAt: "2024-11-02T09:14:33.000Z",
      kadenaWallets: [],
      ouronetWallets: [],
      addressBook: [],
      uiSettings: {
        passwordCacheMinutes: 1,
        patronSelectionMode: "wealthiest" as const,
        selectedNode: "node2" as const,
        customNodeUrl: "",
        customNodeGasLimit: 1_600_000,
        legacyKoalaSigning: false,
        experimentalCurvesEnabled: false,
      },
    });
    await act(async () => {
      await result.current.backup.importFromCloud(payload);
    });

    // The restore must PRESERVE the live watched address, not wipe it to []
    // just because the backup file omitted the field entirely.
    const restored = await adapter.loadAll();
    expect(restored.watchList).toEqual([watched]);
  });

  it("importFromCloud throws CodexImportError on malformed JSON", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderHook(() => useCodexBackup(), {
      wrapper: mkWrapper(adapter),
    });
    await expect(
      result.current.importFromCloud("not-valid-json")
    ).rejects.toThrow(CodexImportError);
  });

  it("importFromCloud throws CodexImportError on wrong version", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderHook(() => useCodexBackup(), {
      wrapper: mkWrapper(adapter),
    });
    await expect(
      result.current.importFromCloud(JSON.stringify({ version: "2.0" }))
    ).rejects.toThrow(CodexImportError);
  });
});
