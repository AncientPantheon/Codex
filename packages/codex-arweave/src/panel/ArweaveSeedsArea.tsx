/**
 * ArweaveSeedsArea — the Arweave "Seeds" category surface (E5 / T7).
 *
 * design.md's one rule: EVERY Arweave seed is a 1600-bit DALOS-ellipse
 * bitstring. This surface is where a user produces one and then spends it on
 * the deterministic RSA-4096 search.
 *
 * PRESENTATIONAL + INJECTED. It reaches into NO store: the seeds, the sources a
 * new seed can be defined from, the Arweave keys the Codex already holds, and
 * the persist/worker seams all arrive as props. It never spawns a worker of its
 * own (`workerFactory` is injected — the same discipline `KeygenRunner` keeps)
 * and never encrypts or decrypts anything itself.
 *
 * THE CORRECTNESS GUARD LIVES HERE. `rsa4096/ranges.js` force-generates index 0
 * on EVERY call (`const seen = new Set([0])`) regardless of the ranges passed,
 * so `planIndexRanges` filtering it out does NOT stop it coming back, and
 * `runSeededBatch` deliberately forwards every key including #0. The
 * never-clobber check therefore sits in `onKey`, applied to EVERY index, before
 * anything is persisted — see `docs/HANDOFF-rsa4096-skip-populated-indices.md`.
 * Getting this wrong silently overwrites the user's key #0.
 *
 * Each key is persisted AS IT ARRIVES, never accumulated and written at the end:
 * generation is ~6.7 s PER KEY, so a 100-key run is ~11 minutes and a cancel or
 * a closed tab must keep everything already produced.
 *
 * The per-run ceiling is PROGRESSIVE and Codex-WIDE: 100 while the Codex holds
 * zero Arweave keys, 1000 once at least one exists (any seed). At 6.7 s/key a
 * first-ever run of 1000 is ~1.9 h against a path the user has never seen work.
 *
 * Option 1b (Restricted Seed Input) is DICTIONARY-GATED against the BIP English
 * wordlist — see `validateRestrictedSeedWords`. Without that gate 1b accepts
 * exactly what 1a accepts and the two variants are one variant with two labels.
 * Option 1a is deliberately NOT gated: it stays DALOS-charset-only.
 *
 * 1b is entered through `RestrictedWordGrid`: ONE rectangle per word, at
 * whichever count the user's tile picked ("Dictionary (12-word)" /
 * "Dictionary (24-word)" — the tile itself IS the count, there is no separate
 * nested switch underneath it), with prefix autocomplete and a red mark on
 * the individual slot whose word the dictionary does not hold — the same
 * numbered word grid the Codex already uses in `CreateStoaChainSeedModal` /
 * `SpawnAccountModal`, so there is one seed-entry language and not two. 1a
 * ("Stoa Dalos") keeps its free textarea, because its
 * words are 1-256 arbitrary DALOS-charset glyphs, not dictionary entries.
 *
 * This file's OWN icons are INLINE SVG, deliberately NOT `lucide-react`: that
 * package lives only at the repo root where `react` resolves to the stale
 * hoisted React 18, so importing it directly here would render elements from a
 * second React ("A React Element from an older version of React was
 * rendered"). Same rule as `ArweavePanel.tsx`. The per-seed "View Seed" reveal
 * mounts `@ancientpantheon/codex-ouronet/ui`'s `DalosSecretReveal`, which DOES
 * use `lucide-react` internally — safe here because `vitest.config.ts` carries
 * the same 3-part lucide-react/React-19 harness fix as `codex-ouronet`'s own
 * config (alias to the ESM barrel, `optimizeDeps.exclude`, `server.deps.inline`).
 */

import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";
import type { ArweaveJwk } from "@ancientpantheon/arweave-core";
import {
  bitStringOf,
  curveOf,
  type BitStringAccount,
} from "@ancientpantheon/codex-ouronet/codex-identity";
import { DalosSecretReveal, CodexModalShell, BitmapKeyInput } from "@ancientpantheon/codex-ouronet/ui";

import { generateMnemonic } from "@scure/bip39";
import { wordlist as BIP_ENGLISH_WORDLIST } from "@scure/bip39/wordlists/english";
import {
  CHARACTER_MATRIX_FLAT,
  MAX_SEED_WORDS,
  MAX_SEED_WORD_GLYPHS,
  DALOS_ELLIPSE,
  BASE49_ALPHABET,
  validateBitString,
  validatePrivateKey,
  generateScalarFromBitString,
  scalarToPrivateKey,
  type Ellipse,
  type Bitmap,
} from "@ouronet/dalos-crypto/gen1";
import { APOLLO } from "@ouronet/dalos-crypto/historical";

import { resolveSeedBitString, SEED_BIT_LENGTH } from "../seeds/index.js";
import { planIndexRanges, type IndexSelection } from "../seeds/planIndexRanges.js";
import { runSeededBatch } from "../keygen/KeygenRunner.js";

/* ────────────────────────────── the model ────────────────────────────── */

/** A defined Arweave seed. `bits` is ALWAYS exactly `SEED_BIT_LENGTH` bits —
 *  it only ever comes out of `resolveSeedBitString`, which refuses any other
 *  width rather than padding or truncating it. */
export interface ArweaveSeedRecord {
  id: string;
  label: string;
  /** The validated 1600-bit DALOS bitstring. SECRET — never rendered. */
  bits: string;
  /** The Prime Arweave Seed occupies the first row. At most one is prime. */
  isPrime?: boolean;
  /** The width `bits` was resolved at. ABSENT means 1600 (DALOS) — every
   *  Seed-Based seed is implicitly 1600 and never sets this field; only a
   *  Direct-mode seed (which can be 1024-bit APOLLO or 1600-bit DALOS) sets
   *  it explicitly. Drives `SeedRow`'s subtitle and the reveal's `originCurve`. */
  bitLength?: 1024 | 1600;
  /** Human-readable provenance — what the seed was actually defined FROM
   *  (typed words, an Ouronet account, a Chainweb seed, Quick Define), shown
   *  in the "View Seed" reveal instead of the generic "bitstring" wording
   *  every seed would otherwise share. Session-only: OPTIONAL, so a seed
   *  loaded after reload (its session-only label lost) still reveals fine —
   *  it just falls back to `DalosSecretReveal`'s own generic text. */
  sourceLabel?: string;
  /** The ACTUAL typed/decrypted seed words, when the source genuinely has
   *  them (typed words, a Chainweb seed, or a seed-words-origin Ouronet
   *  account) — shown, blurred and revealable, in the "View Seed" reveal's
   *  Seed tab. Absent for a bitmap/bitstring/scalar-origin account source
   *  (which has no words to show) and for a seed loaded after reload (the
   *  session-only value is lost) — the reveal falls back to the bitstring-only
   *  view in both cases, never a crash. SECRET — never rendered unmasked
   *  without the same explicit Reveal toggle `DalosSecretReveal` already
   *  gates every other representation behind. */
  words?: readonly string[];
}

/** Option 2's source: an ACTIVATED Ouronet account whose private key already IS
 *  a DALOS bitstring. Only `dalos`-curve accounts qualify — an APOLLO account's
 *  1024 bits are refused by `resolveSeedBitString` (Apollo is deferred). */
export interface ArweaveSeedAccountSource {
  id: string;
  label: string;
  account: BitStringAccount;
  /** The default selection (CodexPrime). */
  isDefault?: boolean;
}

/** Option 3's source: an existing Chainweb seed, captured directly. */
export interface ArweaveSeedChainwebSource {
  id: string;
  label: string;
  /** The seed's BIP39 words, converted through the DALOS ellipse. SECRET.
   *  OPTIONAL: a host that stores the mnemonic as ciphertext should omit this
   *  and supply `revealSeedWords` instead, so no mnemonic is held in memory
   *  until the user actually picks that seed. */
  words?: readonly string[];
  /** The default selection (the Prime Codex Seed). */
  isDefault?: boolean;
}

/** One generated key, handed to the persistence seam the moment it arrives. */
export interface GeneratedArweaveKey {
  seedId: string;
  index: number;
  jwk: ArweaveJwk;
  address: string;
}

/**
 * What a seed deletion must remove: the seed itself AND every key derived from
 * it. The key ids travel WITH the request because the keys are meaningless
 * without the seed that reproduces them — dropping the seed alone would leave
 * Accounts holding entries no seed can ever regenerate.
 */
export interface ArweaveSeedDeletion {
  seedId: string;
  /** The ids of EXACTLY this seed's `ForeignKeyEntry`s (matched on `seedId`). */
  keyIds: readonly string[];
}

export interface ArweaveSeedsAreaProps {
  /** The known Arweave seeds. Seeds defined in-session are merged in on top. */
  seeds?: readonly ArweaveSeedRecord[];
  /** Persistence seam for a newly defined seed. */
  onSeedDefined?: (seed: ArweaveSeedRecord) => void;
  /** Every Arweave key the Codex holds — drives the Codex-wide cap AND the
   *  per-seed never-clobber guard. Ciphertext entries; never decrypted here. */
  existingKeys?: readonly ForeignKeyEntry[];
  /** Option 2's candidates (any curve; APOLLO ones are filtered out here). */
  ouronetAccounts?: readonly ArweaveSeedAccountSource[];
  /** Unlock-gated reveal of an account's decrypted `secret` plaintext, so
   *  option 2 can re-derive its bitstring. Injected — this component never
   *  decrypts. */
  revealAccountSecret?: (accountId: string) => Promise<string | null> | string | null;
  /** Option 3's candidates. */
  chainwebSeeds?: readonly ArweaveSeedChainwebSource[];
  /** LAZY decrypt of a Chainweb seed's mnemonic, used when the source omits
   *  `words`. Resolves `null` when the decrypt fails (wrong/absent password). */
  revealSeedWords?: (seedId: string) => Promise<readonly string[] | null>;
  /** Overrides the dictionary gating the Restricted Seed Input variant (1b).
   *  Defaults to the BIP English wordlist, so the gate is ALWAYS armed — an
   *  unwired consumer must not silently degrade 1b into a second 1a. */
  bipDictionary?: readonly string[];
  /** Overrides the Restricted variant's random-phrase generator. It is told the
   *  word count the user selected (12 or 24). Defaults to a real BIP39 mnemonic
   *  of that length, which `validateRestrictedSeedWords` accepts. */
  generateBipPhrase?: (
    wordCount: RestrictedWordCount,
  ) => Promise<readonly string[]> | readonly string[];
  /** INJECTED worker factory for the seeded batch — never constructed here. */
  workerFactory?: () => Worker;
  /** Persists ONE generated key. Called per key AS IT ARRIVES (never batched). */
  persistKey?: (key: GeneratedArweaveKey) => Promise<void> | void;
  /** Unlock-gated decrypt of ONE stored key into its transient JWK, so a key
   *  the Codex ALREADY holds can open the same RSA-parameter panel a freshly
   *  generated one does. INJECTED — this surface decrypts nothing itself, and
   *  it is called only when the user expands that key's panel, never to draw
   *  the list. Absent → the panel still opens and says it cannot read the key.
   *  Wire it from `ArweavePanelDeps.decryptArweaveKey`. */
  decryptArweaveKey?: (entry: ForeignKeyEntry) => Promise<ArweaveJwk>;
  /** Deletes a seed AND every key derived from it. INJECTED — this surface
   *  reaches into no store: it names the seed and the exact key ids that must
   *  go with it, and the consumer performs the cascade. */
  onDeleteSeed?: (request: ArweaveSeedDeletion) => Promise<void> | void;
  /** Reports the run's LIVE activity to the parent, so a category switch or a
   *  tab close mid-generation can warn instead of silently orphaning the run
   *  (design.md ask A). Fires a non-null `{ seedLabel, cancel }` whenever a
   *  run is `"running"`, and `null` the instant it is not — including on
   *  unmount, so a stale activity can never linger in the parent. Purely
   *  ADDITIVE: a consumer that omits it sees no behavior change. */
  onRunActivityChange?: (activity: { seedLabel: string; cancel: () => void } | null) => void;
}

/* ───────────────────────────── the constants ──────────────────────────── */

/** The name of the FIRST-EVER Arweave seed. It is not a default the user may
 *  overwrite: the Prime seed is the row the whole surface is built around, and
 *  the permanence warning, the `· Prime` marker and the delete copy all name it
 *  by this name. Only SUBSEQUENT seeds carry a user-chosen name. */
export const PRIME_SEED_LABEL = "Prime Arweave Seed";

/** The per-run ceiling while the Codex holds ZERO Arweave keys (~11 min). */
export const FIRST_RUN_INDEX_CAP = 100;
/** The per-run ceiling once at least one Arweave key exists, anywhere. */
export const INDEX_CAP = 1000;

const ACCENT = "#22c55e"; // the Seeds accent, shared across chains
const MONO = "var(--codex-font-mono, 'JetBrains Mono', ui-monospace, monospace)";

const svgBase = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const ChevronDownGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style}><path d="m6 9 6 6 6-6" /></svg>
);
const ChevronRightGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style}><path d="m9 18 6-6-6-6" /></svg>
);
/** The Prime row's toggle, gold-and-locked instead of a chevron — ported from
 *  `SeedWordsTab.tsx`'s `Lock` glyph swap. Decorative only: `onToggle` still
 *  opens/closes the row exactly as the chevron did. */
const LockGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style}>
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);
const PlusGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style}><path d="M5 12h14" /><path d="M12 5v14" /></svg>
);
const TrashGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style}>
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="M19 6l-1 14H6L5 6" />
  </svg>
);

/** The reveal affordance's glyphs, mirroring `DalosSecretReveal`'s Eye/EyeOff
 *  toggle. INLINE SVG: `lucide-react` resolves to a second React here. */
const EyeGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const EyeOffGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style}>
    <path d="M10.7 5.1A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2" />
    <path d="M6.6 6.6A17.6 17.6 0 0 0 2 12s3.5 7 10 7a10.4 10.4 0 0 0 5.4-1.5" />
    <path d="m2 2 20 20" />
  </svg>
);

/* ───────────────────────────── small helpers ──────────────────────────── */

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** The measured cost of ONE RSA-4096 prime search (design.md: 6.8 / 4.8 / 8.4 s
 *  for #0/#1/#2 on a dev box). Used ONLY to state a remaining time — the search
 *  is variance-heavy, so the figure is an estimate and is worded as one. */
const SECONDS_PER_KEY = 6.7;

/** `670` → `"11 min"`. A run is counted in keys but WAITED in minutes: at
 *  ~6.7 s/key a 100-key run is ~11 minutes and a 1000-key one ~1 h 52 min, and
 *  "97 keys left" does not tell the user whether to stay at the machine. */
function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/* ────────────────── base64url → decimal (the RSA numbers) ─────────────── */

/** The base64url alphabet, index = 6-bit value. Decoding is done BY HAND rather
 *  than through `atob`: `atob` rejects the url-safe alphabet, is absent outside
 *  a DOM, and is lenient about padding in ways that differ per runtime. */
const B64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * ONE JWK parameter, as the number it actually is.
 *
 * The Crypto Lab prints `r.key.n.toString()` — a plain decimal integer, which is
 * what an RSA parameter IS. That path is unavailable here: a persisted key is an
 * encrypted JWK, so every parameter arrives as an unpadded, big-endian,
 * base64url byte string. This is the single decoder both the freshly generated
 * and the stored key go through, so the same key can never print two different
 * moduli.
 *
 * @returns the decimal digits, or `null` for an empty/malformed member — a
 *   render must never throw on a bad byte and blank the whole panel.
 */
export function base64UrlToDecimal(value: string): string | null {
  const body = value.replace(/=+$/, "");
  if (body === "") return null;
  // 6 bits per character: a 1-character group encodes nothing whole.
  if (body.length % 4 === 1) return null;

  let bits = 0n;
  for (const char of body) {
    const sextet = B64URL_ALPHABET.indexOf(char);
    if (sextet === -1) return null;
    bits = (bits << 6n) | BigInt(sextet);
  }
  // Drop the low bits the final partial group padded with: 2 characters carry
  // 1 byte (4 spare bits), 3 characters carry 2 bytes (2 spare bits).
  const spare = [0, 0, 4, 2][body.length % 4] ?? 0;
  return (bits >> BigInt(spare)).toString();
}

/** One JWK member of an RSA key, as the parameter panel names it. */
type RsaParamName = "n" | "e" | "p" | "q" | "d" | "dp" | "dq" | "qi";

/**
 * The field definitions, VERBATIM from the Stoic Digest Crypto Lab
 * (`websites/StoicDigest/src/pages/lab/seed.astro`, `DEFS`).
 *
 * Copied rather than paraphrased ON PURPOSE: this panel IS that panel, and two
 * wordings of "what is dq" across two surfaces is two explanations to keep true.
 */
const DEFS = {
  arw: "The 43-character Arweave address others send AR to — Base64URL(SHA-256(n)), the hash of this key’s modulus. Public.",
  n: "The RSA modulus — the product of the two secret primes, n = p × q. Its 4096-bit size is the key’s strength. Public.",
  e: "The public exponent, always 65537 — the number used when encrypting or verifying. Public.",
  d: "The private exponent — the inverse of e modulo λ(n). The core secret used to sign or decrypt. Private.",
  p: "One of the two large secret primes whose product is the modulus n. Learning p (or q) breaks the key. Private.",
  q: "The other secret prime; n = p × q. Private.",
  dp: "CRT exponent d mod (p − 1) — a precomputed value that speeds up private operations. Private.",
  dq: "CRT exponent d mod (q − 1). Private.",
  qi: "CRT coefficient q⁻¹ mod p — the other Chinese-Remainder-Theorem speedup. Private.",
} as const;

/**
 * The eight parameter rows, in the Crypto Lab's order (`resultInner()`), with
 * its labels and its public/private split.
 *
 * `p` and `q` come BEFORE `d` — the Lab's order, which reads as the key is
 * built (the two primes, then the exponent derived from them) rather than as
 * RFC 7518 lists the JWK members. `n`/`e` are public: they identify the key.
 * The other six reconstruct it.
 */
const RSA_FIELDS: ReadonlyArray<{
  name: RsaParamName;
  label: string;
  priv: boolean;
  def: string;
}> = [
  { name: "n", label: "Modulus  n = p × q", priv: false, def: DEFS.n },
  { name: "e", label: "Public exponent e", priv: false, def: DEFS.e },
  { name: "p", label: "Prime p", priv: true, def: DEFS.p },
  { name: "q", label: "Prime q", priv: true, def: DEFS.q },
  { name: "d", label: "Private exponent d", priv: true, def: DEFS.d },
  { name: "dp", label: "dp", priv: true, def: DEFS.dp },
  { name: "dq", label: "dq", priv: true, def: DEFS.dq },
  { name: "qi", label: "qi", priv: true, def: DEFS.qi },
];

/** How many trailing characters never shrink (`field()`'s `TAIL`). The tail is
 *  what a user checks a value BY — a truncation that eats it leaves two
 *  different keys looking identical. */
const VALUE_TAIL = 8;

/** Every parameter of ONE key as its decimal integer, `null` where the member is
 *  absent or malformed. ONE decoder for the generated and the stored key alike. */
function rsaDecimals(jwk: ArweaveJwk): Record<RsaParamName, string | null> {
  const member = jwk as unknown as Record<string, string | undefined>;
  const out = {} as Record<RsaParamName, string | null>;
  for (const field of RSA_FIELDS) {
    const raw = member[field.name];
    out[field.name] = raw === undefined ? null : base64UrlToDecimal(raw);
  }
  return out;
}

/* ───────────────── downloads (ported from `download()`) ───────────────── */

/** The signing algorithm the PEM export imports under — WebCrypto needs one,
 *  and this is the Lab's (`RSA_ALG`). It does not change the key material. */
const RSA_ALG = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

function saveBlob(name: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function abToB64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]!);
  return btoa(out);
}

