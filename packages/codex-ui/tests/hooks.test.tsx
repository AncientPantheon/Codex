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
 * The two Kadena-bound hooks (useGetKeypair / useSignTransaction) are covered in
 * hooks-kadena-seam.test.tsx against a FAKE resolver seam — they hold no real
 * resolver in codex-ui.
 */

import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

import { CodexProvider } from "../src/provider/index.js";
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
} from "../src/hooks/index.js";

// codex-ui's OWN import-failure error (a plain Error subclass local to this
// package — NOT the Ouronet CodexImportError; the carve drops the value edge to
// codex-ouronet/errors). Consumers catch it as an Error; these tests assert the
// hook throws THIS local class.
import { CodexImportError } from "../src/hooks/errors.js";

// Value imports here are TEST-only (tests/ is not scanned by the graph guard).
// codex-ui/src carries no value edge to these — the store is injected.
import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { CodexPrimeProtectedError } from "@ancientpantheon/codex-ouronet/errors";
import type {
  IKadenaSeed,
  IOuroAccount,
  IPureKeypair,
  AddressBookEntry,
  WatchListEntry,
} from "@ancientpantheon/codex-ouronet/types";

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

  it("deleteSeed removes a non-prime entry", async () => {
    const { result } = renderHook(() => useKadenaSeeds(), {
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
      expect(result.current.activeKadenaWalletId).toBeNull();
      expect(result.current.activeOuroAccountId).toBeNull();
    });
    expect(result.current.activeKadenaWallet).toBeNull();
    expect(result.current.activeOuroAccount).toBeNull();
  });

  it("setActive*() updates id + resolved entity", async () => {
    const adapter = new MemoryCodexAdapter("dev");
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
