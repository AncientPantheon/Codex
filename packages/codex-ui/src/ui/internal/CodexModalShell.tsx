/**
 * CodexModalShell — the popup chrome the packaged CodexUI modals render into:
 * a centered, scrollable card with a title bar and close button. The
 * package's signing modals (Rotate*, etc.) are headless (render-prop) by
 * design; this shell is the UI-layer skin that turns them into real centered
 * popups matching My Codex's modal look (dark card, gold title, dashed-free
 * border), without coupling the headless components to any styling.
 *
 * MOBILE: on a narrow `CodexUiRoot` (`useIsMobile()`, container-relative —
 * see `docs/work/codex-ui-mobile/design.md` §7, the Pantheonic mobile doc's
 * "modals go full-screen on mobile" rule), this is the ONE shared component
 * change that flips EVERY modal built on this shell at once: the backdrop
 * becomes `position: absolute` (anchored to `CodexUiRoot`, which is
 * `position: relative` — see `CodexUiRoot.tsx` — so a modal never escapes an
 * embedded CodexUI's own rectangle the way `position: fixed` against the
 * viewport would), and the card becomes a full-bleed, content-height sheet
 * (no max-width cap, no rounded corners) instead of a centered, capped-width
 * card.
 */

import * as React from "react";
import { useState } from "react";
import { X, Eye, EyeOff } from "lucide-react";
import { useIsMobile } from "../mobile/MobileContext.js";

export interface CodexModalShellProps {
  title: string;
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  /** Accent for the title + top rule. Defaults to the codex gold. */
  accent?: string;
  maxWidth?: number;
}

export function CodexModalShell({
  title,
  subtitle,
  onClose,
  children,
  accent = "#ceac5f",
  maxWidth = 520,
}: CodexModalShellProps) {
  const isMobile = useIsMobile();
  return (
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: isMobile ? "absolute" : "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: isMobile ? "stretch" : "center",
        justifyContent: "center",
        padding: isMobile ? 0 : 16,
        backgroundColor: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(2px)",
        // Explicit (not just the implicit default) — a caller MAY portal this
        // shell into a `pointer-events: none` overlay wrapper (e.g. a
        // full-screen modal-portal target spanning a mobile shell's whole
        // body — docs/work/codex-ui-mobile/design.md §8), and `pointer-events`
        // is inherited; without this override the whole dialog would
        // silently become unclickable in that case.
        pointerEvents: "auto",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: isMobile ? "none" : maxWidth,
          height: isMobile ? "100%" : undefined,
          maxHeight: isMobile ? "100%" : "90vh",
          overflowY: "auto",
          backgroundColor: "#0a0a0a",
          border: isMobile ? "none" : "1px solid #262626",
          borderRadius: isMobile ? 0 : 16,
          boxShadow: isMobile ? "none" : "0 20px 60px rgba(0,0,0,0.6)",
          fontFamily: "var(--codex-font, inherit)",
          color: "#d2d3d4",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "16px 20px",
            borderBottom: `1px solid ${accent}30`,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: accent }}>{title}</h2>
            {subtitle && <div style={{ marginTop: 2, fontSize: 11, color: "#888" }}>{subtitle}</div>}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 30, height: 30, borderRadius: 8, flexShrink: 0,
              background: "#141414", border: "1px solid #262626", color: "#888", cursor: "pointer",
            }}
          >
            <X size={16} />
          </button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}

/* Shared form primitives for the modal bodies. */

export const modalLabel: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 600, textTransform: "uppercase",
  letterSpacing: "0.05em", color: "#888", marginBottom: 6,
};

export const modalInput: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", height: 40, padding: "0 12px", borderRadius: 8,
  backgroundColor: "#111", border: "1px solid #262626", color: "#d2d3d4",
  fontFamily: "var(--codex-font-mono, ui-monospace, monospace)", fontSize: 13,
};

export function ModalExecuteRow({
  onCancel, onSubmit, submitting, canSubmit, label, accent = "#ceac5f",
}: {
  onCancel: () => void;
  onSubmit: () => void;
  submitting: boolean;
  canSubmit: boolean;
  label: string;
  accent?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 20 }}>
      <button
        type="button"
        onClick={onCancel}
        style={{ padding: "10px 16px", borderRadius: 8, background: "transparent", border: "1px solid #262626", color: "#d2d3d4", cursor: "pointer", fontSize: 13 }}
      >
        Cancel
      </button>
      <div style={{ flex: 1 }} />
      <button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit}
        style={{
          padding: "10px 20px", borderRadius: 8, border: "none", fontWeight: 700, fontSize: 13,
          backgroundColor: accent, color: "#0a0a0a",
          cursor: canSubmit ? "pointer" : "not-allowed", opacity: canSubmit ? 1 : 0.5,
        }}
      >
        {submitting ? "Submitting…" : label}
      </button>
    </div>
  );
}

/** Password input with a show/hide reveal toggle (eye icon). */
export function PasswordField({
  value, onChange, onEnter, autoFocus, placeholder = "••••••••",
}: {
  value: string;
  onChange: (next: string) => void;
  onEnter?: () => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input
        type={show ? "text" : "password"}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && onEnter) onEnter(); }}
        placeholder={placeholder}
        style={{ ...modalInput, paddingRight: 40, fontFamily: "var(--codex-font, inherit)" }}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        title={show ? "Hide" : "Show"}
        aria-label={show ? "Hide password" : "Show password"}
        style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#888", cursor: "pointer", display: "inline-flex", padding: 2 }}
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

export function ModalFeedback({ error, requestKey }: { error: string | null; requestKey: string | null }) {
  return (
    <>
      {error && (
        <p role="alert" style={{ marginTop: 12, padding: "8px 12px", borderRadius: 8, fontSize: 12, backgroundColor: "#8b1a1a15", border: "1px solid #8b1a1a40", color: "#f87171" }}>
          {error}
        </p>
      )}
      {requestKey && (
        <p style={{ marginTop: 12, padding: "8px 12px", borderRadius: 8, fontSize: 12, backgroundColor: "#22c55e15", border: "1px solid #22c55e40", color: "#4ade80", wordBreak: "break-all" }}>
          Submitted — request key: {requestKey}
        </p>
      )}
    </>
  );
}
