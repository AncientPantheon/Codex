/**
 * DalosSecretReveal — 1:1 port of OuronetUI's ViewSeedPhraseModal body. Given
 * the decrypted plaintext of an account's `secret` + its DALOS origin mode +
 * curve, it re-derives the FullKey via `createOuronetAccount` and offers the
 * tabbed view of every representation (Seed / Bitmap / BitString / Base-10 /
 * Base-49), a mask/Reveal toggle, the origin chip, and the standard address.
 *
 * APOLLO (₱./Π.) accounts re-derive on the 1024-bit curve (32×32 bitmap);
 * DALOS Genesis on 1600 bits (40×40). Registry is built per-render
 * (createDefaultRegistry + register(Apollo) when the curve is apollo) — the
 * same construction OuronetUI's getOuronetRegistry uses.
 */

import * as React from "react";
import { useMemo, useState } from "react";
import { AlertTriangle, Check, Eye, EyeOff, Grid3x3, Hash, Binary, Copy } from "lucide-react";

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
  Apollo,
  createDefaultRegistry,
  createOuronetAccount,
  parseAsciiBitmap,
  BITMAP_ROWS,
  BITMAP_COLS,
  BITMAP_TOTAL_BITS,
  type CreateAccountOptions,
  type FullKey,
} from "@stoachain/stoa-core/dalos";
import type { OuroOriginMode, OuroOriginSeedTab, OuronetOriginCurve } from "../../types/entities.js";

const MONO = "var(--codex-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)";
const APOLLO_ROWS = 32, APOLLO_COLS = 32, APOLLO_BITS = 1024;

const COLORS = {
  chainweaver: "#3b82f6", dalosCustom: "#ceac5f", koala: "#ec4899",
  bitmap: "#22c55e", bitstring: "#0ea5e9", int10: "#a855f7", int49: "#eab308", apollo: "#f97316",
} as const;

function rebuildFullKey(plaintext: string, originMode: OuroOriginMode, originCurve: OuronetOriginCurve): FullKey | null {
  try {
    const primitiveId = originCurve === "apollo" ? "dalos-apollo" : "dalos-gen-1";
    const registry = createDefaultRegistry();
    if (originCurve === "apollo") registry.register(Apollo);

    let options: CreateAccountOptions;
    switch (originMode) {
      case "seedWords": {
        const words = plaintext.trim().split(/\s+/).filter(Boolean);
        if (!words.length) return null;
        options = { mode: "seedWords", data: words, primitiveId };
        break;
      }
      case "bitmap": {
        const lines = plaintext.split(",");
        if (originCurve === "apollo") {
          let bits = "";
          for (const row of lines) for (const ch of row) bits += (ch === "#" || ch === "1") ? "1" : "0";
          options = { mode: "bitString", data: bits, primitiveId };
        } else {
          const bmp = parseAsciiBitmap(lines);
          options = { mode: "bitmap", data: bmp, primitiveId };
        }
        break;
      }
      case "bitString": options = { mode: "bitString", data: plaintext, primitiveId }; break;
      case "integerBase10": options = { mode: "integerBase10", data: plaintext, primitiveId }; break;
      case "integerBase49": options = { mode: "integerBase49", data: plaintext, primitiveId }; break;
      default: {
        const words = plaintext.trim().split(/\s+/).filter(Boolean);
        options = { mode: "seedWords", data: words, primitiveId };
      }
    }
    return createOuronetAccount(registry, options);
  } catch (err) {
    console.error("rebuildFullKey failed:", err);
    return null;
  }
}

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
}

export function DalosSecretReveal({ plaintext, originMode = "seedWords", originSeedTab, originCurve = "dalos", isSmart = false }: DalosSecretRevealProps) {
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
        <span style={{ fontSize: 12, color: "#888" }}>Created from <strong style={{ color }}>{originLabel(originMode, originSeedTab, originCurve)}</strong></span>
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
              {seedWords.map((w, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderRadius: 8, border: `1px solid ${color}30`, backgroundColor: color + "10" }}>
                  <span style={{ fontSize: 10, color: color + "99", fontFamily: MONO, minWidth: 18, textAlign: "right" }}>{i + 1}.</span>
                  <span style={{ fontSize: 13, fontFamily: MONO, wordBreak: "break-word", color: "#d2d3d4", ...masked(unmasked) }}>{w}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {active === "bitmap" && (full ? (
          <div>
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
      {full && (
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
