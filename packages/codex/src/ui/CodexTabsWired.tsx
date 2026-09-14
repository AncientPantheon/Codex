/**
 * CodexTabsWired — `CodexTabs` with the aggregate's own chains already wired
 * into Class 2 (Blockchain Accounts).
 *
 * `codex-ouronet` exposes Class 2 purely as two injected slots
 * (`foreignChains` / `foreignChainPanels`) and registers NO chain of its own —
 * that is what keeps it free of any dependency on `codex-arweave`. This
 * aggregate package is the only one that depends on all four members, so it is
 * the single correct place to close that loop: Chainweb + Arweave are bound to
 * the rail here, and nowhere lower down.
 *
 * Plain `CodexTabs` stays exported from this barrel untouched, for a consumer
 * that wants to wire its own chain list instead of the default two.
 */

import { CodexTabs, ChainwebPanel } from "@ancientpantheon/codex-ouronet/ui";
import type { CodexTabsProps } from "@ancientpantheon/codex-ouronet/ui";
import { getRegisteredChains } from "@ancientpantheon/codex-ouronet/hooks";
import { ArweavePanel } from "@ancientpantheon/codex-arweave/panel";
import {
  ARWEAVE_CHAIN_ID,
  registerArweaveAddressValidator,
} from "@ancientpantheon/codex-arweave/address-book";
import type { ForeignChainPanels } from "@ancientpantheon/codex-ui";

// Register the Arweave address-book validator on the module-level default
// registry, mirroring how AddressBookTab registers StoaChain. Guarded so a
// re-import (HMR / repeated module eval) doesn't re-register.
if (!getRegisteredChains().includes(ARWEAVE_CHAIN_ID)) {
  registerArweaveAddressValidator();
}

/** Class 2's rail, in display order. The rail mirrors this array exactly. */
const WIRED_CHAINS: string[] = ["chainweb", ARWEAVE_CHAIN_ID];

/** id → panel slot map for the ids above. Both panels take codex-ui's
 *  chain-agnostic `PanelProps` (`{ id, ctx? }`) and obtain their own seams. */
const WIRED_CHAIN_PANELS: ForeignChainPanels = {
  chainweb: ChainwebPanel,
  [ARWEAVE_CHAIN_ID]: ArweavePanel,
};

/** `CodexTabsWired` takes the same surface as `CodexTabs` minus the chain
 *  slots — those are what this component supplies. */
export type CodexTabsWiredProps = Omit<
  CodexTabsProps,
  "foreignChains" | "foreignChainPanels"
>;

export function CodexTabsWired({ className, defaultTab }: CodexTabsWiredProps) {
  return (
    <CodexTabs
      className={className}
      defaultTab={defaultTab}
      foreignChains={WIRED_CHAINS}
      foreignChainPanels={WIRED_CHAIN_PANELS}
    />
  );
}

export default CodexTabsWired;
