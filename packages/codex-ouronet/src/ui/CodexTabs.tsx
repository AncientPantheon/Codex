/**
 * CodexTabs — the Ouronet-side aggregator that fills codex-ui's chain-generic
 * <CodexTabsShell> with the five concrete account tabs.
 *
 * The D5 carve moved the pure-layout tab-strip + active-tab switching state into
 * codex-ui's <CodexTabsShell>; this aggregator STAYS Ouronet-side (it statically
 * imports the five @stoachain/zbom-edged tabs) and injects them through the
 * shell's `tabs` slot. The public props (`className`, `defaultTab`) + the
 * `CodexTabKey` union stay byte-stable (N-04).
 *
 * OURO/WSTOA image icons are substituted with lucide equivalents to keep the
 * package asset-free; the Stoa mark is a custom brand-shape SVG.
 */

import * as React from "react";
import { Atom, Sprout, KeySquare, BookOpen } from "lucide-react";
import { CodexTabsShell } from "@ancientpantheon/codex-ui/ui";
import type { CodexTabsShellItem } from "@ancientpantheon/codex-ui/ui";
import { OuronetAccountsTab } from "./tabs/OuronetAccountsTab.js";
import { SeedWordsTab } from "./tabs/SeedWordsTab.js";
import { PureKeypairsTab } from "./tabs/PureKeypairsTab.js";
import { StoaAccountsTab } from "./tabs/StoaAccountsTab.js";
import { AddressBookTab } from "./tabs/AddressBookTab.js";

type IconProps = { style?: React.CSSProperties; strokeWidth?: number };

/** Stoa Accounts logo — the Stoa rhombus as the ❖ glyph (a diamond divided by an
 *  X into four petals), matching the StoaChain mark. Custom SVG so it's the brand
 *  shape, not a generic gem. */
function StoaDiamond({ style, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="round" style={style} aria-hidden>
      <path d="M12 1.5 L22.5 12 L12 22.5 L1.5 12 Z" />
      <path d="M6.75 6.75 L17.25 17.25 M17.25 6.75 L6.75 17.25" />
    </svg>
  );
}

export type CodexTabKey =
  | "ouronet-accounts"
  | "seed-words"
  | "pure-keypairs"
  | "stoa-accounts"
  | "address-book";

// Per-tab logo colour: Ouronet blue · Seed Words green · Pure Key Pairs purple ·
// Stoa Accounts gold-yellow · Address Book white. The concrete tab component
// rides in each item's `content`; the shell owns the strip + switching state.
const TAB_ITEMS: CodexTabsShellItem[] = [
  { key: "ouronet-accounts", label: "Ouronet Accounts", Icon: Atom, accent: "#3b82f6", content: <OuronetAccountsTab /> },
  { key: "seed-words", label: "Seed Words", Icon: Sprout, accent: "#22c55e", content: <SeedWordsTab /> },
  { key: "pure-keypairs", label: "Pure Key Pairs", Icon: KeySquare, accent: "#a78bfa", content: <PureKeypairsTab /> },
  { key: "stoa-accounts", label: "Stoa Accounts", Icon: StoaDiamond, accent: "#ceac5f", content: <StoaAccountsTab /> },
  { key: "address-book", label: "Address Book", Icon: BookOpen, accent: "#e8e8ea", content: <AddressBookTab /> },
];

export interface CodexTabsProps {
  className?: string;
  /** Tab shown on first render. Defaults to "ouronet-accounts". */
  defaultTab?: CodexTabKey;
}

export function CodexTabs({ className, defaultTab = "ouronet-accounts" }: CodexTabsProps) {
  return <CodexTabsShell tabs={TAB_ITEMS} className={className} defaultTab={defaultTab} />;
}

export default CodexTabs;
