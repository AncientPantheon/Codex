/**
 * CodexProvider tests (codex-ui) — the relocated, seam-driven provider.
 *
 * The source provider (codex-ouronet) hard-imported three VALUE couplings:
 *   - createCodexStore (Zustand store factory)   → injected `createStore` seam
 *   - MultiStepToastContainer (zbom toast host)  → injected `zbomToast` slot
 *   - PactClient (signing-client type)           → TYPE-ONLY import (no runtime edge)
 * plus it now exposes a resolver-provider context (the `resolverFactory` seam
 * that useGetKeypair/useSignTransaction consume) that codex-ouronet fills.
 *
 * These tests mount the provider against FAKE seams so codex-ui never imports a
 * value @stoachain / createCodexStore / zbom module. They assert:
 *   - the injected store factory is what the context serves (per-mount, isolated)
 *   - the resolver-provider seam is exposed via context and null-safe outside it
 *   - the zbomToast slot renders inside the provider tree (browser)
 *   - the signingClient override context still round-trips (byte-stable prop)
 *   - the SSR shell renders children server-side without running init
 *   - the provider SOURCE carries NO value @stoachain / createCodexStore / zbom import
 */

import * as React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { renderHook, render, screen, act } from "@testing-library/react";
import {
  CodexProvider,
  useCodexStore,
  useSigningClientOverride,
  useResolverProvider,
} from "../src/provider/index.js";
import type { CodexStore } from "../src/provider/index.js";

// ---------------------------------------------------------------------------
// Fakes for the injected seams. NONE of these touch @stoachain / zbom / the
// real Ouronet store — codex-ui stays chain-generic.
// ---------------------------------------------------------------------------

/** The fake store's observable state. Carries an `id` so the specs can assert
 *  the context serves EXACTLY the injected store (per-mount isolation). */
interface FakeStoreState {
  id: string;
  schemaVersion: number;
  dirty: boolean;
  actions: {
    init: ReturnType<typeof vi.fn>;
    updateUiSettings: ReturnType<typeof vi.fn>;
    clearDirty: ReturnType<typeof vi.fn>;
    setDirty: () => void;
  };
}

/** The fake store handle: the narrow surface the provider touches + the extra
 *  surface the specs read (`getState().id`, `__actions`). Kept structurally
 *  separate from `CodexStore` (whose concrete `CodexStoreState` has no `id`);
 *  the injection sites funnel it to the seam via `asCreateStore`. */
type FakeStore = {
  getState: () => FakeStoreState;
  __actions: FakeStoreState["actions"];
};

/** The provider's `createStore` seam types its return as `CodexStore`; the fake
 *  is structurally looser, so funnel it to the seam through this cast. */
const asCreateStore =
  (fake: FakeStore): (() => CodexStore) =>
  () =>
    fake as unknown as CodexStore;

/** A minimal Zustand-shaped store the fake `createStore` seam returns. It only
 *  needs the surface the provider touches: getState().actions.init, subscribe,
 *  and a `dirty` flag for the onCodexDirty edge. */
function makeFakeStore(id: string): FakeStore {
  let dirty = false;
  const listeners = new Set<(s: { dirty: boolean }) => void>();
  const emit = () => listeners.forEach((l) => l({ dirty }));
  const actions = {
    init: vi.fn(async () => {}),
    updateUiSettings: vi.fn(async () => {}),
    clearDirty: vi.fn(() => {
      dirty = false;
    }),
    setDirty: () => {
      dirty = true;
      emit();
    },
  };
  const state: FakeStoreState = { id, schemaVersion: 1, dirty, actions };
  const store = Object.assign(
    () => state,
    {
      getState: () => ({ ...state, dirty }),
      subscribe: (fn: (s: { dirty: boolean }) => void) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      __actions: actions,
    }
  );
  return store as unknown as FakeStore;
}

const fakeAdapter = { name: "memory-fake" } as never;

function FakeToast() {
  return <div data-testid="zbom-toast-slot">toast-host</div>;
}

