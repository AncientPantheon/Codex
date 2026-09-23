// ============================================================================
// OuronetShellMock — the playground's mobile testing harness.
//
// WHY THIS EXISTS: CodexUI's mobile view (docs/work/codex-ui-mobile/design.md)
// is container-relative, not viewport-relative (§1) — it must correctly detect
// "mobile" off its OWN measured box, not the window, because in production it
// is EMBEDDED inside OuronetUI's real mobile shell (a 7-tab bottom bar: Home /
// STOA ICO / Cross-Chain / Execute Code / Codex / Assets / Auxiliary — see
// OuroborosNetwork/daimons/OuronetUI's own `MobileTabBar`/`MobileHeader`), not
// given the full viewport. The bare standalone mobile view (screenshot: just
// the Codex dashboard filling the whole phone) never actually exercises that —
// `CodexUiRoot` happens to equal the viewport there, so it can't catch a bug
// that only shows up once Codex is squeezed into a SMALLER host rectangle.
//
// This component is that missing "embedded-container verification" harness
// (design.md §6), made into something you can actually look at instead of a
// hidden test div: a MOCKUP of OuronetUI's real mobile chrome (header strip +
// the 7-icon bottom tab bar), where ONLY the "Codex" tab is wired — it renders
// the real Dashboard inside a CONSTRAINED area, exactly the rectangle a real
// embedded CodexUI would get. The other six tabs are unwired, visually muted
// ("redded") placeholders; tapping them does nothing, matching how a real
// OuronetUI deployment would route to a page this playground doesn't have.
//
// It is playground-app-only chrome, NOT part of any shipped package: it knows
// OuronetUI-specific vocabulary ("STOA ICO", "Cross-Chain") that codex-ui/
// codex-ouronet must never depend on (they are host-agnostic).
// ============================================================================

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import {
  Home,
  Rocket,
  ArrowLeftRight,
  Terminal,
  KeySquare,
  Coins,
  Settings2,
  Settings,
  LayoutGrid,
  Download,
  Upload,
  ChevronUp,
  type LucideIcon,
} from "lucide-react";
import { useControls, ControlsDrawer } from "@ancientpantheon/codex-ui/ui";
import "./ouronet-shell-mock.css";

/** Viewport-relative on purpose (unlike CodexUI's own container-relative
 *  useIsMobile()): this component simulates OuronetUI ITSELF, which — being
 *  the top-level, screen-owning app — correctly measures the real viewport
 *  (design.md §1: "OuronetUI... owns the whole screen, viewport-relative is
 *  correct for it"). Breakpoint matches CODEX_MOBILE_BREAKPOINT so the outer
 *  mock shell and the inner CodexUI mobile shell engage at the same width. */
const OURONET_MOCK_BREAKPOINT = 700;

export function useOuronetMockMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth < OURONET_MOCK_BREAKPOINT,
  );
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < OURONET_MOCK_BREAKPOINT);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return isMobile;
}

interface MockTab {
  key: string;
  label: string;
  Icon: LucideIcon;
  /** Only "codex" is wired. Every other tab is a visual-only, unwired mockup. */
  live: boolean;
}

const TABS: MockTab[] = [
  { key: "home", label: "Home", Icon: Home, live: false },
  { key: "stoa-ico", label: "STOA ICO", Icon: Rocket, live: false },
  { key: "cross-chain", label: "Cross-Chain", Icon: ArrowLeftRight, live: false },
  { key: "execute-code", label: "Execute Code", Icon: Terminal, live: false },
  { key: "codex", label: "Codex", Icon: KeySquare, live: true },
  { key: "assets", label: "Assets", Icon: Coins, live: false },
  { key: "auxiliary", label: "Auxiliary", Icon: Settings2, live: false },
];

/**
 * The Controls riser — bottom-left, bulging up above the tab bar, mirrors
 * OuronetUI's own `MobileTabBar` riser (only rendered when there's something
 * to show). `position: absolute` against THIS shell's own `position: relative`
 * root (never `fixed` against the viewport — design.md §1), so it never
 * escapes the mock shell the way OuronetUI's real `fixed` riser wouldn't
 * escape the real phone screen.
 */
function ControlsRiser() {
  const { count, setOpen } = useControls();
  // Always visible, even at [0] (owner directive) — a permanent fixture
  // flush to the tab bar, not something that pops in/out of existence as
  // registrations come and go. Clicking it at [0] opens the (empty)
  // ControlsDrawer, which already renders its own "No actions available."
  // message for a zero-group state.
  return (
    <button
      type="button"
      className="cxpg-osm-controls-riser"
      aria-label={`Controls — ${count} actions`}
      onClick={() => setOpen(true)}
    >
      <ChevronUp size={12} />
      <span>Controls [{count}]</span>
    </button>
  );
}

