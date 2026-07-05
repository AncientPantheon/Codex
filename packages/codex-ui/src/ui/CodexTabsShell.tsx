/**
 * CodexTabsShell — the chain-generic tabs container.
 *
 * A PURE-LAYOUT shell: it owns the big bordered icon-tile tab strip + the
 * active-tab switching state, and renders whatever tab set the host injects.
 * It statically imports NO concrete tab (Ouronet's `CodexTabs` aggregator
 * supplies all five via the `tabs` slot in T9.6), so no STAY chain edge — and no
 * MOVE-child static coupling — re-entangles the generic shell. The tab strip
 * mirrors My Codex's rounded-xl / border-2 tiles, inline-styled so the package
 * needs no Tailwind.
 */

import * as React from "react";
import { useState } from "react";

type IconProps = { style?: React.CSSProperties; strokeWidth?: number };

/** A single injected tab: its identity key, strip label, optional icon + accent,
 *  and the panel content rendered when the tab is active. The host owns the
 *  concrete tab component behind `content` — the shell only lays it out. */
export interface CodexTabsShellItem {
  key: string;
  label: string;
  /** Panel shown when this tab is active — the host's concrete tab component. */
  content: React.ReactNode;
  /** Optional strip icon. Omitted tabs render label-only. */
  Icon?: React.ComponentType<IconProps>;
  /** Active-fill / icon accent colour. Defaults to the gold token accent. */
  accent?: string;
}

export interface CodexTabsShellProps {
  /** The full tab set, injected by the host aggregator. */
  tabs: CodexTabsShellItem[];
  className?: string;
  /** Key of the tab shown on first render. Defaults to the first tab. */
  defaultTab?: string;
}

const DEFAULT_ACCENT = "#ceac5f";

export function CodexTabsShell({ tabs, className, defaultTab }: CodexTabsShellProps) {
  const firstKey = tabs[0]?.key ?? "";
  const [active, setActive] = useState<string>(defaultTab ?? firstKey);

  const activeItem = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <div
      className={className}
      style={{
        fontFamily: "var(--codex-font, inherit)",
        color: "var(--codex-text)",
        display: "flex",
        flexDirection: "column",
        gap: "24px",
      }}
    >
      <div
        role="tablist"
        aria-label="Codex sections"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${Math.max(tabs.length, 1)}, 1fr)`,
          gap: "16px",
        }}
      >
        {tabs.map(({ key, label, Icon, accent = DEFAULT_ACCENT }) => {
          const selected = active === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(key)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                padding: "12px 16px",
                borderRadius: "12px",
                border: `2px solid ${selected ? accent : "#262626"}`,
                backgroundColor: selected ? accent : "#0a0a0a",
                color: selected ? "#0a0a0a" : "#d2d3d4",
                cursor: "pointer",
                transition: "all 0.2s",
                fontWeight: 600,
              }}
            >
              {Icon && (
                <Icon
                  style={{ width: 40, height: 40, flexShrink: 0, color: selected ? "#0a0a0a" : accent }}
                  strokeWidth={1.5}
                />
              )}
              <span style={{ fontWeight: 600 }}>{label}</span>
            </button>
          );
        })}
      </div>

      <div role="tabpanel">{activeItem?.content}</div>
    </div>
  );
}

export default CodexTabsShell;
