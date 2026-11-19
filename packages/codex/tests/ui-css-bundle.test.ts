/**
 * Build-artifact guard for the aggregate `dist/ui.css` emitted by
 * `scripts/bundle-css.mjs`.
 *
 * WHY THIS READS `dist/` AND NOT THE SOURCES: each member sheet
 * (codex-ui, codex-ouronet) is individually valid — its Google-Fonts
 * `@import` IS its first statement, and both carry a comment saying so. The
 * defect lives only in the CONCATENATION: the second member's `@import`
 * lands after ~95 lines of the first member's rules. Per CSS spec an
 * `@import` that follows any rule is invalid and dropped; Turbopack and
 * Lightning CSS warn or hard-error on it. A source-level assertion cannot
 * see that, so this suite asserts on the shipped bytes.
 *
 * The regression it catches: a consumer's production CSS build breaking (or
 * silently losing the three web fonts) on a sheet we published, which is
 * what forced a downstream Next 16 / Turbopack consumer to hand-cut a patch
 * file against this artifact for every release.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const distUiCss = resolve(__dirname, "../dist/ui.css");

/** The exact statement both member sheets open with, byte for byte. */
const FONT_IMPORT =
  '@import url("https://fonts.googleapis.com/css2?family=Cinzel:wght@400;500;600;700' +
  '&family=Inter:wght@300;400;600;700&family=JetBrains+Mono:wght@400;500&display=swap");';

/**
 * Blanks out `/* ... *\/` comment bodies while preserving every byte offset,
 * so an `@import` MENTIONED in prose (both member sheets document the rule in
 * a comment) is never mistaken for a statement. Deliberately independent of
 * the implementation's own helper: a shared masker that got the masking wrong
 * would make the test agree with the bug.
 */
function maskComments(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    if (css.startsWith("/*", i)) {
      const end = css.indexOf("*/", i + 2);
      const stop = end === -1 ? css.length : end + 2;
      out += " ".repeat(stop - i);
      i = stop;
    } else {
      out += css[i];
      i += 1;
    }
  }
  return out;
}

describe("aggregate dist/ui.css — @import placement", () => {
  it("is emitted by the build (run `npm run build` first)", () => {
    expect(existsSync(distUiCss)).toBe(true);
  });

  it("contains at most one @import statement", () => {
    const masked = maskComments(readFileSync(distUiCss, "utf8"));
    const imports = masked.match(/@import\b/g) ?? [];
    expect(imports.length).toBeLessThanOrEqual(1);
  });

  it("places its @import as the very first statement, ahead of every rule", () => {
    const masked = maskComments(readFileSync(distUiCss, "utf8"));
    const at = masked.indexOf("@import");
    expect(at).toBeGreaterThanOrEqual(0);
    // Nothing but comments/whitespace may precede it, or the browser drops it.
    expect(masked.slice(0, at).trim()).toBe("");
  });

  it("carries the font @import INTACT — the URL\'s own `;` must not end the statement", () => {
    // The Google-Fonts URL contains six semicolons (`wght@400;500;600;700`).
    // A naive `@import[^;]*;` scan truncates the statement at the first one,
    // hoisting a broken half and leaving the tail as orphan garbage in the
    // body — a bug that still satisfies a loose `toContain("Cinzel")` check.
    const css = readFileSync(distUiCss, "utf8");
    expect(css).toContain(FONT_IMPORT);
    // ...and the full statement must be the hoisted one, not a leftover.
    const masked = maskComments(css);
    expect(css.indexOf(FONT_IMPORT)).toBe(masked.indexOf("@import"));
  });

  it("leaves no orphan fragment of a split @import anywhere in the sheet", () => {
    const css = readFileSync(distUiCss, "utf8");
    // Every occurrence of the font URL must be part of a whole statement.
    const occurrences = css.split("fonts.googleapis.com").length - 1;
    expect(occurrences).toBe(1);
  });

  it("keeps both member sheets' payloads (the de-duplication must not drop content)", () => {
    const css = readFileSync(distUiCss, "utf8");
    expect(css).toContain("codex-ui/dist/ui.css");
    expect(css).toContain("codex-ouronet/dist/ui.css");
    expect(css).toContain("--codex-accent");
  });
});
