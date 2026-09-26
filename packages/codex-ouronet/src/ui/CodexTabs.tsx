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
 *
 * MOBILE (docs/work/codex-ui-mobile/design.md §8): supersedes codex-ui's
 * generic `CodexTabsShell` bottom icon-bar for THIS specific three-tab set —
 * Ouronet Accounts / Blockchain Accounts become two icon-only `EdgeRail`s
 * (left/right screen edges); Address Book becomes a bottom stripe opening a
 * full-screen `CodexModalShell` popup. Desktop is completely unchanged
 * (still `CodexTabsShell`'s grid-of-tiles + generic bottom bar).
 * `CodexTabsShell` itself is untouched and stays the package's generic
 * default for any OTHER tab set a future consumer injects.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { Atom, Boxes, BookOpen } from "lucide-react";
import { CodexTabsShell, useIsMobile, EdgeRail } from "@ancientpantheon/codex-ui/ui";
import type { CodexTabsShellItem } from "@ancientpantheon/codex-ui/ui";
import { ForeignChainsTab } from "@ancientpantheon/codex-ui";
import type { ForeignChainPanels } from "@ancientpantheon/codex-ui";
import { OuronetAccountsTab } from "./tabs/OuronetAccountsTab.js";
import { AddressBookTab } from "./tabs/AddressBookTab.js";
import { CodexModalShell } from "./internal/CodexModalShell.js";

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
  /** Forwarded straight through to `ForeignChainsTab`'s own `chainLabels` —
   *  see that prop's own doc comment. Optional id → display-label overrides
   *  for the rail; omitted ids keep the default auto-capitalize behavior. */
  chainLabels?: Record<string, string>;
  /**
   * Where the mobile Address Book stripe's TRIGGER BUTTON should mount, via
   * `createPortal` — a DOM node flush against a host's OWN bottom tab bar
   * (owner directive: "the address book stripe isn't sitting flush to the
   * footer bar... similar to the controls stripe"). `CodexTabs`' own frame
   * sits ABOVE a host's real tab bar (it's Zone 3's content, not the tab bar
   * itself), so a riser positioned relative to THIS component's own frame
   * can never truly touch that bar — only a host that owns the tab bar can
   * supply a node already anchored there (see `apps/codex-playground/src/
   * OuronetShellMock.tsx`'s `.cxpg-osm-addressbook-riser-slot`). When
   * supplied, the portaled button is a PLAIN button (no positioning of its
   * own — the target node owns that); when omitted (the default), falls
   * back to the ORIGINAL riser, positioned relative to this component's own
   * frame — safe for any consumer that hasn't wired a slot.
   */
  addressBookRiserTarget?: Element | null;
  /** Forwarded to `OuronetAccountsTab` — see that prop's own doc comment. */
  paginationRiserTarget?: Element | null;
  /**
   * Forwarded to `OuronetAccountsTab` for its swipe-bullets strip — see that
   * prop's own doc comment. (The Ouronet Accounts / Blockchain Accounts
   * `EdgeRail`s do NOT dock here — see `edgeRailAnchorTarget` below, which
   * the owner later redirected them to; this target is bullets-only now.)
   */
  swipeIndicatorRiserTarget?: Element | null;
  /**
   * Where the two Ouronet Accounts / Blockchain Accounts `EdgeRail`s should
   * dock, via `createPortal` — a DOM node whose OWN box exactly matches Zone
   * 2's box (e.g. `apps/codex-playground/src/App.tsx`'s overlay `div` inside
   * `.cxpg-zone2`). Owner correction (the Settings-page cleanup round): "I
   * think we should add them higher (where I've drawn with red)" — pointing
   * at the Zone 2 / Zone 3 seam, having previously directed them to the gap
   * BELOW Zone 3 instead (`swipeIndicatorRiserTarget`, now bullets-only).
   * `edge="bottom"` here straddles THIS anchor's own bottom seam (= the Zone
   * 2/Zone 3 boundary) — never clipped by Zone 3's `overflow-y: auto`
   * because the anchor is a descendant of Zone 2 (no `overflow` clipping),
   * not Zone 3; CSS `overflow` only clips DESCENDANTS of the clipping
   * element, not unrelated nodes that merely render in the same screen
   * region. Omitted (the default) falls back to `fullScreenPortalTarget`
   * (`edge="middle"`, vertically centered against that whole-body node
   * instead — still never clipped, just not pinned to a specific row).
   * Omitted entirely falls back further still to the ORIGINAL inline
   * rendering — the rails as direct children of this component's own frame
   * (`edge="bottom"` against ITS OWN seam) — safe for any consumer that
   * hasn't wired any target (this is exactly what
   * `ui-codex-tabs-mobile.test.tsx`'s "outer frame" test still exercises).
   */
  edgeRailAnchorTarget?: Element | null;
  /**
   * A DOM node spanning ZONE 3's OWN rendered border box exactly (e.g.
   * `apps/codex-playground/src/App.tsx`'s wrapper around `.cxpg-zone3`) —
   * design.md §8, round 8 follow-up: "the expand/collapse medallion needs
   * to be placed on the lower line of the zone 3 rectangle... half above
   * the line and half below it... that's true for the other two medallions
   * [top]... they now sit ON the line [not straddling it]." A DIFFERENT
   * target from `edgeRailAnchorTarget` above — that one is Zone 2's own
   * box, an imprecise proxy for "Zone 3's top" (it sits ~10px above the
   * real seam, across the inter-zone gap: "you placed them one level to
   * high"). Forwarded straight through to `ForeignChainsTab` (a chain
   * panel's own seam badges need it the same way this component's own
   * EdgeRails need `edgeRailAnchorTarget`); this component has no medallion
   * of its own that uses it.
   */
  zone3AnchorTarget?: Element | null;
  /**
   * A DOM node spanning the host's WHOLE mobile body (e.g. `apps/codex-
   * playground/src/App.tsx`'s `.cxpg-modal-portal-root`), via `createPortal`
   * — design.md §8, the "Zone 3" feedback round: "the side buttons are tied
   * into zone 3, which is incorrect... docked to the screen, on top of
   * everything, shown in their entirety." FALLBACK for the EdgeRails when
   * `edgeRailAnchorTarget` isn't supplied (`edge="middle"`). Always forwarded
   * to `OuronetAccountsTab` for its Spawn modal (see that prop's own doc
   * comment) regardless of which EdgeRail target is active.
   */
  fullScreenPortalTarget?: Element | null;
}

