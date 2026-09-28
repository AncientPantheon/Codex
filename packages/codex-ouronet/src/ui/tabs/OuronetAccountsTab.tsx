/**
 * OuronetAccountsTab — 1:1 clone of OuronetUI's My Codex "Ouronet Accounts"
 * subtab (src/components/settings/OuroAccountList.tsx + the parent stats bar
 * with the Spawn buttons), rebuilt Redux-free over the package hooks.
 *
 * Fidelity target: the exact OuronetUI visuals — Total Accounts header +
 * Spawn Standard/Smart buttons, Standard/Smart filter with counts, Expand All,
 * top+bottom pagination (7/page), and the collapsible account rows with their
 * full expanded breakdown (Ouronet address, payment key + balance + guard,
 * account guard, StoicTag, sovereign/governor for Smart, public-key integrity,
 * View/Rename/Delete/Activate). APOLLO accounts read "observational"; CodexPrime
 * is locked (no delete); every chain action self-contains in the package.
 *
 * Increment status (v0.3.1): the VIEW is cloned in full and the Rotate
 * Guard/Payment/Sovereign buttons wire to the package's own modals. The
 * Spawn / Activate / Rotate-Governor / StoicTag add+release modals are ported
 * in subsequent increments (v0.3.2+) — their buttons render here for visual
 * fidelity and are marked accordingly until then.
 *
 * Styling: replicates OuronetUI's exact hex palette via inline styles (the
 * package can't assume a Tailwind build), deliberately NOT the abstract
 * --codex-* tokens, which is what made the earlier port look dissimilar.
 */

import * as React from "react";
import { useState, useMemo, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  ChevronsUpDown,
  Eye,
  Lock,
  RotateCw,
  Shield,
  Zap,
  Tag,
  Unlink,
  Landmark,
  PlusCircle,
  Atom,
  Check,
  X,
  User,
  Sparkles,
  KeyRound,
  Link2,
  Star,
} from "lucide-react";

import { useOuroAccounts } from "../../hooks/index.js";
import { useStoaChainSeeds } from "../../hooks/index.js";
import { useActiveWallet } from "../../hooks/index.js";
import { getApiKeySelectorData, isApiKeyRegistered, isApiKeyLinked, DEPLOY_API_KEY_KEY, type ApiKeyRow } from "../../zbom/pythia/deployApiKey.js";
import PreZbomHint from "../../zbom/cfm/PreZbomHint.js";
import { ouronetAccountFillValues, resolvePatronFillValue } from "../../zbom/cfm/preZbomFillMap.js";
import { usePatronSelectionDefaults } from "../../zbom/patron/usePatronSelectionDefaults.js";
import { codexClock } from "../../zbom/debouncer/codexClock.js";
import { usePureKeypairs } from "../../hooks/index.js";
import { useCodex } from "../../hooks/index.js";
import { readObservationalCodexIdConfig, CODEXID_PRIME_NAMES, codexIdPrimeName, useIsMobile, SwipeDeck, type SwipeDeckHandle } from "@ancientpantheon/codex-ui/ui";
import RotatePaymentKeyModal from "../../zbom/modals/RotatePaymentKeyModal.js";
import RotateGuardModal from "../../zbom/modals/RotateGuardModal.js";
import ReleaseStoicTagModal from "../../zbom/modals/ReleaseStoicTagModal.js";
import RegisterStoicTagModal from "../../zbom/modals/RegisterStoicTagModal.js";
import RotateSovereignModal from "../../zbom/modals/RotateSovereignModal.js";
import RotateGovernorModal from "../../zbom/modals/RotateGovernorModal.js";
import ActivateStandardAccountModal from "../../zbom/modals/ActivateStandardAccountModal.js";
import ActivateSmartAccountModal from "../../zbom/modals/ActivateSmartAccountModal.js";
import ActivateApolloPythiaKeyModal from "../../zbom/modals/ActivateApolloPythiaKeyModal.js";
import { flattenStoaChainAccounts } from "../../zbom/cfm/seam.js";
import { IconCopyBtn, IconDeleteBtn, IconDeleteBtnDisabled, IconRenameBtnRect } from "../internal/IconButtons.js";
import { CodexModalShell } from "../internal/CodexModalShell.js";
import { OuronetAddressHighlight } from "../internal/OuronetAddressHighlight.js";
import { GuardTree } from "../internal/GuardTree.js";
import { detectOriginCurve } from "../internal/originCurve.js";
import { addrColor, identifyKeySource } from "../internal/keySource.js";
import { useAccountChainData } from "../internal/useAccountChainData.js";
import { usePostTxRefresh } from "../../zbom/toast/usePostTxRefresh.js";
import { MONO, GoldenBtn, VioletBtn, GreenBtn, pillStyle, sectionBox, sectionLabel } from "../internal/accountFields.js";
import { ViewSeedModal } from "../internal/ViewSeedModal.js";
import { SpawnAccountModal } from "../internal/SpawnAccountModal.js";
import { SingleApiPanel } from "./SingleApiPanel.js";
import { DualApiPanel } from "./DualApiPanel.js";
import type { AccountSelectorData } from "@ouronet/ouronet-core/interactions/ouroTypes";
import type { IOuroAccount, IStoaChainSeed, IPureKeypair, IStoaChainWallet } from "../../types/entities.js";

/** Overlay live URC_0027 chain state onto a codex account for display. The
 *  codex store stays the at-rest source of truth; chain fields win when present. */
function hydrate(account: IOuroAccount, d?: AccountSelectorData): IOuroAccount {
  if (!d) return account;
  const sovereign = d["sovereign"];
  const governor = d["governor"];
  const accountGuard = d["ouronet-account-guard"];
  const pkGuard = d["payment-key-guard"];
  return {
    ...account,
    isActive: d["iz-activated"],
    guard: accountGuard && accountGuard !== false ? accountGuard : account.guard,
    // Every registered Ouronet account ALWAYS has a payment key assigned at
    // activation. `payment-key-existance` does NOT mean "has a payment key" — it
    // reports whether that payment-key ADDRESS has ever held STOA (has a row in
    // the coin table): virgin (never funded) vs funded. So surface the payment
    // key address whenever the chain returns one, regardless of funding; gating
    // on `payment-key-existance` here wrongly hid the entire section for a virgin
    // (never-funded) payment key. The funding flag only drives the balance / the
    // "virgin" marker (see `paymentKeyFunded` below), never whether it shows.
    stoaChainLedger: d["payment-key"] || account.stoaChainLedger,
    paymentKeyGuard: pkGuard !== false && pkGuard != null ? pkGuard : account.paymentKeyGuard,
    chainPublicKey: d["public-key"] || account.chainPublicKey,
    sovereign: sovereign !== false ? (sovereign as string) : account.sovereign,
    governor: governor !== false && governor != null ? governor : account.governor,
    stoicTag: d["stoic-tag-has"] ? d["stoic-tag"] : undefined,
  };
}

/* APOLLO observational-curve accents — Standard ₱. orange, Smart Π. cherry. */
const APOLLO_COLOR = "#f97316";
const APOLLO_SMART_COLOR = "#a01b3f";
/** DESKTOP's own fixed page size — unchanged/independent of mobile now
 *  (docs/work/codex-ui-mobile/design.md §8, the "variable mobile
 *  pagination" round: "we keep a fixed 10 entry per page on desktop").
 *  Mobile no longer shares this constant at all — see `useMobilePageSize`. */
const DESKTOP_ACCOUNTS_PER_PAGE = 10;

/** Fallback px height of one COMPACT (icon-badge) mobile account row, used
 *  ONLY before the first real row has mounted/measured (jsdom / no layout
 *  yet) — see `useMobilePageSize`'s `rowRef`. This USED to be the only
 *  source of truth (a rough guess), which is exactly why the last row of a
 *  page could render cut off (owner correction, design.md §8, round 8:
 *  "entries musnt be displayed not whole... entries must be displayed only
 *  in their entirety, everywhere") — a real `AccountRow` header (32px icon
 *  + `12px 16px` padding + border) actually renders taller than this
 *  guess, so packing `usable / 44` rows per page put one MORE row on the
 *  page than the measured Zone 3 box could actually show in full, leaving
 *  it sliced at the bottom. `rowRef`, wired to the FIRST real row rendered
 *  each mount, now measures the TRUE height live and corrects `pageSize`
 *  the instant it lands. */
const MOBILE_ROW_HEIGHT_FALLBACK = 44;
const MOBILE_ROW_GAP = 8;

/**
 * Measures Zone 3's actual available content height (via the SAME
 * ResizeObserver-driven technique `CompactHalf`/`MiddleEllipsis` use
 * elsewhere in this codebase) and computes EXACTLY how many rows fit —
 * docs/work/codex-ui-mobile/design.md §8, the "variable mobile pagination"
 * round: "we need to rethink the pagination and make it variable, depending
 * on how much we can fit on the screen... there is a lot of wasted space
 * here... simply recount the number of pages needed." This SUPERSEDES the
 * previous quantized-divisor scheme (a fixed candidate pool of
 * `[12, 6, 4, 3]`, snapping DOWN to the nearest one even when more rows
 * would genuinely fit — the exact "wasted space" the owner flagged) — the
 * page size IS the measured count, with no snapping, and there is no more
 * separate outer/inner (page-of-12 vs swipe-chunk) split: one "page" now
 * simply means "however many rows currently fit," and swiping between
 * pages IS the pagination (see the main component's `chunksPerPage = 1`
 * usage below). Starts at a conservative default (`4`) before the first
 * real measurement lands, matching this codebase's established "safe
 * default, corrected once real measurement resolves" convention. `rowRef`
 * must be attached to the wrapper of the FIRST real `AccountRow` rendered
 * (every row is a single, non-wrapping line in compact mode, so one
 * measurement is representative of all of them) — round 8's fix for the
 * cut-off-last-row bug (see `MOBILE_ROW_HEIGHT_FALLBACK` above).
 *
 * Round 8 follow-up bug fix — owner correction: "first page has 8, second
 * page has 7, leaving one position open, third page again 7... if 8
 * positions fit on a page, they must all be occupied": this hook used to
 * bake a PRIME-ROW deduction into the returned `pageSize` itself, so every
 * chunk (not just chunk 0, the only one that actually carries the pinned
 * CodexPrime/APOLLO-prime rows) was sliced one-or-more slots SMALLER than
 * it needed to be, leaving a real empty slot at the bottom of every OTHER
 * page. This hook now returns the FULL page capacity (no prime deduction
 * at all — it doesn't know about pinned rows anymore); the caller (which
 * DOES know how many prime rows chunk 0 alone carries) subtracts that
 * count from `pageSize` ONLY when sizing chunk 0's own slice, leaving
 * every other page's slice at full capacity.
 */

/**
 * One swipe pane's own scrollable body. Carries `scroll-snap-type:
 * mandatory` with its rows opting in via `scrollSnapAlign` (design.md §8,
 * round 8: "no more incomplete viewing of entries on the list... this must
 * be done everywhere").
 *
 * A JS-enforced backstop (`useSnapScrollCorrection`) was tried on top of
 * this CSS mechanism and REMOVED again — see `ChainwebPanel`'s own doc
 * comment at its (former) call site for the full account: it actively
 * fought the user's own scroll gesture across three separate live-reported
 * regressions in a row, most recently "once i colapse a seed... i scroll
 * and it moves me... the hook behave eratically." Plain CSS scroll-snap,
 * no JS correction, stays the mechanism here.
 */
