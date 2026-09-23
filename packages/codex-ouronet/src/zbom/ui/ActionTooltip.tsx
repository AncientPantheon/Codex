/**
 * ActionTooltip — wraps a single action button (e.g. StoaAccountsTab's merged
 * Send/Transfer, Stake, Unstake, and Collect buttons) in a Radix tooltip
 * using `InfoTooltip.tsx`'s EXACT visual styling (colors/border/shadow/
 * arrow), but with the action button ITSELF as the trigger (`asChild`), not
 * a separate "ⓘ" icon — a row full of icon buttons doesn't have room for one
 * info-icon per action.
 *
 * Extracted from `StoaAccountsTab.tsx` (where it was a private, unexported
 * helper) into this shared location so every package that needs an
 * explanatory hover on a button reuses the SAME bounded-width, dark-card
 * Radix tooltip — never the browser's native `title=` bubble, which can't be
 * styled, can't wrap into a compact block (`max-w`), and renders after a
 * slow, inconsistent OS-level delay. `codex-arweave`'s Send AR Max/Super Max
 * buttons are the first consumer outside `codex-ouronet` itself.
 */
import * as React from "react";
import * as Tooltip from "@radix-ui/react-tooltip";

export interface ActionTooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  /** Which side of the trigger the tooltip opens on. Defaults to `"top"`. */
  side?: "top" | "bottom" | "left" | "right";
}

export function ActionTooltip({ content, children, side = "top" }: ActionTooltipProps) {
  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side={side}
            sideOffset={5}
            className="max-w-[220px] text-[11px] leading-relaxed px-3 py-2 rounded-lg shadow-xl"
            style={{
              backgroundColor: "#1a1a1a",
              color: "#d2d3d4",
              border: "1px solid #3a3a3a",
              zIndex: 99999,
            }}
          >
            {content}
            <Tooltip.Arrow style={{ fill: "#1a1a1a" }} />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

export default ActionTooltip;
