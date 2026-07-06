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

function EyeIcon({ off }: { off: boolean }): ReactElement {
  return off ? (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ) : (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function UnlockScreen(): ReactElement {
  const { authenticate } = useCodexAuth();
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);

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
          <div className="cxpg-input-wrap">
            <input
              id="codex-unlock-password"
              className="cxpg-input cxpg-input--eye"
              type={reveal ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Your codex password"
              autoComplete="current-password"
              autoFocus
            />
            <button
              type="button"
              className="cxpg-eye"
              aria-label={reveal ? "Hide password" : "Show password"}
              aria-pressed={reveal}
              onClick={() => setReveal((v) => !v)}
              tabIndex={-1}
            >
              <EyeIcon off={reveal} />
            </button>
          </div>
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
