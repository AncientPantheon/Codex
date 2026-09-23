/**
 * SeedWordsTab — 1:1 clone of OuronetUI's My Codex "Seed Words" tab
 * (src/components/settings/SeedWordsList.tsx + the Create-New-Seed control),
 * rebuilt Redux-free over the package store.
 *
 * Full surface: a "Create New Seed" button (→ CreateStoaChainSeedModal); each seed
 * row is expandable to reveal its derived keys; per key a Copy + Delete button
 * (the Prime seed's Key #0 delete is disabled); "Add Consecutive Key"
 * (gap-fills the lowest free index) and "Add Key at Position" (arbitrary index,
 * dup-guarded). View-mnemonic / rename / delete-seed live in a per-row menu.
 *
 * Key derivation mirrors My Codex exactly:
 *   getCurrentPassword() → smartDecrypt(seed.secret) → StoaChainWalletBuilder
 *   .createWalletPairFromMnemonic(password, mnemonic, index, seedType); the new
 *   key is persisted by replacing the whole seed via updateSeed({...seed,accounts}).
 * Styled with the original's hardcoded hex palette (matches OuronetAccountsTab).
 */

import { useState, useRef, useMemo, useEffect, Fragment } from "react";
import { createPortal } from "react-dom";
import {
  Lock, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, MoreVertical, Key, Eye, Edit2, Trash2, Plus, Hash, PlusCircle, Check, X, Loader2, ArrowLeftRight, Copy,
} from "lucide-react";
import { smartDecrypt } from "@stoachain/stoa-core/crypto";
import { KadenaWalletBuilder as StoaChainWalletBuilder } from "@stoachain/stoa-core/wallet";
import { binToHex } from "@stoachain/kadena-stoic-legacy/cryptography-utils";
import { useIsMobile } from "@ancientpantheon/codex-ui/ui";
import { useStoaChainSeeds } from "../../hooks/index.js";
import { useCodexAuth } from "../../hooks/index.js";
import { useEnsureCodexUnlocked } from "../../zbom/hooks/useEnsureCodexUnlocked.js";
import { IconCopyBtn, IconDeleteBtn, IconDeleteBtnDisabled, IconHideBtn } from "../internal/IconButtons.js";
import { KeyFieldsHalves } from "../internal/KeyFieldsHalves.js";
import { MeasuredHexHighlight } from "../internal/StoaAddressHighlight.js";
import { CreateStoaChainSeedModal } from "../internal/CreateStoaChainSeedModal.js";
import { CodexModalShell } from "../internal/CodexModalShell.js";
import { DalosSecretReveal } from "../internal/DalosSecretReveal.js";
import { deriveStoaDalosKeypairAtIndex } from "../../wallet/stoaDalosKeygen.js";
import type { IStoaChainSeed, SeedType, WalletAccount } from "../../types/entities.js";

/** Portals `children` into `target` when supplied (a DOM node spanning the
 *  host's WHOLE mobile body — see `SeedWordsTabProps.fullScreenPortalTarget`'s
 *  doc comment); otherwise renders inline, unchanged. A tiny wrapper purely to
 *  avoid duplicating the (long) `CodexModalShell` JSX it wraps across both
 *  branches of a `target ? createPortal(...) : ...` ternary. */
function MobilePortal({ target, children }: { target?: Element | null; children: React.ReactNode }) {
  return target ? createPortal(children, target) : <>{children}</>;
}

/** Fallback px height of one seed row, used only before the first real row
 *  has mounted/measured — see `useMobileSeedPageSize`'s `rowRef`. Round 24:
 *  trimmed alongside the mobile row's own padding cut (52px → ~40px real
 *  row height) so a stale fallback doesn't under-pack the very first paint. */
const SEED_ROW_HEIGHT_FALLBACK = 44;
const SEED_ROW_GAP = 6;

/**
 * Seeds pagination (docs/work/codex-ui-mobile/design.md §8, the "optimize
 * each blockchain and tab" round: "we need to add pagination to the seeds
 * as well, similar to what we did with the Ouronet accounts") — MEASURED,
 * not a fixed count (round 8 follow-up — owner correction: "we need [the]
 * same pagination... at the seeds level"; a fixed `SEEDS_PER_PAGE = 12`
 * this hook replaces wasted space on a tall screen and could still overflow
 * on a short one). Mirrors `OuronetAccountsTab`'s own `useMobilePageSize`
 * exactly: live-measure a real row via `rowRef`, live-measure the
 * container via `containerRef`, `Math.floor((height + GAP) / (rowHeight +
 * GAP))`.
 *
 * Round 8 follow-up — owner correction: "the prime seed must be
 * differentiated only via colour on mobile... if we remove the separator,
 * [more] entries would have fit": `PrimeSeparator` (the "Other Seeds"
 * divider) is now DESKTOP-ONLY (see its own render site below) — mobile
 * already differentiates the prime seed by colour alone, so there is no
 * more page-0-only deduction to account for here at all; every page
 * (including page 0) uses this SAME plain measured `pageSize`.
 */
function useMobileSeedPageSize(): {
  containerRef: React.RefObject<HTMLDivElement | null>;
  rowRef: (node: HTMLDivElement | null) => void;
  pageSize: number;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const [rowEl, setRowEl] = useState<HTMLDivElement | null>(null);
  const [rowHeight, setRowHeight] = useState(SEED_ROW_HEIGHT_FALLBACK);
  const [pageSize, setPageSize] = useState(4);

  useEffect(() => {
    if (!rowEl) return;
    const measure = () => {
      const h = rowEl.getBoundingClientRect().height;
      if (h > 0) setRowHeight(h);
    };
    measure();
    // Owner-reported live bug (round 9): "the next button to change page
    // doesn't work, and i can clearly see that 4 entries would fit, so why
    // aren't there 4 entries there?" A `ResizeObserver` only fires again
    // once the row's OWN size later changes — it does NOT protect against
    // the row's size being read WRONG on this very first pass (e.g. before
    // a web font swaps in and reflows the row a few ms after mount, or
    // before the host shell's own riser/anchor wiring finishes settling
    // one frame later). A single `requestAnimationFrame` + `document.fonts`
    // follow-up re-measure catches either without waiting for an actual
    // resize event that may never come.
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
      // and down": the container carries `padding: SEED_ROW_GAP` on every
      // side on mobile (see its own JSX comment); `clientHeight` counts
      // that as part of the box, so subtract it back out here — harmless
      // on desktop too, which never reads `pageSize` at all.
      const height = el.clientHeight - 2 * SEED_ROW_GAP;
      if (height <= 0) return;
      const maxRows = Math.floor((height + SEED_ROW_GAP) / (rowHeight + SEED_ROW_GAP));
      setPageSize(Math.max(1, maxRows));
    };
    compute();
    // Same "don't trust the very first reading alone" reasoning as the row
    // measurement above, PLUS a `window` resize listener — an orientation
    // change or on-screen-keyboard dismissal changes the container's real
    // available height without necessarily firing this element's OWN
    // `ResizeObserver` in every host environment.
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

  return { containerRef, rowRef: setRowEl, pageSize };
}

const MONO = "var(--codex-font-mono, 'JetBrains Mono', ui-monospace, monospace)";

/** A codex with hundreds of seeds can genuinely paginate into double
 *  digits — owner correction (design.md §8, round 8 follow-up): "when
 *  there are more than 10 pages available the entry 15/24 when clicked
 *  needs to allow the input of a given page, to jump directly to a wanted
 *  page." Below 10 pages, the plain "N / M" text is unchanged. Duplicated
 *  from `StoaAccountsTab`'s identical component per this package's own
 *  "self-contained module" convention. */
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

// Chainweaver and EckoWallet are the same wallet at the crypto level (see
// CreateStoaChainSeedModal.tsx), so both keys render the same unified badge —
// this is a display-only lookup, not a selector; both values must stay valid
// so a legacy seed persisted as "eckowallet" still renders correctly.
const SEED_COLORS: Record<SeedType, { label: string; color: string; bg: string }> = {
  koala: { label: "Koala", color: "#ec4899", bg: "#4a1035" },
  chainweaver: { label: "Chainweaver / EckoWallet", color: "#3b82f6", bg: "#1e3a5f" },
  eckowallet: { label: "Chainweaver / EckoWallet", color: "#3b82f6", bg: "#1e3a5f" },
  // Stoic reuses the user's existing Ouronet (DALOS) seed rather than a
  // fresh StoaChain mnemonic — its own color, distinct from koala/chainweaver.
  stoic: { label: "Stoa Dalos", color: "#eab308", bg: "#3f2f04" },
};
const normalizeSeedType = (raw: string | undefined): SeedType =>
  raw === "koala" || raw === "chainweaver" || raw === "eckowallet" || raw === "stoic" ? raw : "chainweaver";

const derivationPath = (i: number) => `m'/44'/626'/${i}'`;

/** Key derivation (BIP39 PBKDF2 / Chainweaver) is CPU-heavy and BLOCKS the main
 *  thread, so the progress indicator's animation must run on the compositor —
 *  i.e. use `transform` (translateX / rotate) only, which keeps animating even
 *  while JS is blocked. We inject the keyframes once. The stage labels are
 *  painted (via a double-rAF yield) BEFORE each heavy step starts. */
const KEYFRAME_ID = "codex-seed-derive-keyframes";
if (typeof document !== "undefined" && !document.getElementById(KEYFRAME_ID)) {
  const el = document.createElement("style");
  el.id = KEYFRAME_ID;
  el.textContent =
    "@keyframes codex-derive-sweep{0%{transform:translateX(-130%)}100%{transform:translateX(340%)}}" +
    "@keyframes codex-seed-spin{to{transform:rotate(360deg)}}";
  document.head.appendChild(el);
}

/** Resolve after the browser has had a chance to paint (two animation frames),
 *  so a stage label + the compositor animation are live before the next
 *  (potentially main-thread-blocking) derivation step runs. */
const nextPaint = (): Promise<void> =>
  new Promise((res) => {
    if (typeof requestAnimationFrame === "undefined") { setTimeout(res, 0); return; }
    requestAnimationFrame(() => requestAnimationFrame(() => res()));
  });

/** Animated "deriving" indicator. Spinner = rotate transform, sweep bar =
 *  translateX transform — both compositor-driven, so they keep moving while the
 *  derivation blocks the main thread. */
function DerivingBar({ index, stage }: { index: number; stage: string }) {
  return (
    <div style={{ marginTop: 8, padding: "10px 12px", borderRadius: 10, border: "1px solid #ceac5f40", backgroundColor: "#ceac5f0a" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Loader2 style={{ width: 14, height: 14, color: "#ceac5f", animation: "codex-seed-spin 0.9s linear infinite" }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: "#ceac5f" }}>Deriving Key #{index}</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "#888" }}>{stage}</span>
      </div>
      <div style={{ position: "relative", height: 6, borderRadius: 9999, overflow: "hidden", backgroundColor: "#1f1f1f" }}>
        <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: "38%", borderRadius: 9999, background: "linear-gradient(90deg, transparent, #ceac5f, transparent)", animation: "codex-derive-sweep 1.05s ease-in-out infinite", willChange: "transform" }} />
      </div>
    </div>
  );
}

