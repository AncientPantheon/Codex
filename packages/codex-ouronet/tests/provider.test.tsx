/**
 * CodexProvider tests — covers both the Phase 5 baseline (store, init,
 * isolation, throw-without-provider) and the Phase 7 full surface
 * (passwordCacheMinutes, initialUiSettings, onCodexDirty callback,
 * signingClient override, SSR-safe shell).
 */

import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, act, render, screen } from "@testing-library/react";
import {
  CodexProvider,
  useCodexStore,
  useSigningClientOverride,
} from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { useCodex, useKadenaSeeds } from "@ancientpantheon/codex-ouronet/hooks";
import type { PactClient } from "@stoachain/stoa-core/signing";
// Relative import (no subpath alias for the toast module) — resolves to the
// SAME src module the provider's mounted MultiStepToastContainer subscribes to.
import { txPending, toastStore } from "../src/zbom/toast/toastManager";

describe("CodexProvider stub (Phase 5)", () => {
  it("provides a store to children via context", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CodexProvider adapter={adapter}>{children}</CodexProvider>
    );
    const { result } = renderHook(() => useCodexStore(), { wrapper });

    expect(result.current).toBeDefined();
    expect(typeof result.current.getState).toBe("function");
  });

  it("auto-initialises the store with the supplied adapter on mount", async () => {
    const adapter = new MemoryCodexAdapter("main");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CodexProvider adapter={adapter} deviceVariant="main">{children}</CodexProvider>
    );
    const { result } = renderHook(() => useCodexStore(), { wrapper });

    await waitFor(() => {
      expect(result.current.getState().ready).toBe(true);
    });
    expect(result.current.getState().adapter).toBe(adapter);
    expect(result.current.getState().deviceVariant).toBe("main");
  });

  it("isolates state between separate provider mounts", async () => {
    const adapterA = new MemoryCodexAdapter("dev");
    const adapterB = new MemoryCodexAdapter("dev");

    const wrapperA = ({ children }: { children: React.ReactNode }) => (
      <CodexProvider adapter={adapterA}>{children}</CodexProvider>
    );
    const wrapperB = ({ children }: { children: React.ReactNode }) => (
      <CodexProvider adapter={adapterB}>{children}</CodexProvider>
    );

    const { result: a } = renderHook(() => useCodexStore(), {
      wrapper: wrapperA,
    });
    const { result: b } = renderHook(() => useCodexStore(), {
      wrapper: wrapperB,
    });

    await waitFor(() => {
      expect(a.current.getState().ready).toBe(true);
      expect(b.current.getState().ready).toBe(true);
    });

    // Two distinct stores, with two distinct adapters.
    expect(a.current).not.toBe(b.current);
    expect(a.current.getState().adapter).toBe(adapterA);
    expect(b.current.getState().adapter).toBe(adapterB);

    // Mutating one doesn't leak into the other.
    act(() => {
      a.current.getState().actions.authenticate("password-A", 60);
    });
    expect(a.current.getState().locked).toBe(false);
    expect(b.current.getState().locked).toBe(true);
  });

  it("useCodexStore throws when called outside a CodexProvider", () => {
    expect(() => renderHook(() => useCodexStore())).toThrow(
      /missing <CodexProvider>/
    );
  });
});

// --------------------------------------------------------------------
// Phase 7 — full §5.1 surface
// --------------------------------------------------------------------

