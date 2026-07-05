import { cn } from "./cn.js";
import type { ReactNode } from "react";

interface CfmScrollAreaProps {
  children: ReactNode;
  className?: string;
}

/**
 * Scroll container for CFM modals.
 *
 * - flex:1 + min-height:0 → fills remaining flex space, can shrink
 * - overflow-y:auto → scrolls when content overflows
 * - overscroll-behavior:contain → scroll stops here, never bubbles to background
 * - marginRight:-12px → extends 12px into dialog's 24px right padding
 * - paddingRight:12px → content width stays identical to siblings (header, execute button)
 *
 * Result: scrollbar sits in the extra 12px space (centered in right margin).
 * Content width is NEVER affected by scrollbar presence — zones always
 * match the execute button width regardless of whether scrollbar is visible.
 */
export function CfmScrollArea({ children, className }: CfmScrollAreaProps) {
  return (
    <div
      className={cn("cfm-scroll", className)}
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        overscrollBehavior: "contain",
        marginRight: "-12px",
        paddingRight: "12px",
      }}
    >
      {children}
    </div>
  );
}
