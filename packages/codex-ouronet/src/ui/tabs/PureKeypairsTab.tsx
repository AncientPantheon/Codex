/**
 * PureKeypairsTab — upgraded 3-subtab interface for pure (raw `pact -g`) StoaChain
 * keypairs. NOT a 1:1 clone of My Codex — a richer surface:
 *
 *   • List      — one row per stored keypair showing ONLY the public key (its
 *                 `k:` account surfaces in the Stoa Accounts tab). Each row has a
 *                 password-gated "View Private Key" reveal (masked by default) +
 *                 copy. Protected keys (CodexGuard / Duo-prime) are delete-locked.
 *   • Generate  — mint a fresh ed25519 keypair (`genKeyPair`), show both halves
 *                 with a save-warning, then encrypt + store on confirm.
 *   • Import    — paste a known public + private key; validated by re-deriving
 *                 the public key from the private (`tryDerivePublicKey`, which
 *                 accepts both 64-hex plain Ed25519 and 128-hex BIP32-Ed25519
 *                 extended keys) and rejecting mismatches before storing.
 *                 Imported 128-hex extended keys are made signable by
 *                 InternalCodexResolver via the WASM extended-key signer.
 *
 * Private keys are stored only as `encryptedPrivateKey` (encrypted at the codex
 * password). All mutations go through `usePureKeypairs` so the signing resolver
 * stays correct. Styled with the literal hex palette (matches the other tabs).
 */

import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  KeyRound, Plus, Sparkles, Download, Copy, Check, AlertTriangle, Lock, RefreshCw, ShieldCheck, ChevronDown, ChevronRight,
} from "lucide-react";
import { smartDecrypt, encryptStringV2 } from "@stoachain/stoa-core/crypto";
import { tryDerivePublicKey } from "@stoachain/stoa-core/guard";
import { genKeyPair } from "@stoachain/kadena-stoic-legacy/cryptography-utils";
import { usePureKeypairs } from "../../hooks/index.js";
import { useCodexAuth } from "../../hooks/index.js";
import { useCodex } from "../../hooks/index.js";
import { useEnsureCodexUnlocked } from "../../zbom/hooks/useEnsureCodexUnlocked.js";
import { readObservationalCodexIdConfig, CODEXID_PRIME_NAMES, codexIdPrimeName, useIsMobile } from "@ancientpantheon/codex-ui/ui";
import { IconDeleteBtn, IconDeleteBtnDisabled } from "../internal/IconButtons.js";
import { KeyFieldsHalves } from "../internal/KeyFieldsHalves.js";
import type { IPureKeypair } from "../../types/entities.js";

const MONO = "var(--codex-font-mono, 'JetBrains Mono', ui-monospace, monospace)";
const isHex64 = (s: string) => /^[0-9a-fA-F]{64}$/.test(s.trim());
/** A pasteable private key: 64 hex (plain Ed25519) OR 128 hex (BIP32-Ed25519
 *  extended key `kL‖kR`, the Chainweaver / kadenakeys.io export format). */
const isHexPriv = (s: string) => /^([0-9a-fA-F]{64}|[0-9a-fA-F]{128})$/.test(s.trim());
const isProtected = (k: IPureKeypair) => k.isCodexGuard === true || k.wasCodexGuard === true || k.isDuoPurePrime === true;

type Sub = "list" | "generate" | "import";

const fieldInput = (mono = false): React.CSSProperties => ({
  width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 8, outline: "none",
  backgroundColor: "#0a0a0a", border: "1px solid #262626", color: "#d2d3d4", fontSize: 13,
  fontFamily: mono ? MONO : "inherit",
});
const sectionBox: React.CSSProperties = { backgroundColor: "#111", border: "1px solid #262626", borderRadius: 10, padding: 14 };
const fieldLabel: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: "#888" };

