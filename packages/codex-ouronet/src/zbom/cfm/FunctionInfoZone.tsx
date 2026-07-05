/**
 * FunctionInfoZone — Zone 0 prototype for CFM gallery.
 *
 * Each instance is its own collapsible accordion (fetch on first open).
 * Body uses IgnisCostDisplay + KadenaCostDisplay — same as WrapModal / CFMPrototype.
 */

import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";
import { useUiSetting } from "./seam.js";
import { mayComeWithDeimal } from "@stoachain/stoa-core/pact";
import { IgnisCostDisplay } from "../ui/IgnisCostDisplay.js";
import { KadenaCostDisplay } from "../ui/KadenaCostDisplay.js";
import { codexClock } from "../debouncer/codexClock.js";

const GOLD = "#ceac5f";
const BD   = "#ceac5f40";
const BG   = "#ceac5f0d";

// ── helpers ───────────────────────────────────────────────────────────────────

function toNum(v: any): number {
  if (v === null || v === undefined) return 0;
  const raw = mayComeWithDeimal(v);
  return typeof raw === "number" ? raw : parseFloat(String(raw)) || 0;
}

function toLines(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

// ── Shared text-block renderers (exported for inline INFO zones) ──────────────

/** Strip trailing zeros from decimal numbers embedded in a string.
 *  e.g. "Balance: 0.90000000" → "Balance: 0.9", "10.000000" → "10.0" */
function stripTrailingZeros(s: string): string {
  return s.replace(/(\d+\.\d*?)0+(?=\s|$|[),;])/g, (_, core) => {
    // Keep at least one decimal: "10." → "10.0"
    return core.endsWith(".") ? core + "0" : core;
  });
}

/** Normalize pre-text / post-text from the chain response to a string array */
export function toInfoLines(v: string | string[] | undefined): string[] {
  if (!v) return [];
  const raw = Array.isArray(v) ? v.filter(Boolean) : [v];
  return raw.map(stripTrailingZeros);
}

/**
 * Renders pre-text lines in gold italic.
 * Single line → plain <p>; multiple lines → <ul> bullet list.
 */
