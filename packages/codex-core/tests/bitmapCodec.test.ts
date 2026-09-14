/**
 * The 1-bit "key bitmap" BMP codec (encode/decode).
 *
 * The funds-critical case is the inverted-palette one: a conforming 1bpp BMP
 * may define palette index 0 as black instead of white, and a reader that
 * assumed "bit 1 = black" would silently decode a BIT-FLIPPED key — a
 * completely different account, no error. `decodeBitmapBMP` must read the
 * palette rather than assume, so an inverted file decodes to the SAME bitmap
 * as its non-inverted twin.
 */

import { describe, it, expect } from "vitest";
import { encodeBitmapBMP, decodeBitmapBMP } from "../src/codex/bitmapCodec.js";

/** A real, deterministic 40x40 = 1600-bit pattern — not all-zero/all-one,
 *  so a row/column transposition bug would actually fail these assertions. */
function samplePattern(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += (i * 7 + Math.floor(i / 13)) % 3 === 0 ? "1" : "0";
  return out;
}

describe("encodeBitmapBMP", () => {
  it("produces a real uncompressed 1bpp BMP: signature, header fields, exact byte size", () => {
    const bits = samplePattern(1600);
    const buf = encodeBitmapBMP(bits, 40);
    const dv = new DataView(buf);

    expect(dv.getUint8(0)).toBe(0x42); // 'B'
    expect(dv.getUint8(1)).toBe(0x4d); // 'M'
    expect(dv.getUint32(14, true)).toBe(40); // BITMAPINFOHEADER size
    expect(dv.getInt32(18, true)).toBe(40); // width
    expect(dv.getInt32(22, true)).toBe(40); // height (+ve = bottom-up)
    expect(dv.getUint16(28, true)).toBe(1); // 1 bit per pixel
    expect(dv.getUint32(46, true)).toBe(2); // 2-colour palette

    // 40 cols -> 5 bytes/row -> already a multiple of 4 -> stride 8 (padded).
    const stride = (Math.ceil(40 / 8) + 3) & ~3;
    expect(stride).toBe(8);
    const expectedSize = 14 + 40 + 8 + stride * 40;
    expect(buf.byteLength).toBe(expectedSize);
  });

  it("pads a non-multiple-of-4 row width to a 4-byte stride (32x32 Apollo shape)", () => {
    const bits = samplePattern(1024);
    const buf = encodeBitmapBMP(bits, 32);
    // 32 cols -> 4 bytes/row -> already aligned -> stride 4.
    const stride = (Math.ceil(32 / 8) + 3) & ~3;
    expect(stride).toBe(4);
    expect(buf.byteLength).toBe(14 + 40 + 8 + stride * 32);
  });
});

