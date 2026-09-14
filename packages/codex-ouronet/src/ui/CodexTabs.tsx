/**
 * CodexTabs — the Ouronet-side aggregator that fills codex-ui's chain-generic
 * <CodexTabsShell> with the three concrete CLASS tabs.
 *
 * The D5 carve moved the pure-layout tab-strip + active-tab switching state into
 * codex-ui's <CodexTabsShell>; this aggregator STAYS Ouronet-side (it statically
 * imports the @stoachain/zbom-edged tabs) and injects them through the shell's
 * `tabs` slot.
 *
 * The Class-IA restructure collapsed the five peers into three classes:
 * Ouronet Accounts (Class 1) · Blockchain Accounts (Class 2) · Address Book
 * (Class 3). Seed Words / Pure Key Pairs / Stoa Accounts were never peers of
 * Ouronet Accounts — all three are Chainweb sub-concerns — so they are no longer
 * imported here: they are re-parented under `ChainwebPanel`, which a consumer
 * contributes INTO Class 2 through the injected panel map.
 *
 * Class 2 is codex-ui's chain-generic <ForeignChainsTab>, fed purely from the
 * two optional slots `foreignChains` / `foreignChainPanels`. Nothing chain-
 * concrete is imported here — that injection is exactly why codex-ouronet gains
 * NO dependency on codex-arweave (or on any future chain package), and why not
 * even ChainwebPanel is registered as a default. With the empty defaults Class 2
 * renders ForeignChainsTab's own empty state rather than crashing.
 *
 * OURO/WSTOA image icons are substituted with lucide equivalents to keep the
 * package asset-free.
 */

import { Atom, Boxes, BookOpen } from "lucide-react";
import { CodexTabsShell } from "@ancientpantheon/codex-ui/ui";
import type { CodexTabsShellItem } from "@ancientpantheon/codex-ui/ui";
import { ForeignChainsTab } from "@ancientpantheon/codex-ui";
import type { ForeignChainPanels } from "@ancientpantheon/codex-ui";
import { OuronetAccountsTab } from "./tabs/OuronetAccountsTab.js";
import { AddressBookTab } from "./tabs/AddressBookTab.js";

export type CodexTabKey =
  | "ouronet-accounts"
  | "blockchain-accounts"
  | "address-book";

export interface CodexTabsProps {
  className?: string;
  /** Tab shown on first render. Defaults to "ouronet-accounts". */
  defaultTab?: CodexTabKey;
  /** Class 2's chain rail — the consumer's chain-id list, in display order.
   *  Empty (the default) renders ForeignChainsTab's "No foreign chains." state. */
  foreignChains?: string[];
  /** Class 2's id → panel-component slot map. Chains contribute their panel UP
   *  into this aggregator; it never reaches DOWN into a concrete chain package. */
  foreignChainPanels?: ForeignChainPanels;
}

export function CodexTabs({
  className,
  defaultTab = "ouronet-accounts",
  foreignChains = [],
  foreignChainPanels = {},
}: CodexTabsProps) {
  // Per-tab logo colour: Ouronet blue · Blockchain Accounts gold-amber ·
  // Address Book white. The concrete tab component rides in each item's
  // `content`; the shell owns the strip + switching state. Built per-render
  // because Class 2's content closes over the injected chain slots.
  const tabs: CodexTabsShellItem[] = [
    { key: "ouronet-accounts", label: "Ouronet Accounts", Icon: Atom, accent: "#3b82f6", content: <OuronetAccountsTab /> },
    {
      key: "blockchain-accounts",
      label: "Blockchain Accounts",
      Icon: Boxes,
      accent: "#f0a500",
      content: <ForeignChainsTab foreignChains={foreignChains} foreignChainPanels={foreignChainPanels} />,
    },
    { key: "address-book", label: "Address Book", Icon: BookOpen, accent: "#e8e8ea", content: <AddressBookTab /> },
  ];

  return <CodexTabsShell tabs={tabs} className={className} defaultTab={defaultTab} />;
}

export default CodexTabs;