/** PEM: the DER bytes in base64, wrapped at 64 characters, between the labels. */
function pem(buffer: ArrayBuffer, label: string): string {
  const body = abToB64(buffer).match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${body.join("\n")}\n-----END ${label}-----\n`;
}

/** The Lab's three downloads for ONE key, byte-for-byte the same artefacts: the
 *  Arweave keyfile is the JWK itself, and both PEMs go through WebCrypto so what
 *  lands on disk is a standard PKCS#8 / SPKI file, not a hand-rolled encoding. */
async function downloadKeyArtefact(
  kind: "json" | "priv" | "pub",
  jwk: ArweaveJwk,
  address: string,
): Promise<void> {
  const member = jwk as unknown as Record<string, string>;
  const tag = address.slice(0, 10);
  if (kind === "json") {
    saveBlob(`arweave-${tag}.json`, JSON.stringify(jwk, null, 2), "application/json");
    return;
  }
  if (kind === "priv") {
    const key = await crypto.subtle.importKey(
      "jwk",
      {
        kty: "RSA",
        n: member.n,
        e: member.e,
        d: member.d,
        p: member.p,
        q: member.q,
        dp: member.dp,
        dq: member.dq,
        qi: member.qi,
        ext: true,
      } as JsonWebKey,
      RSA_ALG,
      true,
      ["sign"],
    );
    saveBlob(
      `${tag}-private.pem`,
      pem(await crypto.subtle.exportKey("pkcs8", key), "PRIVATE KEY"),
      "application/x-pem-file",
    );
    return;
  }
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "RSA", n: member.n, e: member.e, ext: true } as JsonWebKey,
    RSA_ALG,
    true,
    ["verify"],
  );
  saveBlob(
    `${tag}-public.pem`,
    pem(await crypto.subtle.exportKey("spki", key), "PUBLIC KEY"),
    "application/x-pem-file",
  );
}

/** What a masked parameter renders INSTEAD of its value. The value itself never
 *  reaches the DOM: blurring it (as `DalosSecretReveal` does for an already-
 *  unlocked account) would still leave it selectable, copyable, readable by a
 *  screen reader and present in the page source. The blur is kept as the look;
 *  the substitution is what makes it safe. */
const MASKED_VALUE = "\u2022".repeat(40);

/** `DalosSecretReveal`'s masking idiom, kept verbatim so the two reveals look
 *  like one affordance. */
const masked = (unmasked: boolean): React.CSSProperties => ({
  filter: unmasked ? "none" : "blur(4px)",
  transition: "filter 120ms ease",
});

/** The Crypto Lab's duration format, verbatim (`fmtDuration` in seed.astro). */
export function fmtDuration(ms: number): string {
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** `n` empty word slots — the Restricted grid's zero state. */
function emptyWordSlots(count: number): readonly string[] {
  return Array.from({ length: count }, () => "");
}

/** A stable id for a seed defined in-session. */
let seedIdCounter = 0;
function nextSeedId(): string {
  seedIdCounter += 1;
  const uuid =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `arweave-seed-${seedIdCounter}-${uuid}`;
}

/** `"12"` → 12; anything blank or non-numeric → `NaN`, which `planIndexRanges`
 *  refuses with a readable message rather than silently generating index 0. */
function parseIndexField(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed === "") return Number.NaN;
  return Number(trimmed);
}

/** `"3-7, 12, 20-22"` → the inclusive spans it names. */
function parseRangeList(raw: string): IndexSelection | { error: string } {
  const parts = raw.split(",").map((p) => p.trim()).filter((p) => p !== "");
  if (parts.length === 0) {
    return { error: "Enter at least one interval, e.g. `3-7, 12, 20-22`." };
  }
  const ranges: Array<{ start: number; end: number }> = [];
  for (const part of parts) {
    const [startRaw, endRaw] = part.split("-");
    const start = parseIndexField(startRaw ?? "");
    const end = endRaw === undefined ? start : parseIndexField(endRaw);
    if (Number.isNaN(start) || Number.isNaN(end)) {
      return { error: `\`${part}\` is not an interval — use \`3-7\` or \`12\`.` };
    }
    ranges.push({ start, end });
  }
  return { kind: "ranges", ranges };
}

/** The index space of ONE seed, as the Codex currently knows it. */
function indicesOfSeed(keys: readonly ForeignKeyEntry[], seedId: string): number[] {
  const out: number[] = [];
  for (const key of keys) {
    if (key.seedId === seedId && typeof key.index === "number") out.push(key.index);
  }
  return out;
}

/** Every key derived from ONE seed, by id. Deliberately NOT filtered on
 *  `index`: a legacy/indexless entry carrying this `seedId` is just as orphaned
 *  once the seed is gone, so it goes with it. */
function keyIdsOfSeed(keys: readonly ForeignKeyEntry[], seedId: string): string[] {
  return keys.filter((key) => key.seedId === seedId).map((key) => key.id);
}

/* ─────────────────── Restricted Seed Input (1b) gating ────────────────── */

/** The BIP English wordlist, as a lookup. Built once — 2048 entries. */
const BIP_ENGLISH_SET: ReadonlySet<string> = new Set(BIP_ENGLISH_WORDLIST);

/**
 * The phrase lengths the Restricted variant offers, mirroring the Codex's own
 * seed inputs (`SEED_TYPE_OPTIONS` in `CreateStoaChainSeedModal`: 12-word
 * Chainweaver/EckoWallet, 24-word Koala). `seedWordsToBitString` widens whatever
 * it is given to the DALOS ellipse, so the count is a UX choice — the user's
 * habit from the rest of the Codex — not a cryptographic one.
 */
const RESTRICTED_LENGTH_OPTIONS: ReadonlyArray<{
  words: RestrictedWordCount;
  label: string;
  entropyBits: 128 | 256;
}> = [
  { words: 12, label: "12 words", entropyBits: 128 },
  { words: 24, label: "24 words", entropyBits: 256 },
];

/** How many prefix matches a slot offers at once — the wordlist is 2048 long,
 *  so an uncapped list is a wall, not a suggestion. */
const MAX_WORD_SUGGESTIONS = 8;

/** The colour a slot holding a non-dictionary word is painted. The refusal has
 *  to be answerable by LOOKING at the grid: a summary line under 24 slots does
 *  not tell the user WHICH word is the wrong one. */
const INVALID_WORD_COLOR = "#f87171";

/** The refusal for ONE word at its 1-based position, or `null` when it passes.
 *  Shared by the confirm-time gate and the live per-slot marking so the two can
 *  never disagree about what counts as a dictionary word. */
function restrictedWordRefusal(
  word: string,
  position: number,
  dictionary: ReadonlySet<string>,
): string | null {
  return dictionary.has(word.toLowerCase())
    ? null
    : `seed word ${position} ("${word}"): not in the BIP English wordlist`;
}

/** The dictionary words that start with `prefix`, capped at
 *  `MAX_WORD_SUGGESTIONS`. An empty prefix offers nothing: the whole wordlist is
 *  not a suggestion. */
function suggestWords(dictionary: readonly string[], prefix: string): string[] {
  const needle = prefix.trim().toLowerCase();
  if (needle === "") return [];
  const out: string[] = [];
  for (const word of dictionary) {
    if (word.startsWith(needle)) {
      out.push(word);
      if (out.length === MAX_WORD_SUGGESTIONS) break;
    }
  }
  return out;
}

/**
 * The Restricted Seed Input (1b) gate — what makes 1b differ from 1a.
 *
 * design.md: "every word must exist in the BIP English wordlist — otherwise it
 * is not 'restricted' and is indistinguishable from Free Seed Input". Typing
 * stays allowed (it is one of the two required variants); the gate only decides
 * whether the typed words are admissible.
 *
 * Rejection is PER WORD and NAMES the offender at its 1-based position, the
 * same shape gen1's DALOS charset error already uses
 * (`seed word 1 ("wor中ld"): character "中" is not one of the 256 glyphs…`),
 * so the two error styles read as one voice. Comparison is case-insensitive: a
 * pasted capitalised phrase is a formatting difference, not a wrong word.
 *
 * @returns the inline-renderable refusal text, or `null` when every word passes.
 */
export function validateRestrictedSeedWords(
  words: readonly string[],
  dictionary: ReadonlySet<string> = BIP_ENGLISH_SET,
): string | null {
  for (let i = 0; i < words.length; i += 1) {
    const refusal = restrictedWordRefusal(words[i] ?? "", i + 1, dictionary);
    if (refusal !== null) return refusal;
  }
  return null;
}

/** The default Restricted-variant generator: a real BIP39 mnemonic OF THE
 *  SELECTED LENGTH, so the phrase it produces fills exactly the slots on screen
 *  and necessarily passes `validateRestrictedSeedWords`. */
function defaultGenerateBipPhrase(wordCount: RestrictedWordCount): readonly string[] {
  const option =
    RESTRICTED_LENGTH_OPTIONS.find((o) => o.words === wordCount) ?? RESTRICTED_LENGTH_OPTIONS[0]!;
  return generateMnemonic(BIP_ENGLISH_WORDLIST, option.entropyBits).split(" ");
}

/** The 12/24 switch's value. */
export type RestrictedWordCount = 12 | 24;

type DefineSource = "words" | "account" | "chainweb";
type WordsVariant = "free" | "restricted";
/** Option 1's single flat 3-tile picker. "dalos" is Free Seed Input's
 *  free-form textarea (today's `variant === "free"`); "dict12"/"dict24" are
 *  the BIP-dictionary-gated Restricted variant with its word count LOCKED to
 *  the tile — the tile itself IS the count now, so there is no separate
 *  nested 12/24 switch underneath it any more. Internally still backed by
 *  `variant`/`restrictedCount` (`seedInputTile` is DERIVED from them, and
 *  choosing a tile sets both together) so `confirmDefine`,
 *  `validateRestrictedSeedWords`, `RestrictedWordGrid`, `RESTRICTED_LENGTH_OPTIONS`
 *  etc. stay exactly as they were — only the selector UI feeding them changed. */
type SeedInputTile = "dalos" | "dict12" | "dict24";
/**
 * The 3 tiles of the flat picker, styled like `CreateStoaChainSeedModal`'s own
 * `SEED_TYPE_OPTIONS` tiles — same colours, same "bold label + gray subtitle"
 * shape (`eab308` Stoa Dalos, `3b82f6` Chainweaver/EckoWallet-style 12-word,
 * `ec4899` Koala-style 24-word), so a user who already knows that picker reads
 * this one at a glance.
 */
const SEED_INPUT_TILE_OPTIONS: ReadonlyArray<{
  tile: SeedInputTile;
  label: string;
  subtitle: string;
  color: string;
}> = [
  { tile: "dalos", label: "Stoa Dalos", subtitle: "Min 1 - Max 256 words", color: "#eab308" },
  { tile: "dict12", label: "Dictionary (12-word)", subtitle: "12 words", color: "#3b82f6" },
  { tile: "dict24", label: "Dictionary (24-word)", subtitle: "24 words", color: "#ec4899" },
];
type GenerateMode = "default" | "single" | "upTo" | "ranges";
/** The define form's upper-right toggle (C). `"seed-based"` is today's
 *  three-source, 1600-only form, unchanged; `"direct"` picks a value's exact
 *  bits directly (BitString / Bitmap / Base-10 / Base-49), at either 1024
 *  (APOLLO) or 1600 (DALOS) bits — see `direct-deterministic-rsa`. */
type GeneratorMode = "seed-based" | "direct";

/** The four Direct input kinds, in the order the design lists them. Also each
 *  kind tile's testid suffix, unchanged from the earlier placeholder round so
 *  existing test ids keep working across the placeholder → real-UI swap. */
const DIRECT_INPUT_KINDS: ReadonlyArray<{ label: string; testId: DirectKind }> = [
  { label: "BitString", testId: "bitstring" },
  { label: "Bitmap", testId: "bitmap" },
  { label: "Base-10 scalar", testId: "base10" },
  { label: "Base-49 scalar", testId: "base49" },
];

/** The Direct generator's active input kind — one of `DIRECT_INPUT_KINDS`. */
type DirectKind = "bitstring" | "bitmap" | "base10" | "base49";

/** The two widths Direct mode supports: 1024 (APOLLO) or 1600 (DALOS). */
type DirectWidth = 1024 | 1600;

/** The larger of the two supported widths — the BitString textarea's input
 *  cap. NOT `directWidth`: capping at the CURRENTLY selected width would
 *  truncate a value typed for the OTHER (larger) width before the
 *  auto-correction rule ever gets to see it, making the 1024→1600 direction
 *  of that rule impossible to trigger by typing. */
const MAX_DIRECT_WIDTH: DirectWidth = 1600;

/** The Ellipse a given Direct width resolves against. */
function ellipseForDirectWidth(width: DirectWidth): Ellipse {
  return width === 1024 ? APOLLO : DALOS_ELLIPSE;
}

/** The OTHER supported width — the one auto-correction tries when the
 *  currently selected width refuses a value. */
function otherDirectWidth(width: DirectWidth): DirectWidth {
  return width === 1024 ? 1600 : 1024;
}

/** What a Direct input resolves to: the validated bits at the width they
 *  actually validate at (which may differ from the CURRENTLY selected width —
 *  see the auto-correction rule below), or a refusal. */
type DirectResolution = { bits: string; width: DirectWidth } | { error: string };

/**
 * BitString resolution — STRICT against the ONE width passed in. Deliberately
 * NOT lenient (an earlier version tried both widths internally and returned
 * whichever matched): that made the toggle's own displayed state a LIE the
 * instant it disagreed with the content, and made a MANUAL width click look
 * broken — clicking 1600 while a 1024-native value sat in the field left
 * Confirm silently enabled, because this function accepted the value at 1024
 * regardless of which width the user had just explicitly selected. The
 * two-attempt "try the other width, and if it fits, flip the toggle" logic
 * now lives ONLY where it belongs — in the onChange handlers below, which can
 * tell "the user just typed something new" apart from "the user just clicked
 * the toggle directly" and only auto-correct for the former.
 */
function resolveDirectBitString(text: string, width: DirectWidth): DirectResolution | null {
  if (text === "") return null;
  const result = validateBitString(text, ellipseForDirectWidth(width));
  if (result.valid) return { bits: text, width };
  return { error: result.reason ?? `Not a valid ${width}-bit bitstring.` };
}

/** Base-10/49 resolution — the same STRICT, single-width contract as
 *  `resolveDirectBitString`, reading the resolved bits back off
 *  `validatePrivateKey`'s already-clamped-scalar result. */
function resolveDirectScalar(
  value: string,
  base: 10 | 49,
  width: DirectWidth,
): DirectResolution | null {
  if (value === "") return null;
  const result = validatePrivateKey(value, base, ellipseForDirectWidth(width));
  if (result.valid) return { bits: result.bitString, width };
  return { error: result.reason ?? `Not a valid base-${base} scalar for ${width}-bit.` };
}

/** A random `bitLength`-bit bitstring (`crypto.getRandomValues`), the exact
 *  idiom `SpawnAccountModal.tsx`'s own `randomBits()` uses. */
function randomBits(bitLength: number): string {
  const byteCount = Math.ceil(bitLength / 8);
  const buf = new Uint8Array(byteCount);
  crypto.getRandomValues(buf);
  let bits = "";
  for (let i = 0; i < bitLength; i++) bits += ((buf[i >> 3]! >> (i & 7)) & 1).toString();
  return bits;
}

/** A random, already-clamped Base-10/49 scalar for `width`: draw a random
 *  bitstring (always valid — no curve-order rejection on a bitstring), then
 *  read its canonical int10/int49 back off the clamped scalar. Guaranteed
 *  in-range, unlike an arbitrary typed integer. */
function randomDirectScalar(width: DirectWidth, base: 10 | 49): string {
  const ellipse = ellipseForDirectWidth(width);
  const scalar = generateScalarFromBitString(randomBits(width), ellipse);
  const priv = scalarToPrivateKey(scalar, ellipse);
  return base === 10 ? priv.int10 : priv.int49;
}

/** `BitmapKeyInput`'s bitmap, flattened to its row-major bitstring —
 *  dimension-generic (works for 1024's 32×32 and 1600's 40×40 alike), the
 *  same pattern `SpawnAccountModal.tsx`'s own local `bitmapToBits` uses
 *  (core's `bitmapToBitString` hardcodes 40×40). `BitmapKeyInput` guarantees
 *  its emitted bitmap is already exactly `rows`×`cols`, so there is no
 *  ambiguity to auto-correct here — unlike BitString/Base-10/49. */
function directBitmapToBits(bitmap: Bitmap, rows: number, cols: number): string {
  let bits = "";
  for (let r = 0; r < rows; r++) {
    const row = bitmap[r] as unknown as (number | boolean)[] | undefined;
    for (let c = 0; c < cols; c++) bits += row?.[c] ? "1" : "0";
  }
  return bits;
}

/** The reverse of `directBitmapToBits` — dimension-generic bits -> `Bitmap`,
 *  used when switching TO the Bitmap tile from a value resolved under a
 *  different representation, so the grid shows it instead of starting blank. */
function bitsToDirectBitmap(bits: string, rows: number, cols: number): Bitmap {
  const grid: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: number[] = [];
    for (let c = 0; c < cols; c++) row.push(bits[r * cols + c] === "1" ? 1 : 0);
    grid.push(row);
  }
  return grid as unknown as Bitmap;
}

/** Converts an already-validated N-bit direct value into its equivalent
 *  Base-10/49 scalar forms at the SAME width — the exact same
 *  `generateScalarFromBitString` -> `scalarToPrivateKey` pipeline
 *  `randomDirectScalar` already uses, run on a caller-supplied bitstring
 *  instead of a freshly drawn random one. Used when switching TO Base-10/49
 *  from a value resolved under a different representation. */
function bitsToDirectScalars(bits: string, width: DirectWidth): { int10: string; int49: string } {
  const ellipse = ellipseForDirectWidth(width);
  const scalar = generateScalarFromBitString(bits, ellipse);
  const priv = scalarToPrivateKey(scalar, ellipse);
  return { int10: priv.int10, int49: priv.int49 };
}

/** ONE key produced by the run, as the progress display holds it. The `jwk` is
 *  kept in memory only — it reaches the DOM solely through an explicit reveal. */
interface RunKey {
  index: number;
  address: string;
  jwk: ArweaveJwk;
}