export interface SeedWordsTabProps {
  className?: string;
  /**
   * Controlled "Create New Seed" open state (docs/work/codex-ui-mobile/
   * design.md §8, the "optimize each blockchain and tab" round): "here on
   * the seed button we could show the seed number aligned on the icon
   * button bar to the left, and the add seed as a plus button appearing
   * aligned on the right" — that "+" trigger lives in `ChainwebPanel`'s own
   * mobile category row (a SIBLING of this component, not a descendant),
   * which therefore needs to drive the create-modal `SeedWordsTab` owns.
   * Both optional — omitted, this component falls back to its own internal
   * `useState` (the original, fully self-contained behavior desktop still
   * uses).
   */
  createOpen?: boolean;
  onCreateOpenChange?: (open: boolean) => void;
  /**
   * MOBILE ONLY — a DOM node spanning the host's WHOLE mobile body, via
   * `createPortal` — owner correction (design.md §8, the "further optimize
   * round 3"): "when I say full screen from now on, I mean a full screen
   * extension, not extending in its zone... same when expanding the seeds
   * they need to come full screen." Without it, the mobile seed-detail
   * `CodexModalShell` below resolves its `position: absolute` against the
   * nearest `CodexUiRoot` ancestor (Zone 3's own), so it's bounded to Zone
   * 3's rectangle instead of covering the whole screen. Omitted (the
   * default) falls back to that bounded behavior, same as every other
   * `CodexModalShell` caller in this codebase without a portal target.
   */
  fullScreenPortalTarget?: Element | null;
  /**
   * Reports the seed-list's OWN pagination state so `ChainwebPanel` can
   * render it in the shared "middle of the bottom seam" medallion slot —
   * round 9 owner correction: "we also need to agree on a standard
   * pagination controls zone. If no expand collapse medallion exists at
   * the middle of the bottom page... that's where the pagination controls
   * should be in their own medallion." The Seeds view NEVER has a
   * Collapse-All medallion of its own ("there is no expand collapse
   * button, clicking seed brings its content full screen"), so once a
   * caller supplies this, it's the ONLY place pagination surfaces — same
   * "controlled prop with internal-state fallback" pattern this file's own
   * `createOpen`/`onCreateOpenChange` already uses: omitted (every
   * standalone mount, including every pre-round-9 test), this component
   * keeps rendering its OWN inline/portaled Prev/Next exactly as before
   * this prop existed.
   */
  onPaginationHandleChange?: (
    handle: { page: number; totalPages: number; onPrev: () => void; onNext: () => void; onJump: (page: number) => void } | null,
  ) => void;
}

/* ─── Key row ─── */
function KeyRow({
  account, seedId, isPrimeFirstKey, onDelete, decrypt,
}: {
  account: WalletAccount;
  seedId: string;
  isPrimeFirstKey: boolean;
  onDelete: (seedId: string, index: number) => void;
  /** Re-derives this key's private (secret) key from the seed mnemonic. */
  decrypt: () => Promise<string>;
}) {
  // MOBILE (design.md §8, the "further optimize round 4" — owner
  // correction: "make correct rectangles for each entry"): a proper
  // bordered card per key, matching the same card convention every other
  // mobile entry list in this app already uses (`AddressRow`'s own
  // `data-stoa-address` card, etc.). Desktop stays a plain unbordered row.
  const isMobile = useIsMobile();
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: isMobile ? "8px 10px" : "6px 8px",
        borderRadius: isMobile ? 12 : 8,
        border: isMobile ? "1px solid #262626" : "none",
        backgroundColor: isMobile ? "#18181B" : "transparent",
        scrollSnapAlign: isMobile ? "start" : undefined,
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0, width: 64 }}>
        <Key style={{ width: 14, height: 14, flexShrink: 0, color: "#555" }} />
        <span style={{ fontSize: 12, fontWeight: 500, color: "#888", whiteSpace: "nowrap" }}>Key #{account.index}</span>
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <KeyFieldsHalves publicKey={account.publicKey} decryptPrivate={decrypt} />
      </div>
      {isPrimeFirstKey
        ? <IconDeleteBtnDisabled size={28} title="Cannot delete first key of Prime seed" />
        : <IconDeleteBtn onClick={() => onDelete(seedId, account.index)} size={28} />}
    </div>
  );
}

/** PositionMedallion — a round "#N" badge (design.md §8, the "further
 *  optimize round 5" — owner correction: "instead of Key 1, we simply use a
 *  round medallion with #1. if the number is too big, for example #7723
 *  then we'd use an elongated round medallion, that has the same semicircle
 *  on its ends"). A FIXED height + `borderRadius: 9999` does both shapes
 *  for free: short labels ("#0"–"#99") sit at/near the `minWidth` floor and
 *  read as a circle; once the label's own content pushes past that floor
 *  ("#7723"), the box simply grows sideways — `borderRadius: 9999` still
 *  caps at half the (unchanged) height on each end, so it elongates into a
 *  stadium/pill with the SAME semicircle ends, never a plain rounded
 *  rectangle. */
function PositionMedallion({ index, selected }: { index: number; selected: boolean }) {
  return (
    <div
      style={{
        flexShrink: 0, minWidth: 32, height: 32, padding: "0 8px", borderRadius: 9999,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontWeight: 700, fontFamily: MONO,
        color: selected ? "#ceac5f" : "#888",
        backgroundColor: selected ? "#ceac5f22" : "#26262680",
        border: selected ? "2px solid #ceac5f" : "1px solid #333",
        boxShadow: selected ? "0 0 10px #ceac5f66" : "none",
        transition: "all 0.15s",
      }}
    >
      #{index}
    </div>
  );
}

/** MobileKeyRow — the mobile full-screen key-detail view's own row (design.md
 *  §8, the "further optimize round 5" — owner correction: "we present a
 *  single row of buttons beneath the title... by default the first position
 *  is the selected one"). No per-row buttons/switcher anymore — those moved
 *  to ONE shared row above the list, tied to whichever row is SELECTED
 *  (same "consolidate per-entry buttons into a shared row" pattern
 *  `StoaAccountsTab`'s own `AddressRow`/shared action row already
 *  established). A tap selects; the selected row's medallion lights up. */
function MobileKeyRow({
  account, selected, onSelect, showPrivate, privValue,
}: {
  account: WalletAccount;
  selected: boolean;
  onSelect: () => void;
  /** Whether the shared switcher is currently on "private" — only visually
   *  relevant for the SELECTED row. */
  showPrivate: boolean;
  /** The selected key's cached decrypted private value, if revealed yet. */
  privValue?: string;
}) {
  const showingPrivate = selected && showPrivate && !!privValue;
  const value = showingPrivate ? (privValue as string) : account.publicKey;
  const color = showingPrivate ? "#f59e0b" : "#c0c0c0";
  return (
    <div
      onClick={onSelect}
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", cursor: "pointer",
        borderRadius: 12, border: `1px solid ${selected ? "#ceac5f" : "#262626"}`,
        backgroundColor: "#18181B", scrollSnapAlign: "start",
      }}
    >
      <PositionMedallion index={account.index} selected={selected} />
      <MeasuredHexHighlight
        value={value}
        baseColor={color}
        edgeColor={showingPrivate ? color : "#eab308"}
        style={{ flex: 1, minWidth: 0, fontFamily: MONO, fontSize: 12 }}
      />
    </div>
  );
}

