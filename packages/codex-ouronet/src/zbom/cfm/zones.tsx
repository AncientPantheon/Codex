/**
 * CFM Zone Components — shared across all CFM modals
 *
 * ZONE: color tokens for each zone (info/patron/inputs/signing)
 * ZoneHeader: labeled section header with tooltip
 * SignerRow: single guard display in Signing tab
 * CapRow: single capability display in CAPS tab
 */

import { CheckCircle2, AlertTriangle } from "lucide-react";
import { InfoTooltip } from "../ui/InfoTooltip.js";

// ── Zone color tokens ─────────────────────────────────────────────────────────
export const ZONE = {
  info:    { bg: "#ceac5f0d", border: "#ceac5f50", label: "#ceac5f" },
  patron:  { bg: "#8888880d", border: "#88888850", label: "#aaaaaa" },
  inputs:  { bg: "#cd7f320d", border: "#cd7f3250", label: "#cd7f32" },
  signing: { bg: "#22c55e0d", border: "#22c55e50", label: "#4ade80" },
} as const;

// ── ZoneHeader ────────────────────────────────────────────────────────────────
export function ZoneHeader({
  label,
  tooltip,
  color,
}: {
  label: string;
  tooltip: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color }}>
        {label}
      </span>
      <InfoTooltip content={tooltip} />
    </div>
  );
}

// ── SignerRow ─────────────────────────────────────────────────────────────────
export function SignerRow({
  label,
  pred,
  found,
  total,
  threshold,
  ready,
  keys,
}: {
  label: string;
  pred: string;
  found: number;
  total: number;
  threshold: number;
  ready: boolean;
  keys: string[];
}) {
  return (
    <div
      className="rounded-lg border space-y-1.5 p-2"
      style={{ backgroundColor: "#0a0a0a", borderColor: ready ? "#22c55e30" : "#8b1a1a30" }}
    >
      <div className="flex items-center gap-2">
        {ready
          ? <CheckCircle2 className="h-4 w-4 flex-shrink-0" style={{ color: "#4ade80" }} />
          : <AlertTriangle className="h-4 w-4 flex-shrink-0" style={{ color: "#c0392b" }} />}
        <span className="text-xs flex-1" style={{ color: "#d2d3d4" }}>{label}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full"
          style={{ backgroundColor: "#262626", color: "#ceac5f" }}>
          {pred}
        </span>
        <span className="text-[10px] font-mono"
          style={{ color: ready ? "#4ade80" : "#c0392b" }}>
          {found}/{threshold} needed ({total} total)
        </span>
      </div>
      {keys.map((k, i) => (
        <code key={i} className="block text-[10px] font-mono truncate pl-6" style={{ color: "#555" }}>
          {k.slice(0, 16)}…{k.slice(-8)}
        </code>
      ))}
    </div>
  );
}

// ── CapRow ────────────────────────────────────────────────────────────────────
export function CapRow({
  capability,
  params,
  signer,
  signerKey,
  description,
}: {
  capability: string;
  params: string[];
  signer: string;
  signerKey: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border p-2.5 space-y-1.5"
      style={{ backgroundColor: "#0a0a0a", borderColor: "#22c55e25" }}>
      <div className="flex items-start justify-between gap-2">
        <code className="text-[10px] font-mono font-bold break-all" style={{ color: "#4ade80" }}>
          {capability}
        </code>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 whitespace-nowrap"
          style={{ backgroundColor: "#262626", color: "#888" }}>
          {signer}
        </span>
      </div>
      {params.length > 0 && (
        <div className="pl-2 border-l" style={{ borderColor: "#22c55e30" }}>
          <span className="text-[9px] uppercase tracking-wider font-bold mr-1" style={{ color: "#555" }}>params:</span>
          <code className="text-[10px] font-mono" style={{ color: "#888" }}>({params.join(", ")})</code>
        </div>
      )}
      <div className="pl-2 border-l" style={{ borderColor: "#22c55e30" }}>
        <span className="text-[9px] uppercase tracking-wider font-bold mr-1" style={{ color: "#555" }}>signed by:</span>
        <code className="text-[10px] font-mono" style={{ color: "#555" }}>
          {signerKey ? `${signerKey.slice(0, 16)}…${signerKey.slice(-8)}` : "—"}
        </code>
      </div>
      <p className="text-[10px]" style={{ color: "#555" }}>{description}</p>
    </div>
  );
}
