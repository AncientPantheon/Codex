/**
 * StoaAccountsTab — 1:1 rebuild of OuronetUI's My Codex "Stoa Accounts" tab, now
 * with LIVE per-chain balances.
 *
 *   • "Total Addresses N" header.
 *   • Codex Accounts (N) / Watched Accounts (N) sub-tab toggle.
 *   • Codex: every kadena-seed account + pure keypair → its `k:<publicKey>`
 *     address, grouped by source seed (Prime Codex Seed / Seed #N / Pure Key
 *     Pairs), each group collapsible with a count badge.
 *   • Each address row: prefix badge, truncated address, Key #N sublabel, the
 *     STOA total ("over N chains"), copy + explorer; expands to a "Stoa Balance"
 *     summary line (URC_0028) + the per-chain (0–9) coin-balance grid.
 *   • Watched: arbitrary k:/u:/c:/w: addresses via the codex watch-list, read +
 *     displayed exactly like codex addresses (add / label / remove).
 *
 * Live balances come from `useStoaChainBalances` (per-chain `coin.get-balance` +
 * URC_0028), routed through the consumer-configured `pactRead` seam. Hex palette.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown, ChevronRight, Eye, RefreshCw, Loader2, Plus, Check, X, Pencil, Layers, ArrowUpDown,
} from "lucide-react";
import { useIsMobile } from "@ancientpantheon/codex-ui/ui";
import { STOA_CHAINS, KADENA_CHAIN_ID as STOACHAIN_CHAIN_ID } from "@stoachain/stoa-core/constants";
import { ActionTooltip } from "../../zbom/ui/ActionTooltip.js";
import { useStoaChainSeeds } from "../../hooks/index.js";
import { usePureKeypairs } from "../../hooks/index.js";
import { useWatchList } from "../../hooks/index.js";
import { IconCopyBtn, IconStoaExplorerBtn, IconDeleteBtn } from "../internal/IconButtons.js";
import { useStoaChainBalances, type StoaAccountBalances } from "../internal/useStoaChainBalances.js";
import { useKadenaBalances } from "../internal/useKadenaBalances.js";
import { useUrStoaBalances, type UrStoaAccountBalances } from "../internal/useUrStoaBalances.js";
import { CodexModalShell } from "../internal/CodexModalShell.js";
import { StoaAddressHighlight } from "../internal/StoaAddressHighlight.js";
import { TransferUrStoaModal } from "../internal/TransferUrStoaModal.js";
import { StakeUrStoaModal } from "../internal/StakeUrStoaModal.js";
import { UnstakeUrStoaModal } from "../internal/UnstakeUrStoaModal.js";
import { CollectUrStoaModal } from "../internal/CollectUrStoaModal.js";
import { SendStoaModal } from "../internal/SendStoaModal.js";
import type { IStoaChainSeed } from "../../types/entities.js";
import { useCodexStore } from "../../provider/index.js";
import type { CodexStoreState } from "../../state/index.js";

const MONO = "var(--codex-font-mono, 'JetBrains Mono', ui-monospace, monospace)";
const ADDR_PREFIXES = ["k:", "u:", "c:", "w:"];
const ADDR_COLORS: Record<string, string> = { "k:": "#c0c0c0", "u:": "#92400e", "c:": "#3b82f6", "w:": "#a78bfa" };
// Chainweaver and EckoWallet share one color (same wallet underneath, see
// CreateStoaChainSeedModal.tsx); Stoic ("Stoa Dalos") gets its own yellow so
// a group derived from it doesn't visually read as any of the others.
const SEED_TYPE_COLOR: Record<string, string> = { chainweaver: "#3b82f6", eckowallet: "#3b82f6", koala: "#ec4899", stoic: "#eab308" };

const truncAddr = (a: string) => (a.length > 24 ? `${a.slice(0, 12)}…${a.slice(-10)}` : a);
/** MOBILE-ONLY Prev/Next pagination button style — same family as
 *  `OuronetAccountsTab`'s own `pageBtn`, for consistency across the app's
 *  two paginated mobile account lists. */
const pageBtn = (disabled: boolean): React.CSSProperties => ({
  fontSize: 12, padding: "6px 12px", borderRadius: 8, border: "1px solid #262626", color: "#d2d3d4",
  background: "transparent", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.3 : 1,
});

/** A codex with hundreds of seeds/thousands of accounts can genuinely
 *  paginate into double digits — past that point, tapping "Next" N times
 *  to reach page 24 is exactly the "not paginating responsibly" complaint
 *  pagination was built to fix, just moved one level down. Owner
 *  correction (design.md §8, round 8 follow-up): "when there are more
 *  than 10 pages available the entry 15/24 when clicked needs to allow
 *  the input of a given page, to jump directly to a wanted page." Below
 *  10 pages, the plain "N / M" text is all that's needed (unchanged) —
 *  this only turns into a clickable jump control once it's actually
 *  worth one. */
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
const fmt12 = (n: number) => n.toFixed(12);
/** UrStoa mobile precision — owner correction (design.md §8, the "further
 *  optimize round 4"): "urstoa has only 3 decimals, no point in displaying
 *  this many." Stoa keeps `fmt12` (its own native/desktop precision);
 *  UrStoa's vault figures are meaningfully coarser, so 3 places is already
 *  everything real. */
const fmt3 = (n: number) => n.toFixed(3);
const explorerUrl = (a: string) => `https://explorer.stoachain.com/accounts/${a}`;
/** 2026-09-27: Kadena mode's own explorer — our denascan backend (also the
 *  live REST balance source, see `kadenaBalanceSource.ts`). `encodeURIComponent`
 *  gives exactly the `k%3A...` form the explorer's own URLs use. */
const kadenaExplorerUrl = (a: string) => `https://denascan.ancientholdings.eu/accounts/${encodeURIComponent(a)}`;

/** Bigger square action-button chrome for the mobile SHARED action row
 *  (design.md §8, the "further optimize round 2"): "instead of adding so
 *  many buttons on each entry, [keep] a single row of buttons, beneath the
 *  header... the squares could be made bigger" — up from the old per-row
 *  22px mobile buttons (now removed). Re-tuned to 30px (design.md §8, the
 *  "further optimize round 6" — owner correction: "make them [these
 *  buttons] the same size as the other 3 square size buttons above them
 *  the seeds, pure keys, and accounts button") — matches
 *  `MobileCategoryIconBtn`'s own 30×30 box exactly, for visual consistency
 *  between the two icon rows and a bit more reclaimed vertical space. */
const sharedActionBtnStyle = (disabled: boolean): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 30, height: 30, borderRadius: 8, flexShrink: 0,
  cursor: disabled ? "default" : "pointer",
  backgroundColor: "#141414", color: disabled ? "#3a3a3a" : "#ceac5f",
  border: "2px solid #252525", opacity: disabled ? 0.5 : 1,
});
const sharedActionIconStyle: React.CSSProperties = { width: 15, height: 15 };

/** Mobile-only mode emblem (design.md §8, the "further optimize" round):
 *  "instead of STOA word we use its emblem/icon which is ❖ colour yellow,
 *  and for UrStoa is ✦ colour grey" — replaces the desktop row's literal
 *  " STOA" unit suffix on mobile, where space is at a premium. */
const BALANCE_EMBLEM: Record<BalanceMode, { glyph: string; color: string }> = {
  stoa: { glyph: "❖", color: "#eab308" },
  urstoa: { glyph: "✦", color: "#9ca3af" },
};

/** The Stoa/UrStoa header toggle's two states. */
type BalanceMode = "stoa" | "urstoa";

/** Every k: address's public key IS its address suffix — there is no separate
 *  lookup. Non-`k:` addresses (u:/c:/w:) have no single public key, so the
 *  vault-action + Send buttons (all of which resolve a signing keypair by
 *  public key) simply don't render for those rows. */
const publicKeyOf = (address: string): string | undefined =>
  address.startsWith("k:") ? address.slice(2) : undefined;

/** Small square action-button chrome, matching `IconButtons.tsx`'s
 *  `IconCopyBtn`/`IconHideBtn` resting palette (28px square, 2px border,
 *  dark fill) so the new Transfer/Stake/Unstake/Collect/Send buttons sit
 *  visually consistent with the copy/explorer buttons already in this row. */
const actionBtnStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 28, height: 28, borderRadius: 6, flexShrink: 0, cursor: "pointer",
  backgroundColor: "#141414", color: "#777", border: "2px solid #252525",
};
const actionIconStyle: React.CSSProperties = { width: 13, height: 13 };

/** Inline SVG glyphs — deliberately NOT `lucide-react` for these five new
 *  action icons (mirrors `ArweaveAccountsArea.tsx`'s own local-glyph
 *  convention for the same "established visual language" reason: square,
 *  small, self-contained). */
const svgIconBase = {
  viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true,
};
const TransferGlyph = ({ style }: { style?: React.CSSProperties }) => (
  <svg {...svgIconBase} style={style}><path d="M7 8h10l-3-3M17 16H7l3 3" /></svg>
);
const StakeGlyph = ({ style }: { style?: React.CSSProperties }) => (
  <svg {...svgIconBase} style={style}><path d="M12 19V5M12 5l-5 5M12 5l5 5" /></svg>
);
const UnstakeGlyph = ({ style }: { style?: React.CSSProperties }) => (
  <svg {...svgIconBase} style={style}><path d="M12 5v14M12 19l-5-5M12 19l5-5" /></svg>
);
const CollectGlyph = ({ style }: { style?: React.CSSProperties }) => (
  <svg {...svgIconBase} style={style}><circle cx="12" cy="12" r="8" /><path d="M12 8v8M9 11h6" /></svg>
);
const SendGlyph = ({ style }: { style?: React.CSSProperties }) => (
  <svg {...svgIconBase} style={style}><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7Z" /></svg>
);

interface AddrEntry { address: string; sublabel: string; watchId?: string }
interface AddrGroup { id: string; name: string; color: string; entries: AddrEntry[] }

/**
 * The mobile Codex list's fixed-size-row pagination engine — round 11
 * owner correction: "instead of listing the entries as part of a seed, we
 * should make the entry carry a medallion to see from which seed it
 * belongs, thus making all entries having a fixed size. with a fixed size
 * for all entries, we can perfectly say how many entries fit in a given
 * space size." Superseded the ORIGINAL round-8 design (a 0.5-slot group
 * header interleaved with 1-slot entries, a lookahead-bundling rule so a
 * header was never left alone, the border/gap drift that kept causing
 * "entries not displayed properly" bugs) — every row is now the SAME
 * height, so the formula is the trivial one the Watched list already used
 * safely: `floor((available+gap)/(row+gap))`. No header-alone bug is even
 * POSSIBLE anymore, because there is no header in this list at all — see
 * `codexFlatEntries`'s own doc comment for where the flattening happens.
 */
/** Fallback px height of one `AddressRow`, used only before the first real
 *  row has mounted/measured — see `useSlotPageSize`'s `rowRef`. */
const ACCOUNT_ROW_HEIGHT_FALLBACK = 58;
/**
 * Round 14 owner correction: "the first entrys medalion is cut, that needs
 * fix, and the medalions of an entry touches the upper entry, we need more
 * spacing between entry such that the medalion of an entry doesnt touch
 * the upper entry." Round 13's seed-name pill straddles each row's own top
 * border, poking above it (`translateY(-50%)` of its own rendered box) —
 * at the OLD `ACCOUNT_ROW_GAP` of 8, that poke-out (a) had more headroom
 * than the container's own 8px top padding could give the very FIRST row
 * (clipped by the container's `overflow: hidden`), and (b) left less than
 * zero clearance between one row's pill and the row ABOVE it
 * (touching/overlapping).
 *
 * Round 15 owner correction — round 14's fix overshot: "shouldnt we be
 * able to fit 3 entries here, also the side spacing is a bit to big."
 * Tying the VERTICAL row-to-row gap to the SAME constant as the
 * HORIZONTAL container padding (round 10's "same size of the border left
 * right up and down" rule) meant fixing the vertical clearance the pill
 * needed also inflated the left/right padding by the same amount, for no
 * reason — the pill only ever pokes ABOVE a row, never to its sides, so
 * there is no correctness reason the two need to match anymore (round
 * 10's rule was about VERTICAL spacing drift specifically — see
 * `useSlotPageSize`'s own `compute()` doc comment — not a horizontal
 * requirement). Split into two constants: `ACCOUNT_ROW_GAP` stays the
 * vertical-only knob (row-to-row gap AND top/bottom container padding,
 * still the exact value the pagination engine's slot math uses — see
 * `useSlotPageSize`'s own doc comment), tuned back down to the smallest
 * value that still visibly clears the (now slightly smaller, see the
 * pill's own style) seed-badge pill's poke-out without touching; a new
 * `ACCOUNT_ROW_SIDE_PADDING` independently controls ONLY the container's
 * left/right padding, back to its pre-round-14 size.
 *
 * Round 16 owner correction: "space clearly could be optimised better...
 * below clearly there is enough room for another entry." Trimmed once
 * more, still comfortably clearing the (now smaller) pill's own poke-out —
 * every extra px here is subtracted straight out of how much room the
 * pagination engine has to fit one more whole row.
 */
