/**
 * OuronetAddressHighlight — ported 1:1 from OuronetUI's
 * `src/components/OuronetAddressHighlight.tsx`.
 *
 * Renders an Ouronet address (Ѻ.BODY) filling the parent width: silver base,
 * blue-bold highlight on the first 3 body chars + last 3 chars, with
 * ResizeObserver-driven middle truncation when it doesn't fit.
 *
 * Cloned verbatim from OuronetUI. The Tailwind classes (`font-mono text-xs
 * relative`) are kept as-is — the consumer's Tailwind build scans the package
 * dist (OuronetUI tailwind.config.cjs content glob), and `text-xs` is config-
 * overridden to 14px in OuronetUI, so inlining a fixed font-size here would
 * render 2px smaller than My Codex. Keep the class for pixel parity.
 */

import { useRef, useState, useLayoutEffect } from "react";

interface Props {
  address: string;
  className?: string;
}

function highlighted(s: string) {
  if (s.length < 6) return <span style={{ color: "#a0a0b0" }}>{s}</span>;
  const prefix = s.slice(0, 2);
  const h1 = s.slice(2, 5);
  const mid = s.slice(5, s.length - 3);
  const h2 = s.slice(-3);
  return (
    <>
      <span style={{ color: "#a0a0b0" }}>{prefix}</span>
      <span style={{ color: "#3b82f6", fontWeight: 700 }}>{h1}</span>
      <span style={{ color: "#a0a0b0" }}>{mid}</span>
      <span style={{ color: "#3b82f6", fontWeight: 700 }}>{h2}</span>
    </>
  );
}

function truncateMiddle(s: string, head: number, tail: number) {
  if (s.length <= head + tail + 3) return s;
  return s.slice(0, head) + "·····" + s.slice(-tail);
}

export function OuronetAddressHighlight({ address, className }: Props) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(address);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const recalc = () => {
      const available = container.clientWidth;
      measure.textContent = address;
      const fullWidth = measure.scrollWidth;
      if (fullWidth <= available + 2) {
        setDisplay(address);
        return;
      }
      const charsPerPx = address.length / fullWidth;
      const approxChars = Math.floor(available * charsPerPx) - 5;
      const half = Math.max(4, Math.floor(approxChars / 2));
      setDisplay(truncateMiddle(address, half, Math.max(3, approxChars - half)));
    };

    recalc();
    const ro = new ResizeObserver(recalc);
    ro.observe(container);
    return () => ro.disconnect();
  }, [address]);

  return (
    <span
      ref={containerRef}
      className={`font-mono text-xs relative ${className ?? ""}`}
      style={{ display: "flex", flex: 1, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", alignItems: "center" }}
      title={address}
    >
      <span
        ref={measureRef}
        aria-hidden
        style={{
          position: "absolute",
          visibility: "hidden",
          pointerEvents: "none",
          whiteSpace: "nowrap",
          fontFamily: "inherit",
          fontSize: "inherit",
        }}
      />
      {highlighted(display)}
    </span>
  );
}
