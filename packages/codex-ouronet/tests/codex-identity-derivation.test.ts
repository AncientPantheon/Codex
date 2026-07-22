/**
 * deriveDoubleApollo tests — Phase 4 of the v0.3.0 codex spec (REQ-04).
 *
 * Strategy for known-answer validation (F-003): no external KAT vector file
 * (`testvectors/v1_historical.json`) ships in this dalos-crypto build, so each
 * "round-trip" spec independently re-derives the expected half via APOLLO
 * directly (`Apollo.generateFromSeedWords` / `Apollo.generateFromBitString`)
 * and asserts byte-identity against deriveDoubleApollo's output. This proves
 * deriveDoubleApollo's split + per-half derivation matches the canonical
 * primitive exactly. External Go-reference KATs are deferred to the release
 * ceremony (no vectors available in node_modules to reproduce here).
 */

import { describe, it, expect } from "vitest";
import {
  deriveDoubleApollo,
} from "@ancientpantheon/codex-ouronet/codex-identity";
import { CodexIdentityError } from "@ancientpantheon/codex-ouronet/errors";
import { Apollo } from "@ouronet/dalos-crypto/registry";
import { bigIntToBase49 } from "@ouronet/dalos-crypto/gen1";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORDS_12 = [
  "alpha", "bravo", "charlie", "delta", "echo", "foxtrot",
  "golf", "hotel", "india", "juliet", "kilo", "lima",
];

/** Build a 2048-bit deterministic bitstring. */
function bits2048(): string {
  return "10".repeat(1024);
}

/** Encode a 2048-bit bitstring as a 32-row x 64-col '#'/'.' grid where
 *  columns 0-31 of each row are the Standard half (row-major) and columns
 *  32-63 are the Smart half. Mirrors deriveDoubleApollo's bitmap decoder. */
function bitsToGrid(bits: string): string {
  const standard = bits.slice(0, 1024);
  const smart = bits.slice(1024);
  const rows: string[] = [];
  for (let r = 0; r < 32; r++) {
    let row = "";
    for (let c = 0; c < 32; c++) {
      row += standard[r * 32 + c] === "1" ? "#" : ".";
    }
    for (let c = 0; c < 32; c++) {
      row += smart[r * 32 + c] === "1" ? "#" : ".";
    }
    rows.push(row);
  }
  return rows.join("\n");
}

// ---------------------------------------------------------------------------
// Spec 1 — words mode round-trip, 12 words (even)
// ---------------------------------------------------------------------------

describe("deriveDoubleApollo — words mode", () => {
  it("splits 12 even words at index 6 and each half matches an independent APOLLO seed-word derivation", () => {
    const seed = WORDS_12.join(" ");
    const result = deriveDoubleApollo(seed, "words");

    expect(result.totalWordCount).toBe(12);
    expect(result.splitIndex).toBe(6);

    const stdExpected = Apollo.generateFromSeedWords(WORDS_12.slice(0, 6));
    const smtExpected = Apollo.generateFromSeedWords(WORDS_12.slice(6));

    expect(result.standard.publicKey).toBe(stdExpected.keyPair.publ);
    expect(result.smart.publicKey).toBe(smtExpected.keyPair.publ);
    expect(result.standard.formats.bitstring).toBe(stdExpected.privateKey.bitString);
    expect(result.smart.formats.bitstring).toBe(smtExpected.privateKey.bitString);
  });

  // Spec 2 — odd count: Smart half is bigger by one
  it("gives the Smart half the larger share on a 7-word (odd) seed", () => {
    const seven = WORDS_12.slice(0, 7);
    const result = deriveDoubleApollo(seven.join(" "), "words");

    expect(result.splitIndex).toBe(3);

    const stdExpected = Apollo.generateFromSeedWords(seven.slice(0, 3)); // 3 words
    const smtExpected = Apollo.generateFromSeedWords(seven.slice(3)); // 4 words

    expect(result.standard.publicKey).toBe(stdExpected.keyPair.publ);
    expect(result.smart.publicKey).toBe(smtExpected.keyPair.publ);
  });

  // Spec 3 — minimum boundary: 2 words valid, 1 word rejected
  it("accepts the 2-word minimum (1 word per half) and rejects a single word", () => {
    const two = deriveDoubleApollo("alpha bravo", "words");
    expect(two.totalWordCount).toBe(2);
    expect(two.splitIndex).toBe(1);

    expect(() => deriveDoubleApollo("alpha", "words")).toThrowError(
      CodexIdentityError
    );
    try {
      deriveDoubleApollo("alpha", "words");
    } catch (e) {
      expect((e as CodexIdentityError).reason).toBe("seed-word-count");
      expect((e as CodexIdentityError).message).toContain("2..512");
    }
  });

  // Spec 4 — rejects empty / 513 / oversized-word
  it("rejects empty input, 513-word input, and a 257-glyph word", () => {
    expect(() => deriveDoubleApollo("   ", "words")).toThrowError(
      CodexIdentityError
    );
    try {
      deriveDoubleApollo("", "words");
    } catch (e) {
      expect((e as CodexIdentityError).reason).toBe("seed-word-count");
    }

    const tooMany = Array.from({ length: 513 }, (_, i) => `w${i}`).join(" ");
    try {
      deriveDoubleApollo(tooMany, "words");
      throw new Error("expected throw");
    } catch (e) {
      expect((e as CodexIdentityError).reason).toBe("seed-word-count");
    }

    const longWord = "x".repeat(257);
    try {
      deriveDoubleApollo(`alpha ${longWord}`, "words");
      throw new Error("expected throw");
    } catch (e) {
      expect((e as CodexIdentityError).reason).toBe("seed-invalid");
      expect((e as CodexIdentityError).message).toContain("256");
    }
  });
});

