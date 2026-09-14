/**
 * CreateStoaChainSeedModal — Redux-free port of OuronetUI's `CreateStoaChainSeed`
 * ("Add Seed to Codex"). Generates (or restores) a BIP39/Chainweaver mnemonic,
 * shows a live Key #0 preview, and writes an `IStoaChainSeed` into the codex store
 * with Key #0 + Key #1 auto-derived.
 *
 * Derivation + encryption mirror SpawnAccountModal exactly:
 *   - `StoaChainWalletBuilder.generateMnemonic(12|24)` / `createWalletPairFromMnemonic`
 *     from `@stoachain/stoa-core/wallet` (routes by seedType).
 *   - The entered password is verified by decrypting an existing seed/account
 *     secret before anything is written; the mnemonic is stored as
 *     `encryptStringV2(...)` (smartDecrypt-compatible). Plaintext is never stored.
 *
 * A FOURTH option, "Stoa Dalos" (internal `SeedType` literal `"stoic"`), is
 * structurally different from the other three: it has NO 12/24-word BIP39
 * mnemonic generate/restore UI at all. It offers its own two-way sub-mode
 * toggle instead (`StoicSubMode`, mirroring the `Mode` toggle above but for
 * DALOS words rather than BIP39):
 *
 *   - `"existing"` — reuse an existing `dalos`-curve Ouronet account's own
 *     seed material (decrypted the exact same way `ViewSeedModal.tsx` does:
 *     `smartDecrypt(account.secret, password)`), converted to the 1600-bit
 *     DALOS bitstring. Restricted to accounts whose `originMode ===
 *     "seedWords"` ONLY — see `isStoicEligible`'s doc for why a
 *     `bitString`-origin account is not a valid source here even though its
 *     underlying bitstring is technically usable.
 *   - `"new"` — the user types brand-new DALOS seed words dedicated to this
 *     Chainweb account, not tied to any existing Ouronet account. Validated
 *     via `validateTypedSeedWords` (`../../wallet/stoaDalosKeygen.js`,
 *     a thin adapter over `@ouronet/dalos-crypto/gen1`'s own canonical
 *     `validateSeedWords`) before being run through `seedWordsToBitString`.
 *
 * Both sub-modes converge on the same 1600-bit DALOS bitstring, and
 * everything downstream of "we have a valid bitstring" — Key #0/#1
 * derivation via `deriveStoaDalosKeypairAtIndex` (a direct, real,
 * already-published `@ouronet/dalos-crypto/chainweb` call — no bridge
 * needed, see `../../wallet/stoaDalosKeygen.js`) and `IStoaChainSeed`
 * persistence — is the single shared `finalizeStoicSeed` path below, not
 * duplicated per sub-mode.
 */

import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Eye, EyeOff, RefreshCw, BookKey } from "lucide-react";
import { KadenaWalletBuilder as StoaChainWalletBuilder } from "@stoachain/stoa-core/wallet";
import { encryptStringV2, smartDecrypt } from "@stoachain/stoa-core/crypto";
import { seedWordsToBitString } from "@ouronet/dalos-crypto/gen1";
import { useStoaChainSeeds } from "../../hooks/index.js";
import { useOuroAccounts } from "../../hooks/index.js";
import { useCodexAuth } from "../../hooks/index.js";
import { useCodex } from "../../hooks/index.js";
import { CodexModalShell } from "./CodexModalShell.js";
import { detectOriginCurve } from "./originCurve.js";
import {
  deriveStoaDalosKeypairAtIndex,
  validateTypedSeedWords,
  MIN_SEED_WORDS,
  MAX_SEED_WORDS,
  MIN_SEED_WORD_GLYPHS,
  MAX_SEED_WORD_GLYPHS,
} from "../../wallet/stoaDalosKeygen.js";
import type { IStoaChainSeed, IOuroAccount, OuroOriginMode, SeedType, WalletAccount } from "../../types/entities.js";

type Mode = "generate" | "restore";

/** Stoic's own two-way toggle, parallel to `Mode` above but for DALOS words
 *  instead of a BIP39 mnemonic: `"existing"` reuses an already-stored
 *  Ouronet account's seed words, `"new"` lets the user type brand-new DALOS
 *  seed words dedicated to this Chainweb account only. */
