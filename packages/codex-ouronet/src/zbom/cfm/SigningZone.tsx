/**
 * SigningZone — Zone 3 prototype for CFM gallery.
 *
 * Lifted 1:1 from CFMPrototype Zone 4 logic, adapted to:
 *   - standalone component (no modal wrapper)
 *   - props-driven: patronAccount + accountAccount
 *   - same colors as CFMPrototype (green #22c55e scheme)
 *
 * Tabs:
 *   A. Signing (Pure)  — live guard key analysis via analyzeGuard + buildCodexPubSet
 *   B. CAPS           — auto-generated: GAS_PAYER always, coin.TRANSFER when kadenaNeed > 0
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { CheckCircle2, AlertTriangle, Loader2, ChevronRight, ChevronDown } from "lucide-react";
import { useWallet, useUiSetting } from "./seam.js";
import { ManualKeyInput } from "../ui/ManualKeyInput.js";
import {
  analyzeGuard,
  buildCodexPubSet,
  selectCapsSigningKey,
} from "@stoachain/stoa-core/guard";
import type { IOuroAccount } from "../../types/entities.js";

// ── constants ─────────────────────────────────────────────────────────────────

const BG     = "#22c55e0d";
const BD     = "#22c55e40";
const LABEL  = "#4ade80";

type SigningTab = "signing" | "caps";

// ── sub-components ────────────────────────────────────────────────────────────

function SignerRow({ label, pred, found, total, threshold, ready, keys }: {
  label: string; pred: string; found: number; total: number;
  threshold: number; ready: boolean; keys: string[];
}) {
  return (
    <div style={{ borderRadius: "8px", border: `1px solid ${ready ? "#22c55e30" : "#8b1a1a30"}`, backgroundColor: "#0a0a0a", padding: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        {ready
          ? <CheckCircle2 style={{ width: 14, height: 14, flexShrink: 0, color: LABEL }} />
          : <AlertTriangle style={{ width: 14, height: 14, flexShrink: 0, color: "#c0392b" }} />}
        <span style={{ flex: 1, fontSize: "12px", color: "#d2d3d4" }}>{label}</span>
        <span style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "999px", backgroundColor: "#262626", color: "#ceac5f" }}>{pred}</span>
        <span style={{ fontSize: "10px", fontFamily: "monospace", color: ready ? LABEL : "#c0392b" }}>
          {found}/{threshold} needed ({total} total)
        </span>
      </div>
      {keys.map((k, i) => (
        <code key={i} style={{ display: "block", fontSize: "10px", fontFamily: "monospace", color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingLeft: "20px" }}>
          {k.slice(0, 16)}…{k.slice(-8)}
        </code>
      ))}
    </div>
  );
}

function CapRow({ capability, params, signer, signerKey, description }: {
  capability: string; params: string[]; signer: string; signerKey: string; description: string;
}) {
  return (
    <div style={{ borderRadius: "8px", border: "1px solid #22c55e25", backgroundColor: "#0a0a0a", padding: "10px", display: "flex", flexDirection: "column", gap: "6px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
        <code style={{ fontSize: "10px", fontFamily: "monospace", fontWeight: "bold", color: LABEL, wordBreak: "break-all" }}>{capability}</code>
        <span style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "999px", backgroundColor: "#262626", color: "#888", flexShrink: 0, whiteSpace: "nowrap" }}>{signer}</span>
      </div>
      {params.length > 0 && (
        <div style={{ paddingLeft: "8px", borderLeft: "1px solid #22c55e30" }}>
          <span style={{ fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: "bold", color: "#555", marginRight: "4px" }}>params:</span>
          <code style={{ fontSize: "10px", fontFamily: "monospace", color: "#888" }}>({params.join(", ")})</code>
        </div>
      )}
      <div style={{ paddingLeft: "8px", borderLeft: "1px solid #22c55e30" }}>
        <span style={{ fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: "bold", color: "#555", marginRight: "4px" }}>signed by:</span>
        <code style={{ fontSize: "10px", fontFamily: "monospace", color: "#555" }}>
          {signerKey && signerKey.length > 20 ? `${signerKey.slice(0, 16)}…${signerKey.slice(-8)}` : signerKey}
        </code>
      </div>
      <p style={{ fontSize: "10px", color: "#555", margin: 0 }}>{description}</p>
    </div>
  );
}

// ── SigningZone ───────────────────────────────────────────────────────────────

export interface SigningZoneProps {
  patronAccount:  IOuroAccount | null;
  accountAccount: IOuroAccount | null;
  /**
   * Additional guards beyond patron + account (e.g. New Guard in RotateGuard).
   * Each entry is analyzed via analyzeGuard and shown as a SignerRow.
   */
  additionalGuards?: Array<{
    label: string;
    guard: { keys: string[]; pred: string } | null | undefined;
  }>;
  /** Optional extra caps injected per-button (e.g. coin.TRANSFER to liquidPOT) */
  extraCaps?: Array<{ capability: string; params: string[]; signer: string; signerKey: string; description: string; }>;
  /** From infoData.kadena — used to generate coin.TRANSFER CAPS */
  kadenaNeed?: number;
  kadenaReceivers?: string[];
  kadenaAmounts?: string[];
}

