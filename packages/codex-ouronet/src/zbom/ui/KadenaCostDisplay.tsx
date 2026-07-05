/**
 * KadenaCostDisplay — cloned verbatim from OuronetUI
 * `src/components/settings/KadenaCostDisplay.tsx`.
 *
 * Shared STOA/Kadena cost row for CFM Zone 1.
 *
 * kadena-discount is subunitary (0.55 = user pays 55% of full price).
 * 1.0 = no discount. Display: multiply by 100, no minus sign.
 *
 * NOTE: the WSTOA.svg coin asset is served from the host app's public
 * root (`/images/coins/WSTOA.svg`) — OuronetUI ships it. Kept verbatim.
 */

import { InfoTooltip } from "./InfoTooltip.js";

interface Props {
  kadenaNeed:      number;
  kadenaFull?:     number;
  kadenaDiscount?: number;
  kadenaText?:     string;
}

export function KadenaCostDisplay({ kadenaNeed, kadenaFull, kadenaDiscount, kadenaText }: Props) {
  const isFree      = kadenaNeed === 0;
  const hasDiscount = kadenaDiscount !== undefined && kadenaDiscount > 0 && kadenaDiscount !== 1.0;
  const hasFull     = kadenaFull !== undefined && kadenaFull !== kadenaNeed && !isFree;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <img src="/images/coins/WSTOA.svg" alt="STOA" className="h-4 w-4 flex-shrink-0" />

      {/* Final price — kadena-need */}
      <span className="text-xs font-mono font-semibold" style={{ color: isFree ? "#555" : "#d2d3d4" }}>
        {isFree ? "Free" : `${kadenaNeed} STOA`}
      </span>

      {/* Original price with strikethrough — kadena-full */}
      {hasFull && (
        <span className="text-[10px] font-mono line-through" style={{ color: "#555" }}>
          {kadenaFull}
        </span>
      )}

      {/* Discount badge — subunitary value × 100, no minus */}
      {hasDiscount && !isFree && (
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
          style={{ backgroundColor: "#22c55e18", color: "#4ade80", border: "1px solid #22c55e30" }}>
          {Math.round(kadenaDiscount! * 100)}%
        </span>
      )}

      <InfoTooltip content={kadenaText || "Native STOA gas cost. 'Free' means Gas Station covers it."} />
    </div>
  );
}
