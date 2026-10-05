# Arweave Streaming Upload — Project Design

## Problem

The current bundle-upload engine holds roughly the entire payload in
browser memory twice over — once as the individually-read files, once
again as the concatenated final buffer (`Buffer.concat` in
`packages/arweave-core/src/upload/bundle.ts`) — before it can be signed
or posted. A 1 GiB total-upload-size cap was added as a stopgap
(`packages/codex-arweave/src/panel/UploadWizard.tsx`) specifically
because this doesn't scale: the owner's actual near-term need is a
6.25 GB / 5,982-file NFT folder, and the honest answer worked out during
a long design conversation is that *no* fixed-size cap is the right
permanent architecture — someone always has more data than whatever
number is picked, and "works because the machine happens to have enough
RAM" is a coincidence, not a design.

Verified directly against the libraries already in this project (not
assumed) while shaping this: `arweave-js`'s own chunking/Merkle API
(`chunkData`, `generateTransactionChunks`, `computeRootHash`) requires a
fully-materialized `Uint8Array` — so the *library's convenience API*
can't stream, even though the underlying Arweave protocol itself
already works in 256 KB chunks at its core (that's what makes chunked,
resumable *posting* already possible today via `postArweaveData`'s
`ChunkedUploader`). The ceiling is in this project's own composition of
the library, not in the protocol.

## Approach

Replace in-memory bundle assembly with an OPFS-backed (Origin Private
File System — a standard, disk-backed, app-private browser storage API,
not JS heap) streaming pipeline, so peak memory stays bounded to
"roughly one chunk plus bookkeeping" regardless of whether the total
upload is 1 MB or 1 TB:

1. **Assemble the bundle incrementally, to OPFS, not to a JS buffer.**
   Process one file at a time: read it, sign its data item (via
   `arbundles`' standalone WebCrypto-only `sign()` — never the broken
   `DataItem.sign()`/`.rawId` path already fixed once this session for
   the in-memory case), write its signed bytes directly into an
   OPFS-backed file at the correct pre-computed offset, release the raw
   input. The manifest (which needs every file's final id) is built
   last, from the small id list already accumulated along the way — it
   never needed the bulk data itself.
2. **Compute the Arweave `data_root` (the Merkle root the protocol's
   256 KB chunking already requires) as a streaming pass**, reading the
   OPFS-backed bundle file 256 KB at a time: hash each chunk, keep only
   the ~32-byte hash, discard the chunk, accumulate leaves, build the
   tree from the (small) leaf-hash list. This is a from-scratch port of
   `arweave-js`'s own open-source `chunkData`/`generateLeaves`/
   `buildLayers` algorithm to a streaming input — reusing the documented
   algorithm, not inventing new cryptography, and verified byte-for-byte
   against the library's own buffer-based output on real fixtures
   (same root hash either way is the correctness bar).
3. **Sign the small signature-data structure** (the `data_root` + tx
   metadata, never the bulk bytes) — already cheap today, unchanged.
4. **Post via a chunk-source wrapper around the existing chunked
   uploader**, reading each chunk directly from the OPFS file by byte
   range at post time instead of slicing a pre-loaded buffer — the
   `postArweaveData`/`ChunkedUploader` retry-in-place behavior already
   built this session is preserved, just fed from disk instead of RAM.
5. **Resumability gets *better*, not harder, this way.** The assembled
   bundle already lives in OPFS (survives a tab close, crash, or
   reboot) and `arweave-js`'s own `TransactionUploader.toJSON()`/
   `fromSerialized()` already supports persisting+resuming chunk
   progress. Persist that small JSON state keyed to the OPFS file; a
   resumed upload reopens the same file and continues posting from
   wherever it left off — no re-reading the original folder, no redoing
   any signing.
6. **Graceful degradation when OPFS is unavailable** (older browsers,
   or a user's storage quota/permissions block it): fall back to
   today's in-memory path with its existing 1 GiB cap, never a silent
   failure — detect OPFS support up front and route accordingly.
7. **The 1 GiB cap is removed once this is verified**, replaced with
   whatever (if any) ceiling OPFS's own quota imposes in practice —
   ground this during implementation rather than assume a number.

## Acceptance criteria

- [ ] A streaming data_root computation produces byte-identical results
      to `arweave-js`'s own buffer-based `generateTransactionChunks` on
      the same input, verified across multiple real fixture sizes
      (including at least one spanning multiple 256 KB chunks and one
      exact-chunk-boundary edge case).
- [ ] Assembling and posting a bundle whose total size meaningfully
      exceeds any reasonable single-process heap budget (sized to
      prove the point, not to literally reproduce the owner's 6.25 GB
      case in CI) completes with bounded, roughly-constant peak memory
      — measured, not assumed.
- [ ] An upload interrupted mid-post (tab closed, network dropped) and
      resumed later continues from its last-known chunk rather than
      restarting, and never re-signs or re-reads the original source
      files.
- [ ] A real, visible, persistent progress indicator (not a value the
      user can accidentally dismiss and lose track of) reflects actual
      chunk/byte progress throughout.
- [ ] When OPFS is unavailable, the existing in-memory/1-GiB-capped path
      still works exactly as it does today — no regression, no silent
      failure.
- [ ] The 1 GiB cap is removed once the above is proven, replaced with
      an accurate, grounded (not guessed) ceiling if OPFS itself imposes
      one in practice.

## Out of scope

- Any change to the actual Arweave protocol-level posting mechanics
  beyond sourcing chunks from OPFS instead of memory — the wire
  format, the gateway API, the chunk size (256 KB) are all unchanged.
- Multi-bundle splitting of one logical upload — explicitly rejected
  during shaping in favor of keeping one atomic bundle/transaction per
  logical upload, now that true streaming removes the reason splitting
  was originally proposed.
- The Codex ID page, the migration sweep, and codex-upload
  seed-word-restore integration — separate, already-queued topics.

## Topics

Large enough to need splitting (the plan skill's own escalation
trigger) — four sub-topics, each independently buildable and testable,
sequenced because 2-4 build on 1, and 5 (UI) builds on all of them:

1. `arweave-streaming-data-root` — the streaming Merkle/data_root port,
   a pure, OPFS-independent algorithm (testable against any chunked
   byte source, not browser-dependent) verified byte-identical to
   `arweave-js`'s own buffer-based output. Foundational, build first.
2. `arweave-opfs-bundle-assembly` — incremental, OPFS-backed bundle
   construction (one file at a time, signed, written at the right
   offset) replacing the current hold-everything-then-concat path.
3. `arweave-streaming-post` — wiring the streaming data_root (1) and
   the OPFS-backed bundle (2) into transaction creation and a
   chunk-from-OPFS posting loop built on the existing `ChunkedUploader`,
   plus the resumable-state persistence (serialized uploader progress +
   the OPFS file surviving a reload).
4. `arweave-streaming-ui` — OPFS-support detection and fallback
   routing, the persistent progress UI, and removing the 1 GiB cap once
   1-3 are verified solid.

Topic 1 is shaped in full above and is the next one to plan and build.