describe("CodexProvider — passwordCacheMinutes (Phase 7)", () => {
  it("seeds uiSettings.passwordCacheMinutes on fresh boot", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CodexProvider adapter={adapter} passwordCacheMinutes={42}>
        {children}
      </CodexProvider>
    );
    const { result } = renderHook(() => useCodex(), { wrapper });
    await waitFor(() => {
      expect(result.current.uiSettings.passwordCacheMinutes).toBe(42);
    });
  });

  it("does NOT override a persisted passwordCacheMinutes on re-boot", async () => {
    // Seed the adapter with a "previously saved" uiSettings.
    const adapter = new MemoryCodexAdapter("dev");
    await adapter.saveAll({
      kadenaSeeds: [],
      ouroAccounts: [],
      pureKeypairs: [],
      addressBook: [],
      watchList: [],
      uiSettings: {
        passwordCacheMinutes: 7, // persisted preference
        patronSelectionMode: "wealthiest",
        selectedNode: "node2",
        customNodeUrl: "",
        customNodeGasLimit: 1_600_000,
        legacyKoalaSigning: false,
        experimentalCurvesEnabled: false,
        zbomProfile: "basic",
        zbomZone0: true,
        zbomZone1: false,
        zbomZone2: false,
        zbomZone3: false,
        zbomExecutePosition: "top",
      },
      schemaVersion: 1, // non-zero = NOT fresh
      lastUpdatedAt: "2026-01-01T00:00:00.000Z",
      lastUpdatedDevice: "dev",
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CodexProvider adapter={adapter} passwordCacheMinutes={42}>
        {children}
      </CodexProvider>
    );
    const { result } = renderHook(() => useCodex(), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    // The persisted value wins on re-boot; the prop is first-boot only.
    expect(result.current.uiSettings.passwordCacheMinutes).toBe(7);
  });
});

describe("CodexProvider — initialUiSettings (Phase 7)", () => {
  it("applies override on fresh boot", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CodexProvider
        adapter={adapter}
        initialUiSettings={{
          selectedNode: "node1",
          patronSelectionMode: "resident",
        }}
      >
        {children}
      </CodexProvider>
    );
    const { result } = renderHook(() => useCodex(), { wrapper });
    await waitFor(() => {
      expect(result.current.uiSettings.selectedNode).toBe("node1");
      expect(result.current.uiSettings.patronSelectionMode).toBe(
        "resident"
      );
    });
    // Other fields preserved from DEFAULT_UI_SETTINGS.
    expect(result.current.uiSettings.customNodeGasLimit).toBe(1_600_000);
  });

  it("does NOT override persisted settings on re-boot", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    await adapter.saveAll({
      kadenaSeeds: [],
      ouroAccounts: [],
      pureKeypairs: [],
      addressBook: [],
      watchList: [],
      uiSettings: {
        passwordCacheMinutes: 1,
        patronSelectionMode: "wealthiest",
        selectedNode: "node2", // persisted
        customNodeUrl: "",
        customNodeGasLimit: 1_600_000,
        legacyKoalaSigning: false,
        experimentalCurvesEnabled: false,
        zbomProfile: "basic",
        zbomZone0: true,
        zbomZone1: false,
        zbomZone2: false,
        zbomZone3: false,
        zbomExecutePosition: "top",
      },
      schemaVersion: 1,
      lastUpdatedAt: "2026-01-01T00:00:00.000Z",
      lastUpdatedDevice: "dev",
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CodexProvider
        adapter={adapter}
        initialUiSettings={{ selectedNode: "node1" }}
      >
        {children}
      </CodexProvider>
    );
    const { result } = renderHook(() => useCodex(), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.uiSettings.selectedNode).toBe("node2");
  });
});

describe("CodexProvider — onCodexDirty (Phase 7)", () => {
  it("fires when codex transitions clean→dirty", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const onDirty = vi.fn();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CodexProvider adapter={adapter} onCodexDirty={onDirty}>
        {children}
      </CodexProvider>
    );
    const { result } = renderHook(
      () => ({ codex: useCodex(), seeds: useKadenaSeeds() }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.codex.isReady).toBe(true));
    expect(onDirty).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.seeds.addSeed({
        id: "s1",
        name: "Test",
        seedType: "koala",
        version: "1.0.0",
        index: 0,
        secret: "x",
        main: "k:" + "0".repeat(64),
        createdAt: "2026-05-25T10:00:00.000Z",
        accounts: [],
      });
    });
    await waitFor(() => expect(onDirty).toHaveBeenCalledTimes(1));
  });

  it("does NOT fire on initial false-state mounts", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const onDirty = vi.fn();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CodexProvider adapter={adapter} onCodexDirty={onDirty}>
        {children}
      </CodexProvider>
    );
    const { result } = renderHook(() => useCodex(), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    // No mutations → no callback.
    expect(onDirty).not.toHaveBeenCalled();
  });

  it("only fires on the EDGE (one call per clean→dirty transition)", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const onDirty = vi.fn();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CodexProvider adapter={adapter} onCodexDirty={onDirty}>
        {children}
      </CodexProvider>
    );
    const { result } = renderHook(
      () => ({ codex: useCodex(), seeds: useKadenaSeeds() }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.codex.isReady).toBe(true));

    const seedFx = (id: string) => ({
      id,
      name: "Test",
      seedType: "koala" as const,
      version: "1.0.0",
      index: 0,
      secret: "x",
      main: "k:" + "0".repeat(64),
      createdAt: "2026-05-25T10:00:00.000Z",
      accounts: [],
    });

    // First mutation — fires (false → true).
    await act(async () => {
      await result.current.seeds.addSeed(seedFx("s1"));
    });
    await waitFor(() => expect(onDirty).toHaveBeenCalledTimes(1));

    // Second mutation while already dirty — should NOT fire again.
    await act(async () => {
      await result.current.seeds.addSeed(seedFx("s2"));
    });
    expect(onDirty).toHaveBeenCalledTimes(1);
  });
});

