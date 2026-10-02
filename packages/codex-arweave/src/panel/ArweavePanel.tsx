/**
 * ArweavePanel — the Arweave chain panel contributed into codex-ui's generic
 * `ForeignChainsTab` slot.
 *
 * Conforms to codex-ui's chain-agnostic `PanelProps` (`{ id, ctx? }`, imported
 * TYPE-ONLY via the bare package name so the edge erases at build), so the E5
 * consumer can wire `foreignChainPanels[ARWEAVE_CHAIN_ID] = ArweavePanel`. It
 * hosts the chain's own CATEGORY strip — the Class IA spine (Seeds / Pure Keys /
 * Accounts) plus the two Arweave-specific categories (Upload / Library) — over
 * the existing areas, and reads its E1-E3 seams from the panel context; the
 * codex-ui slot stays chain-blind; the Arweave panel obtains its own seams here.
 * `seeds` is the ONE category with no implementation (seeded RSA-4096 keygen is
 * deferred): it renders an explicit "not yet wired" placeholder, never a blank
 * panel and never a throw.
 *
 * The category id vocabulary is namespaced off the ARWEAVE_CHAIN_ID const — the
 * chain id string is never re-spelled here.
 *
 * SEED STATE IS THE HOST'S, not this panel's. Switching the Class-2 chain rail
 * unmounts the WHOLE panel, so a seed kept in panel state was destroyed on every
 * chain switch while the RSA keys it produced survived in the codex — orphans no
 * seed could ever regenerate. The panel therefore READS the seeds from the
 * injected deps (`arweaveSeeds`) and DELEGATES define/delete outward
 * (`onSeedDefined` / `onDeleteSeed`), so the codex owns them.
 *
 * What stays local is the SESSION overlay: a seed defined in this session is
 * also kept here, because its record carries the plaintext bitstring the
 * generate flow needs and the host's copy is ciphertext at rest. The overlay is
 * merged ON TOP of the host list by id, and pruned on delete so a deleted seed
 * cannot come back. A host that wires neither seam still gets the previous
 * session-only behaviour — degraded, never broken.
 *
 * The panel is also the only place that can hand the SAME seed list to both
 * wired categories, so Accounts can group keys under the seed that produced them.
 *
 * MOBILE (docs/work/codex-ui-mobile/design.md §8, the "Blockchain Accounts"
 * cleanup round): the desktop wrapping text-pill strip is superseded by a
 * single-line, CENTERED icon-only row (`MobileCategoryIconBtn`, imported from
 * `@ancientpantheon/codex-ui/ui` — a VALUE import, unlike the glyphs below,
 * which stay hand-rolled SVGs specifically to avoid `lucide-react`'s own
 * dual-React-instance resolution bug; `MobileCategoryIconBtn`/`useIsMobile`
 * import neither `lucide-react` nor any icon package themselves, so that
 * bug does not apply here) — "we go the same route we did on Ouronet
 * Accounts... Arweave has 5... aligned center on the top of Zone 3." The
 * generation-guard interception (`requestCategory`, the leave-generation
 * dialog) is unchanged and shared by both the desktop and mobile strips —
 * the mobile icon buttons call the SAME `requestCategory` callback, not a
 * bare `setActive`. Desktop's own pill strip is a separate branch,
 * byte-identical to before.
 */

import * as React from "react";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import type { PanelProps } from "@ancientpantheon/codex-ui";
import { useIsMobile, MobileCategoryIconBtn } from "@ancientpantheon/codex-ui/ui";
import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";
import type { WatchListEntry } from "@ancientpantheon/codex-ouronet/types";
import { useEnsureCodexUnlockedOptional } from "@ancientpantheon/codex-ouronet/zbom";

import { ARWEAVE_CHAIN_ID } from "../address-book/chainId.js";
import type { LibraryEntry } from "../library/types.js";
import { ArweavePanelContext } from "./context.js";
import { ArweaveAccountsArea } from "./ArweaveAccountsArea.js";
import { PureKeysArea } from "./PureKeysArea.js";
import { UploadWizard } from "./UploadWizard.js";
import { LibraryArea } from "./LibraryArea.js";
import { LibraryAutoRebuildProgress } from "./LibraryAutoRebuildProgress.js";
import { CodexBackupArea } from "./CodexBackupArea.js";
import { CodexBackupHistoryArea } from "./CodexBackupHistoryArea.js";
import { ArweaveRestoreEligibilityStatus } from "./ArweaveRestoreEligibilityStatus.js";
import {
  ArweaveSeedsArea,
  type ArweaveSeedDeletion,
  type ArweaveSeedRecord,
  type GeneratedArweaveKey,
} from "./ArweaveSeedsArea.js";


/**
 * The store-backed seed seams the HOST wires alongside `ArweavePanelDeps`.
 *
 * Read STRUCTURALLY (a narrowing of the injected deps object) rather than
 * declared on `ArweavePanelDeps` itself: that interface lives in `context.tsx`,
 * which this change does not own. Both members are optional, so a host that
 * wires neither is exactly the old session-only panel; the playground wiring
 * types them explicitly on its own deps bundle. Fold them into
 * `ArweavePanelDeps` (and drop this local shape) when that file is next open.
 */
interface ArweaveSeedStoreSeams {
  /** The codex's persisted Arweave seeds — the list that survives a chain
   *  switch. Their `bits` are whatever the host could resolve (the codex stores
   *  the seed as CIPHERTEXT; an unlocked host decrypts, a locked one cannot). */
  arweaveSeeds?: readonly ArweaveSeedRecord[];
  /** Persists a newly defined seed into the codex. Absent → session-only. */
  onSeedDefined?: (seed: ArweaveSeedRecord) => Promise<void> | void;
}

/**
 * The store-backed watch-list seams the HOST wires alongside `ArweavePanelDeps`
 * (T1) — same structural-narrowing pattern as {@link ArweaveSeedStoreSeams}.
 *
 * Reused from Chainweb's own `watchList` store slice (design.md), filtered to
 * this chain's WatchListEntry.type value by the host wiring — this panel
 * never reads a store itself. `ForeignChainsWiring.tsx`'s `WiredArweavePanelDeps` types the values
 * `| undefined` rather than declaring the keys optional (`?:`), so they are
 * read the same way here: present, but possibly unwired.
 */
interface ArweaveWatchListSeams {
  watchedAddresses: WatchListEntry[];
  addWatchedAddress: (address: string, label?: string) => Promise<void>;
  removeWatchedAddress: (id: string) => Promise<void>;
}

/** A STABLE empty fallback for `watchedEntries` when `watchSeams` isn't
 *  wired — root-caused via a live diagnostic (round 10): `watchSeams
 *  ?.watchedAddresses ?? []` constructs a BRAND NEW array literal on every
 *  single render when the seam is unwired. `ArweaveAccountsArea`'s own
 *  `addresses` is a `useMemo` keyed on `[entries, watchedEntries]` — a
 *  "new" (but content-identical) `watchedEntries` reference on every
 *  render makes `addresses` recompute every render too, which makes
 *  `refreshAllBalances` (keyed on `addresses`) a new function every
 *  render, which makes its own "fetch on mount" effect (keyed on
 *  `[refreshAllBalances]`) treat EVERY render as a fresh mount and refire
 *  `fetchBalances` synchronously — which reports `loading: true` back up
 *  via `onRefreshHandleChange`, updating THIS component's own state,
 *  triggering another render, recreating another "new" `[]`... a true
 *  synchronous infinite render loop (confirmed via a live counter: tens of
 *  thousands of renders per second, `loading` permanently stuck `true`
 *  since the render loop never yields long enough for the real
 *  `getBalance()` promise to resolve). A single shared, referentially
 *  stable empty array breaks the cycle at its root. */
