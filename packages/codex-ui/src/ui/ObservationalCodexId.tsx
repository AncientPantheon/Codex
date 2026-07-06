/**
 * Observational CodexID — a *preview* Codex Identity built from two chosen
 * APOLLO accounts (one Standard ₱., one Smart Π.) combined into the canonical
 * CodexID form `{₱.std}:{Π.smart}`.
 *
 * Split into two surfaces sharing one config stored in `uiSettings`
 * (`observationalCodexId`, via the UiSettings `[extra]` escape hatch — no type
 * change needed):
 *   - <ObservationalCodexIdSettings>  the toggle + the two pickers (lives in
 *     Codex UI Settings). Persists the choice + enabled flag.
 *   - <ObservationalCodexIdDisplay>   reads the config + accounts and, when
 *     enabled + fully picked, renders the constructed identity (lives above the
 *     CodexID status badge on the CodexUI page).
 *
 * OBSERVATIONAL only — never derives, persists, or registers a real identity.
 * Drop-in: state via the provider hooks, styled inline (no Tailwind).
 */

import * as React from "react";
import { useState } from "react";
import { Fingerprint, ChevronDown, ChevronRight, Eye } from "lucide-react";
import { useCodex } from "../hooks/useCodex.js";
import { useOuroAccounts } from "../hooks/useOuroAccounts.js";
import { useCodexIdentity } from "../hooks/useCodexIdentity.js";
import { usePureKeypairs } from "../hooks/usePureKeypairs.js";
import { useStoaChainSeeds } from "../hooks/useStoaChainSeeds.js";
import { useCodexStore } from "../provider/index.js";
import { detectOriginCurve } from "./internal/originCurve.js";
import { IconCopyBtn } from "./internal/IconButtons.js";
import { PublicKeyFieldBox, GuardFieldBox } from "./internal/accountFields.js";
import { GuardTree } from "./internal/GuardTree.js";
import { identifyKeySource } from "./internal/keySource.js";
import { CodexIdField, CopyValueTag } from "./CodexIdField.js";
import { CodexLockControl } from "./CodexLockControl.js";
import type { IOuroAccount } from "@ancientpantheon/codex-ouronet/types";

/** Small "Reveal Seed" button shown at a public key's upper-right. */
function RevealSeedBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 6, background: "transparent", border: "1px solid #262626", color: "#888", cursor: "pointer" }}
    >
      <Eye style={{ width: 12, height: 12 }} /> Reveal Seed
    </button>
  );
}

const STD_ACCENT = "#f97316"; // APOLLO Standard ₱.
const SMT_ACCENT = "#a01b3f"; // APOLLO Smart Π.
const GUARD_ACCENT = "#a78bfa"; // Pure-Key guard (matches the Pure Key Pairs tab)

export interface ObservationalCodexIdConfig {
  enabled: boolean;
  standardId: string;
  smartId: string;
  /** Pure-keypair id chosen as the CodexID guard (a Pure Key, per convention —
   *  never a seed-derived key). Optional: the CodexID still previews without it. */
  guardKeypairId: string;
}

const DEFAULT_CONFIG: ObservationalCodexIdConfig = {
  enabled: false,
  standardId: "",
  smartId: "",
  guardKeypairId: "",
};

export function readObservationalCodexIdConfig(uiSettings: Record<string, unknown>): ObservationalCodexIdConfig {
  const raw = uiSettings.observationalCodexId as Partial<ObservationalCodexIdConfig> | undefined;
  return { ...DEFAULT_CONFIG, ...(raw ?? {}) };
}

/**
 * The names a CodexID's prime entities take in LIVE mode. In observational mode
 * the entity keeps its real name; lists show `${designated} (${original})`.
 */
export const CODEXID_PRIME_NAMES = {
  standard: "StandardCodexID",
  smart: "SmartCodexID",
  guard: "GuardOfCodexID",
} as const;

/** Display name for a prime CodexID entity: designated name + original in parens. */
export function codexIdPrimeName(designated: string, original: string | undefined): string {
  const orig = (original ?? "").trim();
  return orig ? `${designated} (${orig})` : designated;
}

function useApolloAccounts() {
  const { accounts } = useOuroAccounts();
  const apollo = accounts.filter((a) => detectOriginCurve(a) === "apollo");
  return {
    standardApollo: apollo.filter((a) => !a.isSmart),
    smartApollo: apollo.filter((a) => a.isSmart),
  };
}

