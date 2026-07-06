/**
 * ZbomDebouncer — cloned faithfully from OuronetUI
 * `src/components/debouncer/ZbomDebouncer.tsx`.
 *
 * Debouncer bar for ZBOM popup views: codex lock oval (full medallion) + 7 tier
 * circles (compact, no timer text). Non-relevant tiers are dimmed; relevant
 * tiers show animated countdown. Placed at the top of the ZBOM popup.
 *
 * Data-seam swaps (T2):
 *   - useWallet().passwordCachedAt/getCurrentPassword → useCodexAuth()
 *     (passwordCacheExpiresAt) + useRequestPassword() for the unlock prompt.
 *   - useAppSelector(uiSettings.passwordCacheMinutes) → package store uiSettings.
 *   - useDebouncerState() → package tierClock-driven clone.
 * Every className / inline style / SVG geometry kept verbatim.
 */

import { useState, useEffect } from "react";
import { Lock, Unlock } from "lucide-react";
import { useCodexStore } from "../../provider/index.js";
import type { CodexStoreState } from "../../state/index.js";
import { useCodexAuth } from "../../hooks/index.js";
import { useRequestPassword } from "../../hooks/index.js";
import { useDebouncerState } from "./useDebouncerState.js";
import {
  ALL_TIERS,
  getTierInterval,
  getTierColor,
  getTierName,
  type PactQueryTier,
} from "./pactQueryTiers.js";

// ─── Compact Tier Circle (no timer text, for ZBOM) ──────────────────────────
interface CompactTierCircleProps {
  tier: PactQueryTier;
  remaining: number;
  total: number;
  isFetching: boolean;
  isActive: boolean;
  isDisabled?: boolean;
}

function CompactTierCircle({ tier, remaining, total, isFetching, isActive, isDisabled = false }: CompactTierCircleProps) {
  const tierColor = getTierColor(tier);
  const tierName = getTierName(tier);

  const fraction = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
  const r = 9;
  const circ = 2 * Math.PI * r;
  const dashOffset = isFetching ? circ * 0.25 : circ * (1 - fraction);

  let color = tierColor;
  if (isDisabled) color = "#374151";
  else if (!isActive && !isFetching) color = "#374151";

  return (
    <div
      style={{ position: "relative", width: 22, height: 22, flexShrink: 0, opacity: isDisabled ? 0.3 : 1 }}
      title={`${tierName} (${tier}): ${remaining > 0 ? `${Math.ceil(remaining)}s` : "idle"}${isFetching ? " — fetching..." : ""}`}
    >
      <svg width="22" height="22" style={{
        transform: "rotate(-90deg)",
        position: "absolute", top: 0, left: 0,
        ...(isFetching ? { animation: "debouncerSpin 1s linear infinite" } : {}),
      }}>
        <circle cx="11" cy="11" r={r} fill="none" stroke="#1a1a1a" strokeWidth="1.5" />
        <circle
          cx="11" cy="11" r={r}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeDasharray={circ}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          style={{ transition: "none" }}
        />
      </svg>
      <div style={{
        position: "absolute", top: 0, left: 0, width: 22, height: 22,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <span className="font-mono font-bold" style={{ color, fontSize: "7px", lineHeight: 1 }}>
          {tier.replace("T", "")}
        </span>
      </div>
    </div>
  );
}

// ─── Codex Lock Oval (clickable) ────────────────────────────────────────────
function ZbomCodexLockOval() {
  const { passwordCacheExpiresAt } = useCodexAuth();
  const requestPassword = useRequestPassword();
  const store = useCodexStore();
  const cacheMinutes = store((s: CodexStoreState) => s.uiSettings.passwordCacheMinutes ?? 1);
  const [remaining, setRemaining] = useState(0);
  const [fraction, setFraction] = useState(0);

  useEffect(() => {
    const cacheMs = cacheMinutes * 60 * 1000;
    const iv = setInterval(() => {
      if (!passwordCacheExpiresAt) {
        setRemaining(0);
        setFraction(0);
        return;
      }
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

  const display = isLocked
    ? "Locked"
    : remaining >= 60
      ? `${Math.floor(remaining / 60)}:${(remaining % 60).toString().padStart(2, "0")}`
      : `${remaining}s`;

  const r = 9;
  const circ = 2 * Math.PI * r;
  const dashOffset = isLocked ? circ : circ * (1 - fraction);
  const Icon = isLocked ? Lock : Unlock;

  const handleClick = async () => {
    if (isLocked) {
      try { await requestPassword(); } catch { /* cancelled */ }
    }
  };

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-1.5 px-2 py-0.5 rounded-full transition-colors"
      style={{
        backgroundColor: bgColor,
        border: `1px solid ${color}30`,
        cursor: isLocked ? "pointer" : "default",
      }}
      title={isLocked ? "Codex locked. Click to unlock." : `Codex unlocked: ${display} remaining.`}
    >
      <div style={{ position: "relative", width: 20, height: 20, flexShrink: 0 }}>
        <svg width="20" height="20" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="10" cy="10" r={r} fill="none" stroke="#1a1a1a" strokeWidth="1.5" />
          <circle
            cx="10" cy="10" r={r}
            fill="none"
            stroke={color}
            strokeWidth="1.5"
            strokeDasharray={circ}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            style={{ transition: "none" }}
          />
        </svg>
        <div style={{
          position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%, -50%)",
        }}>
          <Icon size={8} style={{ color }} />
        </div>
      </div>
      <span className="text-[9px] font-mono font-bold" style={{ color, minWidth: "28px" }}>
        {display}
      </span>
    </button>
  );
}

// ─── ZBOM Debouncer ──────────────────────────────────────────────────────────
export interface ZbomDebouncerProps {
  activeTiers: PactQueryTier[];
}

export function ZbomDebouncer({ activeTiers }: ZbomDebouncerProps) {
  const { tiers } = useDebouncerState();

  return (
    <div
      className="flex items-center gap-1 px-1.5 py-1 rounded-xl"
      style={{
        backgroundColor: "#0f0f0f",
        border: "1px solid #262626",
      }}
    >
      {/* Codex Lock Oval */}
      <ZbomCodexLockOval />

      {/* Separator */}
      <div className="self-stretch w-px mx-0.5" style={{ backgroundColor: "#262626" }} />

      {/* 7 Compact Tier Circles */}
      <div className="flex items-center gap-1">
        {ALL_TIERS.map((tier) => {
          const tierState = tiers.find((t) => t.tier === tier);
          const interval = getTierInterval(tier);
          const isRelevant = activeTiers.includes(tier);

          return (
            <CompactTierCircle
              key={tier}
              tier={tier}
              remaining={tierState?.nextRefreshIn ?? interval}
              total={interval}
              isFetching={isRelevant ? (tierState?.isFetching ?? false) : false}
              isActive={isRelevant ? (tierState?.isActive ?? false) : false}
              isDisabled={!isRelevant}
            />
          );
        })}
      </div>

      {/* Self-contained keyframes (OuronetUI defines `debouncerSpin` globally). */}
      <style>{`@keyframes debouncerSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default ZbomDebouncer;

/** Default ZBOM tiers shown active in the bar (T1 instant, T2 input, T3 field). */
export const DEFAULT_ZBOM_TIERS: PactQueryTier[] = ["T1", "T2", "T3"];
