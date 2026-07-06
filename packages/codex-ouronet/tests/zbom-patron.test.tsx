/**
 * ZBOM Zone 1 — PATRON subsystem (Wave 5).
 *
 * Covers the store-backed port of OuronetUI's patron selection:
 *   - usePatronSelectionDefaults — maps uiSettings.patronSelectionMode to the
 *     selector seed + the autoSelectBestPatron flag.
 *   - usePatronAutoSelect — picks a codex-satisfiable patron per the setting,
 *     with the wealthiest-fallback + user-override behavior.
 *
 * (The presentational PatronZone selector was retired with the descriptor-driven
 * ZBOM shell; the verbatim-cloned modals carry their own patron block.)
 *
 * getIgnisBalance is injected (test seam) so no chain read happens; the store
 * is seeded via MemoryCodexAdapter exactly like the other hook tests.
 */

import * as React from "react";
import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter, emptySnapshot } from "@ancientpantheon/codex-ouronet/adapters";
import { useActiveWallet } from "@ancientpantheon/codex-ouronet/hooks";
import {
  usePatronSelectionDefaults,
  usePatronAutoSelect,
} from "@ancientpantheon/codex-ouronet/zbom";
import type {
  IOuroAccount,
  IStoaChainSeed,
  PatronSelectionMode,
} from "@ancientpantheon/codex-ouronet/types";

// ── Fixtures ────────────────────────────────────────────────────────────────

function acct(over: Partial<IOuroAccount> & { id: string; address: string }): IOuroAccount {
  return {
    name: undefined,
    version: "1.0",
    isSmart: false,
    guard: { pred: "keys-all", keys: [] },
    stoaChainLedger: null,
    publicKey: "",
    secret: "",
    backup: "",
    isActive: true,
    ...over,
  };
}

const PRIME = acct({ id: "a", address: "Ѻ.AAAprimeAAA", isPrime: true, guard: { pred: "keys-all", keys: ["pubA"] } });
const B = acct({ id: "b", address: "Ѻ.BBBrichBBB", guard: { pred: "keys-all", keys: ["pubB"] } });
// Guard key NOT present in the codex seed → not satisfiable even if richest.
const C = acct({ id: "c", address: "Ѻ.CCCforeignCCC", guard: { pred: "keys-all", keys: ["pubForeign"] } });

const SEED: IStoaChainSeed = {
  id: "seed-1",
  seedType: "koala",
  version: "1.0",
  index: 0,
  secret: "enc",
  main: "main",
  createdAt: "2026-06-01T00:00:00.000Z",
  isPrime: true,
  accounts: [
    { index: 0, publicKey: "pubA", derivationPath: "m/0" },
    { index: 1, publicKey: "pubB", derivationPath: "m/1" },
  ],
};

async function seededAdapter(
  setting: PatronSelectionMode,
  accounts: IOuroAccount[] = [PRIME, B, C],
): Promise<MemoryCodexAdapter> {
  const adapter = new MemoryCodexAdapter("dev");
  const base = emptySnapshot("dev");
  await adapter.saveAll({
    ...base,
    ouroAccounts: accounts,
    kadenaSeeds: [SEED],
    uiSettings: { ...base.uiSettings, patronSelectionMode: setting },
  });
  return adapter;
}

function mkWrapper(adapter: MemoryCodexAdapter) {
  return ({ children }: { children: React.ReactNode }) => (
    <CodexProvider adapter={adapter}>{children}</CodexProvider>
  );
}

/** Injected balance reader keyed by account address. */
function balanceReader(map: Record<string, number>) {
  return async (address: string): Promise<string | null> =>
    address in map ? String(map[address]) : null;
}

// ── usePatronSelectionDefaults ──────────────────────────────────────────────

describe("usePatronSelectionDefaults", () => {
  it("wealthiest → seed 'prime' + autoSelectBestPatron true", async () => {
    const adapter = await seededAdapter("wealthiest");
    const { result } = renderHook(() => usePatronSelectionDefaults(), { wrapper: mkWrapper(adapter) });
    await waitFor(() => expect(result.current.setting).toBe("wealthiest"));
    expect(result.current.initialPatronMode).toBe("prime");
    expect(result.current.autoSelectBestPatron).toBe(true);
  });

  it("prime → seed 'prime' + autoSelectBestPatron false", async () => {
    const adapter = await seededAdapter("prime");
    const { result } = renderHook(() => usePatronSelectionDefaults(), { wrapper: mkWrapper(adapter) });
    await waitFor(() => expect(result.current.setting).toBe("prime"));
    expect(result.current.initialPatronMode).toBe("prime");
    expect(result.current.autoSelectBestPatron).toBe(false);
  });

  it("resident → seed 'resident' + autoSelectBestPatron false", async () => {
    const adapter = await seededAdapter("resident");
    const { result } = renderHook(() => usePatronSelectionDefaults(), { wrapper: mkWrapper(adapter) });
    await waitFor(() => expect(result.current.setting).toBe("resident"));
    expect(result.current.initialPatronMode).toBe("resident");
    expect(result.current.autoSelectBestPatron).toBe(false);
  });
});