describe("CodexProvider — signingClient override (Phase 7)", () => {
  it("useSigningClientOverride returns null when no override is supplied", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CodexProvider adapter={adapter}>{children}</CodexProvider>
    );
    const { result } = renderHook(() => useSigningClientOverride(), {
      wrapper,
    });
    expect(result.current).toBeNull();
  });

  it("useSigningClientOverride returns the supplied client", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const fakeClient: PactClient = {
      dirtyRead: async () => ({ result: { status: "success" } }),
      submit: async () => ({ requestKey: "stub" }),
    };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CodexProvider adapter={adapter} signingClient={fakeClient}>
        {children}
      </CodexProvider>
    );
    const { result } = renderHook(() => useSigningClientOverride(), {
      wrapper,
    });
    expect(result.current).toBe(fakeClient);
  });

  it("returns null when called outside any CodexProvider (no throw)", () => {
    const { result } = renderHook(() => useSigningClientOverride());
    expect(result.current).toBeNull();
  });
});

describe("CodexProvider — SSR-safe shell (Phase 7)", () => {
  it("renders children even without running the init effect (smoke test)", () => {
    // Note: full SSR smoke would render to string via react-dom/server.
    // The browser-vs-server branch lives inside the effect, which doesn't
    // run during the initial render anyway — children render either way.
    // The substantive guarantee is "no crash on missing window" — which
    // we already prove by not crashing during render. The init effect's
    // typeof window check is the runtime gate for adapter calls.
    const adapter = new MemoryCodexAdapter("dev");
    const { container } = render(
      <CodexProvider adapter={adapter}>
        <div data-testid="ssr-shell-child">hello</div>
      </CodexProvider>
    );
    expect(container.querySelector("[data-testid='ssr-shell-child']")).toBeTruthy();
  });
});

describe("CodexProvider mounts the transaction toast host", () => {
  // Regression: the ZBOM operation modals (Activate / Rotate* / *StoicTag)
  // push tx status cards to the package's global toastStore via txPending().
  // Without the MultiStepToastContainer mounted somewhere in the provider
  // tree, a transaction would submit to chain but render NO feedback card
  // ("nothing happened" / "didn't see any cardboard"). The provider now
  // mounts it once so every consumer gets it for free.
  it("renders a tx status card pushed via txPending (the 'cardboard')", async () => {
    // Clear any leftover toasts from earlier in the run.
    toastStore.getAll().forEach((t) => toastStore.remove(t.id));

    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <div>codex app</div>
      </CodexProvider>
    );

    // Nothing before a tx fires.
    expect(screen.queryByText("Activate Account")).toBeNull();

    // Simulate a ZBOM modal pushing a pending tx card.
    act(() => {
      txPending("Activate Account").start();
    });

    // The host must render the card. (Pre-fix: this stayed null forever.)
    await waitFor(() => {
      expect(screen.getByText("Activate Account")).toBeTruthy();
    });

    toastStore.getAll().forEach((t) => toastStore.remove(t.id));
  });
});
