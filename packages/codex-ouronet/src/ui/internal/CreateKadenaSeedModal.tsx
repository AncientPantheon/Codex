/**
 * CreateKadenaSeedModal — Redux-free port of OuronetUI's `CreateKadenaSeed`
 * ("Add Seed to Codex"). Generates (or restores) a BIP39/Chainweaver mnemonic,
 * shows a live Key #0 preview, and writes an `IKadenaSeed` into the codex store
 * with Key #0 + Key #1 auto-derived.
 *
 * Derivation + encryption mirror SpawnAccountModal exactly:
 *   - `KadenaWalletBuilder.generateMnemonic(12|24)` / `createWalletPairFromMnemonic`
 *     from `@stoachain/stoa-core/wallet` (routes by seedType).
 *   - The entered password is verified by decrypting an existing seed/account
 *     secret before anything is written; the mnemonic is stored as
 *     `encryptStringV2(...)` (smartDecrypt-compatible). Plaintext is never stored.
 */

import * as React from "react";
import { useEffect, useState } from "react";
import { Check, Copy, Eye, EyeOff, RefreshCw, BookKey } from "lucide-react";
import { KadenaWalletBuilder } from "@stoachain/stoa-core/wallet";
import { encryptStringV2, smartDecrypt } from "@stoachain/stoa-core/crypto";
import { useKadenaSeeds } from "../../hooks/index.js";
import { useCodexAuth } from "../../hooks/index.js";
import { useCodex } from "../../hooks/index.js";
import { CodexModalShell } from "./CodexModalShell.js";
import type { IKadenaSeed, SeedType, WalletAccount } from "../../types/entities.js";

type Mode = "generate" | "restore";

const SEED_TYPE_OPTIONS: { value: SeedType; label: string; words: 12 | 24; color: string; desc: string }[] = [
  { value: "koala", label: "Koala", words: 24, color: "#ec4899", desc: "24-word BIP39 mnemonic (256-bit entropy). Standard Koala Wallet seed." },
  { value: "chainweaver", label: "Chainweaver", words: 12, color: "#3b82f6", desc: "12-word Kadena Chainweaver mnemonic." },
  { value: "eckowallet", label: "EckoWallet", words: 12, color: "#f97316", desc: "12-word mnemonic — same derivation as Chainweaver." },
];

/** Restore-textarea charset gate (digits, letters, space). */
const ALLOWED = /[^0-9A-Za-z ]/g;
const ALLOWED_PREFIXED_PATH = (i: number) => `m'/44'/626'/${i}'`;

export interface CreateKadenaSeedModalProps {
  onClose: () => void;
}

