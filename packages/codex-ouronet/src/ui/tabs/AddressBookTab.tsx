/**
 * AddressBookTab — token-styled, Redux-free port of OuronetUI's
 * AddressBookPage. Full address-book CRUD over `useAddressBook`; no
 * `react-redux` / `wallet-context`. Styled via `--codex-*` tokens + per-type
 * accents (inline `style`), so a consumer reskins by overriding the tokens.
 *
 * Three subsections, mirroring My Codex:
 *   • Ouronet     — Ѻ. recipient addresses (blue accent)
 *   • StoaChain™  — k:/c:/w:/u: addresses (gold accent)
 *   • StoicTags   — bare §tag names (green accent); resolved on-chain via
 *                   `getStoicTagSelectorData` (URC_0027b) to show the bound
 *                   account / released / not-registered status. The bare name
 *                   is stored in `address`; the `§` sigil is added for
 *                   display/copy and stripped on save.
 */

import { useEffect, useMemo, useState } from "react";
import { useAddressBook } from "../../hooks/index.js";
import {
  KADENA_CHAIN_ID,
  kadenaAddressValidator,
  registerChainAddressValidator,
  getRegisteredChains,
  validateAddress,
} from "../../hooks/addressBookChain.js";
import { getStoicTagSelectorData } from "@stoachain/ouronet-core/interactions/ouroAccountFunctions";
import type { StoicTagSelectorData } from "@stoachain/ouronet-core/interactions/ouroTypes";
import { codexClock } from "../../zbom/debouncer/codexClock.js";
import {
  IconCopyBtn,
  IconStoaExplorerBtn,
  IconOuronetExplorerBtn,
  IconDeleteBtn,
} from "../internal/IconButtons.js";
import type { AddressBookEntry } from "../../types/entities.js";

type TabType = AddressBookEntry["type"];

interface TabConfig {
  label: string;
  accent: string;
  addressLabel: string;
  placeholder: string;
  hint: string;
  emptyTitle: string;
  emptyAction: string;
  validate: (v: string) => boolean;
}

const TAB_CONFIG: Record<TabType, TabConfig> = {
  ouronet: {
    label: "Ouronet",
    accent: "#3b82f6",
    addressLabel: "Address",
    placeholder: "Ѻ.recipient-address…",
    hint: "Must start with Ѻ.",
    emptyTitle: "No Ouronet Accounts",
    emptyAction: "Ouronet Account",
    validate: (v) => v.startsWith("Ѻ."),
  },
  stoa: {
    label: "StoaChain™",
    accent: "#ceac5f",
    addressLabel: "Address",
    placeholder: "k:, c:, w: or u: address…",
    hint: "Must start with k:, c:, w: or u:",
    emptyTitle: "No StoaChain™ Addresses",
    emptyAction: "StoaChain™ Address",
    validate: (v) => /^[kcwu]:/.test(v),
  },
  "stoic-tag": {
    label: "StoicTags",
    accent: "#4ade80",
    addressLabel: "Tag Name",
    placeholder: "tag name (without §)…",
    hint: "A StoicTag name — stored bare, shown with §. Resolved on-chain.",
    emptyTitle: "No StoicTags",
    emptyAction: "StoicTag",
    validate: (v) => stripSigil(v).length > 0,
  },
};

const TAB_ORDER: TabType[] = ["ouronet", "stoa", "stoic-tag"];

// Register the Kadena chain validator on the module-level default registry so
// the tab dispatches every address check through the pluggable per-chain seam
// (D-10). E-series registers Arweave the same way with zero change here.
// Guarded so a re-import (HMR / repeated module eval) doesn't re-register.
if (!getRegisteredChains().includes(KADENA_CHAIN_ID)) {
  registerChainAddressValidator(KADENA_CHAIN_ID, kadenaAddressValidator);
}

const MONO = "var(--codex-font-mono, ui-monospace, monospace)";
const stripSigil = (v: string) => v.replace(/^§/, "").trim();
const trunc = (a: string) => (a.length > 26 ? `${a.slice(0, 14)}…${a.slice(-8)}` : a);
const explorerUrl = (a: string) => `https://explorer.stoachain.com/accounts/${a}`;

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export interface AddressBookTabProps {
  /** Consumer class merged onto the tab root. */
  className?: string;
}

