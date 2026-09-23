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
 *
 * MOBILE (docs/work/codex-ui-mobile/design.md §8, the "Blockchain Accounts"
 * cleanup round): the desktop wrapping text-pill strip is superseded by a
 * single-line, CENTERED icon-only row (`MobileCategoryIconBtn`, shared with
 * the sibling `ArweavePanel` via codex-ui — the two panels live in different,
 * unrelated packages and can't import from each other) — "we go the same
 * route we did on Ouronet Accounts, we use a row of buttons as icons instead
 * of buttons as text... Chainweb has 3... aligned center on the top of Zone
 * 3." `data-testid`s are unchanged either way. Desktop's own pill strip is a
 * separate branch, byte-identical to before.
 */

import * as React from "react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Sprout, KeySquare, Diamond, PlusCircle, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { useIsMobile, MobileCategoryIconBtn } from "@ancientpantheon/codex-ui/ui";

import type { PanelProps } from "@ancientpantheon/codex-ui";

import { useStoaChainSeeds } from "../../hooks/index.js";
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

/**
 * SplitSeamMedallion — the ACTUAL Codex/Watched + Stoa/UrStoa control (round
 * 8 follow-up — owner correction: "they must be like before split in two
 * parts, as each medallion has basically two buttons, not like they are
 * now, which is a regression of what we had before"). A single
 * `SeamMedallion` that TOGGLED its own label on repeat taps (round 7's
 * design) was more compact, but lost the "two independent buttons, pick
 * either directly" interaction `StoaAccountsTab`'s own inline Codex/Watched
 * pill pair always had — this restores that as a real two-segment pill:
 * both options are always visible and independently tappable, the active
 * one filled solid, the other outlined only. Same seam-straddling geometry
 * as `SeamMedallion` (see its doc comment for the `edge`/`edgeRailTarget`/
 * `offset` reasoning — identical here), just two adjacent buttons sharing
 * one pill shell instead of one.
 */
function SplitSeamMedallion({
  edge, align, accent, edgeRailTarget, offset = 14,
  leftLabel, rightLabel, active, onSelectLeft, onSelectRight,
}: {
  edge: "top" | "bottom";
  align: "left" | "right" | "center";
  accent: string;
  edgeRailTarget?: Element | null;
  offset?: number;
  leftLabel: React.ReactNode;
  rightLabel: React.ReactNode;
  active: "left" | "right";
  onSelectLeft: () => void;
  onSelectRight: () => void;
}) {
  const edgeStyle: React.CSSProperties = edge === "top" ? { top: 0 } : { bottom: 0 };
  const alignStyle: React.CSSProperties =
    align === "center"
      ? { left: "50%", transform: `translate(-50%, ${edge === "top" ? "-50%" : "50%"})` }
      : align === "left"
        ? { left: offset, transform: `translateY(${edge === "top" ? "-50%" : "50%"})` }
        : { right: offset, transform: `translateY(${edge === "top" ? "-50%" : "50%"})` };
  const segmentStyle = (isActive: boolean): React.CSSProperties => ({
    height: 24, padding: "0 10px", border: "none", cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
    backgroundColor: isActive ? accent : "transparent",
    color: isActive ? "#0a0a0a" : accent,
  });
  const pill = (
    <div
      style={{
        position: "absolute",
        ...edgeStyle,
        ...alignStyle,
        display: "flex", borderRadius: 9999, overflow: "hidden",
        border: `1.5px solid ${accent}`, backgroundColor: "#0a0a0a",
        zIndex: 6, boxShadow: "0 2px 6px rgba(0,0,0,0.5)",
        // See `SeamMedallion`'s bug fix #3 — same `pointer-events: none`
        // portal-target inheritance issue applies here.
        pointerEvents: "auto",
      }}
    >
      <button
        type="button"
        onClick={onSelectLeft}
        title={typeof leftLabel === "string" ? leftLabel : undefined}
        style={segmentStyle(active === "left")}
      >
        {leftLabel}
      </button>
      <div style={{ width: 1.5, alignSelf: "stretch", backgroundColor: accent }} />
      <button
        type="button"
        onClick={onSelectRight}
        title={typeof rightLabel === "string" ? rightLabel : undefined}
        style={segmentStyle(active === "right")}
      >
        {rightLabel}
      </button>
    </div>
  );
  return edgeRailTarget ? createPortal(pill, edgeRailTarget) : pill;
}

/** A codex with hundreds of seeds/thousands of accounts can genuinely
 *  paginate into double digits — owner correction (round 9): "when more
 *  than 10 pages exist clicking in the middle on the pages number opens
 *  the ability to input page number to jump directly to wanted page."
 *  Below 10 pages, the plain "N / M" text is unclickable. Duplicated from
 *  `StoaAccountsTab`/`SeedWordsTab`'s identical component per this
 *  package's own "self-contained module" convention. */
function PageJumpIndicator({ page, totalPages, onJump }: { page: number; totalPages: number; onJump: (page: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  if (totalPages <= 10) {
    return <span style={{ fontSize: 11, fontWeight: 700, color: "#d2d3d4" }}>{page + 1} / {totalPages}</span>;
  }
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setDraft(String(page + 1)); setEditing(true); }}
        title="Jump to a page"
        style={{ fontSize: 11, fontWeight: 700, color: "#888", background: "transparent", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline dotted" }}
      >
        {page + 1} / {totalPages}
      </button>
    );
  }
  const commit = () => {
    const n = parseInt(draft, 10);
    if (Number.isFinite(n)) onJump(Math.max(0, Math.min(totalPages - 1, n - 1)));
    setEditing(false);
  };
  return (
    <input
      autoFocus
      type="number"
      min={1}
      max={totalPages}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
      onBlur={commit}
      aria-label={`Jump to page (1-${totalPages})`}
      style={{ width: 36, fontSize: 11, padding: "1px 3px", borderRadius: 4, border: "1px solid #888", backgroundColor: "#0a0a0a", color: "#d2d3d4", textAlign: "center" }}
    />
  );
}

/**
 * PaginationMedallion — round 9's "standard pagination controls zone":
 * "we also need to agree on a standard pagination controls zone. If no
 * expand collapse medallion exists at the middle of the bottom page, where
 * it sits now, that's where the pagination controls should be in their own
 * medallion with prev and next buttons, which should be simple square and
 * with arrows, instead of the name." Same seam-straddling geometry as
 * `SeamMedallion`'s own `edge="bottom" align="center"` (its own doc
 * comment covers the `edgeRailTarget`/clipping/pointer-events reasoning —
 * identical here) — this is that SAME shared slot, just showing pagination
 * instead of the Collapse-All toggle whenever the caller determined that
 * toggle isn't occupying it (see `ChainwebPanel`'s own render logic).
 */
/** How many page-position dots `SwipeBullets` shows at once — beyond this,
 *  it slides a window around the current page and truncates the rest with
 *  an ellipsis (see the component's own doc comment). */
const SWIPE_BULLET_WINDOW = 7;

/**
 * SwipeBullets — round 15 owner correction: "i noticed the pages are
 * swapable, but there are no swap bullets displayed, did you miss them?
 * also remember that the swap bullets should be shortned by placing ...
 * and ... before the bullets and after the bullets, to signal the fact,
 * that there are so many bullets, that we couldnt fit them on the
 * available width." Round 11 added the swipe GESTURE (`onTouchStart`/
 * `onTouchEnd` on the paginated container, in `StoaAccountsTab.tsx`) but
 * never added its visual position indicator — this is that indicator,
 * a small dot per page with the current one lit, mirroring the carousel/
 * gallery convention "swipe bullets" names. A codex can genuinely
 * paginate into the dozens (the SAME "don't paginate irresponsibly"
 * concern `PageJumpIndicator` was built to answer) — showing THAT many
 * raw dots would overflow the medallion's own width, so past
 * `SWIPE_BULLET_WINDOW` pages this slides a window centered on the
 * CURRENT page and renders a leading and/or trailing "…" wherever the
 * window doesn't reach the very first/last page, signaling there are more
 * bullets than fit rather than silently hiding them.
 */
function SwipeBullets({ page, totalPages, onJump }: { page: number; totalPages: number; onJump: (page: number) => void }) {
  if (totalPages <= 1) return null;
  let start = 0;
  let end = totalPages - 1;
  if (totalPages > SWIPE_BULLET_WINDOW) {
    const half = Math.floor(SWIPE_BULLET_WINDOW / 2);
    start = Math.max(0, page - half);
    end = start + SWIPE_BULLET_WINDOW - 1;
    if (end > totalPages - 1) {
      end = totalPages - 1;
      start = end - SWIPE_BULLET_WINDOW + 1;
    }
  }
  const showLeadingEllipsis = start > 0;
  const showTrailingEllipsis = end < totalPages - 1;
  const indices = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  return (
    <div
      role="tablist"
      aria-label="Page position"
      style={{
        position: "absolute", bottom: 0, left: "50%", transform: "translate(-50%, calc(50% + 18px))",
        display: "flex", alignItems: "center", gap: 4,
        height: 14, padding: "0 8px", borderRadius: 9999,
        backgroundColor: "#0a0a0a", border: "1px solid #333",
        zIndex: 6, pointerEvents: "auto",
      }}
    >
      {showLeadingEllipsis && <span aria-hidden="true" style={{ fontSize: 9, color: "#666", lineHeight: 1 }}>…</span>}
      {indices.map((i) => (
        <button
          key={i}
          type="button"
          role="tab"
          aria-label={`Go to page ${i + 1}`}
          aria-selected={i === page}
          onClick={() => onJump(i)}
          style={{
            flexShrink: 0, padding: 0, border: "none", cursor: "pointer", borderRadius: "50%",
            width: i === page ? 8 : 6, height: i === page ? 8 : 6,
            backgroundColor: i === page ? "#ceac5f" : "#444",
          }}
        />
      ))}
      {showTrailingEllipsis && <span aria-hidden="true" style={{ fontSize: 9, color: "#666", lineHeight: 1 }}>…</span>}
    </div>
  );
}

function PaginationMedallion({
  edgeRailTarget, page, totalPages, onPrev, onNext, onJump,
}: {
  edgeRailTarget?: Element | null;
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
  onJump: (page: number) => void;
}) {
  const squareBtn = (disabled: boolean): React.CSSProperties => ({
    display: "flex", alignItems: "center", justifyContent: "center",
    width: 20, height: 20, borderRadius: 4, border: "none", background: "transparent",
    color: disabled ? "#444" : "#d2d3d4", cursor: disabled ? "default" : "pointer", padding: 0,
  });
  const pill = (
    <div
      style={{
        position: "absolute", bottom: 0, left: "50%", transform: "translate(-50%, 50%)",
        display: "flex", alignItems: "center", gap: 6,
        height: 24, padding: "0 8px", borderRadius: 9999,
        backgroundColor: "#0a0a0a", border: "1.5px solid #888",
        zIndex: 6, boxShadow: "0 2px 6px rgba(0,0,0,0.5)",
        // See `SeamMedallion`'s bug fix #3 — same `pointer-events: none`
        // portal-target inheritance issue applies here.
        pointerEvents: "auto",
      }}
    >
      <button type="button" aria-label="Previous page" onClick={onPrev} disabled={page === 0} style={squareBtn(page === 0)}>
        <ChevronLeft size={14} />
      </button>
      <PageJumpIndicator page={page} totalPages={totalPages} onJump={onJump} />
      <button type="button" aria-label="Next page" onClick={onNext} disabled={page >= totalPages - 1} style={squareBtn(page >= totalPages - 1)}>
        <ChevronRight size={14} />
      </button>
    </div>
  );
  // `SwipeBullets` is a SIBLING of the arrows/jump pill above (not nested
  // inside it) so the pill's own existing geometry/styling stays byte-
  // identical — it renders its own independent straddling position,
  // offset further below the same border (see its own `transform`).
  const content = (
    <>
      {pill}
      <SwipeBullets page={page} totalPages={totalPages} onJump={onJump} />
    </>
  );
  return edgeRailTarget ? createPortal(content, edgeRailTarget) : content;
}

export function ChainwebPanel({ fullScreenPortalTarget, zone3AnchorTarget }: PanelProps): React.ReactElement {
  const [active, setActive] = useState<CategoryId>(DEFAULT_CATEGORY);
  const isMobile = useIsMobile();
  // Lifted here SPECIFICALLY so the Seeds category's count + "+" trigger can
  // live on THIS row (design.md §8, the "optimize each blockchain and tab"
  // round: "the seed number aligned on the icon button bar to the left, and
  // the add seed as a plus button appearing aligned on the right... only
  // when seed is selected") — `SeedWordsTab` (a sibling under `content`
  // below, not an ancestor) owns the actual create-modal, driven here via
  // its controlled `createOpen`/`onCreateOpenChange` prop pair. Reading the
  // SAME `useStoaChainSeeds()` hook `SeedWordsTab` itself reads needs no
  // prop plumbing for the count — both components read the same store slice.
  const { seeds } = useStoaChainSeeds();
  const [createSeedOpen, setCreateSeedOpen] = useState(false);
  // Same idea again for Accounts' own count (owner correction, the
  // "further optimize" round: "we add the number on the left side" —
  // pointing at THIS row, mirroring Seeds' own relocation above).
  // `StoaAccountsTab` computes the real (deduped Codex+Watched) total
  // itself and reports it here — replicating that dedup logic in this
  // component would duplicate real logic, not just a simple hook read the
  // way Seeds' plain `seeds.length` was.
  const [accountsTotal, setAccountsTotal] = useState(0);
  // The Accounts category's own refresh control, relocated onto THIS row —
  // owner correction (design.md §8, the "further optimize round 2"): "move
  // the refresh button" up here, right beneath the Blockchain-Accounts
  // EdgeRail this row now sits directly under. `StoaAccountsTab` supplies
  // its live active-hook state/action; this component just renders it.
  const [refreshHandle, setRefreshHandle] = useState<{ refresh: () => void; loading: boolean; error: boolean } | null>(null);
  // The Accounts category's own Codex/Watched + Stoa/UrStoa toggles AND its
  // Collapse-All control, ALL relocated onto the seam this row straddles
  // (design.md §8, the "further optimize round 7") — `StoaAccountsTab`
  // stays the source of truth (controlled prop pair for the two toggles,
  // a reported handle for Collapse-All), this component just renders the
  // three medallions.
  const [accountsSubTab, setAccountsSubTab] = useState<"codex" | "watch">("codex");
  const [accountsBalanceMode, setAccountsBalanceMode] = useState<"stoa" | "urstoa">("stoa");
  // Owner correction (design.md §8, the "further optimize round 8"): "it
  // must contain the exact designation as before, you shortened them" —
  // the medallion needs the SAME "Codex N"/"Watched N" designation the
  // inline pill it replaced always showed, not a bare label.
  const [accountsCounts, setAccountsCounts] = useState({ codex: 0, watch: 0 });
  // Owner correction (design.md §8, round 8 follow-up): "my codex already
  // holds 60 accounts over 12 seeds, which... we should be displaying as
  // m/n+x, m being the number of accounts from seeds, n the number of
  // seeds, and x the number of direct accounts (no seeds) instead of
  // simply 60." `StoaAccountsTab` computes the real composition itself
  // (same "report upward" shape every other count/handle on this row
  // already uses) — this component just formats it.
  const [accountsBreakdown, setAccountsBreakdown] = useState({ seedAccounts: 0, seedCount: 0, directAccounts: 0 });
  // Round 9 "standard pagination controls zone" — the shared bottom-seam
  // medallion shows the Collapse-All toggle when it's visible, otherwise
  // whichever category's pagination handle is currently reported (see
  // `PaginationMedallion`'s own doc comment). Each category reports at
  // most its OWN handle; the other stays `null` while that category isn't
  // mounted (both tabs are conditionally rendered above, so only one of
  // these two setters is ever actually called at a time in practice).
  type PaginationHandle = { page: number; totalPages: number; onPrev: () => void; onNext: () => void; onJump: (page: number) => void } | null;
  const [accountsPaginationHandle, setAccountsPaginationHandle] = useState<PaginationHandle>(null);
  const [seedsPaginationHandle, setSeedsPaginationHandle] = useState<PaginationHandle>(null);
  const [pureKeysPaginationHandle, setPureKeysPaginationHandle] = useState<PaginationHandle>(null);

  const content = (
    <div
      role="tabpanel"
      // MOBILE ONLY (desktop stays byte-identical) — a definite height for
      // `StoaAccountsTab`'s own slot-based pagination engine to measure
      // against (design.md §8, round 8 follow-up: "an engine that detects
      // how many slots per available area it has to work with") — `Seeds`
      // and `Pure Keys` now bound + measure their own height the same way
      // (round 9/10: "we need pagination on the pure keys as well").
      style={isMobile ? { height: "100%" } : undefined}
    >
      {active === "seeds" && (
        <SeedWordsTab
          createOpen={createSeedOpen}
          onCreateOpenChange={setCreateSeedOpen}
          fullScreenPortalTarget={fullScreenPortalTarget}
          onPaginationHandleChange={setSeedsPaginationHandle}
        />
      )}
      {active === "pure-keys" && <PureKeypairsTab onPaginationHandleChange={setPureKeysPaginationHandle} />}
      {active === "accounts" && (
        <StoaAccountsTab
          onTotalChange={setAccountsTotal}
          onRefreshHandleChange={setRefreshHandle}
          fullScreenPortalTarget={fullScreenPortalTarget}
          zone3AnchorTarget={zone3AnchorTarget}
          subTab={accountsSubTab}
          onSubTabChange={setAccountsSubTab}
          balanceMode={accountsBalanceMode}
          onBalanceModeChange={setAccountsBalanceMode}
          onSubTabCountsChange={setAccountsCounts}
          onAccountsBreakdownChange={setAccountsBreakdown}
          onPaginationHandleChange={setAccountsPaginationHandle}
        />
      )}
    </div>
  );

  if (isMobile) {
    return (
      <div
        data-testid="chainweb-panel"
        style={{
          fontFamily: "var(--codex-font, inherit)", color: "#d2d3d4", display: "flex", flexDirection: "column", height: "100%",
          // Owner correction (design.md §8, round 8 follow-up): "we need a
          // bit of spacing for the buttons, so that the medallion doesnt
          // come on top of them" — the Codex/Watched + Stoa/UrStoa pills
          // straddle Zone 3's OWN top border (`zone3AnchorTarget`, half
          // poking DOWN into this exact space), so the category icon row
          // needs enough clearance below that border to never sit under
          // the poking-down half.
          paddingTop: 16,
        }}
      >
        {/* Round 16 owner correction: "space clearly could be optimised
            better, look for my red lines, everything could be pushed a bit
            higher." Unlike the outer wrapper's own `paddingTop` above (a
            documented, tightly-tied clearance for the TOP medallion's own
            poke-down — already close to its minimum), this `marginBottom`
            is ordinary breathing room with no such invariant tied to it —
            trimmed to give the entries list more real vertical room to
            work with, pushing the whole list higher. */}
        <div role="tablist" aria-label="Chainweb categories" style={{ position: "relative", flex: "none", display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
          {/* Count — LEFT of the icon row: seeds while Seeds is active,
              addresses while Accounts is active (Pure Keys has no relocated
              count — it kept its own "Keys (N)" pill on its own row). */}
          <span style={{ minWidth: 30, display: "flex", justifyContent: "center", flexShrink: 0 }}>
            {active === "seeds" && (
              <span
                aria-label={`${seeds.length} seed${seeds.length !== 1 ? "s" : ""}`}
                title={`${seeds.length} seed${seeds.length !== 1 ? "s" : ""}`}
                style={{ fontSize: 13, fontWeight: 700, color: "#22c55e" }}
              >
                {seeds.length}
              </span>
            )}
            {active === "accounts" && (
              <span
                aria-label={`${accountsTotal} address${accountsTotal !== 1 ? "es" : ""} — ${accountsBreakdown.seedAccounts} from ${accountsBreakdown.seedCount} seed group${accountsBreakdown.seedCount !== 1 ? "s" : ""}, ${accountsBreakdown.directAccounts} direct`}
                title={`${accountsTotal} address${accountsTotal !== 1 ? "es" : ""} — ${accountsBreakdown.seedAccounts} from ${accountsBreakdown.seedCount} seed group${accountsBreakdown.seedCount !== 1 ? "s" : ""}, ${accountsBreakdown.directAccounts} direct`}
                style={{ fontSize: 12, fontWeight: 700, color: "#ceac5f", whiteSpace: "nowrap" }}
              >
                {accountsBreakdown.seedAccounts}/{accountsBreakdown.seedCount}+{accountsBreakdown.directAccounts}
              </span>
            )}
          </span>
          <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", gap: 4 }}>
            {CATEGORIES.map((id) => {
              const { label, Icon, color } = CATEGORY_META[id];
              const selected = id === active;
              return (
                <MobileCategoryIconBtn key={id} active={selected} color={color} label={label} onClick={() => setActive(id)}>
                  <Icon style={{ width: 16, height: 16 }} />
                </MobileCategoryIconBtn>
              );
            })}
          </div>
          {/* RIGHT of the icon row (same fixed-width reserved slot as the
              count, so the icon row stays centered regardless of whether
              either side is showing anything): add-seed while Seeds is
              active, refresh while Accounts is active. */}
          <span style={{ width: 30, display: "flex", justifyContent: "center", flexShrink: 0 }}>
            {active === "seeds" && (
              <button
                type="button"
                onClick={() => setCreateSeedOpen(true)}
                aria-label="Create New Seed"
                title="Create New Seed"
                style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: 30, height: 30, borderRadius: 8, cursor: "pointer",
                  border: "1px solid #22c55e55", backgroundColor: "#22c55e1a", color: "#22c55e",
                }}
              >
                <PlusCircle style={{ width: 16, height: 16 }} />
              </button>
            )}
            {active === "accounts" && refreshHandle && (
              <button
                type="button"
                onClick={refreshHandle.refresh}
                aria-label="Refresh balances"
                title={refreshHandle.error ? "Balance read failed — tap to retry" : "Refresh balances"}
                style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: 30, height: 30, borderRadius: 8, cursor: "pointer",
                  border: `1px solid ${refreshHandle.error ? "#8b1a1a" : "#ceac5f55"}`,
                  backgroundColor: refreshHandle.error ? "#8b1a1a1a" : "#ceac5f1a",
                  color: refreshHandle.error ? "#c0392b" : "#ceac5f",
                }}
              >
                <RefreshCw style={{ width: 16, height: 16, animation: refreshHandle.loading ? "spin 1s linear infinite" : undefined }} />
              </button>
            )}
          </span>
          {active === "accounts" && (
            <>
              {/* Zone 3's OWN top border, half above/half below (owner
                  correction, round 8 follow-up: "they must be placed on
                  the line, with half the medallion above and half
                  below") — `zone3AnchorTarget`'s own top edge IS that
                  visible border line exactly (see its doc comment on
                  `PanelProps`), so `edge="top"` is correct whether portaled
                  there OR falling back to this local tablist (whose own
                  top border is the SAME semantic line, just pre-fix/
                  clippable). */}
              <SplitSeamMedallion
                edge="top"
                align="left"
                offset={20}
                accent="#ceac5f"
                edgeRailTarget={zone3AnchorTarget}
                active={accountsSubTab === "codex" ? "left" : "right"}
                leftLabel={`Codex ${accountsCounts.codex}`}
                rightLabel={`Watched ${accountsCounts.watch}`}
                onSelectLeft={() => setAccountsSubTab("codex")}
                onSelectRight={() => setAccountsSubTab("watch")}
              />
              <SplitSeamMedallion
                edge="top"
                align="right"
                offset={20}
                accent="#ceac5f"
                edgeRailTarget={zone3AnchorTarget}
                active={accountsBalanceMode === "stoa" ? "left" : "right"}
                leftLabel="Stoa"
                rightLabel="UrStoa"
                onSelectLeft={() => setAccountsBalanceMode("stoa")}
                onSelectRight={() => setAccountsBalanceMode("urstoa")}
              />
              {/* Zone 3's OWN bottom border, half above/half below — owner
                  correction (round 8 follow-up): "the expand/collapse
                  medallion needs to be placed on the lower line of the
                  zone 3 rectangle... half above the line and half below
                  it," NOT the tablist bar's own local bottom (which is
                  what this used to anchor to, and reads as "still up near
                  the top" once compared against the whole Zone 3
                  rectangle). `zone3AnchorTarget`'s own BOTTOM edge is the
                  rectangle's real visible bottom border. */}
              {/* Round 11 — Collapse-All is GONE from mobile entirely (the
                  Codex list is now a flat, fixed-height, seed-badged list —
                  see `StoaAccountsTab`'s own `codexFlatEntries` doc
                  comment — so there's nothing left to collapse). This slot
                  is therefore UNCONDITIONALLY the pagination medallion's. */}
              {accountsPaginationHandle && (
                <PaginationMedallion
                  edgeRailTarget={zone3AnchorTarget}
                  page={accountsPaginationHandle.page}
                  totalPages={accountsPaginationHandle.totalPages}
                  onPrev={accountsPaginationHandle.onPrev}
                  onNext={accountsPaginationHandle.onNext}
                  onJump={accountsPaginationHandle.onJump}
                />
              )}
            </>
          )}
          {/* Seeds NEVER has a Collapse-All medallion of its own ("there is
              no expand collapse button, clicking seed brings it content
              full screen") — the shared slot is always free for its own
              pagination whenever it has more than one page. */}
          {active === "seeds" && seedsPaginationHandle && (
            <PaginationMedallion
              edgeRailTarget={zone3AnchorTarget}
              page={seedsPaginationHandle.page}
              totalPages={seedsPaginationHandle.totalPages}
              onPrev={seedsPaginationHandle.onPrev}
              onNext={seedsPaginationHandle.onNext}
              onJump={seedsPaginationHandle.onJump}
            />
          )}
          {/* Pure Keys is ALSO a flat list with no Collapse-All medallion —
              round 9/10 owner correction: "we need pagination on the pure
              keys as well, which should kick in once enough entries
              exist." */}
          {active === "pure-keys" && pureKeysPaginationHandle && (
            <PaginationMedallion
              edgeRailTarget={zone3AnchorTarget}
              page={pureKeysPaginationHandle.page}
              totalPages={pureKeysPaginationHandle.totalPages}
              onPrev={pureKeysPaginationHandle.onPrev}
              onNext={pureKeysPaginationHandle.onNext}
              onJump={pureKeysPaginationHandle.onJump}
            />
          )}
        </div>
        {/* `scrollSnapType` here is inert unless a child opts in via its own
            `scrollSnapAlign` (SeedRow's card, and `StoaAccountsTab`'s own
            GroupRow/AddressRow, all mobile-only — design.md §8, the
            "further optimize round 5": "we show only full entry pieces" —
            the list settles on a whole-row boundary instead of resting
            mid-row) — so Pure Keys, whose rows don't opt in, scrolls
            exactly as before. `mandatory` (round 8 owner correction: "i
            dont want to see cut entries" — `proximity` only snaps near a
            boundary, so a scroll gesture could still come to rest mid-row;
            `mandatory` forces every scroll to end ON a snap point, never
            between two).

            Round 8 follow-up — a JS-ENFORCED backstop
            (`useSnapScrollCorrection`) was tried on top of this CSS
            mechanism and REMOVED again: it actively fought the user's own
            scroll gesture across three separate live-reported regressions
            in a row (an animated-scroll feedback loop, a boundary-clamping
            bug, an oversized-candidate bug, then this: "once i colapse a
            seed... i scroll and it moves me... the hook behave eratically"
            — each fix for the previous one produced a NEW variant of the
            same class of bug). The CSS-only mechanism below was never
            itself reported as fighting the user — only as occasionally
            (not always) failing to re-snap after a fling on some WebViews,
            a strictly smaller failure mode than "actively wrong." Plain
            CSS scroll-snap, no JS correction, stays the mechanism here. */}
        <div
          style={{
            flex: 1, minHeight: 0, overflowY: "auto", scrollSnapType: "y mandatory",
            // Originally sized as clearance for the (round-11-removed)
            // Collapse-All pill straddling Zone 3's OWN bottom border. Round
            // 15's `PaginationMedallion` + `SwipeBullets` that now
            // UNCONDITIONALLY occupy this slot are portaled straight to
            // `zone3AnchorTarget` — an EXTERNAL node, not a descendant of
            // this scrollable wrapper — so they are never actually clipped
            // by anything here; this padding only ever reserved VISUAL
            // breathing room between the last entry and wherever they sit,
            // not a hard functional requirement. Round 16 owner correction:
            // "below clearly there is enough room for another entry" —
            // trimmed to give the paginated container real height back,
            // which `useSlotPageSize` measures live and will use to fit
            // one more whole row when it genuinely fits.
            paddingBottom: 8,
          }}
        >{content}</div>
      </div>
    );
  }

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

      {content}
    </div>
  );
}

export default ChainwebPanel;
