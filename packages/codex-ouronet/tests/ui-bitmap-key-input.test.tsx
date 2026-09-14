/**
 * BitmapKeyInput — Import Bitmap tests.
 *
 * Import lets a user load a previously-downloaded (or externally-crafted) BMP
 * back into the paintable grid — the read half of the download/import pair
 * DalosSecretReveal's "Download BMP" button opened. FUNDS-CRITICAL: like the
 * codec itself, import must not silently bit-flip a key when the source BMP
 * uses the "inverted" 1bpp palette convention.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

import { BitmapKeyInput } from "../src/ui/internal/BitmapKeyInput";
import { encodeBitmapBMP } from "@ancientpantheon/codex-core";

afterEach(cleanup);

/** A small, deterministic, non-degenerate pattern — a transposition or
 *  off-by-one bug would fail bit-for-bit assertions against this. */
function samplePattern(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += (i * 7 + Math.floor(i / 13)) % 3 === 0 ? "1" : "0";
  return out;
}

function bitsToBitmap(bits: string, rows: number, cols: number): number[][] {
  const out: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: number[] = [];
    for (let c = 0; c < cols; c++) row.push(bits[r * cols + c] === "1" ? 1 : 0);
    out.push(row);
  }
  return out;
}

function bmpFile(bits: string, cols: number, name = "key.bmp"): File {
  const buf = encodeBitmapBMP(bits, cols);
  return new File([buf], name, { type: "image/bmp" });
}

/** Builds the FUNDS-CRITICAL inverted-palette twin of a straight encode —
 *  same construction as codex-core's bitmapCodec.test.ts: swap the two
 *  palette dwords AND complement every pixel byte, so the file displays the
 *  SAME image under the OPPOSITE palette convention. */
function invertedPaletteBuffer(bits: string, cols: number): ArrayBuffer {
  const buf = encodeBitmapBMP(bits, cols);
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
  return inverted;
}

async function importFile(file: File): Promise<void> {
  const input = screen.getByTestId("bitmap-import-input") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

describe("<BitmapKeyInput> — Import Bitmap", () => {
  it("imports a valid BMP matching the configured dimensions and replaces the grid", async () => {
    const onChange = vi.fn();
    render(<BitmapKeyInput rows={32} cols={32} onChange={onChange} />);
    const bits = samplePattern(1024);

    await importFile(bmpFile(bits, 32));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const last = onChange.mock.calls[onChange.mock.calls.length - 1]![0] as unknown as number[][];
    expect(last).toEqual(bitsToBitmap(bits, 32, 32));
  });

  it("refuses a BMP whose dimensions don't match the configured curve, naming both sizes, and does not call onChange", async () => {
    const onChange = vi.fn();
    render(<BitmapKeyInput rows={40} cols={40} onChange={onChange} />);
    const bits = samplePattern(1024);

    await importFile(bmpFile(bits, 32));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/32\s*×\s*32/);
    expect(alert.textContent).toMatch(/40\s*×\s*40/);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("refuses a non-BMP file, surfacing decodeBitmapBMP's own error message, and does not call onChange", async () => {
    const onChange = vi.fn();
    render(<BitmapKeyInput rows={32} cols={32} onChange={onChange} />);
    const junk = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])], "not-a-bitmap.png");

    await importFile(junk);

    expect(await screen.findByText(/not a valid bmp/i)).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disables the import control when the component is disabled", () => {
    render(<BitmapKeyInput disabled />);
    const btn = screen.getByRole("button", { name: /import/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("FUNDS-CRITICAL: imports an inverted-palette BMP to the SAME (non-bit-flipped) bitmap as its straight twin", async () => {
    const onChange = vi.fn();
    render(<BitmapKeyInput rows={40} cols={40} onChange={onChange} />);
    const bits = samplePattern(1600);
    const inverted = invertedPaletteBuffer(bits, 40);
    const file = new File([inverted], "inverted.bmp", { type: "image/bmp" });

    await importFile(file);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const last = onChange.mock.calls[onChange.mock.calls.length - 1]![0] as unknown as number[][];
    expect(last).toEqual(bitsToBitmap(bits, 40, 40));
  });
});
