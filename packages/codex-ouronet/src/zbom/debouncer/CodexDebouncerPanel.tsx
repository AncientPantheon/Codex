/**
 * CodexDebouncerPanel — the CodexUI's full debouncer, a faithful port of
 * OuronetUI's `MainDebouncer` (2×4 grid: T1–T7 medallions + a Codex-lock cell),
 * made self-contained and driven by the package's own `codexClock` monitor.
 *
 * Identical look to the host header debouncer: fixed-size medallions, countdown
 * rings, fetching spinners, per-tier "time since last refresh", and scrollable
 * hover tooltips listing the actual in-flight reads. The difference from the
 * host is purely the data source — here every ring reflects the CodexUI's OWN
 * reads, observed at the package read seam (no Redux, no OuronetUI imports).
 *
 * Seam swaps vs MainDebouncer:
 *   • pactQueryCache.getQueriesByTier()  → codexClock.getQueriesByTier()
 *   • useWallet().passwordCachedAt + redux → useCodexAuth() + package store
 *   • navigate("/app/debouncer")          → optional `onInfo` callback
 */

import { useState, useEffect, useMemo, useRef } from "react";
import { Lock, Unlock, HelpCircle } from "lucide-react";
import { useCodexStore } from "../../provider/index.js";
import { useCodexAuth } from "../../hooks/index.js";
import { useRequestPassword } from "../../hooks/index.js";
import { useDebouncerState } from "./useDebouncerState.js";
import { codexClock } from "./codexClock.js";
import {
  getTierInterval,
  getTierColor,
  getTierName,
  getTierConfig,
  type PactQueryTier,
} from "./pactQueryTiers.js";

const CELL_W = 76;
const CELL_H = 28;
const CIRCLE_SIZE = 20;
const CIRCLE_R = 8;

// ─── Hover Tooltip (custom, scrollable) ─────────────────────────────────────
function HoverTooltip({ children, content }: { children: React.ReactNode; content: React.ReactNode }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState<"bottom" | "top">("bottom");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (show && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setPos(rect.bottom + 260 > window.innerHeight ? "top" : "bottom");
    }
  }, [show]);

  return (
    <div ref={ref} style={{ position: "relative" }} onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <>
          <div style={{ position: "absolute", zIndex: 9998, left: 0, right: 0, ...(pos === "bottom" ? { top: "100%", height: 10 } : { bottom: "100%", height: 10 }) }} />
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute", zIndex: 9999, width: 256, maxHeight: 240, overflowY: "auto",
              borderRadius: 8, border: "1px solid #404040", backgroundColor: "rgba(23,23,23,0.97)",
              backdropFilter: "blur(4px)", boxShadow: "0 10px 30px rgba(0,0,0,0.5)", padding: 10,
              fontSize: 10, lineHeight: 1.5, fontFamily: "var(--codex-font-mono, ui-monospace, monospace)", color: "#d4d4d4",
              left: "50%", transform: "translateX(-50%)",
              ...(pos === "bottom" ? { top: "calc(100% + 6px)" } : { bottom: "calc(100% + 6px)" }),
            }}
          >
            {content}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Countdown Circle (shared SVG) ─────────────────────────────────────────
function CountdownCircle({ fraction, color, isFetching, label }: { fraction: number; color: string; isFetching: boolean; label: string }) {
  const circ = 2 * Math.PI * CIRCLE_R;
  const dashOffset = isFetching ? circ * 0.25 : circ * (1 - fraction);
  return (
    <div style={{ position: "relative", width: CIRCLE_SIZE, height: CIRCLE_SIZE, flexShrink: 0 }}>
      <svg width={CIRCLE_SIZE} height={CIRCLE_SIZE} style={{ transform: "rotate(-90deg)", position: "absolute", top: 0, left: 0, ...(isFetching ? { animation: "codexDebouncerSpin 1s linear infinite" } : {}) }}>
        <circle cx={CIRCLE_SIZE / 2} cy={CIRCLE_SIZE / 2} r={CIRCLE_R} fill="none" stroke="#1a1a1a" strokeWidth="1.5" />
        <circle cx={CIRCLE_SIZE / 2} cy={CIRCLE_SIZE / 2} r={CIRCLE_R} fill="none" stroke={color} strokeWidth="1.5" strokeDasharray={circ} strokeDashoffset={dashOffset} strokeLinecap="round" style={{ transition: "none" }} />
      </svg>
      <div style={{ position: "absolute", top: 0, left: 0, width: CIRCLE_SIZE, height: CIRCLE_SIZE, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color, fontSize: 8, lineHeight: 1, fontFamily: "var(--codex-font-mono, ui-monospace, monospace)", fontWeight: 700 }}>{label}</span>
      </div>
    </div>
  );
}