type StoicSubMode = "existing" | "new";

/**
 * Chainweaver and EckoWallet are byte-for-byte the same wallet at the crypto
 * level (12-word mnemonic → `createWalletPairFromMnemonic` in
 * `StoaChainWalletBuilder`) — they were only ever presented as two separate
 * choices here. This list offers ONE selectable option for that family and
 * it always emits `seedType: "chainweaver"` for anything newly created;
 * `"eckowallet"` is never chosen for a new seed again. Existing seeds already
 * tagged `seedType: "eckowallet"` keep working unchanged — see `keySource.ts`
 * / `SeedWordsTab.tsx` / `StoaAccountsTab.tsx` for the display-side lookups
 * that still recognize both values.
 *
 * `stoic`'s `words: 0` marks it as the one option with no mnemonic at all —
 * every `option.words` consumer below treats `0` as "not applicable."
 */
const SEED_TYPE_OPTIONS: { value: SeedType; label: string; words: 12 | 24 | 0; color: string; desc: string }[] = [
  { value: "koala", label: "Koala", words: 24, color: "#ec4899", desc: "24-word BIP39 mnemonic (256-bit entropy). Standard Koala Wallet seed." },
  {
    value: "stoic",
    label: "Stoa Dalos",
    words: 0,
    color: "#eab308",
    desc: "No new BIP39 mnemonic to write down. Reuse your existing Ouronet seed words, or write brand-new DALOS seed words dedicated to this Chainweb account — either way, the same DALOS pipeline that produces your Ѻ./Σ. address also produces this Chainweb account.",
  },
  { value: "chainweaver", label: "Chainweaver / EckoWallet (12-word)", words: 12, color: "#3b82f6", desc: "12-word mnemonic — Chainweaver and EckoWallet are the same wallet underneath, always have been." },
];

/**
 * Restrict the Stoic "existing account" picker to `dalos`-curve accounts
 * only (Apollo is explicitly out of scope for this path — see the module
 * doc), and, within `dalos`, to `originMode === "seedWords"` ONLY.
 *
 * `bitString`-origin accounts are deliberately EXCLUDED, not just
 * unsupported: we are building Chainweb accounts from seed *words*, and a
 * bitString-origin account has no discrete words at its core — only a raw
 * 1600-bit bitstring — so it was never a valid source for a words-based
 * derivation path, even though the bitstring itself happens to be
 * technically usable.
 *
 * `bitmap` / `integerBase10` / `integerBase49` DALOS accounts are excluded
 * for a different reason — `@ouronet/dalos-crypto/gen1` does expose
 * bitmap/base10/base49 → bitstring conversions in principle, but wiring +
 * testing those here wasn't warranted for this handoff — flagged as a
 * clearly-scoped follow-up rather than silently mis-deriving a key for an
 * untested path.
 */
function isStoicEligible(account: IOuroAccount): boolean {
  return (
    detectOriginCurve(account) === "dalos" &&
    (account.originMode ?? "seedWords") === "seedWords"
  );
}

/**
 * Convert an `IOuroAccount`'s decrypted secret plaintext (space-separated
 * DALOS seed words) into the 1600-bit DALOS bitstring
 * `deriveStoaDalosKeypairAtIndex` needs, via `@ouronet/dalos-crypto/gen1`'s
 * `seedWordsToBitString` (the same seven-fold-Blake3 pipeline DALOS Genesis
 * key-gen itself uses).
 *
 * Only `originMode === "seedWords"` is a valid input — `isStoicEligible`
 * keeps the "existing account" picker from ever offering anything else,
 * so this throws defensively rather than silently mis-deriving a key if
 * that invariant is ever violated.
 */
function originModePlaintextToBitString(plaintext: string, originMode: OuroOriginMode): string {
  if (originMode === "seedWords") {
    const words = plaintext.trim().split(/\s+/).filter(Boolean);
    return seedWordsToBitString(words);
  }
  throw new Error(`Unsupported Ouronet origin mode for the Stoa Dalos path: "${originMode}".`);
}

