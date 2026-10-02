// ============================================================================
// CreateCodexScreen — the minimal "create a brand-new codex" form (T4 of
// docs/work/codex-recovery-backup-tagging/plan.md).
//
// No file under `apps/` called `useCodexLifecycle()`'s `kickstart` before
// this task — there was no "create a brand-new codex" UI path in the
// playground at all, only "Load your Codex" (restore an existing encrypted
// backup). This is that path's minimal, real, clickable form half: a
// password + seed words pair, and a submit that kicks off kickstart + the
// Prime Arweave seed auto-install (wired by `App.tsx`'s `NewCodexSession`).
//
// PRESENTATIONAL + INJECTED (mirrors `ArweaveSeedsArea.tsx`'s own "reaches
// into NO store" discipline): this component owns ONLY its own form state —
// the password/words inputs — and never touches a hook, a store, or
// crypto itself. `onCreate` is the single seam; the host decides what
// happens with the typed values.
// ============================================================================

import { useState, type FormEvent, type ReactElement } from "react";

export interface CreateCodexScreenProps {
  /** Called with the typed password + seed words on submit. Never called
   *  with an empty password (the guard below never lets that through) — a
   *  `kickstart` call must never be seeded with an empty secret. */
  onCreate: (args: { password: string; words: string }) => void | Promise<void>;
  /** True while a create is in flight (kickstart + the ~6.7s Prime Arweave
   *  seed derivation) — disables the form so a second click can't race the
   *  first. */
  busy: boolean;
  /** The live in-progress label, surfaced as the button's own text WHILE
   *  `busy` — never a silent multi-second freeze. Omitted while idle. */
  progressLabel?: string | null;
  /** A secret-free error message from a failed create, rendered as an
   *  `alert`. */
  errorMessage?: string | null;
  /** Back to the load screen. Omitted hides the control entirely. */
  onCancel?: () => void;
}

/** A sensible, ready-to-click default so a dev can exercise the whole flow
 *  without first composing their own seed words — still fully editable. */
const DEFAULT_SEED_WORDS = "orbit lantern meadow cobalt granite ember";

export function CreateCodexScreen({
  onCreate,
  busy,
  progressLabel,
  errorMessage,
  onCancel,
}: CreateCodexScreenProps): ReactElement {
  const [password, setPassword] = useState("");
  const [words, setWords] = useState(DEFAULT_SEED_WORDS);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    // Empty-secret guard — mirrors UnlockScreen's own: never seed kickstart
    // with an empty password, and never kickstart with no seed words either.
    if (password.length === 0 || words.trim().length === 0) {
      return;
    }
    void onCreate({ password, words: words.trim() });
  }

  return (
    <div className="cxpg-app cxpg-landing">
      <div className="cxpg-card">
        <div className="cxpg-logo" aria-hidden="true">
          ◈
        </div>
        <h1 className="cxpg-title">Create a new Codex</h1>
        <p className="cxpg-subtitle">
          Kickstarts a fresh codex AND installs its Prime Arweave seed
          automatically — derived from the same words as the new Prime
          Ouronet account, no separate step.
        </p>

        <form className="cxpg-form" onSubmit={handleSubmit}>
          <label htmlFor="new-codex-password" className="cxpg-field-label">
            Codex password
          </label>
          <input
            id="new-codex-password"
            className="cxpg-input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Set a password for this codex"
            autoComplete="new-password"
            disabled={busy}
          />

          <label htmlFor="new-codex-words" className="cxpg-field-label">
            Seed words
          </label>
          <textarea
            id="new-codex-words"
            className="cxpg-input"
            value={words}
            onChange={(event) => setWords(event.target.value)}
            placeholder="Space-separated seed words"
            rows={2}
            disabled={busy}
          />

          {errorMessage ? (
            <p className="cxpg-error" role="alert">
              {errorMessage}
            </p>
          ) : null}

          <button
            type="submit"
            className="cxpg-btn cxpg-btn--primary cxpg-btn--block"
            disabled={busy}
          >
            {busy ? (progressLabel ?? "Creating…") : "Create Codex"}
          </button>
        </form>

        {onCancel ? (
          <button
            type="button"
            className="cxpg-btn cxpg-btn--ghost cxpg-btn--sm"
            onClick={onCancel}
            disabled={busy}
          >
            Back
          </button>
        ) : null}

        <p className="cxpg-note">
          Your password and seed words never leave this device.
        </p>
      </div>
    </div>
  );
}