const EMPTY_WATCHED_ENTRIES: WatchListEntry[] = [];


/** The Arweave chain's declared categories, in display order. */
const CATEGORIES = ["seeds", "pure-keys", "accounts", "upload", "library"] as const;
type CategoryId = (typeof CATEGORIES)[number];

/** Human labels for the category strip. */
const CATEGORY_LABELS: Record<CategoryId, string> = {
  seeds: "Seeds",
  "pure-keys": "Pure Keys",
  accounts: "Accounts",
  upload: "Upload",
  library: "Library",
};


/** Inline category glyphs. Deliberately NOT `lucide-react`: that package lives
 *  only at the repo root, where `react` resolves to the stale hoisted React 18,
 *  so importing it renders elements from a second React ("A React Element from
 *  an older version of React was rendered"). These few local SVGs keep the panel
 *  free of any icon-package resolution while matching lucide's stroke look. */
type Glyph = (p: { style?: React.CSSProperties }) => React.ReactElement;

const svgBase = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const SeedsGlyph: Glyph = ({ style }) => (
  <svg {...svgBase} style={style}><path d="M7 20h10" /><path d="M12 20V9" /><path d="M12 9a5 5 0 0 1 5-5h3v3a5 5 0 0 1-5 5h-3Z" /><path d="M12 12H9a4 4 0 0 1-4-4V6h3a4 4 0 0 1 4 4v2Z" /></svg>
);
const KeysGlyph: Glyph = ({ style }) => (
  <svg {...svgBase} style={style}><circle cx="8" cy="15" r="4" /><path d="m10.85 12.15 7.4-7.4" /><path d="m18 5 3 3" /><path d="m15 8 2 2" /></svg>
);
const AccountsGlyph: Glyph = ({ style }) => (
  <svg {...svgBase} style={style}><path d="M12 2 22 12 12 22 2 12Z" /></svg>
);
const UploadGlyph: Glyph = ({ style }) => (
  <svg {...svgBase} style={style}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8 12 3 7 8" /><path d="M12 3v13" /></svg>
);
const LibraryGlyph: Glyph = ({ style }) => (
  <svg {...svgBase} style={style}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /></svg>
);
/** The Accounts category's relocated refresh button — same glyph
 *  `ArweaveAccountsArea.tsx`'s own `RefreshGlyph` uses (module JSDoc: this
 *  module stays self-contained, so it is duplicated rather than imported). */
const RefreshGlyph: Glyph = ({ style }) => (
  <svg {...svgBase} style={style}><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
);
/** The pagination medallion's square Prev/Next arrows (round 9 owner
 *  correction: "prev and next buttons, which should be simple square and
 *  with arrows, instead of the name") — hand-rolled per this module's own
 *  inline-SVG rule. */
const ChevronLeftGlyph: Glyph = ({ style }) => (
  <svg {...svgBase} style={style}><path d="m15 18-6-6 6-6" /></svg>
);
const ChevronRightGlyph: Glyph = ({ style }) => (
  <svg {...svgBase} style={style}><path d="m9 18 6-6-6-6" /></svg>
);
/** The Seeds category's relocated "add seed" button (mirrors
 *  `ChainwebPanel.tsx`'s own `PlusCircle` in the same tablist right-slot) —
 *  hand-rolled per this module's own inline-SVG rule. */
const PlusGlyph: Glyph = ({ style }) => (
  <svg {...svgBase} style={style}><circle cx="12" cy="12" r="10" /><path d="M12 8v8" /><path d="M8 12h8" /></svg>
);

/** Icon + accent per category. Seeds / Pure Keys / Accounts deliberately reuse
 *  ChainwebPanel's colours so a shared category name reads the same on every
 *  chain; Upload / Library are Arweave-only and take their own accents. */
const CATEGORY_META: Record<CategoryId, { Icon: Glyph; color: string }> = {
  seeds: { Icon: SeedsGlyph, color: "#22c55e" },
  "pure-keys": { Icon: KeysGlyph, color: "#a78bfa" },
  accounts: { Icon: AccountsGlyph, color: "#ceac5f" },
  upload: { Icon: UploadGlyph, color: "#38bdf8" },
  library: { Icon: LibraryGlyph, color: "#f472b6" },
};

/** Category-button height. Matches the chain rail's row height in codex-ui's
 *  ForeignChainsTab so the vertical menu and this strip share a baseline. Kept
 *  local rather than imported: a layout number is not worth widening codex-ui's
 *  locked public surface. */
const CATEGORY_ROW_HEIGHT = 40;

/**
 * SplitSeamMedallion — "the same structure and design and placement of
 * buttons as what we did for chainweb": ported from
 * `packages/codex-ouronet/src/ui/chains/ChainwebPanel.tsx` rather than
 * imported — both that file and this one already follow a deliberate
 * "self-contained module, nothing shared across chain-panel packages"
 * convention (see this file's own module doc on `lucide-react` /
 * hand-rolled glyphs), and `codex-arweave` cannot import from
 * `codex-ouronet` (unrelated packages) regardless. See `ChainwebPanel.tsx`'s
 * own doc comments on this function for the full history of bugs this
 * exact geometry/click/clipping design fixes — `zone3AnchorTarget`'s OWN
 * border box, `pointer-events: auto` on the portaled badge, `edge`'s
 * `top: 0`/`bottom: 0` being the ACTUAL visible border lines.
 *
 * `SplitSeamMedallion` is the ONLY variant Arweave needs for its Codex/
 * Watched toggle — Arweave has only ONE balance kind (native AR), so there
 * is no Stoa/UrStoa-equivalent second toggle the way Chainweb needs one.
 * Round 11 removed the single-button `SeamMedallion` variant entirely: its
 * only caller was the Collapse-All medallion, and round 11 removed
 * Collapse-All from mobile altogether (the Accounts list is now a flat,
 * fixed-height, seed-badged list — see `ArweaveAccountsArea`'s own
 * `codexFlatEntries` doc comment — so there's nothing left to collapse).
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
        pointerEvents: "auto",
      }}
    >
      <button type="button" onClick={onSelectLeft} title={typeof leftLabel === "string" ? leftLabel : undefined} style={segmentStyle(active === "left")}>
        {leftLabel}
      </button>
      <div style={{ width: 1.5, alignSelf: "stretch", backgroundColor: accent }} />
      <button type="button" onClick={onSelectRight} title={typeof rightLabel === "string" ? rightLabel : undefined} style={segmentStyle(active === "right")}>
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
 *  `ArweaveAccountsArea`/`ArweaveSeedsArea`'s identical component per this
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
 * toggle isn't occupying it (see `ArweavePanel`'s own render logic).
 * Ported from `ChainwebPanel.tsx` rather than imported, per this module's
 * own "self-contained" convention.
 */
/** How many page-position dots `SwipeBullets` shows at once — beyond this,
 *  it slides a window around the current page and truncates the rest with
 *  an ellipsis (see the component's own doc comment). */
const SWIPE_BULLET_WINDOW = 7;

