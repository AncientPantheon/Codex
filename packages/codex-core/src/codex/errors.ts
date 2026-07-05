/**
 * Typed errors for the canonical codex envelope codec.
 *
 * `CodexError` is the SINGLE base every codec-side error extends, so a consumer
 * gets one `instanceof CodexError` catch-all across the whole module (D3's
 * `CodexAdapterError` will also extend it). It follows the family typed-error
 * idiom used by the arweave-core keys module: an `override readonly name`, and a
 * `Object.setPrototypeOf(this, new.target.prototype)` in the constructor so the
 * prototype chain survives transpilation to older targets (where `instanceof`
 * would otherwise break for subclassed `Error`).
 *
 * SECURITY CONTRACT: no error in this module ever includes a codex field VALUE
 * (an encrypted `secret`, an `encryptedKeyfile` ciphertext, an account address)
 * in its message. Errors name the offending FIELD or PATH — never the value that
 * failed — so a rejected envelope's material never leaks into logs or telemetry.
 */

/**
 * Shared base for every codex codec error. Consumers `instanceof CodexError`
 * to catch the whole family without enumerating each subclass. Extends `Error`
 * and restores the prototype chain so `instanceof` holds after transpilation.
 */
export class CodexError extends Error {
  public override readonly name: string = "CodexError";

  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    // Maintain prototype chain across transpilation targets so `instanceof`
    // works for subclasses even when the compile target predates class fields.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown by `deserializeCodex` when an envelope carries a top-level field the
 * reader does not recognize. Extends `CodexError` (NOT `Error` directly) so it
 * is caught by the module-wide `instanceof CodexError` seam. The message names
 * the unknown field(s) — never any value.
 */
export class CodexUnknownFieldError extends CodexError {
  public override readonly name = "CodexUnknownFieldError";

  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    // Restore the prototype chain after the super() call reset it to
    // CodexError.prototype, so `instanceof CodexUnknownFieldError` holds.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a `CodexAdapter` operation fails or when a value that claims to
 * be an adapter does not conform to the interface. Extends `CodexError` so it
 * is caught by the module-wide `instanceof CodexError` seam alongside
 * `CodexUnknownFieldError`.
 *
 * The structured `adapter` and `operation` fields let a consumer render a
 * precise diagnostic without parsing the message, and tie a failure back to
 * the failing adapter's `CodexAdapter.name`. The message is composed from
 * `adapter`/`operation` (and the cause's message) ONLY — it NEVER echoes a
 * snapshot value or an encrypted keyfile, upholding the module's secret-free
 * error contract.
 */
export class CodexAdapterError extends CodexError {
  public override readonly name = "CodexAdapterError";
  public readonly adapter: string;
  public readonly operation: string;

  constructor(adapter: string, operation: string, cause?: unknown) {
    super(
      `Codex adapter "${adapter}" failed during "${operation}"` +
        (cause === undefined
          ? ""
          : `: ${cause instanceof Error ? cause.message : String(cause)}`),
      cause === undefined ? undefined : { cause }
    );
    // Restore the prototype chain after super() reset it to
    // CodexError.prototype, so `instanceof CodexAdapterError` holds.
    Object.setPrototypeOf(this, new.target.prototype);
    this.adapter = adapter;
    this.operation = operation;
  }
}

/**
 * Thrown by the headless resolver's `getKeyPairByPublicKey` when a pubkey
 * matches neither a pure keypair nor any derived kadena-seed account. Extends
 * `CodexError` so it is caught by the module-wide `instanceof CodexError` seam.
 *
 * The structured `publicKey`/`pureKeypairCount`/`derivedAccountCount` fields let
 * a consumer render a precise self-diagnostic ("X pure keypairs, Y derived
 * accounts") without parsing the message. SECRET-FREE: the message SHORTENS the
 * pubkey to `slice(0,8)…slice(-4)` and NEVER echoes the full pubkey, any private
 * key, mnemonic, or password — so a missing-key failure never leaks material
 * into logs or telemetry.
 */
export class CodexKeyMissingError extends CodexError {
  public override readonly name = "CodexKeyMissingError";
  public readonly publicKey: string;
  public readonly pureKeypairCount: number;
  public readonly derivedAccountCount: number;

  constructor(publicKey: string, pureKeypairCount: number, derivedAccountCount: number) {
    const shortKey = `${publicKey.slice(0, 8)}…${publicKey.slice(-4)}`;
    super(
      `Signing key ${shortKey} not found in this device's codex ` +
        `(${pureKeypairCount} pure keypair${pureKeypairCount === 1 ? "" : "s"}, ` +
        `${derivedAccountCount} derived account${derivedAccountCount === 1 ? "" : "s"}). ` +
        `Pure keypairs are device-local and do not travel inside a codex backup file — ` +
        `re-import the keypair on this device, or restore it from your cloud backup.`,
    );
    // Restore the prototype chain after super() reset it to
    // CodexError.prototype, so `instanceof CodexKeyMissingError` holds.
    Object.setPrototypeOf(this, new.target.prototype);
    this.publicKey = publicKey;
    this.pureKeypairCount = pureKeypairCount;
    this.derivedAccountCount = derivedAccountCount;
  }
}