function SwipeChunkPane({ i, children }: { i: number; children: React.ReactNode }) {
  return (
    <div
      data-mobile-swipe-chunk={i}
      style={{ height: "100%", overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, scrollSnapType: "y mandatory" }}
    >
      {children}
    </div>
  );
}
function useMobilePageSize(): {
  ref: React.RefObject<HTMLDivElement | null>;
  rowRef: (node: HTMLDivElement | null) => void;
  pageSize: number;
} {
  const ref = useRef<HTMLDivElement>(null);
  // A CALLBACK ref (not a plain `useRef`) — a plain ref's `.current` change
  // doesn't itself trigger a re-render/effect run, so the measuring effect
  // below would only ever see whatever was mounted on the FIRST render
  // (`null`, before any row exists). Routing the DOM node through state
  // instead means attaching it (once the first real row mounts) reliably
  // fires the measuring effect.
  const [rowEl, setRowEl] = useState<HTMLDivElement | null>(null);
  const [rowHeight, setRowHeight] = useState(MOBILE_ROW_HEIGHT_FALLBACK);
  const [pageSize, setPageSize] = useState(4);

  useEffect(() => {
    if (!rowEl) return;
    const measure = () => {
      const h = rowEl.getBoundingClientRect().height;
      if (h > 0) setRowHeight(h);
    };
    measure();
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measure);
      ro.observe(rowEl);
    }
    return () => ro?.disconnect();
  }, [rowEl]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const compute = () => {
      const height = el.clientHeight;
      if (height <= 0) return;
      const maxRows = Math.floor((height + MOBILE_ROW_GAP) / (rowHeight + MOBILE_ROW_GAP));
      setPageSize(Math.max(1, maxRows));
    };
    compute();
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(compute);
      ro.observe(el);
    }
    return () => ro?.disconnect();
  }, [rowHeight]);

  return { ref, rowRef: setRowEl, pageSize };
}

/** Pact returns decimals as `{ decimal: "…" }` objects. Rendering one directly
 *  as a React child throws "Objects are not valid as a React child" (#31) and
 *  blanks the page — hit when expanding an account whose payment key holds a
 *  balance. Coerce to the inner string; tolerate plain number/string;
 *  null/undefined → null (so the `!== null` render guard still hides it). */
const decimalToDisplay = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === "object" && "decimal" in (v as object)) {
    return String((v as { decimal: unknown }).decimal);
  }
  return String(v);
};

export interface OuronetAccountsTabProps {
  className?: string;
  /**
   * Where the mobile pagination stripe's Prev/Next cluster should mount, via
   * `createPortal` — a DOM node flush against a host's OWN bottom tab bar,
   * centered between the Controls and Address Book risers (docs/work/
   * codex-ui-mobile/design.md §8, the "Zone 3" round: "the Prev/Next page
   * controllers would appear... as a middle stripe... similar to Controls
   * and Address Book"). Mirrors `CodexTabs`' own `addressBookRiserTarget`
   * contract exactly — omitted (the default) falls back to positioning the
   * cluster relative to this component's own frame.
   */
  paginationRiserTarget?: Element | null;
  /**
   * Where the SEPARATE swipe-bullets strip should mount, via `createPortal`
   * — a DOM node spanning the host's full width, positioned in the gap
   * directly BELOW Zone 3's own bordered box (NOT the same stripe as the
   * Prev/Next pagination riser above). Owner correction (the follow-up
   * feedback round): "the bullet I was talking about is something beneath
   * Zone 3, and is specific to Zone 3... they work in concert but they are
   * different entities... I want the bullets where they are on the Ouronet
   * UI, outside of the Zone 3 box" — i.e. NOT merged into the Prev/Next
   * stripe (that reverted back to its original "N / M" text form; see
   * `paginationRiserTarget`). Mirrors the other riser-target contracts —
   * omitted (the default) falls back to positioning the strip relative to
   * this component's own frame.
   */
  swipeIndicatorRiserTarget?: Element | null;
  /**
   * A DOM node spanning the host's WHOLE mobile body, via `createPortal` —
   * design.md §8, the "Zone 3" feedback round: "when clicking the spawning
   * of new accounts, doing so shows the spawning interface, on the whole
   * screen, not only on zone 3." When supplied, the mobile Spawn Standard/
   * Smart `SpawnAccountModal` portals there instead of into this
   * component's own (Zone-3-bounded) frame — mirrors `CodexTabs`' own
   * `fullScreenPortalTarget` contract exactly. Omitted (the default) falls
   * back to the ORIGINAL inline mount — safe for any consumer that hasn't
   * wired a target. Desktop is unaffected either way (its own
   * `CodexModalShell` already renders `position: fixed` against the
   * viewport, never bounded by this component's frame).
   */
  fullScreenPortalTarget?: Element | null;
}

/* Green pillar marker — at-a-glance "account has an active StoicTag" + the
 * high-end hover card (the inscription-style §tag), ported 1:1 from My Codex's
 * StoicTagPillar. CSS/state hover popover (no Radix dependency in the package). */
function StoicTagPillar({ tag }: { tag: string }) {
  const [hover, setHover] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const DISPLAY = "var(--codex-font-display, 'Cinzel', serif)";

  // The hover card is portalled to <body> with fixed positioning so it escapes
  // both the header <button> (a div can't legally nest in a button) and the
  // account row's overflow:hidden — either of which previously clipped/broke it.
  const show = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setCoords({ left: r.left + r.width / 2, top: r.top });
    setHover(true);
  };

  const card = hover && coords
    ? createPortal(
        <div
          style={{
            position: "fixed", left: coords.left, top: coords.top - 10,
            transform: "translate(-50%, -100%)", pointerEvents: "none",
            zIndex: 2147483647, width: "max-content", maxWidth: 360, padding: "14px 16px", borderRadius: 12,
            backgroundColor: "#08120c", border: "1px solid #16a34a55",
            boxShadow: "0 0 26px 2px rgba(74,222,128,0.18), 0 14px 44px rgba(0,0,0,0.65)",
          }}
        >
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
            <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", width: 58, height: 58, borderRadius: 12, background: "radial-gradient(circle at 50% 32%, rgba(22,163,74,0.28), #08120c 72%)", border: "1px solid #16a34a45" }}>
              <Landmark style={{ width: 36, height: 36, color: "#4ade80" }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: DISPLAY, fontSize: 10, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: "#16a34a", marginBottom: 7 }}>StoicTag</div>
              <div style={{ fontFamily: DISPLAY, fontWeight: 600, color: "#7ef0a3", lineHeight: 1.4, wordBreak: "break-word", overflowWrap: "anywhere", textShadow: "0 0 12px rgba(74,222,128,0.35)", maxWidth: 260, maxHeight: 210, overflowY: "auto" }}>
                <span style={{ fontSize: 34, fontWeight: 700, marginRight: 2 }}>§</span>
                {Array.from(tag).map((ch, i) => {
                  const isUpper = ch !== ch.toLowerCase() && ch === ch.toUpperCase();
                  return <span key={i} style={{ fontSize: isUpper ? 27 : 20 }}>{ch}</span>;
                })}
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <span
      ref={triggerRef}
      style={{ position: "relative", display: "inline-flex", alignItems: "center", flexShrink: 0, color: "#4ade80", cursor: "help" }}
      onMouseEnter={show}
      onMouseLeave={() => setHover(false)}
      aria-label="Active StoicTag"
    >
      <Landmark style={{ width: 14, height: 14 }} />
      {card}
    </span>
  );
}

/** A small icon-only badge (docs/work/codex-ui-mobile/design.md §8, the
 *  "Zone 3" feedback round) — `AccountRow`'s `compact` mode's replacement
 *  for a text pill: the full text still carries via `title`/`aria-label`. */
function IconBadge({ icon, bg, color, label }: { icon: React.ReactNode; bg: string; color: string; label: string }) {
  return (
    <span
      title={label}
      aria-label={label}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 20, height: 20, borderRadius: 9999, flexShrink: 0,
        backgroundColor: bg, color,
      }}
    >
      {icon}
    </span>
  );
}

/* ─── Account Row ─── */
/** A labeled divider between prime CodexID entities and the normal accounts. */
function PrimeSeparator({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "2px 0" }}>
      <div style={{ flex: 1, height: 1, backgroundColor: "#262626" }} />
      <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#555" }}>{label}</span>
      <div style={{ flex: 1, height: 1, backgroundColor: "#262626" }} />
    </div>
  );
}

/** Format a Pact `time` value (serialized as `{ time: "…" }` / `{ timep: "…" }`
 *  or a bare ISO string) to a human-readable local timestamp. */
function formatPactTime(t: unknown): string {
  if (t == null) return "—";
  const raw =
    typeof t === "string"
      ? t
      : (t as any)?.time ?? (t as any)?.timep ?? null;
  if (!raw) return "—";
  const d = new Date(raw);
  return isNaN(d.getTime()) ? String(raw) : d.toLocaleString();
}

/** Portals `children` into `target` when supplied, otherwise renders them
 *  inline — the same "no-op fallback" shape `SeedWordsTab.tsx`'s own
 *  `MobilePortal` and `PureKeysArea.tsx`'s own `MobilePortal` already use, so
 *  a caller that hasn't wired a `fullScreenPortalTarget` still gets a working
 *  (if Zone-3-bounded) `CodexModalShell` instead of nothing. */
function MobilePortal({ target, children }: { target?: Element | null; children: React.ReactNode }) {
  return target ? createPortal(children, target) : <>{children}</>;
}

