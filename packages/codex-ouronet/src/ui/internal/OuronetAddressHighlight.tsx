/**
 * OuronetAddressHighlight — renders an Ouronet address (Ѻ.BODY) FILLING the
 * parent width: silver base, blue-bold highlight on the first 3 body chars AND
 * the last 3 chars, with a CENTERED middle truncation (`start … end`, balanced
 * halves) when it can't fit — so it fills the row and reads clearly as shortened.
 *
 * The fit is measured (monospace → ~constant char width) and split into balanced
 * halves around a single `…`.
 *
 * NO VISIBLE RETRACT: kept `visibility:hidden` (but laid out) until the measured
 * width STOPS changing for a beat — the width can change once shortly after mount
 * (e.g. a scrollbar appears and narrows the row), and revealing on that first
 * stale measurement is what caused the earlier "long → shrink" flash.
 *
 * The Tailwind class (`font-mono text-xs relative`) is kept for pixel parity: the
 * consumer's Tailwind build overrides `text-xs` to 14px, so inlining a fixed
 * font-size here would render 2px smaller than My Codex.
 */

import { useRef, useState, useLayoutEffect } from "react";

interface Props {
  address: string;
  className?: string;
}

const SILVER = "#a0a0b0";
const BLUE = "#3b82f6";

function measureCharWidthIn(el: HTMLElement): number {
  if (typeof document === "undefined") return 0;
  const probe = document.createElement("span");
  probe.textContent = "0".repeat(100);
  probe.style.cssText =
    "position:absolute; left:-9999px; top:0; visibility:hidden; white-space:pre; pointer-events:none;";
  el.appendChild(probe);
  const w = probe.getBoundingClientRect().width / 100;
  el.removeChild(probe);
  return Number.isFinite(w) && w > 0 ? w : 0;
}

/** Balanced `start … end` fit into `chars` cells (or the whole string). */
function middleTruncate(text: string, chars: number): string {
  if (chars >= text.length || chars < 3) return text;
  const keep = chars - 1;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return text.slice(0, head) + "…" + text.slice(text.length - tail);
}

/** Silver base with blue-bold first-3 body chars + last-3 chars. Operates on the
 *  ALREADY-TRUNCATED display string, so the highlight tracks what's visible. */
function highlighted(s: string) {
  if (s.length < 6) return <span style={{ color: SILVER }}>{s}</span>;
  const prefix = s.slice(0, 2);
  const h1 = s.slice(2, 5);
  const mid = s.slice(5, s.length - 3);
  const h2 = s.slice(-3);
  return (
    <>
      <span style={{ color: SILVER }}>{prefix}</span>
      <span style={{ color: BLUE, fontWeight: 700 }}>{h1}</span>
      <span style={{ color: SILVER }}>{mid}</span>
      <span style={{ color: BLUE, fontWeight: 700 }}>{h2}</span>
    </>
  );
}

export function OuronetAddressHighlight({ address, className }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(address);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let revealed = false;
    let settle: ReturnType<typeof setTimeout> | undefined;

    const scheduleReveal = () => {
      if (revealed) return;
      if (settle) clearTimeout(settle);
      settle = setTimeout(() => { revealed = true; setReady(true); }, 120);
    };

    const compute = () => {
      const width = el.clientWidth;
      if (width <= 0) return;
      const charW = measureCharWidthIn(el);
      if (charW <= 0) { setDisplay(address); scheduleReveal(); return; }
      const fit = Math.floor(width / charW);
      setDisplay(fit >= address.length ? address : middleTruncate(address, fit));
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
  }, [address]);

  return (
    <span
      ref={ref}
      className={`font-mono text-xs relative ${className ?? ""}`}
      style={{
        display: "flex", flex: 1, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap",
        alignItems: "center", visibility: ready ? "visible" : "hidden",
      }}
      title={address}
    >
      {highlighted(display)}
    </span>
  );
}
