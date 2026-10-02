/**
 * useCodexUnsavedChangesGuard — generic backup-divergence `beforeunload`
 * guard.
 *
 * Installs the browser's native "leave site?" prompt whenever
 * `store.dirty === true` and removes it once the codex is clean again.
 * This is a UX convenience reminder, NOT a safety mechanism: `dirty`
 * tracks divergence from the last *external* backup (cleared only by
 * `clearDirty()`), not whether anything is unsaved to local storage —
 * every mutating store action already persists durably through the
 * adapter via `persistAndTouch` before `dirty` is ever set. Closing the
 * tab loses nothing; this only reminds the user that this browser's
 * local storage may be the only copy of their changes.
 *
 * Deliberately separate from `ArweavePanel.tsx`'s own `beforeunload`
 * effect, which guards an in-flight upload generation
 * (`activeGeneration`) and is untouched by this hook — two independent,
 * additive guards, not a shared one.
 *
 * `beforeunload` cannot show custom copy — only the browser's own "leave
 * site?" chrome — so this is intentionally the bare standard pattern
 * (`event.preventDefault(); event.returnValue = ""`), same as that
 * existing effect.
 */

import { useEffect } from "react";
import { useCodexStore } from "../provider/index.js";

export function useCodexUnsavedChangesGuard(): void {
  const store = useCodexStore();
  const dirty = store((s) => s.dirty);

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
}
