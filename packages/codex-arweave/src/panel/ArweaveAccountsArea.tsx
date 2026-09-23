/**
 * ArweaveAccountsArea — the Arweave "Accounts" category listing.
 *
 * PRESENTATIONAL ONLY. It is handed the ciphertext `ForeignKeyEntry[]` and the
 * known seeds. It NEVER decrypts, never reads a store, never touches the
 * network, and holds no state beyond which sub-tab is open and which groups are
 * collapsed.
 *
 * STRUCTURE IS COPIED, NOT INVENTED: this is the SAME shape Chainweb's
 * `StoaAccountsTab` uses, so both chains' Accounts pages read as one surface —
 *   • a "Total Addresses N" header block;
 *   • a `Codex Accounts (N)` / `Watched Accounts (N)` sub-tab toggle. Arweave has
 *     no watch-list yet, so Watched is a real tab with a count of 0 and its own
 *     empty state — the control stays so the two chains stay identical;
 *   • addresses grouped by their SOURCE SEED, each group collapsible with a
 *     count badge (Stoa's `GroupRow`), holding that seed's entries ascending by
 *     `index`. The prime seed's group is fixed as "Prime Arweave Seed"; any other
 *     falls back to `Seed #N` when it carries no label (Stoa's naming rule).
 *
 * Secrecy: `encryptedKeyfile` is the only copy of the user's key material and is
 * NEVER rendered — every row shows the entry's PLAINTEXT `address` (E5's
 * provenance field, public material), falling back to the entry `id`. That is
 * precisely why `address` exists on `ForeignKeyEntry`: a list renders without
 * decrypting anything.
 *
 * Index spaces are PER SEED — `#0` exists under every seed and is not globally
 * unique — so an index is only ever rendered inside its seed's group.
 *
 * Nothing is ever silently dropped: an entry whose `seedId` names no known seed,
 * and a LEGACY entry written before seed provenance existed (no `seedId` at
 * all), both land in a final "Unassigned" group. Losing a key from the user's
 * view is the worst failure this surface could have.
 *
 * Icons are INLINE SVG, deliberately NOT `lucide-react`: that package lives only
 * at the repo root where `react` resolves to the stale hoisted React 18, so
 * importing it renders elements from a second React ("A React Element from an
 * older version of React was rendered"). Same rule as `ArweavePanel.tsx`.
 *
 * T7: each row also gets a "Send AR" button opening `SendArweaveModal.tsx` for
 * that row's entry — the one place this file stops being purely
 * presentational-only-of-ciphertext and threads the full `ArweavePanelDeps`
 * bundle down to a row, OPTIONALLY (`deps` prop, gated the same way
 * `onDeleteKey` already is): a caller that omits it gets no Send button at
 * all, rather than one that would throw or no-op on click. A successful send
 * re-fires T4's `fetchBalances([address])` for exactly that row.
 */

import * as React from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";
import { winstonToAr } from "@ancientpantheon/arweave-core";
import type { WatchListEntry } from "@ancientpantheon/codex-ouronet/types";
import { validateAddress } from "@ancientpantheon/codex-ouronet/hooks";
import { onTxConfirmed } from "@ancientpantheon/codex-ouronet/zbom";
import { useIsMobile } from "@ancientpantheon/codex-ui/ui";

import type { ArweavePanelDeps } from "./context.js";
import { SendArweaveModal } from "./SendArweaveModal.js";
import { ARWEAVE_CHAIN_ID } from "../address-book/chainId.js";

/** A single STABLE empty array, reused as `watchedEntries`'s default when the
 *  prop is omitted. A `[]` written directly in the destructuring default is a
 *  NEW array literal on every render, which changes `addresses`'s (T4) memoized
 *  identity every render, which re-fires the balance-fetch effect every render
 *  — an infinite render loop the very first time this component mounts without
 *  `watchedEntries` wired (i.e. every pre-T2 caller). */
const EMPTY_WATCHED_ENTRIES: WatchListEntry[] = [];

/** The id of the TRUE-ORPHAN catch-all group: a `seedId` naming no known seed
 *  (unknown/legacy provenance). NOT a real seed id — no seed may use it. */
const UNASSIGNED_ID = "unassigned";
const UNASSIGNED_LABEL = "Unassigned";

/** The id of the genuinely-seedless catch-all group: `seedId === undefined`,
 *  the exact filter `PureKeysArea.tsx` uses for its own list — these entries
 *  duplicate into that standalone tab, so this Accounts-side label matches it
 *  rather than folding them into the true-orphan "Unassigned" bucket above. */
const PURE_KEYS_ID = "pure-keys";
const PURE_KEYS_LABEL = "Pure Keys";

/** The prime seed's group is fixed copy, never the stored label. */
const PRIME_LABEL = "Prime Arweave Seed";

const MONO = "var(--codex-font-mono, 'JetBrains Mono', ui-monospace, monospace)";

/** Accounts accent — the same gold the Accounts category uses on every chain. */
const ACCENT = "#ceac5f";
/** Round 19 owner correction: "Arweave amount as blue" — a funded row
 *  balance's own colour, distinct from the gold `ACCENT` used for
 *  seed/position accents elsewhere on the same row. */
const BALANCE_BLUE = "#3b82f6";

/**
 * Round 11 owner correction (ported from `StoaAccountsTab.tsx`'s identical
 * change): "instead of listing the entries as part of a seed, we should
 * make the entry carry a medallion to see from which seed it belongs" —
 * every row on mobile now carries a small colour-coded corner badge naming
 * its own seed instead of sitting under a group header. Stoa could reuse
 * each seed's OWN already-established `SEED_TYPE_COLOR`; Arweave seeds
 * (`ArweaveAccountsSeed`) carry no colour of their own at all (no
 * seed-type concept exists on this chain), so this is a NEW, local judgment
 * call: a small fixed palette, assigned deterministically by hashing the
 * group's own id — stable across renders/pages for the SAME seed, without
 * inventing a whole seed-type-colour system this chain has no other use
 * for. */
const GROUP_BADGE_PALETTE = ["#ec4899", "#3b82f6", "#eab308", "#22c55e", "#a78bfa", "#f97316", "#06b6d4", "#f43f5e"];
function colorForGroupId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return GROUP_BADGE_PALETTE[hash % GROUP_BADGE_PALETTE.length];
}

const svgBase = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const ChevronDownGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style}><path d="m6 9 6 6 6-6" /></svg>
);
const ChevronRightGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style}><path d="m9 18 6-6-6-6" /></svg>
);
const EyeGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const CopyGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style}>
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </svg>
);
/** `data-glyph="check"` lets tests distinguish this from the resting
 *  `CopyGlyph` without depending on SVG path internals. */
const CheckGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style} data-glyph="check">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const ExternalLinkGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
  </svg>
);
/** T7's per-row "Send AR" button glyph — a paper-plane send icon, same
 *  inline-SVG rule (module JSDoc). */
const SendGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style}>
    <path d="m22 2-7 20-4-9-9-4Z" />
    <path d="M22 2 11 13" />
  </svg>
);
/** Same glyph as `ArweaveSeedsArea.tsx`'s `TrashGlyph` — this module stays
 *  self-contained (module JSDoc), so it is duplicated rather than imported. */
const TrashGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style}>
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="M19 6l-1 14H6L5 6" />
  </svg>
);
/** The "Live balances" header's refresh-all control — same inline-SVG rule
 *  (module JSDoc), mirroring `StoaAccountsTab.tsx`'s `RefreshCw` glyph. */
const RefreshGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style}>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </svg>
);

/** A seed as this list needs to know it: an id to group by and a label to show. */
export interface ArweaveAccountsSeed {
  id: string;
  label: string;
  /** The Prime Arweave Seed. Absent → the FIRST seed is prime, as Stoa does. */
  isPrime?: boolean;
  /** Whether this seed's plaintext words are known THIS SESSION — a Direct/
   *  bitstring-sourced seed, or a word-based seed whose session-only words
   *  were lost on reload, both read `false`/absent here. Absent (an older
   *  caller predating this feature) defaults to PROTECTED inside this
   *  component — see the module doc and design.md §3: never silently
   *  downgrades something that used to delete with a plain confirm into a
   *  hard block. */
  hasWords?: boolean;
}

export interface ArweaveAccountsAreaProps {
  /** The foreign-key entries (ciphertext-only) to list, in any order. */
  entries: ForeignKeyEntry[];
  /** The known Arweave seeds, in display order; each becomes one group. */
  seeds: ArweaveAccountsSeed[];
  /** Deletes ONE key. INJECTED — this surface reaches into no store, it only
   *  names the entry to delete. Omitted entirely → no row renders a delete
   *  control at all (mirrors Stoa's `onRemove &&` gating), since an unwired
   *  delete button would either throw on click or silently do nothing. */
  onDeleteKey?: (entry: ForeignKeyEntry) => Promise<void> | void;
  /** E2 balance read (winston bigint). OPTIONAL and additive — a caller that
   *  omits it gets a plain "—" value cell and today's plain confirm-then-
   *  delete panel, unchanged (design.md §3). When wired, it feeds TWO
   *  independent consumers: (1) every row's value cell, fired once per row
   *  on mount and on "Refresh" (T4, parallel via `Promise.allSettled`), and
   *  (2) the delete guard's own on-click read below, which branches on its
   *  group's `protected` tier (see {@link Group}) — unaffected by (1). */
  getBalance?: (address: string) => Promise<bigint>;
  /** T7: the full injected seam bundle, needed only to open the per-row Send
   *  modal (`deps.sendFrom`/`deps.estimateFee`). OPTIONAL and additive,
   *  mirroring `onDeleteKey`'s own omission convention — a caller that omits
   *  it (this file's own pre-T7 tests) gets no Send button on any row rather
   *  than a button that would throw or no-op on click. */
  deps?: ArweavePanelDeps;
  /** T2: third-party addresses the codex holds no private key for — the
   *  Watched Accounts sub-tab's list. OPTIONAL and additive: a caller that
   *  omits it (every pre-T2 test in this file) sees the Watched sub-tab's
   *  existing empty state and no watched rows, exactly as before this task. */
  watchedEntries?: WatchListEntry[];
  /** Adds a new watched address, or (called again with the same address)
   *  re-labels an existing one — the upsert-by-id semantics of the host's
   *  `addWatchListEntry` make this the same seam for both. OPTIONAL: absent
   *  disables the add form (its submit button renders but stays `disabled`)
   *  and the inline label editor on every watched row. */
  onAddWatched?: (address: string, label?: string) => Promise<void>;
  /** Removes one watched address by its watch-list entry id. OPTIONAL: absent
   *  disables the remove control on every watched row (mirrors `onDeleteKey`'s
   *  own gating). */
  onRemoveWatched?: (id: string) => Promise<void>;
  /**
   * Controlled Codex/Watched sub-tab — `ArweavePanel` owns a seam-
   * straddling medallion pair that must render from ITS OWN tree (the same
   * "controlled prop with internal-state fallback" pattern
   * `StoaAccountsTab`'s own `subTab`/`onSubTabChange` pair uses). Both
   * optional — omitted, this component falls back to its own internal
   * `useState` AND keeps rendering its own inline Codex/Watched pill,
   * exactly as before these props existed.
   */
  subTab?: "codex" | "watch";
  onSubTabChange?: (subTab: "codex" | "watch") => void;
  /** Reports the total address count (Codex + Watched) on every change —
   *  same "report upward" shape `StoaAccountsTab`'s own `onTotalChange`
   *  uses. Optional — omitted, this component simply doesn't report. */
  onTotalChange?: (total: number) => void;
  /** Reports the CURRENTLY ACTIVE balance-refresh control, so `ArweavePanel`
   *  can render the actual refresh button on its own mobile category row —
   *  mirrors `StoaAccountsTab`'s own `onRefreshHandleChange`. */
  onRefreshHandleChange?: (handle: { refresh: () => void; loading: boolean; error: boolean }) => void;
  /** Reports the individual Codex/Watched counts, so the medallion
   *  `ArweavePanel` renders can show "Codex 5"/"Watched 1" instead of a
   *  bare label — mirrors `StoaAccountsTab`'s own `onSubTabCountsChange`. */
  onSubTabCountsChange?: (counts: { codex: number; watch: number }) => void;
  /**
   * Reports the codex's account COMPOSITION as `m/n+x` — `m` accounts
   * derived from seeds, `n` seeds, `x` direct (no-seed) accounts (Pure
   * Keys + any true-orphan Unassigned entries folded together as "direct"
   * for this purpose) — mirrors `StoaAccountsTab`'s own
   * `onAccountsBreakdownChange`.
   */
  onAccountsBreakdownChange?: (breakdown: { seedAccounts: number; seedCount: number; directAccounts: number }) => void;
  /**
   * Reports the ACTIVE pagination state so `ArweavePanel` can render it in
   * the shared "middle of the bottom seam" medallion slot — round 9 owner
   * correction: "we also need to agree on a standard pagination controls
   * zone. If no expand collapse medallion exists at the middle of the
   * bottom page... that's where the pagination controls should be in
   * their own medallion." Mirrors `StoaAccountsTab`'s own
   * `onPaginationHandleChange` exactly. Round 11 removed Collapse-All from
   * mobile entirely (no more grouped list to collapse — see
   * `codexFlatEntries`'s own doc comment), so that slot is now
   * UNCONDITIONALLY free: `null` only when there is nothing to paginate
   * (≤1 page) or no caller opted in at all (a standalone mount falls back
   * to its own inline Prev/Next instead).
   */
  onPaginationHandleChange?: (
    handle: { page: number; totalPages: number; onPrev: () => void; onNext: () => void; onJump: (page: number) => void } | null,
  ) => void;
  /**
   * MOBILE ONLY — a DOM node spanning the host's WHOLE mobile body, via
   * `createPortal` — round 17 owner correction: "arweave account one
   * line, balance one line, and buttons below on the lower bar, with
   * entry selection." Mirrors `StoaAccountsTab`'s own
   * `fullScreenPortalTarget` exactly: without it, the Send modal
   * (opened from the shared bottom bar below) resolves against the
   * nearest `CodexUiRoot` ancestor instead of covering the whole screen.
   * Omitted (the default), falls back to that bounded behavior.
   */
  fullScreenPortalTarget?: Element | null;
  /**
   * MOBILE ONLY — `ArweavePanel`'s own Zone-3-border anchor (see
   * `PanelProps.zone3AnchorTarget`) — mirrors `StoaAccountsTab`'s own
   * `zone3AnchorTarget` exactly: the shared bottom action bar
   * (Send/Copy/Explorer/remove-watched, tied to whichever row is
   * currently selected) docks to THIS seam, straddling it exactly like
   * the pagination medallion does. Omitted, it falls back to
   * `fullScreenPortalTarget`'s own bottom-docked (non-straddling)
   * position.
   */
  zone3AnchorTarget?: Element | null;
}

