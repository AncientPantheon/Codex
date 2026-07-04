/**
 * Seedless RSA JWK generation for new Arweave accounts.
 *
 * An Arweave account IS an RSA JWK, and the default account-creation flow is
 * SEEDLESS: a fresh key is generated directly from the runtime CSPRNG, with no
 * mnemonic, no seed phrase, and no caller-supplied randomness. There is no
 * parameter through which generation could be made reproducible — non-
 * determinism is a structural property of this function, not a runtime option.
 * (Optional mnemonic / EthAReum derivation lives behind default-OFF design
 * stubs in a separate module and is NOT part of this seedless path.)
 *
 * DELIBERATE ZERO-DEPENDENCY DECISION: generation goes DIRECTLY through the
 * runtime WebCrypto (`globalThis.crypto.subtle`) rather than pulling in the
 * arweave-js `arweave.wallets.generate()` helper. WebCrypto yields the exact
 * same key shape with no dependency weight and works identically in Node >=20
 * and browser bundlers. The `arweave` package is deferred to a later phase where
 * transaction build/sign/deephash is evaluated as a whole.
 *
 * The signing scheme (`RSA-PSS` + `SHA-256`) matches Arweave's own, so a key
 * generated here can later sign transactions with the same algorithm without
 * regeneration.
 *
 * LATENCY: RSA-4096 key generation is CPU-bound and takes on the order of
 * SECONDS (~1s measured on Node v24, with a heavy probabilistic tail — some
 * runs take noticeably longer). Callers — especially UI layers — MUST treat
 * `generateKey` as a long-running async operation (a strong Web Worker /
 * off-main-thread candidate) and surface progress accordingly; it should never
 * be awaited on a latency-sensitive path.
 */

import type { ArweaveJwk } from "./types.js";

/** RSA public exponent 65537, big-endian — the canonical Arweave exponent. */
const PUBLIC_EXPONENT = new Uint8Array([1, 0, 1]);

/** Canonical Arweave modulus size in bits. */
const MODULUS_LENGTH = 4096;

/**
 * Generates a fresh, seedless 4096-bit RSA Arweave account key.
 *
 * Resolves to a canonical 9-field {@link ArweaveJwk} (`kty === "RSA"`,
 * `e === "AQAB"`, `n` decoding to 512 bytes); the WebCrypto-only members
 * (`alg`, `ext`, `key_ops`) present on the exported JWK are stripped so the
 * result is shape-identical to an arweave-js keyfile.
 *
 * Randomness is drawn from the platform CSPRNG inside WebCrypto — the function
 * takes no arguments, so generation can never be seeded or reproduced.
 *
 * @returns the newly generated account keyfile (private key material included).
 * @remarks Long-running (~seconds) — see the module note on latency.
 */
export async function generateKey(): Promise<ArweaveJwk> {
  const keyPair = await globalThis.crypto.subtle.generateKey(
    {
      name: "RSA-PSS",
      modulusLength: MODULUS_LENGTH,
      publicExponent: PUBLIC_EXPONENT,
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );

  const jwk = await globalThis.crypto.subtle.exportKey("jwk", keyPair.privateKey);

  return {
    kty: "RSA",
    n: jwk.n as string,
    e: jwk.e as string,
    d: jwk.d as string,
    p: jwk.p as string,
    q: jwk.q as string,
    dp: jwk.dp as string,
    dq: jwk.dq as string,
    qi: jwk.qi as string,
  };
}
