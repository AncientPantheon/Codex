/**
 * StoicTagDisplay — inscription-style §StoicTag display.
 *
 * Cloned verbatim from OuronetUI's `src/components/StoicTagDisplay.tsx` so the
 * packaged CodexUI renders StoicTags pixel-identically to My Codex (auto-fit
 * font, capital-word tokenization, copy badge). The StoicTag itself is chain
 * state (NOT codex storage) — the OuronetAccountsTab feeds the tag string via
 * props; this component imports no chain readers.
 *
 * Short tags (≤ SINGLE_LINE_MAX glyphs) render on a single big line; longer
 * tags wrap at capital boundaries (camelCase words stay whole). The font
 * auto-fits so the whole tag is always visible with no scroll, and the box
 * grows only as tall as needed (capped at MAX_HEIGHT). Capitals render larger
 * than non-capitals. The § rides the upper-left; the STOICTAG badge copies the
 * (UI-form) §tag.
 */
import { useState, useRef, useLayoutEffect } from "react";
import { Landmark, Copy, Check } from "lucide-react";

const SINGLE_LINE_MAX = 18;
const MAX_HEIGHT = 200;

const isUpperGlyph = (g: string) => g !== g.toLowerCase() && g === g.toUpperCase();

/** Split glyphs into capital-delimited words (camelCase): each uppercase glyph
 *  starts a new word; lowercase / caseless glyphs join the current one. */
function tokenizeCapitalWords(glyphs: string[]): string[][] {
  const words: string[][] = [];
  let cur: string[] = [];
  for (const g of glyphs) {
    if (isUpperGlyph(g) && cur.length > 0) { words.push(cur); cur = []; }
    cur.push(g);
  }
  if (cur.length) words.push(cur);
  return words;
}

export interface StoicTagDisplayProps {
  /** Bare tag name (no § sigil). */
  tag: string;
  /** Hide the copy badge (e.g. inside a modal where copy isn't wanted). */
  hideCopy?: boolean;
}

export function StoicTagDisplay({ tag, hideCopy }: StoicTagDisplayProps) {
  const glyphs = Array.from(tag);
  const words = tokenizeCapitalWords(glyphs);
  const singleLine = glyphs.length <= SINGLE_LINE_MAX;
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [fontSize, setFontSize] = useState(28);
  const [copied, setCopied] = useState(false);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const text = textRef.current;
    if (!box || !text) return;
    const fit = () => {
      const availW = box.clientWidth - 16;
      const availH = MAX_HEIGHT - 14;
      if (availW <= 0) return;
      let lo = 6, hi = 58, best = 6;
      for (let i = 0; i < 11; i++) {
        const mid = (lo + hi) / 2;
        text.style.fontSize = `${mid}px`;
        if (text.scrollHeight <= availH && text.scrollWidth <= availW) { best = mid; lo = mid; }
        else { hi = mid; }
      }
      setFontSize(best);
    };
    fit();
    let lastW = box.clientWidth;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (Math.abs(w - lastW) < 1) return;
      lastW = w;
      fit();
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, [tag]);

  const handleCopy = () => {
    navigator.clipboard?.writeText(`§${tag}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }).catch(() => {});
  };

  return (
    <div style={{ position: "relative", width: "100%", paddingTop: "8px" }}>
      {/* § — rides the upper-left corner, semi-outside */}
      <div style={{ position: "absolute", top: "-6px", left: "-2px", zIndex: 2, fontFamily: "'Cinzel', serif", fontWeight: 700, fontSize: "38px", lineHeight: 1, color: "#7ef0a3", textShadow: "0 0 16px rgba(74,222,128,0.6)" }}>
        §
      </div>
      {/* STOICTAG badge — doubles as a copy button */}
      {!hideCopy && (
        <button
          type="button"
          onClick={handleCopy}
          title="Copy StoicTag"
          style={{ position: "absolute", top: "-2px", right: "8px", zIndex: 3, display: "flex", alignItems: "center", gap: "5px", padding: "3px 9px", borderRadius: "6px", backgroundColor: "#08120c", border: `1px solid ${copied ? "#16a34a" : "#16a34a55"}`, cursor: "pointer" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "0 0 12px 1px rgba(74,222,128,0.4)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "none"; }}
        >
          {copied ? <Check style={{ width: 12, height: 12, color: "#4ade80" }} /> : <Landmark style={{ width: 12, height: 12, color: "#16a34a" }} />}
          <span style={{ fontFamily: "'Cinzel', serif", fontSize: "10px", fontWeight: 600, letterSpacing: "0.14em", color: copied ? "#4ade80" : "#16a34a" }}>
            {copied ? "COPIED" : "STOICTAG"}
          </span>
          <Copy style={{ width: 10, height: 10, color: copied ? "#4ade80" : "#16a34a90" }} />
        </button>
      )}
      {/* The box — content-sized (grows only as needed, capped) */}
      <div
        ref={boxRef}
        style={{
          width: "100%",
          minHeight: "62px",
          maxHeight: `${MAX_HEIGHT}px`,
          borderRadius: "12px",
          border: "1px solid #16a34a40",
          background: "radial-gradient(circle at 50% 0%, rgba(22,163,74,0.10), transparent 72%)",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "6px 12px",
          boxSizing: "border-box",
        }}
      >
        <div
          ref={textRef}
          style={{
            fontFamily: "'Cinzel', serif",
            color: "#7ef0a3",
            textAlign: "center",
            lineHeight: 1.16,
            textShadow: "0 0 9px rgba(74,222,128,0.3)",
            maxWidth: "100%",
            fontSize: `${fontSize}px`,
            whiteSpace: singleLine ? "nowrap" : "normal",
          }}
        >
          {words.map((word, wi) => (
            <span key={wi} style={{ display: "inline-block", whiteSpace: "nowrap", margin: "0 0.06em" }}>
              {word.map((g, gi) => {
                const isUpper = isUpperGlyph(g);
                const isLower = g !== g.toUpperCase() && g === g.toLowerCase();
                const em = isUpper ? 1.32 : isLower ? 0.82 : 1.04;
                return <span key={gi} style={{ fontSize: `${em}em`, fontWeight: isUpper ? 600 : 500 }}>{g}</span>;
              })}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default StoicTagDisplay;
