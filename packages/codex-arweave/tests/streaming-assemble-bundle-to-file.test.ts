// @vitest-environment node
/**
 * T2 RED/GREEN — the incremental bundle assembler (`assembleBundleToFile`).
 *
 * Pure node-logic test (no DOM, no OPFS) — mirrors
 * `streaming-bundle-assembly-file.test.ts`'s own `// @vitest-environment node`
 * pragma: this exercises `FakeBundleAssemblyFile` (T1) directly, never the real
 * OPFS-backed implementation (verified separately, manually, against a real
 * browser — see this task's own report).
 *
 * TWO correctness properties are under test, each catching a distinct class of
 * real bug:
 *
 * 1. Byte-for-byte parity with `assembleSignedBundle`'s documented layout (32
 *    bytes item-count + 64 bytes x N per-item {length, id} headers + the
 *    concatenated raw item binaries, `packages/arweave-core/src/upload/
 *    bundle.ts`, read in full before writing this). That function is NOT
 *    exported (module-internal by design — confirmed by reading the file: no
 *    `export` keyword on it, and `design.md` says so explicitly), so it cannot
 *    be imported, deep-path or otherwise, for a real call. A genuinely
 *    byte-identical comparison also could NOT be obtained by calling it twice
 *    independently (once via a real `uploadBundle`/`assembleSignedBundle` run,
 *    once via `assembleBundleToFile`) even if it WERE exported: RSA-PSS
 *    signing draws a fresh random salt on every call (verified empirically
 *    while building this test — two independent `sign()` calls on byte-
 *    identical input never produce byte-identical output), so two SEPARATE
 *    signing passes can never be compared byte-for-byte. The only sound
 *    comparison is therefore: let `assembleBundleToFile` sign every item
 *    exactly ONCE (as the real function must, as designed), INTERCEPT those
 *    exact `{item, rawId}` pairs as they are produced (the `vi.mock` factory
 *    below, wrapping arbundles' `sign` export with a transparent recording
 *    pass-through), and independently pack THOSE SAME items via the documented
 *    formula — this is "replicate the exact same signing+tag-building call
 *    sequence independently and compare" (the task's own sanctioned fallback
 *    for the non-exported function), fed the real items this run actually
 *    produced rather than a second, necessarily-divergent sign pass.
 *
 * 2. Memory residency: `assembleBundleToFile` must never hold more than one
 *    file's raw input bytes resident in its own code at any point in the loop
 *    (`docs/work/arweave-opfs-bundle-assembly/design.md`'s whole point).
 *    Proven structurally via `WeakRef` + a forced GC (`node:v8`'s
 *    `setFlagsFromString("--expose-gc")` + `node:vm`'s `runInNewContext("gc")`
 *    — exposes `gc()` at runtime with no `--expose-gc` CLI flag required, so
 *    this test runs under the project's normal `vitest run`), not "trust the
 *    code": each file's lazily-read buffer is tracked by a `WeakRef`, and the
 *    NEXT file's `readData()` call asserts the PREVIOUS file's buffer is
 *    already unreachable before producing its own — exactly the "one at a
 *    time" property, checked at each step, not just at the end.
 *
 * The `vi.mock` factory used for (1) is a transparent pass-through (every call
 * still reaches the real `sign`) with an opt-in capture flag
 * (`capturedSignCalls`), kept `null` outside the byte-identical test so it
 * does not itself retain a reference to every signed item during the
 * residency test — that retention would defeat (2) by keeping every file's
 * buffer artificially reachable regardless of what `assembleBundleToFile`
 * itself does.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";

import { describe, it, expect, vi } from "vitest";
import { longTo32ByteArray } from "arbundles";
import type { DataItem } from "arbundles";
import type { ArweaveJwk } from "@ancientpantheon/arweave-core";

import { FakeBundleAssemblyFile } from "../src/library/streaming/fakeBundleAssemblyFile.js";
import {
  assembleBundleToFile,
  type AssembleBundleToFileInput,
} from "../src/library/streaming/assembleBundleToFile.js";
import { deriveAccountAesKey } from "../src/crypto/fileEncryption.js";
import {
  ENCRYPTION_CHUNK_SIZE,
  decryptStream,
  type ByteRangeReader,
} from "../src/crypto/streamingFileEncryption.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const throwawayJwk = JSON.parse(
  readFileSync(join(FIXTURES, "throwaway-arweave-keyfile.json"), "utf8"),
) as ArweaveJwk;

/** Opt-in capture of every real `{item, rawId}` pair `assembleBundleToFile`
 *  actually signs, in call order — `null` means "don't capture" (the
 *  residency test's state), so the wrapper below never retains a stray
 *  reference to a file's signed item unless a test explicitly asks for it. */
