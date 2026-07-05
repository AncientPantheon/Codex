/**
 * CFM Input Patterns
 *
 * CfmTokenBalanceRow — Muster Ex 2: balance display + MAX button
 *   Use when balance comes as a raw number/string prop (not from useTokenBalance hook).
 *   For hook-based balances, use TokenAmountRow directly.
 *
 * CfmInputHeader — Muster: INPUT label + type badge
 */

import type { ReactNode } from "react";
import { useRef, useEffect, useCallback, useState } from "react";
import { AlertCircle, Lock, Plus, Minus, Unlock, CheckCircle2, Loader2, ChevronDown, Copy, ClipboardPaste, ShieldCheck, Trash2 } from "lucide-react";
import { AddressBookPicker } from "./AddressBookPicker.js";
import { StoicTagPicker } from "./StoicTagPicker.js";
import { toast } from "sonner";
import { describeKeyset } from "@stoachain/ouronet-core/interactions/guardFunctions";
import type { IDescribedKeyset } from "@stoachain/ouronet-core/interactions/guardFunctions";
import type { NonKeyGuardConstructor } from "@stoachain/ouronet-core/pact";
import CodeMirror from "@uiw/react-codemirror";
import { autocompletion, type CompletionContext } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { pact } from "../lang-pact/index.js";
import { pactTheme } from "../lang-pact/pact-theme.js";
import { pactRead } from "@stoachain/stoa-core/reads";

// ── Shared helper ────────────────────────────────────────────────────────────

/** Detect if a string looks like an Ouronet (Ѻ.) or Kadena (k:/c:/u:/w:) account address */
function isAccountAddress(v: string): boolean {
  return v.startsWith("Ѻ.") || /^[kcuw]:/.test(v);
}

/**
 * AddressHighlight — renders an address exactly like the PatronSpend patron display.
 * Layout: prefix2 (blue) | first3 (gold) | leftFill (dim, overflow) | dots | rightFill (dim) | last3 (gold)
 * Fills the full field width; fades middle chars into background.
 * Non-address strings are rendered as plain truncated dim text.
 */
function AddressHighlight({ value }: { value: string }) {
  if (!value) return <span style={{ color: "#2a2a2a" }}>—</span>;
  if (!isAccountAddress(value)) {
    return (
      <span style={{ color: "#2a2a30", fontFamily: "'Courier New','Lucida Console',monospace", fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block", width: "100%" }}>
        {value}
      </span>
    );
  }
  const raw = value;
  const mid = Math.floor(raw.length / 2);
  const prefix2  = raw.slice(0, 2);
  const first3   = raw.slice(2, 5);
  const leftFill = raw.slice(5, mid);
  const rightFill= raw.slice(mid, -3);
  const last3    = raw.slice(-3);
  return (
    <div style={{ display: "flex", alignItems: "center", fontFamily: "'Courier New','Lucida Console',monospace", fontSize: "11px", whiteSpace: "nowrap", width: "100%", minWidth: 0 }}>
      <span style={{ color: "#3b82f6", flexShrink: 0 }}>{prefix2}</span>
      <span style={{ color: "#ceac5f", flexShrink: 0 }}>{first3}</span>
      <span style={{ color: "#2a2a2a", flex: 1, overflow: "hidden", textAlign: "right", minWidth: 0, display: "block" }} aria-hidden>{leftFill}</span>
      <span style={{ color: "#2d2d30", flexShrink: 0, letterSpacing: "0.05em" }} aria-hidden>·····</span>
      <span style={{ color: "#2a2a2a", flex: 1, overflow: "hidden", textAlign: "left", minWidth: 0, display: "block" }} aria-hidden>{rightFill}</span>
      <span style={{ color: "#ceac5f", flexShrink: 0 }}>{last3}</span>
    </div>
  );
}

/**
 * Trims trailing zeros from a decimal string.
 * "25.000000000000" → "25"
 * "25.50000" → "25.5"
 * "100.0" → "100"
 */
function trimTrailingZeros(value: string): string {
  if (!value || !value.includes(".")) return value;
  const trimmed = value.replace(/\.?0+$/, "");
  return trimmed || "0";
}

// ── CfmTokenBalanceRow ────────────────────────────────────────────────────────

interface CfmTokenBalanceRowProps {
  /** Current balance as number */
  balance: number;
  /** Token name shown after the number (e.g. "wSTOA", "OURO") */
  tokenLabel: string;
  /** Optional: path to token icon (e.g. "/images/coins/WSTOA.svg") */
  tokenIcon?: string;
  /** Called with the balance string when MAX is clicked */
  onMax: (amount: string) => void;
  /** Whether the button is disabled */
  disabled?: boolean;
}

/**
 * Muster Ex 2 — balance row with MAX button.
 *
 * Rule 3: balance number in yellow (#ceac5f), token icon after.
 * MAX button: dark bg, gold text.
 *
 * Use this when balance comes from a prop (number/string), not a hook.
 * When using useTokenBalance hook → use TokenAmountRow instead.
 */
export function CfmTokenBalanceRow({
  balance,
  tokenLabel,
  tokenIcon,
  onMax,
  disabled = false,
}: CfmTokenBalanceRowProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1 text-[10px]" style={{ color: "#555" }}>
        <span>Balance:</span>
        <span className="font-mono font-bold" style={{ color: "#ceac5f" }}>
          {balance}
        </span>
        {tokenIcon
          ? <img src={tokenIcon} className="h-3 w-3" alt={tokenLabel} />
          : <span className="font-mono" style={{ color: "#ceac5f" }}>{tokenLabel}</span>
        }
      </div>
      <button
        className="text-[10px] font-bold px-2 py-0.5 rounded hover:opacity-80 disabled:opacity-40"
        style={{ backgroundColor: "#262626", color: "#ceac5f" }}
        onClick={() => onMax(trimTrailingZeros(String(balance)))}
        disabled={disabled}
      >
        MAX
      </button>
    </div>
  );
}

// ── CfmInputHeader ────────────────────────────────────────────────────────────

interface CfmInputHeaderProps {
  /** e.g. "INPUT I", "INPUT II" */
  label: string;
  /** Type badge text, e.g. "<amount:decimal>", "<address:string>" */
  typeBadge: string;
  /** Optional tooltip node */
  tooltip?: React.ReactNode;
}

/**
 * Muster: INPUT label + type badge, used at the top of each function input.
 */
export function CfmInputHeader({ label, typeBadge, tooltip }: CfmInputHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#cd7f32" }}>
          {label}
        </span>
        {tooltip}
      </div>
      <span
        className="text-[10px] font-mono px-1.5 py-0.5 rounded flex-shrink-0"
        style={{ backgroundColor: "#140d03", color: "#cd7f32", border: "1px solid #cd7f3240" }}
      >
        {typeBadge}
      </span>
    </div>
  );
}

// ── AutonomicAmountInput ──────────────────────────────────────────────────────

interface AutonomicAmountInputProps {
  value: string;
  valueColor?: string;
  tokenIcon?: React.ReactNode;
  label?: string;
  /** When true, suppresses own border/radius (parent provides unified border) */
  noBorder?: boolean;
}

/**
 * AutonomicAmountInput — Universal locked input for system-determined values.
 *
 * Used across ALL patterns when the system pre-fills a value that the user
 * cannot change (e.g. exact burn amount, protocol-computed fee, fixed quantity).
 *
 * Visual cues:
 *   - Dashed border (vs solid on user inputs) → immediately signals "not editable"
 *   - 🔒 Lock icon + "SYSTEM" label on the right, in place of MAX
 *   - Slightly amber-tinted background
 *   - Value text in the token's own color (passed via valueColor)
 *   - pointer-events: none on value — cannot select/copy accidentally
 */
export function AutonomicAmountInput({
  value,
  valueColor = "#ceac5f",
  tokenIcon,
  label = "SYSTEM",
  noBorder,
}: AutonomicAmountInputProps) {
  return (
    <div
      className={`flex items-center overflow-hidden ${noBorder ? "" : "rounded-b-lg"}`}
      style={{
        backgroundColor: "#0a0805",
        ...(noBorder ? { borderTop: "1px solid #1e1a12" } : { border: "1px dashed #ceac5f30" }),
      }}
    >
      {/* Value display — read-only, styled like input */}
      <div
        className="flex-1 flex items-center gap-1.5 px-3 py-2 font-mono text-sm select-none"
        style={{ color: valueColor, pointerEvents: "none" }}
      >
        <span className="font-bold">{value || "—"}</span>
        {tokenIcon && <span className="flex-shrink-0">{tokenIcon}</span>}
      </div>

      {/* Divider */}
      <div style={{ width: "1px", alignSelf: "stretch", backgroundColor: "#ceac5f20" }} />

      {/* Lock indicator */}
      <div
        className="flex items-center gap-1 px-3 py-2 flex-shrink-0 select-none"
        style={{ color: "#ceac5f60" }}
      >
        <Lock className="h-3 w-3" />
        <span className="text-[9px] font-bold uppercase tracking-wider">{label}</span>
      </div>
    </div>
  );
}

// ── CfmBalanceError ───────────────────────────────────────────────────────────

/**
 * Inline error shown when amount exceeds available balance.
 * Always crimson — never pink.
 */
export function CfmBalanceError({ message = "Exceeds available balance" }: { message?: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs" style={{ color: "#c0392b" }}>
      <AlertCircle className="h-3.5 w-3.5" /> {message}
    </div>
  );
}

// ── InputFieldLabel ───────────────────────────────────────────────────────────

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

export interface InputFieldLabelProps {
  /** 1-based → renders "INPUT I", "INPUT II", etc. */
  index: number;
  /** e.g. "amount" → renders "<amount:decimal>" */
  varName: string;
  /** true = pulse glow animation (free/user-required input); false/omit = static (autonomous) */
  pulse?: boolean;
  /** Optional: replaces the "INPUT I" text on the left with a custom node */
  leftNode?: React.ReactNode;
}

/**
 * Label strip rendered directly above each amount input field (no gap).
 * Left: "INPUT I/II/…" in gold bold 9px.
 * Right: "<varName:decimal>" in monospace italic #555 10px.
 */
