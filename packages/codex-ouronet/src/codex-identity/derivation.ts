/**
 * Pure Apollo double-derivation for the Codex identity.
 *
 * `deriveDoubleApollo` turns a single seed (in one of five encodings) into a
 * pair of independent APOLLO keypairs — a "Standard" half and a "Smart" half —
 * plus all four cached private-key representations per half and a combined
 * display address. It is the SOURCE of the plaintext values that Phase 7's
 * `kickstartCodex` later encrypts into `ICodexIdentity.encrypted*` fields.
 *
 * Design contract (v0.3.0):
 *   - PURE: no store, adapter, snapshot, localStorage, window, or randomness.
 *     Same `(seedInput, mode, splitOverride)` → byte-identical output, always.
 *   - SYNCHRONOUS: APOLLO's `generateFrom*` paths are synchronous.
 *   - APOLLO is entered via the registry-mediated primitive
 *     (`@ouronet/dalos-crypto/registry`) so addresses carry APOLLO's own
 *     `₱.` / `Π.` prefixes rather than DALOS Genesis's `Ѻ.` / `Σ.`.
 *
 * Split rule (matches the Phase 3 ICodexIdentity invariant):
 *   - `words` mode: tokens split at `Math.floor(wordCount / 2)`. On odd counts
 *     the Smart half gets the larger share (wordCount 7 → Standard 3, Smart 4).
 *     Each half independently runs APOLLO's seven-fold-Blake3 seed-word path,
 *     so the two halves are NOT a single 2048-bit value cut in two.
 *   - all other modes: the seed becomes a 2048-bit string; bits 0..1023 are the
 *     Standard half, bits 1024..2047 the Smart half. APOLLO's S=1024 means each
 *     half is exactly one APOLLO scalar.
 *
 * APOLLO requires exactly 1024 bits per `generateFromBitString` call, so every
 * non-words mode normalises its scalar to a 2048-bit string before splitting.
 *
 * Glyph counting for `words` mode uses UTF-16 code units (`string.length`).
 * Per the F-004 lock, `words` input is UTF-8 — NOT strictly Dalos-charset —
 * because APOLLO's `generateFromSeedWords` Blake3-hashes raw UTF-8 bytes with
 * no charset check. Consumers wanting strict Dalos-charset must enforce it
 * client-side before calling.
 */

import { Apollo } from "@ouronet/dalos-crypto/registry";
import type { FullKey } from "@ouronet/dalos-crypto/registry";
import { BASE49_ALPHABET, parseBigIntInBase } from "@ouronet/dalos-crypto/gen1";
import { CodexIdentityError } from "../errors/index.js";

/** The four cached private-key representations of one APOLLO half. */
export interface ApolloHalfDerivation {
  /** APOLLO public key (base-49 encoded, `"{prefixLen}.{xyBase49}"`). */
  publicKey: string;
  /** APOLLO private key (base-49 scalar form — the canonical priv form). */
  privateKey: string;
  formats: {
    /** Canonical 1024-bit bit-string (APOLLO S=1024). */
    bitstring: string;
    /** 32×32 `'#'`/`'.'` ASCII grid of the 1024-bit bit-string. */
    bitmap: string;
    /** Base-10 integer form of the scalar. */
    base10: string;
    /** Base-49 integer form of the scalar. */
    base49: string;
  };
}

/** Full result of a double-Apollo derivation: both halves + display address. */
export interface DoubleApolloDerivation {
  standard: ApolloHalfDerivation;
  smart: ApolloHalfDerivation;
  /** `"{standardAddress}:{smartAddress}"` — APOLLO `₱.…:Π.…`. */
  formatted: string;
  /** Word count for `words` mode; `0` for the bit-based modes. */
  totalWordCount: number;
  /** Resolved split point (word index for `words`, bit index 1024 otherwise). */
  splitIndex: number;
}

/** The five seed encodings accepted by {@link deriveDoubleApollo}. */
export type DeriveSeedMode =
  | "words"
  | "bitstring"
  | "bitmap"
  | "base10"
  | "base49";

const APOLLO_BITS_PER_HALF = 1024;
const APOLLO_BITS_TOTAL = APOLLO_BITS_PER_HALF * 2; // 2048
const BITMAP_ROWS = 32;
const BITMAP_HALF_COLS = 32; // each half is a 32×32 grid
const BITMAP_FULL_COLS = BITMAP_HALF_COLS * 2; // 64-col doubled input grid
const MIN_WORDS = 2; // each half needs ≥1 word
const MAX_WORDS = 512;
const MAX_GLYPHS_PER_WORD = 256;
const BASE49_SET = new Set(BASE49_ALPHABET.split(""));

