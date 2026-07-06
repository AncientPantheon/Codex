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

import { useState, useRef, useMemo, Fragment } from "react";
import {
  Lock, ChevronDown, ChevronUp, MoreVertical, Key, Eye, Edit2, Trash2, Plus, Hash, PlusCircle, Check, X, Loader2,
} from "lucide-react";
import { smartDecrypt } from "@stoachain/stoa-core/crypto";
import { KadenaWalletBuilder as StoaChainWalletBuilder } from "@stoachain/stoa-core/wallet";
import { binToHex } from "@stoachain/kadena-stoic-legacy/cryptography-utils";
import { useStoaChainSeeds } from "../../hooks/index.js";
import { useCodexAuth } from "../../hooks/index.js";
import { useEnsureCodexUnlocked } from "../../zbom/hooks/useEnsureCodexUnlocked.js";
import { IconCopyBtn, IconDeleteBtn, IconDeleteBtnDisabled, IconHideBtn } from "../internal/IconButtons.js";
import { KeyFieldsHalves } from "../internal/KeyFieldsHalves.js";
import { CreateStoaChainSeedModal } from "../internal/CreateStoaChainSeedModal.js";
import type { IStoaChainSeed, SeedType, WalletAccount } from "../../types/entities.js";

const MONO = "var(--codex-font-mono, 'JetBrains Mono', ui-monospace, monospace)";

