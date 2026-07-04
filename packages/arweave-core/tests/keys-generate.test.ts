/**
 * keys-generate.test.ts — coverage for seedless RSA JWK generation (T2.5).
 *
 * `generateKey()` produces a fresh Arweave account with NO seed and NO mnemonic:
 * randomness comes from the runtime CSPRNG inside WebCrypto, never from caller
 * input. These tests lock:
 *   - the generated key is a valid canonical keyfile (accepted by importKeyfile)
 *   - exactly the 9 canonical fields, kty === "RSA", e === "AQAB"
 *   - n decodes to 512 bytes (a genuine 4096-bit modulus, not a 2048 shortcut)
 *   - export/import round-trips the generated key unchanged
 *   - seedlessness: two generations yield DIFFERENT moduli, and the API exposes
 *     no seed/mnemonic parameter to make generation reproducible.
 *
 * SEEDLESSNESS-PROOF DECISION: we run TWO real 4096-bit generations and assert
 * their `n` differ. RSA-4096 keygen is ~1s each with a heavy probabilistic tail,
 * so the whole suite shares those two generations across all assertions (no
 * per-assertion regeneration) and sets a generous 60s suite-level timeout. Two
 * real generations giving distinct moduli is the strongest available proof that
 * output is not a deterministic function of any input — combined with the
 * static fact that `generateKey.length === 0` (no seed parameter can exist).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { generateKey } from "../src/keys/generate.js";
import { importKeyfile, exportKeyfile } from "../src/keys/keyfile.js";
import type { ArweaveJwk } from "../src/keys/types.js";

const CANONICAL_FIELDS = [
  "kty",
  "n",
  "e",
  "d",
  "p",
  "q",
  "dp",
  "dq",
  "qi",
] as const;

/** The canonical 4096-bit modulus decodes to exactly this many bytes. */
const MODULUS_BYTES = 512;

/**
 * Decoded byte length of an unpadded base64url string (alphabet assumed valid).
 * `length % 4 === 1` is structurally impossible for base64; returns -1 there.
 */
function decodedByteLength(b64url: string): number {
  const len = b64url.length;
  const mod = len % 4;
  if (mod === 1) return -1;
  const fullGroups = Math.floor(len / 4);
  if (mod === 0) return fullGroups * 3;
  if (mod === 2) return fullGroups * 3 + 1;
  return fullGroups * 3 + 2;
}

describe("generateKey — seedless 4096-bit RSA JWK generation", () => {
  let keyA: ArweaveJwk;
  let keyB: ArweaveJwk;

  // Two real 4096-bit generations shared across every assertion below.
  beforeAll(async () => {
    keyA = await generateKey();
    keyB = await generateKey();
  }, 60_000);

  it("produces a key accepted by the canonical keyfile validator", () => {
    // importKeyfile throws InvalidKeyfileError on any structural/value defect;
    // a clean return proves the generated key satisfies the canonical contract.
    expect(() => importKeyfile(keyA)).not.toThrow();
    const validated = importKeyfile(keyA);
    expect(validated.kty).toBe("RSA");
  });

  it("has exactly the 9 canonical fields with kty RSA and e AQAB", () => {
    expect(Object.keys(keyA).sort()).toEqual([...CANONICAL_FIELDS].sort());
    expect(keyA.kty).toBe("RSA");
    expect(keyA.e).toBe("AQAB");
  });

  it("strips WebCrypto extras (no alg/ext/key_ops on the returned key)", () => {
    // Canonicalization must drop the WebCrypto-only members so the generated key
    // is byte-shape-identical to an arweave-js keyfile.
    expect(Object.keys(keyA)).not.toContain("alg");
    expect(Object.keys(keyA)).not.toContain("ext");
    expect(Object.keys(keyA)).not.toContain("key_ops");
  });

  it("has an n that decodes to 512 bytes (a real 4096-bit modulus)", () => {
    // A 2048-bit shortcut would decode to 256 bytes; 512 pins genuine 4096-bit.
    expect(decodedByteLength(keyA.n)).toBe(MODULUS_BYTES);
  });

  it("round-trips through exportKeyfile/importKeyfile unchanged", () => {
    const roundTripped = importKeyfile(exportKeyfile(keyA));
    expect(roundTripped).toEqual(keyA);
  });

  it("is seedless: two generations yield different moduli", () => {
    // No caller input drives generation, so two independent runs must produce
    // distinct keys — a deterministic/seeded generator would repeat n here.
    expect(keyB.n).not.toBe(keyA.n);
    // The whole private key differs too, not just the modulus.
    expect(keyB.d).not.toBe(keyA.d);
  });

  it("exposes no seed or mnemonic parameter (seedless by API shape)", () => {
    // generateKey takes zero declared parameters: there is no channel through
    // which a caller could supply a seed and make output reproducible.
    expect(generateKey.length).toBe(0);
  });
});
