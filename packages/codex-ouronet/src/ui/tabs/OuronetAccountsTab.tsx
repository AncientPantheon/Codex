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
} from "lucide-react";

import { useOuroAccounts } from "../../hooks/index.js";
import { useStoaChainSeeds } from "../../hooks/index.js";
import { usePureKeypairs } from "../../hooks/index.js";
import { useCodex } from "../../hooks/index.js";
import { readObservationalCodexIdConfig, CODEXID_PRIME_NAMES, codexIdPrimeName } from "@ancientpantheon/codex-ui/ui";
import RotatePaymentKeyModal from "../../zbom/modals/RotatePaymentKeyModal.js";
import RotateGuardModal from "../../zbom/modals/RotateGuardModal.js";
import ReleaseStoicTagModal from "../../zbom/modals/ReleaseStoicTagModal.js";
import RegisterStoicTagModal from "../../zbom/modals/RegisterStoicTagModal.js";
import RotateSovereignModal from "../../zbom/modals/RotateSovereignModal.js";
import RotateGovernorModal from "../../zbom/modals/RotateGovernorModal.js";
import ActivateStandardAccountModal from "../../zbom/modals/ActivateStandardAccountModal.js";
import ActivateSmartAccountModal from "../../zbom/modals/ActivateSmartAccountModal.js";
import { flattenStoaChainAccounts } from "../../zbom/cfm/seam.js";
import { IconCopyBtn, IconDeleteBtn, IconDeleteBtnDisabled, IconRenameBtnRect } from "../internal/IconButtons.js";
import { OuronetAddressHighlight } from "../internal/OuronetAddressHighlight.js";
import { GuardTree } from "../internal/GuardTree.js";
import { detectOriginCurve } from "../internal/originCurve.js";
import { addrColor, identifyKeySource } from "../internal/keySource.js";
import { useAccountChainData } from "../internal/useAccountChainData.js";
import { MONO, GoldenBtn, VioletBtn, GreenBtn, pillStyle, sectionBox, sectionLabel } from "../internal/accountFields.js";
import { ViewSeedModal } from "../internal/ViewSeedModal.js";
import { SpawnAccountModal } from "../internal/SpawnAccountModal.js";
import type { AccountSelectorData } from "@stoachain/ouronet-core/interactions/ouroTypes";
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
    stoaChainLedger: d["payment-key-existance"] ? d["payment-key"] : account.stoaChainLedger,
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
const ACCOUNTS_PER_PAGE = 10;

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

