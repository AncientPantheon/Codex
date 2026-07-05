/**
 * ReadFunctionsCard — the CodexUI "Read Functions" settings subpage.
 *
 * Lists every blockchain READ the CodexUI depends on (the `CODEX_READ_REGISTRY`)
 * with its canonical Pact identifier, the helper that wraps it, the debounce
 * tier it rides on, what surface it powers, and a LIVE status dot driven by the
 * `codexClock` monitor (idle / fetching / fresh / error). This is the operator's
 * single honest view of the CodexUI's on-chain read dependencies.
 */

import { useEffect, useState } from "react";
import { codexClock, type ReadStatus } from "../../zbom/debouncer/codexClock.js";
import { CODEX_READ_REGISTRY } from "../../zbom/debouncer/readRegistry.js";
import { getTierColor } from "../../zbom/debouncer/pactQueryTiers.js";

const BORDER = "var(--codex-border, #262626)";
const MUTED = "var(--codex-text-dim, #888)";
const ACCENT = "#06b6d4";

const STATUS_META: Record<ReadStatus, { dot: string; label: string; color: string }> = {
  idle: { dot: "○", label: "idle", color: "#555" },
  fetching: { dot: "⟳", label: "fetching", color: "#f59e0b" },
  fresh: { dot: "●", label: "live", color: "#4ade80" },
  error: { dot: "✗", label: "error", color: "#c0392b" },
  stale: { dot: "○", label: "stale", color: "#6b7280" },
};

/** Reads that are part of the documented surface but no current UI flow calls. */
const DECLARED_META = { dot: "–", label: "declared", color: "#4b5563" };

/** Subscribe to the monitor so status dots update live. */
function useCodexClockTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const unsub = codexClock.subscribe(() => setTick((t) => (t + 1) % 1_000_000));
    return unsub;
  }, []);
  return tick;
}

export interface ReadFunctionsCardProps {
  className?: string;
}

export function ReadFunctionsCard({ className }: ReadFunctionsCardProps) {
  useCodexClockTick(); // re-render on read activity

  const reachable = CODEX_READ_REGISTRY.filter((r) => r.reachable !== false);
  const declaredCount = CODEX_READ_REGISTRY.length - reachable.length;
  const liveCount = reachable.filter((r) => codexClock.getReadStatus(r.id) === "fresh").length;

  return (
    <div className={className} style={{ fontFamily: "var(--codex-font, inherit)", display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header */}
      <div style={{ borderRadius: 12, border: `1px solid ${BORDER}`, backgroundColor: "#0d0d0d", padding: 18 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: ACCENT, margin: 0 }}>Read Functions</h2>
        <p style={{ fontSize: 13, marginTop: 4, color: MUTED }}>
          Every on-chain read the CodexUI references to operate. These functions live immutably on
          StoaChain — the package depends on them, it doesn't embed them. The status dot reflects live
          activity observed by the debouncer monitor.{" "}
          <span style={{ color: "#4ade80" }}>{liveCount}</span>
          <span style={{ color: MUTED }}> / {reachable.length} reachable reads have read live this session</span>
          {declaredCount > 0 && (
            <span style={{ color: MUTED }}>
              {" "}· <span style={{ color: DECLARED_META.color }}>{declaredCount} declared</span> (part of the
              read surface, not exercised by the current UI)
            </span>
          )}
          <span style={{ color: MUTED }}>.</span>
        </p>
      </div>

      {/* Registry list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {CODEX_READ_REGISTRY.map((r) => {
          const declared = r.reachable === false;
          const status = declared ? "idle" : codexClock.getReadStatus(r.id);
          const meta = declared ? DECLARED_META : STATUS_META[status];
          const tierColor = getTierColor(r.tier);
          return (
            <div key={r.id} style={{ borderRadius: 10, border: `1px solid ${BORDER}`, backgroundColor: "#0d0d0d", padding: "12px 14px", display: "flex", alignItems: "flex-start", gap: 12 }}>
              {/* Status dot */}
              <span title={meta.label} style={{ flexShrink: 0, width: 18, textAlign: "center", color: meta.color, fontSize: 14, lineHeight: "20px", ...(status === "fetching" ? { animation: "codexDebouncerSpin 1s linear infinite" } : {}) }}>{meta.dot}</span>

              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Canonical name + tier badge */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <code style={{ fontFamily: "var(--codex-font-mono, monospace)", fontSize: 12.5, color: "#d2d3d4", wordBreak: "break-all" }}>{r.canonical}</code>
                  <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, fontFamily: "var(--codex-font-mono, monospace)", padding: "1px 7px", borderRadius: 9999, color: tierColor, border: `1px solid ${tierColor}40`, backgroundColor: `${tierColor}14` }}>{r.tier}</span>
                  <span style={{ flexShrink: 0, fontSize: 10, color: meta.color }}>{meta.label}</span>
                </div>
                {/* What it powers */}
                <p style={{ fontSize: 12, color: MUTED, margin: "4px 0 0" }}>{r.powers}</p>
                {/* Helper + subpath */}
                <p style={{ fontSize: 11, color: "#666", margin: "2px 0 0", fontFamily: "var(--codex-font-mono, monospace)" }}>
                  {r.helper} · {r.subpath}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <style>{`@keyframes codexDebouncerSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default ReadFunctionsCard;
