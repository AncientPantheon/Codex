/**
 * SpawnAccountModal — Redux-free port of OuronetUI's CreateOuroAccount. Spawns a
 * Standard (Ѻ./₱.) or Smart (Σ./Π.) Ouronet account into the codex store. Full
 * option surface: DALOS Genesis / APOLLO curve select (APOLLO gated on the
 * experimental-curves toggle), seven key-derivation modes (Chainweaver-12 /
 * DALOS-Custom / Koala-24 seed words + Bitmap / BitString / Base-10 / Base-49
 * direct key input), a live derived-address preview, name + password, and
 * encrypted-at-rest account creation.
 *
 * Derivation goes through `createOuronetAccount` (the same registry-mediated
 * entry point the reveal modal re-derives from), so a spawned account's
 * `secret` round-trips byte-identically through DalosSecretReveal. Encryption
 * uses `encryptStringV2`; the entered password is verified by decrypting an
 * existing account secret before anything is written (so a wrong password can
 * never mint an account whose secret can't be opened later).
 */

import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Copy, Check, Eye, EyeOff, Info, RefreshCw, Shuffle, X, Zap } from "lucide-react";
import {
  Apollo,
  createDefaultRegistry,
  createOuronetAccount,
  bitmapToAscii,
  BITMAP_ROWS,
  BITMAP_COLS,
  BITMAP_TOTAL_BITS,
  type Bitmap,
  type FullKey,
  type CreateAccountOptions,
} from "@stoachain/stoa-core/dalos";
import { encryptStringV2, smartDecrypt } from "@stoachain/stoa-core/crypto";
import { KadenaWalletBuilder } from "@stoachain/stoa-core/wallet";
import { useOuroAccounts } from "../../hooks/index.js";
import { useCodexAuth } from "../../hooks/index.js";
import { useCodex } from "../../hooks/index.js";
import { CodexModalShell } from "./CodexModalShell.js";
import { BitmapKeyInput } from "./BitmapKeyInput.js";
import type { IOuroAccount, OuroOriginMode, OuroOriginSeedTab, OuronetOriginCurve } from "../../types/entities.js";

/** Omit that distributes over a discriminated union so each member keeps its
 *  own `data` shape (a plain Omit collapses to the common keys, dropping `data`). */
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

const APOLLO_ROWS = 32, APOLLO_COLS = 32, APOLLO_BITS = 1024;
const DEFAULT_CUSTOM_SEED = "He who fears death will never do anything worthy of a man who is alive";

/** DALOS charset gate for the custom-seed textarea. */
const ALLOWED_CHARS =
  "0123456789Ѻ₿$¢€£¥₱₳∇ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÆŒÁĂÂÄÀĄÅÃĆČÇĎĐÉĚÊËÈĘĞÍÎÏÌŁŃÑÓÔÖÒØÕŘŚŠŞȘÞŤȚÚÛÜÙŮÝŸŹŽŻæœáăâäàąåãćčçďđéěêëèęğíîïìłńñóôöòøõřśšşșþťțúûüùůýÿźžżßΓΔΘΛΞΠΣΦΨΩαβγδεζηθικλμνξπρσςτφχψωБДЖЗИЙЛПУЦЧШЩЪЫЬЭЮЯбвджзийклмнптуфцчшщъыьэюя ";
const BASE49_ALPHABET_UI = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLM";

type SeedMode = "12-words" | "write-seed" | "24-words" | "bitmap" | "bitstring" | "int10" | "int49";