export function InputFieldLabel({ index, varName, pulse, leftNode }: InputFieldLabelProps) {
  const roman = ROMAN[Math.min(index - 1, ROMAN.length - 1)];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "3px 0 1px",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      {leftNode ?? (
        <span
          className={pulse ? "input-label-active" : undefined}
          style={{
            color: pulse ? "#f97316" : "#3d3d45",
            fontWeight: "bold",
            fontSize: "9px",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          INPUT {roman}
        </span>
      )}
      <span
        style={{
          color: "#f97316",
          fontFamily: "'Courier New', 'Lucida Console', monospace",
          fontSize: "10px",
          fontStyle: "italic",
          fontWeight: "bold",
        }}
      >
        &lt;{varName}:decimal&gt;
      </span>
    </div>
  );
}

// ── FreeAmountInput ───────────────────────────────────────────────────────────

export interface FreeAmountInputProps {
  value: string;
  onChange: (v: string) => void;
  tokenIcon: ReactNode;
  tokenColor: string;
  hasEnough: boolean;
  disabled?: boolean;
  placeholder?: string;
  maxValue?: string;
  leftExtra?: React.ReactNode;
  decimals?: number;
  /** When true, suppresses own border/radius (parent provides unified border) */
  noBorder?: boolean;
}

/**
 * FreeAmountInput — editable amount field for user-typed amounts.
 * Solid border (vs dashed on Autonomic). No lock / no SYSTEM label.
 * Left: optional leftExtra + editable text input. Right: MAX (optional) + tokenIcon + echoed amount.
 */
export function FreeAmountInput({
  value,
  onChange,
  noBorder,
  tokenIcon,
  disabled,
  placeholder = "0.00",
  maxValue,
  leftExtra,
  decimals,
}: FreeAmountInputProps) {
  const showMax = maxValue !== undefined && maxValue !== "";

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Convert comma → dot (European decimal separator)
    let val = e.target.value.replace(/,/g, ".").replace(/[^0-9.]/g, "");
    // Keep only first dot
    const dotIdx = val.indexOf(".");
    if (dotIdx !== -1) val = val.slice(0, dotIdx + 1) + val.slice(dotIdx + 1).replace(/\./g, "");
    const MAX_DECIMALS = 24;
    const effectiveDecimals = decimals ?? MAX_DECIMALS;
    const parts = val.split(".");
    if (parts.length > 1 && parts[1].length > effectiveDecimals) {
      val = parts[0] + "." + parts[1].slice(0, effectiveDecimals);
    }
    if (maxValue && maxValue !== "") {
      const max = parseFloat(maxValue);
      const entered = parseFloat(val);
      if (!isNaN(max) && !isNaN(entered) && entered > max) {
        val = maxValue;
      }
    }
    onChange(val);
  };

  // On blur: ensure value always has decimal point (Pact rejects integers)
  const handleBlur = () => {
    if (!value || value === "") return;
    const n = Number(value);
    if (!isNaN(n) && !value.includes(".")) {
      onChange(value + ".0");
    }
  };

  // Explicit row height driven by input padding + font
  const ROW_H = 36; // px — 8px top + 14px font + 2px line + 8px bottom ≈ 36

  return (
    <div
      style={{
        display: "flex",
        height: ROW_H,
        backgroundColor: "#060608",
        ...(noBorder
          ? { borderTop: "1px solid #1e1e1e" }
          : { border: "1px solid #262626", borderRadius: "0 0 8px 8px" }),
        overflow: "hidden",
      }}
    >
      {/* Left extra (e.g. Dispo toggle) */}
      {leftExtra && (
        <>
          <div style={{ display: "flex", alignItems: "center", paddingLeft: "8px", flexShrink: 0 }}>{leftExtra}</div>
          <div style={{ width: "1px", backgroundColor: "#262626", marginLeft: "8px" }} />
        </>
      )}
      {/* Editable input */}
      <input
        type="text"
        inputMode="decimal"
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={handleChange}
        onBlur={handleBlur}
        className="ghost-input"
        style={{
          flex: 1,
          height: "100%",
          background: "transparent",
          fontFamily: "'Courier New', 'Lucida Console', monospace",
          fontSize: "14px",
          padding: "0 12px",
          outline: "none",
          color: "#d2d3d4",
          minWidth: 0,
          border: "none",
          boxSizing: "border-box",
        }}
      />
      {/* Divider */}
      <div style={{ width: "1px", backgroundColor: "#262626" }} />

      {/* MAX zone — full-height, text perfectly centered */}
      {showMax ? (
        <div
          onClick={() => !disabled && onChange(trimTrailingZeros(maxValue ?? ""))}
          style={{
            position: "relative",
            width: "48px",
            flexShrink: 0,
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          <button
            disabled={disabled}
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              background: "transparent",
              border: "1px solid #ceac5f55",
              borderRadius: "3px",
              color: "#ceac5f",
              fontSize: "9px",
              fontWeight: "bold",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              padding: "2px 5px",
              cursor: "inherit",
              whiteSpace: "nowrap",
              pointerEvents: "none",
            }}
          >
            MAX
          </button>
        </div>
      ) : (
        tokenIcon && (
          <div style={{ display: "flex", alignItems: "center", padding: "0 12px", flexShrink: 0 }}>
            {tokenIcon}
          </div>
        )
      )}
    </div>
  );
}

// ── StringEntryInput ──────────────────────────────────────────────────────────

export interface StringEntryInputProps {
  /** Current string value (without quotes — quotes are added by the component) */
  value: string;
  onChange?: (v: string) => void;

  /** "free" = editable (default), "autonomous" = system-locked */
  variant?: "free" | "autonomous";

  /** INPUT label index (1-based → "INPUT I") */
  labelIndex?: number;
  /** Variable name for the type badge, e.g. "account" → "<account:string>" */
  varName?: string;

  /** Optional switch shown in the label row, right of INPUT label */
  switchLabel?: string;
  switchActive?: boolean;
  onSwitchToggle?: (active: boolean) => void;

  placeholder?: string;
  disabled?: boolean;

  /** When provided, renders an AddressBookPicker button for the given address type */
  addressBookType?: "ouronet" | "stoa";

  /**
   * Enable StoicTag entry: a "§" toggle that prefills the sigil, and a live
   * resolution preview. The modal owns the resolution (via useOuronetReceiver)
   * and passes the state in through the `stoic*` props below — the field is
   * display-only for the resolution. Free variant only.
   */
  allowStoicTag?: boolean;
  stoicResolving?: boolean;
  stoicResolvedAddress?: string | null;
  stoicTagName?: string | null;
  stoicError?: string | null;
}

