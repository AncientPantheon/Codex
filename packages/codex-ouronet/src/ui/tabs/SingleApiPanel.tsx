/**
 * SingleApiPanel — the "Single API" sub-tab of the Ouronet accounts view.
 *
 * Two columns of the codex's own Apollo halves — Standard (₱., left) and Smart
 * (Π., right) — each with its own search + pagination. Each half shows its
 * on-chain API-key status (not deployed / UNLINKED / LINKED) from the shared
 * `DPL-UR.URC_0031` batch read (`ApiKeyRow.counterpart === "BAR"` ⇒ unlinked).
 *
 * The user picks ONE unlinked Standard + ONE unlinked Smart (click a selected
 * half again to deselect); a selection bar then surfaces the pending composite
 * pair with Verify-ownership + Link actions. Mirrors Pythia's Connectors panel.
 *
 * ITERATION 1: selection + display only — the Verify-ownership and Link buttons
 * are stubbed (the actual off-chain ownership proof + Cronoton link tx are wired
 * in a later pass). No chain writes happen here.
 */

import { useState, useMemo } from "react";
import { KeyRound, Link2, Search } from "lucide-react";
import type { IOuroAccount } from "../../types/entities.js";
import {
  type ApiKeyRow,
  isApiKeyRegistered,
  isApiKeyLinked,
  buildDualKey,
} from "../../zbom/pythia/deployApiKey.js";
import { OuronetAddressHighlight } from "../internal/OuronetAddressHighlight.js";
import { IconCopyBtn } from "../internal/IconButtons.js";
import { MONO, pillStyle } from "../internal/accountFields.js";
import LinkDualApiKeyModal from "../../zbom/modals/LinkDualApiKeyModal.js";

const STD_ACCENT = "#ceac5f";
const SMT_ACCENT = "#a78bfa";
const PER_PAGE = 6;

type HalfStatus = "loading" | "not-deployed" | "unlinked" | "linked";

function halfStatus(row: ApiKeyRow | null | undefined, loaded: boolean): HalfStatus {
  if (!loaded) return "loading";
  if (!isApiKeyRegistered(row)) return "not-deployed";
  return isApiKeyLinked(row) ? "linked" : "unlinked";
}

function StatusPill({ status }: { status: HalfStatus }) {
  switch (status) {
    case "unlinked":
      return <span style={pillStyle("#16a34a20", "#4ade80", "#16a34a55")}>UNLINKED</span>;
    case "linked":
      return <span style={pillStyle("#3f3f46", "#a1a1aa")}>LINKED</span>;
    case "not-deployed":
      return <span style={pillStyle("#8b1a1a20", "#c0392b")}>not deployed</span>;
    default:
      return <span style={pillStyle("#26262699", "#666")}>…</span>;
  }
}

interface HalfColumnProps {
  title: string;
  side: "Pythia side" | "consumer side";
  accent: string;
  accounts: IOuroAccount[];
  apiKeyMap: Map<string, ApiKeyRow> | null;
  selected: string | null;
  onToggle: (address: string) => void;
  searchPlaceholder: string;
}

function HalfColumn({
  title, side, accent, accounts, apiKeyMap, selected, onToggle, searchPlaceholder,
}: HalfColumnProps) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const loaded = apiKeyMap !== null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (a) => (a.name ?? "").toLowerCase().includes(q) || a.address.toLowerCase().includes(q),
    );
  }, [accounts, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const clampedPage = Math.min(page, totalPages - 1);
  const pageItems = filtered.slice(clampedPage * PER_PAGE, (clampedPage + 1) * PER_PAGE);

  return (
    <div style={{ flex: 1, minWidth: 0, borderRadius: 14, border: `1px solid ${accent}30`, background: "#0d1117", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: accent }}>{title}</span>
        <span style={{ fontSize: 11, color: "#666" }}>· {side}</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, fontFamily: MONO, color: "#555" }}>{filtered.length}</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#080808", border: "1px solid #262626", borderRadius: 8, padding: "6px 8px" }}>
        <Search style={{ width: 13, height: 13, color: "#555", flexShrink: 0 }} />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(0); }}
          placeholder={searchPlaceholder}
          style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: "#d2d3d4", fontSize: 12, fontFamily: MONO }}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {pageItems.length === 0 ? (
          <div style={{ textAlign: "center", padding: "20px 0", color: "#555", fontSize: 12, fontStyle: "italic" }}>
            {loaded ? "no matching halves" : "reading chain…"}
          </div>
        ) : (
          pageItems.map((a) => {
            const status = halfStatus(apiKeyMap?.get(a.address), loaded);
            const selectable = status === "unlinked";
            const isSel = selected === a.address;
            return (
              <button
                key={a.id || a.address}
                type="button"
                disabled={!selectable}
                onClick={() => selectable && onToggle(a.address)}
                title={selectable ? "Pick this half to link" : status === "linked" ? "Already linked into a dual key" : status === "not-deployed" ? "Deploy this Apollo as an API key before linking" : ""}
                style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
                  padding: "8px 10px", borderRadius: 9,
                  border: `1px solid ${isSel ? accent : "#1f1f23"}`,
                  background: isSel ? accent + "18" : "#0a0a0a",
                  cursor: selectable ? "pointer" : "default",
                  opacity: selectable || isSel ? 1 : 0.6,
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
                  {a.name && <span style={{ fontSize: 12, fontWeight: 600, color: "#d2d3d4", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>}
                  <div style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
                    <OuronetAddressHighlight address={a.address} />
                  </div>
                </div>
                <StatusPill status={status} />
              </button>
            );
          })
        )}
      </div>

      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <button onClick={() => setPage(Math.max(0, clampedPage - 1))} disabled={clampedPage === 0}
            style={pagerBtn(clampedPage === 0)}>←</button>
          <span style={{ fontSize: 11, fontFamily: MONO, color: "#888" }}>{clampedPage + 1} / {totalPages}</span>
          <button onClick={() => setPage(Math.min(totalPages - 1, clampedPage + 1))} disabled={clampedPage >= totalPages - 1}
            style={pagerBtn(clampedPage >= totalPages - 1)}>→</button>
        </div>
      )}
    </div>
  );
}

