/**
 * DalosSecretReveal — 1:1 port of OuronetUI's ViewSeedPhraseModal body. Given
 * the decrypted plaintext of an account's `secret` + its DALOS origin mode +
 * curve, it re-derives the FullKey via `createOuronetAccount` and offers the
 * tabbed view of every representation (Seed / Bitmap / BitString / Base-10 /
 * Base-49), a mask/Reveal toggle, the origin chip, and the standard address.
 *
 * APOLLO (₱./Π.) accounts re-derive on the 1024-bit curve (32×32 bitmap);
 * DALOS Genesis on 1600 bits (40×40).
 *
 * The re-derivation itself lives in `src/codex-identity/rebuildFullKey.ts` —
 * it was lifted out of this file unchanged so the Arweave seed flow can reuse
 * it to read an account's bitstring. This component only renders the result.
 */

import * as React from "react";
import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, Check, Eye, EyeOff, Grid3x3, Hash, Binary, Copy, Download } from "lucide-react";
import { encodeBitmapBMP } from "@ancientpantheon/codex-core";

/** Uniform "Download BMP" tag, styled to match `CopyValueBtn` — the Bitmap
 *  panel's only field with a downloadable value instead of (or alongside) a
 *  copyable text one. Produces a REAL uncompressed 1bpp Windows BMP (one
 *  pixel per bit, row-major) via the shared `encodeBitmapBMP` codec — the
 *  same format `decodeBitmapBMP`/the Spawn modal's bitmap import expects. */
function downloadBitmapBMP(bits: string, cols: number, rows: number, curve: string): void {
  const buf = encodeBitmapBMP(bits, cols);
  const url = URL.createObjectURL(new Blob([buf], { type: "image/bmp" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${curve}-key-${cols}x${rows}.bmp`;
  a.click();
  // Give the browser's download handoff time to read the blob before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function DownloadBitmapBtn({ bits, cols, rows, curve }: { bits: string; cols: number; rows: number; curve: string }) {
  return (
    <button
      type="button"
      onClick={() => downloadBitmapBMP(bits, cols, rows, curve)}
      title={`Download the ${cols}×${rows} 1-bit black-and-white bitmap (.bmp) — uncompressed, one pixel per bit`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 6,
        fontSize: 11, fontWeight: 600, flexShrink: 0, cursor: "pointer",
        border: "1px solid #262626", background: "transparent", color: "#888",
      }}
    >
      <Download style={{ width: 12, height: 12 }} />
      Download BMP
    </button>
  );
}

/** Uniform "Copy Value" tag — same look + placement (field header, outside the
 *  value) for every field in the reveal. */
function CopyValueBtn({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { navigator.clipboard.writeText(value).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 6,
        fontSize: 11, fontWeight: 600, flexShrink: 0, cursor: "pointer",
        border: `1px solid ${copied ? "#16a34a" : "#262626"}`,
        background: copied ? "#0a2a14" : "transparent",
        color: copied ? "#4ade80" : "#888",
      }}
    >
      {copied ? <Check style={{ width: 12, height: 12 }} /> : <Copy style={{ width: 12, height: 12 }} />}
      {copied ? "Copied" : "Copy Value"}
    </button>
  );
}
import {
  BITMAP_ROWS,
  BITMAP_COLS,
  BITMAP_TOTAL_BITS,
} from "@stoachain/stoa-core/dalos";
import { rebuildFullKey } from "../../codex-identity/rebuildFullKey.js";
import type { OuroOriginMode, OuroOriginSeedTab, OuronetOriginCurve } from "../../types/entities.js";
import { useIsMobile } from "@ancientpantheon/codex-ui/ui";

const MONO = "var(--codex-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)";
const APOLLO_ROWS = 32, APOLLO_COLS = 32, APOLLO_BITS = 1024;

const COLORS = {
  chainweaver: "#3b82f6", dalosCustom: "#ceac5f", koala: "#ec4899",
  bitmap: "#22c55e", bitstring: "#0ea5e9", int10: "#a855f7", int49: "#eab308", apollo: "#f97316",
} as const;

function originColor(mode: OuroOriginMode, seedTab?: OuroOriginSeedTab, curve?: OuronetOriginCurve): string {
  if (curve === "apollo") return COLORS.apollo;
  if (mode === "seedWords") {
    if (seedTab === "12-words") return COLORS.chainweaver;
    if (seedTab === "24-words") return COLORS.koala;
    return COLORS.dalosCustom;
  }
  if (mode === "bitmap") return COLORS.bitmap;
  if (mode === "bitString") return COLORS.bitstring;
  if (mode === "integerBase10") return COLORS.int10;
  if (mode === "integerBase49") return COLORS.int49;
  return COLORS.dalosCustom;
}

function originLabel(mode: OuroOriginMode, seedTab?: OuroOriginSeedTab, curve?: OuronetOriginCurve): string {
  const suffix = curve === "apollo" ? " · APOLLO" : "";
  if (mode === "seedWords") {
    if (seedTab === "12-words") return `seed words (Chainweaver 12)${suffix}`;
    if (seedTab === "24-words") return `seed words (Koala 24)${suffix}`;
    return `seed words (DALOS Custom)${suffix}`;
  }
  if (mode === "bitmap") return `bitmap (${curve === "apollo" ? "32×32" : "40×40"})${suffix}`;
  if (mode === "bitString") return `bitstring (${curve === "apollo" ? APOLLO_BITS : BITMAP_TOTAL_BITS} bits)${suffix}`;
  if (mode === "integerBase10") return `base-10 integer${suffix}`;
  if (mode === "integerBase49") return `base-49 integer${suffix}`;
  return "unknown";
}

function BitmapGrid({ bits, rows, cols, color }: { bits: string; rows: number; cols: number; color: string }) {
  const cell = Math.max(4, Math.floor(280 / cols));
  const cells = Array.from(bits.slice(0, rows * cols).padEnd(rows * cols, "0"));
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, ${cell}px)`, gap: 1, width: "fit-content", margin: "0 auto" }}>
      {cells.map((b, i) => (
        <span key={i} style={{ width: cell, height: cell, backgroundColor: b === "1" ? color : "#161616", borderRadius: 1 }} />
      ))}
    </div>
  );
}