/**
 * SwipeBullets — round 15 owner correction (ported from `ChainwebPanel.tsx`'s
 * identical change): "i noticed the pages are swapable, but there are no
 * swap bullets displayed, did you miss them? also remember that the swap
 * bullets should be shortned by placing ... and ... before the bullets and
 * after the bullets, to signal the fact, that there are so many bullets,
 * that we couldnt fit them on the available width." Round 11 added the
 * swipe GESTURE (`onTouchStart`/`onTouchEnd` on the paginated container,
 * in `ArweaveAccountsArea.tsx`) but never added its visual position
 * indicator — this is that indicator. Past `SWIPE_BULLET_WINDOW` pages
 * this slides a window centered on the CURRENT page and renders a leading
 * and/or trailing "…" wherever the window doesn't reach the very
 * first/last page.
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
        <ChevronLeftGlyph style={{ width: 14, height: 14 }} />
      </button>
      <PageJumpIndicator page={page} totalPages={totalPages} onJump={onJump} />
      <button type="button" aria-label="Next page" onClick={onNext} disabled={page >= totalPages - 1} style={squareBtn(page >= totalPages - 1)}>
        <ChevronRightGlyph style={{ width: 14, height: 14 }} />
      </button>
    </div>
  );
  // `SwipeBullets` is a SIBLING of the arrows/jump pill above (not nested
  // inside it) so the pill's own existing geometry/styling stays byte-
  // identical — it renders its own independent straddling position,
  // offset further below the same border.
  const content = (
    <>
      {pill}
      <SwipeBullets page={page} totalPages={totalPages} onJump={onJump} />
    </>
  );
  return edgeRailTarget ? createPortal(content, edgeRailTarget) : content;
}

/** Styling for the seed-persistence failure notice — the one surface that
 *  reports a seed the Codex refused to store. */
const SEED_ERROR_STYLE: React.CSSProperties = {
  marginBottom: 12,
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #7f1d1d",
  backgroundColor: "#7f1d1d1a",
  color: "#fca5a5",
  fontSize: 13,
};

/** Placeholder styling for an unwired category — visible, never blank. */
const EMPTY_STYLE: React.CSSProperties = {
  padding: "24px",
  borderRadius: 12,
  border: "1px dashed #262626",
  color: "#666",
  fontSize: 13,
};

/** The Upload category's own entry-point buttons (`arweave-upload-wizard`,
 *  T3) — replaces the old always-visible flat `UploadArea` form. */
const UPLOAD_ENTRY_WRAP_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  maxWidth: 360,
};

const UPLOAD_ENTRY_BUTTON_STYLE: React.CSSProperties = {
  padding: "14px 18px",
  borderRadius: 12,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  textAlign: "left",
  border: `1px solid ${CATEGORY_META.upload.color}`,
  backgroundColor: `${CATEGORY_META.upload.color}1a`,
  color: CATEGORY_META.upload.color,
};

/**
 * The Library category's own "General Data" / "Codex" tab switcher
 * (`arweave-upload-library` follow-up redesign — owner's own words: "lets
 * make two Tabs here, General Data and Codex, separate on their own
 * display"). Mirrors the TOP-LEVEL category strip's own per-tab button
 * shape EXACTLY (`desktopStrip` below) — same pill geometry, same
 * selected/unselected border+background+color formula — just one accent
 * (`CATEGORY_META.library.color`) and no icon, since this is a sub-tab of
 * the already-icon-labeled "Library" category, not a second category rail.
 */
const LIBRARY_TABS = ["general", "codex"] as const;
type LibraryTabId = (typeof LIBRARY_TABS)[number];
const LIBRARY_TAB_LABELS: Record<LibraryTabId, string> = {
  general: "General Data",
  codex: "Codex",
};
const LIBRARY_TAB_ROW_STYLE: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
  marginBottom: 16,
};
function libraryTabButtonStyle(selected: boolean): React.CSSProperties {
  const color = CATEGORY_META.library.color;
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: CATEGORY_ROW_HEIGHT,
    padding: "0 16px",
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    border: `1px solid ${selected ? color : "#262626"}`,
    backgroundColor: selected ? `${color}1a` : "transparent",
    color: selected ? color : "#888",
    whiteSpace: "nowrap",
  };
}

/** "Back Up Codex to Arweave" has no destination yet (its real target — the
 *  Codex Upload wizard — lives on the not-yet-built Codex ID page, a later
 *  topic), so it renders as a visibly-disabled "coming soon" affordance
 *  rather than a button that silently does nothing on click — mirrors
 *  `codex-ui`'s own `IconOuronetExplorerBtn` "(coming soon)" disabled-button
 *  convention. */
const UPLOAD_ENTRY_BUTTON_DISABLED_STYLE: React.CSSProperties = {
  ...UPLOAD_ENTRY_BUTTON_STYLE,
  cursor: "not-allowed",
  opacity: 0.4,
  border: "1px solid #444",
  backgroundColor: "transparent",
  color: "#888",
};

/** The full-panel backdrop behind the leave-generation confirm dialog (design.md
 *  ask A) — dims the tab strip and whichever area is still mounted underneath,
 *  so the choice reads as blocking rather than an inline aside. */
const LEAVE_DIALOG_BACKDROP_STYLE: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  backgroundColor: "#000000a0",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 50,
};

const LEAVE_DIALOG_STYLE: React.CSSProperties = {
  width: 380,
  maxWidth: "90vw",
  padding: 20,
  borderRadius: 12,
  border: "1px solid #262626",
  backgroundColor: "#111111",
  color: "#d2d3d4",
};

const LEAVE_DIALOG_BUTTON_ROW_STYLE: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
  marginTop: 16,
};

const LEAVE_DIALOG_STOP_BUTTON_STYLE: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid #7f1d1d",
  backgroundColor: "transparent",
  color: "#fca5a5",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const LEAVE_DIALOG_CONTINUE_BUTTON_STYLE: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid #ceac5f",
  backgroundColor: "#ceac5f",
  color: "#0a0a0a",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

/** The category the panel lands on — the one a user reaches for first. */
const DEFAULT_CATEGORY: CategoryId = "accounts";

