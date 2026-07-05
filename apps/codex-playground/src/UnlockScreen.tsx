import { useState, type FormEvent, type ReactElement } from "react";
import { useCodexAuth } from "@ancientpantheon/codex-ouronet/hooks";

/**
 * Minimal mode-1 unlock screen for the codex-playground devtool.
 *
 * Drives the REAL unlock path: on submit it hands the entered password straight
 * to useCodexAuth().authenticate(password, ttlMinutes) — the shipped hook that
 * seeds passwordCache = {value, expiresAt} and unlocks the codex. It does NOT
 * pre-validate: authenticate() only caches, so a wrong password is not detected
 * here — it surfaces at the next decrypt as CodexPasswordError (the real flow).
 *
 * The password lives ONLY in the masked <input type="password">; it is never
 * logged nor echoed into DOM text (N-06). Mode-2 (plaintext) has no encrypted
 * secrets, so the App (T10.7) skips rendering this screen entirely.
 */

// TTL is intentionally caller-agnostic here — the playground unlocks for a dev
// session length; the App may override once it owns the mode gate (T10.7).
const DEFAULT_TTL_MINUTES = 30;

export function UnlockScreen(): ReactElement {
  const { authenticate } = useCodexAuth();
  const [password, setPassword] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    // Empty-password guard: never seed the cache with an empty secret.
    if (password.length === 0) {
      return;
    }
    authenticate(password, DEFAULT_TTL_MINUTES);
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="codex-unlock-password">Password</label>
      <input
        id="codex-unlock-password"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <button type="submit">Unlock</button>
    </form>
  );
}
