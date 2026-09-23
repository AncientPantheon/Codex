/**
 * CodexSettingsSectionShell — the chain-generic settings-section container.
 *
 * A PURE-LAYOUT shell owning the subtab bar + the active-subtab switching
 * state. It renders whatever `{subtabs, cards}` taxonomy the host injects and
 * statically imports NO concrete card — MOVE or STAY. Ouronet's
 * `CodexSettingsSection` aggregator (T9.6) supplies all cards plus the
 * zbom-specific subtab taxonomy (Operations / Debouncer / Read Functions) via
 * the `subtabs` slot, so neither a STAY zbom card edge nor a MOVE-card coupling
 * lands in the generic shell. Styled via `--codex-*` tokens.
 *
 * MOBILE (docs/work/codex-ui-mobile/design.md §8, the Settings-page cleanup
 * round): the desktop text-pill bar wraps across up to 3 lines once there are
 * 7 subtabs — "those whole buttons with text on them, I want them turned into
 * icons and using a single line, same separation we used for the Ouronet page
 * between buttons and page content." Supersedes the pill bar with a single-row
 * icon-only strip (same shape as `OuronetAccountsTab`'s own mobile filter
 * row), gated on `useIsMobile()` — desktop is completely unchanged (still the
 * pill bar, byte-identical branch).
 */

import { useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { useIsMobile } from "../mobile/MobileContext.js";

/** A single injected subtab: its identity key, pill label + colour, and the card
 *  group rendered when the subtab is active. The host owns every concrete card
 *  behind `cards` — the shell only lays out the tab bar + panel. */
export interface CodexSettingsSubtab {
  key: string;
  label: string;
  /** Pill accent colour (desktop) / active icon colour (mobile). */
  color: string;
  /** Card group shown when this subtab is active — the host's concrete cards. */
  cards: ReactNode;
  /** Icon shown in place of the text label on mobile (design.md §8, the
   *  Settings-page cleanup round). A lucide icon component (or any component
   *  accepting `size`/`strokeWidth`). Optional — mobile renders an empty
   *  icon slot for a subtab that doesn't supply one; desktop is unaffected
   *  either way (it never reads this field). */
  Icon?: ComponentType<{ size?: number; strokeWidth?: number }>;
}

/** One icon-only button in the mobile subtab row — same shape as
 *  `OuronetAccountsTab`'s own `MobileFilterIconBtn` (design.md §8): an icon
 *  medallion + a tooltip-style `title`/`aria-label` carrying the text a
 *  desktop pill would show inline. */
function MobileSubtabIconBtn({
  active, color, label, onClick, children,
}: {
  active: boolean; color: string; label: string; onClick: () => void; children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        width: 30, height: 30, borderRadius: 8, cursor: "pointer",
        border: `1px solid ${active ? color : "var(--codex-border)"}`,
        backgroundColor: active ? `${color}1a` : "transparent",
        color: active ? color : "var(--codex-text-dim)",
      }}
    >
      {children}
    </button>
  );
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
  const isMobile = useIsMobile();

  const activeSubtab = subtabs.find((s) => s.key === tab) ?? subtabs[0];

  if (isMobile) {
    return (
      <div
        className={className}
        style={{ fontFamily: "var(--codex-font)", color: "var(--codex-text)" }}
      >
        {/* Single-line icon-only row — no wrap (design.md §8, the
            Settings-page cleanup round). `marginBottom: 10` is the SAME gap
            `OuronetAccountsTab`'s own mobile filter row keeps from its
            content below ("same separation we used for the Ouronet page
            between buttons and page content"). */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 10 }}>
          {subtabs.map(({ key, label, color, Icon }) => (
            <MobileSubtabIconBtn key={key} active={tab === key} color={color} label={label} onClick={() => setTab(key)}>
              {Icon ? <Icon size={16} strokeWidth={1.5} /> : null}
            </MobileSubtabIconBtn>
          ))}
        </div>
        <div>{activeSubtab?.cards}</div>
      </div>
    );
  }

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
      {/* ── Subtab pill bar (desktop, unchanged) ── */}
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
