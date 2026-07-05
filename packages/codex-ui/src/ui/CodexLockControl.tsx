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

import { useState, useEffect } from "react";
import { Lock, Unlock } from "lucide-react";
import { PasswordModal } from "../components/index.js";
import { useCodexAuth } from "../hooks/useCodexAuth.js";
import { useCodexStore } from "../provider/index.js";
import { CodexModalShell, PasswordField, ModalExecuteRow } from "./internal/CodexModalShell.js";

/** The styled global password prompt. Mount once inside the provider. */
export function CodexPasswordPrompt() {
  return (
    <PasswordModal
      render={(a) => (
        <CodexModalShell title="Unlock Codex" subtitle="Enter your codex password to decrypt secrets" accent="#22c55e" onClose={a.onCancel} maxWidth={420}>
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
}

export function CodexLockControl({ className }: CodexLockControlProps) {
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
        style={{
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
