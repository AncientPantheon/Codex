/**
 * CodexIdentityCard — token-styled view of the codex's double-Apollo identity
 * (v0.3.0+) via `useCodexIdentity`.
 *
 * Three states, in precedence order:
 *   1. Registered  — a real on-chain `codexIdentity` exists → show `₱.…:Π.…` in
 *      the accent gold with a "registered" badge.
 *   2. Fed in       — no real identity, but an Observational CodexID is configured
 *      (Settings toggle on + both APOLLO halves picked) → show the constructed
 *      `₱.std:Π.smart` with an "observational — fed in" badge, so this card
 *      reflects that a Codex Identity IS present even in observational mode.
 *   3. Empty        — neither → the "claim / migrate to unlock" hint.
 *
 * Styled via `--codex-*` tokens.
 */

import { useCodexIdentity } from "../../hooks/useCodexIdentity.js";
import { useCodex } from "../../hooks/useCodex.js";
import { useOuroAccounts } from "../../hooks/useOuroAccounts.js";
import { readObservationalCodexIdConfig } from "../ObservationalCodexId.js";
import { CopyValueTag } from "../CodexIdField.js";

export interface CodexIdentityCardProps {
  className?: string;
}

const STD_ACCENT = "#f97316"; // APOLLO Standard ₱.
const SMT_ACCENT = "#a01b3f"; // APOLLO Smart Π.

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        fontSize: "9px",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        fontWeight: 600,
        padding: "1px 6px",
        borderRadius: "9999px",
        color,
        backgroundColor: `${color}15`,
        border: `1px solid ${color}40`,
      }}
    >
      {label}
    </span>
  );
}

export function CodexIdentityCard({ className }: CodexIdentityCardProps) {
  const { identity } = useCodexIdentity();
  const { uiSettings } = useCodex();
  const { accounts } = useOuroAccounts();

  // Real registered identity wins; otherwise fall back to the observational
  // ("fed in") CodexID built from the two chosen APOLLO accounts.
  const realFormatted = (identity as { formatted?: string } | null)?.formatted ?? null;

  const cfg = readObservationalCodexIdConfig(uiSettings as Record<string, unknown>);
  const std = cfg.enabled ? accounts.find((a) => a.id === cfg.standardId) : undefined;
  const smt = cfg.enabled ? accounts.find((a) => a.id === cfg.smartId) : undefined;
  const observationalFormatted = std && smt ? `${std.address}:${smt.address}` : null;

  const formatted = realFormatted ?? observationalFormatted;
  const isRegistered = realFormatted !== null;

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
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <p style={{ fontSize: "14px", fontWeight: 600, margin: 0 }}>Codex Identity</p>
        {formatted &&
          (isRegistered ? (
            <Badge label="registered" color="#4ade80" />
          ) : (
            <Badge label="observational — fed in" color={STD_ACCENT} />
          ))}
        <span style={{ flex: 1 }} />
        {/* Copy the whole CodexID — colour-matched to the header CodexID display
            (gold when registered, APOLLO-Standard orange when observational). */}
        {formatted && (
          <CopyValueTag text={formatted} color={isRegistered ? "var(--codex-accent)" : STD_ACCENT} />
        )}
      </div>

      {formatted === null ? (
        <p style={{ fontSize: "12px", color: "var(--codex-text-dim)" }}>
          No Codex Identity yet. Migrate this codex to v0.3.0 to claim its
          double-Apollo identity, or feed one in from the Observational CodexID
          settings.
        </p>
      ) : (
        <code
          data-testid="identity-formatted"
          style={{
            display: "block",
            wordBreak: "break-all",
            fontSize: "12px",
            fontFamily: "var(--codex-font-mono)",
            color: isRegistered ? "var(--codex-accent)" : SMT_ACCENT,
            backgroundColor: "var(--codex-bg)",
            border: "1px dashed var(--codex-border)",
            borderRadius: "6px",
            padding: "8px",
          }}
        >
          {formatted}
        </code>
      )}
    </div>
  );
}

export default CodexIdentityCard;
