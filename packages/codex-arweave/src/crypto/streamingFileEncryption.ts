/**
 * The v2 chunked-AES-GCM streaming encrypt/decrypt primitives (T1,
 * `arweave-streaming-encryption`).
 *
 * SIBLING to `fileEncryption.ts`'s v1 whole-blob
 * `encryptWithDerivedKey`/`decryptWithDerivedKey` — NOT a replacement. v1
 * stays completely unchanged forever (every already-on-chain encrypted item
 * depends on it never changing); this module exists because v1's single
 * `crypto.subtle.encrypt`/`decrypt` call over an ENTIRE file's bytes is a
 * hard memory ceiling of its own, independent of the (already-solved)
 * bundle-assembly/posting ceiling the rest of this streaming-upload project
 * removed. Web Crypto's `AES-GCM` has no native incremental mode —
 * `crypto.subtle.encrypt`/`decrypt` always take one complete buffer and
 * produce one complete output — so this module applies the standard
 * chunked-AEAD pattern instead: encrypt fixed-size plaintext windows
 * independently, each under its own fresh IV and auth tag.
 *
 * KEY DERIVATION IS UNCHANGED — this module never derives its own key. The
 * SAME `deriveAccountAesKey` (`fileEncryption.ts`) is called once per upload
 * action by the caller, and the resulting `CryptoKey` is handed in here,
 * reused across every chunk of every file — chunking happens INSIDE one
 * file's encrypt/decrypt call sequence, not across the key-derivation
 * boundary.
 *
 * THE v2 ENVELOPE — per-chunk framing, no length-prefix needed: chunk `i`'s
 * ciphertext is `IV_i (12 bytes) ‖ AES-GCM(plaintext chunk i, key, IV_i) +
 * tag (16 bytes)`. Chunk boundaries are fully deterministic from the
 * ORIGINAL plaintext size (already known/tracked per file) and
 * {@link ENCRYPTION_CHUNK_SIZE} alone — chunk `i` covers plaintext bytes
 * `[i·C, min((i+1)·C, totalPlaintextLength))` — so no explicit length
 * framing travels in the stream; the decryptor computes the SAME boundaries
 * from the SAME two numbers (`totalPlaintextLength`, `ENCRYPTION_CHUNK_SIZE`)
 * and derives each chunk's ciphertext offset/length from them (every full
 * chunk's ciphertext is exactly 28 bytes — 12 IV + 16 GCM tag — larger than
 * its plaintext chunk).
 *
 * BOUNDARY RULE IS SIMPLER THAN `planChunkBoundaries.ts`'s (`arweave-core`,
 * read for style precedent, NOT imported — this package takes no direct
 * type/value dependency on `arweave-core`'s internals, mirroring
 * `buildStreamingChunkBody.ts`'s own `StreamingChunkMeta` convention of
 * locally duplicating a shape rather than importing it): that planner's
 * "rebalance a too-small final chunk" branch exists ONLY for Arweave-
 * protocol Merkle-interop reasons (`MIN_CHUNK_SIZE`) that do not apply here —
 * this is a purely internal framing with no protocol interop requirement, so
 * every chunk here is exactly `ENCRYPTION_CHUNK_SIZE` plaintext bytes except
 * the last, which is simply the remainder, however small (including, for a
 * 0-byte file, zero chunks at all — see {@link planEncryptionChunkBoundaries}
 * below for why that is the natural, not special-cased, result of the same
 * rule).
 *
 * FRESH RANDOM IV PER CHUNK (`crypto.getRandomValues`) — the IDENTICAL
 * "fresh random IV, every single encrypt call" rule `encryptWithDerivedKey`
 * already relies on today, just invoked once per chunk instead of once per
 * file. No counter-derived IVs, no new nonce-reuse risk: this is the same
 * audited rule applied more times.
 */

/** Plaintext chunk size — 256 KiB. A LOCAL constant, deliberately NOT
 *  importing `arweave-core`'s `MAX_CHUNK_SIZE`: the two numbers happen to
 *  match today but are independent constants in independent packages, each
 *  grounded on its own terms (this one has no Arweave-protocol Merkle
 *  interop requirement at all). */
export const ENCRYPTION_CHUNK_SIZE = 262_144;

/** AES-GCM IV length in bytes — matches `fileEncryption.ts`'s own
 *  `IV_BYTE_LENGTH` (96-bit GCM nonce, the standard size). */
const IV_BYTE_LENGTH = 12;

/** AES-GCM auth tag length in bytes — the fixed overhead WebCrypto's
 *  `AES-GCM` always appends to its ciphertext output. */
const GCM_TAG_BYTE_LENGTH = 16;

/** Per-chunk framing overhead: `IV (12) + tag (16)` — every full plaintext
 *  chunk's ciphertext is exactly this many bytes larger than the plaintext
 *  it was encrypted from. */