export function StringEntryInput({
  value,
  onChange,
  variant = "free",
  labelIndex = 1,
  varName = "value",
  switchLabel,
  switchActive = false,
  onSwitchToggle,
  placeholder = "type here…",
  disabled,
  addressBookType,
  allowStoicTag,
  stoicResolving,
  stoicResolvedAddress,
  stoicTagName,
  stoicError,
}: StringEntryInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => { resize(); }, [value, resize]);

  const isAuto = variant === "autonomous";

  // ── Hooks hoisted unconditionally (React rules: never call hooks inside conditionals) ──
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // StoicTag mode — the value carries a leading § sigil. In this mode the § is
  // rendered as a fixed, undeletable prefix and the editable text is the bare
  // name; the value stays "§name" so detection/resolution work unchanged.
  const tagMode = !!allowStoicTag && value.startsWith("§");
  // Re-assert focus when entering tag mode (the prefix span insertion can shift
  // the input node) so typing § to start a tag doesn't drop the caret.
  useEffect(() => {
    if (tagMode && isFocused) inputRef.current?.focus();
  }, [tagMode, isFocused]);

  // ── Free variant — single-line with Copy + Paste + address highlight on blur ──
  if (!isAuto) {
    const isAddr   = isAccountAddress(value);
    // Show AddressHighlight when: has value + is address + not focused (never in tag mode)
    const showHighlight = isAddr && !!value && !isFocused && !tagMode;

    async function handlePaste() {
      // Strategy 1: Clipboard API readText — works on Chrome/Edge
      if (navigator.clipboard?.readText) {
        try {
          const text = await navigator.clipboard.readText();
          if (text) { onChange?.(text.trim()); return; }
        } catch {
          // Permission denied or unavailable (Firefox blocks without explicit grant)
        }
      }
      // Strategy 2: Clipboard API read() — broader API, some browsers
      if ((navigator.clipboard as any)?.read) {
        try {
          const items = await (navigator.clipboard as any).read();
          for (const item of items) {
            if (item.types?.includes("text/plain")) {
              const blob = await item.getType("text/plain");
              const text = await blob.text();
              if (text) { onChange?.(text.trim()); return; }
            }
          }
        } catch {
          // Also blocked
        }
      }
      // Strategy 3: focus real input — the onPaste handler on the input will capture Ctrl+V
      inputRef.current?.focus();
      toast.info("Press Ctrl+V (or ⌘V) to paste", { duration: 2000 });
    }
    function handleCopy() {
      if (value) navigator.clipboard.writeText(value).catch(() => {});
    }

    return (
      <div>
        {/* Label row — orange + pulse for free inputs */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              className={disabled ? "" : "input-label-active"}
              style={{ fontSize: "9px", fontWeight: "bold", color: "#f97316", textTransform: "uppercase", letterSpacing: "0.06em" }}
            >
              INPUT {ROMAN[(labelIndex - 1) % 10]}
            </span>
            {switchLabel && onSwitchToggle && (
              <button onClick={() => onSwitchToggle(!switchActive)} disabled={disabled}
                style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "9px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em", background: switchActive ? "#1e3a5f" : "transparent", border: `1px solid ${switchActive ? "#1d4ed8" : "#3b82f6"}`, color: switchActive ? "#60a5fa" : "#3b82f6", borderRadius: "3px", padding: "1px 5px", cursor: disabled ? "not-allowed" : "pointer" }}>
                {switchLabel}
              </button>
            )}
            {allowStoicTag && (() => {
              const tagActive = value.trim().startsWith("§");
              return (
                <button
                  onClick={() => onChange?.(tagActive ? value.replace(/^\s*§\s*/, "") : "§" + value)}
                  disabled={disabled}
                  title={tagActive ? "Switch back to a plain Ouronet address" : "Enter a StoicTag (§)"}
                  style={{ display: "inline-flex", alignItems: "center", gap: "3px", fontSize: "9px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em", background: tagActive ? "#16a34a22" : "transparent", border: `1px solid ${tagActive ? "#16a34a" : "#16a34a80"}`, color: tagActive ? "#4ade80" : "#16a34a", borderRadius: "3px", padding: "1px 5px", cursor: disabled ? "not-allowed" : "pointer" }}>
                  § StoicTag
                </button>
              );
            })()}
          </div>
          <span style={{ fontSize: "10px", fontFamily: "'Courier New', 'Lucida Console', monospace", color: "#f97316", fontStyle: "italic", fontWeight: "bold" }}>
            &lt;{varName}:string&gt;
          </span>
        </div>

        {/* Single-line input row with Copy + Paste + AB Picker */}
        {/* Outer wrapper: position:relative so AB picker dropdown can escape overflow:hidden */}
        <div style={{ display: "flex", alignItems: "center", position: "relative" }}>
          {/* Inner row: overflow:hidden for rounded corners, flex:1 */}
          <div
            style={{ flex: 1, display: "flex", alignItems: "center", backgroundColor: "#060608", border: `1px solid ${isFocused ? "#444" : "#262626"}`, borderRadius: addressBookType ? "8px 0 0 8px" : "8px", overflow: "hidden", height: "36px", cursor: showHighlight ? "text" : undefined }}
            onClick={() => { if (showHighlight) inputRef.current?.focus(); }}
          >
            {/* Address highlight overlay (blurred + is address) */}
            {showHighlight ? (
              <div style={{ flex: 1, padding: "0 10px", minWidth: 0, display: "flex", alignItems: "center", height: "100%" }}>
                <AddressHighlight value={value} />
              </div>
            ) : (
              <div
                style={{ flex: 1, display: "flex", alignItems: "center", minWidth: 0, height: "100%" }}
                onClick={() => inputRef.current?.focus()}
              >
                {/* Fixed, undeletable § sigil prefix — present only in tag mode */}
                {tagMode && (
                  <span
                    aria-hidden
                    style={{ paddingLeft: "10px", color: "#4ade80", fontWeight: "bold", fontFamily: "'Courier New', 'Lucida Console', monospace", fontSize: "13px", userSelect: "none", flexShrink: 0 }}
                  >
                    §
                  </span>
                )}
                <input
                  ref={inputRef}
                  type="text"
                  value={tagMode ? value.slice(1) : value}
                  onChange={(e) => onChange?.(tagMode ? "§" + e.target.value : e.target.value)}
                  onPaste={(e) => { const t = e.clipboardData?.getData("text"); if (t) { e.preventDefault(); onChange?.(tagMode ? "§" + t.trim() : t.trim()); } }}
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => setIsFocused(false)}
                  placeholder={tagMode ? "StoicTag name" : placeholder}
                  disabled={disabled}
                  className="ghost-input"
                  style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontFamily: "'Courier New', 'Lucida Console', monospace", fontSize: "12px", color: "#d2d3d4", padding: tagMode ? "0 10px 0 2px" : "0 10px", height: "100%", minWidth: 0 }}
                />
              </div>
            )}
            {/* Hidden input keeps focus target when overlay is shown */}
            {showHighlight && (
              <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={(e) => onChange?.(e.target.value)}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                style={{ position: "absolute", opacity: 0, pointerEvents: "none", width: 0, height: 0 }}
                tabIndex={-1}
                aria-hidden
              />
            )}
            {/* Divider */}
            <div style={{ width: "1px", height: "20px", backgroundColor: "#262626", flexShrink: 0 }} />
            {/* Paste */}
            <button type="button" onClick={() => handlePaste()} title="Paste"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "40px", minHeight: "36px", background: "transparent", border: "none", cursor: "pointer", color: "#555", flexShrink: 0, WebkitTapHighlightColor: "transparent", touchAction: "manipulation" }}
              onMouseEnter={e => (e.currentTarget.style.color = "#ceac5f")}
              onMouseLeave={e => (e.currentTarget.style.color = "#555")}>
              <ClipboardPaste style={{ width: 13, height: 13 }} />
            </button>
            {/* Copy */}
            <button type="button" onClick={handleCopy} title="Copy" disabled={!value}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "32px", height: "100%", background: "transparent", border: "none", cursor: value ? "pointer" : "default", color: value ? "#555" : "#333", flexShrink: 0 }}
              onMouseEnter={e => { if (value) e.currentTarget.style.color = "#ceac5f"; }}
              onMouseLeave={e => (e.currentTarget.style.color = value ? "#555" : "#333")}>
              <Copy style={{ width: 13, height: 13 }} />
            </button>
          </div>
          {/* StoicTag Picker — dedicated inserter for known §tags (middle button) */}
          {allowStoicTag && addressBookType === "ouronet" && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "36px", height: "36px", flexShrink: 0, backgroundColor: "#060608", border: `1px solid ${isFocused ? "#444" : "#262626"}`, borderLeft: "none", borderRadius: 0 }}>
              <StoicTagPicker onSelect={(v) => onChange?.(v)} />
            </div>
          )}
          {/* Address Book Picker — OUTSIDE overflow:hidden wrapper so dropdown is not clipped */}
          {addressBookType && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "36px", height: "36px", flexShrink: 0, backgroundColor: "#060608", border: `1px solid ${isFocused ? "#444" : "#262626"}`, borderLeft: "none", borderRadius: "0 8px 8px 0" }}>
              <AddressBookPicker
                addressType={addressBookType}
                onSelect={(addr) => onChange?.(addr)}
              />
            </div>
          )}
        </div>

        {/* StoicTag resolution preview — shown while the value is a §tag */}
        {allowStoicTag && value.trim().startsWith("§") && (
          <div style={{ marginTop: "4px" }}>
            {stoicResolving ? (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10px", color: "#888" }}>
                <Loader2 style={{ width: 11, height: 11 }} className="animate-spin" />
                Resolving StoicTag…
              </div>
            ) : stoicError ? (
              <div style={{ display: "flex", alignItems: "flex-start", gap: "6px", fontSize: "10px", color: "#c0392b" }}>
                <AlertCircle style={{ width: 11, height: 11, flexShrink: 0, marginTop: "1px" }} />
                <span style={{ wordBreak: "break-word" }}>{stoicError}</span>
              </div>
            ) : stoicResolvedAddress ? (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10px", color: "#4ade80", minWidth: 0 }}>
                <CheckCircle2 style={{ width: 11, height: 11, flexShrink: 0 }} />
                <span style={{ flexShrink: 0 }}>§{stoicTagName} →</span>
                <span style={{ minWidth: 0, overflow: "hidden" }}>
                  <AddressHighlight value={stoicResolvedAddress} />
                </span>
              </div>
            ) : null}
          </div>
        )}
      </div>
    );
  }

  // ── Autonomous variant — ghost mode, address highlight, Copy button ──────────
  return (
    <div>
      {/* Label row — dark color + optional switch for toggling to free */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "9px", fontWeight: "bold", color: "#3d3d45", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            INPUT {ROMAN[(labelIndex - 1) % 10]}
          </span>
          {switchLabel && onSwitchToggle && (
            <button
              onClick={() => onSwitchToggle(!switchActive)}
              disabled={disabled}
              style={{
                display: "inline-flex", alignItems: "center", gap: "4px",
                fontSize: "9px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em",
                background: switchActive ? "#1e3a5f" : "transparent",
                border: `1px solid ${switchActive ? "#1d4ed8" : "#3b82f6"}`,
                color: switchActive ? "#60a5fa" : "#3b82f6",
                borderRadius: "3px", padding: "1px 5px",
                cursor: disabled ? "not-allowed" : "pointer",
              }}
            >
              {switchLabel}
            </button>
          )}
        </div>
        <span style={{ fontSize: "10px", fontFamily: "'Courier New', 'Lucida Console', monospace", color: "#5a4020", fontStyle: "italic", fontWeight: "bold" }}>
          &lt;{varName}:string&gt;
        </span>
      </div>
      {/* Ghost-mode field: dim background, dashed border, address highlight */}
      <div title={isAccountAddress(value) ? value : undefined}
        style={{ display: "flex", alignItems: "center", height: "36px", backgroundColor: "#080808", border: "1px dashed #2a2a2a", borderRadius: "8px", overflow: "hidden", cursor: "default" }}>
        {/* Address with highlight or plain ghost text */}
        <div style={{ flex: 1, padding: "0 10px", overflow: "hidden", userSelect: "none", pointerEvents: "none", display: "flex", alignItems: "center", minWidth: 0 }}>
          <AddressHighlight value={value} />
        </div>
        <div style={{ width: "1px", height: "20px", backgroundColor: "#2a2a2a", flexShrink: 0 }} />
        {/* Lock + SYSTEM */}
        <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "0 8px", color: "#2d2d35", userSelect: "none", flexShrink: 0 }}>
          <Lock style={{ width: 11, height: 11 }} />
          <span style={{ fontSize: "9px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.08em" }}>SYSTEM</span>
        </div>
        {/* Copy button */}
        {value && (
          <>
            <div style={{ width: "1px", height: "20px", backgroundColor: "#2a2a2a", flexShrink: 0 }} />
            <button type="button" onClick={() => navigator.clipboard.writeText(value).catch(() => {})} title="Copy to clipboard"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "32px", height: "100%", background: "transparent", border: "none", cursor: "pointer", color: "#333", flexShrink: 0 }}
              onMouseEnter={e => (e.currentTarget.style.color = "#ceac5f")}
              onMouseLeave={e => (e.currentTarget.style.color = "#333")}>
              <Copy style={{ width: 12, height: 12 }} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── GuardEntryInput ───────────────────────────────────────────────────────────

const PREDICATES = [
  { value: "keys-all",  label: "keys-all",  group: "Standard", minKeys: 1, description: "All keys must sign" },
  { value: "keys-any",  label: "keys-any",  group: "Standard", minKeys: 1, description: "Any single key may sign" },
  { value: "keys-2",    label: "keys-2",    group: "Standard", minKeys: 2, description: "At least 2 keys must sign" },
  { value: "stoa-ns.stoic-predicates.keys-1", label: "keys-1", group: "Stoic Basic", minKeys: 1, description: "Exactly 1 key must sign" },
  { value: "stoa-ns.stoic-predicates.keys-3", label: "keys-3", group: "Stoic Basic", minKeys: 3, description: "At least 3 keys must sign" },
  { value: "stoa-ns.stoic-predicates.keys-4", label: "keys-4", group: "Stoic Basic", minKeys: 4, description: "At least 4 keys must sign" },
  { value: "stoa-ns.stoic-predicates.at-least-51pct", label: "≥51%", group: "Stoic %", minKeys: 1, description: "At least 51% of keys must sign" },
  { value: "stoa-ns.stoic-predicates.at-least-60pct", label: "≥60%", group: "Stoic %", minKeys: 1, description: "At least 60% of keys must sign" },
  { value: "stoa-ns.stoic-predicates.at-least-66pct", label: "≥66%", group: "Stoic %", minKeys: 1, description: "At least 66% of keys must sign" },
  { value: "stoa-ns.stoic-predicates.at-least-75pct", label: "≥75%", group: "Stoic %", minKeys: 1, description: "At least 75% of keys must sign" },
  { value: "stoa-ns.stoic-predicates.at-least-90pct", label: "≥90%", group: "Stoic %", minKeys: 1, description: "At least 90% of keys must sign" },
  { value: "stoa-ns.stoic-predicates.keys-2-of-3", label: "2-of-3", group: "Stoic m-of-n", exactKeys: 3, description: "2 of 3 keys must sign" },
  { value: "stoa-ns.stoic-predicates.keys-3-of-5", label: "3-of-5", group: "Stoic m-of-n", exactKeys: 5, description: "3 of 5 keys must sign" },
  { value: "stoa-ns.stoic-predicates.keys-4-of-7", label: "4-of-7", group: "Stoic m-of-n", exactKeys: 7, description: "4 of 7 keys must sign" },
  { value: "stoa-ns.stoic-predicates.keys-5-of-9", label: "5-of-9", group: "Stoic m-of-n", exactKeys: 9, description: "5 of 9 keys must sign" },
  { value: "stoa-ns.stoic-predicates.all-but-one", label: "all-but-one", group: "Stoic Tolerance", minKeys: 1, description: "All keys except one must sign" },
  { value: "stoa-ns.stoic-predicates.all-but-two", label: "all-but-two", group: "Stoic Tolerance", minKeys: 2, description: "All keys except two must sign" },
] as const;

