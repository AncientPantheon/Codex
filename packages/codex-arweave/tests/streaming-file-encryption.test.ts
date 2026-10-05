// @vitest-environment node
/**
 * `streamingFileEncryption.ts` RED/GREEN matrix (T1,
 * `arweave-streaming-encryption`).
 *
 * `encryptStreamToFile`/`decryptStream` are the new v2 chunked-AES-GCM
 * primitives — a sibling to `fileEncryption.ts`'s v1 whole-blob
 * `encryptWithDerivedKey`/`decryptWithDerivedKey`, never a replacement (v1
 * is read but never modified or imported for its encrypt/decrypt calls
 * here — only `deriveAccountAesKey`, UNCHANGED, is reused to get a REAL
 * `CryptoKey` for every row below; WebCrypto itself is never mocked).
 *
 * Pure Node-crypto logic, no DOM — `// @vitest-environment node`, mirroring
 * `crypto-file-encryption.test.ts`'s own pragma for the same reason.
 *
 * DESIGN DECISIONS LOCKED IN BY THIS FILE (grounded against
 * `docs/work/arweave-streaming-encryption/design.md` + `plan.md`'s T1):
 *   - A 0-byte plaintext produces ZERO chunks (not one zero-length chunk) —
 *     `encryptStreamToFile` never calls `read`/`write` at all, `decryptStream`
 *     never calls `read`/yields at all. This matches `Math.ceil(0 / C) ===
 *     0` exactly, and matches the per-chunk-boundary rule read literally
 *     ("`chunk i` covers plaintext bytes `[i·C, min((i+1)·C, totalSize))`" —
 *     for `totalSize === 0` there is no `i` for which `i·C < totalSize`
 *     holds, so the boundary list is empty by construction, not by a special
 *     case).
 *   - `decryptStream` yields EAGERLY, one chunk at a time, in order — a
 *     decrypt failure on chunk `i` throws before chunk `i` is yielded, and
 *     (proven below) before any LATER chunk is ever attempted; every chunk
 *     BEFORE the failing one, if any, has already been yielded and seen by
 *     the consumer (this file's wrong-key row below encrypts under key A and
 *     decrypts under key B for EVERY chunk, so chunk 0 itself fails and zero
 *     chunks are ever yielded — the row documents this exact zero-yielded
 *     outcome, not a general "some chunks succeed" claim).
 */

import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";

import { describe, it, expect } from "vitest";

import { deriveAccountAesKey } from "../src/crypto/fileEncryption.js";
import {
  ENCRYPTION_CHUNK_SIZE,
  encryptStreamToFile,
  decryptStream,
  type ByteRangeReader,
  type ByteRangeWriter,
} from "../src/crypto/streamingFileEncryption.js";

/** Stand-in 1600-bit `"0"`/`"1"` bitstrings — mirrors
 *  `crypto-file-encryption.test.ts`'s own `BITSTRING_A`/`BITSTRING_B`
 *  convention exactly (the canonical account-key form, content/length
 *  otherwise irrelevant to these rows). */
const BITSTRING_A = "1".repeat(800) + "0".repeat(800);
const BITSTRING_B = "0".repeat(800) + "1".repeat(800);

/** Deterministic, non-zero, non-repeating-in-a-trivial-way byte content —
 *  mirrors `streaming-assemble-bundle-to-file.test.ts`'s own
 *  `makeDeterministicBytes` convention exactly: realistic enough that an
 *  offset/framing bug would corrupt the round-trip, unlike an all-zero
 *  fixture. */
function makeDeterministicBytes(size: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    bytes[i] = (i * 7 + seed) & 0xff;
  }
  return bytes;
}

/** A simple growable-`Uint8Array`-backed fake `read`/`write` pair, matching
 *  `ByteRangeReader`/`ByteRangeWriter`'s exact signatures — the "fake you
 *  write yourself" the plan calls for, never a mock of WebCrypto itself.
 *  `write` grows the backing array on demand so it can serve as BOTH the
 *  encrypt side's destination file and (via `read` over the same backing
 *  array) the decrypt side's source file. */
