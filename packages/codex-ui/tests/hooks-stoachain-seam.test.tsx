/**
 * The two StoaChain-bound hooks (useGetKeypair / useSignTransaction) — seam
 * delegation, funds-critical.
 *
 * In codex-ouronet these hooks value-imported InternalCodexResolver +
 * @stoachain/kadena-stoic-legacy + @stoachain/stoa-core/{signing,constants} and
 * CONSTRUCTED the resolver + Pact client + CodexSigningStrategy inline. In
 * codex-ui that whole cluster is a REVERSE / value-@stoachain edge that the carve
 * forbids (T9.9 graph guard). So the hooks hold NO real resolver: they read the
 * injected resolver-provider seam from the provider context and DELEGATE:
 *   - useGetKeypair()      → seam.getKeyPairByPublicKey(publicKey)
 *   - useSignTransaction() → seam.createSigningStrategy(store, opts)
 *
 * These specs inject a FAKE seam (no @stoachain, no real crypto) and assert the
 * delegation shape — proving codex-ui carries no value chain edge. The provider's
 * `resolverFactory` seam builds the resolver from the mounted store; codex-ouronet
 * supplies the real InternalCodexResolver at wiring time.
 */

import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

import { CodexProvider } from "../src/provider/index.js";
import { useGetKeypair, useSignTransaction } from "../src/hooks/index.js";
import type { CodexResolverSeam } from "../src/hooks/seams.js";

import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";

// ---------------------------------------------------------------------------
// A FAKE resolver seam. NO @stoachain, NO real crypto, NO InternalCodexResolver.
// It records the delegated calls so the specs can assert the hooks route through
// it rather than constructing their own resolver / Pact client / strategy.
// ---------------------------------------------------------------------------

function makeFakeSeam() {
  const fakeKeypair = { publicKey: "k:pub", secretKey: "k:sec" };
  const fakeStrategy = {
    execute: vi.fn(async () => ({ status: "success" })),
    sign: vi.fn(async () => ({ sigs: [] })),
  };
  const getKeyPairByPublicKey = vi.fn(async (_pub: string) => fakeKeypair);
  const createSigningStrategy = vi.fn(
    (_store: unknown, _opts: unknown) => fakeStrategy
  );
  const seam: CodexResolverSeam = {
    getKeyPairByPublicKey: getKeyPairByPublicKey as never,
    createSigningStrategy: createSigningStrategy as never,
  };
  return { seam, getKeyPairByPublicKey, createSigningStrategy, fakeStrategy, fakeKeypair };
}

function mkWrapper(seam: CodexResolverSeam) {
  const adapter = new MemoryCodexAdapter("dev");
  return ({ children }: { children: React.ReactNode }) => (
    <CodexProvider
      createStore={createCodexStore}
      adapter={adapter}
      resolverFactory={() => seam}
    >
      {children}
    </CodexProvider>
  );
}

describe("useGetKeypair — delegates to seam.getKeyPairByPublicKey", () => {
  it("returns a stable function across renders", () => {
    const { seam } = makeFakeSeam();
    const { result, rerender } = renderHook(() => useGetKeypair(), {
      wrapper: mkWrapper(seam),
    });
    const fn1 = result.current;
    rerender();
    expect(result.current).toBe(fn1);
  });

  it("routes the pubkey through seam.getKeyPairByPublicKey (no own resolver)", async () => {
    const { seam, getKeyPairByPublicKey, fakeKeypair } = makeFakeSeam();
    const { result } = renderHook(() => useGetKeypair(), {
      wrapper: mkWrapper(seam),
    });
    const pub = "a".repeat(64);
    let got: unknown;
    await act(async () => {
      got = await result.current(pub);
    });
    expect(getKeyPairByPublicKey).toHaveBeenCalledWith(pub);
    expect(got).toBe(fakeKeypair);
  });
});

describe("useSignTransaction — delegates to seam.createSigningStrategy", () => {
  it("builds its strategy via seam.createSigningStrategy(store, opts) — not a real one", async () => {
    const { seam, createSigningStrategy, fakeStrategy } = makeFakeSeam();
    const requestForeignKey = vi.fn(async () => "foreign-key");
    const { result } = renderHook(
      () => useSignTransaction({ requestForeignKey }),
      { wrapper: mkWrapper(seam) }
    );
    await waitFor(() => expect(createSigningStrategy).toHaveBeenCalled());

    // The store + the option bag are forwarded to the seam — the whole strategy
    // construction cluster lives Ouronet-side behind this call.
    const [storeArg, optsArg] = createSigningStrategy.mock.calls[0]!;
    expect(typeof storeArg).toBe("function"); // the callable Zustand store
    expect(optsArg).toMatchObject({ requestForeignKey });

    // The View exposes the seam's strategy + bound pass-throughs.
    expect(result.current.strategy).toBe(fakeStrategy);
    expect(typeof result.current.execute).toBe("function");
    expect(typeof result.current.sign).toBe("function");
  });

  it("execute/sign pass through to the seam strategy", async () => {
    const { seam, fakeStrategy } = makeFakeSeam();
    const { result } = renderHook(() => useSignTransaction(), {
      wrapper: mkWrapper(seam),
    });
    await waitFor(() => expect(result.current.strategy).toBe(fakeStrategy));
    await act(async () => {
      await result.current.execute({} as never);
    });
    expect(fakeStrategy.execute).toHaveBeenCalledTimes(1);
  });
});
