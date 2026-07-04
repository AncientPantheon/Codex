/**
 * Centralized Winston<->AR unit conversion.
 *
 * 1 AR = 1e12 Winston. Amounts are held internally as bigint Winston (the base
 * unit and the on-the-wire quantity form) and displayed as AR decimal strings.
 * This is the single conversion boundary for the library; storing Winston and
 * converting only at display time keeps precision exact at every magnitude.
 *
 * There is NO floating-point math in this module. `parseFloat`/`Number()` are
 * deliberately absent: they lose precision above Number.MAX_SAFE_INTEGER and
 * render sub-unit values in scientific notation, both of which would produce
 * wrong-amount transfers at the conversion boundary.
 */

/** Winston per AR: 1 AR = 1_000_000_000_000 Winston (12 decimal places). */
export const WINSTON_PER_AR = 1_000_000_000_000n;

/** Number of fractional (Winston) digits in one AR. */
const AR_DECIMALS = 12;

/**
 * Strict shape gate applied to AR input BEFORE any `BigInt(...)` call.
 *
 * `BigInt`'s own parser is dangerously lenient: `BigInt("")` -> `0n`, it trims
 * surrounding whitespace, and it accepts `0x`/`0o`/`0b` radix prefixes. Raw
 * user input must therefore never reach it. This pattern admits only a
 * non-negative decimal with an optional fractional part of 1..12 digits.
 */
const AR_SHAPE = /^\d+(\.\d{1,12})?$/;

/**
 * Thrown when an amount fails validation in either conversion direction.
 *
 * Carries structured fields (`input`, `reason`) so consumers branch on the
 * failure without parsing the message string.
 */
export class InvalidAmountError extends Error {
  public override readonly name = "InvalidAmountError";
  public readonly input: string;
  public readonly reason: string;

  constructor(input: string, reason: string) {
    super(`Invalid amount ${JSON.stringify(input)}: ${reason}`);
    // Maintain the prototype chain across transpilation targets.
    Object.setPrototypeOf(this, new.target.prototype);
    this.input = input;
    this.reason = reason;
  }
}

/**
 * Convert a decimal-string AR amount to its exact Winston bigint.
 *
 * Accepts a non-negative decimal with up to 12 fractional digits. Rejects
 * malformed input (empty, non-numeric, multiple dots, exponent notation,
 * whitespace, sign prefixes, radix prefixes, numeric separators), more than
 * 12 fractional digits (silent precision loss is forbidden), and negatives.
 */
export function arToWinston(ar: string): bigint {
  if (typeof ar !== "string" || !AR_SHAPE.test(ar)) {
    throw new InvalidAmountError(
      String(ar),
      "must be a non-negative decimal string with up to 12 fractional digits"
    );
  }

  const [whole, fraction = ""] = ar.split(".");
  const paddedFraction = fraction.padEnd(AR_DECIMALS, "0");

  return BigInt(whole) * WINSTON_PER_AR + BigInt(paddedFraction);
}

/**
 * Render a Winston bigint as an exact AR decimal string.
 *
 * No scientific notation; the fractional part is trimmed of trailing zeros
 * (`0` when whole). Rejects negative input.
 */
export function winstonToAr(winston: bigint): string {
  if (winston < 0n) {
    throw new InvalidAmountError(String(winston), "must be non-negative");
  }

  const whole = winston / WINSTON_PER_AR;
  const fraction = winston % WINSTON_PER_AR;

  if (fraction === 0n) {
    return whole.toString();
  }

  const fractionStr = fraction
    .toString()
    .padStart(AR_DECIMALS, "0")
    .replace(/0+$/, "");

  return `${whole.toString()}.${fractionStr}`;
}
