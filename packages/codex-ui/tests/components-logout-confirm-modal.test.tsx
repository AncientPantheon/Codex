/**
 * <LogoutConfirmModal> — the headless logout-confirmation choice.
 *
 * Mirrors <PasswordModal>'s own shape exactly: subscribes to a pending-X
 * slice (`pendingLogoutRequest`, set by `actions.requestLogoutConfirmation`
 * via `useRequestLogout`'s fallthrough) and renders nothing while that
 * slice is null — safe to mount unconditionally at the app root.
 *
 * Three controls settle the pending request:
 *   - "back up now" calls `useCodexBackup().downloadAsJson()` then, on
 *     success, `actions.completeLogoutRequest("backed-up")` (which the
 *     store itself turns into a `clearDirty()` call — not this modal's
 *     job to clear it a second time).
 *   - "continue without backing up" calls
 *     `actions.completeLogoutRequest("proceeded-without-backup")`.
 *   - "cancel" calls `actions.cancelLogoutRequest()`.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import { CodexProvider, useCodexStore } from "../src/provider/index.js";
import { LogoutConfirmModal } from "../src/components/LogoutConfirmModal.js";

import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";

function Harness({ adapter }: { adapter: MemoryCodexAdapter }) {
  return (
    <CodexProvider createStore={createCodexStore} adapter={adapter}>
      <LogoutConfirmModal />
    </CodexProvider>
  );
}

/** Mounts the harness and returns a handle on the live store once ready,
 *  via a sibling probe component (mirrors how the hook tests in this
 *  package read `useCodexStore()` directly rather than mocking it). */
function mountAndGetStore(adapter: MemoryCodexAdapter) {
  let storeRef: ReturnType<typeof useCodexStore> | null = null;
  function Probe() {
    storeRef = useCodexStore();
    return null;
  }
  render(
    <CodexProvider createStore={createCodexStore} adapter={adapter}>
      <Probe />
      <LogoutConfirmModal />
    </CodexProvider>
  );
  if (!storeRef) throw new Error("store not mounted");
  return storeRef as ReturnType<typeof useCodexStore>;
}

describe("<LogoutConfirmModal>", () => {
  it("renders nothing when there is no pending logout request", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    render(<Harness adapter={adapter} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders the choice modal once a logout confirmation request is pending", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const store = mountAndGetStore(adapter);
    await waitFor(() => expect(store.getState().ready).toBe(true));

    act(() => {
      store.getState().actions.markDirty();
      store.getState().actions.requestLogoutConfirmation();
    });

    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
  });

  it("'cancel' resolves the pending request with 'cancelled' and leaves dirty unchanged", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const store = mountAndGetStore(adapter);
    await waitFor(() => expect(store.getState().ready).toBe(true));

    let pending: Promise<string> | undefined;
    act(() => {
      store.getState().actions.markDirty();
      pending = store.getState().actions.requestLogoutConfirmation();
    });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    await expect(pending).resolves.toBe("cancelled");
    expect(store.getState().dirty).toBe(true);
    expect(store.getState().pendingLogoutRequest).toBeNull();
  });

  it("'continue without backing up' resolves with that outcome and leaves dirty true", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const store = mountAndGetStore(adapter);
    await waitFor(() => expect(store.getState().ready).toBe(true));

    let pending: Promise<string> | undefined;
    act(() => {
      store.getState().actions.markDirty();
      pending = store.getState().actions.requestLogoutConfirmation();
    });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    fireEvent.click(
      screen.getByRole("button", { name: /continue without backing up/i })
    );

    await expect(pending).resolves.toBe("proceeded-without-backup");
    expect(store.getState().dirty).toBe(true);
  });

  it("'back up now' downloads a JSON backup, resolves with 'backed-up', and clears dirty", async () => {
    // jsdom lacks URL.createObjectURL — stub it so the real downloadAsJson
    // path runs, exactly how the rest of this package's backup-button
    // tests stub it.
    const createObjectURL = vi.fn(() => "blob:codex");
    const revokeObjectURL = vi.fn();
    window.URL.createObjectURL =
      createObjectURL as unknown as typeof window.URL.createObjectURL;
    window.URL.revokeObjectURL =
      revokeObjectURL as unknown as typeof window.URL.revokeObjectURL;

    const adapter = new MemoryCodexAdapter("dev");
    const store = mountAndGetStore(adapter);
    await waitFor(() => expect(store.getState().ready).toBe(true));

    let pending: Promise<string> | undefined;
    act(() => {
      store.getState().actions.markDirty();
      pending = store.getState().actions.requestLogoutConfirmation();
    });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /back up now/i }));

    await expect(pending).resolves.toBe("backed-up");
    expect(createObjectURL).toHaveBeenCalled();
    await waitFor(() => expect(store.getState().dirty).toBe(false));
  });
});
