/**
 * Rebuild-specific typed errors.
 *
 * The rebuild query REUSES `InvalidAddressError` and `InvalidGatewayResponseError`
 * from `src/reads/errors.ts` (a GraphQL read is a gateway read — no duplicate
 * classes). The two classes here are genuinely rebuild-specific: an out-of-range
 * caller parameter and the no-silent-truncation page cap.
 *
 * Family typed-error shape: each extends `Error`, overrides a readonly `name`,
 * restores the prototype chain in the constructor, and carries STRUCTURED fields
 * so consumers never parse message strings. No key material is ever involved —
 * these carry only public parameter values and counts.
 */

/**
 * Thrown BEFORE any pool attempt when a caller-supplied rebuild parameter is out
 * of range: `pageSize` not an integer in `1..100`, `maxPages` not an integer
 * `>= 1`, or an explicitly provided empty `appName`. Carries the offending option
 * name so consumers never parse the message.
 */
export class InvalidRebuildParamsError extends Error {
  public override readonly name = "InvalidRebuildParamsError";

  /** The offending option name (e.g. "pageSize", "maxPages", "appName"). */
  public readonly field: string;

  /** Machine-readable reason the value was rejected. */
  public readonly reason: string;

  constructor(field: string, reason: string, message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.field = field;
    this.reason = reason;
  }
}

/**
 * Thrown when `hasNextPage` is still true after `maxPages` cumulative page
 * fetches — NO silent truncation. Returning a partial set would let a consumer
 * treat an incomplete list as the complete source of truth. Carries the number
 * of pages fetched and records collected so far in structured fields.
 */
export class RebuildPageLimitError extends Error {
  public override readonly name = "RebuildPageLimitError";

  /** Loop iterations consumed against the maxPages budget before the cap was hit
   *  (== the maxPages cap), including endpoint-rotation restart iterations that
   *  fetched no HTTP page. */
  public readonly pagesFetched: number;

  /** How many records had been collected when the cap was hit. */
  public readonly recordsCollected: number;

  constructor(pagesFetched: number, recordsCollected: number) {
    super(
      `Rebuild query exceeded the page limit of ${pagesFetched}: more pages ` +
        `remain after ${recordsCollected} record(s). Refusing to return a ` +
        `partial source-of-truth set; raise maxPages if this is expected.`,
    );
    Object.setPrototypeOf(this, new.target.prototype);
    this.pagesFetched = pagesFetched;
    this.recordsCollected = recordsCollected;
  }
}