function AccountRow({
  account, index, seeds, pureKeypairs, accounts, stoaChainAccounts, forceExpanded, paymentBalance, paymentKeyFunded, primeName,
  apiKeyRow, apiKeyLoaded, expandable = true, compact = false, fullScreenPortalTarget,
}: {
  account: IOuroAccount;
  index: number;
  seeds: IStoaChainSeed[];
  pureKeypairs: IPureKeypair[];
  accounts: IOuroAccount[];
  stoaChainAccounts: IStoaChainWallet[];
  forceExpanded: boolean;
  paymentBalance: string | number | null;
  /** Chain `payment-key-existance`: whether the payment-key address has ever
   *  held STOA (funded) vs never (virgin). `null` until the chain read resolves.
   *  Drives only the "virgin" marker — never whether the payment key shows. */
  paymentKeyFunded: boolean | null;
  /** When set, this account is a prime CodexID half — shown with this name
   *  (StandardCodexID/SmartCodexID + original), locked + non-deletable. */
  primeName?: string;
  /** The Pythia registration row for this Apollo, from the tab-level batch read
   *  (`P-UI-ONE.URC_01|ApiKeys` — DPL-UR chain-symbol audit, 2026-09-25:
   *  switched from the archived `DPL-UR.URC_0031`; see `deployApiKey.ts`'s
   *  doc comment on `getApiKeySelectorData`). `null` = observational;
   *  undefined until loaded. */
  apiKeyRow?: ApiKeyRow | null;
  apiKeyLoaded?: boolean;
  /**
   * Whether tapping the row header toggles its expand at all (docs/work/
   * codex-ui-mobile/design.md §8, the "Zone 3" round). Default true. On
   * mobile this now drives the FULL-SCREEN popup below (see
   * `fullScreenPortalTarget`), not an inline block — the owner's follow-up
   * correction ("we remove the expansion but we forgot to readd it...
   * normally the content... should be a display fullscreen of its expansion
   * box") restored it after an earlier round had disabled it outright
   * (`expandable={false}`) to avoid shipping the OLD Zone-3-breaking inline
   * expand while the real full-screen version wasn't built yet. Desktop is
   * unaffected either way (still the original inline block).
   */
  expandable?: boolean;
  /**
   * Icon-only badges instead of text pills for Prime/Standard-Smart/
   * Selected/Active (docs/work/codex-ui-mobile/design.md §8, the "Zone 3"
   * feedback round): "instead of the active green text, we should show an
   * icon, and use icons instead of text, for Prime Standard Selected and
   * active — you already used icon for standard and smart in the upper bar
   * button, use that." Standard/Smart reuse the EXACT SAME `User`/
   * `Sparkles` icons the mobile filter row uses. Default false (desktop,
   * unchanged) — StoicTag/APOLLO badges are UNCHANGED either way (not named
   * in the directive).
   */
  compact?: boolean;
  /**
   * MOBILE ONLY — a DOM node spanning the host's WHOLE mobile body, via
   * `createPortal`; threaded straight through from `OuronetAccountsTabProps`
   * (see its own doc comment, which already documents this contract for the
   * mobile Spawn modal) to this row's own full-screen expand popup. Omitted
   * (the default) falls back to a `CodexModalShell` bounded to this
   * component's own Zone-3 frame, same as every other `CodexModalShell`
   * caller in this codebase without a portal target.
   */
  fullScreenPortalTarget?: Element | null;
}) {
  const { updateAccount, deleteAccount } = useOuroAccounts();
  const isMobile = useIsMobile();
  const [localExpanded, setLocalExpanded] = useState(false);
  const expanded = forceExpanded || localExpanded;
  // A single ZBOM host serves all seven codex operations for this row; the open
  // operation is identified by its stable id (null ⇒ closed).
  const [activeOpId, setActiveOpId] = useState<string | null>(null);
  const [viewSeedOpen, setViewSeedOpen] = useState(false);

  const isFirst = index === 0;
  const isCodexIdPrime = !!primeName;
  const locked = isFirst || isCodexIdPrime;
  const displayName = primeName ?? (isFirst ? "CodexPrime" : account.name || `Account #${index + 1}`);

  // Pre-ZBOM tooltip canon rule 7 ("fill every parameter you can, and prove
  // it") — ONE fill map (preZbomFillMap.ts), not hand-rolled per button.
  // `accountFillValues` covers every confirmed "this account" alias
  // (`executor`/`account`/`owner-account`/`apollo-account`); `patronFillValue`
  // mirrors the SAME resident-vs-prime resolution every ZBOM modal's own
  // `usePatronSelectionDefaults` + `accounts[0]` seed already uses at mount,
  // so the hover tooltip shows the SAME patron the modal is about to open
  // with, not a guess.
  const { initialPatronMode } = usePatronSelectionDefaults();
  const accountFillValues = ouronetAccountFillValues(account.address);
  const patronFillValue = resolvePatronFillValue(initialPatronMode, account.address, accounts[0]?.address);
  const withPatron = patronFillValue ? { ...accountFillValues, patron: patronFillValue } : accountFillValues;
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(displayName);
  const commitRename = () => {
    const next = draftName.trim();
    if (next && next !== displayName) void updateAccount({ ...account, name: next });
    setRenaming(false);
  };
  const stoicTag = account.stoicTag;
  const isStandard = !account.isSmart;
  const originCurve = detectOriginCurve(account);
  const isApollo = originCurve === "apollo";
  const apolloAccent = account.isSmart ? APOLLO_SMART_COLOR : APOLLO_COLOR;
  const guardKeyCount = account.guard?.keys?.length ?? 0;
  const isActivated = account.isActive === true;

  // Global "selected Ouronet account" — the active DALOS account the Codex's
  // operations (e.g. the Pythia deploy's owner-account) read. Only ACTIVATED,
  // non-Apollo Ouronet accounts are selectable (an Apollo key can't be an owner
  // and can't transact). The Atom icon is the toggle; the chevron still expands.
  const { activeOuroAccountId, setActiveOuroAccount } = useActiveWallet();
  // Any non-Apollo Ouronet account can be selected as the operations owner (an
  // Apollo key can't own itself). We don't gate on the local `isActive` flag —
  // on-chain guard resolution decides usability at operation time.
  const canSelect = !isApollo;
  const isSelected = canSelect && activeOuroAccountId === account.id;

  // Pythia registration — derived from the tab-level batch read (URC_0031),
  // delivered via props. No per-row chain read.
  const isRegistered = isApollo && isApiKeyRegistered(apiKeyRow);
  // For the Public-Key "matches chain" tag: activated Ouronet accounts carry
  // `chainPublicKey`; a registered Apollo's chain key is the row's `public`.
  const effectiveChainPub = account.chainPublicKey ?? (isRegistered ? apiKeyRow?.public : undefined);

  const paymentSource = account.stoaChainLedger
    ? identifyKeySource(account.stoaChainLedger, seeds, pureKeypairs)
    : { label: "", color: "#888" };

  const rowBorderColor = isApollo ? apolloAccent + "55" : isFirst ? "#ceac5f40" : isActivated ? "#262626" : "#8b1a1a50";
  const rowBgColor = isApollo ? apolloAccent + "08" : isFirst ? "#ceac5f08" : isActivated ? "#18181B" : "#8b1a1a08";
  const nameColor = isApollo ? apolloAccent : isFirst ? "#ceac5f" : isActivated ? "#d2d3d4" : "#c0392b";

  return (
    <div
      data-account-id={account.id}
      style={{
        border: `${guardKeyCount > 1 ? 2 : 1}px solid ${rowBorderColor}`,
        borderRadius: 12, overflow: "hidden", backgroundColor: rowBgColor, transition: "all 0.2s",
      }}
    >
      {/* Header — the row toggles expand/collapse; the Atom icon is a separate
          account-selector button (activated non-Apollo Ouronet accounts only). */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => { if (expandable) setLocalExpanded(!localExpanded); }}
        onKeyDown={(e) => { if (!expandable) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setLocalExpanded(!localExpanded); } }}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
          textAlign: "left", background: "transparent", border: "none",
          cursor: expandable ? "pointer" : "default",
        }}
      >
        {expandable && (expanded
          ? <ChevronDown style={{ width: 16, height: 16, flexShrink: 0, color: "#ceac5f" }} />
          : <ChevronRight style={{ width: 16, height: 16, flexShrink: 0, color: "#555" }} />)}
        {canSelect ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setActiveOuroAccount(isSelected ? null : account.id); }}
            title={isSelected ? "Selected Ouronet account — click to deselect" : "Select this Ouronet account (makes it the active owner for operations)"}
            aria-pressed={isSelected}
            style={{
              width: 32, height: 32, borderRadius: 9999, display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0, cursor: "pointer", padding: 0,
              backgroundColor: isSelected ? "#ceac5f22" : "#262626",
              border: isSelected ? "2px solid #ceac5f" : "2px solid transparent",
              boxShadow: isSelected ? "0 0 10px #ceac5f66" : "none",
              transition: "all 0.15s",
            }}
          >
            <Atom style={{ width: 20, height: 20, color: "#ceac5f" }} />
          </button>
        ) : (
          <div style={{ width: 32, height: 32, borderRadius: 9999, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, backgroundColor: "#262626" }}>
            <Atom style={{ width: 20, height: 20, color: isApollo ? apolloAccent : "#555" }} />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: nameColor }}>{displayName}</span>
            {locked && (compact ? (
              <IconBadge
                icon={<Lock size={11} />}
                bg={`${isCodexIdPrime ? apolloAccent : "#ceac5f"}20`}
                color={isCodexIdPrime ? apolloAccent : "#ceac5f"}
                label="Prime"
              />
            ) : (
              <span style={pillStyle(
                `${isCodexIdPrime ? apolloAccent : "#ceac5f"}20`,
                isCodexIdPrime ? apolloAccent : "#ceac5f",
              )}>🔒 Prime</span>
            ))}
            {stoicTag && <StoicTagPillar tag={stoicTag} />}
            {compact ? (
              <IconBadge
                icon={isStandard ? <User size={11} /> : <Sparkles size={11} />}
                bg={isApollo ? apolloAccent + "20" : isStandard ? "#ceac5f20" : "#8b5cf620"}
                color={isApollo ? apolloAccent : isStandard ? "#ceac5f" : "#a78bfa"}
                label={isStandard ? "Standard" : "Smart"}
              />
            ) : (
              <span style={pillStyle(
                isApollo ? apolloAccent + "20" : isStandard ? "#ceac5f20" : "#8b5cf620",
                isApollo ? apolloAccent : isStandard ? "#ceac5f" : "#a78bfa",
              )}>
                {isStandard ? "Standard" : "Smart"}
              </span>
            )}
            {isApollo && (compact ? (
              // Icon badge, not the full "APOLLO · observational/registered"
              // text pill — the follow-up feedback round: this pill was the
              // ONE badge the earlier icon-badge pass overlooked (only
              // Prime/Standard-Smart/Selected/Active were converted), and
              // its wide text was wide/wrapping enough on longer names to
              // make THIS row taller than its neighbours, throwing off
              // cross-chunk row alignment ("entries from different swipes
              // are not on the same level"). `KeyRound` — the SAME icon the
              // mobile filter row's "Single API" tab already uses (APOLLO
              // accounts ARE the API-key halves that tab lists).
              <IconBadge
                icon={<KeyRound size={11} />}
                bg={apolloAccent + "20"}
                color={apolloAccent}
                label={isRegistered ? "APOLLO — registered" : (apiKeyLoaded ? "APOLLO — observational" : "APOLLO")}
              />
            ) : (
              <span style={pillStyle(apolloAccent + "15", apolloAccent, apolloAccent + "40")} title={isRegistered ? "APOLLO (₱./Π.) — deployed on-chain as a Pythia API key." : "APOLLO (₱./Π.) — a Pythia API-key account. Observational until you deploy it as a Pythia key."}>
                APOLLO · {isRegistered ? "registered" : (apiKeyLoaded ? "observational" : "…")}
              </span>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {isSelected && (compact ? (
            <IconBadge icon={<Star size={11} />} bg="#ceac5f20" color="#ceac5f" label="Selected — the active Ouronet account used as the owner for operations." />
          ) : (
            <span style={pillStyle("#ceac5f20", "#ceac5f", "#ceac5f60")} title="This is the active Ouronet account used as the owner for operations.">
              ★ Selected
            </span>
          ))}
          {compact ? (
            <IconBadge
              icon={(isApollo ? isRegistered : isActivated) ? <Check size={11} /> : <X size={11} />}
              bg={isApollo ? (isRegistered ? "#22c55e20" : apolloAccent + "20") : isActivated ? "#22c55e20" : "#8b1a1a20"}
              color={isApollo ? (isRegistered ? "#4ade80" : apolloAccent) : isActivated ? "#4ade80" : "#c0392b"}
              label={isApollo ? (isRegistered ? "Registered" : "Observational") : isActivated ? "Active" : "Inactive"}
            />
          ) : (
            <span style={pillStyle(
              isApollo ? (isRegistered ? "#22c55e20" : apolloAccent + "20") : isActivated ? "#22c55e20" : "#8b1a1a20",
              isApollo ? (isRegistered ? "#4ade80" : apolloAccent) : isActivated ? "#4ade80" : "#c0392b",
            )}>
              {isApollo ? (isRegistered ? "Registered" : "Observational") : isActivated ? "Active" : "Inactive"}
            </span>
          )}
        </div>
      </div>

      {/* Expanded content — owner correction: "ive added an ouronet smart
          account, but it seems im missing the expand button for ouronet
          accounts. we remove the expansion but we forgot to readd it.
          Normally the content of the Ouronet Account, when clicked on the
          entry, should be a display fullscreen of its expansion box." An
          earlier round disabled mobile's inline expand outright
          (`expandable={false}` at both mobile `AccountRow` call sites) to
          avoid shipping the old Zone-3-bounded behavior before the real
          full-screen version existed — that also silently dropped the
          chevron affordance itself (gated on the same `expandable` prop),
          which is the "missing expand button" being reported here. Fix
          mirrors `SeedRow`'s (round 21) and `PureKeyRow`'s (round 27) own
          "expandedContent extracted once, wrapper differs by platform"
          pattern exactly: identical content either way, MOBILE portals it
          into a full-screen `CodexModalShell` (via `fullScreenPortalTarget`)
          instead of growing the row inline, desktop keeps the original
          inline block byte-identical. */}
      {expanded && (() => {
        const expandedContent = (
          <>
          {/* Ouronet Address */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, minWidth: 0, overflow: "hidden", backgroundColor: "#080808", border: "1px dashed #2a2a2a", borderRadius: 6, padding: "5px 6px 5px 8px" }}>
            <span style={{ ...sectionLabel, letterSpacing: "0.08em" }}>{isApollo ? "Apollo Account" : "Ouronet Account"}</span>
            <Lock style={{ width: 12, height: 12, flexShrink: 0, color: "#444" }} />
            <OuronetAddressHighlight address={account.address} />
            <IconCopyBtn text={account.address} size={24} />
          </div>

          {/* Payment Key + guard */}
          {isActivated && account.stoaChainLedger && (
            <div style={sectionBox}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={sectionLabel}>Payment Key</span>
                {paymentBalance !== null && <span style={{ fontSize: 10, fontFamily: MONO, color: "#ceac5f" }}>{paymentBalance} STOA</span>}
                {/* Virgin = the payment-key address has never held STOA (no coin-table
                    row). The key still exists (assigned at activation); this only
                    explains the absent balance + guard. */}
                {paymentKeyFunded === false && (
                  <span style={pillStyle("#3f3f46", "#a1a1aa")} title="This payment-key address has never held STOA — it has no coin-table row yet (virgin). It still exists and can receive STOA.">
                    virgin · never funded
                  </span>
                )}
                <div style={{ flex: 1 }} />
                <PreZbomHint entrypoint="TS01-C1.DALOS|C_RotateStoa" values={withPatron}>
                  <GoldenBtn icon={<RotateCw style={{ width: 14, height: 14 }} />} label="Rotate Payment Key" onClick={() => setActiveOpId("rotate-payment-key")} />
                </PreZbomHint>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                <code style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, wordBreak: "break-all", flex: 1, color: addrColor(account.stoaChainLedger) }}>{account.stoaChainLedger}</code>
                {paymentSource.label && <span style={{ fontSize: 10, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0, color: paymentSource.color }}>{paymentSource.label}</span>}
                <IconCopyBtn text={account.stoaChainLedger} size={28} />
              </div>
              {account.paymentKeyGuard != null && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #1f1f23" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={sectionLabel}>Payment-Key Guard</span><div style={{ flex: 1 }} />
                  </div>
                  <GuardTree guard={account.paymentKeyGuard} identifyKeySource={(k) => identifyKeySource(k, seeds, pureKeypairs)} />
                </div>
              )}
            </div>
          )}

          {/* Account Guard */}
          {isActivated && account.guard && (
            <div style={sectionBox}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={sectionLabel}>Guard</span><div style={{ flex: 1 }} />
                <PreZbomHint entrypoint="TS01-C1.DALOS|C_RotateGuard" values={withPatron}>
                  <GoldenBtn icon={<Shield style={{ width: 14, height: 14 }} />} label="Rotate Guard" onClick={() => setActiveOpId("rotate-guard")} />
                </PreZbomHint>
              </div>
              <GuardTree guard={account.guard} identifyKeySource={(k) => identifyKeySource(k, seeds, pureKeypairs)} />
            </div>
          )}

          {/* StoicTag */}
          {isActivated && (
            <div style={{ ...sectionBox, border: "1px solid #16a34a30" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={sectionLabel}>StoicTag</span><div style={{ flex: 1 }} />
                {stoicTag
                  ? <PreZbomHint entrypoint="TS01-C4.CODEX|C_ReleaseStoicTag" values={{ ...withPatron, "tag-name": stoicTag }}>
                      <GreenBtn icon={<Unlink style={{ width: 14, height: 14 }} />} label="Release StoicTag" onClick={() => setActiveOpId("release-stoic-tag")} />
                    </PreZbomHint>
                  : <PreZbomHint
                      entrypoint="TS01-C4.CODEX|C_RegisterStoicTag"
                      values={{ ...withPatron, "tag-name": "NewTag", "account-address": account.address }}
                    >
                      <GreenBtn icon={<Tag style={{ width: 14, height: 14 }} />} label="Add StoicTag" onClick={() => setActiveOpId("register-stoic-tag")} />
                    </PreZbomHint>}
              </div>
              {stoicTag ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <code style={{ fontSize: 12, fontWeight: 700, wordBreak: "break-all", color: "#4ade80" }}>§{stoicTag}</code>
                  <IconCopyBtn text={stoicTag} size={28} />
                </div>
              ) : (
                <span style={{ fontSize: 11, fontStyle: "italic", color: "#555" }}>
                  {account.isActive ? "— (no StoicTag registered)" : "— (activate to load from chain)"}
                </span>
              )}
            </div>
          )}

          {/* Sovereign (Smart) */}
          {isActivated && account.isSmart && (
            <div style={{ ...sectionBox, border: "1px solid #8b5cf630" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={sectionLabel}>Sovereign</span>
                <span style={pillStyle("#8b5cf620", "#a78bfa")}>Ѻ. standard account</span>
                <div style={{ flex: 1 }} />
                <PreZbomHint entrypoint="TS01-C1.DALOS|C_RotateSovereign" values={withPatron}>
                  <VioletBtn icon={<RotateCw style={{ width: 14, height: 14 }} />} label="Rotate Sovereign" onClick={() => setActiveOpId("rotate-sovereign")} />
                </PreZbomHint>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                {account.sovereign
                  ? (<><OuronetAddressHighlight address={account.sovereign} /><IconCopyBtn text={account.sovereign} size={28} /></>)
                  : <span style={{ fontSize: 11, fontStyle: "italic", color: "#555" }}>{account.isActive ? "— (no sovereign set on chain)" : "— (activate to load from chain)"}</span>}
              </div>
            </div>
          )}

          {/* Governor (Smart) */}
          {isActivated && account.isSmart && (
            <div style={{ ...sectionBox, border: "1px solid #8b5cf630" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={sectionLabel}>Governor</span><div style={{ flex: 1 }} />
                <PreZbomHint entrypoint="TS01-C1.DALOS|C_RotateGovernor" values={withPatron}>
                  <VioletBtn icon={<RotateCw style={{ width: 14, height: 14 }} />} label="Rotate Governor" onClick={() => setActiveOpId("rotate-governor")} />
                </PreZbomHint>
              </div>
              {account.governor != null
                ? <GuardTree guard={account.governor} identifyKeySource={(k) => identifyKeySource(k, seeds, pureKeypairs)} />
                : <span style={{ fontSize: 11, fontStyle: "italic", color: "#555" }}>{account.isActive ? "— (no governor set on chain)" : "— (activate to load from chain)"}</span>}
            </div>
          )}

          {/* Public Key */}
          <div style={sectionBox}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={sectionLabel}>Public Key</span>
              <span style={pillStyle("#8b1a1a15", "#c0392b", "#8b1a1a40")} title="The public key is derived deterministically from the private key — it cannot be changed.">🔒 immutable</span>
              {effectiveChainPub ? (
                account.publicKey === effectiveChainPub
                  ? <span style={pillStyle("#22c55e20", "#4ade80")}>✓ codex matches chain</span>
                  : <span style={pillStyle("#8b1a1a20", "#c0392b")}>⚠ codex ≠ chain (rotated or corrupted)</span>
              ) : (!isActivated && !isRegistered) ? (
                <span style={pillStyle("#26262680", "#888")}>{isApollo ? "codex only (not registered)" : "codex only (not activated)"}</span>
              ) : null}
              <div style={{ flex: 1 }} />
            </div>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 4 }}>
              <code style={{ fontFamily: MONO, fontSize: 11, wordBreak: "break-all", flex: 1, color: "#c0c0c0" }}>{account.publicKey}</code>
              <IconCopyBtn text={account.publicKey} size={28} />
            </div>
          </div>

          {/* Pythia API Key — shown when the Apollo has been deployed on-chain. */}
          {isRegistered && apiKeyRow && (
            <div style={{ ...sectionBox, border: `1px solid ${apolloAccent}40` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={sectionLabel}>Pythia API Key</span>
                <span style={pillStyle("#22c55e20", "#4ade80")}>registered on-chain</span>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 10, color: "#666" }}>{account.isSmart ? "Π. smart / consumer half" : "₱. standard / slot half"}</span>
              </div>

              <div style={{ marginBottom: 8 }}>
                <span style={sectionLabel}>Ouronet Account Owner</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3, minWidth: 0 }}>
                  <OuronetAddressHighlight address={apiKeyRow["owner-account"]} />
                  <IconCopyBtn text={apiKeyRow["owner-account"]} size={24} />
                </div>
              </div>

              <div style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={sectionLabel}>API Key Counterpart</span>
                  {apiKeyRow.counterpart !== "BAR" && (
                    <span style={pillStyle("#8b1a1a15", "#c0392b", "#8b1a1a40")} title="The counterpart is written once at link time and is immutable.">🔒 immutable</span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3, minWidth: 0 }}>
                  {apiKeyRow.counterpart === "BAR" ? (
                    <span style={{ fontSize: 11, fontStyle: "italic", color: "#888" }}>— not yet linked (BAR)</span>
                  ) : (
                    <>
                      <code style={{ fontFamily: MONO, fontSize: 11, wordBreak: "break-all", flex: 1, color: "#c0c0c0" }}>{apiKeyRow.counterpart}</code>
                      <IconCopyBtn text={apiKeyRow.counterpart} size={24} />
                    </>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", fontSize: 10, color: "#888" }}>
                <span>Registered: <span style={{ color: "#c0c0c0" }}>{formatPactTime(apiKeyRow["registered-at"])}</span></span>
                <span>Updated: <span style={{ color: "#c0c0c0" }}>{formatPactTime(apiKeyRow["updated-at"])}</span></span>
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <button type="button" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, padding: "6px 10px", borderRadius: 6, backgroundColor: "#0a0a0a", border: "1px solid #262626", color: "#d2d3d4", cursor: "pointer" }} onClick={() => setViewSeedOpen(true)}>
              <Eye style={{ width: 14, height: 14 }} /> View Seed
            </button>
            {!locked && (renaming ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <input
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenaming(false); }}
                  style={{ height: 28, fontSize: 12, padding: "0 8px", borderRadius: 6, backgroundColor: "#0a0a0a", border: "1px solid #4ade8060", color: "#d2d3d4" }}
                />
                <button type="button" title="Save" onClick={commitRename} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 6, backgroundColor: "#0a2010", color: "#4ade80", border: "2px solid rgba(20,80,40,0.9)", cursor: "pointer" }}><Check size={13} /></button>
                <button type="button" title="Cancel" onClick={() => setRenaming(false)} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 6, backgroundColor: "#141414", color: "#777", border: "2px solid #252525", cursor: "pointer" }}><X size={13} /></button>
              </span>
            ) : (
              <IconRenameBtnRect onClick={() => { setDraftName(displayName); setRenaming(true); }} />
            ))}
            {!account.isActive && !isApollo && (
              <PreZbomHint
                entrypoint={account.isSmart ? "TS01-C1.DALOS|C_DeploySmartAccount" : "TS01-C1.DALOS|C_DeployStandardAccount"}
                values={accountFillValues}
              >
                <button type="button" onClick={() => setActiveOpId(account.isSmart ? "activate-smart" : "activate-standard")} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, padding: "6px 10px", borderRadius: 6, backgroundColor: "#ceac5f", color: "#0a0a0a", border: "1px solid transparent", cursor: "pointer" }}>
                  <Zap style={{ width: 14, height: 14 }} /> Activate
                </button>
              </PreZbomHint>
            )}
            {!account.isActive && isApollo && !isCodexIdPrime && !isRegistered && apiKeyLoaded && (
              <PreZbomHint entrypoint={DEPLOY_API_KEY_KEY} values={withPatron}>
                <button type="button" onClick={() => setActiveOpId("activate-apollo-pythia")} title={`Deploy this Apollo public key on-chain as a ${account.isSmart ? "Smart" : "Standard"} Pythia key (charges STOA; pairing is a later Pythia-mediated step).`} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, padding: "6px 10px", borderRadius: 6, backgroundColor: apolloAccent, color: "#0a0a0a", border: "1px solid transparent", cursor: "pointer" }}>
                  <Zap style={{ width: 14, height: 14 }} /> Activate as {account.isSmart ? "Smart" : "Standard"} Pythia Key
                </button>
              </PreZbomHint>
            )}
            <div style={{ flex: 1 }} />
            {locked
              ? <IconDeleteBtnDisabled size={28} title={isCodexIdPrime ? `${primeName} cannot be removed while it is part of the CodexID` : "CodexPrime cannot be removed"} />
              : <IconDeleteBtn onClick={() => { void deleteAccount(account.id); }} size={28} />}
          </div>
          </>
        );
        return isMobile ? (
          <MobilePortal target={fullScreenPortalTarget}>
            <CodexModalShell
              title={isApollo ? "Apollo Account" : displayName}
              onClose={() => setLocalExpanded(false)}
              dialogTestId={`ouronet-account-expand-modal-${account.id}`}
              closeTestId="ouronet-account-expand-close"
            >
              {expandedContent}
            </CodexModalShell>
          </MobilePortal>
        ) : (
          <div style={{ padding: "0 16px 12px", borderTop: "1px solid #262626" }}>
            {expandedContent}
          </div>
        );
      })()}

      {/* ZBOM hosts — the seven verbatim-cloned codex modals, each its own
          self-contained debouncer + patron + signing flow. Keyed off the open
          operation id; each mounts only while open so its hooks stay idle. */}
      {activeOpId === "rotate-payment-key" && (
        <RotatePaymentKeyModal open onClose={() => setActiveOpId(null)} account={account} accounts={accounts} kadenaSeeds={seeds} stoaChainAccounts={stoaChainAccounts} />
      )}
      {activeOpId === "rotate-guard" && (
        <RotateGuardModal open onClose={() => setActiveOpId(null)} account={account} accounts={accounts} kadenaSeeds={seeds} stoaChainAccounts={stoaChainAccounts} />
      )}
      {activeOpId === "release-stoic-tag" && (
        <ReleaseStoicTagModal open onClose={() => setActiveOpId(null)} account={account} accounts={accounts} kadenaSeeds={seeds} stoaChainAccounts={stoaChainAccounts} />
      )}
      {activeOpId === "register-stoic-tag" && (
        <RegisterStoicTagModal open onClose={() => setActiveOpId(null)} account={account} accounts={accounts} kadenaSeeds={seeds} stoaChainAccounts={stoaChainAccounts} />
      )}
      {activeOpId === "rotate-sovereign" && (
        <RotateSovereignModal open onClose={() => setActiveOpId(null)} account={account} accounts={accounts} kadenaSeeds={seeds} stoaChainAccounts={stoaChainAccounts} />
      )}
      {activeOpId === "rotate-governor" && (
        <RotateGovernorModal open onClose={() => setActiveOpId(null)} account={account} accounts={accounts} kadenaSeeds={seeds} stoaChainAccounts={stoaChainAccounts} />
      )}
      {activeOpId === "activate-standard" && (
        <ActivateStandardAccountModal open onClose={() => setActiveOpId(null)} ouroAccount={account} accounts={accounts} kadenaSeeds={seeds} stoaChainAccounts={stoaChainAccounts} />
      )}
      {activeOpId === "activate-smart" && (
        <ActivateSmartAccountModal open onClose={() => setActiveOpId(null)} ouroAccount={account} accounts={accounts} kadenaSeeds={seeds} stoaChainAccounts={stoaChainAccounts} />
      )}
      {activeOpId === "activate-apollo-pythia" && (
        <ActivateApolloPythiaKeyModal open onClose={() => setActiveOpId(null)} account={account} accounts={accounts} kadenaSeeds={seeds} stoaChainAccounts={stoaChainAccounts} />
      )}
      <ViewSeedModal isOpen={viewSeedOpen} onClose={() => setViewSeedOpen(false)} account={account} name={displayName} />
      {void updateAccount /* reserved for optimistic post-rotate mirror */}
    </div>
  );
}