export interface PureKeypairsTabProps {
  className?: string;
  /**
   * Reports the list's OWN pagination state so `ChainwebPanel` can render
   * it in the shared "middle of the bottom seam" medallion slot — round 9/
   * 10 owner correction: "we need pagination on the pure keys as well,
   * which should kick in once enough entries exist" + "standard pagination
   * controls zone." Pure Keys NEVER has a Collapse-All medallion of its
   * own (it's a flat list, no groups), so the shared slot is always free
   * for its own pagination — same "controlled prop with internal-state
   * fallback" pattern `SeedWordsTab.tsx`'s own `onPaginationHandleChange`
   * uses: omitted (every standalone mount), this component keeps rendering
   * its own inline Prev/Next.
   */
  onPaginationHandleChange?: (
    handle: { page: number; totalPages: number; onPrev: () => void; onNext: () => void; onJump: (page: number) => void } | null,
  ) => void;
}

/** One `KeypairRow`'s measured height + the gap between rows — same
 *  measurement shape as `SeedWordsTab.tsx`'s own `useMobileSeedPageSize`
 *  (a flat, uniform-height list, no half-slot headers here — Pure Keys has
 *  no grouping concept at all). Duplicated per this package's own
 *  "self-contained module" convention. */
/** Round 26: trimmed alongside `KeypairRow`'s own mobile padding/avatar cut
 *  (58px → ~34px real row height) — same "slim, like the seed rows" ask,
 *  same treatment `SeedWordsTab.tsx`'s own `SEED_ROW_HEIGHT_FALLBACK` got
 *  in round 24. Only the FALLBACK moves; the real row is always
 *  live-measured once mounted. */
const KEYPAIR_ROW_HEIGHT_FALLBACK = 34;
const KEYPAIR_ROW_GAP = 6;