// ---------------------------------------------------------------------------
// Spec 5 + 6 — bitstring mode
// ---------------------------------------------------------------------------

describe("deriveDoubleApollo — bitstring mode", () => {
  it("splits a 2048-bit string at 1024 and each half matches independent APOLLO bitstring derivation", () => {
    const seed = bits2048();
    const result = deriveDoubleApollo(seed, "bitstring");

    expect(result.splitIndex).toBe(1024);
    expect(result.totalWordCount).toBe(0);

    const stdExpected = Apollo.generateFromBitString(seed.slice(0, 1024));
    const smtExpected = Apollo.generateFromBitString(seed.slice(1024));

    expect(result.standard.publicKey).toBe(stdExpected.keyPair.publ);
    expect(result.smart.publicKey).toBe(smtExpected.keyPair.publ);
    expect(result.standard.formats.bitstring).toBe(seed.slice(0, 1024));
    expect(result.smart.formats.bitstring).toBe(seed.slice(1024));
  });

  it("rejects wrong-length and non-binary bitstrings", () => {
    expect(() => deriveDoubleApollo("1".repeat(2047), "bitstring")).toThrowError(
      CodexIdentityError
    );
    expect(() => deriveDoubleApollo("1".repeat(2049), "bitstring")).toThrowError(
      CodexIdentityError
    );
    const withTwo = "2" + "1".repeat(2047);
    try {
      deriveDoubleApollo(withTwo, "bitstring");
      throw new Error("expected throw");
    } catch (e) {
      expect((e as CodexIdentityError).reason).toBe("seed-invalid");
    }
  });
});

// ---------------------------------------------------------------------------
// Spec 7 — base10 mode
// ---------------------------------------------------------------------------

describe("deriveDoubleApollo — base10 mode", () => {
  it("parses a decimal scalar, splits at 1024, and matches independent derivation + int10 format", () => {
    const B = bits2048();
    const dec = BigInt("0b" + B).toString(10);
    const result = deriveDoubleApollo(dec, "base10");

    expect(result.splitIndex).toBe(1024);

    const stdExpected = Apollo.generateFromBitString(B.slice(0, 1024));
    expect(result.standard.publicKey).toBe(stdExpected.keyPair.publ);
    expect(result.standard.formats.base10).toBe(stdExpected.privateKey.int10);
  });

  it("rejects non-decimal input and oversize scalars", () => {
    expect(() => deriveDoubleApollo("12x9", "base10")).toThrowError(
      CodexIdentityError
    );
    const oversize = (2n ** 2048n).toString(10); // needs 2049 bits
    expect(() => deriveDoubleApollo(oversize, "base10")).toThrowError(
      CodexIdentityError
    );
  });
});