type PredValue = typeof PREDICATES[number]["value"];

function isPredAvailable(pred: typeof PREDICATES[number], keyCount: number): boolean {
  if ("exactKeys" in pred && pred.exactKeys !== undefined && keyCount !== pred.exactKeys) return false;
  if ("minKeys" in pred && pred.minKeys !== undefined && keyCount < pred.minKeys) return false;
  return true;
}

function predGroups() {
  const g: Record<string, typeof PREDICATES[number][]> = {};
  for (const p of PREDICATES) {
    if (!g[p.group]) g[p.group] = [];
    g[p.group].push(p);
  }
  return g;
}

export type GuardChangeValue =
  | { mode: "define";   keys: string[];   pred: string }
  | { mode: "existing"; keysetRef: string; resolvedKeys: string[]; resolvedPred: string }
  | null;

/** Current active tab exposed to parent via onChange — needed for BoolEntryInput variant selection */
export type GuardInputMode = "define" | "existing";

export interface GuardEntryInputProps {
  labelIndex?: number;
  varName?: string;
  /** "free" = interactive (default), "autonomous" = system-locked display */
  variant?: "free" | "autonomous";
  /** Autonomous mode: keys to display (locked) */
  autonomousKeys?: string[];
  /** Autonomous mode: predicate to display (locked) */
  autonomousPred?: string;
  /** Called whenever the guard definition changes (free mode only). */
  onChange?: (guard: GuardChangeValue) => void;
  /** Called whenever the active tab changes (needed by parent to switch BoolEntryInput variant). */
  onModeChange?: (mode: GuardInputMode) => void;
  disabled?: boolean;
}

