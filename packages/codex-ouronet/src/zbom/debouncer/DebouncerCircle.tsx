/**
 * DebouncerCircle — status indicator for a single ZBOM INFO read.
 *
 * Mirrors the OuronetUI debouncer circle's SVG-ring visual (spinning ring +
 * centre glyph), but driven by ONE read's `ZbomReadStatus` rather than the
 * global T1–T7 tier clocks (D3 — the package owns no tier scheduler). Same
 * once-at-module-load keyframe injection, guarded for SSR.
 */

import { useEffect, useRef } from "react";
import type { ZbomReadStatus } from "./useZbomInfoRead.js";

const STYLE_ID = "zbom-debouncer-circle-keyframes";
if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent =
    "@keyframes zbomDebouncerSpin{from{transform:rotate(-90deg)}to{transform:rotate(270deg)}}";
  document.head.appendChild(style);
}

export interface DebouncerCircleProps {
  status: ZbomReadStatus;
  /** Ring/glyph colour for the active (fresh) state. Default gold. */
  accent?: string;
  /** Diameter in px (default 20). */
  size?: number;
  /** Tooltip override. */
  title?: string;
}

const GLYPH: Record<ZbomReadStatus, string> = {
  idle: "·",
  loading: "⋯",
  fresh: "✓",
  error: "!",
};

const DEFAULT_TITLE: Record<ZbomReadStatus, string> = {
  idle: "No read scheduled",
  loading: "Reading cost…",
  fresh: "Cost up to date",
  error: "Cost read failed",
};

export function DebouncerCircle({
  status,
  accent = "#ceac5f",
  size = 20,
  title,
}: DebouncerCircleProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 2;
  const circ = 2 * Math.PI * r;

  const strokeColor =
    status === "error" ? "#ef4444" : status === "fresh" ? accent : status === "loading" ? accent : "#374151";
  // Fresh = full ring; loading = 3/4 arc (spins); idle/error = small arc.
  const dashOffset =
    status === "fresh" ? 0 : status === "loading" ? circ * 0.75 : circ * 0.85;

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    if (status === "loading") {
      el.style.animation = "zbomDebouncerSpin 1s linear infinite";
    } else {
      el.style.animation = "none";
      el.style.transform = "rotate(-90deg)";
    }
  }, [status]);

  return (
    <div
      role="status"
      aria-label={title ?? DEFAULT_TITLE[status]}
      title={title ?? DEFAULT_TITLE[status]}
      className="relative rounded-full"
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        backgroundColor: `${strokeColor}12`,
        border: `1px solid ${strokeColor}30`,
      }}
    >
      <svg
        ref={svgRef}
        width={size}
        height={size}
        style={{ transform: "rotate(-90deg)", display: "block" }}
      >
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1a1a1a" strokeWidth="2" />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={strokeColor}
          strokeWidth="2"
          strokeDasharray={circ}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          style={{ transition: status === "loading" ? "none" : "stroke-dashoffset 0.2s linear" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span
          className="font-mono font-bold leading-none select-none"
          style={{ color: strokeColor, fontSize: Math.max(7, size * 0.32) }}
        >
          {GLYPH[status]}
        </span>
      </div>
    </div>
  );
}
