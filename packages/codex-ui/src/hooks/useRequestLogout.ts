/**
 * useRequestLogout — the Promise-returning logout-confirmation gate.
 *
 * Returns a stable function: `() => Promise<"clean" | "backed-up" |
 * "proceeded-without-backup" | "cancelled">` that:
 *   1. If the codex is clean (`dirty === false`), resolves immediately
 *      with `"clean"` — no modal shown, no pending request created. This
 *      fast path lives HERE, not in `requestLogoutConfirmation()` itself —
 *      see that action's own JSDoc (`store.ts`) for the documented
 *      invariant: the store action is only ever called after this hook has
 *      already ruled out the clean case.
 *   2. If dirty, triggers <LogoutConfirmModal> to render via the store's
 *      `pendingLogoutRequest` slice (by calling
 *      `actions.requestLogoutConfirmation()`) and returns the Promise that
 *      settles once the user picks "back up now", "continue without
 *      backing up", or "cancel".
 *
 * A UX convenience checkpoint, not a security or funds-safety gate — see
 * `useCodexUnsavedChangesGuard`'s own doc comment for the same framing of
 * what `dirty` does (and does not) track.
 *
 * Concurrent calls dedup: two callers requesting logout confirmation
 * simultaneously share a single modal + single user choice. See
 * `store.requestLogoutConfirmation` JSDoc for the dedup semantics.
 */

import { useCallback } from "react";
import { useCodexStore } from "../provider/index.js";

export type RequestLogoutFn = () => Promise<
  "clean" | "backed-up" | "proceeded-without-backup" | "cancelled"
>;

export function useRequestLogout(): RequestLogoutFn {
  const store = useCodexStore();
  return useCallback(async () => {
    const state = store.getState();
    // Fast path — codex has no divergence from its last external backup,
    // nothing to confirm.
    if (state.dirty === false) {
      return "clean";
    }
    return state.actions.requestLogoutConfirmation();
  }, [store]);
}