interface RunState {
  seedId: string;
  /** Keys STORED this run (a skipped, already-held index is not counted). */
  stored: number;
  /** Positions the plan asked the library to generate. */
  total: number;
  /** Those positions, ascending — the run's running order, so the display can
   *  name the index currently under search rather than only the last one done. */
  planned: readonly number[];
  /** The keys stored so far, in arrival order. */
  keys: readonly RunKey[];
  status: "running" | "done" | "cancelled" | "error";
  error?: string;
  /** Live search telemetry, forwarded verbatim from the crypto library's
   *  BatchProgressEvent. Mirrors the Stoic Digest Crypto Lab's status line:
   *  "Position N of T · prime P · X this search · Y total · Z%". `grandAttempts`
   *  is a running total across the whole batch, tracked per (index,stage) so a
   *  restated attempt count never double-counts. */
  /** Wall-clock start, for the Lab's "generated in 1m 11s · N searches/sec". */
  startedAt: number;
  /** Set once the run settles: the summary must not read the live `search`
   *  block, which stops updating mid-flight. */
  finishedAt?: number;
  finalAttempts?: number;
  search?: {
    position: number;
    totalCount: number;
    stage: "p" | "q";
    attempts: number;
    grandAttempts: number;
    percent: number;
  };
}

/**
 * ONE row of a seed's address list. A position the Codex already holds a key
 * for, a key THIS run has just delivered, or a planned position whose ~6.7 s
 * prime search has not finished — the three reconcile by index, so a position
 * is exactly one row whichever of them knows about it.
 */
type AddressRow =
  | { kind: "stored"; index: number; entry: ForeignKeyEntry }
  | { kind: "fresh"; index: number; key: RunKey }
  | { kind: "pending"; index: number };

/* ─────────────────────────────── the surface ──────────────────────────── */

export function ArweaveSeedsArea({
  seeds: seedsProp,
  onSeedDefined,
  existingKeys = [],
  ouronetAccounts = [],
  revealAccountSecret,
  chainwebSeeds = [],
  revealSeedWords,
  bipDictionary,
  generateBipPhrase,
  workerFactory,
  persistKey,
  onDeleteSeed,
  decryptArweaveKey,
  onRunActivityChange,
}: ArweaveSeedsAreaProps = {}): React.ReactElement {
  /** Seeds defined in this session. Merged with (not replacing) the prop list,
   *  so the surface works both controlled and standalone. */
  const [localSeeds, setLocalSeeds] = useState<ArweaveSeedRecord[]>([]);
  /** Seeds deleted in this session. The prop list is a snapshot a controlled
   *  consumer refreshes on its own schedule; without this the row would linger
   *  after its cascade and invite a second delete. */
  const [deletedSeedIds, setDeletedSeedIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  const seeds = useMemo<ArweaveSeedRecord[]>(() => {
    const byId = new Map<string, ArweaveSeedRecord>();
    for (const seed of seedsProp ?? []) byId.set(seed.id, seed);
    for (const seed of localSeeds) byId.set(seed.id, seed);
    for (const id of deletedSeedIds) byId.delete(id);
    const all = [...byId.values()];
    const prime = all.find((s) => s.isPrime === true) ?? all[0];
    return prime === undefined ? [] : [prime, ...all.filter((s) => s !== prime)];
  }, [seedsProp, localSeeds, deletedSeedIds]);

  const primeSeed = seeds[0];

  /** Option 2 offers ONLY dalos-curve accounts: an APOLLO account's 1024-bit
   *  bitstring is refused downstream, so offering it would be a dead option. */
  // Option 2 offers ONLY seed-words-origin accounts: the Seed-Based generator's
  // whole premise is that its 1600 bits come from words, so an account made
  // from a bitmap/bitstring/scalar has no place here — that's exclusively the
  // (separate, not-yet-built) Direct generator's territory. A missing
  // originMode (a legacy account predating that field) defaults to
  // "seedWords", matching `bitStringOf`/`rebuildFullKey`'s own fallback.
  const dalosAccounts = useMemo(
    () =>
      ouronetAccounts.filter(
        (entry) =>
          curveOf(entry.account) === "dalos" &&
          (entry.account.originMode ?? "seedWords") === "seedWords",
      ),
    [ouronetAccounts],
  );

  /** Codex-WIDE: any Arweave key under any seed lifts the ceiling. */
  const cap = existingKeys.length > 0 ? INDEX_CAP : FIRST_RUN_INDEX_CAP;

  /** An injected dictionary REPLACES the default wordlist; an absent (or empty)
   *  one leaves the BIP English default in force. */
  const dictionaryOverride = useMemo<ReadonlySet<string> | undefined>(
    () =>
      bipDictionary === undefined || bipDictionary.length === 0
        ? undefined
        : new Set(bipDictionary.map((word) => word.toLowerCase())),
    [bipDictionary],
  );

  /** The words the autocomplete offers, as an ORDERED list — the same source as
   *  `dictionaryOverride`, which is only a membership test. */
  const dictionaryWords = useMemo<readonly string[]>(
    () =>
      bipDictionary === undefined || bipDictionary.length === 0
        ? BIP_ENGLISH_WORDLIST
        : bipDictionary.map((word) => word.toLowerCase()),
    [bipDictionary],
  );

  /* ── define-seed form state ── */
  const [defining, setDefining] = useState(false);
  /** The C toggle, upper-right of the define form. `"seed-based"` is today's
   *  three-source, 1600-only form; `"direct"` is the real BitString/Bitmap/
   *  Base-10/Base-49 generator. */
  const [generatorMode, setGeneratorMode] = useState<GeneratorMode>("seed-based");
  const [source, setSource] = useState<DefineSource>("words");
  const [variant, setVariant] = useState<WordsVariant>("free");
  const [wordsText, setWordsText] = useState("");
  /** Direct mode's width toggle. Default 1600 — reset to 1600 every time the
   *  C toggle is clicked INTO Direct, so re-entering Direct always starts from
   *  the same, predictable state. */
  const [directWidth, setDirectWidth] = useState<DirectWidth>(1600);
  /** Which of the four Direct input kinds is active. */
  const [directKind, setDirectKind] = useState<DirectKind>("bitstring");
  const [directBitStringText, setDirectBitStringText] = useState("");
  const [directInt10Text, setDirectInt10Text] = useState("");
  const [directInt49Text, setDirectInt49Text] = useState("");
  const [directBitmap, setDirectBitmap] = useState<Bitmap | null>(null);
  /** The Restricted variant (1b) is a SLOT GRID, not a textarea: one rectangle
   *  per word, the same shape `CreateStoaChainSeedModal` already uses. The words
   *  therefore live as an array whose length IS the 12/24 switch. */
  const [restrictedCount, setRestrictedCount] = useState<RestrictedWordCount>(12);
  const [restrictedWords, setRestrictedWords] = useState<readonly string[]>(() =>
    emptyWordSlots(12),
  );
  const [accountChoice, setAccountChoice] = useState("");
  const [chainwebChoice, setChainwebChoice] = useState("");
  const [labelText, setLabelText] = useState("");
  const [defineError, setDefineError] = useState<string | null>(null);
  const [defining0, setDefining0] = useState(false); // in-flight (option 2 awaits a reveal)

  const defaultAccountId =
    (dalosAccounts.find((a) => a.isDefault) ?? dalosAccounts[0])?.id ?? "";
  const defaultChainwebId =
    (chainwebSeeds.find((s) => s.isDefault) ?? chainwebSeeds[0])?.id ?? "";
  const selectedAccountId = accountChoice !== "" ? accountChoice : defaultAccountId;
  const selectedChainwebId = chainwebChoice !== "" ? chainwebChoice : defaultChainwebId;

  /** The dictionary actually in force — always armed (the BIP wordlist is the
   *  default), so 1b can never silently degrade into a second 1a. */
  const dictionary = dictionaryOverride ?? BIP_ENGLISH_SET;

  /** Per slot: is the word TYPED there outside the dictionary? An empty slot is
   *  incomplete, not wrong — painting it red would make the grid red before the
   *  user has typed anything. */
  const restrictedInvalid = useMemo(
    () =>
      restrictedWords.map(
        (word) => word.trim() !== "" && restrictedWordRefusal(word.trim(), 1, dictionary) !== null,
      ),
    [restrictedWords, dictionary],
  );
  /** The first offending word, named at its 1-based position. */
  const restrictedNotice = useMemo<string | null>(() => {
    const index = restrictedInvalid.indexOf(true);
    return index === -1
      ? null
      : restrictedWordRefusal((restrictedWords[index] ?? "").trim(), index + 1, dictionary);
  }, [restrictedInvalid, restrictedWords, dictionary]);
  /** Confirm stays blocked until EVERY slot holds a dictionary word. */
  const restrictedReady =
    restrictedWords.length > 0 &&
    restrictedWords.every((word) => word.trim() !== "") &&
    !restrictedInvalid.includes(true);

  const setWordCount = useCallback((count: RestrictedWordCount): void => {
    setRestrictedCount(count);
    // Words already typed survive the switch; 24 → 12 drops only the tail.
    setRestrictedWords((prev) => Array.from({ length: count }, (_, i) => prev[i] ?? ""));
  }, []);

  /** The single flat tile the words picker currently shows as active —
   *  DERIVED from `variant`/`restrictedCount` rather than a third piece of
   *  state, so the two can never disagree about which tile is "on". */
  const seedInputTile: SeedInputTile =
    variant === "free" ? "dalos" : restrictedCount === 24 ? "dict24" : "dict12";

  /** Clicking a tile sets BOTH underlying pieces of state together: "dalos"
   *  is exactly today's Free Seed Input; "dict12"/"dict24" are Restricted
   *  Seed Input with its word count LOCKED to the tile — the tile itself IS
   *  the count now, so there is no separate nested 12/24 switch to also set. */
  const chooseSeedInputTile = useCallback(
    (tile: SeedInputTile): void => {
      if (tile === "dalos") {
        setVariant("free");
        return;
      }
      setVariant("restricted");
      setWordCount(tile === "dict24" ? 24 : 12);
    },
    [setWordCount],
  );

  /** Empties every slot at the CURRENT length. The per-slot refusals and the
   *  notice are derived from the words, so emptying them is the whole reset: an
   *  empty slot is incomplete, not wrong. The stale define error goes too — it
   *  was about words that no longer exist. */
  const clearWords = useCallback((): void => {
    setRestrictedWords((prev) => emptyWordSlots(prev.length));
    setDefineError(null);
  }, []);

  const setWordAt = useCallback((index: number, word: string): void => {
    setRestrictedWords((prev) => prev.map((entry, i) => (i === index ? word : entry)));
  }, []);

  const openDefine = useCallback(() => {
    setDefineError(null);
    setGeneratorMode("seed-based");
    setSource("words");
    setVariant("free");
    setWordsText("");
    setRestrictedCount(12);
    setRestrictedWords(emptyWordSlots(12));
    setAccountChoice("");
    setChainwebChoice("");
    setLabelText("");
    setDirectWidth(1600);
    setDirectKind("bitstring");
    setDirectBitStringText("");
    setDirectInt10Text("");
    setDirectInt49Text("");
    setDirectBitmap(null);
    setDefining(true);
  }, []);

  /** The C toggle's own handler: switching INTO Direct always resets its width
   *  to 1600, so re-entering Direct is never left showing a width toggle that
   *  silently disagrees with what is on screen (e.g. left at 1024 from a prior
   *  visit while every input field is once again empty). */
  const handleSetGeneratorMode = useCallback((next: GeneratorMode): void => {
    setGeneratorMode(next);
    if (next === "direct") setDirectWidth(1600);
  }, []);

  /** What the currently active Direct input resolves to: `null` while it is
   *  untouched, `{error}` when it cannot resolve at either supported width,
   *  or the validated `{bits, width}` on success. Pure given its inputs —
   *  `resolveDirectBitString`/`resolveDirectScalar` do the actual validation. */
  const directResolution = useMemo<DirectResolution | null>(() => {
    switch (directKind) {
      case "bitstring":
        return resolveDirectBitString(directBitStringText, directWidth);
      case "base10":
        return resolveDirectScalar(directInt10Text, 10, directWidth);
      case "base49":
        return resolveDirectScalar(directInt49Text, 49, directWidth);
      case "bitmap":
        // `BitmapKeyInput`'s rows/cols already match `directWidth` — no
        // ambiguity to resolve, and no untouched/empty state either (it
        // always emits a fully-shaped, if all-zero, bitmap).
        return directBitmap === null
          ? null
          : {
              bits: directBitmapToBits(
                directBitmap,
                directWidth === 1600 ? 40 : 32,
                directWidth === 1600 ? 40 : 32,
              ),
              width: directWidth,
            };
    }
  }, [directKind, directWidth, directBitStringText, directInt10Text, directInt49Text, directBitmap]);

  const confirmDefine = useCallback(async (): Promise<void> => {
    setDefineError(null);
    setDefining0(true);
    try {
      // Direct mode is checked FIRST, before the Seed-Based `source` chain
      // below: it shares nothing with it (no words, no account, no Chainweb
      // seed) and builds its own record, `bitLength` included.
      if (generatorMode === "direct") {
        if (directResolution === null) {
          setDefineError("Enter a value to define this seed from.");
          return;
        }
        if ("error" in directResolution) {
          setDefineError(directResolution.error);
          return;
        }
        const isPrime = primeSeed === undefined;
        const kindLabel =
          DIRECT_INPUT_KINDS.find((kind) => kind.testId === directKind)?.label ?? directKind;
        const record: ArweaveSeedRecord = {
          id: nextSeedId(),
          label: isPrime
            ? PRIME_SEED_LABEL
            : labelText.trim() !== ""
              ? labelText.trim()
              : `Arweave Seed ${seeds.length + 1}`,
          bits: directResolution.bits,
          isPrime,
          bitLength: directResolution.width,
          sourceLabel: `Direct: ${kindLabel} (${directResolution.width}-bit)`,
          // No words, ever — a Direct-defined seed has no seed words to show.
        };
        setLocalSeeds((prev) => [...prev, record]);
        onSeedDefined?.(record);
        setDefining(false);
        return;
      }

      let resolved: { bits: string } | { error: string };
      let sourceLabel: string;
      // The ACTUAL typed/decrypted words, kept alongside the derived bits so
      // the reveal modal can show them (blurred, revealable) instead of only
      // the four derived representations. Undefined when the source genuinely
      // has no words (e.g. an account whose own key material is bitstring/
      // bitmap/scalar-origin, not seed-words-origin) — the reveal falls back
      // to the bitstring-only view in that case, never a crash.
      let capturedWords: readonly string[] | undefined;

      if (source === "words") {
        let words: string[];
        if (variant === "restricted") {
          words = restrictedWords.map((word) => word.trim()).filter(Boolean);
          if (words.length !== restrictedWords.length) {
            setDefineError(`Enter all ${restrictedWords.length} words.`);
            return;
          }
          // The dictionary is ALWAYS present (the wordlist is the default), so
          // 1b can never silently fall back to 1a's charset-only check.
          const refusal = validateRestrictedSeedWords(words, dictionaryOverride);
          if (refusal !== null) {
            setDefineError(refusal);
            return;
          }
        } else {
          words = wordsText.trim().split(/\s+/).filter(Boolean);
        }
        resolved = resolveSeedBitString({ kind: "words", words });
        sourceLabel = "Typed seed words";
        capturedWords = words;
      } else if (source === "account") {
        const entry = dalosAccounts.find((a) => a.id === selectedAccountId);
        if (entry === undefined) {
          setDefineError("Pick an activated Ouronet account first.");
          return;
        }
        if (revealAccountSecret === undefined) {
          setDefineError("This build cannot read an account's key material.");
          return;
        }
        let plaintext: string | null;
        try {
          plaintext = await revealAccountSecret(entry.id);
        } catch (cause) {
          setDefineError(messageOf(cause));
          return;
        }
        if (plaintext === null || plaintext === "") {
          setDefineError(`Could not read the key material of "${entry.label}".`);
          return;
        }
        // No conversion: an account's private key ALREADY is a DALOS bitstring.
        const bits = bitStringOf(entry.account, plaintext);
        if (bits === null) {
          setDefineError(`Could not re-derive the bitstring of "${entry.label}".`);
          return;
        }
        resolved = resolveSeedBitString({ kind: "bitstring", bits });
        sourceLabel = `Ouronet account "${entry.label}"`;
        // `dalosAccounts` (this dropdown's OWN source list) already filters
        // to seed-words-origin accounts only — the Seed-Based generator's
        // whole premise is that its bits come from words, so by the time an
        // account reaches here it always has words. Unconditional, not a
        // fallback: there is no code path where `entry` lacks them.
        capturedWords = plaintext.trim().split(/\s+/).filter(Boolean);
      } else {
        const entry = chainwebSeeds.find((s) => s.id === selectedChainwebId);
        if (entry === undefined) {
          setDefineError("Pick an existing Chainweb seed first.");
          return;
        }
        // Prefer eagerly-supplied words; otherwise decrypt on demand. A host
        // holding ciphertext supplies `revealSeedWords` so the mnemonic only
        // exists in memory for the seed the user actually chose.
        let words = entry.words;
        if (words === undefined) {
          if (revealSeedWords === undefined) {
            setDefineError(
              "This build cannot read Chainweb seed words — no decrypt seam was injected.",
            );
            return;
          }
          const revealed = await revealSeedWords(entry.id);
          if (revealed === null || revealed.length === 0) {
            setDefineError("Could not decrypt that Chainweb seed. Unlock the codex and retry.");
            return;
          }
          words = revealed;
        }
        resolved = resolveSeedBitString({ kind: "words", words });
        sourceLabel = `Chainweb seed "${entry.label}"`;
        capturedWords = words;
      }

      if ("error" in resolved) {
        setDefineError(resolved.error);
        return;
      }

      const isPrime = primeSeed === undefined;
      const record: ArweaveSeedRecord = {
        id: nextSeedId(),
        // The Prime seed's name is FIXED — the form shows it read-only, and the
        // record ignores `labelText` entirely so no forced value can land here.
        label: isPrime
          ? PRIME_SEED_LABEL
          : labelText.trim() !== ""
            ? labelText.trim()
            : `Arweave Seed ${seeds.length + 1}`,
        bits: resolved.bits,
        isPrime,
        sourceLabel,
        words: capturedWords,
      };
      setLocalSeeds((prev) => [...prev, record]);
      onSeedDefined?.(record);
      setDefining(false);
    } finally {
      setDefining0(false);
    }
  }, [
    generatorMode,
    directResolution,
    directKind,
    source,
    variant,
    wordsText,
    restrictedWords,
    dictionaryOverride,
    dalosAccounts,
    selectedAccountId,
    revealAccountSecret,
    chainwebSeeds,
    selectedChainwebId,
    labelText,
    primeSeed,
    seeds.length,
    onSeedDefined,
  ]);

  const fillRandomPhrase = useCallback(async (): Promise<void> => {
    const generated = await (generateBipPhrase ?? defaultGenerateBipPhrase)(restrictedCount);
    const words = [...generated].map((word) => word.trim().toLowerCase()).filter(Boolean);
    // The default generator already honours the switch. An INJECTED generator
    // may disagree — adopt its length when it is one the switch can show, so no
    // generated word is silently dropped.
    const count: RestrictedWordCount =
      words.length === 12 || words.length === 24 ? words.length : restrictedCount;
    setRestrictedCount(count);
    setRestrictedWords(Array.from({ length: count }, (_, i) => words[i] ?? ""));
  }, [generateBipPhrase, restrictedCount]);

  /* ── generation state ── */
  const [openSeedId, setOpenSeedId] = useState<string | null>(null);
  const [mode, setMode] = useState<GenerateMode>("default");
  const [positionText, setPositionText] = useState("1");
  const [upToText, setUpToText] = useState("10");
  const [rangesText, setRangesText] = useState("");
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [run, setRun] = useState<RunState | null>(null);
  /** The run in flight, WITH the seed it belongs to: deleting that seed must
   *  abort it, and deleting any OTHER seed must not. */
  const abortRef = useRef<{ seedId: string; controller: AbortController } | null>(null);
  /** Indices persisted in THIS session, per seed — the prop list is a snapshot
   *  and does not update mid-run, so the guard needs both. */
  const storedRef = useRef<Map<string, Set<number>>>(new Map());

  const buildSelection = useCallback((): IndexSelection | { error: string } => {
    switch (mode) {
      case "default":
        return { kind: "default" };
      case "single":
        return { kind: "single", position: parseIndexField(positionText) };
      case "upTo":
        return { kind: "upTo", n: parseIndexField(upToText) };
      case "ranges":
        return parseRangeList(rangesText);
    }
  }, [mode, positionText, upToText, rangesText]);

  const startRun = useCallback(
    async (seed: ArweaveSeedRecord, explicitSelection?: IndexSelection): Promise<void> => {
      setGenerateError(null);

      // Quick Define passes `{kind:"default"}` DIRECTLY rather than relying on
      // `buildSelection()`'s read of `mode`/`positionText` component state —
      // reading that state in the same handler that just set it would be a
      // stale-closure hazard. `buildSelection()` runs ONLY when no explicit
      // selection is supplied, so every other call site is unaffected.
      const selection = explicitSelection ?? buildSelection();
      if ("error" in selection) {
        setGenerateError(selection.error);
        return;
      }

      let sessionIndices = storedRef.current.get(seed.id);
      if (sessionIndices === undefined) {
        sessionIndices = new Set<number>();
        storedRef.current.set(seed.id, sessionIndices);
      }
      const held = new Set<number>([
        ...indicesOfSeed(existingKeys, seed.id),
        ...sessionIndices,
      ]);

      // The OPTIMISATION step: never pay ~6.7 s for an index already held.
      const plan = planIndexRanges({ selection, existing: [...held], cap });
      if ("error" in plan) {
        setGenerateError(plan.error);
        return;
      }
      if (workerFactory === undefined || persistKey === undefined) {
        setGenerateError(
          "Key generation is not wired in this build — no worker/persistence seam was injected.",
        );
        return;
      }
      if (plan.ranges.length === 0) {
        setGenerateError("Every requested position already has a key — nothing to generate.");
        return;
      }

      const controller = new AbortController();
      abortRef.current = { seedId: seed.id, controller };
      setRun({
        seedId: seed.id,
        stored: 0,
        // The planner emits SINGLETON ranges, so one range is one position.
        total: plan.ranges.length,
        planned: plan.ranges.map((range) => range.start),
        keys: [],
        status: "running",
        startedAt: Date.now(),
      });

      // Per-(index,stage) high-water marks + the running grand total the
      // status line shows. Local to this run, reset with it.
      const attemptsSeen = new Map<string, number>();
      let grandAttempts = 0;

      try {
        const result = await runSeededBatch({
          bits: seed.bits,
          ranges: plan.ranges,
          workerFactory,
          signal: controller.signal,
          onBatchProgress: (ev) => {
            // Cumulative attempts across the run: keep the LATEST attempt count
            // per (index,stage) and maintain the grand total in O(1), exactly as
            // the Crypto Lab does — the library restates `attempts` for the
            // search in flight, so summing raw events would over-count.
            const k = `${ev.index}:${ev.stage}`;
            const prev = attemptsSeen.get(k) ?? 0;
            grandAttempts += ev.attempts - prev;
            attemptsSeen.set(k, ev.attempts);
            setRun((r) =>
              r === null
                ? r
                : {
                    ...r,
                    search: {
                      position: ev.completedCount + 1,
                      totalCount: ev.totalCount,
                      stage: ev.stage,
                      attempts: ev.attempts,
                      grandAttempts,
                      percent: Math.round(ev.overallProgress * 100),
                    },
                  },
            );
          },
          onKey: (key) => {
            // ── THE NEVER-CLOBBER GUARD ──
            // Applied to EVERY index, not just the ones the planner kept: the
            // library force-generates #0 on every call whatever `ranges` says,
            // so storing blindly would destroy the user's existing key #0.
            if (held.has(key.index)) return;
            held.add(key.index);
            sessionIndices.add(key.index);

            // Persisted AS IT ARRIVES — at ~6.7 s/key nothing may wait for the
            // batch terminal that a cancel or a closed tab might never reach.
            void (async () => {
              try {
                await persistKey({
                  seedId: seed.id,
                  index: key.index,
                  jwk: key.jwk,
                  address: key.address,
                });
                setRun((prev) =>
                  prev === null || prev.seedId !== seed.id
                    ? prev
                    : {
                        ...prev,
                        stored: prev.stored + 1,
                        keys: [
                          ...prev.keys,
                          { index: key.index, address: key.address, jwk: key.jwk },
                        ],
                      },
                );
              } catch (cause) {
                // Un-mark so a later run can retry this index.
                held.delete(key.index);
                sessionIndices.delete(key.index);
                setGenerateError(`Could not store #${key.index}: ${messageOf(cause)}`);
              }
            })();
          },
        });
        setRun((prev) =>
          prev === null
            ? prev
            : {
                ...prev,
                status: result.cancelled ? "cancelled" : "done",
                // Freeze the totals the summary reports — `search` tracks the
                // search IN FLIGHT and stops updating the moment the run ends.
                finalAttempts: grandAttempts,
                finishedAt: Date.now(),
              },
        );
      } catch (cause) {
        setRun((prev) =>
          prev === null ? prev : { ...prev, status: "error", error: messageOf(cause) },
        );
      } finally {
        abortRef.current = null;
      }
    },
    [buildSelection, existingKeys, cap, workerFactory, persistKey],
  );

  const cancelRun = useCallback((): void => {
    abortRef.current?.controller.abort();
  }, []);

  const running = run !== null && run.status === "running";

  /** The CodexPrime account Quick Define resolves against. Prefers the
   *  explicit `isDefault` flag (the account the codex kickstart marks
   *  `isPrime: true`), but — matching `defaultAccountId`'s OWN fallback to
   *  `dalosAccounts[0]` a few lines up — falls back to the first activated
   *  dalos-curve account when nothing is explicitly flagged prime. A codex
   *  that never went through fresh kickstart (an older or imported codex)
   *  can have activated dalos accounts with no `isPrime` flag on any of them;
   *  refusing to guess there left Quick Define permanently disabled for
   *  exactly the codices it exists to help. */
  const quickDefineAccount = dalosAccounts.find((a) => a.isDefault === true) ?? dalosAccounts[0];
  const canQuickDefine =
    quickDefineAccount !== undefined &&
    revealAccountSecret !== undefined &&
    workerFactory !== undefined &&
    persistKey !== undefined;
  const quickDefineDisabledReason =
    quickDefineAccount === undefined
      ? "No activated dalos-curve Ouronet account exists in this Codex."
      : "Key generation is not wired in this build — no worker/persistence seam was injected.";

  /**
   * Quick Define (D): the Option-2 code path, run against the CodexPrime
   * account specifically, with NO form and an immediate position-0-only
   * generate. One click, no dialog — any failure surfaces through the SAME
   * `defineError` the Custom form uses and leaves NOTHING half-done: the
   * record is only built, added and run once every prior step has succeeded.
   */
  const handleQuickDefine = useCallback(async (): Promise<void> => {
    setDefineError(null);
    const entry = quickDefineAccount;
    if (entry === undefined || revealAccountSecret === undefined) {
      setDefineError(quickDefineDisabledReason);
      return;
    }
    setDefining0(true);
    try {
      let plaintext: string | null;
      try {
        plaintext = await revealAccountSecret(entry.id);
      } catch (cause) {
        setDefineError(messageOf(cause));
        return;
      }
      if (plaintext === null || plaintext === "") {
        setDefineError(`Could not read the key material of "${entry.label}".`);
        return;
      }
      const bits = bitStringOf(entry.account, plaintext);
      if (bits === null) {
        setDefineError(`Could not re-derive the bitstring of "${entry.label}".`);
        return;
      }
      const resolved = resolveSeedBitString({ kind: "bitstring", bits });
      if ("error" in resolved) {
        setDefineError(resolved.error);
        return;
      }
      const record: ArweaveSeedRecord = {
        id: nextSeedId(),
        label: PRIME_SEED_LABEL,
        bits: resolved.bits,
        isPrime: true,
        sourceLabel: `CodexPrime Ouronet account "${entry.label}" (Quick Define)`,
        // `quickDefineAccount` is drawn from the same seed-words-origin-only
        // `dalosAccounts` list as the Custom account branch — always words.
        words: plaintext.trim().split(/\s+/).filter(Boolean),
      };
      setLocalSeeds((prev) => [...prev, record]);
      onSeedDefined?.(record);
      // Exactly position 0 — bypasses the component's `mode` state entirely.
      void startRun(record, { kind: "default" });
    } finally {
      setDefining0(false);
    }
  }, [
    quickDefineAccount,
    quickDefineDisabledReason,
    revealAccountSecret,
    onSeedDefined,
    startRun,
  ]);

  /** Reports the run's live activity up to the parent (design.md ask A), so a
   *  category switch or a tab close mid-generation can offer to stop it
   *  instead of silently losing its progress bar and Cancel button. Fires
   *  `null` the instant the run is not `"running"`, including on unmount —
   *  a stale activity must never outlive the run (or this component). */
  useEffect(() => {
    if (run !== null && run.status === "running") {
      const runningSeed = seeds.find((s) => s.id === run.seedId);
      onRunActivityChange?.({
        seedLabel: runningSeed?.label ?? PRIME_SEED_LABEL,
        cancel: cancelRun,
      });
      return () => onRunActivityChange?.(null);
    }
    onRunActivityChange?.(null);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.status, run?.seedId, seeds, cancelRun, onRunActivityChange]);

  /* ── deletion ── */
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  /**
   * Deletes a seed and, WITH it, every key derived from it.
   *
   * Two things happen before the callback. A run in flight against THIS seed is
   * aborted: at ~6.7 s/key it can be minutes long, and it would otherwise keep
   * persisting keys for a seed that no longer exists — re-creating the exact
   * orphans the cascade exists to prevent. And the session index memory for the
   * seed is dropped, so a later seed reusing the id starts from the store.
   */
  const confirmDelete = useCallback(
    (seed: ArweaveSeedRecord): void => {
      if (abortRef.current?.seedId === seed.id) abortRef.current.controller.abort();
      storedRef.current.delete(seed.id);
      setPendingDeleteId((prev) => (prev === seed.id ? null : prev));
      setLocalSeeds((prev) => prev.filter((entry) => entry.id !== seed.id));
      setDeletedSeedIds((prev) => new Set(prev).add(seed.id));
      void onDeleteSeed?.({ seedId: seed.id, keyIds: keyIdsOfSeed(existingKeys, seed.id) });
    },
    [existingKeys, onDeleteSeed],
  );

  /* ─────────────────────────────── render ─────────────────────────────── */

  return (
    <div
      data-testid="arweave-seeds-area"
      style={{ display: "flex", flexDirection: "column", gap: 12, color: "#d2d3d4" }}
    >
      {/* The Prime Arweave Seed ALWAYS occupies the first row — defined or not.
          In a Codex with no Arweave material this row IS the entry point. */}
      {primeSeed === undefined ? (
        <>
          <div
            data-testid="arweave-prime-seed-row"
            data-defined="false"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "16px 18px",
              borderRadius: 12,
              border: "1px dashed #262626",
              backgroundColor: "#0a0a0a",
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{PRIME_SEED_LABEL}</div>
              <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>
                Undefined — no Arweave address can exist until it is defined.
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {/* An imported/legacy key with no seed still counts as "an
                  Arweave account exists" — Quick Define only ever offers to
                  define the FIRST-EVER seed of an otherwise-empty Codex. */}
              {existingKeys.length === 0 && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                  <button
                    type="button"
                    data-testid="arweave-seed-quick-define"
                    onClick={() => void handleQuickDefine()}
                    disabled={!canQuickDefine || defining0}
                    title={!canQuickDefine ? quickDefineDisabledReason : undefined}
                    style={{
                      ...secondaryButtonStyle,
                      opacity: !canQuickDefine || defining0 ? 0.5 : 1,
                    }}
                  >
                    {defining0 ? "Defining…" : "Quick Define"}
                  </button>
                  {/* The disabled REASON, always visible — a hover-only title
                      is easy to miss and gives no way to report back what is
                      actually missing. */}
                  {!canQuickDefine && (
                    <span
                      data-testid="arweave-seed-quick-define-disabled-reason"
                      style={{ fontSize: 11, color: "#888", maxWidth: 220, textAlign: "right" }}
                    >
                      {quickDefineDisabledReason}
                    </span>
                  )}
                </div>
              )}
              <button
                type="button"
                data-testid="arweave-seed-custom-define"
                onClick={openDefine}
                style={primaryButtonStyle}
              >
                Custom Define Arweave Seed
              </button>
            </div>
          </div>
          {defineError !== null && (
            <div data-testid="arweave-seed-quick-define-error" style={errorStyle}>
              {defineError}
            </div>
          )}
        </>
      ) : (
        seeds.map((seed) => (
          <React.Fragment key={seed.id}>
            <SeedRow
              seed={seed}
              isPrime={seed === primeSeed}
              open={openSeedId === seed.id}
              onToggle={() => setOpenSeedId((prev) => (prev === seed.id ? null : seed.id))}
              keys={existingKeys}
              confirmingDelete={pendingDeleteId === seed.id}
              onRequestDelete={() => setPendingDeleteId(seed.id)}
              onCancelDelete={() => setPendingDeleteId(null)}
              onConfirmDelete={() => confirmDelete(seed)}
              decryptKey={decryptArweaveKey}
              run={run !== null && run.seedId === seed.id ? run : null}
            >
              <GenerateControls
                cap={cap}
                mode={mode}
                setMode={setMode}
                positionText={positionText}
                setPositionText={setPositionText}
                upToText={upToText}
                setUpToText={setUpToText}
                rangesText={rangesText}
                setRangesText={setRangesText}
                error={generateError}
                run={run !== null && run.seedId === seed.id ? run : null}
                running={running}
                canGenerate={workerFactory !== undefined && persistKey !== undefined}
                onRun={() => void startRun(seed)}
                onCancel={cancelRun}
              />
            </SeedRow>
            {/* The separator marks the boundary between the Prime seed and
                every other one — ported from `SeedWordsTab.tsx`, only when
                there IS a "rest" to separate it from. */}
            {seed === primeSeed && seeds.length > 1 && <PrimeSeparator label="Other Seeds" />}
          </React.Fragment>
        ))
      )}

      {primeSeed !== undefined && !defining && (
        <button
          type="button"
          data-testid="arweave-add-seed"
          onClick={openDefine}
          style={{ ...secondaryButtonStyle, alignSelf: "flex-start" }}
        >
          <PlusGlyph style={{ width: 13, height: 13 }} />
          Add Arweave Seed
        </button>
      )}

      {defining && (
        <DefineSeedForm
          primeDefinition={primeSeed === undefined}
          generatorMode={generatorMode}
          setGeneratorMode={handleSetGeneratorMode}
          directWidth={directWidth}
          setDirectWidth={setDirectWidth}
          directKind={directKind}
          setDirectKind={setDirectKind}
          directBitStringText={directBitStringText}
          setDirectBitStringText={setDirectBitStringText}
          directInt10Text={directInt10Text}
          setDirectInt10Text={setDirectInt10Text}
          directInt49Text={directInt49Text}
          setDirectInt49Text={setDirectInt49Text}
          directBitmap={directBitmap}
          setDirectBitmap={setDirectBitmap}
          directResolution={directResolution}
          source={source}
          setSource={setSource}
          seedInputTile={seedInputTile}
          setSeedInputTile={chooseSeedInputTile}
          wordsText={wordsText}
          setWordsText={setWordsText}
          restrictedWords={restrictedWords}
          setWordAt={setWordAt}
          restrictedInvalid={restrictedInvalid}
          restrictedNotice={restrictedNotice}
          dictionaryWords={dictionaryWords}
          confirmBlocked={source === "words" && variant === "restricted" && !restrictedReady}
          labelText={labelText}
          setLabelText={setLabelText}
          accounts={dalosAccounts}
          selectedAccountId={selectedAccountId}
          setAccountChoice={setAccountChoice}
          chainwebSeeds={chainwebSeeds}
          selectedChainwebId={selectedChainwebId}
          setChainwebChoice={setChainwebChoice}
          onGeneratePhrase={() => void fillRandomPhrase()}
          onClearWords={clearWords}
          busy={defining0}
          error={defineError}
          onConfirm={() => void confirmDefine()}
          onCancel={() => setDefining(false)}
        />
      )}
    </div>
  );
}