interface Group {
  id: string;
  label: string;
  entries: ForeignKeyEntry[];
  /** The balance-delete-guard tier (design.md §3): `true` (Protected — a
   *  human can retype the seed words and regenerate the exact same key) for a
   *  real seed group whose `hasWords` is not explicitly `false`; `false`
   *  (Unprotected — funds can never be recovered if the key is lost) for the
   *  Pure Keys and Unassigned catch-alls alike, and for a real seed group
   *  whose `hasWords` is explicitly `false`. */
  protected: boolean;
}

/**
 * MOBILE-ONLY fixed-row pagination engine — round 11 owner correction
 * (ported from `StoaAccountsTab.tsx`'s identical change, same reasoning):
 * "instead of listing the entries as part of a seed, we should make the
 * entry carry a medallion to see from which seed it belongs, thus making
 * all entries having a fixed size. with a fixed size for all entries, we
 * can perfectly say how many entries fit in a given space size." Superseded
 * the ORIGINAL round-8 design (a 0.5-slot group header interleaved with
 * 1-slot entries, a lookahead-bundling rule so a header was never left
 * alone) — every row is now the SAME height, so the formula is the trivial
 * one the Watched list already used safely: `floor((available+gap)/(row+gap))`.
 * No header-alone bug is even POSSIBLE anymore, because there is no header
 * in this list at all — see `codexFlatEntries`'s own doc comment for where
 * the flattening happens. Desktop keeps `GroupSection` (unchanged, still
 * rendered uncontrolled) — this only touches the mobile list below.
 */
/** Fallback px height of one row, used only before the first real row has
 *  mounted/measured — see `useSlotPageSize`'s `rowRef`. */
const ACCOUNT_ROW_HEIGHT_FALLBACK = 58;
/**
 * Round 14 owner correction (ported from `StoaAccountsTab.tsx`'s identical
 * change): "the first entrys medalion is cut, that needs fix, and the
 * medalions of an entry touches the upper entry, we need more spacing
 * between entry such that the medalion of an entry doesnt touch the upper
 * entry." Round 13's seed-name pill straddles each row's own top border,
 * poking above it — at the OLD gap of 8, that had less headroom than the
 * container's own top padding could give the very FIRST row (clipped by
 * the container's `overflow: hidden`), and left the pill touching the row
 * above it.
 *
 * Round 15 owner correction (ported from `StoaAccountsTab.tsx`'s identical
 * change) — round 14 overshot: "shouldnt we be able to fit 3 entries here,
 * also the side spacing is a bit to big." Tying the vertical row-to-row
 * gap to the SAME constant as the horizontal container padding meant
 * fixing the vertical clearance also inflated the left/right padding for
 * no reason (the pill only ever pokes ABOVE a row, never to its sides).
 * Split into `ACCOUNT_ROW_GAP` (vertical-only: row-to-row gap + top/bottom
 * padding, still the exact value the pagination engine's slot math uses)
 * and a new `ACCOUNT_ROW_SIDE_PADDING` (horizontal-only), tuned back down
 * now that the pill itself (see its own render) is also a touch smaller.
 */
/**
 * Round 16 owner correction (ported from `StoaAccountsTab.tsx`'s identical
 * change): "space clearly could be optimised better... below clearly there
 * is enough room for another entry." Trimmed once more, still comfortably
 * clearing the pill's own poke-out.
 */
const ACCOUNT_ROW_GAP = 12;
/** Horizontal-only container padding — see `ACCOUNT_ROW_GAP`'s own doc
 *  comment for why this is no longer the same constant. */
const ACCOUNT_ROW_SIDE_PADDING = 8;

/** Measures the available container height + one real row's height live
 *  and returns how many whole rows fit — the SAME live-measure-don't-guess
 *  convention `OuronetAccountsTab`'s own `useMobilePageSize` established;
 *  the raw (fractional) value is returned here, flooring happens where a
 *  caller actually chunks entries into pages (round 11 — no more header to
 *  budget a fraction for). */
function useSlotPageSize(): {
  containerRef: React.RefObject<HTMLDivElement | null>;
  rowRef: (node: HTMLDivElement | null) => void;
  slotsAvailable: number;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const [rowEl, setRowEl] = useState<HTMLDivElement | null>(null);
  const [rowHeight, setRowHeight] = useState(ACCOUNT_ROW_HEIGHT_FALLBACK);
  const [slotsAvailable, setSlotsAvailable] = useState(4);

  useEffect(() => {
    if (!rowEl) return;
    const measure = () => {
      const h = rowEl.getBoundingClientRect().height;
      if (h > 0) setRowHeight(h);
    };
    measure();
    // Owner-reported live bug (round 9, on Chainweb's own Seeds list, same
    // measurement shape here): "the next button to change page doesn't
    // work, and i can clearly see that 4 entries would fit, so why aren't
    // there 4 entries there?" A `ResizeObserver` only refires once the
    // row's OWN size later changes — it does not protect against the row
    // being measured WRONG on this very first pass (a web font swapping in
    // a few ms after mount, or the host shell's own anchor wiring settling
    // a frame later). A `requestAnimationFrame` + `document.fonts`
    // follow-up re-measure catches either without waiting on a resize
    // event that may never come.
    let raf = 0;
    if (typeof requestAnimationFrame !== "undefined") raf = requestAnimationFrame(measure);
    const fontsReady = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready;
    fontsReady?.then(measure).catch(() => {});
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measure);
      ro.observe(rowEl);
    }
    return () => {
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [rowEl]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const compute = () => {
      // Round 10 owner correction — "same size of the border left right up
      // and down": the container carries `padding: ACCOUNT_ROW_GAP` on
      // every side (see its own JSX comment), which `clientHeight` counts
      // as part of the box — subtract it back out so the packer only ever
      // budgets the REAL usable content height.
      const height = el.clientHeight - 2 * ACCOUNT_ROW_GAP;
      if (height <= 0) return;
      setSlotsAvailable(Math.max(1, (height + ACCOUNT_ROW_GAP) / (rowHeight + ACCOUNT_ROW_GAP)));
    };
    compute();
    // Same "don't trust the very first reading alone" reasoning, PLUS a
    // `window` resize listener — an orientation change or on-screen-
    // keyboard dismissal changes the container's real available height
    // without necessarily firing this element's OWN `ResizeObserver` in
    // every host environment.
    let raf = 0;
    if (typeof requestAnimationFrame !== "undefined") raf = requestAnimationFrame(compute);
    if (typeof window !== "undefined") window.addEventListener("resize", compute);
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(compute);
      ro.observe(el);
    }
    return () => {
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
      if (typeof window !== "undefined") window.removeEventListener("resize", compute);
    };
  }, [rowHeight]);

  return { containerRef, rowRef: setRowEl, slotsAvailable };
}

/** The live value-cell read state for ONE row's address (T4). Distinct from
 *  {@link DeleteGuardState} below — that state machine drives its OWN,
 *  separately-fired `getBalance` call on delete-click; this one drives the
 *  value cell's automatic on-mount/on-refresh read. */
type BalanceState = { status: "loading" } | { status: "ready"; balance: bigint } | { status: "error" };

/** "Live balances" alone doesn't say whether it's stale — there is no
 *  periodic polling at all (only on-mount, manual Refresh, post-send, and
 *  post-confirmation reads), so a plain "updated Xs ago" is how a user
 *  actually tells freshness from staleness at a glance. */
function formatUpdatedAgo(lastFetchedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - lastFetchedAt) / 1000));
  if (seconds < 5) return "Updated just now";
  if (seconds < 60) return `Updated ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `Updated ${minutes}m ago`;
}

/** Ascending by `index`; an entry without one (legacy) sorts last. */
function byIndexAscending(a: ForeignKeyEntry, b: ForeignKeyEntry): number {
  const ai = typeof a.index === "number" ? a.index : Number.POSITIVE_INFINITY;
  const bi = typeof b.index === "number" ? b.index : Number.POSITIVE_INFINITY;
  return ai - bi;
}

/** There is no existing Arweave explorer constant anywhere in the codebase
 *  (`codex-arweave` deliberately holds no `arweave.net` literal) — this is a
 *  new, local decision, exactly like Stoa's own `explorerUrl` in
 *  `StoaAccountsTab.tsx`. */
function explorerUrl(address: string): string {
  return `https://viewblock.io/arweave/address/${address}`;
}

/**
 * ArweaveAddressHighlight — round 19 owner correction: "the arweave account
 * must be shorted same as stoa accounts, first 3 last 3 characters
 * coloured, and ... in the middle." Ported from
 * `StoaAccountsTab.tsx`'s own `MeasuredHexHighlight`/`StoaAddressHighlight`
 * (`packages/codex-ouronet/src/ui/internal/StoaAddressHighlight.tsx`) —
 * duplicated rather than imported per this file's own established
 * "self-contained module, nothing shared across chain-panel packages"
 * convention (see the module JSDoc's own note on inline SVG glyphs). Same
 * exact behaviour: fills the available width, measured (not a fixed
 * length), balanced `head…tail` truncation only once it genuinely doesn't
 * fit, bold `edgeColor` on the first/last 3 characters. Applies to BOTH
 * mobile AND desktop — "this whole deal... must also be on the desktop
 * variant" — unlike most of this session's mobile-only work, a readability
 * improvement like this one has no reason to be mobile-exclusive.
 * `prefixChars` is 0 (unlike Stoa's own 2, for its `k:`/`u:`/`c:`/`w:`
 * prefix) — an Arweave address carries no such prefix to strip.
 */
function measureCharWidthIn(el: HTMLElement): number {
  if (typeof document === "undefined") return 0;
  const probe = document.createElement("span");
  probe.textContent = "0".repeat(100);
  probe.style.cssText = "position:absolute; left:-9999px; top:0; visibility:hidden; white-space:pre; pointer-events:none;";
  el.appendChild(probe);
  const w = probe.getBoundingClientRect().width / 100;
  el.removeChild(probe);
  return Number.isFinite(w) && w > 0 ? w : 0;
}
/** Balanced `start…end` fit into `chars` cells (or the whole string). */
function middleTruncateAddress(text: string, chars: number): string {
  if (chars >= text.length || chars < 3) return text;
  const keep = chars - 1;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return text.slice(0, head) + "…" + text.slice(text.length - tail);
}
/** Base color body + bold `edgeColor` on the FIRST 3 and LAST 3 characters
 *  of the ALREADY-truncated display string. Short strings (≤6 chars, where
 *  head/tail would overlap) render entirely in `edgeColor`. */