/** Restore-textarea charset gate (digits, letters, space). */
const ALLOWED = /[^0-9A-Za-z ]/g;
const ALLOWED_PREFIXED_PATH = (i: number) => `m'/44'/626'/${i}'`;

export interface CreateStoaChainSeedModalProps {
  onClose: () => void;
}

/** Account picker for the Stoic seed type's "existing" sub-mode — lists
 *  only `isStoicEligible` accounts, radio-style (single selection,
 *  `role="option"` inside a `role="listbox"`). Only each account's name is
 *  shown (never its address); a search field above the list narrows the
 *  visible accounts by a case-insensitive substring match against the name
 *  (falling back to the address, for the rare no-name account). */
function StoicAccountPicker({
  accounts,
  selectedId,
  onSelect,
  accent,
}: {
  accounts: IOuroAccount[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  accent: string;
}) {
  const [query, setQuery] = useState("");

  if (accounts.length === 0) {
    return (
      <div style={{ padding: 14, borderRadius: 10, border: "1px dashed #262626", color: "#888", fontSize: 12, textAlign: "center", lineHeight: 1.5 }}>
        No compatible Ouronet accounts found. This picker needs a DALOS-curve
        (Ѻ./Σ.) account created from seed words — a raw-bitstring-origin
        account has no discrete words at its core and isn't eligible here.
        You can still use "Enter new seed words" instead.
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const visible = q
    ? accounts.filter((a) => (a.name || "").toLowerCase().includes(q) || a.address.toLowerCase().includes(q))
    : accounts;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search accounts…"
        style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, outline: "none", backgroundColor: "#0a0a0a", border: "1px solid #262626", color: "#d2d3d4", fontSize: 12 }}
      />
      {visible.length === 0 ? (
        <div style={{ padding: 14, borderRadius: 10, border: "1px dashed #262626", color: "#888", fontSize: 12, textAlign: "center", lineHeight: 1.5 }}>
          No accounts match "{query}".
        </div>
      ) : (
        <div role="listbox" aria-label="Ouronet account to derive from" style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflowY: "auto" }}>
          {visible.map((a) => {
            const on = a.id === selectedId;
            return (
              <button
                key={a.id}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => onSelect(a.id)}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2,
                  padding: "8px 12px", borderRadius: 8, cursor: "pointer", textAlign: "left",
                  border: `1px solid ${on ? accent : "#262626"}`,
                  backgroundColor: on ? accent + "14" : "transparent",
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: on ? accent : "#d2d3d4" }}>{a.name || a.address}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function CreateStoaChainSeedModal({ onClose }: CreateStoaChainSeedModalProps): React.JSX.Element {
  const { seeds, addSeed } = useStoaChainSeeds();
  const { accounts: ouroAccounts } = useOuroAccounts();
  const { getCurrentPassword, authenticate } = useCodexAuth();
  const { uiSettings } = useCodex();
  const ttl = typeof uiSettings.passwordCacheMinutes === "number" ? uiSettings.passwordCacheMinutes : undefined;

  const [mode, setMode] = useState<Mode>("generate");
  const [seedType, setSeedType] = useState<SeedType>("stoic");
  const [mnemonic, setMnemonic] = useState("");
  const [stoicSubMode, setStoicSubMode] = useState<StoicSubMode>("new");
  const [selectedOuroAccountId, setSelectedOuroAccountId] = useState<string | null>(null);
  const [stoicNewWordsInput, setStoicNewWordsInput] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const option = SEED_TYPE_OPTIONS.find((o) => o.value === seedType)!;
  const accent = option.color;
  const isStoic = seedType === "stoic";

  const stoicEligibleAccounts = useMemo(
    () => ouroAccounts.filter(isStoicEligible),
    [ouroAccounts],
  );
  const selectedOuroAccount = stoicEligibleAccounts.find((a) => a.id === selectedOuroAccountId) ?? null;
  const stoicNewWords = stoicNewWordsInput.trim().split(/\s+/).filter(Boolean);

  // Prefill the password from the unlocked cache (if any).
  useEffect(() => {
    try { setPassword(getCurrentPassword()); } catch { /* locked — leave blank */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const genMnemonic = (type: SeedType) => {
    const opt = SEED_TYPE_OPTIONS.find((o) => o.value === type)!;
    if (opt.words === 0) return; // stoic — no mnemonic to generate
    void StoaChainWalletBuilder.generateMnemonic(opt.words).then(setMnemonic);
  };

  // On open + on every seed-type change, regenerate (generate mode only).
  // Stoic has no mnemonic at all — always clear it instead.
  useEffect(() => {
    if (isStoic) { setMnemonic(""); return; }
    if (mode === "generate") genMnemonic(seedType);
    else setMnemonic("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedType, mode, isStoic]);

  // Live Key #0 preview.
  //   - koala/chainweaver: derives deterministically from mnemonic + seedType
  //     (password irrelevant to the public key; pass "").
  //   - stoic/"existing": needs the REAL codex password (to decrypt the
  //     source Ouronet account's secret via smartDecrypt — same call
  //     ViewSeedModal.tsx uses) before it can derive anything, so this
  //     preview doubles as an early password-correctness check: a wrong
  //     password surfaces here as a decrypt failure, well before Add Seed
  //     is ever clickable.
  //   - stoic/"new": no account, no decryption — validated synchronously via
  //     `validateTypedSeedWords`, then run straight through
  //     `seedWordsToBitString`. The codex password plays no role in this
  //     preview (there's no secret to decrypt yet); it's still required at
  //     Submit time to encrypt the resulting bitstring into the new seed.
  useEffect(() => {
    let cancelled = false;

    if (isStoic && stoicSubMode === "existing") {
      if (!selectedOuroAccount || !password) { setPreviewKey(null); return; }
      void (async () => {
        try {
          const plaintext = await smartDecrypt(selectedOuroAccount.secret, password);
          const bitString = originModePlaintextToBitString(plaintext, selectedOuroAccount.originMode ?? "seedWords");
          const { publicKey } = deriveStoaDalosKeypairAtIndex(bitString, 0);
          if (cancelled) return;
          setPreviewKey(publicKey);
          setNotice(null);
        } catch {
          if (cancelled) return;
          setPreviewKey(null);
          setNotice("Incorrect password, or this account's seed data could not be converted for the Stoa Dalos path.");
        }
      })();
      return () => { cancelled = true; };
    }

    if (isStoic && stoicSubMode === "new") {
      if (stoicNewWords.length === 0) { setPreviewKey(null); setNotice(null); return; }
      const reason = validateTypedSeedWords(stoicNewWords);
      if (reason) { setPreviewKey(null); setNotice(reason); return; }
      try {
        const bitString = seedWordsToBitString(stoicNewWords);
        const { publicKey } = deriveStoaDalosKeypairAtIndex(bitString, 0);
        setPreviewKey(publicKey);
        setNotice(null);
      } catch (e) {
        setPreviewKey(null);
        setNotice(e instanceof Error ? e.message : "Could not derive a Chainweb account from these seed words.");
      }
      return;
    }

    // Both Stoic sub-modes above always return — this direct literal check
    // (rather than the `isStoic` alias) is what lets TS narrow `seedType`
    // below to exclude "stoic", which `@stoachain/stoa-core`'s own
    // (unwidened) `SeedType` parameter type doesn't include.
    if (seedType === "stoic") return;

    const mnemonicWords = mnemonic.trim().split(/\s+/).filter(Boolean);
    if (mnemonicWords.length !== option.words) { setPreviewKey(null); return; }
    StoaChainWalletBuilder.createWalletPairFromMnemonic("", mnemonic.trim(), 0, seedType)
      .then((kp) => { if (!cancelled) setPreviewKey(kp.publicKey); })
      .catch(() => { if (!cancelled) setPreviewKey(null); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mnemonic, seedType, option.words, isStoic, stoicSubMode, selectedOuroAccount, password, stoicNewWords.join(" ")]);

  const words = mnemonic.trim().split(/\s+/).filter(Boolean);

  async function verifyPassword(pw: string): Promise<boolean> {
    const withSecret =
      seeds.find((s) => s.secret) as { secret?: string } | undefined;
    if (!withSecret?.secret) return true; // first seed — nothing to verify against
    try { await smartDecrypt(withSecret.secret, pw); return true; } catch { return false; }
  }

  // Shared tail for BOTH Stoic sub-modes — the only difference between
  // "existing" and "new" is where `bitString` comes from (decrypt an
  // existing account vs. hash typed words); everything from here on is
  // identical: authenticate, derive Key #0/#1, persist an IStoaChainSeed.
  async function finalizeStoicSeed(bitString: string): Promise<void> {
    authenticate(password, ttl);

    // Auto-derive Key #0 and Key #1, same pattern as the mnemonic path.
    const derivedAccounts: WalletAccount[] = [];
    for (const idx of [0, 1]) {
      const kp = deriveStoaDalosKeypairAtIndex(bitString, idx);
      derivedAccounts.push({ index: idx, publicKey: kp.publicKey, derivationPath: ALLOWED_PREFIXED_PATH(idx) });
    }

    const seed: IStoaChainSeed = {
      id: globalThis.crypto.randomUUID(),
      version: "1.0",
      name: name.trim(),
      index: 0,
      // Store the DERIVED 1600-bit bitstring itself (encrypted, same
      // envelope as every other seed type's "mnemonic") rather than a
      // reference back to a source account — keeps IStoaChainSeed fully
      // self-contained, consistent with every other seed type, and means a
      // stoic seed still works even if a source Ouronet account is later
      // renamed/removed (or, for "new", never existed at all).
      secret: await encryptStringV2(bitString, password),
      seedType: "stoic",
      main: derivedAccounts[0]!.publicKey,
      createdAt: new Date().toISOString(),
      accounts: derivedAccounts,
    };
    await addSeed(seed);
    onClose();
  }

  async function handleSubmitStoicExisting() {
    if (!selectedOuroAccount) { setNotice("Select an Ouronet account to derive from."); return; }
    if (!previewKey) { setNotice("Enter the correct codex password to preview Key #0 first."); return; }

    setSubmitting(true);
    try {
      // Definitive password check: decrypting the SOURCE account's own
      // secret with the entered password. (Unlike the "new words"
      // sub-mode's `verifyPassword`, which trivially passes on a codex
      // with no other seeds yet, this always has a real secret to check
      // against — the selected Ouronet account.)
      let plaintext: string;
      try {
        plaintext = await smartDecrypt(selectedOuroAccount.secret, password);
      } catch {
        setNotice("Incorrect password.");
        setSubmitting(false);
        return;
      }
      const bitString = originModePlaintextToBitString(plaintext, selectedOuroAccount.originMode ?? "seedWords");
      await finalizeStoicSeed(bitString);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Failed to add seed.");
      setSubmitting(false);
    }
  }

  async function handleSubmitStoicNew() {
    const reason = validateTypedSeedWords(stoicNewWords);
    if (reason) { setNotice(reason); return; }
    if (!previewKey) { setNotice("Enter valid seed words to preview Key #0 first."); return; }

    setSubmitting(true);
    try {
      // No source account to decrypt here — verify the codex password the
      // same way the koala/chainweaver mnemonic path does (against any
      // existing seed's own secret; trivially passes when this is the
      // codex's first seed).
      const ok = await verifyPassword(password);
      if (!ok) { setNotice("Incorrect password."); setSubmitting(false); return; }
      const bitString = seedWordsToBitString(stoicNewWords);
      await finalizeStoicSeed(bitString);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Failed to add seed.");
      setSubmitting(false);
    }
  }

  async function handleSubmitStoic() {
    if (stoicSubMode === "existing") { await handleSubmitStoicExisting(); return; }
    await handleSubmitStoicNew();
  }

  async function handleSubmit() {
    setNotice(null);
    if (!name.trim()) { setNotice("Please enter a name for this seed."); return; }
    if (!password) { setNotice("Please enter your codex password."); return; }

    if (isStoic) { await handleSubmitStoic(); return; }

    if (!mnemonic.trim()) { setNotice("Enter or generate a seed phrase."); return; }
    if (words.length !== option.words) { setNotice(`This seed type needs exactly ${option.words} words (have ${words.length}).`); return; }
    if (!previewKey) { setNotice("Seed phrase is invalid for this seed type."); return; }

    setSubmitting(true);
    try {
      const ok = await verifyPassword(password);
      if (!ok) { setNotice("Incorrect password."); setSubmitting(false); return; }
      authenticate(password, ttl);

      // Auto-derive Key #0 and Key #1.
      const accounts: WalletAccount[] = [];
      for (const idx of [0, 1]) {
        const kp = await StoaChainWalletBuilder.createWalletPairFromMnemonic(password, mnemonic.trim(), idx, seedType);
        accounts.push({ index: idx, publicKey: kp.publicKey, derivationPath: ALLOWED_PREFIXED_PATH(idx) });
      }

      const seed: IStoaChainSeed = {
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
        {/* Mode toggle — not applicable to Stoic (no mnemonic to generate or restore) */}
        {!isStoic && (
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
        )}

        {/* Seed type */}
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${SEED_TYPE_OPTIONS.length}, 1fr)`, gap: 4, padding: 4, borderRadius: 8, backgroundColor: "#18181B" }}>
          {SEED_TYPE_OPTIONS.map((o) => {
            const on = seedType === o.value;
            return (
              <button key={o.value} type="button" onClick={() => setSeedType(o.value)}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 4px", borderRadius: 6, border: "none", cursor: "pointer",
                  backgroundColor: on ? o.color + "22" : "transparent", borderBottom: on ? `2px solid ${o.color}` : "2px solid transparent" }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: on ? o.color : "#888" }}>{o.label}</span>
                <span style={{ fontSize: 10, color: "#555" }}>{o.words > 0 ? `${o.words} words` : "Min 1 - Max 256 words"}</span>
              </button>
            );
          })}
        </div>
        <p style={{ margin: 0, fontSize: 11, color: "#888", lineHeight: 1.5 }}>{option.desc}</p>

        {isStoic ? (
          /* Stoic ("Stoa Dalos"): no BIP39 mnemonic UI at all — instead its
             own `StoicSubMode` toggle between "existing" (pick an already-
             stored Ouronet account, narrowed to originMode === "seedWords")
             and "new" (type brand-new DALOS seed words). Live Key #0
             preview (below) appears once a valid bitstring is derivable
             either way. */
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, padding: 4, borderRadius: 8, backgroundColor: "#18181B" }}>
              {(["new", "existing"] as const).map((m) => (
                <button key={m} type="button" onClick={() => { setStoicSubMode(m); setNotice(null); }}
                  style={{ padding: "8px 4px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600,
                    backgroundColor: stoicSubMode === m ? accent + "22" : "transparent",
                    color: stoicSubMode === m ? accent : "#888" }}>
                  {m === "existing" ? "Use existing Ouronet seed" : "Enter new seed words"}
                </button>
              ))}
            </div>

            {stoicSubMode === "existing" ? (
              <StoicAccountPicker
                accounts={stoicEligibleAccounts}
                selectedId={selectedOuroAccountId}
                onSelect={(id) => { setSelectedOuroAccountId(id); setNotice(null); }}
                accent={accent}
              />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <textarea
                  placeholder="Type brand-new DALOS seed words, separated by spaces…"
                  value={stoicNewWordsInput}
                  onChange={(e) => setStoicNewWordsInput(e.target.value)}
                  style={{ width: "100%", boxSizing: "border-box", minHeight: 80, padding: 12, borderRadius: 8, outline: "none", resize: "none", backgroundColor: "#18181B", border: "1px solid #262626", color: "#d2d3d4", fontFamily: "var(--codex-font-mono, monospace)", fontSize: 13, lineHeight: 1.6 }}
                />
                <span style={{ fontSize: 11, color: "#888" }}>
                  {stoicNewWords.length} word{stoicNewWords.length === 1 ? "" : "s"} — not tied to any existing Ouronet account. Write these down; this is the only copy.
                </span>
                <span style={{ fontSize: 10, color: "#555" }}>
                  {MIN_SEED_WORDS}–{MAX_SEED_WORDS} words, {MIN_SEED_WORD_GLYPHS}–{MAX_SEED_WORD_GLYPHS} characters each, from the DALOS seed-word alphabet.
                </span>
              </div>
            )}
          </>
        ) : (
          <>
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
          </>
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

export default CreateStoaChainSeedModal;