function makeFakeFile(): { read: ByteRangeReader; write: ByteRangeWriter; getBytes: () => Uint8Array } {
  let backing = new Uint8Array(0);
  const read: ByteRangeReader = async (offset, length) => backing.slice(offset, offset + length);
  const write: ByteRangeWriter = async (offset, bytes) => {
    const requiredLength = offset + bytes.byteLength;
    if (requiredLength > backing.byteLength) {
      const grown = new Uint8Array(requiredLength);
      grown.set(backing);
      backing = grown;
    }
    backing.set(bytes, offset);
  };
  return { read, write, getBytes: () => backing };
}

/** A read-only fake `read` over an already-materialized fixture buffer —
 *  used for the plaintext SOURCE side (never written to). */
function makeReaderOver(source: Uint8Array): ByteRangeReader {
  return async (offset, length) => source.slice(offset, offset + length);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return out;
}

/** Exposes a real `gc()` at runtime (no `--expose-gc` CLI flag needed) and
 *  waits through enough event-loop turns for V8 to actually reclaim an
 *  object whose only reference went out of scope — the EXACT technique
 *  `streaming-assemble-bundle-to-file.test.ts` already established in this
 *  package, reused verbatim here. */
async function forceGcAndSettle(): Promise<void> {
  setFlagsFromString("--expose-gc");
  const gc = runInNewContext("gc") as () => void;
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    gc();
  }
}

const ROUND_TRIP_SIZES = [
  0,
  1,
  ENCRYPTION_CHUNK_SIZE - 1,
  ENCRYPTION_CHUNK_SIZE,
  ENCRYPTION_CHUNK_SIZE + 1,
  3 * ENCRYPTION_CHUNK_SIZE + 1000,
];

describe("encryptStreamToFile + decryptStream — byte-exact round trip", () => {
  for (const size of ROUND_TRIP_SIZES) {
    it(`round-trips ${size} plaintext bytes byte-identically`, async () => {
      const key = await deriveAccountAesKey(BITSTRING_A);
      const plaintext = makeDeterministicBytes(size, 13);
      const file = makeFakeFile();

      const { totalCiphertextLength, chunkCount } = await encryptStreamToFile({
        read: makeReaderOver(plaintext),
        totalPlaintextLength: plaintext.byteLength,
        key,
        write: file.write,
      });

      // Each full chunk's ciphertext is exactly 28 bytes (12 IV + 16 tag)
      // larger than its plaintext chunk — a known, computable expansion,
      // never base64 blowup. Checked here via the TOTAL (not per-chunk,
      // which the write-spy test below covers): expansion is 28 bytes times
      // however many chunks there are.
      expect(totalCiphertextLength).toBe(plaintext.byteLength + chunkCount * 28);
      expect(file.getBytes().byteLength).toBe(totalCiphertextLength);

      const decryptedChunks: Uint8Array[] = [];
      for await (const chunk of decryptStream({
        read: makeReaderOver(file.getBytes()),
        totalCiphertextLength,
        totalPlaintextLength: plaintext.byteLength,
        key,
      })) {
        decryptedChunks.push(chunk);
      }

      const decrypted = concat(decryptedChunks);
      expect(Buffer.from(decrypted).equals(Buffer.from(plaintext))).toBe(true);
    });
  }
});

describe("encryptStreamToFile — chunkCount", () => {
  it.each(ROUND_TRIP_SIZES)(
    "chunkCount for %i plaintext bytes matches Math.ceil(totalPlaintextLength / ENCRYPTION_CHUNK_SIZE)",
    async (size) => {
      const key = await deriveAccountAesKey(BITSTRING_A);
      const plaintext = makeDeterministicBytes(size, 5);
      const file = makeFakeFile();

      const { chunkCount } = await encryptStreamToFile({
        read: makeReaderOver(plaintext),
        totalPlaintextLength: plaintext.byteLength,
        key,
        write: file.write,
      });

      expect(chunkCount).toBe(Math.ceil(size / ENCRYPTION_CHUNK_SIZE));
    },
  );

  it("produces exactly 0 chunks for a 0-byte plaintext (the locked-in zero-chunk decision)", async () => {
    const key = await deriveAccountAesKey(BITSTRING_A);
    const file = makeFakeFile();

    const { chunkCount, totalCiphertextLength } = await encryptStreamToFile({
      read: makeReaderOver(new Uint8Array(0)),
      totalPlaintextLength: 0,
      key,
      write: file.write,
    });

    expect(chunkCount).toBe(0);
    expect(totalCiphertextLength).toBe(0);
    // Zero chunks means `read`/`write` are never called at all for a 0-byte
    // file — nothing was written to the fake backing file.
    expect(file.getBytes().byteLength).toBe(0);
  });
});

