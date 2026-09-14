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
 */

import * as React from "react";
import { useState } from "react";

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
}: ForeignChainsTabProps): React.ReactElement {
  const firstId = foreignChains[0] ?? "";
  const [selectedId, setSelectedId] = useState<string>(firstId);
  const [query, setQuery] = useState<string>("");

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
          <ActivePanel id={activeId} ctx={ctx} />
        ) : (
          <div>{`No panel contributed for ${activeId}.`}</div>
        )}
      </div>
    </div>
  );
}

export default ForeignChainsTab;