const pagerBtn = (disabled: boolean): React.CSSProperties => ({
  padding: "3px 9px", borderRadius: 7, fontSize: 12, border: "1px solid #262626",
  background: "transparent", color: disabled ? "#3a3a3a" : "#888", cursor: disabled ? "default" : "pointer",
});

export interface SingleApiPanelProps {
  standardApollo: IOuroAccount[];
  smartApollo: IOuroAccount[];
  apiKeyMap: Map<string, ApiKeyRow> | null;
  /** All codex accounts — passed through to the Link modal for owner labels. */
  accounts: IOuroAccount[];
}

export function SingleApiPanel({ standardApollo, smartApollo, apiKeyMap, accounts }: SingleApiPanelProps) {
  const [selStd, setSelStd] = useState<string | null>(null);
  const [selSmt, setSelSmt] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);

  const toggle = (cur: string | null, addr: string): string | null => (cur === addr ? null : addr);
  const pairReady = selStd !== null && selSmt !== null;
  const composite = pairReady ? buildDualKey(selStd!, selSmt!) : "";

  // The picked half accounts + their on-chain owner accounts (for the Link tx).
  const stdAcct = selStd ? standardApollo.find((a) => a.address === selStd) ?? null : null;
  const smtAcct = selSmt ? smartApollo.find((a) => a.address === selSmt) ?? null : null;
  const stdOwner = selStd ? (apiKeyMap?.get(selStd)?.["owner-account"] ?? "") : "";
  const smtOwner = selSmt ? (apiKeyMap?.get(selSmt)?.["owner-account"] ?? "") : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 13, color: "#8a8a8a", lineHeight: 1.5 }}>
        Consumer API keys are a <strong style={{ color: "#ceac5f" }}>Standard (₱.)</strong> half linked to a{" "}
        <strong style={{ color: "#a78bfa" }}>Smart (Π.)</strong> half. Pick one{" "}
        <strong style={{ color: "#4ade80" }}>UNLINKED</strong> half from each side (click a selected half again to
        deselect), then <strong style={{ color: "#a78bfa" }}>Link</strong> them. Read live off StoaChain.
      </div>

      {/* Selection / action bar */}
      <div style={{ borderRadius: 12, border: `1px solid ${pairReady ? "#ceac5f55" : "#262626"}`, background: "#0d1117", padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <KeyRound style={{ width: 16, height: 16, color: pairReady ? "#ceac5f" : "#555", flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 200, fontSize: 12, fontFamily: MONO, color: pairReady ? "#d2d3d4" : "#666", wordBreak: "break-all" }}>
          {pairReady
            ? composite
            : `Select ${selStd ? "" : "a Standard ₱. half"}${!selStd && !selSmt ? " and " : ""}${selSmt ? "" : "a Smart Π. half"}…`}
        </div>
        {pairReady && <IconCopyBtn text={composite} size={26} />}
        <button type="button" disabled={!pairReady}
          onClick={() => { if (pairReady) setLinkOpen(true); }}
          title={pairReady ? "Link the pair into a dual API key" : "Pick both halves first"}
          style={actionBtn(pairReady, "#a78bfa")}>
          <Link2 style={{ width: 14, height: 14 }} /> Link
        </button>
      </div>

      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
        <HalfColumn
          title="Standard ₱." side="Pythia side" accent={STD_ACCENT}
          accounts={standardApollo} apiKeyMap={apiKeyMap}
          selected={selStd} onToggle={(a) => setSelStd((c) => toggle(c, a))}
          searchPlaceholder="search Standard halves…"
        />
        <HalfColumn
          title="Smart Π." side="consumer side" accent={SMT_ACCENT}
          accounts={smartApollo} apiKeyMap={apiKeyMap}
          selected={selSmt} onToggle={(a) => setSelSmt((c) => toggle(c, a))}
          searchPlaceholder="search Smart halves…"
        />
      </div>

      {linkOpen && stdAcct && smtAcct && (
        <LinkDualApiKeyModal
          open
          onClose={() => setLinkOpen(false)}
          standardAccount={stdAcct}
          smartAccount={smtAcct}
          standardOwner={stdOwner}
          smartOwner={smtOwner}
          accounts={accounts}
        />
      )}
    </div>
  );
}

const actionBtn = (enabled: boolean, accent: string): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10,
  fontSize: 13, fontWeight: 600, border: `1px solid ${enabled ? accent + "88" : "#262626"}`,
  background: enabled ? accent + "18" : "#111", color: enabled ? accent : "#555",
  cursor: enabled ? "pointer" : "default",
});

export default SingleApiPanel;