function highlightedAddress(s: string, baseColor: string, edgeColor: string) {
  if (s.length <= 6) return <span style={{ color: edgeColor, fontWeight: 700 }}>{s}</span>;
  const head = s.slice(0, 3);
  const mid = s.slice(3, s.length - 3);
  const tail = s.slice(s.length - 3);
  return (
    <>
      <span style={{ color: edgeColor, fontWeight: 700 }}>{head}</span>
      <span style={{ color: baseColor }}>{mid}</span>
      <span style={{ color: edgeColor, fontWeight: 700 }}>{tail}</span>
    </>
  );
}
/** Exported (round 28) so `PureKeysArea.tsx` can reuse it verbatim instead
 *  of duplicating the width-measurement logic — mirrors the SAME sibling-
 *  import precedent `PureKeysArea.tsx` already uses for `RsaParamsPanel`/
 *  `RsaParamsToggle`/`useRsaParamsSection` from `ArweaveSeedsArea.js`. */
export function ArweaveAddressHighlight({ address, baseColor = "#d2d3d4", style }: { address: string; baseColor?: string; style?: React.CSSProperties }): React.ReactElement {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(address);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let revealed = false;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const scheduleReveal = () => {
      if (revealed) return;
      if (settle) clearTimeout(settle);
      settle = setTimeout(() => { revealed = true; setReady(true); }, 120);
    };
    const compute = () => {
      const width = el.clientWidth;
      if (width <= 0) return;
      const charW = measureCharWidthIn(el);
      if (charW <= 0) { setDisplay(address); scheduleReveal(); return; }
      const fit = Math.floor(width / charW);
      setDisplay(fit >= address.length ? address : middleTruncateAddress(address, fit));
      scheduleReveal();
    };
    compute();
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(compute); ro.observe(el); }
    const safety = setTimeout(() => { if (!revealed) { revealed = true; setReady(true); } }, 700);
    return () => { ro?.disconnect(); if (settle) clearTimeout(settle); clearTimeout(safety); };
  }, [address]);

  return (
    <span
      ref={ref}
      title={address}
      style={{
        display: "block", overflow: "hidden", whiteSpace: "nowrap",
        visibility: ready ? "visible" : "hidden",
        ...style,
      }}
    >
      {highlightedAddress(display, baseColor, ACCENT)}
    </span>
  );
}

const iconButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 26,
  height: 26,
  borderRadius: 6,
  flexShrink: 0,
  cursor: "pointer",
  backgroundColor: "#141414",
  color: "#888",
  border: "1px solid #262626",
  textDecoration: "none",
};

const dangerIconButtonStyle: React.CSSProperties = {
  ...iconButtonStyle,
  color: "#f87171",
  border: "1px solid #7f1d1d",
};

/** MOBILE-ONLY Prev/Next pagination button style — same family as
 *  `StoaAccountsTab.tsx`'s own `pageBtn`, for consistency across the app's
 *  paginated mobile account lists. */
const pageBtn = (disabled: boolean): React.CSSProperties => ({
  fontSize: 12, padding: "6px 12px", borderRadius: 8, border: "1px solid #262626", color: "#d2d3d4",
  background: "transparent", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.3 : 1,
});

/** Portals `children` into `target` when supplied (a DOM node spanning the
 *  host's WHOLE mobile body — see `ArweaveAccountsAreaProps.fullScreenPortalTarget`'s
 *  doc comment); otherwise renders inline, unchanged. Mirrors
 *  `StoaAccountsTab.tsx`'s own `MobilePortal` exactly. */
function MobilePortal({ target, children }: { target?: Element | null; children: React.ReactNode }) {
  return target ? createPortal(children, target) : <>{children}</>;
}

/** Bigger square action-button chrome for the mobile SHARED bottom action
 *  bar (round 17 owner correction: "buttons below on the lower bar, with
 *  entry selection") — mirrors `StoaAccountsTab.tsx`'s own
 *  `sharedActionBtnStyle` exactly, so the two chains' mobile Accounts
 *  views read as one surface. */
const sharedActionBtnStyle = (disabled: boolean): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 30, height: 30, borderRadius: 8, flexShrink: 0,
  cursor: disabled ? "default" : "pointer",
  backgroundColor: "#141414", color: disabled ? "#3a3a3a" : ACCENT,
  border: "2px solid #252525", opacity: disabled ? 0.5 : 1,
});
const sharedActionIconStyle: React.CSSProperties = { width: 15, height: 15 };

/** A codex with hundreds of seeds/thousands of accounts can genuinely
 *  paginate into double digits — owner correction (design.md §8, round 8
 *  follow-up): "when there are more than 10 pages available the entry
 *  15/24 when clicked needs to allow the input of a given page, to jump
 *  directly to a wanted page." Below 10 pages, the plain "N / M" text is
 *  unchanged. Duplicated from `StoaAccountsTab.tsx`'s identical component
 *  per this package's own "self-contained module" convention. */
