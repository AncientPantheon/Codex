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

import { useMemo, useState } from "react";
import {
  ChevronDown, ChevronRight, Eye, RefreshCw, Loader2, Plus, Check, X, Pencil,
} from "lucide-react";
import { STOA_CHAINS } from "@stoachain/stoa-core/constants";
import { useKadenaSeeds } from "../../hooks/index.js";
import { usePureKeypairs } from "../../hooks/index.js";
import { useWatchList } from "../../hooks/index.js";
import { IconCopyBtn, IconStoaExplorerBtn, IconDeleteBtn } from "../internal/IconButtons.js";
import { useStoaChainBalances, type StoaAccountBalances } from "../internal/useStoaChainBalances.js";
import type { IKadenaSeed } from "../../types/entities.js";

const MONO = "var(--codex-font-mono, 'JetBrains Mono', ui-monospace, monospace)";
const ADDR_PREFIXES = ["k:", "u:", "c:", "w:"];
const ADDR_COLORS: Record<string, string> = { "k:": "#c0c0c0", "u:": "#92400e", "c:": "#3b82f6", "w:": "#a78bfa" };
const SEED_TYPE_COLOR: Record<string, string> = { chainweaver: "#3b82f6", eckowallet: "#f97316", koala: "#ec4899" };

const truncAddr = (a: string) => (a.length > 24 ? `${a.slice(0, 12)}…${a.slice(-10)}` : a);
const fmt12 = (n: number) => n.toFixed(12);
const explorerUrl = (a: string) => `https://explorer.stoachain.com/accounts/${a}`;

interface AddrEntry { address: string; sublabel: string; watchId?: string }

export interface StoaAccountsTabProps {
  className?: string;
}

/* ─────────────── Address row ─────────────── */
function AddressRow({
  entry, bal, loading, onRemove, onRelabel,
}: {
  entry: AddrEntry;
  bal: StoaAccountBalances | undefined;
  loading: boolean;
  onRemove?: () => void;
  onRelabel?: (label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.sublabel);
  const prefix = entry.address.slice(0, 2);
  const prefixColor = ADDR_COLORS[prefix] ?? "#888";

  const totalLabel = !bal || bal.isEmpty ? "Empty" : bal.total === 0 ? "0.0 STOA" : `${fmt12(bal.total)} STOA`;
  const totalColor = bal && !bal.isEmpty && bal.total > 0 ? "#ceac5f" : "#555";

  return (
    <div data-stoa-address={entry.address} style={{ border: "1px solid #262626", borderRadius: 12, overflow: "hidden", backgroundColor: "#18181B" }}>
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
          <IconCopyBtn text={entry.address} size={28} />
          <IconStoaExplorerBtn href={explorerUrl(entry.address)} size={28} />
          {onRemove && <IconDeleteBtn onClick={onRemove} size={28} />}
        </span>
      </div>

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
  );
}

/* ─────────────── Collapsible group ─────────────── */
function GroupRow({ name, color, count, children }: { name: string; color: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ border: "1px solid #262626", borderRadius: 12, overflow: "hidden" }}>
      <div onClick={() => setOpen((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", cursor: "pointer", backgroundColor: "#0d0d0d" }}>
        {open ? <ChevronDown style={{ width: 16, height: 16, flexShrink: 0, color }} /> : <ChevronRight style={{ width: 16, height: 16, flexShrink: 0, color: "#555" }} />}
        <span style={{ flex: 1, fontWeight: 600, fontSize: 14, color: "#d2d3d4" }}>{name}</span>
        <span style={{ fontSize: 11, fontWeight: 600, padding: "1px 8px", borderRadius: 9999, color: "#555", backgroundColor: "#1a1a1a" }}>{count}</span>
      </div>
      {open && <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10 }}>{children}</div>}
    </div>
  );
}

/* ─────────────── Main tab ─────────────── */
export function StoaAccountsTab({ className }: StoaAccountsTabProps) {
  const { seeds } = useKadenaSeeds();
  const { keypairs } = usePureKeypairs();
  const { entries: watchEntries, addEntry, deleteEntry } = useWatchList();
  const [subTab, setSubTab] = useState<"codex" | "watch">("codex");
  const [watchInput, setWatchInput] = useState("");
  const [watchError, setWatchError] = useState<string | null>(null);

  // Build the codex groups (one per seed + a Pure Key Pairs group).
  const groups = useMemo(() => {
    const out: { id: string; name: string; color: string; entries: AddrEntry[] }[] = [];
    seeds.forEach((seed: IKadenaSeed, i) => {
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
  // Watch entries that aren't already codex accounts.
  const watchAddrs = useMemo(() => watchEntries.filter((w) => !codexAddressSet.has(w.address)), [watchEntries, codexAddressSet]);

  const allAddresses = useMemo(() => [...codexAddresses, ...watchAddrs.map((w) => w.address)], [codexAddresses, watchAddrs]);
  const { byAddress, loading, error, refresh } = useStoaChainBalances(allAddresses, codexAddresses);

  const totalCodex = codexAddresses.length;

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

  return (
    <div className={className} style={{ fontFamily: "var(--codex-font, inherit)", color: "#d2d3d4", display: "flex", flexDirection: "column", gap: 16 }}>
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
        {/* Live-chain status */}
        {loading ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "#888" }}><RefreshCw style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> Reading balances…</span>
        ) : error ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "#c0392b" }}>⚠ Balance read failed</span>
        ) : (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "#4ade80" }}>✓ Live balances</span>
        )}
        <button type="button" onClick={refresh} title="Refresh balances" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 6, border: "1px solid #262626", background: "transparent", color: "#888", cursor: "pointer", fontSize: 11 }}><RefreshCw style={{ width: 11, height: 11 }} /> Refresh</button>
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

      {subTab === "codex" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {groups.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px 0", borderRadius: 12, border: "1px dashed #262626", color: "#555", fontSize: 14 }}>No Stoa accounts in the codex.</div>
          ) : (
            groups.map((g) => (
              <GroupRow key={g.id} name={g.name} color={g.color} count={g.entries.length}>
                {g.entries.map((e) => (
                  <AddressRow key={e.address} entry={e} bal={byAddress[e.address]} loading={loading && !byAddress[e.address]} />
                ))}
              </GroupRow>
            ))
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
                loading={loading && !byAddress[w.address]}
                onRemove={() => void deleteEntry(w.id)}
                onRelabel={(label) => void addEntry({ ...w, label })}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default StoaAccountsTab;
