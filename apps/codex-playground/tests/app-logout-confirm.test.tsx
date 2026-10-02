// ============================================================================
// docs/work/codex-session-lifecycle (T5) — wiring `useRequestLogout()` and
// `useCodexUnsavedChangesGuard()` into the REAL playground Dashboard.
//
// "Lock Codex" (CodexLockControl, rendered by ObservationalCodexIdDisplay) is
// the closest existing equivalent to "logout" in this single-codex-per-
// browser app. Clicking it must now surface <LogoutConfirmModal> (mounted
// in App.tsx) BEFORE the codex actually locks whenever the codex is dirty,
// and must lock with no modal at all when clean — matching today's behavior.
// This is a UX convenience reminder only, never a funds/upload-safety gate.
// ============================================================================

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useRef } from "react";

import { CodexProvider, useCodexStore } from "@ancientpantheon/codex-ouronet/provider";
import { useCodex } from "@ancientpantheon/codex-ouronet/hooks";

import { Dashboard } from "../src/App";
import { hydrateFromPlaintextSnapshot } from "../src/loadCodex";
import { emptySnapshot } from "../fixtures";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

/** Authenticates (so CodexLockControl shows "Lock Codex", not "Unlock
 *  Codex") once the provider's own init effect finishes (`isReady`) — a
 *  pre-ready `authenticate()` would race that effect's `loadAll()`
 *  completion. Exposes the live store via `onStore` so the test can force
 *  the exact `dirty` state it wants AFTER the dashboard's own mount effects
 *  (e.g. `DashboardBody`'s "push the StoaChain node into uiSettings" effect)
 *  have settled — those effects call ordinary mutating actions, which
 *  `persistAndTouch` dirties same as any real local edit would, so a mount
 *  alone does not stay "clean" long enough to exercise the clean path
 *  deterministically. */
function Authenticator({
  children,
  onStore,
}: {
  children: React.ReactNode;
  onStore: (store: ReturnType<typeof useCodexStore>) => void;
}) {
  const store = useCodexStore();
  const { isReady } = useCodex();
  const ran = useRef(false);
  onStore(store);
  useEffect(() => {
    if (!isReady || ran.current) return;
    ran.current = true;
    store.getState().actions.authenticate("test-password", 5);
  }, [isReady, store]);
  return <>{children}</>;
}

async function mountDashboard(dirty: boolean) {
  const adapter = await hydrateFromPlaintextSnapshot(emptySnapshot);
  let store: ReturnType<typeof useCodexStore> | undefined;
  render(
    <CodexProvider adapter={adapter} deviceVariant="dev">
      <Authenticator onStore={(s) => { store = s; }}>
        <Dashboard />
      </Authenticator>
    </CodexProvider>,
  );
  await waitFor(() => expect(screen.getByRole("button", { name: /^lock codex$/i })).toBeInTheDocument());
  if (!store) throw new Error("store never captured");

  // Let the dashboard's own mount-time mutating effects (network settings
  // push, etc.) finish dirtying the store on their own schedule, THEN pin
  // the exact dirty state this test actually wants to exercise — the
  // realistic equivalent of "the user has/hasn't backed up since those
  // local edits landed."
  await waitFor(() => expect(store!.getState().dirty).toBe(true));
  if (dirty) {
    store.getState().actions.markDirty();
  } else {
    store.getState().actions.clearDirty();
  }
  await waitFor(() => expect(store!.getState().dirty).toBe(dirty));
}

describe("App — useRequestLogout() wired into the real Lock Codex control", () => {
  it("a dirty codex shows the logout-confirmation modal BEFORE locking, and defers the lock until a choice is made", async () => {
    const user = userEvent.setup();
    await mountDashboard(true);

    await user.click(screen.getByRole("button", { name: /^lock codex$/i }));

    // The modal appears; the codex is NOT locked yet — the password screen
    // has not reappeared (still "Lock Codex", not "Unlock Codex").
    expect(await screen.findByText(/back up before locking/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^lock codex$/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /continue without backing up/i }));

    // Only now does the real lock happen.
    await waitFor(() => expect(screen.getByRole("button", { name: /^unlock codex$/i })).toBeInTheDocument());
    expect(screen.queryByText(/back up before locking/i)).toBeNull();
  });

  it("cancelling the logout confirmation leaves the codex unlocked and the modal gone", async () => {
    const user = userEvent.setup();
    await mountDashboard(true);

    await user.click(screen.getByRole("button", { name: /^lock codex$/i }));
    await screen.findByText(/back up before locking/i);

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(screen.queryByText(/back up before locking/i)).toBeNull();
    expect(screen.getByRole("button", { name: /^lock codex$/i })).toBeInTheDocument();
  });

  it("a CLEAN codex locks immediately with no modal, same as before this wiring", async () => {
    const user = userEvent.setup();
    await mountDashboard(false);

    await user.click(screen.getByRole("button", { name: /^lock codex$/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /^unlock codex$/i })).toBeInTheDocument());
    expect(screen.queryByText(/back up before locking/i)).toBeNull();
  });
});

describe("App — useCodexUnsavedChangesGuard() mounted and active on the real Dashboard", () => {
  function dispatchBeforeUnload(): boolean {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }

  it("arms the native beforeunload prompt once the mounted dashboard's codex is dirty", async () => {
    await mountDashboard(true);
    expect(dispatchBeforeUnload()).toBe(true);
  });

  it("never arms the prompt for a clean, freshly mounted dashboard", async () => {
    await mountDashboard(false);
    expect(dispatchBeforeUnload()).toBe(false);
  });
});
