/**
 * CodexSettingsSection — the Ouronet-side aggregator that fills codex-ui's
 * chain-generic <CodexSettingsSectionShell> with the concrete settings cards +
 * the zbom-specific subtab taxonomy.
 *
 * The D5 carve moved the pure-layout pill-subtab bar + active-subtab switching
 * state into codex-ui's <CodexSettingsSectionShell>; this aggregator STAYS
 * Ouronet-side (it owns the Ouronet card taxonomy — the Operations/Debouncer/
 * Read-Functions subtabs are zbom-specific, and it statically imports the STAY
 * zbom cards + the @stoachain-edged CodexInfoCard/EncryptionCard). It injects
 * the whole `{subtabs, cards}` set through the shell's `subtabs` slot.
 *
 * MOVE cards (no chain edge) are imported from @ancientpantheon/codex-ui/ui; the
 * five STAY cards (the three zbom cards + CodexInfoCard + EncryptionCard, C4) are
 * imported locally. The public props (onChangePassword / onUpgradeEncryption /
 * consumerName / initialTab / className) stay byte-stable (N-04).
 *
 * The Google Drive sync card is intentionally excluded (it stays
 * redux/localStorage-bound in OuronetUI). The card-owned consumer seams
 * (`onChangePassword`, `onUpgradeEncryption`) thread through as section props —
 * the package never re-encrypts or rotates passwords itself; it delegates to the
 * host app. All visual structure uses `--codex-*` tokens.
 */

import { type CSSProperties } from "react";
import {
  ChangePasswordCard,
  type ChangePasswordPayload,
  DownloadCodexCard,
  ExperimentalCurvesCard,
  CodexIdentityCard,
  CodexGuardCard,
  ConsumerSettingsCard,
  PasswordCacheCard,
  GasSettingsCard,
  ObservationalCodexIdSettings,
} from "@ancientpantheon/codex-ui/ui";
import type { CodexSettingsSubtab } from "@ancientpantheon/codex-ui/ui";
import { CodexSettingsSectionShell } from "@ancientpantheon/codex-ui/ui";
import { CodexInfoCard } from "./CodexInfoCard.js";
import { EncryptionCard } from "./EncryptionCard.js";
import { ZbomSettingsCard } from "./ZbomSettingsCard.js";
import { DebouncerSettingsCard } from "./DebouncerSettingsCard.js";
import { ReadFunctionsCard } from "./ReadFunctionsCard.js";

export interface CodexSettingsSectionProps {
  /** Re-encryption seam forwarded to <ChangePasswordCard>. The package hands
   *  over a validated {currentPassword,newPassword} pair; the host owns the
   *  crypto + persistence. */
  onChangePassword?: (payload: ChangePasswordPayload) => Promise<void> | void;
  /** V1→V2 upgrade seam forwarded to <EncryptionCard>. */
  onUpgradeEncryption?: () => Promise<void> | void;
  /** Consumer registry key for the embedded <ConsumerSettingsCard>. Defaults
   *  to "OuronetUI". */
  consumerName?: string;
  /** Subtab open on first render. Defaults to "operations". */
  initialTab?: SettingsTab;
  /** Consumer class merged onto the section root. */
  className?: string;
}

type SettingsTab =
  | "operations"
  | "debouncer"
  | "read-functions"
  | "security"
  | "identity"
  | "advanced";

/** Responsive auto-fit grid used to lay out the small action cards in a tab.
 *  `alignItems: stretch` makes every card in a row share the tallest card's
 *  height — so the rectangles line up cleanly instead of looking ragged. */
function cardGrid(min: number): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`,
    gap: "12px",
    alignItems: "stretch",
  };
}

export function CodexSettingsSection({
  onChangePassword,
  onUpgradeEncryption,
  consumerName = "OuronetUI",
  initialTab = "operations",
  className,
}: CodexSettingsSectionProps) {
  const subtabs: CodexSettingsSubtab[] = [
    {
      key: "operations",
      label: "Operations",
      color: "#ceac5f",
      cards: (
        <div style={cardGrid(300)}>
          <ZbomSettingsCard />
          <GasSettingsCard />
        </div>
      ),
    },
    {
      key: "debouncer",
      label: "Debouncer",
      color: "#ec4899",
      cards: <DebouncerSettingsCard />,
    },
    {
      key: "read-functions",
      label: "Read Functions",
      color: "#06b6d4",
      cards: <ReadFunctionsCard />,
    },
    {
      key: "security",
      label: "Security",
      color: "#22c55e",
      cards: (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={cardGrid(220)}>
            <ChangePasswordCard onChangePassword={onChangePassword} />
            <EncryptionCard onUpgradeEncryption={onUpgradeEncryption} />
            <CodexGuardCard />
          </div>
          <div
            style={{
              borderRadius: "var(--codex-radius)",
              border: "1px solid var(--codex-border)",
              padding: "16px",
            }}
          >
            <PasswordCacheCard />
          </div>
        </div>
      ),
    },
    {
      key: "identity",
      label: "Identity & Backup",
      color: "#8b5cf6",
      cards: (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={cardGrid(240)}>
            <CodexIdentityCard />
            <DownloadCodexCard />
          </div>
          <div
            style={{
              borderRadius: "var(--codex-radius)",
              border: "1px solid #22c55e40",
              padding: "16px",
            }}
          >
            <ObservationalCodexIdSettings />
          </div>
          <CodexInfoCard />
        </div>
      ),
    },
    {
      key: "advanced",
      label: "Advanced",
      color: "#f59e0b",
      cards: (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <ConsumerSettingsCard consumerName={consumerName} />
          <div
            style={{
              borderRadius: "var(--codex-radius)",
              border: "1px solid var(--codex-warning)",
              padding: "16px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginBottom: "12px",
              }}
            >
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "var(--codex-warning)",
                }}
              >
                Experimental Curves
              </span>
              <span
                style={{
                  fontSize: "10px",
                  padding: "1px 8px",
                  borderRadius: "999px",
                  color: "var(--codex-warning)",
                  border: "1px solid var(--codex-warning)",
                }}
              >
                observational
              </span>
            </div>
            <ExperimentalCurvesCard />
          </div>
        </div>
      ),
    },
  ];

  return (
    <CodexSettingsSectionShell
      subtabs={subtabs}
      className={className}
      initialTab={initialTab}
    />
  );
}

export default CodexSettingsSection;