function PageJumpIndicator({ page, totalPages, onJump }: { page: number; totalPages: number; onJump: (page: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  if (totalPages <= 10) {
    return <span style={{ fontSize: 12, fontFamily: MONO, color: "#888" }}>{page + 1} / {totalPages}</span>;
  }
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setDraft(String(page + 1)); setEditing(true); }}
        title="Jump to a page"
        style={{ fontSize: 12, fontFamily: MONO, color: "#ceac5f", background: "transparent", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline dotted" }}
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
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
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
        style={{ width: 44, fontSize: 12, fontFamily: MONO, padding: "2px 4px", borderRadius: 6, border: "1px solid #ceac5f", backgroundColor: "#0a0a0a", color: "#d2d3d4", textAlign: "center" }}
      />
      <span style={{ fontSize: 12, fontFamily: MONO, color: "#888" }}>/ {totalPages}</span>
    </span>
  );
}

/** The Delete flow's state machine when `getBalance` is wired — the exact
 *  same shape `PureKeysArea.tsx`'s `PureKeyRow` uses (design.md §3): `"idle"`
 *  (nothing shown yet), `"checking"` (the read is in flight), `"confirm"`
 *  (the plain, pre-existing confirm/cancel panel — reached directly when
 *  `getBalance` is absent, or after a zero/failed read, or for a funded
 *  Protected-tier row with sharper copy), `"blocked"` (funded + Unprotected —
 *  no delete action at all, only dismiss). */
type DeleteGuardState = "idle" | "checking" | "confirm" | "blocked";

/** The live value-cell read (T4), factored out of `AccountRow` so `WatchedRow`
 *  (T2) renders the identical loading/ready/error states off the SAME
 *  `balances` map the parent fetches into — a watched row's balance goes
 *  through the exact same `getBalance` pipeline as a Codex-owned row, per
 *  design.md. `testIdBase` is the caller's own per-row id prefix (e.g.
 *  `arweave-account-value-${entry.id}` / `arweave-watched-value-${w.id}`); the
 *  error state appends `-error`, unchanged from `AccountRow`'s original
 *  contract. */
function BalanceCell({
  testIdBase,
  address,
  balances,
}: {
  testIdBase: string;
  address: string;
  balances: Record<string, BalanceState>;
}): React.ReactElement {
  const balanceState = balances[address];
  const isError = balanceState?.status === "error";
  const testId = isError ? `${testIdBase}-error` : testIdBase;
  const content =
    balanceState?.status === "ready"
      ? `${winstonToAr(balanceState.balance)} AR`
      : balanceState?.status === "loading"
        ? "…"
        : "—";
  // Round 19 owner correction: "Arweave amount as blue, and aligned right."
  // A funded balance now reads in BALANCE_BLUE instead of the gold ACCENT
  // (gold stays reserved for the seed/position accents elsewhere on the
  // row) — both mobile AND desktop, this component is shared by both.
  const color =
    balanceState?.status === "ready"
      ? balanceState.balance > 0n
        ? BALANCE_BLUE
        : "#555"
      : isError
        ? "#f87171"
        : "#555";
  return (
    <span
      data-testid={testId}
      style={{
        fontFamily: MONO, fontSize: 12, fontWeight: 600, color, flexShrink: 0,
        // `textAlign: right` is a no-op on desktop (a shrink-to-fit flex-row
        // sibling, already exactly as wide as its own text) but is what
        // actually right-aligns it on mobile, where this is the SOLE
        // content of its own line and stretches to the row's full width
        // (the parent's `flexDirection: column` defaults to
        // `align-items: stretch` on its children).
        display: "block", textAlign: "right",
      }}
    >
      {content}
    </span>
  );
}

/** The copy-address icon button, shared by `AccountRow` and `WatchedRow` —
 *  same green-check-then-revert feedback as Chainweb's `IconCopyBtn`
 *  (`StoaAccountsTab.tsx`), which this previously had no equivalent of: a
 *  click here used to give no visible confirmation at all. Mirrors
 *  `IconCopyBtn`'s exact timing (1200ms) and color swap (green background +
 *  border + icon while `copied`). */
function CopyButton({ testId, address }: { testId: string; address: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      data-testid={testId}
      title="Copy address"
      aria-label="Copy address"
      onClick={(e) => {
        e.stopPropagation();
        // Same idiom as `ArweaveSeedsArea.tsx`'s copy handler: `void` a
        // possibly-undefined result rather than chaining `.catch` onto it,
        // since a bare `vi.fn()` test double returns `undefined`.
        void navigator.clipboard?.writeText(address);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      style={{
        ...iconButtonStyle,
        backgroundColor: copied ? "#0a2a14" : iconButtonStyle.backgroundColor,
        color: copied ? "#4ade80" : iconButtonStyle.color,
        border: copied ? "1px solid rgba(74,222,128,0.4)" : iconButtonStyle.border,
      }}
    >
      {copied ? (
        <CheckGlyph style={{ width: 13, height: 13 }} />
      ) : (
        <CopyGlyph style={{ width: 13, height: 13 }} />
      )}
    </button>
  );
}

function AccountRow({
  entry,
  onDeleteKey,
  getBalance,
  protectedTier,
  balances,
  deps,
  onSendSuccess,
  seedBadge,
  selected,
  onSelect,
}: {
  entry: ForeignKeyEntry;
  onDeleteKey?: (entry: ForeignKeyEntry) => Promise<void> | void;
  getBalance?: (address: string) => Promise<bigint>;
  /** This row's group's balance-delete-guard tier (design.md §3). Only
   *  consulted once a funded balance is actually read. */
  protectedTier: boolean;
  /** The live value-cell read state, keyed by address (T4) — owned and
   *  fetched by {@link ArweaveAccountsArea}, not this row. */
  balances: Record<string, BalanceState>;
  /** T7: the injected seam bundle the Send modal needs. Absent → no Send
   *  button renders at all (same gating as `onDeleteKey`). */
  deps?: ArweavePanelDeps;
  /** T7: fired with this row's address on a successful send, so the parent
   *  can re-fire T4's `fetchBalances([address])` for exactly this row. */
  onSendSuccess?: (address: string) => void;
  /**
   * MOBILE ONLY, round 11 owner correction: "instead of listing the
   * entries as part of a seed, we should make the entry carry a medallion
   * to see from which seed it belongs." A small colour-coded dot next to
   * the row's own position badge — see `colorForGroupId`'s own doc
   * comment — plus (round 13) a thin pill straddling the card's own top
   * border carrying the seed's actual NAME (see the render below for the
   * full reasoning). Omitted (desktop, which keeps `GroupSection`'s own
   * header instead), neither shows.
   */
  seedBadge?: { name: string; color: string };
  /**
   * MOBILE ONLY, round 17 owner correction: "we need to do the same thing
   * with the addresses of arweave, arweave account one line, balance one
   * line, and buttons below on the lower bar, with entry selection" —
   * ports `StoaAccountsTab.tsx`'s own `AddressRow` mobile pattern exactly:
   * tapping a row selects it (medallion lights up), the actual action
   * buttons live on {@link ArweaveAccountsArea}'s own shared bottom bar
   * instead of on each row. Desktop ignores both — its own inline
   * Send/Copy/Explorer/Delete row (below) is untouched.
   */
  selected?: boolean;
  onSelect?: () => void;
}): React.ReactElement {
  // `address` is plaintext public material; `id` is the fallback. The
  // `encryptedKeyfile` is never read here — see module JSDoc.
  const address = entry.address ?? entry.id;
  const numberedPosition = typeof entry.index === "number" ? `#${entry.index}` : null;
  // Round 20 owner correction: "the fat hippo name needs to be in its own
  // medalion on the opposite side" — a Pure Key (or any other label-only,
  // no-index entry) previously fell back to cramming its own free-text
  // `label` straight into the small circular position medallion (no
  // `overflow: hidden` on that circle at all), which simply overflowed
  // past its bounds for anything longer than 1-2 characters — exactly
  // what the screenshot showed. The medallion itself now shows a short
  // AVATAR-style initial instead when there's no numeric index; the full
  // label gets its OWN small pill, mirroring `seedBadge`'s own straddling
  // top-border pill but on the OPPOSITE (right) side — `seedBadge` (the
  // GROUP name, e.g. "Pure Keys") sits top-left; this (the entry's OWN
  // label, e.g. "FatHippo") sits top-right — the two never collide.
  const position = numberedPosition ?? (entry.label ? entry.label.slice(0, 2).toUpperCase() : "—");
  const isMobile = useIsMobile();
  const [sendOpen, setSendOpen] = useState(false);

  /** Confirm-then-delete: matches Arweave's OWN seed-delete pattern
   *  (`ArweaveSeedsArea.tsx`'s `SeedRow`), not Chainweb's immediate `onRemove`
   *  — a key costs ~6.7 s of RSA-4096 search to regenerate, so a stray click
   *  must not be destructive. DESKTOP ONLY (round 17): mobile Codex rows
   *  never carry a delete control at all — the same rule
   *  `StoaAccountsTab.tsx`'s own mobile `AddressRow` already follows (a
   *  seed-derived entry is only ever deleted via its own seed, at the
   *  Seeds category), and this component's own real wiring
   *  (`ArweavePanel.tsx`) never threads `onDeleteKey` into Accounts at all
   *  — "Accounts is a pure listing... it never deletes" (module JSDoc on
   *  the `onDeleteKey` prop below `ArweaveAccountsAreaProps`). */
  const [deleteGuard, setDeleteGuard] = useState<DeleteGuardState>("idle");
  const [fundedBalance, setFundedBalance] = useState<bigint | null>(null);
  const confirmingDelete = deleteGuard === "confirm";

  // Round 20 — the entry's OWN label (e.g. a Pure Key's custom name), as
  // its own small pill on the border's opposite (right) side. Only when
  // there's no numeric index (a Pure Key or legacy/imported entry) — a
  // seed-derived row's "Key #N" position never doubles as a free-text
  // label the way a Pure Key's does.
  const labelPill = numberedPosition === null && entry.label ? entry.label : null;

  return (
    <div style={{ position: seedBadge || labelPill ? "relative" : undefined }}>
      {/* Owner correction (round 13, ported from `StoaAccountsTab.tsx`'s
          identical change): "i was thinking adding [the seed name] in
          upper left side, on the border (like we did for the medallions
          of Stoa/UrStoa Codex/Watched), this would keep the entry with a
          smaller height necessary, and would allow more to fit in a given
          area." Round 12 put the name INSIDE the row's own content flow
          (a fixed height cost on every row); this straddles the card's
          own TOP border instead, "half in half out" — the same geometry
          `ChainwebPanel.tsx`'s `SeamMedallion`/`SplitSeamMedallion` use for
          the zone-level toggles, scoped to just this one entry's border.
          Being `position: absolute`, it costs the row's own measured
          height NOTHING (an absolutely positioned sibling never
          contributes to its relative parent's normal-flow height) —
          rendered as a SIBLING of the bordered card, not a child of it,
          because the card keeps its own `overflow: hidden` for its
          rounded corners (the same "position OUTSIDE the clipping
          ancestor" rule `SeamMedallion`'s own bug fix #1 documents). */}
      {seedBadge && (
        <span
          title={seedBadge.name}
          style={{
            position: "absolute", top: 0, left: 14, transform: "translateY(-50%)",
            zIndex: 2, maxWidth: "calc(100% - 28px)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            // Round 15 — a touch smaller (was height 18 / 1.5px border):
            // less poke-out above the row's own border means `ACCOUNT_ROW_GAP`
            // can shrink too (more rows fit per page) while still clearing it.
            height: 16, padding: "0 7px", borderRadius: 9999,
            display: "inline-flex", alignItems: "center",
            fontSize: 9, fontWeight: 700,
            backgroundColor: "#0a0a0a", border: `1px solid ${seedBadge.color}`, color: seedBadge.color,
          }}
        >
          {seedBadge.name}
        </span>
      )}
      {/* Round 20 — the entry's OWN label, mirroring `seedBadge`'s exact
          straddling-pill geometry but on the OPPOSITE side (`right: 14`
          instead of `left: 14`) so it never collides with a group's own
          `seedBadge` pill when both are present on the same row (e.g. a
          Pure Key, which sits inside the "Pure Keys" pseudo-group AND
          carries its own custom name). Purple — the SAME "Pure Keys"
          identity colour `StoaAccountsTab.tsx`'s own Pure Key Pairs group
          already uses, for a consistent cross-chain read. */}
      {labelPill && (
        <span
          title={labelPill}
          style={{
            position: "absolute", top: 0, right: 14, transform: "translateY(-50%)",
            zIndex: 2, maxWidth: "calc(100% - 28px)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            height: 16, padding: "0 7px", borderRadius: 9999,
            display: "inline-flex", alignItems: "center",
            fontSize: 9, fontWeight: 700,
            backgroundColor: "#0a0a0a", border: "1px solid #a78bfa", color: "#a78bfa",
          }}
        >
          {labelPill}
        </span>
      )}
    <div
      data-testid="arweave-account-row"
      data-index={typeof entry.index === "number" ? String(entry.index) : undefined}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "8px 12px",
        borderRadius: 10,
        border: "1px solid #1a1a1a",
        backgroundColor: "#0a0a0a",
      }}
    >
      {isMobile ? (
        /* Round 17 owner correction: "arweave account one line, balance
           one line, and buttons below on the lower bar, with entry
           selection" — mirrors `StoaAccountsTab.tsx`'s own mobile
           `AddressRow` exactly: a leading medallion (lit when selected),
           the address filling its own line, the balance on the line below
           it, and NO per-row buttons at all — those now live on
           {@link ArweaveAccountsArea}'s own shared bottom bar, tied to
           whichever row is currently selected. Desktop's own header row
           below (unchanged) still carries its own inline buttons. */
        <div
          onClick={() => onSelect?.()}
          style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}
        >
          <div style={{ flexShrink: 0, position: "relative", width: 34, height: 34 }}>
            <div
              style={{
                width: 34, height: 34, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700, fontFamily: MONO,
                color: selected ? "#ceac5f" : ACCENT,
                backgroundColor: selected ? "#ceac5f22" : ACCENT + "1a",
                border: selected ? "2px solid #ceac5f" : `1px solid ${ACCENT}40`,
                boxShadow: selected ? "0 0 10px #ceac5f66" : "none",
                transition: "all 0.15s",
              }}
            >
              {position}
            </div>
            {/* Round 11's TYPE-only corner dot — dropped when round 17
                split this row's mobile layout out of the shared JSX; put
                back on the new circular medallion, same convention
                `StoaAccountsTab.tsx`'s own mobile `AddressRow` uses. */}
            {seedBadge && (
              <span
                title={seedBadge.name}
                aria-label={`From ${seedBadge.name}`}
                style={{
                  position: "absolute", bottom: -1, right: -1, width: 11, height: 11, borderRadius: "50%",
                  backgroundColor: seedBadge.color, border: "2px solid #0a0a0a",
                }}
              />
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            <ArweaveAddressHighlight address={address} style={{ fontFamily: MONO, fontSize: 12 }} />
            <BalanceCell testIdBase={`arweave-account-value-${entry.id}`} address={address} balances={balances} />
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: ACCENT, flexShrink: 0 }}>
              {position}
            </span>
            {seedBadge && (
              <span
                title={seedBadge.name}
                aria-label={`From ${seedBadge.name}`}
                style={{
                  flexShrink: 0, width: 9, height: 9, borderRadius: "50%",
                  backgroundColor: seedBadge.color,
                }}
              />
            )}
            <ArweaveAddressHighlight address={address} style={{ flex: 1, minWidth: 0, fontFamily: MONO, fontSize: 12 }} />
            {/* T4: the live value cell — fetched by the parent via `getBalance`,
                one call per row on mount and on "Refresh" (Promise.allSettled).
                `balances[address]` is absent entirely when `getBalance` was never
                wired at all (an inert "—", never attempted a read). */}
            <BalanceCell testIdBase={`arweave-account-value-${entry.id}`} address={address} balances={balances} />
            <span
              onClick={(e) => e.stopPropagation()}
              style={{ display: "inline-flex", gap: 6, flexShrink: 0 }}
            >
              {deps && (
                <button
                  type="button"
                  data-testid={`arweave-account-send-${entry.id}`}
                  title="Send AR"
                  aria-label="Send AR"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSendOpen(true);
                  }}
                  style={iconButtonStyle}
                >
                  <SendGlyph style={{ width: 13, height: 13 }} />
                </button>
              )}
              <CopyButton testId={`arweave-account-copy-${entry.id}`} address={address} />
              <a
                data-testid={`arweave-account-explorer-${entry.id}`}
                href={explorerUrl(address)}
                target="_blank"
                rel="noopener noreferrer"
                title="Open in Explorer"
                aria-label="Open in Explorer"
                onClick={(e) => e.stopPropagation()}
                style={iconButtonStyle}
              >
                <ExternalLinkGlyph style={{ width: 13, height: 13 }} />
              </a>
              {onDeleteKey && (
                <button
                  type="button"
                  data-testid={`arweave-account-delete-${entry.id}`}
                  title="Delete this key"
                  aria-label="Delete this key"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (getBalance === undefined) {
                      setDeleteGuard("confirm");
                      return;
                    }
                    setDeleteGuard("checking");
                    getBalance(address)
                      .then((balance) => {
                        if (balance > 0n && !protectedTier) {
                          setFundedBalance(balance);
                          setDeleteGuard("blocked");
                        } else {
                          // Zero/failed read, OR funded-but-Protected: same plain
                          // confirm-then-delete action as today — Protected just
                          // gets sharper copy below.
                          setFundedBalance(balance > 0n ? balance : null);
                          setDeleteGuard("confirm");
                        }
                      })
                      .catch(() => {
                        setFundedBalance(null);
                        setDeleteGuard("confirm");
                      });
                  }}
                  style={dangerIconButtonStyle}
                >
                  <TrashGlyph style={{ width: 13, height: 13 }} />
                </button>
              )}
            </span>
          </div>

          {deleteGuard === "checking" && (
            <div
              data-testid={`arweave-account-delete-checking-${entry.id}`}
              style={{ fontSize: 12, color: "#888" }}
            >
              Checking balance…
            </div>
          )}

          {confirmingDelete && (
            <div
              data-testid={`arweave-account-delete-confirm-panel-${entry.id}`}
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid #7f1d1d",
                backgroundColor: "#1a0a0a",
                fontSize: 12,
                color: "#f87171",
              }}
            >
              <span style={{ flex: 1, minWidth: 180 }}>
                {fundedBalance !== null
                  ? `This address holds ${winstonToAr(fundedBalance)} AR. Deleting it is possible but not reversible without the seed that made it.`
                  : "Delete this Arweave key? It cannot be regenerated without its seed."}
              </span>
              <button
                type="button"
                data-testid={`arweave-account-delete-confirm-${entry.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteGuard("idle");
                  void onDeleteKey?.(entry);
                }}
                style={{ ...dangerIconButtonStyle, width: "auto", padding: "0 10px", fontSize: 12 }}
              >
                Delete
              </button>
              <button
                type="button"
                data-testid={`arweave-account-delete-cancel-${entry.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteGuard("idle");
                }}
                style={{ ...iconButtonStyle, width: "auto", padding: "0 10px", fontSize: 12 }}
              >
                Cancel
              </button>
            </div>
          )}

          {deleteGuard === "blocked" && fundedBalance !== null && (
            <div
              data-testid={`arweave-account-delete-blocked-${entry.id}`}
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid #7f1d1d",
                backgroundColor: "#1a0a0a",
                fontSize: 12,
                color: "#f87171",
              }}
            >
              <span style={{ flex: 1, minWidth: 180 }}>
                {`This address holds ${winstonToAr(fundedBalance)} AR and has no seed behind it — ` +
                  "it can never be regenerated. Deletion is disabled to prevent irreversible fund loss."}
              </span>
              <button
                type="button"
                data-testid={`arweave-account-delete-dismiss-${entry.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteGuard("idle");
                }}
                style={{ ...iconButtonStyle, width: "auto", padding: "0 10px", fontSize: 12 }}
              >
                Dismiss
              </button>
            </div>
          )}

          {deps && (
            <SendArweaveModal
              entry={entry}
              isOpen={sendOpen}
              onClose={() => setSendOpen(false)}
              deps={deps}
              onSuccess={() => onSendSuccess?.(address)}
              // Reuses the SAME balances map the value cell above already reads
              // (T4) — no extra fetch. Undefined (loading/error/unfetched)
              // simply leaves the modal's amount-fits-balance check inert; it
              // never blocks submit on an unknown balance (see the modal's own
              // prop doc).
              senderBalanceWinston={balances[address]?.status === "ready" ? balances[address].balance : undefined}
            />
          )}
        </>
      )}
    </div>
    </div>
  );
}

/** T2: one row of the Watched Accounts sub-tab — a third-party address the
 *  codex holds no private key for. `WatchListEntry` cannot be handed to
 *  `AccountRow` unmodified (it takes a `ForeignKeyEntry`, which carries a
 *  mandatory `encryptedKeyfile`), so this is a SEPARATE component, not an
 *  overload.
 *
 *  Mirrors `AccountRow`'s layout (address text, the SAME `BalanceCell` off the
 *  SAME `balances` map, copy, ViewBlock explorer link) plus an inline label
 *  editor and a remove button, mirroring `StoaAccountsTab.tsx`'s own watched
 *  row (`onRelabel`/`onRemove`, upsert-by-id semantics).
 *
 *  Deliberately carries NO `deps` prop and renders NO Send control anywhere:
 *  there is no private key behind a watched address to sign a send with. */
function WatchedRow({
  entry,
  balances,
  onRelabel,
  onRemove,
  selected,
  onSelect,
}: {
  entry: WatchListEntry;
  /** The live value-cell read state, keyed by address (T4) — the SAME map
   *  {@link ArweaveAccountsArea} fetches for the Codex rows; a watched
   *  address's own address is included in that same fetch. */
  balances: Record<string, BalanceState>;
  /** Relabels this watched entry. Absent → no label editor renders (mirrors
   *  `onDeleteKey`'s own gating on `AccountRow`). */
  onRelabel?: (label: string) => void;
  /** Removes this watched entry. Absent → no remove control renders. */
  onRemove?: () => void;
  /** MOBILE ONLY, round 17 — mirrors `AccountRow`'s own `selected`/
   *  `onSelect` exactly (see its own doc comment): the row's medallion
   *  lights up when selected, and the actual remove control lives on
   *  {@link ArweaveAccountsArea}'s own shared bottom bar instead of here.
   *  Desktop ignores both. */
  selected?: boolean;
  onSelect?: () => void;
}): React.ReactElement {
  const isMobile = useIsMobile();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.label);

  const saveLabel = (): void => {
    onRelabel?.(draft.trim());
    setEditing(false);
  };

  return (
    <div
      data-testid="arweave-watched-row"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "8px 12px",
        borderRadius: 10,
        border: "1px solid #1a1a1a",
        backgroundColor: "#0a0a0a",
      }}
    >
      {isMobile ? (
        /* Round 17 — mirrors `AccountRow`'s own mobile layout (see its
           doc comment): one line for the address, one for the balance, a
           lit-when-selected medallion (an eye glyph — this row's own
           "watched" identity, no position/index the way a Codex row
           has), no per-row buttons. */
        <div
          onClick={() => onSelect?.()}
          style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}
        >
          <div
            style={{
              flexShrink: 0, width: 34, height: 34, borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: selected ? "#ceac5f" : ACCENT,
              backgroundColor: selected ? "#ceac5f22" : ACCENT + "1a",
              border: selected ? "2px solid #ceac5f" : `1px solid ${ACCENT}40`,
              boxShadow: selected ? "0 0 10px #ceac5f66" : "none",
              transition: "all 0.15s",
            }}
          >
            <EyeGlyph style={{ width: 15, height: 15 }} />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            <ArweaveAddressHighlight address={entry.address} style={{ fontFamily: MONO, fontSize: 12 }} />
            <BalanceCell testIdBase={`arweave-watched-value-${entry.id}`} address={entry.address} balances={balances} />
          </div>
        </div>
      ) : (
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <ArweaveAddressHighlight address={entry.address} style={{ flex: 1, minWidth: 0, fontFamily: MONO, fontSize: 12 }} />
        <BalanceCell
          testIdBase={`arweave-watched-value-${entry.id}`}
          address={entry.address}
          balances={balances}
        />
        <span
          onClick={(e) => e.stopPropagation()}
          style={{ display: "inline-flex", gap: 6, flexShrink: 0 }}
        >
          {/* Deliberately NO Send button here — a watched address has no
              private key behind it to sign a send with (module JSDoc). */}
          <CopyButton testId={`arweave-watched-copy-${entry.id}`} address={entry.address} />
          <a
            data-testid={`arweave-watched-explorer-${entry.id}`}
            href={explorerUrl(entry.address)}
            target="_blank"
            rel="noopener noreferrer"
            title="Open in Explorer"
            aria-label="Open in Explorer"
            onClick={(e) => e.stopPropagation()}
            style={iconButtonStyle}
          >
            <ExternalLinkGlyph style={{ width: 13, height: 13 }} />
          </a>
          {onRemove && (
            <button
              type="button"
              data-testid={`arweave-watched-remove-${entry.id}`}
              title="Stop watching this address"
              aria-label="Stop watching this address"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              style={dangerIconButtonStyle}
            >
              <TrashGlyph style={{ width: 13, height: 13 }} />
            </button>
          )}
        </span>
      </div>
      )}

      {!isMobile && onRelabel && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: "#555" }}>Label</span>
          {editing ? (
            <>
              <input
                autoFocus
                data-testid={`arweave-watched-label-input-${entry.id}`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveLabel();
                  if (e.key === "Escape") setEditing(false);
                }}
                style={{
                  flex: 1,
                  height: 26,
                  fontSize: 12,
                  padding: "0 8px",
                  borderRadius: 6,
                  backgroundColor: "#0a0a0a",
                  border: "1px solid #4ade8060",
                  color: "#d2d3d4",
                }}
              />
              <button
                type="button"
                data-testid={`arweave-watched-label-save-${entry.id}`}
                onClick={saveLabel}
                style={{ ...iconButtonStyle, width: "auto", padding: "0 10px", fontSize: 12 }}
              >
                Save
              </button>
              <button
                type="button"
                data-testid={`arweave-watched-label-cancel-${entry.id}`}
                onClick={() => setEditing(false)}
                style={{ ...iconButtonStyle, width: "auto", padding: "0 10px", fontSize: 12 }}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              data-testid={`arweave-watched-label-edit-${entry.id}`}
              onClick={() => {
                setDraft(entry.label);
                setEditing(true);
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 6,
                background: "transparent",
                border: "1px solid #262626",
                color: "#888",
                cursor: "pointer",
              }}
            >
              {entry.label || "(set label)"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function GroupSection({
  group,
  onDeleteKey,
  getBalance,
  balances,
  deps,
  onSendSuccess,
  open: openProp,
  onToggle,
  showHeader = true,
  entriesOverride,
  firstRowRef,
}: {
  group: Group;
  onDeleteKey?: (entry: ForeignKeyEntry) => Promise<void> | void;
  getBalance?: (address: string) => Promise<bigint>;
  balances: Record<string, BalanceState>;
  deps?: ArweavePanelDeps;
  onSendSuccess?: (address: string) => void;
  /** Controlled open state — mobile-only "Collapse All" drives every group
   *  at once through this pair (same "controlled prop with internal-state
   *  fallback" pattern used throughout this codebase). Omitted, this
   *  component falls back to its own internal `useState` (desktop, fully
   *  self-contained, unchanged). */
  open?: boolean;
  onToggle?: () => void;
  /** MOBILE PAGINATION ONLY: when a group's own entries don't all fit on
   *  ONE page, the remaining entries continue on the NEXT page — but the
   *  header (and its collapse toggle) must NOT repeat, since it already
   *  appeared on the previous page and this same group is, by definition,
   *  already open. `false` renders just the bordered card + entries, no
   *  header row at all. */
  showHeader?: boolean;
  /** MOBILE PAGINATION ONLY: the SLICE of `group.entries` that belongs on
   *  THIS page's block — omitted (desktop, and any other caller), the
   *  full `group.entries` renders as before. */
  entriesOverride?: ForeignKeyEntry[];
  /** MOBILE PAGINATION ONLY: attached to the wrapper of the FIRST rendered
   *  row across the whole page, for `useSlotPageSize`'s live measurement. */
  firstRowRef?: (node: HTMLDivElement | null) => void;
}): React.ReactElement {
  const [openState, setOpenState] = useState(true);
  const open = openProp ?? openState;
  const toggle = onToggle ?? (() => setOpenState((v) => !v));
  const entries = entriesOverride ?? group.entries;
  return (
    <div
      data-testid={`arweave-accounts-group-${group.id}`}
      style={{ border: "1px solid #262626", borderRadius: 12, overflow: "hidden" }}
    >
      {showHeader && (
        <div
          role="button"
          tabIndex={0}
          aria-expanded={open}
          data-testid={`arweave-accounts-toggle-${group.id}`}
          onClick={toggle}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            cursor: "pointer",
            backgroundColor: "#0d0d0d",
          }}
        >
          {open ? (
            <ChevronDownGlyph style={{ width: 16, height: 16, flexShrink: 0, color: ACCENT }} />
          ) : (
            <ChevronRightGlyph style={{ width: 16, height: 16, flexShrink: 0, color: "#555" }} />
          )}
          {/* Same "smaller screen" overflow fix as `StoaAccountsTab`'s own
              `GroupRow` header (design.md §8, round 8 follow-up): a
              `flex: 1` child with no `minWidth: 0` won't shrink below its
              own text width, so a longer seed label can push the count
              badge off its line instead of the row truncating cleanly. */}
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600, fontSize: 14, color: "#d2d3d4" }}>{group.label}</span>
          <span
            data-testid={`arweave-accounts-count-${group.id}`}
            style={{
              flexShrink: 0,
              fontSize: 11,
              fontWeight: 600,
              padding: "1px 8px",
              borderRadius: 9999,
              color: "#555",
              backgroundColor: "#1a1a1a",
            }}
          >
            {group.entries.length}
          </span>
        </div>
      )}
      {(showHeader ? open : true) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10 }}>
          {entries.length === 0 ? (
            <div style={{ fontSize: 12, color: "#666" }}>No addresses generated from this seed yet.</div>
          ) : (
            entries.map((entry, i) => (
              <div key={entry.id} ref={i === 0 ? firstRowRef : undefined}>
                <AccountRow
                  entry={entry}
                  onDeleteKey={onDeleteKey}
                  getBalance={getBalance}
                  protectedTier={group.protected}
                  balances={balances}
                  deps={deps}
                  onSendSuccess={onSendSuccess}
                />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function ArweaveAccountsArea({
  entries,
  seeds,
  onDeleteKey,
  getBalance,
  deps,
  watchedEntries = EMPTY_WATCHED_ENTRIES,
  onAddWatched,
  onRemoveWatched,
  subTab: subTabProp,
  onSubTabChange,
  onTotalChange,
  onRefreshHandleChange,
  onSubTabCountsChange,
  onAccountsBreakdownChange,
  onPaginationHandleChange,
  fullScreenPortalTarget,
  zone3AnchorTarget,
}: ArweaveAccountsAreaProps): React.ReactElement {
  const isMobile = useIsMobile();
  const [localSubTab, setLocalSubTab] = useState<"codex" | "watch">("codex");
  const subTab = subTabProp ?? localSubTab;
  const setSubTab = onSubTabChange ?? setLocalSubTab;
  // MOBILE ONLY (design.md §8, round 17 — ported from `StoaAccountsTab.tsx`'s
  // own selection mechanism): "arweave account one line, balance one line,
  // and buttons below on the lower bar, with entry selection." The user's
  // own EXPLICIT choice (or `null` — "no explicit choice yet/anymore");
  // mirrors `StoaAccountsTab`'s own `selectedAddressState` rule exactly:
  // "there is no state where no entry is selected. always an entry is
  // selected, and by default that is the first entry of the first seed on
  // the list" — the EFFECTIVE selection (below, once `entries`/
  // `watchedEntries` exist) falls back to the current subtab's first entry
  // whenever the explicit choice is absent OR belongs to the OTHER subtab.
  const [selectedAddressState, setSelectedAddressState] = useState<string | null>(null);
  const [mobileActiveModal, setMobileActiveModal] = useState<null | "send">(null);

  // T4: live per-row balances. Every entry's resolvable address — same
  // fallback the row itself uses (`entry.address ?? entry.id`) — PLUS (T2)
  // every watched address, so a watched row reads its balance through the
  // exact same fetch/refresh pipeline as a Codex-owned row.
  const addresses = useMemo(
    () => [
      ...entries.map((entry) => entry.address ?? entry.id),
      ...watchedEntries.map((w) => w.address),
    ],
    [entries, watchedEntries],
  );
  const [balances, setBalances] = useState<Record<string, BalanceState>>({});
  // When the FULL set (`refreshAllBalances`) last actually completed a read —
  // NOT when a per-row `fetchBalances([address])` fires alone, so "updated
  // Xs ago" always describes what the visible "Live balances" label claims.
  // `null` until the first read resolves (nothing rendered yet to be stale).
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  // Ticks once a second purely to force a re-render — `formatUpdatedAgo`
  // itself reads `Date.now()` fresh each render; this is what makes "Updated
  // 3s ago" advance on screen without any new network read.
  const [, setClockTick] = useState(0);

  /** Reads `getBalance(address)` for the given addresses, ALL in parallel via
   *  `Promise.allSettled` (no bulk-read capability exists in arweave-core —
   *  design.md), marking each address "loading" first so the value cell never
   *  silently keeps its stale content while a new read is in flight.
   *
   *  Also THE per-row refresh hook point a later task (T7's Send modal, after
   *  a successful send) can reuse — `fetchBalances([address])` refreshes
   *  exactly that one row without re-fetching every other row. */
  const fetchBalances = useCallback(
    (targets: readonly string[]) => {
      if (!getBalance) return;
      setBalances((prev) => {
        const next = { ...prev };
        for (const addr of targets) next[addr] = { status: "loading" };
        return next;
      });
      void Promise.allSettled(targets.map((addr) => getBalance(addr))).then((results) => {
        setBalances((prev) => {
          const next = { ...prev };
          results.forEach((result, i) => {
            const addr = targets[i];
            next[addr] =
              result.status === "fulfilled"
                ? { status: "ready", balance: result.value }
                : { status: "error" };
          });
          return next;
        });
      });
    },
    [getBalance],
  );

  const refreshAllBalances = useCallback(() => {
    fetchBalances(addresses);
    setLastFetchedAt(Date.now());
  }, [fetchBalances, addresses]);

  // Fires once per row on mount, and again whenever the entry list itself
  // changes (a key generated/imported/deleted) — re-reading the FULL set,
  // matching `refreshAllBalances`'s own scope.
  useEffect(() => {
    refreshAllBalances();
  }, [refreshAllBalances]);

  // Real on-chain confirmation for an Arweave send arrives up to ~10 minutes
  // AFTER `sendFrom` resolves (toastManager.ts's arweave poll) — long after
  // this row's own post-send `fetchBalances([address])` already fired at
  // BROADCAST time, before the debit was final. Without this, the balance
  // shown here just silently stays the pre-send figure until the user
  // remembers to click Refresh themselves. `onTxConfirmed` is a blunt "ANY
  // tx confirmed, somewhere" signal (no payload) — refreshing every visible
  // balance on it is cheap for this panel's realistic address counts and is
  // always correct, unlike guessing which single row to target.
  useEffect(() => onTxConfirmed(refreshAllBalances), [refreshAllBalances]);

  // Ticks the "updated Xs ago" label forward once a second while mounted.
  useEffect(() => {
    const id = setInterval(() => setClockTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const anyBalanceLoading = addresses.some((addr) => balances[addr]?.status === "loading");

  const groups = useMemo<Group[]>(() => {
    const known = new Map<string, ForeignKeyEntry[]>(seeds.map((seed) => [seed.id, []]));
    // Genuinely seedless (`seedId === undefined`) — the exact filter
    // `PureKeysArea.tsx` uses for its own list. These duplicate into that
    // standalone tab, so they group here as "Pure Keys", not "Unassigned".
    const pureKeys: ForeignKeyEntry[] = [];
    // A `seedId` naming no known seed — a TRUE orphan (unknown/legacy
    // provenance), distinct from the above.
    const unassigned: ForeignKeyEntry[] = [];

    for (const entry of entries) {
      if (entry.seedId === undefined) {
        pureKeys.push(entry);
        continue;
      }
      const bucket = known.get(entry.seedId);
      // A seedId naming no known seed → Unassigned, never dropped.
      if (bucket === undefined) unassigned.push(entry);
      else bucket.push(entry);
    }

    const out: Group[] = seeds.map((seed, i) => ({
      id: seed.id,
      // Same rule as Stoa: the prime seed is named by the product, not by its
      // stored label; every other seed falls back to its position.
      label: seed.isPrime === true || i === 0 ? PRIME_LABEL : seed.label || `Seed #${i + 1}`,
      entries: [...(known.get(seed.id) ?? [])].sort(byIndexAscending),
      // Protected unless the seed EXPLICITLY says its words are unknown this
      // session; absent `hasWords` (an older caller) defaults to Protected —
      // the conservative direction for a caller that predates this feature
      // (design.md §3).
      protected: seed.hasWords !== false,
    }));
    if (pureKeys.length > 0) {
      out.push({
        id: PURE_KEYS_ID,
        label: PURE_KEYS_LABEL,
        entries: [...pureKeys].sort(byIndexAscending),
        // Always Unprotected: no seed at all, by definition.
        protected: false,
      });
    }
    if (unassigned.length > 0) {
      out.push({
        id: UNASSIGNED_ID,
        label: UNASSIGNED_LABEL,
        entries: [...unassigned].sort(byIndexAscending),
        // Always Unprotected: unknown/legacy provenance, never provably recoverable.
        protected: false,
      });
    }
    return out;
  }, [entries, seeds]);

  // "Report upward, don't duplicate the underlying logic" — same shape
  // `StoaAccountsTab`'s own `onTotalChange`/`onRefreshHandleChange`/
  // `onSubTabCountsChange`/`onAccountsBreakdownChange` use; `ArweavePanel`
  // renders the actual medallions/buttons on its own mobile category row,
  // this component supplies what they should show/do.
  useEffect(() => {
    onTotalChange?.(entries.length + watchedEntries.length);
  }, [entries.length, watchedEntries.length, onTotalChange]);

  useEffect(() => {
    onRefreshHandleChange?.({ refresh: refreshAllBalances, loading: anyBalanceLoading, error: false });
  }, [refreshAllBalances, anyBalanceLoading, onRefreshHandleChange]);

  useEffect(() => {
    onSubTabCountsChange?.({ codex: entries.length, watch: watchedEntries.length });
  }, [entries.length, watchedEntries.length, onSubTabCountsChange]);

  // "m being the number of accounts from seeds, n the number of seeds, and
  // x the number of direct accounts (no seeds)" — computed off the REAL
  // seed groups (excluding the Pure Keys / Unassigned pseudo-groups), with
  // both pseudo-groups' entries folded together as "direct" for this
  // purpose (neither has a seed behind it).
  const seedAccountsCount = useMemo(
    () => groups.filter((g) => g.id !== PURE_KEYS_ID && g.id !== UNASSIGNED_ID).reduce((sum, g) => sum + g.entries.length, 0),
    [groups],
  );
  const directAccountsCount = useMemo(
    () => groups.filter((g) => g.id === PURE_KEYS_ID || g.id === UNASSIGNED_ID).reduce((sum, g) => sum + g.entries.length, 0),
    [groups],
  );
  useEffect(() => {
    onAccountsBreakdownChange?.({ seedAccounts: seedAccountsCount, seedCount: seeds.length, directAccounts: directAccountsCount });
  }, [seedAccountsCount, seeds.length, directAccountsCount, onAccountsBreakdownChange]);

  // Round 11 — a fundamentally simpler, deterministic redesign: "instead
  // of listing the entries as part of a seed, we should make the entry
  // carry a medallion to see from which seed it belongs, thus making all
  // entries having a fixed size." MOBILE ONLY (desktop keeps the grouped
  // `GroupSection` list above, byte-identical): every group's entries
  // flatten into ONE uniform-height list, each entry tagged with its
  // OWNING group's name/colour for the small seed-badge `AccountRow`
  // renders (see its own `seedBadge` prop) — no more header units, no more
  // half-slot cost, no more "never leave a header alone" bundling rule, no
  // more Collapse-All (nothing left to collapse). The exact same trivial,
  // already-proven chunking `watchedEntries` uses below — a page is simply
  // `floor(slotsAvailable)` entries, period.
  const codexFlatEntries = useMemo(
    () => groups.flatMap((g) => g.entries.map((entry) => ({ entry, groupId: g.id, groupLabel: g.label, groupColor: colorForGroupId(g.id), groupProtected: g.protected }))),
    [groups],
  );

  // MOBILE ONLY — the measured pagination engine (see `useSlotPageSize`'s
  // own doc comment). Desktop keeps its original, unpaginated single-column
  // list untouched below (`isMobile` gates every consumer of this
  // measurement/these pages).
  const { containerRef: accountsPageContainerRef, rowRef: accountsPageRowRef, slotsAvailable } = useSlotPageSize();
  const codexPages = useMemo(() => {
    const perPage = Math.max(1, Math.floor(slotsAvailable));
    const out: typeof codexFlatEntries[] = [];
    for (let i = 0; i < codexFlatEntries.length; i += perPage) out.push(codexFlatEntries.slice(i, i + perPage));
    if (out.length === 0) out.push([]);
    return out;
  }, [codexFlatEntries, slotsAvailable]);
  const watchPages = useMemo(() => {
    const perPage = Math.max(1, Math.floor(slotsAvailable));
    const out: typeof watchedEntries[] = [];
    for (let i = 0; i < watchedEntries.length; i += perPage) out.push(watchedEntries.slice(i, i + perPage));
    if (out.length === 0) out.push([]);
    return out;
  }, [watchedEntries, slotsAvailable]);
  const [codexPageIndex, setCodexPageIndex] = useState(0);
  const [watchPageIndex, setWatchPageIndex] = useState(0);
  const codexPage = Math.max(0, Math.min(codexPageIndex, codexPages.length - 1));
  const watchPage = Math.max(0, Math.min(watchPageIndex, watchPages.length - 1));
  const activePageCount = subTab === "codex" ? codexPages.length : watchPages.length;
  const activePage = subTab === "codex" ? codexPage : watchPage;
  const setActivePageIndex = subTab === "codex" ? setCodexPageIndex : setWatchPageIndex;
  // Round 11 — with Collapse-All gone entirely on mobile, the shared
  // bottom-seam medallion slot is UNCONDITIONALLY free for pagination now;
  // this always reports upward once a caller opts in (falls back to inline
  // Prev/Next only for a standalone mount with no `onPaginationHandleChange`
  // wired at all — same "controlled prop with fallback" rule as before).
  const reportsPaginationExternally = !!onPaginationHandleChange;
  useEffect(() => {
    if (!reportsPaginationExternally || activePageCount <= 1) {
      onPaginationHandleChange?.(null);
      return;
    }
    onPaginationHandleChange?.({
      page: activePage,
      totalPages: activePageCount,
      onPrev: () => setActivePageIndex((p) => Math.max(0, p - 1)),
      onNext: () => setActivePageIndex((p) => Math.min(activePageCount - 1, p + 1)),
      onJump: (p) => setActivePageIndex(p),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportsPaginationExternally, activePageCount, activePage, onPaginationHandleChange]);

  /**
   * Round 11 owner correction (ported from `StoaAccountsTab.tsx`'s
   * identical change): "additionaly we can add swping mechanic to move
   * page." The paginated entry area (`accountsPageContainerRef`) is
   * `overflow: hidden` — it never scrolls, so there is nothing for a swipe
   * gesture to fight.
   *
   * Round 18 owner correction (ported from `StoaAccountsTab.tsx`'s
   * identical change): "we need swiping behaviour when swiping, not
   * simply showing directly next page." Round 11's version computed the
   * horizontal delta only on `touchend` and jumped straight to the
   * next/prev page — no visual feedback WHILE dragging. This tracks the
   * finger live (`touchmove`) with a CSS `translateX` on the entry list's
   * own inner wrapper (NOT the `overflow: hidden` measured container
   * itself — see the JSX below), with a light rubber-band RESISTANCE past
   * the first/last page. See `StoaAccountsTab.tsx`'s own identical block
   * for the full reasoning on `dragTransition`'s two settle animations
   * and why a gesture is only ever treated as a page-swipe once it's
   * confirmed more horizontal than vertical.
   *
   * Round 20 owner correction (ported from `StoaAccountsTab.tsx`'s
   * identical change): "the swiping behaviour should act like a swipe, if
   * i swipe, as you can see the next page isnt there, it simply appears
   * when the prev page is complelety gone." `dragDirection` now mounts
   * the ADJACENT page's own real content as a second pane beside the
   * current one — a real two-pane carousel track — so dragging genuinely
   * slides the incoming page INTO view as the outgoing one slides out.
   * See `StoaAccountsTab.tsx`'s own identical block for the full
   * reasoning.
   */
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const [swipeAxis, setSwipeAxis] = useState<"horizontal" | "vertical" | null>(null);
  const [dragX, setDragX] = useState(0);
  const [dragTransition, setDragTransition] = useState(false);
  const [dragDirection, setDragDirection] = useState<"next" | "prev" | null>(null);
  const SWIPE_THRESHOLD_PX = 40;
  const SWIPE_AXIS_DEADZONE_PX = 8;
  const SWIPE_SETTLE_MS = 200;
  const onAccountsTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const t = e.touches[0];
    if (!t) return;
    swipeStart.current = { x: t.clientX, y: t.clientY };
    setSwipeAxis(null);
    setDragDirection(null);
    setDragTransition(false);
  };
  const onAccountsTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const start = swipeStart.current;
    const t = e.touches[0];
    if (!start || !t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    let axis = swipeAxis;
    if (axis === null) {
      if (Math.abs(dx) < SWIPE_AXIS_DEADZONE_PX && Math.abs(dy) < SWIPE_AXIS_DEADZONE_PX) return;
      axis = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
      setSwipeAxis(axis);
    }
    if (axis !== "horizontal") return;
    const atFirstPage = activePage === 0;
    const atLastPage = activePage >= activePageCount - 1;
    const resisted = (dx > 0 && atFirstPage) || (dx < 0 && atLastPage) ? dx * 0.35 : dx;
    setDragX(resisted);
    if (dragDirection === null) {
      if (dx < 0 && !atLastPage) setDragDirection("next");
      else if (dx > 0 && !atFirstPage) setDragDirection("prev");
    }
  };
  const onAccountsTouchEnd = () => {
    const start = swipeStart.current;
    swipeStart.current = null;
    const axis = swipeAxis;
    setSwipeAxis(null);
    if (!start || axis !== "horizontal") { setDragTransition(true); setDragX(0); return; }
    const committingNext = dragX <= -SWIPE_THRESHOLD_PX && activePage < activePageCount - 1;
    const committingPrev = dragX >= SWIPE_THRESHOLD_PX && activePage > 0;
    if (!committingNext && !committingPrev) { setDragTransition(true); setDragX(0); return; }
    const containerWidth = accountsPageContainerRef.current?.clientWidth || 320;
    setDragTransition(true);
    setDragX(committingNext ? -containerWidth : containerWidth);
    window.setTimeout(() => {
      setActivePageIndex((p) => (committingNext ? Math.min(activePageCount - 1, p + 1) : Math.max(0, p - 1)));
      setDragTransition(false);
      setDragX(0);
      setDragDirection(null);
    }, SWIPE_SETTLE_MS);
  };

  /**
   * Round 20 (ported from `StoaAccountsTab.tsx`'s identical change) —
   * renders ONE page's worth of rows for whichever subtab is active,
   * factored out of the JSX below so the swipe carousel can mount it
   * TWICE (the current page, plus whichever adjacent page `dragDirection`
   * is currently revealing) instead of just once. `measureFirstRow` is
   * true ONLY for the currently-displayed page's own first row.
   */
  const renderAccountsPage = (pageIndex: number, measureFirstRow: boolean): React.ReactNode => {
    if (subTab === "codex") {
      if (entries.length === 0) {
        return (
          <div data-testid="arweave-accounts-empty" style={{ padding: "24px", borderRadius: 12, border: "1px dashed #262626", color: "#666", fontSize: 13 }}>
            No Arweave addresses yet. Define a seed and generate one to see it here.
          </div>
        );
      }
      // Round 11 — flat, fixed-height rows (no group header/wrapper card
      // at all): each `AccountRow` carries its own `seedBadge` dot
      // instead. See `codexFlatEntries`'s own doc comment for the full
      // reasoning.
      return (codexPages[pageIndex] ?? []).map((row, i) => {
        const rowAddress = row.entry.address ?? row.entry.id;
        return (
          <div key={row.entry.id} ref={measureFirstRow && i === 0 ? accountsPageRowRef : undefined}>
            <AccountRow
              entry={row.entry}
              onDeleteKey={onDeleteKey}
              getBalance={getBalance}
              protectedTier={row.groupProtected}
              balances={balances}
              deps={deps}
              onSendSuccess={(address) => fetchBalances([address])}
              seedBadge={{ name: row.groupLabel, color: row.groupColor }}
              selected={resolvedSelectedAddress === rowAddress}
              onSelect={() => setSelectedAddressState(rowAddress)}
            />
          </div>
        );
      });
    }
    if (watchedEntries.length === 0) {
      return (
        <div
          data-testid="arweave-accounts-watched-empty"
          style={{ textAlign: "center", padding: "32px 0", borderRadius: 12, border: "1px dashed #262626", color: "#555", fontSize: 13 }}
        >
          <EyeGlyph style={{ width: 24, height: 24, opacity: 0.4 }} />
          <p style={{ fontSize: 14, margin: "8px 0 0" }}>No watched addresses.</p>
        </div>
      );
    }
    return (watchPages[pageIndex] ?? []).map((w, wi) => (
      <div key={w.id} ref={measureFirstRow && wi === 0 ? accountsPageRowRef : undefined}>
        <WatchedRow
          entry={w}
          balances={balances}
          onRelabel={onAddWatched ? (label: string) => void onAddWatched(w.address, label) : undefined}
          onRemove={onRemoveWatched ? () => void onRemoveWatched(w.id) : undefined}
          selected={resolvedSelectedAddress === w.address}
          onSelect={() => setSelectedAddressState(w.address)}
        />
      </div>
    ));
  };

  // T2: the add-watched-address form's own local state — mirrors
  // `StoaAccountsTab.tsx`'s `handleAddWatch` shape exactly (module JSDoc).
  const [watchInput, setWatchInput] = useState("");
  const [watchError, setWatchError] = useState<string | null>(null);

  const handleAddWatch = useCallback(async (): Promise<void> => {
    setWatchError(null);
    const addr = watchInput.trim();
    if (!validateAddress(ARWEAVE_CHAIN_ID, addr)) {
      setWatchError("Not a valid Arweave address.");
      return;
    }
    if (entries.some((e) => e.address === addr)) {
      setWatchError("That address is already a Codex account.");
      return;
    }
    if (watchedEntries.some((w) => w.address === addr)) {
      setWatchError("Already watched.");
      return;
    }
    try {
      await onAddWatched?.(addr);
      setWatchInput("");
    } catch (e) {
      setWatchError(e instanceof Error ? e.message : "Could not add.");
    }
  }, [watchInput, entries, watchedEntries, onAddWatched]);

  // MOBILE ONLY (round 17) — the resolved-address form of every Codex
  // entry, for the selection-validity check below — `AccountRow`'s own
  // `entry.address ?? entry.id` fallback, applied once here rather than
  // per row.
  const codexAddressSet = useMemo(
    () => new Set(entries.map((e) => e.address ?? e.id)),
    [entries],
  );
  // The EFFECTIVE selection (see `selectedAddressState`'s own doc comment
  // above): the current subtab's first entry, unless the user's explicit
  // choice is both present AND actually belongs to THIS subtab's list.
  const currentListFirstAddress =
    subTab === "codex"
      ? (codexFlatEntries[0] ? (codexFlatEntries[0].entry.address ?? codexFlatEntries[0].entry.id) : null)
      : (watchedEntries[0]?.address ?? null);
  const selectedAddressStateValid =
    selectedAddressState !== null &&
    (subTab === "codex" ? codexAddressSet.has(selectedAddressState) : watchedEntries.some((w) => w.address === selectedAddressState));
  const selectedAddress = selectedAddressStateValid ? selectedAddressState : currentListFirstAddress;

  // MOBILE ONLY (round 17): resolve an address back to its full entry —
  // either a Codex `ForeignKeyEntry` or a `WatchListEntry` — for the shared
  // bottom bar and the shared Send modal below.
  const findSelectedEntry = (address: string | null): { kind: "codex"; entry: ForeignKeyEntry } | { kind: "watch"; entry: WatchListEntry } | null => {
    if (!address) return null;
    const codexHit = entries.find((e) => (e.address ?? e.id) === address);
    if (codexHit) return { kind: "codex", entry: codexHit };
    const watchHit = watchedEntries.find((w) => w.address === address);
    if (watchHit) return { kind: "watch", entry: watchHit };
    return null;
  };
  const selectedResolved = findSelectedEntry(selectedAddress);
  const resolvedSelectedAddress = selectedResolved
    ? (selectedResolved.kind === "codex" ? (selectedResolved.entry.address ?? selectedResolved.entry.id) : selectedResolved.entry.address)
    : null;

  // MOBILE ONLY (round 17 owner correction): "arweave account one line,
  // balance one line, and buttons below on the lower bar, with entry
  // selection" — mirrors `StoaAccountsTab.tsx`'s own `rightEdgeStack`
  // exactly. Only ONE stack (Arweave has no Stoa/UrStoa-equivalent second
  // action set) — Send (Codex-selected only, a watched address has no
  // private key), Copy, Explorer (both always), and Delete/remove
  // (WATCHED entries only, immediate — the SAME rule `StoaAccountsTab`'s
  // own mobile bar follows: a seed-derived Codex entry is never deletable
  // from this surface at all, mobile or desktop — see `AccountRow`'s own
  // `deleteGuard` doc comment).
  const noSelection = !selectedResolved;
  const edgeStackYPosition: React.CSSProperties = zone3AnchorTarget
    ? { bottom: 0, transform: "translateY(50%)" }
    : { bottom: 12 };
  const rightEdgeStack = !noSelection && (
    <div style={{ position: "absolute", right: 6, ...edgeStackYPosition, display: "flex", flexDirection: "row", gap: 8, zIndex: 5, pointerEvents: "auto" }}>
      {deps && selectedResolved.kind === "codex" && (
        <button
          type="button"
          title="Send AR"
          aria-label="Send AR"
          onClick={() => setMobileActiveModal("send")}
          style={sharedActionBtnStyle(false)}
        >
          <SendGlyph style={sharedActionIconStyle} />
        </button>
      )}
      <button
        type="button"
        title="Copy address"
        aria-label="Copy address"
        onClick={() => void navigator.clipboard?.writeText(resolvedSelectedAddress ?? "")}
        style={sharedActionBtnStyle(false)}
      >
        <CopyGlyph style={sharedActionIconStyle} />
      </button>
      <a
        href={explorerUrl(resolvedSelectedAddress ?? "")}
        target="_blank"
        rel="noopener noreferrer"
        title="Open in Explorer"
        aria-label="Open in Explorer"
        style={{ ...sharedActionBtnStyle(false), textDecoration: "none" }}
      >
        <ExternalLinkGlyph style={sharedActionIconStyle} />
      </a>
      {selectedResolved.kind === "watch" && onRemoveWatched && (
        <button
          type="button"
          title="Stop watching this address"
          aria-label="Stop watching this address"
          onClick={() => { void onRemoveWatched(selectedResolved.entry.id); setSelectedAddressState(null); }}
          style={{ ...sharedActionBtnStyle(false), color: "#f87171" }}
        >
          <TrashGlyph style={sharedActionIconStyle} />
        </button>
      )}
    </div>
  );

  // MOBILE ONLY — `ArweavePanel` owns the seam-straddling Codex/Watched
  // medallion + Collapse-All medallion + refresh button + m/n+x breakdown
  // once it's actually driving this component via the controlled props
  // above ("same structure and design and placement of buttons as what we
  // did for chainweb") — mirrors `StoaAccountsTab`'s own
  // `drivenExternally` gate exactly. A standalone mount (this file's own
  // pre-existing tests, or any future caller that doesn't wire
  // `onSubTabChange`) keeps rendering its own inline header/toggle, on
  // mobile or off, exactly as before these props existed.
  const drivenExternally = !!onSubTabChange;
  const hideOwnChromeOnMobile = isMobile && drivenExternally;

  return (
    <div
      data-testid="arweave-accounts-area"
      style={{
        display: "flex", flexDirection: "column", gap: 16, color: "#d2d3d4",
        position: isMobile ? "relative" : undefined,
        height: isMobile ? "100%" : undefined,
        minHeight: isMobile ? 0 : undefined,
      }}
    >
      {/* MOBILE ONLY — the shared bottom action bar (round 17), portaled to
          the SAME whole-screen target the shared Send modal below uses so
          it docks to the actual screen edge (EdgeRail's own established
          convention) — falling back to this component's own (now
          `position: relative`) frame when no portal target is supplied.
          Mirrors `StoaAccountsTab.tsx`'s identical block exactly. */}
      {isMobile && (
        <MobilePortal target={zone3AnchorTarget ?? fullScreenPortalTarget}>
          {rightEdgeStack}
        </MobilePortal>
      )}
      {!hideOwnChromeOnMobile && (
        <>
          {/* Total Addresses */}
          <div
            data-testid="arweave-accounts-total"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "14px 16px",
              borderRadius: 12,
              border: "1px solid #262626",
              backgroundColor: "#0a0a0a",
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: `${ACCENT}20`,
              }}
            >
              <svg {...svgBase} strokeWidth={1.6} style={{ width: 18, height: 18, color: ACCENT }}>
                <path d="M12 1.5 L22.5 12 L12 22.5 L1.5 12 Z" />
                <path d="M6.75 6.75 L17.25 17.25 M17.25 6.75 L6.75 17.25" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "#888" }}>Total Addresses</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#d2d3d4" }}>
                {entries.length + watchedEntries.length}
              </div>
            </div>
            <div style={{ flex: 1 }} />
            {/* T4: "Live balances / Refresh" — mirrors `StoaAccountsTab.tsx`'s own
                live-chain-status + refresh convention, adapted to this file's
                established inline-SVG styling. */}
            {anyBalanceLoading ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "#888" }}>
                <RefreshGlyph style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} />
                Reading balances…
              </span>
            ) : (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "#4ade80" }}>
                Live balances
                {/* "Live" alone doesn't say WHEN — there is no periodic polling,
                    only on-mount/manual-refresh/post-send/post-confirmation
                    reads, so this is how staleness is actually told at a glance. */}
                {lastFetchedAt !== null && (
                  <span style={{ color: "#555" }} data-testid="arweave-accounts-updated-ago">
                    · {formatUpdatedAgo(lastFetchedAt, Date.now())}
                  </span>
                )}
              </span>
            )}
            <button
              type="button"
              data-testid="arweave-accounts-refresh"
              title="Refresh balances"
              onClick={refreshAllBalances}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 8px",
                borderRadius: 6,
                border: "1px solid #262626",
                background: "transparent",
                color: "#888",
                cursor: "pointer",
                fontSize: 11,
              }}
            >
              <RefreshGlyph style={{ width: 11, height: 11 }} />
              Refresh
            </button>
          </div>

          {/* Codex / Watched toggle */}
          <div style={{ display: "flex", gap: 8 }}>
            {(
              [
                ["codex", "Codex Accounts", entries.length],
                ["watch", "Watched Accounts", watchedEntries.length],
              ] as const
            ).map(([key, label, count]) => {
              const active = subTab === key;
              return (
                <button
                  key={key}
                  type="button"
                  data-testid={`arweave-accounts-subtab-${key}`}
                  aria-pressed={active}
                  onClick={() => setSubTab(key)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 14px",
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    border: `1px solid ${active ? ACCENT : "#262626"}`,
                    backgroundColor: active ? ACCENT : "#111",
                    color: active ? "#0a0a0a" : "#888",
                  }}
                >
                  {label}
                  <span
                    style={{
                      fontSize: 11,
                      padding: "0 7px",
                      borderRadius: 9999,
                      backgroundColor: active ? "#0a0a0a20" : "#262626",
                      color: active ? "#0a0a0a" : "#555",
                    }}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {isMobile ? (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Add watched address — a fixed control, not part of the
              measured/paginated entry area below. */}
          {subTab === "watch" && (
            <>
              <div style={{ flex: "none", display: "flex", gap: 8 }}>
                <span style={{ display: "inline-flex", alignItems: "center", padding: "0 10px", color: "#888" }}>
                  <EyeGlyph style={{ width: 16, height: 16 }} />
                </span>
                <input
                  data-testid="arweave-watch-input"
                  value={watchInput}
                  onChange={(e) => setWatchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleAddWatch();
                  }}
                  placeholder="Watch an Arweave address…"
                  spellCheck={false}
                  style={{
                    flex: 1, minWidth: 0, padding: "8px 12px", borderRadius: 8, outline: "none",
                    backgroundColor: "#0a0a0a", border: "1px solid #262626", color: "#d2d3d4",
                    fontSize: 13, fontFamily: MONO,
                  }}
                />
                {/* Round 10 owner correction: "let's make the watch button a
                    new square button... with an eye on it, instead of a big
                    button with text, which clearly doesn't fit" — mirrors
                    `StoaAccountsTab.tsx`'s identical fix. The old text pill
                    ("Watch") had no `flexShrink: 0` and could get
                    squeezed/overflow off the right edge next to the input's
                    own `flex: 1`. A fixed-size square icon button can never
                    overflow that way. */}
                <button
                  type="button"
                  data-testid="arweave-watch-submit"
                  aria-label="Watch"
                  title="Watch"
                  disabled={onAddWatched === undefined}
                  onClick={() => void handleAddWatch()}
                  style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                    width: 36, height: 36, borderRadius: 8, border: "none",
                    backgroundColor: onAddWatched === undefined ? "#262626" : ACCENT,
                    color: onAddWatched === undefined ? "#666" : "#0a0a0a",
                    cursor: onAddWatched === undefined ? "not-allowed" : "pointer",
                  }}
                >
                  <EyeGlyph style={{ width: 16, height: 16 }} />
                </button>
              </div>
              {watchError && <p role="alert" style={{ flex: "none", fontSize: 12, color: "#f87171", margin: 0 }}>{watchError}</p>}
            </>
          )}

          {/* The MEASURED, PAGINATED entry area — "same structure and design
              and placement of buttons as what we did for chainweb": a page
              is computed to fit EXACTLY within the measured available
              height, no scrolling within a page at all.
              Round 10 owner correction: "the lowest border of the entry
              relative to the border of the enclosing... wasn't being
              kept... we need to have the same separator everywhere. so
              there needs to be the same size of the border left right up
              and down." Mirrors `StoaAccountsTab.tsx`'s identical fix —
              this `gap` MUST equal `ACCOUNT_ROW_GAP` (the constant
              `useSlotPageSize` measures with) or the real rendered spacing
              drifts from what the engine assumed, letting entries overflow
              the container a few px at a time (the actual root cause of
              "the engine to display entries doesn't work properly"). The
              matching top/bottom `padding` gives those edges the same
              breathing room the inter-entry gaps already have. Round 15
              split the left/right padding into its own
              `ACCOUNT_ROW_SIDE_PADDING` — see `ACCOUNT_ROW_GAP`'s own doc
              comment for why the two no longer need to match. */}
          <div
            ref={accountsPageContainerRef}
            data-testid="arweave-accounts-page-surface"
            onTouchStart={onAccountsTouchStart}
            onTouchMove={onAccountsTouchMove}
            onTouchEnd={onAccountsTouchEnd}
            style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: `${ACCOUNT_ROW_GAP}px ${ACCOUNT_ROW_SIDE_PADDING}px` }}
          >
          {/* Round 18 — the swipe gesture's own live-tracked drag transform
              lives on THIS inner wrapper, not the measured/clipped
              container above — `useSlotPageSize`'s `compute()` reads the
              OUTER div's `clientHeight` (padding-box), which `translateX`
              never affects, so the two stay independent.
              Round 20 — a real two-PANE track, mirroring
              `StoaAccountsTab.tsx`'s own identical structure: once a
              direction locks in, the ADJACENT page mounts as a second
              same-width pane immediately beside the current one, with the
              track's own base offset shifted by one pane's measured width
              so the current page still starts out fully in view. */}
          <div
            data-testid="arweave-accounts-page-swipe-track"
            style={{
              display: "flex", flexDirection: "row",
              transform: `translateX(${(dragDirection === "prev" ? -(accountsPageContainerRef.current?.clientWidth || 320) : 0) + dragX}px)`,
              transition: dragTransition ? `transform ${SWIPE_SETTLE_MS}ms ease-out` : "none",
            }}
          >
            {dragDirection === "prev" && (
              <div style={{ width: accountsPageContainerRef.current?.clientWidth || 320, flexShrink: 0, display: "flex", flexDirection: "column", gap: ACCOUNT_ROW_GAP }}>
                {renderAccountsPage(activePage - 1, false)}
              </div>
            )}
            <div
              style={{
                width: dragDirection ? (accountsPageContainerRef.current?.clientWidth || 320) : "100%",
                flexShrink: 0, display: "flex", flexDirection: "column", gap: ACCOUNT_ROW_GAP,
              }}
            >
              {renderAccountsPage(activePage, true)}
            </div>
            {dragDirection === "next" && (
              <div style={{ width: accountsPageContainerRef.current?.clientWidth || 320, flexShrink: 0, display: "flex", flexDirection: "column", gap: ACCOUNT_ROW_GAP }}>
                {renderAccountsPage(activePage + 1, false)}
              </div>
            )}
          </div>
          </div>

          {/* Prev/Next — "there is the pagination problem... not paginating
              here would be very irresponsible" (the SAME owner correction
              this mirrors from Chainweb's own round). Round 9/11 —
              "standard pagination controls zone": rendered INLINE only for
              a standalone mount with no `onPaginationHandleChange` wired at
              all — every other case reports its handle to `ArweavePanel`
              instead, which renders the shared medallion version (round
              11: ALWAYS free now that Collapse-All no longer exists on
              mobile). */}
          {!reportsPaginationExternally && activePageCount > 1 && (
            <div style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <button
                type="button"
                onClick={() => setActivePageIndex((p) => Math.max(0, p - 1))}
                disabled={activePage === 0}
                style={pageBtn(activePage === 0)}
              >
                ← Prev
              </button>
              <PageJumpIndicator page={activePage} totalPages={activePageCount} onJump={setActivePageIndex} />
              <button
                type="button"
                onClick={() => setActivePageIndex((p) => Math.min(activePageCount - 1, p + 1))}
                disabled={activePage >= activePageCount - 1}
                style={pageBtn(activePage >= activePageCount - 1)}
              >
                Next →
              </button>
            </div>
          )}
        </div>
      ) : subTab === "codex" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {entries.length === 0 ? (
            <div
              data-testid="arweave-accounts-empty"
              style={{
                padding: "24px",
                borderRadius: 12,
                border: "1px dashed #262626",
                color: "#666",
                fontSize: 13,
              }}
            >
              No Arweave addresses yet. Define a seed and generate one to see it here.
            </div>
          ) : (
            groups.map((group) => (
              <GroupSection
                key={group.id}
                group={group}
                onDeleteKey={onDeleteKey}
                getBalance={getBalance}
                balances={balances}
                deps={deps}
                onSendSuccess={(address) => fetchBalances([address])}
              />
            ))
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* T2: add-address form — ALWAYS rendered in the watch tab, even
              while the list is empty (mirrors Chainweb's own tab, module
              JSDoc). The submit button stays enabled-looking but `disabled`
              while `onAddWatched` is unwired, so an unwired seam never
              silently no-ops on click. */}
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ display: "inline-flex", alignItems: "center", padding: "0 10px", color: "#888" }}>
              <EyeGlyph style={{ width: 16, height: 16 }} />
            </span>
            <input
              data-testid="arweave-watch-input"
              value={watchInput}
              onChange={(e) => setWatchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleAddWatch();
              }}
              placeholder="Watch an Arweave address…"
              spellCheck={false}
              style={{
                flex: 1,
                padding: "8px 12px",
                borderRadius: 8,
                outline: "none",
                backgroundColor: "#0a0a0a",
                border: "1px solid #262626",
                color: "#d2d3d4",
                fontSize: 13,
                fontFamily: MONO,
              }}
            />
            <button
              type="button"
              data-testid="arweave-watch-submit"
              disabled={onAddWatched === undefined}
              onClick={() => void handleAddWatch()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                border: "none",
                backgroundColor: onAddWatched === undefined ? "#262626" : ACCENT,
                color: onAddWatched === undefined ? "#666" : "#0a0a0a",
                cursor: onAddWatched === undefined ? "not-allowed" : "pointer",
              }}
            >
              Watch
            </button>
          </div>
          {watchError && (
            <p role="alert" style={{ fontSize: 12, color: "#f87171", margin: 0 }}>
              {watchError}
            </p>
          )}

          {watchedEntries.length === 0 ? (
            <div
              data-testid="arweave-accounts-watched-empty"
              style={{
                textAlign: "center",
                padding: "32px 0",
                borderRadius: 12,
                border: "1px dashed #262626",
                color: "#555",
                fontSize: 13,
              }}
            >
              <EyeGlyph style={{ width: 24, height: 24, opacity: 0.4 }} />
              <p style={{ fontSize: 14, margin: "8px 0 0" }}>No watched addresses.</p>
            </div>
          ) : (
            watchedEntries.map((w) => (
              <WatchedRow
                key={w.id}
                entry={w}
                balances={balances}
                onRelabel={
                  onAddWatched ? (label: string) => void onAddWatched(w.address, label) : undefined
                }
                onRemove={onRemoveWatched ? () => void onRemoveWatched(w.id) : undefined}
              />
            ))
          )}
        </div>
      )}

      {/* MOBILE ONLY — the shared bottom bar's own Send modal (round 17),
          keyed off `selectedResolved` rather than any one row (desktop's
          own per-row modal, inside `AccountRow`, is untouched — this is an
          ADDITIONAL mount, not a replacement). `fullScreenPortalTarget`
          makes the modal's own `CodexModalShell` (which already flips to a
          full-bleed sheet on mobile) resolve against the whole mobile body
          instead of this component's own Zone-3-bounded frame — mirrors
          `StoaAccountsTab.tsx`'s identical `mobileActiveModal` wiring. */}
      {isMobile && deps && selectedResolved?.kind === "codex" && (
        <SendArweaveModal
          entry={selectedResolved.entry}
          isOpen={mobileActiveModal === "send"}
          onClose={() => setMobileActiveModal(null)}
          deps={deps}
          onSuccess={() => { if (resolvedSelectedAddress) fetchBalances([resolvedSelectedAddress]); }}
          senderBalanceWinston={
            resolvedSelectedAddress && balances[resolvedSelectedAddress]?.status === "ready"
              ? balances[resolvedSelectedAddress].balance
              : undefined
          }
          fullScreenPortalTarget={fullScreenPortalTarget}
        />
      )}
    </div>
  );
}

export default ArweaveAccountsArea;