export function AddressBookTab({ className }: AddressBookTabProps) {
  const { entries, addEntry, updateEntry, deleteEntry } = useAddressBook();

  const [activeTab, setActiveTab] = useState<TabType>("ouronet");
  const [searchQuery, setSearchQuery] = useState("");
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const [formName, setFormName] = useState("");
  const [formAddress, setFormAddress] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // StoicTag on-chain resolution (URC_0027b), keyed by bare tag name.
  const [tagStatus, setTagStatus] = useState<Record<string, StoicTagSelectorData>>({});
  const [tagLoading, setTagLoading] = useState(false);

  const cfg = TAB_CONFIG[activeTab];

  const visible = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return entries
      .filter((e) => e.type === activeTab)
      .filter(
        (e) =>
          !q ||
          e.name.toLowerCase().includes(q) ||
          e.address.toLowerCase().includes(q) ||
          (e.notes ?? "").toLowerCase().includes(q),
      );
  }, [entries, activeTab, searchQuery]);

  // Batch-resolve visible StoicTags whenever the StoicTags tab is active.
  const tagKey = activeTab === "stoic-tag" ? visible.map((e) => e.address).sort().join("|") : "";
  useEffect(() => {
    if (activeTab !== "stoic-tag") return;
    const names = tagKey ? tagKey.split("|") : [];
    if (names.length === 0) { setTagStatus({}); setTagLoading(false); return; }
    let cancelled = false;
    setTagLoading(true);
    codexClock
      .report("URC_0027b", undefined, () => getStoicTagSelectorData(names))
      .then((rows) => {
        if (cancelled) return;
        const m: Record<string, StoicTagSelectorData> = {};
        for (const r of rows) m[r["stoic-tag"]] = r;
        setTagStatus(m);
      })
      .catch(() => { if (!cancelled) setTagStatus({}); })
      .finally(() => { if (!cancelled) setTagLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab, tagKey]);

  const resetForm = () => {
    setFormName("");
    setFormAddress("");
    setFormNotes("");
    setFormError(null);
  };

  const cancelAdd = () => {
    setIsAddingNew(false);
    resetForm();
  };

  const handleSave = () => {
    const name = formName.trim();
    const raw = activeTab === "stoic-tag" ? stripSigil(formAddress) : formAddress.trim();
    if (!name || !raw) return;
    // Dispatch validation through the chain-aware registry: the Kadena chain
    // validator internally re-runs the per-type check (dispatching on the
    // orthogonal address-KIND), so the three per-type rules are preserved.
    const candidate = activeTab === "stoic-tag" ? raw : formAddress.trim();
    if (!validateAddress(KADENA_CHAIN_ID, candidate, activeTab)) {
      setFormError(cfg.hint);
      return;
    }
    if (entries.some((e) => e.type === activeTab && e.address.toLowerCase() === raw.toLowerCase())) {
      setFormError(`That ${cfg.label} entry is already saved.`);
      return;
    }
    const now = new Date().toISOString();
    void addEntry({
      id: newId(),
      name,
      address: raw,
      notes: formNotes.trim() || undefined,
      type: activeTab,
      createdAt: now,
      updatedAt: now,
    });
    cancelAdd();
  };

  const startRename = (entry: AddressBookEntry) => {
    setRenamingId(entry.id);
    setRenameValue(entry.name);
  };

  const confirmRename = () => {
    if (renamingId && renameValue.trim()) {
      void updateEntry(renamingId, { name: renameValue.trim() });
    }
    setRenamingId(null);
    setRenameValue("");
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue("");
  };

  /** The resolution status line for a StoicTag entry. */
  const renderTagStatus = (bareName: string) => {
    const st = tagStatus[bareName];
    if (!st) {
      return <span style={{ fontSize: 11, color: "#555" }}>{tagLoading ? "Resolving…" : "—"}</span>;
    }
    if (st["iz-active"]) {
      return (
        <span style={{ fontSize: 11, color: "#3b82f6", fontFamily: MONO }}>
          → {trunc(st["ouronet-account"])}
        </span>
      );
    }
    if (st["iz-released"]) {
      return <span style={{ fontSize: 11, color: "#c0392b" }}>Released — no bound account</span>;
    }
    return <span style={{ fontSize: 11, color: "#c0392b" }}>Not registered on chain</span>;
  };

  return (
    <div className={className} style={{ fontFamily: "var(--codex-font)", color: "var(--codex-text)" }}>
      {/* Tabs */}
      <div
        style={{
          display: "flex", gap: "4px", padding: "4px",
          borderRadius: "var(--codex-radius)", backgroundColor: "var(--codex-surface-2)",
          border: "1px solid var(--codex-border)", marginBottom: "16px",
        }}
      >
        {TAB_ORDER.map((tab) => {
          const active = activeTab === tab;
          const accent = TAB_CONFIG[tab].accent;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => { setActiveTab(tab); setSearchQuery(""); cancelAdd(); }}
              style={{
                flex: 1, padding: "8px 16px", borderRadius: "6px", fontSize: "14px",
                fontWeight: 600, cursor: "pointer",
                backgroundColor: active ? `${accent}1a` : "transparent",
                color: active ? accent : "var(--codex-text-dim)",
                border: active ? `1px solid ${accent}` : "1px solid transparent",
              }}
            >
              {TAB_CONFIG[tab].label}
            </button>
          );
        })}
      </div>

      {/* Search + add */}
      {!isAddingNew && (
        <div style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>
          <input
            aria-label="Search addresses"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, address, or notes…"
            style={{
              flex: 1, padding: "8px 12px", borderRadius: "var(--codex-radius)",
              backgroundColor: "var(--codex-surface)", border: "1px solid var(--codex-border)",
              color: "var(--codex-text)",
            }}
          />
          <button
            type="button"
            onClick={() => setIsAddingNew(true)}
            style={{
              padding: "8px 16px", borderRadius: "var(--codex-radius)", fontWeight: 600,
              cursor: "pointer", backgroundColor: cfg.accent, color: "var(--codex-bg)", border: "none",
            }}
          >
            Add {cfg.label}
          </button>
        </div>
      )}

      {/* Add form */}
      {isAddingNew && (
        <div
          style={{
            backgroundColor: "var(--codex-surface)", border: `1px solid ${cfg.accent}40`,
            borderRadius: "var(--codex-radius-lg)", padding: "16px", marginBottom: "24px",
            display: "flex", flexDirection: "column", gap: "12px",
          }}
        >
          <label style={{ fontSize: "12px", color: "var(--codex-text-dim)" }}>
            Name
            <input
              aria-label="Name"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="e.g., John's Wallet"
              style={inputStyle}
            />
          </label>

          <label style={{ fontSize: "12px", color: "var(--codex-text-dim)" }}>
            {cfg.addressLabel}
            <input
              aria-label={cfg.addressLabel}
              value={formAddress}
              onChange={(e) => { setFormAddress(e.target.value); setFormError(null); }}
              placeholder={cfg.placeholder}
              style={{ ...inputStyle, fontFamily: MONO, fontSize: "13px" }}
            />
            <span style={{ display: "block", marginTop: "4px", fontSize: "11px", color: "var(--codex-text-dim)" }}>
              {cfg.hint}
            </span>
          </label>

          <label style={{ fontSize: "12px", color: "var(--codex-text-dim)" }}>
            Notes (Optional)
            <textarea
              aria-label="Notes"
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              rows={3}
              style={inputStyle}
            />
          </label>

          {formError && (
            <p role="alert" style={{ margin: 0, fontSize: 12, color: "#c0392b" }}>{formError}</p>
          )}

          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              onClick={handleSave}
              disabled={!formName.trim() || !formAddress.trim()}
              style={{
                padding: "8px 16px", borderRadius: "var(--codex-radius)", fontWeight: 600,
                cursor: "pointer", backgroundColor: cfg.accent, color: "var(--codex-bg)", border: "none",
                opacity: !formName.trim() || !formAddress.trim() ? 0.5 : 1,
              }}
            >
              Save {cfg.label}
            </button>
            <button
              type="button"
              onClick={cancelAdd}
              style={{
                padding: "8px 16px", borderRadius: "var(--codex-radius)", cursor: "pointer",
                backgroundColor: "transparent", color: "var(--codex-text)", border: "1px solid var(--codex-border)",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* List / empty state */}
      {!isAddingNew &&
        (visible.length === 0 ? (
          <div
            style={{
              textAlign: "center", padding: "48px 12px", backgroundColor: "var(--codex-surface)",
              border: "1px solid var(--codex-border)", borderRadius: "var(--codex-radius-lg)",
            }}
          >
            <h3 style={{ fontSize: "20px", fontWeight: 600, marginBottom: "8px", color: "var(--codex-text)" }}>
              {searchQuery ? "No Results Found" : cfg.emptyTitle}
            </h3>
            <p style={{ color: "var(--codex-text-dim)" }}>
              {searchQuery ? "No entries match your search criteria." : `Add your first ${cfg.emptyAction} to get started.`}
            </p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: "12px" }}>
            {visible.map((entry) => {
              const isTag = entry.type === "stoic-tag";
              const displayValue = isTag ? `§${entry.address}` : entry.address;
              const copyText = displayValue;
              // Read-time chain default (D-10): a legacy entry with no chainId
              // resolves to Kadena without rewriting the stored entry.
              const chainId = entry.chainId ?? KADENA_CHAIN_ID;
              return (
                <div
                  key={entry.id}
                  data-entry-id={entry.id}
                  style={{
                    backgroundColor: "var(--codex-surface)", border: "1px solid var(--codex-border)",
                    borderRadius: "var(--codex-radius)", padding: "12px",
                  }}
                >
                  {/* Name row */}
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                    {renamingId === entry.id ? (
                      <>
                        <input
                          autoFocus
                          aria-label="Rename entry"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") confirmRename(); if (e.key === "Escape") cancelRename(); }}
                          style={{
                            flex: 1, background: "transparent", border: "none",
                            borderBottom: `1px solid ${cfg.accent}`, color: "var(--codex-text)",
                            outline: "none", fontSize: "13px", fontWeight: 600,
                          }}
                        />
                        <button type="button" aria-label="Confirm rename" onClick={confirmRename}
                          style={{ background: "none", border: "none", color: "var(--codex-success)", cursor: "pointer" }}>✓</button>
                        <button type="button" aria-label="Cancel rename" onClick={cancelRename}
                          style={{ background: "none", border: "none", color: "var(--codex-text-dim)", cursor: "pointer" }}>✕</button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          aria-label="Rename entry"
                          onClick={() => startRename(entry)}
                          style={{
                            background: "none", border: "1px solid var(--codex-border)", borderRadius: "4px",
                            color: "var(--codex-text-dim)", cursor: "pointer", padding: "2px 6px", fontSize: "11px",
                          }}
                        >
                          Rename
                        </button>
                        <span style={{ flexShrink: 0, width: 8, height: 8, borderRadius: 9999, backgroundColor: cfg.accent }} />
                        <span style={{ flex: 1, fontSize: "13px", fontWeight: 600, color: "var(--codex-text)" }}>
                          {entry.name}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Value row */}
                  <div
                    style={{
                      display: "flex", alignItems: "center", gap: "8px",
                      backgroundColor: "var(--codex-bg)", border: "1px dashed var(--codex-border)",
                      borderRadius: "6px", padding: "6px 8px",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                      <span
                        style={{
                          fontFamily: MONO, fontSize: "13px",
                          color: isTag ? "#4ade80" : "var(--codex-text)", fontWeight: isTag ? 700 : 400,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}
                      >
                        {displayValue}
                      </span>
                      {isTag && renderTagStatus(entry.address)}
                    </div>
                    <span style={{ display: "inline-flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
                      <span
                        data-chain-id={chainId}
                        title={`Chain: ${chainId}`}
                        style={{
                          fontSize: 10, fontWeight: 600, letterSpacing: "0.03em",
                          textTransform: "uppercase", padding: "2px 6px", borderRadius: 4,
                          color: cfg.accent, backgroundColor: `${cfg.accent}1a`,
                          border: `1px solid ${cfg.accent}40`, whiteSpace: "nowrap",
                        }}
                      >
                        {chainId}
                      </span>
                      <IconCopyBtn text={copyText} size={28} />
                      {entry.type === "stoa" && <IconStoaExplorerBtn href={explorerUrl(entry.address)} size={28} />}
                      {entry.type === "ouronet" && <IconOuronetExplorerBtn size={28} />}
                      <IconDeleteBtn onClick={() => void deleteEntry(entry.id)} size={28} />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
    </div>
  );
}

const inputStyle = {
  display: "block", width: "100%", marginTop: "4px", padding: "8px 12px",
  borderRadius: "var(--codex-radius)", backgroundColor: "var(--codex-surface-2)",
  border: "1px solid var(--codex-border)", color: "var(--codex-text)",
} as const;

export default AddressBookTab;