/* ──────────────────────────────── pieces ──────────────────────────────── */

const primaryButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 14px",
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  border: `1px solid ${ACCENT}`,
  backgroundColor: `${ACCENT}1a`,
  color: ACCENT,
  whiteSpace: "nowrap",
};

const secondaryButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  border: "1px solid #262626",
  backgroundColor: "transparent",
  color: "#888",
};

const errorStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #7f1d1d",
  backgroundColor: "#1a0a0a",
  color: "#f87171",
  fontSize: 12,
  overflowWrap: "anywhere",
};

/** The View Seed overlay's empty-`bits` notice — an EXPECTED state (the host
 *  has not decrypted this seed yet), not an error, so it gets the muted,
 *  dashed "not available" treatment (`ArweavePanel.tsx`'s `EMPTY_STYLE`
 *  pattern) rather than `errorStyle`'s red alarm. */
const revealLockedStyle: React.CSSProperties = {
  padding: "16px 14px",
  borderRadius: 10,
  border: "1px dashed #262626",
  color: "#888",
  fontSize: 13,
};

/** A labelled divider between the Prime seed and the rest — ported VERBATIM
 *  from `SeedWordsTab.tsx`'s `PrimeSeparator` (down to the exact colours), so
 *  the two "Prime + Other Seeds" surfaces read as one visual language. */
function PrimeSeparator({ label }: { label: string }): React.ReactElement {
  return (
    <div
      data-testid="arweave-seed-separator"
      style={{ display: "flex", alignItems: "center", gap: 10, margin: "2px 0" }}
    >
      <div style={{ flex: 1, height: 1, backgroundColor: "#262626" }} />
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "#555",
        }}
      >
        {label}
      </span>
      <div style={{ flex: 1, height: 1, backgroundColor: "#262626" }} />
    </div>
  );
}