export function InfoPreText({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  if (lines.length === 1) {
    return (
      <p style={{ margin: 0, fontSize: "12px", fontStyle: "italic", color: `${GOLD}bb`, lineHeight: 1.5 }}>
        {lines[0]}
      </p>
    );
  }
  return (
    <ul style={{ margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "2px" }}>
      {lines.map((line, i) => (
        <li key={i} style={{ fontSize: "12px", fontStyle: "italic", color: `${GOLD}bb`, lineHeight: 1.5 }}>{line}</li>
      ))}
    </ul>
  );
}

/**
 * Renders post-text lines with a green checkmark prefix.
 * Single line → plain span; multiple lines → <ul> bullet list.
 */
export function InfoPostText({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "6px" }}>
      <CheckCircle2 style={{ width: 14, height: 14, color: "#4ade80", flexShrink: 0, marginTop: "2px" }} />
      <div style={{ flex: 1 }}>
        {lines.length === 1 ? (
          <span style={{ fontSize: "12px", color: "#888" }}>{lines[0]}</span>
        ) : (
          <ul style={{ margin: 0, paddingLeft: "14px", display: "flex", flexDirection: "column", gap: "2px" }}>
            {lines.map((line, i) => (
              <li key={i} style={{ fontSize: "12px", color: "#888", lineHeight: 1.5 }}>{line}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── FunctionInfoZone ─────────────────────────────────────────────────────────

export interface FunctionInfoZoneProps {
  label:     string;
  pactCall?: string;
  fetcher:   () => Promise<any | null>;
  /** readRegistry id — when set, this INFO read reports into the codexClock monitor. */
  readId?:   string;
}

export function FunctionInfoZone({ label, pactCall, fetcher, readId }: FunctionInfoZoneProps) {
  const defaultOpen = useUiSetting("infoZoneOpen", true);
  const [open, setOpen]     = useState(defaultOpen);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData]     = useState<any>(null);

  // Fetch on first open
  useEffect(() => {
    if (!open || loaded) return;
    setLoading(true);
    (readId ? codexClock.report(readId, undefined, fetcher) : fetcher())
      .then(setData)
      .finally(() => { setLoading(false); setLoaded(true); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const preLines  = toLines(data?.["pre-text"]);
  const postLines = toLines(data?.["post-text"]);

  const ignisNeed     = toNum(data?.ignis?.["ignis-need"]);
  const ignisFull     = toNum(data?.ignis?.["ignis-full"]);
  const ignisDiscount = toNum(data?.ignis?.["ignis-discount"]);
  const ignisText     = data?.ignis?.["ignis-text"] as string | undefined;

  const kadenaNeed     = toNum(data?.kadena?.["kadena-need"]);
  const kadenaFull     = toNum(data?.kadena?.["kadena-full"]);
  const kadenaDiscount = toNum(data?.kadena?.["kadena-discount"]);
  const kadenaText     = data?.kadena?.["kadena-text"] as string | undefined;

  return (
    <div style={{ borderRadius: "10px", border: `1px solid ${BD}`, backgroundColor: BG, overflow: "hidden" }}>

      {/* Accordion header */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: "8px",
          padding: "9px 12px", background: "transparent", border: "none",
          borderBottom: open ? `1px solid ${BD}` : "none",
          cursor: "pointer", textAlign: "left",
        }}
      >
        {open
          ? <ChevronDown  style={{ width: 13, height: 13, color: "#555", flexShrink: 0 }} />
          : <ChevronRight style={{ width: 13, height: 13, color: "#555", flexShrink: 0 }} />}
        <span style={{ fontSize: "9px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.08em", color: GOLD, flexShrink: 0 }}>INFO</span>
        <ChevronRight style={{ width: 10, height: 10, color: "#333", flexShrink: 0 }} />
        <span style={{ fontSize: "11px", fontWeight: "600", color: "#d2d3d4", fontFamily: "monospace" }}>{label}</span>
        {!open && loaded && data && (
          <span style={{ marginLeft: "auto", fontSize: "10px", color: "#4ade80", display: "flex", alignItems: "center", gap: "3px", flexShrink: 0 }}>
            <CheckCircle2 style={{ width: 11, height: 11 }} /> loaded
          </span>
        )}
        {!open && loading && (
          <span style={{ marginLeft: "auto" }}>
            <Loader2 style={{ width: 12, height: 12, color: "#555", animation: "spin 1s linear infinite" }} />
          </span>
        )}
      </button>

      {/* Body */}
      {open && (
        <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: "10px" }}>

          {pactCall && (
            <code style={{ fontSize: "9px", fontFamily: "monospace", color: "#444", wordBreak: "break-all" }}>{pactCall}</code>
          )}

          {loading && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#555" }}>
              <Loader2 style={{ width: 13, height: 13, animation: "spin 1s linear infinite" }} />
              <span style={{ fontSize: "11px" }}>Fetching from chain…</span>
            </div>
          )}

          {loaded && !data && (
            <span style={{ fontSize: "11px", color: "#555", fontStyle: "italic" }}>
              No data returned — chain may have rejected the call.
            </span>
          )}

          {loaded && data && (
            <>
              {/* Pre-text */}
              <InfoPreText lines={preLines} />

              {/* IGNIS + STOA costs — single line when both present */}
              {data?.ignis !== undefined && data?.kadena !== undefined ? (
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <IgnisCostDisplay
                    ignisNeed={ignisNeed}
                    ignisFull={ignisFull}
                    ignisDiscount={ignisDiscount}
                    ignisText={ignisText}
                  />
                  <KadenaCostDisplay
                    kadenaNeed={kadenaNeed}
                    kadenaFull={kadenaFull}
                    kadenaDiscount={kadenaDiscount}
                    kadenaText={kadenaText}
                  />
                </div>
              ) : (
                <>
                  {data?.ignis !== undefined && (
                    <IgnisCostDisplay
                      ignisNeed={ignisNeed}
                      ignisFull={ignisFull}
                      ignisDiscount={ignisDiscount}
                      ignisText={ignisText}
                    />
                  )}
                  {data?.kadena !== undefined && (
                    <KadenaCostDisplay
                      kadenaNeed={kadenaNeed}
                      kadenaFull={kadenaFull}
                      kadenaDiscount={kadenaDiscount}
                      kadenaText={kadenaText}
                    />
                  )}
                </>
              )}

              {/* Post-text */}
              <InfoPostText lines={postLines} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