function useMobileKeypairPageSize(): {
  containerRef: React.RefObject<HTMLDivElement | null>;
  rowRef: (node: HTMLDivElement | null) => void;
  pageSize: number;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const [rowEl, setRowEl] = useState<HTMLDivElement | null>(null);
  const [rowHeight, setRowHeight] = useState(KEYPAIR_ROW_HEIGHT_FALLBACK);
  const [pageSize, setPageSize] = useState(4);

  useEffect(() => {
    if (!rowEl) return;
    const measure = () => {
      const h = rowEl.getBoundingClientRect().height;
      if (h > 0) setRowHeight(h);
    };
    measure();
    // See `SeedWordsTab.tsx`'s identical hook for why: a `ResizeObserver`
    // alone doesn't protect against the row being measured wrong on this
    // very first pass (a web font swapping in a few ms after mount, or the
    // host shell's own anchor wiring settling a frame later).
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
      // and down": the container carries `padding: KEYPAIR_ROW_GAP` on
      // every side on mobile (see its own JSX comment); `clientHeight`
      // counts that as part of the box, so subtract it back out.
      const height = el.clientHeight - 2 * KEYPAIR_ROW_GAP;
      if (height <= 0) return;
      const maxRows = Math.floor((height + KEYPAIR_ROW_GAP) / (rowHeight + KEYPAIR_ROW_GAP));
      setPageSize(Math.max(1, maxRows));
    };
    compute();
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

/** A codex can hold hundreds of pure keypairs — owner correction (round 9
 *  follow-up): "when there are more than 10 pages available the entry
 *  15/24 when clicked needs to allow the input of a given page, to jump
 *  directly to a wanted page." Below 10 pages, the plain "N / M" text is
 *  unclickable. Duplicated from `StoaAccountsTab.tsx`'s identical
 *  component per this package's own "self-contained module" convention. */
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

/** Mirrors `StoaAccountsTab.tsx`'s own Prev/Next pagination button style. */
const pageBtn = (disabled: boolean): React.CSSProperties => ({
  fontSize: 12, padding: "6px 12px", borderRadius: 8, border: "1px solid #262626", color: "#d2d3d4",
  background: "transparent", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.3 : 1,
});

/* ─────────────── List subtab ─────────────── */
function KeypairRow({
  keypair, index, onDelete, decryptFor, primeName,
}: {
  keypair: IPureKeypair;
  index: number;
  onDelete: (id: string) => void;
  decryptFor: (k: IPureKeypair) => () => Promise<string>;
  /** When set, this keypair is the prime CodexID guard — shown with this name,
   *  purple guard accent, and a locked (non-deletable) delete control. */
  primeName?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const protRaw = isProtected(keypair);
  const isGuardPrime = !!primeName;
  const locked = protRaw || isGuardPrime;
  const label = primeName ?? keypair.label ?? `Pure Key #${index + 1}`;
  const protLabel = isGuardPrime
    ? "GuardOfCodexID"
    : keypair.isCodexGuard ? "CodexGuard" : keypair.wasCodexGuard ? "retired guard" : keypair.isDuoPurePrime ? "CodexPrime" : "";
  const accent = isGuardPrime ? "#a78bfa" : protRaw ? "#ceac5f" : "#6366f1";
  const border = isGuardPrime ? "#a78bfa55" : protRaw ? "#ceac5f40" : "#262626";
  const bg = isGuardPrime ? "#a78bfa10" : protRaw ? "#ceac5f08" : "#18181B";
  const badgeColor = isGuardPrime ? "#a78bfa" : "#ceac5f";
  // Owner correction (design.md §8, the "further optimize round 6"): "i
  // want scrolling to show full entries... this must be done everywhere" —
  // opts into the scroll-snap ChainwebPanel's mobile content wrapper
  // already enables (inert unless a row opts in; desktop is unaffected).
  const isMobile = useIsMobile();

  return (
    <div data-keypair-id={keypair.id} style={{ border: `1px solid ${border}`, borderRadius: 12, overflow: "hidden", backgroundColor: bg, scrollSnapAlign: isMobile ? "start" : undefined }}>
      {/* Collapsed header — icon + label + badge, click to expand (Ouronet-Accounts style).
          Round 26 owner correction: "The key entries need to have same
          height as the seed entries, slim and they woould allow for a lot
          of entries even on smaller pages" — MOBILE ONLY fork, mirroring
          `SeedWordsTab.tsx`'s own trimmed `SeedRow` header exactly: `6px`
          top/bottom padding (was 12px) and the 32×32 avatar circle
          replaced with the same small 10×10 colour dot `SeedRow` uses —
          the avatar was this row's own height floor, same root cause as
          the seed row's old triple-dot-driven floor. Desktop keeps the
          original avatar + padding, unchanged. */}
      {isMobile ? (
        <div
          onClick={() => setExpanded((v) => !v)}
          style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 16px", cursor: "pointer" }}
        >
          {expanded
            ? <ChevronDown style={{ width: 16, height: 16, flexShrink: 0, color: accent }} />
            : <ChevronRight style={{ width: 16, height: 16, flexShrink: 0, color: "#555" }} />}
          <span
            title="Pure key"
            aria-hidden="true"
            style={{ flexShrink: 0, width: 10, height: 10, borderRadius: "50%", backgroundColor: accent }}
          />
          <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: locked ? accent : "#d2d3d4" }}>{label}</span>
          {locked && protLabel && (
            isGuardPrime
              ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 9999, fontSize: 10, fontWeight: 600, flexShrink: 0, color: badgeColor, backgroundColor: `${badgeColor}20` }}>🔒 Prime</span>
              : <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 9999, fontSize: 10, fontWeight: 600, flexShrink: 0, color: badgeColor, backgroundColor: `${badgeColor}20` }}><Lock size={10} /> {protLabel}</span>
          )}
        </div>
      ) : (
        <div
          onClick={() => setExpanded((v) => !v)}
          style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", cursor: "pointer" }}
        >
          {expanded
            ? <ChevronDown style={{ width: 16, height: 16, flexShrink: 0, color: accent }} />
            : <ChevronRight style={{ width: 16, height: 16, flexShrink: 0, color: "#555" }} />}
          <div style={{ width: 32, height: 32, borderRadius: 9999, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, backgroundColor: "#262626" }}>
            <KeyRound style={{ width: 18, height: 18, color: accent }} />
          </div>
          <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: locked ? accent : "#d2d3d4" }}>{label}</span>
          {locked && protLabel && (
            isGuardPrime
              ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 9999, fontSize: 10, fontWeight: 600, flexShrink: 0, color: badgeColor, backgroundColor: `${badgeColor}20` }}>🔒 Prime</span>
              : <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 9999, fontSize: 10, fontWeight: 600, flexShrink: 0, color: badgeColor, backgroundColor: `${badgeColor}20` }}><Lock size={10} /> {protLabel}</span>
          )}
        </div>
      )}

      {/* Expanded breakdown — public | private key halves + delete, all on one
          row (the delete sits inline at the end, matching the Seed Words rows). */}
      {expanded && (
        <div style={{ padding: "10px 16px 12px", borderTop: "1px solid #262626", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <KeyFieldsHalves publicKey={keypair.publicKey} decryptPrivate={decryptFor(keypair)} />
          </div>
          {locked
            ? <IconDeleteBtnDisabled size={28} title={`${protLabel} key cannot be removed`} />
            : <IconDeleteBtn onClick={() => onDelete(keypair.id)} size={28} />}
        </div>
      )}
    </div>
  );
}