// ── usePatronAutoSelect ─────────────────────────────────────────────────────

describe("usePatronAutoSelect", () => {
  it("wealthiest mode picks the richest codex-satisfiable account (skips unsatisfiable C)", async () => {
    const adapter = await seededAdapter("wealthiest");
    const getIgnisBalance = balanceReader({ [PRIME.address]: 5, [B.address]: 100, [C.address]: 1000 });
    const { result } = renderHook(() => usePatronAutoSelect({ getIgnisBalance }), {
      wrapper: mkWrapper(adapter),
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    // C is richest but unsatisfiable → B wins.
    expect(result.current.patronAccount?.address).toBe(B.address);
    expect(result.current.patronLabel).toBe("Wealthiest Patron");
  });

  it("prime mode selects the CodexPrime account", async () => {
    const adapter = await seededAdapter("prime");
    const getIgnisBalance = balanceReader({ [PRIME.address]: 5, [B.address]: 100 });
    const { result } = renderHook(() => usePatronAutoSelect({ getIgnisBalance }), {
      wrapper: mkWrapper(adapter),
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.patronAccount?.address).toBe(PRIME.address);
    expect(result.current.patronMode).toBe("prime");
  });

  it("resident mode selects the active ouro account", async () => {
    const adapter = await seededAdapter("resident");
    const getIgnisBalance = balanceReader({ [PRIME.address]: 5, [B.address]: 100 });
    const { result } = renderHook(
      () => ({ patron: usePatronAutoSelect({ getIgnisBalance }), active: useActiveWallet() }),
      { wrapper: mkWrapper(adapter) },
    );
    await waitFor(() => expect(result.current.patron.isReady).toBe(true));
    await act(async () => {
      result.current.active.setActiveOuroAccount("b");
    });
    expect(result.current.active.activeOuroAccount?.address).toBe(B.address);
    await waitFor(() => expect(result.current.patron.patronAccount?.address).toBe(B.address));
    expect(result.current.patron.patronMode).toBe("resident");
  });

  it("checkFallback switches to wealthiest when the preferred patron is short", async () => {
    const adapter = await seededAdapter("prime");
    const getIgnisBalance = balanceReader({ [PRIME.address]: 5, [B.address]: 100 });
    const { result } = renderHook(() => usePatronAutoSelect({ getIgnisBalance }), {
      wrapper: mkWrapper(adapter),
    });
    await waitFor(() => expect(result.current.patronAccount?.address).toBe(PRIME.address));
    act(() => result.current.checkFallback(10)); // prime has 5 < 10 → fall back to B (100)
    await waitFor(() => expect(result.current.patronAccount?.address).toBe(B.address));
    expect(result.current.noViablePatron).toBe(false);
  });

  it("marks noViablePatron when no account can cover the cost", async () => {
    const adapter = await seededAdapter("prime");
    const getIgnisBalance = balanceReader({ [PRIME.address]: 0, [B.address]: 0 });
    const { result } = renderHook(() => usePatronAutoSelect({ getIgnisBalance }), {
      wrapper: mkWrapper(adapter),
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    act(() => result.current.checkFallback(10));
    await waitFor(() => expect(result.current.noViablePatron).toBe(true));
  });

  it("a manual override suppresses the fallback switch", async () => {
    const adapter = await seededAdapter("prime");
    const getIgnisBalance = balanceReader({ [PRIME.address]: 5, [B.address]: 100 });
    const { result } = renderHook(() => usePatronAutoSelect({ getIgnisBalance }), {
      wrapper: mkWrapper(adapter),
    });
    await waitFor(() => expect(result.current.patronAccount?.address).toBe(PRIME.address));
    act(() => result.current.setPatronMode("prime")); // user re-asserts prime → override flag
    act(() => result.current.checkFallback(10)); // would normally switch to B; override blocks it
    // Stays on prime despite insufficiency.
    expect(result.current.patronAccount?.address).toBe(PRIME.address);
  });
});