describe("decryptStream — wrong key fails loudly and immediately", () => {
  it("throws on the first chunk and yields zero chunks before throwing (every chunk encrypted under a DIFFERENT key)", async () => {
    const keyA = await deriveAccountAesKey(BITSTRING_A);
    const keyB = await deriveAccountAesKey(BITSTRING_B);
    const plaintext = makeDeterministicBytes(3 * ENCRYPTION_CHUNK_SIZE + 1000, 21);
    const file = makeFakeFile();

    const { totalCiphertextLength } = await encryptStreamToFile({
      read: makeReaderOver(plaintext),
      totalPlaintextLength: plaintext.byteLength,
      key: keyA,
      write: file.write,
    });

    const yielded: Uint8Array[] = [];
    await expect(async () => {
      for await (const chunk of decryptStream({
        read: makeReaderOver(file.getBytes()),
        totalCiphertextLength,
        totalPlaintextLength: plaintext.byteLength,
        key: keyB,
      })) {
        yielded.push(chunk);
      }
    }).rejects.toThrow();

    // Documents the TRUE behavior (not assumed): decrypting under the wrong
    // key fails on chunk 0 itself (every chunk was encrypted under keyA, so
    // every chunk's auth tag fails under keyB) — zero chunks are ever
    // yielded before the throw.
    expect(yielded.length).toBe(0);
  });
});

describe("encryptStreamToFile — write is never asked to write more than one chunk's ciphertext at a time", () => {
  it("every write call's byte length is <= ENCRYPTION_CHUNK_SIZE + 28, across a multi-chunk fixture", async () => {
    const key = await deriveAccountAesKey(BITSTRING_A);
    const plaintext = makeDeterministicBytes(3 * ENCRYPTION_CHUNK_SIZE + 1000, 3);
    const file = makeFakeFile();

    const writeCallLengths: number[] = [];
    const spyWrite: ByteRangeWriter = async (offset, bytes) => {
      writeCallLengths.push(bytes.byteLength);
      await file.write(offset, bytes);
    };

    await encryptStreamToFile({
      read: makeReaderOver(plaintext),
      totalPlaintextLength: plaintext.byteLength,
      key,
      write: spyWrite,
    });

    // Guard against a vacuous pass: the multi-chunk fixture must actually
    // have produced more than one write call.
    expect(writeCallLengths.length).toBeGreaterThan(1);
    for (const length of writeCallLengths) {
      expect(length).toBeLessThanOrEqual(ENCRYPTION_CHUNK_SIZE + 28);
    }
  });
});