export type CodexPlaygroundView = "ui" | "settings";

export interface OuronetShellMockProps {
  children: ReactNode;
  /** Which of Codex's two core regions is showing (design.md §8's Core zone:
   *  "made of 2 such core regions, the CodexUI and the Settings"). */
  activeView: CodexPlaygroundView;
  onSelectView: (view: CodexPlaygroundView) => void;
  /** "Export codex to JSON" — a Codex-tap tier-2 menu item, not inline chrome
   *  (design.md §8: these are localhost-only, standalone-specific affordances
   *  that don't belong in a real host's persistent UI). */
  onExport: () => void;
  /** "Load a different codex" — omitted (no menu item) when there's nothing
   *  loaded to replace yet, same optionality the old inline button had. */
  onImport?: () => void;
  /**
   * Fires with the Address Book riser SLOT's own DOM node once it mounts
   * (and `null` on unmount) — a callback, not a plain ref, because the
   * CALLER needs the real node (to hand down to `CodexTabs` as
   * `addressBookRiserTarget`, several component layers away) as REACT
   * STATE, which only a callback ref can produce reliably on first paint.
   * This node sits flush against the tab bar (`.cxpg-osm-addressbook-riser-
   * slot`, mirrors `.cxpg-osm-controls-riser`'s own positioning, opposite
   * side) — `CodexTabs`' own Address Book stripe portals its trigger button
   * into it instead of positioning itself relative to its own (necessarily
   * higher-up) frame.
   */
  onAddressBookRiserSlotChange?: (el: HTMLDivElement | null) => void;
  /**
   * Same idea as `onAddressBookRiserSlotChange`, for the Ouronet Accounts
   * pagination stripe (design.md §8, the "Zone 3" round) — "the Prev 1/3
   * Next page controllers... a middle stripe with 2 buttons, one left and
   * one right, similar to Controls and Address Book... the middle position
   * flush to the footer button list is reserved for the pagination
   * controls." Centered between the Controls riser (left) and the Address
   * Book riser (right).
   */
  onPaginationRiserSlotChange?: (el: HTMLDivElement | null) => void;
  /**
   * Same idea again, for the Zone 3 swipe-BULLETS strip AND the Ouronet
   * Accounts / Blockchain Accounts `EdgeRail`s — owner correction (the
   * follow-up feedback round): "the bullet I was talking about is something
   * beneath Zone 3... outside of the Zone 3 box, as we are doing it on
   * Ouronet UI. This creates a great enough separation between the
   * rectangle of Zone 3 and the footer, such that at THIS LEVEL we can add
   * the side buttons." A SEPARATE band from the Controls/Pagination/Address
   * Book riser row (`.cxpg-osm-swipe-indicator-riser-slot`, positioned
   * ABOVE that row, closer to Zone 3) — NOT merged into it, since the owner
   * was explicit these are "different entities" that merely "work in
   * concert."
   */
  onSwipeIndicatorRiserSlotChange?: (el: HTMLDivElement | null) => void;
}

/**
 * Tapping "Codex" opens this instead of navigating straight through — the
 * SAME tier-2-drawer mechanic OuronetUI's own `MobileTabBar` uses for a
 * section with sub-items (`openSubs`/`tier2Meta`, popping up from the bar as
 * a ONE-ROW grid of icon+short-label cells — `grid auto-cols-fr
 * grid-flow-col`, per that component's own real markup), applied here with 4
 * items instead of that pattern's usual sub-pages (design.md §8) — same
 * one-line, icon-on-top layout as the real tier-2 drawer, NOT four stacked
 * full-width rows.
 */
function CodexTierTwoMenu({
  activeView,
  onSelectView,
  onExport,
  onImport,
  onClose,
}: {
  activeView: CodexPlaygroundView;
  onSelectView: (view: CodexPlaygroundView) => void;
  onExport: () => void;
  onImport?: () => void;
  onClose: () => void;
}) {
  return (
    <div className="cxpg-osm-codex-menu" role="menu" aria-label="Codex">
      <button
        type="button"
        role="menuitem"
        aria-current={activeView === "ui" ? "true" : undefined}
        className={activeView === "ui" ? "cxpg-osm-codex-menu-item cxpg-osm-codex-menu-item--active" : "cxpg-osm-codex-menu-item"}
        onClick={() => { onSelectView("ui"); onClose(); }}
      >
        <LayoutGrid size={19} strokeWidth={1.5} aria-hidden="true" />
        <span>Codex UI</span>
      </button>
      <button
        type="button"
        role="menuitem"
        aria-current={activeView === "settings" ? "true" : undefined}
        className={activeView === "settings" ? "cxpg-osm-codex-menu-item cxpg-osm-codex-menu-item--active" : "cxpg-osm-codex-menu-item"}
        onClick={() => { onSelectView("settings"); onClose(); }}
      >
        <Settings size={19} strokeWidth={1.5} aria-hidden="true" />
        <span>Settings</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="cxpg-osm-codex-menu-item"
        onClick={() => { onExport(); onClose(); }}
      >
        <Download size={19} strokeWidth={1.5} aria-hidden="true" />
        <span>Export</span>
      </button>
      {onImport && (
        <button
          type="button"
          role="menuitem"
          className="cxpg-osm-codex-menu-item"
          onClick={() => { onImport(); onClose(); }}
        >
          <Upload size={19} strokeWidth={1.5} aria-hidden="true" />
          <span>Import</span>
        </button>
      )}
    </div>
  );
}

