/**
 * Strict Arweave keyfile import/export.
 *
 * The keyfile IS the private key, so import validates LOUDLY: any malformed,
 * incomplete, or corrupt JWK is rejected with a typed `InvalidKeyfileError`
 * rather than silently continuing — a silently-accepted bad JWK can derive a
 * WRONG address and lose funds. Import never returns a partially-valid key.
 *
 * Validation performed here (structural + cheap value-level invariants):
 *   1. input is a non-null object (not array, not primitive);
 *   2. `kty === "RSA"`;
 *   3. each of the 8 base64url fields (`n,e,d,p,q,dp,dq,qi`) is present, a
 *      string, non-empty, and contains only base64url chars `[A-Za-z0-9_-]`
 *      (padding `=` and standard-base64 `+`/`/` are treated as corruption);
 *   4. `n` decodes to exactly 512 bytes — the canonical 4096-bit modulus.
 *      Truncated/partial-paste `n` is the most common real-world keyfile
 *      corruption and is 100% alphabet-valid, so a decoded-LENGTH check is the
 *      only structural guard that catches it. The decoded length is computed
 *      locally via unpadded-base64url length arithmetic (no encoding helper is
 *      imported — `src/keys/encoding.ts` is owned by a later task);
 *   5. `e === "AQAB"` (public exponent 65537 — this library's canonical form).
 *
 * DOCUMENTED RESIDUAL RISK (carry to Phase 3 signing): a corrupted-but-
 * alphabet-valid `n` of the CORRECT decoded length (e.g. a single flipped
 * character) is NOT detectable structurally here — it passes every check above
 * yet is a different modulus, hence a different address. This class of
 * corruption is only caught when Phase 3 imports the key into WebCrypto for
 * signing (which rejects mathematically-inconsistent RSA parameters). No RSA
 * CRT cross-check is performed in this phase.
 */

import type { ArweaveJwk } from "./types.js";
import { InvalidKeyfileError } from "./errors.js";

/** The 8 base64url string fields (everything except `kty`). */
const BASE64URL_FIELDS = ["n", "e", "d", "p", "q", "dp", "dq", "qi"] as const;

/** The canonical 4096-bit modulus decodes to exactly this many bytes. */
const MODULUS_BYTES = 512;

/** Public exponent 65537 in base64url — the only value this library accepts. */
const CANONICAL_EXPONENT = "AQAB";

const BASE64URL_ALPHABET = /^[A-Za-z0-9_-]+$/;

/**
 * Decoded byte length of an unpadded base64url string, or `-1` if the length
 * is structurally impossible (`length % 4 === 1` can never be produced by
 * base64 encoding). Assumes the alphabet has already been validated.
 */
function decodedByteLength(b64url: string): number {
  const len = b64url.length;
  const mod = len % 4;
  if (mod === 1) return -1;
  const fullGroups = Math.floor(len / 4);
  if (mod === 0) return fullGroups * 3;
  if (mod === 2) return fullGroups * 3 + 1;
  return fullGroups * 3 + 2; // mod === 3
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates `raw` as a canonical Arweave keyfile and returns it normalized to
 * exactly the 9 `ArweaveJwk` fields (WebCrypto extras like `alg`/`ext`/`key_ops`
 * stripped). Throws `InvalidKeyfileError` on any malformation — never returns a
 * usable-but-wrong key.
 *
 * KEY-MATERIAL LIFETIME: the returned JWK is a plain, non-zeroizable object
 * whose private fields (`d`/`p`/`q`/`dp`/`dq`/`qi`) are strings that live in
 * memory for the GC lifetime of the object — they cannot be securely wiped.
 * This library retains no reference to any JWK once this call returns; a caller
 * holding a long-lived JWK owns the responsibility for minimizing its lifetime.
 */
export function importKeyfile(raw: unknown): ArweaveJwk {
  if (!isObject(raw)) {
    throw new InvalidKeyfileError("not-an-object", []);
  }

  if (raw.kty !== "RSA") {
    throw new InvalidKeyfileError("wrong-kty", ["kty"]);
  }

  for (const field of BASE64URL_FIELDS) {
    const value = raw[field];
    if (value === undefined || value === null) {
      throw new InvalidKeyfileError("missing", [field]);
    }
    if (typeof value !== "string") {
      throw new InvalidKeyfileError("not-a-string", [field]);
    }
    if (value.length === 0) {
      throw new InvalidKeyfileError("empty", [field]);
    }
    if (!BASE64URL_ALPHABET.test(value)) {
      throw new InvalidKeyfileError("bad-encoding", [field]);
    }
  }

  if (decodedByteLength(raw.n as string) !== MODULUS_BYTES) {
    throw new InvalidKeyfileError("bad-length", ["n"]);
  }

  if (raw.e !== CANONICAL_EXPONENT) {
    throw new InvalidKeyfileError("bad-exponent", ["e"]);
  }

  return {
    kty: "RSA",
    n: raw.n as string,
    e: raw.e as string,
    d: raw.d as string,
    p: raw.p as string,
    q: raw.q as string,
    dp: raw.dp as string,
    dq: raw.dq as string,
    qi: raw.qi as string,
  };
}

/**
 * Serializes a validated `ArweaveJwk` to its canonical 9-field object form.
 * The output is a fresh plain object safe to `JSON.stringify` into a keyfile;
 * `importKeyfile(exportKeyfile(k))` is an identity round-trip.
 *
 * KEY-MATERIAL LIFETIME: the accepted `jwk` and the returned object are plain,
 * non-zeroizable objects whose private fields (`d`/`p`/`q`/`dp`/`dq`/`qi`) live
 * in memory for their GC lifetime and cannot be securely wiped. This library
 * retains no reference to either object after this call returns; a caller
 * holding a long-lived JWK owns the responsibility for minimizing its lifetime.
 */
export function exportKeyfile(jwk: ArweaveJwk): ArweaveJwk {
  return {
    kty: "RSA",
    n: jwk.n,
    e: jwk.e,
    d: jwk.d,
    p: jwk.p,
    q: jwk.q,
    dp: jwk.dp,
    dq: jwk.dq,
    qi: jwk.qi,
  };
}
