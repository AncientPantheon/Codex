/**
 * Hook tests — verify each Phase 5 hook reads + mutates the codex
 * correctly under <CodexProvider>.
 *
 * Strategy: one focused describe per hook. Each uses renderHook +
 * MemoryCodexAdapter under a fresh CodexProvider per test, asserting
 * both the read path (state reflects store updates) and the write
 * path (action mutates store + adapter). Crypto-heavy hooks
 * (useGetKeypair, useSignTransaction) are unit-tested separately
 * in resolver-internal.test.ts — the hook tests here just verify
 * delegation correctness without exercising real crypto twice.
 */

import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

import {
  CodexProvider,
} from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import {
  useCodex,
  useActiveWallet,
  useCodexAuth,
  useKadenaSeeds,
  usePureKeypairs,
  useOuroAccounts,
  useAddressBook,
  useWatchList,
  useCodexBackup,
  useGetKeypair,
} from "@ancientpantheon/codex-ouronet/hooks";
import {
  CodexKeyMissingError,
  CodexLockedError,
  CodexPrimeProtectedError,
  CodexImportError,
} from "@ancientpantheon/codex-ouronet/errors";
import type {
  IKadenaSeed,
  IOuroAccount,
  IPureKeypair,
  AddressBookEntry,
  WatchListEntry,
} from "@ancientpantheon/codex-ouronet/types";

// --------------------------------------------------------------------
// Fixtures + shared wrapper
// --------------------------------------------------------------------

function mkWrapper(adapter: MemoryCodexAdapter) {
  return ({ children }: { children: React.ReactNode }) => (
    <CodexProvider adapter={adapter}>{children}</CodexProvider>
  );
}

const seedFx = (id = "s1"): IKadenaSeed => ({
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
  kadenaLedger: null,
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

// --------------------------------------------------------------------
// useCodex
// --------------------------------------------------------------------

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

// --------------------------------------------------------------------
// useCodexAuth
// --------------------------------------------------------------------

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

  it("getCurrentPassword() throws CodexLockedError when locked", async () => {
    const { result } = renderHook(() => useCodexAuth(), {
      wrapper: mkWrapper(adapter),
    });
    expect(() => result.current.getCurrentPassword()).toThrow(
      CodexLockedError
    );
  });

  it("getCurrentPassword() returns cached value when unlocked", async () => {
    const { result } = renderHook(() => useCodexAuth(), {
      wrapper: mkWrapper(adapter),
    });
    act(() => result.current.authenticate("hunter2", 60));
    expect(result.current.getCurrentPassword()).toBe("hunter2");
  });
});

// --------------------------------------------------------------------
// useKadenaSeeds
// --------------------------------------------------------------------

describe("useKadenaSeeds", () => {
  let adapter: MemoryCodexAdapter;
  beforeEach(() => {
    adapter = new MemoryCodexAdapter("dev");
  });

  it("addSeed persists + reflects in state", async () => {
    const { result } = renderHook(() => useKadenaSeeds(), {
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

  it("deleteSeed removes the entry", async () => {
    const { result } = renderHook(() => useKadenaSeeds(), {
      wrapper: mkWrapper(adapter),
    });
    // Wait for provider's init effect to finish — otherwise init's
    // adapter.loadAll() resolves mid-test and resets state to empty,
    // racing with our addSeed calls. Every test that mutates needs
    // this gate.
    await waitFor(() => expect(result.current.seeds).toEqual([]));
    await act(async () => {
      await result.current.addSeed(seedFx("s1"));
      await result.current.addSeed(seedFx("s2"));
    });
    expect(result.current.seeds).toHaveLength(2);
    // s1 is the Prime Codex Seed (auto-flagged on first add per v0.2.0);
    // delete s2 (non-prime) to exercise the non-prime branch.
    await act(async () => {
      await result.current.deleteSeed("s2");
    });
    expect(result.current.seeds.map((s) => s.id)).toEqual(["s1"]);
  });
});

// --------------------------------------------------------------------
// usePureKeypairs
// --------------------------------------------------------------------

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

// --------------------------------------------------------------------
// useOuroAccounts + CodexPrime guard
// --------------------------------------------------------------------

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
    await expect(
      result.current.deleteAccount("prime")
    ).rejects.toThrow(CodexPrimeProtectedError);
  });
});