function SeedRow({
  seed,
  isPrime,
  open,
  onToggle,
  keys,
  confirmingDelete,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  decryptKey,
  run,
  children,
}: {
  seed: ArweaveSeedRecord;
  isPrime: boolean;
  open: boolean;
  onToggle: () => void;
  keys: readonly ForeignKeyEntry[];
  confirmingDelete: boolean;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  /** On-demand decrypt of ONE stored key, so its RSA parameters can be shown. */
  decryptKey?: (entry: ForeignKeyEntry) => Promise<ArweaveJwk>;
  /** The run in flight against THIS seed, or `null`. It is what puts the
   *  planned-but-not-yet-generated positions into the list below. */
  run: RunState | null;
  /** The generate box. Rendered FIRST, above the address list. */
  children: React.ReactNode;
}): React.ReactElement {
  /** Whether this row's "View Seed" overlay is open (arweave-seed-reveal-v1). */
  const [revealOpen, setRevealOpen] = useState(false);

  /**
   * The seed's address list, position by position — the ONE list, which is why
   * a run's output no longer lives inside the generate box.
   *
   * Keyed by index so the three sources reconcile instead of stacking: a key
   * delivered by the run in flight REPLACES the pending row of its own
   * position, and replaces the stored snapshot of that index too (same key —
   * but this copy already holds its JWK, so its parameters open without a
   * decrypt, and the row is never drawn twice once the consumer refreshes
   * `existingKeys` mid-run).
   */
  const rows = useMemo<AddressRow[]>(() => {
    const byIndex = new Map<number, AddressRow>();
    for (const entry of keys) {
      if (entry.seedId !== seed.id || typeof entry.index !== "number") continue;
      byIndex.set(entry.index, { kind: "stored", index: entry.index, entry });
    }
    if (run !== null) {
      // Pending rows exist ONLY while the run is alive. At ~6.7 s per key a
      // 100-position run is minutes of apparently nothing happening, so every
      // planned position is on screen from the first second — and the moment
      // the run settles (cancelled, failed or finished) an unfilled position
      // is not an address the user has, so it is taken away rather than left
      // as an empty row.
      if (run.status === "running") {
        for (const index of run.planned) {
          if (!byIndex.has(index)) byIndex.set(index, { kind: "pending", index });
        }
      }
      for (const key of run.keys) {
        byIndex.set(key.index, { kind: "fresh", index: key.index, key });
      }
    }
    return [...byIndex.values()].sort((a, b) => a.index - b.index);
  }, [keys, seed.id, run]);

  /** The badge counts ADDRESSES, never the positions still being searched for. */
  const addressCount = rows.filter((row) => row.kind !== "pending").length;
  /** What the cascade will take — every entry of this seed, indexed or not. */
  const derivedCount = useMemo(
    () => keys.filter((k) => k.seedId === seed.id).length,
    [keys, seed.id],
  );

  return (
    <div
      data-testid={isPrime ? "arweave-prime-seed-row" : `arweave-seed-row-${seed.id}`}
      data-defined="true"
      data-seed-id={seed.id}
      style={{
        border: isPrime ? "1px solid #ceac5f40" : "1px solid #262626",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", backgroundColor: "#0d0d0d" }}>
        <button
          type="button"
          data-testid={`arweave-seed-toggle-${seed.id}`}
          aria-expanded={open}
          onClick={onToggle}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flex: 1,
            minWidth: 0,
            padding: "12px 14px",
            cursor: "pointer",
            border: "none",
            backgroundColor: "transparent",
            textAlign: "left",
            color: "inherit",
          }}
        >
          {/* The Prime row swaps its chevron for a lock — decorative only:
              the toggle still opens/closes the row exactly as before. */}
          {isPrime ? (
            <LockGlyph style={{ width: 16, height: 16, flexShrink: 0, color: "#ceac5f" }} />
          ) : open ? (
            <ChevronDownGlyph style={{ width: 16, height: 16, flexShrink: 0, color: ACCENT }} />
          ) : (
            <ChevronRightGlyph style={{ width: 16, height: 16, flexShrink: 0, color: "#555" }} />
          )}
          <span style={{ flex: 1 }}>
            <span
              style={{
                fontWeight: 600,
                fontSize: 14,
                display: "block",
                color: isPrime ? "#ceac5f" : "#d2d3d4",
              }}
            >
              {seed.label}
            </span>
            {/* The seed BITS are key material and are never rendered — only their
                width, which is a fixed, public property of every Arweave seed.
                `bitLength` is absent for every Seed-Based seed (always 1600,
                DALOS); a Direct-mode seed sets it explicitly, and a 1024-bit
                one is APOLLO, not DALOS — this must not lie about either. */}
            <span style={{ fontSize: 11, color: "#666" }}>
              {`${seed.bitLength ?? SEED_BIT_LENGTH}-bit ${
                (seed.bitLength ?? SEED_BIT_LENGTH) === 1024 ? "APOLLO" : "DALOS"
              } seed`}
              {isPrime ? " · Prime" : ""}
            </span>
          </span>
          {/* `SeedWordsTab.tsx`'s exact badge style, ported verbatim. */}
          {isPrime && (
            <span
              data-testid="arweave-prime-badge"
              style={{
                flexShrink: 0,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 8px",
                borderRadius: 9999,
                fontSize: 10,
                fontWeight: 600,
                color: "#ceac5f",
                backgroundColor: "#ceac5f20",
              }}
            >
              {"\u{1F512} Prime"}
            </span>
          )}
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "1px 8px",
              borderRadius: 9999,
              color: "#555",
              backgroundColor: "#1a1a1a",
            }}
          >
            {addressCount}
          </span>
        </button>
        {/* View this seed's key material (arweave-seed-reveal-v1) — same
            visual weight as the delete button beside it. */}
        <button
          type="button"
          data-testid={`arweave-seed-reveal-${seed.id}`}
          aria-label={`View ${seed.label}`}
          title="View this seed's key material"
          onClick={() => setRevealOpen(true)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "10px 14px",
            border: "none",
            backgroundColor: "transparent",
            color: "#888",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          <EyeGlyph style={{ width: 15, height: 15 }} />
          View Seed
        </button>
        {/* The Prime seed is deletable FOR NOW (development): the shipped build
            makes it permanent, and only the warning copy ships in this pass. */}
        <button
          type="button"
          data-testid={`arweave-seed-delete-${seed.id}`}
          aria-label={`Delete ${seed.label}`}
          title="Delete this seed and every Arweave key derived from it"
          onClick={onRequestDelete}
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "10px 14px",
            border: "none",
            backgroundColor: "transparent",
            color: confirmingDelete ? "#f87171" : "#666",
            cursor: "pointer",
          }}
        >
          <TrashGlyph style={{ width: 15, height: 15 }} />
        </button>
      </div>

      {confirmingDelete && (
        <div
          data-testid={`arweave-seed-delete-confirm-panel-${seed.id}`}
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
            padding: "10px 14px",
            borderTop: "1px solid #7f1d1d",
            backgroundColor: "#1a0a0a",
            fontSize: 12,
            color: "#f87171",
          }}
        >
          <span style={{ flex: 1, minWidth: 220 }}>
            {`Delete "${seed.label}" and the ${derivedCount} Arweave ${
              derivedCount === 1 ? "key" : "keys"
            } derived from it? Those keys cannot be regenerated without this seed.`}
          </span>
          <button
            type="button"
            data-testid={`arweave-seed-delete-confirm-${seed.id}`}
            onClick={onConfirmDelete}
            style={{ ...secondaryButtonStyle, border: "1px solid #7f1d1d", color: "#f87171" }}
          >
            Delete seed and keys
          </button>
          <button
            type="button"
            data-testid={`arweave-seed-delete-cancel-${seed.id}`}
            onClick={onCancelDelete}
            style={secondaryButtonStyle}
          >
            Keep
          </button>
        </div>
      )}

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 12 }}>
          {/* The generate box FIRST. It is the control the list below GROWS
              from: under a seed holding two hundred addresses it would
              otherwise sit a screenful down, and a run's Cancel with it. */}
          {children}
          {rows.length === 0 ? (
            <div
              data-testid={`arweave-seed-unused-${seed.id}`}
              style={{ fontSize: 12, color: "#666" }}
            >
              Unused — this seed has generated no Arweave addresses yet.
            </div>
          ) : (
            <div
              data-testid={`arweave-seed-addresses-${seed.id}`}
              style={{ display: "flex", flexDirection: "column", gap: 6 }}
            >
              {/* A STORED key gets the SAME RSA-parameter panel a freshly
                  generated one does — that panel used to hang off the run list
                  alone, so it vanished for every key the user came back to.
                  The JWK is ciphertext here, so it is decrypted ON EXPAND. */}
              {rows.map((row) =>
                row.kind === "pending" ? (
                  <PendingKeyRow key={`pending-${row.index}`} index={row.index} />
                ) : row.kind === "fresh" ? (
                  <ArweaveKeyRow
                    key={`fresh-${row.index}`}
                    prefix="arweave-generate-key"
                    index={row.index}
                    address={row.key.address}
                    jwk={row.key.jwk}
                  />
                ) : (
                  <ArweaveKeyRow
                    key={row.entry.id}
                    prefix="arweave-seed-key"
                    index={row.index}
                    address={row.entry.address ?? row.entry.id}
                    loadJwk={
                      decryptKey === undefined ? undefined : () => decryptKey(row.entry)
                    }
                  />
                ),
              )}
            </div>
          )}
        </div>
      )}

      {revealOpen && (
        // The SAME popup chrome ViewSeedModal (Ouronet accounts) renders
        // into, at the SAME maxWidth — unified, not just size-matched, so an
        // Ouronet account's Secret Reveal and an Arweave seed's read as one
        // surface rather than two differently-built lookalikes.
        <CodexModalShell
          title={`View ${seed.label}`}
          onClose={() => setRevealOpen(false)}
          maxWidth={880}
          dialogTestId={`arweave-seed-reveal-modal-${seed.id}`}
          closeTestId="arweave-seed-reveal-close"
        >
          {seed.bits === "" ? (
            // A seed exists but the host has not decrypted it yet (locked
            // codex) — `DalosSecretReveal` must NEVER mount on an empty
            // plaintext (its own derivation would just fail silently).
            <div data-testid="arweave-seed-reveal-locked" style={revealLockedStyle}>
              This seed's material could not be decrypted — the codex may be
              locked.
            </div>
          ) : seed.words !== undefined && seed.words.length > 0 ? (
            // The seed genuinely has typed/decrypted words (typed-words,
            // Chainweb-seed, or a seed-words-origin account source) —
            // `originMode="seedWords"` gives it DalosSecretReveal's Seed
            // tab (blurred, revealable via the SAME Reveal/Hide toggle every
            // other representation already uses) IN ADDITION to the four
            // derived tabs, not instead of them.
            <DalosSecretReveal
              plaintext={seed.words.join(" ")}
              originMode="seedWords"
              originCurve="dalos"
              sourceLabelOverride={seed.sourceLabel}
              hideAddress
            />
          ) : (
            // No words — either a bitstring-origin Seed-Based source or a
            // Direct-mode seed (which NEVER sets `words`). `originCurve` must
            // match the seed's ACTUAL width: a 1024-bit Direct seed is APOLLO,
            // and passing "dalos" here would make `DalosSecretReveal` derive
            // (and size its Bitmap tab) on the wrong curve entirely.
            <DalosSecretReveal
              plaintext={seed.bits}
              originMode="bitString"
              originCurve={(seed.bitLength ?? SEED_BIT_LENGTH) === 1024 ? "apollo" : "dalos"}
              sourceLabelOverride={seed.sourceLabel}
              hideAddress
            />
          )}
        </CodexModalShell>
      )}
    </div>
  );
}

function GenerateControls({
  cap,
  mode,
  setMode,
  positionText,
  setPositionText,
  upToText,
  setUpToText,
  rangesText,
  setRangesText,
  error,
  run,
  running,
  canGenerate,
  onRun,
  onCancel,
}: {
  cap: number;
  mode: GenerateMode;
  setMode: (m: GenerateMode) => void;
  positionText: string;
  setPositionText: (v: string) => void;
  upToText: string;
  setUpToText: (v: string) => void;
  rangesText: string;
  setRangesText: (v: string) => void;
  error: string | null;
  run: RunState | null;
  running: boolean;
  canGenerate: boolean;
  onRun: () => void;
  onCancel: () => void;
}): React.ReactElement {
  return (
    <div
      data-testid="arweave-generate-controls"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 12,
        borderRadius: 10,
        border: "1px solid #1a1a1a",
        backgroundColor: "#0a0a0a",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <label style={{ fontSize: 12, color: "#888" }} htmlFor="arweave-generate-mode">
          Positions
        </label>
        <select
          id="arweave-generate-mode"
          data-testid="arweave-generate-mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as GenerateMode)}
          style={selectStyle}
        >
          <option value="default">Default — just #0</option>
          <option value="single">Custom position — #0 plus one more</option>
          <option value="upTo">Up to — #0 through N</option>
          <option value="ranges">Skipping intervals — a list of ranges</option>
        </select>

        {mode === "single" && (
          <input
            type="number"
            min={0}
            data-testid="arweave-generate-position"
            aria-label="Extra position"
            value={positionText}
            onChange={(e) => setPositionText(e.target.value)}
            style={inputStyle}
          />
        )}
        {mode === "upTo" && (
          <input
            type="number"
            min={0}
            data-testid="arweave-generate-upto"
            aria-label="Highest position"
            value={upToText}
            onChange={(e) => setUpToText(e.target.value)}
            style={inputStyle}
          />
        )}
        {mode === "ranges" && (
          <input
            type="text"
            placeholder="3-7, 12, 20-22"
            data-testid="arweave-generate-ranges"
            aria-label="Intervals"
            value={rangesText}
            onChange={(e) => setRangesText(e.target.value)}
            style={{ ...inputStyle, width: 180 }}
          />
        )}

        <button
          type="button"
          data-testid="arweave-generate-run"
          onClick={onRun}
          disabled={running || !canGenerate}
          style={{ ...primaryButtonStyle, opacity: running || !canGenerate ? 0.5 : 1 }}
        >
          Generate
        </button>
        {running && (
          <button
            type="button"
            data-testid="arweave-generate-cancel"
            onClick={onCancel}
            style={secondaryButtonStyle}
          >
            Cancel
          </button>
        )}
      </div>

      {/* The ACTIVE limit, stated plainly — it is the only thing between the
          user and a multi-hour run. Kept free of any other number. */}
      <div data-testid="arweave-generate-limit" style={{ fontSize: 11, color: "#666" }}>
        {`Per-run limit: ${cap} positions`}
      </div>
      {cap === FIRST_RUN_INDEX_CAP && (
        <div data-testid="arweave-generate-limit-note" style={{ fontSize: 11, color: "#555" }}>
          {`At roughly 6.7 s per key this is about 11 minutes. The limit rises to ${INDEX_CAP} once this Codex holds its first Arweave key.`}
        </div>
      )}
      {!canGenerate && (
        <div data-testid="arweave-generate-unwired" style={{ fontSize: 11, color: "#555" }}>
          Key generation is not wired in this build — no worker/persistence seam was injected.
        </div>
      )}

      {run !== null && <RunProgress run={run} />}

      {error !== null && (
        <div data-testid="arweave-generate-error" style={errorStyle}>
          {error}
        </div>
      )}
    </div>
  );
}

/**
 * The run's progress display — the whole of what the user sees during a wait
 * that is measured in minutes or hours.
 *
 * At ~6.7 s per key the two questions a long run has to answer continuously are
 * "is it alive?" and "how much longer?". So it states the position CURRENTLY
 * under prime search (not merely the last one finished — a 6.7 s silence after
 * the last line is indistinguishable from a hang), where that position sits in
 * the run, the proportion done, and the remaining time in units a human waits
 * in.
 *
 * What it deliberately does NOT hold is the keys themselves. The generate box
 * is for choosing a run and watching it; the keys belong to the ONE address
 * list below it, where a position keeps the same row from the moment it is
 * planned to long after the run is over.
 */
function RunProgress({ run }: { run: RunState }): React.ReactElement {
  const delivered = useMemo(() => new Set(run.keys.map((key) => key.index)), [run.keys]);
  /** The first planned position with no key yet — the one being searched for. */
  const currentIndex = run.planned.find((index) => !delivered.has(index));
  const position =
    currentIndex === undefined ? run.total : run.planned.indexOf(currentIndex) + 1;
  // While a search is in flight the bar tracks the LIBRARY's own
  // `overallProgress` — a key takes ~6.7 s, so a bar that only moved on a
  // completed key would sit frozen for seconds at a time. Falls back to
  // stored/total before the first event and after the run settles.
  const storedPercent = run.total === 0 ? 0 : Math.round((run.stored / run.total) * 100);
  const percent = run.status === "running" && run.search !== undefined ? run.search.percent : storedPercent;
  const remaining = Math.max(run.total - run.stored, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div data-testid="arweave-generate-progress" style={{ fontSize: 12, color: "#888" }}>
        {`Generated ${run.stored} of ${run.total} · ${storedPercent}%`}
      </div>
      {run.search !== undefined && run.status === "running" && (
        // The Crypto Lab's status line, field for field:
        // "Position N of T · prime P · X this search · Y total · Z%"
        <div data-testid="arweave-generate-search" style={{ fontSize: 12, color: ACCENT }}>
          {`Position ${run.search.position} of ${run.search.totalCount}` +
            ` · prime ${run.search.stage.toUpperCase()}` +
            ` · ${run.search.attempts.toLocaleString()} this search` +
            ` · ${run.search.grandAttempts.toLocaleString()} total` +
            ` · ${run.search.percent}%`}
        </div>
      )}
      <div
        data-testid="arweave-generate-progress-bar"
        data-percent={String(percent)}
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{
          height: 4,
          borderRadius: 999,
          overflow: "hidden",
          backgroundColor: "#1a1a1a",
        }}
      >
        <div
          style={{
            width: `${percent}%`,
            height: "100%",
            backgroundColor: ACCENT,
            transition: "width 200ms ease",
          }}
        />
      </div>

      {run.status === "running" && currentIndex !== undefined && (
        <div data-testid="arweave-generate-current" style={{ fontSize: 12, color: ACCENT }}>
          {`Generating #${currentIndex} — position ${position} of ${run.total}`}
        </div>
      )}
      {run.status === "running" && remaining > 0 && (
        <div data-testid="arweave-generate-eta" style={{ fontSize: 11, color: "#666" }}>
          {`About ${formatDuration(remaining * SECONDS_PER_KEY)} left — ${remaining} ${
            remaining === 1 ? "key" : "keys"
          } at roughly ${SECONDS_PER_KEY} s each. Prime search time varies.`}
        </div>
      )}

      <div data-testid="arweave-generate-status" style={{ fontSize: 11, color: "#666" }}>
        {run.status === "running" && "Running — each key takes several seconds."}
        {run.status === "error" && `Failed: ${run.error ?? "unknown error"}`}
        {(run.status === "done" || run.status === "cancelled") && (
          // The Crypto Lab's completion summary, field for field:
          // "✓ 11 addresses generated in 1m 11s · 16,110 candidate searches ·
          //  22 prime numbers found · 228 searches/sec".
          // Two primes per address (p and q) is exactly how the Lab counts them.
          <span data-testid="arweave-generate-summary" style={{ color: ACCENT }}>
            {(() => {
              const count = run.keys.length;
              const elapsed = Math.max((run.finishedAt ?? Date.now()) - run.startedAt, 0);
              const attempts = run.finalAttempts ?? 0;
              const rate = elapsed > 0 ? Math.round(attempts / (elapsed / 1000)) : 0;
              return (
                `✓ ${count} address${count === 1 ? "" : "es"} generated in ${fmtDuration(elapsed)}` +
                ` · ${attempts.toLocaleString()} candidate searches` +
                ` · ${(count * 2).toLocaleString()} prime numbers found` +
                ` · ${rate.toLocaleString()} searches/sec` +
                (run.status === "cancelled" ? " · cancelled" : "")
              );
            })()}
          </span>
        )}
      </div>

    </div>
  );
}

