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
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
import {
  MemoryCodexAdapter,
  emptySnapshot,
} from "@ancientpantheon/codex-ouronet/adapters";
import { CodexPrimeProtectedError } from "@ancientpantheon/codex-ouronet/errors";

// Direct from-source import (test-only, mirrors this file's own
// `CodexImportError` import above): `buildDefaultBackupFilename` is a plain
// named export of the hook module, not re-exported through the package's
// public `hooks/index.ts` barrel — it is downloadAsJson's own filename
// template, pulled out to a pure function purely so the "unversioned"
// branch (impossible to reach end-to-end post-T1, see below) is directly
// unit-testable.
import { buildDefaultBackupFilename } from "../src/hooks/useCodexBackup.js";
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

  /**
   * Owner-reported incident: "i loaded a codex, upgraded it, then exported
   * it. It is now versioned. I loaded again, it still says its not
   * versioned."
   *
   * Their real export (checked on disk) DOES carry
   * `Codex_Shape_Version: "1.0.0"` at the top level — the writer side is
   * fine, and the filename even reads `OuronetCodex_v1.0.0_...`. The loss
   * is on the READ side: `importFromCloud` rebuilds a `CodexSnapshot`
   * field by field and simply never assigned this one, so every import
   * silently dropped the stamp and the codex came back "not versioned".
   *
   * Exactly the same class as the `watchList` / `arweaveSeeds` /
   * `foreignKeys` losses this hook's own comments already document — the
   * fourth instance of it, missed because nothing tested the stamp across
   * a round trip.
   */
  it("an UNFINISHED migration survives an export -> import round trip, so it can resume on another device", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderHook(
      () => ({ backup: useCodexBackup(), codex: useCodex() }),
      { wrapper: mkWrapper(adapter) }
    );
    await waitFor(() => expect(result.current.codex.isReady).toBe(true));

    const run = {
      stage: "selection" as const,
      startedAt: "2026-10-29T10:00:00.000Z",
      updatedAt: "2026-10-29T10:01:00.000Z",
      selection: {
        account: { kind: "existing" as const, accountId: "ouro-7" },
        payment: { kind: "stoic-dalos-position-0" as const },
        guard: { kind: "recommended-single-key" as const },
      },
    };
    const payload = JSON.stringify({
      version: "1.3",
      exportedAt: "2026-10-29T10:01:00.000Z",
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
      migrationProgress: run,
    });

    await act(async () => {
      await result.current.backup.importFromCloud(payload);
    });

    // Persisted, so re-opening the wizard here can resume it...
    expect((await adapter.loadAll()).migrationProgress).toEqual(run);
    // ...and it rides back out, so the half-done run follows the codex on.
    const reExported = await act(async () => result.current.backup.exportForCloud());
    expect(JSON.parse(reExported as unknown as string).migrationProgress).toEqual(run);
  });

  it("the Codex Master Seed row survives an export -> import round trip", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderHook(
      () => ({ backup: useCodexBackup(), codex: useCodex() }),
      { wrapper: mkWrapper(adapter) }
    );
    await waitFor(() => expect(result.current.codex.isReady).toBe(true));

    const row = {
      ouroAccountId: "ouro-1",
      chainwebSeedId: "seed-1",
      arweaveSeedId: "arw-1",
      establishedAt: "2026-10-28T10:00:00.000Z",
    };
    const payload = JSON.stringify({
      version: "1.3",
      exportedAt: "2026-10-28T10:00:00.000Z",
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
      codexMasterSeed: row,
    });

    await act(async () => {
      await result.current.backup.importFromCloud(payload);
    });

    expect((await adapter.loadAll()).codexMasterSeed).toEqual(row);

    // ...and it rides back out, so a restored codex can be re-exported
    // without forgetting which seed it is built on.
    const reExported = await act(async () => result.current.backup.exportForCloud());
    expect(JSON.parse(reExported as unknown as string).codexMasterSeed).toEqual(row);
  });

  it("masterKeyLocks survive an export -> import round trip (a restored codex that forgot its locks re-permits deleting the master's payment key)", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderHook(
      () => ({ backup: useCodexBackup(), codex: useCodex() }),
      { wrapper: mkWrapper(adapter) }
    );
    await waitFor(() => expect(result.current.codex.isReady).toBe(true));

    const locks = [
      { seedId: "seed-1", position: 0, reason: "master-payment-key" as const },
      { seedId: "seed-1", position: 1, reason: "master-guard-key" as const },
      // A custom guard keyset reaching into a SECOND seed — the many-to-many
      // case that is the whole reason this is a registry and not a flag.
      { seedId: "seed-2", position: 7, reason: "master-guard-key" as const },
    ];
    const payload = JSON.stringify({
      version: "1.3",
      exportedAt: "2026-10-27T11:00:40.651Z",
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
      masterKeyLocks: locks,
    });

    await act(async () => {
      await result.current.backup.importFromCloud(payload);
    });

    const restored = await adapter.loadAll();
    expect(restored.masterKeyLocks).toEqual(locks);

    // And they ride straight back out on the next export, so a re-export
    // of a restored codex does not quietly drop the guarantee.
    const reExported = await act(async () => result.current.backup.exportForCloud());
    expect(JSON.parse(reExported as unknown as string).masterKeyLocks).toEqual(locks);
  });

  it("an import that PREDATES locks does NOT wipe this device's existing locks", async () => {
    // Deliberately the opposite of Codex_Shape_Version's no-fallback rule.
    // The stamp describes the shape of the imported data, so absence is the
    // datum. A lock protects a key position from deletion, so absence means
    // only "this backup is older than the feature" — inheriting nothing
    // would silently re-permit deleting the master's payment key.
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderHook(
      () => ({ backup: useCodexBackup(), codex: useCodex() }),
      { wrapper: mkWrapper(adapter) }
    );
    await waitFor(() => expect(result.current.codex.isReady).toBe(true));

    const base = {
      version: "1.3",
      exportedAt: "2026-10-27T11:00:40.651Z",
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
    };
    const locks = [
      { seedId: "seed-1", position: 0, reason: "master-payment-key" as const },
    ];

    await act(async () => {
      await result.current.backup.importFromCloud(
        JSON.stringify({ ...base, masterKeyLocks: locks })
      );
    });
    expect((await adapter.loadAll()).masterKeyLocks).toEqual(locks);

    // A legacy backup with no locks field at all.
    await act(async () => {
      await result.current.backup.importFromCloud(JSON.stringify(base));
    });
    expect((await adapter.loadAll()).masterKeyLocks).toEqual(locks);
  });

  it("Codex_Shape_Version survives an export -> import round trip (owner incident: an upgraded codex came back 'not versioned')", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderHook(
      () => ({ backup: useCodexBackup(), codex: useCodex() }),
      { wrapper: mkWrapper(adapter) }
    );
    await waitFor(() => expect(result.current.codex.isReady).toBe(true));

    // A versioned codex on the wire — exactly what their file looks like.
    const payload = JSON.stringify({
      version: "1.3",
      exportedAt: "2026-10-27T11:00:40.651Z",
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
      Codex_Shape_Version: "1.0.0",
    });

    await act(async () => {
      await result.current.backup.importFromCloud(payload);
    });

    // Persisted...
    const restored = await adapter.loadAll();
    expect(restored.Codex_Shape_Version).toBe("1.0.0");
    // ...and live in the store, which is what the Codex ID page reads to
    // decide "versioned" vs "not versioned".
    await waitFor(() => {
      expect(result.current.codex.Codex_Shape_Version).toBe("1.0.0");
    });

    // And it rides straight back out on the next export.
    let json = "";
    await act(async () => {
      json = await result.current.backup.exportForCloud();
    });
    expect(JSON.parse(json).Codex_Shape_Version).toBe("1.0.0");
  });

  it("an UNVERSIONED backup imported over a versioned codex does NOT inherit the old stamp (the imported data is legacy-shaped; claiming otherwise would skip the migration it needs)", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderHook(
      () => ({ backup: useCodexBackup(), codex: useCodex() }),
      { wrapper: mkWrapper(adapter) }
    );
    await waitFor(() => expect(result.current.codex.isReady).toBe(true));

    const uiSettings = {
      passwordCacheMinutes: 1,
      patronSelectionMode: "wealthiest" as const,
      selectedNode: "node2" as const,
      customNodeUrl: "",
      customNodeGasLimit: 1_600_000,
      legacyKoalaSigning: false,
      experimentalCurvesEnabled: false,
    };
    const base = {
      version: "1.3",
      exportedAt: "2026-10-27T11:00:40.651Z",
      kadenaWallets: [],
      ouronetWallets: [],
      addressBook: [],
      uiSettings,
    };

    // First: a versioned codex.
    await act(async () => {
      await result.current.backup.importFromCloud(
        JSON.stringify({ ...base, Codex_Shape_Version: "1.0.0" })
      );
    });
    await waitFor(() => {
      expect(result.current.codex.Codex_Shape_Version).toBe("1.0.0");
    });

    // Then: a LEGACY export with no stamp. The stamp describes the SHAPE OF
    // THE DATA being imported, so unlike the funds-critical keyrings it must
    // NOT fall back to whatever this device happened to hold — that would
    // mark unmigrated data as migrated and skip its structural upgrade.
    await act(async () => {
      await result.current.backup.importFromCloud(JSON.stringify(base));
    });
    await waitFor(() => {
      expect(result.current.codex.Codex_Shape_Version).toBeUndefined();
    });
    expect((await adapter.loadAll()).Codex_Shape_Version).toBeUndefined();
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

  it("importFromCloud PRESERVES existing foreignKeys when the backup omits the field (a pre-foreignKeys backup must not wipe a live foreign key)", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    // Pre-seed the live store with a foreign key before the import runs.
    const liveFk = {
      id: "ar-live",
      chainId: "arweave" as const,
      label: "Live AR key",
      encryptedKeyfile: "ENC::live-ciphertext",
    };
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
      await result.current.store.getState().actions.addForeignKey(liveFk);
    });

    // A "1.2" backup — written before foreignKeys existed — carries no
    // foreignKeys field at all.
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

    // The restore must PRESERVE the live foreign key, not wipe it to [] just
    // because the backup file omitted the field entirely — the same wipe
    // mechanism already fixed for arweaveSeeds/watchList below, but left
    // unfixed for foreignKeys until now.
    const restored = await adapter.loadAll();
    expect(restored.foreignKeys).toEqual([liveFk]);
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

  // ----------------------------------------------------------------
  // downloadAsJson's default filename — docs/work/codex-shape-version-stamp.
  // A fresh-shaped (post-T3) codex's export filename must itself carry the
  // live `Codex_Shape_Version`, so a user with several exports in a
  // Downloads folder can tell at a glance which shape each one is in,
  // without opening the file.
  // ----------------------------------------------------------------

  describe("downloadAsJson default filename (Codex_Shape_Version)", () => {
    // Each test re-spies `document.createElement`; without restoring between
    // tests the second spy wraps the first test's already-mocked function,
    // which then recurses into itself (stack overflow).
    afterEach(() => {
      vi.restoreAllMocks();
    });

    /** Stubs the browser download mechanism the same way the existing
     *  `<LogoutConfirmModal>` "back up now" test already does (jsdom lacks
     *  `URL.createObjectURL`), PLUS spies on `document.createElement` to
     *  capture the `<a>` that `downloadAsJson` builds — needed here (unlike
     *  that test) because we must read the resulting `.download` string,
     *  not merely confirm a download was attempted. */
    function stubDownloadMechanism() {
      const createObjectURL = vi.fn(() => "blob:codex");
      const revokeObjectURL = vi.fn();
      window.URL.createObjectURL =
        createObjectURL as unknown as typeof window.URL.createObjectURL;
      window.URL.revokeObjectURL =
        revokeObjectURL as unknown as typeof window.URL.revokeObjectURL;

      const realCreateElement = document.createElement.bind(document);
      let anchor: HTMLAnchorElement | null = null;
      vi.spyOn(document, "createElement").mockImplementation(
        (tag: string, ...rest: unknown[]) => {
          const el = (
            realCreateElement as (
              tag: string,
              ...rest: unknown[]
            ) => HTMLElement
          )(tag, ...rest);
          if (tag === "a") anchor = el as HTMLAnchorElement;
          return el;
        }
      );
      return { getAnchor: () => anchor };
    }

    it("downloadAsJson() with no filename argument carries the live Codex_Shape_Version in a.download (regression guard: a fresh T3-stamped codex must not download looking unversioned)", async () => {
      const adapter = new MemoryCodexAdapter("dev");
      await adapter.saveAll({
        ...emptySnapshot("dev"),
        Codex_Shape_Version: "1.0.0",
      });
      const { getAnchor } = stubDownloadMechanism();

      const { result } = renderHook(
        () => ({ backup: useCodexBackup(), codex: useCodex() }),
        { wrapper: mkWrapper(adapter) }
      );
      await waitFor(() => expect(result.current.codex.isReady).toBe(true));

      await act(async () => {
        await result.current.backup.downloadAsJson();
      });

      expect(getAnchor()?.download).toMatch(/^OuronetCodex_v1\.0\.0_.+\.json$/);
    });

    // `codex-id-step-flow`: the export filename must reflect Permaweb
    // eligibility too, not just the shape version — "the codex now finally
    // has the proper shape going forward" (owner, this session).
    it("downloadAsJson() with no filename argument carries a '_permaweb-eligible' marker when primeAlignment is 'aligned'", async () => {
      const adapter = new MemoryCodexAdapter("dev");
      // `primeAlignment` is NOT YET a declared field on the shared
      // `CodexSnapshot` type (it lives on codex-ouronet's own widened
      // `CodexSnapshotWithPrimeAlignment` internally) — same cast
      // `packages/codex-ouronet/tests/state-store.test.ts` already uses to
      // seed/read it through a plain `CodexSnapshot`-typed adapter call.
      await adapter.saveAll({
        ...emptySnapshot("dev"),
        Codex_Shape_Version: "1.0.0",
        primeAlignment: "aligned",
      } as unknown as Parameters<typeof adapter.saveAll>[0]);
      const { getAnchor } = stubDownloadMechanism();

      const { result } = renderHook(
        () => ({ backup: useCodexBackup(), codex: useCodex() }),
        { wrapper: mkWrapper(adapter) }
      );
      await waitFor(() => expect(result.current.codex.isReady).toBe(true));

      await act(async () => {
        await result.current.backup.downloadAsJson();
      });

      expect(getAnchor()?.download).toMatch(
        /^OuronetCodex_v1\.0\.0_permaweb-eligible_.+\.json$/
      );
    });

    it("downloadAsJson() with no filename argument omits the marker when primeAlignment is 'legacy' (the default)", async () => {
      const adapter = new MemoryCodexAdapter("dev");
      await adapter.saveAll({
        ...emptySnapshot("dev"),
        Codex_Shape_Version: "1.0.0",
      });
      const { getAnchor } = stubDownloadMechanism();

      const { result } = renderHook(
        () => ({ backup: useCodexBackup(), codex: useCodex() }),
        { wrapper: mkWrapper(adapter) }
      );
      await waitFor(() => expect(result.current.codex.isReady).toBe(true));

      await act(async () => {
        await result.current.backup.downloadAsJson();
      });

      const download = getAnchor()?.download ?? "";
      expect(download).toMatch(/^OuronetCodex_v1\.0\.0_.+\.json$/);
      expect(download).not.toContain("permaweb-eligible");
    });

    it("downloadAsJson(filename) still overrides the shape-version default entirely (explicit filename must win, unchanged pre-existing behaviour)", async () => {
      const adapter = new MemoryCodexAdapter("dev");
      await adapter.saveAll({
        ...emptySnapshot("dev"),
        Codex_Shape_Version: "1.0.0",
      });
      const { getAnchor } = stubDownloadMechanism();

      const { result } = renderHook(() => useCodexBackup(), {
        wrapper: mkWrapper(adapter),
      });
      await waitFor(() => expect(result.current.isDirty).toBe(false));

      await act(async () => {
        await result.current.downloadAsJson("my-custom-backup-name.json");
      });

      expect(getAnchor()?.download).toBe("my-custom-backup-name.json");
    });
  });
});