export function CodexTabs({
  className,
  defaultTab = "ouronet-accounts",
  foreignChains = [],
  foreignChainPanels = {},
  chainLabels,
  addressBookRiserTarget,
  paginationRiserTarget,
  swipeIndicatorRiserTarget,
  edgeRailAnchorTarget,
  zone3AnchorTarget,
  fullScreenPortalTarget,
}: CodexTabsProps) {
  // The EdgeRails' own portal target: prefer the Zone 2-anchored slot (its
  // own bottom seam = the Zone 2/Zone 3 boundary, `edge="bottom"`); fall
  // back to the old whole-body node (`edge="middle"`); fall back further to
  // inline rendering (see the doc comments above).
  const edgeRailPortalTarget = edgeRailAnchorTarget ?? fullScreenPortalTarget;
  const edgeRailEdge: "bottom" | "middle" = edgeRailAnchorTarget ? "bottom" : "middle";
  // Per-tab logo colour: Ouronet blue · Blockchain Accounts gold-amber ·
  // Address Book white. The concrete tab component rides in each item's
  // `content`; the shell owns the strip + switching state. Built per-render
  // because Class 2's content closes over the injected chain slots.
  const tabs: CodexTabsShellItem[] = [
    {
      key: "ouronet-accounts", label: "Ouronet Accounts", Icon: Atom, accent: "#3b82f6",
      content: <OuronetAccountsTab paginationRiserTarget={paginationRiserTarget} swipeIndicatorRiserTarget={swipeIndicatorRiserTarget} fullScreenPortalTarget={fullScreenPortalTarget} />,
    },
    {
      key: "blockchain-accounts",
      label: "Blockchain Accounts",
      Icon: Boxes,
      accent: "#f0a500",
      content: (
        <ForeignChainsTab
          foreignChains={foreignChains}
          foreignChainPanels={foreignChainPanels}
          chainLabels={chainLabels}
          chainPickerRiserTarget={paginationRiserTarget}
          fullScreenPortalTarget={fullScreenPortalTarget}
          edgeRailAnchorTarget={edgeRailAnchorTarget}
          zone3AnchorTarget={zone3AnchorTarget}
        />
      ),
    },
    { key: "address-book", label: "Address Book", Icon: BookOpen, accent: "#e8e8ea", content: <AddressBookTab /> },
  ];

  // Mobile (docs/work/codex-ui-mobile/design.md §8): supersedes
  // CodexTabsShell's generic bottom icon-bar for THIS specific three-tab set.
  // Ouronet Accounts / Blockchain Accounts become two icon-only EdgeRails
  // (left/right screen edges); Address Book becomes a bottom stripe opening
  // a full-screen popup (CodexModalShell, already full-screen on mobile).
  const isMobile = useIsMobile();
  const [activeClass, setActiveClass] = useState<"ouronet-accounts" | "blockchain-accounts">(
    defaultTab === "blockchain-accounts" ? "blockchain-accounts" : "ouronet-accounts",
  );
  const [addressBookOpen, setAddressBookOpen] = useState(false);

  if (isMobile) {
    return (
      // The OUTER box is the non-scrolling fixed frame — bounded to exactly
      // whatever height the host gives it (`height: "100%"`, per the host's
      // own flex chain: docs/work/codex-ui-mobile/design.md §8's "EdgeRails
      // must be linked to the SIDE OF THE SCREEN, not the side of a scrolling
      // zone, and stay in place" correction).
      //
      // WITHOUT `fullScreenPortalTarget` (the fallback): the two EdgeRails
      // are DIRECT children of THIS box (`position: absolute` against it,
      // `edge="bottom"`, docked at its own bottom seam — the gap the host's
      // Zone 3 wrapper leaves below it, `.cxpg-zone3`'s own bottom margin).
      //
      // WITH `fullScreenPortalTarget` (design.md §8, the next "Zone 3"
      // feedback round: "the side buttons are tied into zone 3, which is
      // incorrect... docked to the screen, on top of everything, shown in
      // their entirety"): the rails portal OUT of this box entirely
      // (`edge="middle"`, vertically centered against the host's own
      // full-body node) — they are no longer bounded by, or clippable
      // against, Zone 3's own frame/overflow at all.
      <div
        className={className}
        style={{
          position: "relative", height: "100%", display: "flex", flexDirection: "column",
          fontFamily: "var(--codex-font, inherit)", color: "var(--codex-text)",
        }}
      >
        {edgeRailPortalTarget ? (
          createPortal(
            <>
              <EdgeRail
                side="left"
                edge={edgeRailEdge}
                accent="#3b82f6"
                active={activeClass === "ouronet-accounts"}
                onClick={() => setActiveClass("ouronet-accounts")}
                aria-label="Ouronet Accounts"
              >
                <Atom size={18} strokeWidth={1.5} />
              </EdgeRail>
              <EdgeRail
                side="right"
                edge={edgeRailEdge}
                accent="#f0a500"
                active={activeClass === "blockchain-accounts"}
                onClick={() => setActiveClass("blockchain-accounts")}
                aria-label="Blockchain Accounts"
              >
                <Boxes size={18} strokeWidth={1.5} />
              </EdgeRail>
            </>,
            edgeRailPortalTarget,
          )
        ) : (
          <>
            <EdgeRail
              side="left"
              edge="bottom"
              accent="#3b82f6"
              active={activeClass === "ouronet-accounts"}
              onClick={() => setActiveClass("ouronet-accounts")}
              aria-label="Ouronet Accounts"
            >
              <Atom size={18} strokeWidth={1.5} />
            </EdgeRail>
            <EdgeRail
              side="right"
              edge="bottom"
              accent="#f0a500"
              active={activeClass === "blockchain-accounts"}
              onClick={() => setActiveClass("blockchain-accounts")}
              aria-label="Blockchain Accounts"
            >
              <Boxes size={18} strokeWidth={1.5} />
            </EdgeRail>
          </>
        )}

        {/* The ONLY scrolling element in this box — `flex: 1; min-height: 0`
            so it never grows past the outer frame's own bounded height.
            Uniform 8px padding on EVERY side (owner directive, the
            follow-up feedback round: "they must have the same border to the
            zone everywhere, for example the last entry sits flush" — the
            prior `"8px 8px 0"` left the BOTTOM edge unpadded, so the last
            scrolled-to account row touched Zone 3's own border directly
            while every other side kept an 8px gap). */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 8 }}>
          {activeClass === "ouronet-accounts" ? (
            <OuronetAccountsTab paginationRiserTarget={paginationRiserTarget} swipeIndicatorRiserTarget={swipeIndicatorRiserTarget} fullScreenPortalTarget={fullScreenPortalTarget} />
          ) : (
            <ForeignChainsTab
              foreignChains={foreignChains}
              foreignChainPanels={foreignChainPanels}
              chainLabels={chainLabels}
              chainPickerRiserTarget={paginationRiserTarget}
              fullScreenPortalTarget={fullScreenPortalTarget}
              edgeRailAnchorTarget={edgeRailAnchorTarget}
              zone3AnchorTarget={zone3AnchorTarget}
            />
          )}
        </div>

        {/* Address Book stripe trigger — same visual family as the Controls
            riser, mirrored to the opposite side (design.md §8). Portaled to
            `addressBookRiserTarget` when supplied, so it renders flush
            against a HOST's real bottom tab bar instead of floating above
            it; the fallback (no target) positions it relative to THIS
            component's own frame — which can only ever sit just above a
            host's tab bar, never flush against it. The reference's own
            design note says a rail must never be the ONLY door to a view;
            this stripe plays that "other door" role opposite the two
            EdgeRails above. */}
        {addressBookRiserTarget ? (
          createPortal(
            <button
              type="button"
              onClick={() => setAddressBookOpen(true)}
              aria-label="Address Book"
              style={{
                display: "flex", alignItems: "center", gap: 4,
                height: 18, padding: "0 8px", border: "1px solid #262626", borderBottom: "none",
                borderRadius: "6px 6px 0 0", backgroundColor: "#0a0a0af0",
                color: "#e8e8ea", fontSize: 9, fontWeight: 700, cursor: "pointer",
              }}
            >
              <BookOpen size={11} strokeWidth={1.5} />
              Address Book
            </button>,
            addressBookRiserTarget,
          )
        ) : (
          <button
            type="button"
            onClick={() => setAddressBookOpen(true)}
            aria-label="Address Book"
            style={{
              position: "absolute", right: 8, bottom: 0, zIndex: 5,
              display: "flex", alignItems: "center", gap: 4,
              height: 18, padding: "0 8px",
              border: "1px solid #262626", borderBottom: "none",
              borderRadius: "6px 6px 0 0",
              backgroundColor: "#0a0a0af0",
              color: "#e8e8ea", fontSize: 9, fontWeight: 700, cursor: "pointer",
            }}
          >
            <BookOpen size={11} strokeWidth={1.5} />
            Address Book
          </button>
        )}

        {addressBookOpen && (
          <CodexModalShell title="Address Book" onClose={() => setAddressBookOpen(false)}>
            <AddressBookTab />
          </CodexModalShell>
        )}
      </div>
    );
  }

  return <CodexTabsShell tabs={tabs} className={className} defaultTab={defaultTab} />;
}

export default CodexTabs;