/** A labeled divider between prime entities and the rest of a list. */
function PrimeSeparator({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "2px 0" }}>
      <div style={{ flex: 1, height: 1, backgroundColor: "#262626" }} />
      <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#555" }}>{label}</span>
      <div style={{ flex: 1, height: 1, backgroundColor: "#262626" }} />
    </div>
  );
}

/* ─────────────── Generate subtab ─────────────── */
function GenerateSubtab({ onSaved }: { onSaved: () => void }) {
  const { addKeypair } = usePureKeypairs();
  const { getCurrentPassword } = useCodexAuth();
  const ensureUnlocked = useEnsureCodexUnlocked();
  const [pair, setPair] = useState<{ publicKey: string; secretKey: string } | null>(null);
  const [label, setLabel] = useState("");
  const [copied, setCopied] = useState<"pub" | "sec" | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const generate = () => { setNotice(null); setPair(genKeyPair()); };
  const copy = (which: "pub" | "sec", text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(which); setTimeout(() => setCopied(null), 1200);
  };

  const save = async () => {
    if (!pair) return;
    setNotice(null); setSaving(true);
    try {
      if (!(await ensureUnlocked())) { setNotice("Unlock the codex to save the keypair."); setSaving(false); return; }
      const password = getCurrentPassword();
      const encryptedPrivateKey = await encryptStringV2(pair.secretKey, password);
      await addKeypair({
        id: globalThis.crypto.randomUUID(),
        label: label.trim() || undefined,
        publicKey: pair.publicKey,
        encryptedPrivateKey,
        createdAt: new Date().toISOString(),
      });
      setPair(null); setLabel("");
      onSaved();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Failed to save keypair.");
      setSaving(false);
    }
  };

  const keyField = (lbl: string, color: string, text: string, which: "pub" | "sec") => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color }}>{lbl}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <code style={{ flex: 1, fontFamily: MONO, fontSize: 12, wordBreak: "break-all", color: "#d2d3d4" }}>{text}</code>
        <button type="button" onClick={() => copy(which, text)} title="Copy"
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 6, flexShrink: 0, cursor: "pointer", backgroundColor: copied === which ? "#0a2a14" : "#141414", color: copied === which ? "#4ade80" : "#777", border: copied === which ? "2px solid rgba(74,222,128,0.4)" : "2px solid #252525" }}>
          {copied === which ? <Check size={12} strokeWidth={2.5} /> : <Copy size={12} strokeWidth={2} />}
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ ...sectionBox, display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ margin: 0, fontSize: 12, color: "#888", lineHeight: 1.5 }}>
        Generate a fresh ed25519 keypair (the standard <code style={{ color: "#6366f1" }}>pact -g</code> format). It's stored
        encrypted at your codex password and becomes available for signing.
      </p>
      <button type="button" onClick={generate}
        style={{ display: "inline-flex", alignSelf: "flex-start", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600, border: "none", backgroundColor: "#22c55e", color: "#0a0a0a", cursor: "pointer" }}>
        {pair ? <RefreshCw style={{ width: 16, height: 16 }} /> : <Sparkles style={{ width: 16, height: 16 }} />}
        {pair ? "Generate Another" : "Generate Keypair"}
      </button>

      {pair && (
        <>
          {keyField("Public Key", "#6366f1", pair.publicKey, "pub")}
          {keyField("Private Key", "#c0392b", pair.secretKey, "sec")}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 10px", borderRadius: 8, backgroundColor: "#8b1a1a10", border: "1px solid #8b1a1a40" }}>
            <AlertTriangle style={{ width: 14, height: 14, flexShrink: 0, marginTop: 2, color: "#c0392b" }} />
            <p style={{ margin: 0, fontSize: 11, lineHeight: 1.5, color: "#f0a978" }}>
              <strong>Save this private key now.</strong> After saving it's encrypted in the codex and only revealable with your password — copy it somewhere safe if you need an external backup.
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={fieldLabel}>Label (optional)</label>
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Cold key…" style={fieldInput()} />
          </div>
          <button type="button" onClick={() => void save()} disabled={saving}
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 16px", borderRadius: 10, fontSize: 13, fontWeight: 700, border: "none", backgroundColor: saving ? "#262626" : "#ceac5f", color: saving ? "#555" : "#0a0a0a", cursor: saving ? "not-allowed" : "pointer" }}>
            <KeyRound style={{ width: 16, height: 16 }} /> {saving ? "Saving…" : "Save to Codex"}
          </button>
        </>
      )}
      {notice && <p role="alert" style={{ margin: 0, fontSize: 12, color: "#c0392b" }}>{notice}</p>}
    </div>
  );
}

