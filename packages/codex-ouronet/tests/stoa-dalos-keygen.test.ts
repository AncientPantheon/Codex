/**
 * `deriveStoaDalosKeypairAtIndex` shape-normalization — regression for
 * debug bug 2a (docs/work/debug/two-real-codex-bugs.md).
 *
 * A "stoic" seed's `secret` SHOULD always decrypt to the pre-converted
 * 1600-bit DALOS bitstring, but real legacy data exists where it decrypts
 * straight to the space-separated seed words instead (confirmed live
 * against a real codex: "bid day just attack address climb actual puppy
 * suggest expre…", real English-shaped DALOS words, not a bitstring).
 * Before this fix, feeding that straight to `generateFromBitStringAtIndex`
 * either threw or mis-derived — the function assumed its input was always
 * already a bitstring.
 */
import { describe, it, expect } from "vitest";
import { seedWordsToBitString } from "@ouronet/dalos-crypto/gen1";
import { deriveStoaDalosKeypairAtIndex } from "../src/wallet/stoaDalosKeygen.js";

const WORDS = ["bid", "day", "just", "attack", "address", "climb", "actual", "puppy"];

describe("deriveStoaDalosKeypairAtIndex", () => {
  it("derives unchanged from an already-converted bitstring (today's normal case, no regression)", () => {
    const bitString = seedWordsToBitString(WORDS);
    const direct = deriveStoaDalosKeypairAtIndex(bitString, 0);
    // Same bitstring in, twice, must be deterministic.
    expect(deriveStoaDalosKeypairAtIndex(bitString, 0)).toEqual(direct);
    expect(direct.publicKey).toHaveLength(64);
    expect(direct.privateKey).toHaveLength(64);
  });

  it("derives the SAME key from raw legacy words as from their pre-converted bitstring (bug 2a fix)", () => {
    const bitString = seedWordsToBitString(WORDS);
    const viaBitString = deriveStoaDalosKeypairAtIndex(bitString, 0);

    // The legacy shape: `secret` decrypted straight to the words, joined by
    // spaces exactly as `CreateStoaChainSeedModal.tsx`'s own split convention
    // (`plaintext.trim().split(/\s+/)`) expects on the way back.
    const viaWords = deriveStoaDalosKeypairAtIndex(WORDS.join(" "), 0);

    expect(viaWords).toEqual(viaBitString);
  });

  it("tolerates stray whitespace around raw legacy words", () => {
    const bitString = seedWordsToBitString(WORDS);
    const viaBitString = deriveStoaDalosKeypairAtIndex(bitString, 0);
    const viaWords = deriveStoaDalosKeypairAtIndex(`  ${WORDS.join("   ")}  `, 3);
    const viaBitStringIndex3 = deriveStoaDalosKeypairAtIndex(bitString, 3);

    expect(viaWords).toEqual(viaBitStringIndex3);
    expect(viaBitString.publicKey).not.toBe(viaBitStringIndex3.publicKey); // sanity: different index differs
  });

  it("throws the library's own word-naming error for genuinely malformed input, not a cryptic crash", () => {
    // Neither a valid bitstring (contains non-0/1 chars) nor a valid DALOS
    // word — "-" is not one of the 256 DALOS glyphs, so `validateSeedWords`
    // names the exact offending character rather than letting
    // `generateFromBitStringAtIndex` fail on it opaquely downstream.
    expect(() => deriveStoaDalosKeypairAtIndex("bad-word", 0)).toThrow(
      /not one of the 256 glyphs/,
    );
  });

  it("throws on an empty secret (neither a bitstring nor any words)", () => {
    expect(() => deriveStoaDalosKeypairAtIndex("   ", 0)).toThrow(
      /expected between 1 and 256 words/,
    );
  });
});
