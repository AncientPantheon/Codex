/**
 * Typed errors for the upload module.
 *
 * Follows the family typed-error shape: each class extends `Error`, overrides a
 * readonly `name`, restores the prototype chain in the constructor (survives
 * transpilation to older targets), and carries STRUCTURED fields so consumers
 * never parse message strings.
 *
 * SECURITY CONTRACT: errors from this module NEVER carry JWK private-field values
 * or any key material. Tag names/values and the owner address are PUBLIC data
 * (the address MAY appear); the offending FIELD NAME and a machine-readable
 * reason code are the structured payload.
 *
 * OWNERSHIP: this file is created here with `InvalidUploadParamsError`; the upload
 * orchestration task EXTENDS it with `UploadFailedError`. The existing class and
 * its fields (`field`, `reason`) must be preserved as-is by later additions.
 */

/**
 * Thrown by `buildUploadTags` (and other upload input validators) when a caller
 * argument is malformed BEFORE any SDK/network call — a malformed tag would
 * otherwise surface as an opaque arbundles serialization error, or (worse) ship a
 * valid-but-unfindable upload that the rebuild filter can never see.
 *
 * Carries the offending field NAME and a machine-readable reason code. Never
 * carries key material; tag values / the owner address are public and MAY appear
 * in the surrounding context but are not required here.
 */
export class InvalidUploadParamsError extends Error {
  public override readonly name = "InvalidUploadParamsError";

  /** The offending parameter/field name (e.g. "ownerAddress", "appName", "appMetadata[2].value"). */
  public readonly field: string;

  /** Machine-readable reason code (e.g. "invalid-address", "empty", "reserved-name", "too-many-tags"). */
  public readonly reason: string;

  constructor(field: string, reason: string, message?: string) {
    super(message ?? `Invalid upload parameter "${field}": ${reason}`);
    Object.setPrototypeOf(this, new.target.prototype);
    this.field = field;
    this.reason = reason;
  }
}

/** Machine-readable reason an upload failed AFTER inputs validated. */
export type UploadFailedReason = "upload-rejected" | "bad-response";

/**
 * Thrown by `uploadData` when the upload itself fails: the injected client's
 * `upload` REJECTS (`reason: "upload-rejected"`, the client's error preserved as
 * `cause`), or the client resolves with a response whose `id` is not a canonical
 * 43-char base64url string (`reason: "bad-response"`) — a garbage id persisted by
 * a consumer would be unresolvable on every gateway, so it fails loudly here.
 *
 * SECURITY CONTRACT: this error carries NO JWK material. `operation` is a fixed
 * label and `reason` is a code; the underlying `cause` is preserved verbatim for
 * diagnostics but `uploadData` never places key material into it (the jwk goes
 * only to the local signer, never to an error). The message is value-free.
 */
export class UploadFailedError extends Error {
  public override readonly name = "UploadFailedError";

  /** Fixed operation label so consumers branch without parsing the message. */
  public readonly operation: string;

  /** Machine-readable failure class. */
  public readonly reason: UploadFailedReason;

  constructor(reason: UploadFailedReason, options?: { cause?: unknown }) {
    super(`Upload failed: ${reason}`, options?.cause !== undefined ? { cause: options.cause } : undefined);
    Object.setPrototypeOf(this, new.target.prototype);
    this.operation = "uploadData";
    this.reason = reason;
  }
}