function formatSeconds(secs: number): string {
  const s = Math.round(secs);
  if (s < 0) return "—";
  if (s === 0) return "⟳";
  if (s >= 60) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return `${s}s`;
}

// ─── Tier Medallion ─────────────────────────────────────────────────────────
function TierMedallion({ tier, remaining, total, isFetching, isActive }: { tier: PactQueryTier; remaining: number; total: number; isFetching: boolean; isActive: boolean }) {
  const tierColor = getTierColor(tier);
  const tierName = getTierName(tier);
  const config = getTierConfig(tier);

  const tooltipContent = useMemo(() => {
    const tierQueries = codexClock.getQueriesByTier().get(tier) ?? [];
    return (
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4, color: tierColor }}>{tierName} ({tier})</div>
        <div style={{ color: "#a3a3a3", marginBottom: 4 }}>{config.description}</div>
        <div style={{ color: "#737373", marginBottom: 6 }}>
          Interval: {config.interval}s • Status:{" "}
          <span style={{ color: isFetching ? "#f59e0b" : remaining > 0 ? tierColor : "#6b7280" }}>
            {isFetching ? "fetching..." : remaining > 0 ? `${Math.round(remaining)}s` : "idle"}
          </span>
        </div>
        {tierQueries.length > 0 ? (
          <>
            <div style={{ borderTop: "1px solid #404040", margin: "6px 0" }} />
            <div style={{ color: "#a3a3a3", marginBottom: 4 }}>Active reads ({tierQueries.length}):</div>
            {tierQueries.map((q, i) => {
              const icon = q.status === "fetching" ? "⟳" : q.status === "fresh" ? "●" : q.status === "error" ? "✗" : "○";
              const iconColor = q.status === "fetching" ? "#f59e0b" : q.status === "fresh" ? "#4ade80" : q.status === "error" ? "#c0392b" : "#6b7280";
              return (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 4, padding: "2px 0" }}>
                  <span style={{ color: iconColor, flexShrink: 0 }}>{icon}</span>
                  <span style={{ wordBreak: "break-all", color: "#d4d4d4" }}>
                    {q.fnName}
                    {q.chainId && q.chainId !== "0" && (
                      <span style={{ color: "#8b8bab", fontSize: "0.85em", marginLeft: 3 }}>[{q.chainId}]</span>
                    )}
                  </span>
                </div>
              );
            })}
          </>
        ) : (
          <>
            <div style={{ borderTop: "1px solid #404040", margin: "6px 0" }} />
            <div style={{ color: "#737373", fontStyle: "italic" }}>No active reads</div>
          </>
        )}
      </div>
    );
  }, [tier, tierName, tierColor, config, isFetching, remaining]);

  const fraction = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
  const color = isActive || isFetching ? tierColor : "#374151";
  const bgColor = isActive || isFetching ? `${tierColor}12` : "#37415108";

  return (
    <HoverTooltip content={tooltipContent}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, borderRadius: 6, width: CELL_W, height: CELL_H, minWidth: CELL_W, maxWidth: CELL_W, minHeight: CELL_H, maxHeight: CELL_H, backgroundColor: bgColor, border: `1px solid ${color}25`, padding: "0 6px", opacity: !isActive && !isFetching ? 0.4 : 1 }}>
        <CountdownCircle fraction={fraction} color={color} isFetching={isFetching} label={tier.replace("T", "")} />
        <span style={{ fontFamily: "var(--codex-font-mono, ui-monospace, monospace)", fontWeight: 700, fontSize: 10, color, width: 28, textAlign: "right", flexShrink: 0, overflow: "hidden" }}>
          {formatSeconds(remaining)}
        </span>
      </div>
    </HoverTooltip>
  );
}

