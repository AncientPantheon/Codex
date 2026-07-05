/**
 * CodexIdField — the "epic" CodexID display: a single rectangle holding the two
 * APOLLO halves separated by a yellow `:`. Each half shows a big Cinzel prefix
 * (₱. / Π.) that glows in a pulsed manner and is clickable (copies that whole
 * half). The body glyphs fill the half's width: first-3 + last-3 in the side
 * accent (orange / vișiniu), the middle glyphs plain white, with a prefix-styled
 * `…` marking the truncation. The per-half "Copy Value" tags live in the parent
 * header (ObservationalCodexId) — no decorative underline or glyph/bit caption.
 */

import { useState } from "react";
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
export function CopyValueTag({ text, color }: { text: string; color: string }) {
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
        display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 9999,
        fontFamily: "var(--codex-font, inherit)", fontSize: 10, fontWeight: 600, cursor: "pointer",
        backgroundColor: copied ? "#0a2a14" : "#101010",
        color: copied ? "#4ade80" : color,
        border: `1px solid ${copied ? "#4ade8055" : color + "40"}`,
        whiteSpace: "nowrap",
      }}
    >
      {copied ? <Check size={11} strokeWidth={2.5} /> : <Copy size={11} strokeWidth={2} />}
      {copied ? "Copied" : "Copy Value"}
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

export interface CodexIdFieldProps {
  standardAddress: string;
  smartAddress: string;
  standardColor?: string;
  smartColor?: string;
  className?: string;
}

export function CodexIdField({
  standardAddress,
  smartAddress,
  standardColor = "#f97316",
  smartColor = "#a01b3f",
  className,
}: CodexIdFieldProps) {
  return (
    <div
      className={className}
      style={{
        display: "flex", alignItems: "flex-start", gap: 8,
        padding: "16px 14px 10px", borderRadius: 10,
        backgroundColor: "#080808", border: "1px solid #2a2a2a",
      }}
    >
      <Half address={standardAddress} color={standardColor} />
      <span style={{ fontFamily: DISPLAY, fontSize: 28, fontWeight: 700, color: YELLOW, lineHeight: 1, marginTop: 4, flexShrink: 0 }}>:</span>
      <Half address={smartAddress} color={smartColor} />
    </div>
  );
}

export default CodexIdField;
