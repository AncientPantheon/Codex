/**
 * ZbomLayout — Centralized ZBOM/CFM modal layout.
 *
 * Single source of truth for:
 * - Execute button positioning (top/bottom from settings)
 * - Edge-to-edge separator lines
 * - Button sizing & spacing (py-2 button, py-1.5 wrapper)
 * - CfmScrollArea with py-3 gap
 * - marginBottom:-18px dialog padding compensation
 * - Invisible scrollbar (cross-browser consistent)
 *
 * Usage:
 * ```tsx
 * <ZbomLayout
 *   header={<>
 *     <h2 className="text-sm font-bold" style={{ color: "#d2d3d4" }}>Coil</h2>
 *     <p className="text-[10px]" style={{ color: "#555" }}>ouronet-ns.TS01-C2.ATS|C_Coil</p>
 *   </>}
 *   executeButton={{
 *     canExecute,
 *     isProcessing,
 *     onClick: handleExecute,
 *     bgColor: insufficientIgnis ? "#8b1a1a" : canExecute ? "#ceac5f" : "#1a1a1a",
 *     textColor: insufficientIgnis ? "#fff" : canExecute ? "#0a0a0a" : "#444",
 *     content: insufficientIgnis
 *       ? "Insufficient IGNIS"
 *       : <><ArrowRight className="inline h-4 w-4 mr-1.5 align-text-bottom" />Coil</>,
 *     processingContent: <><Loader2 className="inline h-4 w-4 mr-2 animate-spin" />Processing…</>,
 *   }}
 * >
 *   Zone 0, Zone 1, Zone 2, Zone 3 — just the content
 * </ZbomLayout>
 * ```
 *
 * Verified pattern from Sublimate ZBOM (v0.16.6h) — approved by Bytales.
 */

import type { ReactNode } from "react";
import { useUiSetting } from "./seam.js";
import { CfmScrollArea } from "../ui/CfmScrollArea.js";
import { ZbomDebouncer } from "../debouncer/ZbomDebouncer.js";
import type { PactQueryTier } from "../debouncer/pactQueryTiers.js";
import ExecutionTooltip, { type ExecutionSpec } from "./ExecutionTooltip.js";

export interface ZbomExecuteButtonProps {
  canExecute: boolean;
  isProcessing: boolean;
  onClick: () => void;
  /** Active background color (e.g. "#ceac5f" gold, "#f97316" orange) */
  bgColor: string;
  /** Active text color */
  textColor: string;
  /** Button content when NOT processing (icon + label) */
  content: ReactNode;
  /** Button content when processing (spinner + text) */
  processingContent?: ReactNode;
  /**
   * Optional — when provided, hovering the button (desktop only) shows
   * `ExecutionTooltip`'s live verification card: the execution function +
   * parameter list from the contract, the actual argument VALUES this
   * click would send (positionally aligned — the one class no static check
   * catches, two same-typed args swapped), and the live INFO preview. Pass
   * the SAME args the real execute call will use, computed fresh on every
   * render (not memoized to stale state) so hovering right before a click
   * shows exactly what that click will send.
   */
  executionSpec?: ExecutionSpec;
}

interface ZbomLayoutProps {
  /** Header content (title, subtitle, tooltip — NO wrapper div needed) */
  header: ReactNode;
  /** Execute button configuration */
  executeButton: ZbomExecuteButtonProps;
  /** Zone content (Zone 0, 1, 2, 3, SigningZone etc.) */
  children: ReactNode;
  /** Extra content between header and execute zone (e.g. mode tabs in UncoilAuryn) */
  headerExtra?: ReactNode;
  /** Active debounce tiers for this ZBOM (defaults to T2+T3 if not specified) */
  activeTiers?: PactQueryTier[];
}

/** Edge-to-edge separator line */
function EdgeLine() {
  return <div style={{ marginLeft: "-24px", marginRight: "-24px", borderBottom: "1px solid #1a1a1a" }} />;
}

/** Execute button zone (wrapper + button) */
function ExecuteZone({ btn }: { btn: ZbomExecuteButtonProps }) {
  const defaultProcessing = (
    <><span className="inline-block h-4 w-4 mr-2 animate-spin rounded-full border-2 border-current border-t-transparent" />Processing…</>
  );

  const button = (
    <button
      type="button"
      className="w-full py-2 px-4 rounded-lg text-sm font-bold transition-colors btn-aura-tx"
      style={{
        backgroundColor: btn.bgColor,
        color: btn.textColor,
        cursor: btn.canExecute ? "pointer" : "not-allowed",
      }}
      onClick={btn.canExecute ? btn.onClick : undefined}
      disabled={!btn.canExecute || btn.isProcessing}
    >
      {btn.isProcessing
        ? (btn.processingContent ?? defaultProcessing)
        : btn.content}
    </button>
  );

  return (
    <div className="py-1.5 flex-shrink-0">
      {btn.executionSpec ? (
        <ExecutionTooltip spec={btn.executionSpec}>{button}</ExecutionTooltip>
      ) : button}
    </div>
  );
}

const DEFAULT_ZBOM_TIERS: PactQueryTier[] = ['T1', 'T2', 'T3'];

export function ZbomLayout({ header, executeButton, children, headerExtra, activeTiers }: ZbomLayoutProps) {
  const zbomExecutePosition = useUiSetting<string>("zbomExecutePosition", "top");

  return (
    <div className="flex flex-col" style={{ maxHeight: "82vh", marginBottom: "-18px" }}>

      {/* ══ ZBOM Debouncer ══ */}
      <div className="flex justify-center pb-2 flex-shrink-0">
        <ZbomDebouncer activeTiers={activeTiers ?? DEFAULT_ZBOM_TIERS} />
      </div>

      {/* ══ Header ══ */}
      <div className="flex items-center justify-between pb-3 flex-shrink-0">
        <div>{header}</div>
      </div>

      {/* ══ Header extra (e.g. mode tabs) ══ */}
      {headerExtra}

      {/* ══ Execute button (top) ══ */}
      {zbomExecutePosition === "top" && (
        <>
          <EdgeLine />
          <ExecuteZone btn={executeButton} />
          <EdgeLine />
        </>
      )}

      {/* ══ Scrollable zones ══ */}
      <CfmScrollArea className="py-3 space-y-3">
        {children}
      </CfmScrollArea>

      {/* ══ Execute button (bottom) ══ */}
      {zbomExecutePosition === "bottom" && (
        <>
          <EdgeLine />
          <ExecuteZone btn={executeButton} />
        </>
      )}
    </div>
  );
}
