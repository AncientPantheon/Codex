/**
 * MiddleEllipsis — render a long string on ONE line, FILLING the available width,
 * and MIDDLE-truncate it with a CENTERED ellipsis (`start … end`, roughly equal
 * chars on each side) when it can't fit. Fills the row and reads clearly as
 * "shortened", unlike CSS `text-overflow: ellipsis` (end-only) or a max-head flex
 * split (ellipsis stuck at the far end).
 *
 * The fit is measured (addresses render in a MONOSPACE font → ~constant char
 * width) and the string is split into balanced halves around a single `…`.
 *
 * NO VISIBLE RETRACT: the element is kept `visibility:hidden` (but laid out, so
 * nothing jumps) until the measured width has STOPPED changing for a beat. The
 * width can change once shortly after mount — e.g. a vertical scrollbar appears
 * when the list grows and narrows the row — and revealing on that first (stale)
 * measurement is what caused the earlier "long → shrink" flash. By waiting for the
 * width to settle while hidden, the first painted frame is already the final form.
 * A ResizeObserver keeps it re-fitting on later resizes.
 *
 * Headless-safe: with no layout (jsdom / SSR, `clientWidth === 0`) it reveals the
 * full string after a short safety timeout; the full string is also the `title`.
 */

import { useRef, useState, useLayoutEffect } from "react";

/** Measure the average character width by rendering a probe span INSIDE `el` — so
 *  it inherits `el`'s ACTUAL font (a canvas `ctx.font` can silently fall back to
 *  10px sans-serif). Absolutely positioned + hidden, so it never affects layout. */
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

/** Split `text` into a balanced `start … end` that fits in `chars` cells. */
export function middleTruncate(text: string, chars: number): string {
  if (chars >= text.length || chars < 3) return text;
  const keep = chars - 1; // reserve one cell for the "…"
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return text.slice(0, head) + "…" + text.slice(text.length - tail);
}

export interface MiddleEllipsisProps {
  text: string;
  /** Text styles (fontFamily/fontSize/color/fontWeight). fontFamily SHOULD be
   *  monospace for an exact fit; a proportional font over-estimates slightly. */
  style?: React.CSSProperties;
  className?: string;
}

export function MiddleEllipsis({ text, style, className }: MiddleEllipsisProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(text);
  // Hidden until the width settles, so the first paint is the final form.
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let revealed = false;
    let settle: ReturnType<typeof setTimeout> | undefined;

    const scheduleReveal = () => {
      if (revealed) return;
      if (settle) clearTimeout(settle);
      // Reveal only once the width has been quiet for a beat (absorbs the
      // one-off scrollbar-appearance reflow while still hidden → no retract).
      settle = setTimeout(() => { revealed = true; setReady(true); }, 120);
    };

    const compute = () => {
      const width = el.clientWidth;
      if (width <= 0) return; // no layout yet → wait for a real observe
      const charW = measureCharWidthIn(el);
      if (charW <= 0) { setDisplay(text); scheduleReveal(); return; }
      const fit = Math.floor(width / charW);
      setDisplay(fit >= text.length ? text : middleTruncate(text, fit));
      scheduleReveal();
    };

    compute();
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(compute);
      ro.observe(el);
    }
    // Safety: reveal even if width never resolves (jsdom / broken layout).
    const safety = setTimeout(() => { if (!revealed) { revealed = true; setReady(true); } }, 700);
    return () => { ro?.disconnect(); if (settle) clearTimeout(settle); clearTimeout(safety); };
  }, [text]);

  return (
    <span
      ref={ref}
      className={className}
      title={text}
      style={{
        display: "block", overflow: "hidden", whiteSpace: "nowrap",
        visibility: ready ? "visible" : "hidden",
        ...style,
      }}
    >
      {display}
    </span>
  );
}

export default MiddleEllipsis;