const FRAME_OVERHEAD_BYTES = IV_BYTE_LENGTH + GCM_TAG_BYTE_LENGTH;

/** Supplies exactly `length` bytes starting at `offset` — the streaming read
 *  seam this module reads through instead of requiring a resident buffer.
 *  A LOCAL type, duplicated rather than imported — mirrors
 *  `computeStreamingDataRoot.ts`'s own `ByteRangeReader` shape exactly
 *  (`arweave-core`), but kept local per this package's "no direct
 *  type/value dependency on arweave-core's internals" convention. */
export type ByteRangeReader = (offset: number, length: number) => Promise<Uint8Array>;

/** Writes `bytes` starting at `offset` — the streaming write seam this
 *  module writes through instead of accumulating the whole ciphertext in
 *  memory. A LOCAL type, mirroring `BundleAssemblyFile.write`'s own shape. */
export type ByteRangeWriter = (offset: number, bytes: Uint8Array) => Promise<void>;

/** One planned chunk's plaintext AND ciphertext byte ranges — computed
 *  purely from `totalPlaintextLength` and {@link ENCRYPTION_CHUNK_SIZE},
 *  never from actual byte content, so both {@link encryptStreamToFile} and
 *  {@link decryptStream} derive the IDENTICAL boundary list independently. */
interface EncryptionChunkBoundary {
  plaintextOffset: number;
  plaintextLength: number;
  ciphertextOffset: number;
  /** Always `plaintextLength + FRAME_OVERHEAD_BYTES` — the IV-prefixed,
   *  tag-suffixed framed chunk's total byte length. */
  ciphertextLength: number;
}

/**
 * Computes every chunk's plaintext/ciphertext byte ranges for a
 * `totalPlaintextLength`-byte file, without reading or requiring any of the
 * actual data — mirrors `planChunkBoundaries.ts`'s own pure, length-only
 * planner shape, but with the simpler boundary rule documented at the top of
 * this file (no tiny-final-chunk rebalancing).
 *
 * A 0-byte plaintext produces an EMPTY list (zero chunks), not one
 * zero-length chunk: the loop below only ever pushes a boundary while
 * `plaintextOffset < totalPlaintextLength`, which is never true when
 * `totalPlaintextLength === 0` — this is the natural result of the same
 * `[i·C, min((i+1)·C, totalSize))` rule, not a special case carved out for
 * it. `chunkCount = Math.ceil(totalPlaintextLength / ENCRYPTION_CHUNK_SIZE)`
 * holds for every length, including 0 (`Math.ceil(0 / C) === 0`).
 */
function planEncryptionChunkBoundaries(totalPlaintextLength: number): EncryptionChunkBoundary[] {
  const boundaries: EncryptionChunkBoundary[] = [];
  let plaintextOffset = 0;
  let ciphertextOffset = 0;

  while (plaintextOffset < totalPlaintextLength) {
    const plaintextLength = Math.min(ENCRYPTION_CHUNK_SIZE, totalPlaintextLength - plaintextOffset);
    const ciphertextLength = plaintextLength + FRAME_OVERHEAD_BYTES;

    boundaries.push({ plaintextOffset, plaintextLength, ciphertextOffset, ciphertextLength });

    plaintextOffset += plaintextLength;
    ciphertextOffset += ciphertextLength;
  }

  return boundaries;
}

/** The result of a successful {@link encryptStreamToFile} run. */
export interface EncryptStreamToFileResult {
  /** The total bytes written across every framed chunk — the file's final
   *  ciphertext size, exactly `totalPlaintextLength + chunkCount * 28`. */
  totalCiphertextLength: number;
  /** `Math.ceil(totalPlaintextLength / ENCRYPTION_CHUNK_SIZE)` — 0 for a
   *  0-byte plaintext (see {@link planEncryptionChunkBoundaries}). */
  chunkCount: number;
}

/**
 * Encrypts a `totalPlaintextLength`-byte plaintext source (read through
 * `read`, one {@link ENCRYPTION_CHUNK_SIZE} window at a time) under
 * `key`, writing each chunk's framed ciphertext (`IV ‖ ciphertext+tag`)
 * through `write` at its correct running ciphertext offset.
 *
 * Peak memory: at most one plaintext chunk + one ciphertext chunk resident
 * at once — each chunk's plaintext and ciphertext buffers are read/built,
 * written, and allowed to fall out of scope before the next chunk's `read`
 * call, never accumulated across iterations (verified structurally by this
 * module's own test via `WeakRef` + a forced GC, not assumed).
 */
