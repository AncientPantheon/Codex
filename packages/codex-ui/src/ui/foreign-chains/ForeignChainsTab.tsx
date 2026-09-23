/**
 * ForeignChainsTab — the chain-generic foreign-chains tab.
 *
 * A vertical chain rail + a dispatched panel rendered PURELY off two injected
 * props: `foreignChains` (the id list — a consumer's
 * `createForeignChainRegistry().list()`) and `foreignChainPanels` (an id → panel-
 * component slot map). It carries NO chain-specific branch: no
 * `if (id === "...")`, no concrete-chain import. The rail is the injected id
 * list, in that list's order; selecting a rail entry renders that id's injected
 * panel. Above the threshold the rail gains a search field that filters it
 * case-insensitively by id — so the rail scales past a handful of chains without
 * taxing a two-chain deployment with a filter box. A selected id with no panel
 * entry renders a graceful "no panel contributed" fallback rather than
 * crashing/blanking; an empty list renders an empty-state. Chain modules
 * contribute their panel UP into this shell (via the slot map) — the shell never
 * reaches DOWN into a concrete chain module.
 *
 * MOBILE (docs/work/codex-ui-mobile/design.md §8, the "Blockchain Accounts"
 * cleanup round): the desktop rail-plus-panel split "eats half the available
 * width... obviously not the way to do it" on a narrow screen (the rail's
 * `RAIL_MIN_WIDTH` floor alone consumes roughly half a typical mobile Zone 3).
 * Superseded on mobile by a full-screen chain PICKER (a middle riser stripe —
 * reusing the SAME portal slot Ouronet Accounts' pagination stripe uses, since
 * `CodexTabs` never mounts both class tabs' content at once — that opens a
 * `CodexModalShell` popup: a search field as its first row, then every chain
 * listed at FULL width, scrollable) plus the selected chain's `ActivePanel`
 * rendered at full width below it, with NO rail at all. Desktop's own
 * rail-plus-panel layout is completely unchanged (a separate branch below).
 */

import * as React from "react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Search, ChevronDown, Check, Boxes } from "lucide-react";
import { useIsMobile } from "../mobile/MobileContext.js";
import { CodexModalShell } from "../internal/CodexModalShell.js";

/**
 * The chain-agnostic contract every injected foreign-chain panel satisfies. The
 * shell hands ONLY the selected adapter id + an opaque context — never any
 * chain-specific value (no keyring, no adapter instance, no chain SDK type). A
 * concrete panel obtains its own chain seams internally.
 */
export type PanelProps = {
  /** The selected adapter id the shell dispatched to this slot. */
  id: string;
  /** Opaque, chain-agnostic context passed through to the panel. */
  ctx?: unknown;
  /**
   * MOBILE ONLY — a DOM node spanning the host's WHOLE mobile body, via
   * `createPortal` — owner correction (docs/work/codex-ui-mobile/design.md
   * §8, the "further optimize round 3"): "when I say full screen from now
   * on, I'm mean a full screen extension, not extending in its zone."
   * Mirrors the SAME `fullScreenPortalTarget` contract `ForeignChainsTab`
   * itself already takes and uses for its own chain-picker popup — panels
   * get it too now, so a panel's OWN full-screen `CodexModalShell` views
   * (an account detail, a seed detail, …) cover the whole screen instead of
   * being bounded to this tab's own Zone 3 rectangle. Omitted (the
   * default) falls back to the same "bounded to this component's own
   * frame" behavior every other `CodexModalShell` caller in this codebase
   * already falls back to when its own portal target isn't supplied.
   */
  fullScreenPortalTarget?: Element | null;
  /**
   * MOBILE ONLY — a DOM node spanning Zone 2's OWN rectangle exactly (no
   * `overflow` clipping, unlike Zone 3's own `overflow-y: auto`) — owner
   * correction (design.md §8, the "further optimize round 8"): a panel's
   * own seam-straddling badges (an account/balance-mode medallion pair,
   * say) need to poke UP into Zone 2's space to sit "on top of the Zone 2
   * rectangle, half in half out" without being clipped by Zone 3's own
   * scroll boundary — the SAME reason `CodexTabs`' own Ouronet-Accounts/
   * Blockchain-Accounts `EdgeRail` pair anchors here instead of to
   * `fullScreenPortalTarget`. Omitted (the default), a panel has no safe
   * anchor for this and should keep such badges bounded to its own frame
   * (accepting the clipping) or skip them.
   */
  edgeRailAnchorTarget?: Element | null;
  /**
   * MOBILE ONLY — a DOM node spanning the CORE/Zone-3 rectangle's OWN
   * rendered border box exactly (unlike `edgeRailAnchorTarget` above, which
   * is Zone 2's box — an imprecise proxy for "the top of Zone 3," off by
   * the inter-zone gap) — owner correction (design.md §8, round 8 follow-
   * up): "the expand/collapse medallion needs to be placed on the lower
   * line of the zone 3 rectangle... half above the line and half below
   * it... that's true for the other two medallions [top]." `edge="top"`/
   * `edge="bottom"` against THIS anchor are the exact visible top/bottom
   * border lines of the panel's own bounding rectangle. Omitted (the
   * default), a panel has no safe anchor for this and should keep such
   * badges bounded to its own frame (accepting the clipping) or skip them.
   */
  zone3AnchorTarget?: Element | null;
};