export function OuronetShellMock({
  children,
  activeView,
  onSelectView,
  onExport,
  onImport,
  onAddressBookRiserSlotChange,
  onPaginationRiserSlotChange,
  onSwipeIndicatorRiserSlotChange,
}: OuronetShellMockProps): ReactElement {
  const barRef = useRef<HTMLDivElement>(null);
  const [codexMenuOpen, setCodexMenuOpen] = useState(false);

  return (
    <div className="cxpg-osm-root">
      {/* ── Mock header — just enough OuronetUI framing to sell "this is
          embedded inside a bigger host", not a replica of the real dashboard
          content (that content belongs to OuronetUI, not this playground). ── */}
      <header className="cxpg-osm-header">
        <span className="cxpg-osm-wordmark">OURONETWORK</span>
        <span className="cxpg-osm-mockbadge" title="Simulated host chrome — not real OuronetUI">
          mock host
        </span>
      </header>

      {/* ── The constrained content area — the rectangle a real embedded
          CodexUI would actually get, NOT the full viewport. This is the whole
          point: it proves CodexUiRoot's container-relative useIsMobile() (see
          MobileContext.tsx) engages correctly even though it is smaller than
          the window. ── */}
      <main className="cxpg-osm-stage">{children}</main>

      {/* Outside tap dismisses the Codex tier-2 menu, mirrors MobileTabBar's
          own transparent dismiss backdrop. */}
      {codexMenuOpen && (
        <button
          type="button"
          aria-label="Close Codex menu"
          className="cxpg-osm-menu-backdrop"
          onClick={() => setCodexMenuOpen(false)}
        />
      )}

      {/* ── The 7-icon bottom tab bar — only "Codex" is live. ── */}
      <div className="cxpg-osm-tabbar-wrap" ref={barRef}>
        <ControlsRiser />
        {/* The Address Book riser SLOT — flush against the tab bar, same
            family as the Controls riser above, mirrored to the right. Empty
            by default; `CodexTabs` (several layers below `children`) portals
            its own trigger button into it via `onAddressBookRiserSlotChange`. */}
        <div className="cxpg-osm-addressbook-riser-slot" ref={onAddressBookRiserSlotChange} />
        {/* The Ouronet Accounts pagination riser SLOT — centered, flush
            against the tab bar, between Controls (left) and Address Book
            (right). Empty by default; `OuronetAccountsTab` portals its
            Prev/Next cluster into it. */}
        <div className="cxpg-osm-pagination-riser-slot" ref={onPaginationRiserSlotChange} />
        {/* The Zone 3 swipe-bullets + EdgeRails SLOT — a SEPARATE band,
            positioned ABOVE the Controls/Pagination/Address Book row, closer
            to Zone 3's own bottom border (owner correction: "the bullet...
            is something beneath Zone 3... a different entity" from the
            Prev/Next pagination stripe). Spans the full width so the
            EdgeRails (edge-docked left/right) and the centered bullets both
            have somewhere to land. */}
        <div className="cxpg-osm-swipe-indicator-riser-slot" ref={onSwipeIndicatorRiserSlotChange} />
        {codexMenuOpen && (
          <CodexTierTwoMenu
            activeView={activeView}
            onSelectView={onSelectView}
            onExport={onExport}
            onImport={onImport}
            onClose={() => setCodexMenuOpen(false)}
          />
        )}
        <nav className="cxpg-osm-tabbar" aria-label="Ouronet sections (mock)">
          {TABS.map(({ key, label, Icon, live }) => (
            <button
              key={key}
              type="button"
              className={live ? "cxpg-osm-tab cxpg-osm-tab--live" : "cxpg-osm-tab cxpg-osm-tab--mock"}
              aria-current={live ? "page" : undefined}
              aria-expanded={live ? codexMenuOpen : undefined}
              disabled={!live}
              title={live ? label : `${label} — unwired mockup`}
              onClick={live ? () => setCodexMenuOpen((v) => !v) : undefined}
            >
              <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Fills THIS root (position: relative) when open — never the viewport. */}
      <ControlsDrawer />
    </div>
  );
}

export default OuronetShellMock;
