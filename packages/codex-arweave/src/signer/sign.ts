/**
 * The Arweave sibling signer — a single-file, auditable delegate to arweave-core.
 *
 * FUNDS-CRITICAL, HARD-ISOLATED (E-04, N-05): this is a PARALLEL SIBLING of the
 * StoaChain signing path (`InternalCodexResolver` → `CodexSigningStrategy`), sharing
 * NOTHING with it. It imports ONLY `@ancientpantheon/arweave-core` (the isolated
 * RSA-PSS + deep-hash `signTransaction`) and the `arweave` `Transaction` type. It
 * NEVER references `@stoachain/stoa-core/signing`, a `KeyResolver`, a
 * `CodexSigningStrategy`, a `PactClient`, or any `codex-ouronet` resolver — the
 * static import-scan gate asserts this file stays StoaChain-free.
 *
 * The JWK arrives as an ARGUMENT (from E1's unlock-gated `decryptArweaveKey`) —
 * this module resolves NO key itself and takes NO resolver/strategy. The plaintext
 * JWK is used transiently for the one sign call and is NEVER logged, echoed, or
 * serialized: any thrown error (`InvalidKeyfileError` for a malformed keyfile,
 * `SigningError` for a driver rejection) surfaces VERBATIM from arweave-core, which
 * names the offending field/operation only and carries no private field value.
 */

import { signTransaction, type ArweaveJwk } from "@ancientpantheon/arweave-core";
import type Transaction from "arweave/node/lib/transaction";

/**
 * Sign `tx` in place with `jwk` by delegating to arweave-core's isolated
 * RSA-PSS + deep-hash `signTransaction`. Returns the SAME transaction instance,
 * now carrying its signature and derived id.
 *
 * @throws {InvalidKeyfileError} when `jwk` fails structural validation (arweave-core
 *   rejects it via `importKeyfile` BEFORE signing; the error names the field, never
 *   its value).
 * @throws {SigningError} when the crypto driver rejects an otherwise-valid key
 *   (carries `operation`/`cause`, never key material).
 */
export function signArweaveTransaction(
  tx: Transaction,
  jwk: ArweaveJwk,
): Promise<Transaction> {
  return signTransaction(tx, jwk);
}