/**
 * A planned position whose key does not exist YET.
 *
 * It is a PLACEHOLDER, not an `ArweaveKeyRow`: there is no address to headline
 * and no JWK to open, so a parameters toggle here would be an affordance that
 * answers nothing. Its whole job is to make a multi-minute run legible — at
 * ~6.7 s per key a 100-position run would otherwise show an empty list for
 * eleven minutes.
 *
 * It lives exactly as long as the run does. Its key landing replaces it in
 * place; the run ending WITHOUT its key removes it, because an unfilled
 * position is not an address the user has.
 */
function PendingKeyRow({ index }: { index: number }): React.ReactElement {
  return (
    <div
      data-testid={`arweave-seed-pending-row-${index}`}
      data-index={String(index)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "2px 0",
        opacity: 0.5,
      }}
    >
      <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: ACCENT }}>
        {`#${index}`}
      </span>
      <span
        style={{
          flex: 1,
          height: 8,
          borderRadius: 999,
          border: "1px dashed #262626",
          backgroundColor: "#0d0d0d",
        }}
      />
      <span style={{ flexShrink: 0, fontSize: 11, color: "#666" }}>
        {`Waiting — about ${SECONDS_PER_KEY} s of prime search`}
      </span>
    </div>
  );
}

/**
 * ONE key's row — the Crypto Lab's result card, ported.
 *
 * Used for BOTH a key just produced by a run and a key the Codex already holds
 * under the seed. That sharing is the point: the parameters panel used to hang
 * off the run list alone, so the button "disappeared" on every key the user came
 * back to. One component, one panel, both places.
 *
 * The address is the headline because it is the key's public identity — the
 * value the user checks against Arweave -> Accounts. The JWK is the opposite:
 * `d`/`p`/`q`/`dp`/`dq`/`qi` reconstruct the private key outright.
 *
 * A STORED key arrives as ciphertext, so its JWK is fetched ON DEMAND through
 * the injected `loadJwk` when the panel is expanded — never eagerly, so a list
 * of a hundred addresses does not decrypt a hundred private keys to draw itself.
 *
 * The reveal is `DalosSecretReveal`'s affordance — a blurred value and an
 * Eye/EyeOff toggle — with ONE deliberate difference: the masked state renders
 * a substitute, not the blurred real value. `DalosSecretReveal` blurs a secret
 * the user has already unlocked and asked to see; here the parameters would
 * otherwise sit in the DOM of a long-running batch screen, where blur is only
 * cosmetic — selectable, copyable, screen-readable, and in the page source.
 * Collapsing the panel re-masks, so a reveal cannot outlive the look at it.
 */
export interface RsaParamsSectionProps {
  /** Namespaces every test id inside the section — reuse the CALLER's
   *  existing prefix: `arweave-generate-key` for a run's key, `arweave-seed-key`
   *  for one already stored under the seed. */
  prefix: string;
  /** Any stable per-row identifier. `ArweaveKeyRow` passes its own numeric
   *  `index` unchanged; a future caller may pass a string (e.g. an address) —
   *  type as `string | number`. Only ever interpolated into test ids. */
  index: string | number;
  /** Present for a key produced this session — already in memory. */
  jwk?: ArweaveJwk;
  /** Decrypts a STORED key on demand, when the panel is opened. */
  loadJwk?: () => Promise<ArweaveJwk>;
  /** The address a download's filename is tagged with (`arweave-{tag}.json`,
   *  `{tag}-private.pem`, `{tag}-public.pem`). Falls back to `String(index)`
   *  when omitted, so a caller whose `index` already IS the address (e.g. a
   *  Pure Key's `entry.id`) needs nothing extra here. */
  address?: string;
}

/**
 * `RsaParamsSection`'s state/logic, WITHOUT any rendering — extracted so its
 * toggle pill and its panel body can be mounted as two INDEPENDENT elements
 * (a `PureKeyRow` wants the pill inline with its address/action-icon row and
 * the panel on its own row below, rather than the two glued together)
 * while still sharing exactly one `open`/reveal/decrypt state machine. A
 * caller uses ONE hook call and hands the same returned state to both
 * `RsaParamsToggle` and `RsaParamsPanel`. See `RsaParamsSection` (the thin
 * wrapper below, unchanged for every existing caller) for the combined shape.
 */
export function useRsaParamsSection({
  jwk: providedJwk,
  loadJwk,
  address,
  index,
}: Pick<RsaParamsSectionProps, "jwk" | "loadJwk" | "address" | "index">) {
  const [open, setOpen] = useState(false);
  /** The panel-wide reveal — every private row at once. */
  const [revealAll, setRevealAll] = useState(false);
  /** The rows revealed ONE at a time. Looking at `p` must not put `d` on screen
   *  as well: each 👁 answers only for its own parameter. */
  const [revealedRows, setRevealedRows] = useState<ReadonlySet<string>>(() => new Set());
  const [decrypted, setDecrypted] = useState<ArweaveJwk | null>(null);
  const [decrypting, setDecrypting] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);

  const jwk = providedJwk ?? decrypted;

  const load = useCallback(async (): Promise<void> => {
    if (loadJwk === undefined) {
      setPanelError(
        "This build cannot decrypt a stored key — no decrypt seam was injected.",
      );
      return;
    }
    setDecrypting(true);
    setPanelError(null);
    try {
      setDecrypted(await loadJwk());
    } catch (cause) {
      setPanelError(`Could not decrypt this key: ${messageOf(cause)}`);
    } finally {
      setDecrypting(false);
    }
  }, [loadJwk]);

  const toggle = useCallback((): void => {
    if (open) {
      // Collapsing re-masks: a reveal may not outlive the look at it.
      setOpen(false);
      setRevealAll(false);
      setRevealedRows(new Set());
      return;
    }
    setOpen(true);
    if (providedJwk === undefined && decrypted === null && !decrypting) void load();
  }, [open, providedJwk, decrypted, decrypting, load]);

  const toggleRevealAll = useCallback((): void => {
    setRevealAll((prev) => {
      if (prev) setRevealedRows(new Set());
      return !prev;
    });
  }, []);

  const toggleRow = useCallback((name: string): void => {
    setRevealedRows((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  // Gated on `open`, not just `jwk`: `rsaDecimals` converts every 4096/2048-bit
  // JWK member to a decimal STRING, and a "fresh" (this-run) row is handed its
  // `jwk` directly as a prop — so an ungated memo would run this conversion
  // for EVERY already-generated key the instant its row mounts, whether or
  // not its "RSA parameters" disclosure is even expanded. Reopening a seed
  // mid-run (or after one) re-mounts every fresh row at once, so that cost
  // multiplied by however many keys had already landed is exactly what made
  // reopening the row stall. Computing it only once `open` is true makes
  // mounting N rows cheap again; the cost still exists, but now it is paid
  // once per row a user actually expands, not once per row that merely exists.
  const decimals = useMemo(() => (jwk === null || !open ? null : rsaDecimals(jwk)), [jwk, open]);

  const [downloadError, setDownloadError] = useState<string | null>(null);
  const download = useCallback(
    (kind: "json" | "priv" | "pub"): void => {
      if (jwk === null) return;
      setDownloadError(null);
      void downloadKeyArtefact(kind, jwk, address ?? String(index)).catch((cause: unknown) => {
        setDownloadError(`Could not build that file: ${messageOf(cause)}`);
      });
    },
    [jwk, address, index],
  );

  return {
    open,
    toggle,
    revealAll,
    toggleRevealAll,
    revealedRows,
    toggleRow,
    decimals,
    decrypting,
    panelError,
    jwk,
    downloadError,
    download,
  };
}

/** What `useRsaParamsSection` returns — every field `RsaParamsToggle`/
 *  `RsaParamsPanel` need, shared from ONE hook call per row. */
type RsaParamsState = ReturnType<typeof useRsaParamsSection>;

/**
 * JUST the "RSA parameters" pill (chevron + label) — no panel. Mountable
 * anywhere in a row's layout (e.g. inline with the address + action icons),
 * independently of where `RsaParamsPanel` renders its expandable body, as
 * long as both share the SAME `useRsaParamsSection` instance.
 */
export function RsaParamsToggle({
  prefix,
  index,
  open,
  toggle,
}: Pick<RsaParamsSectionProps, "prefix" | "index"> &
  Pick<RsaParamsState, "open" | "toggle">): React.ReactElement {
  return (
    <button
      type="button"
      data-testid={`${prefix}-params-toggle-${index}`}
      aria-expanded={open}
      onClick={toggle}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        flexShrink: 0,
        // Right-aligned: an elastic sibling (an address field) before it in
        // the row pushes it to the far side without this needing to know
        // that sibling's width.
        marginLeft: "auto",
        padding: "2px 8px",
        borderRadius: 999,
        border: "1px solid #262626",
        backgroundColor: "transparent",
        color: "#888",
        fontSize: 11,
        cursor: "pointer",
      }}
    >
      {open ? (
        <ChevronDownGlyph style={{ width: 11, height: 11 }} />
      ) : (
        <ChevronRightGlyph style={{ width: 11, height: 11 }} />
      )}
      RSA parameters
    </button>
  );
}

/**
 * JUST the expandable panel body (the secret-warning strip, the 8-field
 * table, reveal-all, and the three downloads) — no toggle pill. Renders
 * nothing at all while `open` is `false`, so a caller can mount it
 * unconditionally right where the old combined panel used to sit.
 */
export function RsaParamsPanel({
  prefix,
  index,
  open,
  decimals,
  decrypting,
  panelError,
  revealAll,
  toggleRevealAll,
  revealedRows,
  toggleRow,
  jwk,
  download,
  downloadError,
}: Pick<RsaParamsSectionProps, "prefix" | "index"> &
  Omit<RsaParamsState, "toggle">): React.ReactElement | null {
  if (!open) return null;
  return (
    <div
      data-testid={`${prefix}-params-${index}`}
      style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: 8,
            borderRadius: 8,
            border: "1px solid #262626",
            backgroundColor: "#0a0a0a",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                flex: 1,
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "#c0392b",
              }}
            >
              RSA-4096 parameters · secret
            </span>
            {decimals !== null && (
              <button
                type="button"
                data-testid={`${prefix}-reveal-${index}`}
                aria-pressed={revealAll}
                onClick={toggleRevealAll}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 10px",
                  borderRadius: 8,
                  fontSize: 11,
                  border: "1px solid #262626",
                  backgroundColor: "transparent",
                  color: "#d2d3d4",
                  cursor: "pointer",
                }}
              >
                {revealAll ? (
                  <EyeOffGlyph style={{ width: 12, height: 12 }} />
                ) : (
                  <EyeGlyph style={{ width: 12, height: 12 }} />
                )}
                {revealAll ? "Hide" : "Reveal"}
              </button>
            )}
          </div>
          <p style={{ margin: 0, fontSize: 10, lineHeight: 1.5, color: "#c0392b" }}>
            These parameters ARE the private key of this address. Any one of `d`, `p` or `q`
            reconstructs it. Never share or paste them anywhere but a trusted offline backup.
          </p>

          {decrypting && (
            <div
              data-testid={`${prefix}-params-loading-${index}`}
              style={{ fontSize: 11, color: "#666" }}
            >
              Decrypting this key…
            </div>
          )}
          {decimals === null && panelError !== null && (
            <div data-testid={`${prefix}-params-error-${index}`} style={errorStyle}>
              {panelError}
            </div>
          )}

          {decimals !== null && (
            <>
              {RSA_FIELDS.map((field) => (
                <LabField
                  key={field.name}
                  prefix={prefix}
                  index={index}
                  name={field.name}
                  label={field.label}
                  def={field.def}
                  value={decimals[field.name]}
                  priv={field.priv}
                  revealed={!field.priv || revealAll || revealedRows.has(field.name)}
                  onToggleReveal={field.priv ? () => toggleRow(field.name) : undefined}
                />
              ))}

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 6,
                  marginTop: 2,
                }}
              >
                <span style={{ fontSize: 10, color: "#666" }}>Download this key:</span>
                <button
                  type="button"
                  data-testid={`${prefix}-download-json-${index}`}
                  onClick={() => download("json")}
                  disabled={jwk === null}
                  title={
                    jwk === null
                      ? "Decrypting this key — the file cannot be built until its numbers are loaded."
                      : undefined
                  }
                  style={{
                    ...downloadButtonStyle,
                    ...(jwk === null ? { opacity: 0.45, cursor: "not-allowed" } : {}),
                  }}
                >
                  Arweave keyfile (.json)
                </button>
                <button
                  type="button"
                  data-testid={`${prefix}-download-priv-${index}`}
                  onClick={() => download("priv")}
                  disabled={jwk === null}
                  title={
                    jwk === null
                      ? "Decrypting this key — the file cannot be built until its numbers are loaded."
                      : undefined
                  }
                  style={{
                    ...downloadButtonStyle,
                    ...(jwk === null ? { opacity: 0.45, cursor: "not-allowed" } : {}),
                  }}
                >
                  Private key (.pem)
                </button>
                <button
                  type="button"
                  data-testid={`${prefix}-download-pub-${index}`}
                  onClick={() => download("pub")}
                  disabled={jwk === null}
                  title={
                    jwk === null
                      ? "Decrypting this key — the file cannot be built until its numbers are loaded."
                      : undefined
                  }
                  style={{
                    ...downloadButtonStyle,
                    ...(jwk === null ? { opacity: 0.45, cursor: "not-allowed" } : {}),
                  }}
                >
                  Public key (.pem)
                </button>
              </div>
              {downloadError !== null && (
                <div data-testid={`${prefix}-download-error-${index}`} style={errorStyle}>
                  {downloadError}
                </div>
              )}
            </>
          )}
        </div>
  );
}

/**
 * The "RSA parameters" disclosure toggle + panel — the self-contained part of
 * `ArweaveKeyRow` (everything except its address `LabField` line and the
 * outer row chrome). Extracted so a future row (a Pure Key's, which has no
 * seed behind it) can mount the exact same panel without duplicating any of
 * its state or its 8-field RSA parameter table. See this file's module doc
 * and `ArweaveKeyRow`'s own doc comment for the panel's full rationale.
 *
 * A THIN WRAPPER over `useRsaParamsSection` + `RsaParamsToggle` +
 * `RsaParamsPanel`: every existing caller (`ArweaveKeyRow` below) keeps
 * exactly today's combined toggle-then-panel rendering, byte-for-byte, with
 * zero changes at its call site. A caller that wants the toggle and the panel
 * in two different places in its own layout (e.g. `PureKeyRow`) calls
 * `useRsaParamsSection` itself instead and mounts `RsaParamsToggle`/
 * `RsaParamsPanel` independently, sharing that one hook instance.
 */
export function RsaParamsSection(props: RsaParamsSectionProps): React.ReactElement {
  const state = useRsaParamsSection(props);
  return (
    <>
      <RsaParamsToggle prefix={props.prefix} index={props.index} open={state.open} toggle={state.toggle} />
      <RsaParamsPanel prefix={props.prefix} index={props.index} {...state} />
    </>
  );
}

function ArweaveKeyRow({
  prefix,
  index,
  address,
  jwk: providedJwk,
  loadJwk,
}: {
  /** Namespaces the row's test ids: `arweave-generate-key` for a run's key,
   *  `arweave-seed-key` for one already stored under the seed. */
  prefix: string;
  index: number;
  address: string;
  /** Present for a key produced in THIS session — already in memory. */
  jwk?: ArweaveJwk;
  /** Decrypts a STORED key on demand. Absent → the row still offers the panel
   *  and says why it cannot show the numbers. */
  loadJwk?: () => Promise<ArweaveJwk>;
}): React.ReactElement {
  return (
    <div
      data-testid={`${prefix}-row-${index}`}
      data-index={String(index)}
      style={{ display: "flex", flexDirection: "column", gap: 6 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: ACCENT }}>
          {`#${index}`}
        </span>
        <LabField
          prefix={prefix}
          index={index}
          name="address"
          label="Arweave address"
          def={DEFS.arw}
          value={address}
          priv={false}
          revealed
          onToggleReveal={undefined}
        />
      </div>

      <RsaParamsSection
        prefix={prefix}
        index={index}
        jwk={providedJwk}
        loadJwk={loadJwk}
        address={address}
      />
    </div>
  );
}

const downloadButtonStyle: React.CSSProperties = {
  padding: "3px 10px",
  borderRadius: 999,
  border: "1px solid #262626",
  backgroundColor: "transparent",
  color: "#d2d3d4",
  fontSize: 10,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

/**
 * A label with the Crypto Lab's hover/focus tooltip (`termLabel()`).
 *
 * The Lab leans on the site's `.term` CSS; this panel has no stylesheet of its
 * own, so the same affordance is driven by state — hover OR focus, because a
 * definition reachable only by mouse is not reachable by keyboard at all. The
 * ⓘ marker (`&#9432;`) is what tells the user there is something to hover.
 */
function TermLabel({
  text,
  def,
  labelTestId,
  tipTestId,
}: {
  text: string;
  def: string;
  labelTestId: string;
  tipTestId: string;
}): React.ReactElement {
  const [shown, setShown] = useState(false);
  return (
    <span
      tabIndex={0}
      onMouseEnter={() => setShown(true)}
      onMouseLeave={() => setShown(false)}
      onFocus={() => setShown(true)}
      onBlur={() => setShown(false)}
      style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 3 }}
    >
      {/* The marker leads the label: trailing it made every row's icon land at a
          different x, since the labels differ in length. */}
      <span
        aria-hidden="true"
        style={{ color: `${ACCENT}cc`, fontSize: 12, lineHeight: 1, flexShrink: 0 }}
      >
        {"ⓘ"}
      </span>
      <span data-testid={labelTestId}>{text}</span>
      <span
        role="tooltip"
        data-testid={tipTestId}
        style={{
          position: "absolute",
          bottom: "calc(100% + 6px)",
          left: 0,
          zIndex: 20,
          width: "max-content",
          maxWidth: "17rem",
          whiteSpace: "normal",
          padding: "6px 8px",
          borderRadius: 8,
          border: "1px solid #262626",
          backgroundColor: "#111",
          color: "#d2d3d4",
          fontSize: 10,
          lineHeight: 1.5,
          textTransform: "none",
          letterSpacing: "normal",
          pointerEvents: "none",
          opacity: shown ? 1 : 0,
          visibility: shown ? "visible" : "hidden",
          transition: "opacity 120ms ease",
        }}
      >
        {def}
      </span>
    </span>
  );
}

/**
 * ONE `lab-field` row, ported from `field()`.
 *
 * The value is middle-truncated the Lab's way: the head shrinks with an
 * ellipsis while the last `VALUE_TAIL` characters NEVER shrink, because the tail
 * is what a user checks a value by. The copy button carries the FULL string —
 * copying what is on screen would hand over a silently broken key.
 *
 * A private row renders a SUBSTITUTE while masked. The real digits never reach
 * the DOM before its 👁 is pressed: a blur would leave them selectable,
 * copyable, screen-readable and in the page source.
 */