/** An id → panel-component slot map. A missing entry renders a graceful fallback. */
export type ForeignChainPanels = Record<string, React.ComponentType<PanelProps>>;

export interface ForeignChainsTabProps {
  /** The rail id list — the consumer's `registry.list()`. The rail mirrors this
   *  list in order; the shell derives everything from it (id-blind). */
  foreignChains: string[];
  /** The id → panel-component slot map. */
  foreignChainPanels: ForeignChainPanels;
  /** Opaque context forwarded to the active panel's `ctx` prop. */
  ctx?: unknown;
  /**
   * MOBILE ONLY — where the chain-picker's trigger stripe should mount, via
   * `createPortal` (docs/work/codex-ui-mobile/design.md §8, the "Blockchain
   * Accounts" cleanup round). Mirrors `OuronetAccountsTab`'s own
   * `paginationRiserTarget` contract exactly, and is meant to literally BE
   * the same portal target — `CodexTabs` only ever mounts one class tab's
   * content at a time, so the two never collide. Omitted (the default) falls
   * back to positioning the stripe relative to this component's own frame.
   */
  chainPickerRiserTarget?: Element | null;
  /**
   * MOBILE ONLY — a DOM node spanning the host's WHOLE mobile body, via
   * `createPortal`, for the full-screen chain-picker popup itself. Mirrors
   * `OuronetAccountsTab`'s own `fullScreenPortalTarget` contract exactly.
   * Omitted (the default) falls back to an inline `CodexModalShell` mount
   * (still full-screen on mobile via that shell's own flip, just bounded to
   * this component's own frame rather than the host's whole body).
   */
  fullScreenPortalTarget?: Element | null;
  /** Forwarded straight through to the active panel's own `edgeRailAnchorTarget`
   *  (see `PanelProps`'s own doc comment) — this shell has no seam-straddling
   *  badges of its own to anchor here itself. */
  edgeRailAnchorTarget?: Element | null;
  /** Forwarded straight through to the active panel's own `zone3AnchorTarget`
   *  (see `PanelProps`'s own doc comment) — this shell has no seam-straddling
   *  badges of its own to anchor here itself. */
  zone3AnchorTarget?: Element | null;
}

/** The rail search field renders only when the injected list is LONGER than
 *  this — below it the rail is scannable at a glance and a filter box would be
 *  pure overhead. */
const SEARCH_GATE = 6;

const ACCENT = "#ceac5f";

/** Rail row height — matched by each chain panel's category buttons so the two
 *  strips line up on the same baseline. */
export const CHAIN_ROW_HEIGHT = 40;
const RAIL_ROW_HEIGHT = CHAIN_ROW_HEIGHT;
/** Square brand-mark slot reserved at the start of every rail row. */
const RAIL_ICON_SLOT = 22;
/** Floor so a one-word chain name still reads as a menu, not a chip. */
const RAIL_MIN_WIDTH = 150;

/** Display label for a rail id. Capitalised for presentation only — the shell
 *  stays id-blind (no per-chain map, no branching on the value). */
