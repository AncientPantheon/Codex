/**
 * useRequestPassword — the Promise-returning password prompt.
 *
 * Returns a stable function: `() => Promise<string>` that:
 *   1. If the codex is already unlocked, resolves immediately with the
 *      cached password (no modal shown).
 *   2. If locked, triggers <PasswordModal> to render via the store's
 *      pendingPasswordRequest slice and returns a Promise that resolves
 *      when the user submits or rejects when they cancel.
 *
 * Concurrent calls dedup: two hooks asking for the password
 * simultaneously share a single modal + single user prompt. See
 * store.requestPassword JSDoc for the dedup semantics.
 *
 * Why a hook (not just the store action): consumers needing the
 * "ensure unlocked, get password" gate often want it as a stable
 * function reference for useEffect deps. The hook gives them that
 * by returning the same function across renders (memoised on store
 * identity).
 */

import { useCallback } from "react";
import { useCodexStore } from "../provider/index.js";

export type RequestPasswordFn = () => Promise<string>;

export function useRequestPassword(): RequestPasswordFn {
  const store = useCodexStore();
  return useCallback(async (): Promise<string> => {
    const state = store.getState();
    // Fast path — codex already unlocked, return cached password
    // without prompting.
    const cache = state.passwordCache;
    if (cache && cache.expiresAt > Date.now()) {
      return cache.value;
    }
    return state.actions.requestPassword();
  }, [store]);
}
