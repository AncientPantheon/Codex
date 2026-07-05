/**
 * useEnsureCodexUnlocked — cloned from OuronetUI `hooks/useEnsureCodexUnlocked.ts`.
 *
 * Returns a stable `() => Promise<boolean>` gate the ZBOM modals call before
 * signing: it ensures the codex password is available (prompting if locked),
 * returning false when the user cancels.
 *
 * Unlock window is **absolute, not sliding.** The TTL is started once — when
 * the user FRESHLY enters their password — and counts straight down. A cache
 * hit (codex already unlocked) does NOT extend it. The locked path starts the
 * window via `submitPasswordRequest()` → `authenticate()`; this hook only
 * (re)starts it on a fresh authentication, so routine operations within the
 * window leave the countdown untouched and the visible "re-authenticate in X"
 * timer means exactly what it shows. (Previously this called `authenticate()`
 * unconditionally, so every operation silently reset the timer to the full
 * TTL — a sliding window that never enforced the displayed deadline.)
 *
 * Data-seam swaps (T2, blueprint §7.2):
 *   - `useWallet().getCurrentPassword` → `useRequestPassword()` (package's
 *     Promise-returning prompt: resolves cached pw or shows <PasswordModal>).
 *   - `useCodex().uiSettings` stays (package's own Zustand-backed useCodex).
 */

import { useCallback } from "react";
import { useRequestPassword } from "../../hooks/index.js";
import { useCodexAuth } from "../../hooks/index.js";
import { useCodex } from "../../hooks/index.js";
import { useCodexStore } from "../../provider/index.js";

export function useEnsureCodexUnlocked(): () => Promise<boolean> {
  const store = useCodexStore();
  const requestPassword = useRequestPassword();
  const { authenticate } = useCodexAuth();
  const { uiSettings } = useCodex();

  return useCallback(async () => {
    // Snapshot the lock state BEFORE prompting: a still-valid cache means the
    // codex was already unlocked and this is a routine cache hit (no prompt) —
    // its window must keep counting down, not reset.
    const cache = store.getState().passwordCache;
    const wasUnlocked = !!cache && cache.expiresAt > Date.now();

    let pw: string;
    try {
      pw = await requestPassword();
    } catch {
      return false;
    }
    if (!pw) return false;

    // Only start the window on a FRESH authentication. On the locked path the
    // user's submit already called authenticate() (via submitPasswordRequest);
    // this keeps the hook's configured TTL authoritative without refreshing on
    // cache hits.
    if (!wasUnlocked) {
      authenticate(pw, uiSettings?.passwordCacheMinutes ?? 1);
    }
    return true;
  }, [store, requestPassword, authenticate, uiSettings?.passwordCacheMinutes]);
}
