/**
 * CodexLockControl + CodexPasswordPrompt — the codex unlock/lock affordance,
 * brought into the CodexUI so a drop-in consumer doesn't need the host's own
 * unlock button.
 *
 *   <CodexPasswordPrompt/>  mount once; renders the styled global password
 *                           prompt whenever any code calls requestPassword().
 *   <CodexLockControl/>     a button: "Unlock Codex" when locked (opens the
 *                           prompt) / "Lock Codex" + a live cache-expiry
 *                           countdown when unlocked.
 *
 * TTL comes from uiSettings.passwordCacheMinutes (edited in Codex UI Settings).
 */

import { useState, useEffect, type CSSProperties } from "react";
import { Lock, Unlock } from "lucide-react";
import { PasswordModal } from "../components/index.js";
import { useCodexAuth } from "../hooks/useCodexAuth.js";
import { useCodexStore } from "../provider/index.js";
import { CodexModalShell, PasswordField, ModalExecuteRow } from "./internal/CodexModalShell.js";

/** The styled global password prompt. Mount once inside the provider.
 *
 *  `zIndex={2147483647}` (the same "always topmost, no matter what" sentinel
 *  `OuronetAccountsTab.tsx`'s own `StoicTagPillar` hover card already uses):
 *  a signed action on a locked codex calls `ensureCodexUnlocked()` /
 *  `requestPassword()` from INSIDE whatever modal is already open (a ZBOM
 *  action card, an account-detail popup, …) — this prompt must always win
 *  the stack over ALL of them, or it renders invisibly behind the caller and
 *  its promise can never resolve. See `CodexModalShell`'s own `zIndex` prop
 *  doc comment for the bug this fixes. */
export function CodexPasswordPrompt() {
  return (
    <PasswordModal
      render={(a) => (
        <CodexModalShell title="Unlock Codex" subtitle="Enter your codex password to decrypt secrets" accent="#22c55e" onClose={a.onCancel} maxWidth={420} zIndex={2147483647}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "#888", marginBottom: 6 }}>
            Codex password
          </label>
          <PasswordField
            value={a.password}
            onChange={a.onPasswordChange}
            onEnter={() => { if (a.password) a.onSubmit(); }}
            autoFocus
          />
          {a.error && <p style={{ marginTop: 8, fontSize: 12, color: "#f87171" }}>{a.error}</p>}
          <ModalExecuteRow onCancel={a.onCancel} onSubmit={a.onSubmit} submitting={a.submitting} canSubmit={!!a.password} label="Unlock" accent="#22c55e" />
        </CodexModalShell>
      )}
    />
  );
}

export interface CodexLockControlProps {
  className?: string;
  /** A single, full-width "button row" instead of a compact inline pill —
   *  for Zone 2's mobile empty-state (docs/work/codex-ui-mobile/design.md
   *  §8 feedback round: "the zone 2 pattern we have on OuronetUI... title
   *  plus 3 button-like zones", matching the reference's stacked full-width
   *  rows). The unlocked countdown folds INTO the same button's label
   *  (`Lock Codex · MM:SS`) instead of a second trailing element, so this
   *  stays ONE zone/row, not two, and can never overflow past the row's own
   *  (now bounded, `width: 100%`) edge the way the inline pill's separate
   *  countdown `<span>` could. Default false — every existing caller is
   *  unaffected. */
  fullWidth?: boolean;
}

const fullWidthButtonStyle: CSSProperties = {
  display: "flex", width: "100%", alignItems: "center", justifyContent: "center", gap: 6,
  padding: "10px 12px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
  fontFamily: "var(--codex-font, inherit)",
};

export function CodexLockControl({ className, fullWidth }: CodexLockControlProps) {
  const { isLocked, lock, passwordCacheExpiresAt } = useCodexAuth();
  const store = useCodexStore();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const cacheValid = !!passwordCacheExpiresAt && passwordCacheExpiresAt > now;
  const effectiveLocked = isLocked || !cacheValid;

  if (effectiveLocked) {
    return (
      <button
        type="button"
        className={className}
        onClick={() => { void store.getState().actions.requestPassword().catch(() => {}); }}
        style={fullWidth ? {
          ...fullWidthButtonStyle,
          backgroundColor: "#22c55e15", border: "1px solid #22c55e40", color: "#4ade80",
        } : {
          display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8,
          fontSize: 12, fontWeight: 600, cursor: "pointer",
          backgroundColor: "#22c55e15", border: "1px solid #22c55e40", color: "#4ade80",
        }}
      >
        <Lock style={{ width: 14, height: 14 }} /> Unlock Codex
      </button>
    );
  }

  const remMs = (passwordCacheExpiresAt ?? now) - now;
  const mm = Math.floor(remMs / 60000);
  const ss = Math.floor((remMs % 60000) / 1000);
  const countdown = `${mm}:${String(ss).padStart(2, "0")}`;

  if (fullWidth) {
    return (
      <button
        type="button"
        className={className}
        onClick={lock}
        style={{
          ...fullWidthButtonStyle,
          backgroundColor: "#0a0a0a", border: "1px solid #262626", color: "#d2d3d4",
        }}
      >
        <Unlock style={{ width: 14, height: 14, color: "#4ade80", flexShrink: 0 }} />
        <span>Lock Codex</span>
        <span style={{ fontSize: 11, color: "#666", fontFamily: "var(--codex-font-mono, monospace)" }}>
          · {countdown}
        </span>
      </button>
    );
  }

  return (
    <div className={className} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button
        type="button"
        onClick={lock}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8,
          fontSize: 12, fontWeight: 600, cursor: "pointer",
          backgroundColor: "#0a0a0a", border: "1px solid #262626", color: "#d2d3d4",
        }}
      >
        <Unlock style={{ width: 14, height: 14, color: "#4ade80" }} /> Lock Codex
      </button>
      <span style={{ fontSize: 11, color: "#666", fontFamily: "var(--codex-font-mono, monospace)" }}>
        unlocked · {countdown}
      </span>
    </div>
  );
}