const masked = (unmasked: boolean): React.CSSProperties => ({
  filter: unmasked ? "none" : "blur(4px)", transition: "filter 120ms ease",
});

/**
 * Round 24 owner correction: "for smaller display we should go with 1 or 2
 * words per line, horisontaly. not like that [a hardcoded 8-column grid],
 * depending on how long the word is. we always fit max 8 horisontaly, (if
 * they fit) if not 6 then 4 then 2 then 1. but the word should be one per
 * line. if it doesnt fit one per line, we dont shorten it, but ratel
 * carusell it moving it slowly liek a train, from right to left, and
 * placing a copy button at its end, remaing on one word per line."
 *
 * Replaces the old two-branch system (a hardcoded 8-column grid for
 * "short" words, middle-truncated one-per-line for "long" ones — DALOS
 * custom words run up to 256 glyphs, well past anything a fixed grid
 * could show) with ONE responsive grid: measure the real available width
 * (`useMeasuredWidth` below), then pick the WIDEST of these candidate
 * column counts at which every word still fits, single line, in its own
 * cell. A word that still doesn't fit even at 1 column (full width) is
 * never truncated — it gets the marquee treatment instead (see
 * `codex-word-marquee` in tokens.css), so the actual, complete value stays
 * readable/verifiable rather than losing characters to an ellipsis.
 */
const GRID_CANDIDATE_COLUMNS = [8, 6, 4, 2, 1] as const;
/** ~0.6em per character is a typical monospace advance width (this grid
 *  always renders words in `MONO`); rounded up for a safety margin — better
 *  to drop a column early than let a word silently clip its cell. */
const MONO_CHAR_WIDTH_PX = 8.5;
/** Matches the grid's own column gap (`gap: "14px 8px"` below). */
const GRID_CELL_GAP_PX = 8;
/** Matches the cell's own left+right padding (`padding: "10px 8px 8px"` — 8px each side). */
const GRID_CELL_PADDING_PX = 16;

function fitWordColumns(
  containerWidth: number,
  words: readonly string[],
): { columns: number; overflow: ReadonlySet<number> } {
  for (const columns of GRID_CANDIDATE_COLUMNS) {
    const cellWidth = (containerWidth - (columns - 1) * GRID_CELL_GAP_PX) / columns;
    const usable = cellWidth - GRID_CELL_PADDING_PX;
    const overflow = new Set<number>();
    words.forEach((w, i) => {
      if (w.length * MONO_CHAR_WIDTH_PX > usable) overflow.add(i);
    });
    // Either everything fits at this column count, or this is the last
    // (narrowest) candidate — stop here either way; any remaining
    // `overflow` entries get marqueed instead of shrinking further.
    if (overflow.size === 0 || columns === 1) return { columns, overflow };
  }
  /* istanbul ignore next -- unreachable: 1 is always the final candidate above. */
  return { columns: 1, overflow: new Set(words.map((_, i) => i)) };
}