function AccountRow({
  account, index, seeds, pureKeypairs, accounts, stoaChainAccounts, forceExpanded, paymentBalance, primeName,
}: {
  account: IOuroAccount;
  index: number;
  seeds: IStoaChainSeed[];
  pureKeypairs: IPureKeypair[];
  accounts: IOuroAccount[];
  stoaChainAccounts: IStoaChainWallet[];
  forceExpanded: boolean;
  paymentBalance: string | number | null;
  /** When set, this account is a prime CodexID half — shown with this name
   *  (StandardCodexID/SmartCodexID + original), locked + non-deletable. */
  primeName?: string;
}) {
  const { updateAccount, deleteAccount } = useOuroAccounts();
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
      {/* Header */}
      <button
        type="button"
        onClick={() => setLocalExpanded(!localExpanded)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
          textAlign: "left", background: "transparent", border: "none", cursor: "pointer",
        }}
      >
        {expanded
          ? <ChevronDown style={{ width: 16, height: 16, flexShrink: 0, color: "#ceac5f" }} />
          : <ChevronRight style={{ width: 16, height: 16, flexShrink: 0, color: "#555" }} />}
        <div style={{ width: 32, height: 32, borderRadius: 9999, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, backgroundColor: "#262626" }}>
          <Atom style={{ width: 20, height: 20, color: "#ceac5f" }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: nameColor }}>{displayName}</span>
            {locked && (
              <span style={pillStyle(
                `${isCodexIdPrime ? apolloAccent : "#ceac5f"}20`,
                isCodexIdPrime ? apolloAccent : "#ceac5f",
              )}>🔒 Prime</span>
            )}
            {stoicTag && <StoicTagPillar tag={stoicTag} />}
            <span style={pillStyle(
              isApollo ? apolloAccent + "20" : isStandard ? "#ceac5f20" : "#8b5cf620",
              isApollo ? apolloAccent : isStandard ? "#ceac5f" : "#a78bfa",
            )}>
              {isStandard ? "Standard" : "Smart"}
            </span>
            {isApollo && (
              <span style={pillStyle(apolloAccent + "15", apolloAccent, apolloAccent + "40")} title="APOLLO 1024-bit curve — observational only, cannot be activated on StoaChain™.">
                APOLLO · observational
              </span>
            )}
          </div>
        </div>
        <span style={pillStyle(
          isApollo ? apolloAccent + "20" : isActivated ? "#22c55e20" : "#8b1a1a20",
          isApollo ? apolloAccent : isActivated ? "#4ade80" : "#c0392b",
        )}>
          {isApollo ? "Observational" : isActivated ? "Active" : "Inactive"}
        </span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div style={{ padding: "0 16px 12px", borderTop: "1px solid #262626" }}>
          {/* Ouronet Address */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, minWidth: 0, overflow: "hidden", backgroundColor: "#080808", border: "1px dashed #2a2a2a", borderRadius: 6, padding: "5px 6px 5px 8px" }}>
            <span style={{ ...sectionLabel, letterSpacing: "0.08em" }}>Ouronet Account</span>
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
                <div style={{ flex: 1 }} />
                <GoldenBtn icon={<RotateCw style={{ width: 14, height: 14 }} />} label="Rotate Payment Key" onClick={() => setActiveOpId("rotate-payment-key")} />
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
                <GoldenBtn icon={<Shield style={{ width: 14, height: 14 }} />} label="Rotate Guard" onClick={() => setActiveOpId("rotate-guard")} />
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
                  ? <GreenBtn icon={<Unlink style={{ width: 14, height: 14 }} />} label="Release StoicTag" onClick={() => setActiveOpId("release-stoic-tag")} />
                  : <GreenBtn icon={<Tag style={{ width: 14, height: 14 }} />} label="Add StoicTag" onClick={() => setActiveOpId("register-stoic-tag")} />}
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
                <VioletBtn icon={<RotateCw style={{ width: 14, height: 14 }} />} label="Rotate Sovereign" onClick={() => setActiveOpId("rotate-sovereign")} />
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
                <VioletBtn icon={<RotateCw style={{ width: 14, height: 14 }} />} label="Rotate Governor" onClick={() => setActiveOpId("rotate-governor")} />
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
              {!isActivated ? (
                <span style={pillStyle("#26262680", "#888")}>codex only (not activated)</span>
              ) : account.chainPublicKey ? (
                account.publicKey === account.chainPublicKey
                  ? <span style={pillStyle("#22c55e20", "#4ade80")}>✓ codex matches chain</span>
                  : <span style={pillStyle("#8b1a1a20", "#c0392b")}>⚠ codex ≠ chain (rotated or corrupted)</span>
              ) : null}
              <div style={{ flex: 1 }} />
            </div>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 4 }}>
              <code style={{ fontFamily: MONO, fontSize: 11, wordBreak: "break-all", flex: 1, color: "#c0c0c0" }}>{account.publicKey}</code>
              <IconCopyBtn text={account.publicKey} size={28} />
            </div>
          </div>

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
              <button type="button" onClick={() => setActiveOpId(account.isSmart ? "activate-smart" : "activate-standard")} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, padding: "6px 10px", borderRadius: 6, backgroundColor: "#ceac5f", color: "#0a0a0a", border: "1px solid transparent", cursor: "pointer" }}>
                <Zap style={{ width: 14, height: 14 }} /> Activate
              </button>
            )}
            {!account.isActive && isApollo && !isCodexIdPrime && (
              <button type="button" disabled title="APOLLO is observational — activation is not supported for ₱./Π. prefixes." style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, padding: "6px 10px", borderRadius: 6, backgroundColor: "#18181B", color: apolloAccent, border: `1px solid ${apolloAccent}30`, cursor: "not-allowed", opacity: 0.8 }}>
                <Zap style={{ width: 14, height: 14 }} /> Activate
              </button>
            )}
            <div style={{ flex: 1 }} />
            {locked
              ? <IconDeleteBtnDisabled size={28} title={isCodexIdPrime ? `${primeName} cannot be removed while it is part of the CodexID` : "CodexPrime cannot be removed"} />
              : <IconDeleteBtn onClick={() => { void deleteAccount(account.id); }} size={28} />}
          </div>
        </div>
      )}

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
      <ViewSeedModal isOpen={viewSeedOpen} onClose={() => setViewSeedOpen(false)} account={account} name={displayName} />
      {void updateAccount /* reserved for optimistic post-rotate mirror */}
    </div>
  );
}

