/**
 * Typed errors thrown by the native transfer path.
 *
 * Family convention (see `src/gateway/errors.ts`): each class extends `Error`,
 * sets an overridden readonly `name`, restores the prototype chain in the
 * constructor, and carries STRUCTURED fields — consumers `instanceof`-catch and
 * inspect fields, never parse messages.
 *
 * SECURITY CONTRACT: no error here ever carries a JWK field value (public or
 * private) in its message or fields. The recipient `target` and gateway
 * endpoints/rewards are public and safe to carry; key material is not.
 */

/** Machine-readable reason a transfer's inputs were rejected. */
export type InvalidTransferReason =
  | "bad-target"
  | "non-positive-quantity"
  | "missing-max-reward";

/**
 * Thrown for a structurally invalid transfer input BEFORE any pool attempt:
 * a `target` failing the canonical 43-char base64url form, a `quantity` that is
 * not a positive `bigint`, or a missing required `maxRewardWinston` fee cap.
 * `reason` discriminates the failure; the offending `target` (public) is carried
 * when relevant. Never carries the jwk.
 */
export class InvalidTransferError extends Error {
  public override readonly name = "InvalidTransferError";

  /** Discriminates the rejection cause without message parsing. */
  public readonly reason: InvalidTransferReason;

  /** The offending recipient address, when the reason is `bad-target`. */
  public readonly target?: string;

  constructor(reason: InvalidTransferReason, target?: string) {
    let detail: string;
    if (reason === "bad-target") {
      detail = `recipient address is not canonical 43-char base64url`;
    } else if (reason === "non-positive-quantity") {
      detail = `quantity must be a positive Winston bigint`;
    } else {
      detail = `maxRewardWinston fee cap is required (a caller must state the maximum reward they will pay)`;
    }
    super(`Invalid transfer: ${detail}`);
    // Maintain the prototype chain across transpilation targets.
    Object.setPrototypeOf(this, new.target.prototype);
    this.reason = reason;
    if (reason === "bad-target") {
      this.target = target;
    }
  }
}

/**
 * Thrown INSIDE the post operation when a gateway returns a status outside
 * 200-299. This throw is what makes the pool rotate/back off; it only ever
 * surfaces to callers WRAPPED inside `GatewayPoolExhaustedError.attempts`.
 * Carries the endpoint and status (both public — never key material).
 */
export class TransferPostFailedError extends Error {
  public override readonly name = "TransferPostFailedError";

  /** The endpoint whose post returned a non-2xx status. */
  public readonly endpoint: string;

  /** The offending HTTP status code. */
  public readonly status: number;

  /** The gateway's status text, when provided. */
  public readonly statusText?: string;

  constructor(endpoint: string, status: number, statusText?: string) {
    super(
      `Transaction post to ${endpoint} failed with status ${status}` +
        (statusText !== undefined ? ` (${statusText})` : ""),
    );
    // Maintain the prototype chain across transpilation targets.
    Object.setPrototypeOf(this, new.target.prototype);
    this.endpoint = endpoint;
    this.status = status;
    this.statusText = statusText;
  }
}

/**
 * Thrown INSIDE the price operation when a gateway's reward quote fails the
 * strict `^\d+$` gate. The reward is embedded in a SIGNED transaction — a
 * strictly more dangerous sink than `BigInt` (whose lenient coercion accepts
 * `""`, `" 123"`, `"1e3"`, `"0x10"`) — so the quote must be a plain decimal
 * digit string. Throwing inside the op rotates to the next gateway, which may
 * quote honestly. Carries the endpoint (public); the rejected quote is NOT
 * carried (it is untrusted gateway input, not needed for diagnosis).
 */
export class InvalidGatewayPriceError extends Error {
  public override readonly name = "InvalidGatewayPriceError";

  /** The endpoint that returned a gate-failing price quote. */
  public readonly endpoint: string;

  constructor(endpoint: string) {
    super(
      `Gateway ${endpoint} returned a reward quote that is not a plain ` +
        `decimal Winston string.`,
    );
    // Maintain the prototype chain across transpilation targets.
    Object.setPrototypeOf(this, new.target.prototype);
    this.endpoint = endpoint;
  }
}

/**
 * Thrown to the CALLER (not inside a pool op) BEFORE building or signing when a
 * valid quoted reward exceeds `maxRewardWinston`. The quote comes from an
 * untrusted rotating gateway and is signed and PAID verbatim, so a
 * compromised/MITM'd gateway could otherwise quote and burn an arbitrary fee.
 * Carries the quoted `reward` and the `cap` (both public Winston amounts).
 */
export class RewardExceedsCapError extends Error {
  public override readonly name = "RewardExceedsCapError";

  /** The reward the gateway quoted, in Winston. */
  public readonly reward: bigint;

  /** The caller-supplied cap that was exceeded, in Winston. */
  public readonly cap: bigint;

  constructor(reward: bigint, cap: bigint) {
    super(
      `Quoted reward ${reward} Winston exceeds the fee cap ${cap} Winston; ` +
        `refusing to build and sign the transaction.`,
    );
    // Maintain the prototype chain across transpilation targets.
    Object.setPrototypeOf(this, new.target.prototype);
    this.reward = reward;
    this.cap = cap;
  }
}
