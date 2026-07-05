/**
 * ManualKeyInput — cloned verbatim from OuronetUI
 * `src/components/ui/ManualKeyInput.tsx`.
 *
 * Progressive private key entry for unsatisfied guards.
 *
 * Shows ONE input field. Below it, lists all foreign (not-in-Codex) keys
 * that still need a matching private key.
 * As the user types:
 *   - Derives pubkey from the input
 *   - Checks against all remaining foreign keys
 *   - On match → resolves that key, clears field
 *   - Stops showing when the guard threshold is met
 *
 * NOTE: this is the OuronetUI-shape clone (single field, derives pubkey,
 * lists candidate/resolved keys). It REPLACES the earlier package's
 * inline-styled `src/ui/zbom/ManualKeyInput.tsx` abstraction.
 */

import { useState, useCallback } from "react";
import { Input } from "./Input.js";
import { CheckCircle2, Key } from "lucide-react";
import { tryDerivePublicKey } from "@stoachain/stoa-core/guard";

interface ManualKeyInputProps {
  /** Label for this guard (e.g. "Wrapper Guard", "Patron Guard") */
  label: string;
  /** All foreign keys in this guard (not found in Codex) */
  foreignKeys: string[];
  /** Already resolved: pubkey → privkey */
  resolved: Record<string, string>;
  /** How many more keys are needed to satisfy the guard */
  neededMore: number;
  /** Called when a privkey successfully matches a foreign pubkey */
  onResolve: (pub: string, priv: string) => void;
}

export function ManualKeyInput({
  label,
  foreignKeys,
  resolved,
  neededMore,
  onResolve,
}: ManualKeyInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [lastAttempt, setLastAttempt] = useState<"idle" | "no-match">("idle");

  const unresolvedForeignKeys = foreignKeys.filter(k => !resolved[k]);

  const handleChange = useCallback(
    (val: string) => {
      setInputValue(val);
      setLastAttempt("idle");

      const derived = tryDerivePublicKey(val.trim());
      if (!derived) return;

      // Check if derived pubkey matches any unresolved foreign key
      const match = unresolvedForeignKeys.find(k => k === derived);
      if (match) {
        onResolve(match, val.trim());
        setInputValue("");
        setLastAttempt("idle");
      } else if (val.length >= 64) {
        setLastAttempt("no-match");
      }
    },
    [unresolvedForeignKeys, onResolve],
  );

  // Guard is satisfied — nothing to show
  if (neededMore <= 0) return null;

  return (
    <div className="space-y-2 p-3 rounded-lg border"
      style={{ backgroundColor: "#0a0a0a", borderColor: "#8b1a1a40" }}>

      {/* Header */}
      <div className="flex items-center gap-2">
        <Key className="h-3.5 w-3.5 flex-shrink-0" style={{ color: "#f59e0b" }} />
        <span className="text-xs font-semibold" style={{ color: "#c0392b" }}>
          {label} — {neededMore} more key{neededMore > 1 ? "s" : ""} needed
        </span>
      </div>

      {/* Explanation */}
      <p className="text-[10px] leading-relaxed" style={{ color: "#666" }}>
        Enter the private key for one of the addresses below. The public key is derived
        automatically — no need to specify which one.
      </p>

      {/* Single private key input */}
      <Input
        value={inputValue}
        onChange={e => handleChange(e.target.value)}
        placeholder="Private key (64 or 128 hex chars)"
        className="font-mono text-[10px]"
        style={{
          backgroundColor: "#080808",
          borderColor: lastAttempt === "no-match" ? "#8b1a1a" : "#262626",
          color: "#d2d3d4",
        }}
        autoComplete="off"
        spellCheck={false}
      />
      {lastAttempt === "no-match" && (
        <p className="text-[10px]" style={{ color: "#c0392b" }}>
          Key doesn't match any expected public key — try again.
        </p>
      )}

      {/* Candidate public keys — still unresolved */}
      <div className="space-y-1">
        <span className="text-[9px] uppercase tracking-wider font-bold" style={{ color: "#444" }}>
          Waiting for a key matching one of:
        </span>
        {unresolvedForeignKeys.map(pub => (
          <div key={pub} className="flex items-center gap-2">
            <Key className="h-3 w-3 flex-shrink-0" style={{ color: "#555" }} />
            <code className="text-[10px] font-mono" style={{ color: "#666" }}>
              {pub.slice(0, 16)}…{pub.slice(-8)}
            </code>
          </div>
        ))}
        {/* Already resolved in this guard */}
        {foreignKeys.filter(k => resolved[k]).map(pub => (
          <div key={pub} className="flex items-center gap-2">
            <CheckCircle2 className="h-3 w-3 flex-shrink-0" style={{ color: "#4ade80" }} />
            <code className="text-[10px] font-mono" style={{ color: "#4ade80" }}>
              {pub.slice(0, 16)}…{pub.slice(-8)}
            </code>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Payment key manual input (single, fixed target) ──────────────────────────

interface PaymentKeyInputProps {
  pubkey: string;
  resolved: Record<string, string>;
  onResolve: (pub: string, priv: string) => void;
}

export function PaymentKeyInput({ pubkey, resolved, onResolve }: PaymentKeyInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [lastAttempt, setLastAttempt] = useState<"idle" | "no-match">("idle");

  const handleChange = (val: string) => {
    setInputValue(val);
    setLastAttempt("idle");
    const derived = tryDerivePublicKey(val.trim());
    if (!derived) return;
    if (derived === pubkey) {
      onResolve(pubkey, val.trim());
      setInputValue("");
    } else if (val.length >= 64) {
      setLastAttempt("no-match");
    }
  };

  if (resolved[pubkey]) return (
    <div className="flex items-center gap-2 p-2 rounded-lg border"
      style={{ backgroundColor: "#0a0a0a", borderColor: "#22c55e30" }}>
      <CheckCircle2 className="h-4 w-4 flex-shrink-0" style={{ color: "#4ade80" }} />
      <span className="text-xs" style={{ color: "#4ade80" }}>Payment key resolved</span>
      <code className="text-[10px] font-mono ml-auto" style={{ color: "#555" }}>
        {pubkey.slice(0, 16)}…{pubkey.slice(-8)}
      </code>
    </div>
  );

  return (
    <div className="space-y-2 p-3 rounded-lg border"
      style={{ backgroundColor: "#0a0a0a", borderColor: "#8b1a1a40" }}>
      <div className="flex items-center gap-2">
        <Key className="h-3.5 w-3.5 flex-shrink-0" style={{ color: "#f59e0b" }} />
        <span className="text-xs font-semibold" style={{ color: "#c0392b" }}>
          Payment key not in Codex
        </span>
        <code className="text-[10px] font-mono ml-auto" style={{ color: "#555" }}>
          {pubkey.slice(0, 16)}…{pubkey.slice(-8)}
        </code>
      </div>
      <Input
        value={inputValue}
        onChange={e => handleChange(e.target.value)}
        placeholder="Private key for the payment address"
        className="font-mono text-[10px]"
        style={{
          backgroundColor: "#080808",
          borderColor: lastAttempt === "no-match" ? "#8b1a1a" : "#262626",
          color: "#d2d3d4",
        }}
        autoComplete="off"
        spellCheck={false}
      />
      {lastAttempt === "no-match" && (
        <p className="text-[10px]" style={{ color: "#c0392b" }}>
          Key doesn't match the payment address pubkey.
        </p>
      )}
    </div>
  );
}
