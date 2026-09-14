/**
 * BitmapKeyInput — package (inline-styled, Redux-free) port of OuronetUI's
 * clickable bitmap-grid key-generation input. Black pixel = 1, white = 0;
 * row-major top-to-bottom, left-to-right. The same bitmap always derives the
 * same address. Default shape is DALOS Genesis 40×40 = 1600 bits; pass
 * rows/cols = 32 for the APOLLO 32×32 = 1024-bit path.
 *
 * Drag-to-paint, Clear / Invert / Randomise. No Tailwind / no shadcn — pure
 * inline styles, matching the rest of the packaged CodexUI surface.
 */

import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Eraser, ArrowRightLeft, Shuffle, Upload } from "lucide-react";
import {
  BITMAP_ROWS as CORE_BITMAP_ROWS,
  BITMAP_COLS as CORE_BITMAP_COLS,
  type Bitmap,
} from "@stoachain/stoa-core/dalos";
import { decodeBitmapBMP } from "@ancientpantheon/codex-core";

const emptyBitmap = (rows: number, cols: number): Bitmap => {
  const out: number[][] = [];
  for (let r = 0; r < rows; r++) out.push(new Array(cols).fill(0));
  return out as unknown as Bitmap;
};

const cloneBitmap = (b: Bitmap, rows: number, cols: number): Bitmap => {
  const out: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const src = b[r] as unknown as (number | boolean)[] | undefined;
    const row: number[] = new Array(cols).fill(0);
    if (src) {
      const n = Math.min(cols, src.length);
      for (let c = 0; c < n; c++) row[c] = src[c] ? 1 : 0;
    }
    out.push(row);
  }
  return out as unknown as Bitmap;
};

const countBlackPixels = (b: Bitmap, rows: number, cols: number): number => {
  let n = 0;
  const actualRows = Math.min(rows, b.length);
  for (let r = 0; r < actualRows; r++) {
    const row = b[r] as unknown as (number | boolean)[] | undefined;
    if (!row) continue;
    const actualCols = Math.min(cols, row.length);
    for (let c = 0; c < actualCols; c++) if (row[c]) n++;
  }
  return n;
};

export interface BitmapKeyInputProps {
  onChange?: (bitmap: Bitmap) => void;
  cellSize?: number;
  disabled?: boolean;
  rows?: number;
  cols?: number;
  dimensionsLabel?: string;
  /**
   * A bitmap to start FROM, instead of a blank grid — for a caller that
   * already has bits from elsewhere (e.g. converting a typed BitString/
   * scalar into this same input's grid when a user switches which
   * representation they are editing). Read ONLY at mount time (this
   * component stays deliberately UNCONTROLLED, matching its existing
   * onChange-only contract — there is no live two-way binding). A caller
   * that wants to inject a NEW preset into an ALREADY-mounted instance must
   * remount it (e.g. by keying on whatever triggered the new preset, or by
   * only ever rendering this component behind a condition that itself
   * causes a fresh mount, as `ArweaveSeedsArea`'s Direct generator already
   * does by conditionally rendering it per selected input kind).
   */
  initialBitmap?: Bitmap;
}

