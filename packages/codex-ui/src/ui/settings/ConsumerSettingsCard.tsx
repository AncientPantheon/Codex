/**
 * ConsumerSettingsCard — token-styled view of one consumer's namespaced
 * settings slot (v0.3.0+) via `useConsumerSettings(name)`.
 *
 * Gates gracefully: an unknown consumer (no slot yet) shows a "no settings"
 * hint instead of crashing. When a slot exists it surfaces the consumer's
 * version + schema version + last-updated stamp (read-only view; writes are
 * the consumer app's job, not this card's). Styled via `--codex-*` tokens.
 */

import { useConsumerSettings } from "../../hooks/useConsumerSettings.js";

export interface ConsumerSettingsCardProps {
  /** The consumer registry key to view (e.g. "OuronetUI", "Mnemosyne"). */
  consumerName: string;
  className?: string;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function Row({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId: string;
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

export function ConsumerSettingsCard({
  consumerName,
  className,
}: ConsumerSettingsCardProps) {
  const { entry } = useConsumerSettings(consumerName);

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
        gap: "8px",
        fontFamily: "var(--codex-font)",
        color: "var(--codex-text)",
      }}
    >
      <p style={{ fontSize: "14px", fontWeight: 600 }}>
        Consumer Settings — {consumerName}
      </p>

      {entry === null ? (
        <p style={{ fontSize: "12px", color: "var(--codex-text-dim)" }}>
          No settings stored for {consumerName} yet.
        </p>
      ) : (
        <div>
          <Row
            label="Consumer Version"
            value={entry.consumerVersion}
            testId="consumer-version"
          />
          <Row
            label="Schema Version"
            value={String(entry.schemaVersion)}
            testId="consumer-schema"
          />
          <Row
            label="Last Updated"
            value={formatDate(entry.lastUpdatedAt)}
            testId="consumer-updated"
          />
        </div>
      )}
    </div>
  );
}

export default ConsumerSettingsCard;
