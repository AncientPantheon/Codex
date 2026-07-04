/**
 * Canonical Arweave keyfile type.
 *
 * An Arweave account IS an RSA JWK — there is no separate address secret; the
 * address is derived deterministically from the public modulus `n`. This is the
 * one canonical in-memory form used across the keys module: exactly the 9 RSA
 * JWK fields with `kty === "RSA"`. WebCrypto-generated keys carry extra members
 * (`alg`, `ext`, `key_ops`) which are stripped on import/canonicalization so a
 * WebCrypto key and an arweave-js-style keyfile normalize to one shape.
 *
 * All field values are unpadded base64url strings (RFC 7518 §6.3). `e` is the
 * public exponent (always `"AQAB"` = 65537 for this library's keys); `n` is the
 * 4096-bit modulus (decodes to 512 bytes). `d,p,q,dp,dq,qi` are private CRT
 * parameters — the key material. Never log or transmit these values.
 */
export interface ArweaveJwk {
  readonly kty: "RSA";
  /** Public modulus (4096-bit, decodes to 512 bytes), base64url. */
  readonly n: string;
  /** Public exponent, base64url — always `"AQAB"` for this library. */
  readonly e: string;
  /** Private exponent, base64url — key material. */
  readonly d: string;
  /** First prime factor, base64url — key material. */
  readonly p: string;
  /** Second prime factor, base64url — key material. */
  readonly q: string;
  /** First CRT exponent, base64url — key material. */
  readonly dp: string;
  /** Second CRT exponent, base64url — key material. */
  readonly dq: string;
  /** CRT coefficient, base64url — key material. */
  readonly qi: string;
}
