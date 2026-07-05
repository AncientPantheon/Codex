/**
 * <PasswordModal> — headless password prompt.
 *
 * Subscribes to the store's `pendingPasswordRequest` slice. When the
 * slice is non-null (set by `actions.requestPassword`), this component
 * renders its form. User submits → store.submitPasswordRequest →
 * the awaiting Promise resolves. User cancels → store.cancelPasswordRequest
 * → the awaiting Promise rejects with CodexLockedError.
 *
 * Renders NOTHING when there's no outstanding request — safe to mount
 * unconditionally at the app root.
 *
 * Theming: accept `className` for the outer container + render-prop
 * slots for header, body, submit/cancel buttons, error message. The
 * defaults give a working unstyled modal so consumers can ship quickly
 * and theme incrementally.
 *
 * No CSS imports — semantic HTML only. Consumers wrap with their own
 * styling layer.
 */

import * as React from "react";
import { useCallback, useState } from "react";
import { useCodexStore } from "../provider/index.js";

export interface PasswordModalRenderArgs {
  /** Current input value. Wire to your input's `value` prop. */
  password: string;
  /** Input change handler. Wire to your input's `onChange` prop. */
  onPasswordChange: (next: string) => void;
  /** Form submit handler. Wire to your form's `onSubmit` or button click. */
  onSubmit: () => void;
  /** Cancel handler — closes the modal + rejects the awaiting Promise. */
  onCancel: () => void;
  /** Last submit error (only set after a failed authenticate attempt
   *  that the consumer caught and surfaced — Phase 6a's flow doesn't
   *  validate the password against an encrypted secret, so this is
   *  always null for now. Phase 7's full provider may add pre-flight
   *  validation; this slot is reserved). */
  error: string | null;
  /** Whether a submit is in flight. Always false in Phase 6a (submit
   *  is synchronous); reserved for Phase 7 async validation. */
  submitting: boolean;
}

export interface PasswordModalProps {
  /** Optional outer container className. */
  className?: string;
  /** Override the entire markup with your own. Receives all state +
   *  handlers via the render arg. Overrides every other render-prop
   *  slot; use this for full design-system integration. */
  render?: (args: PasswordModalRenderArgs) => React.ReactNode;
  /** Override just the title block (default: "Enter codex password"). */
  renderTitle?: () => React.ReactNode;
  /** Override the submit button. Receives the submit handler. */
  renderSubmitButton?: (
    onClick: () => void,
    submitting: boolean
  ) => React.ReactNode;
  /** Override the cancel button. Receives the cancel handler. */
  renderCancelButton?: (onClick: () => void) => React.ReactNode;
  /** TTL in minutes to pass through to authenticate. Defaults to
   *  the codex's persisted uiSettings.passwordCacheMinutes. */
  ttlMinutes?: number;
}

export function PasswordModal({
  className,
  render,
  renderTitle,
  renderSubmitButton,
  renderCancelButton,
  ttlMinutes,
}: PasswordModalProps): React.JSX.Element | null {
  const store = useCodexStore();
  const pending = store((s) => s.pendingPasswordRequest);
  const actions = store((s) => s.actions);
  const [password, setPassword] = useState("");
  const [error] = useState<string | null>(null);

  // Reset the input whenever a new request starts.
  React.useEffect(() => {
    if (pending) setPassword("");
  }, [pending?.id]);

  const handleSubmit = useCallback(() => {
    if (!password) return;
    actions.submitPasswordRequest(password, ttlMinutes);
  }, [actions, password, ttlMinutes]);

  const handleCancel = useCallback(() => {
    actions.cancelPasswordRequest();
  }, [actions]);

  if (!pending) return null;

  const renderArgs: PasswordModalRenderArgs = {
    password,
    onPasswordChange: setPassword,
    onSubmit: handleSubmit,
    onCancel: handleCancel,
    error,
    submitting: false,
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
      aria-labelledby="codex-password-title"
      className={className}
    >
      <div id="codex-password-title">
        {renderTitle ? renderTitle() : <h2>Enter codex password</h2>}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
      >
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          aria-label="Codex password"
        />
        {error && (
          <p role="alert" aria-live="polite">
            {error}
          </p>
        )}
        <div>
          {renderSubmitButton ? (
            renderSubmitButton(handleSubmit, false)
          ) : (
            <button type="submit" disabled={!password}>
              Unlock
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
      </form>
    </div>
  );
}
