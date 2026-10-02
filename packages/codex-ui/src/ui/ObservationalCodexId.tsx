/**
 * Observational CodexID — a *preview* Codex Identity built from two chosen
 * APOLLO accounts (one Standard ₱., one Smart Π.) combined into the canonical
 * CodexID form `{₱.std}:{Π.smart}`.
 *
 * Split into two surfaces sharing one config stored in `uiSettings`
 * (`observationalCodexId`, via the UiSettings `[extra]` escape hatch — no type
 * change needed):
 *   - <ObservationalCodexIdSettings>  the toggle + the two pickers (lives in
 *     Codex UI Settings). Persists the choice + enabled flag.
 *   - <ObservationalCodexIdDisplay>   reads the config + accounts and, when
 *     enabled + fully picked, renders the constructed identity (lives above the
 *     CodexID status badge on the CodexUI page).
 *
 * OBSERVATIONAL only — never derives, persists, or registers a real identity.
 * Drop-in: state via the provider hooks, styled inline (no Tailwind).
 */

import * as React from "react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Fingerprint, ChevronDown, ChevronUp, ChevronRight, Eye } from "lucide-react";
import { useIsMobile } from "./mobile/MobileContext.js";
import { SwipeDeck } from "./mobile/SwipeDeck.js";
import { useRegisterControlsOptional } from "./mobile/controls-context.js";
import { useCodex } from "../hooks/useCodex.js";
import { useCodexAuth } from "../hooks/useCodexAuth.js";
import { useRequestLogout } from "../hooks/useRequestLogout.js";
import { useOuroAccounts } from "../hooks/useOuroAccounts.js";
import { useCodexIdentity } from "../hooks/useCodexIdentity.js";
import { usePureKeypairs } from "../hooks/usePureKeypairs.js";
import { useStoaChainSeeds } from "../hooks/useStoaChainSeeds.js";
import { useCodexStore } from "../provider/index.js";
import { detectOriginCurve } from "./internal/originCurve.js";
import { IconCopyBtn } from "./internal/IconButtons.js";
import { PublicKeyFieldBox, GuardFieldBox } from "./internal/accountFields.js";
import { GuardTree } from "./internal/GuardTree.js";
import { identifyKeySource } from "./internal/keySource.js";
import { CodexIdField, CopyValueTag } from "./CodexIdField.js";
import { CodexLockControl } from "./CodexLockControl.js";
import { CodexModalShell } from "./internal/CodexModalShell.js";
import type { IOuroAccount } from "@ancientpantheon/codex-ouronet/types";

/** Small "Reveal Seed" button shown at a public key's upper-right. `compact`
 *  (design.md §8, Zone 2 rework) drops the text label — icon-only, so it
 *  fits on `PublicKeyFieldBox`'s own compact one-line header alongside the
 *  label + lock badge + the key value itself. */
function RevealSeedBtn({ onClick, compact }: { onClick: () => void; compact?: boolean }) {
  if (compact) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label="Reveal Seed"
        title="Reveal Seed"
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 20, height: 20, flexShrink: 0, borderRadius: 6,
          background: "transparent", border: "1px solid #262626", color: "#888", cursor: "pointer",
        }}
      >
        <Eye style={{ width: 12, height: 12 }} />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 6, background: "transparent", border: "1px solid #262626", color: "#888", cursor: "pointer" }}
    >
      <Eye style={{ width: 12, height: 12 }} /> Reveal Seed
    </button>
  );
}

/** Renders `node` through `createPortal(node, target)` when `target` is
 *  supplied, otherwise renders it inline exactly as before — see
 *  `ObservationalCodexIdDisplayProps.fullScreenPortalTarget`'s doc comment. */
function portalOrInline(node: React.ReactNode, target: Element | null | undefined): React.ReactNode {
  if (!node) return null;
  return target ? createPortal(node, target) : node;
}

const STD_ACCENT = "#f97316"; // APOLLO Standard ₱.
const SMT_ACCENT = "#a01b3f"; // APOLLO Smart Π.
const GUARD_ACCENT = "#a78bfa"; // Pure-Key guard (matches the Pure Key Pairs tab)

