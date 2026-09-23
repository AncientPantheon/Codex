/**
 * MeasuredHexHighlight / StoaAddressHighlight — renders a hex-ish value
 * (a Stoa k:/u:/c:/w: address, or a raw public/private key) FILLING the
 * parent width: base-color body, bold highlight-color on the FIRST 3 AND
 * LAST 3 characters, with a CENTERED middle truncation (`start … end`,
 * balanced halves) when it can't fit — so it fills the row and reads
 * clearly as shortened, rather than being cut short to a fixed length
 * regardless of how much room is actually available.
 *
 * Owner correction (docs/work/codex-ui-mobile/design.md §8, the "further
 * optimize round 3"): "we can extend the account name on the whole width,
 * and shorten it only if it doesn't fit" — supersedes an earlier round's
 * fixed "3 chars after prefix … last 3 yellow" shape (which shortened
 * regardless of available room) with this MEASURED fit, mirroring the
 * sibling `OuronetAddressHighlight`'s own "measured, not fixed" convention
 * (own local copy of the measure/truncate helpers — same reasoning as that
 * component's doc comment: each highlight variant owns its exact shape, not
 * worth abstracting a third layer over). A LATER owner correction (round 4):
 * "colour the first 3 characters of the account string same as the last 3"
 * — both ends now highlight, not just the tail.
 *
 * `MeasuredHexHighlight` is the generic engine (used for raw key values —
 * "we need to shorten the key correctly first 3 and last 3 coloured… same
 * with the private key when revealed via the switcher… the private key we
 * show in in the same orange colour" — pass `edgeColor="#f59e0b"` (and
 * `baseColor` the same, for a uniform orange read) for that case).
 * `StoaAddressHighlight` is a thin, address-specific wrapper: it strips the
 * 2-char `k:`/`u:`/`c:`/`w:` prefix (every caller already shows it
 * separately in the row's own medallion, so repeating it here would waste
 * width on a duplicate) and defaults to the standard silver/yellow pair.
 *
 * The fit is measured (monospace → ~constant char width) and split into
 * balanced halves around a single `…`.
 *
 * NO VISIBLE RETRACT: kept `visibility:hidden` (but laid out) until the
 * measured width STOPS changing for a beat — the width can change once
 * shortly after mount (e.g. a scrollbar appears and narrows the row), and
 * revealing on that first stale measurement is what caused an earlier
 * "long → shrink" flash in the sibling `MiddleEllipsis`/
 * `OuronetAddressHighlight` components this one is modeled on.
 */

import { useRef, useState, useLayoutEffect } from "react";

const YELLOW = "#eab308";

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

/** Base color body + bold `edgeColor` on the FIRST 3 and LAST 3 characters,
 *  on the ALREADY-truncated display string — the head/tail of a
 *  middle-truncated string are always the real leading/trailing characters
 *  of the source, so this stays correct however much (or little) got
 *  shortened. Short strings (≤6 chars, head/tail would overlap) render
 *  entirely in `edgeColor` rather than attempting a split. */
function highlighted(s: string, baseColor: string, edgeColor: string) {
  if (s.length <= 6) return <span style={{ color: edgeColor, fontWeight: 700 }}>{s}</span>;
  const head = s.slice(0, 3);
  const mid = s.slice(3, s.length - 3);
  const tail = s.slice(s.length - 3);
  return (
    <>
      <span style={{ color: edgeColor, fontWeight: 700 }}>{head}</span>
      <span style={{ color: baseColor }}>{mid}</span>
      <span style={{ color: edgeColor, fontWeight: 700 }}>{tail}</span>
    </>
  );
}

export interface MeasuredHexHighlightProps {
  /** The FULL value to display. */
  value: string;
  /** Characters stripped from the FRONT before measuring/display (e.g. 2 for
   *  a `k:`/`u:`/`c:`/`w:` prefix already shown elsewhere). Default 0 — the
   *  whole value displays, as a raw key value needs. */
  prefixChars?: number;
  /** Base (non-highlighted, middle section) text color. */
  baseColor?: string;
  /** First-3/last-3 highlight color. */
  edgeColor?: string;
  style?: React.CSSProperties;
  className?: string;
}

export function MeasuredHexHighlight({ value, prefixChars = 0, baseColor = "#d2d3d4", edgeColor = YELLOW, style, className }: MeasuredHexHighlightProps) {
  const body = prefixChars > 0 && value.length > prefixChars ? value.slice(prefixChars) : value;
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(body);
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
      if (charW <= 0) { setDisplay(body); scheduleReveal(); return; }
      const fit = Math.floor(width / charW);
      setDisplay(fit >= body.length ? body : middleTruncate(body, fit));
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

  return (
    <span
      ref={ref}
      className={className}
      title={value}
      style={{
        display: "block", overflow: "hidden", whiteSpace: "nowrap",
        visibility: ready ? "visible" : "hidden",
        ...style,
      }}
    >
      {highlighted(display, baseColor, edgeColor)}
    </span>
  );
}

export interface StoaAddressHighlightProps {
  /** The FULL address, including its k:/u:/c:/w: prefix (dropped for display). */
  address: string;
  /** Base (non-highlighted) text color. Defaults to the standard row color. */
  baseColor?: string;
  style?: React.CSSProperties;
  className?: string;
}

/** Address-specific wrapper: strips the 2-char prefix, standard silver/yellow. */
export function StoaAddressHighlight({ address, baseColor = "#d2d3d4", style, className }: StoaAddressHighlightProps) {
  return <MeasuredHexHighlight value={address} prefixChars={2} baseColor={baseColor} edgeColor={YELLOW} style={style} className={className} />;
}

export default StoaAddressHighlight;
