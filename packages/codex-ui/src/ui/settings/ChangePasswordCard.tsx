/**
 * ChangePasswordCard — token-styled change-password affordance.
 *
 * The package does NOT own codex-password rotation: re-encrypting every
 * secret under a new password is a crypto operation the consumer performs
 * (OuronetUI's ChangePasswordModal does this against its own wallet-context).
 * This card owns only the FORM + validation, then delegates the validated
 * pair to the `onChangePassword` seam — the same consumer-seam pattern the
 * Phase-14 tabs used. It also exposes `lock()` from `useCodexAuth` so the
 * user can drop the cached password without rotating it.
 *
 * Styled exclusively via `--codex-*` tokens.
 */

import { useState } from "react";
import { useCodexAuth } from "../../hooks/useCodexAuth.js";

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

export interface ChangePasswordCardProps {
  /** Consumer seam — re-encrypts the codex under `newPassword`. The card
   *  hands over a validated pair; the consumer owns the crypto + persistence.
   *  When omitted, the card renders but the submit button is disabled. */
  onChangePassword?: (payload: ChangePasswordPayload) => Promise<void> | void;
  /** Minimum new-password length the form enforces before delegating.
   *  Defaults to 8 (matches OuronetUI). */
  minLength?: number;
  className?: string;
}

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: "4px",
  padding: "8px 12px",
  borderRadius: "var(--codex-radius)",
  backgroundColor: "var(--codex-surface)",
  border: "1px solid var(--codex-border)",
  color: "var(--codex-text)",
};

const labelStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "var(--codex-text-dim)",
};

export function ChangePasswordCard({
  onChangePassword,
  minLength = 8,
  className,
}: ChangePasswordCardProps) {
  const { lock } = useCodexAuth();

  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
    setBusy(false);
  };

  const validate = (): string | null => {
    if (!current) return "Enter your current password.";
    if (!next) return "Enter a new password.";
    if (next.length < minLength)
      return `New password must be at least ${minLength} characters.`;
    if (next !== confirm) return "New passwords do not match.";
    if (current === next)
      return "New password must be different from the current password.";
    return null;
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    if (!onChangePassword) return;
    setBusy(true);
    try {
      await onChangePassword({ currentPassword: current, newPassword: next });
      setOpen(false);
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to change password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={className}
      style={{
        borderRadius: "var(--codex-radius)",
        border: "1px solid var(--codex-border)",
        backgroundColor: "var(--codex-surface-2)",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        alignItems: "center",
        textAlign: "center",
        fontFamily: "var(--codex-font)",
        color: "var(--codex-text)",
      }}
    >
      <div>
        <p style={{ fontSize: "14px", fontWeight: 600 }}>Change Password</p>
        <p
          style={{
            fontSize: "11px",
            marginTop: "4px",
            color: "var(--codex-text-dim)",
          }}
        >
          Update the codex encryption password
        </p>
      </div>

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            width: "100%",
            marginTop: "auto",
            padding: "8px 16px",
            borderRadius: "var(--codex-radius)",
            cursor: "pointer",
            backgroundColor: "transparent",
            color: "var(--codex-text)",
            border: "1px solid var(--codex-border)",
            fontWeight: 600,
          }}
        >
          Change Password
        </button>
      ) : (
        <div
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            textAlign: "left",
          }}
        >
          <label style={labelStyle}>
            Current Password
            <input
              type="password"
              aria-label="Current password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            New Password
            <input
              type="password"
              aria-label="New password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            Confirm New Password
            <input
              type="password"
              aria-label="Confirm new password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              style={inputStyle}
            />
          </label>

          {error && (
            <p style={{ fontSize: "11px", color: "var(--codex-error)" }}>
              {error}
            </p>
          )}

          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={busy || !onChangePassword}
              style={{
                flex: 1,
                padding: "8px 16px",
                borderRadius: "var(--codex-radius)",
                fontWeight: 600,
                cursor: busy ? "default" : "pointer",
                backgroundColor: "var(--codex-accent)",
                color: "var(--codex-bg)",
                border: "none",
                opacity: busy || !onChangePassword ? 0.5 : 1,
              }}
            >
              {busy ? "Submitting…" : "Submit"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                reset();
              }}
              style={{
                padding: "8px 16px",
                borderRadius: "var(--codex-radius)",
                cursor: "pointer",
                backgroundColor: "transparent",
                color: "var(--codex-text)",
                border: "1px solid var(--codex-border)",
              }}
            >
              Cancel
            </button>
          </div>

          <button
            type="button"
            onClick={() => lock()}
            style={{
              alignSelf: "flex-start",
              background: "none",
              border: "none",
              padding: 0,
              fontSize: "11px",
              color: "var(--codex-text-dim)",
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            Lock codex now
          </button>
        </div>
      )}
    </div>
  );
}

export default ChangePasswordCard;