const pageBtn = (disabled: boolean): React.CSSProperties => ({
  fontSize: 12, padding: "6px 12px", borderRadius: 8, border: "1px solid #262626", color: "#d2d3d4",
  background: "transparent", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.3 : 1,
});

/** The mobile pagination riser's Prev/Next arrow style — same family as the
 *  Controls/Address Book risers' own tiny buttons. */
const iconRiserBtn = (disabled: boolean): React.CSSProperties => ({
  display: "flex", alignItems: "center", justifyContent: "center",
  background: "none", border: "none", padding: 0, color: "inherit",
  cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.3 : 1,
});

/** One icon-only button in Zone 3's fixed mobile button row (design.md §8) —
 *  a filter tab, a spawn action, or the Expand-All toggle, all condensed to
 *  the same shape: an icon medallion + a tooltip-style `title`/`aria-label`
 *  carrying the text a desktop button would show inline. */
function MobileFilterIconBtn({
  active, accent, label, onClick, children,
}: {
  active: boolean; accent: string; label: string; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        width: 30, height: 30, borderRadius: 8, cursor: "pointer",
        border: `1px solid ${active ? accent : "#262626"}`,
        backgroundColor: active ? accent + "1a" : "transparent",
        color: active ? accent : "#888",
      }}
    >
      {children}
    </button>
  );
}

