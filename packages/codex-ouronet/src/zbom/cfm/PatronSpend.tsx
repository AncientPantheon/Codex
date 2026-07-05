/**
 * CFM Pattern 2 — Patron Spend Zone
 *
 * PatronZonePattern2 — Zone 1 block for CFM modals where a Patron spends IGNIS.
 *
 * Part A: 3-way Patron Selector (Prime | Resident | Custom)
 * Part B: Patron Address Rectangle (styled like PaymentKeyDisplay)
 * Part C: Autonomic IGNIS cost display (inline, handles virtualToggleActive)
 */

import { useState, useRef, useEffect, useCallback } from "react";
import ReactDOM from "react-dom";
import { Flame, ChevronDown, ChevronRight } from "lucide-react";
import { InfoTooltip } from "../ui/InfoTooltip.js";
import { formatEU } from "@stoachain/stoa-core/pact";
import { AutonomicAmountInput } from "./inputs.js";
import { getIgnisBalance } from "../debouncer/monitoredReads.js";
import { analyzeGuard, buildCodexPubSet } from "@stoachain/stoa-core/guard";
import { useWallet, useUiSetting } from "./seam.js";
import type { IOuroAccount } from "../../types/entities.js";

// ── formatIgnisBalance ────────────────────────────────────────────────────────

function formatIgnisBalance(val: number | null): string {
  if (val === null) return "—";
  const eu = formatEU(String(val));
  const commaIdx = eu.indexOf(",");
  if (commaIdx === -1) return eu;

  const dec = eu.slice(commaIdx + 1);
  if (dec.length <= 4) {
    const trimmed = dec.replace(/0+$/, "");
    return trimmed.length === 0
      ? eu.slice(0, commaIdx)
      : eu.slice(0, commaIdx + 1) + trimmed;
  } else {
    return eu.slice(0, commaIdx + 5) + "...";
  }
}

// ── Address helpers ───────────────────────────────────────────────────────────

interface AddressParts {
  prefix2: string;
  first3: string;
  leftFill: string;
  rightFill: string;
  last3: string;
}

