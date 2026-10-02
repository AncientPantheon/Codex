/**
 * useCodexUnsavedChangesGuard (codex-ui) — the generic backup-divergence
 * `beforeunload` guard. Installs the same native
 * `event.preventDefault(); event.returnValue = ""` pattern
 * `ArweavePanel.tsx`'s own upload-in-flight guard already uses, but keyed
 * off `store.dirty` (backup divergence) instead of an in-flight upload —
 * a separate, additive concern from that panel's own guard.
 *
 * This is a UX convenience reminder, NOT a safety mechanism: `dirty`
 * tracks divergence from the last external backup, not unsaved-to-local-
 * storage (local storage already persists durably via `persistAndTouch`).
 */

import * as React from "react";
import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

import { CodexProvider, useCodexStore } from "../src/provider/index.js";
import { useCodexUnsavedChangesGuard } from "../src/hooks/useCodexUnsavedChangesGuard.js";
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

function renderGuard(adapter: MemoryCodexAdapter) {
  return renderHook(
    () => {
      useCodexUnsavedChangesGuard();
      return { codex: useCodex(), store: useCodexStore() };
    },
    { wrapper: mkWrapper(adapter) }
  );
}

/** Dispatches a real `beforeunload` event against `window` (jsdom) and
 *  returns whether the handler called `preventDefault()`/set
 *  `returnValue` — the two signals that actually arm the browser's
 *  native "leave site?" chrome. Not a mocked `addEventListener` call:
 *  this exercises the real listener the hook installed.
 *
 *  jsdom does not implement the legacy `BeforeUnloadEvent` string
 *  quirk — it follows the base `Event` spec instead, where
 *  `returnValue` is a boolean that defaults to `true` and flips to
 *  `false` (and sets the canceled flag) the moment anything assigns
 *  it a falsy value, exactly what `event.returnValue = ""` does. So a
 *  handler that ran leaves `returnValue === false`; one that never ran
 *  leaves it at its untouched default of `true`. */
function dispatchBeforeUnload(): { defaultPrevented: boolean; returnValue: boolean } {
  const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
  window.dispatchEvent(event);
  return {
    defaultPrevented: event.defaultPrevented,
    returnValue: event.returnValue as unknown as boolean,
  };
}

describe("useCodexUnsavedChangesGuard", () => {
  it("arms the native beforeunload prompt while the codex is dirty", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderGuard(adapter);
    await waitFor(() => expect(result.current.codex.isReady).toBe(true));

    act(() => {
      result.current.store.getState().actions.markDirty();
    });
    await waitFor(() => expect(result.current.codex.isDirty).toBe(true));

    const { defaultPrevented, returnValue } = dispatchBeforeUnload();
    expect(defaultPrevented).toBe(true);
    expect(returnValue).toBe(false);
  });

  it("disarms the native beforeunload prompt once the codex is clean again", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderGuard(adapter);
    await waitFor(() => expect(result.current.codex.isReady).toBe(true));

    act(() => {
      result.current.store.getState().actions.markDirty();
    });
    await waitFor(() => expect(result.current.codex.isDirty).toBe(true));

    act(() => {
      result.current.store.getState().actions.clearDirty();
    });
    await waitFor(() => expect(result.current.codex.isDirty).toBe(false));

    const { defaultPrevented, returnValue } = dispatchBeforeUnload();
    expect(defaultPrevented).toBe(false);
    expect(returnValue).toBe(true);
  });

  it("never arms the prompt on a fresh, clean codex", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderGuard(adapter);
    await waitFor(() => expect(result.current.codex.isReady).toBe(true));
    expect(result.current.codex.isDirty).toBe(false);

    const { defaultPrevented } = dispatchBeforeUnload();
    expect(defaultPrevented).toBe(false);
  });
});
