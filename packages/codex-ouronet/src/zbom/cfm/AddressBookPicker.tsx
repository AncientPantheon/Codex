/**
 * AddressBookPicker — compact popover for quick address selection.
 * Ouronet: shows Ouronet accounts from wallet context + Ouronet AB entries.
 * Stoa: shows StoaChain accounts from wallet context + watched Stoa accounts + Stoa AB entries.
 */
import { useState, useRef, useEffect } from "react";
import { BookOpen, User, ChevronDown } from "lucide-react";
import { useWallet } from "./seam.js";
import { useAddressBook } from "../../hooks/index.js";
import { useWatchList } from "../../hooks/index.js";
import { getSeedDisplayName, sortSeeds } from "../../ui/internal/seedNames.js";

export interface AddressBookPickerProps {
  addressType: "ouronet" | "stoa";
  onSelect: (address: string, name: string) => void;
  className?: string;
}

interface PickerEntry {
  address: string;
  name: string;
  group: string;
  prime?: boolean; // CodexPrime — gold highlight
}

function truncAddr(addr: string): string {
  if (addr.length <= 16) return addr;
  return addr.slice(0, 8) + "…" + addr.slice(-6);
}

export function AddressBookPicker({ addressType, onSelect, className }: AddressBookPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { ouro, kadena, pureKeypairs } = useWallet();
  const { entries: abEntries } = useAddressBook();
  const { entries: watchEntries } = useWatchList();
  const getAddressesByType = (t: string) => abEntries.filter((e) => e.type === t);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const entries: PickerEntry[] = [];

  if (addressType === "ouronet") {
    // Ouronet accounts from wallet — index 0 is always "CodexPrime"
    ouro.forEach((acc, idx) => {
      const displayName = idx === 0 ? "CodexPrime" : (acc.name || `Account #${idx + 1}`);
      entries.push({
        address: acc.address,
        name: displayName,
        group: "My Ouronet Accounts",
        prime: idx === 0,
      });
    });
    // Ouronet AB entries
    getAddressesByType("ouronet").forEach((ab) => {
      if (!entries.some(e => e.address === ab.address)) {
        entries.push({ address: ab.address, name: ab.name, group: "Address Book" });
      }
    });
    // Note: §StoicTags have their own dedicated picker (<StoicTagPicker>).
  } else {
    // 1. Stoa AB entries first
    getAddressesByType("stoa").forEach((ab) => {
      if (!entries.some(e => e.address === ab.address)) {
        entries.push({ address: ab.address, name: ab.name, group: "Address Book" });
      }
    });
    // 2. StoaChain accounts from seeds (grouped by display name, sorted)
    const sortedSeeds = sortSeeds(kadena);
    sortedSeeds.forEach((seed) => {
      const displayName = getSeedDisplayName(seed, sortedSeeds);
      seed.accounts.forEach((acc) => {
        const addr = `k:${acc.publicKey}`;
        entries.push({ address: addr, name: `${displayName} / acc ${acc.index}`, group: displayName });
      });
    });
    // 3. Pure keypairs
    pureKeypairs.forEach((kp) => {
      const addr = `k:${kp.publicKey}`;
      if (!entries.some(e => e.address === addr)) {
        entries.push({ address: addr, name: kp.label || truncAddr(addr), group: "Pure Keys" });
      }
    });
    // 4. Watched Stoa accounts last
    watchEntries.forEach((w) => {
      if (!entries.some(e => e.address === w.address)) {
        entries.push({ address: w.address, name: w.label || truncAddr(w.address), group: "Watch List" });
      }
    });
  }

  // Group entries
  const grouped: Record<string, PickerEntry[]> = {};
  entries.forEach((e) => {
    if (!grouped[e.group]) grouped[e.group] = [];
    grouped[e.group].push(e);
  });

  const handleSelect = (address: string, name: string) => {
    onSelect(address, name);
    setOpen(false);
  };

  return (
    <div ref={ref} className={`relative ${className ?? ""}`} style={{ display: "inline-flex" }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        title="Address Book"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "28px",
          height: "28px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: open ? "#ceac5f" : "#555",
          flexShrink: 0,
          borderRadius: "4px",
          transition: "color 0.15s",
        }}
        onMouseEnter={e => (e.currentTarget.style.color = "#ceac5f")}
        onMouseLeave={e => { if (!open) e.currentTarget.style.color = "#555"; }}
      >
        <BookOpen style={{ width: 13, height: 13 }} />
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 4px)",
            right: 0,
            zIndex: 9999,
            minWidth: "240px",
            maxWidth: "320px",
            maxHeight: "280px",
            overflowY: "auto",
            backgroundColor: "#0a0a0a",
            border: "1px solid #262626",
            borderRadius: "8px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
          }}
        >
          {/* Header */}
          <div style={{ padding: "8px 12px", borderBottom: "1px solid #1a1a1a", display: "flex", alignItems: "center", gap: "6px" }}>
            <BookOpen style={{ width: 12, height: 12, color: "#ceac5f" }} />
            <span style={{ fontSize: "11px", fontWeight: "bold", color: "#ceac5f", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {addressType === "ouronet" ? "Ouronet" : "StoaChain™"}
            </span>
            <ChevronDown style={{ width: 10, height: 10, color: "#555", marginLeft: "auto" }} />
          </div>

          {entries.length === 0 ? (
            <div style={{ padding: "16px 12px", textAlign: "center", color: "#555", fontSize: "12px" }}>
              No addresses found
            </div>
          ) : (
            Object.entries(grouped).map(([group, items]) => (
              <div key={group}>
                <div style={{ padding: "6px 12px 2px", fontSize: "9px", fontWeight: "bold", color: "#444", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {group}
                </div>
                {items.map((item) => (
                  <button
                    key={item.address}
                    type="button"
                    onClick={() => handleSelect(item.address, item.name)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      width: "100%",
                      padding: "7px 12px",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#18181B"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                  >
                    <User style={{ width: 12, height: 12, color: "#ceac5f", flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: "12px", color: item.prime ? "#ceac5f" : "#d2d3d4", fontWeight: item.prime ? 700 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.name}
                      </div>
                      <div style={{ fontSize: "10px", color: "#555", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {truncAddr(item.address)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default AddressBookPicker;