const SEED_COLORS: Record<SeedType, { label: string; color: string; bg: string }> = {
  koala: { label: "Koala", color: "#ec4899", bg: "#4a1035" },
  chainweaver: { label: "Chainweaver", color: "#3b82f6", bg: "#1e3a5f" },
  eckowallet: { label: "EckoWallet", color: "#f97316", bg: "#431407" },
};
const normalizeSeedType = (raw: string | undefined): SeedType =>
  raw === "koala" || raw === "chainweaver" || raw === "eckowallet" ? raw : "chainweaver";

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
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 8 }}>
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
      {open && (
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
        </>
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
  seed, index, expanded, onToggle, onRename, onDeleteSeed, onAddKey, onDeleteKey,
}: {
  seed: IStoaChainSeed;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  onRename: (seed: IStoaChainSeed, name: string) => void;
  onDeleteSeed: (id: string) => void;
  onAddKey: (seed: IStoaChainSeed, index: number, onStage?: (s: string) => Promise<void> | void) => Promise<void>;
  onDeleteKey: (seed: IStoaChainSeed, index: number) => void;
}) {
  const { getCurrentPassword } = useCodexAuth();
  const ensureUnlocked = useEnsureCodexUnlocked();
  const isPrime = seed.isPrime === true || index === 0;
  const displayName = isPrime ? "Prime Codex Seed" : seed.name || `Seed #${index + 1}`;
  const cfg = SEED_COLORS[normalizeSeedType(seed.seedType)];

  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(displayName);
  const [phrase, setPhrase] = useState<string | null>(null);
  const [showCustomPos, setShowCustomPos] = useState(false);
  const [customIndex, setCustomIndex] = useState("");
  const [rowError, setRowError] = useState<string | null>(null);
  const [deriving, setDeriving] = useState<{ index: number; stage: string } | null>(null);

  const sortedAccounts = [...seed.accounts].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  const commitRename = () => {
    if (draftName.trim() && draftName.trim() !== displayName) onRename(seed, draftName.trim());
    setRenaming(false);
  };

  const handleView = async () => {
    setRowError(null);
    if (phrase) { setPhrase(null); return; }
    // Prompt for the codex password if locked. Without this, getCurrentPassword()
    // throws CodexLockedError → the catch sets rowError, but rowError only renders
    // inside the {expanded} block, so on a collapsed row the click does nothing
    // visible. The sibling reveal paths (revealPrivateKey / handleAddKey) gate the
    // same way.
    if (!(await ensureUnlocked())) { setRowError("Unlock the codex to view this seed phrase."); return; }
    try {
      const plain = await smartDecrypt(seed.secret, getCurrentPassword());
      setPhrase(plain);
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
   *      unchanged. */
  const revealPrivateKey = (account: WalletAccount) => async (): Promise<string> => {
    if (!(await ensureUnlocked())) throw new Error("locked");
    const password = getCurrentPassword();
    const mnemonic = await smartDecrypt(seed.secret, password);
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
    <div data-seed-id={seed.id} style={{ border: `1px solid ${isPrime ? "#ceac5f40" : "#262626"}`, borderRadius: 12, overflow: "hidden", backgroundColor: "#18181B" }}>
      {/* Header (a plain clickable div, NOT role=button — it hosts the rename
          inputs + the actions menu, which are real buttons; a role=button here
          would (a) invalidly nest buttons and (b) aggregate the open menu's text
          into its own accessible name). */}
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

      {/* Mnemonic reveal (from the actions menu) */}
      {phrase && (
        <div style={{ margin: "0 16px 12px", backgroundColor: "#080808", border: "1px dashed #2a2a2a", borderRadius: 8, padding: "10px 12px", fontFamily: MONO, fontSize: 13, color: "#d2d3d4", wordBreak: "break-word", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ flex: 1 }}>{phrase}</span>
          <IconCopyBtn text={phrase} size={28} />
          <IconHideBtn onClick={() => setPhrase(null)} size={28} />
        </div>
      )}

      {/* Row error (view / add-key) — rendered outside the {expanded} block so a
          "View Seed Words" failure on a collapsed row is actually visible. */}
      {rowError && <p role="alert" style={{ fontSize: 12, color: "#c0392b", margin: "0 16px 12px" }}>{rowError}</p>}

      {/* Expanded content */}
      {expanded && (
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
export function SeedWordsTab({ className }: SeedWordsTabProps) {
  const { seeds, updateSeed, deleteSeed } = useStoaChainSeeds();
  const { getCurrentPassword } = useCodexAuth();
  const ensureUnlocked = useEnsureCodexUnlocked();
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [createOpen, setCreateOpen] = useState(false);
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

  const handleRename = (seed: IStoaChainSeed, name: string) => void updateSeed({ ...seed, name });

  const handleDeleteSeed = async (id: string) => {
    setTopError(null);
    try { await deleteSeed(id); } catch { setTopError("This seed is protected and cannot be deleted."); }
  };

  /** Derive a key at `index` from the seed's mnemonic and persist it. `onStage`
   *  is awaited before each step so the progress label (and the compositor sweep
   *  bar) paint before the CPU-heavy derivation blocks the main thread. */
  const handleAddKey = async (
    seed: IStoaChainSeed,
    index: number,
    onStage?: (s: string) => Promise<void> | void,
  ) => {
    await onStage?.("Unlocking codex…");
    if (!(await ensureUnlocked())) throw new Error("Unlock the codex to add keys.");
    const password = getCurrentPassword();
    await onStage?.("Decrypting seed…");
    const mnemonic = await smartDecrypt(seed.secret, password);
    await onStage?.("Deriving keypair…");
    const kp = await StoaChainWalletBuilder.createWalletPairFromMnemonic(password, mnemonic, index, seed.seedType);
    await onStage?.("Saving key…");
    const newAcc: WalletAccount = { index, publicKey: kp.publicKey, derivationPath: derivationPath(index) };
    const accounts = [...seed.accounts.filter((a) => a.index !== index), newAcc].sort((a, b) => a.index - b.index);
    await updateSeed({ ...seed, accounts });
  };

  const handleDeleteKey = (seed: IStoaChainSeed, index: number) => {
    void updateSeed({ ...seed, accounts: seed.accounts.filter((a) => a.index !== index) });
  };

  return (
    <div className={className} style={{ fontFamily: "var(--codex-font, inherit)", color: "#d2d3d4", display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header: total + Create New Seed */}
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

      {topError && <p role="alert" style={{ fontSize: 12, color: "#c0392b", margin: 0 }}>{topError}</p>}

      {seeds.length === 0 ? (
        <div style={{ textAlign: "center", padding: "32px 0", borderRadius: 12, border: "1px dashed #262626", color: "#555" }}>
          <p style={{ fontSize: 14, margin: "0 0 12px" }}>No seeds in the codex yet.</p>
          <button type="button" onClick={() => setCreateOpen(true)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600, border: "none", backgroundColor: "#ceac5f", color: "#0a0a0a", cursor: "pointer" }}>
            <PlusCircle style={{ width: 16, height: 16 }} /> Create Your First Seed
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {orderedSeeds.map((seed, idx) => {
            const isPrime = seed.isPrime === true || idx === 0;
            return (
              <Fragment key={seed.id}>
                <SeedRow
                  seed={seed}
                  index={idx}
                  expanded={!!expandedIds[seed.id]}
                  onToggle={() => toggle(seed.id)}
                  onRename={handleRename}
                  onDeleteSeed={(id) => void handleDeleteSeed(id)}
                  onAddKey={handleAddKey}
                  onDeleteKey={handleDeleteKey}
                />
                {/* Separator after the prime seed, before the rest. */}
                {isPrime && idx === 0 && orderedSeeds.length > 1 && <PrimeSeparator label="Other Seeds" />}
              </Fragment>
            );
          })}
        </div>
      )}

      {createOpen && <CreateStoaChainSeedModal onClose={() => setCreateOpen(false)} />}
    </div>
  );
}

export default SeedWordsTab;