export function BitmapKeyInput({
  onChange,
  cellSize = 9,
  disabled = false,
  rows = CORE_BITMAP_ROWS,
  cols = CORE_BITMAP_COLS,
  dimensionsLabel,
  initialBitmap,
}: BitmapKeyInputProps): React.JSX.Element {
  const totalBits = rows * cols;
  const label = dimensionsLabel ?? `${rows} × ${cols} bitmap`;

  const [bitmap, setBitmap] = useState<Bitmap>(() =>
    initialBitmap ? cloneBitmap(initialBitmap, rows, cols) : emptyBitmap(rows, cols),
  );

  // Rebuild internal state when dimensions change (curve toggle in spawn modal).
  useEffect(() => {
    setBitmap((prev: Bitmap) => {
      if (prev.length === rows && (prev[0]?.length ?? 0) === cols) return prev;
      return emptyBitmap(rows, cols);
    });
  }, [rows, cols]);

  const [isDragging, setIsDragging] = useState<false | 0 | 1>(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const interactive = !disabled;

  const emit = useCallback(
    (next: Bitmap) => {
      setBitmap(next);
      onChange?.(next);
    },
    [onChange],
  );

  const togglePixel = useCallback(
    (row: number, col: number, forcedValue?: 0 | 1) => {
      if (disabled) return;
      const next = cloneBitmap(bitmap, rows, cols) as unknown as number[][];
      const current = next[row]![col]!;
      const value = forcedValue !== undefined ? forcedValue : ((1 - current) as 0 | 1);
      next[row]![col] = value;
      emit(next as unknown as Bitmap);
    },
    [bitmap, disabled, emit, rows, cols],
  );

  const handleMouseDown = (row: number, col: number) => {
    if (!interactive) return;
    const current = (bitmap[row]![col]! as unknown as number) & 1;
    const target: 0 | 1 = current === 1 ? 0 : 1;
    setIsDragging(target);
    togglePixel(row, col, target);
  };

  const handleMouseEnter = (row: number, col: number) => {
    if (isDragging === false || !interactive) return;
    const current = (bitmap[row]![col]! as unknown as number) & 1;
    if (current !== isDragging) togglePixel(row, col, isDragging);
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleClear = () => { if (!disabled) emit(emptyBitmap(rows, cols)); };

  const handleInvert = () => {
    if (disabled) return;
    const next: number[][] = [];
    for (let r = 0; r < rows; r++) {
      const src = bitmap[r] as unknown as (number | boolean)[] | undefined;
      const row: number[] = [];
      for (let c = 0; c < cols; c++) row.push(src?.[c] ? 0 : 1);
      next.push(row);
    }
    emit(next as unknown as Bitmap);
  };

  const handleRandomise = () => {
    if (disabled) return;
    const byteCount = Math.ceil(totalBits / 8);
    const buf = new Uint8Array(byteCount);
    globalThis.crypto.getRandomValues(buf);
    const next: number[][] = [];
    let bitIdx = 0;
    for (let r = 0; r < rows; r++) {
      const row: number[] = [];
      for (let c = 0; c < cols; c++) {
        const byte = buf[bitIdx >> 3]!;
        row.push((byte >> (bitIdx & 7)) & 1);
        bitIdx++;
      }
      next.push(row);
    }
    emit(next as unknown as Bitmap);
  };

  const handleImportClick = () => {
    if (!disabled) fileInputRef.current?.click();
  };

  const handleImportFile = useCallback(
    async (file: File) => {
      setImportError(null);
      let buffer: ArrayBuffer;
      try {
        buffer = await file.arrayBuffer();
      } catch {
        setImportError("Could not read the selected file.");
        return;
      }
      const result = decodeBitmapBMP(buffer);
      if (!result.ok) {
        setImportError(result.error);
        return;
      }
      const { bitmap: decoded } = result;
      if (decoded.cols !== cols || decoded.rows !== rows) {
        setImportError(
          `This bitmap is ${decoded.cols}×${decoded.rows}, but ${label} is required for the selected curve.`,
        );
        return;
      }
      const next: number[][] = [];
      for (let r = 0; r < rows; r++) {
        const row: number[] = [];
        for (let c = 0; c < cols; c++) row.push(decoded.bits[r * cols + c] === "1" ? 1 : 0);
        next.push(row);
      }
      emit(next as unknown as Bitmap);
    },
    [cols, rows, label, emit],
  );

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-importing the same filename later
    if (file) void handleImportFile(file);
  };

  const blackCount = useMemo(() => countBlackPixels(bitmap, rows, cols), [bitmap, rows, cols]);
  const fillPct = ((blackCount / totalBits) * 100).toFixed(1);
  const gridSize = rows * cellSize;

  const ctrlBtn: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
    padding: "8px 10px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
    border: "1px solid #262626", background: "#111", color: "#d2d3d4",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        style={{
          position: "relative", userSelect: "none", borderRadius: 8, border: "1px solid #262626",
          backgroundColor: "#0a0a0a", overflow: "hidden", width: gridSize, height: gridSize,
          margin: "0 auto", imageRendering: "pixelated",
        }}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <svg width={gridSize} height={gridSize} viewBox={`0 0 ${cols} ${rows}`} style={{ display: "block" }} shapeRendering="crispEdges">
          {bitmap.map((row: unknown, r: number) =>
            (row as unknown as (number | boolean)[]).map((cell, c) => (
              <rect
                key={`${r}-${c}`}
                x={c} y={r} width={1} height={1}
                fill={cell ? "#d2d3d4" : "#0f0f10"}
                stroke="#18181B" strokeWidth={0.05}
                onMouseDown={() => handleMouseDown(r, c)}
                onMouseEnter={() => handleMouseEnter(r, c)}
                style={{ cursor: interactive ? "pointer" : "not-allowed" }}
              />
            )),
          )}
        </svg>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderRadius: 8, border: "1px solid #262626", backgroundColor: "#18181B", padding: "7px 12px", fontSize: 11 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ color: "#888" }}>
            <strong style={{ color: "#ceac5f" }}>{blackCount}</strong>
            <span style={{ color: "#555" }}> / {totalBits} bits</span>
          </span>
          <span style={{ color: "#333" }}>·</span>
          <span style={{ color: "#888" }}>{fillPct}% fill</span>
        </div>
        <span style={{ color: "#555" }}>{label}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
        <button type="button" onClick={handleClear} disabled={disabled || blackCount === 0} style={{ ...ctrlBtn, opacity: disabled || blackCount === 0 ? 0.4 : 1 }}>
          <Eraser style={{ width: 14, height: 14 }} /> Clear
        </button>
        <button type="button" onClick={handleInvert} disabled={disabled} style={{ ...ctrlBtn, opacity: disabled ? 0.4 : 1 }}>
          <ArrowRightLeft style={{ width: 14, height: 14 }} /> Invert
        </button>
        <button type="button" onClick={handleRandomise} disabled={disabled} style={{ ...ctrlBtn, opacity: disabled ? 0.4 : 1 }}>
          <Shuffle style={{ width: 14, height: 14 }} /> Randomise
        </button>
        <button type="button" onClick={handleImportClick} disabled={disabled} style={{ ...ctrlBtn, opacity: disabled ? 0.4 : 1 }}>
          <Upload style={{ width: 14, height: 14 }} /> Import
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/bmp,.bmp"
        data-testid="bitmap-import-input"
        onChange={handleFileInputChange}
        disabled={disabled}
        style={{ display: "none" }}
      />

      {importError && (
        <p role="alert" style={{ margin: 0, padding: "8px 12px", borderRadius: 8, fontSize: 11, lineHeight: 1.5, backgroundColor: "#8b1a1a15", border: "1px solid #8b1a1a40", color: "#f87171" }}>
          {importError}
        </p>
      )}

      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, borderRadius: 8, border: "1px solid #262626", backgroundColor: "#18181B", padding: "8px 12px" }}>
        <RefreshCw style={{ width: 14, height: 14, flexShrink: 0, marginTop: 2, color: "#ceac5f" }} />
        <p style={{ margin: 0, fontSize: 11, lineHeight: 1.5, color: "#888" }}>
          Click or drag to paint pixels. Each cell contributes one bit to the {totalBits}-bit
          private scalar — the same bitmap always derives the same address. Keep this image
          private; a screenshot is effectively your private key.
        </p>
      </div>
    </div>
  );
}

export default BitmapKeyInput;
