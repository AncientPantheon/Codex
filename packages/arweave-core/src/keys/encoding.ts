/**
 * Buffer-free, strict base64url codec (RFC 4648 §5, unpadded).
 *
 * This library is headless and cross-runtime (Node >=20 AND browser bundlers),
 * so it must not touch Node's `Buffer` (Node-only). Encoding/decoding is done
 * with pure JS over the base64url alphabet `[A-Za-z0-9_-]` and emits NO `=`
 * padding.
 *
 * SECURITY CONTRACT (the fund-loss class): `base64urlDecode` is STRICT. A
 * lenient decoder that coerces, substitutes, or default-maps an out-of-alphabet
 * character silently turns corrupt input into some byte sequence — and for
 * address derivation that means a well-formed but WRONG address. So decode
 * throws `InvalidBase64UrlError` on ANY character outside the alphabet, on `=`
 * padding, and on an input length ≡ 1 (mod 4) (a byte count base64 can never
 * produce). It never returns bytes for input it could not decode exactly.
 */

// `InvalidBase64UrlError` now lives in the keys-module error home (`./errors.js`).
// It is imported here (this file throws it) and re-exported so existing import
// paths (`from "./encoding.js"`) keep working.
import { InvalidBase64UrlError } from "./errors.js";
export { InvalidBase64UrlError };
export type { InvalidBase64UrlReason } from "./errors.js";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** char code → 6-bit value, or -1 if the char is outside the base64url alphabet. */
const DECODE_TABLE: readonly number[] = (() => {
  const table = new Array<number>(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) {
    table[ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

/**
 * Encodes bytes to unpadded base64url. Output contains only `[A-Za-z0-9_-]`
 * and never a `=` padding character.
 */
export function base64urlEncode(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  const len = bytes.length;

  // Full 3-byte groups → 4 chars.
  for (; i + 2 < len; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out +=
      ALPHABET[(n >>> 18) & 63] +
      ALPHABET[(n >>> 12) & 63] +
      ALPHABET[(n >>> 6) & 63] +
      ALPHABET[n & 63];
  }

  const remaining = len - i;
  if (remaining === 1) {
    const n = bytes[i]! << 16;
    out += ALPHABET[(n >>> 18) & 63] + ALPHABET[(n >>> 12) & 63];
  } else if (remaining === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += ALPHABET[(n >>> 18) & 63] + ALPHABET[(n >>> 12) & 63] + ALPHABET[(n >>> 6) & 63];
  }

  return out;
}

/**
 * Decodes unpadded base64url to bytes. Throws `InvalidBase64UrlError` on any
 * character outside `[A-Za-z0-9_-]` (including `=` padding and `+`/`/`) and on
 * an input length ≡ 1 (mod 4). Never coerces or substitutes invalid input.
 */
export function base64urlDecode(input: string): Uint8Array {
  const len = input.length;
  const mod = len % 4;
  if (mod === 1) {
    throw new InvalidBase64UrlError("bad-length");
  }

  const fullGroups = Math.floor(len / 4);
  const outLen = fullGroups * 3 + (mod === 2 ? 1 : mod === 3 ? 2 : 0);
  const out = new Uint8Array(outLen);

  let o = 0;
  let i = 0;

  for (let g = 0; g < fullGroups; g++, i += 4) {
    const c0 = sextet(input, i);
    const c1 = sextet(input, i + 1);
    const c2 = sextet(input, i + 2);
    const c3 = sextet(input, i + 3);
    const n = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    out[o++] = (n >>> 16) & 0xff;
    out[o++] = (n >>> 8) & 0xff;
    out[o++] = n & 0xff;
  }

  if (mod === 2) {
    const c0 = sextet(input, i);
    const c1 = sextet(input, i + 1);
    out[o] = ((c0 << 2) | (c1 >>> 4)) & 0xff;
  } else if (mod === 3) {
    const c0 = sextet(input, i);
    const c1 = sextet(input, i + 1);
    const c2 = sextet(input, i + 2);
    out[o++] = ((c0 << 2) | (c1 >>> 4)) & 0xff;
    out[o] = ((c1 << 4) | (c2 >>> 2)) & 0xff;
  }

  return out;
}

/** Resolves one base64url char to its 6-bit value, throwing on any bad char (padding, `+`/`/`, unicode). */
function sextet(input: string, index: number): number {
  const code = input.charCodeAt(index);
  const value = code < 128 ? DECODE_TABLE[code]! : -1;
  if (value === -1) {
    throw new InvalidBase64UrlError(input[index] === "=" ? "padding" : "bad-char");
  }
  return value;
}