export function GuardEntryInput({
  labelIndex = 1,
  varName = "guard",
  variant = "free",
  autonomousKeys = [],
  autonomousPred = "keys-all",
  onChange,
  onModeChange,
  disabled,
}: GuardEntryInputProps) {
  const COLOR = "#cd7f32";

  // ── Hooks hoisted unconditionally (React rules: never call hooks after a conditional return) ──
  // The 12 hooks that drive the free-variant editor used to live below the
  // `if (variant === "autonomous")` early-return. When `variant` flipped
  // between renders the hook-counter desynchronized by 12 slots and crashed
  // the component. Hoisted here; the free branch reads from the same state,
  // the autonomous branch ignores it (state is cheap, hook discipline isn't).
  type Tab = "define" | "existing";
  const [tab, setTab]                   = useState<Tab>("define");

  const handleTabChange = (t: Tab) => {
    setTab(t);
    onModeChange?.(t);
  };

  // ── Define tab state ──
  const [keys, setKeys]                 = useState<string[]>([""]);
  const [pred, setPred]                 = useState<PredValue>("keys-all");
  const [predOpen, setPredOpen]         = useState(false);
  const [predSearch, setPredSearch]     = useState("");

  // ── Existing tab state ──
  const [keysetName, setKeysetName]     = useState("");
  const [locking, setLocking]           = useState(false);
  const [locked, setLocked]             = useState<IDescribedKeyset | null>(null);
  const [lockError, setLockError]       = useState<string | null>(null);

  const validKeys = keys.filter((k) => k.trim().length === 64);
  const selectedPred = PREDICATES.find((p) => p.value === pred)!;
  const groups = predGroups();

  // Notify parent
  useEffect(() => {
    if (!onChange) return;
    if (tab === "define") {
      if (validKeys.length > 0) onChange({ mode: "define", keys: validKeys, pred });
      else onChange(null);
    } else {
      if (locked) onChange({ mode: "existing", keysetRef: keysetName, resolvedKeys: locked.keys, resolvedPred: locked.pred });
      else onChange(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, keys, pred, locked, keysetName]);

  // Auto-reset pred when it becomes unavailable
  useEffect(() => {
    if (!isPredAvailable(selectedPred, validKeys.length)) setPred("keys-all");
  }, [validKeys.length, selectedPred]);

  const handleLock = useCallback(async () => {
    if (!keysetName.trim()) return;
    setLocking(true);
    setLockError(null);
    setLocked(null);
    try {
      const ks = await describeKeyset(keysetName.trim());
      setLocked(ks);
    } catch {
      setLockError("Keyset not found or failed to resolve.");
    } finally {
      setLocking(false);
    }
  }, [keysetName]);

  // ── Autonomous variant ──────────────────────────────────────────────────────
  if (variant === "autonomous") {
    const payloadJson = JSON.stringify({ keys: autonomousKeys, pred: autonomousPred }, null, 2);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {/* Label row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: "9px", fontWeight: "bold", color: COLOR, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            INPUT {ROMAN[(labelIndex - 1) % 10]}
          </span>
          <span style={{ fontSize: "10px", fontFamily: "'Courier New','Lucida Console',monospace", color: "#555", fontStyle: "italic" }}>
            &lt;{varName}:guard&gt;
          </span>
        </div>
        {/* Locked display */}
        <div style={{ display: "flex", alignItems: "flex-start", backgroundColor: "#0a0805", border: "1px dashed #ceac5f30", borderRadius: "8px", padding: "10px 12px", gap: "8px", overflow: "hidden" }}>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
            {/* Keys */}
            <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
              {autonomousKeys.map((k, i) => (
                <code key={i} style={{ fontSize: "11px", fontFamily: "'Courier New','Lucida Console',monospace", color: "#ceac5f", wordBreak: "break-all" }}>
                  {k.slice(0, 20)}…{k.slice(-8)}
                </code>
              ))}
              {autonomousKeys.length === 0 && (
                <span style={{ fontSize: "11px", color: "#555" }}>—</span>
              )}
            </div>
            {/* Pred badge */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: "bold", color: "#555" }}>pred:</span>
              <span style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "999px", backgroundColor: "#262626", color: "#ceac5f" }}>{autonomousPred}</span>
            </div>
            {/* JSON payload */}
            <pre style={{ margin: 0, fontSize: "9px", fontFamily: "'Courier New','Lucida Console',monospace", color: "#555", backgroundColor: "#060608", border: "1px solid #1a1a1a", borderRadius: "4px", padding: "6px 8px", overflowX: "auto", overflowY: "auto", maxHeight: "120px" }}>
              {payloadJson}
            </pre>
          </div>
          {/* Divider */}
          <div style={{ width: "1px", alignSelf: "stretch", backgroundColor: "#ceac5f20", margin: "0 4px" }} />
          {/* Lock + SYSTEM */}
          <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0, color: "#ceac5f60", userSelect: "none" }}>
            <Lock style={{ width: 12, height: 12 }} />
            <span style={{ fontSize: "9px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.08em" }}>SYSTEM</span>
          </div>
        </div>
      </div>
    );
  }

  // JSON payload preview — only in Define mode (existing keyset is already on-chain, no payload needed)
  const payloadJson = tab === "define" && validKeys.length > 0
    ? JSON.stringify({ keys: validKeys, pred }, null, 2)
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>

      {/* ── Label row ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: "9px", fontWeight: "bold", color: COLOR, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {ROMAN[(labelIndex - 1) % 10] ? `INPUT ${ROMAN[(labelIndex - 1) % 10]}` : `INPUT ${labelIndex}`}
        </span>
        <span style={{ fontSize: "10px", fontFamily: "'Courier New','Lucida Console',monospace", color: "#555", fontStyle: "italic" }}>
          &lt;{varName}:guard&gt;
        </span>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
        {(["define", "existing"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => handleTabChange(t)}
            style={{
              padding: "6px 0",
              borderRadius: "8px",
              border: `1px solid ${tab === t ? COLOR : "#262626"}`,
              backgroundColor: tab === t ? `${COLOR}18` : "#0a0a0a",
              color: tab === t ? COLOR : "#888",
              fontSize: "11px",
              fontWeight: "bold",
              cursor: "pointer",
            }}
          >
            {t === "define" ? "Define Keyset" : "Use Existing Keyset"}
          </button>
        ))}
      </div>

      {/* ── Define tab ── */}
      {tab === "define" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "10px", backgroundColor: "#060608", border: "1px solid #262626", borderRadius: "8px" }}>

          {/* Keys */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <span style={{ fontSize: "9px", fontWeight: "bold", color: COLOR, textTransform: "uppercase", letterSpacing: "0.05em" }}>Public Keys</span>
            {keys.map((key, i) => (
              <div key={i} style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                <input
                  type="text"
                  value={key}
                  onChange={(e) => { const u = [...keys]; u[i] = e.target.value; setKeys(u); }}
                  placeholder="Public key hex (64 chars)"
                  disabled={disabled}
                  style={{
                    flex: 1,
                    fontFamily: "'Courier New','Lucida Console',monospace",
                    fontSize: "12px",
                    padding: "6px 10px",
                    backgroundColor: "#0a0a0a",
                    border: `1px solid ${key.length === 64 ? "#22c55e40" : "#262626"}`,
                    borderRadius: "6px",
                    color: key.length === 64 ? "#d2d3d4" : "#888",
                    outline: "none",
                  }}
                />
                {keys.length > 1 && (
                  <button
                    onClick={() => setKeys(keys.filter((_, j) => j !== i))}
                    style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "6px", border: "1px solid #8b1a1a40", backgroundColor: "transparent", cursor: "pointer", flexShrink: 0 }}
                  >
                    <Minus style={{ width: 12, height: 12, color: "#c0392b" }} />
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={() => setKeys([...keys, ""])}
              style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", color: COLOR, backgroundColor: "transparent", border: `1px solid ${COLOR}40`, borderRadius: "6px", padding: "4px 10px", cursor: "pointer", width: "fit-content" }}
            >
              <Plus style={{ width: 12, height: 12 }} /> Add Key
            </button>
          </div>

          {/* Predicate dropdown */}
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span style={{ fontSize: "9px", fontWeight: "bold", color: COLOR, textTransform: "uppercase", letterSpacing: "0.05em" }}>Predicate</span>
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setPredOpen((v) => !v)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "6px 10px",
                  backgroundColor: "#0a0a0a",
                  border: `1px solid ${predOpen ? `${COLOR}60` : "#262626"}`,
                  borderRadius: "6px",
                  color: "#d2d3d4",
                  fontSize: "12px",
                  fontFamily: "'Courier New','Lucida Console',monospace",
                  cursor: "pointer",
                }}
              >
                <span>{selectedPred.label}</span>
                <ChevronDown style={{ width: 14, height: 14, color: "#555", transform: predOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
              </button>

              {predOpen && (
                <div style={{ position: "absolute", zIndex: 50, width: "100%", marginTop: "4px", borderRadius: "8px", border: "1px solid #262626", backgroundColor: "#111", boxShadow: "0 8px 24px rgba(0,0,0,0.6)", overflow: "hidden" }}>
                  <div style={{ padding: "6px", borderBottom: "1px solid #1a1a1a" }}>
                    <input
                      autoFocus
                      value={predSearch}
                      onChange={(e) => setPredSearch(e.target.value)}
                      placeholder="Search predicate…"
                      style={{ width: "100%", padding: "4px 8px", backgroundColor: "#0a0a0a", border: "1px solid #262626", borderRadius: "4px", color: "#d2d3d4", fontSize: "11px", fontFamily: "monospace", outline: "none", boxSizing: "border-box" }}
                    />
                  </div>
                  <div style={{ maxHeight: "200px", overflowY: "auto" }}>
                    {Object.entries(groups).map(([group, preds]) => {
                      const filtered = preds.filter((p) =>
                        !predSearch || p.label.toLowerCase().includes(predSearch.toLowerCase()) || p.description.toLowerCase().includes(predSearch.toLowerCase())
                      );
                      if (!filtered.length) return null;
                      return (
                        <div key={group}>
                          <div style={{ padding: "4px 10px", backgroundColor: "#0d0d0d", borderBottom: "1px solid #1a1a1a" }}>
                            <span style={{ fontSize: "9px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.1em", color: "#444" }}>{group}</span>
                          </div>
                          {filtered.map((p) => {
                            const avail = isPredAvailable(p, validKeys.length);
                            const sel = pred === p.value;
                            return (
                              <button
                                key={p.value}
                                onClick={() => { if (avail) { setPred(p.value as PredValue); setPredOpen(false); setPredSearch(""); } }}
                                style={{
                                  width: "100%",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  padding: "0 10px",
                                  height: "34px",
                                  backgroundColor: sel ? `${COLOR}18` : "transparent",
                                  border: "none",
                                  borderBottom: "1px solid #1a1a1a",
                                  color: !avail ? "#333" : sel ? COLOR : "#d2d3d4",
                                  fontSize: "11px",
                                  fontFamily: "monospace",
                                  cursor: avail ? "pointer" : "not-allowed",
                                  textAlign: "left",
                                }}
                              >
                                <span>{p.label}</span>
                                <span style={{ fontSize: "9px", color: avail ? "#555" : "#2a2a2a" }}>{!avail ? "unavail" : p.description}</span>
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            {selectedPred && (
              <span style={{ fontSize: "10px", color: "#555" }}>{selectedPred.description}</span>
            )}
          </div>
        </div>
      )}

      {/* ── Existing tab ── */}
      {tab === "existing" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "10px", backgroundColor: "#060608", border: "1px solid #262626", borderRadius: "8px" }}>
          <span style={{ fontSize: "9px", fontWeight: "bold", color: COLOR, textTransform: "uppercase", letterSpacing: "0.05em" }}>Keyset Name</span>

          {/* Quoted string input */}
          <div style={{ display: "flex", alignItems: "center", backgroundColor: "#0a0a0a", border: `1px solid ${locked ? "#22c55e40" : "#262626"}`, borderRadius: "6px", overflow: "hidden" }}>
            <span style={{ padding: "6px 8px", color: COLOR, fontFamily: "monospace", fontSize: "14px", flexShrink: 0, userSelect: "none" }}>"</span>
            <input
              type="text"
              value={keysetName}
              onChange={(e) => { setKeysetName(e.target.value); setLocked(null); setLockError(null); }}
              placeholder="keyset-name"
              disabled={disabled || !!locked}
              style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontFamily: "'Courier New','Lucida Console',monospace", fontSize: "13px", color: "#d2d3d4", padding: "6px 4px" }}
            />
            <span style={{ padding: "6px 8px", color: COLOR, fontFamily: "monospace", fontSize: "14px", flexShrink: 0, userSelect: "none" }}>"</span>
          </div>

          {/* Lock In / Unlock */}
          {!locked ? (
            <button
              onClick={handleLock}
              disabled={locking || !keysetName.trim() || disabled}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                backgroundColor: COLOR,
                border: "none",
                borderRadius: "6px",
                color: "#0a0a0a",
                fontSize: "11px",
                fontWeight: "bold",
                cursor: locking || !keysetName.trim() ? "not-allowed" : "pointer",
                opacity: locking || !keysetName.trim() ? 0.5 : 1,
                width: "fit-content",
              }}
            >
              {locking
                ? <Loader2 style={{ width: 13, height: 13, animation: "spin 1s linear infinite" }} />
                : <Lock style={{ width: 13, height: 13 }} />}
              {locking ? "Verifying…" : "Lock In"}
            </button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {/* Resolved keyset */}
              <div style={{ padding: "8px 10px", backgroundColor: "#0a0a0a", border: "1px solid #22c55e30", borderRadius: "6px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
                  <CheckCircle2 style={{ width: 14, height: 14, color: "#4ade80", flexShrink: 0 }} />
                  <span style={{ fontSize: "11px", fontWeight: "bold", color: "#4ade80" }}>Keyset Resolved</span>
                  <span style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "999px", backgroundColor: "#262626", color: COLOR }}>{locked.pred}</span>
                  <span style={{ fontSize: "10px", color: "#555" }}>{locked.keys.length} key{locked.keys.length !== 1 ? "s" : ""}</span>
                </div>
                {locked.keys.map((k, i) => (
                  <code key={i} style={{ display: "block", fontSize: "10px", fontFamily: "monospace", color: "#c0c0c0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k}</code>
                ))}
              </div>
              <button
                onClick={() => { setLocked(null); setLockError(null); }}
                style={{ display: "flex", alignItems: "center", gap: "6px", padding: "5px 10px", backgroundColor: "transparent", border: "1px solid #262626", borderRadius: "6px", color: "#888", fontSize: "11px", cursor: "pointer", width: "fit-content" }}
              >
                <Unlock style={{ width: 12, height: 12 }} /> Unlock
              </button>
            </div>
          )}

          {/* Error */}
          {lockError && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 10px", backgroundColor: "#8b1a1a10", border: "1px solid #8b1a1a40", borderRadius: "6px" }}>
              <AlertCircle style={{ width: 13, height: 13, color: "#c0392b", flexShrink: 0 }} />
              <span style={{ fontSize: "11px", color: "#c0392b" }}>{lockError}</span>
            </div>
          )}
        </div>
      )}

      {/* ── JSON Payload preview ── */}
      {payloadJson && (
        <div style={{ borderRadius: "6px", border: `1px solid ${COLOR}30`, overflow: "hidden" }}>
          <div style={{ padding: "4px 10px", backgroundColor: `${COLOR}12`, borderBottom: `1px solid ${COLOR}20` }}>
            <span style={{ fontSize: "9px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.08em", color: COLOR }}>TX Keyset Payload</span>
          </div>
          <pre style={{ margin: 0, padding: "8px 10px", fontSize: "10px", fontFamily: "'Courier New','Lucida Console',monospace", color: "#888", backgroundColor: "#060608", overflow: "auto" }}>
            {payloadJson}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── NonKeyGuardEntryInput ─────────────────────────────────────────────────────
//
// A guard input for slots the chain restricts to NON-key-based guards (the
// Smart-account GOVERNOR slot). The user picks a guard constructor and supplies
// the argument expression ("body"). The final guard is assembled core-side via
// buildNonKeyGuardExpr — `(constructor body)`.
//
// Only the two constructors that make sense when authoring a governor from the
// UI are exposed: create-user-guard (wrap a function as a predicate) and
// create-capability-guard (wrap a capability). The three remaining non-key
// constructors are unusable here — pact / capability-pact guards capture a
// pact-id that can never recur outside their defpact (permanently
// unsatisfiable), and module guards are created from inside a module to own
// its own assets, not authored externally.
//
// The body is edited in a CodeMirror Pact editor (same language + theme as the
// Execute Code window) with autocomplete for the guard built-ins. An optional
// "Check Guard Input" button runs an on-chain local dry-run that constructs the
// guard, so the chain validates that the referenced function / capability
// exists with the right arity before the user commits.

const NON_KEY_CONSTRUCTORS: { value: NonKeyGuardConstructor; label: string }[] = [
  { value: "create-user-guard",       label: "User Guard" },
  { value: "create-capability-guard", label: "Capability Guard" },
];

// Completions are limited to the two guard constructors this slot accepts, so
// `create-cabability-guard`-style typos surface immediately and the disallowed
// pact / module variants are never suggested.
const PACT_GUARD_COMPLETIONS = [
  "create-user-guard",
  "create-capability-guard",
].map((label) => ({ label, type: "function" }));

function pactGuardCompletions(context: CompletionContext) {
  const word = context.matchBefore(/[\w.|-]+/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  return { from: word.from, options: PACT_GUARD_COMPLETIONS };
}

// lineWrapping — wrap long lines instead of clipping them at the right edge.
const CM_EXTENSIONS = [pact(), EditorView.lineWrapping, autocompletion({ override: [pactGuardCompletions] })];

type GuardCheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "valid" }
  | { status: "invalid"; message: string };

export interface NonKeyGuardEntryInputProps {
  labelIndex?: number;
  varName?: string;
  /**
   * Controlled — parent owns the constructor + body so the field can be
   * rendered in both the collapsed and expanded Zone2 slots without state
   * diverging. Seed the parent state once from serializeGovernorToInput.
   */
  constructorName: NonKeyGuardConstructor;
  body: string;
  onConstructorChange: (c: NonKeyGuardConstructor) => void;
  onBodyChange: (b: string) => void;
  /**
   * The current on-chain governor reduced to { constructor, body } (rotate
   * flow). When the user switches BACK to the constructor that matches it, the
   * body is restored to this seed instead of cleared — switching to a
   * different constructor still clears, since that is entirely different code.
   */
  initialSeed?: { constructor: NonKeyGuardConstructor; body: string };
  disabled?: boolean;
}

export function NonKeyGuardEntryInput({
  labelIndex = 1,
  varName = "governor",
  constructorName: ctor,
  body,
  onConstructorChange,
  onBodyChange,
  initialSeed,
  disabled,
}: NonKeyGuardEntryInputProps) {
  const COLOR = "#cd7f32";

  const [check, setCheck] = useState<GuardCheckState>({ status: "idle" });

  // Any edit invalidates a prior check result.
  useEffect(() => { setCheck({ status: "idle" }); }, [ctor, body]);

  // Switching constructor: restore the on-chain seed when the new constructor
  // matches the current governor's kind, otherwise clear (a different guard
  // kind is entirely different code). The user can wipe a restored seed with
  // the Clear Argument button to author a fresh guard of the same kind.
  const pickCtor = (c: NonKeyGuardConstructor) => {
    if (c === ctor) return;
    onConstructorChange(c);
    onBodyChange(initialSeed && c === initialSeed.constructor ? initialSeed.body : "");
  };

  const handleCheck = useCallback(async () => {
    const b = body.trim();
    if (b.length === 0) return;
    setCheck({ status: "checking" });
    try {
      // Construct (don't enforce) the guard on-chain. Pact resolves the inner
      // function / capability reference and its arity at compile time, so a
      // missing or mis-shaped reference fails here without running anything.
      const res: any = await pactRead(`(${ctor} ${b})`, { tier: "T7" });
      if (res?.result?.status === "success") {
        setCheck({ status: "valid" });
      } else {
        const msg = res?.result?.error?.message ?? "Guard construction failed on chain.";
        setCheck({ status: "invalid", message: String(msg) });
      }
    } catch (e: any) {
      setCheck({ status: "invalid", message: e?.message ?? "Check failed (network or parse error)." });
    }
  }, [ctor, body]);

  const trimmed = body.trim();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {/* ── Label row ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: "9px", fontWeight: "bold", color: COLOR, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          INPUT {ROMAN[(labelIndex - 1) % 10] ?? labelIndex}
        </span>
        <span style={{ fontSize: "10px", fontFamily: "'Courier New','Lucida Console',monospace", color: "#555", fontStyle: "italic" }}>
          &lt;{varName}:guard&gt;
        </span>
      </div>

      {/* ── Constructor selector ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "4px" }}>
        {NON_KEY_CONSTRUCTORS.map((c) => (
          <button
            key={c.value}
            onClick={() => pickCtor(c.value)}
            disabled={disabled}
            title={c.value}
            style={{
              padding: "6px 2px",
              borderRadius: "8px",
              border: `1px solid ${ctor === c.value ? COLOR : "#262626"}`,
              backgroundColor: ctor === c.value ? `${COLOR}18` : "#0a0a0a",
              color: ctor === c.value ? COLOR : "#888",
              fontSize: "11px",
              fontWeight: "bold",
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* ── Body expression (CodeMirror Pact editor) ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: "9px", fontWeight: "bold", color: COLOR, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Guard Argument
          </span>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
            {/* Clear the field to author a fresh guard from scratch */}
            <button
              type="button"
              onClick={() => onBodyChange("")}
              disabled={disabled || trimmed.length === 0}
              style={{
                display: "inline-flex", alignItems: "center", gap: "4px",
                fontSize: "9px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em",
                background: "transparent", border: `1px solid ${trimmed.length === 0 ? "#262626" : "#555"}`,
                color: trimmed.length === 0 ? "#444" : "#888",
                borderRadius: "4px", padding: "2px 7px",
                cursor: disabled || trimmed.length === 0 ? "not-allowed" : "pointer",
              }}
            >
              <Trash2 style={{ width: 10, height: 10 }} />
              Clear Argument
            </button>
            {/* Optional on-chain verification */}
            <button
              type="button"
              onClick={handleCheck}
              disabled={disabled || trimmed.length === 0 || check.status === "checking"}
              style={{
                display: "inline-flex", alignItems: "center", gap: "4px",
                fontSize: "9px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em",
                background: "transparent", border: `1px solid ${trimmed.length === 0 ? "#262626" : "#3b82f6"}`,
                color: trimmed.length === 0 ? "#444" : "#3b82f6",
                borderRadius: "4px", padding: "2px 7px",
                cursor: disabled || trimmed.length === 0 || check.status === "checking" ? "not-allowed" : "pointer",
              }}
            >
              {check.status === "checking"
                ? <Loader2 style={{ width: 10, height: 10 }} className="animate-spin" />
                : <ShieldCheck style={{ width: 10, height: 10 }} />}
              Check Guard Input
            </button>
          </div>
        </div>
        <div style={{ borderRadius: "8px", border: "1px solid #262626", overflow: "hidden" }}>
          <CodeMirror
            value={body}
            onChange={(v) => onBodyChange(v)}
            editable={!disabled}
            readOnly={disabled}
            theme={pactTheme}
            extensions={CM_EXTENSIONS}
            minHeight="72px"
            maxHeight="320px"
            placeholder="(qualified.fun arg1 arg2 …)"
            basicSetup={{
              lineNumbers: false,
              foldGutter: false,
              highlightActiveLine: false,
              highlightActiveLineGutter: false,
              autocompletion: false,
              closeBrackets: true,
              bracketMatching: true,
            }}
          />
        </div>
        {/* Check result */}
        {check.status === "valid" && (
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10px", color: "#4ade80" }}>
            <CheckCircle2 style={{ width: 12, height: 12, flexShrink: 0 }} />
            Guard is valid — the referenced definition exists on chain.
          </div>
        )}
        {check.status === "invalid" && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: "6px", fontSize: "10px", color: "#c0392b", padding: "6px 8px", border: "1px solid #8b1a1a40", borderRadius: "6px", backgroundColor: "#8b1a1a10" }}>
            <AlertCircle style={{ width: 12, height: 12, flexShrink: 0, marginTop: "1px" }} />
            <span style={{ wordBreak: "break-word" }}>{check.message}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── BoolEntryInput ────────────────────────────────────────────────────────────

export interface BoolEntryInputProps {
  value: boolean;
  onChange?: (v: boolean) => void;
  variant?: "free" | "autonomous";
  labelIndex?: number;
  varName?: string;
  disabled?: boolean;
}

export function BoolEntryInput({
  value,
  onChange,
  variant = "free",
  labelIndex = 1,
  varName = "value",
  disabled,
}: BoolEntryInputProps) {
  const isAuto = variant === "autonomous";

  const labelRow = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
      <span
        className={!isAuto && !disabled ? "input-label-active" : undefined}
        style={{ fontSize: "9px", fontWeight: "bold", color: isAuto || disabled ? "#3d3d45" : "#f97316", textTransform: "uppercase", letterSpacing: "0.06em" }}
      >
        INPUT {ROMAN[(labelIndex - 1) % 10]}
      </span>
      <span style={{ fontSize: "10px", fontFamily: "'Courier New','Lucida Console',monospace", color: isAuto || disabled ? "#5a4020" : "#f97316", fontStyle: "italic", fontWeight: "bold" }}>
        &lt;{varName}:bool&gt;
      </span>
    </div>
  );

  if (!isAuto) {
    // ── Free variant: clickable toggle ──
    return (
      <div>
        {labelRow}
        <div
          role="button"
          onClick={() => !disabled && onChange?.(!value)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 14px",
            backgroundColor: "#060608",
            border: `1px solid ${value ? "#22c55e50" : "#262626"}`,
            borderRadius: "8px",
            cursor: disabled ? "not-allowed" : "pointer",
            transition: "border-color 0.15s",
            userSelect: "none",
          }}
        >
          {/* State label */}
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <span style={{
              fontSize: "13px",
              fontWeight: "bold",
              fontFamily: "'Courier New','Lucida Console',monospace",
              color: value ? "#4ade80" : "#555",
              transition: "color 0.15s",
            }}>
              {value ? "true" : "false"}
            </span>
            <span style={{ fontSize: "9px", color: "#444", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {value ? "ON" : "OFF"}
            </span>
          </div>

          {/* Toggle pill */}
          <div style={{
            position: "relative",
            width: "44px",
            height: "24px",
            borderRadius: "12px",
            backgroundColor: value ? "#22c55e" : "#262626",
            border: `1px solid ${value ? "#22c55e" : "#3a3a3a"}`,
            transition: "background-color 0.2s, border-color 0.2s",
            flexShrink: 0,
          }}>
            <div style={{
              position: "absolute",
              top: "3px",
              left: value ? "22px" : "3px",
              width: "16px",
              height: "16px",
              borderRadius: "50%",
              backgroundColor: value ? "#0a0a0a" : "#555",
              transition: "left 0.2s, background-color 0.2s",
            }} />
          </div>
        </div>
      </div>
    );
  }

  // ── Autonomous variant: locked toggle ──
  return (
    <div>
      {labelRow}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 14px",
        backgroundColor: "#0a0805",
        border: "1px dashed #ceac5f30",
        borderRadius: "8px",
        userSelect: "none",
        pointerEvents: "none",
      }}>
        {/* State label */}
        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          <span style={{
            fontSize: "13px",
            fontWeight: "bold",
            fontFamily: "'Courier New','Lucida Console',monospace",
            color: value ? "#ceac5f" : "#555",
          }}>
            {value ? "true" : "false"}
          </span>
          <span style={{ fontSize: "9px", color: "#444", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {value ? "ON" : "OFF"}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          {/* Locked pill */}
          <div style={{
            position: "relative",
            width: "44px",
            height: "24px",
            borderRadius: "12px",
            backgroundColor: value ? "#ceac5f30" : "#262626",
            border: `1px solid ${value ? "#ceac5f40" : "#3a3a3a"}`,
            flexShrink: 0,
          }}>
            <div style={{
              position: "absolute",
              top: "3px",
              left: value ? "22px" : "3px",
              width: "16px",
              height: "16px",
              borderRadius: "50%",
              backgroundColor: value ? "#ceac5f60" : "#444",
            }} />
          </div>

          {/* Divider */}
          <div style={{ width: "1px", height: "28px", backgroundColor: "#ceac5f20" }} />

          {/* Lock + SYSTEM */}
          <div style={{ display: "flex", alignItems: "center", gap: "4px", color: "#ceac5f60" }}>
            <Lock style={{ width: 12, height: 12 }} />
            <span style={{ fontSize: "9px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.08em" }}>SYSTEM</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── IntegerEntryInput ─────────────────────────────────────────────────────────

export interface IntegerEntryInputProps {
  value: number | null;
  onChange?: (v: number | null) => void;
  variant?: "free" | "autonomous";
  labelIndex?: number;
  varName?: string;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * IntegerEntryInput — single integer input (free + autonomous).
 * Free: editable number field, solid border, Copy + Paste.
 * Autonomous: locked display, dashed border, SYSTEM + Lock INSIDE field.
 */
export function IntegerEntryInput({
  value,
  onChange,
  variant = "free",
  labelIndex = 1,
  varName = "value",
  placeholder = "0",
  disabled,
}: IntegerEntryInputProps) {
  const isAuto = variant === "autonomous";
  const displayValue = value !== null && value !== undefined ? String(value) : "";

  const handleCopy = () => {
    if (displayValue) navigator.clipboard.writeText(displayValue).catch(() => {});
  };

  // Label row
  const labelRow = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
      <span
        className={!isAuto && !disabled ? "input-label-active" : undefined}
        style={{ fontSize: "9px", fontWeight: "bold", color: isAuto ? "#3d3d45" : "#f97316", textTransform: "uppercase", letterSpacing: "0.06em" }}
      >
        INPUT {ROMAN[(labelIndex - 1) % 10]}
      </span>
      <span style={{ fontSize: "10px", fontFamily: "'Courier New','Lucida Console',monospace", color: isAuto ? "#5a4020" : "#f97316", fontStyle: "italic", fontWeight: "bold" }}>
        &lt;{varName}:integer&gt;
      </span>
    </div>
  );

  if (isAuto) {
    return (
      <div>
        {labelRow}
        <div style={{ display: "flex", alignItems: "center", height: "36px", backgroundColor: "#080808", border: "1px dashed #2a2a2a", borderRadius: "8px", overflow: "hidden", cursor: "default" }}>
          <div style={{ flex: 1, padding: "0 10px", display: "flex", alignItems: "center", minWidth: 0 }}>
            <span style={{ color: "#888", fontFamily: "'Courier New','Lucida Console',monospace", fontSize: "12px", fontWeight: "bold" }}>
              {displayValue || "—"}
            </span>
          </div>
          <div style={{ width: "1px", height: "20px", backgroundColor: "#2a2a2a", flexShrink: 0 }} />
          <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "0 8px", color: "#2d2d35", userSelect: "none", flexShrink: 0 }}>
            <Lock style={{ width: 11, height: 11 }} />
            <span style={{ fontSize: "9px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.08em" }}>SYSTEM</span>
          </div>
          {displayValue && (
            <>
              <div style={{ width: "1px", height: "20px", backgroundColor: "#2a2a2a", flexShrink: 0 }} />
              <button type="button" onClick={handleCopy} title="Copy" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "32px", height: "100%", background: "transparent", border: "none", cursor: "pointer", color: "#333", flexShrink: 0 }}
                onMouseEnter={e => (e.currentTarget.style.color = "#ceac5f")} onMouseLeave={e => (e.currentTarget.style.color = "#333")}>
                <Copy style={{ width: 12, height: 12 }} />
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // Free variant
  return (
    <div>
      {labelRow}
      <div style={{ display: "flex", alignItems: "center", height: "36px", backgroundColor: "#060608", border: "1px solid #262626", borderRadius: "8px", overflow: "hidden" }}>
        <input
          type="text"
          inputMode="numeric"
          value={displayValue}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9]/g, "");
            onChange?.(raw ? parseInt(raw, 10) : null);
          }}
          placeholder={placeholder}
          disabled={disabled}
          className="ghost-input"
          style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontFamily: "'Courier New','Lucida Console',monospace", fontSize: "12px", color: "#d2d3d4", padding: "0 10px", height: "100%", minWidth: 0 }}
        />
        <div style={{ width: "1px", height: "20px", backgroundColor: "#262626", flexShrink: 0 }} />
        <button type="button" onClick={handleCopy} title="Copy" disabled={!displayValue} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "32px", height: "100%", background: "transparent", border: "none", cursor: displayValue ? "pointer" : "default", color: displayValue ? "#555" : "#333", flexShrink: 0 }}
          onMouseEnter={e => { if (displayValue) e.currentTarget.style.color = "#ceac5f"; }} onMouseLeave={e => (e.currentTarget.style.color = displayValue ? "#555" : "#333")}>
          <Copy style={{ width: 13, height: 13 }} />
        </button>
      </div>
    </div>
  );
}

// ── IntegerListEntryInput ────────────────────────────────────────────────────

export interface IntegerListEntryInputProps {
  values: number[];
  onChange?: (v: number[]) => void;
  variant?: "free" | "autonomous";
  labelIndex?: number;
  varName?: string;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * IntegerListEntryInput — integer list input (free + autonomous).
 * Free: comma-separated input, pills display.
 * Autonomous: locked pill badges inside field, SYSTEM + Lock INSIDE field.
 */
export function IntegerListEntryInput({
  values,
  onChange,
  variant = "free",
  labelIndex = 1,
  varName = "values",
  placeholder = "1, 5, 12",
  disabled,
}: IntegerListEntryInputProps) {
  const isAuto = variant === "autonomous";
  const displayStr = values.length > 0 ? `[${values.join(", ")}]` : "[]";

  // ── Hooks hoisted unconditionally (React rules: never call hooks after a conditional return) ──
  const [rawText, setRawText] = useState(values.join(", "));

  const handleCopy = () => {
    navigator.clipboard.writeText(displayStr).catch(() => {});
  };

  // Label row
  const labelRow = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
      <span
        className={!isAuto && !disabled ? "input-label-active" : undefined}
        style={{ fontSize: "9px", fontWeight: "bold", color: isAuto ? "#3d3d45" : "#f97316", textTransform: "uppercase", letterSpacing: "0.06em" }}
      >
        INPUT {ROMAN[(labelIndex - 1) % 10]}
      </span>
      <span style={{ fontSize: "10px", fontFamily: "'Courier New','Lucida Console',monospace", color: isAuto ? "#5a4020" : "#f97316", fontStyle: "italic", fontWeight: "bold" }}>
        &lt;{varName}:[integer]&gt;
      </span>
    </div>
  );

  if (isAuto) {
    return (
      <div>
        {labelRow}
        <div style={{ display: "flex", alignItems: "center", minHeight: "36px", backgroundColor: "#080808", border: "1px dashed #2a2a2a", borderRadius: "8px", overflow: "hidden", cursor: "default", flexWrap: "nowrap" }}>
          <div style={{ flex: 1, padding: "4px 10px", display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap", minWidth: 0 }}>
            {values.length === 0 ? (
              <span style={{ color: "#2a2a2a", fontFamily: "'Courier New','Lucida Console',monospace", fontSize: "11px" }}>—</span>
            ) : (
              values.map((n, i) => (
                <span key={i} style={{ display: "inline-flex", alignItems: "center", padding: "1px 6px", borderRadius: "4px", backgroundColor: "#1a1a1a", border: "1px solid #262626", color: "#888", fontFamily: "'Courier New','Lucida Console',monospace", fontSize: "11px", fontWeight: "bold", flexShrink: 0 }}>
                  {n}
                </span>
              ))
            )}
          </div>
          <div style={{ width: "1px", height: "20px", backgroundColor: "#2a2a2a", flexShrink: 0 }} />
          <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "0 8px", color: "#2d2d35", userSelect: "none", flexShrink: 0 }}>
            <Lock style={{ width: 11, height: 11 }} />
            <span style={{ fontSize: "9px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.08em" }}>SYSTEM</span>
          </div>
          {values.length > 0 && (
            <>
              <div style={{ width: "1px", height: "20px", backgroundColor: "#2a2a2a", flexShrink: 0 }} />
              <button type="button" onClick={handleCopy} title="Copy" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "32px", height: "100%", minHeight: "36px", background: "transparent", border: "none", cursor: "pointer", color: "#333", flexShrink: 0 }}
                onMouseEnter={e => (e.currentTarget.style.color = "#ceac5f")} onMouseLeave={e => (e.currentTarget.style.color = "#333")}>
                <Copy style={{ width: 12, height: 12 }} />
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // Free variant — comma or space separated text input (rawText state hoisted above)
  const handleChange = (text: string) => {
    setRawText(text);
    // Split on commas, spaces, or both
    const parsed = text.split(/[,\s]+/).map(s => s.trim()).filter(s => /^\d+$/.test(s)).map(Number);
    onChange?.(parsed);
  };

  return (
    <div>
      {labelRow}
      <div style={{ display: "flex", alignItems: "center", height: "36px", backgroundColor: "#060608", border: "1px solid #262626", borderRadius: "8px", overflow: "hidden" }}>
        <input
          type="text"
          value={rawText}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="ghost-input"
          style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontFamily: "'Courier New','Lucida Console',monospace", fontSize: "12px", color: "#d2d3d4", padding: "0 10px", height: "100%", minWidth: 0 }}
        />
        <div style={{ width: "1px", height: "20px", backgroundColor: "#262626", flexShrink: 0 }} />
        <button type="button" onClick={handleCopy} title="Copy" disabled={values.length === 0} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "32px", height: "100%", background: "transparent", border: "none", cursor: values.length > 0 ? "pointer" : "default", color: values.length > 0 ? "#555" : "#333", flexShrink: 0 }}
          onMouseEnter={e => { if (values.length > 0) e.currentTarget.style.color = "#ceac5f"; }} onMouseLeave={e => (e.currentTarget.style.color = values.length > 0 ? "#555" : "#333")}>
          <Copy style={{ width: 13, height: 13 }} />
        </button>
      </div>
      <p style={{ fontSize: "9px", color: "#444", marginTop: "3px", fontStyle: "italic" }}>
        Commas are optional — space-separated works too
      </p>
    </div>
  );
}

