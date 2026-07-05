/**
 * Shared account-field constructors — the exact field building blocks the
 * Ouronet Account row is built from, extracted so the CodexID surface (and any
 * other) renders identical fields ("same constructors, no guessing").
 *
 * - AddressFieldBox : the dashed "OURONET ACCOUNT"-style address field
 *   (label + lock + OuronetAddressHighlight that fills width / `·····`-truncates
 *   when it doesn't fit + copy).
 * - PublicKeyFieldBox : the account "Public Key" section (immutable badge +
 *   break-all code + copy).
 * - GuardFieldBox : the account "Guard" section (label + Rotate-Guard button +
 *   content).
 * Plus the gradient action buttons + the section box/label/pill style tokens.
 */

import * as React from "react";
import { Lock, Shield } from "lucide-react";
import { OuronetAddressHighlight } from "./OuronetAddressHighlight.js";
import { IconCopyBtn } from "./IconButtons.js";

export const MONO = "var(--codex-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)";

export const sectionBox: React.CSSProperties = {
  marginTop: 8, padding: 8, borderRadius: 8, backgroundColor: "#0a0a0a", border: "1px solid #262626",
};
export const sectionLabel: React.CSSProperties = {
  fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0, color: "#888",
};
export const pillStyle = (bg: string, fg: string, border?: string): React.CSSProperties => ({
  fontSize: 10, padding: "2px 6px", borderRadius: 9999, fontWeight: 500, flexShrink: 0,
  backgroundColor: bg, color: fg, ...(border ? { border: `1px solid ${border}` } : {}),
});

/* ─── Gradient action buttons ─── */
export function GoldenBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 8,
        fontWeight: 700, fontSize: 11, flexShrink: 0, transition: "all 0.3s", cursor: "pointer",
        background: "linear-gradient(90deg, rgb(163,108,42) 0%, rgb(242,217,129) 50%, rgb(163,108,42) 100%)",
        color: "#000", border: "none",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "0 0 12px 1px rgba(242,217,129,0.6)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "none"; }}
    >
      {icon}{label}
    </button>
  );
}

export function VioletBtn({ icon, label, onClick, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 8,
        fontWeight: 700, fontSize: 11, flexShrink: 0, transition: "all 0.3s", cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        background: "linear-gradient(90deg, rgb(91,33,182) 0%, rgb(167,139,250) 50%, rgb(91,33,182) 100%)",
        color: "#0a0a0a", border: "none",
      }}
      onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLElement).style.boxShadow = "0 0 12px 1px rgba(167,139,250,0.6)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "none"; }}
    >
      {icon}{label}
    </button>
  );
}

export function GreenBtn({ icon, label, onClick, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 8,
        fontWeight: 700, fontSize: 11, flexShrink: 0, transition: "all 0.3s", cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        background: "linear-gradient(90deg, rgb(21,128,61) 0%, rgb(74,222,128) 50%, rgb(21,128,61) 100%)",
        color: "#0a0a0a", border: "none",
      }}
      onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLElement).style.boxShadow = "0 0 12px 1px rgba(74,222,128,0.6)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "none"; }}
    >
      {icon}{label}
    </button>
  );
}

/* ─── Field boxes ─── */

/** The dashed "OURONET ACCOUNT"-style address field. */
export function AddressFieldBox({ label, address, copyText }: { label: string; address: string; copyText?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, overflow: "hidden", backgroundColor: "#080808", border: "1px dashed #2a2a2a", borderRadius: 6, padding: "5px 6px 5px 8px" }}>
      <span style={{ ...sectionLabel, letterSpacing: "0.08em" }}>{label}</span>
      <Lock style={{ width: 12, height: 12, flexShrink: 0, color: "#444" }} />
      <OuronetAddressHighlight address={address} />
      <IconCopyBtn text={copyText ?? address} size={24} />
    </div>
  );
}

/** The account "Public Key" section (immutable badge + break-all code + copy).
 *  Optional `headerAction` renders at the section header's upper-right (e.g. a
 *  per-key "Reveal Seed" button). */
export function PublicKeyFieldBox({ label = "Public Key", publicKey, headerAction }: { label?: string; publicKey: string; headerAction?: React.ReactNode }) {
  return (
    <div style={sectionBox}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={sectionLabel}>{label}</span>
        <span style={pillStyle("#8b1a1a15", "#c0392b", "#8b1a1a40")} title="The public key is derived deterministically from the private key — it cannot be changed.">🔒 immutable</span>
        <div style={{ flex: 1 }} />
        {headerAction}
      </div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 4 }}>
        <code style={{ fontFamily: MONO, fontSize: 11, wordBreak: "break-all", flex: 1, color: "#c0c0c0" }}>{publicKey}</code>
        <IconCopyBtn text={publicKey} size={28} />
      </div>
    </div>
  );
}

/** The account "Guard" section (label + Rotate-Guard button + content). */
export function GuardFieldBox({
  label = "Guard", rotateLabel = "Rotate Guard", onRotate, children,
}: {
  label?: string; rotateLabel?: string; onRotate: () => void; children: React.ReactNode;
}) {
  return (
    <div style={sectionBox}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={sectionLabel}>{label}</span>
        <div style={{ flex: 1 }} />
        <GoldenBtn icon={<Shield style={{ width: 14, height: 14 }} />} label={rotateLabel} onClick={onRotate} />
      </div>
      {children}
    </div>
  );
}
