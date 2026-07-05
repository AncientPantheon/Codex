/**
 * Zone2Wrapper — collapsible wrapper for Zone 2 (Function Inputs) in CFM modals.
 *
 * Reads zbomZone2 from settings.
 * When collapsed:
 *   - Children wrapped in [data-autonomous="true"] are hidden via CSS
 *   - Children wrapped in [data-autonomous="false"] (free/user-input) stay visible
 *   - If ALL children are autonomous → zone collapses completely
 * When expanded: all children visible.
 *
 * `functionName` carries the canonical Pact-function annotation (the
 * inventory anchor — see src/constants/functionAnnotation.ts). The full
 * grammar is `namespace.CONTRACTMODULE.DESIGNATOR|fn` for Ouronet calls and
 * `namespace.MODULE|fn` (or `namespace.fn`) for Stoa-native calls. The
 * sibling `functionMeta` prop (also defined in functionAnnotation.ts) carries
 * the human-readable display payload the generator stamps into the inventory.
 *
 * Usage:
 * <Zone2Wrapper
 *   functionName="ouronet-ns.TS01-C2.ATS|C_Coil"
 *   functionMeta={{
 *     locations: ["Dashboard → OURO asset → Coil button"],
 *     name: "Coil (OURO)",
 *     description: "Coils OURO into the Auryndex autostake pool…",
 *     icon: "flame",
 *     addedInVersion: "0.6.2aw",
 *     addedDate: "2026-03-11",
 *   }}
 * >
 *   <div data-autonomous="true"><StringEntryInput variant="autonomous" .../></div>
 *   <div data-autonomous="false"><ResidentSpendOURO variant="free" .../></div>
 * </Zone2Wrapper>
 *
 * OR with collapsedContent prop (legacy pattern):
 * <Zone2Wrapper functionName="ouronet-ns.TS01-C2.ATS|C_Coil" collapsedContent={<FreeField />}>
 *   ...all fields...
 * </Zone2Wrapper>
 */

import { useState, useEffect, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useUiSetting } from "./seam.js";
import type { FunctionMetaProp } from "./functionAnnotation.js";

const COLOR = "#cd7f32";
const BD = "#cd7f3270";
const BG = "#cd7f320d";

interface Zone2WrapperProps {
  functionName?: string;
  /**
   * Companion display payload for the inventory generator. Single-function
   * surfaces pass an object literal; multi-function surfaces pass an array
   * of records (each carrying its own `functionName`). Read at compile time
   * by the T2.4 generator's source-text scan; never read at runtime.
   */
  functionMeta?: FunctionMetaProp;
  /**
   * Required rationale string when `functionName` is the inventory exclusion
   * sentinel. Read by the Phase 4 drift guard's text scan.
   */
  functionMetaExclusionRationale?: string;
  children: ReactNode;
  collapsedContent?: ReactNode;
}

// `functionMeta` and `functionMetaExclusionRationale` are intentionally NOT
// destructured into the function body — they are static-text annotations
// consumed by the inventory generator at build/scan time, with no runtime
// behavior on the rendered component.
export function Zone2Wrapper({ functionName, children, collapsedContent }: Zone2WrapperProps) {
  const defaultOpen = useUiSetting("zbomZone2", false);
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => { setOpen(defaultOpen); }, [defaultOpen]);

  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    // overflow: visible so popovers from descendants (e.g. AddressBookPicker
    // dropdown rendered inside StringEntryInput) aren't clipped by this wrapper.
    // borderRadius is still applied to the outer div + the inner header has
    // matching borderTopRadius via the parent's border, so visually rounded
    // corners are preserved without the hidden overflow.
    <div style={{ borderRadius: "10px", border: `1px solid ${BD}`, backgroundColor: BG }}>
      <button
        type="button"
        onClick={() => setOpen((v: boolean) => !v)}
        className="w-full flex items-center gap-1.5 text-left"
        style={{ background: "transparent", border: "none", cursor: "pointer", padding: "7px 10px", borderBottom: open ? `1px solid ${BD}` : "none", borderRadius: "10px 10px 0 0" }}
      >
        <Chevron style={{ width: 13, height: 13, color: "#555", flexShrink: 0 }} />
        <span style={{ fontSize: "10px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.08em", color: COLOR }}>
          Zone 2 — INPUTS
        </span>
        {functionName && (
          <span style={{ fontSize: "9px", fontFamily: "'Courier New','Lucida Console',monospace", color: `${COLOR}80` }}>
            ({functionName})
          </span>
        )}
      </button>

      {open ? (
        /* Expanded: show everything */
        <div style={{ padding: "8px 12px 10px", display: "flex", flexDirection: "column", gap: "8px" }}>
          {children}
        </div>
      ) : collapsedContent ? (
        /* Collapsed with explicit collapsedContent: show only that */
        <div style={{ padding: "8px 12px 10px", borderTop: `1px solid ${BD}`, display: "flex", flexDirection: "column", gap: "8px", opacity: 0.9 }}>
          {collapsedContent}
        </div>
      ) : null}
    </div>
  );
}
