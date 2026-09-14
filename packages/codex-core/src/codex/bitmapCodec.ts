/**
 * The 1-bit "key bitmap" — a real, uncompressed 1bpp Windows BMP whose pixels
 * are the DALOS/APOLLO private-key bitstring, one pixel per bit, row-major.
 * Pure codec: no React, no DALOS/APOLLO coupling, no knowledge of which curve
 * or dimensions are "correct" for a given account — the caller (the reveal
 * modal's download button, the spawn modal's import button) supplies/checks
 * those against its own context.
 *
 * The writer is ported VERBATIM (structure and byte layout) from StoicDigest's
 * `keyBitmapBMP` (`websites/StoicDigest/src/pages/lab/seed.astro`): 14-byte
 * BITMAPFILEHEADER + 40-byte BITMAPINFOHEADER + an 8-byte 2-colour palette
 * (index 0 white, index 1 black), rows padded to a 4-byte stride, stored
 * bottom-up, bits packed MSB-first within each byte.
 *
 * FUNDS SAFETY (the reason a reader is harder than a writer): a 1bpp BMP's
 * TWO-COLOUR PALETTE IS NOT FIXED BY THE FORMAT. A conforming file may define
 * palette index 0 as black and index 1 as white — the mirror image of what
 * this writer produces. A reader that assumed "bit 1 always means black"
 * would silently import a BIT-INVERTED key: a different account, no error,
 * no warning. `decodeBitmapBMP` therefore reads the palette and determines
 * which index is "ink" (the darker of the two colours) rather than assuming.
 */

/** One decoded bitmap: bits in the SAME row-major, top-to-bottom convention
 *  `encodeBitmapBMP` accepts — `bits[row * cols + col]`. */
export interface DecodedBitmap {
  /** `'0'`/`'1'` characters only, length `cols * rows`. */
  bits: string;
  cols: number;
  rows: number;
}

export type DecodeBitmapResult = { ok: true; bitmap: DecodedBitmap } | { ok: false; error: string };

/**
 * Encode a row-major bitstring as an uncompressed 1bpp Windows BMP. `bits`
 * must contain only `'0'`/`'1'` characters; `cols` is the row width in bits
 * (pixels). `rows` is derived as `ceil(bits.length / cols)` — the caller is
 * responsible for `bits.length` being an exact multiple of `cols` (every
 * DALOS/APOLLO caller's bit count already is: 1600 = 40×40, 1024 = 32×32).
 */
export function encodeBitmapBMP(bits: string, cols: number): ArrayBuffer {
  const rows = Math.ceil(bits.length / cols);
  const rowBytes = Math.ceil(cols / 8);
  const stride = (rowBytes + 3) & ~3; // rows padded to a 4-byte boundary
  const pixData = stride * rows;
  const offset = 14 + 40 + 8; // BITMAPFILEHEADER + BITMAPINFOHEADER + 2-colour palette
  const size = offset + pixData;
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);

  // BITMAPFILEHEADER
  dv.setUint8(0, 0x42); // 'B'
  dv.setUint8(1, 0x4d); // 'M'
  dv.setUint32(2, size, true);
  dv.setUint32(10, offset, true);

  // BITMAPINFOHEADER
  dv.setUint32(14, 40, true); // header size
  dv.setInt32(18, cols, true); // biWidth
  dv.setInt32(22, rows, true); // biHeight (+ve = bottom-up)
  dv.setUint16(26, 1, true); // biPlanes
  dv.setUint16(28, 1, true); // biBitCount = 1
  dv.setUint32(34, pixData, true); // biSizeImage
  dv.setUint32(46, 2, true); // biClrUsed
  dv.setUint32(50, 2, true); // biClrImportant

  // 2-colour palette: index 0 white (background), index 1 black (ink/set bit)
  dv.setUint32(54, 0x00ffffff, true);
  dv.setUint32(58, 0x00000000, true);

  const u8 = new Uint8Array(buf);
  for (let y = 0; y < rows; y++) {
    // Bottom-up storage: bits-row y (0 = top) lands at file row (rows-1-y).
    const base = offset + (rows - 1 - y) * stride;
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (i < bits.length && bits[i] === "1") {
        u8[base + (x >> 3)] |= 0x80 >> (x & 7); // MSB-first within the byte
      }
    }
  }
  return buf;
}

/** BGR (+ 1 reserved byte) palette entry, read as an {r,g,b} triple. */
function paletteColorAt(view: DataView, paletteOffset: number, index: number): { r: number; g: number; b: number } {
  const base = paletteOffset + index * 4;
  const b = view.getUint8(base);
  const g = view.getUint8(base + 1);
  const r = view.getUint8(base + 2);
  return { r, g, b };
}