// ── IntegerSliderInput ───────────────────────────────────────────────────────

export interface IntegerSliderInputProps {
  varName: string;
  labelIndex: number;
  value: string;
  onChange: (v: string) => void;
  min?: number;
  max?: number;
  placeholder?: string;
  variant?: "free" | "autonomous";
}

/**
 * Integer input with synced horizontal slider.
 * Typing updates slider position; dragging slider updates input.
 */
export function IntegerSliderInput({
  varName,
  labelIndex,
  value,
  onChange,
  min = 1,
  max = 15000,
  placeholder = "1",
  variant = "free",
}: IntegerSliderInputProps) {
  const isFree = variant === "free";
  const labelColor = isFree ? "#f97316" : "#3d3d45";
  const numVal = parseInt(value) || parseInt(placeholder) || min;
  const clampedVal = Math.max(min, Math.min(max, numVal));

  return (
    <div className="space-y-1.5">
      {/* Label */}
      <div className="flex items-center gap-1.5">
        <span
          className="text-[9px] font-bold uppercase tracking-widest"
          style={{ color: labelColor }}
        >
          INPUT {ROMAN[labelIndex - 1] ?? labelIndex}
        </span>
        <span className="text-[9px]" style={{ color: "#555" }}>—</span>
        <span
          className="text-[9px] italic"
          style={{
            color: isFree ? "#f97316" : "#5a4020",
            fontWeight: isFree ? 700 : 400,
          }}
        >
          &lt;{varName}:integer&gt;
        </span>
        {isFree && (
          <span className="relative flex h-1.5 w-1.5 ml-0.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-orange-500" />
          </span>
        )}
      </div>

      {/* Number input */}
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9]/g, "");
          onChange(raw);
        }}
        placeholder={placeholder}
        className="w-full rounded-md px-3 py-2 text-xs font-mono outline-none transition-colors"
        style={{
          backgroundColor: "#0a0a0a",
          border: "1px solid #262626",
          color: value ? "#d2d3d4" : "#555",
        }}
        onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "#ceac5f"; }}
        onBlur={(e) => { (e.target as HTMLInputElement).style.borderColor = "#262626"; }}
      />

      {/* Slider */}
      <div className="relative px-1">
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={clampedVal}
          onChange={(e) => onChange(e.target.value)}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
          style={{
            background: `linear-gradient(to right, #ceac5f 0%, #ceac5f ${((clampedVal - min) / (max - min)) * 100}%, #262626 ${((clampedVal - min) / (max - min)) * 100}%, #262626 100%)`,
            accentColor: "#ceac5f",
          }}
        />
        <div className="flex justify-between mt-0.5">
          <span className="text-[8px]" style={{ color: "#555" }}>{min}</span>
          <span className="text-[8px] font-mono" style={{ color: "#ceac5f" }}>
            {value || placeholder} days
          </span>
          <span className="text-[8px]" style={{ color: "#555" }}>{max.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

// ── StringListEntryInput ──────────────────────────────────────────────────────

export interface StringListEntryInputProps {
  values: string[];
  onChange?: (v: string[]) => void;
  variant?: "free" | "autonomous";
  labelIndex?: number;
  varName?: string;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * StringListEntryInput — string list input (free + autonomous).
 * Autonomous: locked pill badges, SYSTEM + Lock, Copy button.
 * Free: comma-separated text input.
 */
export function StringListEntryInput({
  values,
  onChange,
  variant = "autonomous",
  labelIndex = 1,
  varName = "ids",
  placeholder = '"id-1", "id-2"',
  disabled,
}: StringListEntryInputProps) {
  const isAuto = variant === "autonomous";
  const displayStr = values.length > 0 ? `[${values.map(v => `"${v}"`).join(", ")}]` : "[]";

  // ── Hooks hoisted unconditionally (React rules: never call hooks after a conditional return) ──
  const [rawText, setRawText] = useState(values.join(", "));

  const handleCopy = () => {
    navigator.clipboard.writeText(displayStr).catch(() => {});
  };

  const labelRow = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
      <span
        className={!isAuto && !disabled ? "input-label-active" : undefined}
        style={{ fontSize: "9px", fontWeight: "bold", color: isAuto ? "#3d3d45" : "#f97316", textTransform: "uppercase", letterSpacing: "0.06em" }}
      >
        INPUT {ROMAN[(labelIndex - 1) % 10]}
      </span>
      <span style={{ fontSize: "10px", fontFamily: "'Courier New','Lucida Console',monospace", color: isAuto ? "#5a4020" : "#f97316", fontStyle: "italic", fontWeight: "bold" }}>
        &lt;{varName}:[string]&gt;
      </span>
    </div>
  );

  if (isAuto) {
    return (
      <div>
        {labelRow}
        <div style={{ display: "flex", alignItems: "center", minHeight: "36px", backgroundColor: "#080808", border: "1px dashed #2a2a2a", borderRadius: "8px", overflow: "hidden", cursor: "default", flexWrap: "nowrap" }}>
          <div style={{ flex: 1, padding: "4px 10px", display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap", minWidth: 0 }}>
            {values.length === 0 ? (
              <span style={{ color: "#2a2a2a", fontFamily: "'Courier New','Lucida Console',monospace", fontSize: "11px" }}>—</span>
            ) : (
              values.map((s, i) => {
                const display = s.length > 20 ? s.slice(0, 8) + "…" + s.slice(-6) : s;
                return (
                  <span key={i} title={s} style={{ display: "inline-flex", alignItems: "center", padding: "1px 6px", borderRadius: "4px", backgroundColor: "#1a1a1a", border: "1px solid #262626", color: "#888", fontFamily: "'Courier New','Lucida Console',monospace", fontSize: "10px", fontWeight: "bold", flexShrink: 0, maxWidth: "140px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {display}
                  </span>
                );
              })
            )}
          </div>
          <div style={{ width: "1px", height: "20px", backgroundColor: "#2a2a2a", flexShrink: 0 }} />
          <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "0 8px", color: "#2d2d35", userSelect: "none", flexShrink: 0 }}>
            <Lock style={{ width: 11, height: 11 }} />
            <span style={{ fontSize: "9px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.08em" }}>SYSTEM</span>
          </div>
          {values.length > 0 && (
            <>
              <div style={{ width: "1px", height: "20px", backgroundColor: "#2a2a2a", flexShrink: 0 }} />
              <button type="button" onClick={handleCopy} title="Copy" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "32px", height: "100%", minHeight: "36px", background: "transparent", border: "none", cursor: "pointer", color: "#333", flexShrink: 0 }}
                onMouseEnter={e => (e.currentTarget.style.color = "#ceac5f")} onMouseLeave={e => (e.currentTarget.style.color = "#333")}>
                <Copy style={{ width: 12, height: 12 }} />
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // Free variant (rawText state hoisted above)
  const handleChange = (text: string) => {
    setRawText(text);
    const parsed = text.split(",").map(s => s.trim()).filter(Boolean);
    onChange?.(parsed);
  };

  return (
    <div>
      {labelRow}
      <div style={{ display: "flex", alignItems: "center", height: "36px", backgroundColor: "#060608", border: "1px solid #262626", borderRadius: "8px", overflow: "hidden" }}>
        <input type="text" value={rawText} onChange={e => handleChange(e.target.value)} placeholder={placeholder} disabled={disabled}
          style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#d2d3d4", fontFamily: "'Courier New','Lucida Console',monospace", fontSize: "11px", padding: "0 10px" }} />
      </div>
    </div>
  );
}

// ── DecimalListEntryInput ─────────────────────────────────────────────────────

export interface DecimalListEntryInputProps {
  values: string[];
  onChange?: (v: string[]) => void;
  variant?: "free" | "autonomous";
  labelIndex?: number;
  varName?: string;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * DecimalListEntryInput — decimal list input (free + autonomous).
 * Autonomous: locked gold pill badges, SYSTEM + Lock, Copy button.
 * Free: comma-separated text input.
 */
export function DecimalListEntryInput({
  values,
  onChange,
  variant = "autonomous",
  labelIndex = 1,
  varName = "amounts",
  placeholder = "1.0, 5.5",
  disabled,
}: DecimalListEntryInputProps) {
  const isAuto = variant === "autonomous";
  const displayStr = values.length > 0 ? `[${values.join(", ")}]` : "[]";

  // ── Hooks hoisted unconditionally (React rules: never call hooks after a conditional return) ──
  const [rawText, setRawText] = useState(values.join(", "));

  const handleCopy = () => {
    navigator.clipboard.writeText(displayStr).catch(() => {});
  };

  const labelRow = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
      <span
        className={!isAuto && !disabled ? "input-label-active" : undefined}
        style={{ fontSize: "9px", fontWeight: "bold", color: isAuto ? "#3d3d45" : "#f97316", textTransform: "uppercase", letterSpacing: "0.06em" }}
      >
        INPUT {ROMAN[(labelIndex - 1) % 10]}
      </span>
      <span style={{ fontSize: "10px", fontFamily: "'Courier New','Lucida Console',monospace", color: isAuto ? "#5a4020" : "#f97316", fontStyle: "italic", fontWeight: "bold" }}>
        &lt;{varName}:[decimal]&gt;
      </span>
    </div>
  );

  if (isAuto) {
    return (
      <div>
        {labelRow}
        <div style={{ display: "flex", alignItems: "center", minHeight: "36px", backgroundColor: "#080808", border: "1px dashed #2a2a2a", borderRadius: "8px", overflow: "hidden", cursor: "default", flexWrap: "nowrap" }}>
          <div style={{ flex: 1, padding: "4px 10px", display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap", minWidth: 0 }}>
            {values.length === 0 ? (
              <span style={{ color: "#2a2a2a", fontFamily: "'Courier New','Lucida Console',monospace", fontSize: "11px" }}>—</span>
            ) : (
              values.map((d, i) => (
                <span key={i} style={{ display: "inline-flex", alignItems: "center", padding: "1px 6px", borderRadius: "4px", backgroundColor: "#1a1610", border: "1px solid #ceac5f30", color: "#ceac5f", fontFamily: "'Courier New','Lucida Console',monospace", fontSize: "11px", fontWeight: "bold", flexShrink: 0 }}>
                  {d}
                </span>
              ))
            )}
          </div>
          <div style={{ width: "1px", height: "20px", backgroundColor: "#2a2a2a", flexShrink: 0 }} />
          <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "0 8px", color: "#2d2d35", userSelect: "none", flexShrink: 0 }}>
            <Lock style={{ width: 11, height: 11 }} />
            <span style={{ fontSize: "9px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.08em" }}>SYSTEM</span>
          </div>
          {values.length > 0 && (
            <>
              <div style={{ width: "1px", height: "20px", backgroundColor: "#2a2a2a", flexShrink: 0 }} />
              <button type="button" onClick={handleCopy} title="Copy" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "32px", height: "100%", minHeight: "36px", background: "transparent", border: "none", cursor: "pointer", color: "#333", flexShrink: 0 }}
                onMouseEnter={e => (e.currentTarget.style.color = "#ceac5f")} onMouseLeave={e => (e.currentTarget.style.color = "#333")}>
                <Copy style={{ width: 12, height: 12 }} />
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // Free variant (rawText state hoisted above)
  const handleChange = (text: string) => {
    setRawText(text);
    const parsed = text.split(",").map(s => s.trim()).filter(s => /^\d+(\.\d+)?$/.test(s));
    onChange?.(parsed);
  };

  return (
    <div>
      {labelRow}
      <div style={{ display: "flex", alignItems: "center", height: "36px", backgroundColor: "#060608", border: "1px solid #262626", borderRadius: "8px", overflow: "hidden" }}>
        <input type="text" value={rawText} onChange={e => handleChange(e.target.value)} placeholder={placeholder} disabled={disabled}
          style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#d2d3d4", fontFamily: "'Courier New','Lucida Console',monospace", fontSize: "11px", padding: "0 10px" }} />
      </div>
    </div>
  );
}