function LabField({
  prefix,
  index,
  name,
  label,
  def,
  value,
  priv,
  revealed,
  onToggleReveal,
}: {
  prefix: string;
  /** Only ever interpolated into test ids — a numeric row position for every
   *  current caller, but `string | number` so `RsaParamsSection` can forward
   *  whatever per-row identifier it was given (a future caller's may be an
   *  address string). */
  index: string | number;
  name: string;
  label: string;
  def: string;
  value: string | null;
  priv: boolean;
  revealed: boolean;
  onToggleReveal?: (() => void) | undefined;
}): React.ReactElement {
  const valueTestId =
    name === "address" ? `${prefix}-address-${index}` : `${prefix}-param-${index}-${name}`;
  // Only a PRIVATE row is ever hidden. Keying this off `revealed` alone made
  // the public rows (`n`, `e`) — and the address — render MASKED_VALUE, i.e. a
  // solid bar of bullets where their digits belong.
  const hidden = priv && !revealed;
  const shown = hidden ? MASKED_VALUE : (value ?? "—");
  const head = shown.length > VALUE_TAIL ? shown.slice(0, -VALUE_TAIL) : shown;
  const tail = shown.length > VALUE_TAIL ? shown.slice(-VALUE_TAIL) : "";

  return (
    <div
      data-testid={`${prefix}-field-${index}-${name}`}
      data-priv={priv ? "true" : "false"}
      style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}
    >
      <span
        style={{
          flexShrink: 0,
          fontFamily: MONO,
          fontSize: 10,
          color: `${ACCENT}99`,
          whiteSpace: "nowrap",
        }}
      >
        <TermLabel
          text={label}
          def={def}
          labelTestId={`${prefix}-label-${index}-${name}`}
          tipTestId={`${prefix}-tip-${index}-${name}`}
        />
      </span>
      <span
        style={{
          display: "flex",
          flex: 1,
          minWidth: 0,
          alignItems: "center",
          gap: 4,
        }}
      >
        <span
          data-testid={valueTestId}
          style={{
            display: "flex",
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            fontFamily: MONO,
            fontSize: 10,
            lineHeight: 1.6,
            color: "#d2d3d4",
            ...masked(!hidden),
          }}
        >
          <span
            data-testid={`${valueTestId}-head`}
            style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {head}
          </span>
          <span
            data-testid={`${valueTestId}-tail`}
            style={{ flexShrink: 0, whiteSpace: "nowrap" }}
          >
            {tail}
          </span>
        </span>
        <button
          type="button"
          data-testid={`${prefix}-copy-${index}-${name}`}
          title="Copy full value"
          aria-label={`Copy ${label}`}
          onClick={() => {
            if (value !== null) void navigator.clipboard?.writeText(value);
          }}
          style={glyphButtonStyle}
        >
          {"⧉"}
        </button>
        {priv && onToggleReveal !== undefined && (
          <button
            type="button"
            data-testid={`${prefix}-field-reveal-${index}-${name}`}
            title="Show / hide"
            aria-label={`Reveal ${label}`}
            aria-pressed={revealed}
            onClick={onToggleReveal}
            style={glyphButtonStyle}
          >
            {"\u{1F441}"}
          </button>
        )}
      </span>
    </div>
  );
}

const glyphButtonStyle: React.CSSProperties = {
  flexShrink: 0,
  padding: "0 4px",
  border: "none",
  backgroundColor: "transparent",
  color: "#888",
  fontSize: 11,
  lineHeight: 1,
  cursor: "pointer",
};

/** Documented alongside StoicDigest's own 16×16 board and Mnemosyne's. */
const DALOS_CHARSET_DOCS_URL = "https://codex.ancientholdings.eu/docs/dalos-character-set.html";

/**
 * "DALOS Charset" — a link to the docs page that also previews the full
 * 16×16, 256-glyph alphabet on hover, so a user typing Free Seed Input words
 * can see EXACTLY which glyphs are legal without leaving the form. The data
 * is `CHARACTER_MATRIX_FLAT` itself — the same 256 glyphs `validateSeedWords`
 * checks every word's characters against, not a separately-maintained copy.
 */
function DalosCharsetInfo(): React.ReactElement {
  const [shown, setShown] = useState(false);
  const glyphs = useMemo(() => Array.from(CHARACTER_MATRIX_FLAT), []);
  return (
    <span
      style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={() => setShown(true)}
      onMouseLeave={() => setShown(false)}
    >
      <a
        href={DALOS_CHARSET_DOCS_URL}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="arweave-seed-dalos-charset-link"
        onFocus={() => setShown(true)}
        onBlur={() => setShown(false)}
        style={{
          fontSize: 11,
          color: ACCENT,
          textDecoration: "underline",
          textUnderlineOffset: 2,
          cursor: "help",
        }}
      >
        DALOS Charset
      </a>
      <div
        role="tooltip"
        data-testid="arweave-seed-dalos-charset-grid"
        style={{
          position: "absolute",
          bottom: "calc(100% + 8px)",
          left: 0,
          zIndex: 30,
          padding: 8,
          borderRadius: 10,
          border: "1px solid #262626",
          backgroundColor: "#0a0a0a",
          boxShadow: "0 12px 30px rgba(0,0,0,0.6)",
          opacity: shown ? 1 : 0,
          visibility: shown ? "visible" : "hidden",
          transition: "opacity 120ms ease",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(16, 1fr)",
            gap: 2,
            width: 16 * 16,
          }}
        >
          {glyphs.map((g, i) => (
            <span
              key={i}
              style={{
                width: 14,
                height: 14,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10,
                fontFamily: MONO,
                color: ACCENT,
                backgroundColor: "#141414",
                borderRadius: 2,
              }}
            >
              {g}
            </span>
          ))}
        </div>
        <div style={{ marginTop: 6, fontSize: 10, color: "#666", textAlign: "center" }}>
          {glyphs.length} glyphs · 16 × 16 · one byte each
        </div>
      </div>
    </span>
  );
}

/**
 * The absolute worst case Free Seed Input accepts: `MAX_SEED_WORDS` words
 * (256), each exactly `MAX_SEED_WORD_GLYPHS` glyphs (256) — every glyph drawn
 * uniformly from the 256-glyph DALOS charset (256 = 2^8, so one random BYTE
 * indexes it with zero modulo bias). This is deliberately NOT a phrase — it
 * previews how the reveal renders the largest input the seed engine will
 * ever accept, not a usable mnemonic.
 */
function randomMaxEntropyWords(glyphs: readonly string[]): string {
  const bytes = new Uint8Array(MAX_SEED_WORDS * MAX_SEED_WORD_GLYPHS);
  crypto.getRandomValues(bytes);
  const words: string[] = [];
  for (let w = 0; w < MAX_SEED_WORDS; w++) {
    let word = "";
    for (let c = 0; c < MAX_SEED_WORD_GLYPHS; c++) {
      word += glyphs[bytes[w * MAX_SEED_WORD_GLYPHS + c]!];
    }
    words.push(word);
  }
  return words.join(" ");
}