export function SigningZone({
  patronAccount,
  accountAccount,
  additionalGuards = [],
  extraCaps = [],
  kadenaNeed = 0,
  kadenaReceivers = [],
  kadenaAmounts = [],
}: SigningZoneProps) {
  const { kadena: kadenaSeeds, kadenaAccounts } = useWallet();
  const [signingTab, setSigningTab]             = useState<SigningTab>("signing");
  const [resolvedManualKeys, setResolvedManualKeys] = useState<Record<string, string>>({});

  const handleResolveKey = useCallback((pub: string, priv: string) => {
    setResolvedManualKeys(prev => ({ ...prev, [pub]: priv }));
  }, []);

  // ── A1: Codex pub set ──
  const codexPubs = useMemo(
    () => buildCodexPubSet(kadenaSeeds, kadenaAccounts),
    [kadenaSeeds, kadenaAccounts],
  );

  // ── A2: Guard analysis ──
  const patronAnalysis = useMemo(
    () => analyzeGuard(patronAccount?.guard, codexPubs, resolvedManualKeys),
    [patronAccount?.guard, codexPubs, resolvedManualKeys],
  );
  const accountAnalysis = useMemo(
    () => analyzeGuard(accountAccount?.guard, codexPubs, resolvedManualKeys),
    [accountAccount?.guard, codexPubs, resolvedManualKeys],
  );

   
  const additionalAnalyses = useMemo(
    () => additionalGuards.map(({ label, guard }) => ({
      label,
      analysis: analyzeGuard(guard ?? undefined, codexPubs, resolvedManualKeys),
    })),
    // stringify guard to avoid infinite loop on object identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(additionalGuards), codexPubs, resolvedManualKeys],
  );

  const isSameAccount = patronAccount?.address === accountAccount?.address;

  // ── A3: Pure signing pubs (patron + account + additional) ──
  const pureSigningPubs = useMemo(() => {
    const set = new Set<string>();
    [...patronAnalysis.codexKeys, ...patronAnalysis.resolvedForeignKeys].forEach(k => set.add(k));
    if (!isSameAccount) [...accountAnalysis.codexKeys, ...accountAnalysis.resolvedForeignKeys].forEach(k => set.add(k));
    additionalAnalyses.forEach(({ analysis }) => {
      [...analysis.codexKeys, ...analysis.resolvedForeignKeys].forEach(k => set.add(k));
    });
    return set;
  }, [patronAnalysis, accountAnalysis, isSameAccount, additionalAnalyses]);

  // ── A4: Gas station key ──
  const capsKey = useMemo(
    () => selectCapsSigningKey(null, codexPubs, pureSigningPubs),
    [codexPubs, pureSigningPubs],
  );
  const gasStationPub = capsKey.key;

  // ── A5: Signers list ──
  const autoSigners = useMemo(() => {
    const list = [];
    if (patronAnalysis.keys.length > 0) {
      list.push({
        label: "Patron Guard", pred: patronAnalysis.predLabel,
        found: patronAnalysis.signable, total: patronAnalysis.keys.length,
        threshold: patronAnalysis.threshold, ready: patronAnalysis.satisfied,
        keys: patronAnalysis.keys,
      });
    }
    if (!isSameAccount && accountAnalysis.keys.length > 0) {
      list.push({
        label: "Account Guard", pred: accountAnalysis.predLabel,
        found: accountAnalysis.signable, total: accountAnalysis.keys.length,
        threshold: accountAnalysis.threshold, ready: accountAnalysis.satisfied,
        keys: accountAnalysis.keys,
      });
    }
    additionalAnalyses.forEach(({ label, analysis }) => {
      if (analysis.keys.length > 0) {
        list.push({
          label, pred: analysis.predLabel,
          found: analysis.signable, total: analysis.keys.length,
          threshold: analysis.threshold, ready: analysis.satisfied,
          keys: analysis.keys,
        });
      }
    });
    return list;
  }, [patronAnalysis, accountAnalysis, isSameAccount, additionalAnalyses]);

  // ── B1: Auto CAPS ──
  const autoCaps = useMemo(() => {
    const caps = [];
    caps.push({
      capability: "ouronet-ns.DALOS.GAS_PAYER",
      params: [`""`, `{ int: 0 }`, `{ decimal: "0.0" }`],
      signer: "Ouronet GasStation",
      signerKey: gasStationPub || "auto-selected",
      description: "Covers StoaChain™ network gas fees — paid by Gas Station, not the user.",
    });
    if (kadenaNeed > 0 && kadenaReceivers.length > 0) {
      kadenaReceivers.forEach((receiver, i) => {
        caps.push({
          capability: "coin.TRANSFER",
          params: [`"<payment-key>"`, `"${receiver.slice(0, 10)}…"`, `{ decimal: "${kadenaAmounts[i] ?? kadenaNeed}" }`],
          signer: "Payment Key",
          signerKey: gasStationPub || "auto-selected",
          description: `Transfers STOA from payment account to protocol receiver ${i + 1}.`,
        });
      });
    }
    return [...caps, ...extraCaps];
  }, [gasStationPub, kadenaNeed, kadenaReceivers, kadenaAmounts, extraCaps]);

  const noAccounts = !patronAccount && !accountAccount;

  // Collapsible Zone 3 — reads zbomZone3 from settings
  const zone3DefaultOpen = useUiSetting("zbomZone3", false);
  const [zone3Open, setZone3Open] = useState(zone3DefaultOpen);
  useEffect(() => { setZone3Open(zone3DefaultOpen); }, [zone3DefaultOpen]);

  // Compute pure keys + caps count for collapsed label
  const pureKeysCount = pureSigningPubs.size;
  const capsCount = 1 + (kadenaNeed > 0 ? kadenaReceivers.length : 0) + extraCaps.length;

  return (
    <div style={{ borderRadius: "10px", border: `1px solid ${BD}`, backgroundColor: BG, overflow: "hidden" }}>

      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setZone3Open((v: boolean) => !v)}
        className="w-full flex items-center gap-1.5 text-left"
        style={{ background: "transparent", border: "none", cursor: "pointer", padding: "7px 10px", borderBottom: zone3Open ? `1px solid ${BD}` : "none" }}
      >
        {zone3Open ? <ChevronDown style={{ width: 13, height: 13, color: "#555", flexShrink: 0 }} /> : <ChevronRight style={{ width: 13, height: 13, color: "#555", flexShrink: 0 }} />}
        <span style={{ fontSize: "10px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.08em", color: LABEL }}>
          Zone 3 — SIGNING
        </span>
        <span style={{ fontSize: "9px", fontFamily: "'Courier New','Lucida Console',monospace", color: `${LABEL}80` }}>
          ({pureKeysCount} Pure Key{pureKeysCount !== 1 ? "s" : ""} & {capsCount} Cap{capsCount !== 1 ? "s" : ""})
        </span>
      </button>

      {/* Content — hidden when collapsed */}
      {zone3Open && (
      <>
      {/* Old header + tab toggle */}
      <div style={{ padding: "8px 12px", borderBottom: `1px solid ${BD}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "9px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.1em", color: LABEL }}>Signing</span>
          <ChevronRight style={{ width: 12, height: 12, color: "#555" }} />
          <span style={{ fontSize: "10px", color: "#555" }}>Fully automatic — guard keys from Codex, CAPS from INFO data</span>
        </div>

        {/* Tab switcher */}
        <div style={{ display: "flex", borderRadius: "6px", overflow: "hidden", border: "1px solid #262626" }}>
          {(["signing", "caps"] as SigningTab[]).map((t) => (
            <button key={t} onClick={() => setSigningTab(t)}
              style={{
                padding: "3px 10px",
                fontSize: "9px",
                fontWeight: "bold",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                backgroundColor: signingTab === t ? "#22c55e20" : "#0a0a0a",
                color: signingTab === t ? LABEL : "#555",
                border: "none",
                borderRight: t === "signing" ? "1px solid #262626" : "none",
                cursor: "pointer",
              }}>
              {t === "signing" ? "Signing (Pure)" : "CAPS"}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: "8px" }}>

        {/* ── Tab A: Signing (Pure) ── */}
        {signingTab === "signing" && (
          <>
            <p style={{ fontSize: "10px", color: "#555", margin: 0 }}>
              Keys that must sign this transaction (pure guard ownership — no capabilities). Automatically detected from your Codex.
            </p>

            {noAccounts && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#555" }}>
                <Loader2 style={{ width: 13, height: 13, animation: "spin 1s linear infinite" }} />
                <span style={{ fontSize: "11px" }}>Waiting for account data…</span>
              </div>
            )}

            {autoSigners.map((s, i) => <SignerRow key={i} {...s} />)}

            {/* Gas Station conflict */}
            {gasStationPub === undefined && codexPubs.size > 0 && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", padding: "8px 10px", backgroundColor: "#8b1a1a10", border: "1px solid #8b1a1a40", borderRadius: "8px" }}>
                <AlertTriangle style={{ width: 14, height: 14, color: "#c0392b", flexShrink: 0, marginTop: "1px" }} />
                <div>
                  <p style={{ fontSize: "12px", fontWeight: "600", color: "#c0392b", margin: "0 0 2px 0" }}>No available key for Gas Station</p>
                  <p style={{ fontSize: "10px", color: "#888", margin: 0 }}>All Codex keys are used for guard signing. Add another key to your seed.</p>
                </div>
              </div>
            )}

            {/* Impossible overlap */}
            {capsKey.impossible && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", padding: "8px 10px", backgroundColor: "#8b1a1a10", border: "1px solid #8b1a1a40", borderRadius: "8px" }}>
                <AlertTriangle style={{ width: 14, height: 14, color: "#c0392b", flexShrink: 0, marginTop: "1px" }} />
                <div>
                  <p style={{ fontSize: "12px", fontWeight: "600", color: "#c0392b", margin: "0 0 2px 0" }}>Transaction impossible — guard overlap detected</p>
                  <p style={{ fontSize: "10px", color: "#888", margin: 0 }}>The payment key is also required for pure guard signing. Rotate the account guard or use the Ouronet console.</p>
                </div>
              </div>
            )}

            {/* Manual key input — patron */}
            {!patronAnalysis.satisfied && patronAnalysis.foreignKeys.length > 0 && (
              <ManualKeyInput
                label="Patron Guard"
                foreignKeys={patronAnalysis.foreignKeys}
                resolved={resolvedManualKeys}
                neededMore={patronAnalysis.neededMore}
                onResolve={handleResolveKey}
              />
            )}

            {/* Manual key input — account */}
            {!isSameAccount && !accountAnalysis.satisfied && accountAnalysis.foreignKeys.length > 0 && (
              <ManualKeyInput
                label="Account Guard"
                foreignKeys={accountAnalysis.foreignKeys}
                resolved={resolvedManualKeys}
                neededMore={accountAnalysis.neededMore}
                onResolve={handleResolveKey}
              />
            )}

            {/* Manual key input — additional guards */}
            {additionalAnalyses.map(({ label, analysis }) =>
              !analysis.satisfied && analysis.foreignKeys.length > 0 ? (
                <ManualKeyInput
                  key={label}
                  label={label}
                  foreignKeys={analysis.foreignKeys}
                  resolved={resolvedManualKeys}
                  neededMore={analysis.neededMore}
                  onResolve={handleResolveKey}
                />
              ) : null
            )}
          </>
        )}

        {/* ── Tab B: CAPS ── */}
        {signingTab === "caps" && (
          <>
            <p style={{ fontSize: "10px", color: "#555", margin: 0 }}>
              Capabilities automatically attached by the UI from INFO data. GAS_PAYER always present. coin.TRANSFER(s) when kadenaNeed &gt; 0.
            </p>
            {autoCaps.map((cap, i) => <CapRow key={i} {...cap} />)}
          </>
        )}
      </div>
      </>
      )}
    </div>
  );
}
