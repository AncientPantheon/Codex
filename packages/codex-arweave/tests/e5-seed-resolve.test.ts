// @vitest-environment node
/**
 * E5 RED matrix — `resolveSeedBitString`, the ONE gate every Arweave seed
 * passes through (design.md: "every Arweave seed is a 1600-bit DALOS-ellipse
 * bitstring").
 *
 * All three UI sources converge here:
 *   - Options 1a/1b (typed words, free or BIP-dictionary gated) → `kind:"words"`
 *   - Option 2 (an activated Ouronet account's key material)    → `kind:"bitstring"`
 *   - Option 3 (an existing Chainweb BIP39 seed)                → `kind:"words"`
 *
 * Two FUNDS-CRITICAL invariants are pinned here, because both failure modes are
 * silent and unrecoverable once a key has been derived:
 *   1. EXACTLY 1600 bits out, or refusal. Never pad, never truncate — a padded
 *      1024-bit Apollo bitstring would derive a DIFFERENT RSA key than the same
 *      material would under the deferred Apollo pass, so it is refused here.
 *   2. Validation failures are RETURNED as human-readable `error` text, never
 *      thrown — the define-seed form renders the string inline, and an escaping
 *      `InvalidSeedWordsError` would blow up the panel instead.
 */

import { describe, it, expect } from "vitest";

import { resolveSeedBitString } from "../src/seeds";

/** The DALOS ellipse bit length. Anything else is refused, never coerced. */
const SEED_BITS = 1600;

const BITS_ONLY = /^[01]+$/;

/** A real BIP39 12-word phrase — the Option 3 (Chainweb seed) path. */
const BIP39_PHRASE =
  "abandon ability able about above absent absorb abstract absurd abuse access accident".split(
    " ",
  );

/** Narrow the union so a wrong branch fails loudly instead of `undefined`. */
function expectBits(result: { bits: string } | { error: string }): string {
  if ("error" in result) {
    throw new Error(`expected bits, got error: ${result.error}`);
  }
  return result.bits;
}

function expectError(result: { bits: string } | { error: string }): string {
  if ("bits" in result) {
    throw new Error(`expected an error, got ${result.bits.length} bits`);
  }
  return result.error;
}

describe("resolveSeedBitString — words (Options 1a/1b, Option 3)", () => {
  it("(a) converts arbitrary DALOS-legal words to exactly 1600 binary digits", () => {
    const bits = expectBits(resolveSeedBitString({ kind: "words", words: ["hello", "world"] }));

    expect(bits).toHaveLength(SEED_BITS);
    expect(bits).toMatch(BITS_ONLY);
  });

  it("(b) converts a real 12-word BIP39 phrase to 1600 bits — the Option 3 path", () => {
    const bits = expectBits(resolveSeedBitString({ kind: "words", words: BIP39_PHRASE }));

    expect(bits).toHaveLength(SEED_BITS);
    expect(bits).toMatch(BITS_ONLY);
  });

  it("is deterministic — the same words always derive the same bitstring", () => {
    const first = expectBits(resolveSeedBitString({ kind: "words", words: BIP39_PHRASE }));
    const second = expectBits(resolveSeedBitString({ kind: "words", words: BIP39_PHRASE }));

    expect(second).toBe(first);
  });

  it("(c) returns an error naming the offending word for a glyph outside the DALOS charset", () => {
    let result: { bits: string } | { error: string };
    expect(() => {
      result = resolveSeedBitString({ kind: "words", words: ["hello", "wor中ld"] });
    }).not.toThrow();

    const error = expectError(result!);
    expect(error).toContain("wor中ld");
    expect(error.length).toBeGreaterThan(0);
  });

  it("(d) returns an error for more than 256 words", () => {
    const tooMany = Array.from({ length: 257 }, () => "word");

    const error = expectError(resolveSeedBitString({ kind: "words", words: tooMany }));
    expect(error).toContain("256");
  });

  it("returns an error for an empty word list rather than deriving a key from nothing", () => {
    expect(expectError(resolveSeedBitString({ kind: "words", words: [] }))).toBeTruthy();
  });
});

describe("resolveSeedBitString — bitstring (Option 2, an Ouronet account)", () => {
  it("(f) passes exactly 1600 valid bits through unchanged", () => {
    const source = "1011".repeat(SEED_BITS / 4);
    expect(source).toHaveLength(SEED_BITS);

    expect(expectBits(resolveSeedBitString({ kind: "bitstring", bits: source }))).toBe(source);
  });

  it("(e) refuses a 1024-bit Apollo bitstring rather than padding it to 1600", () => {
    const apollo = "1".repeat(1024);

    const error = expectError(resolveSeedBitString({ kind: "bitstring", bits: apollo }));
    expect(error).toContain("1600");
    expect(error).toContain("1024");
  });

  it("refuses a bitstring longer than 1600 rather than truncating it", () => {
    expect(
      expectError(resolveSeedBitString({ kind: "bitstring", bits: "1".repeat(SEED_BITS + 1) })),
    ).toContain("1600");
  });

  it("refuses a 1600-char string containing a non-binary character", () => {
    const corrupted = `${"1".repeat(SEED_BITS - 1)}2`;
    expect(corrupted).toHaveLength(SEED_BITS);

    expect(expectError(resolveSeedBitString({ kind: "bitstring", bits: corrupted }))).toBeTruthy();
  });

  it("refuses an empty bitstring", () => {
    expect(expectError(resolveSeedBitString({ kind: "bitstring", bits: "" }))).toBeTruthy();
  });
});
