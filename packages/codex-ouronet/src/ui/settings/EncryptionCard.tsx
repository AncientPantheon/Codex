/**
 * EncryptionCard — token-styled port of OuronetUI's EncryptionCardContent.
 *
 * Reads the codex's V1/V2 encryption level (read-only, via stoa-core's
 * allEncryptedV2 over the existing secrets — see encryptionState.ts) and
 * renders the status badge. The actual V1→V2 upgrade re-encrypts every
 * secret under the user's password — a crypto operation the package does
 * NOT own; the card delegates it to the `onUpgradeEncryption` consumer seam
 * and only surfaces the button while the codex is still legacy. Styled via
 * `--codex-*` tokens.
 */

import { useState } from "react";
import { useCodex } from "../../hooks/index.js";
import { collectCodexSecrets, encryptionLevel } from "./encryptionState.js";

export interface EncryptionCardProps {
  /** Consumer seam — performs the V1→V2 re-encryption + persistence. The
   *  card validates only that the codex is legacy before invoking it. When
   *  omitted, the upgrade button renders disabled. */
  onUpgradeEncryption?: () => Promise<void> | void;
  className?: string;
}

export function EncryptionCard({
  onUpgradeEncryption,
  className,
}: EncryptionCardProps) {
  const { kadenaSeeds, ouroAccounts, pureKeypairs } = useCodex();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const level = encryptionLevel(
    collectCodexSecrets({ kadenaSeeds, ouroAccounts, pureKeypairs }),
  );
  const isLegacy = level === "v1";

  const handleUpgrade = async () => {
    if (!onUpgradeEncryption) return;
    setError(null);
    setDone(false);
    setBusy(true);
    try {
      await onUpgradeEncryption();
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upgrade failed.");
    } finally {
      setBusy(false);
    }
  };

  const badge = isLegacy
    ? { text: "Legacy (10k SHA-256)", color: "var(--codex-warning)" }
    : level === "v2"
      ? { text: "Upgraded (600k SHA-512)", color: "var(--codex-success)" }
      : { text: "No secrets", color: "var(--codex-text-dim)" };

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
        <p style={{ fontSize: "14px", fontWeight: 600 }}>Encryption</p>
        <p
          style={{
            fontSize: "11px",
            marginTop: "4px",
            color: "var(--codex-text-dim)",
          }}
        >
          Manage encryption level
        </p>
      </div>

      <span
        style={{
          fontSize: "12px",
          fontWeight: 500,
          padding: "2px 10px",
          borderRadius: "999px",
          color: badge.color,
          border: `1px solid ${badge.color}`,
        }}
      >
        {badge.text}
      </span>

      {done && (
        <p style={{ fontSize: "11px", color: "var(--codex-success)" }}>
          ✓ Upgrade complete!
        </p>
      )}
      {error && (
        <p style={{ fontSize: "11px", color: "var(--codex-error)" }}>{error}</p>
      )}

      {isLegacy && (
        <button
          type="button"
          onClick={() => void handleUpgrade()}
          disabled={busy || !onUpgradeEncryption}
          style={{
            width: "100%",
            marginTop: "auto",
            padding: "8px 16px",
            borderRadius: "var(--codex-radius)",
            fontWeight: 600,
            cursor: busy ? "default" : "pointer",
            backgroundColor: "var(--codex-accent)",
            color: "var(--codex-bg)",
            border: "none",
            opacity: busy || !onUpgradeEncryption ? 0.5 : 1,
          }}
        >
          {busy ? "Upgrading…" : "Upgrade Encryption"}
        </button>
      )}
    </div>
  );
}

export default EncryptionCard;
