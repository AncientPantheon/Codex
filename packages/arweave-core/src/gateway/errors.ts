/**
 * Typed errors thrown by the gateway pool.
 *
 * Family convention (see the sibling stoa-js ouronet-codex/src/errors/types.ts):
 * each class extends a module-local base, sets an overridden readonly `name`,
 * restores the prototype chain across transpile targets, and carries structured
 * fields — consumers must never parse message strings, they inspect fields and
 * use `instanceof`.
 */

/** Base class for all gateway-pool errors. Lets consumers catch every
 *  pool-thrown error with a single `instanceof GatewayError`. */
export class GatewayError extends Error {
  public override readonly name: string = "GatewayError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    // Maintain the prototype chain across transpilation targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** One recorded failed attempt: which endpoint was tried and the underlying
 *  error object it produced (preserved verbatim, never stringified). */
export interface GatewayAttempt {
  readonly endpoint: string;
  readonly error: unknown;
}

/**
 * Thrown by a pool call when every configured endpoint has been attempted
 * `maxAttemptsPerEndpoint` times without success. Carries the operation label
 * and one `attempts` entry per failed attempt, in order — the single typed
 * terminal error that both posts and reads surface. The pool NEVER throws an
 * opaque underlying error directly.
 */
export class GatewayPoolExhaustedError extends GatewayError {
  public override readonly name = "GatewayPoolExhaustedError";

  /** A short label for the operation that exhausted the pool. */
  public readonly operation: string;

  /** One entry per failed attempt, in attempt order. An endpoint appears once
   *  per attempt (up to `maxAttemptsPerEndpoint` times), each entry preserving
   *  the underlying error object. */
  public readonly attempts: ReadonlyArray<GatewayAttempt>;

  constructor(operation: string, attempts: ReadonlyArray<GatewayAttempt>) {
    super(
      `Gateway pool exhausted for operation "${operation}": ` +
        `all ${attempts.length} attempt(s) across ` +
        `${new Set(attempts.map((a) => a.endpoint)).size} endpoint(s) failed.`,
    );
    this.operation = operation;
    this.attempts = attempts;
  }
}

/**
 * Thrown SYNCHRONOUSLY at pool construction when the config is unusable:
 * an empty `endpoints` array, an endpoint string that fails `new URL(...)`
 * parsing, or a `maxAttemptsPerEndpoint` that is not a positive integer.
 * A pool must never be constructible that could exhaust with an empty
 * `attempts` array — which a non-positive `maxAttemptsPerEndpoint` would cause
 * (the retry loop would never run, so the terminal error would carry zero
 * underlying failures). Validating it here is the same-class complement to the
 * empty-endpoints guard.
 */
export class InvalidGatewayConfigError extends GatewayError {
  public override readonly name = "InvalidGatewayConfigError";

  /** Discriminates the rejection cause without message parsing. */
  public readonly reason:
    | "empty-endpoints"
    | "invalid-endpoint-url"
    | "invalid-max-attempts"
    | "invalid-request-timeout";

  /** The offending endpoint string, when the reason is a bad URL. */
  public readonly endpoint?: string;

  /** The offending `maxAttemptsPerEndpoint` value, when the reason is
   *  `invalid-max-attempts`. */
  public readonly maxAttemptsPerEndpoint?: number;

  /** The offending `requestTimeoutMs` value, when the reason is
   *  `invalid-request-timeout`. */
  public readonly requestTimeoutMs?: number;

  constructor(
    reason: InvalidGatewayConfigError["reason"],
    detail?: string | number,
  ) {
    let message: string;
    if (reason === "empty-endpoints") {
      message =
        "Gateway pool config is invalid: `endpoints` must contain at least one URL.";
    } else if (reason === "invalid-endpoint-url") {
      message = `Gateway pool config is invalid: endpoint is not a parseable URL: ${detail}`;
    } else if (reason === "invalid-max-attempts") {
      message = `Gateway pool config is invalid: \`maxAttemptsPerEndpoint\` must be a positive integer, got ${detail}.`;
    } else {
      message = `Gateway pool config is invalid: \`requestTimeoutMs\` must be a positive integer, got ${detail}.`;
    }
    super(message);
    this.reason = reason;
    if (reason === "invalid-endpoint-url" && detail !== undefined) {
      this.endpoint = detail as string;
    }
    if (reason === "invalid-max-attempts" && detail !== undefined) {
      this.maxAttemptsPerEndpoint = detail as number;
    }
    if (reason === "invalid-request-timeout" && detail !== undefined) {
      this.requestTimeoutMs = detail as number;
    }
  }
}