/** Dot geometry for `GroupedSwipeBullets` — same regular/active dot sizing
 *  convention `SwipeDeck`'s own (now-hidden, for Zone 3) dot strip used. */
const SWIPE_BULLET = { dot: 4, activeDot: 12, gap: 4, groupGap: 10, ellipsisSlot: 11 };

/**
 * The Zone 3 pagination riser's swipe-position indicator — the follow-up
 * feedback round: "if an area is swipeable, it must have its swiping bullets
 * show." Two-level, matching the owner's exact spec: one dot PER inner swipe
 * chunk, GROUPED (extra gap, no hard divider glyph) by which outer
 * (`ACCOUNTS_PER_PAGE`) page it belongs to — "two swipes per page, two
 * pages... 4 bullets grouped into 2" — so the grouping itself communicates
 * page boundaries even at the bullet level, not just the chunk count.
 *
 * Truncates at GROUP granularity when there isn't room for every page's
 * group ("instead of showing 100 groups of 3 bullets each, we'd show as many
 * groups as the width would fit, and the rest would show …"), windowed
 * around the ACTIVE page and re-measured live via `ResizeObserver` (the same
 * measured-fit convention `useSwipeDivisor`/`CompactHalf` already use
 * elsewhere in this codebase). The leading/trailing "…" slots are FIXED
 * width and always occupy their layout space — rendered empty (not
 * unmounted) when that side isn't truncated — so the visible groups never
 * shift horizontally as truncation toggles on/off while swiping near either
 * end of a long list vs. its middle ("their location reserved, not showing
 * when they are not needed").
 *
 * Every dot is also a direct jump target (`onSelectChunk`), same as
 * `SwipeDeck`'s own dots were before Zone 3 hid them — this strip both
 * SHOWS and DRIVES the swipe position.
 */