// ----------------------------------------------------------------
// buildDefaultBackupFilename — the pure filename-template helper
// `downloadAsJson` builds its default from. No real post-T1 export can ever
// have an `undefined` Codex_Shape_Version (every live codex is at least
// stamped "1.0.0"), so the "unversioned" branch can only be exercised by a
// direct unit test of the template logic itself, never end-to-end through
// the full downloadAsJson flow.
// ----------------------------------------------------------------

describe("buildDefaultBackupFilename", () => {
  it("renders the vX.Y.Z branch when a shape version is present", () => {
    expect(
      buildDefaultBackupFilename("1.0.0", "2026-10-18T00-00-00-000Z")
    ).toBe("OuronetCodex_v1.0.0_2026-10-18T00-00-00-000Z.json");
  });

  it("renders the 'unversioned' branch when the shape version is undefined", () => {
    expect(
      buildDefaultBackupFilename(undefined, "2026-10-18T00-00-00-000Z")
    ).toBe("OuronetCodex_vunversioned_2026-10-18T00-00-00-000Z.json");
  });

  // `codex-id-step-flow`: once BOTH versioning AND Permaweb eligibility are
  // checked, the codex "finally has the proper shape going forward" (owner,
  // this session) — reflected as a `_permaweb-eligible` filename marker.
  it("appends a '_permaweb-eligible' marker when primeAlignment is 'aligned'", () => {
    expect(
      buildDefaultBackupFilename("1.0.0", "2026-10-18T00-00-00-000Z", "aligned")
    ).toBe("OuronetCodex_v1.0.0_permaweb-eligible_2026-10-18T00-00-00-000Z.json");
  });

  it("omits the marker when primeAlignment is 'legacy'", () => {
    expect(
      buildDefaultBackupFilename("1.0.0", "2026-10-18T00-00-00-000Z", "legacy")
    ).toBe("OuronetCodex_v1.0.0_2026-10-18T00-00-00-000Z.json");
  });

  it("omits the marker when primeAlignment is not supplied at all (backward compatible)", () => {
    expect(
      buildDefaultBackupFilename("1.0.0", "2026-10-18T00-00-00-000Z")
    ).toBe("OuronetCodex_v1.0.0_2026-10-18T00-00-00-000Z.json");
  });
});