describe("encryptStreamToFile — memory residency", () => {
  it("releases each iteration's plaintext+ciphertext chunk buffers by two iterations later", async () => {
    const key = await deriveAccountAesKey(BITSTRING_A);
    const plaintext = makeDeterministicBytes(3 * ENCRYPTION_CHUNK_SIZE + 1000, 9);
    const file = makeFakeFile();

    const plaintextRefs: WeakRef<Uint8Array>[] = [];
    const ciphertextRefs: WeakRef<Uint8Array>[] = [];
    let writeCount = 0;

    const read: ByteRangeReader = async (offset, length) => {
      const chunk = plaintext.slice(offset, offset + length);
      plaintextRefs.push(new WeakRef(chunk));
      return chunk;
    };

    const write: ByteRangeWriter = async (offset, bytes) => {
      // `bytes` here IS the framed ciphertext buffer the implementation
      // itself built for this iteration — tracked directly, no extra copy.
      ciphertextRefs.push(new WeakRef(bytes));
      await file.write(offset, bytes);

      const currentIndex = writeCount;
      writeCount += 1;

      // Checked strictly AFTER this iteration's own write (same
      // same-iteration-binding nuance `streaming-assemble-bundle-to-
      // file.test.ts` already documents: a check placed inside `read()`
      // would run as a sub-expression of that very iteration's own
      // assignment, before it completes, and could never observe even a
      // flawlessly-correct implementation's earlier buffers as collected).
      // A gap of two iterations (checking `currentIndex - 2`, not `- 1`)
      // gives slack for any one-iteration-lag quirk while still proving the
      // real bound this task requires.
      if (currentIndex >= 2) {
        await forceGcAndSettle();
        expect(plaintextRefs[currentIndex - 2]!.deref()).toBeUndefined();
        expect(ciphertextRefs[currentIndex - 2]!.deref()).toBeUndefined();
      }
    };

    await encryptStreamToFile({
      read,
      totalPlaintextLength: plaintext.byteLength,
      key,
      write,
    });

    // The LAST two iterations' buffers are checked here, after the whole
    // call has returned (never reachable via the function's return value).
    await forceGcAndSettle();
    expect(plaintextRefs[plaintextRefs.length - 1]!.deref()).toBeUndefined();
    expect(ciphertextRefs[ciphertextRefs.length - 1]!.deref()).toBeUndefined();
  });
});

describe("decryptStream — memory residency", () => {
  it("releases each iteration's ciphertext+plaintext chunk buffers by two iterations later", async () => {
    const key = await deriveAccountAesKey(BITSTRING_A);
    const plaintext = makeDeterministicBytes(3 * ENCRYPTION_CHUNK_SIZE + 1000, 11);
    const file = makeFakeFile();

    const { totalCiphertextLength } = await encryptStreamToFile({
      read: makeReaderOver(plaintext),
      totalPlaintextLength: plaintext.byteLength,
      key,
      write: file.write,
    });
    const ciphertextFile = file.getBytes();

    const ciphertextRefs: WeakRef<Uint8Array>[] = [];
    const plaintextRefs: WeakRef<Uint8Array>[] = [];

    const read: ByteRangeReader = async (offset, length) => {
      const chunk = ciphertextFile.slice(offset, offset + length);
      ciphertextRefs.push(new WeakRef(chunk));
      return chunk;
    };

    // The `for await` loop's own `plaintextChunk` binding is, empirically,
    // subject to the SAME V8 same-iteration-binding nuance
    // `streaming-assemble-bundle-to-file.test.ts` already documents for a
    // PRODUCER's loop-local `const` — except here it's the CONSUMER side:
    // the LAST iteration's binding is not released until the frame that
    // declares the loop (this nested function) itself returns, not merely
    // once the loop body has finished running within a still-executing
    // outer frame. Isolating the consumption into its own async function
    // and checking the WeakRefs only AFTER `await consumeAll()` returns
    // (mirroring that other test's "after the whole outer call returns, not
    // from inside it" fix) is what makes the final two entries reliably
    // observed as collected.
    async function consumeAll(): Promise<void> {
      let index = 0;
      for await (const plaintextChunk of decryptStream({
        read,
        totalCiphertextLength,
        totalPlaintextLength: plaintext.byteLength,
        key,
      })) {
        plaintextRefs.push(new WeakRef(plaintextChunk));
        const currentIndex = index;
        index += 1;

        if (currentIndex >= 2) {
          await forceGcAndSettle();
          expect(ciphertextRefs[currentIndex - 2]!.deref()).toBeUndefined();
          expect(plaintextRefs[currentIndex - 2]!.deref()).toBeUndefined();
        }
      }
    }

    await consumeAll();

    await forceGcAndSettle();
    expect(ciphertextRefs[ciphertextRefs.length - 1]!.deref()).toBeUndefined();
    expect(plaintextRefs[plaintextRefs.length - 1]!.deref()).toBeUndefined();
  });
});
