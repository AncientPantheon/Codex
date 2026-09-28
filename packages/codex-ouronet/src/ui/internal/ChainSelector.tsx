/**
 * <ChainSelector> — a numbered chain-picker button grid, shared between
 * StoaChain's (10 chains) and Kadena's (20 chains) crosschain-transfer UI.
 * Inspired by OuronetUI's own inline `ChainSelector` component in
 * `CrossChainTransfer.tsx` (a button grid, source/target selectors mutually
 * excluding each other's current value via `disabledChain`) — same
 * interaction model, not a byte-for-byte shared component: this one has
 * already cosmetically diverged (button sizing, no "Chain N selected"
 * label), so treat the two as independently-styled siblings, not one
 * canonical shape.
 */
import * as React from "react";
import { modalLabel } from "./CodexModalShell.js";

export interface ChainSelectorProps {
  label: string;
  value: string;
  onChange: (chainId: string) => void;
  /** The OTHER selector's current value — disabled here so source and
   *  target can never collide. Omitted when there's nothing to exclude. */
  disabledChain?: string;
  /** 10 for StoaChain (0-9, the default), 20 for Kadena mainnet (0-19). */
  chainCount?: number;
}

export function ChainSelector({
  label,
  value,
  onChange,
  disabledChain,
  chainCount = 10,
}: ChainSelectorProps): React.JSX.Element {
  return (
    <div>
      <label style={modalLabel}>{label}</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {Array.from({ length: chainCount }, (_, i) => String(i)).map((chainId) => {
          const isSelected = value === chainId;
          const isDisabled = disabledChain === chainId;
          return (
            <button
              key={chainId}
              type="button"
              disabled={isDisabled}
              aria-pressed={isSelected}
              onClick={() => {
                // Re-clicking the already-selected chain is a genuine no-op
                // — without this guard, callers that react to `onChange` by
                // moving OTHER state (e.g. `SendStoaModal`'s target-chain
                // collision-avoidance) would fire on a value that never
                // actually changed.
                if (!isDisabled && chainId !== value) onChange(chainId);
              }}
              style={{
                width: 30,
                height: 30,
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                cursor: isDisabled ? "not-allowed" : "pointer",
                border: isSelected ? "2px solid #ceac5f" : "1px solid #262626",
                backgroundColor: isSelected ? "#ceac5f" : isDisabled ? "#141414" : "#0a0a0a",
                color: isSelected ? "#0a0a0a" : isDisabled ? "#444" : "#d2d3d4",
              }}
            >
              {chainId}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default ChainSelector;