const ACCOUNT_ROW_GAP = 12;
/** Horizontal-only container padding — see `ACCOUNT_ROW_GAP`'s own doc
 *  comment for why this is no longer the same constant. */
const ACCOUNT_ROW_SIDE_PADDING = 8;

/**
 * Measures Zone 3's actual available content height + one real
 * `AddressRow`'s height and returns how many whole rows fit — the SAME
 * live-measure-don't-guess convention `OuronetAccountsTab`'s
 * `useMobilePageSize` established.
 */
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
    // Owner-reported live bug (round 9, seen on the Seeds list but the same
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
      // and down": the container now carries `padding: ACCOUNT_ROW_GAP` on
      // every side (see its own JSX comment), which `clientHeight` counts
      // as part of the box — subtract it back out so the packer only ever
      // budgets the REAL usable content height, not the padded box height.
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

/** Portals `children` into `target` when supplied (a DOM node spanning the
 *  host's WHOLE mobile body — see `StoaAccountsTabProps.fullScreenPortalTarget`'s
 *  doc comment); otherwise renders inline, unchanged. */
function MobilePortal({ target, children }: { target?: Element | null; children: React.ReactNode }) {
  return target ? createPortal(children, target) : <>{children}</>;
}

/** MobileBalanceFill — the balance-amount analog of `StoaAddressHighlight`:
 *  shows the FULL precision `value` string, filling the available width, and
 *  only shortens (dropping trailing decimals, right-truncated, "…" appended)
 *  when it genuinely doesn't fit — owner correction (design.md §8, the
 *  "further optimize round 3"): "the same with the balance amount, so we
 *  should extend on the whole width and shorten it only if it doesn't fit."
 *  Never truncates past the decimal point — the integer part always shows in
 *  full, since a shortened INTEGER part would misrepresent the actual
 *  holding (a shortened decimal tail merely loses precision, which the "…"
 *  already signals honestly). */
function MobileBalanceFill({ value, color, style }: { value: string; color: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(value);
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
      const probe = document.createElement("span");
      probe.textContent = "0".repeat(100);
      probe.style.cssText = "position:absolute; left:-9999px; top:0; visibility:hidden; white-space:pre; pointer-events:none;";
      el.appendChild(probe);
      const charW = probe.getBoundingClientRect().width / 100;
      el.removeChild(probe);
      if (!Number.isFinite(charW) || charW <= 0) { setDisplay(value); scheduleReveal(); return; }
      const fit = Math.floor(width / charW);
      if (fit >= value.length) { setDisplay(value); scheduleReveal(); return; }
      const dotIdx = value.indexOf(".");
      // Always keep AT LEAST the integer part (+ the decimal point, if any).
      const minKeep = dotIdx === -1 ? value.length : dotIdx + 1;
      const keepLen = Math.min(value.length, Math.max(minKeep, fit - 1));
      setDisplay(`${value.slice(0, keepLen)}…`);
      scheduleReveal();
    };
    compute();
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(compute); ro.observe(el); }
    const safety = setTimeout(() => { if (!revealed) { revealed = true; setReady(true); } }, 700);
    return () => { ro?.disconnect(); if (settle) clearTimeout(settle); clearTimeout(safety); };
  }, [value]);

  return (
    <span
      ref={ref}
      title={value}
      style={{ display: "block", overflow: "hidden", whiteSpace: "nowrap", textAlign: "right", visibility: ready ? "visible" : "hidden", color, ...style }}
    >
      {display}
    </span>
  );
}

export interface StoaAccountsTabProps {
  className?: string;
  /**
   * Reports the total address count (Codex + Watched, deduped — the SAME
   * number the desktop "Total Addresses" card shows) on every change.
   * `ChainwebPanel`'s own mobile category row (docs/work/codex-ui-mobile/
   * design.md §8, the "optimize each blockchain and tab" round) renders
   * this on its LEFT side while "accounts" is the active category — the
   * same relocation `SeedWordsTab`'s own seed count already got. Optional —
   * omitted, this component simply doesn't report (desktop never wires it).
   */
  onTotalChange?: (total: number) => void;
  /**
   * Reports the CURRENTLY ACTIVE balance-refresh control — owner correction
   * (design.md §8, the "further optimize round 2"): "move the refresh
   * button" up onto `ChainwebPanel`'s own icon row, right beneath the
   * Blockchain-Accounts EdgeRail it now sits directly under. Mirrors
   * `onTotalChange`'s "report upward, don't duplicate the underlying logic"
   * shape — `ChainwebPanel` renders the actual button, this component
   * supplies what it should DO and its live state. Optional — omitted,
   * desktop's own inline refresh button (never touched) still works.
   */
  onRefreshHandleChange?: (handle: { refresh: () => void; loading: boolean; error: boolean }) => void;
  /**
   * MOBILE ONLY — a DOM node spanning the host's WHOLE mobile body, via
   * `createPortal` — owner correction (design.md §8, the "further optimize
   * round 3"): "when I say full screen from now on, I mean a full screen
   * extension, not extending in its zone." Without it, the full-screen
   * account-detail view below resolves its `CodexModalShell` against the
   * nearest `CodexUiRoot` ancestor (Zone 3's own), bounding it to Zone 3's
   * rectangle instead of covering the whole screen. Omitted (the default)
   * falls back to that bounded behavior, same as every other
   * `CodexModalShell` caller in this codebase without a portal target.
   */
  fullScreenPortalTarget?: Element | null;
  /**
   * Controlled Codex/Watched sub-tab (docs/work/codex-ui-mobile/design.md
   * §8, the "further optimize round 7" — owner correction: "we have two
   * stripe double button medallions, the codex/watched and stoa urstoa...
   * i would place this on top the upper border of the zone, half in half
   * out... would sit atop these 3 buttons [Seeds/Pure Keys/Accounts]"):
   * `ChainwebPanel` owns a seam-straddling medallion pair that MUST render
   * from ITS OWN tree (only it shares an ancestor with the category icon
   * row the medallions dock to), so this component's own state moves to a
   * controlled prop it drives — same "controlled prop with internal-state
   * fallback" pattern `SeedWordsTab`'s own `createOpen`/`onCreateOpenChange`
   * already uses. Both optional — omitted (every existing test, and any
   * standalone use outside `ChainwebPanel`), this component falls back to
   * its own internal `useState` AND keeps rendering its own inline
   * Codex/Watched pill (mobile), exactly as before this prop existed.
   */
  subTab?: "codex" | "watch";
  onSubTabChange?: (subTab: "codex" | "watch") => void;
  /** Controlled Stoa/UrStoa balance mode — same pair/reasoning as `subTab`
   *  above, for the OTHER medallion. */
  balanceMode?: BalanceMode;
  onBalanceModeChange?: (mode: BalanceMode) => void;
  /**
   * Controlled active blockchain for the read side of this tab (2026-09-26,
   * owner directive: "how do i switch to kadena when i have chainweb as
   * selected blockchain... lets wire first the kadena switch, and read
   * functions"). `"stoa"` (the default) is unchanged behavior. `"kadena"`
   * swaps the balance DATA SOURCE from `useStoaChainBalances` to
   * `useKadenaBalances` (real Kadena mainnet, raw Pact constructors — see
   * that hook's own doc comment) and disables the UrStoa side of the
   * Stoa/UrStoa pill — UrStoa (the DALOS-wrapped vault token) does not exist
   * on real Kadena mainnet, so there is nothing for that segment to show;
   * its label morphs from "Stoa" to "Kadena" instead (owner's own words:
   * "make the selector Stoa/Urstoa disabled and morphed to Kadena in
   * naming"). Write actions (Send/Stake/Unstake/Collect) stay disabled in
   * Kadena mode — signing against real Kadena mainnet is explicit, separate,
   * not-yet-wired future work ("when doing transfer for kadena wed need to
   * wire other functions"). Plain (not controlled/fallback like `subTab`/
   * `balanceMode`) — this component never shows a switch UI for it, only
   * reacts to it; `ChainwebPanel` owns rendering + state for the actual
   * switch control. Omitted defaults to `"stoa"` — unchanged behavior. */
  activeNetwork?: "stoa" | "kadena";
  /**
   * Reports the individual Codex/Watched counts — owner correction
   * (design.md §8, the "further optimize round 8"): "it must contain the
   * exact designation as before, you shortened them" — the medallion
   * `ChainwebPanel` renders for the `subTab` toggle needs "Codex 58"/
   * "Watched 1", not a bare "Codex"/"Watched", to match what the inline
   * pill it replaced always showed.
   */
  onSubTabCountsChange?: (counts: { codex: number; watch: number }) => void;
  /**
   * Reports the codex's account COMPOSITION — owner correction (design.md
   * §8, round 8 follow-up): "my codex already holds 60 accounts over 12
   * seeds, which... we should be displaying as m/n+x, m being the number
   * of accounts from seeds, n the number of seeds, and x the number of
   * direct accounts (no seeds) instead of simply 60." `ChainwebPanel`'s
   * own category-row count (previously a bare total) renders this as
   * `${seedAccounts}/${seedCount}+${directAccounts}` instead. Deliberately
   * separate from `onTotalChange` (still the plain total, unchanged, used
   * for the accessible label) — this is a DIFFERENT, compositional stat,
   * not a replacement for the numeric total.
   */
  onAccountsBreakdownChange?: (breakdown: { seedAccounts: number; seedCount: number; directAccounts: number }) => void;
  /**
   * MOBILE ONLY — `ChainwebPanel`'s own Zone-3-border anchor (see
   * `PanelProps.zone3AnchorTarget`) — round 9 owner correction: "the
   * buttons need to be on the same level as the collapse expand
   * medallion." The action-button groups (`rightEdgeStack`/`leftEdgeStack`)
   * now dock to THIS seam, straddling it exactly like the Collapse-All
   * medallion does, instead of floating near the tab bar. Omitted, they
   * fall back to `fullScreenPortalTarget`'s own bottom-docked (non-
   * straddling) position, unchanged from the previous round.
   */
  zone3AnchorTarget?: Element | null;
  /**
   * Reports the ACTIVE pagination state (whichever of Codex/Watched is
   * showing) so `ChainwebPanel` can render it in the shared "middle of the
   * bottom seam" medallion slot — round 9 owner correction: "we also need
   * to agree on a standard pagination controls zone." Round 11 removed
   * Collapse-All from mobile entirely (no more grouped list to collapse —
   * see `codexFlatEntries`'s own doc comment), so that slot is now
   * UNCONDITIONALLY free: `null` only when there is nothing to paginate
   * (≤1 page) or no caller opted in at all (a standalone mount falls back
   * to its own inline Prev/Next instead, same "controlled prop with
   * fallback" rule as everywhere else in this codebase).
   */
  onPaginationHandleChange?: (
    handle: { page: number; totalPages: number; onPrev: () => void; onNext: () => void; onJump: (page: number) => void } | null,
  ) => void;
}

