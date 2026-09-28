/**
 * readablePreview — the shared display formatter both `ExecutionTooltipCard`
 * and `PreZbomTooltipCard` render through (`zbom/cfm/previewFormatting.ts`).
 *
 * Direct regression lock for the exact bug this module's extraction fixed:
 * the two cards' independently-maintained copies disagreed on a genuine
 * `decimal: 0` cost (one treated it as falsy and stringified the whole
 * `{decimal}` object instead of the number). Neither `execution-tooltip.test.tsx`
 * nor `zbom-prezbom-hint.test.tsx` exercises `decimal: 0` directly (both only
 * use non-zero string decimals like `"1.0"`), so this file is the only place
 * that pins it.
 */
import { describe, it, expect } from "vitest";
import { readablePreview, shorten } from "../src/zbom/cfm/previewFormatting.js";

describe("readablePreview — ignis cost formatting", () => {
  it("formats a genuine decimal:0 cost as \"0\", not the stringified {decimal} object", () => {
    const result = readablePreview({
      "pre-text": ["Free — no IGNIS charge."],
      ignis: { "ignis-need": { decimal: 0 } },
    });
    expect(result.ignis).toBe("0");
    expect(result.ignis).not.toContain("[object Object]");
  });

  it("formats a non-zero string decimal unchanged (e.g. \"1.0\" stays \"1.0\", not truncated)", () => {
    const result = readablePreview({
      "pre-text": ["Costs 1.0 IGNIS."],
      ignis: { "ignis-need": { decimal: "1.0" } },
    });
    expect(result.ignis).toBe("1.0");
  });

  it("returns null ignis when ignis-need is absent, and \"(no data)\" text for null/undefined data", () => {
    expect(readablePreview({ "pre-text": ["ok"] }).ignis).toBeNull();
    expect(readablePreview(null)).toEqual({ text: "(no data)", ignis: null });
    expect(readablePreview(undefined)).toEqual({ text: "(no data)", ignis: null });
  });
});

describe("shorten — middle-elision keeping head AND tail", () => {
  // A 162-glyph Ouronet account string, well over the 2*keep+1 threshold.
  const LONG_GLYPH_ACCOUNT =
    "Σ.ъΦĞρλξäFφVПÉЫЬÙGěЭыц¥ĄïsK·ŀ8£ΞδĚãlÍŃÝÞáΩĘΞȘĎĄЛδůÖîĎĄΠДÈrʪqyςk·δKŢĄρěØänÀŚxǇtÍςÃΩ₳9ŀ7ÇЏŠΛδÓdŀЗΞЛ·πΩ∇ĆдuлiØŢлáYπOкæáYoùχmЌуŠËЛΞЌPĘáлдaBÑБžЏ₳ЛςhrĚëℱdÑLÞЛεñeîÓУŢëΦ";

  it("keeps head and tail, elides the middle with a single ellipsis, for a long unquoted value", () => {
    const result = shorten(LONG_GLYPH_ACCOUNT);
    expect(result.startsWith(LONG_GLYPH_ACCOUNT.slice(0, 14))).toBe(true);
    expect(result.endsWith(LONG_GLYPH_ACCOUNT.slice(-14))).toBe(true);
    expect(result).toContain("…");
    expect(result.length).toBeLessThan(LONG_GLYPH_ACCOUNT.length);
  });

  it("preserves surrounding quotes OUTSIDE the elision for a quoted Pact-literal value", () => {
    const quoted = `"${LONG_GLYPH_ACCOUNT}"`;
    const result = shorten(quoted);
    expect(result.startsWith('"' + LONG_GLYPH_ACCOUNT.slice(0, 14))).toBe(true);
    expect(result.endsWith(LONG_GLYPH_ACCOUNT.slice(-14) + '"')).toBe(true);
    // Never truncate INSIDE the quotes such that a reader can't tell this is
    // a Pact string (vs. a bare decimal) — exactly one opening and one
    // closing quote, at the very ends.
    expect(result.indexOf('"')).toBe(0);
    expect(result.lastIndexOf('"')).toBe(result.length - 1);
  });

  it("leaves a short value (at or under the 2*keep+1 threshold) completely unchanged", () => {
    expect(shorten("OURO-8Nh")).toBe("OURO-8Nh");
    expect(shorten('"short"')).toBe('"short"');
    // Exactly at the boundary (keep*2+1 = 29 chars) — still unchanged.
    const boundary = "a".repeat(29);
    expect(shorten(boundary)).toBe(boundary);
  });

  it("elides a value exactly ONE character past the boundary (30 chars) — proves the threshold actually engages, not just that short values pass through", () => {
    const justOver = "b".repeat(30);
    const result = shorten(justOver);
    expect(result).not.toBe(justOver);
    expect(result).toContain("…");
  });

  it("respects a custom keep length — the exact elided string for keep=4, not merely a prefix/suffix of the default keep=14 result", () => {
    const result = shorten(LONG_GLYPH_ACCOUNT, 4);
    // Exact match: a broken implementation that silently ignored `keep` and
    // always used the default 14 would ALSO happen to satisfy a bare
    // startsWith/endsWith(slice(...,4)) check (a 4-char prefix is a prefix
    // of the 14-char prefix too) — this pins the actual full output instead.
    expect(result).toBe(
      `${LONG_GLYPH_ACCOUNT.slice(0, 4)}…${LONG_GLYPH_ACCOUNT.slice(-4)}`,
    );
    expect(result).not.toBe(shorten(LONG_GLYPH_ACCOUNT, 14));
  });
});
