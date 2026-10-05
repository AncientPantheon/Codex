// @vitest-environment node
/**
 * T1 RED/GREEN — the injectable OPFS-like file I/O seam (`BundleAssemblyFile`).
 *
 * Pure node-logic test (no DOM, no OPFS) — `// @vitest-environment node` mirrors
 * `e4-keygen-runner.test.ts`'s own pragma for the same reason: nothing here
 * touches React or a browser API, only the `FakeBundleAssemblyFile` seam T2's
 * incremental assembler will actually exercise directly (a real browser has no
 * Node runtime to test the OPFS-backed impl against here; that half is verified
 * by typechecking + a later task's manual browser run).
 *
 * Every test below exists to catch a specific class of streaming-assembly bug:
 * `assembleBundleToFile` (T2) writes the header-count field at offset 0, then
 * the per-item `{length, id}` headers, THEN the item bodies in sequence, and
 * FINALLY seeks back to offset 0 to backfill the header region once every
 * item's real length/id is known. That access pattern is non-sequential by
 * design (write body forward, then jump back and overwrite earlier bytes) and
 * leaves gaps ahead of the write cursor (the reserved-but-not-yet-written
 * header region) — exactly what these round-trip tests target.
 */

import { describe, it, expect } from "vitest";

import { FakeBundleAssemblyFile } from "../src/library/streaming/fakeBundleAssemblyFile.js";

describe("FakeBundleAssemblyFile — byte-exact round trips (T1)", () => {
  it("reads back exactly what was written at a given offset", async () => {
    const file = new FakeBundleAssemblyFile();
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

    await file.write(0, bytes);
    const readBack = await file.read(0, bytes.byteLength);

    // Regression this catches: a write/read implementation that silently
    // truncates, reorders, or off-by-ones the bytes it stores — the exact
    // failure mode that would corrupt an assembled ANS-104 bundle.
    expect([...readBack]).toEqual([...bytes]);
  });

  it("round-trips correctly when writes land at non-sequential offsets", async () => {
    const file = new FakeBundleAssemblyFile();
    const second = new Uint8Array([9, 9, 9, 9]);
    const first = new Uint8Array([1, 2, 3, 4]);

    // Write the LATER region first, then go back and fill the earlier one —
    // exactly the header-backfill access pattern `assembleBundleToFile` (T2)
    // needs: body bytes land first, headers get backfilled at offset 0 only
    // once every item is signed.
    await file.write(4, second);
    await file.write(0, first);

    const readBack = await file.read(0, 8);
    expect([...readBack]).toEqual([1, 2, 3, 4, 9, 9, 9, 9]);
  });

  it("overwrites a previously-written region in place without disturbing its neighbors", async () => {
    const file = new FakeBundleAssemblyFile();
    await file.write(0, new Uint8Array([1, 2, 3, 4, 5, 6]));

    // The header-backfill itself: re-write just the first 2 bytes (a stand-in
    // for the 32-byte item-count field) after the body already landed.
    await file.write(0, new Uint8Array([9, 9]));

    const readBack = await file.read(0, 6);
    expect([...readBack]).toEqual([9, 9, 3, 4, 5, 6]);
  });

  it("extends the file when a write lands past the current end, zero-filling the gap", async () => {
    const file = new FakeBundleAssemblyFile();

    // Nothing written at offsets 0..9 yet — this is the reserved-header-region
    // gap the real assembler leaves ahead of its cursor before any file is
    // signed. A correct implementation must zero-fill it, not leave garbage
    // or throw.
    await file.write(10, new Uint8Array([7, 7, 7]));

    const readBack = await file.read(0, 13);
    expect([...readBack]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 7, 7]);
  });

  it("returns zero-filled bytes when reading a range that was never written", async () => {
    const file = new FakeBundleAssemblyFile();
    const readBack = await file.read(0, 5);
    expect([...readBack]).toEqual([0, 0, 0, 0, 0]);
  });

  it("close() is idempotent — calling it a second time does not throw", async () => {
    const file = new FakeBundleAssemblyFile();
    await file.write(0, new Uint8Array([1]));

    await file.close();
    // Regression this catches: a caller (the eventual Worker message loop)
    // that calls close() on both the success and a cleanup/error path ending
    // up double-closing — that must be safe, not a thrown error.
    await expect(file.close()).resolves.toBeUndefined();
  });

  it("rejects a write() issued after close()", async () => {
    const file = new FakeBundleAssemblyFile();
    await file.close();

    // Regression this catches: silently accepting (and losing) a write to an
    // already-closed handle instead of surfacing the programmer error loudly.
    await expect(file.write(0, new Uint8Array([1]))).rejects.toThrow();
  });

  it("rejects a read() issued after close()", async () => {
    const file = new FakeBundleAssemblyFile();
    await file.write(0, new Uint8Array([1, 2, 3]));
    await file.close();

    await expect(file.read(0, 3)).rejects.toThrow();
  });
});
