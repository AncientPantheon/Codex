/**
 * ChainwebPanel — the Chainweb chain panel contributed into codex-ui's generic
 * `ForeignChainsTab` slot.
 *
 * Conforms to codex-ui's chain-agnostic `PanelProps` (`{ id, ctx? }`, imported
 * TYPE-ONLY) and IGNORES both: the panel is Chainweb by construction, and the
 * shell hands it no chain-specific value. Its only job is RE-PARENTING: the
 * three tabs that used to sit at the Codex top level — `SeedWordsTab`,
 * `PureKeypairsTab`, `StoaAccountsTab` — are mounted here UNCHANGED, with no
 * prop changes and no copied logic, under the common Seeds · Pure Keys ·
 * Accounts category spine. Behaviour of the three surfaces is therefore
 * identical to before; only their parent changed.
 *
 * `accounts` is the landing category: the `k:` accounts are what a user reaches
 * for, the seeds/keys that mint them are the drill-down.
 *
 * The category strip follows the sibling `ArweavePanel`'s `role="tablist"` +
 * `data-testid="<chain>-subtab-<id>"` contract and the pill styling used by the
 * Ouronet tabs' own subtab strips.
 */

import * as React from "react";
import { useState } from "react";
import { Sprout, KeySquare, Diamond } from "lucide-react";

import type { PanelProps } from "@ancientpantheon/codex-ui";

import { SeedWordsTab } from "../tabs/SeedWordsTab.js";
import { PureKeypairsTab } from "../tabs/PureKeypairsTab.js";
import { StoaAccountsTab } from "../tabs/StoaAccountsTab.js";

/** The Chainweb panel's categories, in display order. */
const CATEGORIES = ["seeds", "pure-keys", "accounts"] as const;
type CategoryId = (typeof CATEGORIES)[number];

type IconProps = { style?: React.CSSProperties };

/** Strip label + accent per category — accents mirror the pre-reparent top-level
 *  tabs (Seed Words green · Pure Key Pairs purple · Stoa Accounts gold). */
const CATEGORY_META: Record<CategoryId, { label: string; Icon: React.ComponentType<IconProps>; color: string }> = {
  seeds: { label: "Seeds", Icon: Sprout, color: "#22c55e" },
  "pure-keys": { label: "Pure Keys", Icon: KeySquare, color: "#a78bfa" },
  accounts: { label: "Accounts", Icon: Diamond, color: "#ceac5f" },
};

/** Landing category — the accounts view, not the key material behind it. */
const DEFAULT_CATEGORY: CategoryId = "accounts";

/** Category-button height — matches the chain rail row height in codex-ui's
 *  ForeignChainsTab so the vertical menu and this strip share a baseline. */
const CATEGORY_ROW_HEIGHT = 40;

export function ChainwebPanel(_props: PanelProps): React.ReactElement {
  const [active, setActive] = useState<CategoryId>(DEFAULT_CATEGORY);

  return (
    <div
      data-testid="chainweb-panel"
      style={{ fontFamily: "var(--codex-font, inherit)", color: "#d2d3d4", display: "flex", flexDirection: "column", gap: 12 }}
    >
      <div role="tablist" aria-label="Chainweb categories" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {CATEGORIES.map((id) => {
          const { label, Icon, color } = CATEGORY_META[id];
          const selected = id === active;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={selected}
              data-testid={`chainweb-subtab-${id}`}
              onClick={() => setActive(id)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, height: CATEGORY_ROW_HEIGHT, padding: "0 16px", borderRadius: 999,
                fontSize: 13, fontWeight: 600, cursor: "pointer",
                border: `1px solid ${selected ? color : "#262626"}`,
                backgroundColor: selected ? color + "1a" : "transparent",
                color: selected ? color : "#888",
              }}
            >
              <Icon style={{ width: 14, height: 14 }} />
              {label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel">
        {active === "seeds" && <SeedWordsTab />}
        {active === "pure-keys" && <PureKeypairsTab />}
        {active === "accounts" && <StoaAccountsTab />}
      </div>
    </div>
  );
}

export default ChainwebPanel;
