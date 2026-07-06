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
    <div className="cxpg-app cxpg-landing">
      <div className="cxpg-card">
        <div className="cxpg-logo" aria-hidden="true">
          🔒
        </div>
        <h1 className="cxpg-title">Unlock your Codex</h1>
        <p className="cxpg-subtitle">
          Enter your password to decrypt this codex on this device.
        </p>

        <form className="cxpg-form" onSubmit={handleSubmit}>
          <label htmlFor="codex-unlock-password" className="cxpg-field-label">
            Password
          </label>
          <input
            id="codex-unlock-password"
            className="cxpg-input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Your codex password"
            autoComplete="current-password"
            autoFocus
          />
          <button
            type="submit"
            className="cxpg-btn cxpg-btn--primary cxpg-btn--block"
          >
            Unlock
          </button>
        </form>

        <p className="cxpg-note">
          Your password never leaves this device.
        </p>
      </div>
    </div>
  );
}
