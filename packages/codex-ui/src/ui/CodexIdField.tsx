/**
 * CodexIdField — the "epic" CodexID display: a single rectangle holding the two
 * APOLLO halves separated by a yellow `:`. Each half shows a big Cinzel prefix
 * (₱. / Π.) that glows in a pulsed manner and is clickable (copies that whole
 * half). The body glyphs fill the half's width: first-3 + last-3 in the side
 * accent (orange / vișiniu), the middle glyphs plain white, with a prefix-styled
 * `…` marking the truncation. The per-half "Copy Value" tags live in the parent
 * header (ObservationalCodexId) — no decorative underline or glyph/bit caption.
 */

import { useState, useRef, useLayoutEffect } from "react";
import { Copy, Check } from "lucide-react";

const DISPLAY = "var(--codex-font-display, 'Cinzel', serif)";
// High-tech monospace for the DALOS glyph string — JetBrains Mono carries the full
// 256-glyph coverage (digits, currencies, Latin Extended, Greek, Cyrillic) and reads
// as a blockchain/IT data string, where Cinzel (a serif display face) did not.
const MONO = "var(--codex-font-mono, 'JetBrains Mono', ui-monospace, 'SFMono-Regular', monospace)";
const YELLOW = "#facc15"; // the central separator (Mnemosyne)
const WHITE = "#e8e8ea"; // middle glyphs

/** Consistent labeled copy affordance — same tag for every value (each CodexID
 *  half + the whole ID). Exported so the parent header can host the per-half
 *  copy tags rather than placing them inside the value. */
/** `iconOnly` (docs/work/codex-ui-mobile/design.md §8, Zone 2 feedback round)
 *  drops the "Copy Value"/"Copied" text label — just the icon, still colored
 *  per the caller's `color` (each CodexID half's own accent) — so the title
 *  row reads as two small medallions instead of two wide pill buttons.
 *  Desktop's own (text-bearing) callers are unaffected — default false. */
export function CopyValueTag({ text, color, iconOnly }: { text: string; color: string; iconOnly?: boolean }) {
  const [copied, setCopied] = useState(false);
  const onClick = () => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <button
      type="button"
      onClick={onClick}
      title="Copy value"
      aria-label="Copy value"
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        gap: iconOnly ? 0 : 5, borderRadius: 9999,
        ...(iconOnly ? { width: 22, height: 22, padding: 0 } : { padding: "3px 9px" }),
        fontFamily: "var(--codex-font, inherit)", fontSize: 10, fontWeight: 600, cursor: "pointer",
        backgroundColor: copied ? "#0a2a14" : "#101010",
        color: copied ? "#4ade80" : color,
        border: `1px solid ${copied ? "#4ade8055" : color + "40"}`,
        whiteSpace: "nowrap",
      }}
    >
      {copied ? <Check size={11} strokeWidth={2.5} /> : <Copy size={11} strokeWidth={2} />}
      {!iconOnly && (copied ? "Copied" : "Copy Value")}
    </button>
  );
}

function Half({ address, color }: { address: string; color: string; label?: string }) {
  const prefix = address.slice(0, 2); // ₱. / Π.
  const body = address.slice(2);
  // Split the body at its midpoint so the `…` sits dead-center: the left side
  // fills toward the center (clipping its right), the right side fills back from
  // the center (clipping its left via text-align:right).
  const mid = Math.floor(body.length / 2);
  const left = body.slice(0, mid);
  const right = body.slice(mid);
  const leftHead = left.slice(0, 3);              // first-3 (side color)
  const leftRest = left.slice(3);                 // yellow
  const rightTail = right.length > 3 ? right.slice(-3) : right; // last-3 (side color)
  const rightRest = right.length > 3 ? right.slice(0, -3) : ""; // yellow

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "stretch", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "baseline", width: "100%", overflow: "hidden", fontFamily: MONO }}>
        <span
          style={{
            flexShrink: 0, fontFamily: DISPLAY, fontSize: 30, fontWeight: 700, lineHeight: 1, color,
            animation: "codex-glow-pulse 2.4s ease-in-out infinite",
          }}
        >
          {prefix}
        </span>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textAlign: "left", fontSize: 17, letterSpacing: "0.5px" }}>
          <span style={{ color }}>{leftHead}</span>
          <span style={{ color: WHITE }}>{leftRest}</span>
        </span>
        <span style={{ color, fontSize: 24, fontWeight: 700, lineHeight: 1, flexShrink: 0, padding: "0 3px" }}>…</span>
        {/* Right portion shows the END of the body (…middle + last-3). `text-align:
            right` does NOT survive overflow — when the content is wider than the box
            the browser keeps the START visible and clips the END, hiding the colored
            tail. A flex container with justify-content:flex-end pins the inner line to
            the right edge so the overflow clips the START instead, keeping last-3 visible. */}
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", display: "flex", justifyContent: "flex-end", fontSize: 17, letterSpacing: "0.5px" }}>
          <span style={{ flexShrink: 0, whiteSpace: "nowrap" }}>
            <span style={{ color: WHITE }}>{rightRest}</span>
            <span style={{ color }}>{rightTail}</span>
          </span>
        </span>
      </div>
    </div>
  );
}

/** Measure the average character width by rendering a probe span INSIDE `el`
 *  (so it inherits `el`'s actual font). Absolutely positioned + hidden, so it
 *  never affects layout — same technique `codex-ouronet`'s `MiddleEllipsis`
 *  uses (that component lives in a different package, so this is a small,
 *  self-contained re-implementation rather than a cross-package import). */
