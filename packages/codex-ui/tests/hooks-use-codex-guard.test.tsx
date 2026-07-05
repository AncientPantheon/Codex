/**
 * useCodexGuard (codex-ui) — thin hook over the active-CodexGuard projection of
 * the pureKeypairs slice + the generate/rotate actions.
 *
 * Ported from codex-ouronet with the carve's two changes: hook + provider from
 * codex-ui's src, and the store injected via the `createStore` seam. Pins
 * delegation + the re-render-on-rotate contract, not the crypto.
 */

import * as React from "react";
import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

import { CodexProvider } from "../src/provider/index.js";
import { useCodexGuard, useCodexAuth } from "../src/hooks/index.js";

import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import {
  MemoryCodexAdapter,
  emptySnapshot,
} from "@ancientpantheon/codex-ouronet/adapters";
import type { IPureKeypair } from "@ancientpantheon/codex-ouronet/types";

const CK = "codex-password-123";
const HEX64 = /^[0-9a-f]{64}$/;

const activeGuard = (overrides: Partial<IPureKeypair> = {}): IPureKeypair => ({
  id: "guard-1",
  label: "CodexGuard",
  publicKey: "old-pub",
  encryptedPrivateKey: "old-enc",
  createdAt: "2026-05-29T00:00:00.000Z",
  isCodexGuard: true,
  ...overrides,
});

async function seededAdapter(
  pureKeypairs: IPureKeypair[]
): Promise<MemoryCodexAdapter> {
  const adapter = new MemoryCodexAdapter("dev");
  await adapter.saveAll({
    ...emptySnapshot("dev"),
    pureKeypairs,
  });
  return adapter;
}

function mkWrapper(adapter: MemoryCodexAdapter) {
  return ({ children }: { children: React.ReactNode }) => (
    <CodexProvider createStore={createCodexStore} adapter={adapter}>
      {children}
    </CodexProvider>
  );
}

describe("useCodexGuard", () => {
  it("activePublicKey is null on a fresh codex with no guard", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderHook(() => useCodexGuard(), {
      wrapper: mkWrapper(adapter),
    });
    await waitFor(() => expect(result.current.activePublicKey).toBeNull());
    expect(result.current.encryptedPrivateKey).toBeNull();
  });

  it("activePublicKey/encryptedPrivateKey reflect the active guard loaded from the snapshot", async () => {
    const adapter = await seededAdapter([activeGuard()]);
    const { result } = renderHook(() => useCodexGuard(), {
      wrapper: mkWrapper(adapter),
    });
    await waitFor(() => expect(result.current.activePublicKey).toBe("old-pub"));
    expect(result.current.encryptedPrivateKey).toBe("old-enc");
  });

  it("excludes a demoted (wasCodexGuard) entry — only the active guard surfaces", async () => {
    const adapter = await seededAdapter([
      activeGuard({
        id: "new",
        publicKey: "new-pub",
        encryptedPrivateKey: "new-enc",
      }),
      activeGuard({
        id: "old",
        publicKey: "retired-pub",
        encryptedPrivateKey: "retired-enc",
        isCodexGuard: false,
        wasCodexGuard: true,
        label: "CodexGuard (retired #1)",
      }),
    ]);
    const { result } = renderHook(() => useCodexGuard(), {
      wrapper: mkWrapper(adapter),
    });
    await waitFor(() => expect(result.current.activePublicKey).toBe("new-pub"));
  });

  it("generateForLegacy throws already-exists (delegates to the action) when a guard already exists", async () => {
    const adapter = await seededAdapter([activeGuard()]);
    const { result } = renderHook(
      () => ({ guard: useCodexGuard(), auth: useCodexAuth() }),
      { wrapper: mkWrapper(adapter) }
    );
    await waitFor(() =>
      expect(result.current.guard.activePublicKey).toBe("old-pub")
    );
    act(() => result.current.auth.authenticate(CK, 60));
    await expect(
      result.current.guard.generateForLegacy()
    ).rejects.toMatchObject({
      name: "CodexGuardError",
      reason: "already-exists",
    });
  });

  it("rotate() swaps the active pubkey — the hook re-renders with the new guard's pubkey", async () => {
    const adapter = await seededAdapter([activeGuard()]);
    const { result } = renderHook(
      () => ({ guard: useCodexGuard(), auth: useCodexAuth() }),
      { wrapper: mkWrapper(adapter) }
    );
    await waitFor(() =>
      expect(result.current.guard.activePublicKey).toBe("old-pub")
    );
    act(() => result.current.auth.authenticate(CK, 60));

    await act(async () => {
      await result.current.guard.rotate();
    });

    expect(result.current.guard.activePublicKey).not.toBe("old-pub");
    expect(result.current.guard.activePublicKey).toMatch(HEX64);
  });
});
