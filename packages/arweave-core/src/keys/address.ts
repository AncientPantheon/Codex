/**
 * Deterministic Arweave address derivation.
 *
 * An Arweave address IS `Base64URL(SHA-256(n))` where `n` is the DECODED bytes
 * of the public RSA modulus — derivable from the public modulus alone, no
 * private material required. For the canonical 4096-bit key (`n` decodes to 512
 * bytes) the 32-byte digest base64url-encodes to exactly 43 chars.
 *
 * The hash is over the crypto-standard `crypto.subtle.digest("SHA-256", …)`
 * (one code path for Node >=20 and browsers), so `addressOf` is async.
 *
 * SECURITY CONTRACT (never a silent WRONG address — the fund-loss class): a
 * corrupt `n` is rejected via TWO layered guards:
 *   1. the strict decoder (`base64urlDecode`) throws on encoding corruption —
 *      out-of-alphabet chars, `=` padding, or length ≡ 1 (mod 4);
 *   2. `addressOf` itself rejects an `n` whose decoded byte length ≠ 512 (the
 *      canonical 4096-bit invariant). This guard is NECESSARY because 3 of
 *      every 4 truncation points are mod-4-CLEAN: they pass the strict decoder
 *      yet are the wrong modulus, which would mint a well-formed wrong address.
 */

import { base64urlDecode, base64urlEncode } from "./encoding.js";
import { InvalidKeyfileError } from "./errors.js";

/** The canonical 4096-bit modulus decodes to exactly this many bytes. */
const MODULUS_BYTES = 512;

/**
 * Derives the deterministic Arweave address `Base64URL(SHA-256(decode(n)))`
 * from any object carrying the public modulus `n`. Resolves to a 43-char
 * unpadded base64url string for a canonical 4096-bit key.
 *
 * Rejects a corrupt `n`: encoding corruption throws `InvalidBase64UrlError`
 * (via the strict decoder); an alphabet-valid `n` that does not decode to
 * exactly 512 bytes throws `InvalidKeyfileError` (reason `bad-length`) — never
 * returns a silently-wrong address.
 */
export async function addressOf(jwk: { n: string }): Promise<string> {
  const modulusBytes = base64urlDecode(jwk.n);

  if (modulusBytes.length !== MODULUS_BYTES) {
    throw new InvalidKeyfileError("bad-length", ["n"]);
  }

  const digest = await globalThis.crypto.subtle.digest("SHA-256", modulusBytes);
  return base64urlEncode(new Uint8Array(digest));
}
