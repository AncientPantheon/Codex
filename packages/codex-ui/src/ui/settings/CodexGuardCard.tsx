/**
 * CodexGuardCard — token-styled view of the active CodexGuard (v0.3.0+) via
 * `useCodexGuard`, with the generate-for-legacy + rotate actions.
 *
 * Gates gracefully: a codex with no active CodexGuard (legacy/fresh) shows a
 * "migrate to unlock / generate" hint and offers `generateForLegacy`. Once an
 * active guard exists, it shows the active public key + a Rotate control. Both
 * mutations delegate verbatim to the hook (which owns auth pre-flight + integrity
 * throws). Styled via `--codex-*` tokens.
 */

import { useState } from "react";
import { useCodexGuard } from "../../hooks/useCodexGuard.js";

export interface CodexGuardCardProps {
  className?: string;
}

export function CodexGuardCard({ className }: CodexGuardCardProps) {
  const { activePublicKey, generateForLegacy, rotate } = useCodexGuard();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (op: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await op();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed.");
    } finally {
      setBusy(false);
    }
  };

  const btnStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 16px",
    borderRadius: "var(--codex-radius)",
    fontWeight: 600,
    cursor: busy ? "default" : "pointer",
    opacity: busy ? 0.5 : 1,
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
        fontFamily: "var(--codex-font)",
        color: "var(--codex-text)",
      }}
    >
      <p style={{ fontSize: "14px", fontWeight: 600 }}>CodexGuard</p>

      {error && (
        <p style={{ fontSize: "11px", color: "var(--codex-error)" }}>{error}</p>
      )}

      {activePublicKey === null ? (
        <>
          <p style={{ fontSize: "12px", color: "var(--codex-text-dim)" }}>
            No active CodexGuard. Generate one to unlock v0.3.0 codex-guard
            signing for this legacy codex.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(generateForLegacy)}
            style={{
              ...btnStyle,
              backgroundColor: "var(--codex-accent)",
              color: "var(--codex-bg)",
              border: "none",
            }}
          >
            {busy ? "Generating…" : "Generate CodexGuard"}
          </button>
        </>
      ) : (
        <>
          <code
            data-testid="guard-pubkey"
            style={{
              display: "block",
              wordBreak: "break-all",
              fontSize: "12px",
              fontFamily: "var(--codex-font-mono)",
              color: "var(--codex-text)",
              backgroundColor: "var(--codex-bg)",
              border: "1px dashed var(--codex-border)",
              borderRadius: "6px",
              padding: "8px",
            }}
          >
            {activePublicKey}
          </code>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(rotate)}
            style={{
              ...btnStyle,
              backgroundColor: "transparent",
              color: "var(--codex-text)",
              border: "1px solid var(--codex-border)",
            }}
          >
            {busy ? "Rotating…" : "Rotate CodexGuard"}
          </button>
        </>
      )}
    </div>
  );
}

export default CodexGuardCard;
