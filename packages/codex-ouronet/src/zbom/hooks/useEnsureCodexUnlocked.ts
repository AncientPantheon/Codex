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
import { useCodexStore, useCodexStoreOptional } from "../../provider/index.js";

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

/**
 * Same as `useEnsureCodexUnlocked()`, but returns `null` instead of
 * throwing when there is no `<CodexProvider>` ancestor — for a caller that
 * is SOMETIMES mounted without one (e.g. `ArweavePanel`'s own "degrades to
 * a visible 'not available' state rather than crashing when no provider is
 * wired" test, and `ArweaveSeedsArea`/`PureKeysArea`'s own deliberately
 * provider-agnostic standalone-render contract). `null` means "there is no
 * real unlock gate available here" — a caller wiring this into an injected
 * prop (see `RsaParamsSectionProps.ensureCodexUnlocked`) simply omits the
 * prop in that case, which its own consumer already treats as "proceed
 * straight to the decrypt attempt," i.e. exactly today's pre-round-22
 * behavior in a providerless context — never a crash, never a silently
 * wrong prompt.
 *
 * `useCodexStore()` is the ONE hook, of the four `useEnsureCodexUnlocked`
 * calls, that actually throws first (confirmed: it's the first line of
 * that hook's own body, and every hook downstream of it — `useCodex()`,
 * `useCodexAuth()`, `useRequestPassword()` — is ITSELF built on
 * `useCodexStore()` as ITS OWN first call, so none of them can be reached
 * at all once the provider is missing). Checking `useCodexStoreOptional()`
 * first and early-returning before calling the other three is therefore
 * NOT a "sometimes call fewer hooks" hazard in the sense React's rule
 * exists to prevent: whether a `<CodexProvider>` ancestor exists is fixed
 * by this component's OWN static JSX tree for its entire mounted
 * lifetime — it can never flip between one render and the next for a
 * given instance, so the number of hooks actually invoked here is stable
 * across every re-render of any one call site, which is the real
 * invariant the rule protects. ESLint's static analysis cannot prove that
 * itself, hence the explicit disable below.
 */
export function useEnsureCodexUnlockedOptional(): (() => Promise<boolean>) | null {
  const store = useCodexStoreOptional();
  if (store === null) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return null;
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const requestPassword = useRequestPassword();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { authenticate } = useCodexAuth();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { uiSettings } = useCodex();

  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useCallback(async () => {
    const cache = store.getState().passwordCache;
    const wasUnlocked = !!cache && cache.expiresAt > Date.now();

    let pw: string;
    try {
      pw = await requestPassword();
    } catch {
      return false;
    }
    if (!pw) return false;

    if (!wasUnlocked) {
      authenticate(pw, uiSettings?.passwordCacheMinutes ?? 1);
    }
    return true;
  }, [store, requestPassword, authenticate, uiSettings?.passwordCacheMinutes]);
}