const accLabel = (a: IOuroAccount, i: number) =>
  `${a.name || `Apollo #${i + 1}`} — ${a.address.slice(0, 10)}…`;

/* ───────────────────────── Settings surface ───────────────────────── */

export interface ObservationalCodexIdSettingsProps {
  className?: string;
}

const selectStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", height: 38, padding: "0 10px", borderRadius: 8,
  backgroundColor: "#111", border: "1px solid #262626", color: "#d2d3d4", fontSize: 13,
};
const labelStyle = (color: string): React.CSSProperties => ({
  display: "block", fontSize: 11, fontWeight: 600, textTransform: "uppercase",
  letterSpacing: "0.05em", color, marginBottom: 6,
});

const kpLabel = (kp: { label?: string; publicKey: string }, i: number) =>
  `${kp.label || `Pure Key #${i + 1}`} — ${kp.publicKey.slice(0, 10)}…`;

export function ObservationalCodexIdSettings({ className }: ObservationalCodexIdSettingsProps) {
  const { uiSettings } = useCodex();
  const store = useCodexStore();
  const cfg = readObservationalCodexIdConfig(uiSettings);
  const { standardApollo, smartApollo } = useApolloAccounts();
  const { keypairs } = usePureKeypairs();

  const write = (patch: Partial<ObservationalCodexIdConfig>) => {
    void store.getState().actions.updateUiSettings({
      observationalCodexId: { ...cfg, ...patch },
    });
  };

  return (
    <div
      className={className}
      style={{ display: "flex", flexDirection: "column", gap: 12, fontFamily: "var(--codex-font, inherit)", color: "#d2d3d4" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Fingerprint style={{ width: 16, height: 16, color: "#22c55e" }} />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>Preview Observational CodexID</span>
        {/* Toggle */}
        <button
          type="button"
          role="switch"
          aria-checked={cfg.enabled}
          onClick={() => write({ enabled: !cfg.enabled })}
          style={{
            width: 44, height: 24, borderRadius: 9999, position: "relative", cursor: "pointer",
            border: "none", padding: 0,
            backgroundColor: cfg.enabled ? "#22c55e" : "#333",
            transition: "background-color 0.15s",
          }}
        >
          <span style={{
            position: "absolute", top: 2, left: cfg.enabled ? 22 : 2, width: 20, height: 20,
            borderRadius: "50%", backgroundColor: "#fff", transition: "left 0.15s",
          }} />
        </button>
      </div>
      <p style={{ margin: 0, fontSize: 11, color: "#888", lineHeight: 1.5 }}>
        When enabled, combine one Standard (₱.) + one Smart (Π.) APOLLO account into the CodexID
        display form and show it on the CodexUI page (above the identity status). Observational
        only — does <strong>not</strong> derive or register a real identity.
      </p>

      {cfg.enabled && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={labelStyle(STD_ACCENT)}>Standard half (₱.)</label>
            <select style={selectStyle} value={cfg.standardId} onChange={(e) => write({ standardId: e.target.value })}>
              <option value="">{standardApollo.length ? "Select…" : "No Standard APOLLO accounts"}</option>
              {standardApollo.map((a, i) => <option key={a.id} value={a.id}>{accLabel(a, i)}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={labelStyle(SMT_ACCENT)}>Smart half (Π.)</label>
            <select style={selectStyle} value={cfg.smartId} onChange={(e) => write({ smartId: e.target.value })}>
              <option value="">{smartApollo.length ? "Select…" : "No Smart APOLLO accounts"}</option>
              {smartApollo.map((a, i) => <option key={a.id} value={a.id}>{accLabel(a, i)}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={labelStyle(GUARD_ACCENT)}>Guard (Pure Key)</label>
            <select style={selectStyle} value={cfg.guardKeypairId} onChange={(e) => write({ guardKeypairId: e.target.value })}>
              <option value="">{keypairs.length ? "Select… (optional)" : "No Pure Keys"}</option>
              {keypairs.map((kp, i) => <option key={kp.id} value={kp.id}>{kpLabel(kp, i)}</option>)}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Display surface ───────────────────────── */

/**
 * Args handed to the injected seed-reveal slot. The chain-generic shell decides
 * WHEN the per-half reveal is open and for WHICH account/name; the concrete
 * seed-decrypting modal (which carries the `@stoachain` crypto edge) is supplied
 * by the Ouronet host so codex-ui never statically imports it.
 */
export interface ObservationalViewSeedModalArgs {
  isOpen: boolean;
  onClose: () => void;
  account?: IOuroAccount;
  name: string;
}

export interface ObservationalCodexIdDisplayProps {
  className?: string;
  /**
   * Consumer seam to launch the "establish a real Codex Identity" flow (the
   * Mnemosyne Stage-1 registration). When provided, the empty-state
   * "Define Codex Identity" button is enabled and calls this; when omitted, the
   * button renders disabled with a "coming with Mnemosyne" hint. Wiring this in
   * is what will let a fresh codex establish its on-chain CodexIdentity.
   */
  onDefineIdentity?: () => void;
  /**
   * Injected seed-reveal modal slot. The Ouronet host supplies its concrete
   * `ViewSeedModal` (which value-imports `@stoachain/stoa-core/crypto`), keeping
   * that runtime edge out of the generic shell. When omitted, the per-half
   * "Reveal Seed" affordance simply mounts nothing.
   */
  renderViewSeedModal?: (args: ObservationalViewSeedModalArgs) => React.ReactNode;
}

/**
 * The CodexID surface on the CodexUI page — built from the SAME field
 * constructors an Ouronet Account row uses (AddressFieldBox / PublicKeyFieldBox
 * / GuardFieldBox). Shows the populated identity (observational preview, or the
 * real registered identity if ever present) as two account-style address fields
 * + a "details" dropdown revealing each half's public key + a Guard field with
 * a (placeholder) Rotate Guard button; otherwise "CODEXID not yet established".
 */
export function ObservationalCodexIdDisplay({ className, onDefineIdentity, renderViewSeedModal }: ObservationalCodexIdDisplayProps) {
  const { uiSettings } = useCodex();
  const { accounts } = useOuroAccounts();
  const { keypairs } = usePureKeypairs();
  const { seeds } = useStoaChainSeeds();
  const { identity } = useCodexIdentity();
  const cfg = readObservationalCodexIdConfig(uiSettings);
  const [expanded, setExpanded] = useState(false);
  const [revealHalf, setRevealHalf] = useState<"std" | "smt" | null>(null);

  const std = cfg.enabled ? accounts.find((a) => a.id === cfg.standardId) : undefined;
  const smt = cfg.enabled ? accounts.find((a) => a.id === cfg.smartId) : undefined;
  const observational = std && smt ? { std, smt } : null;
  // The chosen Pure-Key guard (optional).
  const guardKp = cfg.enabled && cfg.guardKeypairId
    ? keypairs.find((k) => k.id === cfg.guardKeypairId)
    : undefined;

  // The CodexID guard, as a real guard object rendered through the SAME GuardTree
  // engine the Ouronet Accounts use:
  //   • observational ⇒ a `keys-all` keyset over the chosen Pure Key (a key is
  //     not a guard — a guard is a keyset).
  //   • live (real identity) ⇒ the on-chain CodexID guard, when present.
  const codexIdGuard: unknown = guardKp
    ? { pred: "keys-all", keys: [guardKp.publicKey] }
    : (identity as { guard?: unknown } | null)?.guard ?? null;

  // Real registered identity (rare for now) — formatted is "₱.std:Π.smart".
  const realFormatted = (identity as { formatted?: string } | null)?.formatted ?? null;
  const realHalves = realFormatted && realFormatted.includes(":")
    ? { stdAddr: realFormatted.split(":")[0], smtAddr: realFormatted.split(":")[1] }
    : null;

  const wrapStyle: React.CSSProperties = {
    backgroundColor: "#0a0a0a", border: "1px solid #262626", borderRadius: 12,
    padding: 12, fontFamily: "var(--codex-font, inherit)",
    display: "flex", flexDirection: "column", gap: 8,
  };

  // ── Empty state ──
  if (!observational && !realHalves) {
    return (
      <div className={className} style={{ ...wrapStyle, flexDirection: "row", alignItems: "center", gap: 8 }} title="Codex Identity">
        <Fingerprint style={{ width: 16, height: 16, flexShrink: 0, color: "#22c55e" }} />
        <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "#888" }}>CodexID</span>
        <span style={{ fontSize: 12, fontStyle: "italic", color: "#555" }}>not yet established</span>
        <button
          type="button"
          disabled={!onDefineIdentity}
          onClick={() => onDefineIdentity?.()}
          title={onDefineIdentity ? "Define your Codex Identity" : "Define your Codex Identity — coming with Mnemosyne"}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, marginLeft: 4, padding: "5px 12px",
            borderRadius: 8, fontSize: 12, fontWeight: 600, fontFamily: "var(--codex-font, inherit)",
            border: "1px solid #22c55e55", backgroundColor: "#22c55e1a", color: "#22c55e",
            cursor: onDefineIdentity ? "pointer" : "not-allowed", opacity: onDefineIdentity ? 1 : 0.55,
          }}
        >
          <Fingerprint style={{ width: 13, height: 13 }} /> Define Codex Identity
        </button>
        <div style={{ flex: 1 }} />
        <CodexLockControl />
      </div>
    );
  }

  const stdAddr = observational ? observational.std.address : realHalves!.stdAddr;
  const smtAddr = observational ? observational.smt.address : realHalves!.smtAddr;
  const whole = `${stdAddr}:${smtAddr}`;

  return (
    <div className={className} style={wrapStyle}>
      {/* Header: label + tag + details toggle + whole-ID copy */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Fingerprint style={{ width: 16, height: 16, flexShrink: 0, color: "#22c55e" }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: "#22c55e" }}>CodexID</span>
        <span style={{
          fontSize: 9, padding: "1px 6px", borderRadius: 9999, flexShrink: 0,
          ...(observational
            ? { backgroundColor: "#f9731615", color: "#f97316", border: "1px solid #f9731640" }
            : { backgroundColor: "#22c55e15", color: "#4ade80", border: "1px solid #22c55e40" }),
        }}>
          {observational ? "observational" : "registered"}
        </span>
        <div style={{ flex: 1 }} />
        {/* Per-half copy tags (color-coded to each half: Standard ₱. / Smart Π.) */}
        <CopyValueTag text={stdAddr} color={STD_ACCENT} />
        <CopyValueTag text={smtAddr} color={SMT_ACCENT} />
        <CodexLockControl />
        {observational && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? "Hide details" : "Show public keys + guard"}
            style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 10, padding: "2px 8px", borderRadius: 6, background: "transparent", border: "1px solid #262626", color: "#888", cursor: "pointer" }}
          >
            {expanded ? <ChevronDown style={{ width: 12, height: 12 }} /> : <ChevronRight style={{ width: 12, height: 12 }} />}
            details
          </button>
        )}
        <span title="Copy full CodexID">
          <IconCopyBtn text={whole} size={24} />
        </span>
      </div>

      {/* The epic single-rectangle, two-half CodexID display */}
      <CodexIdField standardAddress={stdAddr} smartAddress={smtAddr} standardColor={STD_ACCENT} smartColor={SMT_ACCENT} />

      {/* Details: each half's public key (account-style) with a Reveal Seed button,
          plus a Guard field with Rotate Guard (placeholder until the ZBOM port). */}
      {observational && expanded && (
        <>
          <PublicKeyFieldBox
            label="Standard Public Key"
            publicKey={observational.std.publicKey}
            headerAction={<RevealSeedBtn onClick={() => setRevealHalf("std")} />}
          />
          <PublicKeyFieldBox
            label="Smart Public Key"
            publicKey={observational.smt.publicKey}
            headerAction={<RevealSeedBtn onClick={() => setRevealHalf("smt")} />}
          />
          <GuardFieldBox onRotate={() => { /* placeholder — wired in the ZBOM port */ }}>
            {codexIdGuard ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                {guardKp && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: GUARD_ACCENT }}>
                    {codexIdPrimeName(CODEXID_PRIME_NAMES.guard, guardKp.label)}
                  </span>
                )}
                {/* Same guard-detection engine the Ouronet Accounts use. */}
                <GuardTree guard={codexIdGuard} identifyKeySource={(k) => identifyKeySource(k, seeds, keypairs)} />
              </div>
            ) : (
              <span style={{ fontSize: 11, fontStyle: "italic", color: "#555" }}>
                no guard selected — pick a Pure Key in Codex UI Settings → Identity &amp; Backup
              </span>
            )}
          </GuardFieldBox>
        </>
      )}

      {/* Per-half seed reveal (interim — the full tabbed DALOS Secret-Reveal is next).
          The concrete decrypting modal is injected by the Ouronet host so the
          generic shell carries no @stoachain crypto edge. */}
      {observational && renderViewSeedModal?.({
        isOpen: revealHalf !== null,
        onClose: () => setRevealHalf(null),
        account: revealHalf === "std" ? observational.std : revealHalf === "smt" ? observational.smt : undefined,
        name: revealHalf === "std" ? "Standard half" : "Smart half",
      })}
    </div>
  );
}

export default ObservationalCodexIdSettings;
