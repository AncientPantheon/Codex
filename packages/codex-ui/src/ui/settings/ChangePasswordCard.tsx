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
import { useRequestLogout } from "../../hooks/useRequestLogout.js";

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

export interface ChangePasswordCardProps {
  /** Consumer seam — re-encrypts the codex under `newPassword`. The card
   *  hands over a validated pair; the consumer owns the crypto + persistence.
   *  When omitted, the card renders but the submit button is disabled.
   *
   *  The second parameter, `onProgress`, is OPTIONAL and purely additive —
   *  a real downstream consumer (OuronetUI) already had this exact shape on
   *  its own internal `upgradeCodexEncryption(password, onProgress?)`, and
   *  reported a permanently-stuck "Submitting…" with no way to tell a real
   *  hang apart from a dead UI. This card's own try/catch/finally was
   *  already correct (busy always clears once the returned promise settles,
   *  success or failure) — the actual gap was that a MULTI-SECRET
   *  re-encryption can legitimately take a while, with zero feedback. Call
   *  `onProgress(step)` as many times as you like while re-encrypting; the
   *  card shows the latest string. A consumer that ignores the second
   *  argument behaves exactly as before — no progress line ever renders. */
  onChangePassword?: (
    payload: ChangePasswordPayload,
    onProgress?: (step: string) => void,
  ) => Promise<void> | void;
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

const toggleButtonStyle: React.CSSProperties = {
  position: "absolute",
  right: "8px",
  top: "50%",
  transform: "translateY(calc(-50% + 7px))",
  background: "none",
  border: "none",
  padding: "2px 4px",
  fontSize: "11px",
  color: "var(--codex-text-dim)",
  cursor: "pointer",
};

/** A password `<input>` with its own independent show/hide toggle — a user
 *  revealing one field (e.g. New, to confirm it was typed correctly) should
 *  not also reveal Current or Confirm. The toggle button's own accessible
 *  name doubles as the test/UX seam ("Show current password" / "Hide
 *  current password"), matching the label's own wording so a screen reader
 *  announces the exact field a given toggle affects. */
function ToggleablePasswordField({
  label,
  ariaLabel,
  value,
  onChange,
  show,
  onToggleShow,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  show: boolean;
  onToggleShow: () => void;
}) {
  return (
    <label style={labelStyle}>
      {label}
      <div style={{ position: "relative" }}>
        <input
          type={show ? "text" : "password"}
          aria-label={ariaLabel}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...inputStyle, paddingRight: "52px" }}
        />
        <button
          type="button"
          aria-label={`${show ? "Hide" : "Show"} ${ariaLabel.toLowerCase()}`}
          onClick={onToggleShow}
          style={toggleButtonStyle}
        >
          {show ? "Hide" : "Show"}
        </button>
      </div>
    </label>
  );
}

export function ChangePasswordCard({
  onChangePassword,
  minLength = 8,
  className,
}: ChangePasswordCardProps) {
  const { lock } = useCodexAuth();
  const requestLogout = useRequestLogout();

  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  // Three INDEPENDENT reveal toggles — a user may want to confirm New/Confirm
  // match without re-revealing Current, so this is deliberately not one
  // shared "show all" flag.
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
    setBusy(false);
    setProgress(null);
    setShowCurrent(false);
    setShowNext(false);
    setShowConfirm(false);
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
    setProgress(null);
    try {
      await onChangePassword(
        { currentPassword: current, newPassword: next },
        (step: string) => setProgress(step),
      );
      setOpen(false);
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to change password.");
      setBusy(false);
      setProgress(null);
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
          <ToggleablePasswordField
            label="Current Password"
            ariaLabel="Current password"
            value={current}
            onChange={setCurrent}
            show={showCurrent}
            onToggleShow={() => setShowCurrent((s) => !s)}
          />
          <ToggleablePasswordField
            label="New Password"
            ariaLabel="New password"
            value={next}
            onChange={setNext}
            show={showNext}
            onToggleShow={() => setShowNext((s) => !s)}
          />
          <ToggleablePasswordField
            label="Confirm New Password"
            ariaLabel="Confirm new password"
            value={confirm}
            onChange={setConfirm}
            show={showConfirm}
            onToggleShow={() => setShowConfirm((s) => !s)}
          />

          {error && (
            <p style={{ fontSize: "11px", color: "var(--codex-error)" }}>
              {error}
            </p>
          )}

          {busy && progress && (
            <p
              data-testid="change-password-progress"
              style={{ fontSize: "11px", color: "var(--codex-text-dim)" }}
            >
              {progress}
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
            onClick={() => {
              // Same save-reminder gate CodexLockControl's "Lock Codex"
              // button uses — a UX convenience checkpoint only (see
              // SESSION_LIFECYCLE_CONTRACT.md), never a block.
              void requestLogout().then((outcome) => {
                if (outcome !== "cancelled") lock();
              });
            }}
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
