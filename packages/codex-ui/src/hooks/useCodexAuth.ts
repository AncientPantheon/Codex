/**
 * useCodexAuth — password prompts, lock/unlock, password cache access.
 *
 * Replaces the password-related half of OuronetUI's auth-context.tsx.
 * Phase 5 ships the imperative surface (authenticate / lock /
 * getCurrentPassword); Phase 6 adds the headless <PasswordModal> that
 * calls into these.
 *
 * Note: authenticate() does NOT validate the password against an
 * encrypted secret in Phase 5 — it just caches whatever the caller
 * provides. Wrong-password detection happens at the next decrypt
 * attempt (where CodexPasswordError is thrown by stoa-core/crypto).
 * Phase 7 may add an optional `validateAgainst` parameter for a
 * pre-flight check.
 */

import { useCallback } from "react";
import { useCodexStore } from "../provider/index.js";

export interface CodexAuthView {
  isLocked: boolean;
  authenticate: (password: string, ttlMinutes?: number) => void;
  lock: () => void;
  /** Returns the cached password. Throws CodexLockedError if the cache
   *  is empty or expired. Used by hooks that need to decrypt secrets. */
  getCurrentPassword: () => string;
  /** Epoch-ms timestamp of cache expiry, or null when locked. Useful
   *  for "Re-authenticate in X minutes" UI affordances. */
  passwordCacheExpiresAt: number | null;
}

export function useCodexAuth(): CodexAuthView {
  const store = useCodexStore();
  const isLocked = store((s) => s.locked);
  const passwordCache = store((s) => s.passwordCache);
  const actions = store((s) => s.actions);

  const getCurrentPassword = useCallback(
    () => actions.getPassword(),
    [actions]
  );

  return {
    isLocked,
    authenticate: actions.authenticate,
    lock: actions.lock,
    getCurrentPassword,
    passwordCacheExpiresAt: passwordCache?.expiresAt ?? null,
  };
}
