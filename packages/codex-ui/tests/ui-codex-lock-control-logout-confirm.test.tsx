/**
 * CodexLockControl — the `useRequestLogout()` wiring (docs/work/
 * codex-session-lifecycle/plan.md T5). "Lock Codex" is the closest existing
 * equivalent to "logout" in this single-codex-per-browser app (confirmed by
 * grepping the codebase for a separate multi-account logout concept — none
 * exists), so it is the real call site: the button must run the
 * logout-confirmation gate BEFORE calling `lock()`, and only proceed to lock
 * when the outcome isn't `"cancelled"`.
 *
 * This is a UX convenience reminder, never a safety/funds gate — see
 * `LogoutConfirmModal`'s own doc comment for the same framing.
 */
import { useEffect, useRef } from "react";
import { describe, it, expect } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

import { CodexProvider, useCodexStore } from "../src/provider/index.js";
import { CodexLockControl } from "../src/ui/CodexLockControl.js";
import { useCodex } from "../src/hooks/index.js";

import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";

/** Mounts <CodexLockControl/> already unlocked (authenticate()), optionally
 *  dirty, and returns the store so assertions can read `locked`/
 *  `pendingLogoutRequest` directly.
 *
 *  `markDirty()`/`authenticate()` must wait for the provider's own init
 *  effect to finish (`isReady`) — that effect's `loadAll()` completion sets
 *  `dirty: false` as part of hydration, which would otherwise stomp a
 *  pre-ready `markDirty()` call the instant it resolves (mirrors
 *  `hooks-use-codex-unsaved-changes-guard.test.tsx`'s own documented
 *  ordering for the same reason). */
async function mountUnlocked(dirty: boolean) {
  const adapter = new MemoryCodexAdapter("dev");
  let captured: ReturnType<typeof useCodexStore> | undefined;
  function Unlocker() {
    const store = useCodexStore();
    const codex = useCodex();
    const ran = useRef(false);
    captured = store;
    useEffect(() => {
      if (!codex.isReady || ran.current) return;
      ran.current = true;
      store.getState().actions.authenticate("test-password", 5);
      if (dirty) store.getState().actions.markDirty();
    }, [codex.isReady, store]);
    return <CodexLockControl />;
  }
  render(
    <CodexProvider createStore={createCodexStore} adapter={adapter}>
      <Unlocker />
    </CodexProvider>,
  );
  await waitFor(() => expect(screen.getByRole("button", { name: /lock codex/i })).toBeInTheDocument());
  if (!captured) throw new Error("store never captured");
  if (dirty) {
    await waitFor(() => expect(captured!.getState().dirty).toBe(true));
  }
  return captured;
}

describe("CodexLockControl — useRequestLogout() wiring", () => {
  it("clicking Lock Codex on a dirty codex defers the actual lock behind a pending logout request", async () => {
    const store = await mountUnlocked(true);

    fireEvent.click(screen.getByRole("button", { name: /^lock codex$/i }));

    // The lock is deferred: the store is NOT locked yet, and a pending
    // logout request now exists for a modal to pick up.
    await waitFor(() => expect(store.getState().pendingLogoutRequest).not.toBeNull());
    expect(store.getState().locked).toBe(false);
  });

  it("cancelling the logout request leaves the codex unlocked (lock() is never called)", async () => {
    const store = await mountUnlocked(true);

    fireEvent.click(screen.getByRole("button", { name: /^lock codex$/i }));
    await waitFor(() => expect(store.getState().pendingLogoutRequest).not.toBeNull());

    store.getState().actions.cancelLogoutRequest();

    await waitFor(() => expect(store.getState().pendingLogoutRequest).toBeNull());
    expect(store.getState().locked).toBe(false);
  });

  it("a non-cancel outcome (continue without backing up) proceeds to lock", async () => {
    const store = await mountUnlocked(true);

    fireEvent.click(screen.getByRole("button", { name: /^lock codex$/i }));
    await waitFor(() => expect(store.getState().pendingLogoutRequest).not.toBeNull());

    store.getState().actions.completeLogoutRequest("proceeded-without-backup");

    await waitFor(() => expect(store.getState().locked).toBe(true));
  });

  it("clicking Lock Codex on a CLEAN codex locks immediately — no pending logout request is ever created", async () => {
    const store = await mountUnlocked(false);

    fireEvent.click(screen.getByRole("button", { name: /^lock codex$/i }));

    await waitFor(() => expect(store.getState().locked).toBe(true));
    expect(store.getState().pendingLogoutRequest).toBeNull();
  });
});
