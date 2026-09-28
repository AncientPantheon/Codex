/**
 * ActionTooltip — `unstyled` variant.
 *
 * Default behavior (every existing caller — StoaAccountsTab's merged action
 * buttons, codex-arweave's Send AR Max/Super Max) must stay UNCHANGED:
 * `Tooltip.Content` keeps its built-in `max-w-[220px]` dark-card box, designed
 * for short single-line explanatory text.
 *
 * `PreZbomHint`'s card is a much larger data-preview card (up to 480px,
 * `minWidth: 320px`) with its OWN complete styling (`previewCardStyle`). Using
 * the default variant nests that card INSIDE `ActionTooltip`'s own 220px-capped
 * box, so the (wider) inner card visibly overflows the (narrower) outer one —
 * a real, live-reported bug ("the tooltip is placed in some sort of
 * background where it bulged out of"). `unstyled` skips the built-in
 * box/background/arrow entirely, letting the caller's own `content` supply
 * its complete visual box, with no default styling to overflow.
 *
 * Radix's `Tooltip.Content` only mounts when open, and jsdom cannot reliably
 * drive Radix's hover-intent-to-open animation (confirmed by hand elsewhere
 * in this suite — see `zbom-prezbom-hint-real-hover.test.tsx`'s own note),
 * so this is a source-text check (mirrors this suite's own established
 * pattern for exactly this class of Radix-testing limitation) rather than a
 * rendered-DOM assertion.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(
  resolve(__dirname, "../src/zbom/ui/ActionTooltip.tsx"),
  "utf8",
);

describe("ActionTooltip — unstyled variant", () => {
  it("declares an unstyled prop, defaulting to false (every existing caller keeps today's box unchanged)", () => {
    expect(SOURCE).toMatch(/unstyled\??:\s*boolean/);
    expect(SOURCE).toMatch(/unstyled\s*=\s*false/);
  });

  it("only applies the built-in max-w-[220px] dark-card className/background when NOT unstyled", () => {
    expect(SOURCE).toMatch(/unstyled\s*\?\s*undefined\s*:\s*"max-w-\[220px\]/);
  });

  it("skips the built-in Arrow (colored for the default #1a1a1a background) when unstyled — a differently-colored caller card shouldn't get a mismatched arrow", () => {
    expect(SOURCE).toMatch(/!unstyled\s*&&\s*<Tooltip\.Arrow/);
  });
});