export function CreateKadenaSeedModal({ onClose }: CreateKadenaSeedModalProps): React.JSX.Element {
  const { seeds, addSeed } = useKadenaSeeds();
  const { getCurrentPassword, authenticate } = useCodexAuth();
  const { uiSettings } = useCodex();
  const ttl = typeof uiSettings.passwordCacheMinutes === "number" ? uiSettings.passwordCacheMinutes : undefined;

  const [mode, setMode] = useState<Mode>("generate");
  const [seedType, setSeedType] = useState<SeedType>("koala");
  const [mnemonic, setMnemonic] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const option = SEED_TYPE_OPTIONS.find((o) => o.value === seedType)!;
  const accent = option.color;

  // Prefill the password from the unlocked cache (if any).
  useEffect(() => {
    try { setPassword(getCurrentPassword()); } catch { /* locked — leave blank */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const genMnemonic = (type: SeedType) => {
    const opt = SEED_TYPE_OPTIONS.find((o) => o.value === type)!;
    void KadenaWalletBuilder.generateMnemonic(opt.words).then(setMnemonic);
  };

  // On open + on every seed-type change, regenerate (generate mode only).
  useEffect(() => {
    if (mode === "generate") genMnemonic(seedType);
    else setMnemonic("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedType, mode]);

  // Live Key #0 preview — derives deterministically from mnemonic + seedType
  // (password irrelevant to the public key; pass "").
  useEffect(() => {
    let cancelled = false;
    const words = mnemonic.trim().split(/\s+/).filter(Boolean);
    if (words.length !== option.words) { setPreviewKey(null); return; }
    KadenaWalletBuilder.createWalletPairFromMnemonic("", mnemonic.trim(), 0, seedType)
      .then((kp) => { if (!cancelled) setPreviewKey(kp.publicKey); })
      .catch(() => { if (!cancelled) setPreviewKey(null); });
    return () => { cancelled = true; };
  }, [mnemonic, seedType, option.words]);

  const words = mnemonic.trim().split(/\s+/).filter(Boolean);

  async function verifyPassword(pw: string): Promise<boolean> {
    const withSecret =
      seeds.find((s) => s.secret) as { secret?: string } | undefined;
    if (!withSecret?.secret) return true; // first seed — nothing to verify against
    try { await smartDecrypt(withSecret.secret, pw); return true; } catch { return false; }
  }

  async function handleSubmit() {
    setNotice(null);
    if (!mnemonic.trim()) { setNotice("Enter or generate a seed phrase."); return; }
    if (words.length !== option.words) { setNotice(`This seed type needs exactly ${option.words} words (have ${words.length}).`); return; }
    if (!previewKey) { setNotice("Seed phrase is invalid for this seed type."); return; }
    if (!name.trim()) { setNotice("Please enter a name for this seed."); return; }
    if (!password) { setNotice("Please enter your codex password."); return; }

    setSubmitting(true);
    try {
      const ok = await verifyPassword(password);
      if (!ok) { setNotice("Incorrect password."); setSubmitting(false); return; }
      authenticate(password, ttl);

      // Auto-derive Key #0 and Key #1.
      const accounts: WalletAccount[] = [];
      for (const idx of [0, 1]) {
        const kp = await KadenaWalletBuilder.createWalletPairFromMnemonic(password, mnemonic.trim(), idx, seedType);
        accounts.push({ index: idx, publicKey: kp.publicKey, derivationPath: ALLOWED_PREFIXED_PATH(idx) });
      }

      const seed: IKadenaSeed = {
        id: globalThis.crypto.randomUUID(),
        version: "1.0",
        name: name.trim(),
        index: 0,
        secret: await encryptStringV2(mnemonic.trim(), password),
        seedType,
        main: accounts[0]!.publicKey,
        createdAt: new Date().toISOString(),
        accounts,
      };
      await addSeed(seed);
      onClose();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Failed to add seed.");
      setSubmitting(false);
    }
  }

  /* ── styles ── */
  const fieldInput: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 8, outline: "none",
    backgroundColor: "#0a0a0a", border: "1px solid #262626", color: "#d2d3d4", fontSize: 13,
  };

  return (
    <CodexModalShell title="Add Seed to Codex" accent={accent} maxWidth={480} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Mode toggle */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, padding: 4, borderRadius: 8, backgroundColor: "#18181B" }}>
          {(["generate", "restore"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)}
              style={{ padding: "8px 4px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600,
                backgroundColor: mode === m ? accent + "22" : "transparent",
                color: mode === m ? accent : "#888" }}>
              {m === "generate" ? "Generate New" : "Restore Existing"}
            </button>
          ))}
        </div>

        {/* Seed type */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4, padding: 4, borderRadius: 8, backgroundColor: "#18181B" }}>
          {SEED_TYPE_OPTIONS.map((o) => {
            const on = seedType === o.value;
            return (
              <button key={o.value} type="button" onClick={() => setSeedType(o.value)}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 4px", borderRadius: 6, border: "none", cursor: "pointer",
                  backgroundColor: on ? o.color + "22" : "transparent", borderBottom: on ? `2px solid ${o.color}` : "2px solid transparent" }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: on ? o.color : "#888" }}>{o.label}</span>
                <span style={{ fontSize: 10, color: "#555" }}>{o.words} words</span>
              </button>
            );
          })}
        </div>
        <p style={{ margin: 0, fontSize: 11, color: "#888", lineHeight: 1.5 }}>{option.desc}</p>

        {/* Generate: word grid */}
        {mode === "generate" && (
          <>
            {words.length ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, padding: 12, borderRadius: 10, border: `1px solid ${accent}20`, backgroundColor: accent + "05" }}>
                {words.map((w, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 8px", borderRadius: 6, border: `1px solid ${accent}30`, backgroundColor: accent + "08" }}>
                    <span style={{ fontSize: 10, flexShrink: 0, color: accent + "99" }}>{i + 1}.</span>
                    <span style={{ fontFamily: "var(--codex-font-mono, monospace)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#d2d3d4" }}>{w}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 80, borderRadius: 10, border: `1px solid ${accent}20`, backgroundColor: accent + "05", color: "#555", fontSize: 12 }}>Generating…</div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button type="button" onClick={() => { if (mnemonic) { navigator.clipboard.writeText(mnemonic).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1200); } }}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, fontSize: 12, cursor: "pointer", border: "1px solid #262626", background: "transparent", color: copied ? "#4ade80" : "#d2d3d4" }}>
                {copied ? <Check style={{ width: 14, height: 14 }} /> : <Copy style={{ width: 14, height: 14 }} />}{copied ? "Copied" : "Copy"}
              </button>
              <button type="button" onClick={() => genMnemonic(seedType)}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, fontSize: 12, cursor: "pointer", border: "1px solid #262626", background: "transparent", color: "#d2d3d4" }}>
                <RefreshCw style={{ width: 14, height: 14 }} /> New
              </button>
            </div>
            <p style={{ margin: 0, fontSize: 11, color: "#c0392b" }}>⚠ Write these words down. Anyone with them controls the keys.</p>
          </>
        )}

        {/* Restore: textarea */}
        {mode === "restore" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <textarea
              placeholder={`Enter your ${option.words}-word seed phrase…`}
              value={mnemonic}
              onChange={(e) => setMnemonic(e.target.value.replace(ALLOWED, ""))}
              style={{ width: "100%", boxSizing: "border-box", minHeight: 80, padding: 12, borderRadius: 8, outline: "none", resize: "none", backgroundColor: "#18181B", border: "1px solid #262626", color: "#d2d3d4", fontFamily: "var(--codex-font-mono, monospace)", fontSize: 13, lineHeight: 1.6 }}
            />
            <span style={{ fontSize: 11, color: words.length === option.words ? "#4ade80" : "#888" }}>{words.length} / {option.words} words</span>
          </div>
        )}

        {/* Key #0 preview */}
        {previewKey && (
          <div style={{ padding: 12, borderRadius: 10, border: "1px solid #262626", backgroundColor: "#0a0a0a" }}>
            <p style={{ margin: "0 0 4px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#555" }}>Key #0 preview</p>
            <code style={{ fontFamily: "var(--codex-font-mono, monospace)", fontSize: 12, wordBreak: "break-all", color: accent }}>k:{previewKey}</code>
          </div>
        )}

        {/* Name + password */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 14, borderRadius: 10, border: "1px solid #262626", backgroundColor: "#18181B" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "#888" }}>Seed Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="My Seed…" style={fieldInput} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "#888" }}>Codex Password</label>
            <div style={{ position: "relative" }}>
              <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password…" style={{ ...fieldInput, paddingRight: 40 }} />
              <button type="button" onClick={() => setShowPassword((s) => !s)} aria-label={showPassword ? "Hide password" : "Show password"}
                style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#71717a", cursor: "pointer", display: "inline-flex", padding: 2 }}>
                {showPassword ? <EyeOff style={{ width: 16, height: 16 }} /> : <Eye style={{ width: 16, height: 16 }} />}
              </button>
            </div>
          </div>
        </div>

        {notice && (
          <p role="alert" style={{ margin: 0, padding: "8px 12px", borderRadius: 8, fontSize: 12, backgroundColor: "#8b1a1a15", border: "1px solid #8b1a1a40", color: "#f87171" }}>{notice}</p>
        )}

        {/* Actions */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, borderTop: "1px solid #262626", paddingTop: 14 }}>
          <button type="button" onClick={onClose} style={{ padding: "10px 16px", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer", border: "1px solid #262626", background: "transparent", color: "#888" }}>Cancel</button>
          <button type="button" onClick={() => void handleSubmit()} disabled={submitting || !previewKey || !name.trim()}
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700, border: "none",
              backgroundColor: !submitting && previewKey && name.trim() ? accent : "#262626", color: !submitting && previewKey && name.trim() ? "#0a0a0a" : "#555", cursor: !submitting && previewKey && name.trim() ? "pointer" : "not-allowed" }}>
            <BookKey style={{ width: 16, height: 16 }} />
            {submitting ? "Adding…" : "Add Seed"}
          </button>
        </div>
      </div>
    </CodexModalShell>
  );
}

export default CreateKadenaSeedModal;
