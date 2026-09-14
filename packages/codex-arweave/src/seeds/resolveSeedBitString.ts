/**
 * The single seed-input gate for Arweave key generation (E5).
 *
 * design.md's one rule: EVERY Arweave seed is a 1600-bit DALOS-ellipse
 * bitstring. The three UI sources converge here before anything reaches the
 * deterministic RSA-4096 search:
 *
 * | source                          | kind          | conversion            |
 * | ------------------------------- | ------------- | --------------------- |
 * | 1a/1b typed words (free / BIP)  | `"words"`     | `seedWordsToBitString`|
 * | 2  an Ouronet account's key     | `"bitstring"` | none — already 1600   |
 * | 3  an existing Chainweb seed    | `"words"`     | `seedWordsToBitString`|
 *
 * Two invariants, both funds-critical:
 *
 *   1. EXACTLY `SEED_BIT_LENGTH` bits out, or refusal. Never pad, never
 *      truncate. `ALLOWED_SEED_BIT_STRING_LENGTHS` in dalos-crypto's `/rsa4096`
 *      also admits 1024 (Apollo), but Apollo input is DEFERRED by design
 *      decision — padding it here would derive a different RSA key than the
 *      later Apollo pass will, so a 1024-bit input is refused outright.
 *   2. Validation failures are RETURNED as human-readable `error` text, never
 *      thrown. The define-seed form renders the string inline; gen1's
 *      `InvalidSeedWordsError` message already names the offending word, so it
 *      is surfaced verbatim.
 */

import { seedWordsToBitString, validateSeedWords } from "@ouronet/dalos-crypto/gen1";

/** The DALOS ellipse bit length — the ONLY accepted Arweave seed width. */
export const SEED_BIT_LENGTH = 1600;

/** A bitstring is binary digits and nothing else. */
const BIT_STRING_RE = /^[01]+$/;

/** Where a seed's 1600 bits come from — one arm per design.md source. */
export type SeedSourceInput =
  | { kind: "words"; words: readonly string[] }
  | { kind: "bitstring"; bits: string };

/** Either the validated 1600-bit seed, or inline-renderable refusal text. */
export type ResolvedSeedBitString = { bits: string } | { error: string };

/** The message of an unknown thrown value, without leaking `[object Object]`. */
function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * The ONE width check, applied to every source on the way out — so no branch
 * can hand the RSA search a bitstring that is not exactly 1600 bits.
 */
function requireSeedWidth(bits: string): ResolvedSeedBitString {
  if (bits.length !== SEED_BIT_LENGTH) {
    return {
      error:
        `An Arweave seed must be exactly ${SEED_BIT_LENGTH} bits, got ${bits.length}. ` +
        `It is refused rather than padded or truncated.`,
    };
  }
  if (!BIT_STRING_RE.test(bits)) {
    return { error: "An Arweave seed must contain only the digits 0 and 1." };
  }
  return { bits };
}

/**
 * Resolve any seed source to its validated 1600-bit bitstring.
 *
 * Words run through gen1's `validateSeedWords` (1-256 words, each 1-256 glyphs,
 * every glyph one of the DALOS 256) BEFORE conversion, so the caller gets the
 * library's word-naming message rather than a downstream surprise.
 */
export function resolveSeedBitString(input: SeedSourceInput): ResolvedSeedBitString {
  if (input.kind === "bitstring") {
    return requireSeedWidth(input.bits);
  }

  const words = [...input.words];
  let bits: string;
  try {
    validateSeedWords(words);
    bits = seedWordsToBitString(words);
  } catch (cause) {
    return { error: messageOf(cause) };
  }
  return requireSeedWidth(bits);
}