/* ─────────────── Import subtab ─────────────── */
function ImportSubtab({ onAdded }: { onAdded: () => void }) {
  const { addKeypair } = usePureKeypairs();
  const { getCurrentPassword } = useCodexAuth();
  const ensureUnlocked = useEnsureCodexUnlocked();
  const [pub, setPub] = useState("");
  const [sec, setSec] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const pubT = pub.trim().toLowerCase();
  const secT = sec.trim().toLowerCase();

  // Live validation: re-derive the public key from the private and compare.
  const validation = useMemo<{ state: "idle" | "ok" | "err"; msg: string }>(() => {
    if (!pub && !sec) return { state: "idle", msg: "" };
    if (sec && !isHexPriv(secT)) return { state: "err", msg: "Private key must be 64 hex (Ed25519) or 128 (Chainweaver extended key)." };
    if (pub && !isHex64(pubT)) return { state: "err", msg: "Public key must be 64 hex characters." };
    if (!isHex64(pubT) || !isHexPriv(secT)) return { state: "idle", msg: "Enter both keys to validate." };
    try {
      // tryDerivePublicKey handles BOTH formats: 64 hex → plain Ed25519,
      // 128 hex → BIP32-Ed25519 extended key (kL·B). A 128-hex key whose
      // pubkey matches is stored and made signable by InternalCodexResolver,
      // which routes it through the WASM extended-key signer.
      const derived = (tryDerivePublicKey(secT) ?? "").toLowerCase();
      if (!derived) return { state: "err", msg: "Could not derive a public key from this private key." };
      return derived === pubT
        ? { state: "ok", msg: "Keys match — the public key derives from this private key. ✓" }
        : { state: "err", msg: `Mismatch — this private key derives a different public key (${derived.slice(0, 16)}…).` };
    } catch (e) {
      return { state: "err", msg: `Validation error: ${e instanceof Error ? e.message : "invalid key"}` };
    }
  }, [pub, sec, pubT, secT]);

  const add = async () => {
    setNotice(null);
    if (validation.state !== "ok") { setNotice("Validate a matching public + private key first."); return; }
    setSaving(true);
    try {
      if (!(await ensureUnlocked())) { setNotice("Unlock the codex to add the keypair."); setSaving(false); return; }
      const password = getCurrentPassword();
      const encryptedPrivateKey = await encryptStringV2(secT, password);
      await addKeypair({
        id: globalThis.crypto.randomUUID(),
        label: label.trim() || undefined,
        publicKey: pubT,
        encryptedPrivateKey,
        createdAt: new Date().toISOString(),
      });
      setPub(""); setSec(""); setLabel("");
      onAdded();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Failed to add keypair.");
      setSaving(false);
    }
  };

  const vColor = validation.state === "ok" ? "#4ade80" : validation.state === "err" ? "#c0392b" : "#888";

  return (
    <div style={{ ...sectionBox, display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ margin: 0, fontSize: 12, color: "#888", lineHeight: 1.5 }}>
        Already have a keypair from elsewhere? Paste both halves. They're validated — the private key must
        actually derive the public key — before anything is stored.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={fieldLabel}>Public Key (64 hex)</label>
        <input type="text" value={pub} onChange={(e) => setPub(e.target.value)} placeholder="public key…" style={fieldInput(true)} spellCheck={false} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={{ ...fieldLabel, color: "#c0392b" }}>Private Key (64 or 128 hex)</label>
        <input type="text" value={sec} onChange={(e) => setSec(e.target.value)} placeholder="private (secret) key…" style={fieldInput(true)} spellCheck={false} />
      </div>

      {validation.state !== "idle" && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: vColor }}>
          {validation.state === "ok" ? <ShieldCheck size={14} /> : <AlertTriangle size={14} />}
          {validation.msg}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={fieldLabel}>Label (optional)</label>
        <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Imported key…" style={fieldInput()} />
      </div>

      <button type="button" onClick={() => void add()} disabled={saving || validation.state !== "ok"}
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 16px", borderRadius: 10, fontSize: 13, fontWeight: 700, border: "none",
          backgroundColor: !saving && validation.state === "ok" ? "#ceac5f" : "#262626", color: !saving && validation.state === "ok" ? "#0a0a0a" : "#555", cursor: !saving && validation.state === "ok" ? "pointer" : "not-allowed" }}>
        <Download style={{ width: 16, height: 16 }} /> {saving ? "Adding…" : "Add to Codex"}
      </button>
      {notice && <p role="alert" style={{ margin: 0, fontSize: 12, color: "#c0392b" }}>{notice}</p>}
    </div>
  );
}