// ---------------------------------------------------------------------------
// Spec 8 — base49 mode
// ---------------------------------------------------------------------------

describe("deriveDoubleApollo — base49 mode", () => {
  it("parses a base-49 scalar, splits at 1024, and matches independent derivation", () => {
    const B = bits2048();
    const dec = BigInt("0b" + B);
    const b49 = bigIntToBase49(dec);
    const result = deriveDoubleApollo(b49, "base49");

    expect(result.splitIndex).toBe(1024);

    const stdExpected = Apollo.generateFromBitString(B.slice(0, 1024));
    const smtExpected = Apollo.generateFromBitString(B.slice(1024));
    expect(result.standard.publicKey).toBe(stdExpected.keyPair.publ);
    expect(result.smart.publicKey).toBe(smtExpected.keyPair.publ);
  });

  it("rejects characters outside the base-49 alphabet", () => {
    // '!' is not in BASE49_ALPHABET
    expect(() => deriveDoubleApollo("0!0", "base49")).toThrowError(
      CodexIdentityError
    );
  });
});

// ---------------------------------------------------------------------------
// Spec 9 + 10 — bitmap mode
// ---------------------------------------------------------------------------

describe("deriveDoubleApollo — bitmap mode", () => {
  it("decodes a 32x64 grid: columns 0-31 -> standard half, 32-63 -> smart half", () => {
    const B = bits2048();
    const grid = bitsToGrid(B);
    const result = deriveDoubleApollo(grid, "bitmap");

    expect(result.standard.formats.bitstring).toBe(B.slice(0, 1024));
    expect(result.smart.formats.bitstring).toBe(B.slice(1024));

    const stdExpected = Apollo.generateFromBitString(B.slice(0, 1024));
    expect(result.standard.publicKey).toBe(stdExpected.keyPair.publ);
  });

  it("rejects malformed grids: wrong row count, wrong column count, invalid char, empty", () => {
    const B = bits2048();
    const grid = bitsToGrid(B);
    const rows = grid.split("\n");

    // 31 rows
    expect(() =>
      deriveDoubleApollo(rows.slice(0, 31).join("\n"), "bitmap")
    ).toThrowError(CodexIdentityError);
    // 33 rows
    expect(() =>
      deriveDoubleApollo(grid + "\n" + rows[0], "bitmap")
    ).toThrowError(CodexIdentityError);
    // wrong column count (truncate one row)
    const badCols = [...rows];
    badCols[0] = badCols[0].slice(0, 63);
    expect(() => deriveDoubleApollo(badCols.join("\n"), "bitmap")).toThrowError(
      CodexIdentityError
    );
    // invalid char
    const badChar = [...rows];
    badChar[0] = "X" + badChar[0].slice(1);
    expect(() => deriveDoubleApollo(badChar.join("\n"), "bitmap")).toThrowError(
      CodexIdentityError
    );
    // empty
    expect(() => deriveDoubleApollo("", "bitmap")).toThrowError(
      CodexIdentityError
    );
  });
});

// ---------------------------------------------------------------------------
// Spec 11 — splitOverride strict-strict bounds (words)
// ---------------------------------------------------------------------------

describe("deriveDoubleApollo — splitOverride (F-001 strict-strict bounds)", () => {
  const six = WORDS_12.slice(0, 6).join(" ");

  it("honours a valid in-bounds override (2) and the upper boundary (5)", () => {
    const r2 = deriveDoubleApollo(six, "words", 2);
    expect(r2.splitIndex).toBe(2);
    const stdExpected = Apollo.generateFromSeedWords(WORDS_12.slice(0, 2));
    expect(r2.standard.publicKey).toBe(stdExpected.keyPair.publ);

    const r5 = deriveDoubleApollo(six, "words", 5);
    expect(r5.splitIndex).toBe(5);
    const smtExpected = Apollo.generateFromSeedWords(WORDS_12.slice(5, 6));
    expect(r5.smart.publicKey).toBe(smtExpected.keyPair.publ);
  });

  it("rejects override <= 0 and >= wordCount", () => {
    for (const bad of [-1, 0, 6, 7]) {
      try {
        deriveDoubleApollo(six, "words", bad);
        throw new Error(`expected throw for ${bad}`);
      } catch (e) {
        expect((e as CodexIdentityError).reason).toBe("split-invalid");
      }
    }
    try {
      deriveDoubleApollo(six, "words", 0);
    } catch (e) {
      expect((e as CodexIdentityError).message).toContain("0 < split < count");
    }
  });
});