let capturedSignCalls: { item: DataItem; rawId: Buffer }[] | null = null;

vi.mock("arbundles", async (importOriginal) => {
  const original = await importOriginal<typeof import("arbundles")>();
  return {
    ...original,
    // Transparent recording pass-through: behavior is byte-for-byte identical
    // to the real `sign` (every call still reaches it); this ONLY lets a test
    // observe which exact items got signed, in what order.
    sign: async (...args: Parameters<typeof original.sign>) => {
      const rawId = await original.sign(...args);
      if (capturedSignCalls !== null) {
        capturedSignCalls.push({ item: args[0], rawId });
      }
      return rawId;
    },
  };
});

/** Deterministic, non-zero, non-repeating-in-a-trivial-way byte content —
 *  realistic enough that a header/offset bug (wrong length, swapped id, bodies
 *  out of order) would corrupt the comparison, unlike an all-zero fixture. */
function makeDeterministicBytes(size: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    bytes[i] = (i * 7 + seed) & 0xff;
  }
  return bytes;
}

/** Realistic multi-file fixture: subfolders preserved (mirrors
 *  `e3-library-flow.test.ts`'s own `makeFiles` convention), sizes spanning a
 *  few bytes up to ~1.2 MB — enough to meaningfully exceed a trivial
 *  2-tiny-file case (signing an RSA-4096 item is cheap regardless of payload
 *  size — benchmarked at single-digit milliseconds even at several MB — so
 *  this stays fast while still exercising a real, non-trivial total size). */
function makeRealisticFiles(): AssembleBundleToFileInput[] {
  const sizes = [37, 2_048, 64_000, 1_200_000];
  return sizes.map((size, i) => ({
    path: i === 0 ? `root-${i}.bin` : `sub/dir/file-${i}.bin`,
    contentType: "application/octet-stream",
    readData: async () => makeDeterministicBytes(size, i),
  }));
}

/** Exposes a real `gc()` at runtime (no `--expose-gc` CLI flag needed) and
 *  waits through enough event-loop turns for V8 to actually reclaim an
 *  object whose only reference went out of scope — the exact technique
 *  verified empirically while building this test (a bare `gc()` call with no
 *  surrounding microtask yield does not reliably collect). */
async function forceGcAndSettle(): Promise<void> {
  setFlagsFromString("--expose-gc");
  const gc = runInNewContext("gc") as () => void;
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    gc();
  }
}

/** Packs items via `assembleSignedBundle`'s own documented, non-exported
 *  formula (32-byte count + 64 bytes x N per-item {length, id} headers + the
 *  concatenated raw item binaries) — see the module doc comment above for why
 *  this is driven by the REAL run's captured items, not a second sign pass. */
function packExpectedBundle(items: { item: DataItem; rawId: Buffer }[]): Buffer {
  const headers = new Uint8Array(64 * items.length);
  const binaries: Uint8Array[] = [];
  items.forEach(({ item, rawId }, index) => {
    const header = new Uint8Array(64);
    header.set(longTo32ByteArray(item.getRaw().byteLength), 0);
    header.set(rawId, 32);
    headers.set(header, 64 * index);
    binaries.push(item.getRaw());
  });
  return Buffer.concat([
    Buffer.from(longTo32ByteArray(items.length)),
    Buffer.from(headers),
    Buffer.concat(binaries),
  ]);
}

