/**
 * StoaChainBrand — cloned verbatim from OuronetUI
 * `src/components/ui/StoaChainBrand.tsx`.
 *
 * Branded "StoaChain™" text — always gold + bold. Use everywhere "StoaChain"
 * appears in visible ZBOM UI text.
 */
import type * as React from "react";

export function StoaChainBrand({ className }: { className?: string }) {
  return (
    <span
      className={`font-bold${className ? ` ${className}` : ""}`}
      style={{ color: "#ceac5f" }}
    >
      StoaChain™
    </span>
  );
}

/**
 * Replaces all occurrences of "StoaChain™", "StoaChain", "Stoa Chain™" or "Stoa Chain"
 * in a plain string with the branded <StoaChainBrand /> component.
 */
export function renderBranded(text: string): React.ReactNode {
  const parts = text.split(/(StoaChain™|StoaChain|Stoa Chain™|Stoa Chain)/g);
  return parts.map((part, i) =>
    part === "StoaChain™" || part === "StoaChain" ||
    part === "Stoa Chain™" || part === "Stoa Chain" ? (
      <StoaChainBrand key={i} />
    ) : (
      part
    )
  );
}
