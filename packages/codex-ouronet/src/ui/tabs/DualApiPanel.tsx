/**
 * DualApiPanel — the "Dual API" sub-tab of the Ouronet accounts view.
 *
 * Lists the codex's mutually-linked dual API keys — a registered Standard (₱.)
 * half whose `counterpart` points at a Smart (Π.) half. Each such pair forms the
 * composite `<standard>|<smart>` (standard first, the on-chain `PYTHIA|T|DualLinks`
 * key), read via the new `DPL-UR.URC_0033_DualApiKeyMapper` (→ per-key
 * `PYTHIA.UR_DualLinkRowOrNull`). The Pythia deploy/rename STOA prices come from
 * `DPL-UR.URC_0034_PythiaPrices`.
 *
 * ITERATION 1: the dual-link row is rendered DEFENSIVELY — the documented fields
 * (standard-apollo / smart-apollo / consumer-lane / iz-active) are labelled, and
 * any OTHER keys the live row carries are dumped raw — so the exact on-chain
 * shape surfaces on inspection and the user can say what to keep. The row actions
 * (rename lane / kill switch) are stubbed pending the wiring pass.
 */

import { useState, useMemo, useEffect } from "react";
import { KeyRound, Pencil, Power, RefreshCw } from "lucide-react";
import type { IOuroAccount } from "../../types/entities.js";
import {
  type ApiKeyRow,
  type DualLinkRow,
  type PythiaPrices,
  isApiKeyRegistered,
  isApiKeyLinked,
  buildDualKey,
  splitDualKey,
  getDualApiKeySelectorData,
  getPythiaPrices,
} from "../../zbom/pythia/deployApiKey.js";
import { OuronetAddressHighlight } from "../internal/OuronetAddressHighlight.js";
import { IconCopyBtn } from "../internal/IconButtons.js";
import { MONO, pillStyle, sectionLabel } from "../internal/accountFields.js";
import { usePostTxRefresh } from "../../zbom/toast/usePostTxRefresh.js";
import RenameDualLaneModal from "../../zbom/modals/RenameDualLaneModal.js";
import RevokeDualLinkModal from "../../zbom/modals/RevokeDualLinkModal.js";

// Fields the panel renders as first-class rows (confirmed live shape). Anything
// NOT in here is dumped raw, so a future contract change surfaces on sight.
const KNOWN_FIELDS = new Set([
  "standard-apollo", "smart-apollo", "consumer-lane", "iz-active",
  "is-registered", "linked-at", "updated-at", "dual-link-key",
]);

function activePill(row: DualLinkRow | null) {
  if (!row) return <span style={pillStyle("#26262699", "#888")}>no dual-link row</span>;
  const a = row["iz-active"];
  if (a === true) return <span style={pillStyle("#16a34a20", "#4ade80", "#16a34a55")}>active</span>;
  if (a === false) return <span style={pillStyle("#8b1a1a20", "#c0392b")}>revoked</span>;
  return <span style={pillStyle("#3f3f46", "#a1a1aa")}>pending</span>;
}

/** Pact `time` values arrive as `{ timep: "…Z" }` (or legacy `{ time: … }`).
 *  Show the ISO instant; fall back to the raw JSON if the shape is unexpected. */
function fmtTime(v: unknown): string {
  if (v && typeof v === "object") {
    const t = (v as { timep?: unknown; time?: unknown }).timep ?? (v as { time?: unknown }).time;
    if (typeof t === "string") return t.replace("T", " ").replace(/\.\d+Z$/, "Z");
  }
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** Render any non-standard keys the live row carries, so a future contract change
 *  surfaces on sight (nothing dumped for the current, fully-known shape). */
function extraFields(row: DualLinkRow): Array<[string, string]> {
  return Object.entries(row)
    .filter(([k]) => !KNOWN_FIELDS.has(k))
    .map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)]);
}

export interface DualApiPanelProps {
  standardApollo: IOuroAccount[];
  smartApollo: IOuroAccount[];
  apiKeyMap: Map<string, ApiKeyRow> | null;
  /** All codex accounts — passed through to the Rename/Revoke modals. */
  accounts: IOuroAccount[];
}