const SEED_TABS: { value: SeedMode; label: string; sublabel: string; description: string; color: string }[] = [
  { value: "12-words", label: "Chainweaver", sublabel: "12 words", color: "#3b82f6",
    description: "12-word mnemonic using Kadena's native Chainweaver wordlist. Compatible with Chainweaver and EckoWallet." },
  { value: "write-seed", label: "DALOS Custom", sublabel: "4–256 words", color: "#ceac5f", description: "DALOS_CUSTOM" },
  { value: "24-words", label: "Koala", sublabel: "24 words", color: "#ec4899",
    description: "24-word mnemonic using the BIP39 English wordlist (256-bit entropy). The standard Koala Wallet seed format." },
  { value: "bitmap", label: "Bitmap", sublabel: "40 × 40", color: "#22c55e",
    description: "Derive the account from a 40×40 bitmap — 1600 bits of hand-painted entropy. The same bitmap always produces the same address, so remember or export it before spawning." },
  { value: "bitstring", label: "BitString", sublabel: "1600 bits", color: "#0ea5e9",
    description: "Direct private-key input as a 1600-bit binary string. Any sequence of 0s and 1s qualifies — no curve-order rejection. The string IS your private key." },
  { value: "int10", label: "Base-10", sublabel: "integer", color: "#a855f7",
    description: "Direct private-key input as a decimal integer. Must be a valid DALOS scalar (in range) — core rejects out-of-range values inline." },
  { value: "int49", label: "Base-49", sublabel: "integer", color: "#eab308",
    description: "Direct private-key input as a base-49 DALOS integer. Must be a valid DALOS scalar — core rejects out-of-range values inline." },
];

const CURVE_META: Record<OuronetOriginCurve, { displayName: string; bits: number; standardPrefix: string; smartPrefix: string; color: string; subtitle: string }> = {
  dalos: { displayName: "DALOS Genesis", bits: 1600, standardPrefix: "Ѻ.", smartPrefix: "Σ.", color: "#ceac5f", subtitle: "1600-bit · production" },
  apollo: { displayName: "APOLLO", bits: 1024, standardPrefix: "₱.", smartPrefix: "Π.", color: "#f97316", subtitle: "1024-bit · observational" },
};

/* ── local bitmap helpers (dimension-generic; core's bitmapToAscii hardcodes 40×40) ── */
function bitmapToAsciiRows(bitmap: Bitmap, rows: number, cols: number): string {
  const out: string[] = [];
  for (let r = 0; r < rows; r++) {
    const row = bitmap[r] as unknown as (number | boolean)[] | undefined;
    let s = "";
    for (let c = 0; c < cols; c++) s += row?.[c] ? "#" : ".";
    out.push(s);
  }
  return out.join(",");
}
function bitmapToBits(bitmap: Bitmap, rows: number, cols: number): string {
  let bits = "";
  for (let r = 0; r < rows; r++) {
    const row = bitmap[r] as unknown as (number | boolean)[] | undefined;
    for (let c = 0; c < cols; c++) bits += row?.[c] ? "1" : "0";
  }
  return bits;
}
function bitmapHasAnyPixel(bitmap: Bitmap): boolean {
  for (const row of bitmap as unknown as (number | boolean)[][]) for (const cell of row) if (cell) return true;
  return false;
}

export interface SpawnAccountModalProps {
  isSmart: boolean;
  onClose: () => void;
}