function DefineSeedForm({
  primeDefinition,
  generatorMode,
  setGeneratorMode,
  directWidth,
  setDirectWidth,
  directKind,
  setDirectKind,
  directBitStringText,
  setDirectBitStringText,
  directInt10Text,
  setDirectInt10Text,
  directInt49Text,
  setDirectInt49Text,
  directBitmap,
  setDirectBitmap,
  directResolution,
  source,
  setSource,
  seedInputTile,
  setSeedInputTile,
  wordsText,
  setWordsText,
  restrictedWords,
  setWordAt,
  restrictedInvalid,
  restrictedNotice,
  dictionaryWords,
  confirmBlocked,
  labelText,
  setLabelText,
  accounts,
  selectedAccountId,
  setAccountChoice,
  chainwebSeeds,
  selectedChainwebId,
  setChainwebChoice,
  onGeneratePhrase,
  onClearWords,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  primeDefinition: boolean;
  generatorMode: GeneratorMode;
  setGeneratorMode: (m: GeneratorMode) => void;
  directWidth: DirectWidth;
  setDirectWidth: (w: DirectWidth) => void;
  directKind: DirectKind;
  setDirectKind: (k: DirectKind) => void;
  directBitStringText: string;
  setDirectBitStringText: (v: string) => void;
  directInt10Text: string;
  setDirectInt10Text: (v: string) => void;
  directInt49Text: string;
  setDirectInt49Text: (v: string) => void;
  directBitmap: Bitmap | null;
  setDirectBitmap: (b: Bitmap | null) => void;
  directResolution: DirectResolution | null;
  source: DefineSource;
  setSource: (s: DefineSource) => void;
  seedInputTile: SeedInputTile;
  setSeedInputTile: (tile: SeedInputTile) => void;
  wordsText: string;
  setWordsText: (v: string) => void;
  restrictedWords: readonly string[];
  setWordAt: (index: number, word: string) => void;
  restrictedInvalid: readonly boolean[];
  restrictedNotice: string | null;
  dictionaryWords: readonly string[];
  confirmBlocked: boolean;
  labelText: string;
  setLabelText: (v: string) => void;
  accounts: readonly ArweaveSeedAccountSource[];
  selectedAccountId: string;
  setAccountChoice: (v: string) => void;
  chainwebSeeds: readonly ArweaveSeedChainwebSource[];
  selectedChainwebId: string;
  setChainwebChoice: (v: string) => void;
  onGeneratePhrase: () => void;
  onClearWords: () => void;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactElement {
  // Free Seed Input auto-grows WITH its content, never ahead of it: an empty
  // (or short) box stays a normal few-line box, and only typing (or Max
  // Entropy's 256×256-glyph worst case) pushes it taller — up to most of the
  // viewport, past which `maxHeight` + `overflowY` below take over as an
  // internal scrollbar. A fixed tall box regardless of content was the
  // opposite of useful: an empty textarea occupying the whole page.
  const wordsInputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = wordsInputRef.current;
    if (el === null) return;
    el.style.height = "auto"; // shrink back down before re-measuring, so deleting text un-grows it too
    el.style.height = `${el.scrollHeight}px`;
  }, [wordsText]);

  /** Direct mode's Confirm gate, mirroring how `confirmBlocked` already gates
   *  the Restricted word grid: blocked until the current input resolves to a
   *  valid bitstring, at either supported width. */
  const directBlocked =
    generatorMode === "direct" &&
    (directResolution === null || "error" in directResolution);

  const sourceButton = (
    id: DefineSource,
    testId: string,
    label: string,
    disabled: boolean,
    hint: string,
  ): React.ReactElement => (
    <button
      type="button"
      data-testid={testId}
      role="radio"
      aria-checked={source === id}
      disabled={disabled}
      title={disabled ? hint : undefined}
      onClick={() => setSource(id)}
      style={{
        ...(source === id ? primaryButtonStyle : secondaryButtonStyle),
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      data-testid="arweave-seed-define-form"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 14,
        borderRadius: 12,
        border: "1px solid #262626",
        backgroundColor: "#0a0a0a",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600 }}>Define an Arweave seed</div>
        {/* The C toggle (buttons only, per design.md): "Direct" is a visible,
            honest placeholder — the full generator is a separate topic. */}
        <div
          role="group"
          aria-label="Generator mode"
          style={{
            display: "inline-flex",
            gap: 4,
            padding: 4,
            borderRadius: 8,
            backgroundColor: "#18181B",
          }}
        >
          <button
            type="button"
            data-testid="arweave-seed-mode-seed-based"
            aria-pressed={generatorMode === "seed-based"}
            onClick={() => setGeneratorMode("seed-based")}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
              backgroundColor: generatorMode === "seed-based" ? `${ACCENT}22` : "transparent",
              color: generatorMode === "seed-based" ? ACCENT : "#888",
            }}
          >
            Seed Words Deterministic RSA Generation
          </button>
          <button
            type="button"
            data-testid="arweave-seed-mode-direct"
            aria-pressed={generatorMode === "direct"}
            onClick={() => setGeneratorMode("direct")}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
              backgroundColor: generatorMode === "direct" ? `${ACCENT}22` : "transparent",
              color: generatorMode === "direct" ? ACCENT : "#888",
            }}
          >
            Direct Deterministic RSA Generation
          </button>
        </div>
      </div>

      {/* Shown BEFORE the confirm, because after it the act is done. The block
          itself is deferred — the Prime seed stays deletable in development so
          this flow can be re-run — but the copy ships now. */}
      {primeDefinition && (
        <div
          data-testid="arweave-seed-prime-permanence-warning"
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid #78350f",
            backgroundColor: "#1a1206",
            color: "#fbbf24",
            fontSize: 12,
          }}
        >
          This is the Prime Arweave Seed. Defining it is a one-way act: in the shipped build the
          Prime Arweave Seed is permanent and can never be replaced. It stays deletable in this
          development build only.
        </div>
      )}
      {generatorMode === "direct" ? (
        <DirectGeneratorBody
          directWidth={directWidth}
          setDirectWidth={setDirectWidth}
          directKind={directKind}
          setDirectKind={setDirectKind}
          directBitStringText={directBitStringText}
          setDirectBitStringText={setDirectBitStringText}
          directInt10Text={directInt10Text}
          setDirectInt10Text={setDirectInt10Text}
          directInt49Text={directInt49Text}
          setDirectInt49Text={setDirectInt49Text}
          directBitmap={directBitmap}
          setDirectBitmap={setDirectBitmap}
          directResolution={directResolution}
        />
      ) : (
        <>
      <div style={{ fontSize: 11, color: "#666" }}>
        {`Every Arweave seed is exactly ${SEED_BIT_LENGTH} bits on the DALOS ellipse. A source that cannot produce exactly ${SEED_BIT_LENGTH} bits is refused, never padded.`}
      </div>

      <div role="radiogroup" aria-label="Seed source" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {sourceButton("words", "arweave-seed-source-words", "1 · Enter your own seed", false, "")}
        {sourceButton(
          "account",
          "arweave-seed-source-account",
          "2 · Use an Ouronet account",
          accounts.length === 0,
          "No activated, seed-words-origin DALOS-curve Ouronet account exists in this Codex.",
        )}
        {sourceButton(
          "chainweb",
          "arweave-seed-source-chainweb",
          "3 · Use a Chainweb seed",
          chainwebSeeds.length === 0,
          "No Chainweb seed exists in this Codex.",
        )}
      </div>

      {source === "words" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {/* The single flat 3-tile picker — ported from `CreateStoaChainSeedModal`'s
              `SEED_TYPE_OPTIONS` tile row: "Stoa Dalos" is Free Seed Input's
              free-form textarea; the two Dictionary tiles are the BIP-gated
              Restricted variant with its word count LOCKED to the tile — the
              tile itself IS the count, so there is no separate nested 12/24
              switch underneath it any more. Deliberately no "Generate New /
              Restore Existing" mode toggle above this: the textarea/word grid
              below already serves both typing fresh and typing over to
              restore, with nothing today's single surface cannot already do. */}
          <div
            role="group"
            aria-label="Seed word input"
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${SEED_INPUT_TILE_OPTIONS.length}, 1fr)`,
              gap: 4,
              padding: 4,
              borderRadius: 8,
              backgroundColor: "#18181B",
            }}
          >
            {SEED_INPUT_TILE_OPTIONS.map((option) => {
              const on = seedInputTile === option.tile;
              return (
                <button
                  key={option.tile}
                  type="button"
                  data-testid={`arweave-seed-input-tile-${option.tile}`}
                  aria-pressed={on}
                  onClick={() => setSeedInputTile(option.tile)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    padding: "8px 4px",
                    borderRadius: 6,
                    border: "none",
                    cursor: "pointer",
                    backgroundColor: on ? `${option.color}22` : "transparent",
                    borderBottom: on ? `2px solid ${option.color}` : "2px solid transparent",
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 600, color: on ? option.color : "#888" }}>
                    {option.label}
                  </span>
                  <span style={{ fontSize: 10, color: "#555" }}>{option.subtitle}</span>
                </button>
              );
            })}
          </div>

          {seedInputTile === "dalos" ? (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <DalosCharsetInfo />
                {/* Worst-case stress input: 256 words of 256 random DALOS
                    glyphs each — the absolute ceiling `validateSeedWords`
                    accepts — to preview how the reveal renders it. */}
                <button
                  type="button"
                  data-testid="arweave-seed-max-entropy"
                  title={`Fill with ${MAX_SEED_WORDS} words of ${MAX_SEED_WORD_GLYPHS} random DALOS glyphs each — the absolute maximum the seed engine accepts.`}
                  onClick={() =>
                    setWordsText(
                      randomMaxEntropyWords(Array.from(CHARACTER_MATRIX_FLAT)),
                    )
                  }
                  style={secondaryButtonStyle}
                >
                  Max Entropy
                </button>
              </div>
              <textarea
                ref={wordsInputRef}
                data-testid="arweave-seed-words-input"
                aria-label="Seed words"
                rows={3}
                value={wordsText}
                onChange={(e) => setWordsText(e.target.value)}
                placeholder="1-256 words, each 1-256 glyphs from the DALOS charset"
                // Height tracks CONTENT (the effect above sets it from
                // scrollHeight on every change) — an empty box is a normal
                // few-line box, not a giant empty rectangle. `maxHeight` is
                // the hard ceiling that turns growth into an internal
                // scrollbar once content would otherwise push past most of
                // the viewport (Max Entropy's 256×256-glyph worst case).
                style={{
                  ...inputStyle,
                  width: "100%",
                  fontFamily: MONO,
                  maxHeight: "70vh",
                  overflowY: "auto",
                  resize: "vertical",
                }}
              />
            </>
          ) : (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button
                  type="button"
                  data-testid="arweave-seed-random-phrase"
                  onClick={onGeneratePhrase}
                  style={secondaryButtonStyle}
                >
                  Generate a random phrase
                </button>
                {/* Retyping a slot replaces ONE word; without this the only way
                    out of a wrong 24-word phrase is 24 manual deletions. */}
                <button
                  type="button"
                  data-testid="arweave-seed-clear-words"
                  title="Empty every word slot"
                  onClick={onClearWords}
                  style={secondaryButtonStyle}
                >
                  Clear
                </button>
              </div>
              <RestrictedWordGrid
                words={restrictedWords}
                invalid={restrictedInvalid}
                dictionary={dictionaryWords}
                onWordChange={setWordAt}
              />
              {restrictedNotice !== null && (
                <div data-testid="arweave-seed-restricted-notice" style={errorStyle}>
                  {restrictedNotice}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {source === "account" && (
        <select
          data-testid="arweave-seed-account-select"
          aria-label="Ouronet account"
          value={selectedAccountId}
          onChange={(e) => setAccountChoice(e.target.value)}
          style={selectStyle}
        >
          {accounts.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
      )}

      {source === "chainweb" && (
        <select
          data-testid="arweave-seed-chainweb-select"
          aria-label="Chainweb seed"
          value={selectedChainwebId}
          onChange={(e) => setChainwebChoice(e.target.value)}
          style={selectStyle}
        >
          {chainwebSeeds.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
      )}

        </>
      )}

      {/* The FIRST-EVER seed's name is not a choice: it is always the Prime
          Arweave Seed. The field stays visible (so the name is stated where a
          name is expected) but is read-only, and `confirmDefine` ignores
          `labelText` for a prime definition regardless of what reaches it.
          Shared across BOTH generator modes — a Direct-defined seed still
          gets a name (or the locked Prime one), same as a Seed-Based one;
          this field previously sat inside the Seed-Based-only branch above
          and was silently missing whenever Direct mode was active. */}
      <input
        type="text"
        data-testid="arweave-seed-label-input"
        aria-label="Seed name"
        value={primeDefinition ? PRIME_SEED_LABEL : labelText}
        readOnly={primeDefinition}
        title={primeDefinition ? "The first Arweave seed is always the Prime Arweave Seed." : undefined}
        placeholder="Name (optional)"
        onChange={(e) => setLabelText(e.target.value)}
        style={
          primeDefinition
            ? { ...inputStyle, color: "#888", cursor: "not-allowed" }
            : inputStyle
        }
      />

      {error !== null && (
        <div data-testid="arweave-seed-error" style={errorStyle}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          data-testid="arweave-seed-confirm"
          disabled={busy || confirmBlocked || directBlocked}
          onClick={onConfirm}
          style={{
            ...primaryButtonStyle,
            opacity: busy || confirmBlocked || directBlocked ? 0.5 : 1,
          }}
        >
          Define seed
        </button>
        <button
          type="button"
          data-testid="arweave-seed-define-cancel"
          onClick={onCancel}
          style={secondaryButtonStyle}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * The Direct mode's body (C): pick a value's exact bits directly — BitString /
 * Bitmap / Base-10 / Base-49 — at either 1024 (APOLLO) or 1600 (DALOS) bits,
 * instead of deriving them from a seed. See `direct-deterministic-rsa`.
 *
 * The width toggle and the four kind tiles are always visible; only the ONE
 * body matching `directKind` renders below them. `directResolution` (computed
 * by the parent, one level up, from whichever input is active) is what the
 * error notice and the Confirm button's gate both read — this component never
 * re-validates on its own.
 */
function DirectGeneratorBody({
  directWidth,
  setDirectWidth,
  directKind,
  setDirectKind,
  directBitStringText,
  setDirectBitStringText,
  directInt10Text,
  setDirectInt10Text,
  directInt49Text,
  setDirectInt49Text,
  directBitmap,
  setDirectBitmap,
  directResolution,
}: {
  directWidth: DirectWidth;
  setDirectWidth: (w: DirectWidth) => void;
  directKind: DirectKind;
  setDirectKind: (k: DirectKind) => void;
  directBitStringText: string;
  setDirectBitStringText: (v: string) => void;
  directInt10Text: string;
  setDirectInt10Text: (v: string) => void;
  directInt49Text: string;
  setDirectInt49Text: (v: string) => void;
  directBitmap: Bitmap | null;
  setDirectBitmap: (b: Bitmap | null) => void;
  directResolution: DirectResolution | null;
}): React.ReactElement {
  const bitmapDim = directWidth === 1600 ? 40 : 32;

  /**
   * The auto-correction rule (design.md): a value shaped for the OTHER width
   * is accepted, and the toggle FLIPS to visibly match it. Applied ONLY as a
   * direct consequence of the TEXT changing — never reactively from a
   * `useEffect` watching `directWidth` itself, which would fire just as
   * readily when the user clicks the width toggle DIRECTLY (with an
   * old value still in the field that happens to resolve at the width they
   * are switching AWAY from), instantly snapping the toggle back and making
   * a manual width click look broken/unresponsive. Tying the flip to the
   * `onChange` event instead means a manual toggle click is authoritative
   * and is never overridden — only typing/pasting a NEW value can trigger it.
   */
  function applyBitStringChange(next: string): void {
    setDirectBitStringText(next);
    // Strict at the CURRENT width first — if it already fits, there is
    // nothing to correct. Only when it does NOT fit here do we check the
    // OTHER width and flip the toggle to it.
    const atCurrent = resolveDirectBitString(next, directWidth);
    if (atCurrent !== null && !("error" in atCurrent)) return;
    const other = otherDirectWidth(directWidth);
    const atOther = resolveDirectBitString(next, other);
    if (atOther !== null && !("error" in atOther)) setDirectWidth(other);
  }
  function applyScalarChange(next: string, base: 10 | 49, setText: (v: string) => void): void {
    setText(next);
    const atCurrent = resolveDirectScalar(next, base, directWidth);
    if (atCurrent !== null && !("error" in atCurrent)) return;
    const other = otherDirectWidth(directWidth);
    const atOther = resolveDirectScalar(next, base, other);
    if (atOther !== null && !("error" in atOther)) setDirectWidth(other);
  }

  /**
   * Switching WHICH representation is being edited must carry the value
   * across, converted, not drop it — the four tiles are four VIEWS of the
   * same underlying bits, not four independent, forgetful fields. If the
   * currently active kind currently resolves to something valid, the TARGET
   * kind's field is populated with the exact equivalent (bits -> the same
   * bitstring / the derived scalar / the derived bitmap) before the switch,
   * so it never presents as empty just because it was not the field the
   * user happened to be looking at.
   */
  function handleKindChange(newKind: DirectKind): void {
    if (directResolution !== null && !("error" in directResolution)) {
      const bits = directResolution.bits;
      switch (newKind) {
        case "bitstring":
          setDirectBitStringText(bits);
          break;
        case "base10": {
          const { int10 } = bitsToDirectScalars(bits, directWidth);
          setDirectInt10Text(int10);
          break;
        }
        case "base49": {
          const { int49 } = bitsToDirectScalars(bits, directWidth);
          setDirectInt49Text(int49);
          break;
        }
        case "bitmap": {
          const dim = directWidth === 1600 ? 40 : 32;
          setDirectBitmap(bitsToDirectBitmap(bits, dim, dim));
          break;
        }
      }
    }
    setDirectKind(newKind);
  }

  /**
   * Switching WIDTH is a different curve entirely (DALOS vs APOLLO) — there
   * is no meaningful "1024-bit equivalent" of a 1600-bit value to carry
   * across, unlike a kind switch. Rather than leave the old value sitting
   * behind a permanent "length mismatch" error, a manual width switch clears
   * ALL FOUR representations, so the user starts clean at the new width
   * instead of staring at an error banner over content that can never fit.
   * (The auto-correction path in `applyBitStringChange`/`applyScalarChange`
   * above does NOT go through this — it calls `setDirectWidth` directly,
   * because there the just-typed value is exactly what resolved at the new
   * width and must be kept, not cleared.)
   */
  function handleWidthChange(newWidth: DirectWidth): void {
    setDirectWidth(newWidth);
    setDirectBitStringText("");
    setDirectInt10Text("");
    setDirectInt49Text("");
    setDirectBitmap(null);
  }

  // Each direct-input field GROWS with its content instead of hiding most of
  // a 1600-bit bitstring or a 483-digit scalar behind a fixed few-line box /
  // a single-line input's horizontal scroll — the whole value should be
  // visible. Same auto-grow idiom as Free Seed Input's textarea: measure
  // `scrollHeight` after every change, capped by `maxHeight` + `overflowY`
  // below (so it never grows past most of the viewport before scrolling).
  const bitStringRef = useRef<HTMLTextAreaElement>(null);
  const int10Ref = useRef<HTMLTextAreaElement>(null);
  const int49Ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = bitStringRef.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [directBitStringText]);
  useEffect(() => {
    const el = int10Ref.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [directInt10Text]);
  useEffect(() => {
    const el = int49Ref.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [directInt49Text]);

  /** The error notice only shows once the user has actually typed something —
   *  an untouched field is incomplete, not wrong (mirrors the Restricted word
   *  grid's own "empty slot is incomplete" rule). Bitmap never errors: its
   *  shape is guaranteed by `BitmapKeyInput`'s own rows/cols. */
  const touched =
    directKind === "bitstring"
      ? directBitStringText !== ""
      : directKind === "base10"
        ? directInt10Text !== ""
        : directKind === "base49"
          ? directInt49Text !== ""
          : false;
  const directError =
    touched && directResolution !== null && "error" in directResolution
      ? directResolution.error
      : null;

  return (
    <div
      data-testid="arweave-seed-direct-body"
      style={{ display: "flex", flexDirection: "column", gap: 10 }}
    >
      <div style={{ fontSize: 11, color: "#666" }}>
        Pick a value's exact bits directly — BitString, Bitmap, Base-10 or Base-49 — instead of
        deriving them from a seed. A value shaped for the OTHER width is accepted automatically
        and flips the toggle below to match; a value that fits neither is refused.
      </div>

      {/* The width toggle — 1024 (APOLLO) or 1600 (DALOS). Auto-correction
          (the parent's effect) can flip this on its own; this control lets the
          user flip it manually too. */}
      <div
        role="group"
        aria-label="Direct width"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 4,
          padding: 4,
          borderRadius: 8,
          backgroundColor: "#18181B",
        }}
      >
        {([1024, 1600] as const).map((width) => {
          const on = directWidth === width;
          return (
            <button
              key={width}
              type="button"
              data-testid={`arweave-seed-direct-width-${width}`}
              aria-pressed={on}
              onClick={() => handleWidthChange(width)}
              style={{
                padding: "8px 4px",
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
                backgroundColor: on ? `${ACCENT}22` : "transparent",
                color: on ? ACCENT : "#888",
              }}
            >
              {width === 1024 ? "1024-bit (APOLLO)" : "1600-bit (DALOS)"}
            </button>
          );
        })}
      </div>

      {/* The four input-kind tiles — the same test ids the earlier placeholder
          round used, now enabled and functioning as a radiogroup. */}
      <div
        role="radiogroup"
        aria-label="Direct input kind"
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
      >
        {DIRECT_INPUT_KINDS.map((kind) => {
          const on = directKind === kind.testId;
          return (
            <button
              key={kind.testId}
              type="button"
              role="radio"
              aria-checked={on}
              data-testid={`arweave-seed-direct-tile-${kind.testId}`}
              onClick={() => handleKindChange(kind.testId)}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                textAlign: "left",
                cursor: "pointer",
                ...(on ? primaryButtonStyle : secondaryButtonStyle),
              }}
            >
              {kind.label}
            </button>
          );
        })}
      </div>

      {directKind === "bitstring" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 11, color: "#888" }}>
              <strong>{directBitStringText.length}</strong>
              <span style={{ color: "#555" }}> / {directWidth} bits</span>
            </span>
            <button
              type="button"
              data-testid="arweave-seed-direct-random-bitstring"
              onClick={() => setDirectBitStringText(randomBits(directWidth))}
              style={secondaryButtonStyle}
            >
              Random BitString
            </button>
          </div>
          <textarea
            ref={bitStringRef}
            data-testid="arweave-seed-direct-bitstring-input"
            aria-label="Direct BitString"
            rows={4}
            value={directBitStringText}
            onChange={(e) =>
              applyBitStringChange(
                e.target.value.replace(/[^01]/g, "").slice(0, MAX_DIRECT_WIDTH),
              )
            }
            placeholder={`Paste or type exactly ${directWidth} bits (0s and 1s)…`}
            style={{
              ...inputStyle,
              width: "100%",
              fontFamily: MONO,
              wordBreak: "break-all",
              maxHeight: "60vh",
              overflowY: "auto",
              resize: "vertical",
            }}
          />
        </div>
      )}

      {directKind === "base10" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              data-testid="arweave-seed-direct-random-base10"
              onClick={() => setDirectInt10Text(randomDirectScalar(directWidth, 10))}
              style={secondaryButtonStyle}
            >
              Random Base-10 Scalar
            </button>
          </div>
          {/* A textarea, not a single-line input: a valid clamped scalar is
              hundreds of digits (483 decimal for 1600-bit, 309-310 for
              1024-bit) — a single-line input hides all but a sliver of it
              behind horizontal scroll. Wrapping shows the whole value. */}
          <textarea
            ref={int10Ref}
            data-testid="arweave-seed-direct-base10-input"
            aria-label="Direct Base-10 scalar"
            rows={2}
            value={directInt10Text}
            onChange={(e) =>
              applyScalarChange(e.target.value.replace(/[^0-9]/g, ""), 10, setDirectInt10Text)
            }
            placeholder="Enter a decimal integer (digits 0-9 only)…"
            style={{
              ...inputStyle,
              width: "100%",
              fontFamily: MONO,
              wordBreak: "break-all",
              maxHeight: "60vh",
              overflowY: "auto",
              resize: "vertical",
            }}
          />
        </div>
      )}

      {directKind === "base49" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              data-testid="arweave-seed-direct-random-base49"
              onClick={() => setDirectInt49Text(randomDirectScalar(directWidth, 49))}
              style={secondaryButtonStyle}
            >
              Random Base-49 Scalar
            </button>
          </div>
          {/* Same reasoning as Base-10: a clamped base-49 scalar is up to 286
              characters (1600-bit) — a textarea shows all of it, wrapped. */}
          <textarea
            ref={int49Ref}
            data-testid="arweave-seed-direct-base49-input"
            aria-label="Direct Base-49 scalar"
            rows={2}
            value={directInt49Text}
            onChange={(e) =>
              applyScalarChange(
                e.target.value
                  .split("")
                  .filter((ch) => BASE49_ALPHABET.includes(ch))
                  .join(""),
                49,
                setDirectInt49Text,
              )
            }
            placeholder={`Enter a base-49 integer. Alphabet: ${BASE49_ALPHABET}`}
            style={{
              ...inputStyle,
              width: "100%",
              fontFamily: MONO,
              wordBreak: "break-all",
              maxHeight: "60vh",
              overflowY: "auto",
              resize: "vertical",
            }}
          />
        </div>
      )}

      {directKind === "bitmap" && (
        <div data-testid="arweave-seed-direct-bitmap">
          <BitmapKeyInput
            rows={bitmapDim}
            cols={bitmapDim}
            onChange={setDirectBitmap}
            dimensionsLabel={`${bitmapDim} × ${bitmapDim} ${directWidth === 1600 ? "DALOS" : "APOLLO"} bitmap`}
            // `directBitmap` already holds the CONVERTED bits by the time
            // this mounts — `handleKindChange` (above) populates it from
            // whichever OTHER representation was valid before switching
            // here. `BitmapKeyInput` is deliberately uncontrolled, so this
            // only works because the surrounding `{directKind === "bitmap"
            // && (...)}` conditional gives it a genuine fresh mount on every
            // switch INTO this kind — the same value passed to an ALREADY-
            // mounted instance would do nothing, by design.
            initialBitmap={directBitmap ?? undefined}
          />
        </div>
      )}

      {directError !== null && (
        <div data-testid="arweave-seed-direct-error" style={errorStyle}>
          {directError}
        </div>
      )}
    </div>
  );
}

/**
 * The Restricted variant's word grid: ONE rectangle per word, numbered, with
 * prefix autocomplete and a per-slot red mark for a word the dictionary does not
 * hold.
 *
 * The look is deliberately NOT new — it is `CreateStoaChainSeedModal`'s /
 * `SpawnAccountModal`'s numbered 4-column word grid, so the Codex has one seed
 * grid and not two. What is added is that each cell is an INPUT (those two only
 * display words) and that a cell can be wrong on its own: with 24 slots, "one of
 * your words is not in the wordlist" is unactionable — the user has to be able
 * to SEE which rectangle is the no-go.
 *
 * The suggestion list opens on TYPING (not only on focus) and is keyboard
 * driven: ArrowDown/ArrowUp move the highlight, Enter/Tab take it, Escape closes.
 * `onMouseDown`'s `preventDefault` keeps the input focused so a click lands on
 * the option instead of being eaten by the blur.
 */
function RestrictedWordGrid({
  words,
  invalid,
  dictionary,
  onWordChange,
}: {
  words: readonly string[];
  invalid: readonly boolean[];
  dictionary: readonly string[];
  onWordChange: (index: number, word: string) => void;
}): React.ReactElement {
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  /** -1 = nothing highlighted yet, so the FIRST ArrowDown takes option 0. */
  const [highlight, setHighlight] = useState(-1);

  const suggestions = useMemo(
    () => (activeSlot === null ? [] : suggestWords(dictionary, words[activeSlot] ?? "")),
    [activeSlot, dictionary, words],
  );

  const choose = (index: number, word: string): void => {
    onWordChange(index, word);
    setActiveSlot(null);
    setHighlight(-1);
  };

  return (
    <div
      data-testid="arweave-seed-word-grid"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 6,
        padding: 12,
        borderRadius: 10,
        border: `1px solid ${ACCENT}20`,
        backgroundColor: `${ACCENT}05`,
      }}
    >
      {words.map((word, index) => {
        const bad = invalid[index] === true;
        const open = activeSlot === index && suggestions.length > 0;
        return (
          <div
            key={index}
            data-testid={`arweave-seed-word-slot-${index}`}
            data-invalid={String(bad)}
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "6px 8px",
              borderRadius: 6,
              borderStyle: "solid",
              borderWidth: 1,
              borderColor: bad ? INVALID_WORD_COLOR : `${ACCENT}30`,
              backgroundColor: bad ? "#1a0a0a" : `${ACCENT}08`,
            }}
          >
            <span
              style={{ fontSize: 10, flexShrink: 0, color: bad ? INVALID_WORD_COLOR : `${ACCENT}99` }}
            >
              {index + 1}.
            </span>
            <input
              type="text"
              data-testid={`arweave-seed-word-input-${index}`}
              aria-label={`Seed word ${index + 1}`}
              aria-invalid={bad}
              autoComplete="off"
              spellCheck={false}
              value={word}
              onChange={(e) => {
                // Whitespace is how a slot would become two words; the grid, not
                // the spacebar, decides where a word ends.
                onWordChange(index, e.target.value.replace(/\s+/g, "").toLowerCase());
                setActiveSlot(index);
                setHighlight(-1);
              }}
              onFocus={() => {
                setActiveSlot(index);
                setHighlight(-1);
              }}
              onBlur={() => setActiveSlot((prev) => (prev === index ? null : prev))}
              onKeyDown={(e) => {
                if (!open) return;
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setHighlight((prev) => Math.min(prev + 1, suggestions.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setHighlight((prev) => Math.max(prev - 1, 0));
                } else if (e.key === "Enter" || e.key === "Tab") {
                  const picked = suggestions[highlight];
                  if (picked !== undefined) {
                    e.preventDefault();
                    choose(index, picked);
                  }
                } else if (e.key === "Escape") {
                  setActiveSlot(null);
                  setHighlight(-1);
                }
              }}
              style={{
                width: "100%",
                minWidth: 0,
                padding: 0,
                outline: "none",
                borderStyle: "solid",
                borderWidth: 1,
                borderColor: bad ? INVALID_WORD_COLOR : "transparent",
                borderRadius: 4,
                backgroundColor: "transparent",
                fontFamily: MONO,
                fontSize: 11,
                color: bad ? INVALID_WORD_COLOR : "#d2d3d4",
              }}
            />
            {open && (
              <div
                role="listbox"
                data-testid={`arweave-seed-word-suggestions-${index}`}
                style={{
                  position: "absolute",
                  zIndex: 5,
                  top: "100%",
                  left: 0,
                  right: 0,
                  marginTop: 2,
                  display: "flex",
                  flexDirection: "column",
                  borderRadius: 6,
                  border: "1px solid #262626",
                  backgroundColor: "#0d0d0d",
                  overflow: "hidden",
                }}
              >
                {suggestions.map((candidate, option) => (
                  <button
                    key={candidate}
                    type="button"
                    role="option"
                    aria-selected={option === highlight}
                    data-testid={`arweave-seed-word-suggestion-${index}-${option}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(index, candidate)}
                    style={{
                      padding: "4px 8px",
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                      fontFamily: MONO,
                      fontSize: 11,
                      backgroundColor: option === highlight ? `${ACCENT}22` : "transparent",
                      color: option === highlight ? ACCENT : "#d2d3d4",
                    }}
                  >
                    {candidate}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 8,
  border: "1px solid #262626",
  backgroundColor: "#0d0d0d",
  color: "#d2d3d4",
  fontSize: 12,
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
};

export default ArweaveSeedsArea;
