/**
 * keys-address.test.ts — coverage for base64url encoding + address derivation (T2.6).
 *
 * An Arweave address IS Base64URL(SHA-256(n)) over the DECODED bytes of the
 * public modulus. A lenient base64url decoder silently maps corrupt input to
 * some byte sequence and mints a well-formed but WRONG address — the fund-loss
 * class. These tests lock two things end-to-end:
 *   - the encoding helpers reject every corruption class instead of coercing;
 *   - addressOf derives the KNOWN-VECTOR address and rejects a corrupt `n` via
 *     both the strict decoder AND the 512-byte length invariant (a mod-4-clean
 *     truncation passes the decoder yet must still throw).
 *
 * KNOWN VECTOR (implementation-independent, computed OUTSIDE addressOf):
 *   Command (run from packages/arweave-core/, node:crypto explicit — bare
 *   `crypto` in Node >=19 is WebCrypto and has no createHash; Buffer is
 *   scratch-only, never in src/):
 *     node -e "const {createHash}=require('node:crypto');console.log(createHash('sha256').update(Buffer.from(TEST_KEYFILE.n,'base64url')).digest('base64url'))"
 *   Result: n decodes to 512 bytes; digest → -W8NFPd7SPC6ufKP5r0GQR9sNEtdKxEDvZLVMh5cOL4
 *   This proves addressOf hashes the DECODED bytes (correctness), not the
 *   UTF-8 of the base64url string.
 */

import { describe, it, expect } from "vitest";
import {
  base64urlEncode,
  base64urlDecode,
  InvalidBase64UrlError,
} from "../src/keys/encoding.js";
import { addressOf } from "../src/keys/address.js";
import { InvalidKeyfileError } from "../src/keys/errors.js";
import { TEST_KEYFILE } from "./fixtures/test-keyfile.js";

/** Pinned address for the committed fixture, computed via `node:crypto` (see file header). */
const KNOWN_VECTOR_ADDRESS = "-W8NFPd7SPC6ufKP5r0GQR9sNEtdKxEDvZLVMh5cOL4";

const BASE64URL_ONLY = /^[A-Za-z0-9_-]+$/;

describe("base64urlEncode", () => {
  it("emits no `=` padding and only base64url alphabet chars", () => {
    // 2 bytes → mod-4==3 output (the padded-in-standard-base64 case): proves
    // padding is stripped rather than emitted as `=`.
    const encoded = base64urlEncode(new Uint8Array([0xff, 0xff]));
    expect(encoded).not.toContain("=");
    expect(encoded).toMatch(BASE64URL_ONLY);
  });

  it("uses `-` and `_` (not `+`/`/`) for the high-bit byte pattern", () => {
    // 0xfb 0xff 0xbf encodes to +/+ in standard base64 → must be -_- here.
    const encoded = base64urlEncode(new Uint8Array([0xfb, 0xff, 0xbf]));
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).toMatch(BASE64URL_ONLY);
  });
});

describe("base64url round-trip", () => {
  it("decode(encode(bytes)) reproduces the original bytes for every byte value", () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    const round = base64urlDecode(base64urlEncode(bytes));
    expect([...round]).toEqual([...bytes]);
  });

  it("round-trips odd lengths (mod-4==2 and mod-4==3 outputs)", () => {
    expect([...base64urlDecode(base64urlEncode(new Uint8Array([1])))]).toEqual([1]);
    expect([...base64urlDecode(base64urlEncode(new Uint8Array([1, 2])))]).toEqual([1, 2]);
  });
});

describe("base64urlDecode — strict rejection (no coercion)", () => {
  it("throws InvalidBase64UrlError on `=` padding", () => {
    expect(() => base64urlDecode("QQ==")).toThrow(InvalidBase64UrlError);
  });

  it("throws on standard-base64 `+` and `/` chars", () => {
    expect(() => base64urlDecode("ab+c")).toThrow(InvalidBase64UrlError);
    expect(() => base64urlDecode("ab/c")).toThrow(InvalidBase64UrlError);
  });

  it("throws on out-of-alphabet chars (space, `!`, unicode)", () => {
    expect(() => base64urlDecode("ab c")).toThrow(InvalidBase64UrlError);
    expect(() => base64urlDecode("ab!c")).toThrow(InvalidBase64UrlError);
    expect(() => base64urlDecode("abéc")).toThrow(InvalidBase64UrlError);
  });

  it("throws on length ≡ 1 (mod 4) — a byte count base64 can never produce", () => {
    expect(() => base64urlDecode("AAAAA")).toThrow(InvalidBase64UrlError);
  });

  it("does NOT silently substitute an invalid char — it never returns bytes for corrupt input", () => {
    let threw = false;
    try {
      base64urlDecode("ab+c");
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(InvalidBase64UrlError);
    }
    expect(threw).toBe(true);
  });
});

describe("addressOf — known-vector correctness", () => {
  it("derives exactly 43 chars for the 4096-bit fixture key", async () => {
    const address = await addressOf(TEST_KEYFILE);
    expect(address).toHaveLength(43);
  });

  it("equals the implementation-independent pinned vector (hashes DECODED n bytes)", async () => {
    // If addressOf hashed the UTF-8 string of n instead of its decoded bytes,
    // this pin (computed via node:crypto over Buffer.from(n,'base64url')) fails.
    const address = await addressOf(TEST_KEYFILE);
    expect(address).toBe(KNOWN_VECTOR_ADDRESS);
  });

  it("is deterministic — two calls on the same key return the identical string", async () => {
    const a = await addressOf(TEST_KEYFILE);
    const b = await addressOf(TEST_KEYFILE);
    expect(a).toBe(b);
  });

  it("contains only base64url chars and no padding", async () => {
    const address = await addressOf(TEST_KEYFILE);
    expect(address).toMatch(BASE64URL_ONLY);
    expect(address).not.toContain("=");
  });

  it("accepts any object carrying only `n` (public modulus alone)", async () => {
    const address = await addressOf({ n: TEST_KEYFILE.n });
    expect(address).toBe(KNOWN_VECTOR_ADDRESS);
  });

  it("a different modulus yields a different address", async () => {
    // Flip the leading char of a valid 512-byte n to a different alphabet char;
    // still 683 chars → still decodes to 512 bytes, but a different modulus.
    const flipped = (TEST_KEYFILE.n[0] === "a" ? "b" : "a") + TEST_KEYFILE.n.slice(1);
    const other = await addressOf({ n: flipped });
    expect(other).not.toBe(KNOWN_VECTOR_ADDRESS);
    expect(other).toHaveLength(43);
  });
});

describe("addressOf — layered corruption rejection (never a silent wrong address)", () => {
  it("rejects an encoding-corrupt n (guard 1: strict decoder) with InvalidBase64UrlError", async () => {
    const corrupt = TEST_KEYFILE.n.slice(0, -1) + "=";
    await expect(addressOf({ n: corrupt })).rejects.toBeInstanceOf(InvalidBase64UrlError);
  });

  it("rejects an alphabet-valid n truncated to a mod-4-clean length (guard 2: 512-byte invariant)", async () => {
    // 683 chars → mod 4 == 3. Drop 3 chars → 680, mod 4 == 0: PASSES the strict
    // decoder (decodes to 510 bytes) yet is the wrong modulus. Only the length
    // invariant catches this — 3 of 4 truncation points are mod-4-clean.
    const truncated = TEST_KEYFILE.n.slice(0, 680);
    expect(truncated.length % 4).toBe(0); // proves it survives the strict decoder
    await expect(addressOf({ n: truncated })).rejects.toBeInstanceOf(InvalidKeyfileError);
  });
});