/** Zone 2's collapsed height on mobile — one header row (icon + label +
 *  badge/status + toggle), padding included. "A single line, occupying as
 *  little space as possible." */
const ZONE2_COLLAPSED_HEIGHT = 44;
/** Zone 2's expanded height on mobile — UNCHANGED from the fixed height the
 *  host's `.cxpg-zone2` wrapper used to force ("same size/area/positioning
 *  as the zone 2 rectangle on the dashboard"). */
const ZONE2_EXPANDED_HEIGHT = 190;

export interface ObservationalCodexIdConfig {
  enabled: boolean;
  standardId: string;
  smartId: string;
  /** Pure-keypair id chosen as the CodexID guard (a Pure Key, per convention —
   *  never a seed-derived key). Optional: the CodexID still previews without it. */
  guardKeypairId: string;
}

const DEFAULT_CONFIG: ObservationalCodexIdConfig = {
  enabled: false,
  standardId: "",
  smartId: "",
  guardKeypairId: "",
};

export function readObservationalCodexIdConfig(uiSettings: Record<string, unknown>): ObservationalCodexIdConfig {
  const raw = uiSettings.observationalCodexId as Partial<ObservationalCodexIdConfig> | undefined;
  return { ...DEFAULT_CONFIG, ...(raw ?? {}) };
}

/**
 * The names a CodexID's prime entities take in LIVE mode. In observational mode
 * the entity keeps its real name; lists show `${designated} (${original})`.
 */
export const CODEXID_PRIME_NAMES = {
  standard: "StandardCodexID",
  smart: "SmartCodexID",
  guard: "GuardOfCodexID",
} as const;

/** Display name for a prime CodexID entity: designated name + original in parens. */
export function codexIdPrimeName(designated: string, original: string | undefined): string {
  const orig = (original ?? "").trim();
  return orig ? `${designated} (${orig})` : designated;
}

function useApolloAccounts() {
  const { accounts } = useOuroAccounts();
  const apollo = accounts.filter((a) => detectOriginCurve(a) === "apollo");
  return {
    standardApollo: apollo.filter((a) => !a.isSmart),
    smartApollo: apollo.filter((a) => a.isSmart),
  };
}

const accLabel = (a: IOuroAccount, i: number) =>
  `${a.name || `Apollo #${i + 1}`} — ${a.address.slice(0, 10)}…`;

/* ───────────────────────── Settings surface ───────────────────────── */

export interface ObservationalCodexIdSettingsProps {
  className?: string;
}

const selectStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", height: 38, padding: "0 10px", borderRadius: 8,
  backgroundColor: "#111", border: "1px solid #262626", color: "#d2d3d4", fontSize: 13,
};
const labelStyle = (color: string): React.CSSProperties => ({
  display: "block", fontSize: 11, fontWeight: 600, textTransform: "uppercase",
  letterSpacing: "0.05em", color, marginBottom: 6,
});

const kpLabel = (kp: { label?: string; publicKey: string }, i: number) =>
  `${kp.label || `Pure Key #${i + 1}`} — ${kp.publicKey.slice(0, 10)}…`;

