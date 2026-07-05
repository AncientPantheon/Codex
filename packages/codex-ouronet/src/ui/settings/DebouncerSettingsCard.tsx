/**
 * DebouncerSettingsCard — the CodexUI "Debouncer" settings subpage.
 *
 * A self-contained port of OuronetUI's `/app/debouncer` explainer, plus a LIVE
 * <CodexDebouncerPanel> at the top so the operator sees their own monitor in
 * context. Explains the 7-tier read taxonomy, how to read a medallion, the
 * Codex-lock cell, and the post-TX cascade — all driven by the package's own
 * `codexClock`, identical in behaviour to the host header debouncer.
 */

import { Lock } from "lucide-react";
import { CodexDebouncerPanel } from "../../zbom/debouncer/CodexDebouncerPanel.js";
import { ALL_TIERS, getTierConfig } from "../../zbom/debouncer/pactQueryTiers.js";

const ACCENT = "#ceac5f";
const MUTED = "var(--codex-text-dim, #888)";
const DIM = "#666";
const BORDER = "var(--codex-border, #262626)";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ borderRadius: 12, border: `1px solid ${BORDER}`, backgroundColor: "#0d0d0d", padding: 18 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10, color: ACCENT }}>{title}</h3>
      <div style={{ fontSize: 13, lineHeight: 1.6, color: MUTED, display: "flex", flexDirection: "column", gap: 10 }}>
        {children}
      </div>
    </div>
  );
}

export interface DebouncerSettingsCardProps {
  className?: string;
}

export function DebouncerSettingsCard({ className }: DebouncerSettingsCardProps) {
  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", gap: 12, fontFamily: "var(--codex-font, inherit)" }}>
      {/* Header + live panel */}
      <div style={{ borderRadius: 12, border: `1px solid ${BORDER}`, backgroundColor: "#0d0d0d", padding: 18, display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ flex: "1 1 280px", minWidth: 0 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: ACCENT, margin: 0 }}>The CodexUI Debouncer</h2>
          <p style={{ fontSize: 13, marginTop: 4, color: MUTED }}>
            The CodexUI runs its own independent read monitor — separate from the host app's. Every
            chain read the Codex makes is filed into one of seven refresh tiers; this panel shows when
            each tier last refreshed and what reads are riding on it, live.
          </p>
        </div>
        <CodexDebouncerPanel />
      </div>

      {/* How to read a cell */}
      <Section title="How to read a medallion">
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4, color: DIM }}>
          <li><b style={{ color: ACCENT }}>Color</b> identifies the tier (see the table below).</li>
          <li><b style={{ color: ACCENT }}>Ring</b> fills as the next refresh approaches.</li>
          <li><b style={{ color: ACCENT }}>Number</b> is seconds remaining. "⟳" means fetching now.</li>
          <li><b style={{ color: ACCENT }}>Dim</b> cells have no active reads on that tier right now.</li>
        </ul>
        <p style={{ margin: 0 }}>
          <b>Hover any cell</b> for a tooltip listing the exact reads subscribed to that tier, each with
          a status icon (● fresh, ⟳ fetching, ✗ error, ○ stale).
        </p>
      </Section>

      {/* Tier table */}
      <Section title="The seven tiers">
        <div style={{ borderRadius: 8, border: `1px solid ${BORDER}`, overflow: "hidden" }}>
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ backgroundColor: "#0a0a0a", color: ACCENT }}>
                <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>Tier</th>
                <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>Name</th>
                <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>Interval</th>
                <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>Typical use</th>
              </tr>
            </thead>
            <tbody>
              {ALL_TIERS.map((tier) => {
                const cfg = getTierConfig(tier);
                return (
                  <tr key={tier} style={{ borderTop: `1px solid ${BORDER}` }}>
                    <td style={{ padding: "8px 12px" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 9999, backgroundColor: cfg.color }} />
                        <span style={{ fontFamily: "var(--codex-font-mono, monospace)", fontWeight: 700, color: cfg.color }}>{tier}</span>
                      </span>
                    </td>
                    <td style={{ padding: "8px 12px", fontFamily: "var(--codex-font-mono, monospace)", color: "#d2d3d4" }}>{cfg.name}</td>
                    <td style={{ padding: "8px 12px", fontFamily: "var(--codex-font-mono, monospace)", color: MUTED }}>{cfg.interval === 0 ? "instant" : `${cfg.interval}s`}</td>
                    <td style={{ padding: "8px 12px", color: MUTED }}>{cfg.description}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p style={{ margin: 0 }}>
          <b style={{ color: ACCENT }}>One-shot vs continuous.</b> T2/T3/T4 fire once then wait — they
          re-arm on a trigger (typing, selection, or a transaction). T5/T6/T7 cycle on their own while
          the CodexUI is mounted.
        </p>
      </Section>

      {/* Codex lock */}
      <Section title="The Codex lock cell">
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8, width: 40, height: 40, border: `1px solid ${ACCENT}30`, backgroundColor: `${ACCENT}10` }}>
            <Lock style={{ width: 16, height: 16, color: ACCENT }} />
          </div>
          <p style={{ margin: 0 }}>
            The bottom-right cell shows your <b style={{ color: ACCENT }}>Codex password</b> session. When
            you enter your password it's cached for a fixed window so you aren't prompted on every sign —
            the countdown shows how long the cache has left. Click it (when locked) to unlock.
          </p>
        </div>
      </Section>

      {/* Post-tx cascade */}
      <Section title="After a transaction">
        <p style={{ margin: 0 }}>
          When a Codex transaction lands, the monitor doesn't wait the full slow-tier window. <b style={{ color: "#4ade80" }}>T4</b> is
          armed with a post-TX marker; after its 10-second propagation window it flashes and cascades a
          refresh down to T5/T6/T7 — so balances and account state pull in the new chain state promptly.
        </p>
      </Section>
    </div>
  );
}

export default DebouncerSettingsCard;