export async function encryptStreamToFile(params: {
  read: ByteRangeReader;
  totalPlaintextLength: number;
  key: CryptoKey;
  write: ByteRangeWriter;
}): Promise<EncryptStreamToFileResult> {
  const { read, totalPlaintextLength, key, write } = params;
  const boundaries = planEncryptionChunkBoundaries(totalPlaintextLength);

  for (const { plaintextOffset, plaintextLength, ciphertextOffset } of boundaries) {
    const plaintextChunk = await read(plaintextOffset, plaintextLength);

    // Fresh random IV per chunk — the identical rule `encryptWithDerivedKey`
    // already relies on, invoked once per chunk instead of once per file.
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTE_LENGTH));
    // `ByteRangeReader`'s own return type is the plain, generic `Uint8Array`
    // this module's public API is specified against — the cast below only
    // asserts what every real caller (a fake test file, an OPFS read, a
    // browser `File` slice) actually hands back: an `ArrayBuffer`-backed
    // view, never a `SharedArrayBuffer`-backed one, which is what
    // `crypto.subtle`'s `BufferSource` parameter type actually requires.
    // Same cast convention `fileEncryption.ts` already uses for its own
    // WebCrypto call sites (`Uint8Array<ArrayBuffer>`).
    const encrypted = new Uint8Array(
      await globalThis.crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        plaintextChunk as Uint8Array<ArrayBuffer>,
      ),
    );

    const framedChunk = new Uint8Array(IV_BYTE_LENGTH + encrypted.byteLength);
    framedChunk.set(iv, 0);
    framedChunk.set(encrypted, IV_BYTE_LENGTH);

    await write(ciphertextOffset, framedChunk);
  }

  const totalCiphertextLength = totalPlaintextLength + boundaries.length * FRAME_OVERHEAD_BYTES;
  return { totalCiphertextLength, chunkCount: boundaries.length };
}

/**
 * Inverse of {@link encryptStreamToFile}: decrypts a stream previously
 * written by it, reading through `read` one framed chunk at a time and
 * `yield`ing plaintext chunks in order. Computes the SAME boundaries
 * {@link encryptStreamToFile} used, purely from `totalPlaintextLength` — no
 * length-prefix framing is ever read from the stream itself.
 *
 * `totalCiphertextLength` is cross-checked against the total the SAME
 * boundary computation implies (`totalPlaintextLength` bytes plus 28 bytes
 * of framing overhead per chunk): a mismatch means the caller handed in a
 * `totalCiphertextLength` that disagrees with `totalPlaintextLength` (e.g. a
 * truncated/corrupted file, or two values from different files), which is a
 * caller bug worth failing loudly on rather than silently reading past — or
 * short of — the real stream's end.
 *
 * A decrypt failure on any chunk (wrong key → WebCrypto's own
 * `OperationError`, from its AES-GCM auth-tag check) propagates UNMODIFIED —
 * never caught or reworded — and stops iteration there; no chunk after the
 * failing one is ever attempted, and the failing chunk itself is never
 * yielded (see the module-level test file's own documented wrong-key
 * behavior for the exact, verified "zero chunks yielded" outcome when every
 * chunk was encrypted under a different key).
 *
 * Peak memory: at most one ciphertext chunk + one plaintext chunk resident
 * at once, the same bound {@link encryptStreamToFile} holds (verified
 * structurally the same way).
 */
export async function* decryptStream(params: {
  read: ByteRangeReader;
  totalCiphertextLength: number;
  totalPlaintextLength: number;
  key: CryptoKey;
}): AsyncGenerator<Uint8Array> {
  const { read, totalCiphertextLength, totalPlaintextLength, key } = params;
  const boundaries = planEncryptionChunkBoundaries(totalPlaintextLength);

  const expectedTotalCiphertextLength = totalPlaintextLength + boundaries.length * FRAME_OVERHEAD_BYTES;
  if (totalCiphertextLength !== expectedTotalCiphertextLength) {
    throw new Error(
      `decryptStream: totalCiphertextLength (${totalCiphertextLength}) does not match the length ` +
        `implied by totalPlaintextLength (${totalPlaintextLength}): expected ` +
        `${expectedTotalCiphertextLength}`,
    );
  }

  for (const { ciphertextOffset, ciphertextLength } of boundaries) {
    const framedChunk = await read(ciphertextOffset, ciphertextLength);
    const iv = framedChunk.subarray(0, IV_BYTE_LENGTH);
    const ciphertext = framedChunk.subarray(IV_BYTE_LENGTH);

    // Same `ArrayBuffer`-backed cast as `encryptStreamToFile` above —
    // `framedChunk` ultimately comes from the same `ByteRangeReader`.
    // WebCrypto's own `OperationError` (auth-tag mismatch under the wrong
    // key) propagates unmodified — never caught/reworded here.
    const decrypted = await globalThis.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as Uint8Array<ArrayBuffer> },
      key,
      ciphertext as Uint8Array<ArrayBuffer>,
    );

    yield new Uint8Array(decrypted);
  }
}
