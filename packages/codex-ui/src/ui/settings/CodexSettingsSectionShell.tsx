/**
 * CodexSettingsSectionShell — the chain-generic settings-section container.
 *
 * A PURE-LAYOUT shell owning the pill subtab bar + the active-subtab switching
 * state. It renders whatever `{subtabs, cards}` taxonomy the host injects and
 * statically imports NO concrete card — MOVE or STAY. Ouronet's
 * `CodexSettingsSection` aggregator (T9.6) supplies all cards plus the
 * zbom-specific subtab taxonomy (Operations / Debouncer / Read Functions) via
 * the `subtabs` slot, so neither a STAY zbom card edge nor a MOVE-card coupling
 * lands in the generic shell. Styled via `--codex-*` tokens.
 */

import { useState } from "react";
import type { ReactNode } from "react";

/** A single injected subtab: its identity key, pill label + colour, and the card
 *  group rendered when the subtab is active. The host owns every concrete card
 *  behind `cards` — the shell only lays out the pill bar + panel. */
export interface CodexSettingsSubtab {
  key: string;
  label: string;
  /** Pill accent colour. */
  color: string;
  /** Card group shown when this subtab is active — the host's concrete cards. */
  cards: ReactNode;
}

export interface CodexSettingsSectionShellProps {
  /** The full subtab taxonomy + card groups, injected by the host aggregator. */
  subtabs: CodexSettingsSubtab[];
  className?: string;
  /** Key of the subtab open on first render. Defaults to the first subtab. */
  initialTab?: string;
}

export function CodexSettingsSectionShell({
  subtabs,
  className,
  initialTab,
}: CodexSettingsSectionShellProps) {
  const firstKey = subtabs[0]?.key ?? "";
  const [tab, setTab] = useState<string>(initialTab ?? firstKey);

  const activeSubtab = subtabs.find((s) => s.key === tab) ?? subtabs[0];

  return (
    <div
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        fontFamily: "var(--codex-font)",
        color: "var(--codex-text)",
      }}
    >
      {/* ── Subtab pill bar ── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        {subtabs.map(({ key, label, color }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              style={{
                padding: "8px 16px",
                borderRadius: "999px",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.15s",
                border: `1px solid ${active ? color : "var(--codex-border)"}`,
                backgroundColor: active ? `${color}1a` : "transparent",
                color: active ? color : "var(--codex-text-dim)",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* ── Active subtab's injected card group ── */}
      <div>{activeSubtab?.cards}</div>
    </div>
  );
}

export default CodexSettingsSectionShell;
