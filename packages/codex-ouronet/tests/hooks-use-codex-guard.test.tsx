/**
 * useCodexGuard — thin hook over the active-CodexGuard projection of the
 * pureKeypairs slice + the generate/rotate actions.
 *
 * activePublicKey / encryptedPrivateKey are DERIVED from a subscription to
 * s.pureKeypairs using the same canonical active filter the store getters use
 * (isCodexGuard === true && wasCodexGuard !== true), so the hook re-renders
 * when rotate() swaps the active guard. generateForLegacy / rotate are the
 * store actions verbatim — these specs pin delegation + the re-render contract,
 * not the crypto (covered in the state-level guard tests).
 */

import * as React from "react";
import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import {
  MemoryCodexAdapter,
  emptySnapshot,
} from "@ancientpantheon/codex-ouronet/adapters";
import { useCodexGuard, useCodexAuth } from "@ancientpantheon/codex-ouronet/hooks";
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
    <CodexProvider adapter={adapter}>{children}</CodexProvider>
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
    await waitFor(() =>
      expect(result.current.activePublicKey).toBe("old-pub")
    );
    expect(result.current.encryptedPrivateKey).toBe("old-enc");
  });

  it("excludes a demoted (wasCodexGuard) entry — only the active guard surfaces", async () => {
    const adapter = await seededAdapter([
      activeGuard({ id: "new", publicKey: "new-pub", encryptedPrivateKey: "new-enc" }),
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
    await waitFor(() =>
      expect(result.current.activePublicKey).toBe("new-pub")
    );
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

    // The previous active pubkey is no longer surfaced; the new active guard's
    // fresh ED25519 pubkey is.
    expect(result.current.guard.activePublicKey).not.toBe("old-pub");
    expect(result.current.guard.activePublicKey).toMatch(HEX64);
  });
});