// ---------------------------------------------------------------------------
// Spec 12 — determinism across all 5 modes
// ---------------------------------------------------------------------------

describe("deriveDoubleApollo — determinism (F-005, purity)", () => {
  it("produces byte-identical output on repeat calls for every mode", () => {
    const B = bits2048();
    const cases: Array<[string, "words" | "bitstring" | "base10" | "base49" | "bitmap"]> = [
      [WORDS_12.join(" "), "words"],
      [B, "bitstring"],
      [BigInt("0b" + B).toString(10), "base10"],
      [bigIntToBase49(BigInt("0b" + B)), "base49"],
      [bitsToGrid(B), "bitmap"],
    ];
    for (const [seed, mode] of cases) {
      const a = deriveDoubleApollo(seed, mode);
      const b = deriveDoubleApollo(seed, mode);
      expect(a).toEqual(b);
    }
  });
});

// ---------------------------------------------------------------------------
// Spec 13/14/15 — within-bitstring encoding round-trips
// ---------------------------------------------------------------------------

describe("deriveDoubleApollo — encoding round-trips (F-002 replacement)", () => {
  const B = bits2048();

  it("bitstring and base10 of the same scalar yield identical keypairs", () => {
    const r1 = deriveDoubleApollo(B, "bitstring");
    const dec = BigInt("0b" + B).toString(10);
    const r2 = deriveDoubleApollo(dec, "base10");
    expect(r1.standard.publicKey).toBe(r2.standard.publicKey);
    expect(r1.smart.publicKey).toBe(r2.smart.publicKey);
  });

  it("bitstring and base49 of the same scalar yield identical keypairs", () => {
    const r1 = deriveDoubleApollo(B, "bitstring");
    const b49 = bigIntToBase49(BigInt("0b" + B));
    const r2 = deriveDoubleApollo(b49, "base49");
    expect(r1.standard.publicKey).toBe(r2.standard.publicKey);
    expect(r1.smart.publicKey).toBe(r2.smart.publicKey);
  });

  it("bitstring and bitmap of the same scalar yield identical keypairs", () => {
    const r1 = deriveDoubleApollo(B, "bitstring");
    const r2 = deriveDoubleApollo(bitsToGrid(B), "bitmap");
    expect(r1.standard.publicKey).toBe(r2.standard.publicKey);
    expect(r1.smart.publicKey).toBe(r2.smart.publicKey);
  });
});

// ---------------------------------------------------------------------------
// formatted output + bitmap format shape
// ---------------------------------------------------------------------------

describe("deriveDoubleApollo — formatted address", () => {
  it("joins APOLLO standard (₱.) and smart (Π.) addresses with a colon", () => {
    const result = deriveDoubleApollo(WORDS_12.join(" "), "words");
    const stdExpected = Apollo.generateFromSeedWords(WORDS_12.slice(0, 6));
    const smtExpected = Apollo.generateFromSeedWords(WORDS_12.slice(6));

    expect(result.formatted).toBe(
      `${stdExpected.standardAddress}:${smtExpected.smartAddress}`
    );
    expect(result.formatted.startsWith("₱.")).toBe(true);
    expect(result.formatted).toContain(":Π.");
  });

  it("renders each half's bitmap format as a 32x32 '#'/'.' grid", () => {
    const result = deriveDoubleApollo(WORDS_12.join(" "), "words");
    const rows = result.standard.formats.bitmap.split("\n");
    expect(rows).toHaveLength(32);
    for (const row of rows) {
      expect(row).toHaveLength(32);
      expect(/^[#.]+$/.test(row)).toBe(true);
    }
    // bitmap must encode the same bits as formats.bitstring
    const flat = rows.join("").replace(/#/g, "1").replace(/\./g, "0");
    expect(flat).toBe(result.standard.formats.bitstring);
  });
});