/* ─────────────── Address row ─────────────── */
function AddressRow({
  entry, bal, urBal, mode, loading, onRemove, onRelabel, onActionSuccess, selected, onSelect, onExpand, seedBadge,
  activeNetwork = "stoa",
}: {
  entry: AddrEntry;
  bal: StoaAccountBalances | undefined;
  urBal: UrStoaAccountBalances | undefined;
  mode: BalanceMode;
  loading: boolean;
  /** 2026-09-26: hides the "Send STOA" action while viewing Kadena-mode
   *  balances — signing/submitting against real Kadena mainnet isn't wired
   *  yet (see `StoaAccountsTab`'s own `activeNetwork` prop doc comment).
   *  UrStoa's own Transfer/Stake/Unstake/Collect actions need no separate
   *  gate here: they only ever show when `mode === "urstoa"`, which the
   *  parent tab already prevents while `activeNetwork === "kadena"`. */
  activeNetwork?: "stoa" | "kadena";
  onRemove?: () => void;
  onRelabel?: (label: string) => void;
  /** Called after ANY of this row's action modals (Transfer/Stake/Unstake/
   *  Collect/Send) succeeds — always the CURRENTLY ACTIVE balance hook's
   *  `refresh()`, so the row updates without a manual reload. */
  onActionSuccess: () => void;
  /**
   * MOBILE ONLY (design.md §8, the "further optimize round 2"): "the user
   * selects the entry, by tapping it and then is selected, the k medallion
   * lights up... tapping it again enters a full screen view mode." Desktop
   * ignores all three — its own chevron-toggle `open` state (below) is
   * untouched and still drives its own inline expand.
   */
  selected?: boolean;
  onSelect?: () => void;
  onExpand?: () => void;
  /**
   * MOBILE ONLY, round 11 owner correction: "instead of listing the
   * entries as part of a seed, we should make the entry carry a medallion
   * to see from which seed it belongs, thus making all entries having a
   * fixed size." A small colored dot on the row's own leading medallion —
   * the SAME "differentiate by colour, not text" convention already
   * chosen for the mobile seed list — plus a `title`/`aria-label` carrying
   * the full seed name for anyone who taps/inspects it. Omitted (desktop,
   * or the flat Watched list, which has no groups at all), no badge shows.
   */
  seedBadge?: { name: string; color: string };
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.sublabel);
  const [activeModal, setActiveModal] = useState<null | "transfer" | "stake" | "unstake" | "collect" | "send">(null);
  const isMobile = useIsMobile();
  const prefix = entry.address.slice(0, 2);
  const prefixColor = ADDR_COLORS[prefix] ?? "#888";
  const publicKey = publicKeyOf(entry.address);

  // 2026-09-27: Kadena mode's total is real KDA, not STOA — the unit word
  // must say so, not just the number.
  const balanceUnit = activeNetwork === "kadena" ? "KDA" : "STOA";
  const totalLabel =
    mode === "urstoa"
      ? !urBal || !urBal.exists ? "Empty" : `${fmt12(urBal.balance)} [${fmt12(urBal.staked)}]`
      : !bal || bal.isEmpty ? "Empty" : bal.total === 0 ? `0.0 ${balanceUnit}` : `${fmt12(bal.total)} ${balanceUnit}`;
  const totalColor =
    mode === "urstoa"
      // Gold whenever the account holds ANY value — liquid, staked, or
      // unclaimed earnings. A large STAKED balance with zero currently-liquid
      // balance is not "empty" and must not render gray.
      ? urBal && urBal.exists && (urBal.balance > 0 || urBal.staked > 0 || urBal.earnings > 0) ? "#ceac5f" : "#555"
      : bal && !bal.isEmpty && bal.total > 0 ? "#ceac5f" : "#555";

  // Mobile-only balance + mode emblem (design.md §8, the "further optimize"
  // round) — replaces the desktop row's `totalLabel`/" STOA" word in the
  // mobile row's lower-right corner. Stoa: FULL precision (owner correction,
  // round 3: "extend on the whole width and shorten it only if it doesn't
  // fit") — `MobileBalanceFill` (below) does the actual width-aware
  // shortening; this just supplies the full, untruncated source string.
  // UrStoa: the DUAL "liquid [staked]" figure desktop already shows — round
  // 4 owner correction: "on mobile its missing the dual balance display
  // that urstoa has" — at 3 decimals (round 4: "no point in displaying this
  // many").
  const mobileBalance =
    mode === "urstoa"
      ? !urBal || !urBal.exists
        ? { text: "Empty", emblem: null }
        : { text: `${fmt3(urBal.balance)} [${fmt3(urBal.staked)}]`, emblem: BALANCE_EMBLEM.urstoa }
      : !bal || bal.isEmpty
        ? { text: "Empty", emblem: null }
        : { text: bal.total === 0 ? "0.0" : fmt12(bal.total), emblem: BALANCE_EMBLEM.stoa };
  // Round 4 owner correction: "balance must be grey coloured, urstoa
  // colour, same colour as the logo dark silvery grey" — UrStoa's mobile
  // balance is ALWAYS the emblem's own grey (not the conditional gold/grey
  // `totalColor` desktop uses), regardless of whether it holds value.
  const mobileTotalColor = mode === "urstoa" ? BALANCE_EMBLEM.urstoa.color : totalColor;

  return (
    <>
    <div style={{ position: isMobile && seedBadge ? "relative" : undefined }}>
      {/* Owner correction (round 13): "i was thinking adding [the seed
          name] in upper left side, on the border (like we did for the
          medallions of Stoa/UrStoa Codex/Watched), this would keep the
          entry with a smaller height necessary, and would allow more to
          fit in a given area." Round 12 put the name INSIDE the row's own
          content flow (adding a fixed amount to every row's height,
          shrinking how many fit per page) — this straddles the card's own
          TOP border instead, "half in half out", the exact `SeamMedallion`/
          `SplitSeamMedallion` geometry already used for the zone-level
          Codex/Watched + Stoa/UrStoa toggles (see `ChainwebPanel.tsx`), just
          scoped to THIS one entry's own border rather than the whole
          panel's. Being `position: absolute`, it costs the row's own
          measured height NOTHING — `useSlotPageSize`'s `rowRef` measures
          this wrapper's normal-flow height, and an absolutely positioned
          sibling never contributes to that, satisfied by construction, not
          by convention. Rendered on a WRAPPER sibling to the bordered card
          (not a child of it) specifically because the card itself keeps its
          own `overflow: hidden` (for its rounded corners) — the same
          "portal/position OUTSIDE the clipping ancestor" rule
          `SeamMedallion`'s own bug fix #1 documents. */}
      {isMobile && seedBadge && (
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
    <div data-stoa-address={entry.address} style={{ border: "1px solid #262626", borderRadius: 12, overflow: "hidden", backgroundColor: "#18181B", scrollSnapAlign: isMobile ? "start" : undefined }}>
      {isMobile ? (
        /* Mobile entry layout (design.md §8, the "further optimize round
           2"): medallion (account-type prefix) as the row's leading "head"
           — lights up when SELECTED, mirroring how the Ouronet account
           entry's own selector medallion lights up. No per-row action
           buttons anymore (owner correction: "instead of adding so many
           buttons on each entry... keep a single row of buttons, beneath
           the header... tied to that selection") — just the chain count
           (upper-right) and the shortened address/position/balance. A tap
           selects (first tap) or opens the full-screen per-chain view
           (second tap, already selected) via `onSelect`/`onExpand`.
           Desktop's own header below is untouched. */
        <div
          onClick={() => { if (selected) { onExpand?.(); } else { onSelect?.(); } }}
          style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", cursor: "pointer" }}
        >
          <div style={{ flexShrink: 0, position: "relative", width: 34, height: 34 }}>
            <div
              style={{
                width: 34, height: 34, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700, fontFamily: MONO,
                color: selected ? "#ceac5f" : prefixColor,
                backgroundColor: selected ? "#ceac5f22" : prefixColor + "1a",
                border: selected ? "2px solid #ceac5f" : `1px solid ${prefixColor}40`,
                boxShadow: selected ? "0 0 10px #ceac5f66" : "none",
                transition: "all 0.15s",
              }}
            >
              {prefix}
            </div>
            {/* Round 11 owner correction: "make the entry carry a medallion
                to see from which seed it belongs" — a small colour-coded
                corner dot, reusing the group's OWN established colour
                (the SAME colour `SeedWordsTab`'s seed-type dot uses),
                title-tagged with the full seed name. */}
            {seedBadge && (
              <span
                title={seedBadge.name}
                aria-label={`From ${seedBadge.name}`}
                style={{
                  position: "absolute", bottom: -1, right: -1, width: 11, height: 11, borderRadius: "50%",
                  backgroundColor: seedBadge.color, border: "2px solid #18181B",
                }}
              />
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            {/* Upper row: address FILLS the row — owner correction (round 3):
                "extend the account name on the whole width, and shorten it
                only if it doesn't fit" — no more fixed 50%/3-char cap. */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <StoaAddressHighlight address={entry.address} style={{ flex: 1, minWidth: 0, fontFamily: MONO, fontSize: 12 }} />
              {bal && bal.chainsWithBalance > 1 && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 10, color: "#555", flexShrink: 0 }}>
                  <Layers style={{ width: 10, height: 10 }} />{bal.chainsWithBalance}
                </span>
              )}
            </div>
            {/* Lower row: position/sublabel … balance, ALSO filling the rest
                of the row (same correction, "the same with the balance
                amount"). */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0, maxWidth: "40%" }}>{entry.sublabel}</span>
              {loading ? (
                <Loader2 style={{ width: 13, height: 13, color: "#888", animation: "codex-seed-spin 0.9s linear infinite", flexShrink: 0, marginLeft: "auto" }} />
              ) : (
                <span style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 0, justifyContent: "flex-end" }}>
                  {/* Emblem AFTER the balance — owner correction (round 4):
                      "we add the urstoa logo after the balance… or better
                      yet, i think it has to sit after the balance." */}
                  <MobileBalanceFill value={mobileBalance.text} color={mobileTotalColor} style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, flex: 1, minWidth: 0 }} />
                  {mobileBalance.emblem && (
                    <span style={{ color: mobileBalance.emblem.color, fontSize: 12, lineHeight: 1, flexShrink: 0 }}>{mobileBalance.emblem.glyph}</span>
                  )}
                </span>
              )}
            </div>
          </div>
        </div>
      ) : (
      <div onClick={() => setOpen((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", cursor: "pointer" }}>
        {open ? <ChevronDown style={{ width: 16, height: 16, flexShrink: 0, color: "#ceac5f" }} /> : <ChevronRight style={{ width: 16, height: 16, flexShrink: 0, color: "#555" }} />}
        <span style={{ flexShrink: 0, width: 26, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 6, fontSize: 10, fontWeight: 700, fontFamily: MONO, color: prefixColor, backgroundColor: prefixColor + "1a" }}>{prefix}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <code style={{ fontFamily: MONO, fontSize: 13, color: "#d2d3d4", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{truncAddr(entry.address)}</code>
          <span style={{ fontSize: 11, color: "#888" }}>{entry.sublabel}</span>
        </div>
        <div style={{ flexShrink: 0, textAlign: "right" }}>
          {loading ? (
            <Loader2 style={{ width: 14, height: 14, color: "#888", animation: "codex-seed-spin 0.9s linear infinite" }} />
          ) : (
            <>
              <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: totalColor }}>{totalLabel}</div>
              {bal && bal.chainsWithBalance > 1 && <div style={{ fontSize: 10, color: "#555" }}>over {bal.chainsWithBalance} chains</div>}
            </>
          )}
        </div>
        <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex", gap: 6, flexShrink: 0 }}>
          {/* One mode-dependent slot: "Send" (native Stoa) in Stoa mode,
             "Transfer" (UrStoa) in UrStoa mode — same position, same chrome,
             just a different modal/icon/tooltip depending on the toggle. */}
          {publicKey && (mode === "urstoa" || activeNetwork === "stoa") && (
            <ActionTooltip
              content={
                mode === "urstoa"
                  ? "Transfer UrStoa to another account."
                  : "Send native Stoa to another account."
              }
            >
              <button
                type="button"
                title={mode === "urstoa" ? "Transfer UrStoa" : "Send STOA"}
                onClick={() => setActiveModal(mode === "urstoa" ? "transfer" : "send")}
                style={actionBtnStyle}
              >
                {mode === "urstoa" ? <TransferGlyph style={actionIconStyle} /> : <SendGlyph style={actionIconStyle} />}
              </button>
            </ActionTooltip>
          )}
          {publicKey && mode === "urstoa" && (
            <>
              <ActionTooltip content={`Stake your liquid UrStoa into the vault. ${fmt12(urBal?.balance ?? 0)} UrStoa available.`}>
                <button type="button" title="Stake UrStoa" onClick={() => setActiveModal("stake")} style={actionBtnStyle}><StakeGlyph style={actionIconStyle} /></button>
              </ActionTooltip>
              <ActionTooltip content={`Unstake UrStoa from the vault. ${fmt12(urBal?.staked ?? 0)} UrStoa staked.`}>
                <button type="button" title="Unstake UrStoa" onClick={() => setActiveModal("unstake")} style={actionBtnStyle}><UnstakeGlyph style={actionIconStyle} /></button>
              </ActionTooltip>
              <ActionTooltip content={`Collect ${fmt12(urBal?.earnings ?? 0)} STOA in earned vault rewards.`}>
                <button type="button" title="Collect UrStoa earnings" onClick={() => setActiveModal("collect")} style={actionBtnStyle}><CollectGlyph style={actionIconStyle} /></button>
              </ActionTooltip>
            </>
          )}
          <IconCopyBtn text={entry.address} size={28} />
          <IconStoaExplorerBtn
            href={activeNetwork === "kadena" ? kadenaExplorerUrl(entry.address) : explorerUrl(entry.address)}
            network={activeNetwork === "kadena" ? "kadena" : "stoa"}
            size={28}
          />
          {onRemove && <IconDeleteBtn onClick={onRemove} size={28} />}
        </span>
      </div>
      )}

      {open && (
        <div style={{ padding: "0 14px 12px", borderTop: "1px solid #1a1a1a" }}>
          {/* Watched-label editor */}
          {onRelabel && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
              <span style={{ fontSize: 11, color: "#555" }}>Label</span>
              {editing ? (
                <>
                  <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { onRelabel(draft.trim()); setEditing(false); } if (e.key === "Escape") setEditing(false); }}
                    style={{ flex: 1, height: 26, fontSize: 12, padding: "0 8px", borderRadius: 6, backgroundColor: "#0a0a0a", border: "1px solid #4ade8060", color: "#d2d3d4" }} />
                  <button type="button" onClick={() => { onRelabel(draft.trim()); setEditing(false); }} style={{ display: "inline-flex", width: 26, height: 26, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: "#0a2010", color: "#4ade80", border: "2px solid rgba(20,80,40,0.9)", cursor: "pointer" }}><Check size={12} /></button>
                  <button type="button" onClick={() => setEditing(false)} style={{ display: "inline-flex", width: 26, height: 26, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: "#141414", color: "#777", border: "2px solid #252525", cursor: "pointer" }}><X size={12} /></button>
                </>
              ) : (
                <button type="button" onClick={() => { setDraft(entry.sublabel); setEditing(true); }} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, padding: "2px 8px", borderRadius: 6, background: "transparent", border: "1px solid #262626", color: "#888", cursor: "pointer" }}><Pencil size={11} /> {entry.sublabel || "(set label)"}</button>
              )}
            </div>
          )}

          {/* Stoa Balance summary (URC_0028) */}
          {bal?.selectorBalance !== undefined && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, padding: "6px 0", borderBottom: "1px solid #1a1a1a" }}>
              <span style={{ fontSize: 12, color: "#888" }}>Stoa Balance</span>
              <span style={{ fontFamily: MONO, fontSize: 13, color: "#d2d3d4" }}>{bal.selectorBalance.toFixed(8)} STOA</span>
            </div>
          )}

          {/* Per-chain grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 24px", marginTop: 10 }}>
            {STOA_CHAINS.map((chainId: string) => {
              const c = bal?.perChain[chainId];
              const val = !c || !c.exists ? "✗" : c.balance === 0 ? "0.0" : fmt12(c.balance);
              const color = !c || !c.exists ? "#c0392b" : c.balance === 0 ? "#555" : "#ceac5f";
              return (
                <div key={chainId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "3px 0" }}>
                  <span style={{ fontSize: 12, color: "#888" }}>Chain {chainId}</span>
                  <span style={{ fontFamily: MONO, fontSize: 12, color }}>{val}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
    </div>
    {publicKey && (
      <>
        <TransferUrStoaModal isOpen={activeModal === "transfer"} onClose={() => setActiveModal(null)} publicKey={publicKey} address={entry.address} onSuccess={onActionSuccess} />
        <StakeUrStoaModal isOpen={activeModal === "stake"} onClose={() => setActiveModal(null)} publicKey={publicKey} address={entry.address} onSuccess={onActionSuccess} />
        <UnstakeUrStoaModal isOpen={activeModal === "unstake"} onClose={() => setActiveModal(null)} publicKey={publicKey} address={entry.address} onSuccess={onActionSuccess} />
        <CollectUrStoaModal isOpen={activeModal === "collect"} onClose={() => setActiveModal(null)} publicKey={publicKey} address={entry.address} onSuccess={onActionSuccess} />
        <SendStoaModal isOpen={activeModal === "send"} onClose={() => setActiveModal(null)} publicKey={publicKey} address={entry.address} senderChainBalance={bal?.perChain[STOACHAIN_CHAIN_ID]?.balance} onSuccess={onActionSuccess} />
      </>
    )}
    </>
  );
}

/* ─────────────── Mobile full-screen per-chain breakdown ─────────────── */
/**
 * MobileAddressFullScreen — owner correction (design.md §8, the "further
 * optimize round 2"): "tapping an entry selects it. tapping it again enters
 * a full screen view mode with per chain breakdown of values, one chain per
 * row, and we can use the whole screen... instead of showing the per chain
 * view in zone 3, like we have now." Replaces the old inline "open" expand
 * (Stoa Balance summary + per-chain grid squeezed into Zone 3) with a real
 * full-screen `CodexModalShell` sheet — same shell every other mobile modal
 * in this package uses, so it gets the full-bleed sheet + close(×) button
 * "for free". Stoa mode gets the per-chain grid (one row per chain, with a
 * sort-by-amount toggle, "default view is in order of chain number");
 * UrStoa mode has no per-chain data at all (a single vault construct), so it
 * shows Liquid/Staked/Earnings instead — the same three figures the old
 * inline UrStoa row already exposed via `totalLabel`/vault-action tooltips.
 */
function MobileAddressFullScreen({
  entry, bal, urBal, mode, onClose, onRelabel, chainSort, onToggleChainSort,
  activeNetwork = "stoa",
}: {
  entry: AddrEntry;
  bal: StoaAccountBalances | undefined;
  urBal: UrStoaAccountBalances | undefined;
  mode: BalanceMode;
  onClose: () => void;
  onRelabel?: (label: string) => void;
  chainSort: "number" | "amount";
  onToggleChainSort: () => void;
  /** 2026-09-27: only fixes the "Total Stoa Balance"/" STOA" unit label for
   *  Kadena mode — this view's per-chain grid below still iterates
   *  `STOA_CHAINS` (10), not `KADENA_CHAINS` (20), so a Kadena account with
   *  balance on chain 10+ won't show that chain's row here yet. Known,
   *  separate gap (mobile-only fullscreen view); not attempted in this pass,
   *  which fixes the desktop-reported label/explorer-link bugs. */
  activeNetwork?: "stoa" | "kadena";
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.sublabel);
  const prefix = entry.address.slice(0, 2);
  const prefixColor = ADDR_COLORS[prefix] ?? "#888";
  const balanceUnit = activeNetwork === "kadena" ? "KDA" : "STOA";

  const chainRows = STOA_CHAINS.map((chainId: string) => ({ chainId, c: bal?.perChain[chainId] }));
  const sortedChainRows =
    chainSort === "amount"
      ? [...chainRows].sort((a, b) => (b.c?.exists ? b.c.balance : -1) - (a.c?.exists ? a.c.balance : -1))
      : chainRows;

  return (
    <CodexModalShell title="Account Detail" subtitle={entry.sublabel} onClose={onClose} dialogTestId="stoa-address-fullscreen">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div
          style={{
            flexShrink: 0, width: 40, height: 40, borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, fontWeight: 700, fontFamily: MONO, color: prefixColor,
            backgroundColor: prefixColor + "1a", border: `1px solid ${prefixColor}40`,
          }}
        >
          {prefix}
        </div>
        <StoaAddressHighlight address={entry.address} style={{ flex: 1, minWidth: 0, fontFamily: MONO, fontSize: 14 }} />
        <IconCopyBtn text={entry.address} size={32} />
      </div>

      {onRelabel && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <span style={{ fontSize: 11, color: "#555" }}>Label</span>
          {editing ? (
            <>
              <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { onRelabel(draft.trim()); setEditing(false); } if (e.key === "Escape") setEditing(false); }}
                style={{ flex: 1, height: 30, fontSize: 12, padding: "0 8px", borderRadius: 6, backgroundColor: "#0a0a0a", border: "1px solid #4ade8060", color: "#d2d3d4" }} />
              <button type="button" onClick={() => { onRelabel(draft.trim()); setEditing(false); }} style={{ display: "inline-flex", width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: "#0a2010", color: "#4ade80", border: "2px solid rgba(20,80,40,0.9)", cursor: "pointer" }}><Check size={13} /></button>
              <button type="button" onClick={() => setEditing(false)} style={{ display: "inline-flex", width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: "#141414", color: "#777", border: "2px solid #252525", cursor: "pointer" }}><X size={13} /></button>
            </>
          ) : (
            <button type="button" onClick={() => { setDraft(entry.sublabel); setEditing(true); }} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, padding: "3px 9px", borderRadius: 6, background: "transparent", border: "1px solid #262626", color: "#888", cursor: "pointer" }}><Pencil size={12} /> {entry.sublabel || "(set label)"}</button>
          )}
        </div>
      )}

      {mode === "stoa" ? (
        <>
          {/* Owner correction (design.md §8, the "further optimize round
              3"): "Total Stoa balance, not only the balance on chain 0" —
              `bal.selectorBalance` (the URC_0028 protocol figure) reads as
              ONE chain's worth, not the account's real cross-chain total;
              `bal.total` is the actual sum across every STOA_CHAINS entry
              (the SAME figure the list row's own balance already shows). */}
          {bal && !bal.isEmpty && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, padding: "8px 0", borderBottom: "1px solid #1a1a1a" }}>
              <span style={{ fontSize: 13, color: "#888" }}>
                {activeNetwork === "kadena" ? "Total Kadena Balance" : "Total Stoa Balance"}
              </span>
              <span style={{ fontFamily: MONO, fontSize: 14, color: "#d2d3d4" }}>{fmt12(bal.total)} {balanceUnit}</span>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: "#888", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Per-Chain Balances</span>
            <button
              type="button"
              onClick={onToggleChainSort}
              aria-pressed={chainSort === "amount"}
              title={chainSort === "amount" ? "Sorted by amount (biggest first) — tap for chain number" : "Sorted by chain number — tap to sort by amount"}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, padding: "4px 9px", borderRadius: 6, border: `1px solid ${chainSort === "amount" ? "#ceac5f" : "#262626"}`, backgroundColor: chainSort === "amount" ? "#ceac5f1a" : "transparent", color: chainSort === "amount" ? "#ceac5f" : "#888", cursor: "pointer" }}
            >
              <ArrowUpDown size={12} /> {chainSort === "amount" ? "By amount" : "By chain #"}
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {sortedChainRows.map(({ chainId, c }) => {
              const val = !c || !c.exists ? "✗" : c.balance === 0 ? "0.0" : fmt12(c.balance);
              const color = !c || !c.exists ? "#c0392b" : c.balance === 0 ? "#555" : "#ceac5f";
              return (
                <div key={chainId} data-testid={`fullscreen-chain-row-${chainId}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderRadius: 10, border: "1px solid #1a1a1a", backgroundColor: "#0d0d0d" }}>
                  <span style={{ fontSize: 14, color: "#888" }}>Chain {chainId}</span>
                  <span style={{ fontFamily: MONO, fontSize: 14, color }}>{val}</span>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {([
            ["Liquid", urBal?.balance],
            ["Staked", urBal?.staked],
            ["Earnings", urBal?.earnings],
          ] as const).map(([label, value]) => (
            <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderRadius: 10, border: "1px solid #1a1a1a", backgroundColor: "#0d0d0d" }}>
              <span style={{ fontSize: 14, color: "#888" }}>{label}</span>
              <span style={{ fontFamily: MONO, fontSize: 14, color: value ? "#ceac5f" : "#555" }}>{value === undefined ? "—" : fmt12(value)}</span>
            </div>
          ))}
        </div>
      )}
    </CodexModalShell>
  );
}

/* ─────────────── Collapsible group ─────────────── */
function GroupRow({
  name, color, count, children, open: openProp, onToggle, showHeader = true,
}: {
  name: string;
  color: string;
  count: number;
  children: React.ReactNode;
  /**
   * Controlled open state — mobile-only "Collapse All" button (design.md
   * §8, the "further optimize round 5") drives every group at once through
   * this pair. Both optional — omitted, this component falls back to its
   * own internal `useState` (the original, fully self-contained desktop
   * behavior), same "controlled prop with internal-state fallback" pattern
   * `SeedWordsTab`'s own `createOpen`/`onCreateOpenChange` already uses.
   */
  open?: boolean;
  onToggle?: () => void;
  /**
   * MOBILE PAGINATION ONLY (design.md §8, round 8 follow-up — owner
   * correction: "cant you do a fixed amount of entries per available area
   * ... one seed entry is 0.5 slot"): when a group's own entries don't all
   * fit on ONE page, the remaining entries continue on the NEXT page —
   * but the header (and its collapse chevron) must NOT repeat, since it
   * already appeared on the previous page and this same group is, by
   * definition, already open. `false` renders just the bordered card +
   * `children`, no header row at all. Default `true` — every other caller
   * (desktop, and a page's own FIRST block for a given group) is
   * unaffected.
   */
  showHeader?: boolean;
}) {
  const [openState, setOpenState] = useState(true);
  const open = openProp ?? openState;
  const toggle = onToggle ?? (() => setOpenState((v) => !v));
  // Owner correction (design.md §8, the "further optimize round 6"): "i
  // want scrolling to show full entries... this must be done everywhere" —
  // opts into the scroll-snap ChainwebPanel's mobile content wrapper
  // already enables (inert unless a row opts in).
  //
  // COLLAPSED-only (round 8 follow-up — owner-reported live bug: "scrolling
  // scrolls me back, it doesnt keep"): a group card left snap-eligible
  // while EXPANDED registers itself as a "start" snap target that can span
  // hundreds of pixels (an 11-key group, say) — CSS `scroll-snap-type:
  // mandatory` treats that oversized target as just as valid a snap point
  // as each of its own much smaller child `AddressRow`s, and real browsers
  // don't reliably pick "the nearest one that actually makes sense" among
  // overlapping/nested snap targets, so a normal scroll through a long
  // expanded group could get yanked back to the GROUP's own top instead of
  // resting on whichever key row the user actually scrolled to. A
  // COLLAPSED group has no such competing children, so it stays snap-
  // eligible as the atomic "entry" in that state; once expanded, only its
  // own `AddressRow` children opt in (they already do, unconditionally).
  //
  // A separate, short-lived attempt built a JS-enforced correction hook
  // (`useSnapScrollCorrection`) as a backstop on TOP of this CSS mechanism.
  // It was removed again after causing three separate live-reported
  // scroll regressions in a row (an animated-scroll feedback loop, a
  // scroll-boundary-clamping bug, an oversized-candidate bug that produced
  // spurious corrections on nearly every settle inside a tall expanded
  // group — "once i colapse a seed... i scroll and it moves me... the
  // hook behave eratically"). Plain CSS scroll-snap, no JS correction,
  // stays the mechanism here — it was never itself reported as fighting
  // the user, only as occasionally (not always) failing to re-snap after a
  // fling on some WebViews, a strictly smaller failure mode.
  const isMobile = useIsMobile();
  const snapEligible = isMobile && !open;
  return (
    <div style={{ border: "1px solid #262626", borderRadius: 12, overflow: "hidden", scrollSnapAlign: snapEligible ? "start" : undefined }}>
      {showHeader && (
        <div onClick={toggle} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", cursor: "pointer", backgroundColor: "#0d0d0d" }}>
          {open ? <ChevronDown style={{ width: 16, height: 16, flexShrink: 0, color }} /> : <ChevronRight style={{ width: 16, height: 16, flexShrink: 0, color: "#555" }} />}
          {/* Round 8 follow-up — owner-reported live bug: "on a smaller
              screen, the seeds view on accounts when collapsing, some
              weird shit is happening with the entries that they are not
              displayed properly on their entry line." A `flex: 1` child
              with no `minWidth: 0` refuses to shrink below its own
              intrinsic text width in a flex row — on a narrow viewport a
              longer seed name pushes the count badge (no `flexShrink`
              either) off its own line / causes the whole header row to
              overflow instead of truncating. Both fixed here: the name
              now actually shrinks and ellipsizes, the badge never gets
              squeezed. */}
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600, fontSize: 14, color: "#d2d3d4" }}>{name}</span>
          <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, padding: "1px 8px", borderRadius: 9999, color: "#555", backgroundColor: "#1a1a1a" }}>{count}</span>
        </div>
      )}
      {(showHeader ? open : true) && <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10 }}>{children}</div>}
    </div>
  );
}