/* ─── Per-seed actions menu (View / Rename / Delete) ─── */
function SeedActions({
  isPrime, onView, onRename, onDelete,
}: {
  isPrime: boolean;
  onView: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  // Menu is anchored to the viewport (position: fixed) so it escapes the seed
  // row's `overflow: hidden` clip — otherwise the dropdown renders *inside* the
  // rounded rectangle and its items can't be clicked.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const item: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 12px",
    background: "transparent", border: "none", cursor: "pointer", fontSize: 13, textAlign: "left",
  };
  const toggle = () => {
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    }
    setOpen((v) => !v);
  };
  return (
    <span onClick={(e) => e.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Seed actions"
        onClick={toggle}
        style={{ width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 8, background: "transparent", border: "none", cursor: "pointer" }}
      >
        <MoreVertical style={{ width: 16, height: 16, color: "#888" }} />
      </button>
      {/* Round 22 owner correction: "clicking the triple point makes the
          menu appear in the wrong place." Root cause: round 21's swipe
          carousel wraps every row in a `transform: translateX(...)`
          ancestor (the swipe track) — even at rest (`translateX(0px)`), a
          non-`none` `transform` on an ancestor makes THAT ancestor the
          containing block for any `position: fixed` descendant instead of
          the viewport (CSS Transforms spec), so `pos` (computed viewport-
          relative via `getBoundingClientRect`) landed nowhere near the
          trigger. Portaling straight to `document.body` — same fix
          `MobilePortal` already applies for the row's own `overflow:
          hidden` clip, just against a DIFFERENT ancestor hazard — guarantees
          the popup always renders outside ANY transformed tree, regardless
          of what the swipe carousel is doing. */}
      {open && createPortal(
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 1000 }} />
          <div style={{ position: "fixed", top: pos.top, right: pos.right, zIndex: 1001, width: 176, padding: "4px 0", borderRadius: 8, backgroundColor: "#1f1f1f", border: "1px solid #262626", boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
            <button type="button" style={{ ...item, color: "#d2d3d4" }} onClick={() => { setOpen(false); onView(); }}>
              <Eye style={{ width: 16, height: 16 }} /> View Seed Words
            </button>
            {!isPrime && (
              <>
                <button type="button" style={{ ...item, color: "#d2d3d4" }} onClick={() => { setOpen(false); onRename(); }}>
                  <Edit2 style={{ width: 16, height: 16 }} /> Rename
                </button>
                <div style={{ height: 1, backgroundColor: "#919eab3d", margin: "4px 0" }} />
                <button type="button" style={{ ...item, color: "#c0392b" }} onClick={() => { setOpen(false); onDelete(); }}>
                  <Trash2 style={{ width: 16, height: 16 }} /> Delete
                </button>
              </>
            )}
          </div>
        </>,
        document.body,
      )}
    </span>
  );
}

/* ─── Seed row ─── */
/** A labeled divider between the prime seed and the rest. */
function PrimeSeparator({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "2px 0" }}>
      <div style={{ flex: 1, height: 1, backgroundColor: "#262626" }} />
      <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#555" }}>{label}</span>
      <div style={{ flex: 1, height: 1, backgroundColor: "#262626" }} />
    </div>
  );
}