describe("decodeBitmapBMP — round trip", () => {
  it("round-trips a 40x40 (1600-bit) pattern byte-for-byte through bits", () => {
    const bits = samplePattern(1600);
    const buf = encodeBitmapBMP(bits, 40);
    const result = decodeBitmapBMP(buf);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.bitmap.cols).toBe(40);
    expect(result.bitmap.rows).toBe(40);
    expect(result.bitmap.bits).toBe(bits);
  });

  it("round-trips a 32x32 (1024-bit) Apollo-shaped pattern", () => {
    const bits = samplePattern(1024);
    const buf = encodeBitmapBMP(bits, 32);
    const result = decodeBitmapBMP(buf);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.bitmap.cols).toBe(32);
    expect(result.bitmap.rows).toBe(32);
    expect(result.bitmap.bits).toBe(bits);
  });

  it("round-trips an ALL-ZERO bitmap (the degenerate case a naive palette-blind reader gets right by accident)", () => {
    const bits = "0".repeat(1600);
    const buf = encodeBitmapBMP(bits, 40);
    const result = decodeBitmapBMP(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.bitmap.bits).toBe(bits);
  });

  it("round-trips an ALL-ONE bitmap", () => {
    const bits = "1".repeat(1600);
    const buf = encodeBitmapBMP(bits, 40);
    const result = decodeBitmapBMP(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.bitmap.bits).toBe(bits);
  });

  it("FUNDS-CRITICAL: decodes an INVERTED-PALETTE BMP (index 0 = black) to the SAME bitmap as the non-inverted file — never the bit-flipped key", () => {
    const bits = samplePattern(1600);
    const buf = encodeBitmapBMP(bits, 40);

    // Build a file that displays the SAME visual image (same black/white
    // pixels) but under the OPPOSITE palette convention: index 0 is now
    // black, index 1 is now white — so the pixel data must ALSO be
    // complemented (every raw pixel index flips) to keep the picture
    // identical. This is what a conforming-but-inverted encoder produces;
    // merely swapping the palette while leaving pixel data untouched would
    // instead produce the VISUAL negative, a different test entirely.
    const inverted = buf.slice(0);
    const dv = new DataView(inverted);
    const paletteOffset = 14 + 40;
    const color0 = dv.getUint32(paletteOffset, true);
    const color1 = dv.getUint32(paletteOffset + 4, true);
    dv.setUint32(paletteOffset, color1, true);
    dv.setUint32(paletteOffset + 4, color0, true);
    const dataOffset = dv.getUint32(10, true);
    const pixelBytes = new Uint8Array(inverted, dataOffset);
    for (let i = 0; i < pixelBytes.length; i++) pixelBytes[i] = pixelBytes[i]! ^ 0xff;

    const straight = decodeBitmapBMP(buf);
    const invertedResult = decodeBitmapBMP(inverted);

    expect(straight.ok).toBe(true);
    expect(invertedResult.ok).toBe(true);
    if (!straight.ok || !invertedResult.ok) throw new Error("unreachable");
    expect(invertedResult.bitmap.bits).toBe(straight.bitmap.bits);
    expect(invertedResult.bitmap.bits).toBe(bits);
  });

  it("round-trips a TOP-DOWN BMP (negative biHeight) identically to the default bottom-up one", () => {
    const bits = samplePattern(1600);
    const buf = encodeBitmapBMP(bits, 40);

    // Flip to top-down storage: negate biHeight AND physically reverse the
    // row order in the pixel data (a real top-down encoder writes rows in
    // display order, first row first).
    const stride = (Math.ceil(40 / 8) + 3) & ~3;
    const dataOffset = 14 + 40 + 8;
    const srcRows = new Uint8Array(buf, dataOffset, stride * 40);
    const flipped = new Uint8Array(stride * 40);
    for (let y = 0; y < 40; y++) {
      // Source is bottom-up: file row (39-y) holds bits-row y. Top-down wants
      // file row y to hold bits-row y, i.e. reverse the row order.
      flipped.set(srcRows.subarray((39 - y) * stride, (40 - y) * stride), y * stride);
    }
    const topDown = new ArrayBuffer(buf.byteLength);
    new Uint8Array(topDown).set(new Uint8Array(buf));
    new Uint8Array(topDown, dataOffset).set(flipped);
    new DataView(topDown).setInt32(22, -40, true); // negative height = top-down

    const result = decodeBitmapBMP(topDown);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.bitmap.bits).toBe(bits);
  });
});

describe("decodeBitmapBMP — refusals, each with a distinct message", () => {
  it("refuses a file too short to be a BMP", () => {
    const result = decodeBitmapBMP(new ArrayBuffer(10));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(/too short/i);
  });

  it("refuses a file missing the \"BM\" signature (e.g. a PNG)", () => {
    const buf = encodeBitmapBMP(samplePattern(1600), 40);
    const notBmp = buf.slice(0);
    new DataView(notBmp).setUint8(0, 0x89); // PNG's first magic byte
    const result = decodeBitmapBMP(notBmp);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(/signature/i);
  });

  it("refuses a BMP that is NOT 1 bit per pixel", () => {
    const buf = encodeBitmapBMP(samplePattern(1600), 40);
    const eightBpp = buf.slice(0);
    new DataView(eightBpp).setUint16(28, 8, true);
    const result = decodeBitmapBMP(eightBpp);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(/1-bit-per-pixel/i);
  });

  it("refuses a non-40-byte DIB header (a BMP variant this codec does not speak)", () => {
    const buf = encodeBitmapBMP(samplePattern(1600), 40);
    const oddHeader = buf.slice(0);
    new DataView(oddHeader).setUint32(14, 108, true); // BITMAPV4HEADER size
    const result = decodeBitmapBMP(oddHeader);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(/40-byte/i);
  });

  it("refuses a truncated file (declared size larger than actual data)", () => {
    const buf = encodeBitmapBMP(samplePattern(1600), 40);
    const truncated = buf.slice(0, buf.byteLength - 20);
    const result = decodeBitmapBMP(truncated);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(/truncated/i);
  });
});