export function DualApiPanel({ standardApollo, smartApollo, apiKeyMap, accounts }: DualApiPanelProps) {
  // Which per-row op modal is open (rename lane / revoke), keyed by the composite.
  const [opModal, setOpModal] = useState<{ op: "rename" | "revoke"; key: string } | null>(null);
  // Names for pretty display (address → codex account name).
  const nameByAddr = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of [...standardApollo, ...smartApollo]) if (a.name) m.set(a.address, a.name);
    return m;
  }, [standardApollo, smartApollo]);

  // Build the composite dual keys from the codex's LINKED Standard halves:
  // composite = `<standard>|<counterpart>` (counterpart is the Smart half).
  const dualKeys = useMemo(() => {
    if (!apiKeyMap) return [];
    const keys: string[] = [];
    for (const std of standardApollo) {
      const row = apiKeyMap.get(std.address);
      if (isApiKeyRegistered(row) && isApiKeyLinked(row)) {
        keys.push(buildDualKey(std.address, row!.counterpart));
      }
    }
    return keys;
  }, [standardApollo, apiKeyMap]);

  const [rows, setRows] = useState<Map<string, DualLinkRow | null> | null>(null);
  const [prices, setPrices] = useState<PythiaPrices | null>(null);
  const [nonce, setNonce] = useState(0);
  // Re-read after any tx confirms (a Link/Revoke/Rename), on top of the manual
  // Refresh button. The dual-link ROWS also refresh transitively once the tab's
  // URC_0031 apiKeyMap updates (which drives `dualKeys`).
  const txNonce = usePostTxRefresh();

  useEffect(() => {
    let aborted = false;
    void getPythiaPrices().then((p) => { if (!aborted) setPrices(p); });
    return () => { aborted = true; };
  }, [nonce, txNonce]);

  useEffect(() => {
    if (apiKeyMap === null) { setRows(null); return; }
    if (dualKeys.length === 0) { setRows(new Map()); return; }
    let aborted = false;
    setRows(null);
    void getDualApiKeySelectorData(dualKeys).then((res) => {
      if (aborted) return;
      const m = new Map<string, DualLinkRow | null>();
      dualKeys.forEach((k, i) => m.set(k, res[i] ?? null));
      setRows(m);
    });
    return () => { aborted = true; };
  }, [dualKeys, apiKeyMap, nonce]);

  const loading = apiKeyMap === null || rows === null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 13, color: "#8a8a8a", lineHeight: 1.5 }}>
        A <strong style={{ color: "#ceac5f" }}>dual API key</strong> is a registered Standard (₱.) half
        linked to its Smart (Π.) counterpart — read as one on-chain identity via{" "}
        <code style={{ fontFamily: MONO, fontSize: 12, color: "#ceac5f" }}>URC_0033_DualApiKeyMapper</code>.
      </div>

      {/* Pricing banner (URC_0034) */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", borderRadius: 12, border: "1px solid #262626", background: "#0d1117", padding: "10px 14px" }}>
        <span style={sectionLabel}>Pythia prices</span>
        {prices ? (
          <>
            <span style={pillStyle("#ceac5f15", "#ceac5f")}>{prices["deploy-price-text"] ?? `${prices["deploy-price"]} STOA deploy`}</span>
            <span style={pillStyle("#a78bfa15", "#a78bfa")}>{prices["rename-price-text"] ?? `${prices["rename-price"]} STOA rename`}</span>
          </>
        ) : (
          <span style={{ fontSize: 12, color: "#666", fontStyle: "italic" }}>reading…</span>
        )}
        <div style={{ flex: 1 }} />
        <button type="button" onClick={() => setNonce((n) => n + 1)} title="Refresh chain reads"
          style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 8, fontSize: 12, border: "1px solid #262626", background: "transparent", color: "#888", cursor: "pointer" }}>
          <RefreshCw style={{ width: 13, height: 13 }} /> Refresh
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "32px 0", borderRadius: 12, border: "1px dashed #262626", color: "#555", fontSize: 13 }}>
          reading dual-link rows off StoaChain…
        </div>
      ) : dualKeys.length === 0 ? (
        <div style={{ textAlign: "center", padding: "32px 0", borderRadius: 12, border: "1px dashed #262626", color: "#555", fontSize: 13 }}>
          No dual API keys in this Codex — link a Standard and a Smart half in the <strong>Single API</strong> tab first.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {dualKeys.map((key) => {
            const row = rows?.get(key) ?? null;
            // Defensive: a genuine dual-link row is `is-registered: true`. If a
            // stray composite ever slips through, skip it rather than show a
            // 1970 / empty phantom card.
            if (row && row["is-registered"] === false) return null;
            const halves = splitDualKey(key);
            return (
              <div key={key} style={{ borderRadius: 12, border: "1px solid #262626", background: "#0d1117", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                {/* Header: composite + status + actions */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <KeyRound style={{ width: 15, height: 15, color: "#ceac5f", flexShrink: 0 }} />
                  <span style={sectionLabel}>Dual API Key</span>
                  {activePill(row)}
                  <div style={{ flex: 1 }} />
                  <IconCopyBtn text={key} size={26} />
                  {(() => {
                    // Rename + Revoke are only meaningful on an ACTIVE dual link —
                    // disable BOTH once the row is already revoked (iz-active false).
                    const alreadyRevoked = row?.["iz-active"] === false;
                    return (
                      <>
                        <button type="button" disabled={alreadyRevoked}
                          onClick={() => { if (!alreadyRevoked) setOpModal({ op: "rename", key }); }}
                          title={alreadyRevoked ? "Revoked — can't rename a deactivated link" : "Rename this dual key's consumer lane (100 STOA)"}
                          style={rowActionBtn("#a78bfa", alreadyRevoked)}>
                          <Pencil style={{ width: 13, height: 13 }} /> Rename lane
                        </button>
                        <button type="button" disabled={alreadyRevoked}
                          onClick={() => { if (!alreadyRevoked) setOpModal({ op: "revoke", key }); }}
                          title={alreadyRevoked ? "Already revoked — deploy fresh halves to re-pair" : "Kill switch — revoke (deactivate) this dual key (1 IGNIS)"}
                          style={rowActionBtn("#c0392b", alreadyRevoked)}>
                          <Power style={{ width: 13, height: 13 }} /> {alreadyRevoked ? "Revoked" : "Revoke"}
                        </button>
                      </>
                    );
                  })()}
                </div>

                {/* The composite key string */}
                <code style={{ fontFamily: MONO, fontSize: 12, wordBreak: "break-all", color: "#8a8a8a", background: "#080808", border: "1px dashed #2a2a2a", borderRadius: 6, padding: "6px 8px" }}>{key}</code>

                {/* The two halves */}
                {halves && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <HalfRow accent="#ceac5f" tag="₱. Standard" address={halves.standard} name={nameByAddr.get(halves.standard)} />
                    <HalfRow accent="#a78bfa" tag="Π. Smart" address={halves.smart} name={nameByAddr.get(halves.smart)} />
                  </div>
                )}

                {/* Dual-link row fields */}
                {row ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, borderTop: "1px solid #1f1f23", paddingTop: 8 }}>
                    <FieldLine label="Consumer lane" value={row["consumer-lane"] != null && String(row["consumer-lane"]).length > 0 ? String(row["consumer-lane"]) : "— (none)"} />
                    {row["linked-at"] != null && <FieldLine label="Linked" value={fmtTime(row["linked-at"])} muted />}
                    {row["updated-at"] != null && <FieldLine label="Updated" value={fmtTime(row["updated-at"])} muted />}
                    {/* Anything the contract adds later that we don't label yet. */}
                    {extraFields(row).map(([k, v]) => <FieldLine key={k} label={k} value={v} muted />)}
                  </div>
                ) : (
                  <span style={{ fontSize: 11, fontStyle: "italic", color: "#555" }}>
                    — no dual-link row returned for this composite (URC_0033 → null)
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Rename lane / Revoke op modals — opened per dual-key card. Owner accounts
          come from each half's API-key row (`owner-account` = UR_OwnerAccount). */}
      {opModal && (() => {
        const halves = splitDualKey(opModal.key);
        if (!halves) return null;
        const stdOwner = apiKeyMap?.get(halves.standard)?.["owner-account"] ?? "";
        const smtOwner = apiKeyMap?.get(halves.smart)?.["owner-account"] ?? "";
        const close = () => setOpModal(null);
        if (opModal.op === "rename") {
          const currentLane = rows?.get(opModal.key)?.["consumer-lane"];
          return (
            <RenameDualLaneModal
              open onClose={close}
              dualLinkKey={opModal.key}
              currentLane={typeof currentLane === "string" ? currentLane : undefined}
              standardOwner={stdOwner} smartOwner={smtOwner} accounts={accounts}
            />
          );
        }
        return (
          <RevokeDualLinkModal
            open onClose={close}
            dualLinkKey={opModal.key}
            standardOwner={stdOwner} smartOwner={smtOwner} accounts={accounts}
          />
        );
      })()}
    </div>
  );
}

function HalfRow({ accent, tag, address, name }: { accent: string; tag: string; address: string; name?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
      <span style={pillStyle(accent + "18", accent)}>{tag}</span>
      {name && <span style={{ fontSize: 12, fontWeight: 600, color: "#d2d3d4", flexShrink: 0 }}>{name}</span>}
      <div style={{ display: "flex", alignItems: "center", minWidth: 0, flex: 1 }}>
        <OuronetAddressHighlight address={address} />
      </div>
      <IconCopyBtn text={address} size={24} />
    </div>
  );
}

function FieldLine({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
      <span style={{ ...sectionLabel, color: muted ? "#555" : "#888", flexShrink: 0 }}>{label}</span>
      <code style={{ fontFamily: MONO, fontSize: 12, color: muted ? "#666" : "#c8c9ca", wordBreak: "break-all" }}>{value}</code>
    </div>
  );
}

const rowActionBtn = (accent: string, disabled = false): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 8,
  fontSize: 12, fontWeight: 600,
  border: `1px solid ${disabled ? "#262626" : accent + "55"}`,
  background: disabled ? "#141414" : accent + "12",
  color: disabled ? "#555" : accent,
  cursor: disabled ? "default" : "pointer",
});

export default DualApiPanel;