function chainLabel(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

export function ForeignChainsTab({
  foreignChains,
  foreignChainPanels,
  ctx,
  chainPickerRiserTarget,
  fullScreenPortalTarget,
  edgeRailAnchorTarget,
  zone3AnchorTarget,
}: ForeignChainsTabProps): React.ReactElement {
  const firstId = foreignChains[0] ?? "";
  const [selectedId, setSelectedId] = useState<string>(firstId);
  const [query, setQuery] = useState<string>("");
  const isMobile = useIsMobile();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");

  if (foreignChains.length === 0) {
    return <div role="tabpanel">No foreign chains.</div>;
  }

  const activeId = foreignChains.includes(selectedId) ? selectedId : firstId;
  const ActivePanel = foreignChainPanels[activeId];

  const showSearch = foreignChains.length > SEARCH_GATE;
  const needle = query.trim().toLowerCase();
  // Filtering narrows the RAIL only — the active panel stays mounted, so a
  // non-matching query never blanks the work surface.
  const visibleIds =
    showSearch && needle
      ? foreignChains.filter((id) => id.toLowerCase().includes(needle))
      : foreignChains;

  if (isMobile) {
    const pickerNeedle = pickerQuery.trim().toLowerCase();
    const pickerVisibleIds = pickerNeedle
      ? foreignChains.filter((id) => id.toLowerCase().includes(pickerNeedle))
      : foreignChains;

    const selectChain = (id: string) => {
      setSelectedId(id);
      setPickerOpen(false);
      setPickerQuery("");
    };

    const triggerStripe = (
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        aria-label={`Select blockchain — currently ${chainLabel(activeId)}`}
        style={{
          display: "flex", alignItems: "center", gap: 4,
          height: 18, padding: "0 8px", border: "1px solid #262626", borderBottom: "none",
          borderRadius: "6px 6px 0 0", backgroundColor: "#0a0a0af0",
          color: ACCENT, fontSize: 9, fontWeight: 700, cursor: "pointer",
        }}
      >
        <Boxes size={11} strokeWidth={1.5} />
        {chainLabel(activeId)}
        <ChevronDown size={11} strokeWidth={1.5} />
      </button>
    );

    const picker = pickerOpen ? (
      <CodexModalShell title="Select Blockchain" onClose={() => { setPickerOpen(false); setPickerQuery(""); }}>
        {/* "the first entry is a search field (in case too many would be
            added and searching were to be needed)" — always present, not
            gated the way the desktop rail's own search is (`SEARCH_GATE`),
            since its whole point here is to scale gracefully past a
            two-chain deployment without needing a later code change. */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#080808", border: "1px solid #262626", borderRadius: 8, padding: "6px 10px", marginBottom: 12 }}>
          <Search style={{ width: 14, height: 14, color: "#555", flexShrink: 0 }} />
          <input
            type="search"
            aria-label="Search chains"
            placeholder="Search chains…"
            value={pickerQuery}
            onChange={(e) => setPickerQuery(e.target.value)}
            autoFocus
            style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: "#d2d3d4", fontSize: 13, fontFamily: "inherit" }}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "60vh", overflowY: "auto" }}>
          {pickerVisibleIds.map((id) => {
            const selected = id === activeId;
            return (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => selectChain(id)}
                style={{
                  display: "flex", alignItems: "center", gap: 10, width: "100%",
                  height: RAIL_ROW_HEIGHT, textAlign: "left", padding: "0 14px",
                  borderRadius: 12, border: `2px solid ${selected ? ACCENT : "#262626"}`,
                  backgroundColor: selected ? `${ACCENT}1a` : "#0a0a0a",
                  color: selected ? ACCENT : "#d2d3d4", cursor: "pointer", fontWeight: 600,
                }}
              >
                <span
                  aria-hidden="true"
                  data-testid={`chain-icon-slot-${id}`}
                  style={{ flex: `0 0 ${RAIL_ICON_SLOT}px`, width: RAIL_ICON_SLOT, height: RAIL_ICON_SLOT, borderRadius: 6, border: `1px solid ${selected ? `${ACCENT}55` : "#2f2f2f"}`, backgroundColor: selected ? `${ACCENT}20` : "#121212" }}
                />
                <span style={{ flex: 1, minWidth: 0 }}>{chainLabel(id)}</span>
                {selected && <Check size={16} style={{ flexShrink: 0 }} />}
              </button>
            );
          })}
          {pickerVisibleIds.length === 0 && (
            <div style={{ textAlign: "center", padding: "24px 0", color: "#555", fontSize: 13 }}>No matching chains</div>
          )}
        </div>
      </CodexModalShell>
    ) : null;

    return (
      <div style={{ position: "relative", display: "flex", flexDirection: "column", height: "100%" }}>
        {chainPickerRiserTarget ? createPortal(triggerStripe, chainPickerRiserTarget) : (
          <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", bottom: 0, zIndex: 5 }}>
            {triggerStripe}
          </div>
        )}
        <div role="tabpanel" style={{ flex: 1, minHeight: 0 }}>
          {ActivePanel ? (
            <ActivePanel id={activeId} ctx={ctx} fullScreenPortalTarget={fullScreenPortalTarget} edgeRailAnchorTarget={edgeRailAnchorTarget} zone3AnchorTarget={zone3AnchorTarget} />
          ) : (
            <div>{`No panel contributed for ${activeId}.`}</div>
          )}
        </div>
        {pickerOpen && (fullScreenPortalTarget ? createPortal(picker, fullScreenPortalTarget) : picker)}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: "24px" }}>
      {/* `stretch` (not flex-start) so the rail column — and therefore its
          right-hand separator — runs the FULL height of the active panel
          rather than stopping after the last chain row. */}
      <div
        style={{
          flex: "0 0 auto",
          width: "max-content",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          // Separator between the chain menu and the active panel.
          borderRight: "1px solid #262626",
          paddingRight: "16px",
        }}
      >
        {showSearch && (
          <input
            type="search"
            aria-label="Search chains"
            placeholder="Search chains…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              padding: "8px 12px",
              borderRadius: "8px",
              border: "2px solid #262626",
              backgroundColor: "#0a0a0a",
              color: "#d2d3d4",
              fontFamily: "inherit",
            }}
          />
        )}

        <div
          role="tablist"
          aria-label="Foreign chains"
          aria-orientation="vertical"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            width: "max-content",
            minWidth: RAIL_MIN_WIDTH,
            maxHeight: "420px",
            overflowY: "auto",
          }}
        >
          {visibleIds.map((id) => {
            const selected = id === activeId;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setSelectedId(id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: "100%",
                  height: RAIL_ROW_HEIGHT,
                  textAlign: "left",
                  padding: "0 14px",
                  borderRadius: "12px",
                  border: `2px solid ${selected ? ACCENT : "#262626"}`,
                  backgroundColor: selected ? ACCENT : "#0a0a0a",
                  color: selected ? "#0a0a0a" : "#d2d3d4",
                  cursor: "pointer",
                  transition: "all 0.2s",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {/* Square icon slot — reserved now, per-chain brand mark drops in
                    later. Kept chain-agnostic: the shell never maps id -> asset. */}
                <span
                  aria-hidden="true"
                  data-testid={`chain-icon-slot-${id}`}
                  style={{
                    flex: `0 0 ${RAIL_ICON_SLOT}px`,
                    width: RAIL_ICON_SLOT,
                    height: RAIL_ICON_SLOT,
                    borderRadius: 6,
                    border: `1px solid ${selected ? "rgba(10,10,10,0.35)" : "#2f2f2f"}`,
                    backgroundColor: selected ? "rgba(10,10,10,0.12)" : "#121212",
                  }}
                />
                {chainLabel(id)}
              </button>
            );
          })}
        </div>

        {visibleIds.length === 0 && <div>No matching chains</div>}
      </div>

      <div role="tabpanel" style={{ flex: "1 1 auto", minWidth: 0 }}>
        {ActivePanel ? (
          <ActivePanel id={activeId} ctx={ctx} fullScreenPortalTarget={fullScreenPortalTarget} edgeRailAnchorTarget={edgeRailAnchorTarget} zone3AnchorTarget={zone3AnchorTarget} />
        ) : (
          <div>{`No panel contributed for ${activeId}.`}</div>
        )}
      </div>
    </div>
  );
}

export default ForeignChainsTab;