// ─── Codex Lock cell (medallion-shaped) ─────────────────────────────────────
function CodexLockCell() {
  const { passwordCacheExpiresAt } = useCodexAuth();
  const requestPassword = useRequestPassword();
  const store = useCodexStore();
  const cacheMinutes = store((s) => s.uiSettings.passwordCacheMinutes ?? 1);
  const [remaining, setRemaining] = useState(0);
  const [fraction, setFraction] = useState(0);

  useEffect(() => {
    const cacheMs = cacheMinutes * 60 * 1000;
    const iv = setInterval(() => {
      if (!passwordCacheExpiresAt) { setRemaining(0); setFraction(0); return; }
      const left = Math.max(0, passwordCacheExpiresAt - Date.now());
      setRemaining(Math.ceil(left / 1000));
      setFraction(left / cacheMs);
    }, 200);
    return () => clearInterval(iv);
  }, [passwordCacheExpiresAt, cacheMinutes]);

  const isLocked = remaining <= 0;
  const isLow = !isLocked && remaining <= 10;
  const color = isLocked ? "#c0392b" : isLow ? "#f59e0b" : "#4ade80";
  const bgColor = isLocked ? "#8b1a1a12" : isLow ? "#f59e0b12" : "#22c55e08";
  const Icon = isLocked ? Lock : Unlock;

  const handleClick = async () => {
    if (isLocked) { try { await requestPassword(); } catch { /* cancelled */ } }
  };

  return (
    <HoverTooltip
      content={
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4, color }}>Codex {isLocked ? "Locked" : "Unlocked"}</div>
          <div style={{ color: "#a3a3a3" }}>{isLocked ? "Password not cached. Click to unlock." : `Password cached. ${formatSeconds(remaining)} remaining.`}</div>
        </div>
      }
    >
      <button onClick={handleClick} style={{ display: "flex", alignItems: "center", gap: 4, borderRadius: 6, width: CELL_W, height: CELL_H, minWidth: CELL_W, maxWidth: CELL_W, minHeight: CELL_H, maxHeight: CELL_H, backgroundColor: bgColor, border: `1px solid ${color}25`, padding: "0 6px", cursor: isLocked ? "pointer" : "default" }}>
        <div style={{ position: "relative", width: CIRCLE_SIZE, height: CIRCLE_SIZE, flexShrink: 0 }}>
          <CountdownCircle fraction={isLocked ? 0 : fraction} color={color} isFetching={false} label="" />
          <div style={{ position: "absolute", top: 0, left: 0, width: CIRCLE_SIZE, height: CIRCLE_SIZE, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            <Icon size={8} style={{ color }} />
          </div>
        </div>
        <span style={{ fontFamily: "var(--codex-font-mono, ui-monospace, monospace)", fontWeight: 700, fontSize: 10, color, flex: 1, textAlign: "right", flexShrink: 0, overflow: "hidden", whiteSpace: "nowrap" }}>
          {isLocked ? "Locked" : formatSeconds(remaining)}
        </span>
      </button>
    </HoverTooltip>
  );
}

// ─── Panel ──────────────────────────────────────────────────────────────────
export interface CodexDebouncerPanelProps {
  /** When provided, renders the "?" info button (wire it to the Debouncer settings subpage). */
  onInfo?: () => void;
  className?: string;
}

// Grid order (row-by-row): T1 T3 T5 T7 / T2 T4 T6 🔒
const TOP_ROW: PactQueryTier[] = ["T1", "T3", "T5", "T7"];
const BOTTOM_ROW: PactQueryTier[] = ["T2", "T4", "T6"];

export function CodexDebouncerPanel({ onInfo, className }: CodexDebouncerPanelProps) {
  const { tiers } = useDebouncerState();

  const medallion = (tier: PactQueryTier) => {
    const state = tiers.find((t) => t.tier === tier);
    const interval = getTierInterval(tier);
    return (
      <TierMedallion
        key={tier}
        tier={tier}
        remaining={state?.nextRefreshIn ?? interval}
        total={interval}
        isFetching={state?.isFetching ?? false}
        isActive={state?.isActive ?? false}
      />
    );
  };

  return (
    <div
      className={className}
      style={{
        display: "inline-grid", gap: 3, padding: 6, borderRadius: 12, position: "relative",
        gridTemplateColumns: `repeat(4, ${CELL_W}px)`, gridTemplateRows: `${CELL_H}px ${CELL_H}px`,
        backgroundColor: "#0f0f0f", border: "1px solid #262626", height: 71, boxSizing: "border-box",
      }}
    >
      {onInfo && (
        <button
          type="button"
          onClick={onInfo}
          title="What is this? — Debouncer info"
          aria-label="Debouncer info"
          style={{ position: "absolute", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 9999, width: 16, height: 16, top: -6, right: -6, backgroundColor: "#0a0a0a", border: "1px solid #262626", color: "#888", zIndex: 2, cursor: "pointer" }}
        >
          <HelpCircle size={10} strokeWidth={2.5} />
        </button>
      )}
      {TOP_ROW.map(medallion)}
      {BOTTOM_ROW.map(medallion)}
      <CodexLockCell />
      <style>{`@keyframes codexDebouncerSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default CodexDebouncerPanel;
