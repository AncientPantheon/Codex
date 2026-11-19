/**
 * `InlineUnlockPrompt` — the reusable inline "enter your codex password"
 * panel (`docs/work/wizard-unlock-lifecycle/design.md`).
 *
 * Shaped after this codebase's own mature precedent: the migration wizard's
 * Account step already renders exactly this panel inline
 * (`legacy-prime-migration-account-probe-unlock` in
 * `LegacyPrimeMigrationWizard.tsx`), and `ViewSeedModal.tsx`'s `needsPassword`
 * branch is a second one. This component generalises that shape so the
 * remaining password touch points — Finalize and the two "View seed" modals —
 * stop dead-ending on a raw `Codex is locked; operation "getPassword"
 * requires authentication` and ask for the password where the user stands.
 *
 * Deliberately NOT routed through `useEnsureCodexUnlocked()` /
 * `requestPassword()`: that path is answered by a `<PasswordModal>` which no
 * host in this tree actually mounts, and it carries no `zIndex` while these
 * prompts open from INSIDE an already-open modal. See the design's "Approach".
 *
 * AUTH-FREE BY CONSTRUCTION. This component imports nothing from the store:
 * no `useCodexStore`, no `authenticate`, no `getPassword`. It collects a
 * password and hands it to the injected `onUnlock`. That matters because the
 * unlock window is ABSOLUTE, not sliding — `authenticate()` may only be called
 * on a genuinely locked codex, or it silently resets the TTL and makes the
 * displayed countdown lie (see `src/zbom/hooks/useEnsureCodexUnlocked.ts`).
 * Each caller owns that decision; keeping it out of here is what makes the
 * panel safe to reuse in three places.
 */

import { useState } from "react";

export interface InlineUnlockPromptProps {
  /** Why the password is being asked for, in the caller's own words — e.g.
   *  which of "locked" vs "the held password decrypts nothing" happened. */
  message: string;
  /** Button text. Defaults to the Account step panel's own wording style. */
  submitLabel?: string;
  /** Attempt the unlock. Resolve `{ ok: false, error }` to show `error` and
   *  keep the typed password for another try; `{ ok: true }` clears the field.
   *  The caller — not this component — decides whether to `authenticate()`. */
  onUnlock: (password: string) => Promise<{ ok: boolean; error?: string }>;
}

export function InlineUnlockPrompt({
  message,
  submitLabel = "Unlock & Continue",
  onUnlock,
}: InlineUnlockPromptProps): React.JSX.Element {
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = Boolean(password) && !unlocking;

  async function handleSubmit(): Promise<void> {
    if (!canSubmit) return;
    setUnlocking(true);
    setError(null);
    try {
      const result = await onUnlock(password);
      if (result.ok) {
        // Don't leave an accepted plaintext password sitting in a mounted
        // input, and don't let the previous failure's line outlive it.
        setPassword("");
        setError(null);
      } else {
        setError(result.error ?? "Incorrect password — try again.");
      }
    } finally {
      setUnlocking(false);
    }
  }

  return (
    <div
      data-testid="wizard-unlock-prompt"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "8px 10px",
        borderRadius: 8,
        backgroundColor: "#ceac5f15",
        border: "1px solid #ceac5f40",
        marginBottom: 2,
      }}
    >
      <span style={{ fontSize: 11, color: "#ceac5f" }}>{message}</span>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          type="password"
          value={password}
          disabled={unlocking}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSubmit) void handleSubmit();
          }}
          placeholder="Codex password"
          data-testid="wizard-unlock-prompt-input"
          style={{
            flex: 1,
            fontSize: 12,
            padding: "6px 8px",
            borderRadius: 6,
            border: "1px solid #333",
            backgroundColor: "#111",
            color: "#d2d3d4",
          }}
        />
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void handleSubmit()}
          data-testid="wizard-unlock-prompt-submit"
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: "6px 12px",
            borderRadius: 6,
            border: "none",
            cursor: canSubmit ? "pointer" : "not-allowed",
            backgroundColor: "#ceac5f",
            color: "#111",
            opacity: canSubmit ? 1 : 0.5,
          }}
        >
          {unlocking ? "Checking…" : submitLabel}
        </button>
      </div>
      {error ? (
        <span data-testid="wizard-unlock-prompt-error" style={{ fontSize: 11, color: "#f87171" }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