function measureCharWidthIn(el: HTMLElement): number {
  if (typeof document === "undefined") return 0;
  const probe = document.createElement("span");
  probe.textContent = "0".repeat(60);
  probe.style.cssText = "position:absolute; left:-9999px; top:0; visibility:hidden; white-space:pre; pointer-events:none;";
  el.appendChild(probe);
  const w = probe.getBoundingClientRect().width / 60;
  el.removeChild(probe);
  return Number.isFinite(w) && w > 0 ? w : 0;
}

/** Split `body` (the address minus its 2-char prefix) into the pieces
 *  `CompactHalf` renders: `head` (first 3, colored) and `tail` (last 3,
 *  colored) are ALWAYS shown; `middle` fills with as many of the REMAINING
 *  characters as `fitChars` allows (plain color); `ellipsis` is true only
 *  when the full body does NOT fit — i.e. "the prefix, first 3, last 3
 *  characters must be shown, plus extra characters that fit" (owner
 *  directive), never a decorative `…` shown just because it's the midpoint. */
export function splitHalfToFit(body: string, fitChars: number | null): { head: string; middle: string; tail: string; ellipsis: boolean } {
  const head = body.slice(0, 3);
  const tail = body.length > 3 ? body.slice(-3) : "";
  // Not measured yet — show the anchors only, no middle, no ellipsis (a safe,
  // never-wrong-looking placeholder while width settles).
  if (fitChars === null) return { head, middle: "", tail, ellipsis: false };
  if (fitChars >= body.length) {
    // Everything fits — the WHOLE string, no ellipsis at all.
    const middle = body.length > 6 ? body.slice(3, -3) : body.slice(3, Math.max(3, body.length - (tail ? 3 : 0)));
    return { head, middle: body.length > 3 ? middle : "", tail, ellipsis: false };
  }
  // Truncated: reserve head(3) + tail(3) + ellipsis(1) = 7 minimum; the
  // remainder goes to "extra characters that fit" in the middle.
  const middleLen = Math.max(0, fitChars - 7);
  const middle = body.slice(3, 3 + middleLen);
  return { head, middle, tail, ellipsis: true };
}

/** Measured, single-line, SMALLER-font half for Zone 2's mobile pane (design.md
 *  §8 feedback round): "the proper shortening method — prefix, first 3, last
 *  3 characters of each half must be shown, plus extra characters that fit."
 *  Unlike the desktop `Half` (a fixed midpoint split that ALWAYS shows a
 *  decorative `…`, regardless of whether the string would actually fit), this
 *  measures the real available width and only truncates when it must. Hidden
 *  until the measurement settles (avoids a flash of the wrong split), with a
 *  700ms safety reveal for headless/SSR environments with no real layout. */
function CompactHalf({ address, color }: { address: string; color: string }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [fitChars, setFitChars] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const prefix = address.slice(0, 2);
  const body = address.slice(2);

  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    let revealed = false;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const scheduleReveal = () => {
      if (revealed) return;
      if (settle) clearTimeout(settle);
      settle = setTimeout(() => { revealed = true; setReady(true); }, 100);
    };
    const compute = () => {
      const width = el.clientWidth;
      if (width <= 0) return;
      const charW = measureCharWidthIn(el);
      if (charW <= 0) return;
      setFitChars(Math.floor(width / charW));
      scheduleReveal();
    };
    compute();
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(compute);
      ro.observe(el);
    }
    const safety = setTimeout(() => { if (!revealed) { revealed = true; setReady(true); } }, 700);
    return () => { ro?.disconnect(); if (settle) clearTimeout(settle); clearTimeout(safety); };
  }, [body]);

  const { head, middle, tail, ellipsis } = splitHalfToFit(body, fitChars);

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: 4, fontFamily: MONO, visibility: ready ? "visible" : "hidden" }}>
      <span style={{ flexShrink: 0, fontFamily: DISPLAY, fontSize: 16, fontWeight: 700, lineHeight: 1, color }}>{prefix}</span>
      <span ref={rowRef} title={address} style={{ flex: 1, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", fontSize: 11, letterSpacing: "0.2px" }}>
        <span style={{ color }}>{head}</span>
        <span style={{ color: WHITE }}>{middle}</span>
        {ellipsis && <span style={{ color }}>…</span>}
        <span style={{ color }}>{tail}</span>
      </span>
    </div>
  );
}

export interface CodexIdFieldProps {
  standardAddress: string;
  smartAddress: string;
  standardColor?: string;
  smartColor?: string;
  className?: string;
  /** Smaller, measured-fit rendering for Zone 2's mobile pane (design.md §8
   *  feedback round) — see `CompactHalf`. Desktop's own `Half` is completely
   *  unchanged either way. Default false. */
  compact?: boolean;
}

export function CodexIdField({
  standardAddress,
  smartAddress,
  standardColor = "#f97316",
  smartColor = "#a01b3f",
  className,
  compact,
}: CodexIdFieldProps) {
  const HalfComp = compact ? CompactHalf : Half;
  return (
    <div
      className={className}
      style={{
        display: "flex", alignItems: compact ? "center" : "flex-start", gap: compact ? 6 : 8,
        padding: compact ? "8px 10px" : "16px 14px 10px", borderRadius: 10,
        backgroundColor: "#080808", border: "1px solid #2a2a2a",
      }}
    >
      <HalfComp address={standardAddress} color={standardColor} />
      <span
        style={{
          fontFamily: DISPLAY, fontWeight: 700, color: YELLOW, lineHeight: 1, flexShrink: 0,
          fontSize: compact ? 16 : 28, marginTop: compact ? 0 : 4,
        }}
      >
        :
      </span>
      <HalfComp address={smartAddress} color={smartColor} />
    </div>
  );
}

export default CodexIdField;
