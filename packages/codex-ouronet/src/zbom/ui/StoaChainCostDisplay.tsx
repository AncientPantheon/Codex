/**
 * StoaChainCostDisplay — cloned verbatim from OuronetUI
 * `src/components/settings/StoaChainCostDisplay.tsx`.
 *
 * Shared STOA/StoaChain cost row for CFM Zone 1.
 *
 * kadena-discount is subunitary (0.55 = user pays 55% of full price).
 * 1.0 = no discount. Display: multiply by 100, no minus sign.
 *
 * The STOA mark is the gold ❖ glyph (OuronetUI's canonical Stoa glyph,
 * `#ceac5f`) rendered as inline text — NOT an <img>. An earlier version pointed
 * at `/images/coins/WSTOA.svg` from the host app's public root, which broke
 * (missing image) in any consumer that doesn't ship that asset (e.g. Mnemosyne
 * consuming the bundled `@ancientpantheon/codex`). The glyph is self-contained
 * in the bundle and renders identically everywhere.
 */

import { InfoTooltip } from "./InfoTooltip.js";

interface Props {
  stoaChainNeed:      number;
  stoaChainFull?:     number;
  stoaChainDiscount?: number;
  stoaChainText?:     string;
}

export function StoaChainCostDisplay({ stoaChainNeed, stoaChainFull, stoaChainDiscount, stoaChainText }: Props) {
  const isFree      = stoaChainNeed === 0;
  const hasDiscount = stoaChainDiscount !== undefined && stoaChainDiscount > 0 && stoaChainDiscount !== 1.0;
  const hasFull     = stoaChainFull !== undefined && stoaChainFull !== stoaChainNeed && !isFree;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span aria-label="STOA" title="STOA" className="flex-shrink-0"
        style={{ color: "#ceac5f", fontWeight: 700, lineHeight: 1, fontSize: "1rem" }}>❖</span>

      {/* Final price — kadena-need */}
      <span className="text-xs font-mono font-semibold" style={{ color: isFree ? "#555" : "#d2d3d4" }}>
        {isFree ? "Free" : `${stoaChainNeed} STOA`}
      </span>

      {/* Original price with strikethrough — kadena-full */}
      {hasFull && (
        <span className="text-[10px] font-mono line-through" style={{ color: "#555" }}>
          {stoaChainFull}
        </span>
      )}

      {/* Discount badge — subunitary value × 100, no minus */}
      {hasDiscount && !isFree && (
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
          style={{ backgroundColor: "#22c55e18", color: "#4ade80", border: "1px solid #22c55e30" }}>
          {Math.round(stoaChainDiscount! * 100)}%
        </span>
      )}

      <InfoTooltip content={stoaChainText || "Native STOA gas cost. 'Free' means Gas Station covers it."} />
    </div>
  );
}
