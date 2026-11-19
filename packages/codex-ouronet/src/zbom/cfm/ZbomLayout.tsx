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
import { PAPYRUS_COPY, PAPYRUS_VERSION, type PapyrusKind } from "@ouronet/papyrus";
import { useUiSetting } from "./seam.js";
import { InfoTooltip } from "../ui/InfoTooltip.js";
import { CfmScrollArea } from "../ui/CfmScrollArea.js";
import { ZbomDebouncer } from "../debouncer/ZbomDebouncer.js";
import type { PactQueryTier } from "../debouncer/pactQueryTiers.js";

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
}

interface ZbomLayoutProps {
  /**
   * WHICH MEMBER of the Papyrus family this instance is.
   *
   * REQUIRED, deliberately, per `PAPYRUS_ENGINE_SPEC.md` §2.4: a default
   * would be silently wrong for whichever member it is not, and a badge
   * naming the wrong form is worse than no badge at all.
   *
   * Everything this layout draws today is a `"page"` — a discrete sheet
   * presented for signing, inside a `ZbomModalFrame`. The prop is still
   * taken rather than hardcoded because the caller is what knows: the
   * moment Codex grows an inline (Roll) or read-discovery (Leaf) instrument,
   * the type forces the question instead of letting it default to a lie.
   */
  kind: PapyrusKind;
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


/**
 * THE PAPYRUS DESIGNATION — member upper-LEFT, engine version upper-RIGHT.
 *
 * Owner, 2026-10-28: *"Upper left corner the papyrus type, upper right corner
 * papyrus package version."* Mirrors OuronetUI's own
 * `src/lib/papyrus/PapyrusBadge.tsx`, so the same instrument designates
 * itself identically in both apps.
 *
 * AT THE TOP, NOT THE FOOT. The badge answers *"which instrument am I looking
 * at?"*, and a reader asks that on arrival — so it belongs where the eye
 * lands, not below the execute button where it would be read, if at all,
 * after the decision is already made.
 *
 * OPPOSITE CORNERS, NOT CLUSTERED. The two facts answer different questions
 * and change on different clocks: the MEMBER is a property of this screen and
 * never changes; the VERSION belongs to the engine drawing it and changes on
 * release. Splitting them stops the pair reading as one compound label.
 *
 * The version is the PACKAGE's — `@ouronet/papyrus`, imported, never
 * `APP_VERSION` and never a local copy. Once Codex consumes Papyrus, Codex and
 * OuronetUI show the SAME engine version and DIFFERENT app versions, and that
 * pair is exactly what a bug report needs. `tests/papyrus-designation.test.ts`
 * holds that rule over comment-stripped source.
 */
function PapyrusBadge({ kind }: { kind: PapyrusKind }) {
  const { label, blurb } = PAPYRUS_COPY[kind];
  return (
    <div
      data-testid="papyrus-badge"
      className="flex items-center justify-between gap-2 pb-1.5 flex-shrink-0 text-[9px] select-none"
      style={{ color: "#4a4a4a" }}
    >
      {/* ── Upper LEFT: which member this is. */}
      <span className="flex items-center gap-1 min-w-0">
        <span
          data-testid="papyrus-badge-member"
          className="uppercase tracking-[0.08em] truncate"
          style={{ color: "#6a6a6a" }}
        >
          {label}
        </span>
        <InfoTooltip content={`${label} — ${blurb}`} />
      </span>
      {/* ── Upper RIGHT: which engine drew it. */}
      <span data-testid="papyrus-badge-version" className="font-mono flex-shrink-0">
        v{PAPYRUS_VERSION}
      </span>
    </div>
  );
}

/** Edge-to-edge separator line */
function EdgeLine() {
  return <div style={{ marginLeft: "-24px", marginRight: "-24px", borderBottom: "1px solid #1a1a1a" }} />;
}

/**
 * Execute button zone (wrapper + button). NEVER wraps the button in a hover
 * tooltip — owner ruling: inside an open ZBOM the information is already on
 * the page (Zone 2 lists every parameter with its declared type, the INFO
 * panel shows the live cost), so a tooltip here is a duplicate that occludes
 * the thing it duplicates. The pre-open verification lives on the LAUNCHER
 * (`PreZbomHint`, `zbom/cfm/PreZbomHint.tsx`), never here — see
 * `tests/zbom-execute-button-no-tooltip.test.ts` for the guard against this
 * regressing (a real regression once shipped: a hover card, meant only for
 * pre-open verification, drew directly over this button, occluding the
 * modal it was hovering).
 */
function ExecuteZone({ btn }: { btn: ZbomExecuteButtonProps }) {
  const defaultProcessing = (
    <><span className="inline-block h-4 w-4 mr-2 animate-spin rounded-full border-2 border-current border-t-transparent" />Processing…</>
  );

  return (
    <div className="py-1.5 flex-shrink-0">
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
    </div>
  );
}

const DEFAULT_ZBOM_TIERS: PactQueryTier[] = ['T1', 'T2', 'T3'];

export function ZbomLayout({ kind, header, executeButton, children, headerExtra, activeTiers }: ZbomLayoutProps) {
  const zbomExecutePosition = useUiSetting<string>("zbomExecutePosition", "top");

  return (
    <div className="flex flex-col" style={{ maxHeight: "82vh", marginBottom: "-18px" }}>

      {/* ══ Papyrus designation — FIRST, before the form ══ */}
      <PapyrusBadge kind={kind} />

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
