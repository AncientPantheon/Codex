/**
 * useEnsureCodexUnlocked — absolute (non-sliding) unlock window.
 *
 * Regression guard for the codex unlock timer. The gate must start the TTL
 * window once — on a FRESH authentication — and never extend it on a routine
 * cache hit. A previous version called authenticate() unconditionally, so
 * every codex operation silently reset the countdown to the full TTL (a
 * sliding window that never enforced the displayed "re-authenticate in X"
 * deadline).
 */

import * as React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { useCodexAuth } from "@ancientpantheon/codex-ouronet/hooks";
import { useEnsureCodexUnlocked } from "../src/zbom/hooks/useEnsureCodexUnlocked";

function mkWrapper(adapter: MemoryCodexAdapter) {
  return ({ children }: { children: React.ReactNode }) => (
    <CodexProvider adapter={adapter}>{children}</CodexProvider>
  );
}

describe("useEnsureCodexUnlocked — absolute unlock window", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-20T00:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does NOT extend the TTL on a cache hit (already unlocked)", async () => {
    const wrapper = mkWrapper(new MemoryCodexAdapter());
    const { result } = renderHook(
      () => ({ ensure: useEnsureCodexUnlocked(), auth: useCodexAuth() }),
      { wrapper },
    );

    // Fresh authentication at t0 with a 60-minute window.
    act(() => {
      result.current.auth.authenticate("pw", 60);
    });
    const deadline = result.current.auth.passwordCacheExpiresAt;
    expect(deadline).toBe(Date.now() + 60 * 60_000);

    // 5 minutes pass, then a routine operation calls the gate. The codex is
    // still unlocked, so this is a silent cache hit — no prompt.
    await act(async () => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.ensure();
    });

    expect(ok).toBe(true);
    // The deadline must be UNCHANGED — the window keeps counting down from the
    // original unlock, not reset to now + 60min.
    expect(result.current.auth.passwordCacheExpiresAt).toBe(deadline);
  });
});
