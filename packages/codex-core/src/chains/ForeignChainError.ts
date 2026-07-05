/**
 * Typed error for the ForeignChainAdapter registry seam.
 *
 * `ForeignChainError` extends the module-wide `CodexError` base (from the codec
 * side) so a consumer's single `instanceof CodexError` catch-all covers registry
 * failures alongside every other codex-core error. It follows the same family
 * idiom as `CodexUnknownFieldError`: an `override readonly name` and a
 * `Object.setPrototypeOf(this, new.target.prototype)` so `instanceof` survives
 * transpilation to older targets.
 *
 * SECRET CONTRACT: a registry error NAMES the offending chain id (so a lookup
 * miss or a duplicate registration is diagnosable) but NEVER echoes an adapter's
 * key material — `generateKey`/`importKey` produce secrets that must not leak
 * into a thrown message, log, or telemetry.
 */

import { CodexError } from "../codex/errors.js";

/**
 * Thrown by the foreign-chain registry when a lookup misses (`get(unknownId)`)
 * or a registration collides (`register` on an already-registered id). Extends
 * `CodexError` so it is caught by the module-wide `instanceof CodexError` seam.
 * The message names the chain id — never any secret.
 */
export class ForeignChainError extends CodexError {
  public override readonly name = "ForeignChainError";

  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    // Restore the prototype chain after the super() call reset it to
    // CodexError.prototype, so `instanceof ForeignChainError` holds.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