/** Render a 1024-bit bit-string as a 32×32 `'#'`/`'.'` ASCII grid (row-major).
 *
 * APOLLO is 1024 bits = 32×32; dalos-crypto's gen1 bitmap helpers hardcode
 * the DALOS 40×40 = 1600-bit grid, so the APOLLO-sized grid is produced
 * consumer-side here per the bitmap.d.ts scope boundary. */
function bitstringTo32x32Ascii(bits: string): string {
  const rows: string[] = [];
  for (let r = 0; r < BITMAP_ROWS; r++) {
    let row = "";
    for (let c = 0; c < BITMAP_HALF_COLS; c++) {
      row += bits[r * BITMAP_HALF_COLS + c] === "1" ? "#" : ".";
    }
    rows.push(row);
  }
  return rows.join("\n");
}

/** Decode a 32-row × 64-col `'#'`/`'.'` grid into a 2048-bit string where each
 *  row contributes its Standard columns (0..31) followed — across all rows —
 *  by its Smart columns (32..63). Throws `seed-invalid` on any malformation. */
function gridTo2048Bits(grid: string): string {
  const rows = grid.split("\n");
  if (rows.length !== BITMAP_ROWS) {
    throw new CodexIdentityError(
      "seed-invalid",
      `bitmap must have ${BITMAP_ROWS} rows, got ${rows.length}`
    );
  }
  let standard = "";
  let smart = "";
  for (let r = 0; r < BITMAP_ROWS; r++) {
    const row = rows[r];
    if (row.length !== BITMAP_FULL_COLS) {
      throw new CodexIdentityError(
        "seed-invalid",
        `bitmap row ${r} must have ${BITMAP_FULL_COLS} columns, got ${row.length}`
      );
    }
    for (let c = 0; c < BITMAP_FULL_COLS; c++) {
      const ch = row[c];
      let bit: string;
      if (ch === "#") bit = "1";
      else if (ch === ".") bit = "0";
      else
        throw new CodexIdentityError(
          "seed-invalid",
          `bitmap cell [${r},${c}] must be '#' or '.', got ${JSON.stringify(ch)}`
        );
      if (c < BITMAP_HALF_COLS) standard += bit;
      else smart += bit;
    }
  }
  return standard + smart;
}

/** Validate + normalise a `bitstring`-mode seed to exactly 2048 bits. */
function normalizeBitstring(seedInput: string): string {
  if (seedInput.length !== APOLLO_BITS_TOTAL) {
    throw new CodexIdentityError(
      "seed-invalid",
      `bitstring must be exactly ${APOLLO_BITS_TOTAL} bits, got ${seedInput.length}`
    );
  }
  if (!/^[01]+$/.test(seedInput)) {
    throw new CodexIdentityError(
      "seed-invalid",
      "bitstring must contain only '0' and '1'"
    );
  }
  return seedInput;
}

/** Render a BigInt scalar as a left-padded 2048-bit string, rejecting oversize. */
function scalarTo2048Bits(scalar: bigint, modeLabel: string): string {
  const raw = scalar.toString(2);
  if (raw.length > APOLLO_BITS_TOTAL) {
    throw new CodexIdentityError(
      "seed-invalid",
      `${modeLabel} scalar exceeds ${APOLLO_BITS_TOTAL} bits (got ${raw.length})`
    );
  }
  return raw.padStart(APOLLO_BITS_TOTAL, "0");
}

/** Parse + normalise a `base10`-mode seed to exactly 2048 bits. */
function normalizeBase10(seedInput: string): string {
  let scalar: bigint;
  try {
    scalar = BigInt(seedInput);
  } catch {
    throw new CodexIdentityError(
      "seed-invalid",
      "base10 input is not a valid decimal integer"
    );
  }
  if (scalar < 0n) {
    throw new CodexIdentityError(
      "seed-invalid",
      "base10 input must be non-negative"
    );
  }
  return scalarTo2048Bits(scalar, "base10");
}

/** Parse + normalise a `base49`-mode seed to exactly 2048 bits. */
function normalizeBase49(seedInput: string): string {
  if (seedInput.length === 0) {
    throw new CodexIdentityError("seed-invalid", "base49 input is empty");
  }
  for (const ch of seedInput) {
    if (!BASE49_SET.has(ch)) {
      throw new CodexIdentityError(
        "seed-invalid",
        `base49 input has character ${JSON.stringify(ch)} outside the alphabet`
      );
    }
  }
  const scalar = parseBigIntInBase(seedInput, 49);
  return scalarTo2048Bits(scalar, "base49");
}