// --------------------------------------------------------------------
// useAddressBook
// --------------------------------------------------------------------

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

// --------------------------------------------------------------------
// useWatchList
// --------------------------------------------------------------------

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

// --------------------------------------------------------------------
// useActiveWallet
// --------------------------------------------------------------------

describe("useActiveWallet", () => {
  it("returns null active wallet/account on empty codex", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderHook(() => useActiveWallet(), {
      wrapper: mkWrapper(adapter),
    });
    await waitFor(() => {
      expect(result.current.activeKadenaWalletId).toBeNull();
      expect(result.current.activeOuroAccountId).toBeNull();
    });
    expect(result.current.activeKadenaWallet).toBeNull();
    expect(result.current.activeOuroAccount).toBeNull();
  });

  it("setActive*() updates id + resolved entity", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    // Combine the two hooks so they share one provider mount.
    const { result } = renderHook(
      () => ({
        active: useActiveWallet(),
        seeds: useKadenaSeeds(),
      }),
      { wrapper: mkWrapper(adapter) }
    );
    await waitFor(() => expect(result.current.seeds.seeds).toEqual([]));
    await act(async () => {
      await result.current.seeds.addSeed(seedFx("s1"));
      await result.current.seeds.addSeed(seedFx("s2"));
    });
    act(() => result.current.active.setActiveKadenaWallet("s2"));
    expect(result.current.active.activeKadenaWalletId).toBe("s2");
    expect(result.current.active.activeKadenaWallet?.id).toBe("s2");
  });
});

// --------------------------------------------------------------------
// useGetKeypair (delegation only — real crypto tested in resolver tests)
// --------------------------------------------------------------------

describe("useGetKeypair", () => {
  it("returns a stable function across renders", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result, rerender } = renderHook(() => useGetKeypair(), {
      wrapper: mkWrapper(adapter),
    });
    const fn1 = result.current;
    rerender();
    expect(result.current).toBe(fn1);
  });

  it("throws CodexLockedError when codex is locked", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderHook(() => useGetKeypair(), {
      wrapper: mkWrapper(adapter),
    });
    await expect(result.current("a".repeat(64))).rejects.toThrow(
      CodexLockedError
    );
  });

  it("throws CodexKeyMissingError for unknown pubkey when unlocked", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderHook(
      () => ({
        auth: useCodexAuth(),
        getKeypair: useGetKeypair(),
      }),
      { wrapper: mkWrapper(adapter) }
    );
    act(() => result.current.auth.authenticate("p", 60));
    await expect(
      result.current.getKeypair("c".repeat(64))
    ).rejects.toThrow(CodexKeyMissingError);
  });
});

// --------------------------------------------------------------------
// useCodexBackup
// --------------------------------------------------------------------

describe("useCodexBackup", () => {
  it("exportForCloud returns a parseable v1.2-plus-pureKeypairs JSON", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderHook(
      () => ({
        backup: useCodexBackup(),
        pure: usePureKeypairs(),
        seeds: useKadenaSeeds(),
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
    expect(parsed.version).toBe("1.2");
    expect(parsed.kadenaWallets).toHaveLength(1);
    expect(parsed.pureKeypairs).toHaveLength(1);
    expect(parsed.pureKeypairs[0].id).toBe("p1");
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
      // no pureKeypairs key — like a pre-v1.0.9 backup
    });
    await act(async () => {
      await result.current.backup.importFromCloud(payload);
    });
    expect(result.current.codex.pureKeypairs).toEqual([]);
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