export function ArweavePanel({ fullScreenPortalTarget, zone3AnchorTarget }: PanelProps): React.ReactElement {
  const [active, setActive] = useState<CategoryId>(DEFAULT_CATEGORY);
  const isMobile = useIsMobile();
  // Round 22 owner correction: "then i think we have a problem here when
  // attempting to show RSA details" — see
  // `ArweaveSeedsAreaProps.ensureCodexUnlocked`'s own doc comment for why
  // this is threaded down as an injected prop rather than
  // `ArweaveSeedsArea`/`useRsaParamsSection` calling it directly. The
  // OPTIONAL variant, not the throwing one `SendArweaveModal` uses —
  // `ArweavePanel` ITSELF is deliberately mountable with zero providers at
  // all (its own "degrades to a visible 'not available' state rather than
  // crashing when no provider is wired" test) — `null` here just means
  // "no real gate available," which `ArweaveSeedsArea`'s own
  // `ensureCodexUnlocked` prop already treats as "proceed straight to
  // decrypt," unchanged from before this round.
  const ensureCodexUnlocked = useEnsureCodexUnlockedOptional();
  // Accounts' own relocated controls — same "report upward, don't
  // duplicate the underlying logic" shape `ChainwebPanel.tsx` uses for
  // `StoaAccountsTab` ("same structure and design and placement of
  // buttons as what we did for chainweb"). `ArweaveAccountsArea` stays the
  // source of truth; this component just renders the medallions/buttons.
  const [accountsTotal, setAccountsTotal] = useState(0);
  const [refreshHandle, setRefreshHandle] = useState<{ refresh: () => void; loading: boolean; error: boolean } | null>(null);
  const [accountsSubTab, setAccountsSubTab] = useState<"codex" | "watch">("codex");
  const [accountsCounts, setAccountsCounts] = useState({ codex: 0, watch: 0 });
  const [accountsBreakdown, setAccountsBreakdown] = useState({ seedAccounts: 0, seedCount: 0, directAccounts: 0 });
  // Round 9/11 "standard pagination controls zone" — the shared bottom-seam
  // medallion shows whichever category's pagination handle is currently
  // reported. Round 11 removed Collapse-All from mobile entirely (see
  // `ArweaveAccountsArea`'s own `codexFlatEntries` doc comment), so this
  // slot is now UNCONDITIONALLY pagination's for the Accounts category too
  // — mirrors `ChainwebPanel.tsx`'s own identical state exactly.
  type PaginationHandle = { page: number; totalPages: number; onPrev: () => void; onNext: () => void; onJump: (page: number) => void } | null;
  const [accountsPaginationHandle, setAccountsPaginationHandle] = useState<PaginationHandle>(null);
  const [seedsPaginationHandle, setSeedsPaginationHandle] = useState<PaginationHandle>(null);
  // Seeds' own relocated "+" add-seed button (mirrors `ChainwebPanel.tsx`'s
  // `setCreateSeedOpen` lift for `SeedWordsTab`) — "same structure and
  // design and placement of buttons as what we did for chainweb", round 20
  // owner correction. Unlike Chainweb's separate, remountable
  // `CreateStoaChainSeedModal`, `ArweaveSeedsArea`'s define form is inline,
  // per-field state that only `openDefine` knows how to reset correctly —
  // so rather than lifting a raw open/close boolean (which would skip that
  // reset), `ArweaveSeedsArea` reports its OWN `openDefine` function up here,
  // same "report a handle upward" shape `onPaginationHandleChange` already
  // uses throughout this file.
  const [openSeedFormHandle, setOpenSeedFormHandle] = useState<(() => void) | null>(null);
  const [pureKeysPaginationHandle, setPureKeysPaginationHandle] = useState<PaginationHandle>(null);
  /** Upload's own entry-point state (`arweave-upload-wizard`, T3) — the
   *  Upload category has no other modal-ish open/close state of its own to
   *  mirror in this file (Accounts' `SendArweaveModal` and Seeds' define
   *  form each own their local open/close state INSIDE their own area
   *  component, not lifted here), so this is a plain `useState`, the same
   *  way `ArweaveSeedsArea`/`PureKeysArea`'s own internal modal toggles work. */
  const [uploadWizardOpen, setUploadWizardOpen] = useState(false);
  /** The Library category's own "General Data" / "Codex" sub-tab — defaults
   *  to "general" so the owner never lands on the Library category and sees
   *  an empty screen (the Codex tab's own content is nothing until a backup
   *  actually exists). Local to this component, same as `accountsSubTab`'s
   *  own "report upward from a sibling area, keep the switch itself here"
   *  shape — except Library's two tabs are two WHOLE areas, not two sub-views
   *  of one area, so there is no child component to report a handle from. */
  const [libraryTab, setLibraryTab] = useState<LibraryTabId>("general");

  /** The Seeds area's live run, reported up via `ArweaveSeedsArea`'s
   *  `onRunActivityChange` (T1) — non-null exactly while a generate run has
   *  `status === "running"`. Read by the tab strip below to intercept a
   *  category switch that would otherwise abandon it silently (design.md ask A:
   *  unmounting the area does not stop the worker, it just makes it invisible
   *  and uncancelable). */
  const [activeGeneration, setActiveGeneration] = useState<
    { seedLabel: string; cancel: () => void } | null
  >(null);
  /** The category a tab click asked for while `activeGeneration !== null` — set
   *  the moment the leave-generation dialog opens, applied once the user picks
   *  "Stop" or "Continue", and cleared either way. */
  const [pendingCategory, setPendingCategory] = useState<CategoryId | null>(null);

  /** Requests a switch to `id`. The `seeds` tab and a switch with no run active
   *  both proceed immediately, exactly as before this task — only a switch AWAY
   *  from an in-flight generation is intercepted. */
  const requestCategory = useCallback(
    (id: CategoryId): void => {
      if (id === "seeds" || activeGeneration === null) {
        setActive(id);
        return;
      }
      setPendingCategory(id);
    },
    [activeGeneration],
  );

  const handleStopGeneration = useCallback((): void => {
    activeGeneration?.cancel();
    setActiveGeneration(null);
    if (pendingCategory !== null) setActive(pendingCategory);
    setPendingCategory(null);
  }, [activeGeneration, pendingCategory]);

  const handleContinueInBackground = useCallback((): void => {
    // Deliberately does NOT call `cancel()` — the whole point of this choice is
    // that the run keeps going. `activeGeneration` is left as-is: the area may
    // still report it live (background run) or settle it to `null` on its own.
    if (pendingCategory !== null) setActive(pendingCategory);
    setPendingCategory(null);
  }, [pendingCategory]);

  // If the run settles on its own (finishes/errors/is cancelled elsewhere)
  // WHILE a switch is pending — between the tab click and the user picking
  // "Stop"/"Continue", or even before the dialog has painted — there is no
  // longer a background run to warn about, so the pending switch is applied
  // rather than left stranded with the dialog closed and `active` never
  // updated (a click that silently did nothing).
  useEffect(() => {
    if (activeGeneration === null && pendingCategory !== null) {
      setActive(pendingCategory);
      setPendingCategory(null);
    }
  }, [activeGeneration, pendingCategory]);

  // Native browser prompt for the OTHER way to abandon a run: closing the tab
  // or refreshing. `beforeunload` cannot show custom copy — only the browser's
  // own "leave site?" chrome — so this is intentionally the bare standard
  // pattern, not an attempt at the dialog above.
  useEffect(() => {
    if (activeGeneration === null) return;
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [activeGeneration]);

  // The injected seams, read OPTIONALLY (not through `useArweavePanelDeps`,
  // which throws): a consumer that has not wired the provider yet still gets a
  // working read-only panel rather than a crash.
  const deps = useContext(ArweavePanelContext);

  /** The host's store-backed seed seams (see {@link ArweaveSeedStoreSeams}). */
  const seedSeams = deps as (typeof deps & ArweaveSeedStoreSeams) | null;

  /** The host's store-backed watch-list seams (see {@link ArweaveWatchListSeams}). */
  const watchSeams = deps as (typeof deps & ArweaveWatchListSeams) | null;

  /** Seeds defined in THIS session, kept as an overlay over the host list: the
   *  record carries the plaintext bitstring the generate flow needs, which the
   *  persisted (ciphertext) copy cannot hand back on its own. */
  const [sessionSeeds, setSessionSeeds] = useState<ArweaveSeedRecord[]>([]);
  /** Why the Codex refused to store the last defined seed (locked codex, failed
   *  encrypt, a second prime). The seed stays usable for THIS session, but it
   *  will NOT survive an unmount — so the failure is shown, never swallowed.
   *  Carries the host's message only; no seed material ever reaches it. */
  const [seedPersistError, setSeedPersistError] = useState<string | null>(null);
  /** Keys generated in this session, so they are visible before the host app
   *  feeds an updated `foreignKeys` back in. */
  const [sessionKeys, setSessionKeys] = useState<ForeignKeyEntry[]>([]);

  /** THIS chain's keys only — the foreign-key slice is chain-agnostic. */
  const arweaveKeys = useMemo<ForeignKeyEntry[]>(() => {
    const byId = new Map<string, ForeignKeyEntry>();
    for (const entry of deps?.foreignKeys ?? []) {
      if (entry.chainId === ARWEAVE_CHAIN_ID) byId.set(entry.id, entry);
    }
    for (const entry of sessionKeys) byId.set(entry.id, entry);
    return [...byId.values()];
  }, [deps?.foreignKeys, sessionKeys]);

  /**
   * EVERY address this chain currently holds a configured key for — fed to
   * `LibraryArea.owners` below. Library's whole point is "show me everything
   * I've uploaded", not "show me what the FIRST configured key uploaded": a
   * codex can hold more than one Arweave key, and the Upload Wizard's own
   * Account step genuinely lets an upload go out under ANY of them
   * (`arweave-upload-wizard-account-wiring`'s per-call `accountId`
   * resolution) — scoping Library to the single `deps.address` (the host's
   * construction-time default identity, still correct for codex-backup's
   * OWN default signing identity, which never carries an explicit accountId
   * selection) silently hid every OTHER key's uploads, even though they
   * genuinely exist on chain under a key this very codex holds.
   *
   * Derived from `arweaveKeys` (already chain-filtered + session-merged)
   * rather than re-reading `deps.foreignKeys` a second time; `deps.address`
   * is folded in too (as a floor, never a narrowing) so a host that supplies
   * an address outside `foreignKeys` — or a test double that only wires
   * `address` — still gets at least that one address queried, matching the
   * pre-fix behaviour as a strict superset rather than a regression.
   */
  const libraryOwners = useMemo<string[]>(() => {
    const owners = new Set<string>();
    for (const key of arweaveKeys) owners.add(key.address ?? key.id);
    if (deps?.address) owners.add(deps.address);
    return [...owners];
  }, [arweaveKeys, deps?.address]);

  /**
   * `arweave-auto-rebuild-on-unlock`: `LibraryArea` reads the Library ONCE,
   * on its own mount (`listLibrary`/`uniqueOwners` identity are its own
   * `refresh` effect's only dependencies — see that component's own doc
   * comment) — it has no way to know the HOST's background
   * `rebuildLibraryForAllOwners` run just reconciled new entries into the
   * SAME store out-of-band, since that mutation is a plain method call, not
   * a React state update anything here subscribes to. Re-identifying
   * `listLibrary` on every `libraryAutoRebuildProgress` tick (every page
   * fetched, AND the final settle-to-`null`) is what makes `LibraryArea`'s
   * own effect refire and actually pick up what the auto-rebuild wrote —
   * without this, the Library would show nothing until the user manually
   * clicked "Rebuild from chain" themselves, defeating the whole feature.
   * `deps?.listLibrary` is read fresh each call (never captured stale); the
   * `deps === null` fallback is never actually reached by a mounted
   * `LibraryArea` (that branch only renders once `deps !== null`), kept only
   * so this Hook can be called unconditionally, at the top level, every
   * render (Rules of Hooks).
   */
  const listLibraryWithAutoRebuildRefresh = useCallback(
    (owner: string): Promise<LibraryEntry[]> =>
      deps?.listLibrary(owner) ?? Promise.resolve([]),
    [deps?.listLibrary, deps?.libraryAutoRebuildProgress],
  );

  /** Persist ONE generated key, composed from the existing E1 seams: the
   *  keyring encrypts the JWK at rest, then the entry is stored with its seed
   *  provenance. Called per key AS IT ARRIVES — never batched. */
  const persistKey = useMemo(() => {
    if (deps === null) return undefined;
    return async ({ seedId, index, jwk, address }: GeneratedArweaveKey): Promise<void> => {
      const encrypted = await deps.generateArweaveKey({ jwk, label: `#${index}` });
      const entry: ForeignKeyEntry = { ...encrypted, seedId, index, address };
      await deps.addForeignKey(entry);
      setSessionKeys((prev) => [...prev, entry]);
    };
  }, [deps]);

  /** Host seeds first, session overlay on top (same id → the session record
   *  wins, because it is the one that still knows its bitstring). */
  const seeds = useMemo<ArweaveSeedRecord[]>(() => {
    const byId = new Map<string, ArweaveSeedRecord>();
    for (const seed of seedSeams?.arweaveSeeds ?? []) byId.set(seed.id, seed);
    for (const seed of sessionSeeds) byId.set(seed.id, seed);
    return [...byId.values()];
  }, [seedSeams?.arweaveSeeds, sessionSeeds]);

  /** A newly defined seed goes OUT to the codex (so it survives this panel) and
   *  into the session overlay (so it is usable immediately, with its bits). */
  const handleSeedDefined = useCallback(
    (seed: ArweaveSeedRecord): void => {
      setSessionSeeds((prev) => [...prev.filter((s) => s.id !== seed.id), seed]);
      setSeedPersistError(null);
      void (async () => {
        try {
          await seedSeams?.onSeedDefined?.(seed);
        } catch (cause) {
          setSeedPersistError(
            `"${seed.label}" could not be saved to the Codex, so it will not ` +
              `survive leaving this panel: ${
                cause instanceof Error ? cause.message : String(cause)
              }`,
          );
        }
      })();
    },
    [seedSeams],
  );

  /** Deleting a seed also drops BOTH session overlays — the seed AND every key
   *  the cascade removes. Pruning only `sessionSeeds` left a this-session-
   *  generated key's id alive in `sessionKeys`, which `arweaveKeys` merges back
   *  in on top of the (now-empty) host list — the deleted key resurrected, and
   *  `existingKeys.length` never dropped back to zero, wrongly hiding Quick
   *  Define forever after a delete. */
  const handleDeleteSeed = useCallback(
    async (request: ArweaveSeedDeletion): Promise<void> => {
      setSessionSeeds((prev) => prev.filter((s) => s.id !== request.seedId));
      setSessionKeys((prev) => prev.filter((k) => !request.keyIds.includes(k.id)));
      await deps?.onDeleteSeed?.(request);
    },
    [deps],
  );

  // ── Pure Keys' own add/rename/delete wrappers ──
  // Mirrors the seeded-key session overlay above: a pure key created/renamed/
  // deleted THIS session must be visible immediately in `arweaveKeys` rather
  // than waiting for the host to round-trip an updated `foreignKeys` prop.
  const handleAddPureKey = useCallback(
    async (entry: ForeignKeyEntry): Promise<void> => {
      await deps?.addForeignKey(entry);
      setSessionKeys((prev) => [...prev, entry]);
    },
    [deps],
  );
  const handleRenamePureKey = useCallback(
    async (id: string, label: string): Promise<void> => {
      await deps?.renameForeignKey(id, label);
      setSessionKeys((prev) => prev.map((k) => (k.id === id ? { ...k, label } : k)));
    },
    [deps],
  );
  const handleDeletePureKey = useCallback(
    async (id: string): Promise<void> => {
      setSessionKeys((prev) => prev.filter((k) => k.id !== id));
      await deps?.deleteForeignKey(id);
    },
    [deps],
  );

  const accountsSeeds = useMemo(
    // Forward `isPrime` so Accounts titles the prime group "Prime Arweave Seed"
    // even when the prime seed is not first in the array. Without it the list
    // falls back to positional inference (index 0), which mislabels after a
    // reorder or once an earlier seed is deleted.
    //
    // `hasWords` drives Accounts' balance-delete-guard tier (design.md §3):
    // `true` only when this seed's plaintext words are actually known this
    // session — a Direct/bitstring-sourced seed, or a word-based seed whose
    // session-only words were lost on reload, both read `false` here.
    () =>
      seeds.map((seed) => ({
        id: seed.id,
        label: seed.label,
        isPrime: seed.isPrime,
        hasWords: seed.words !== undefined && seed.words.length > 0,
      })),
    [seeds],
  );

  const desktopStrip = (
    <div
      role="tablist"
      aria-label="Arweave panel"
      style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 16 }}
    >
      {CATEGORIES.map((id) => {
        const { Icon, color } = CATEGORY_META[id];
        const selected = id === active;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={selected}
            data-testid={`arweave-subtab-${id}`}
            onClick={() => requestCategory(id)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: CATEGORY_ROW_HEIGHT,
              padding: "0 16px",
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              border: `1px solid ${selected ? color : "#262626"}`,
              backgroundColor: selected ? color + "1a" : "transparent",
              color: selected ? color : "#888",
              whiteSpace: "nowrap",
            }}
          >
            <Icon style={{ width: 14, height: 14 }} />
            {CATEGORY_LABELS[id]}
          </button>
        );
      })}
    </div>
  );

  // Same categories, same `requestCategory` interception (the generation
  // guard) — just icon-only, single-line, centered (design.md §8, the
  // "Blockchain Accounts" cleanup round). "Same structure and design and
  // placement of buttons as what we did for chainweb": LEFT/RIGHT reserved
  // slots (count, and a category-specific action) mirror
  // `ChainwebPanel.tsx`'s own icon row exactly — Seeds shows its count on
  // the left and (round 20) a "+" add-seed button on the right, reported up
  // via `ArweaveSeedsArea`'s own `onOpenSeedFormHandleChange`, the same
  // "lift the '+' next to Chainweb's" ask `SeedWordsTab`'s `createSeedOpen`
  // already satisfies there; Accounts shows its `m/n+x` composition on the
  // left and the refresh button on the right; Pure Keys/Upload/Library show
  // neither, exactly like Chainweb's own Pure Keys.
  const mobileStrip = (
    <div
      role="tablist"
      aria-label="Arweave panel"
      // Round 16 owner correction (ported from `ChainwebPanel.tsx`'s
      // identical change): "space clearly could be optimised better...
      // everything could be pushed a bit higher." Ordinary breathing room
      // (no medallion-clearance invariant tied to it, unlike the outer
      // wrapper's own `paddingTop` below) — trimmed to give the entries
      // list more real room.
      style={{ position: "relative", flex: "none", display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}
    >
      <span style={{ minWidth: 30, display: "flex", justifyContent: "center", flexShrink: 0 }}>
        {active === "seeds" && (
          <span
            aria-label={`${seeds.length} seed${seeds.length !== 1 ? "s" : ""}`}
            title={`${seeds.length} seed${seeds.length !== 1 ? "s" : ""}`}
            style={{ fontSize: 13, fontWeight: 700, color: CATEGORY_META.seeds.color }}
          >
            {seeds.length}
          </span>
        )}
        {active === "accounts" && (
          <span
            aria-label={`${accountsTotal} address${accountsTotal !== 1 ? "es" : ""} — ${accountsBreakdown.seedAccounts} from ${accountsBreakdown.seedCount} seed group${accountsBreakdown.seedCount !== 1 ? "s" : ""}, ${accountsBreakdown.directAccounts} direct`}
            title={`${accountsTotal} address${accountsTotal !== 1 ? "es" : ""} — ${accountsBreakdown.seedAccounts} from ${accountsBreakdown.seedCount} seed group${accountsBreakdown.seedCount !== 1 ? "s" : ""}, ${accountsBreakdown.directAccounts} direct`}
            style={{ fontSize: 12, fontWeight: 700, color: CATEGORY_META.accounts.color, whiteSpace: "nowrap" }}
          >
            {accountsBreakdown.seedAccounts}/{accountsBreakdown.seedCount}+{accountsBreakdown.directAccounts}
          </span>
        )}
      </span>
      <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", gap: 4 }}>
        {CATEGORIES.map((id) => {
          const { Icon, color } = CATEGORY_META[id];
          const selected = id === active;
          return (
            <MobileCategoryIconBtn key={id} active={selected} color={color} label={CATEGORY_LABELS[id]} onClick={() => requestCategory(id)}>
              <Icon style={{ width: 16, height: 16 }} />
            </MobileCategoryIconBtn>
          );
        })}
      </div>
      <span style={{ width: 30, display: "flex", justifyContent: "center", flexShrink: 0 }}>
        {active === "accounts" && refreshHandle && (
          <button
            type="button"
            onClick={refreshHandle.refresh}
            aria-label="Refresh balances"
            title={refreshHandle.error ? "Balance read failed — tap to retry" : "Refresh balances"}
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 30, height: 30, borderRadius: 8, cursor: "pointer",
              border: `1px solid ${refreshHandle.error ? "#8b1a1a" : `${CATEGORY_META.accounts.color}55`}`,
              backgroundColor: refreshHandle.error ? "#8b1a1a1a" : `${CATEGORY_META.accounts.color}1a`,
              color: refreshHandle.error ? "#c0392b" : CATEGORY_META.accounts.color,
            }}
          >
            <RefreshGlyph style={{ width: 16, height: 16, animation: refreshHandle.loading ? "spin 1s linear infinite" : undefined }} />
          </button>
        )}
        {active === "seeds" && openSeedFormHandle && (
          <button
            type="button"
            data-testid="arweave-mobile-add-seed"
            onClick={openSeedFormHandle}
            aria-label="Add Arweave Seed"
            title="Add Arweave Seed"
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 30, height: 30, borderRadius: 8, cursor: "pointer",
              border: `1px solid ${CATEGORY_META.seeds.color}55`,
              backgroundColor: `${CATEGORY_META.seeds.color}1a`,
              color: CATEGORY_META.seeds.color,
            }}
          >
            <PlusGlyph style={{ width: 16, height: 16 }} />
          </button>
        )}
      </span>
      {active === "accounts" && (
        <>
          {/* Zone 3's OWN top border, half above/half below — the SAME
              seam-straddling geometry `ChainwebPanel.tsx` uses for its own
              Codex/Watched medallion. Only ONE toggle here (Arweave has no
              Stoa/UrStoa-equivalent second balance kind), so it's the only
              medallion on the top border, left-aligned. */}
          <SplitSeamMedallion
            edge="top"
            align="left"
            offset={20}
            accent={CATEGORY_META.accounts.color}
            edgeRailTarget={zone3AnchorTarget}
            active={accountsSubTab === "codex" ? "left" : "right"}
            leftLabel={`Codex ${accountsCounts.codex}`}
            rightLabel={`Watched ${accountsCounts.watch}`}
            onSelectLeft={() => setAccountsSubTab("codex")}
            onSelectRight={() => setAccountsSubTab("watch")}
          />
          {/* Zone 3's OWN bottom border, half above/half below — same
              geometry as `ChainwebPanel.tsx`'s own pagination medallion.
              Round 11 — Collapse-All is GONE from mobile entirely (the
              Codex list is now a flat, fixed-height, seed-badged list —
              see `ArweaveAccountsArea`'s own `codexFlatEntries` doc
              comment — so there's nothing left to collapse). This slot is
              therefore UNCONDITIONALLY the pagination medallion's. */}
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
      {/* Seeds NEVER has a Collapse-All medallion of its own — the shared
          slot is always free for its own pagination whenever it has more
          than one page. */}
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
          keys as well, which should kick in once enough entries exist." */}
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
  );

  const tabContent = (
      <div
        role="tabpanel"
        // MOBILE ONLY (desktop stays byte-identical) — a definite height
        // for `ArweaveAccountsArea`'s own slot-based pagination engine to
        // measure against, mirroring `ChainwebPanel.tsx`'s identical fix
        // for `StoaAccountsTab`.
        style={isMobile ? { height: "100%" } : undefined}
      >
        {/* Seeds, Pure Keys, Accounts, Upload and Library are ALL WIRED (E5 +
            the arweave-upload-categories addendum: mounting what the prior
            two topics built but never mounted). Upload renders the real
            `UploadArea`; Library renders `CodexBackupArea` and
            `CodexBackupHistoryArea` above the real `LibraryArea` —
            CodexBackupArea lives there (not its own category) because
            backing up the codex is a Library-adjacent action, not a
            file-upload-centric one, and CodexBackupHistoryArea is a
            dedicated filtered "just my codex backups" list over that same
            Library data. Every category keeps its own
            e4-panel-*.test.tsx / e5-*.test.tsx specs, so nothing here re-tests
            an area's own internals — only that the panel actually mounts it.

            Seeds is a KEEP-ALIVE, unlike the rest: it is
            hidden with `display: none` rather than unmounted when another
            category is active, because it is the one category that can carry
            an in-flight generation. The worker keeps running regardless of
            what the panel renders (confirmed architecture — keys persist via
            the host store regardless of component lifecycle), so unmounting
            `ArweaveSeedsArea` destroyed its `run` state and, on returning to
            Seeds, showed no progress bar at all even though the run was still
            alive. Mounting it unconditionally and only toggling visibility
            keeps `run`/`abortRef`/`storedRef`/the form fields intact across the
            switch, with no change needed inside `ArweaveSeedsArea` itself. */}
        <div
          style={{
            display: active === "seeds" ? undefined : "none",
            // MOBILE ONLY — a definite height for `ArweaveSeedsArea`'s own
            // measured seed-list pagination to size against (mirrors the
            // `role="tabpanel"` fix just above). Irrelevant while hidden
            // (`display: none`).
            height: isMobile ? "100%" : undefined,
          }}
        >
          {seedPersistError !== null && (
            <div data-testid="arweave-seed-persist-error" role="alert" style={SEED_ERROR_STYLE}>
              {seedPersistError}
            </div>
          )}
          <ArweaveSeedsArea
            seeds={seeds}
            onSeedDefined={handleSeedDefined}
            existingKeys={arweaveKeys}
            persistKey={persistKey}
            ouronetAccounts={deps?.ouronetAccounts}
            revealAccountSecret={deps?.revealAccountSecret}
            chainwebSeeds={deps?.chainwebSeeds}
            revealSeedWords={deps?.revealSeedWords}
            workerFactory={deps?.workerFactory}
            onDeleteSeed={handleDeleteSeed}
            decryptArweaveKey={deps?.decryptArweaveKey}
            onRunActivityChange={setActiveGeneration}
            fullScreenPortalTarget={fullScreenPortalTarget}
            onPaginationHandleChange={setSeedsPaginationHandle}
            // NOT `setOpenSeedFormHandle` directly: `openDefine` is itself a
            // function, and `useState`'s setter treats a function ARGUMENT
            // as a `(prevState) => nextState` updater rather than as the
            // literal next value — passing it straight through would
            // immediately INVOKE `openDefine` (as `updater(prevState)`) and
            // store its `undefined` return as state, both opening the
            // define form as an unwanted side effect and leaving the "+"
            // button permanently unrendered. Wrapping it forces React to
            // treat `fn` as the value, not as an updater.
            onOpenSeedFormHandleChange={(fn) => setOpenSeedFormHandle(() => fn)}
            ensureCodexUnlocked={ensureCodexUnlocked ?? undefined}
          />
        </div>
        {active === "accounts" ? (
          <ArweaveAccountsArea
            entries={arweaveKeys}
            seeds={accountsSeeds}
            // onDeleteKey intentionally NOT threaded: Accounts is a pure
            // listing of every address the codex holds — it never deletes.
            // A key can only be removed from its OWN category: a seed-derived
            // key via the Seeds category (deleting the seed), or a seedless
            // key via the Pure Keys category. `onDeleteKey` is optional on
            // this component precisely so omitting it renders no delete
            // control on any row at all (see this component's own module doc).
            // getBalance IS now threaded (was deliberately withheld until this
            // was wired): every row shows a live AR balance, fetched in
            // parallel per row with a "Live balances / Refresh" control
            // mirroring StoaAccountsTab. The same read also still feeds the
            // funded-key delete guard, unchanged from before this task.
            getBalance={deps?.getBalance}
            // deps (full ArweavePanelDeps) threaded so the row-level Send
            // button/modal can reach sendFrom/estimateFee — deps is `null`
            // here (no-context state) but the prop wants `undefined`.
            deps={deps ?? undefined}
            // T2: the watch-list seams (see {@link ArweaveWatchListSeams}) —
            // an unwired host (watchSeams === null, or one that never wires
            // these three fields) degrades to an empty list and a disabled
            // add form, never a throw.
            watchedEntries={watchSeams?.watchedAddresses ?? EMPTY_WATCHED_ENTRIES}
            onAddWatched={watchSeams?.addWatchedAddress}
            onRemoveWatched={watchSeams?.removeWatchedAddress}
            onTotalChange={setAccountsTotal}
            onRefreshHandleChange={setRefreshHandle}
            subTab={accountsSubTab}
            onSubTabChange={setAccountsSubTab}
            onSubTabCountsChange={setAccountsCounts}
            onAccountsBreakdownChange={setAccountsBreakdown}
            onPaginationHandleChange={setAccountsPaginationHandle}
            // Round 17 — "arweave account one line, balance one line, and
            // buttons below on the lower bar, with entry selection": the
            // shared bottom action bar docks to the SAME Zone-3 seam every
            // other mobile medallion here already does, and its Send modal
            // needs the same full-screen portal every other mobile modal
            // in this panel already gets.
            fullScreenPortalTarget={fullScreenPortalTarget}
            zone3AnchorTarget={zone3AnchorTarget}
          />
        ) : active === "pure-keys" ? (
          deps === null ? (
            <div data-testid="arweave-pure-keys-unavailable" style={EMPTY_STYLE}>
              Pure Keys are not available until the Arweave keyring is wired.
            </div>
          ) : (
            <PureKeysArea
              foreignKeys={arweaveKeys}
              keygenRunner={deps.keygenRunner}
              generateArweaveKey={deps.generateArweaveKey}
              importArweaveKey={deps.importArweaveKey}
              decryptArweaveKey={deps.decryptArweaveKey}
              addForeignKey={handleAddPureKey}
              renameForeignKey={handleRenamePureKey}
              deleteForeignKey={handleDeletePureKey}
              onPaginationHandleChange={setPureKeysPaginationHandle}
              fullScreenPortalTarget={fullScreenPortalTarget}
              // getBalance intentionally NOT threaded here yet: mock mode's
              // fake `getBalance` always resolves the SAME fixed balance for
              // every address, including a key created seconds ago with
              // nothing on it. A Pure Key is *always* seedless (exactly the
              // case the funded-guard exists to protect), so wiring it here
              // would make a false-positive "funded, can't delete" warning
              // the single most visible place this would bite a user testing
              // a freshly-generated, genuinely-empty key. `getBalance` is
              // optional on this component precisely so the guard stays a
              // no-op (today's plain confirm) until a real balance read
              // exists to feed it — unlike Accounts (T4), this one is NOT yet
              // wired to a live value display either, so there is no display
              // reason to force the read here today.
            />
          )
        ) : active === "upload" ? (
          deps === null ? (
            <div data-testid="arweave-upload-unavailable" style={EMPTY_STYLE}>
              Upload is not available until the Arweave upload seam is wired.
            </div>
          ) : (
            <>
              <div style={UPLOAD_ENTRY_WRAP_STYLE}>
                <button
                  type="button"
                  data-testid="arweave-upload-start"
                  onClick={() => setUploadWizardOpen(true)}
                  style={UPLOAD_ENTRY_BUTTON_STYLE}
                >
                  Start Upload
                </button>
                {/* Its real destination — the Codex Upload (backup) wizard —
                    primarily lives on the new Codex ID page, a not-yet-built
                    later topic. Disabled + "(coming soon)" rather than a
                    button that silently does nothing on click. */}
                <button
                  type="button"
                  disabled
                  data-testid="arweave-upload-backup-codex"
                  title="Back Up Codex to Arweave (coming soon)"
                  style={UPLOAD_ENTRY_BUTTON_DISABLED_STYLE}
                >
                  Back Up Codex to Arweave (coming soon)
                </button>
              </div>
              {uploadWizardOpen ? (
                <UploadWizard
                  accounts={arweaveKeys}
                  ouronetAccounts={deps.ouronetAccounts ?? []}
                  pool={deps.pool}
                  uploadAndTrack={deps.uploadAndTrack}
                  uploadFilesAndTrack={deps.uploadFilesAndTrack}
                  openUrl={(id) => deps.openUrl(id, { pool: deps.pool })}
                  revealAccountSecret={deps.revealAccountSecret}
                  // Owner correction pass (`arweave-upload-wizard` T2): the
                  // SAME live-balance seam `ArweaveAccountsArea`'s own
                  // `getBalance` prop already uses, straight from `deps`.
                  getBalance={deps.getBalance}
                  // The SAME `ensureCodexUnlocked` source the Seeds mount
                  // just above already uses (`useEnsureCodexUnlockedOptional()`,
                  // read once near the top of this component) — NOT a
                  // field on `ArweavePanelDeps`, because that is not
                  // actually how this panel sources it for Seeds either.
                  ensureCodexUnlocked={ensureCodexUnlocked ?? undefined}
                  // `arweave-non-removable-account` T4: the dead-letter gap
                  // closed — the real seam straight from `deps`, mirroring
                  // `getBalance`/`revealAccountSecret` just above.
                  onAccountUsedForEncryption={deps.onAccountUsedForEncryption}
                  onClose={() => setUploadWizardOpen(false)}
                />
              ) : null}
            </>
          )
        ) : active === "library" ? (
          deps === null ? (
            <div data-testid="arweave-library-unavailable" style={EMPTY_STYLE}>
              Library is not available until the Arweave library seam is wired.
            </div>
          ) : (
            <div>
              {/* `arweave-auto-rebuild-on-unlock`: the HOST's own in-flight
                  multi-address auto-rebuild progress — a visible,
                  non-blocking status, topmost in the Library category so it
                  is the first thing seen here. Optional seam: an unwired
                  host (or one that never updates it, or has already
                  settled it back to `null`) renders nothing. */}
              <LibraryAutoRebuildProgress progress={deps.libraryAutoRebuildProgress ?? null} />
              {/* The "General Data" / "Codex" sub-tab switcher — owner's own
                  words: "lets make two Tabs here, General Data and Codex,
                  separate on their own display." General Data is the
                  redesigned `LibraryArea` (every upload EXCEPT a codex
                  backup); Codex is the backup button + its dedicated history
                  list, moved OFF the always-stacked layout and under their
                  own tab. */}
              <div role="tablist" aria-label="Library view" style={LIBRARY_TAB_ROW_STYLE}>
                {LIBRARY_TABS.map((tab) => {
                  const selected = tab === libraryTab;
                  return (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      data-testid={`library-tab-${tab}`}
                      onClick={() => setLibraryTab(tab)}
                      style={libraryTabButtonStyle(selected)}
                    >
                      {LIBRARY_TAB_LABELS[tab]}
                    </button>
                  );
                })}
              </div>
              {libraryTab === "codex" ? (
                <>
                  {/* ArweaveRestoreEligibilityStatus (`codex-seed-restore-activation`
                      T2) sits directly above CodexBackupArea — "true" here means
                      the backup button right below it will carry a recovery tag,
                      so the signal belongs immediately next to the action it
                      describes. Optional seam: an unwired host (`deps.
                      checkArweaveRestoreEligibility` undefined) renders nothing. */}
                  <ArweaveRestoreEligibilityStatus
                    checkArweaveRestoreEligibility={deps.checkArweaveRestoreEligibility}
                  />
                  {/* CodexBackupArea — a special, distinct upload path (its own
                      dedicated permanence warning), not just another Library
                      entry — now reachable from its own "Codex" tab rather than
                      always stacked above the general upload list. */}
                  <CodexBackupArea
                    getExportJson={deps.getExportJson}
                    backupCodex={deps.backupCodex}
                    openUrl={(id) => deps.openUrl(id, { pool: deps.pool })}
                  />
                  {/* CodexBackupHistoryArea: a dedicated, filtered "just my
                      codex backups" list, mounted alongside CodexBackupArea on
                      the SAME "Codex" tab — same props-reuse pattern as
                      CodexBackupArea above (listLibrary/openUrl are the SAME
                      seams LibraryArea itself is given). */}
                  <CodexBackupHistoryArea
                    owner={deps.address}
                    pool={deps.pool}
                    listLibrary={deps.listLibrary}
                    openUrl={deps.openUrl}
                  />
                </>
              ) : (
                <LibraryArea
                  owners={libraryOwners}
                  pool={deps.pool}
                  listLibrary={listLibraryWithAutoRebuildRefresh}
                  openUrl={deps.openUrl}
                  rebuildLibrary={deps.rebuildLibrary}
                />
              )}
            </div>
          )
        ) : active !== "seeds" ? (
          <div data-testid={`arweave-category-empty-${active}`} style={EMPTY_STYLE}>
            {`${CATEGORY_LABELS[active]} — not wired yet.`}
          </div>
        ) : null}
      </div>
  );

  const leaveDialog = pendingCategory !== null && activeGeneration !== null && (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="Leave the seed still generating?"
      data-testid="arweave-leave-generation-dialog"
      style={LEAVE_DIALOG_BACKDROP_STYLE}
    >
      <div style={LEAVE_DIALOG_STYLE}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
          {`"${activeGeneration.seedLabel}" is still generating keys.`}
        </div>
        <div style={{ fontSize: 13, color: "#888" }}>
          Leaving this tab does not stop it, but you will lose the progress bar
          and the ability to cancel until you come back.
        </div>
        <div style={LEAVE_DIALOG_BUTTON_ROW_STYLE}>
          <button
            type="button"
            data-testid="arweave-leave-generation-stop"
            onClick={handleStopGeneration}
            style={LEAVE_DIALOG_STOP_BUTTON_STYLE}
          >
            Stop generation now
          </button>
          <button
            type="button"
            data-testid="arweave-leave-generation-continue"
            onClick={handleContinueInBackground}
            style={LEAVE_DIALOG_CONTINUE_BUTTON_STYLE}
          >
            Continue in background
          </button>
        </div>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <div
        data-testid="arweave-panel"
        data-chain-id={ARWEAVE_CHAIN_ID}
        style={{
          display: "flex", flexDirection: "column", height: "100%",
          // Owner correction (round 8 follow-up — "on chainweb there is
          // enough room between the medallion and the buttons, and on
          // arweave there isn't... we need to have the same implementation
          // here as on chainweb"): the Codex/Watched medallion straddles
          // Zone 3's OWN top border, half poking DOWN into this exact
          // space — the category icon row needs the SAME clearance
          // `ChainwebPanel.tsx` already gives it, or the poking-down half
          // sits on top of the icon row's own buttons.
          paddingTop: 16,
        }}
      >
        {mobileStrip}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>{tabContent}</div>
        {leaveDialog}
      </div>
    );
  }

  return (
    <div data-testid="arweave-panel" data-chain-id={ARWEAVE_CHAIN_ID}>
      {desktopStrip}
      {tabContent}
      {leaveDialog}
    </div>
  );
}

export default ArweavePanel;