function GroupedSwipeBullets({
  totalChunks,
  chunksPerPage,
  activeChunk,
  onSelectChunk,
}: {
  totalChunks: number;
  chunksPerPage: number;
  activeChunk: number;
  onSelectChunk: (chunkIndex: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const compute = () => setWidth(el.clientWidth);
    compute();
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(compute);
      ro.observe(el);
    }
    return () => ro?.disconnect();
  }, []);

  const totalGroups = Math.max(1, Math.ceil(totalChunks / chunksPerPage));
  const groupSize = (p: number) => Math.max(0, Math.min(chunksPerPage, totalChunks - p * chunksPerPage));
  const groupWidth = (p: number) => {
    const n = groupSize(p);
    return n <= 0 ? 0 : n * SWIPE_BULLET.dot + (n - 1) * SWIPE_BULLET.gap;
  };
  const activePage = Math.min(totalGroups - 1, Math.max(0, Math.floor(activeChunk / chunksPerPage)));

  // Fixed budget for the two ellipsis slots — ALWAYS reserved (see the doc
  // comment above), regardless of whether either side actually truncates.
  const available = Math.max(0, width - SWIPE_BULLET.ellipsisSlot * 2);

  // Grow a window of WHOLE page-groups outward from the active page,
  // alternating which side gets first refusal each step, until neither side
  // has room (or width, or more pages) left to grow into. jsdom never
  // resolves real layout (`clientWidth` stays 0) — `available` then starts
  // at 0, so this degrades to "just the active group" until a real
  // measurement lands, the same safe-default convention as `useSwipeDivisor`.
  let lo = activePage;
  let hi = activePage;
  let used = groupWidth(activePage);
  let preferRight = true;
  for (;;) {
    const order = preferRight ? ([true, false] as const) : ([false, true] as const);
    let advanced = false;
    for (const goRight of order) {
      if (goRight && hi + 1 < totalGroups) {
        const w = groupWidth(hi + 1) + SWIPE_BULLET.groupGap;
        if (used + w <= available) { hi += 1; used += w; advanced = true; break; }
      } else if (!goRight && lo - 1 >= 0) {
        const w = groupWidth(lo - 1) + SWIPE_BULLET.groupGap;
        if (used + w <= available) { lo -= 1; used += w; advanced = true; break; }
      }
    }
    if (!advanced) break;
    preferRight = !preferRight;
  }

  const ellipsisStyle: React.CSSProperties = {
    width: SWIPE_BULLET.ellipsisSlot, flexShrink: 0, textAlign: "center",
    color: "#555", fontSize: 9, lineHeight: "4px",
  };

  return (
    <div ref={ref} style={{ display: "flex", alignItems: "center", flex: 1, minWidth: 0, justifyContent: "center" }}>
      <span data-swipe-ellipsis="lead" style={ellipsisStyle}>{lo > 0 ? "…" : ""}</span>
      <div style={{ display: "flex", alignItems: "center", gap: SWIPE_BULLET.groupGap }}>
        {Array.from({ length: hi - lo + 1 }, (_, gi) => lo + gi).map((p) => (
          <div key={p} style={{ display: "flex", alignItems: "center", gap: SWIPE_BULLET.gap }}>
            {Array.from({ length: groupSize(p) }, (_, k) => {
              const chunkIndex = p * chunksPerPage + k;
              const isActive = chunkIndex === activeChunk;
              return (
                <button
                  key={k}
                  type="button"
                  aria-label={`Go to swipe ${k + 1} of page ${p + 1}`}
                  aria-pressed={isActive}
                  onClick={() => onSelectChunk(chunkIndex)}
                  style={{
                    width: isActive ? SWIPE_BULLET.activeDot : SWIPE_BULLET.dot,
                    height: SWIPE_BULLET.dot, borderRadius: 9999, border: "none", padding: 0,
                    cursor: "pointer", transition: "all 0.2s",
                    backgroundColor: isActive ? "#ceac5f" : "#3a3a3a",
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
      <span data-swipe-ellipsis="trail" style={ellipsisStyle}>{hi < totalGroups - 1 ? "…" : ""}</span>
    </div>
  );
}

/* ─── Main tab ─── */
export function OuronetAccountsTab({ className, paginationRiserTarget, swipeIndicatorRiserTarget, fullScreenPortalTarget }: OuronetAccountsTabProps) {
  const isMobile = useIsMobile();
  const { accounts } = useOuroAccounts();
  const { seeds } = useStoaChainSeeds();
  const { keypairs } = usePureKeypairs();
  const { uiSettings } = useCodex();

  // The APOLLO accounts chosen for the observational CodexID are prime: pinned
  // first in their sub-tab, locked (non-deletable), renamed Standard/SmartCodexID.
  const idCfg = readObservationalCodexIdConfig(uiSettings);
  const stdPrimeId = idCfg.enabled ? idCfg.standardId : "";
  const smtPrimeId = idCfg.enabled ? idCfg.smartId : "";

  const [activeTab, setActiveTab] = useState<"standard" | "smart" | "single-api" | "dual-api">("standard");
  const [page, setPage] = useState(0);
  const [allExpanded, setAllExpanded] = useState(false);
  const [spawnMode, setSpawnMode] = useState<"standard" | "smart" | null>(null);
  /** Mobile's OWN continuous-swipe position — the index of the currently
   *  active inner swipe pane across the ENTIRE (unpaginated) account list,
   *  not just the current outer 12-account page (docs/work/codex-ui-mobile/
   *  design.md §8, the follow-up Zone 3 round: "a direct swipe for all the
   *  accounts... if I'm on the last swipe page of page 1 and I swipe
   *  forward, I'd be sent on swipe 1 of the next page, and the page counter
   *  would update accordingly"). Driven by the deck's own `onActiveChange`;
   *  `swipeDeckRef` lets the pagination riser's Prev/Next drive it back the
   *  OTHER direction (see `goToPage` in the `isMobile` block below). */
  const [mobileSwipeIndex, setMobileSwipeIndex] = useState(0);
  const swipeDeckRef = useRef<SwipeDeckHandle>(null);

  // Live on-chain state (URC_0027) — activation, sovereign, governor, payment
  // key + guard + balance, on-chain public key, StoicTag. The package reads the
  // same immutable Pact function My Codex uses; APOLLO accounts are excluded.
  const addresses = useMemo(() => accounts.map((a) => a.address), [accounts]);
  const { byAddress } = useAccountChainData(addresses);

  // Re-read the API-key registration/link status after ANY tx confirms (e.g. a
  // deploy or a Link) so the Apollo pills + Single/Dual API tabs update without a
  // manual reload. useAccountChainData wires the same nonce for URC_0027.
  const txNonce = usePostTxRefresh();

  // Batch Pythia registration read (`P-UI-ONE.URC_01|ApiKeys` — switched
  // from the archived `DPL-UR.URC_0031`, see `deployApiKey.ts`'s doc
  // comment on `getApiKeySelectorData`) — ONE chain call for ALL Apollo
  // accounts, index-aligned. Builds apolloAddress → row so each row shows
  // registered vs observational without its own per-row read.
  const apolloAddrs = useMemo(
    () => accounts.filter((a) => detectOriginCurve(a) === "apollo").map((a) => a.address),
    [accounts],
  );
  const [apiKeyMap, setApiKeyMap] = useState<Map<string, ApiKeyRow> | null>(null);
  useEffect(() => {
    if (!apolloAddrs.length) { setApiKeyMap(new Map()); return; }
    let aborted = false;
    setApiKeyMap(null);
    codexClock.report("URC_0031", undefined, () => getApiKeySelectorData(apolloAddrs))
      .then((rows) => {
        if (aborted) return;
        const m = new Map<string, ApiKeyRow>();
        apolloAddrs.forEach((addr, i) => { const r = rows[i]; if (r) m.set(addr, r); });
        setApiKeyMap(m);
      })
      .catch(() => { if (!aborted) setApiKeyMap(new Map()); });
    return () => { aborted = true; };
  }, [apolloAddrs, txNonce]);

  // Codex at-rest + live chain overlay. Preserves codex order so index 0 stays
  // CodexPrime regardless of the display sort below.
  const hydratedAccounts = useMemo(
    () => accounts.map((a) => hydrate(a, byAddress[a.address])),
    [accounts, byAddress],
  );

  const { standardAccounts, smartAccounts } = useMemo(() => {
    const sorted = [...hydratedAccounts].sort((a, b) => {
      const aI = hydratedAccounts.indexOf(a), bI = hydratedAccounts.indexOf(b);
      if (aI === 0) return -1;
      if (bI === 0) return 1;
      return (a.name || a.address).localeCompare(b.name || b.address);
    });
    return {
      standardAccounts: sorted.filter((a) => !a.isSmart),
      smartAccounts: sorted.filter((a) => a.isSmart),
    };
  }, [hydratedAccounts]);

  // Apollo (₱./Π.) halves per side — the source lists for the Single/Dual API
  // tabs. Standard ₱. halves (left) and Smart Π. halves (right).
  const standardApollo = useMemo(
    () => standardAccounts.filter((a) => detectOriginCurve(a) === "apollo"),
    [standardAccounts],
  );
  const smartApollo = useMemo(
    () => smartAccounts.filter((a) => detectOriginCurve(a) === "apollo"),
    [smartAccounts],
  );
  const apolloHalfCount = standardApollo.length + smartApollo.length;
  // Dual-key count = codex Standard halves that are registered AND linked — matches
  // the exact set DualApiPanel builds its list from.
  const dualCount = apiKeyMap
    ? standardApollo.filter((a) => {
        const r = apiKeyMap.get(a.address);
        return isApiKeyRegistered(r) && isApiKeyLinked(r);
      }).length
    : null;

  // Flat kadena signing material (IStoaChainWallet[]) the ZBOM modals need for
  // payment-key / guard pub-set lookup — derived the same way My Codex's
  // wallet-context carried it.
  const stoaChainAccounts = useMemo(() => flattenStoaChainAccounts(seeds), [seeds]);

  const currentList = activeTab === "standard" ? standardAccounts : smartAccounts;
  const primeDesignated = activeTab === "standard" ? CODEXID_PRIME_NAMES.standard : CODEXID_PRIME_NAMES.smart;

  // The prime zone pins all prime entities to the top (excluded from pagination,
  // separated from the rest): the CodexID APOLLO half for this sub-tab AND the
  // codex's own CodexPrime account (index 0) when it lives in this sub-tab.
  const primeId = activeTab === "standard" ? stdPrimeId : smtPrimeId;
  const apolloPrime = primeId ? currentList.find((a) => a.id === primeId) : undefined;
  const codexPrimeAcct = hydratedAccounts[0];
  const codexPrimeInTab = codexPrimeAcct
    ? (activeTab === "standard" ? !codexPrimeAcct.isSmart : codexPrimeAcct.isSmart)
    : false;

  const primeRows: { account: IOuroAccount; primeName?: string }[] = [];
  const primeIds = new Set<string>();
  if (apolloPrime) {
    primeRows.push({ account: apolloPrime, primeName: codexIdPrimeName(primeDesignated, apolloPrime.name) });
    primeIds.add(apolloPrime.id);
  }
  if (codexPrimeInTab && codexPrimeAcct && !primeIds.has(codexPrimeAcct.id)) {
    primeRows.push({ account: codexPrimeAcct }); // index-0 ⇒ AccountRow renders it as CodexPrime
    primeIds.add(codexPrimeAcct.id);
  }

  const restList = currentList.filter((a) => !primeIds.has(a.id));
  // DESKTOP-only from here — mobile computes its OWN page count from its
  // OWN measured page size (`useMobilePageSize`, below), independent of
  // this fixed constant (design.md §8, the "variable mobile pagination"
  // round).
  const totalPages = Math.ceil(restList.length / DESKTOP_ACCOUNTS_PER_PAGE);
  const pageAccounts = restList.slice(page * DESKTOP_ACCOUNTS_PER_PAGE, (page + 1) * DESKTOP_ACCOUNTS_PER_PAGE);

  // `mobileSwipeIndex`/`swipeDeckRef` mirror `page`/`setPage` for mobile's
  // OWN continuous swipe sequence (see the `isMobile` block below) — reset
  // together on a tab switch, including an imperative snap back to the
  // deck's own pane 0 (its `initialIndex` only applies on first mount, not
  // on a later tab switch that keeps the SAME `SwipeDeck` instance mounted
  // with new children).
  useEffect(() => {
    setPage(0);
    setMobileSwipeIndex(0);
    swipeDeckRef.current?.scrollToIndex(0);
  }, [activeTab]);

  const prevStdCount = useRef(standardAccounts.length);
  const prevSmartCount = useRef(smartAccounts.length);
  useEffect(() => {
    // Only auto-jump between the account lists — never yank the user off the
    // Single/Dual API tabs when an account count changes.
    if (activeTab === "standard" || activeTab === "smart") {
      if (smartAccounts.length > prevSmartCount.current && activeTab !== "smart") setActiveTab("smart");
      else if (standardAccounts.length > prevStdCount.current && activeTab !== "standard") setActiveTab("standard");
    }
    prevStdCount.current = standardAccounts.length;
    prevSmartCount.current = smartAccounts.length;
  }, [standardAccounts.length, smartAccounts.length, activeTab]);

  const isAccountList = activeTab === "standard" || activeTab === "smart";

  // Called UNCONDITIONALLY (Rules of Hooks) even though its result is only
  // consumed in the `isMobile` branch below — `isMobile` itself can flip
  // live (a container-relative ResizeObserver), so this can't be gated
  // behind the `if (isMobile)` check the way the mobile JSX itself is.
  const { ref: swipeRef, rowRef: mobileRowRef, pageSize: mobilePageSize } = useMobilePageSize();

  const Pagination = () => totalPages > 1 ? (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
      <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} style={pageBtn(page === 0)}>← Prev</button>
      <span style={{ fontSize: 12, fontFamily: MONO, color: "#888" }}>{page + 1} / {totalPages}</span>
      <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} style={pageBtn(page >= totalPages - 1)}>Next →</button>
    </div>
  ) : null;

  // ── Mobile (docs/work/codex-ui-mobile/design.md §8, the "Zone 3" round,
  // and the follow-up "variable mobile pagination" round) ──
  // Zone 3 is its own ENCIRCLED area (the host gives this component a
  // bordered, bounded box — `.cxpg-zone3` in the playground). Structure:
  //   1. A FIXED single-line icon row (flex: none) — the filter tabs +
  //      Spawn Standard/Smart + Expand All, all condensed to icon-only.
  //   2. The pane below is ONE continuous `SwipeDeck` spanning the WHOLE
  //      (unpaginated) account list, chunked at `mobilePageSize` — the
  //      EXACT number of rows that measured to fit Zone 3's real height
  //      (`useMobilePageSize`), no quantization. A "page" IS a chunk now —
  //      there is no more separate outer (fixed-count) / inner (measured)
  //      split the way `ACCOUNTS_PER_PAGE`/`swipeDivisor` used to have
  //      (`chunksPerPage` below is always `1`), so "recount the number of
  //      pages needed" happens for free: `chunks.length` IS `totalPages`,
  //      live, off the SAME measurement. The continuous-sweep behavior
  //      (swiping past the last row of one page lands on the first row of
  //      the next) is unchanged — `page`/`pageAccounts` stay desktop-only
  //      (fixed `DESKTOP_ACCOUNTS_PER_PAGE`); mobile derives its own page
  //      number directly from the active swipe index.
  //   3. The pagination stripe (Prev/Next, portaled flush against the host's
  //      tab bar, same family as Controls/Address Book) now DRIVES the deck
  //      via `swipeDeckRef` rather than owning an independent slice — and
  //      the deck's own dot/arrow strip is suppressed (`hideIndicators`):
  //      Zone 3 is a bordered/clipped box (unlike Zone 1's border-less
  //      slot), so a dot strip anchored inside it can't spill into the gap
  //      below the way Zone 1's does — the owner's directive was to move
  //      "the lines showing there is swipeable content" OUTSIDE the box
  //      entirely, and this pagination stripe already lives there.
  //   4. Row expansion opens a FULL-SCREEN `CodexModalShell` (via
  //      `AccountRow`'s own `isMobile` branch + `fullScreenPortalTarget`,
  //      threaded straight through below) rather than an inline block — the
  //      owner's directive is that it "must be shown on the whole screen...
  //      instead of expanding it on Zone 3". An earlier round shipped
  //      `expandable={false}` here as a stopgap before that full-screen
  //      version existed; the owner's later follow-up ("we remove the
  //      expansion but we forgot to readd it") flagged the row was left with
  //      no expand affordance at all in the meantime — fixed by restoring
  //      `expandable` to its default (true) at both call sites below.
  if (isMobile) {
    // Owner correction (design.md §8, round 8): "if 8 positions fit on a
    // page, they must all be occupied" — chunk 0 ALONE shares its page with
    // the pinned prime row(s), so ONLY its own slice is shrunk by that many
    // slots; every other page gets the full measured `mobilePageSize` (see
    // `useMobilePageSize`'s own doc comment for why the deduction moved
    // here instead of living inside the hook).
    const chunks: IOuroAccount[][] = [];
    const firstChunkSize = Math.max(1, mobilePageSize - primeRows.length);
    if (restList.length === 0) {
      chunks.push([]);
    } else {
      chunks.push(restList.slice(0, firstChunkSize));
      for (let i = firstChunkSize; i < restList.length; i += mobilePageSize) {
        chunks.push(restList.slice(i, i + mobilePageSize));
      }
    }

    // A "page" and a "chunk" are the SAME thing now (see the doc comment
    // above) — `chunksPerPage` stays `1` purely so `GroupedSwipeBullets`
    // (built for the old two-tier scheme) still works unmodified: with
    // `chunksPerPage=1` its own "group" math degenerates to exactly one dot
    // per page, i.e. a flat bullet row, which is exactly right here.
    const chunksPerPage = 1;
    const mobileTotalPages = chunks.length;
    const mobilePage = Math.min(mobileTotalPages - 1, Math.max(0, mobileSwipeIndex));
    // Set state directly (immediate feedback + jsdom-testable —
    // `scrollToIndex`'s own `Element.scrollTo` guard is a real-browser-only
    // no-op in the test env) IN ADDITION to driving the real scroll
    // position, so a subsequent manual swipe continues from the correct
    // visual spot rather than snapping back once the deck's own scroll
    // listener resolves. Shared by the Prev/Next arrows (page-level jump)
    // AND every individual bullet in `GroupedSwipeBullets` (chunk-level jump).
    const goToChunk = (target: number) => {
      const idx = Math.max(0, Math.min(chunks.length - 1, target));
      setMobileSwipeIndex(idx);
      swipeDeckRef.current?.scrollToIndex(idx);
    };
    const goToPage = (target: number) => {
      const clamped = Math.max(0, Math.min(mobileTotalPages - 1, target));
      goToChunk(clamped);
    };

    // The ORIGINAL Prev/Next pagination stripe — arrows + "N / M" text, back
    // exactly as it was before the bullets round (owner correction: "you
    // need to keep the pagination stripe with page 1/2 prev and next, that
    // we have before"). Still gated on `mobileTotalPages > 1` — "N" here is
    // now the LIVE, measured page count, not a fixed-count derivation.
    const paginationCluster = isAccountList && mobileTotalPages > 1 ? (
      <div
        style={{
          display: "flex", alignItems: "center", gap: 6,
          height: 18, padding: "0 6px", border: "1px solid #262626", borderBottom: "none",
          borderRadius: "6px 6px 0 0", backgroundColor: "#0a0a0af0",
          color: "#ceac5f", fontSize: 9, fontWeight: 700, fontFamily: MONO,
        }}
      >
        <button
          type="button"
          aria-label="Previous page"
          onClick={() => goToPage(mobilePage - 1)}
          disabled={mobilePage === 0}
          style={iconRiserBtn(mobilePage === 0)}
        >
          <ChevronLeft size={11} />
        </button>
        <span>{mobilePage + 1}/{mobileTotalPages}</span>
        <button
          type="button"
          aria-label="Next page"
          onClick={() => goToPage(mobilePage + 1)}
          disabled={mobilePage >= mobileTotalPages - 1}
          style={iconRiserBtn(mobilePage >= mobileTotalPages - 1)}
        >
          <ChevronRight size={11} />
        </button>
      </div>
    ) : null;

    // A SEPARATE strip, specific to Zone 3, for the swipe-position bullets —
    // owner correction: "the bullet I was talking about is something
    // beneath Zone 3... they work in concert but they are different
    // entities." Gated on `chunks.length > 1` — since a page and a chunk
    // are now the SAME thing, this is equivalent to `mobileTotalPages > 1`,
    // but written this way to stay correct even if that ever changes again.
    const swipeIndicatorCluster = isAccountList && chunks.length > 1 ? (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%" }}>
        <GroupedSwipeBullets
          totalChunks={chunks.length}
          chunksPerPage={chunksPerPage}
          activeChunk={mobileSwipeIndex}
          onSelectChunk={goToChunk}
        />
      </div>
    ) : null;

    return (
      <div
        className={className}
        style={{
          position: "relative", height: "100%", display: "flex", flexDirection: "column",
          fontFamily: "var(--codex-font, inherit)", color: "#d2d3d4",
        }}
      >
        {/* Fixed icon-only button row — never scrolls away. 4 filters LEFT,
            2 spawn actions RIGHT (owner directive) — Expand All is DROPPED
            entirely on mobile (row expansion itself is disabled here, so a
            toggle for it has nothing to do). `marginBottom` — owner
            directive (the follow-up feedback round): "the buttons on the
            top sit flush to the account entries, this is a no go, must
            have some sort of spacing between them." */}
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 4, marginBottom: 10 }}>
          <MobileFilterIconBtn active={activeTab === "standard"} accent="#ceac5f" label={`Standard (${standardAccounts.length})`} onClick={() => setActiveTab("standard")}>
            <User size={16} />
          </MobileFilterIconBtn>
          <MobileFilterIconBtn active={activeTab === "smart"} accent="#a78bfa" label={`Smart (${smartAccounts.length})`} onClick={() => setActiveTab("smart")}>
            <Sparkles size={16} />
          </MobileFilterIconBtn>
          <MobileFilterIconBtn active={activeTab === "single-api"} accent="#4ade80" label={`Single API (${apolloHalfCount})`} onClick={() => setActiveTab("single-api")}>
            <KeyRound size={16} />
          </MobileFilterIconBtn>
          <MobileFilterIconBtn active={activeTab === "dual-api"} accent="#38bdf8" label={`Dual API (${dualCount ?? "…"})`} onClick={() => setActiveTab("dual-api")}>
            <Link2 size={16} />
          </MobileFilterIconBtn>
          <div style={{ flex: 1 }} />
          <MobileFilterIconBtn active={false} accent="#ceac5f" label="Spawn Standard Account" onClick={() => setSpawnMode("standard")}>
            <PlusCircle size={16} />
          </MobileFilterIconBtn>
          <MobileFilterIconBtn active={false} accent="#a78bfa" label="Spawn Smart Account" onClick={() => setSpawnMode("smart")}>
            <PlusCircle size={16} />
          </MobileFilterIconBtn>
        </div>

        {/* The pane below — swipeable per-page content. */}
        <div ref={swipeRef} style={{ flex: 1, minHeight: 0 }}>
          {activeTab === "single-api" ? (
            <div style={{ height: "100%", overflowY: "auto" }}>
              <SingleApiPanel standardApollo={standardApollo} smartApollo={smartApollo} apiKeyMap={apiKeyMap} accounts={hydratedAccounts} />
            </div>
          ) : activeTab === "dual-api" ? (
            <div style={{ height: "100%", overflowY: "auto" }}>
              <DualApiPanel standardApollo={standardApollo} smartApollo={smartApollo} apiKeyMap={apiKeyMap} accounts={hydratedAccounts} />
            </div>
          ) : (
            <SwipeDeck
              ref={swipeDeckRef}
              fill
              peek={false}
              hideIndicators
              onActiveChange={setMobileSwipeIndex}
              style={{ height: "100%" }}
            >
              {chunks.map((chunk, i) => (
                <SwipeChunkPane key={i} i={i}>
                  {/* CodexPrime/APOLLO-prime row(s) — pinned first in pane 0,
                      NO separator bar on mobile (owner directive, the
                      follow-up feedback round: "the bar separating the
                      prime account... needs to be removed, and the prime
                      account must be designated as such via colour coding"
                      — `AccountRow`'s own border/background/name-color
                      already carries that designation; see
                      `useMobilePageSize`'s doc comment above for why this
                      also keeps every pane's row count uniform). */}
                  {i === 0 && primeRows.length > 0 && primeRows.map(({ account, primeName }, pi) => (
                    <div
                      key={account.id || account.address}
                      ref={i === 0 && pi === 0 ? mobileRowRef : undefined}
                      style={{ scrollSnapAlign: "start" }}
                    >
                      <AccountRow
                        account={account}
                        index={hydratedAccounts.indexOf(account)}
                        seeds={seeds}
                        pureKeypairs={keypairs}
                        accounts={hydratedAccounts}
                        stoaChainAccounts={stoaChainAccounts}
                        forceExpanded={false}
                        compact
                        fullScreenPortalTarget={fullScreenPortalTarget}
                        paymentBalance={decimalToDisplay(byAddress[account.address]?.["payment-key-balance"])}
                        paymentKeyFunded={byAddress[account.address]?.["payment-key-existance"] ?? null}
                        primeName={primeName}
                        apiKeyRow={apiKeyMap?.get(account.address) ?? null}
                        apiKeyLoaded={apiKeyMap !== null}
                      />
                    </div>
                  ))}
                  {chunk.map((account, ai) => (
                    <div
                      key={account.id || account.address}
                      ref={i === 0 && primeRows.length === 0 && ai === 0 ? mobileRowRef : undefined}
                      style={{ scrollSnapAlign: "start" }}
                    >
                      <AccountRow
                        account={account}
                        index={hydratedAccounts.indexOf(account)}
                        seeds={seeds}
                        pureKeypairs={keypairs}
                        accounts={hydratedAccounts}
                        stoaChainAccounts={stoaChainAccounts}
                        forceExpanded={false}
                        compact
                        fullScreenPortalTarget={fullScreenPortalTarget}
                        paymentBalance={decimalToDisplay(byAddress[account.address]?.["payment-key-balance"])}
                        paymentKeyFunded={byAddress[account.address]?.["payment-key-existance"] ?? null}
                        apiKeyRow={apiKeyMap?.get(account.address) ?? null}
                        apiKeyLoaded={apiKeyMap !== null}
                      />
                    </div>
                  ))}
                  {i === 0 && chunk.length === 0 && primeRows.length === 0 && (
                    <div style={{ textAlign: "center", padding: "32px 0", borderRadius: 12, border: "1px dashed #262626", color: "#555" }}>
                      <span style={{ fontSize: 14 }}>No {activeTab} accounts in Codex</span>
                    </div>
                  )}
                </SwipeChunkPane>
              ))}
            </SwipeDeck>
          )}
        </div>

        {paginationCluster && (paginationRiserTarget ? createPortal(paginationCluster, paginationRiserTarget) : (
          <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", bottom: 0, zIndex: 5 }}>
            {paginationCluster}
          </div>
        ))}

        {/* The swipe-bullets strip — a DIFFERENT stripe from the Prev/Next
            pagination riser above, "beneath Zone 3, specific to Zone 3."
            Fallback (no target) sits directly ABOVE the pagination riser's
            own fallback position, not sharing its row. */}
        {swipeIndicatorCluster && (swipeIndicatorRiserTarget ? createPortal(swipeIndicatorCluster, swipeIndicatorRiserTarget) : (
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 22, zIndex: 5 }}>
            {swipeIndicatorCluster}
          </div>
        ))}

        {/* Owner directive (the follow-up feedback round): "when clicking
            the spawning of new accounts, doing so shows the spawning
            interface, on the whole screen, not only on zone 3." Portaled to
            `fullScreenPortalTarget` when supplied — its `CodexModalShell`
            (mobile: `position: absolute; inset: 0`) then anchors against
            the host's WHOLE mobile body instead of this component's own
            Zone-3-bounded frame. Falls back to the original inline mount
            when no target is supplied. */}
        {spawnMode && (
          fullScreenPortalTarget ? createPortal(
            <SpawnAccountModal isSmart={spawnMode === "smart"} onClose={() => setSpawnMode(null)} />,
            fullScreenPortalTarget,
          ) : (
            <SpawnAccountModal isSmart={spawnMode === "smart"} onClose={() => setSpawnMode(null)} />
          )
        )}
      </div>
    );
  }

  return (
    <div className={className} style={{ fontFamily: "var(--codex-font, inherit)", color: "#d2d3d4", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Live-read status + manual refresh removed — the CodexUI debouncer panel
          now surfaces URC_0027's live/fetching/error state (T5) and auto-refresh. */}

      {/* Total + Standard/Smart filter + Expand All */}
      <div style={{ fontSize: 14, color: "#888" }}>
        Total <span style={{ fontWeight: 700, color: "#d2d3d4" }}>{accounts.length}</span> Accounts{" "}
        <span style={{ color: "#555" }}>({standardAccounts.length} Standard, {smartAccounts.length} Smart)</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {(["standard", "smart"] as const).map((tab) => {
          const active = activeTab === tab;
          const accent = tab === "standard" ? "#ceac5f" : "#a78bfa";
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: "8px 16px", borderRadius: 12, fontSize: 14, fontWeight: 600,
                border: `2px solid ${active ? accent : "#262626"}`,
                backgroundColor: active ? accent + "15" : "#0a0a0a",
                color: active ? accent : "#888", cursor: "pointer",
              }}
            >
              {tab === "standard" ? "Standard" : "Smart"} ({tab === "standard" ? standardAccounts.length : smartAccounts.length})
            </button>
          );
        })}
        {/* API-key tabs: Single (link halves) + Dual (linked composite keys). */}
        {([
          { key: "single-api", label: "Single API", accent: "#4ade80", count: apolloHalfCount },
          { key: "dual-api", label: "Dual API", accent: "#38bdf8", count: dualCount },
        ] as const).map(({ key, label, accent, count }) => {
          const active = activeTab === key;
          return (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              style={{
                padding: "8px 16px", borderRadius: 12, fontSize: 14, fontWeight: 600,
                border: `2px solid ${active ? accent : "#262626"}`,
                backgroundColor: active ? accent + "15" : "#0a0a0a",
                color: active ? accent : "#888", cursor: "pointer",
              }}
            >
              {label} ({count ?? "…"})
            </button>
          );
        })}
        {isAccountList && (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <GoldenBtn icon={<PlusCircle style={{ width: 16, height: 16 }} />} label="Spawn Standard Account" onClick={() => setSpawnMode("standard")} />
            <VioletBtn icon={<PlusCircle style={{ width: 16, height: 16 }} />} label="Spawn Smart Account" onClick={() => setSpawnMode("smart")} />
            <button
              onClick={() => setAllExpanded(!allExpanded)}
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "8px 12px", borderRadius: 12, fontSize: 12, fontWeight: 500, border: "1px solid #262626", color: "#888", background: "transparent", cursor: "pointer" }}
            >
              <ChevronsUpDown style={{ width: 14, height: 14 }} />
              {allExpanded ? "Collapse All" : "Expand All"}
            </button>
          </div>
        )}
      </div>

      {activeTab === "single-api" ? (
        <SingleApiPanel standardApollo={standardApollo} smartApollo={smartApollo} apiKeyMap={apiKeyMap} accounts={hydratedAccounts} />
      ) : activeTab === "dual-api" ? (
        <DualApiPanel standardApollo={standardApollo} smartApollo={smartApollo} apiKeyMap={apiKeyMap} accounts={hydratedAccounts} />
      ) : (
      <>
      <Pagination />

      {(primeRows.length > 0 || pageAccounts.length > 0) ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {primeRows.length > 0 && (
            <>
              {primeRows.map(({ account, primeName }) => (
                <AccountRow
                  key={account.id || account.address}
                  account={account}
                  index={hydratedAccounts.indexOf(account)}
                  seeds={seeds}
                  pureKeypairs={keypairs}
                  accounts={hydratedAccounts}
                  stoaChainAccounts={stoaChainAccounts}
                  forceExpanded={allExpanded}
                  paymentBalance={decimalToDisplay(byAddress[account.address]?.["payment-key-balance"])}
                  paymentKeyFunded={byAddress[account.address]?.["payment-key-existance"] ?? null}
                  primeName={primeName}
                  apiKeyRow={apiKeyMap?.get(account.address) ?? null}
                  apiKeyLoaded={apiKeyMap !== null}
                />
              ))}
              {restList.length > 0 && <PrimeSeparator label={`Other ${activeTab} accounts`} />}
            </>
          )}
          {pageAccounts.map((account) => (
            <AccountRow
              key={account.id || account.address}
              account={account}
              index={hydratedAccounts.indexOf(account)}
              seeds={seeds}
              pureKeypairs={keypairs}
              accounts={hydratedAccounts}
              stoaChainAccounts={stoaChainAccounts}
              forceExpanded={allExpanded}
              paymentBalance={decimalToDisplay(byAddress[account.address]?.["payment-key-balance"])}
                  paymentKeyFunded={byAddress[account.address]?.["payment-key-existance"] ?? null}
              apiKeyRow={apiKeyMap?.get(account.address) ?? null}
              apiKeyLoaded={apiKeyMap !== null}
            />
          ))}
        </div>
      ) : (
        <div style={{ textAlign: "center", padding: "32px 0", borderRadius: 12, border: "1px dashed #262626", color: "#555" }}>
          <span style={{ fontSize: 14 }}>No {activeTab} accounts in Codex</span>
        </div>
      )}

      <Pagination />
      </>
      )}

      {spawnMode && (
        <SpawnAccountModal isSmart={spawnMode === "smart"} onClose={() => setSpawnMode(null)} />
      )}
    </div>
  );
}

export default OuronetAccountsTab;