function parseAddress(address: string | null): AddressParts {
  const raw = address ?? "·".repeat(66);
  const mid = Math.floor(raw.length / 2);
  return {
    prefix2: raw.slice(0, 2),
    first3: raw.slice(2, 5),
    leftFill: raw.slice(5, mid),
    rightFill: raw.slice(mid, -3),
    last3: raw.slice(-3),
  };
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface PatronZonePattern2Props {
  // Selector
  patronMode: "prime" | "resident" | "custom";
  onPatronModeChange: (mode: "prime" | "resident" | "custom") => void;

  // Accounts for selector
  primeAccount: IOuroAccount | null;        // CodexPrime — first account in codex
  residentAccount: IOuroAccount | null;     // current active account
  codexAccounts: IOuroAccount[];            // all codex accounts (for Custom dropdown)
  selectedCustomAccount: IOuroAccount | null;
  onSelectCustomAccount: (account: IOuroAccount) => void;

  // IGNIS economics (from info function or mock)
  ignisCost: number;                        // e.g. 10.0
  virtualToggleActive: boolean;             // if false → show "Free" instead of amount

  // Balance (passed from parent who fetched it, null while loading)
  patronIgnisBalance: number | null;

  // Loading state
  loading?: boolean;

  /** When true, auto-selects the patron with the highest IGNIS balance on mount */
  autoSelectBestPatron?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MODES: Array<{ key: "prime" | "resident" | "custom"; label: string }> = [
  { key: "prime", label: "Prime" },
  { key: "resident", label: "Resident" },
  { key: "custom", label: "Custom" },
];

function truncAddr(addr: string): string {
  if (addr.length <= 10) return addr;
  return addr.slice(0, 4) + "…" + addr.slice(-4);
}

// ── Part A — 3-way Patron Selector ───────────────────────────────────────────

interface PatronSelectorProps {
  patronMode: "prime" | "resident" | "custom";
  onPatronModeChange: (mode: "prime" | "resident" | "custom") => void;
  codexAccounts: IOuroAccount[];
  selectedCustomAccount: IOuroAccount | null;
  onSelectCustomAccount: (account: IOuroAccount) => void;
}

function PatronSelector({
  patronMode,
  onPatronModeChange,
  codexAccounts,
  selectedCustomAccount,
  onSelectCustomAccount,
}: PatronSelectorProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dropdownPos, setDropdownPos] = useState({
    top: 0,
    left: 0,
    width: 0,
    openUpward: false,
  });

  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Exclude unactivated accounts from Custom dropdown
  const activeAccounts = codexAccounts.filter((a) => a.isActive !== false);

  const getDisplayName = (a: IOuroAccount) =>
    codexAccounts.indexOf(a) === 0 ? "CodexPrime" : a.name || a.address.slice(0, 8) + "…";

  const filtered = activeAccounts.filter(
    (a) =>
      getDisplayName(a).toLowerCase().includes(search.toLowerCase()) ||
      a.address.toLowerCase().includes(search.toLowerCase())
  );

  const openDropdown = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const dropdownHeight = 260;
      const openUpward = rect.bottom + dropdownHeight > window.innerHeight;
      setDropdownPos({
        top: openUpward ? rect.top - dropdownHeight : rect.bottom,
        left: rect.left,
        width: rect.width,
        openUpward,
      });
    }
    setDropdownOpen(true);
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  const handleSelect = (account: IOuroAccount) => {
    onSelectCustomAccount(account);
    setDropdownOpen(false);
    setSearch("");
  };

  const dropdownPortal =
    dropdownOpen && typeof window !== "undefined"
      ? ReactDOM.createPortal(
          <div
            ref={dropdownRef}
            style={{
              position: "fixed",
              top: dropdownPos.top,
              left: dropdownPos.left,
              width: dropdownPos.width,
              zIndex: 9999,
              backgroundColor: "#0f0f0f",
              border: "1px solid #262626",
              borderRadius: "8px",
              boxShadow: "0 8px 32px rgba(0,0,0,0.8)",
              overflow: "hidden",
              maxHeight: "260px",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Search */}
            <div
              style={{
                padding: "8px 12px",
                borderBottom: "1px solid #1a1a1a",
                flexShrink: 0,
              }}
            >
              <input
                type="text"
                placeholder="Search accounts..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
                style={{
                  width: "100%",
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: "#d2d3d4",
                  fontSize: "12px",
                }}
              />
            </div>

            {/* Account list */}
            <div style={{ overflowY: "auto", maxHeight: "220px" }}>
              {filtered.length === 0 ? (
                <div style={{ padding: "8px 12px", fontSize: "12px", color: "#555" }}>
                  No accounts found
                </div>
              ) : (
                filtered.map((account) => {
                  const isSelected =
                    selectedCustomAccount?.address === account.address;
                  return (
                    <button
                      key={account.address}
                      onClick={() => handleSelect(account)}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "10px 12px",
                        background: isSelected ? "#1a1a0a" : "transparent",
                        border: "none",
                        borderBottom: "1px solid #111",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                          "#141408";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                          isSelected ? "#1a1a0a" : "transparent";
                      }}
                    >
                      <span
                        style={{
                          fontSize: "12px",
                          fontWeight: "bold",
                          color: "#d2d3d4",
                        }}
                      >
                        {getDisplayName(account)}
                      </span>
                      <span
                        style={{
                          fontSize: "10px",
                          fontFamily: "monospace",
                          color: "#555",
                        }}
                      >
                        {truncAddr(account.address)}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div>
      {/* 3-way toggle */}
      <div
        className="flex rounded-lg overflow-hidden"
        style={{ border: "1px solid #262626" }}
      >
        {MODES.map((m, idx) => {
          const active = patronMode === m.key;
          const isLast = idx === MODES.length - 1;
          return (
            <button
              key={m.key}
              onClick={() => onPatronModeChange(m.key)}
              className="flex-1 py-1.5 text-xs font-bold transition-colors"
              style={{
                backgroundColor: active ? "#ceac5f" : "#0a0a0a",
                color: active ? "#0a0a0a" : "#888",
                borderRight: isLast ? "none" : "1px solid #262626",
              }}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Custom mode — static trigger field */}
      {patronMode === "custom" && (
        <div
          ref={triggerRef}
          onClick={openDropdown}
          className="flex items-center justify-between px-3 py-2 rounded-lg mt-1.5 cursor-pointer"
          style={{
            backgroundColor: "#0a0a0a",
            border: "1px solid #262626",
          }}
        >
          <span
            className="text-xs"
            style={{
              color: selectedCustomAccount ? "#d2d3d4" : "#555",
            }}
          >
            {selectedCustomAccount
              ? (selectedCustomAccount.name ?? selectedCustomAccount.address.slice(0, 8))
              : "Select Custom Patron"}
          </span>
          <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" style={{ color: "#555" }} />
        </div>
      )}

      {dropdownPortal}
    </div>
  );
}

// ── Part B — Patron Address Rectangle ────────────────────────────────────────

interface PatronAddressDisplayProps {
  patronName: string;
  patronAddress: string | null;
  patronIgnisBalance: number | null;
  hasEnoughIgnis: boolean;
  loading?: boolean;
}

function PatronAddressDisplay({
  patronName,
  patronAddress,
  patronIgnisBalance,
  hasEnoughIgnis,
  loading,
}: PatronAddressDisplayProps) {
  const { prefix2, first3, leftFill, rightFill, last3 } = parseAddress(patronAddress);

  const balanceColor =
    patronIgnisBalance === null ? "#555" : hasEnoughIgnis ? "#ff8c00" : "#c0392b";

  const formattedBalance = loading ? "…" : formatIgnisBalance(patronIgnisBalance);

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-t-lg border-x border-t"
      style={{ backgroundColor: "#060608", borderColor: "#262626" }}
    >
      {/* Left: label + address */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <span
          className="text-[9px] uppercase tracking-widest font-bold mb-0.5"
          style={{ color: "#555" }}
        >
          PATRON: {patronName}
        </span>

        {/* Address — monospace, colored spans */}
        <div
          className="flex items-center text-[10px] min-w-0 overflow-hidden"
          style={{
            fontFamily: "'Courier New', 'Lucida Console', monospace",
            whiteSpace: "nowrap",
            gap: 0,
          }}
        >
          <span style={{ color: "#3b82f6", flexShrink: 0 }}>{prefix2}</span>
          <span style={{ color: "#ceac5f", flexShrink: 0 }}>{first3}</span>
          <span
            className="flex-1 overflow-hidden"
            style={{ color: "#333", textAlign: "right", minWidth: 0, display: "block" }}
            aria-hidden
          >
            {leftFill}
          </span>
          <span
            style={{ color: "#3a3a3a", flexShrink: 0, letterSpacing: "0.05em" }}
            aria-hidden
          >
            ·······
          </span>
          <span
            className="flex-1 overflow-hidden"
            style={{ color: "#333", textAlign: "left", minWidth: 0, display: "block" }}
            aria-hidden
          >
            {rightFill}
          </span>
          <span style={{ color: "#ceac5f", flexShrink: 0 }}>{last3}</span>
        </div>
      </div>

      {/* Right: IGNIS balance + Flame icon (Rule 3) */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <span className="text-xs font-mono font-bold" style={{ color: balanceColor }}>
          {formattedBalance}
        </span>
        {patronIgnisBalance !== null && !loading && (
          <Flame className="h-3.5 w-3.5" style={{ color: balanceColor }} />
        )}
      </div>
    </div>
  );
}

// ── PatronZonePattern2 ────────────────────────────────────────────────────────

/**
 * Pattern 2 — Patron Spend Zone
 *
 * Renders a complete Zone 1 block for modals where the patron spends IGNIS:
 *   - Part A: 3-way selector (Prime | Resident | Custom) with portal dropdown for Custom
 *   - Part B: Patron address rect with IGNIS balance
 *   - Part C: Autonomic IGNIS cost display (handles virtualToggleActive + hasEnoughIgnis)
 */
export function PatronZonePattern2({
  patronMode,
  onPatronModeChange,
  primeAccount,
  residentAccount,
  codexAccounts,
  selectedCustomAccount,
  onSelectCustomAccount,
  ignisCost,
  virtualToggleActive,
  patronIgnisBalance,
  loading,
  autoSelectBestPatron = true,
}: PatronZonePattern2Props) {
  // Auto-select patron with highest IGNIS balance + keys in codex
  const { kadena: kadenaSeeds, kadenaAccounts } = useWallet();
  const [autoSelected, setAutoSelected] = useState(false);
  useEffect(() => {
    if (!autoSelectBestPatron || autoSelected) return;
    if (!primeAccount) { setAutoSelected(true); return; }

    // Only standard, activated accounts
    const eligible = codexAccounts.filter(a => !a.isSmart && a.isActive !== false);

    // Single account → select directly, no mapping needed
    if (eligible.length <= 1) {
      // Prime is default, just confirm it
      setAutoSelected(true);
      return;
    }

    let aborted = false;
    (async () => {
      try {
        const codexPubs = buildCodexPubSet(kadenaSeeds, kadenaAccounts);

        // Fetch IGNIS for all eligible accounts in parallel
        const balances = await Promise.all(
          eligible.map(async (acc) => {
            const bal = await getIgnisBalance(acc.address);
            return { account: acc, ignis: bal ? parseFloat(bal) : 0 };
          })
        );
        if (aborted) return;

        // Sort by IGNIS descending
        balances.sort((a, b) => b.ignis - a.ignis);

        // Pick the first one whose guard keys exist in codex
        let bestAccount: IOuroAccount | null = null;
        for (const entry of balances) {
          const guard = (entry.account as any)?.guard;
          if (!guard) continue;
          const analysis = analyzeGuard(guard, codexPubs);
          if (analysis.satisfied) {
            bestAccount = entry.account;
            break;
          }
        }

        if (aborted) return;

        if (!bestAccount) {
          // No account with keys in codex — default to prime
          setAutoSelected(true);
          return;
        }

        // Determine which mode to set
        if (bestAccount.address === primeAccount?.address) {
          onPatronModeChange("prime");
        } else if (bestAccount.address === residentAccount?.address) {
          onPatronModeChange("resident");
        } else {
          onSelectCustomAccount(bestAccount);
          onPatronModeChange("custom");
        }
        setAutoSelected(true);
      } catch { setAutoSelected(true); }
    })();
    return () => { aborted = true; };
  }, [autoSelectBestPatron, autoSelected, primeAccount?.address, codexAccounts.length]);

  // Internal computed values
  const patronAccount =
    patronMode === "prime"
      ? primeAccount
      : patronMode === "resident"
      ? residentAccount
      : selectedCustomAccount;

  const patronAddress = patronAccount?.address ?? null;
  const patronName = patronAccount
    ? (codexAccounts.indexOf(patronAccount) === 0
        ? "CodexPrime"
        : patronAccount.name || patronAccount.address.slice(0, 8) + "…")
    : "—";
  const hasEnoughIgnis =
    patronIgnisBalance !== null && patronIgnisBalance >= ignisCost;

  // Autonomic IGNIS display
  const displayValue = !virtualToggleActive
    ? "Free"
    : formatEU(String(ignisCost));
  const valueColor = !virtualToggleActive
    ? "#888"
    : !hasEnoughIgnis
    ? "#c0392b"
    : "#ff8c00";
  const ignisIconColor = !virtualToggleActive
    ? "#888"
    : hasEnoughIgnis
    ? "#f59e0b"
    : "#c0392b";

  const tokenIcon = virtualToggleActive ? (
    <Flame className="h-3.5 w-3.5" style={{ color: ignisIconColor }} />
  ) : null;

  // Collapsible Zone 1 — reads zbomZone1 from settings
  const zone1DefaultOpen = useUiSetting("zbomZone1", false);
  const [zone1Open, setZone1Open] = useState(zone1DefaultOpen);
  useEffect(() => { setZone1Open(zone1DefaultOpen); }, [zone1DefaultOpen]);

  const patronSelectionSetting = useUiSetting("patronSelectionMode", "wealthiest") as string;
  const patronSettingLabel = ({ wealthiest: "Wealthiest Patron", prime: "Codex Prime", resident: "Resident Account" } as Record<string, string>)[patronSelectionSetting] ?? "Wealthiest Patron";

  return (
    <div className="rounded-lg border overflow-hidden" style={{ backgroundColor: "#0a0a0f", borderColor: "#88888870" }}>
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setZone1Open((v: boolean) => !v)}
        className="w-full flex items-center gap-1.5 py-1 text-left"
        style={{ background: "transparent", border: "none", cursor: "pointer", padding: "6px 10px" }}
      >
        {zone1Open ? <ChevronDown style={{ width: 13, height: 13, color: "#555", flexShrink: 0 }} /> : <ChevronRight style={{ width: 13, height: 13, color: "#555", flexShrink: 0 }} />}
        <span style={{ fontSize: "10px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.08em", color: "#aaaaaa" }}>
          Zone 1 — PATRON
        </span>
        <span style={{ fontSize: "9px", fontFamily: "'Courier New','Lucida Console',monospace", color: "#aaaaaa80" }}>
          ({patronSettingLabel})
        </span>
      </button>

      {/* Content — always mounted (display:none when collapsed) for autoSelectBestPatron to run */}
      <div style={{ padding: "6px 12px 10px", borderTop: "1px solid #88888830", ...(zone1Open ? {} : { display: "none" }) }}>
      {/* Title */}
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#ceac5f" }}>Select Patron</span>
        <InfoTooltip content="The Patron pays the IGNIS fee for this transaction. Prime = your first Codex account. Resident = currently selected account. Custom = pick any active Codex account." />
      </div>

      {/* Part A — Patron selector */}
      <PatronSelector
        patronMode={patronMode}
        onPatronModeChange={onPatronModeChange}
        codexAccounts={codexAccounts}
        selectedCustomAccount={selectedCustomAccount}
        onSelectCustomAccount={onSelectCustomAccount}
      />

      {/* Parts B + C — address rect + autonomic input (joined) */}
      <div>
        <PatronAddressDisplay
          patronName={patronName}
          patronAddress={patronAddress}
          patronIgnisBalance={patronIgnisBalance}
          hasEnoughIgnis={hasEnoughIgnis}
          loading={loading}
        />
        <AutonomicAmountInput
          value={displayValue}
          valueColor={valueColor}
          tokenIcon={tokenIcon}
        />
      </div>
      </div>{/* close content wrapper */}
    </div>
  );
}
