/**
 * ForeignChainsTab — the chain-generic foreign-chains tab.
 *
 * A subtab strip + a dispatched panel rendered PURELY off two injected props:
 * `foreignChains` (the id list — a consumer's `createForeignChainRegistry().list()`)
 * and `foreignChainPanels` (an id → panel-component slot map). It carries NO
 * chain-specific branch: no `if (id === "...")`, no concrete-chain import. The
 * strip is the injected id list, in that list's order; selecting a subtab renders
 * that id's injected panel. A selected id with no panel entry renders a graceful
 * "no panel contributed" fallback rather than crashing/blanking; an empty list
 * renders an empty-state. Chain modules contribute their panel UP into this shell
 * (via the slot map) — the shell never reaches DOWN into a concrete chain module.
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
  /** The subtab id list — the consumer's `registry.list()`. The strip mirrors
   *  this list in order; the shell derives everything from it (id-blind). */
  foreignChains: string[];
  /** The id → panel-component slot map. */
  foreignChainPanels: ForeignChainPanels;
  /** Opaque context forwarded to the active panel's `ctx` prop. */
  ctx?: unknown;
}

export function ForeignChainsTab({
  foreignChains,
  foreignChainPanels,
  ctx,
}: ForeignChainsTabProps): React.ReactElement {
  const firstId = foreignChains[0] ?? "";
  const [selectedId, setSelectedId] = useState<string>(firstId);

  if (foreignChains.length === 0) {
    return <div role="tabpanel">No foreign chains.</div>;
  }

  const activeId = foreignChains.includes(selectedId) ? selectedId : firstId;
  const ActivePanel = foreignChainPanels[activeId];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <div role="tablist" aria-label="Foreign chains">
        {foreignChains.map((id) => {
          const selected = id === activeId;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setSelectedId(id)}
            >
              {id}
            </button>
          );
        })}
      </div>

      <div role="tabpanel">
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
