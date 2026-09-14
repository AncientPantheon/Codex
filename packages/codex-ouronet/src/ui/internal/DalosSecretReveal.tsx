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
import { useMemo, useState } from "react";
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

/** A seed word longer than this wraps to enough lines in the 8-column grid
 *  that the grid stops being readable (the DALOS charset allows up to 256
 *  glyphs per word — the grid was designed for short, dictionary-style
 *  words). Past this length the WHOLE seed switches to one word per line,
 *  single line, middle-truncated — never a mix of the two layouts. */
const LONG_SEED_WORD_THRESHOLD = 24;

/** Keeps the first `head` and last `tail` characters, replacing the middle
 *  with a single "…" — the same "the tail is what you check a value by"
 *  convention the RSA-parameter panels already use, applied here because a
 *  256-glyph word cannot render on one line otherwise. */
function truncateMiddle(value: string, head: number, tail: number): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

function RepPanel({ value, unmasked, label, color, icon }: { value: string; unmasked: boolean; label: string; color: string; icon: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color }}>{icon}{label}</div>
        <CopyValueBtn value={value} />
      </div>
      <div style={{ borderRadius: 8, border: `1px solid ${color}30`, padding: 12, maxHeight: 240, overflowY: "auto", backgroundColor: "#0a0a0a" }}>
        <code style={{ display: "block", fontFamily: MONO, fontSize: 11, lineHeight: 1.6, wordBreak: "break-all", color: "#d2d3d4", ...masked(unmasked) }}>{value}</code>
      </div>
      <p style={{ margin: 0, fontSize: 10, color: "#555" }}>{value.length} characters</p>
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

  const full = useMemo(() => (plaintext ? rebuildFullKey(plaintext, originMode, originCurve) : null), [plaintext, originMode, originCurve]);
  const color = originColor(originMode, originSeedTab, originCurve);
  const seedWords = originMode === "seedWords" ? plaintext.trim().split(/\s+/).filter(Boolean) : [];
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
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Origin chip + Reveal toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Check style={{ width: 14, height: 14, color: "#22c55e", flexShrink: 0 }} />
        <span style={{ fontSize: 12, color: "#888" }}>Created from <strong style={{ color }}>{sourceLabelOverride ?? originLabel(originMode, originSeedTab, originCurve)}</strong></span>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={() => setUnmasked((u) => !u)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, fontSize: 12, border: "1px solid #262626", background: "transparent", color: "#d2d3d4", cursor: "pointer" }}>
          {unmasked ? <EyeOff style={{ width: 14, height: 14 }} /> : <Eye style={{ width: 14, height: 14 }} />}{unmasked ? "Hide" : "Reveal"}
        </button>
      </div>

      {/* Warning */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: 8, borderRadius: 8, backgroundColor: isApollo ? "#f9731608" : "#8b1a1a08", border: `1px solid ${isApollo ? "#f9731640" : "#8b1a1a30"}` }}>
        <AlertTriangle style={{ width: 14, height: 14, flexShrink: 0, marginTop: 2, color: isApollo ? COLORS.apollo : "#c0392b" }} />
        <p style={{ margin: 0, fontSize: 11, lineHeight: 1.5, color: isApollo ? "#f0a978" : "#c0392b" }}>
          {isApollo
            ? <><strong style={{ color: COLORS.apollo }}>APOLLO observational account.</strong> Key material is shown for export / inspection, but ₱./Π. prefixes can't activate or sign on StoaChain™.</>
            : <><strong>This is your private key in every form below.</strong> Any one representation can fully reconstruct the account. Never share, screenshot, or paste anywhere except a trusted offline backup.</>}
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${tabs.length}, 1fr)`, gap: 4, padding: 4, borderRadius: 8, backgroundColor: "#18181B" }}>
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
      <div>
        {active === "seed" && originMode === "seedWords" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color }}>Seed · {seedWords.length} words</span>
              <CopyValueBtn value={plaintext} />
            </div>
            {seedWords.some((w) => w.length > LONG_SEED_WORD_THRESHOLD) ? (
              // Long words (up to 256 DALOS glyphs each) cannot read on a
              // grid — wrapping a 256-character word across many lines is
              // what made the grid unreadable. One word per line, ONE
              // physical line each, middle-truncated, with its own copy
              // button (`Copy Value` above copies the whole plaintext, not
              // any one word) — never a mix with the short-word grid below.
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {seedWords.map((w, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 10px",
                      borderRadius: 8,
                      border: `1px solid ${color}30`,
                      backgroundColor: color + "10",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        color: color + "99",
                        fontFamily: MONO,
                        minWidth: 32,
                        textAlign: "right",
                        flexShrink: 0,
                      }}
                    >
                      {i + 1}.
                    </span>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 13,
                        fontFamily: MONO,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        color: "#d2d3d4",
                        ...masked(unmasked),
                      }}
                    >
                      {truncateMiddle(w, 48, 8)}
                    </span>
                    <CopyValueBtn value={w} />
                  </div>
                ))}
              </div>
            ) : (
              // Short (dictionary-style) words: an 8-per-row grid, the
              // position rendered as a medallion straddling the cell's top
              // edge — not inline text stealing width from the word itself.
              <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: "14px 8px" }}>
                {seedWords.map((w, i) => (
                  <div
                    key={i}
                    style={{
                      position: "relative",
                      display: "flex",
                      justifyContent: "center",
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
                    <span
                      style={{
                        fontSize: 13,
                        fontFamily: MONO,
                        wordBreak: "break-word",
                        textAlign: "center",
                        color: "#d2d3d4",
                        ...masked(unmasked),
                      }}
                    >
                      {w}
                    </span>
                  </div>
                ))}
              </div>
            )}
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
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