describe("assembleBundleToFile — byte-for-byte parity with the documented bundle layout", () => {
  it("writes a bundle byte-identical to the documented header+body formula for the real signed items", async () => {
    capturedSignCalls = [];
    const files = makeRealisticFiles();
    const bundleFile = new FakeBundleAssemblyFile();

    const result = await assembleBundleToFile(bundleFile, {
      jwk: throwawayJwk,
      files,
      category: "general-other",
      encrypted: false,
    });

    const items = capturedSignCalls;
    capturedSignCalls = null;
    expect(items).not.toBeNull();
    // Regression this catches: signing more or fewer items than files + 1
    // manifest (e.g. skipping a file, double-signing, forgetting the
    // manifest) — every downstream assertion below assumes this count.
    expect(items!.length).toBe(files.length + 1);

    const expected = packExpectedBundle(items!);
    const actualHeaderAndBody = await bundleFile.read(0, expected.byteLength);
    // Regression this catches: ANY header-backfill arithmetic bug (wrong
    // item count, wrong per-item length/id, bodies written at the wrong
    // offset or out of order) — compares the FULL buffer, not a summary.
    expect([...actualHeaderAndBody]).toEqual([...expected]);

    // Nothing was written past the end of the real bundle (no stray trailing
    // bytes from an over-sized header reservation or a cursor miscalculation).
    const probe = await bundleFile.read(expected.byteLength, 1);
    expect([...probe]).toEqual([0]);

    // The returned ids are the SAME base64url-encoded raw ids the header
    // region now carries — not a mismatched or re-derived value.
    const toBase64Url = (b: Buffer) => b.toString("base64url");
    files.forEach((f, i) => {
      expect(result.fileIds[i]).toEqual({ path: f.path, id: toBase64Url(items![i].rawId) });
    });
    expect(result.manifestId).toBe(toBase64Url(items![items!.length - 1].rawId));
  });

  it("builds the manifest's index/paths referencing every file's real final id, subfolders preserved", async () => {
    capturedSignCalls = [];
    const files = makeRealisticFiles();
    const bundleFile = new FakeBundleAssemblyFile();

    const result = await assembleBundleToFile(bundleFile, {
      jwk: throwawayJwk,
      files,
      category: "general-other",
      encrypted: false,
    });

    const items = capturedSignCalls;
    capturedSignCalls = null;
    const manifestItem = items![items!.length - 1]!.item;
    const manifest = JSON.parse(manifestItem.rawData.toString("utf8")) as {
      manifest: string;
      version: string;
      index: { path: string };
      paths: Record<string, { id: string }>;
    };

    // Regression this catches: a manifest built BEFORE every file's real id is
    // known (e.g. a placeholder/wrong id), or paths keyed on the wrong
    // relative path (subfolder loss), which would 404 real gateway browsing.
    expect(manifest.manifest).toBe("arweave/paths");
    expect(manifest.index).toEqual({ path: files[0]!.path });
    for (const f of files) {
      const expectedEntry = result.fileIds.find((e) => e.path === f.path);
      expect(manifest.paths[f.path]).toEqual({ id: expectedEntry!.id });
    }
  });
});

/**
 * Wraps `FakeBundleAssemblyFile.write()` to call `onItemWritten` after every
 * ITEM write (never the two header-region writes, both always at `offset ===
 * 0` — the initial zeroed reservation and the final backfill — since
 * `headerRegionSize` is always > 0, no real item write ever lands at offset
 * 0). `onItemWritten`'s 0-based index counts files-then-manifest, matching
 * `assembleBundleToFile`'s own write order.
 *
 * WHY check here rather than inside `readData()` (the first, more obvious
 * place to try): verified empirically while building this test — V8 does not
 * retire a `for`-loop's reused `const bytes = await file.readData()` binding
 * from the PREVIOUS iteration until that statement's assignment for the
 * CURRENT iteration actually completes. A check placed INSIDE `readData()`
 * runs as a sub-expression of that very assignment, strictly BEFORE it
 * completes — so it can never observe the previous iteration's buffer as
 * collected, even for a flawlessly-correct implementation (confirmed with a
 * minimal throwaway repro matching this exact driver-loop shape). Checking
 * instead after `write()` — which only runs once the implementation's
 * `readData()` call for the CURRENT file has already resolved and been
 * assigned — lands strictly after that assignment, where V8 reliably reports
 * the previous (now zero-remaining-references) buffer as collected.
 */