describe("CodexProvider — injected store-factory seam", () => {
  it("serves the store produced by the injected createStore, not a hardcoded one", () => {
    const injected = makeFakeStore("injected-A");
    const createStore = vi.fn(asCreateStore(injected));
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CodexProvider createStore={createStore} adapter={fakeAdapter}>
        {children}
      </CodexProvider>
    );
    const { result } = renderHook(() => useCodexStore(), { wrapper });

    // The context serves EXACTLY the object the seam returned — proving the
    // provider does not import its own createCodexStore.
    expect(createStore).toHaveBeenCalledTimes(1);
    expect(result.current as unknown).toBe(injected);
    expect((result.current as unknown as FakeStore).getState().id).toBe(
      "injected-A"
    );
  });

  it("gives each mount its own store from the seam (per-mount isolation)", () => {
    const storeA = makeFakeStore("A");
    const storeB = makeFakeStore("B");
    const wrapA = ({ children }: { children: React.ReactNode }) => (
      <CodexProvider createStore={asCreateStore(storeA)} adapter={fakeAdapter}>
        {children}
      </CodexProvider>
    );
    const wrapB = ({ children }: { children: React.ReactNode }) => (
      <CodexProvider createStore={asCreateStore(storeB)} adapter={fakeAdapter}>
        {children}
      </CodexProvider>
    );
    const { result: a } = renderHook(() => useCodexStore(), { wrapper: wrapA });
    const { result: b } = renderHook(() => useCodexStore(), { wrapper: wrapB });

    expect(a.current).not.toBe(b.current);
    expect((a.current as unknown as FakeStore).getState().id).toBe("A");
    expect((b.current as unknown as FakeStore).getState().id).toBe("B");
  });

  it("useCodexStore throws when called outside a CodexProvider", () => {
    expect(() => renderHook(() => useCodexStore())).toThrow(
      /missing <CodexProvider>/
    );
  });
});

describe("CodexProvider — resolver-provider context seam", () => {
  it("exposes the resolver built by the injected resolverFactory via useResolverProvider", () => {
    const resolver = {
      getKeyPairByPublicKey: vi.fn(async () => ({ publicKey: "k:pub" })),
    };
    const resolverFactory = vi.fn(() => resolver);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CodexProvider
        createStore={asCreateStore(makeFakeStore("R"))}
        adapter={fakeAdapter}
        resolverFactory={resolverFactory}
      >
        {children}
      </CodexProvider>
    );
    const { result } = renderHook(() => useResolverProvider(), { wrapper });

    // The seam is invoked with the mounted store, and its product is what the
    // context serves — the shape useGetKeypair/useSignTransaction (T9.4) consume.
    expect(resolverFactory).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(resolver);
    expect(typeof result.current!.getKeyPairByPublicKey).toBe("function");
  });

  it("returns null from useResolverProvider when no resolverFactory is supplied", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CodexProvider createStore={asCreateStore(makeFakeStore("N"))} adapter={fakeAdapter}>
        {children}
      </CodexProvider>
    );
    const { result } = renderHook(() => useResolverProvider(), { wrapper });
    expect(result.current).toBeNull();
  });

  it("returns null from useResolverProvider outside any provider (no throw)", () => {
    const { result } = renderHook(() => useResolverProvider());
    expect(result.current).toBeNull();
  });
});

describe("CodexProvider — injected zbomToast slot", () => {
  it("renders the injected zbomToast inside the provider tree", () => {
    render(
      <CodexProvider
        createStore={asCreateStore(makeFakeStore("Z"))}
        adapter={fakeAdapter}
        zbomToast={<FakeToast />}
      >
        <div>app</div>
      </CodexProvider>
    );
    // The provider mounts the slot content — the zbom value edge is now a prop.
    expect(screen.getByTestId("zbom-toast-slot")).toBeTruthy();
  });

  it("renders nothing extra when no zbomToast is supplied", () => {
    render(
      <CodexProvider createStore={asCreateStore(makeFakeStore("Z0"))} adapter={fakeAdapter}>
        <div data-testid="only-child">app</div>
      </CodexProvider>
    );
    expect(screen.queryByTestId("zbom-toast-slot")).toBeNull();
    expect(screen.getByTestId("only-child")).toBeTruthy();
  });
});

