/**
 * CodexTabsShell — the chain-generic tabs container.
 *
 * A PURE-LAYOUT shell: it owns the tab strip + the active-tab switching
 * state, and renders whatever tab set the host injects. It statically
 * imports NO concrete tab (Ouronet's `CodexTabs` aggregator supplies all five
 * via the `tabs` slot in T9.6), so no STAY chain edge — and no MOVE-child
 * static coupling — re-entangles the generic shell.
 *
 * DESKTOP (unchanged): the big bordered icon-tile GRID at the top, mirroring
 * My Codex's rounded-xl / border-2 tiles, inline-styled so the package needs
 * no Tailwind.
 *
 * MOBILE (`useIsMobile()`, container-relative — see
 * `docs/work/codex-ui-mobile/design.md` §3, "The CodexUI mobile shell"): a
 * bottom tab bar (icon + short label, thumb-reachable), `position: sticky;
 * bottom: 0` so it stays pinned to the bottom of the shell as the active
 * panel's own content scrolls past it — the CodexUI-scoped equivalent of
 * OuronetUI's `MobileTabBar`. A grid of large tiles is a genuine "custom"
 * conversion, not a "reflow": N equal-width columns of big tiles can't
 * survive 390px, so mobile gets a DIFFERENT layout, not a shrunk one.
 */

import * as React from "react";
import { useState } from "react";
import { useIsMobile } from "./mobile/MobileContext.js";

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
  const isMobile = useIsMobile();
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
        flexDirection: isMobile ? "column-reverse" : "column",
        gap: isMobile ? 0 : "24px",
      }}
    >
      <div
        role="tablist"
        aria-label="Codex sections"
        style={
          isMobile
            ? {
                display: "flex",
                position: "sticky",
                bottom: 0,
                gap: 4,
                padding: "6px 4px",
                borderTop: "1px solid #262626",
                backgroundColor: "#0a0a0a",
              }
            : {
                display: "grid",
                gridTemplateColumns: `repeat(${Math.max(tabs.length, 1)}, 1fr)`,
                gap: "16px",
              }
        }
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
              style={
                isMobile
                  ? {
                      flex: 1,
                      minWidth: 0,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 2,
                      padding: "6px 2px",
                      borderRadius: 8,
                      border: "none",
                      background: "transparent",
                      color: selected ? accent : "#8b8b8b",
                      cursor: "pointer",
                    }
                  : {
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
                    }
              }
            >
              {Icon && (
                <Icon
                  style={{
                    width: isMobile ? 22 : 40,
                    height: isMobile ? 22 : 40,
                    flexShrink: 0,
                    color: isMobile ? (selected ? accent : "#8b8b8b") : selected ? "#0a0a0a" : accent,
                  }}
                  strokeWidth={1.5}
                />
              )}
              <span
                style={
                  isMobile
                    ? { fontSize: 9, fontWeight: 500, lineHeight: 1, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }
                    : { fontWeight: 600 }
                }
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>

      <div role="tabpanel" style={isMobile ? { flex: 1, minHeight: 0, overflowY: "auto" } : undefined}>
        {activeItem?.content}
      </div>
    </div>
  );
}

export default CodexTabsShell;