/** Sum of channels — smaller means darker. Used only to compare the two
 *  palette entries against EACH OTHER, never against an absolute threshold. */
function luma({ r, g, b }: { r: number; g: number; b: number }): number {
  return r + g + b;
}

/**
 * Decode an uncompressed 1bpp Windows BMP back into its bitstring.
 *
 * Refuses (distinct messages):
 *   - a file too short to hold a BMP header, or missing the "BM" signature;
 *   - a DIB header that isn't the 40-byte BITMAPINFOHEADER this codec speaks;
 *   - `biBitCount !== 1` (any format other than a 1-bit bitmap);
 *   - a non-2-colour palette.
 *
 * Handles:
 *   - EITHER row order (`biHeight` positive = bottom-up, negative = top-down);
 *   - the palette being either polarity (index 0 or index 1 may be the darker
 *     "ink" colour) — the darker of the two palette entries is always treated
 *     as bit `'1'`, so an inverted-palette file decodes to the SAME bitmap as
 *     its non-inverted equivalent, never the bit-flipped key.
 *
 * Does NOT check `cols`/`rows` against any expected curve dimensions — that
 * is the caller's job (it knows which curve/mode is selected; this codec does
 * not), so its error message can name the actual mismatch precisely.
 */
export function decodeBitmapBMP(buffer: ArrayBuffer): DecodeBitmapResult {
  if (buffer.byteLength < 62) {
    return { ok: false, error: "Not a valid BMP file: too short to hold a bitmap header." };
  }
  const dv = new DataView(buffer);

  if (dv.getUint8(0) !== 0x42 || dv.getUint8(1) !== 0x4d) {
    return { ok: false, error: "Not a valid BMP file: missing the \"BM\" signature." };
  }

  const dataOffset = dv.getUint32(10, true);
  const dibHeaderSize = dv.getUint32(14, true);
  if (dibHeaderSize !== 40) {
    return {
      ok: false,
      error: `Unsupported BMP variant: expected a 40-byte BITMAPINFOHEADER, got a ${dibHeaderSize}-byte DIB header.`,
    };
  }

  const width = dv.getInt32(18, true);
  const heightRaw = dv.getInt32(22, true);
  const bitCount = dv.getUint16(28, true);
  const colorsUsed = dv.getUint32(46, true);

  if (bitCount !== 1) {
    return { ok: false, error: `Not a 1-bit-per-pixel BMP: this file is ${bitCount} bits per pixel.` };
  }
  if (width <= 0) {
    return { ok: false, error: `Invalid BMP width: ${width}.` };
  }
  // biClrUsed of 0 conventionally means "the full palette for this bit
  // depth" (i.e. 2, for 1bpp) — only an EXPLICIT non-2 count is a refusal.
  if (colorsUsed !== 0 && colorsUsed !== 2) {
    return { ok: false, error: `Not a 2-colour palette: this file declares ${colorsUsed} colours.` };
  }

  const topDown = heightRaw < 0;
  const rows = Math.abs(heightRaw);
  if (rows <= 0) {
    return { ok: false, error: `Invalid BMP height: ${heightRaw}.` };
  }

  const paletteOffset = 14 + dibHeaderSize;
  const color0 = paletteColorAt(dv, paletteOffset, 0);
  const color1 = paletteColorAt(dv, paletteOffset, 1);
  // The darker of the two palette entries is "ink" — bit '1' — WHICHEVER
  // index it lives at. This is what makes an inverted-palette file decode to
  // the same bitmap as its non-inverted equivalent.
  const inkIndex = luma(color0) <= luma(color1) ? 0 : 1;

  const rowBytes = Math.ceil(width / 8);
  const stride = (rowBytes + 3) & ~3;
  const requiredBytes = dataOffset + stride * rows;
  if (buffer.byteLength < requiredBytes) {
    return { ok: false, error: "Truncated BMP file: pixel data is shorter than the header declares." };
  }

  const u8 = new Uint8Array(buffer);
  let bits = "";
  for (let y = 0; y < rows; y++) {
    // Bottom-up: bits-row y (0 = top) is stored at file row (rows-1-y).
    // Top-down: file row order already matches bits-row order directly.
    const fileRow = topDown ? y : rows - 1 - y;
    const base = dataOffset + fileRow * stride;
    for (let x = 0; x < width; x++) {
      const byte = u8[base + (x >> 3)]!;
      const pixelIndex = (byte >> (7 - (x & 7))) & 1;
      bits += pixelIndex === inkIndex ? "1" : "0";
    }
  }

  return { ok: true, bitmap: { bits, cols: width, rows } };
}
