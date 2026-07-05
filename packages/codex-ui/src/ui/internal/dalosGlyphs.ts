/**
 * DALOS 256-glyph character set — ported 1:1 from OuronetUI's
 * `src/lib/dalos/characterSet.ts`. Sourced byte-for-byte from
 * DALOS_Crypto's CharacterMatrix.go in canonical index order.
 *
 * A StoicTag is a sequence of up to 256 of these glyphs and nothing else
 * (no §, no spaces, no out-of-set characters). Used to restrict the
 * StoicTag registration field in the packaged CodexUI.
 */

export const MAX_STOIC_TAG_GLYPHS = 256;

/** All 256 DALOS glyphs, concatenated in canonical matrix order. */
export const DALOS_GLYPHS =
  "0123456789Ѻ₿$¢€£¥₱₳∇" +
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ" +
  "abcdefghijklmnopqrstuvwxyz" +
  "ÆŒÁĂÂÄÀĄÅÃĆČÇĎĐÉĚÊËÈĘĞÍÎÏÌŁŃÑÓÔÖÒØÕŘŚŠŞȘÞŤȚÚÛÜÙŮÝŸŹŽŻ" +
  "æœáăâäàąåãćčçďđéěêëèęğíîïìłńñóôöòøõřśšşșþťțúûüùůýÿźžżß" +
  "ΓΔΘΛΞΠΣΦΨΩ" +
  "αβγδεζηθικλμνξπρσςτφχψω" +
  "БДЖЗИЙЛПУЦЧШЩЪЫЬЭЮЯ" +
  "бвджзийклмнптуфцчшщъыьэюя";

/** O(1) membership set of the 256 glyphs. */
export const DALOS_GLYPH_SET: ReadonlySet<string> = new Set(Array.from(DALOS_GLYPHS));

/** True when `glyph` (a single code point) is part of the DALOS set. */
export function isDalosGlyph(glyph: string): boolean {
  return DALOS_GLYPH_SET.has(glyph);
}

/**
 * Restrict an arbitrary input to a valid StoicTag body: keeps only DALOS
 * glyphs (drops §, whitespace, out-of-set) and caps the length at `max`.
 */
export function filterToDalosGlyphs(input: string, max: number = MAX_STOIC_TAG_GLYPHS): string {
  const out: string[] = [];
  for (const ch of input) {
    if (DALOS_GLYPH_SET.has(ch)) {
      out.push(ch);
      if (out.length >= max) break;
    }
  }
  return out.join("");
}