class ResidencyProbeFile extends FakeBundleAssemblyFile {
  #itemWriteCount = 0;
  constructor(private readonly onItemWritten: (itemIndex: number) => Promise<void>) {
    super();
  }
  override async write(offset: number, bytes: Uint8Array): Promise<void> {
    await super.write(offset, bytes);
    if (offset !== 0) {
      await this.onItemWritten(this.#itemWriteCount);
      this.#itemWriteCount += 1;
    }
  }
}

describe("assembleBundleToFile — memory residency", () => {
  it("never holds more than one file's raw input bytes resident at a time", async () => {
    const sizes = [41, 65_000, 1_300_000];
    const refs: Array<WeakRef<Uint8Array>> = [];

    const files: AssembleBundleToFileInput[] = sizes.map((size, i) => ({
      path: i === 0 ? `big-${i}.bin` : `sub/big-${i}.bin`,
      contentType: "application/octet-stream",
      readData: async () => {
        const bytes = makeDeterministicBytes(size, i);
        refs[i] = new WeakRef(bytes);
        return bytes;
      },
    }));

    const bundleFile = new ResidencyProbeFile(async (itemIndex) => {
      // itemIndex 0..files.length-1 are the file items, in order. Checked
      // strictly BETWEEN two file items (itemIndex < files.length) — the
      // boundary into the manifest write (itemIndex === files.length) is
      // deliberately EXCLUDED here: that checkpoint still runs inside the
      // SAME `assembleBundleToFile` activation as the last file's loop
      // iteration, and V8 does not retire a loop's final iteration binding
      // until the function itself returns (no subsequent iteration's
      // assignment to overwrite the slot) — confirmed empirically with a
      // throwaway repro, true for a flawlessly-correct implementation too.
      // The post-`await` check below (after the whole call returns) is what
      // verifies the LAST file's release instead — a real, just differently
      // timed, structural proof, not a gap in coverage.
      if (itemIndex > 0 && itemIndex < files.length) {
        await forceGcAndSettle();
        // The PREVIOUS file's buffer must already be unreachable by the time
        // THIS (later) file has been written — structural proof the
        // implementation released its reference before moving on, not
        // "trust the code": if `assembleBundleToFile` accumulated every
        // file's bytes into an array instead of dropping each one per
        // iteration, this buffer would still be reachable here and the
        // assertion would fail.
        expect(refs[itemIndex - 1]!.deref()).toBeUndefined();
      }
    });

    await assembleBundleToFile(bundleFile, {
      jwk: throwawayJwk,
      files,
      category: "general-other",
      encrypted: false,
    });

    await forceGcAndSettle();
    // The LAST file's buffer must ALSO be released — checked here, after the
    // whole call has returned, rather than at the manifest-write boundary
    // above (see that checkpoint's own comment for why that boundary isn't a
    // reliable observation point). This is where "the function's own return
    // value/closures must not retain it either" is actually verified.
    expect(refs[sizes.length - 1]!.deref()).toBeUndefined();
  });
});

/**
 * T2 (`arweave-streaming-encryption`) RED/GREEN — the optional `encryption`
 * param.
 *
 * ANS-104 signing (`createData`/`sign`) hashes a DataItem's complete `data`
 * field in one shot (no incremental/streaming signing exists in arbundles),
 * so the final ciphertext for a given file MUST be fully assembled as one
 * buffer before `createData` is called — exactly the same "one file's worth
 * of bytes resident at a time" bound the UNENCRYPTED path already has via
 * `readData()`. What T1's chunked `encryptStreamToFile` buys here is never
 * holding a base64-blown-up whole-file string (v1's `encryptFileForUpload`
 * ceiling) or more than one plaintext+ciphertext CHUNK resident mid-encrypt —
 * not a change to this per-file residency bound, which this sub-topic never
 * claimed to lower.
 *
 * Confirmed directly from `arbundles`' own `DataItem.rawData` getter
 * (`node_modules/arbundles/build/node/esm/src/DataItem.js`): `data` is the
 * LAST field in a DataItem's raw binary (`binary.subarray(dataStart,
 * binary.length)`), so a captured item's ciphertext region within the WHOLE
 * bundle file is always `[itemOffset + (itemRawLength - dataLength),
 * itemOffset + itemRawLength)` — {@link ciphertextRegionsFromCapturedItems}
 * below derives exactly that, from the same `vi.mock`-captured `{item}` pairs
 * the byte-for-byte parity tests above already use, mirroring
 * `packExpectedBundle`'s own cumulative-cursor bookkeeping.
 */

const ENCRYPTION_BITSTRING = "1".repeat(800) + "0".repeat(800);

/** A read-only `ByteRangeReader` over an already-materialized buffer — same
 *  shape as `streaming-file-encryption.test.ts`'s own `makeReaderOver`. */
function makeReaderOver(source: Uint8Array): ByteRangeReader {
  return async (offset, length) => source.subarray(offset, offset + length);
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return out;
}

/** Derives every captured item's `{itemOffset, itemRawLength, dataOffset,
 *  dataLength}` within the bundle file, from the SAME cumulative-cursor
 *  bookkeeping `assembleBundleToFile` itself uses (header region first, then
 *  each item's raw bytes back to back, in order) — see the module doc
 *  comment above for why `dataOffset`/`dataLength` (the file's CIPHERTEXT
 *  region) are derivable from `item.getRaw()`/`item.rawData` alone, with no
 *  change needed to `AssembleBundleToFileResult`'s own public shape. */
function ciphertextRegionsFromCapturedItems(
  items: { item: DataItem; rawId: Buffer }[],
  headerRegionSize: number,
): { itemOffset: number; itemRawLength: number; dataOffset: number; dataLength: number }[] {
  const regions: { itemOffset: number; itemRawLength: number; dataOffset: number; dataLength: number }[] = [];
  let cursor = headerRegionSize;
  for (const { item } of items) {
    const raw = item.getRaw();
    const dataLength = item.rawData.byteLength;
    const dataOffset = cursor + (raw.byteLength - dataLength);
    regions.push({ itemOffset: cursor, itemRawLength: raw.byteLength, dataOffset, dataLength });
    cursor += raw.byteLength;
  }
  return regions;
}

describe("assembleBundleToFile — encrypted bundle (encryption param)", () => {
  it("decrypts every file's on-disk ciphertext region back to its exact original plaintext, including a file spanning multiple ENCRYPTION_CHUNK_SIZE chunks", async () => {
    capturedSignCalls = [];
    const key = await deriveAccountAesKey(ENCRYPTION_BITSTRING);
    // Sizes deliberately span: a partial-chunk file, a tiny file, and a file
    // crossing multiple ENCRYPTION_CHUNK_SIZE boundaries (3 full chunks + a
    // remainder) — proving this isn't just correct for single-chunk files.
    const sizes = [ENCRYPTION_CHUNK_SIZE + 500, 2_048, 3 * ENCRYPTION_CHUNK_SIZE + 777];
    const plaintexts = sizes.map((size, i) => makeDeterministicBytes(size, 100 + i));
    const files: AssembleBundleToFileInput[] = sizes.map((_size, i) => ({
      path: i === 0 ? `enc-${i}.bin` : `sub/enc-${i}.bin`,
      contentType: "application/octet-stream",
      readData: async () => plaintexts[i]!,
    }));
    const bundleFile = new FakeBundleAssemblyFile();

    await assembleBundleToFile(bundleFile, {
      jwk: throwawayJwk,
      files,
      category: "general-other",
      encrypted: true,
      encryptorAddress: "Ѻ.throwaway-ouronet-address",
      encryptionVersion: "2",
      encryption: { key },
    });

    const items = capturedSignCalls!;
    capturedSignCalls = null;
    const headerRegionSize = 32 + 64 * (files.length + 1);
    const regions = ciphertextRegionsFromCapturedItems(items, headerRegionSize);

    for (let i = 0; i < files.length; i++) {
      const { dataOffset, dataLength } = regions[i]!;
      // Read the ciphertext region back through the FAKE file's OWN read
      // capability — not from the in-memory `item.rawData` the mock already
      // captured — so this proves the bytes actually landed on disk at the
      // right place, not merely that `createData` was handed the right value.
      const ciphertext = await bundleFile.read(dataOffset, dataLength);
      const decryptedChunks: Uint8Array[] = [];
      for await (const chunk of decryptStream({
        read: makeReaderOver(ciphertext),
        totalCiphertextLength: dataLength,
        totalPlaintextLength: plaintexts[i]!.byteLength,
        key,
      })) {
        decryptedChunks.push(chunk);
      }
      expect(Buffer.from(concatChunks(decryptedChunks)).equals(Buffer.from(plaintexts[i]!))).toBe(true);
    }
  });

  it("the SECOND file's ciphertext offset is based on the FIRST file's CIPHERTEXT length, not its plaintext length — a plaintext-length-based offset lands on the wrong bytes and fails to decrypt", async () => {
    capturedSignCalls = [];
    const key = await deriveAccountAesKey(ENCRYPTION_BITSTRING);
    // File 1 spans exactly 2 ENCRYPTION_CHUNK_SIZE chunks, so its ciphertext
    // is 2 * 28 = 56 bytes larger than its plaintext — a deliberately large
    // enough shift that reading at the WRONG (plaintext-length-based) offset
    // for file 2 reads 56 bytes of file 1's own tail instead, guaranteeing a
    // GCM auth-tag failure rather than a lucky accidental match.
    const sizes = [2 * ENCRYPTION_CHUNK_SIZE, 9_000];
    const plaintexts = sizes.map((size, i) => makeDeterministicBytes(size, 200 + i));
    const files: AssembleBundleToFileInput[] = sizes.map((_size, i) => ({
      path: `f-${i}.bin`,
      contentType: "application/octet-stream",
      readData: async () => plaintexts[i]!,
    }));
    const bundleFile = new FakeBundleAssemblyFile();

    await assembleBundleToFile(bundleFile, {
      jwk: throwawayJwk,
      files,
      category: "general-other",
      encrypted: true,
      encryptorAddress: "Ѻ.throwaway-ouronet-address",
      encryptionVersion: "2",
      encryption: { key },
    });

    const items = capturedSignCalls!;
    capturedSignCalls = null;
    const headerRegionSize = 32 + 64 * (files.length + 1);
    const regions = ciphertextRegionsFromCapturedItems(items, headerRegionSize);

    const file1CiphertextLength = items[0]!.item.rawData.byteLength;
    const file1PlaintextLength = plaintexts[0]!.byteLength;
    const file1OverheadBytes = file1CiphertextLength - file1PlaintextLength;
    // Sanity guard: file 1 really did span 2 chunks (2 * 28 bytes overhead) —
    // if this ever drifted to 0, the rest of this test would prove nothing.
    expect(file1OverheadBytes).toBe(2 * 28);

    const correctFile2Offset = regions[1]!.itemOffset;
    const wrongFile2Offset = correctFile2Offset - file1OverheadBytes;
    expect(wrongFile2Offset).not.toBe(correctFile2Offset);

    // The WRONG offset: reading file 2's expected ciphertext LENGTH starting
    // `file1OverheadBytes` too early lands on the tail of file 1's own raw
    // item bytes instead of file 2's real ciphertext.
    const wrongRegionBytes = await bundleFile.read(wrongFile2Offset, regions[1]!.dataLength);
    let wrongDecryptThrew = false;
    const wrongDecryptedChunks: Uint8Array[] = [];
    try {
      for await (const chunk of decryptStream({
        read: makeReaderOver(wrongRegionBytes),
        totalCiphertextLength: regions[1]!.dataLength,
        totalPlaintextLength: plaintexts[1]!.byteLength,
        key,
      })) {
        wrongDecryptedChunks.push(chunk);
      }
    } catch {
      wrongDecryptThrew = true;
    }
    const wrongDecryptedMatchesOriginal =
      !wrongDecryptThrew &&
      Buffer.from(concatChunks(wrongDecryptedChunks)).equals(Buffer.from(plaintexts[1]!));
    // The misaligned read must NOT silently round-trip — proves the offset
    // genuinely matters, not that any nearby offset happens to work.
    expect(wrongDecryptedMatchesOriginal).toBe(false);

    // The CORRECT (ciphertext-length-based) offset really does round-trip.
    const { dataOffset, dataLength } = regions[1]!;
    const ciphertext = await bundleFile.read(dataOffset, dataLength);
    const decryptedChunks: Uint8Array[] = [];
    for await (const chunk of decryptStream({
      read: makeReaderOver(ciphertext),
      totalCiphertextLength: dataLength,
      totalPlaintextLength: plaintexts[1]!.byteLength,
      key,
    })) {
      decryptedChunks.push(chunk);
    }
    expect(Buffer.from(concatChunks(decryptedChunks)).equals(Buffer.from(plaintexts[1]!))).toBe(true);
  });
});