/* ─────────────── Main tab ─────────────── */
export function PureKeypairsTab({ className, onPaginationHandleChange }: PureKeypairsTabProps) {
  const isMobile = useIsMobile();
  const { keypairs, deleteKeypair } = usePureKeypairs();
  const { getCurrentPassword } = useCodexAuth();
  const { uiSettings } = useCodex();
  const ensureUnlocked = useEnsureCodexUnlocked();
  const [sub, setSub] = useState<Sub>("list");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // The Pure Key chosen as the CodexID guard (observational) is prime: pinned
  // first, non-deletable, renamed GuardOfCodexID (original).
  const idCfg = readObservationalCodexIdConfig(uiSettings);
  const guardId = idCfg.enabled ? idCfg.guardKeypairId : "";

  const { guardKp, rest } = useMemo(() => {
    const all = [...keypairs].sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id));
    const g = guardId ? all.find((k) => k.id === guardId) : undefined;
    return { guardKp: g, rest: g ? all.filter((k) => k.id !== g.id) : all };
  }, [keypairs, guardId]);
  const sorted = guardKp ? [guardKp, ...rest] : rest;

  // MOBILE ONLY — round 9/10 owner correction: "we need pagination on the
  // pure keys as well, which should kick in once enough entries exist, of
  // course." A flat, uniform-height list (no groups, unlike Accounts) —
  // mirrors `SeedWordsTab.tsx`'s own plain pagination shape exactly,
  // including the "report externally once a caller opts in, otherwise
  // render inline" fallback rule.
  const { containerRef: keypairsPageContainerRef, rowRef: keypairsPageRowRef, pageSize: mobileKeypairPageSize } = useMobileKeypairPageSize();
  const [page, setPage] = useState(0);
  const mobilePages = useMemo(() => {
    if (sorted.length === 0) return [[]] as IPureKeypair[][];
    const out: IPureKeypair[][] = [];
    for (let i = 0; i < sorted.length; i += mobileKeypairPageSize) out.push(sorted.slice(i, i + mobileKeypairPageSize));
    return out;
  }, [sorted, mobileKeypairPageSize]);
  const totalPages = isMobile ? mobilePages.length : 1;
  const clampedPage = Math.min(page, totalPages - 1);
  const pageKeypairs = isMobile ? (mobilePages[clampedPage] ?? []) : sorted;

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

  // Per-keypair decrypt closure for PrivateKeyReveal (unlock gate + decrypt).
  const decryptFor = (k: IPureKeypair) => async () => {
    if (!(await ensureUnlocked())) throw new Error("locked");
    return smartDecrypt(k.encryptedPrivateKey, getCurrentPassword());
  };

  const handleDelete = async (id: string) => {
    setDeleteError(null);
    try { await deleteKeypair(id); }
    catch { setDeleteError("This key is protected (CodexGuard / CodexPrime) and cannot be deleted."); }
  };

  const TABS: { key: Sub; label: string; icon: typeof KeyRound; color: string }[] = [
    { key: "list", label: "Keys", icon: KeyRound, color: "#6366f1" },
    { key: "generate", label: "Generate", icon: Sparkles, color: "#22c55e" },
    { key: "import", label: "Import", icon: Download, color: "#ceac5f" },
  ];

  return (
    <div
      className={className}
      style={{
        fontFamily: "var(--codex-font, inherit)", color: "#d2d3d4", display: "flex", flexDirection: "column", gap: 12,
        // MOBILE ONLY — bounds this component to whatever height its host
        // actually gives it, so `useMobileKeypairPageSize` measures a real
        // available height instead of the list just growing with its own
        // content (same reasoning as `SeedWordsTab.tsx`'s own root wrapper).
        height: isMobile ? "100%" : undefined,
        minHeight: isMobile ? 0 : undefined,
      }}
    >
      {/* Subtab pills. Round 26 owner correction: "the 3 buttons from pure
          keys are a bit to big, making the view get a horisontal scroll...
          we should move to icons instead of thsse buttons. Then the
          buttons need to stay put, scrolling shouldnt move them." Reverses
          round 19's "keep the text, three short pills fit fine" call — on
          a genuinely narrow phone (375px) they didn't. Icon-only, small
          fixed squares (mobile only; desktop keeps its original
          left-aligned, wrapping, labeled row) — the "Keys" count moves to
          a small corner badge instead of inline text. `position: sticky`
          (mobile only) pins the row to the top of `ChainwebPanel`'s own
          scrolling ancestor (the actual scroll container — this
          component's own root has no scroller of its own), the same
          "buttons stay fixed, only entries scroll" contract every other
          fixed mobile header in this app already has, just via a lighter
          mechanism (no separate zone split needed) since this row has
          nothing else pinned alongside it. */}
      <div
        role="tablist"
        aria-label="Pure Keypairs categories"
        style={{
          display: "flex", flexWrap: isMobile ? "nowrap" : "wrap", justifyContent: isMobile ? "center" : "flex-start", gap: 8,
          position: isMobile ? "sticky" : undefined,
          top: isMobile ? 0 : undefined,
          zIndex: isMobile ? 5 : undefined,
          backgroundColor: isMobile ? "#0a0a0a" : undefined,
          paddingTop: isMobile ? 4 : undefined,
          paddingBottom: isMobile ? 4 : undefined,
        }}
      >
        {TABS.map(({ key, label, icon: Icon, color }) => {
          const active = sub === key;
          const badgeCount = key === "list" ? keypairs.length : 0;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSub(key)}
              aria-label={key === "list" ? `${label} (${keypairs.length})` : label}
              title={label}
              style={
                isMobile
                  ? {
                      position: "relative",
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      width: 44, height: 36, borderRadius: 8, cursor: "pointer",
                      border: `1px solid ${active ? color : "#262626"}`,
                      backgroundColor: active ? color + "1a" : "transparent",
                      color: active ? color : "#888",
                    }
                  : {
                      display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 16px", borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: "pointer",
                      border: `1px solid ${active ? color : "#262626"}`, backgroundColor: active ? color + "1a" : "transparent", color: active ? color : "#888",
                    }
              }
            >
              <Icon style={{ width: isMobile ? 16 : 14, height: isMobile ? 16 : 14 }} />
              {isMobile ? (
                badgeCount > 0 && (
                  <span
                    style={{
                      position: "absolute", top: -5, right: -5, minWidth: 15, height: 15, padding: "0 3px",
                      borderRadius: 9999, fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center",
                      backgroundColor: color, color: "#0a0a0a", border: "1px solid #0a0a0a",
                    }}
                  >
                    {badgeCount}
                  </span>
                )
              ) : (
                <>{label}{key === "list" ? ` (${keypairs.length})` : ""}</>
              )}
            </button>
          );
        })}
      </div>

      {sub === "list" && (
        <>
          {deleteError && <p role="alert" style={{ fontSize: 12, color: "#c0392b", margin: 0 }}>{deleteError}</p>}
          {sorted.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px 0", borderRadius: 12, border: "1px dashed #262626", color: "#555" }}>
              <p style={{ fontSize: 14, margin: "0 0 12px" }}>No pure keypairs yet.</p>
              <button type="button" onClick={() => setSub("generate")} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600, border: "none", backgroundColor: "#22c55e", color: "#0a0a0a", cursor: "pointer" }}>
                <Plus style={{ width: 16, height: 16 }} /> Generate Your First Keypair
              </button>
            </div>
          ) : isMobile ? (
            <>
              {/* MOBILE ONLY — the measured, paginated entry area (round
                  9/10 owner correction: "we need pagination on the pure
                  keys as well, which should kick in once enough entries
                  exist"). Deliberately NO `overflow: hidden` — a
                  `KeypairRow` expands INLINE (accordion, like
                  `ArweaveSeedsArea`'s own seed rows), so a page's total
                  height can legitimately grow past the measured bound
                  while a row is open; forcing a hard clip there would risk
                  silently cutting the very content the user just opened.
                  Falls back to `ChainwebPanel`'s own ancestor scroller
                  instead, same tradeoff `ArweaveSeedsArea.tsx` already
                  documents. The Prime/Guard key is differentiated by
                  colour alone here (no separator — round 8's "if we
                  remove the separator, [more] entries would have fit"
                  correction, same reasoning applied fresh to this list). */}
              <div ref={keypairsPageContainerRef} style={{ display: "flex", flexDirection: "column", gap: KEYPAIR_ROW_GAP, padding: KEYPAIR_ROW_GAP, flex: 1, minHeight: 0 }}>
                {(() => {
                  let measured = false;
                  return pageKeypairs.map((kp) => {
                    const shouldMeasure = !measured;
                    if (shouldMeasure) measured = true;
                    const isGuard = kp === guardKp;
                    return (
                      <div key={kp.id} ref={shouldMeasure ? keypairsPageRowRef : undefined}>
                        <KeypairRow
                          keypair={kp}
                          index={isGuard ? 0 : rest.indexOf(kp)}
                          onDelete={isGuard ? () => { /* prime — non-deletable */ } : (id) => void handleDelete(id)}
                          decryptFor={decryptFor}
                          primeName={isGuard ? codexIdPrimeName(CODEXID_PRIME_NAMES.guard, guardKp!.label) : undefined}
                        />
                      </div>
                    );
                  });
                })()}
              </div>
              {/* Prev/Next — rendered INLINE only when no caller opted into
                  `onPaginationHandleChange` (round 9's "standard pagination
                  controls zone" — `ChainwebPanel` renders the shared
                  medallion version otherwise). */}
              {!reportsPaginationExternally && totalPages > 1 && (
                <div style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8 }}>
                  <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={clampedPage === 0} style={pageBtn(clampedPage === 0)}>
                    ← Prev
                  </button>
                  <PageJumpIndicator page={clampedPage} totalPages={totalPages} onJump={setPage} />
                  <button type="button" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={clampedPage >= totalPages - 1} style={pageBtn(clampedPage >= totalPages - 1)}>
                    Next →
                  </button>
                </div>
              )}
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {guardKp && (
                <>
                  <KeypairRow
                    key={guardKp.id}
                    keypair={guardKp}
                    index={0}
                    onDelete={() => { /* prime — non-deletable */ }}
                    decryptFor={decryptFor}
                    primeName={codexIdPrimeName(CODEXID_PRIME_NAMES.guard, guardKp.label)}
                  />
                  {rest.length > 0 && <PrimeSeparator label="Other Pure Keys" />}
                </>
              )}
              {rest.map((kp, i) => (
                <KeypairRow key={kp.id} keypair={kp} index={i} onDelete={(id) => void handleDelete(id)} decryptFor={decryptFor} />
              ))}
            </div>
          )}
        </>
      )}

      {sub === "generate" && <GenerateSubtab onSaved={() => setSub("list")} />}
      {sub === "import" && <ImportSubtab onAdded={() => setSub("list")} />}
    </div>
  );
}

export default PureKeypairsTab;
