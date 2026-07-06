/**
 * CodexInfoCard — token-styled, Redux-free port of OuronetUI's CodexInfoSection.
 *
 * A read-only status panel: schema version, encryption level (V1/V2 derived
 * from the codex secrets), last-updated timestamp + device, and live counts
 * of each codex slice. All data flows through `useCodex` over a mounted
 * <CodexProvider>; nothing here mutates. Styled exclusively via `--codex-*`
 * tokens so consumers reskin by overriding tokens.
 */

import { useCodex } from "../../hooks/index.js";
import { collectCodexSecrets, encryptionLevel } from "./encryptionState.js";

export interface CodexInfoCardProps {
  /** Consumer class merged onto the card root. */
  className?: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function InfoRow({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "4px 0",
        borderTop: "1px solid var(--codex-border)",
      }}
    >
      <span style={{ fontSize: "12px", color: "var(--codex-text-dim)" }}>
        {label}
      </span>
      <span
        data-testid={testId}
        style={{
          fontSize: "12px",
          fontFamily: "var(--codex-font-mono)",
          color: "var(--codex-text)",
        }}
      >
        {value}
      </span>
    </div>
  );
}

export function CodexInfoCard({ className }: CodexInfoCardProps) {
  const {
    schemaVersion,
    lastUpdatedAt,
    lastUpdatedDevice,
    kadenaSeeds,
    ouroAccounts,
    pureKeypairs,
    addressBook,
    watchList,
  } = useCodex();

  const abOuronet = addressBook.filter(
    (e: { type?: string }) => e.type === "ouronet" || !e.type,
  ).length;
  const abStoa = addressBook.filter((e: { type?: string }) => e.type === "stoa").length;

  const secrets = collectCodexSecrets({
    kadenaSeeds,
    ouroAccounts,
    pureKeypairs,
  });
  const level = encryptionLevel(secrets);
  const encryptionLabel =
    level === "none"
      ? "No secrets"
      : level === "v2"
        ? "V2 (PBKDF2 600k SHA-512)"
        : "V1 Legacy (PBKDF2 10k SHA-256)";

  return (
    <div
      className={className}
      style={{
        borderRadius: "var(--codex-radius-lg)",
        border: "1px solid var(--codex-border)",
        backgroundColor: "var(--codex-surface-2)",
        padding: "16px",
        fontFamily: "var(--codex-font)",
        color: "var(--codex-text)",
      }}
    >
      <h3
        style={{
          fontSize: "12px",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: "12px",
          color: "var(--codex-text-dim)",
        }}
      >
        Codex Info
      </h3>
      <div>
        <InfoRow
          label="Schema Version"
          value={String(schemaVersion)}
          testId="info-schema"
        />
        <InfoRow
          label="Encryption"
          value={encryptionLabel}
          testId="info-encryption"
        />
        <InfoRow
          label="Last Updated"
          value={formatDate(lastUpdatedAt)}
          testId="info-updated"
        />
        <InfoRow
          label="Device"
          value={lastUpdatedDevice}
          testId="info-device"
        />
        <InfoRow
          label="Seeds"
          value={String(kadenaSeeds.length)}
          testId="info-seeds"
        />
        <InfoRow
          label="Ouro Accounts"
          value={String(ouroAccounts.length)}
          testId="info-ouro"
        />
        <InfoRow
          label="Pure Keys"
          value={String(pureKeypairs.length)}
          testId="info-pure"
        />
        <InfoRow
          label="AddressBook Ouronet Accounts"
          value={String(abOuronet)}
          testId="info-ab-ouronet"
        />
        <InfoRow
          label="AddressBook Stoa Accounts"
          value={String(abStoa)}
          testId="info-ab-stoa"
        />
        <InfoRow
          label="Watched Stoa"
          value={String(watchList.length)}
          testId="info-watch"
        />
      </div>
      <p
        style={{
          marginTop: "12px",
          fontSize: "10px",
          color: "var(--codex-text-dim)",
        }}
      >
        Encrypted locally. Cloud sync stores encrypted data only.
      </p>
    </div>
  );
}

export default CodexInfoCard;
