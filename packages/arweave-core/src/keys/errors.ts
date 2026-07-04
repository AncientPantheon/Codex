/**
 * Typed errors for the keys module — the SINGLE home of every keys-module error
 * class (`InvalidKeyfileError`, `InvalidBase64UrlError`, and the two derivation
 * errors). Sibling files (`encoding.ts`, `derivation.ts`) import their classes
 * from here and re-export them so existing import paths keep working.
 *
 * Follows the family typed-error shape: each class extends `Error`, overrides a
 * readonly `name`, restores the prototype chain in the constructor (survives
 * transpilation to older targets), and carries STRUCTURED fields so consumers
 * never parse message strings.
 *
 * SECURITY CONTRACT: no error in this module ever includes a JWK field VALUE
 * (public or private) in its message or its structured fields. A rejected
 * keyfile's material must never leak into logs or transmitted errors. Errors
 * name the offending FIELD (`n`, `d`, ...) and a machine-readable reason code —
 * never the value that failed. The derivation errors likewise carry only which
 * PATH was requested — never the caller's mnemonic phrase or signature bytes.
 */

/** Machine-readable reason a keyfile was rejected. */
export type InvalidKeyfileReason =
  | "not-an-object"
  | "wrong-kty"
  | "missing"
  | "not-a-string"
  | "empty"
  | "bad-encoding"
  | "bad-length"
  | "bad-exponent";

/**
 * Thrown by `importKeyfile` when a keyfile is malformed or incomplete.
 *
 * `reason` discriminates the failure class; `fields` names the offending JWK
 * field name(s) (never their values). Consumers `instanceof`-catch and branch
 * on `reason`/`fields` — the human message is intentionally value-free.
 */
export class InvalidKeyfileError extends Error {
  public override readonly name = "InvalidKeyfileError";
  public readonly reason: InvalidKeyfileReason;
  /** Offending JWK field names (never values). */
  public readonly fields: readonly string[];

  constructor(reason: InvalidKeyfileReason, fields: readonly string[]) {
    const detail = fields.length > 0 ? ` (field(s): ${fields.join(", ")})` : "";
    super(`Invalid keyfile: ${reason}${detail}`);
    // Maintain prototype chain across transpilation targets.
    Object.setPrototypeOf(this, new.target.prototype);
    this.reason = reason;
    this.fields = Object.freeze([...fields]);
  }
}

/** Machine-readable reason a base64url string was rejected. */
export type InvalidBase64UrlReason = "bad-char" | "padding" | "bad-length";

/**
 * Thrown by `base64urlDecode` when input is not valid unpadded base64url.
 *
 * `reason` discriminates the failure; consumers `instanceof`-catch and branch
 * on it. The message is intentionally value-free — decode input can be key
 * material (the modulus `n`), which must never leak into logs or errors.
 */
export class InvalidBase64UrlError extends Error {
  public override readonly name = "InvalidBase64UrlError";
  public readonly reason: InvalidBase64UrlReason;

  constructor(reason: InvalidBase64UrlReason) {
    super(`Invalid base64url: ${reason}`);
    // Maintain prototype chain across transpilation targets.
    Object.setPrototypeOf(this, new.target.prototype);
    this.reason = reason;
  }
}

/** Which optional derivation path an error refers to. */
export type KeyDerivationPath = "mnemonic" | "ethareum";

/**
 * Thrown when a derivation path is requested while its flag is OFF (the
 * default). Structured `path` field lets consumers branch without parsing the
 * message. Carries NO caller input (mnemonic phrase, signature bytes) — secrets
 * never appear in errors.
 */
export class KeyDerivationDisabledError extends Error {
  public override readonly name = "KeyDerivationDisabledError";
  /** Which optional path was requested while disabled. */
  public readonly path: KeyDerivationPath;

  constructor(path: KeyDerivationPath) {
    super(
      `${path} key derivation is disabled by default; enable it via the derivation flags to opt in`,
    );
    // Maintain prototype chain across transpilation targets.
    Object.setPrototypeOf(this, new.target.prototype);
    this.path = path;
  }
}

/**
 * Thrown when a caller FORCES a derivation flag on: the flag gate passes, but
 * no implementation exists in this spec. Structured `path` field; carries NO
 * caller input — secrets never appear in errors.
 */
export class KeyDerivationNotImplementedError extends Error {
  public override readonly name = "KeyDerivationNotImplementedError";
  /** Which optional path was requested but is not implemented. */
  public readonly path: KeyDerivationPath;

  constructor(path: KeyDerivationPath) {
    super(
      `${path} key derivation is not implemented in this release; see derivation.ts design warnings before enabling`,
    );
    // Maintain prototype chain across transpilation targets.
    Object.setPrototypeOf(this, new.target.prototype);
    this.path = path;
  }
}