/** Live-measures a DOM node's own content width via `ResizeObserver`,
 *  through a callback ref (no separate `useEffect` + stored-element-ref
 *  needed). Defaults to a generous 800px — "plenty of room" — until the
 *  first real measurement lands, so jsdom (which never resolves real
 *  layout) and the very first paint both fall back to the widest grid
 *  (8 columns, no marquee) rather than assuming the narrowest. */
function useMeasuredWidth(fallback = 800): [(node: HTMLDivElement | null) => void, number] {
  const [width, setWidth] = useState(fallback);
  const [observer, setObserver] = useState<ResizeObserver | null>(null);
  const ref = useCallback((node: HTMLDivElement | null) => {
    observer?.disconnect();
    if (!node) {
      setObserver(null);
      return;
    }
    setWidth(node.clientWidth || fallback);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    ro.observe(node);
    setObserver(ro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [ref, width];
}

function RepPanel({ value, unmasked, label, color, icon }: { value: string; unmasked: boolean; label: string; color: string; icon: React.ReactNode }) {
  // Round 22 owner correction: "the bit string display isnt using the
  // available space, and is shwoing scroll, when clearly you can see it
  // has extension place. it is only after the available space is consumed
  // should the scroll be used." MOBILE ONLY (inside a `fillBody`
  // `CodexModalShell`, which establishes the definite-height flex chain
  // this needs — see that prop's own doc comment): the value box flex-
  // fills whatever room is left in the card instead of stopping at a fixed
  // 240px, and only scrolls once its OWN content genuinely exceeds that —
  // never before. Desktop (or any host without a `fillBody` ancestor)
  // keeps the exact fixed 240px cap it always had.
  const isMobile = useIsMobile();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: isMobile ? 1 : undefined, minHeight: isMobile ? 0 : undefined }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color }}>{icon}{label}</div>
        <CopyValueBtn value={value} />
      </div>
      <div
        style={{
          borderRadius: 8, border: `1px solid ${color}30`, padding: 12, overflowY: "auto", backgroundColor: "#0a0a0a",
          maxHeight: isMobile ? undefined : 240,
          flex: isMobile ? 1 : undefined,
          minHeight: isMobile ? 0 : undefined,
        }}
      >
        <code style={{ display: "block", fontFamily: MONO, fontSize: 11, lineHeight: 1.6, wordBreak: "break-all", color: "#d2d3d4", ...masked(unmasked) }}>{value}</code>
      </div>
      <p style={{ margin: 0, fontSize: 10, color: "#555", flexShrink: 0 }}>{value.length} characters</p>
    </div>
  );
}

export interface DalosSecretRevealProps {
  plaintext: string;
  originMode?: OuroOriginMode;
  originSeedTab?: OuroOriginSeedTab;
  originCurve?: OuronetOriginCurve;
  isSmart?: boolean;
  /** Overrides the generic "Created from <X>" text with a caller-supplied
   *  provenance string, e.g. "Ouronet account \"Explorer\"" — for callers
   *  (like the Arweave seed reveal) whose real source isn't expressible by
   *  originMode/originCurve alone, since they only ever pass originMode:
   *  "bitString" regardless of the seed's actual origin. */
  sourceLabelOverride?: string;
  /** Hides the derived Smart/Standard address block entirely — for callers
   *  (like the Arweave seed reveal) where an Ouronet address has no meaning. */
  hideAddress?: boolean;
}

