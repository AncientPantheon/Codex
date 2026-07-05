/**
 * IgnisCostDisplay — cloned verbatim from OuronetUI
 * `src/components/settings/IgnisCostDisplay.tsx`.
 *
 * Shared IGNIS cost row for CFM Zone 1.
 *
 * ignisNeed === 0  → shows "Free" (dimmed), same pattern as KadenaCostDisplay.
 * ignis-discount is subunitary (0.55 = user pays 55% of full price).
 * 1.0 = no discount. Display: multiply by 100, no minus sign.
 */

import { Flame } from "lucide-react";
import { InfoTooltip } from "./InfoTooltip.js";

interface Props {
  ignisNeed:      number;
  ignisFull?:     number;
  ignisDiscount?: number;
  ignisText?:     string;
}

export function IgnisCostDisplay({ ignisNeed, ignisFull, ignisDiscount, ignisText }: Props) {
  const isFree      = ignisNeed === 0;
  const hasDiscount = !isFree && ignisDiscount !== undefined && ignisDiscount > 0 && ignisDiscount !== 1.0;
  const hasFull     = !isFree && ignisFull !== undefined && ignisFull !== ignisNeed;

  const defaultTooltip = isFree
    ? "Operation is free of IGNIS gas."
    : "IGNIS cost for this operation, paid by the patron.";

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Flame className="h-4 w-4 flex-shrink-0" style={{ color: "#f59e0b" }} />

      {/* Final price — 0 → "Free" */}
      <span className="text-xs font-mono font-semibold" style={{ color: isFree ? "#555" : "#d2d3d4" }}>
        {isFree ? "Free" : `${ignisNeed} IGNIS`}
      </span>

      {/* Original price with strikethrough — ignis-full */}
      {hasFull && (
        <span className="text-[10px] font-mono line-through" style={{ color: "#555" }}>
          {ignisFull}
        </span>
      )}

      {/* Discount badge — subunitary value × 100, no minus */}
      {hasDiscount && (
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
          style={{ backgroundColor: "#22c55e18", color: "#4ade80", border: "1px solid #22c55e30" }}>
          {Math.round(ignisDiscount! * 100)}%
        </span>
      )}

      <InfoTooltip content={ignisText || defaultTooltip} />
    </div>
  );
}