const pageBtn = (disabled: boolean): React.CSSProperties => ({
  fontSize: 12, padding: "6px 12px", borderRadius: 8, border: "1px solid #262626", color: "#d2d3d4",
  background: "transparent", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.3 : 1,
});

/* ─── Main tab ─── */
export function OuronetAccountsTab({ className }: OuronetAccountsTabProps) {
  const { accounts } = useOuroAccounts();
  const { seeds } = useStoaChainSeeds();
  const { keypairs } = usePureKeypairs();
  const { uiSettings } = useCodex();

  // The APOLLO accounts chosen for the observational CodexID are prime: pinned
  // first in their sub-tab, locked (non-deletable), renamed Standard/SmartCodexID.
  const idCfg = readObservationalCodexIdConfig(uiSettings);
  const stdPrimeId = idCfg.enabled ? idCfg.standardId : "";
  const smtPrimeId = idCfg.enabled ? idCfg.smartId : "";

  const [activeTab, setActiveTab] = useState<"standard" | "smart">("standard");
  const [page, setPage] = useState(0);
  const [allExpanded, setAllExpanded] = useState(false);
  const [spawnMode, setSpawnMode] = useState<"standard" | "smart" | null>(null);

  // Live on-chain state (URC_0027) — activation, sovereign, governor, payment
  // key + guard + balance, on-chain public key, StoicTag. The package reads the
  // same immutable Pact function My Codex uses; APOLLO accounts are excluded.
  const addresses = useMemo(() => accounts.map((a) => a.address), [accounts]);
  const { byAddress } = useAccountChainData(addresses);

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
  const totalPages = Math.ceil(restList.length / ACCOUNTS_PER_PAGE);
  const pageAccounts = restList.slice(page * ACCOUNTS_PER_PAGE, (page + 1) * ACCOUNTS_PER_PAGE);

  useEffect(() => setPage(0), [activeTab]);

  const prevStdCount = useRef(standardAccounts.length);
  const prevSmartCount = useRef(smartAccounts.length);
  useEffect(() => {
    if (smartAccounts.length > prevSmartCount.current && activeTab !== "smart") setActiveTab("smart");
    else if (standardAccounts.length > prevStdCount.current && activeTab !== "standard") setActiveTab("standard");
    prevStdCount.current = standardAccounts.length;
    prevSmartCount.current = smartAccounts.length;
  }, [standardAccounts.length, smartAccounts.length, activeTab]);

  const Pagination = () => totalPages > 1 ? (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
      <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} style={pageBtn(page === 0)}>← Prev</button>
      <span style={{ fontSize: 12, fontFamily: MONO, color: "#888" }}>{page + 1} / {totalPages}</span>
      <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} style={pageBtn(page >= totalPages - 1)}>Next →</button>
    </div>
  ) : null;

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
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <GoldenBtn icon={<PlusCircle style={{ width: 16, height: 16 }} />} label="Spawn Standard Ouronet Account" onClick={() => setSpawnMode("standard")} />
          <VioletBtn icon={<PlusCircle style={{ width: 16, height: 16 }} />} label="Spawn Smart Ouronet Account" onClick={() => setSpawnMode("smart")} />
          <button
            onClick={() => setAllExpanded(!allExpanded)}
            style={{ display: "flex", alignItems: "center", gap: 4, padding: "8px 12px", borderRadius: 12, fontSize: 12, fontWeight: 500, border: "1px solid #262626", color: "#888", background: "transparent", cursor: "pointer" }}
          >
            <ChevronsUpDown style={{ width: 14, height: 14 }} />
            {allExpanded ? "Collapse All" : "Expand All"}
          </button>
        </div>
      </div>

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
                  primeName={primeName}
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
            />
          ))}
        </div>
      ) : (
        <div style={{ textAlign: "center", padding: "32px 0", borderRadius: 12, border: "1px dashed #262626", color: "#555" }}>
          <span style={{ fontSize: 14 }}>No {activeTab} accounts in Codex</span>
        </div>
      )}

      <Pagination />

      {spawnMode && (
        <SpawnAccountModal isSmart={spawnMode === "smart"} onClose={() => setSpawnMode(null)} />
      )}
    </div>
  );
}

export default OuronetAccountsTab;