/* ─────────────── Main tab ─────────────── */
export function StoaAccountsTab({
  className, onTotalChange, onRefreshHandleChange, fullScreenPortalTarget, zone3AnchorTarget,
  subTab: subTabProp, onSubTabChange, balanceMode: balanceModeProp, onBalanceModeChange,
  onSubTabCountsChange, onAccountsBreakdownChange, onPaginationHandleChange,
  activeNetwork = "stoa",
}: StoaAccountsTabProps) {
  const isMobile = useIsMobile();
  const { seeds } = useStoaChainSeeds();
  const { keypairs } = usePureKeypairs();
  const { entries: watchEntries, addEntry, deleteEntry } = useWatchList();
  const [localSubTab, setLocalSubTab] = useState<"codex" | "watch">("codex");
  const subTab = subTabProp ?? localSubTab;
  const setSubTab = onSubTabChange ?? setLocalSubTab;
  const [watchInput, setWatchInput] = useState("");
  const [watchError, setWatchError] = useState<string | null>(null);
  const [localBalanceMode, setLocalBalanceMode] = useState<BalanceMode>("stoa");
  const balanceMode = balanceModeProp ?? localBalanceMode;
  const setBalanceMode = onBalanceModeChange ?? setLocalBalanceMode;
  // 2026-09-26: UrStoa has no Kadena-mainnet equivalent (see the
  // `activeNetwork` prop's own doc comment) — if the pill was already on
  // "urstoa" from BEFORE the user switched networks, force it back to
  // "stoa" (now displaying as "Kadena") the moment `activeNetwork` becomes
  // "kadena", rather than leaving a stale, disabled-but-still-selected
  // UrStoa view on screen. The pill's own onClick already prevents
  // SELECTING "urstoa" while in Kadena mode — this covers the one path that
  // doesn't go through that click handler.
  useEffect(() => {
    if (activeNetwork === "kadena" && balanceMode === "urstoa") setBalanceMode("stoa");
  }, [activeNetwork, balanceMode, setBalanceMode]);
  // MOBILE ONLY (design.md §8, the "further optimize round 2") — the
  // currently SELECTED entry (medallion lit, shared action row tied to it),
  // the entry currently shown FULL SCREEN (a second tap on an already-
  // selected row), the chain-sort mode inside that full-screen view, and
  // the modal the shared action row's own buttons opened. Desktop never
  // touches any of these — its own per-row `open`/`activeModal` state
  // (inside `AddressRow`) is untouched.
  //
  // `selectedAddressState` is the user's own EXPLICIT choice (or `null` —
  // "no explicit choice yet/anymore"); owner correction (round 3): "there
  // is no state where no entry is selected. always an entry is selected,
  // and by default that is the first entry of the first seed on the list."
  // The EFFECTIVE selection (below, after `groups`/`watchAddrs` exist) falls
  // back to the current subtab's first entry whenever the explicit choice is
  // absent OR belongs to the OTHER subtab — a pure per-render derivation, not
  // an effect, so there is never a one-frame "nothing selected" flash on
  // mount or on switching Codex/Watched.
  const [selectedAddressState, setSelectedAddressState] = useState<string | null>(null);
  const [fullScreenAddress, setFullScreenAddress] = useState<string | null>(null);
  const [chainSort, setChainSort] = useState<"number" | "amount">("number");
  const [mobileActiveModal, setMobileActiveModal] = useState<null | "transfer" | "stake" | "unstake" | "collect" | "send">(null);

  // Build the codex groups (one per seed + a Pure Key Pairs group).
  const groups = useMemo(() => {
    const out: AddrGroup[] = [];
    seeds.forEach((seed: IStoaChainSeed, i) => {
      const isPrime = seed.isPrime === true || i === 0;
      const name = isPrime ? "Prime Codex Seed" : seed.name || `Seed #${i + 1}`;
      const color = SEED_TYPE_COLOR[seed.seedType] ?? "#ec4899";
      out.push({
        id: seed.id,
        name,
        color,
        entries: [...seed.accounts].sort((a, b) => a.index - b.index).map((acc) => ({ address: `k:${acc.publicKey}`, sublabel: `Key #${acc.index}` })),
      });
    });
    if (keypairs.length) {
      out.push({
        id: "pure",
        name: "Pure Key Pairs",
        color: "#a78bfa",
        entries: [...keypairs].sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id)).map((kp, i) => ({ address: `k:${kp.publicKey}`, sublabel: kp.label || `Pair #${i + 1}` })),
      });
    }
    return out;
  }, [seeds, keypairs]);

  const codexAddresses = useMemo(() => groups.flatMap((g) => g.entries.map((e) => e.address)), [groups]);
  const codexAddressSet = useMemo(() => new Set(codexAddresses), [codexAddresses]);
  // Watch entries for THIS chain only, that aren't already codex accounts.
  //
  // Bug fix — owner-reported live bug: "there is a watched account but on
  // arweave, and it has leaked in the watch account on chainweb. these
  // must be independent lists." `useWatchList()` returns ONE global,
  // codex-wide array shared by every chain's watch feature (see
  // `WatchListEntry.type`) — Arweave's own wiring already filters that
  // array down to `type === "arweave"` before it ever reaches its panel
  // (`apps/codex-playground/src/ForeignChainsWiring.tsx`), but this
  // component had NO equivalent filter at all: it only excluded addresses
  // that happened to already be codex-owned, so an Arweave-typed entry
  // (or any entry from a different chain) passed straight through and
  // rendered here too. Filtering to `type === "stoa"` first makes this
  // list — like Arweave's — genuinely independent per chain.
  const watchAddrs = useMemo(
    () => watchEntries.filter((w) => w.type === "stoa" && !codexAddressSet.has(w.address)),
    [watchEntries, codexAddressSet],
  );

  // Round 11 owner correction — a fundamentally simpler, deterministic
  // redesign: "instead of listing the entries as part of a seed, we should
  // make the entry carry a medallion to see from which seed it belongs,
  // thus making all entries having a fixed size. with a fixed size for all
  // entries, we can perfectly say how many entries fit in a given space
  // size... this means we wouldn't necessarily need an expand/collapse
  // medallion." MOBILE ONLY (desktop keeps the grouped `GroupRow` list
  // above, byte-identical): every group's entries flatten into ONE
  // uniform-height list, each entry tagged with its OWNING group's
  // name/color for the small seed-badge `AddressRow` renders (see its own
  // `seedBadge` prop) — no more header units, no more half-slot cost, no
  // more "never leave a header alone" bundling rule, no more Collapse-All
  // (nothing left to collapse). The exact same trivial, already-proven
  // chunking `watchAddrs` uses below — a page is simply
  // `floor(slotsAvailable)` entries, period.
  const codexFlatEntries = useMemo(
    () => groups.flatMap((g) => g.entries.map((e) => ({ entry: e, groupId: g.id, groupName: g.name, groupColor: g.color }))),
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
    const out: typeof watchAddrs[] = [];
    for (let i = 0; i < watchAddrs.length; i += perPage) out.push(watchAddrs.slice(i, i + perPage));
    if (out.length === 0) out.push([]);
    return out;
  }, [watchAddrs, slotsAvailable]);
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
   * Round 11 owner correction: "additionaly we can add swping mechanic to
   * move page." The paginated entry area (`accountsPageContainerRef`) is
   * `overflow: hidden` — it never scrolls, so there is nothing for a swipe
   * gesture to fight (unlike the abandoned `useSnapScrollCorrection`
   * attempt earlier this session, which fought CSS scroll-snap on a
   * genuinely SCROLLING list and caused three separate regressions).
   *
   * Round 18 owner correction: "we need swiping behaviour when swiping,
   * not simply showing directly next page." Round 11's version computed
   * the horizontal delta only on `touchend` and jumped straight to the
   * next/prev page — no visual feedback WHILE dragging. This tracks the
   * finger live (`touchmove`) with a CSS `translateX` on the entry list's
   * own inner wrapper (NOT the `overflow: hidden` measured container
   * itself — see the JSX below), with a light rubber-band RESISTANCE past
   * the first/last page (there's nothing further to reveal, but the drag
   * should still feel alive, not rigid).
   *
   * `dragTransition` is OFF (instant, 1:1 with the finger) while
   * `touchmove` is actively firing, and ON (a short CSS `transition`)
   * for the two settle animations `touchend` can trigger: past the
   * threshold, the current page's content finishes animating OFF-SCREEN
   * before the page index actually changes AND the transform resets to
   * 0 in the SAME batched update that flips `dragTransition` back off —
   * so that reset is invisible (the classic carousel "animate out, swap
   * with no animation, animate the NEW page in via its own re-mount"
   * trick); short of the threshold, it animates back to 0 instead (a
   * "bounce back", no page change).
   *
   * A gesture is only ever treated as a page-swipe once it's CONFIRMED
   * more horizontal than vertical past a small dead-zone (a few px) —
   * until then (and whenever it resolves vertical), this deliberately
   * touches nothing, so an ordinary vertical scroll of the page around
   * this area is never fought (no `preventDefault` anywhere in this
   * handler set, for the same reason — React's own touch listeners are
   * passive, so it would silently do nothing useful anyway; simply never
   * applying `dragX` for a vertical gesture is what actually keeps
   * native scrolling free).
   *
   * Round 20 owner correction: "the swiping behaviour should act like a
   * swipe, if i swipe, as you can see the next page isnt there, it simply
   * appears when the prev page is complelety gone." Round 18's version
   * only ever rendered the CURRENT page — dragging it aside revealed
   * genuinely empty space, and the next page only mounted once the old
   * one had fully animated away. `dragDirection` now mounts the ADJACENT
   * page's own real content (`codexPages[activePage±1]`/
   * `watchPages[activePage±1]`) as a second pane, positioned immediately
   * beside the current one — a real two-pane carousel track, so dragging
   * genuinely slides the incoming page INTO view as the outgoing one
   * slides out, from the very first pixel of the gesture, not just once
   * it's fully gone. Locked to whichever direction the gesture first
   * resolves toward (never flips mid-gesture — keeps the geometry simple
   * and matches how every mainstream swipe carousel behaves); stays
   * `null` (single-pane, rubber-band only) whenever there's no adjacent
   * page in that direction to show at all.
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
   * Round 20 — renders ONE page's worth of rows for whichever subtab is
   * active, factored out of the JSX below so the swipe carousel can mount
   * it TWICE (the current page, plus whichever adjacent page `dragDirection`
   * is currently revealing) instead of just once. `measureFirstRow` is
   * true ONLY for the currently-displayed page's own first row — the
   * peeking adjacent page must never feed `useSlotPageSize`'s live
   * measurement (it's not what's actually settled/visible at rest).
   */
  const renderAccountsPage = (pageIndex: number, measureFirstRow: boolean): React.ReactNode => {
    if (subTab === "codex") {
      if (groups.length === 0) {
        return <div style={{ textAlign: "center", padding: "32px 0", borderRadius: 12, border: "1px dashed #262626", color: "#555", fontSize: 14 }}>No Stoa accounts in the codex.</div>;
      }
      // Round 11 — flat, fixed-height rows (no group header/wrapper card
      // at all): each `AddressRow` carries its own `seedBadge` dot
      // instead. See `codexFlatEntries`'s own doc comment for the full
      // reasoning.
      return (codexPages[pageIndex] ?? []).map((row, i) => (
        <div key={row.entry.address} ref={measureFirstRow && i === 0 ? accountsPageRowRef : undefined}>
          <AddressRow
            entry={row.entry}
            bal={byAddress[row.entry.address]}
            urBal={urByAddress[row.entry.address]}
            mode={balanceMode}
            activeNetwork={activeNetwork}
            loading={rowLoading(row.entry.address)}
            onActionSuccess={activeRefresh}
            selected={selectedAddress === row.entry.address}
            onSelect={() => setSelectedAddressState(row.entry.address)}
            onExpand={() => setFullScreenAddress(row.entry.address)}
            seedBadge={{ name: row.groupName, color: row.groupColor }}
          />
        </div>
      ));
    }
    if (watchAddrs.length === 0) {
      return (
        <div style={{ textAlign: "center", padding: "32px 0", borderRadius: 12, border: "1px dashed #262626", color: "#555" }}>
          <Eye style={{ width: 24, height: 24, opacity: 0.4 }} />
          <p style={{ fontSize: 14, margin: "8px 0 0" }}>No watched addresses.</p>
        </div>
      );
    }
    return (watchPages[pageIndex] ?? []).map((w, wi) => (
      <div key={w.id} ref={measureFirstRow && wi === 0 ? accountsPageRowRef : undefined}>
        <AddressRow
          entry={{ address: w.address, sublabel: w.label || "", watchId: w.id }}
          bal={byAddress[w.address]}
          urBal={urByAddress[w.address]}
          mode={balanceMode}
          activeNetwork={activeNetwork}
          loading={rowLoading(w.address)}
          onRemove={() => void deleteEntry(w.id)}
          onRelabel={(label) => void addEntry({ ...w, label })}
          onActionSuccess={activeRefresh}
          selected={selectedAddress === w.address}
          onSelect={() => setSelectedAddressState(w.address)}
          onExpand={() => setFullScreenAddress(w.address)}
        />
      </div>
    ));
  };

  // The EFFECTIVE selection (see `selectedAddressState`'s own doc comment
  // above): the current subtab's first entry, unless the user's explicit
  // choice is both present AND actually belongs to THIS subtab's list.
  const currentListFirstAddress = subTab === "codex" ? (groups[0]?.entries[0]?.address ?? null) : (watchAddrs[0]?.address ?? null);
  const selectedAddressStateValid =
    selectedAddressState !== null &&
    (subTab === "codex" ? codexAddressSet.has(selectedAddressState) : watchAddrs.some((w) => w.address === selectedAddressState));
  const selectedAddress = selectedAddressStateValid ? selectedAddressState : currentListFirstAddress;

  const allAddresses = useMemo(() => [...codexAddresses, ...watchAddrs.map((w) => w.address)], [codexAddresses, watchAddrs]);

  // Only read chain data when a StoaChain connection is actually wired. A node
  // is wired when a PRESET is selected (OuronetUI's default) OR a non-empty
  // custom node URL is set (the standalone Network tab). A standalone Codex with
  // nothing connected (selectedNode "custom" + empty URL) must NOT read balances
  // — otherwise it silently falls through to stoa-core's default node.
  const store = useCodexStore();
  const ui = store((s: CodexStoreState) => s.uiSettings as Record<string, unknown>);
  const stoaChainConnected =
    ui.selectedNode !== "custom" || String(ui.customNodeUrl ?? "").trim().length > 0;

  const {
    byAddress: stoaByAddress,
    loading: stoaLoading,
    error: stoaError,
    refresh: stoaRefresh,
  } = useStoaChainBalances(
    allAddresses,
    codexAddresses,
    stoaChainConnected && activeNetwork === "stoa",
  );
  // Kadena mode (2026-09-26): real Kadena mainnet balances, raw Pact
  // constructors — see `useKadenaBalances`'s own doc comment. Only issued
  // while `activeNetwork` is actually "kadena", mirroring the UrStoa read's
  // own "don't pay for a read nobody's looking at" gating below.
  const {
    byAddress: kadenaByAddress,
    loading: kadenaLoading,
    error: kadenaError,
    refresh: kadenaRefresh,
  } = useKadenaBalances(allAddresses, activeNetwork === "kadena");
  // The "stoa slot" balance bundle, picked between Stoa and Kadena by
  // `activeNetwork` — every existing `byAddress[...]` read site below (and
  // `activeLoading`/`activeError`/`activeRefresh`/`rowLoading`'s own
  // `balanceMode === "urstoa" ? ur... : ...` branch immediately below)
  // reads THIS name, so Kadena mode is a drop-in swap with zero changes to
  // any render site.
  const byAddress = activeNetwork === "kadena" ? kadenaByAddress : stoaByAddress;
  const loading = activeNetwork === "kadena" ? kadenaLoading : stoaLoading;
  const error = activeNetwork === "kadena" ? kadenaError : stoaError;
  const refresh = activeNetwork === "kadena" ? kadenaRefresh : stoaRefresh;
  // Only issue the UrStoa batched read while the toggle is actually on
  // UrStoa AND still in Stoa mode — UrStoa does not exist on Kadena mainnet
  // (see `activeNetwork` prop's own doc comment), and the pill itself is
  // disabled out of "urstoa" whenever `activeNetwork === "kadena"` (see the
  // two pill render sites below), so this condition is a belt-and-braces
  // guard against ever paying for a UrStoa read in Kadena mode.
  const {
    byAddress: urByAddress,
    loading: urLoading,
    error: urError,
    refresh: urRefresh,
  } = useUrStoaBalances(allAddresses, stoaChainConnected && activeNetwork === "stoa" && balanceMode === "urstoa");

  const activeLoading = balanceMode === "urstoa" ? urLoading : loading;
  const activeError = balanceMode === "urstoa" ? urError : error;
  const activeRefresh = balanceMode === "urstoa" ? urRefresh : refresh;

  const totalCodex = codexAddresses.length;
  useEffect(() => {
    onTotalChange?.(totalCodex + watchAddrs.length);
  }, [totalCodex, watchAddrs.length, onTotalChange]);

  useEffect(() => {
    onSubTabCountsChange?.({ codex: totalCodex, watch: watchAddrs.length });
  }, [totalCodex, watchAddrs.length, onSubTabCountsChange]);

  // Owner correction (design.md §8, round 8 follow-up): "m being the number
  // of accounts from seeds, n the number of seeds, and x the number of
  // direct accounts (no seeds)" — computed straight off `seeds`/`keypairs`
  // (NOT `groups`, which also folds the "Pure Key Pairs" pseudo-group's
  // entries into one flat list) so `seedAccounts` counts ONLY real
  // seed-derived accounts.
  const seedAccountsCount = useMemo(() => seeds.reduce((sum, s) => sum + s.accounts.length, 0), [seeds]);
  useEffect(() => {
    onAccountsBreakdownChange?.({ seedAccounts: seedAccountsCount, seedCount: seeds.length, directAccounts: keypairs.length });
  }, [seedAccountsCount, seeds.length, keypairs.length, onAccountsBreakdownChange]);

  // Relocated refresh control (design.md §8, the "further optimize round
  // 2") — `ChainwebPanel`'s icon row renders the actual button from this.
  useEffect(() => {
    onRefreshHandleChange?.({ refresh: activeRefresh, loading: activeLoading, error: !!activeError });
  }, [activeRefresh, activeLoading, activeError, onRefreshHandleChange]);

  // A full-screen view tied to one subTab (Codex/Watched) stops making sense
  // the moment the OTHER subTab is showing — close it on every switch. (The
  // SELECTION itself needs no such effect — see `selectedAddress`'s
  // derivation above, a pure per-render fallback rather than a reset.)
  useEffect(() => {
    setFullScreenAddress(null);
  }, [subTab]);

  // Per-row loading flag, sourced from whichever balance hook is active.
  const rowLoading = (addr: string) =>
    balanceMode === "urstoa" ? urLoading && !urByAddress[addr] : loading && !byAddress[addr];

  // MOBILE ONLY: resolve an address back to its full `AddrEntry` (+ watchId,
  // for the shared action row's Delete button) — shared by the selection
  // and full-screen lookups below.
  const findEntry = (address: string | null): AddrEntry | null => {
    if (!address) return null;
    for (const g of groups) {
      const e = g.entries.find((x) => x.address === address);
      if (e) return e;
    }
    const w = watchAddrs.find((x) => x.address === address);
    return w ? { address: w.address, sublabel: w.label || "", watchId: w.id } : null;
  };
  const selectedEntry = findEntry(selectedAddress);
  const selectedPublicKey = selectedEntry ? publicKeyOf(selectedEntry.address) : undefined;
  const selectedBal = selectedEntry ? byAddress[selectedEntry.address] : undefined;
  const selectedUrBal = selectedEntry ? urByAddress[selectedEntry.address] : undefined;
  const fullScreenEntry = findEntry(fullScreenAddress);

  const handleAddWatch = async () => {
    setWatchError(null);
    const addr = watchInput.trim();
    if (addr.length < 3 || !ADDR_PREFIXES.some((p) => addr.startsWith(p))) { setWatchError("Address must start with k: / u: / c: / w:."); return; }
    if (codexAddressSet.has(addr)) { setWatchError("That address is already a Codex account."); return; }
    if (watchEntries.some((w) => w.address === addr)) { setWatchError("Already watched."); return; }
    try {
      await addEntry({ id: globalThis.crypto.randomUUID(), label: "", address: addr, type: "stoa", createdAt: new Date().toISOString() });
      setWatchInput("");
    } catch (e) { setWatchError(e instanceof Error ? e.message : "Could not add."); }
  };

  // Mobile (docs/work/codex-ui-mobile/design.md §8, the "further optimize"
  // round): "we add the number on the left side [of ChainwebPanel's own
  // category icon row, via `onTotalChange` below, mirroring how Seeds'
  // count already relocated there], and we use a single line beneath. we
  // place the stoa ursota toggle aligned right, and the codex and watched
  // accounts aligned left. this way we gain more vertical space." The
  // "Total Addresses" card AND its own count are GONE entirely on mobile —
  // this is now ONE thin line: Codex/Watched (left) ... Stoa/UrStoa
  // (right). Refresh moved OFF this row entirely (owner correction, round
  // 2: "move the refresh button" up onto ChainwebPanel's own icon row — see
  // `onRefreshHandleChange` above). Desktop keeps the original two-block
  // layout (refresh included), byte-identical.
  // Owner correction (design.md §8, the "further optimize round 6"): "too
  // much space is wasted here... let's make the (Codex/Watched, Stoa/
  // UrStoa medallions) the same length so we can have symmetry." Both pill
  // groups now `flex: 1` (an equal, symmetric half of the row each) instead
  // of shrink-to-content — the shorter "Stoa/UrStoa" pair no longer floats
  // in a mostly-empty right half while "Codex N/Watched N" hugs the left.
  // Owner correction (design.md §8, the "further optimize round 7"): "we
  // have two stripe double button medallions, the codex/watched and stoa
  // urstoa... i would place this on top the upper border of the zone, half
  // in half out... would sit atop these 3 buttons [Seeds/Pure Keys/
  // Accounts]." Those medallions can only render from `ChainwebPanel`'s OWN
  // tree (only it shares an ancestor with the category icon row they dock
  // to) — driven through the `subTab`/`balanceMode` controlled-prop pair
  // above. Once driven externally, this component's OWN inline pill row is
  // redundant and hidden; omitted (every existing standalone use/test),
  // this still renders exactly as before.
  const drivenExternally = !!onSubTabChange;
  const summaryMobile = drivenExternally ? null : (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ display: "flex", flex: 1, borderRadius: 8, border: "1px solid #262626", overflow: "hidden" }}>
        {([["codex", "Codex", totalCodex], ["watch", "Watched", watchAddrs.length]] as const).map(([key, label, count]) => {
          const active = subTab === key;
          return (
            <button key={key} type="button" aria-pressed={active} onClick={() => setSubTab(key)}
              style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "4px 8px", fontSize: 11, fontWeight: 600, border: "none", cursor: "pointer", backgroundColor: active ? "#ceac5f" : "transparent", color: active ? "#0a0a0a" : "#888" }}>
              {label} <span style={{ fontSize: 10 }}>{count}</span>
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", flex: 1, borderRadius: 8, border: "1px solid #262626", overflow: "hidden" }}>
        {(["stoa", "urstoa"] as const).map((m) => {
          // Kadena mode (2026-09-26): "UrStoa" doesn't exist on real Kadena
          // mainnet (see the `activeNetwork` prop's own doc comment) — its
          // segment is disabled, and "Stoa" morphs into "Kadena" naming,
          // exactly per owner directive ("make the selector Stoa/Urstoa
          // disabled and morphed to Kadena in naming").
          const disabled = activeNetwork === "kadena" && m === "urstoa";
          const label = activeNetwork === "kadena" && m === "stoa" ? "Kadena" : m === "stoa" ? "Stoa" : "UrStoa";
          return (
            <button key={m} type="button" aria-pressed={balanceMode === m} disabled={disabled}
              onClick={() => { if (!disabled) setBalanceMode(m); }}
              style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "3px 9px", fontSize: 10, fontWeight: 600, border: "none", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.4 : 1, backgroundColor: balanceMode === m ? "#ceac5f" : "transparent", color: balanceMode === m ? "#0a0a0a" : "#888" }}>
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );

  // MOBILE ONLY — owner correction round 7: "the remainder of the control
  // buttons, 3 on stoa, 6 urstoa i would make then vertical buttons on the
  // side of the screen... for stoa, Transfer, Copy, Explorer, on the
  // right. For urstoa, Transfer copy explorer on the right, collect stake
  // unstake on the left." Round 8 follow-up — owner correction: "i think we
  // should add the 3 + 3 buttons on the lower bar... since on smaller
  // screen they are drawing on top of existing buttons/elements, and they
  // block view." Round 9 owner correction: "the buttons need to be on the
  // same level as the collapse expand medallion." Both stacks now dock to
  // the SAME seam that medallion straddles (`zone3AnchorTarget`'s own
  // bottom border — `bottom: 0` + `translateY(50%)`, the exact geometry
  // `ChainwebPanel`'s own `SeamMedallion` uses for `edge="bottom"`),
  // instead of an arbitrary `bottom: 12` near the tab bar. Falls back to
  // that previous fixed offset (still portaled to `fullScreenPortalTarget`)
  // when no `zone3AnchorTarget` is supplied. Same left/right grouping
  // (Stoa on the right; UrStoa's extra vault trio on the left) preserved,
  // same "tied to the SELECTED entry" gating. Nothing renders at all when
  // there's no entry to act on.
  const noSelection = !selectedEntry;
  // 2026-09-26: hidden in Kadena mode — signing/submitting against real
  // Kadena mainnet isn't wired yet (see `activeNetwork` prop's own doc
  // comment). Mirrors `AddressRow`'s own identical gate on its per-row
  // "Send STOA" button.
  const showSendSlot = !noSelection && !!selectedPublicKey && activeNetwork === "stoa";
  const showVaultSlots = showSendSlot && balanceMode === "urstoa";
  const edgeStackYPosition: React.CSSProperties = zone3AnchorTarget
    ? { bottom: 0, transform: "translateY(50%)" }
    : { bottom: 12 };
  const rightEdgeStack = !noSelection && (
    <div style={{ position: "absolute", right: 6, ...edgeStackYPosition, display: "flex", flexDirection: "row", gap: 8, zIndex: 5, pointerEvents: "auto" }}>
      {showSendSlot && (
        <button
          type="button"
          title={balanceMode === "urstoa" ? "Transfer UrStoa" : "Send STOA"}
          onClick={() => setMobileActiveModal(balanceMode === "urstoa" ? "transfer" : "send")}
          style={sharedActionBtnStyle(false)}
        >
          {balanceMode === "urstoa" ? <TransferGlyph style={sharedActionIconStyle} /> : <SendGlyph style={sharedActionIconStyle} />}
        </button>
      )}
      <IconCopyBtn text={selectedEntry.address} size={30} />
      <IconStoaExplorerBtn
        href={activeNetwork === "kadena" ? kadenaExplorerUrl(selectedEntry.address) : explorerUrl(selectedEntry.address)}
        network={activeNetwork === "kadena" ? "kadena" : "stoa"}
        size={30}
      />
      {selectedEntry.watchId && (
        <IconDeleteBtn onClick={() => { void deleteEntry(selectedEntry.watchId as string); setSelectedAddressState(null); }} size={30} />
      )}
    </div>
  );
  const leftEdgeStack = showVaultSlots && (
    <div style={{ position: "absolute", left: 6, ...edgeStackYPosition, display: "flex", flexDirection: "row", gap: 8, zIndex: 5, pointerEvents: "auto" }}>
      <ActionTooltip content={`Collect ${fmt12(selectedUrBal?.earnings ?? 0)} STOA in earned vault rewards.`}>
        <button type="button" title="Collect UrStoa earnings" onClick={() => setMobileActiveModal("collect")} style={sharedActionBtnStyle(false)}><CollectGlyph style={sharedActionIconStyle} /></button>
      </ActionTooltip>
      <ActionTooltip content={`Stake your liquid UrStoa into the vault. ${fmt12(selectedUrBal?.balance ?? 0)} UrStoa available.`}>
        <button type="button" title="Stake UrStoa" onClick={() => setMobileActiveModal("stake")} style={sharedActionBtnStyle(false)}><StakeGlyph style={sharedActionIconStyle} /></button>
      </ActionTooltip>
      <ActionTooltip content={`Unstake UrStoa from the vault. ${fmt12(selectedUrBal?.staked ?? 0)} UrStoa staked.`}>
        <button type="button" title="Unstake UrStoa" onClick={() => setMobileActiveModal("unstake")} style={sharedActionBtnStyle(false)}><UnstakeGlyph style={sharedActionIconStyle} /></button>
      </ActionTooltip>
    </div>
  );

  return (
    <div
      className={className}
      style={{
        fontFamily: "var(--codex-font, inherit)", color: "#d2d3d4", display: "flex", flexDirection: "column", gap: 16,
        position: isMobile ? "relative" : undefined,
        // MOBILE ONLY — bounds this component to whatever height its host
        // (`ChainwebPanel`'s own scroller) actually gives it, so the
        // measured/paginated entry area below can compute a real available
        // height instead of growing to fit its own content (which is
        // exactly the "fixed amount of entries per available area" engine
        // needs to work at all).
        height: isMobile ? "100%" : undefined,
        minHeight: isMobile ? 0 : undefined,
      }}
    >
      {/* MOBILE ONLY — the vertical edge button stacks (design.md §8, the
          "further optimize round 7"), portaled to the SAME whole-screen
          target the full-screen account detail uses so they dock to the
          actual screen edges (EdgeRail's own established convention) —
          falling back to this component's own (now `position: relative`)
          frame when no portal target is supplied. */}
      {isMobile && (
        <MobilePortal target={zone3AnchorTarget ?? fullScreenPortalTarget}>
          {rightEdgeStack}
          {leftEdgeStack}
        </MobilePortal>
      )}
      {isMobile ? (
        summaryMobile
      ) : (
        <>
          {/* Total Addresses */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 12, border: "1px solid #262626", backgroundColor: "#0a0a0a" }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#ceac5f20" }}>
              <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="#ceac5f" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round"><path d="M12 1.5 L22.5 12 L12 22.5 L1.5 12 Z" /><path d="M6.75 6.75 L17.25 17.25 M17.25 6.75 L6.75 17.25" /></svg>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "#888" }}>Total Addresses</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#d2d3d4" }}>{totalCodex + watchAddrs.length}</div>
            </div>
            <div style={{ flex: 1 }} />
            {/* Stoa / UrStoa balance-source toggle — morphs to Kadena-only
                when activeNetwork==="kadena" (see the prop's own doc
                comment: UrStoa has no Kadena-mainnet equivalent). */}
            <div style={{ display: "inline-flex", borderRadius: 8, border: "1px solid #262626", overflow: "hidden" }}>
              {(["stoa", "urstoa"] as const).map((m) => {
                const disabled = activeNetwork === "kadena" && m === "urstoa";
                const label = activeNetwork === "kadena" && m === "stoa" ? "Kadena" : m === "stoa" ? "Stoa" : "UrStoa";
                return (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={balanceMode === m}
                    disabled={disabled}
                    onClick={() => { if (!disabled) setBalanceMode(m); }}
                    style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "none", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.4 : 1, backgroundColor: balanceMode === m ? "#ceac5f" : "transparent", color: balanceMode === m ? "#0a0a0a" : "#888" }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {/* Live-chain status */}
            {activeLoading ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "#888" }}><RefreshCw style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> Reading balances…</span>
            ) : activeError ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "#c0392b" }}>⚠ Balance read failed</span>
            ) : (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "#4ade80" }}>✓ Live balances</span>
            )}
            <button type="button" onClick={activeRefresh} title="Refresh balances" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 6, border: "1px solid #262626", background: "transparent", color: "#888", cursor: "pointer", fontSize: 11 }}><RefreshCw style={{ width: 11, height: 11 }} /> Refresh</button>
          </div>

          {/* Codex / Watched toggle */}
          <div style={{ display: "flex", gap: 8 }}>
            {([["codex", "Codex Accounts", totalCodex], ["watch", "Watched Accounts", watchAddrs.length]] as const).map(([key, label, count]) => {
              const active = subTab === key;
              return (
                <button key={key} type="button" onClick={() => setSubTab(key)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", border: `1px solid ${active ? "#ceac5f" : "#262626"}`, backgroundColor: active ? "#ceac5f" : "#111", color: active ? "#0a0a0a" : "#888" }}>
                  {label}
                  <span style={{ fontSize: 11, padding: "0 7px", borderRadius: 9999, backgroundColor: active ? "#0a0a0a20" : "#262626", color: active ? "#0a0a0a" : "#555" }}>{count}</span>
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
                <span style={{ display: "inline-flex", alignItems: "center", padding: "0 10px", color: "#888" }}><Eye style={{ width: 16, height: 16 }} /></span>
                <input value={watchInput} onChange={(e) => setWatchInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void handleAddWatch(); }} placeholder="Watch a k: / u: / c: / w: address…"
                  style={{ flex: 1, minWidth: 0, padding: "8px 12px", borderRadius: 8, outline: "none", backgroundColor: "#0a0a0a", border: "1px solid #262626", color: "#d2d3d4", fontSize: 13, fontFamily: MONO }} spellCheck={false} />
                {/* Round 10 owner correction: "let's make the watch button a
                    new square button... with an eye on it, instead of a big
                    button with text, which clearly doesn't fit" — the old
                    text pill ("+ Watch") had no `flexShrink: 0` and could
                    get squeezed/overflow off the right edge on a narrow
                    screen next to the input's own `flex: 1`. A fixed-size
                    square icon button can never overflow that way. */}
                <button
                  type="button"
                  aria-label="Watch"
                  title="Watch"
                  onClick={() => void handleAddWatch()}
                  style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, width: 36, height: 36, borderRadius: 8, border: "none", backgroundColor: "#ceac5f", color: "#0a0a0a", cursor: "pointer" }}
                >
                  <Eye style={{ width: 16, height: 16 }} />
                </button>
              </div>
              {watchError && <p role="alert" style={{ flex: "none", fontSize: 12, color: "#c0392b", margin: 0 }}>{watchError}</p>}
            </>
          )}

          {/* The MEASURED, PAGINATED entry area (design.md §8, round 8
              follow-up — owner correction: "cant you do a fixed amount of
              entries per available area... an engine that detects how many
              slots per available area it has to work with"). `overflow:
              hidden`, never scrollable — a page is computed to fit EXACTLY,
              so "only whole entries, ever" holds by construction, not by a
              scroll mechanism re-enforcing it after the fact.
              Round 10 owner correction: "the lowest border of the entry
              relative to the border of the enclosing... wasn't being
              kept, it's smaller than what the rest of the border allows...
              we need to have the same separator everywhere. so there needs
              to be the same size of the border left right up and down."
              This `gap` MUST equal `ACCOUNT_ROW_GAP` — the exact constant
              `useSlotPageSize` uses to measure how many rows fit — or the
              REAL rendered spacing silently drifts from what the engine
              assumed, letting entries overflow the container by a few
              accumulated px per gap (the actual root cause behind "the
              engine to display entries doesn't work properly": entries
              looking cut after the available area changes size). Top/
              bottom `padding`, ALSO `ACCOUNT_ROW_GAP`, gives the top/
              bottom edges the SAME breathing room the gaps between entries
              already have — `useSlotPageSize`'s own `compute()` subtracts
              this same padding back out of the measured `clientHeight`
              before packing, so the two stay in lockstep. Round 15 owner
              correction split OUT the left/right padding into its own
              `ACCOUNT_ROW_SIDE_PADDING` — see `ACCOUNT_ROW_GAP`'s own doc
              comment for why the two no longer need to match. */}
          <div
            ref={accountsPageContainerRef}
            data-testid="stoa-accounts-page-surface"
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
              Round 20 — a real two-PANE track: `dragDirection === null`
              renders exactly the current page (byte-identical to before);
              once a direction locks in, the ADJACENT page mounts as a
              second same-width pane immediately beside it (`"prev"` comes
              BEFORE the current pane, `"next"` comes AFTER), and the
              track's own base offset shifts by exactly one pane's measured
              width so the current page still starts out fully in view —
              `translateX(dragX)` (still the SAME live/settling value as
              round 18) then slides BOTH panes together, genuinely
              revealing the incoming page as the outgoing one leaves,
              instead of a blank gap. */}
          <div
            data-testid="stoa-accounts-page-swipe-track"
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

          {/* Prev/Next — owner correction (design.md §8, round 8 follow-up):
              "there is the pagination problem, what if a codex has hundreds
              of seeds and thousand of chainweb accounts? then not
              paginating here would be very irresponsible." Mirrors
              `OuronetAccountsTab`'s own Prev/Next styling.
              Round 9/11 — "standard pagination controls zone": rendered
              INLINE only for a standalone mount with no
              `onPaginationHandleChange` wired at all — every other case
              reports its handle to `ChainwebPanel` instead, which renders
              the shared medallion version (round 11: ALWAYS free now that
              Collapse-All no longer exists on mobile). */}
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
          {groups.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px 0", borderRadius: 12, border: "1px dashed #262626", color: "#555", fontSize: 14 }}>No Stoa accounts in the codex.</div>
          ) : (
            <>
              {groups.map((g) => (
              <GroupRow
                key={g.id}
                name={g.name}
                color={g.color}
                count={g.entries.length}
              >
                {g.entries.map((e) => (
                  <AddressRow
                    key={e.address}
                    entry={e}
                    bal={byAddress[e.address]}
                    urBal={urByAddress[e.address]}
                    mode={balanceMode}
                    activeNetwork={activeNetwork}
                    loading={rowLoading(e.address)}
                    onActionSuccess={activeRefresh}
                    selected={selectedAddress === e.address}
                    onSelect={() => setSelectedAddressState(e.address)}
                    onExpand={() => setFullScreenAddress(e.address)}
                  />
                ))}
              </GroupRow>
              ))}
            </>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Add watched address */}
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ display: "inline-flex", alignItems: "center", padding: "0 10px", color: "#888" }}><Eye style={{ width: 16, height: 16 }} /></span>
            <input value={watchInput} onChange={(e) => setWatchInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void handleAddWatch(); }} placeholder="Watch a k: / u: / c: / w: address…"
              style={{ flex: 1, padding: "8px 12px", borderRadius: 8, outline: "none", backgroundColor: "#0a0a0a", border: "1px solid #262626", color: "#d2d3d4", fontSize: 13, fontFamily: MONO }} spellCheck={false} />
            <button type="button" onClick={() => void handleAddWatch()} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600, border: "none", backgroundColor: "#ceac5f", color: "#0a0a0a", cursor: "pointer" }}><Plus style={{ width: 16, height: 16 }} /> Watch</button>
          </div>
          {watchError && <p role="alert" style={{ fontSize: 12, color: "#c0392b", margin: 0 }}>{watchError}</p>}

          {watchAddrs.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px 0", borderRadius: 12, border: "1px dashed #262626", color: "#555" }}>
              <Eye style={{ width: 24, height: 24, opacity: 0.4 }} />
              <p style={{ fontSize: 14, margin: "8px 0 0" }}>No watched addresses.</p>
            </div>
          ) : (
            watchAddrs.map((w) => (
              <AddressRow
                key={w.id}
                entry={{ address: w.address, sublabel: w.label || "", watchId: w.id }}
                bal={byAddress[w.address]}
                urBal={urByAddress[w.address]}
                mode={balanceMode}
                activeNetwork={activeNetwork}
                loading={rowLoading(w.address)}
                onRemove={() => void deleteEntry(w.id)}
                onRelabel={(label) => void addEntry({ ...w, label })}
                onActionSuccess={activeRefresh}
                selected={selectedAddress === w.address}
                onSelect={() => setSelectedAddressState(w.address)}
                onExpand={() => setFullScreenAddress(w.address)}
              />
            ))
          )}
        </div>
      )}

      {/* MOBILE ONLY — the shared action row's own modals (design.md §8,
          the "further optimize round 2"), keyed off `selectedEntry` rather
          than any one row (desktop's own per-row modals, inside
          `AddressRow`, are untouched — this is an ADDITIONAL mount, not a
          replacement). */}
      {selectedEntry && selectedPublicKey && (
        <>
          {/* Round 10 owner correction: "the buttons, stake unstake collect
              transfer, must expand on the full screen, and once executed,
              they get out of the full screen." `fullScreenPortalTarget`
              makes each modal's own `CodexModalShell` (which already flips
              to a full-bleed sheet on mobile) resolve its `position:
              absolute` against the whole mobile body instead of this
              component's own Zone-3-bounded frame. Each modal's existing
              `onSuccess?.(...); onClose();` already returns it to the
              normal view once the action completes — unchanged here. */}
          <TransferUrStoaModal isOpen={mobileActiveModal === "transfer"} onClose={() => setMobileActiveModal(null)} publicKey={selectedPublicKey} address={selectedEntry.address} onSuccess={activeRefresh} fullScreenPortalTarget={fullScreenPortalTarget} />
          <StakeUrStoaModal isOpen={mobileActiveModal === "stake"} onClose={() => setMobileActiveModal(null)} publicKey={selectedPublicKey} address={selectedEntry.address} onSuccess={activeRefresh} fullScreenPortalTarget={fullScreenPortalTarget} />
          <UnstakeUrStoaModal isOpen={mobileActiveModal === "unstake"} onClose={() => setMobileActiveModal(null)} publicKey={selectedPublicKey} address={selectedEntry.address} onSuccess={activeRefresh} fullScreenPortalTarget={fullScreenPortalTarget} />
          <CollectUrStoaModal isOpen={mobileActiveModal === "collect"} onClose={() => setMobileActiveModal(null)} publicKey={selectedPublicKey} address={selectedEntry.address} onSuccess={activeRefresh} fullScreenPortalTarget={fullScreenPortalTarget} />
          <SendStoaModal isOpen={mobileActiveModal === "send"} onClose={() => setMobileActiveModal(null)} publicKey={selectedPublicKey} address={selectedEntry.address} senderChainBalance={selectedBal?.perChain[STOACHAIN_CHAIN_ID]?.balance} onSuccess={activeRefresh} fullScreenPortalTarget={fullScreenPortalTarget} />
        </>
      )}

      {/* MOBILE ONLY — the full-screen per-chain breakdown (a second tap on
          an already-selected row). */}
      {fullScreenEntry && (
        <MobilePortal target={fullScreenPortalTarget}>
          <MobileAddressFullScreen
            entry={fullScreenEntry}
            bal={byAddress[fullScreenEntry.address]}
            urBal={urByAddress[fullScreenEntry.address]}
            mode={balanceMode}
            onClose={() => setFullScreenAddress(null)}
            onRelabel={fullScreenEntry.watchId ? (label) => {
              const w = watchEntries.find((x) => x.id === fullScreenEntry.watchId);
              if (w) void addEntry({ ...w, label });
            } : undefined}
            chainSort={chainSort}
            onToggleChainSort={() => setChainSort((s) => (s === "amount" ? "number" : "amount"))}
            activeNetwork={activeNetwork}
          />
        </MobilePortal>
      )}
    </div>
  );
}

export default StoaAccountsTab;
