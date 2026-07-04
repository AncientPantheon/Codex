/**
 * Typed errors for the reads module (balance + transaction status).
 *
 * Follows the family typed-error shape: each class extends `Error`, overrides a
 * readonly `name`, restores the prototype chain in the constructor (survives
 * transpilation to older targets), and carries STRUCTURED fields so consumers
 * never parse message strings.
 *
 * SECURITY CONTRACT: reads never touch key material. Addresses and transaction
 * ids are PUBLIC identifiers (safe to carry and log); gateway response reasons
 * are machine-readable labels, never response bodies verbatim.
 */

/**
 * Thrown when an address fails the canonical Arweave form `/^[A-Za-z0-9_-]{43}$/`
 * BEFORE any network call — a caller error that must never burn a pool attempt.
 * Carries the offending address (a public identifier).
 */
export class InvalidAddressError extends Error {
  public override readonly name = "InvalidAddressError";

  /** The offending address, verbatim (public — safe to carry). */
  public readonly address: string;

  constructor(address: string) {
    super(
      `Invalid Arweave address: must be 43 base64url characters ([A-Za-z0-9_-]).`,
    );
    Object.setPrototypeOf(this, new.target.prototype);
    this.address = address;
  }
}

/**
 * Thrown when a transaction id fails the canonical Arweave form
 * `/^[A-Za-z0-9_-]{43}$/` BEFORE any network call. Carries the offending id (a
 * public identifier).
 */
export class InvalidTransactionIdError extends Error {
  public override readonly name = "InvalidTransactionIdError";

  /** The offending transaction id, verbatim (public — safe to carry). */
  public readonly transactionId: string;

  constructor(transactionId: string) {
    super(
      `Invalid Arweave transaction id: must be 43 base64url characters ([A-Za-z0-9_-]).`,
    );
    Object.setPrototypeOf(this, new.target.prototype);
    this.transactionId = transactionId;
  }
}

/**
 * Thrown INSIDE a pool operation when a gateway returns a 2xx response whose
 * body fails validation (a balance body failing the strict `^\d+$` amounts gate,
 * or a status body failing the confirmed-shape check). Throwing inside the
 * operation makes the pool ROTATE — a garbage body from one gateway may be fine
 * on the next. Carries the operation label, the endpoint that served the bad
 * body, and a machine-readable reason (never the body verbatim).
 */
export class InvalidGatewayResponseError extends Error {
  public override readonly name = "InvalidGatewayResponseError";

  /** Short label for the operation (e.g. "getBalance", "getTransactionStatus"). */
  public readonly operation: string;

  /** The endpoint that served the invalid response. */
  public readonly endpoint: string;

  /** Machine-readable reason the body was rejected (never the body verbatim). */
  public readonly reason: string;

  constructor(operation: string, endpoint: string, reason: string) {
    super(
      `Invalid gateway response for ${operation} from ${endpoint}: ${reason}`,
    );
    Object.setPrototypeOf(this, new.target.prototype);
    this.operation = operation;
    this.endpoint = endpoint;
    this.reason = reason;
  }
}