function SeedRow({
  seed, index, expanded, onToggle, onRename, onDeleteSeed, onAddKey, onDeleteKey, fullScreenPortalTarget,
}: {
  seed: IStoaChainSeed;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  onRename: (seed: IStoaChainSeed, name: string) => void;
  onDeleteSeed: (id: string) => void;
  onAddKey: (seed: IStoaChainSeed, index: number, onStage?: (s: string) => Promise<void> | void) => Promise<void>;
  onDeleteKey: (seed: IStoaChainSeed, index: number) => void;
  /** MOBILE ONLY — see `SeedWordsTabProps.fullScreenPortalTarget`'s own doc
   *  comment; threaded straight through to this row's own full-screen popup. */
  fullScreenPortalTarget?: Element | null;
}) {
  const { getCurrentPassword } = useCodexAuth();
  const ensureUnlocked = useEnsureCodexUnlocked();
  const isMobile = useIsMobile();
  const isPrime = seed.isPrime === true || index === 0;
  const displayName = isPrime ? "Prime Codex Seed" : seed.name || `Seed #${index + 1}`;
  const cfg = SEED_COLORS[normalizeSeedType(seed.seedType)];

  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(displayName);
  const [phrase, setPhrase] = useState<string | null>(null);
  /** Round 22/23 owner correction (asked repeatedly): the DECRYPTED real
   *  words, when this `"stoic"` seed actually has a `wordsSecret` (see its
   *  own doc comment on `IStoaChainSeed`) — `null` for every OTHER seed
   *  type (their `phrase` above already IS the mnemonic) and for a stoic
   *  seed genuinely persisted with no words behind it. */
  const [stoicWords, setStoicWords] = useState<string | null>(null);
  const [showCustomPos, setShowCustomPos] = useState(false);
  const [customIndex, setCustomIndex] = useState("");
  const [rowError, setRowError] = useState<string | null>(null);
  const [deriving, setDeriving] = useState<{ index: number; stage: string } | null>(null);
  // MOBILE ONLY (design.md §8, the "further optimize round 5") — the
  // shared key-detail selection state: which position is selected (an
  // explicit choice, or `null` — falls back to the FIRST position, same
  // "always a default selection" derivation `StoaAccountsTab` already
  // uses), whether the shared switcher is showing that position's private
  // key, a per-index decrypt cache (so re-selecting an already-revealed
  // position doesn't re-decrypt), and the switcher's own busy/copied state.
  const [selectedKeyIndexState, setSelectedKeyIndexState] = useState<number | null>(null);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [privCache, setPrivCache] = useState<Record<number, string>>({});
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);

  const sortedAccounts = [...seed.accounts].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const selectedKeyIndex =
    selectedKeyIndexState !== null && sortedAccounts.some((a) => a.index === selectedKeyIndexState)
      ? selectedKeyIndexState
      : (sortedAccounts[0]?.index ?? null);
  const selectedAccount = sortedAccounts.find((a) => a.index === selectedKeyIndex) ?? null;

  const selectKey = (idx: number) => {
    setSelectedKeyIndexState(idx);
    setShowPrivateKey(false);
  };

  const toggleKeySwitch = async () => {
    if (!selectedAccount) return;
    if (!showPrivateKey && privCache[selectedAccount.index] === undefined) {
      setRowError(null);
      setKeyBusy(true);
      try {
        const pk = await revealPrivateKey(selectedAccount)();
        setPrivCache((prev) => ({ ...prev, [selectedAccount.index]: pk }));
      } catch {
        setRowError("Unlock the codex to view the private key.");
        setKeyBusy(false);
        return;
      }
      setKeyBusy(false);
    }
    setShowPrivateKey((v) => !v);
  };

  const copyCurrentKey = async () => {
    if (!selectedAccount) return;
    setRowError(null);
    if (showPrivateKey) {
      try {
        const pk = privCache[selectedAccount.index] ?? (await revealPrivateKey(selectedAccount)());
        if (privCache[selectedAccount.index] === undefined) setPrivCache((prev) => ({ ...prev, [selectedAccount!.index]: pk }));
        void navigator.clipboard.writeText(pk).catch(() => {});
      } catch { setRowError("Unlock the codex to copy the private key."); return; }
    } else {
      void navigator.clipboard.writeText(selectedAccount.publicKey).catch(() => {});
    }
    setKeyCopied(true);
    setTimeout(() => setKeyCopied(false), 1200);
  };

  const commitRename = () => {
    if (draftName.trim() && draftName.trim() !== displayName) onRename(seed, draftName.trim());
    setRenaming(false);
  };

  const handleView = async () => {
    setRowError(null);
    if (phrase) { setPhrase(null); setStoicWords(null); return; }
    // Prompt for the codex password if locked. Without this, getCurrentPassword()
    // throws CodexLockedError → the catch sets rowError, but rowError only renders
    // inside the {expanded} block, so on a collapsed row the click does nothing
    // visible. The sibling reveal paths (revealPrivateKey / handleAddKey) gate the
    // same way.
    if (!(await ensureUnlocked())) { setRowError("Unlock the codex to view this seed phrase."); return; }
    try {
      const plain = await smartDecrypt(seed.secret, getCurrentPassword());
      setPhrase(plain);
      // Round 22/23: decrypt the SEPARATE `wordsSecret` envelope too, when
      // this seed has one (only ever set for `"stoic"` seeds created after
      // this field existed, with real words in hand at creation time — see
      // `IStoaChainSeed.wordsSecret`'s own doc comment). A decrypt failure
      // here is swallowed on purpose: `phrase` (the bitstring) already
      // decrypted successfully with the SAME password, so a `wordsSecret`
      // failure would mean corrupt/foreign ciphertext, not a wrong
      // password — falling back to the bitstring-only view rather than
      // blocking the reveal the user already unlocked for.
      if (seed.seedType === "stoic" && seed.wordsSecret) {
        try {
          setStoicWords(await smartDecrypt(seed.wordsSecret, getCurrentPassword()));
        } catch {
          setStoicWords(null);
        }
      } else {
        setStoicWords(null);
      }
    } catch {
      setRowError("Unlock the codex to view this seed phrase.");
    }
  };

  const nextConsecutive = () => {
    const set = new Set(seed.accounts.map((a) => a.index));
    let i = 0;
    while (set.has(i)) i++;
    return i;
  };

  /** Re-derive a key's RAW private key on demand — never stored; derived from
   *  the seed mnemonic at the key's index (unlock-gated). Returns the CANONICAL
   *  export-format private key, matching Chainweaver / kadenakeys.io exports.
   *
   *  Crucial subtlety for the two seed families:
   *    - Chainweaver / Ecko are BIP32-Ed25519. The library's 128-byte key
   *      buffer is `[scalar kL‖kR (64) | publicKey (32) | chainCode (32)]`, and
   *      the first 64 bytes are XOR-scrambled against the *wallet password*
   *      (Cardano `cardanoMemoryCombine`) purely as an in-memory safety layer.
   *      The canonical exported key is password-AGNOSTIC. So we re-derive with
   *      an EMPTY wallet password (no scramble → plaintext scalar) and take the
   *      first 64 bytes (`kL‖kR` → 128 hex). The trailing pubkey + chainCode in
   *      the raw buffer are NOT part of the exported key.
   *      (The previous code dumped the whole 128-byte buffer with the scrambled
   *       scalar still in place — yielding a 256-hex value whose key bytes were
   *       wrong, e.g. `<scrambled>‖<pubkey>‖<chainCode>`.)
   *    - Koala is plain Ed25519; its 32-byte (64-hex) key is already correct and
   *      equally password-agnostic, so it is left on the codex password path
   *      unchanged.
   *    - Stoic ("Stoa Dalos") has no mnemonic at all — `seed.secret` decrypts
   *      to the 1600-bit DALOS bitstring, not a mnemonic, so it CANNOT go
   *      through `createWalletPairFromMnemonic` (same reasoning as
   *      InternalCodexResolver's `"stoic"` branch). Its `privateKey` is
   *      already a PLAIN nacl-signable hex key — no `StoaChainWalletBuilder
   *      .decrypt` unwrap needed. */
  const revealPrivateKey = (account: WalletAccount) => async (): Promise<string> => {
    if (!(await ensureUnlocked())) throw new Error("locked");
    const password = getCurrentPassword();
    const secretPlain = await smartDecrypt(seed.secret, password);
    if (seed.seedType === "stoic") {
      return deriveStoaDalosKeypairAtIndex(secretPlain, account.index).privateKey;
    }
    const mnemonic = secretPlain;
    const isExtended = seed.seedType === "chainweaver" || seed.seedType === "eckowallet";
    // Empty wallet password for extended keys → plaintext scalar. Koala keeps
    // the codex password (no behavioral change; its key is password-agnostic).
    const walletPw = isExtended ? "" : password;
    const { secretKey } = await StoaChainWalletBuilder.createWalletPairFromMnemonic(walletPw, mnemonic, account.index, seed.seedType);
    const rawBytes = await StoaChainWalletBuilder.decrypt(walletPw, secretKey);
    const hex = binToHex(rawBytes);
    // Extended: first 64 bytes (kL‖kR) = the 128-hex KadenaKeys export format.
    return isExtended ? hex.slice(0, 128) : hex;
  };

  /** Derive + add a key at `index`, surfacing staged progress. The stage label
   *  + sweep bar paint before each heavy step so the user sees work happening
   *  even though the derivation blocks the main thread. */
  const runAdd = async (index: number) => {
    setRowError(null);
    setShowCustomPos(false);
    setCustomIndex("");
    setDeriving({ index, stage: "Preparing…" });
    await nextPaint();
    try {
      await onAddKey(seed, index, async (stage) => { setDeriving({ index, stage }); await nextPaint(); });
    } catch (e) {
      setRowError(e instanceof Error ? e.message : "Could not add key.");
    } finally {
      setDeriving(null);
    }
  };

  return (
    <div data-seed-id={seed.id} style={{ border: `1px solid ${isPrime ? "#ceac5f40" : "#262626"}`, borderRadius: 12, overflow: "hidden", backgroundColor: "#18181B", scrollSnapAlign: "start" }}>
      {/* Header (a plain clickable div, NOT role=button — it hosts the rename
          inputs + the actions menu, which are real buttons; a role=button here
          would (a) invalidly nest buttons and (b) aggregate the open menu's text
          into its own accessible name).
          MOBILE (design.md §8, the "further optimize round 6" — owner
          correction: "instead of showing Koala, Chainweaver/EckoWallet, and
          Stoa Dalos... i propose we instead use an icon (pink blue golden)
          representing this seed type, gaining vertical space, after the
          name the number of keys, and at the end the triple point button"):
          back to a SINGLE row — the wide text badge (round 4's fix for
          name-truncation) is replaced by a small colored DOT, narrow enough
          that the name no longer needs its own second row at all. The
          "Prime" text badge is dropped too (redundant with the Lock icon
          already leading the row + the name's own gold color). Desktop's
          own single-row layout below is untouched (and was never the
          problem — text badges only crowd space on mobile's narrower row). */}
      {isMobile ? (
        <div
          onClick={onToggle}
          // Round 24 owner correction: "here would have surely fitted 4
          // entries; moreover the seed entries themselves could make due
          // with smaller height, as you can see there is only one line of
          // text that needs displaying." The row's actual height floor is
          // the 28px triple-dot trigger (`SeedActions`, shared with
          // desktop — not touched here), not this single line of 14px
          // text/16px icons — so the real lever is vertical padding, which
          // had nothing but that shared component's own fixed height to
          // clear. Trimmed 12px → 6px top/bottom (saves 12px per row);
          // horizontal untouched.
          style={{ width: "100%", boxSizing: "border-box", display: "flex", alignItems: "center", gap: 10, padding: "6px 16px", textAlign: "left", cursor: "pointer" }}
        >
          {isPrime
            ? <Lock style={{ width: 16, height: 16, flexShrink: 0, color: "#ceac5f" }} />
            : expanded
              ? <ChevronUp style={{ width: 16, height: 16, flexShrink: 0, color: "#ceac5f" }} />
              : <ChevronDown style={{ width: 16, height: 16, flexShrink: 0, color: "#555" }} />}
          <span
            title={cfg.label}
            aria-label={cfg.label}
            style={{ flexShrink: 0, width: 10, height: 10, borderRadius: "50%", backgroundColor: cfg.color }}
          />
          {renaming ? (
            <span style={{ flex: 1, minWidth: 0, display: "inline-flex", alignItems: "center", gap: 6 }} onClick={(e) => e.stopPropagation()}>
              <input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenaming(false); }}
                style={{ flex: 1, height: 28, fontSize: 13, padding: "0 8px", borderRadius: 6, backgroundColor: "#0a0a0a", border: "1px solid #4ade8060", color: "#d2d3d4" }}
              />
              <button type="button" title="Save" onClick={commitRename} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 6, backgroundColor: "#0a2010", color: "#4ade80", border: "2px solid rgba(20,80,40,0.9)", cursor: "pointer" }}><Check size={13} /></button>
              <button type="button" title="Cancel" onClick={() => setRenaming(false)} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 6, backgroundColor: "#141414", color: "#777", border: "2px solid #252525", cursor: "pointer" }}><X size={13} /></button>
            </span>
          ) : (
            // Round 10 owner correction: "when i collapse the seeds the
            // seed name isn't properly centered on the entry, it sits
            // slightly lower... it has to be properly centered in its
            // entry." A text span's line box carries extra leading below
            // the baseline (for descenders) that a same-height icon's box
            // doesn't — `align-items: center` on the row then centers the
            // (taller) LINE BOX, not the glyphs within it, visibly
            // dropping the text a few px below the icons beside it. An
            // explicit `lineHeight` matching the row's own icon size (16px)
            // collapses that extra leading so the text centers identically.
            <span style={{ flex: 1, minWidth: 0, lineHeight: "16px", fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: isPrime ? "#ceac5f" : "#d2d3d4" }}>
              {displayName}
            </span>
          )}
          <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, lineHeight: "16px", color: "#888" }}>
            {seed.accounts.length} <Key style={{ width: 11, height: 11 }} />
          </span>
          <SeedActions
            isPrime={isPrime}
            onView={() => void handleView()}
            onRename={() => { setDraftName(isPrime ? "" : seed.name || ""); setRenaming(true); }}
            onDelete={() => onDeleteSeed(seed.id)}
          />
        </div>
      ) : (
      <div
        onClick={onToggle}
        style={{ width: "100%", boxSizing: "border-box", display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", textAlign: "left", cursor: "pointer" }}
      >
        {isPrime
          ? <Lock style={{ width: 16, height: 16, flexShrink: 0, color: "#ceac5f" }} />
          : expanded
            ? <ChevronUp style={{ width: 16, height: 16, flexShrink: 0, color: "#ceac5f" }} />
            : <ChevronDown style={{ width: 16, height: 16, flexShrink: 0, color: "#555" }} />}

        {renaming ? (
          <span style={{ flex: 1, display: "inline-flex", alignItems: "center", gap: 6 }} onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenaming(false); }}
              style={{ flex: 1, height: 28, fontSize: 13, padding: "0 8px", borderRadius: 6, backgroundColor: "#0a0a0a", border: "1px solid #4ade8060", color: "#d2d3d4" }}
            />
            <button type="button" title="Save" onClick={commitRename} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 6, backgroundColor: "#0a2010", color: "#4ade80", border: "2px solid rgba(20,80,40,0.9)", cursor: "pointer" }}><Check size={13} /></button>
            <button type="button" title="Cancel" onClick={() => setRenaming(false)} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 6, backgroundColor: "#141414", color: "#777", border: "2px solid #252525", cursor: "pointer" }}><X size={13} /></button>
          </span>
        ) : (
          <span style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: isPrime ? "#ceac5f" : "#d2d3d4" }}>
            {displayName}
          </span>
        )}

        {isPrime && (
          <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 9999, fontSize: 10, fontWeight: 600, color: "#ceac5f", backgroundColor: "#ceac5f20" }}>🔒 Prime</span>
        )}
        <span style={{ flexShrink: 0, padding: "2px 8px", borderRadius: 9999, fontSize: 10, fontWeight: 600, color: cfg.color, backgroundColor: cfg.bg }}>{cfg.label}</span>
        <span style={{ fontSize: 12, flexShrink: 0, color: "#888" }}>{seed.accounts.length} key{seed.accounts.length !== 1 ? "s" : ""}</span>
        <div style={{ flex: 1 }} />
        <SeedActions
          isPrime={isPrime}
          onView={() => void handleView()}
          onRename={() => { setDraftName(isPrime ? "" : seed.name || ""); setRenaming(true); }}
          onDelete={() => onDeleteSeed(seed.id)}
        />
      </div>
      )}

      {/* Mnemonic reveal (from the actions menu) — MOBILE (design.md §8, the
          "further optimize round 5" — owner correction: "i suggest we use
          full screen mode for this"): a real full-screen `CodexModalShell`
          instead of a small inline strip squeezed under the collapsed row,
          matching every other mobile reveal surface in this app. Desktop's
          own inline strip is untouched.
          Round 19 owner correction: "if there is a stoa dalos Seed type, it
          needs to have the whole Stoa Dalos private key viewing
          infrastructure, words, bit sctring, bitmap, base 49 base 10
          scalar the whole deal... it should look like what we can see in
          the view of the Seed of Arweave plus showing the actual words."
          A `stoic` seed's own `secret` is ALWAYS its raw DALOS bitstring —
          never a BIP39 mnemonic (`seedWordsToBitString` is one-way, so
          `phrase` here can never itself BE the words) — but round 22/23
          (asked four times) closed the real gap: `stoicWords`, decrypted
          separately from `seed.wordsSecret` in `handleView` when this seed
          actually has one, carries the REAL typed/source words when they
          were captured at creation time. `DalosSecretReveal` gets
          `originMode="seedWords"` + `plaintext={stoicWords}` in that case —
          the exact same shape `ArweaveSeedsArea.tsx`'s own "View Seed"
          already uses for its own words-origin seeds — falling back to
          today's `originMode="bitString"` dump only when this specific
          seed genuinely has no words behind it (Direct/bitstring-origin,
          an "existing account" source that itself had no words, or a seed
          persisted before this field existed). Every OTHER seed type keeps
          the plain mnemonic strip, unchanged.
          The explicit `key`s below are load-bearing, not cosmetic: `phrase`
          (bitstring) decrypts and sets state SYNCHRONOUSLY first, mounting
          `DalosSecretReveal` with `originMode="bitString"` — `stoicWords`
          only resolves slightly later (its own separate `wordsSecret`
          decrypt). Without a `key`, React sees the SAME element type at the
          same tree position on the next render and reuses the existing
          instance, just updating props — but `DalosSecretReveal`'s own
          `active` tab state is a `useState` INITIALIZER, which only runs
          once at first mount, so it would stay stuck on whichever tab
          `originMode="bitString"`'s initial render picked, even after
          `originMode` itself changes to `"seedWords"` — the Seed tab
          BUTTON would appear (tabs are recomputed every render) but never
          actually display, silently. Different `key`s force a real
          remount so `active` re-initializes correctly. */}
      {phrase && isMobile && (
        <MobilePortal target={fullScreenPortalTarget}>
          <CodexModalShell title={`${displayName} — Seed Words`} onClose={() => { setPhrase(null); setStoicWords(null); }} fillBody>
            {seed.seedType === "stoic" ? (
              stoicWords ? (
                <DalosSecretReveal key="stoic-words" plaintext={stoicWords} originMode="seedWords" originCurve="dalos" sourceLabelOverride={displayName} hideAddress />
              ) : (
                <DalosSecretReveal key="stoic-bitstring" plaintext={phrase} originMode="bitString" originCurve="dalos" sourceLabelOverride={displayName} hideAddress />
              )
            ) : (
              <>
                <div style={{ backgroundColor: "#080808", border: "1px dashed #2a2a2a", borderRadius: 8, padding: "14px 16px", fontFamily: MONO, fontSize: 15, lineHeight: 1.7, color: "#d2d3d4", wordBreak: "break-word" }}>
                  {phrase}
                </div>
                <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 16 }}>
                  <IconCopyBtn text={phrase} size={36} />
                  <IconHideBtn onClick={() => { setPhrase(null); setStoicWords(null); }} size={36} />
                </div>
              </>
            )}
          </CodexModalShell>
        </MobilePortal>
      )}
      {phrase && !isMobile && (
        seed.seedType === "stoic" ? (
          <div style={{ margin: "0 16px 12px", padding: "10px 12px", borderRadius: 8, border: "1px dashed #2a2a2a", backgroundColor: "#080808" }}>
            {/* `DalosSecretReveal`'s own "Reveal/Hide" toggle only MASKS
                the content — this is the separate "forget the decrypted
                plaintext and dismiss the whole panel" action `IconHideBtn`
                provides for every other seed type here too. */}
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
              <IconHideBtn onClick={() => { setPhrase(null); setStoicWords(null); }} size={28} />
            </div>
            {stoicWords ? (
              <DalosSecretReveal key="stoic-words" plaintext={stoicWords} originMode="seedWords" originCurve="dalos" sourceLabelOverride={displayName} hideAddress />
            ) : (
              <DalosSecretReveal key="stoic-bitstring" plaintext={phrase} originMode="bitString" originCurve="dalos" sourceLabelOverride={displayName} hideAddress />
            )}
          </div>
        ) : (
          <div style={{ margin: "0 16px 12px", backgroundColor: "#080808", border: "1px dashed #2a2a2a", borderRadius: 8, padding: "10px 12px", fontFamily: MONO, fontSize: 13, color: "#d2d3d4", wordBreak: "break-word", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ flex: 1 }}>{phrase}</span>
            <IconCopyBtn text={phrase} size={28} />
            <IconHideBtn onClick={() => { setPhrase(null); setStoicWords(null); }} size={28} />
          </div>
        )
      )}

      {/* Row error (view / add-key) — rendered outside the {expanded} block so a
          "View Seed Words" failure on a collapsed row is actually visible.
          Bug fix (design.md §8, the "further optimize round 5"): this was
          gated `!isMobile` ONLY — meaning on mobile, a "View Seed Words"
          failure on a COLLAPSED row (e.g. the password prompt cancelled)
          produced zero visible feedback at all: "clicking it, nothing
          happens." Now shown on mobile too, UNLESS the row is currently
          `expanded` — in that case the full-screen popup below renders its
          OWN copy of the same error instead, so it isn't shown twice. */}
      {rowError && (!isMobile || !expanded) && <p role="alert" style={{ fontSize: 12, color: "#c0392b", margin: "0 16px 12px" }}>{rowError}</p>}

      {/* Expanded content — MOBILE (docs/work/codex-ui-mobile/design.md §8,
          the "optimize each blockchain and tab" round): "when clicking each
          seed to expand, it won't expand as usual, but show everything full
          screen with a back button, and there would be place for
          everything." Reuses the EXACT same content/state/handlers as
          desktop's inline expansion — only the OUTER wrapper differs
          (a full-screen `CodexModalShell` instead of an inline block); the
          tab-level `expanded`/`onToggle` (see `SeedWordsTab` below) already
          guarantees only ONE row is ever "expanded" at a time on mobile, so
          only one popup can ever be mounted. */}
      {expanded && isMobile && (
        <MobilePortal target={fullScreenPortalTarget}>
        <CodexModalShell
          title={`${displayName} (${sortedAccounts.length})`}
          onClose={onToggle}
          dialogTestId={`seed-detail-${seed.id}`}
          bodySnap
          // Owner correction (design.md §8, the "further optimize round
          // 6"): "the button must stay fixed at the top, only the entries
          // scroll" — the shared switcher/copy/delete row (tied to
          // whichever position is SELECTED, same consolidation
          // `StoaAccountsTab`'s own shared action row already does for
          // address entries) pins to the CARD's own top edge, right beneath
          // the title, via `CodexModalShell`'s `topBar` slot — never
          // scrolls away with the key list. Always has a selection ("by
          // default the first position is the selected one"), so this
          // never needs a disabled/empty state.
          topBar={selectedAccount && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <button
                type="button"
                onClick={() => void toggleKeySwitch()}
                title={showPrivateKey ? "Switch to public key" : "Switch to private key"}
                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 8, flexShrink: 0, cursor: "pointer", backgroundColor: "#141414", color: "#ceac5f", border: "2px solid #252525" }}
              >
                {keyBusy ? <Loader2 style={{ width: 16, height: 16, animation: "codex-seed-spin 0.9s linear infinite" }} /> : <ArrowLeftRight style={{ width: 16, height: 16 }} />}
              </button>
              <button
                type="button"
                onClick={() => void copyCurrentKey()}
                title={showPrivateKey ? "Copy private key" : "Copy public key"}
                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 8, flexShrink: 0, cursor: "pointer", backgroundColor: keyCopied ? "#0a2a14" : "#141414", color: keyCopied ? "#4ade80" : "#777", border: keyCopied ? "2px solid rgba(74,222,128,0.4)" : "2px solid #252525" }}
              >
                {keyCopied ? <Check style={{ width: 16, height: 16 }} /> : <Copy style={{ width: 16, height: 16 }} />}
              </button>
              {isPrime && selectedAccount.index === 0
                ? <IconDeleteBtnDisabled size={36} title="Cannot delete first key of Prime seed" />
                : <IconDeleteBtn onClick={() => onDeleteKey(seed, selectedAccount.index)} size={36} />}
            </div>
          )}
          // Owner correction (design.md §8, the "further optimize round
          // 4"): "lets keep the buttons down, always showing" — the
          // Add-Consecutive/Add-at-Position controls pin to the CARD's own
          // bottom edge (via `CodexModalShell`'s `footer` slot, the same
          // mechanism the Send/Transfer modals already use for their own
          // Cancel/Submit row) instead of scrolling away with the key list.
          footer={
            deriving ? (
              <DerivingBar index={deriving.index} stage={deriving.stage} />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {/* Owner correction (design.md §8, the "further optimize
                    round 5"): "buttons must be centered." */}
                <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => void runAdd(nextConsecutive())}
                    title="Adds the next consecutive key position"
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 500, padding: "6px 12px", borderRadius: 8, border: "1px solid #262626", background: "transparent", color: "#ceac5f", cursor: "pointer" }}
                  >
                    <Plus style={{ width: 14, height: 14 }} /> Add Consecutive Key
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowCustomPos((v) => !v); setCustomIndex(""); setRowError(null); }}
                    title="Add key at a specific position"
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 500, padding: "6px 12px", borderRadius: 8, border: "1px solid #262626", background: "transparent", color: "#888", cursor: "pointer" }}
                  >
                    <Hash style={{ width: 14, height: 14 }} /> Add Key at Position
                  </button>
                </div>
                {showCustomPos && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                      <input
                        type="number"
                        min={0}
                        placeholder="Position (e.g. 5)"
                        value={customIndex}
                        onChange={(e) => setCustomIndex(e.target.value)}
                        style={{ width: 128, borderRadius: 6, padding: "6px 8px", fontSize: 12, fontFamily: MONO, outline: "none", backgroundColor: "#111", border: "1px solid #262626", color: "#d2d3d4" }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setRowError(null);
                          const pos = parseInt(customIndex, 10);
                          if (isNaN(pos) || pos < 0) { setRowError("Enter a valid position (≥ 0)."); return; }
                          if (seed.accounts.some((a) => a.index === pos)) { setRowError(`Key #${pos} is already in the Codex for this seed.`); return; }
                          void runAdd(pos);
                        }}
                        style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, border: "none", backgroundColor: "#ceac5f", color: "#0a0a0a", cursor: "pointer" }}
                      >
                        Add
                      </button>
                      <button type="button" onClick={() => { setShowCustomPos(false); setCustomIndex(""); }} style={{ fontSize: 12, padding: "6px 8px", borderRadius: 8, border: "1px solid #262626", background: "transparent", color: "#555", cursor: "pointer" }}>Cancel</button>
                    </div>
                    {customIndex !== "" && seed.accounts.some((a) => a.index === parseInt(customIndex, 10)) && (
                      <p style={{ fontSize: 11, color: "#f59e0b", margin: 0 }}>⚠ Key #{customIndex} is already in the Codex for this seed.</p>
                    )}
                  </div>
                )}
              </div>
            )
          }
        >
          {rowError && <p role="alert" style={{ fontSize: 12, color: "#c0392b", margin: "0 0 12px" }}>{rowError}</p>}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {sortedAccounts.length === 0 ? (
              <p style={{ fontSize: 13, padding: "16px 0", textAlign: "center", color: "#555", margin: 0 }}>No keys in this seed</p>
            ) : (
              sortedAccounts.map((acc) => (
                <MobileKeyRow
                  key={`${seed.id}-${acc.index}`}
                  account={acc}
                  selected={acc.index === selectedKeyIndex}
                  onSelect={() => selectKey(acc.index)}
                  showPrivate={showPrivateKey}
                  privValue={privCache[acc.index]}
                />
              ))
            )}
          </div>
        </CodexModalShell>
        </MobilePortal>
      )}

      {/* Expanded content — DESKTOP (unchanged inline block). */}
      {expanded && !isMobile && (
        <div style={{ padding: "8px 16px 12px", borderTop: "1px solid #262626", display: "flex", flexDirection: "column", gap: 2 }}>
          {sortedAccounts.length === 0 ? (
            <p style={{ fontSize: 13, padding: "16px 0", textAlign: "center", color: "#555", margin: 0 }}>No keys in this seed</p>
          ) : (
            sortedAccounts.map((acc) => (
              <KeyRow
                key={`${seed.id}-${acc.index}`}
                account={acc}
                seedId={seed.id}
                isPrimeFirstKey={isPrime && acc.index === 0}
                onDelete={(sid, i) => { void (sid === seed.id && onDeleteKey(seed, i)); }}
                decrypt={revealPrivateKey(acc)}
              />
            ))
          )}

          {/* While deriving, the add controls are replaced by the live progress
              bar so the user sees the (CPU-heavy) key derivation working. */}
          {deriving ? (
            <DerivingBar index={deriving.index} stage={deriving.stage} />
          ) : (
            <>
              {/* Add-key buttons */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => void runAdd(nextConsecutive())}
                  title="Adds the next consecutive key position"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 500, padding: "6px 12px", borderRadius: 8, border: "1px solid #262626", background: "transparent", color: "#ceac5f", cursor: "pointer" }}
                >
                  <Plus style={{ width: 14, height: 14 }} /> Add Consecutive Key
                </button>
                <button
                  type="button"
                  onClick={() => { setShowCustomPos((v) => !v); setCustomIndex(""); setRowError(null); }}
                  title="Add key at a specific position"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 500, padding: "6px 12px", borderRadius: 8, border: "1px solid #262626", background: "transparent", color: "#888", cursor: "pointer" }}
                >
                  <Hash style={{ width: 14, height: 14 }} /> Add Key at Position
                </button>
              </div>

              {/* Custom position input */}
              {showCustomPos && (
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="number"
                      min={0}
                      placeholder="Position (e.g. 5)"
                      value={customIndex}
                      onChange={(e) => setCustomIndex(e.target.value)}
                      style={{ width: 128, borderRadius: 6, padding: "6px 8px", fontSize: 12, fontFamily: MONO, outline: "none", backgroundColor: "#111", border: "1px solid #262626", color: "#d2d3d4" }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setRowError(null);
                        const pos = parseInt(customIndex, 10);
                        if (isNaN(pos) || pos < 0) { setRowError("Enter a valid position (≥ 0)."); return; }
                        if (seed.accounts.some((a) => a.index === pos)) { setRowError(`Key #${pos} is already in the Codex for this seed.`); return; }
                        void runAdd(pos);
                      }}
                      style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, border: "none", backgroundColor: "#ceac5f", color: "#0a0a0a", cursor: "pointer" }}
                    >
                      Add
                    </button>
                    <button type="button" onClick={() => { setShowCustomPos(false); setCustomIndex(""); }} style={{ fontSize: 12, padding: "6px 8px", borderRadius: 8, border: "1px solid #262626", background: "transparent", color: "#555", cursor: "pointer" }}>Cancel</button>
                  </div>
                  {customIndex !== "" && seed.accounts.some((a) => a.index === parseInt(customIndex, 10)) && (
                    <p style={{ fontSize: 11, color: "#f59e0b", margin: 0 }}>⚠ Key #{customIndex} is already in the Codex for this seed.</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Main tab ─── */
export function SeedWordsTab({ className, createOpen: createOpenProp, onCreateOpenChange, fullScreenPortalTarget, onPaginationHandleChange }: SeedWordsTabProps) {
  const isMobile = useIsMobile();
  const { seeds, updateSeed, deleteSeed } = useStoaChainSeeds();
  const { getCurrentPassword } = useCodexAuth();
  const ensureUnlocked = useEnsureCodexUnlocked();
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  // Mobile's OWN "which seed is currently open full-screen" — deliberately
  // NOT the same state as `expandedIds` (which allows MULTIPLE simultaneous
  // inline expansions on desktop): a full-screen popup is a single overlay,
  // so at most one seed can be "expanded" on mobile at a time.
  const [mobileOpenSeedId, setMobileOpenSeedId] = useState<string | null>(null);
  const [localCreateOpen, setLocalCreateOpen] = useState(false);
  // Controlled create-modal state, falling back to internal state when the
  // consumer hasn't wired the controlled pair (see `SeedWordsTabProps`'s doc
  // comment) — `ChainwebPanel`'s mobile category row drives this via props.
  const createOpen = createOpenProp ?? localCreateOpen;
  const setCreateOpen = onCreateOpenChange ?? setLocalCreateOpen;
  const [page, setPage] = useState(0);
  const { containerRef: seedsPageContainerRef, rowRef: seedsPageRowRef, pageSize: mobileSeedPageSize } = useMobileSeedPageSize();
  const [topError, setTopError] = useState<string | null>(null);

  // Display order: the Prime seed is pinned first (it's the non-deletable prime
  // entity); every other seed is listed alphabetically by name (case-insensitive,
  // locale-aware, numeric-aware so "Seed 2" precedes "Seed 10"). The store's raw
  // insertion order is otherwise arbitrary, which is the bug this corrects.
  const orderedSeeds = useMemo(() => {
    if (seeds.length < 2) return seeds;
    const prime = seeds.find((s) => s.isPrime === true) ?? seeds[0];
    const rest = seeds
      .filter((s) => s !== prime)
      .sort((a, b) =>
        (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base", numeric: true }),
      );
    return [prime, ...rest];
  }, [seeds]);

  const toggle = (id: string) => setExpandedIds((p) => ({ ...p, [id]: !p[id] }));
  // Mobile: opening a DIFFERENT seed replaces whichever one was open — never
  // two full-screen popups mounted at once.
  const toggleMobile = (id: string) => setMobileOpenSeedId((cur) => (cur === id ? null : id));

  const handleRename = (seed: IStoaChainSeed, name: string) => void updateSeed({ ...seed, name });

  const handleDeleteSeed = async (id: string) => {
    setTopError(null);
    try { await deleteSeed(id); } catch { setTopError("This seed is protected and cannot be deleted."); }
  };

  /** Derive a key at `index` from the seed's mnemonic and persist it. `onStage`
   *  is awaited before each step so the progress label (and the compositor sweep
   *  bar) paint before the CPU-heavy derivation blocks the main thread.
   *
   *  Stoic ("Stoa Dalos") seeds have no mnemonic — `seed.secret` decrypts to
   *  the 1600-bit DALOS bitstring instead, derived via
   *  `deriveStoaDalosKeypairAtIndex` (same reasoning as `revealPrivateKey`
   *  above / InternalCodexResolver's `"stoic"` branch). */
  const handleAddKey = async (
    seed: IStoaChainSeed,
    index: number,
    onStage?: (s: string) => Promise<void> | void,
  ) => {
    await onStage?.("Unlocking codex…");
    if (!(await ensureUnlocked())) throw new Error("Unlock the codex to add keys.");
    const password = getCurrentPassword();
    await onStage?.("Decrypting seed…");
    const secretPlain = await smartDecrypt(seed.secret, password);
    await onStage?.("Deriving keypair…");
    const publicKey =
      seed.seedType === "stoic"
        ? deriveStoaDalosKeypairAtIndex(secretPlain, index).publicKey
        : (await StoaChainWalletBuilder.createWalletPairFromMnemonic(password, secretPlain, index, seed.seedType)).publicKey;
    await onStage?.("Saving key…");
    const newAcc: WalletAccount = { index, publicKey, derivationPath: derivationPath(index) };
    const accounts = [...seed.accounts.filter((a) => a.index !== index), newAcc].sort((a, b) => a.index - b.index);
    await updateSeed({ ...seed, accounts });
  };

  const handleDeleteKey = (seed: IStoaChainSeed, index: number) => {
    void updateSeed({ ...seed, accounts: seed.accounts.filter((a) => a.index !== index) });
  };

  // Pagination (mobile only — desktop stays unpaginated, unchanged) — MEASURED
  // (round 8 follow-up: "we need [the] same pagination... at the seeds
  // level"), not the old fixed `SEEDS_PER_PAGE = 12`. `PrimeSeparator` is
  // DESKTOP-ONLY now (see its own render site below), so every page —
  // including page 0 — uses the SAME plain measured `mobileSeedPageSize`,
  // no per-page deduction needed. Clamp so a seed deletion that drops the
  // page count doesn't strand `page` past the new last page.
  const mobilePages = useMemo(() => {
    if (orderedSeeds.length === 0) return [[]] as IStoaChainSeed[][];
    const out: IStoaChainSeed[][] = [];
    for (let i = 0; i < orderedSeeds.length; i += mobileSeedPageSize) {
      out.push(orderedSeeds.slice(i, i + mobileSeedPageSize));
    }
    return out;
  }, [orderedSeeds, mobileSeedPageSize]);
  const totalPages = isMobile ? mobilePages.length : 1;
  const clampedPage = Math.min(page, totalPages - 1);

  // Round 9 "standard pagination controls zone" — reports upward whenever a
  // caller opts in (see `onPaginationHandleChange`'s own doc comment for
  // the fallback rule); `ChainwebPanel` renders the ACTUAL medallion.
  const reportsPaginationExternally = !!onPaginationHandleChange;
  useEffect(() => {
    if (!reportsPaginationExternally) return;
    if (totalPages <= 1) {
      onPaginationHandleChange?.(null);
      return;
    }
    onPaginationHandleChange?.({
      page: clampedPage,
      totalPages,
      onPrev: () => setPage((p) => Math.max(0, p - 1)),
      onNext: () => setPage((p) => Math.min(totalPages - 1, p + 1)),
      onJump: (p) => setPage(p),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportsPaginationExternally, totalPages, clampedPage, onPaginationHandleChange]);

  /**
   * Round 21 owner correction (ported from `ArweaveSeedsArea.tsx`'s
   * identical change, itself ported from `StoaAccountsTab.tsx`'s own
   * drag-following, two-pane swipe carousel): "same slide swipe animation
   * must be for the seed view as well, which now currently doesnt have
   * such a thing." MOBILE ONLY — desktop (`totalPages` always 1) never
   * mounts the swipe track. Already safe to have `overflow: hidden` on
   * this container (unchanged from before this round) — an expanded row
   * has always portaled full screen on mobile here (`expanded && isMobile`
   * below), never growing this list inline.
   */
  const seedSwipeStart = useRef<{ x: number; y: number } | null>(null);
  const [seedSwipeAxis, setSeedSwipeAxis] = useState<"horizontal" | "vertical" | null>(null);
  const [seedDragX, setSeedDragX] = useState(0);
  const [seedDragTransition, setSeedDragTransition] = useState(false);
  const [seedDragDirection, setSeedDragDirection] = useState<"next" | "prev" | null>(null);
  const SEED_SWIPE_THRESHOLD_PX = 40;
  const SEED_SWIPE_AXIS_DEADZONE_PX = 8;
  const SEED_SWIPE_SETTLE_MS = 200;
  const onSeedsTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const t = e.touches[0];
    if (!t) return;
    seedSwipeStart.current = { x: t.clientX, y: t.clientY };
    setSeedSwipeAxis(null);
    setSeedDragDirection(null);
    setSeedDragTransition(false);
  };
  const onSeedsTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const start = seedSwipeStart.current;
    const t = e.touches[0];
    if (!start || !t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    let axis = seedSwipeAxis;
    if (axis === null) {
      if (Math.abs(dx) < SEED_SWIPE_AXIS_DEADZONE_PX && Math.abs(dy) < SEED_SWIPE_AXIS_DEADZONE_PX) return;
      axis = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
      setSeedSwipeAxis(axis);
    }
    if (axis !== "horizontal") return;
    const atFirstPage = clampedPage === 0;
    const atLastPage = clampedPage >= totalPages - 1;
    const resisted = (dx > 0 && atFirstPage) || (dx < 0 && atLastPage) ? dx * 0.35 : dx;
    setSeedDragX(resisted);
    if (seedDragDirection === null) {
      if (dx < 0 && !atLastPage) setSeedDragDirection("next");
      else if (dx > 0 && !atFirstPage) setSeedDragDirection("prev");
    }
  };
  const onSeedsTouchEnd = () => {
    const start = seedSwipeStart.current;
    seedSwipeStart.current = null;
    const axis = seedSwipeAxis;
    setSeedSwipeAxis(null);
    if (!start || axis !== "horizontal") { setSeedDragTransition(true); setSeedDragX(0); return; }
    const committingNext = seedDragX <= -SEED_SWIPE_THRESHOLD_PX && clampedPage < totalPages - 1;
    const committingPrev = seedDragX >= SEED_SWIPE_THRESHOLD_PX && clampedPage > 0;
    if (!committingNext && !committingPrev) { setSeedDragTransition(true); setSeedDragX(0); return; }
    const containerWidth = seedsPageContainerRef.current?.clientWidth || 320;
    setSeedDragTransition(true);
    setSeedDragX(committingNext ? -containerWidth : containerWidth);
    window.setTimeout(() => {
      setPage((p) => (committingNext ? Math.min(totalPages - 1, p + 1) : Math.max(0, p - 1)));
      setSeedDragTransition(false);
      setSeedDragX(0);
      setSeedDragDirection(null);
    }, SEED_SWIPE_SETTLE_MS);
  };

  /** Renders ONE page's worth of seed rows — factored out so the swipe
   *  carousel can mount it up to three times. On desktop, `pageIndex` is
   *  irrelevant — the full unpaginated `orderedSeeds` list renders exactly
   *  as it always has. `measureFirstRow` is true ONLY for the currently-
   *  displayed page's own first row. */
  const renderSeedsPage = (pageIndex: number, measureFirstRow: boolean): React.ReactNode => {
    const list = isMobile ? (mobilePages[pageIndex] ?? []) : orderedSeeds;
    let measured = false;
    return list.map((seed) => {
      const idx = orderedSeeds.indexOf(seed);
      const isPrime = seed.isPrime === true || idx === 0;
      const shouldMeasure = measureFirstRow && isMobile && !measured;
      if (shouldMeasure) measured = true;
      return (
        <Fragment key={seed.id}>
          <div ref={shouldMeasure ? seedsPageRowRef : undefined}>
            <SeedRow
              seed={seed}
              index={idx}
              expanded={isMobile ? mobileOpenSeedId === seed.id : !!expandedIds[seed.id]}
              onToggle={() => (isMobile ? toggleMobile(seed.id) : toggle(seed.id))}
              onRename={handleRename}
              onDeleteSeed={(id) => void handleDeleteSeed(id)}
              onAddKey={handleAddKey}
              onDeleteKey={handleDeleteKey}
              fullScreenPortalTarget={fullScreenPortalTarget}
            />
          </div>
          {!isMobile && isPrime && idx === 0 && list.length > 1 && <PrimeSeparator label="Other Seeds" />}
        </Fragment>
      );
    });
  };

  return (
    <div
      className={className}
      style={{
        fontFamily: "var(--codex-font, inherit)", color: "#d2d3d4", display: "flex", flexDirection: "column", gap: 12,
        height: isMobile ? "100%" : undefined,
        minHeight: isMobile ? 0 : undefined,
      }}
    >
      {/* Header: total + Create New Seed — DESKTOP only. On mobile both are
          relocated onto `ChainwebPanel`'s own category icon row (design.md
          §8: "the seed number aligned... to the left, and the add seed as a
          plus button... on the right"). */}
      {!isMobile && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div style={{ fontSize: 14, color: "#888" }}>
            Total <span style={{ fontWeight: 700, color: "#d2d3d4" }}>{seeds.length}</span> Seed{seeds.length !== 1 ? "s" : ""}
          </div>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600, border: "none", backgroundColor: "#ceac5f", color: "#0a0a0a", cursor: "pointer" }}
          >
            <PlusCircle style={{ width: 16, height: 16 }} /> Create New Seed
          </button>
        </div>
      )}

      {topError && <p role="alert" style={{ fontSize: 12, color: "#c0392b", margin: 0 }}>{topError}</p>}

      {seeds.length === 0 ? (
        <div style={{ textAlign: "center", padding: "32px 0", borderRadius: 12, border: "1px dashed #262626", color: "#555" }}>
          <p style={{ fontSize: 14, margin: "0 0 12px" }}>No seeds in the codex yet.</p>
          {!isMobile && (
            <button type="button" onClick={() => setCreateOpen(true)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600, border: "none", backgroundColor: "#ceac5f", color: "#0a0a0a", cursor: "pointer" }}>
              <PlusCircle style={{ width: 16, height: 16 }} /> Create Your First Seed
            </button>
          )}
        </div>
      ) : (
        <div
          ref={seedsPageContainerRef}
          data-testid="stoa-seeds-page-surface"
          onTouchStart={isMobile ? onSeedsTouchStart : undefined}
          onTouchMove={isMobile ? onSeedsTouchMove : undefined}
          onTouchEnd={isMobile ? onSeedsTouchEnd : undefined}
          style={{
            display: "flex", flexDirection: "column", gap: SEED_ROW_GAP,
            // MOBILE ONLY — bounds this list to whatever's actually left
            // over, so `useMobileSeedPageSize` measures real available
            // height instead of the list just growing with its own
            // content (design.md §8, round 8 follow-up: "we need [the]
            // same pagination... at the seeds level"). Desktop keeps
            // growing naturally, unchanged.
            flex: isMobile ? 1 : undefined,
            minHeight: isMobile ? 0 : undefined,
            overflow: isMobile ? "hidden" : undefined,
            // Round 10 owner correction: "we need to have the same
            // separator everywhere. so there needs to be the same size of
            // the border left right up and down." MOBILE ONLY — matches
            // `StoaAccountsTab.tsx`'s identical fix; `useMobileSeedPageSize`
            // subtracts this same padding back out of the measured
            // `clientHeight` before packing.
            padding: isMobile ? SEED_ROW_GAP : undefined,
          }}
        >
          {isMobile ? (
            // Round 21 — the drag-following two-pane swipe carousel, ported
            // from `ArweaveSeedsArea.tsx`'s identical structure (see the
            // hooks above for the full reasoning).
            <div
              data-testid="stoa-seeds-page-swipe-track"
              style={{
                display: "flex", flexDirection: "row",
                transform: `translateX(${(seedDragDirection === "prev" ? -(seedsPageContainerRef.current?.clientWidth || 320) : 0) + seedDragX}px)`,
                transition: seedDragTransition ? `transform ${SEED_SWIPE_SETTLE_MS}ms ease-out` : "none",
              }}
            >
              {seedDragDirection === "prev" && (
                <div style={{ width: seedsPageContainerRef.current?.clientWidth || 320, flexShrink: 0, display: "flex", flexDirection: "column", gap: SEED_ROW_GAP }}>
                  {renderSeedsPage(clampedPage - 1, false)}
                </div>
              )}
              <div
                style={{
                  width: seedDragDirection ? (seedsPageContainerRef.current?.clientWidth || 320) : "100%",
                  flexShrink: 0, display: "flex", flexDirection: "column", gap: SEED_ROW_GAP,
                }}
              >
                {renderSeedsPage(clampedPage, true)}
              </div>
              {seedDragDirection === "next" && (
                <div style={{ width: seedsPageContainerRef.current?.clientWidth || 320, flexShrink: 0, display: "flex", flexDirection: "column", gap: SEED_ROW_GAP }}>
                  {renderSeedsPage(clampedPage + 1, false)}
                </div>
              )}
            </div>
          ) : (
            renderSeedsPage(0, false)
          )}
        </div>
      )}

      {/* Pagination — mobile only (design.md §8: "we need to add pagination
          to the seeds as well, similar to what we did with the Ouronet
          accounts"). Round 8 follow-up — owner correction: "if we bring
          the pagination engine in the bar below (see 4th screenshot),
          probably 4 would have fit. because here there is no expand
          collapse button, clicking seed brings it content full screen."
          Portaled OUT of the measured/paginated column entirely (into
          `fullScreenPortalTarget`, the same whole-screen target the
          full-screen seed detail already uses) and docked to the bottom
          edge — it no longer competes with the seed list for one of the
          column's own flex rows, so `useMobileSeedPageSize` sees that much
          MORE available height to pack seed rows into. Falls back to the
          old inline placement (still functionally identical) when no
          portal target is supplied. Round 9 — "standard pagination
          controls zone": once a caller opts into
          `onPaginationHandleChange`, THIS rendering is suppressed entirely
          — `ChainwebPanel` renders the shared medallion version instead
          (see that prop's own doc comment). */}
      {!reportsPaginationExternally && isMobile && totalPages > 1 && (
        <MobilePortal target={fullScreenPortalTarget}>
          <div
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
              position: fullScreenPortalTarget ? "absolute" : undefined,
              left: fullScreenPortalTarget ? 0 : undefined,
              right: fullScreenPortalTarget ? 0 : undefined,
              bottom: fullScreenPortalTarget ? 12 : undefined,
              marginTop: fullScreenPortalTarget ? undefined : 4,
              zIndex: fullScreenPortalTarget ? 5 : undefined,
              pointerEvents: fullScreenPortalTarget ? "none" : undefined,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, pointerEvents: "auto" }}>
              <button
                type="button"
                aria-label="Previous page"
                onClick={() => setPage(Math.max(0, clampedPage - 1))}
                disabled={clampedPage === 0}
                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 8, border: "1px solid #262626", background: "transparent", color: "#d2d3d4", cursor: clampedPage === 0 ? "default" : "pointer", opacity: clampedPage === 0 ? 0.3 : 1 }}
              >
                <ChevronLeft size={14} />
              </button>
              <PageJumpIndicator page={clampedPage} totalPages={totalPages} onJump={setPage} />
              <button
                type="button"
                aria-label="Next page"
                onClick={() => setPage(Math.min(totalPages - 1, clampedPage + 1))}
                disabled={clampedPage >= totalPages - 1}
                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 8, border: "1px solid #262626", background: "transparent", color: "#d2d3d4", cursor: clampedPage >= totalPages - 1 ? "default" : "pointer", opacity: clampedPage >= totalPages - 1 ? 0.3 : 1 }}
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </MobilePortal>
      )}

      {createOpen && <CreateStoaChainSeedModal onClose={() => setCreateOpen(false)} fullScreenPortalTarget={fullScreenPortalTarget} />}
    </div>
  );
}

export default SeedWordsTab;
