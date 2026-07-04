/**
 * Centralized Winston<->AR unit conversion.
 *
 * Contract under test:
 *   - 1 AR = 1e12 Winston; amounts are held as bigint Winston, displayed as AR.
 *   - `arToWinston` parses a decimal-string AR (<=12 fractional digits) with a
 *     strict shape gate BEFORE any BigInt(...) call, because BigInt's parser is
 *     dangerously lenient (accepts "", trims whitespace, accepts 0x/0o/0b).
 *   - `winstonToAr` renders an exact decimal string with trailing zeros trimmed
 *     and no scientific notation.
 *   - Both directions reject invalid input with a typed InvalidAmountError so
 *     consumers instanceof-catch instead of parsing messages.
 *
 * No floating point anywhere: precision must hold beyond Number.MAX_SAFE_INTEGER.
 */

import { describe, it, expect } from "vitest";
import {
  WINSTON_PER_AR,
  arToWinston,
  winstonToAr,
  InvalidAmountError,
} from "../src/units.js";

describe("WINSTON_PER_AR", () => {
  it("is the exact 1 AR = 1e12 Winston scale factor as a bigint", () => {
    // A wrong scale factor here silently mis-values every transfer in the library.
    expect(WINSTON_PER_AR).toBe(1_000_000_000_000n);
    expect(typeof WINSTON_PER_AR).toBe("bigint");
  });
});

describe("arToWinston", () => {
  it("converts a whole AR amount to its exact Winston bigint", () => {
    // 1 AR must be exactly one trillion Winston, not an approximation.
    expect(arToWinston("1")).toBe(1_000_000_000_000n);
  });

  it("converts zero to 0n", () => {
    expect(arToWinston("0")).toBe(0n);
  });

  it("converts a fractional AR amount without losing precision", () => {
    // 0.5 AR is half a trillion Winston; float math would drift here.
    expect(arToWinston("0.5")).toBe(500_000_000_000n);
  });

  it("converts the smallest unit (1 Winston) from its 12-decimal AR string", () => {
    expect(arToWinston("0.000000000001")).toBe(1n);
  });

  it("pads fractional digits fewer than 12 to full Winston precision", () => {
    // "1.5" -> 1 AR + 0.5 AR fractional; the fractional part must be scaled by 1e11.
    expect(arToWinston("1.5")).toBe(1_500_000_000_000n);
  });

  it("converts an amount whose Winston value exceeds Number.MAX_SAFE_INTEGER exactly", () => {
    // 66846281419287301199 > 2^53; only bigint/string math keeps every digit.
    expect(arToWinston("66846281.419287301199")).toBe(66846281419287301199n);
  });

  it("accepts exactly 12 fractional digits", () => {
    expect(arToWinston("1.123456789012")).toBe(1_123_456_789_012n);
  });

  // The lenient-parse trap matrix: each of these must be rejected BEFORE BigInt sees it.
  const rejected: Array<[string, string]> = [
    ["leading space", " 1"],
    ["trailing space", "1 "],
    ["explicit plus sign", "+1"],
    ["negative amount", "-1"],
    ["hex prefix", "0x10"],
    ["binary prefix", "0b101"],
    ["trailing dot with no fraction", "1."],
    ["leading dot with no integer", ".5"],
    ["numeric separator underscore", "1_000"],
    ["empty string", ""],
    ["exponent notation", "1e3"],
    ["multiple dots", "1.2.3"],
    ["thirteen fractional digits", "0.0000000000001"],
  ];

  it.each(rejected)(
    "rejects %s (%j) with InvalidAmountError",
    (_label, input) => {
      expect(() => arToWinston(input)).toThrow(InvalidAmountError);
    }
  );

  it("carries the rejected input and a reason in structured fields (no message parsing)", () => {
    try {
      arToWinston("0.0000000000001");
      throw new Error("expected arToWinston to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidAmountError);
      const err = e as InvalidAmountError;
      // Consumers read structured fields, never parse the message string.
      expect(err.input).toBe("0.0000000000001");
      expect(typeof err.reason).toBe("string");
      expect(err.reason.length).toBeGreaterThan(0);
    }
  });

  it("never coerces the empty string to 0n the way BigInt would", () => {
    // BigInt("") === 0n is the exact trap this gate exists to close.
    expect(() => arToWinston("")).toThrow(InvalidAmountError);
  });
});

describe("winstonToAr", () => {
  it("renders zero Winston as \"0\"", () => {
    expect(winstonToAr(0n)).toBe("0");
  });

  it("renders a whole-AR Winston value with no fractional part", () => {
    expect(winstonToAr(1_000_000_000_000n)).toBe("1");
  });

  it("trims trailing zeros from the fractional part", () => {
    // 1.5 AR must render as "1.5", not "1.500000000000".
    expect(winstonToAr(1_500_000_000_000n)).toBe("1.5");
  });

  it("renders the smallest unit as a full 12-decimal string, not scientific notation", () => {
    // 1n Winston is 1e-12 AR; Number() would render "1e-12" and lose the contract.
    expect(winstonToAr(1n)).toBe("0.000000000001");
  });

  it("renders a value beyond Number.MAX_SAFE_INTEGER exactly", () => {
    expect(winstonToAr(66846281419287301199n)).toBe("66846281.419287301199");
  });

  it("throws InvalidAmountError on negative Winston", () => {
    expect(() => winstonToAr(-1n)).toThrow(InvalidAmountError);
  });

  it("carries the rejected input in structured fields on negative Winston", () => {
    try {
      winstonToAr(-5n);
      throw new Error("expected winstonToAr to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidAmountError);
      const err = e as InvalidAmountError;
      expect(err.input).toBe("-5");
      expect(typeof err.reason).toBe("string");
    }
  });
});

describe("round-trip stability", () => {
  const representative = [
    "0",
    "1",
    "0.5",
    "1.5",
    "0.000000000001",
    "66846281.419287301199",
    "1.123456789012",
  ];

  it.each(representative)(
    "winstonToAr(arToWinston(%j)) returns the normalized AR string",
    (ar) => {
      // Round-trip must be stable: parsing then rendering yields the trimmed form.
      const winston = arToWinston(ar);
      const back = winstonToAr(winston);
      // Normalize the input the same way winstonToAr does (trim trailing zeros).
      expect(back).toBe(winstonToAr(arToWinston(back)));
      // And the value survives a second full round trip unchanged.
      expect(arToWinston(back)).toBe(winston);
    }
  );

  it("0 <-> 0n both directions", () => {
    expect(arToWinston("0")).toBe(0n);
    expect(winstonToAr(0n)).toBe("0");
  });

  it("1 Winston <-> \"0.000000000001\" both directions", () => {
    expect(arToWinston("0.000000000001")).toBe(1n);
    expect(winstonToAr(1n)).toBe("0.000000000001");
  });

  it("1 AR <-> 1_000_000_000_000n both directions", () => {
    expect(arToWinston("1")).toBe(1_000_000_000_000n);
    expect(winstonToAr(1_000_000_000_000n)).toBe("1");
  });
});
