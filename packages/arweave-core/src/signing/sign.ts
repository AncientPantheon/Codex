/**
 * Isolated Arweave signer subsystem.
 *
 * Arweave signing is a SELF-CONTAINED sibling subsystem: RSA-PSS over a deep-hash
 * of the transaction, computed by arweave-js over the `ArweaveJwk` keyfile. It
 * shares nothing with any foreign-chain, aggregator, or wallet path — this file
 * imports ONLY from arweave-core's own keys module (`../keys/*.js`) and the
 * `arweave` package root. That isolation is auditable by design (single-file
 * module, no cross-module reach) and is enforced structurally by tests + the
 * phase-wide isolation sweep.
 *
 * The consensus-critical pieces (deep-hash, RSA-PSS signature, id derivation) are
 * NEVER hand-rolled — they are delegated to arweave-js's `transactions.sign`, the
 * exact code path the network verifies against. This module adds only two things
 * around that call: (1) a strict pre-validation gate via the keys module's
 * `importKeyfile`, so a malformed keyfile surfaces the typed `InvalidKeyfileError`
 * before arweave-js's opaque `"No valid JWK..."` string can fire; (2) a typed
 * `SigningError` wrapper around any crypto-driver failure.
 *
 * DOCUMENTED RESIDUAL RISK (carried from the Phase 2 keyfile validator): a
 * corrupted-but-alphabet-valid `n` of the correct decoded length passes the
 * structural import gate yet is a mathematically different modulus. That class of
 * corruption is only caught here, at the moment WebCrypto imports the key to sign,
 * where it surfaces as a `SigningError` wrapping the driver's rejection.
 *
 * The signing Arweave instance is module-internal and NEVER performs network I/O:
 * `transactions.sign` is fully local (deep-hash → RSA-PSS → id = b64url(SHA-256)),
 * so no gateway config matters and no fetch is ever issued.
 */

import Arweave from "arweave";
import type Transaction from "arweave/node/lib/transaction";

import type { ArweaveJwk } from "../keys/types.js";
import { importKeyfile } from "../keys/keyfile.js";

/**
 * Module-internal Arweave instance used ONLY for its local signing routine.
 *
 * NOT A NETWORK CONNECTION POINT. `transactions.sign` is a fully local RSA-PSS
 * deep-hash (verified: build+sign issue zero fetches — see the `signing.test.ts`
 * offline guarantee and the vestigial-host probe), so no gateway is ever
 * contacted through this instance. The host is therefore an INERT placeholder,
 * deliberately NOT `arweave.net`, so no reachable gateway default is baked in
 * (N-03): a caller that (incorrectly) tried to read/post through this instance
 * would hit the unroutable placeholder, not the public gateway. Never reuse this
 * instance for reads or posts — those go through the injected pool endpoint.
 */
const SIGNING_INERT_HOST = "signing.invalid";
const signer = Arweave.init({
  host: SIGNING_INERT_HOST,
  protocol: "https",
  port: 443,
});

/**
 * Thrown when the consensus-critical arweave-js sign path fails for a keyfile
 * that PASSED structural import validation — e.g. a corrupt-but-valid modulus
 * rejected by the WebCrypto RSA-PSS driver.
 *
 * Follows the family typed-error shape. Carries a machine-readable `operation`
 * label and the underlying `cause`, and NEVER any JWK field value — key material
 * must never leak into a thrown error, a log, or a serialized error chain. The
 * caller-supplied `cause` is preserved verbatim for diagnosis (its own contents
 * are the driver's responsibility), but this class's own message and structured
 * fields are value-free.
 */
export class SigningError extends Error {
  public override readonly name = "SigningError";
  /** Machine-readable label of the signing step that failed. */
  public readonly operation: string;
  /** The underlying driver failure. Never contains JWK material from this module. */
  public override readonly cause: unknown;

  constructor(operation: string, cause: unknown) {
    super(`Transaction signing failed during ${operation}`);
    // Maintain prototype chain across transpilation targets.
    Object.setPrototypeOf(this, new.target.prototype);
    this.operation = operation;
    this.cause = cause;
  }
}

/**
 * Signs `tx` in place with `jwk` using arweave-js's RSA-PSS + deep-hash routine,
 * returning the same (now-signed) transaction for ergonomic composition.
 *
 * Order of operations:
 *   1. `importKeyfile(jwk)` — strict structural validation. A malformed keyfile
 *      throws `InvalidKeyfileError` here, BEFORE arweave-js sees the key.
 *   2. `transactions.sign(tx, validated)` — the consensus-critical local path:
 *      deep-hash signature data → RSA-PSS sign → id = Base64URL(SHA-256(sig)).
 *      Any failure (e.g. a corrupt-but-valid modulus rejected by the driver) is
 *      wrapped in a typed `SigningError` carrying no key material.
 *
 * No network I/O occurs: `transactions.sign` is fully local.
 *
 * @throws {InvalidKeyfileError} when `jwk` fails structural validation.
 * @throws {SigningError} when the crypto driver rejects an otherwise-valid key.
 */
export async function signTransaction(
  tx: Transaction,
  jwk: ArweaveJwk,
): Promise<Transaction> {
  const validated = importKeyfile(jwk);

  try {
    await signer.transactions.sign(tx, validated);
  } catch (cause) {
    throw new SigningError("rsa-pss-deephash-sign", cause);
  }

  return tx;
}