describe("CodexProvider — signingClient override (byte-stable prop)", () => {
  it("useSigningClientOverride returns the supplied client", () => {
    const fakeClient = { dirtyRead: vi.fn(), submit: vi.fn() } as never;
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CodexProvider
        createStore={asCreateStore(makeFakeStore("S"))}
        adapter={fakeAdapter}
        signingClient={fakeClient}
      >
        {children}
      </CodexProvider>
    );
    const { result } = renderHook(() => useSigningClientOverride(), { wrapper });
    expect(result.current).toBe(fakeClient);
  });

  it("useSigningClientOverride returns null when no override supplied", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CodexProvider createStore={asCreateStore(makeFakeStore("S0"))} adapter={fakeAdapter}>
        {children}
      </CodexProvider>
    );
    const { result } = renderHook(() => useSigningClientOverride(), { wrapper });
    expect(result.current).toBeNull();
  });
});

describe("CodexProvider — SSR shell + init effect", () => {
  it("renders children even before/without init running (SSR-safe shell)", () => {
    const { container } = render(
      <CodexProvider createStore={asCreateStore(makeFakeStore("SSR"))} adapter={fakeAdapter}>
        <div data-testid="ssr-child">hello</div>
      </CodexProvider>
    );
    expect(container.querySelector("[data-testid='ssr-child']")).toBeTruthy();
  });

  it("runs the injected store's init action once the browser effect fires", async () => {
    const store = makeFakeStore("INIT");
    render(
      <CodexProvider
        createStore={asCreateStore(store)}
        adapter={fakeAdapter}
        deviceVariant="main"
      >
        <div>app</div>
      </CodexProvider>
    );
    await vi.waitFor(() => {
      expect(store.__actions.init).toHaveBeenCalledWith(fakeAdapter, "main");
    });
  });

  it("fires onCodexDirty on the clean→dirty edge exactly once", async () => {
    const store = makeFakeStore("DIRTY");
    const onDirty = vi.fn();
    render(
      <CodexProvider
        createStore={asCreateStore(store)}
        adapter={fakeAdapter}
        onCodexDirty={onDirty}
      >
        <div>app</div>
      </CodexProvider>
    );
    await vi.waitFor(() => expect(store.__actions.init).toHaveBeenCalled());
    expect(onDirty).not.toHaveBeenCalled();

    act(() => {
      store.getState().actions.setDirty();
    });
    await vi.waitFor(() => expect(onDirty).toHaveBeenCalledTimes(1));
  });
});

describe("CodexProvider source — no value @stoachain/createCodexStore/zbom edge", () => {
  const providerSrc = readFileSync(
    resolve(__dirname, "../src/provider/CodexProvider.tsx"),
    "utf8"
  );

  it("has no VALUE @stoachain import (type-only PactClient is allowed)", () => {
    // Any non-type import from @stoachain would drag the chain runtime into the
    // generic shell. `import type { PactClient } ...` is erased at compile.
    const valueStoachain = /^\s*import\s+(?!type\b)[^;]*from\s+["']@stoachain/m;
    expect(valueStoachain.test(providerSrc)).toBe(false);
  });

  it("has no createCodexStore / state-store import (the store is an injected seam)", () => {
    // Doc prose may name the seam it replaces; what must NOT exist is an import
    // statement pulling the store value into this generic package.
    const importCreateStore = /^\s*import\s[^;]*\bcreateCodexStore\b[^;]*from/m;
    const importStateStore = /^\s*import\s[^;]*from\s+["'][^"']*state\/store/m;
    expect(importCreateStore.test(providerSrc)).toBe(false);
    expect(importStateStore.test(providerSrc)).toBe(false);
  });

  it("has no zbom import (the toast host is an injected slot)", () => {
    // The MultiStepToastContainer value edge is gone; only an import from a
    // zbom path (or importing the container symbol) would fail the carve.
    const importZbom = /^\s*import\s[^;]*from\s+["'][^"']*zbom/m;
    const importToastContainer = /^\s*import\s[^;]*\bMultiStepToastContainer\b[^;]*from/m;
    expect(importZbom.test(providerSrc)).toBe(false);
    expect(importToastContainer.test(providerSrc)).toBe(false);
  });
});