export function ObservationalCodexIdSettings({ className }: ObservationalCodexIdSettingsProps) {
  const { uiSettings } = useCodex();
  const store = useCodexStore();
  const cfg = readObservationalCodexIdConfig(uiSettings);
  const { standardApollo, smartApollo } = useApolloAccounts();
  const { keypairs } = usePureKeypairs();

  const write = (patch: Partial<ObservationalCodexIdConfig>) => {
    void store.getState().actions.updateUiSettings({
      observationalCodexId: { ...cfg, ...patch },
    });
  };

  return (
    <div
      className={className}
      style={{ display: "flex", flexDirection: "column", gap: 12, fontFamily: "var(--codex-font, inherit)", color: "#d2d3d4" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Fingerprint style={{ width: 16, height: 16, color: "#22c55e" }} />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>Preview Observational CodexID</span>
        {/* Toggle */}
        <button
          type="button"
          role="switch"
          aria-checked={cfg.enabled}
          onClick={() => write({ enabled: !cfg.enabled })}
          style={{
            width: 44, height: 24, borderRadius: 9999, position: "relative", cursor: "pointer",
            border: "none", padding: 0,
            backgroundColor: cfg.enabled ? "#22c55e" : "#333",
            transition: "background-color 0.15s",
          }}
        >
          <span style={{
            position: "absolute", top: 2, left: cfg.enabled ? 22 : 2, width: 20, height: 20,
            borderRadius: "50%", backgroundColor: "#fff", transition: "left 0.15s",
          }} />
        </button>
      </div>
      <p style={{ margin: 0, fontSize: 11, color: "#888", lineHeight: 1.5 }}>
        When enabled, combine one Standard (₱.) + one Smart (Π.) APOLLO account into the CodexID
        display form and show it on the CodexUI page (above the identity status). Observational
        only — does <strong>not</strong> derive or register a real identity.
      </p>

      {cfg.enabled && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={labelStyle(STD_ACCENT)}>Standard half (₱.)</label>
            <select style={selectStyle} value={cfg.standardId} onChange={(e) => write({ standardId: e.target.value })}>
              <option value="">{standardApollo.length ? "Select…" : "No Standard APOLLO accounts"}</option>
              {standardApollo.map((a, i) => <option key={a.id} value={a.id}>{accLabel(a, i)}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={labelStyle(SMT_ACCENT)}>Smart half (Π.)</label>
            <select style={selectStyle} value={cfg.smartId} onChange={(e) => write({ smartId: e.target.value })}>
              <option value="">{smartApollo.length ? "Select…" : "No Smart APOLLO accounts"}</option>
              {smartApollo.map((a, i) => <option key={a.id} value={a.id}>{accLabel(a, i)}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={labelStyle(GUARD_ACCENT)}>Guard (Pure Key)</label>
            <select style={selectStyle} value={cfg.guardKeypairId} onChange={(e) => write({ guardKeypairId: e.target.value })}>
              <option value="">{keypairs.length ? "Select… (optional)" : "No Pure Keys"}</option>
              {keypairs.map((kp, i) => <option key={kp.id} value={kp.id}>{kpLabel(kp, i)}</option>)}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Display surface ───────────────────────── */

/**
 * Args handed to the injected seed-reveal slot. The chain-generic shell decides
 * WHEN the per-half reveal is open and for WHICH account/name; the concrete
 * seed-decrypting modal (which carries the `@stoachain` crypto edge) is supplied
 * by the Ouronet host so codex-ui never statically imports it.
 */
export interface ObservationalViewSeedModalArgs {
  isOpen: boolean;
  onClose: () => void;
  account?: IOuroAccount;
  name: string;
}

export interface ObservationalCodexIdDisplayProps {
  className?: string;
  /**
   * Consumer seam to launch the "establish a real Codex Identity" flow (the
   * Mnemosyne Stage-1 registration). When provided, the empty-state
   * "Define Codex Identity" button is enabled and calls this; when omitted, the
   * button renders disabled with a "coming with Mnemosyne" hint. Wiring this in
   * is what will let a fresh codex establish its on-chain CodexIdentity.
   */
  onDefineIdentity?: () => void;
  /**
   * Injected seed-reveal modal slot. The Ouronet host supplies its concrete
   * `ViewSeedModal` (which value-imports `@stoachain/stoa-core/crypto`), keeping
   * that runtime edge out of the generic shell. When omitted, the per-half
   * "Reveal Seed" affordance simply mounts nothing.
   */
  renderViewSeedModal?: (args: ObservationalViewSeedModalArgs) => React.ReactNode;
  /**
   * Where this component's OWN full-screen popups (the seed-reveal modal +
   * the "Show CodexID Guard" view) should mount, via `createPortal` — NOT
   * this component's own small Zone 2 box (design.md §8 feedback round: "the
   * whole screen, not Zone 2 only"). This component is itself usually
   * mounted inside a small, fixed-height Zone 2 rectangle on mobile (see
   * `apps/codex-playground/src/App.tsx`'s `.cxpg-zone2`) — a modal rendered
   * INLINE there (the default, when this prop is omitted) is bounded to that
   * same small box, since `CodexModalShell`'s mobile flip is `position:
   * absolute` against the nearest `CodexUiRoot`, which in Zone 2's case IS
   * that small box. Pass a DOM node spanning the whole embedded Codex area
   * (a dedicated overlay, `pointer-events: none` until something portals
   * into it) to fix that. Omitted → falls back to the ORIGINAL inline
   * rendering (desktop is unaffected either way; it never had this bug,
   * since desktop's CodexID card already sits in the normal, unbounded page
   * flow).
   */
  fullScreenPortalTarget?: Element | null;
}

/**
 * The CodexID surface on the CodexUI page — built from the SAME field
 * constructors an Ouronet Account row uses (AddressFieldBox / PublicKeyFieldBox
 * / GuardFieldBox). Shows the populated identity (observational preview, or the
 * real registered identity if ever present) as two account-style address fields
 * + a "details" dropdown revealing each half's public key + a Guard field with
 * a (placeholder) Rotate Guard button; otherwise "CODEXID not yet established".
 */
export function ObservationalCodexIdDisplay({ className, onDefineIdentity, renderViewSeedModal, fullScreenPortalTarget }: ObservationalCodexIdDisplayProps) {
  const { uiSettings } = useCodex();
  const { accounts } = useOuroAccounts();
  const { keypairs } = usePureKeypairs();
  const { seeds } = useStoaChainSeeds();
  const { identity } = useCodexIdentity();
  const cfg = readObservationalCodexIdConfig(uiSettings);
  const [expanded, setExpanded] = useState(false);
  const [revealHalf, setRevealHalf] = useState<"std" | "smt" | null>(null);
  const [guardFullscreenOpen, setGuardFullscreenOpen] = useState(false);
  // Zone 2 of the CodexUI mobile shell (docs/work/codex-ui-mobile/design.md
  // §8) — a SwipeDeck of panes replaces the desktop "details" disclosure
  // toggle: there's no room to show a details section AND the overview at
  // once, so mobile always shows every pane, just one swipe at a time,
  // instead of hiding them behind `expanded`.
  const isMobile = useIsMobile();
  // Zone 2 COLLAPSIBLE, collapsed by default (docs/work/codex-ui-mobile/
  // design.md §8, the "Zone 2 collapse" round): "the define codex identity
  // is occupying too much screen estate permanently for nothing... make
  // Zone 2 collapsible, and be collapsed in by default to a single line...
  // this brings us more screen estate to Zone 3." Mobile-only concept —
  // desktop's own row/card layout is unaffected (never reads this state).
  const [collapsed, setCollapsed] = useState(true);
  const { isLocked, lock } = useCodexAuth();
  const requestLogout = useRequestLogout();
  const store = useCodexStore();

  const std = cfg.enabled ? accounts.find((a) => a.id === cfg.standardId) : undefined;
  const smt = cfg.enabled ? accounts.find((a) => a.id === cfg.smartId) : undefined;
  const observational = std && smt ? { std, smt } : null;
  // The chosen Pure-Key guard (optional).
  const guardKp = cfg.enabled && cfg.guardKeypairId
    ? keypairs.find((k) => k.id === cfg.guardKeypairId)
    : undefined;

  // The CodexID guard, as a real guard object rendered through the SAME GuardTree
  // engine the Ouronet Accounts use:
  //   • observational ⇒ a `keys-all` keyset over the chosen Pure Key (a key is
  //     not a guard — a guard is a keyset).
  //   • live (real identity) ⇒ the on-chain CodexID guard, when present.
  const codexIdGuard: unknown = guardKp
    ? { pred: "keys-all", keys: [guardKp.publicKey] }
    : (identity as { guard?: unknown } | null)?.guard ?? null;

  // Real registered identity (rare for now) — formatted is "₱.std:Π.smart".
  const realFormatted = (identity as { formatted?: string } | null)?.formatted ?? null;
  const realHalves = realFormatted && realFormatted.includes(":")
    ? { stdAddr: realFormatted.split(":")[0], smtAddr: realFormatted.split(":")[1] }
    : null;
  const populated = !!observational || !!realHalves;

  // ── Zone 2's title row is too narrow for the Lock control alongside the
  // CodexID label + badge + two per-half copy buttons (design.md §8) — ghost
  // it into Controls on mobile INSTEAD of hiding it outright.
  // `useRegisterControlsOptional` degrades safely: with no ControlsProvider
  // ancestor (e.g. real production OuronetUI, which doesn't have one yet),
  // `lockRegistered` comes back false and the title row keeps rendering the
  // control inline exactly as before — nothing goes silently unreachable.
  //
  // Gated on `populated || collapsed` (not just `populated`): the EMPTY
  // state's Lock control is NOT ghosted normally — it renders inline as its
  // own full-width row (below) — but that whole row is part of the "body"
  // hidden while Zone 2 is collapsed (the "Zone 2 collapse" round), so it
  // must ALSO ghost into Controls whenever collapsed, or it becomes
  // unreachable the moment the empty state's default collapsed view lands.
  const lockRegistered = useRegisterControlsOptional(
    "codexid-lock",
    "Codex Identity",
    isMobile && (populated || collapsed),
    [
      {
        id: "lock-toggle",
        label: isLocked ? "Unlock Codex" : "Lock Codex",
        onClick: () => {
          if (isLocked) void store.getState().actions.requestPassword().catch(() => {});
          // Same save-reminder gate CodexLockControl's "Lock Codex" button
          // uses — a UX convenience checkpoint only (see
          // SESSION_LIFECYCLE_CONTRACT.md), never a block: proceed to the
          // real lock() on any outcome except an explicit cancel.
          else void requestLogout().then((outcome) => {
            if (outcome !== "cancelled") lock();
          });
        },
      },
    ],
  );

  // The Guard pane's content can genuinely outgrow Zone 2's fixed content
  // area (a multi-key keyset) — the pane itself gets a bounded, scrollable
  // preview (below), and this Controls entry offers a full-screen view
  // regardless, so a big guard is never truly unreachable. Registered only
  // when there's an actual guard to show.
  useRegisterControlsOptional(
    "codexid-guard-fullscreen",
    "Codex Identity",
    isMobile && populated && !!codexIdGuard,
    codexIdGuard
      ? [{ id: "show-guard", label: "Show CodexID Guard", onClick: () => setGuardFullscreenOpen(true) }]
      : [],
    1,
  );

  // On mobile, Zone 2's box height is now OWNED by this component itself,
  // not a fixed-size ancestor (the "Zone 2 collapse" round) — the host's
  // `.cxpg-zone2` wrapper no longer forces a fixed height (see its own CSS
  // comment), it just lets this component's `maxHeight` dictate. Collapsed
  // caps at a single header-row's worth of height; expanded caps at the
  // SAME 190px Zone 2 has always used ("same size/area/positioning as the
  // zone 2 rectangle on the dashboard" — still honored, just now reachable
  // via a toggle instead of being permanently forced). `overflow: hidden` +
  // a `max-height` transition (not `height`, which can't animate to/from
  // `auto`) gives a smooth expand/collapse instead of an abrupt snap.
  const wrapStyle: React.CSSProperties = {
    backgroundColor: "#0a0a0a", border: "1px solid #262626", borderRadius: 12,
    padding: 12, fontFamily: "var(--codex-font, inherit)",
    display: "flex", flexDirection: "column", gap: 8,
    ...(isMobile
      ? {
          maxHeight: collapsed ? ZONE2_COLLAPSED_HEIGHT : ZONE2_EXPANDED_HEIGHT,
          minHeight: 0, overflow: "hidden", transition: "max-height 0.2s ease",
        }
      : {}),
  };

  const collapseToggle = isMobile && (
    <button
      type="button"
      onClick={() => setCollapsed((v) => !v)}
      aria-label={collapsed ? "Expand Codex Identity" : "Collapse Codex Identity"}
      title={collapsed ? "Expand Codex Identity" : "Collapse Codex Identity"}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        width: 22, height: 22, borderRadius: 6,
        background: "transparent", border: "1px solid #262626", color: "#888", cursor: "pointer",
      }}
    >
      {collapsed ? <ChevronDown style={{ width: 13, height: 13 }} /> : <ChevronUp style={{ width: 13, height: 13 }} />}
    </button>
  );

  // ── Empty state ──
  if (!observational && !realHalves) {
    const defineBtnLabel = "Define Codex Identity";
    const defineBtnTitle = onDefineIdentity ? "Define your Codex Identity" : "Define your Codex Identity — coming with Mnemosyne";

    // Mobile (design.md §8 feedback round): "the zone 2 pattern we have on
    // OuronetUI — title plus [button-like] zones" (matching the reference's
    // OWN card shape — a title bar + stacked FULL-WIDTH button rows, e.g.
    // "BASIC CONTROLS" → Activate/Firestarter/Send-Receive). The PREVIOUS
    // mobile rendering crammed icon+label+badge+button+CodexLockControl into
    // ONE horizontal row — too narrow for CodexLockControl's own countdown
    // text, which overflowed past the screen edge, and left the fixed-height
    // box mostly empty (one short row, centered, in a tall box). Title
    // (`flex: none`) + two full-width button rows (`flex: 1` each, so they
    // share the box's remaining height instead of leaving it empty) fixes
    // both at once.
    if (isMobile) {
      return (
        <div className={className} style={wrapStyle} title="Codex Identity">
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <Fingerprint style={{ width: 16, height: 16, flexShrink: 0, color: "#22c55e" }} />
            <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "#888" }}>CodexID</span>
            <span style={{ fontSize: 11, fontStyle: "italic", color: "#555" }}>not yet established</span>
            <div style={{ flex: 1 }} />
            {collapseToggle}
          </div>
          {!collapsed && (
            <>
              <button
                type="button"
                disabled={!onDefineIdentity}
                onClick={() => onDefineIdentity?.()}
                title={defineBtnTitle}
                style={{
                  flex: 1, display: "flex", width: "100%", alignItems: "center", justifyContent: "center", gap: 6,
                  padding: "10px 12px", borderRadius: 8, fontSize: 13, fontWeight: 700, fontFamily: "var(--codex-font, inherit)",
                  border: "1px solid #22c55e55", backgroundColor: "#22c55e1a", color: "#22c55e",
                  cursor: onDefineIdentity ? "pointer" : "not-allowed", opacity: onDefineIdentity ? 1 : 0.55,
                }}
              >
                <Fingerprint style={{ width: 14, height: 14 }} /> {defineBtnLabel}
              </button>
              <div style={{ flex: 1, display: "flex" }}>
                <CodexLockControl fullWidth />
              </div>
            </>
          )}
        </div>
      );
    }

    return (
      <div className={className} style={{ ...wrapStyle, flexDirection: "row", alignItems: "center", gap: 8 }} title="Codex Identity">
        <Fingerprint style={{ width: 16, height: 16, flexShrink: 0, color: "#22c55e" }} />
        <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "#888" }}>CodexID</span>
        <span style={{ fontSize: 12, fontStyle: "italic", color: "#555" }}>not yet established</span>
        <button
          type="button"
          disabled={!onDefineIdentity}
          onClick={() => onDefineIdentity?.()}
          title={defineBtnTitle}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, marginLeft: 4, padding: "5px 12px",
            borderRadius: 8, fontSize: 12, fontWeight: 600, fontFamily: "var(--codex-font, inherit)",
            border: "1px solid #22c55e55", backgroundColor: "#22c55e1a", color: "#22c55e",
            cursor: onDefineIdentity ? "pointer" : "not-allowed", opacity: onDefineIdentity ? 1 : 0.55,
          }}
        >
          <Fingerprint style={{ width: 13, height: 13 }} /> {defineBtnLabel}
        </button>
        <div style={{ flex: 1 }} />
        <CodexLockControl />
      </div>
    );
  }

  const stdAddr = observational ? observational.std.address : realHalves!.stdAddr;
  const smtAddr = observational ? observational.smt.address : realHalves!.smtAddr;
  const whole = `${stdAddr}:${smtAddr}`;

  // The Guard field's body — shared between the desktop "details" disclosure
  // and the full-screen popup (both render it UNBOUNDED — full size).
  const guardBody = codexIdGuard ? (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      {guardKp && (
        <span style={{ fontSize: 10, fontWeight: 700, color: GUARD_ACCENT }}>
          {codexIdPrimeName(CODEXID_PRIME_NAMES.guard, guardKp.label)}
        </span>
      )}
      {/* Same guard-detection engine the Ouronet Accounts use. */}
      <GuardTree guard={codexIdGuard} identifyKeySource={(k) => identifyKeySource(k, seeds, keypairs)} />
    </div>
  ) : (
    <span style={{ fontSize: 11, fontStyle: "italic", color: "#555" }}>
      no guard selected — pick a Pure Key in Codex UI Settings → Identity &amp; Backup
    </span>
  );

  // Zone 2's guard PANE (design.md §8) gets a bounded, scrollable preview
  // instead of the unbounded desktop body — a guard can genuinely outgrow
  // the fixed pane height (a multi-key keyset); `overflow: auto` on both
  // axes means it just scrolls in whichever direction it overflows, no
  // measurement/fit-detection needed. The "Show CodexID Guard" Controls
  // entry (registered above) offers the SAME `guardBody`, unbounded, in a
  // full-screen popup for anything too big to read comfortably even here.
  const guardBodyMobile = (
    <div style={{ maxHeight: 74, overflow: "auto" }}>{guardBody}</div>
  );

  const identityOverview = (
    <CodexIdField
      standardAddress={stdAddr}
      smartAddress={smtAddr}
      standardColor={STD_ACCENT}
      smartColor={SMT_ACCENT}
      compact={isMobile}
    />
  );

  // Zone 2 mobile panes (design.md §8): identity overview always first —
  // CENTERED to actually fill the pane's height (not pinned to the top
  // corner) — then, when observational, the compact Standard/Smart Public
  // Key + Guard boxes as their OWN panes, never hidden behind a details
  // toggle on mobile since swiping already reveals them.
  const mobilePanes: React.ReactNode[] = [
    <div key="overview" style={{ display: "flex", alignItems: "center", height: "100%" }}>
      {identityOverview}
    </div>,
  ];
  if (observational) {
    mobilePanes.push(
      <PublicKeyFieldBox
        key="std-key"
        label="Standard Public Key"
        publicKey={observational.std.publicKey}
        headerAction={<RevealSeedBtn compact onClick={() => setRevealHalf("std")} />}
        compact
      />,
      <PublicKeyFieldBox
        key="smt-key"
        label="Smart Public Key"
        publicKey={observational.smt.publicKey}
        headerAction={<RevealSeedBtn compact onClick={() => setRevealHalf("smt")} />}
        compact
      />,
      <GuardFieldBox key="guard" compact onRotate={() => { /* placeholder — wired in the ZBOM port */ }}>
        {guardBodyMobile}
      </GuardFieldBox>,
    );
  }

  return (
    <div className={className} style={wrapStyle}>
      {/* Header: label + tag + (Lock, when not ghosted into Controls) +
          details toggle + whole-ID copy. `flexShrink: 0` on mobile — this
          row is the "same title on every swipe" bar; the SwipeDeck below it
          (flex: 1) is what fills Zone 2's remaining bounded height. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: isMobile ? 0 : undefined }}>
        <Fingerprint style={{ width: 16, height: 16, flexShrink: 0, color: "#22c55e" }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: "#22c55e" }}>CodexID</span>
        <span style={{
          fontSize: 9, padding: "1px 6px", borderRadius: 9999, flexShrink: 0,
          ...(observational
            ? { backgroundColor: "#f9731615", color: "#f97316", border: "1px solid #f9731640" }
            : { backgroundColor: "#22c55e15", color: "#4ade80", border: "1px solid #22c55e40" }),
        }}>
          {observational ? "observational" : "registered"}
        </span>
        <div style={{ flex: 1 }} />
        {/* Per-half copy tags (color-coded to each half: Standard ₱. / Smart Π.) */}
        <CopyValueTag text={stdAddr} color={STD_ACCENT} iconOnly={isMobile} />
        <CopyValueTag text={smtAddr} color={SMT_ACCENT} iconOnly={isMobile} />
        {/* Ghosted into Controls on mobile (registered above) — kept inline
            whenever that ghosting isn't actually reachable (desktop, or no
            ControlsProvider ancestor at all). */}
        {(!isMobile || !lockRegistered) && <CodexLockControl />}
        {/* The details disclosure toggle is a DESKTOP-only affordance — on
            mobile, swiping the Zone 2 deck already reveals every pane, so
            there's nothing left for this button to toggle. */}
        {observational && !isMobile && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? "Hide details" : "Show public keys + guard"}
            style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 10, padding: "2px 8px", borderRadius: 6, background: "transparent", border: "1px solid #262626", color: "#888", cursor: "pointer" }}
          >
            {expanded ? <ChevronDown style={{ width: 12, height: 12 }} /> : <ChevronRight style={{ width: 12, height: 12 }} />}
            details
          </button>
        )}
        <span title="Copy full CodexID">
          <IconCopyBtn text={whole} size={24} />
        </span>
        {collapseToggle}
      </div>

      {isMobile ? (
        // Zone 2 (design.md §8): identity overview + (when observational)
        // Standard/Smart Public Key + Guard, one swipe at a time, filling
        // whatever height the host's Zone 2 box gives this component.
        // `peek={false}` — Zone 2's fixed box has no room to spare for a
        // sliver of the next pane; the previous default (`peek: true`)
        // showed the next pane's content bleeding in at the edge.
        // Hidden entirely while collapsed (the "Zone 2 collapse" round) —
        // the SwipeDeck still mounts underneath `overflow: hidden`/
        // `max-height: 0`-ish clipping would work too, but skipping the
        // mount outright avoids paying for its layout/measurement work
        // while the user never sees it.
        !collapsed && <SwipeDeck fill peek={false} style={{ flex: 1, minHeight: 0 }}>{mobilePanes}</SwipeDeck>
      ) : (
        <>
          {/* The epic single-rectangle, two-half CodexID display */}
          {identityOverview}

          {/* Details: each half's public key (account-style) with a Reveal Seed
              button, plus a Guard field with Rotate Guard (placeholder until
              the ZBOM port). */}
          {observational && expanded && (
            <>
              <PublicKeyFieldBox
                label="Standard Public Key"
                publicKey={observational.std.publicKey}
                headerAction={<RevealSeedBtn onClick={() => setRevealHalf("std")} />}
              />
              <PublicKeyFieldBox
                label="Smart Public Key"
                publicKey={observational.smt.publicKey}
                headerAction={<RevealSeedBtn onClick={() => setRevealHalf("smt")} />}
              />
              <GuardFieldBox onRotate={() => { /* placeholder — wired in the ZBOM port */ }}>
                {guardBody}
              </GuardFieldBox>
            </>
          )}
        </>
      )}

      {/* Per-half seed reveal (interim — the full tabbed DALOS Secret-Reveal is next).
          The concrete decrypting modal is injected by the Ouronet host so the
          generic shell carries no @stoachain crypto edge. Portaled to
          `fullScreenPortalTarget` when supplied — see that prop's doc
          comment: rendered INLINE here (the default), it would be bounded to
          THIS component's own small Zone 2 box on mobile, not the whole
          screen. */}
      {observational && portalOrInline(
        renderViewSeedModal?.({
          isOpen: revealHalf !== null,
          onClose: () => setRevealHalf(null),
          account: revealHalf === "std" ? observational.std : revealHalf === "smt" ? observational.smt : undefined,
          name: revealHalf === "std" ? "Standard half" : "Smart half",
        }),
        fullScreenPortalTarget,
      )}

      {/* The "Show CodexID Guard" Controls entry's target — full-screen,
          unbounded guard view (the SAME `guardBody` the desktop details
          section shows, just in a dedicated popup instead of a fixed pane).
          Same portal treatment as the seed-reveal modal above. */}
      {guardFullscreenOpen && portalOrInline(
        <CodexModalShell title="CodexID Guard" onClose={() => setGuardFullscreenOpen(false)}>
          {guardBody}
        </CodexModalShell>,
        fullScreenPortalTarget,
      )}
    </div>
  );
}

export default ObservationalCodexIdSettings;