/** Tokenise + validate a `words`-mode seed into a non-empty word array. */
function parseWords(seedInput: string): string[] {
  const trimmed = seedInput.trim();
  const words = trimmed.length === 0 ? [] : trimmed.split(/\s+/);
  if (words.length < MIN_WORDS || words.length > MAX_WORDS) {
    throw new CodexIdentityError(
      "seed-word-count",
      `got ${words.length}, range ${MIN_WORDS}..${MAX_WORDS}`
    );
  }
  words.forEach((word, i) => {
    // Glyph count is UTF-16 code units (string.length).
    if (word.length < 1 || word.length > MAX_GLYPHS_PER_WORD) {
      throw new CodexIdentityError(
        "seed-invalid",
        `word ${i} has ${word.length} glyphs, range 1..${MAX_GLYPHS_PER_WORD}`
      );
    }
  });
  return words;
}

/** Build the per-half cached representation from APOLLO's FullKey. */
function buildHalf(fullKey: FullKey): ApolloHalfDerivation {
  return {
    publicKey: fullKey.keyPair.publ,
    privateKey: fullKey.keyPair.priv,
    formats: {
      bitstring: fullKey.privateKey.bitString,
      bitmap: bitstringTo32x32Ascii(fullKey.privateKey.bitString),
      base10: fullKey.privateKey.int10,
      base49: fullKey.privateKey.int49,
    },
  };
}

/**
 * Derive two independent APOLLO keypairs from a single seed.
 *
 * @param seedInput Seed material in the encoding named by `mode`.
 * @param mode One of `"words" | "bitstring" | "bitmap" | "base10" | "base49"`.
 * @param splitOverride Optional override of the default split point. Bounds are
 *   STRICT-STRICT (F-001): `0 < splitOverride < total`, so both halves keep at
 *   least one word (or one bit's worth of scalar). For `words` the bound is the
 *   word count; for bit-based modes it is {@link APOLLO_BITS_TOTAL} (2048).
 *   Phase 3's CodexIdentityError default message states the inclusive
 *   `0 <= split <= total` type-level bound; this runtime narrows it via the
 *   thrown `detail`.
 * @throws {CodexIdentityError} `seed-word-count` (word count out of 2..512),
 *   `seed-invalid` (bad glyph/char/length/oversize), or `split-invalid`
 *   (override outside the strict-strict bounds).
 */
export function deriveDoubleApollo(
  seedInput: string,
  mode: DeriveSeedMode,
  splitOverride?: number
): DoubleApolloDerivation {
  let standardKey: FullKey;
  let smartKey: FullKey;
  let totalWordCount: number;
  let splitIndex: number;

  if (mode === "words") {
    const words = parseWords(seedInput);
    totalWordCount = words.length;
    splitIndex = splitOverride ?? Math.floor(totalWordCount / 2);

    if (splitOverride !== undefined) {
      if (splitOverride <= 0 || splitOverride >= totalWordCount) {
        throw new CodexIdentityError(
          "split-invalid",
          `Phase 4 requires 0 < split < count; got ${splitOverride}`
        );
      }
    }

    const standardWords = words.slice(0, splitIndex);
    const smartWords = words.slice(splitIndex);
    standardKey = Apollo.generateFromSeedWords(standardWords);
    smartKey = Apollo.generateFromSeedWords(smartWords);
  } else {
    let bits: string;
    if (mode === "bitstring") bits = normalizeBitstring(seedInput);
    else if (mode === "bitmap") bits = gridTo2048Bits(seedInput);
    else if (mode === "base10") bits = normalizeBase10(seedInput);
    else bits = normalizeBase49(seedInput);

    totalWordCount = 0;
    splitIndex = splitOverride ?? APOLLO_BITS_PER_HALF;

    if (splitOverride !== undefined) {
      if (splitOverride <= 0 || splitOverride >= APOLLO_BITS_TOTAL) {
        throw new CodexIdentityError(
          "split-invalid",
          `Phase 4 requires 0 < split < count; got ${splitOverride}`
        );
      }
    }

    standardKey = Apollo.generateFromBitString(bits.slice(0, splitIndex));
    smartKey = Apollo.generateFromBitString(bits.slice(splitIndex));
  }

  return {
    standard: buildHalf(standardKey),
    smart: buildHalf(smartKey),
    formatted: `${standardKey.standardAddress}:${smartKey.smartAddress}`,
    totalWordCount,
    splitIndex,
  };
}