export function SpawnAccountModal({ isSmart, onClose }: SpawnAccountModalProps): React.JSX.Element {
  const { accounts, addAccount } = useOuroAccounts();
  const { getCurrentPassword, authenticate } = useCodexAuth();
  const { uiSettings } = useCodex();
  const experimentalCurvesEnabled = uiSettings.experimentalCurvesEnabled === true;
  const ttl = typeof uiSettings.passwordCacheMinutes === "number" ? uiSettings.passwordCacheMinutes : undefined;

  const [curve, setCurve] = useState<OuronetOriginCurve>("dalos");
  const [active, setActive] = useState<SeedMode>("write-seed");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [mnemonic, setMnemonic] = useState<string | null>(DEFAULT_CUSTOM_SEED);
  const [bitmap, setBitmap] = useState<Bitmap | null>(null);
  const [bitString, setBitString] = useState("");
  const [int10, setInt10] = useState("");
  const [int49, setInt49] = useState("");

  const [preview, setPreview] = useState<FullKey | null>(null);
  const [derr, setDerr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [spawning, setSpawning] = useState(false);
  const [copied, setCopied] = useState(false);

  const curveMeta = CURVE_META[curve];
  // Per account-kind accent, matching the CodexID half colors: APOLLO Standard ₱.
  // = orange, APOLLO Smart Π. = vișiniu; DALOS Standard Ѻ. = gold, Smart Σ. = violet.
  const accent = curve === "apollo"
    ? (isSmart ? "#a01b3f" : CURVE_META.apollo.color)
    : (isSmart ? "#8b5cf6" : "#ceac5f");
  const accountKind = isSmart ? "Smart" : "Standard";
  const addressPrefix = curve === "apollo"
    ? (isSmart ? CURVE_META.apollo.smartPrefix : CURVE_META.apollo.standardPrefix)
    : (isSmart ? CURVE_META.dalos.smartPrefix : CURVE_META.dalos.standardPrefix);

  const bitmapRows = curve === "apollo" ? APOLLO_ROWS : BITMAP_ROWS;
  const bitmapCols = curve === "apollo" ? APOLLO_COLS : BITMAP_COLS;
  const bitstringLen = curve === "apollo" ? APOLLO_BITS : BITMAP_TOTAL_BITS;

  // Prefill password from the unlocked cache (if any).
  useEffect(() => {
    try { setPassword(getCurrentPassword()); } catch { /* locked — leave blank */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Curve flip → clear mode-specific input + preview.
  useEffect(() => {
    setBitmap(null); setBitString(""); setInt10(""); setInt49("");
    setPreview(null); setDerr(null);
  }, [curve]);

  // Tab switch → reset preview + per-mode init (mnemonic for word tabs).
  useEffect(() => {
    setPreview(null); setDerr(null);
    let cancelled = false;
    if (active === "12-words" || active === "24-words") {
      void KadenaWalletBuilder.generateMnemonic(active === "12-words" ? 12 : 24).then((m) => { if (!cancelled) setMnemonic(m); });
    } else if (active === "write-seed") {
      setMnemonic(DEFAULT_CUSTOM_SEED);
    }
    return () => { cancelled = true; };
  }, [active]);

  const deriveKey = useMemo(() => (options: DistributiveOmit<CreateAccountOptions, "primitiveId">): FullKey => {
    const registry = createDefaultRegistry();
    if (curve === "apollo") registry.register(Apollo);
    const primitiveId = curve === "apollo" ? "dalos-apollo" : "dalos-gen-1";
    return createOuronetAccount(registry, { ...options, primitiveId } as CreateAccountOptions);
  }, [curve]);

  // Debounced live preview.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        let full: FullKey | null = null;
        if (active === "12-words" || active === "24-words" || active === "write-seed") {
          if (!mnemonic) { setPreview(null); setDerr(null); return; }
          const words = mnemonic.trim().split(/\s+/).filter(Boolean);
          if (!words.length) { setPreview(null); setDerr(null); return; }
          if (words.length > 256 || words.some((w) => w.length > 256)) { setPreview(null); setDerr("Seed must be ≤256 words, each ≤256 characters."); return; }
          full = deriveKey({ mode: "seedWords", data: words });
        } else if (active === "bitmap") {
          if (!bitmap || !bitmapHasAnyPixel(bitmap)) { setPreview(null); setDerr(null); return; }
          full = curve === "apollo"
            ? deriveKey({ mode: "bitString", data: bitmapToBits(bitmap, bitmapRows, bitmapCols) })
            : deriveKey({ mode: "bitmap", data: bitmap });
        } else if (active === "bitstring") {
          if (bitString.length !== bitstringLen) {
            setPreview(null);
            setDerr(bitString.length === 0 ? null : `Need exactly ${bitstringLen} bits (have ${bitString.length}).`);
            return;
          }
          full = deriveKey({ mode: "bitString", data: bitString });
        } else if (active === "int10") {
          if (!int10) { setPreview(null); setDerr(null); return; }
          full = deriveKey({ mode: "integerBase10", data: int10 });
        } else if (active === "int49") {
          if (!int49) { setPreview(null); setDerr(null); return; }
          full = deriveKey({ mode: "integerBase49", data: int49 });
        }
        setPreview(full);
        setDerr(null);
      } catch (e) {
        setPreview(null);
        setDerr(e instanceof Error ? e.message : "Invalid input for this mode.");
      }
    }, 250);
    return () => clearTimeout(t);
  }, [active, curve, mnemonic, bitmap, bitString, int10, int49, deriveKey, bitmapRows, bitmapCols, bitstringLen]);

  const previewAddress = preview ? (isSmart ? preview.smartAddress : preview.standardAddress) : null;

  async function verifyPassword(pw: string): Promise<boolean> {
    const withSecret = accounts.find((a) => a.secret);
    if (!withSecret) return true;
    try { await smartDecrypt(withSecret.secret, pw); return true; } catch { return false; }
  }

  function randomBits(): string {
    const byteCount = Math.ceil(bitstringLen / 8);
    const buf = new Uint8Array(byteCount);
    globalThis.crypto.getRandomValues(buf);
    let bits = "";
    for (let i = 0; i < bitstringLen; i++) bits += ((buf[i >> 3]! >> (i & 7)) & 1).toString();
    return bits;
  }

  function randomizeBitString() {
    setBitString(randomBits());
  }

  // Random Base-10 / Base-49 scalar: draw a random bitstring (always a valid
  // private key — no curve-order rejection) and read back its CANONICAL integer
  // forms from the derived key. The int10/int49 of a derived FullKey are the
  // already-clamped scalar, so they round-trip through integerBase10/49 mode
  // byte-identically and are guaranteed in-range (not every arbitrary base-10/49
  // integer is a valid DALOS scalar, but one produced this way always is).
  function randomizeInt(base: 10 | 49) {
    try {
      const full = deriveKey({ mode: "bitString", data: randomBits() });
      if (base === 10) setInt10(full.privateKey.int10);
      else setInt49(full.privateKey.int49);
      setDerr(null);
    } catch (e) {
      setDerr(e instanceof Error ? e.message : "Could not generate a random scalar.");
    }
  }

  function secretPlaintextFor(): string {
    switch (active) {
      case "bitmap":
        if (!bitmap) return "";
        return curve === "apollo" ? bitmapToAsciiRows(bitmap, bitmapRows, bitmapCols) : String(bitmapToAscii(bitmap));
      case "bitstring": return bitString;
      case "int10": return int10;
      case "int49": return int49;
      default: return mnemonic ?? "";
    }
  }

  function originModeFor(): OuroOriginMode {
    switch (active) {
      case "bitmap": return "bitmap";
      case "bitstring": return "bitString";
      case "int10": return "integerBase10";
      case "int49": return "integerBase49";
      default: return "seedWords";
    }
  }

  async function handleSpawn() {
    setNotice(null);
    if (!preview || !previewAddress) { setNotice("Account preview not ready yet."); return; }
    if (derr) { setNotice(derr); return; }
    if (!name.trim()) { setNotice("Please enter a name for your account."); return; }
    if (!password) { setNotice("Please enter your codex password."); return; }

    setSpawning(true);
    try {
      const ok = await verifyPassword(password);
      if (!ok) { setNotice("Incorrect password."); setSpawning(false); return; }
      authenticate(password, ttl); // cache + unlock for the rest of the session

      const originSeedTab: OuroOriginSeedTab | undefined =
        active === "12-words" || active === "24-words" || active === "write-seed" ? active : undefined;

      const account: IOuroAccount = {
        id: globalThis.crypto.randomUUID(),
        version: curve === "apollo" ? "1.2" : "2",
        name: name.trim(),
        isSmart,
        address: previewAddress,
        guard: null,
        kadenaLedger: null,
        publicKey: preview.keyPair.publ,
        secret: await encryptStringV2(secretPlaintextFor(), password),
        backup: await encryptStringV2(preview.keyPair.priv, password),
        isActive: false,
        originMode: originModeFor(),
        originSeedTab,
        originCurve: curve,
      };
      await addAccount(account);
      onClose();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Failed to spawn account.");
      setSpawning(false);
    }
  }

  const activeSeedTab = SEED_TABS.find((t) => t.value === active)!;
  const canSpawn = !spawning && !!preview && !!name.trim();

  /* ── styles ── */
  const card = (border: string, bg: string): React.CSSProperties => ({ borderRadius: 10, border: `1px solid ${border}`, backgroundColor: bg });
  const textareaStyle: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: 12, borderRadius: 8, outline: "none", resize: "none",
    backgroundColor: "#18181B", border: "1px solid #262626", color: "#d2d3d4",
    fontFamily: "var(--codex-font-mono, ui-monospace, monospace)", fontSize: 13, lineHeight: 1.6,
  };
  const fieldInput: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 8, outline: "none",
    backgroundColor: "#0a0a0a", border: "1px solid #262626", color: "#d2d3d4", fontSize: 13,
  };
  const warnBanner = (color: string): React.CSSProperties => ({
    display: "flex", alignItems: "flex-start", gap: 8, marginTop: 8, padding: "8px 10px",
    borderRadius: 8, backgroundColor: color + "08", border: `1px solid ${color}30`,
  });

  function SeedDisplay({ words, color }: { words: string[]; color: string }) {
    if (!words.length) {
      return (
        <div style={{ ...card(color + "20", color + "05"), display: "flex", alignItems: "center", justifyContent: "center", height: 90 }}>
          <span style={{ fontSize: 12, color: "#555" }}>Generating…</span>
        </div>
      );
    }
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, padding: 12, ...card(color + "20", color + "05") }}>
        {words.map((w, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 8px", borderRadius: 6, border: `1px solid ${color}30`, backgroundColor: color + "08" }}>
            <span style={{ fontSize: 10, flexShrink: 0, color: color + "99" }}>{i + 1}.</span>
            <span style={{ fontFamily: "var(--codex-font-mono, monospace)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#d2d3d4" }}>{w}</span>
          </div>
        ))}
      </div>
    );
  }

  function tabButton(tab: typeof SEED_TABS[number]) {
    const on = active === tab.value;
    return (
      <button
        key={tab.value}
        type="button"
        onClick={() => setActive(tab.value)}
        style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          padding: "8px 4px", borderRadius: 6, border: "none", cursor: "pointer",
          backgroundColor: on ? tab.color + "22" : "transparent",
          borderBottom: on ? `2px solid ${tab.color}` : "2px solid transparent",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: on ? tab.color : "#888" }}>{tab.label}</span>
        <span style={{ fontSize: 10, color: "#555" }}>
          {tab.value === "bitmap" ? `${bitmapRows} × ${bitmapCols}` : tab.value === "bitstring" ? `${bitstringLen} bits` : tab.sublabel}
        </span>
      </button>
    );
  }

  return (
    <CodexModalShell
      title={`Spawn ${accountKind} Ouronet Account`}
      accent={accent}
      maxWidth={920}
      subtitle={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: 9999, fontWeight: 700, fontSize: 11, color: accent, backgroundColor: accent + "20" }}>{addressPrefix.charAt(0)}</span>
          {curve === "apollo"
            ? "OBSERVATIONAL — APOLLO accounts cannot be activated on StoaChain™."
            : isSmart ? "Adds a new Σ. Smart account — activate on-chain with a sovereign separately."
            : "Adds a new Ѻ. Standard account — activate on-chain separately."}
        </span>
      }
      onClose={onClose}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* ── Curve badge / selector ── */}
        {!experimentalCurvesEnabled ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", ...card(CURVE_META.dalos.color + "30", CURVE_META.dalos.color + "08") }}>
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: 9999, fontWeight: 700, fontSize: 13, color: CURVE_META.dalos.color, backgroundColor: CURVE_META.dalos.color + "20" }}>Ѻ</span>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#d2d3d4" }}>{CURVE_META.dalos.displayName}</span>
              <span style={{ fontSize: 10, color: "#555" }}>{CURVE_META.dalos.subtitle}</span>
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {(["dalos", "apollo"] as const).map((c) => {
              const m = CURVE_META[c];
              const selected = curve === c;
              return (
                <button key={c} type="button" onClick={() => setCurve(c)}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", textAlign: "left", cursor: "pointer", ...card(selected ? m.color : "#262626", selected ? m.color + "15" : "#0a0a0a") }}>
                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, flexShrink: 0, borderRadius: 9999, fontWeight: 700, fontSize: 13, color: m.color, backgroundColor: m.color + (selected ? "20" : "10") }}>{m.standardPrefix.charAt(0)}</span>
                  <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: selected ? m.color : "#888" }}>
                      {m.displayName}{c === "apollo" && <AlertTriangle style={{ width: 12, height: 12, display: "inline", marginLeft: 4, verticalAlign: "middle", color: m.color }} />}
                    </span>
                    <span style={{ fontSize: 10, color: "#555" }}>{m.subtitle}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
        {curve === "apollo" && (
          <div style={warnBanner(CURVE_META.apollo.color)}>
            <AlertTriangle style={{ width: 14, height: 14, flexShrink: 0, marginTop: 2, color: CURVE_META.apollo.color }} />
            <p style={{ margin: 0, fontSize: 11, lineHeight: 1.5, color: "#f0a978" }}>
              <strong>APOLLO is observational.</strong> The spawned account appears in your codex but <strong>cannot be activated or used to sign</strong> — StoaChain™ recognises DALOS Genesis (Ѻ./Σ.) prefixes only.
            </p>
          </div>
        )}

        {/* ── Seed-mode tabs ── */}
        <div>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#555", marginBottom: 4 }}>From seed words</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4, padding: 4, borderRadius: 8, backgroundColor: "#18181B" }}>
            {SEED_TABS.filter((t) => ["12-words", "write-seed", "24-words"].includes(t.value)).map(tabButton)}
          </div>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#555", margin: "12px 0 4px" }}>Direct key input</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4, padding: 4, borderRadius: 8, backgroundColor: "#18181B" }}>
            {SEED_TABS.filter((t) => ["bitmap", "bitstring", "int10", "int49"].includes(t.value)).map(tabButton)}
          </div>
        </div>

        {/* ── Mode description ── */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: 8, backgroundColor: "#18181B" }}>
          <Info style={{ width: 14, height: 14, flexShrink: 0, marginTop: 2, color: activeSeedTab.color }} />
          {activeSeedTab.value === "write-seed" ? (
            <div style={{ fontSize: 11, lineHeight: 1.6, color: "#888" }}>
              Custom DALOS seed — <strong style={{ color: "#d2d3d4" }}>4–256 words</strong>, each <strong style={{ color: "#d2d3d4" }}>1–256 characters</strong>, from the <strong style={{ color: "#d2d3d4" }}>256 supported character types</strong> (digits, currencies, Latin, Greek, Cyrillic). Up to <strong style={{ color: curveMeta.color }}>2^{curveMeta.bits}</strong> unique accounts.
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 11, lineHeight: 1.6, color: "#888" }}>{activeSeedTab.description}</p>
          )}
        </div>

        {/* ── Mode input ── */}
        <div>
          {(active === "12-words" || active === "24-words") && (
            <SeedDisplay words={(mnemonic ?? "").split(/\s+/).filter(Boolean)} color={activeSeedTab.color} />
          )}

          {active === "write-seed" && (
            <>
              <textarea
                style={{ ...textareaStyle, minHeight: 80 }}
                placeholder="Write your DALOS custom seed (4–256 words from the DALOS charset)…"
                value={mnemonic ?? ""}
                onChange={(e) => {
                  const filtered = e.target.value.split("").filter((c) => ALLOWED_CHARS.includes(c)).join("");
                  const words = filtered.trim().split(/\s+/).filter(Boolean);
                  if (words.length > 256 || words.some((w) => w.length > 256)) return;
                  setMnemonic(filtered);
                }}
              />
              <div style={warnBanner("#8b1a1a")}>
                <AlertTriangle style={{ width: 14, height: 14, flexShrink: 0, marginTop: 2, color: "#c0392b" }} />
                <p style={{ margin: 0, fontSize: 11, lineHeight: 1.5, color: "#c0392b" }}>
                  <strong>Custom seed — your responsibility.</strong> No dictionary restriction: every word is allowed. A single misspelling produces a completely different address.
                </p>
              </div>
            </>
          )}

          {active === "bitmap" && (
            <>
              <BitmapKeyInput onChange={setBitmap} rows={bitmapRows} cols={bitmapCols} dimensionsLabel={`${bitmapRows} × ${bitmapCols} ${curve === "apollo" ? "APOLLO" : "DALOS"} bitmap`} />
              <div style={warnBanner("#8b1a1a")}>
                <AlertTriangle style={{ width: 14, height: 14, flexShrink: 0, marginTop: 2, color: "#c0392b" }} />
                <p style={{ margin: 0, fontSize: 11, lineHeight: 1.5, color: "#c0392b" }}>
                  <strong>Bitmap is your private key.</strong> The exact pattern determines the address. Export or memorise it before spawning.
                </p>
              </div>
            </>
          )}

          {active === "bitstring" && (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: "#888" }}>
                  <strong style={{ color: bitString.length === bitstringLen ? "#0ea5e9" : "#ceac5f" }}>{bitString.length}</strong>
                  <span style={{ color: "#555" }}> / {bitstringLen} bits</span>
                </span>
                <button type="button" onClick={randomizeBitString} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer", border: "1px solid #262626", background: "transparent", color: "#0ea5e9" }}>
                  <Shuffle style={{ width: 12, height: 12 }} /> Random {bitstringLen} bits
                </button>
              </div>
              <textarea
                style={{ ...textareaStyle, minHeight: 120, wordBreak: "break-all", fontSize: 12 }}
                placeholder={`Paste or type exactly ${bitstringLen} bits (0s and 1s)…`}
                value={bitString}
                onChange={(e) => setBitString(e.target.value.replace(/[^01]/g, "").slice(0, bitstringLen))}
              />
            </>
          )}

          {active === "int10" && (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginBottom: 6 }}>
                <button type="button" onClick={() => randomizeInt(10)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer", border: "1px solid #262626", background: "transparent", color: "#a855f7" }}>
                  <Shuffle style={{ width: 12, height: 12 }} /> Random Base-10 Scalar
                </button>
              </div>
              <textarea
                style={{ ...textareaStyle, minHeight: 80, wordBreak: "break-all" }}
                placeholder="Enter a decimal integer (digits 0–9 only)…"
                value={int10}
                onChange={(e) => setInt10(e.target.value.replace(/[^0-9]/g, ""))}
              />
            </>
          )}

          {active === "int49" && (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginBottom: 6 }}>
                <button type="button" onClick={() => randomizeInt(49)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer", border: "1px solid #262626", background: "transparent", color: "#eab308" }}>
                  <Shuffle style={{ width: 12, height: 12 }} /> Random Base-49 Scalar
                </button>
              </div>
              <textarea
                style={{ ...textareaStyle, minHeight: 80, wordBreak: "break-all" }}
                placeholder={`Enter a base-49 integer. Alphabet: ${BASE49_ALPHABET_UI}`}
                value={int49}
                onChange={(e) => setInt49(e.target.value.split("").filter((c) => BASE49_ALPHABET_UI.includes(c)).join(""))}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                <code style={{ fontSize: 10, fontFamily: "var(--codex-font-mono, monospace)", padding: "4px 8px", borderRadius: 6, backgroundColor: "#18181B", color: "#eab308" }}>{BASE49_ALPHABET_UI}</code>
                <span style={{ fontSize: 10, color: "#555" }}>49-char alphabet</span>
              </div>
            </>
          )}

          {derr && (
            <div style={warnBanner("#8b1a1a")}>
              <AlertTriangle style={{ width: 14, height: 14, flexShrink: 0, marginTop: 2, color: "#c0392b" }} />
              <p style={{ margin: 0, fontSize: 11, lineHeight: 1.5, color: "#c0392b" }}>{derr}</p>
            </div>
          )}
        </div>

        {/* ── Copy seed / Generate new (word tabs only) ── */}
        {(active === "12-words" || active === "write-seed" || active === "24-words") && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button type="button" onClick={() => { if (mnemonic) { navigator.clipboard.writeText(mnemonic).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1200); } }}
              disabled={!mnemonic}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, fontSize: 12, cursor: "pointer", border: "1px solid #262626", background: "transparent", color: copied ? "#4ade80" : "#d2d3d4", opacity: mnemonic ? 1 : 0.4 }}>
              {copied ? <Check style={{ width: 14, height: 14 }} /> : <Copy style={{ width: 14, height: 14 }} />}{copied ? "Copied" : "Copy Seed"}
            </button>
            {active !== "write-seed" && (
              <button type="button" onClick={() => void KadenaWalletBuilder.generateMnemonic(active === "12-words" ? 12 : 24).then(setMnemonic)}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, fontSize: 12, cursor: "pointer", border: "1px solid #262626", background: "transparent", color: "#d2d3d4" }}>
                <RefreshCw style={{ width: 14, height: 14 }} /> Generate New
              </button>
            )}
            {active === "write-seed" && mnemonic && (
              <button type="button" onClick={() => setMnemonic("")}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, fontSize: 12, cursor: "pointer", border: "1px solid #8b1a1a40", background: "transparent", color: "#c0392b" }}>
                <X style={{ width: 14, height: 14 }} /> Clear
              </button>
            )}
          </div>
        )}

        {/* ── Preview ── */}
        {previewAddress && (
          <div style={{ position: "relative", padding: 12, ...card("#262626", "#0a0a0a") }}>
            <p style={{ margin: "0 0 4px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#555" }}>Derived {accountKind} {curveMeta.displayName} Address</p>
            <code style={{ fontFamily: "var(--codex-font-mono, monospace)", fontSize: 12, wordBreak: "break-all", color: accent }}>{previewAddress}</code>
          </div>
        )}

        {/* ── Name + password ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 14, ...card("#262626", "#18181B") }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "#888" }}>Account Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="My Ouronet Account…" style={fieldInput} />
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

        {/* ── Actions ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, borderTop: "1px solid #262626", paddingTop: 14 }}>
          <button type="button" onClick={onClose} style={{ padding: "10px 16px", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer", border: "1px solid #262626", background: "transparent", color: "#888" }}>Cancel</button>
          <button type="button" onClick={handleSpawn} disabled={!canSpawn}
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700, border: "none",
              backgroundColor: canSpawn ? accent : "#262626", color: canSpawn ? "#0a0a0a" : "#555", cursor: canSpawn ? "pointer" : "not-allowed" }}>
            <Zap style={{ width: 16, height: 16 }} />
            {spawning ? "Spawning…" : `Spawn ${accountKind} ${curve === "apollo" ? "APOLLO " : ""}Account`}
          </button>
        </div>
      </div>
    </CodexModalShell>
  );
}

export default SpawnAccountModal;
