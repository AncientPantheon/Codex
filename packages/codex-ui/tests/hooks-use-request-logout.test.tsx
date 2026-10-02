/**
 * useRequestLogout (codex-ui) — the Promise-returning logout-confirmation
 * gate. Mirrors useRequestPassword's own shape: a fast path handled HERE
 * in the hook (never in the store action, per `requestLogoutConfirmation`'s
 * own documented invariant) plus delegation to the store's pending-request
 * seam for the "needs prompting" case.
 *
 * `dirty` tracks divergence from the last *external* backup (cleared only
 * by `clearDirty()`), not unsaved-to-local-storage — see
 * `useCodexUnsavedChangesGuard`'s own doc comment for the same framing.
 */

import * as React from "react";
import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

import { CodexProvider, useCodexStore } from "../src/provider/index.js";
import { useRequestLogout } from "../src/hooks/useRequestLogout.js";
import { useCodex } from "../src/hooks/index.js";

import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";

function mkWrapper(adapter: MemoryCodexAdapter) {
  return ({ children }: { children: React.ReactNode }) => (
    <CodexProvider createStore={createCodexStore} adapter={adapter}>
      {children}
    </CodexProvider>
  );
}

function renderLogout(adapter: MemoryCodexAdapter) {
  return renderHook(
    () => {
      return { requestLogout: useRequestLogout(), codex: useCodex(), store: useCodexStore() };
    },
    { wrapper: mkWrapper(adapter) }
  );
}

describe("useRequestLogout", () => {
  it("resolves 'clean' immediately on a clean codex without creating a pending request", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderLogout(adapter);
    await waitFor(() => expect(result.current.codex.isReady).toBe(true));
    expect(result.current.store.getState().dirty).toBe(false);

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.requestLogout();
    });

    expect(outcome).toBe("clean");
    // The fast path must never touch modal state — a host calling this on
    // a clean codex should see zero UI, not a flash of a pending request.
    expect(result.current.store.getState().pendingLogoutRequest).toBeNull();
  });

  it("delegates to the store's pending-request seam on a dirty codex, resolving once the request is completed", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderLogout(adapter);
    await waitFor(() => expect(result.current.codex.isReady).toBe(true));

    act(() => {
      result.current.store.getState().actions.markDirty();
    });
    await waitFor(() => expect(result.current.codex.isDirty).toBe(true));

    let pending: Promise<string> | undefined;
    act(() => {
      pending = result.current.requestLogout();
    });

    // A pending request must now exist for <LogoutConfirmModal> to pick up.
    await waitFor(() =>
      expect(result.current.store.getState().pendingLogoutRequest).not.toBeNull()
    );

    act(() => {
      result.current.store.getState().actions.completeLogoutRequest(
        "proceeded-without-backup"
      );
    });

    const outcome = await pending;
    expect(outcome).toBe("proceeded-without-backup");
  });
});
