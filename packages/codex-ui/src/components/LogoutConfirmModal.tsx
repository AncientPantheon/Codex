/**
 * <LogoutConfirmModal> — headless logout-confirmation choice.
 *
 * Subscribes to the store's `pendingLogoutRequest` slice. When the slice
 * is non-null (set by `actions.requestLogoutConfirmation`, reached via
 * `useRequestLogout`'s fallthrough once it has already ruled out the clean
 * case), this component renders its choice. Renders NOTHING when there's
 * no outstanding request — safe to mount unconditionally at the app root.
 * Same headless/render-prop convention, same "reads a pending-X slice,
 * calls completion actions" responsibility split as <PasswordModal>.
 *
 * A UX convenience reminder, NOT a safety mechanism: `dirty` tracks
 * divergence from the last *external* backup, never from
 * unsaved-to-local-storage. This modal must never be framed as protecting
 * funds or the non-removable-account invariant — those are independently
 * chain-truth-backed and unaffected by anything here.
 *
 * Three controls settle the pending request:
 *   - "back up now" runs `useCodexBackup().downloadAsJson()` (the one
 *     backup path that needs no host-supplied Arweave wiring); on success
 *     it calls `actions.completeLogoutRequest("backed-up")` (the store
 *     itself clears `dirty` — this component never calls `clearDirty()`
 *     directly). A host wanting an Arweave "back up now" option builds its
 *     own confirmation UI against the raw store actions instead.
 *   - "continue without backing up" calls
 *     `actions.completeLogoutRequest("proceeded-without-backup")`.
 *   - "cancel" calls `actions.cancelLogoutRequest()`.
 *
 * No CSS imports — semantic HTML only. Consumers wrap with their own
 * styling layer.
 */

import * as React from "react";
import { useCallback, useState } from "react";
import { useCodexStore } from "../provider/index.js";
import { useCodexBackup } from "../hooks/useCodexBackup.js";

export interface LogoutConfirmModalRenderArgs {
  /** Backs up via `downloadAsJson()`, then settles the request as
   *  `"backed-up"` on success. Leaves the request pending (and surfaces
   *  `error`) if the download throws. */
  onBackUpNow: () => void;
  /** Settles the request as `"proceeded-without-backup"` — `dirty` is
   *  left unchanged (still `true`). */
  onContinueWithoutBackup: () => void;
  /** Settles the request as `"cancelled"` — nothing changes. */
  onCancel: () => void;
  /** Error from a failed `downloadAsJson()` call, if any. */
  error: string | null;
  /** Whether a "back up now" download is in flight. */
  backingUp: boolean;
}

export interface LogoutConfirmModalProps {
  /** Optional outer container className. */
  className?: string;
  /** Override the entire markup with your own. Receives all state +
   *  handlers via the render arg. Overrides every other render-prop
   *  slot. */
  render?: (args: LogoutConfirmModalRenderArgs) => React.ReactNode;
  /** Override just the title block (default: "Back up before logging
   *  out?"). */
  renderTitle?: () => React.ReactNode;
  /** Override the "back up now" button. */
  renderBackUpButton?: (
    onClick: () => void,
    backingUp: boolean
  ) => React.ReactNode;
  /** Override the "continue without backing up" button. */
  renderContinueButton?: (onClick: () => void) => React.ReactNode;
  /** Override the "cancel" button. */
  renderCancelButton?: (onClick: () => void) => React.ReactNode;
  /** Filename for the downloaded JSON file, passed through to
   *  `downloadAsJson`. Default: `OuronetCodex_<ISO>.json`. */
  downloadFilename?: string;
}

export function LogoutConfirmModal({
  className,
  render,
  renderTitle,
  renderBackUpButton,
  renderContinueButton,
  renderCancelButton,
  downloadFilename,
}: LogoutConfirmModalProps): React.JSX.Element | null {
  const store = useCodexStore();
  const pending = store((s) => s.pendingLogoutRequest);
  const actions = store((s) => s.actions);
  const backup = useCodexBackup();
  const [backingUp, setBackingUp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset transient state whenever a new request starts.
  React.useEffect(() => {
    if (pending) {
      setBackingUp(false);
      setError(null);
    }
  }, [pending?.id]);

  const handleBackUpNow = useCallback(() => {
    setBackingUp(true);
    setError(null);
    backup
      .downloadAsJson(downloadFilename)
      .then(() => {
        actions.completeLogoutRequest("backed-up");
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setBackingUp(false);
      });
  }, [backup, downloadFilename, actions]);

  const handleContinueWithoutBackup = useCallback(() => {
    actions.completeLogoutRequest("proceeded-without-backup");
  }, [actions]);

  const handleCancel = useCallback(() => {
    actions.cancelLogoutRequest();
  }, [actions]);

  if (!pending) return null;

  const renderArgs: LogoutConfirmModalRenderArgs = {
    onBackUpNow: handleBackUpNow,
    onContinueWithoutBackup: handleContinueWithoutBackup,
    onCancel: handleCancel,
    error,
    backingUp,
  };

  if (render) {
    return <>{render(renderArgs)}</>;
  }

  // Default unstyled markup. Consumers theme via className or override
  // via render-prop slots / full `render` prop.
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="codex-logout-confirm-title"
      className={className}
    >
      <div id="codex-logout-confirm-title">
        {renderTitle ? (
          renderTitle()
        ) : (
          <h2>Back up before logging out?</h2>
        )}
      </div>
      {error && (
        <p role="alert" aria-live="polite">
          {error}
        </p>
      )}
      <div>
        {renderBackUpButton ? (
          renderBackUpButton(handleBackUpNow, backingUp)
        ) : (
          <button type="button" onClick={handleBackUpNow} disabled={backingUp}>
            Back up now
          </button>
        )}
        {renderContinueButton ? (
          renderContinueButton(handleContinueWithoutBackup)
        ) : (
          <button type="button" onClick={handleContinueWithoutBackup}>
            Continue without backing up
          </button>
        )}
        {renderCancelButton ? (
          renderCancelButton(handleCancel)
        ) : (
          <button type="button" onClick={handleCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
