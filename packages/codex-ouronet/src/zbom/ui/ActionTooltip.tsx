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
 *
 * `unstyled` (added for `PreZbomHint`'s data-preview card): skips the
 * built-in `max-w-[220px]` dark-card box/background/arrow entirely, so the
 * caller's own `content` supplies its COMPLETE visual box instead of being
 * nested inside this component's own (much narrower, differently-colored)
 * default box. Without this, a wider caller card visibly overflows — bulges
 * out of — the default 220px-capped box around it (a real, live-reported
 * bug). Defaults to `false`: every existing caller (StoaAccountsTab,
 * codex-arweave) keeps today's compact-explanatory-tooltip look unchanged.
 */
import * as React from "react";
import * as Tooltip from "@radix-ui/react-tooltip";

export interface ActionTooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  /** Which side of the trigger the tooltip opens on. Defaults to `"top"`. */
  side?: "top" | "bottom" | "left" | "right";
  /** Skip the built-in max-width/background/border/arrow — the caller's own
   *  `content` supplies its complete box. Default `false`. */
  unstyled?: boolean;
}

export function ActionTooltip({ content, children, side = "top", unstyled = false }: ActionTooltipProps) {
  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side={side}
            sideOffset={5}
            className={unstyled ? undefined : "max-w-[220px] text-[11px] leading-relaxed px-3 py-2 rounded-lg shadow-xl"}
            style={
              unstyled
                ? { zIndex: 99999 }
                : {
                    backgroundColor: "#1a1a1a",
                    color: "#d2d3d4",
                    border: "1px solid #3a3a3a",
                    zIndex: 99999,
                  }
            }
          >
            {content}
            {!unstyled && <Tooltip.Arrow style={{ fill: "#1a1a1a" }} />}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

export default ActionTooltip;