export function DalosSecretReveal({ plaintext, originMode = "seedWords", originSeedTab, originCurve = "dalos", isSmart = false, sourceLabelOverride, hideAddress = false }: DalosSecretRevealProps) {
  const [active, setActive] = useState<string>(originMode === "seedWords" ? "seed" : originMode === "bitmap" ? "bitmap" : originMode === "bitString" ? "bitstring" : originMode === "integerBase10" ? "int10" : originMode === "integerBase49" ? "int49" : "seed");
  const [unmasked, setUnmasked] = useState(false);
  // See `RepPanel`'s own doc comment — this is the same "fill available
  // space, only scroll once truly full" flex chain, one level up.
  const isMobile = useIsMobile();

  const full = useMemo(() => (plaintext ? rebuildFullKey(plaintext, originMode, originCurve) : null), [plaintext, originMode, originCurve]);
  const color = originColor(originMode, originSeedTab, originCurve);
  const seedWords = originMode === "seedWords" ? plaintext.trim().split(/\s+/).filter(Boolean) : [];
  // Round 24 — see `fitWordColumns`'s own doc comment.
  const [wordGridRef, wordGridWidth] = useMeasuredWidth();
  const { columns: wordColumns, overflow: wordOverflow } = useMemo(
    () => fitWordColumns(wordGridWidth, seedWords),
    [wordGridWidth, seedWords],
  );
  const isApollo = originCurve === "apollo";
  const rows = isApollo ? APOLLO_ROWS : BITMAP_ROWS;
  const cols = isApollo ? APOLLO_COLS : BITMAP_COLS;
  const totalBits = isApollo ? APOLLO_BITS : BITMAP_TOTAL_BITS;

  const tabs = (originMode === "seedWords"
    ? [{ v: "seed", l: "Seed", s: `${seedWords.length} words`, c: color }] : [])
    .concat([
      { v: "bitmap", l: "Bitmap", s: `${rows} × ${cols}`, c: COLORS.bitmap },
      { v: "bitstring", l: "BitString", s: `${totalBits} bits`, c: COLORS.bitstring },
      { v: "int10", l: "Base-10", s: "integer", c: COLORS.int10 },
      { v: "int49", l: "Base-49", s: "integer", c: COLORS.int49 },
    ]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: isMobile ? 1 : undefined, minHeight: isMobile ? 0 : undefined }}>
      {/* Origin chip + Reveal toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <Check style={{ width: 14, height: 14, color: "#22c55e", flexShrink: 0 }} />
        <span style={{ fontSize: 12, color: "#888" }}>Created from <strong style={{ color }}>{sourceLabelOverride ?? originLabel(originMode, originSeedTab, originCurve)}</strong></span>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={() => setUnmasked((u) => !u)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, fontSize: 12, border: "1px solid #262626", background: "transparent", color: "#d2d3d4", cursor: "pointer" }}>
          {unmasked ? <EyeOff style={{ width: 14, height: 14 }} /> : <Eye style={{ width: 14, height: 14 }} />}{unmasked ? "Hide" : "Reveal"}
        </button>
      </div>

      {/* Warning */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: 8, borderRadius: 8, backgroundColor: isApollo ? "#f9731608" : "#8b1a1a08", border: `1px solid ${isApollo ? "#f9731640" : "#8b1a1a30"}`, flexShrink: 0 }}>
        <AlertTriangle style={{ width: 14, height: 14, flexShrink: 0, marginTop: 2, color: isApollo ? COLORS.apollo : "#c0392b" }} />
        <p style={{ margin: 0, fontSize: 11, lineHeight: 1.5, color: isApollo ? "#f0a978" : "#c0392b" }}>
          {isApollo
            ? <><strong style={{ color: COLORS.apollo }}>APOLLO observational account.</strong> Key material is shown for export / inspection, but ₱./Π. prefixes can't activate or sign on StoaChain™.</>
            : <><strong>This is your private key in every form below.</strong> Any one representation can fully reconstruct the account. Never share, screenshot, or paste anywhere except a trusted offline backup.</>}
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${tabs.length}, 1fr)`, gap: 4, padding: 4, borderRadius: 8, backgroundColor: "#18181B", flexShrink: 0 }}>
        {tabs.map((t) => {
          const on = active === t.v;
          return (
            <button key={t.v} type="button" onClick={() => setActive(t.v)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, padding: "6px 4px", borderRadius: 6, border: "none", cursor: "pointer", backgroundColor: on ? t.c + "22" : "transparent", borderBottom: on ? `2px solid ${t.c}` : "2px solid transparent" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: on ? t.c : "#888" }}>{t.l}</span>
              <span style={{ fontSize: 10, color: "#555" }}>{t.s}</span>
            </button>
          );
        })}
      </div>

      {/* Panels */}
      <div style={{ flex: isMobile ? 1 : undefined, minHeight: isMobile ? 0 : undefined, display: isMobile ? "flex" : undefined, flexDirection: isMobile ? "column" : undefined }}>
        {active === "seed" && originMode === "seedWords" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color }}>Seed · {seedWords.length} words</span>
              <CopyValueBtn value={plaintext} />
            </div>
            {/* Round 24 — ONE responsive grid replaces the old fixed
                8-column / middle-truncated-list split (see `fitWordColumns`'s
                own doc comment): as many columns as genuinely fit (8, 6, 4,
                2, down to 1), every word single-line in its own cell, no
                shortening — a word that STILL doesn't fit at 1 column
                (DALOS custom words run up to 256 glyphs) scrolls instead
                of truncating. */}
            <div
              ref={wordGridRef}
              style={{ display: "grid", gridTemplateColumns: `repeat(${wordColumns}, 1fr)`, gap: "14px 8px" }}
            >
              {seedWords.map((w, i) => {
                const marquee = wordOverflow.has(i);
                return (
                  <div
                    key={i}
                    style={{
                      position: "relative",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: marquee ? "flex-start" : "center",
                      padding: "10px 8px 8px",
                      borderRadius: 8,
                      border: `1px solid ${color}30`,
                      backgroundColor: color + "10",
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        top: -9,
                        left: "50%",
                        transform: "translateX(-50%)",
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 10,
                        fontWeight: 700,
                        fontFamily: MONO,
                        color: "#0a0a0a",
                        backgroundColor: color,
                        border: "2px solid #0a0a0a",
                      }}
                    >
                      {i + 1}
                    </span>
                    {marquee ? (
                      // Too wide even at 1 column — a fixed copy button
                      // "at its end", the text itself scrolling right to
                      // left behind it, full value intact (never
                      // shortened). `overflow: hidden` on the track is
                      // what makes the marquee invisible outside the cell;
                      // the animated span is `width: max-content` so its
                      // own length drives the loop, not the cell's.
                      <div style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", minWidth: 0 }}>
                        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                          <span
                            style={{
                              display: "inline-block",
                              width: "max-content",
                              whiteSpace: "nowrap",
                              fontSize: 13,
                              fontFamily: MONO,
                              color: "#d2d3d4",
                              // "moving it slowly liek a train" — duration
                              // scales with the word's own length so every
                              // word crosses at roughly the same visual
                              // speed, not the same fixed time.
                              animation: `codex-word-marquee ${Math.max(6, w.length * 0.18)}s linear infinite`,
                              ...masked(unmasked),
                            }}
                          >
                            {w}
                          </span>
                        </div>
                        <CopyValueBtn value={w} />
                      </div>
                    ) : (
                      <span
                        style={{
                          fontSize: 13,
                          fontFamily: MONO,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          maxWidth: "100%",
                          textAlign: "center",
                          color: "#d2d3d4",
                          ...masked(unmasked),
                        }}
                      >
                        {w}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {active === "bitmap" && (full ? (
          <div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
              <DownloadBitmapBtn
                bits={full.privateKey.bitString}
                cols={cols}
                rows={rows}
                curve={originCurve}
              />
            </div>
            <BitmapGrid bits={full.privateKey.bitString} rows={rows} cols={cols} color={COLORS.bitmap} />
            <p style={{ textAlign: "center", marginTop: 8, fontSize: 11, color: "#555" }}>
              <Grid3x3 style={{ width: 12, height: 12, display: "inline", verticalAlign: "middle", marginRight: 4 }} />
              {rows} × {cols} = {totalBits} bits · row-major
            </p>
          </div>
        ) : <ErrorPanel msg="Could not derive bitmap." />)}
        {active === "bitstring" && (full ? <RepPanel value={full.privateKey.bitString} unmasked={unmasked} label={`${totalBits}-bit binary`} color={COLORS.bitstring} icon={<Binary style={{ width: 13, height: 13 }} />} /> : <ErrorPanel msg="Could not derive bitstring." />)}
        {active === "int10" && (full ? <RepPanel value={full.privateKey.int10} unmasked={unmasked} label="Base-10 integer" color={COLORS.int10} icon={<Hash style={{ width: 13, height: 13 }} />} /> : <ErrorPanel msg="Could not derive base-10." />)}
        {active === "int49" && (full ? <RepPanel value={full.privateKey.int49} unmasked={unmasked} label="Base-49 integer (DALOS alphabet)" color={COLORS.int49} icon={<Hash style={{ width: 13, height: 13 }} />} /> : <ErrorPanel msg="Could not derive base-49." />)}
      </div>

      {/* Derived address — Smart (Σ./Π.) for smart accounts, Standard (Ѻ./₱.) otherwise */}
      {full && !hideAddress && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: "#555" }}>{isSmart ? "Smart address" : "Standard address"}</span>
            <CopyValueBtn value={isSmart ? full.smartAddress : full.standardAddress} />
          </div>
          <div style={{ borderRadius: 8, border: "1px solid #262626", padding: 12, backgroundColor: "#0a0a0a" }}>
            <code style={{ fontFamily: MONO, fontSize: 11, wordBreak: "break-all", color }}>{isSmart ? full.smartAddress : full.standardAddress}</code>
          </div>
        </div>
      )}
    </div>
  );
}

function ErrorPanel({ msg }: { msg: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 8, backgroundColor: "#8b1a1a08", border: "1px solid #8b1a1a30" }}>
      <AlertTriangle style={{ width: 14, height: 14, flexShrink: 0, marginTop: 2, color: "#c0392b" }} />
      <p style={{ margin: 0, fontSize: 11, color: "#c0392b" }}>{msg}</p>
    </div>
  );
}
