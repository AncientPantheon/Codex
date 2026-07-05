/**
 * DownloadCodexCard — token-styled port of OuronetUI's "Download Codex" card.
 *
 * Delegates wholly to `useCodexBackup().downloadAsJson` (the v1.2-plus
 * backup-file writer). No re-implementation of the blob/download mechanics
 * here — the hook owns that. Surfaces a busy state + any error the hook
 * throws (e.g. SSR-environment guard). Styled via `--codex-*` tokens.
 */

import { useState } from "react";
import { useCodexBackup } from "../../hooks/useCodexBackup.js";

export interface DownloadCodexCardProps {
  className?: string;
}

export function DownloadCodexCard({ className }: DownloadCodexCardProps) {
  const { downloadAsJson } = useCodexBackup();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async () => {
    setError(null);
    setBusy(true);
    try {
      await downloadAsJson();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed.");
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
        <p style={{ fontSize: "14px", fontWeight: 600 }}>Download Codex</p>
        <p
          style={{
            fontSize: "11px",
            marginTop: "4px",
            color: "var(--codex-text-dim)",
            fontFamily: "var(--codex-font-mono)",
          }}
        >
          OuronetCodex_date_time.json
        </p>
      </div>

      {error && (
        <p style={{ fontSize: "11px", color: "var(--codex-error)" }}>{error}</p>
      )}

      <button
        type="button"
        onClick={() => void handleDownload()}
        disabled={busy}
        style={{
          width: "100%",
          marginTop: "auto",
          padding: "8px 16px",
          borderRadius: "var(--codex-radius)",
          fontWeight: 600,
          cursor: busy ? "default" : "pointer",
          backgroundColor: "transparent",
          color: "var(--codex-text)",
          border: "1px solid var(--codex-border)",
          opacity: busy ? 0.5 : 1,
        }}
      >
        {busy ? "Downloading…" : "Download"}
      </button>
    </div>
  );
}

export default DownloadCodexCard;
