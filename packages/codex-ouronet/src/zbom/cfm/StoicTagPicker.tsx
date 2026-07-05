/**
 * StoicTagPicker — compact popover for inserting a §StoicTag into an Ouronet
 * account field. Distinct from <AddressBookPicker> (which lists addresses);
 * this one lists known StoicTags so users can see there's a dedicated inserter.
 *
 * Sources:
 *   - "My Account Tags" — tags attached to the user's own codex accounts
 *     (account.stoicTag, sourced from URC_0027).
 *   - "Saved Tags" — entries in the Address Book's StoicTags tab.
 *
 * Selecting an entry calls onSelect("§name"); the field then resolves it.
 */
import { useState, useRef, useEffect } from "react";
import { Landmark, ChevronDown } from "lucide-react";
import { useWallet } from "./seam.js";
import { useAddressBook } from "../../hooks/index.js";

export interface StoicTagPickerProps {
  onSelect: (value: string) => void;
  className?: string;
}

interface TagEntry {
  tag: string;   // bare name (no §)
  name: string;  // human label
  group: string;
}

const GREEN = "#4ade80";

export function StoicTagPicker({ onSelect, className }: StoicTagPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { ouro } = useWallet();
  const { entries: abEntries } = useAddressBook();
  const getAddressesByType = (t: string) => abEntries.filter((e) => e.type === t);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const entries: TagEntry[] = [];
  // (a) tags attached to the user's own codex accounts
  ouro.forEach((acc, idx) => {
    const tag = acc.stoicTag;
    if (typeof tag === "string" && tag.length > 0 && !entries.some(e => e.tag === tag)) {
      const displayName = idx === 0 ? "CodexPrime" : (acc.name || `Account #${idx + 1}`);
      entries.push({ tag, name: displayName, group: "My Account Tags" });
    }
  });
  // (b) tags saved in the Address Book
  getAddressesByType("stoic-tag").forEach((ab) => {
    if (!entries.some(e => e.tag === ab.address)) {
      entries.push({ tag: ab.address, name: ab.name, group: "Saved Tags" });
    }
  });

  const grouped: Record<string, TagEntry[]> = {};
  entries.forEach((e) => { (grouped[e.group] ??= []).push(e); });

  const handleSelect = (tag: string) => {
    onSelect(`§${tag}`);
    setOpen(false);
  };

  return (
    <div ref={ref} className={`relative ${className ?? ""}`} style={{ display: "inline-flex" }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        title="Insert a StoicTag"
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: "28px", height: "28px", background: "transparent", border: "none",
          cursor: "pointer", color: open ? GREEN : "#555", flexShrink: 0,
          borderRadius: "4px", transition: "color 0.15s",
        }}
        onMouseEnter={e => (e.currentTarget.style.color = GREEN)}
        onMouseLeave={e => { if (!open) e.currentTarget.style.color = "#555"; }}
      >
        <Landmark style={{ width: 13, height: 13 }} />
      </button>

      {open && (
        <div
          style={{
            position: "absolute", bottom: "calc(100% + 4px)", right: 0, zIndex: 9999,
            minWidth: "220px", maxWidth: "300px", maxHeight: "280px", overflowY: "auto",
            backgroundColor: "#0a0a0a", border: "1px solid #262626", borderRadius: "8px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
          }}
        >
          <div style={{ padding: "8px 12px", borderBottom: "1px solid #1a1a1a", display: "flex", alignItems: "center", gap: "6px" }}>
            <Landmark style={{ width: 12, height: 12, color: GREEN }} />
            <span style={{ fontSize: "11px", fontWeight: "bold", color: GREEN, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              StoicTags
            </span>
            <ChevronDown style={{ width: 10, height: 10, color: "#555", marginLeft: "auto" }} />
          </div>

          {entries.length === 0 ? (
            <div style={{ padding: "16px 12px", textAlign: "center", color: "#555", fontSize: "12px" }}>
              No saved StoicTags.
              <div style={{ marginTop: "4px", fontSize: "10px", color: "#444" }}>
                Add one in Address Book → StoicTags, or attach a tag to an account.
              </div>
            </div>
          ) : (
            Object.entries(grouped).map(([group, items]) => (
              <div key={group}>
                <div style={{ padding: "6px 12px 2px", fontSize: "9px", fontWeight: "bold", color: "#444", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {group}
                </div>
                {items.map((item) => (
                  <button
                    key={item.tag}
                    type="button"
                    onClick={() => handleSelect(item.tag)}
                    style={{
                      display: "flex", alignItems: "center", gap: "8px", width: "100%",
                      padding: "7px 12px", background: "transparent", border: "none",
                      cursor: "pointer", textAlign: "left", transition: "background 0.1s",
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#18181B"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                  >
                    <Landmark style={{ width: 12, height: 12, color: GREEN, flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: "12px", color: GREEN, fontWeight: 600, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        §{item.tag}
                      </div>
                      <div style={{ fontSize: "10px", color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.name}
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

export default StoicTagPicker;
