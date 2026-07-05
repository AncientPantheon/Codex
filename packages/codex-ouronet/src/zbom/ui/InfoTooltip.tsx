/**
 * InfoTooltip — cloned verbatim from OuronetUI `src/components/settings/InfoTooltip.tsx`.
 *
 * A styled radix ⓘ tooltip. Kept faithful (radix hover card, NOT a native
 * `title` tooltip) so the packaged ZBOM zones read pixel-identically to My
 * Codex. `@radix-ui/react-tooltip` is a package dependency for this reason.
 */
import { ReactNode } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";

interface InfoTooltipProps {
  content: ReactNode;
  size?: "sm" | "md";
}

export function InfoTooltip({ content, size = "sm" }: InfoTooltipProps) {
  const dim = size === "sm" ? "h-3.5 w-3.5 text-[9px]" : "h-4 w-4 text-[10px]";

  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger
          className={`${dim} rounded-full inline-flex items-center justify-center flex-shrink-0 font-bold leading-none select-none cursor-help`}
          style={{
            backgroundColor: "#262626",
            color: "#888",
            border: "1px solid #3a3a3a",
          }}
          aria-label="More info"
        >
          i
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="top"
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
