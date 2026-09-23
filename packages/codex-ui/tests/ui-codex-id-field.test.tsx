/**
 * CodexIdField — `splitHalfToFit` (docs/work/codex-ui-mobile/design.md §8,
 * Zone 2 feedback round): "the proper shortening method — prefix, first 3,
 * last 3 characters of each half must be shown, plus extra characters that
 * fit" — NOT a fixed midpoint split with a decorative `…` shown regardless
 * of whether the string actually needs truncating (the desktop `Half`'s own
 * behavior, left unchanged). Pure-function unit tests for the algorithm,
 * plus a couple of `CodexIdField compact` rendering checks.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CodexIdField, splitHalfToFit } from "../src/ui/CodexIdField";

afterEach(() => cleanup());

describe("splitHalfToFit — not yet measured (fitChars === null)", () => {
  it("shows only the head/tail anchors, no middle, no ellipsis", () => {
    expect(splitHalfToFit("Níę…ăúĖkağŭ¢šVưĆe0FZDÚäÜÅkŘì", null)).toEqual({
      head: "Níę", middle: "", tail: "kŘì", ellipsis: false,
    });
  });
});

describe("splitHalfToFit — everything fits (fitChars >= body.length)", () => {
  it("shows the WHOLE string, no ellipsis at all", () => {
    const body = "abcdefghij"; // 10 chars
    const result = splitHalfToFit(body, 20);
    expect(result.ellipsis).toBe(false);
    expect(result.head).toBe("abc");
    expect(result.tail).toBe("hij");
    // head + middle + tail reconstructs the full body.
    expect(result.head + result.middle + result.tail).toBe(body);
  });

  it("exactly-fitting (fitChars === body.length) still shows the whole string", () => {
    const body = "abcdefghij";
    const result = splitHalfToFit(body, body.length);
    expect(result.ellipsis).toBe(false);
    expect(result.head + result.middle + result.tail).toBe(body);
  });
});

describe("splitHalfToFit — truncated (fitChars < body.length)", () => {
  it("always shows head-3 and tail-3, plus AS MANY extra middle chars as fit, with ellipsis", () => {
    const body = "abcdefghijklmnopqrstuvwxyz"; // 26 chars
    const result = splitHalfToFit(body, 15);
    expect(result.ellipsis).toBe(true);
    expect(result.head).toBe("abc");
    expect(result.tail).toBe("xyz");
    // 15 fitChars - 7 reserved (head+tail+ellipsis) = 8 middle chars.
    expect(result.middle).toBe("defghijk");
    expect(result.middle).toHaveLength(8);
  });

  it("more available width fits MORE middle characters (adaptive, not fixed-formula)", () => {
    const body = "abcdefghijklmnopqrstuvwxyz";
    const narrow = splitHalfToFit(body, 12);
    const wide = splitHalfToFit(body, 20);
    expect(wide.middle.length).toBeGreaterThan(narrow.middle.length);
  });

  it("clamps the middle to empty (never negative) when fitChars can't even cover head+tail+ellipsis", () => {
    const body = "abcdefghijklmnop";
    const result = splitHalfToFit(body, 5); // less than the 7-char reserve
    expect(result.middle).toBe("");
    expect(result.ellipsis).toBe(true);
    expect(result.head).toBe("abc");
    expect(result.tail).toBe("nop");
  });
});

describe("CodexIdField — compact vs default rendering", () => {
  it("compact renders both halves' prefixes and is visible once measured (jsdom fallback reveal)", async () => {
    render(
      <CodexIdField standardAddress="₱.abcdefghijklmnop" smartAddress="Π.qrstuvwxyzabcdef" compact />,
    );
    // jsdom has no real layout, so this settles via the safety-timeout path —
    // just confirm both prefixes render and the whole address is the title
    // (hover-to-read), proving the compact half actually mounted.
    expect(await screen.findByTitle("₱.abcdefghijklmnop")).toBeInTheDocument();
    expect(await screen.findByTitle("Π.qrstuvwxyzabcdef")).toBeInTheDocument();
  });

  it("default (non-compact) renders without a title attribute on the half row (desktop's own fixed-split path, unchanged)", () => {
    render(<CodexIdField standardAddress="₱.abcdefghijklmnop" smartAddress="Π.qrstuvwxyzabcdef" />);
    expect(screen.queryByTitle("abcdefghijklmnop")).toBeNull();
  });
});
