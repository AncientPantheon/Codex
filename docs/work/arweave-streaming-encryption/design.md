# Arweave Streaming Encryption — Project Design

## Problem

`arweave-streaming-upload`'s first three sub-topics (data_root, OPFS bundle
assembly, streaming post + resume — all complete) removed the memory ceiling
for the *unencrypted* upload path. They did not touch encryption, and
grounding this directly against the real code (`packages/codex-arweave/src/
library/flow.ts`'s `uploadAndTrack`) shows encryption is still a hard,
separate memory ceiling of its own:

```
uploadAndTrack → encryptFileForUpload(file.data, encryptionKey)   // PER FILE
```

`encryptFileForUpload` (`flow.ts`) and the primitive it calls,
`encryptWithDerivedKey` (`crypto/fileEncryption.ts`), are both single-shot:
the WHOLE file is base64-encoded to a string (1.33x size blowup), UTF-8
re-encoded, and handed to ONE `crypto.subtle.encrypt({name: "AES-GCM"}, key,
wholeBuffer)` call. This happens for EVERY file of an encrypted upload,
BEFORE `uploadBundle`/the streaming engine is ever reached — so even once
the bundle-assembly and posting stages stream perfectly, an encrypted
upload still fully materializes (at ~1.33x size) in browser memory at this
one step. The owner has explicitly decided (2026-10-03) that **both
encrypted and unencrypted uploads must use the new arbitrary-size method** —
so this ceiling has to go too, not be carved out as a permanent exception.

The Web Crypto API's `AES-GCM` has no native incremental/streaming mode —
`crypto.subtle.encrypt`/`decrypt` always take one complete buffer and
produce one complete output. Chunked-AEAD (independently encrypting
fixed-size plaintext chunks, each with its own IV and auth tag) is the
standard, well-understood way around this (the same shape Web-standard
streaming encryption schemes like `age`'s STREAM construction and TLS's
record layer use) — not a novel scheme, a standard pattern applied to this
codebase's existing primitive.

## Grounding (read directly from the real code, not assumed)

- **Current envelope** (`fileEncryption.ts` + `flow.ts`'s
  `encryptFileForUpload`): `base64(plaintext)` → UTF-8 bytes → one AES-256-GCM
  encrypt call with a fresh random 12-byte IV → `IV (12 bytes) ‖ ciphertext+tag`.
  Key is PBKDF2-SHA512/600k-iterations, derived ONCE per upload action from
  the encryptor Ouronet account's canonical bitstring, salted
  deterministically from that same bitstring (so re-deriving later for
  decryption reproduces the identical key with no side-channel salt storage).
- **Current decrypt path** (`LibraryArea.tsx`'s `downloadEntry`): fetches the
  ENTIRE gateway response into memory (`response.arrayBuffer()`) regardless
  of encryption, then for encrypted entries: strip the 12-byte IV prefix,
  one-shot `decryptWithDerivedKey`, UTF-8-decode, base64-decode. This is
  gated on the `Codex-Encrypted` tag; the base64 round-trip is a property of
  THIS envelope only (confirmed: unencrypted downloads never touch
  `base64ToBytes`), not a general content convention — a new envelope is
  free to drop it.
- **Versioning is already wired for exactly this**: every encrypted upload
  is tagged `Codex-Encryption-Version` (`TAG_CODEX_ENCRYPTION_VERSION`,
  `arweave-core/src/upload/tags.ts`), currently always
  `CODEX_ENCRYPTION_VERSION_CURRENT = "1"`. This project bumps that constant
  to `"2"` for newly-encrypted uploads and adds a version-gated branch in the
  decrypt path — `"1"` keeps decrypting via the existing whole-blob method
  forever (every already-uploaded encrypted item on real Arweave is
  permanent and immutable; it must never need re-encryption). This is the
  same "always support back tag versions" discipline this whole project has
  followed for every other tag.
- **No merkle/encryption-chunk alignment needed.** The outer Arweave-protocol
  Merkle chunking (`arweave-core`'s `planChunkBoundaries`/
  `computeStreamingDataRoot`, fixed at the protocol's own 256 KiB) operates
  on the FINAL ciphertext bytes sitting in the OPFS bundle file — it has no
  awareness of what those bytes represent. The encryption layer can pick its
  own independent chunk size; the two layers only ever interact through "a
  sequence of bytes at a known offset in an OPFS file," which is already
  `assembleBundleToFile`'s existing contract.

## Approach

### The v2 chunked envelope

- **Plaintext chunk size**: a new module-level constant, e.g.
  `ENCRYPTION_CHUNK_SIZE = 262_144` (256 KiB — matches `arweave-core`'s own
  `MAX_CHUNK_SIZE` purely for one-bookkeeping-unit-to-reason-about
  consistency across the codebase; the two are independent constants in
  independent packages and must each be grounded/confirmed at build time,
  not assumed equal by convention alone).
- **Per-chunk framing, no length-prefix needed**: chunk `i`'s ciphertext is
  `IV_i (12 bytes) ‖ AES-GCM(plaintext chunk i, key, IV_i)+tag (16 bytes)`.
  Chunk boundaries are fully deterministic from the ORIGINAT plaintext size
  (already known/tracked per file) and the fixed chunk size — `chunk i`
  covers plaintext bytes `[i·C, min((i+1)·C, totalSize))` — so no explicit
  length framing needs to travel in the stream; the decryptor computes the
  same boundaries from the same two numbers. Each ciphertext chunk is
  therefore exactly `28 bytes` larger than its plaintext chunk (12 IV + 16
  tag), a known, computable total-size expansion with zero base64 blowup
  (a real size/cost improvdment over v1, not just a parity feature).
- **Fresh random IV per chunk** (`crypto.getRandomValues`), exactly the
  existing precedent in `encryptWithDerivedKey` — just invoked once per
  chunk instead of once per file. No counter-derived IVs, no new nonce-reuse
  risk analysis needed: this is the identical "fresh random IV, every
  single encrypt call" rule already audited and relied on today, applied
  more times.
- **Key derivation is UNCHANGED** — `deriveAccountAesKey` already runs once
  per upload action, already the correct scope (chunking happens inside one
  file's one `encryptWithDerivedKey`-family call sequence, not across the
  key-derivation boundary).

### Streaming encrypt (upload side)

A new function, `encryptStreamToFile(reader, writer, key, opts)` (exact
name/shape decided at planning time): reads the plaintext source (a `File`
via `.slice()`/`.stream()`, or any `ByteRangeReader`-shaped seam matching the
convention `computeStreamingDataRoot` already established) one
`ENCRYPTION_CHUNK_SIZE` window at a time, encrypts each chunk, writes the
`IV ‖ ciphertext+tag` bytes directly into the OPFS bundle file at the
correct running offset via the existing `BundleAssemblyFile.write(offset,
bytes)` seam from `arweave-opfs-bundle-assembly`. Peak memory per file: one
plaintext chunk + one ciphertext chunk, not the whole file — the same
"roughly one chunk plus bookkeeping" bound the rest of this project already
achieves. This slots into `assembleBundleToFile`'s existing per-file loop as
an optional encrypt-then-write step instead of a direct write, gated on
whether this upload action is encrypted.

### Streaming decrypt (needed for THIS project's own correctness proof, and
for any future download-side streaming work — see Out of scope)

A new function, `decryptStreamFromFile(reader, key, totalCiphertextLen,
originalPlaintextLen) → AsyncIterable<Uint8Array>` (or equivalent): computes
the same chunk boundaries from `originalPlaintextLen`, reads each
`IV ‖ ciphertext+tag` chunk, decrypts, yields plaintext chunks in order. This
is REQUIRED scope here (not deferred) because the owner explicitly wants an
offline way to prove the whole pipeline is correct before trusting it with a
real multi-gigabyte upload (`arweave-upload-dry-run`) — that proof is only
real if it decrypts its own output back to the exact original bytes, chunk
by chunk, the same way a real future download would.

### What does NOT change in this sub-topic

- `fileEncryption.ts`'s existing `deriveAccountAesKey`/
  `encryptWithDerivedKey`/`decryptWithDerivedKey` (v1, whole-blob) are left
  completely alone — new v2 chunked functions are added alongside, not a
  replacement. Every already-uploaded encrypted item keeps decrypting via
  the unchanged v1 path forever.
- The real-world DOWNLOAD UI (`LibraryArea.tsx`'s `downloadEntry`) is **not**
  updated to stream in this sub-topic — seeing/downloading a large item
  (encrypted or not) still fetches the whole response into memory today.
  This is a real, separate gap, explicitly out of scope here (see below) —
  flagged honestly rather than silently left unnoticed.

## Acceptance criteria

- [ ] A streaming-encrypted file's chunks, decrypted via the new streaming
      decrypt function and concatenated in order, are byte-identical to the
      original plaintext — verified on fixtures spanning 0 bytes, a partial
      final chunk, an exact chunk-boundary multiple, and a multi-chunk size,
      the same fixture-size discipline every prior sub-topic in this project
      used.
- [ ] Decrypting with a key derived from the WRONG bitstring fails loudly
      (the existing AES-GCM auth-tag behavior) on EVERY chunk it's tried
      against, never silently returns garbage for some chunks and not
      others.
- [ ] Peak memory during streaming-encrypt of a large fixture stays bounded
      to "roughly one chunk," measured, not assumed — same bar
      `arweave-opfs-bundle-assembly` already met for assembly itself.
- [ ] `Codex-Encryption-Version` is `"2"` for every NEWLY uploaded encrypted
      item once this ships; items already on-chain under `"1"` are provably
      unaffected (no code path changes their expected decrypt behavior).
- [ ] A real-browser check (same throwaway-CDP-script convention already
      used three times this project) proves the real WebCrypto
      `crypto.subtle` chunk-by-chunk encrypt/decrypt round-trip works
      end-to-end against a real OPFS-backed file, not just under Node/jsdom.

## Out of scope

- Updating `LibraryArea.tsx`'s download/view path to stream large
  (encrypted or plain) files — a real, separate gap this design surfaces but
  does not close. Flagged for a future sub-topic once upload-side streaming
  ships; large uploaded items remain full-memory-load-to-view until then.
- Any change to the v1 whole-blob envelope, its tag value, or any
  already-on-chain encrypted item's decrypt behavior.
- Re-deriving or rotating the PBKDF2/AES-GCM key-derivation scheme itself —
  only the per-file chunking of how an already-derived key is *used*
  changes.
