# Arweave Streaming Upload — How It's Built

A technical walkthrough of how Codex uploads files of **arbitrary size** to
Arweave — public or encrypted, one file or thousands — without ever holding
the whole payload in memory, how an interrupted upload survives and
resumes, how the whole thing runs safely off the UI thread, and how you can
test a real upload without spending real AR or touching the real network.

This document explains the **system that exists today**, for anyone
extending it, auditing it, or just trying to understand what happens when
a user drags a folder into the Upload Wizard and clicks a button. It is not
a historical build log — see each package's own `CHANGELOG.md` for that.

## The problem this solves

Arweave's wire protocol has always worked in bounded 256 KiB chunks under
the hood — that's what makes chunked, resumable *posting* possible at all.
But the convenience libraries built on top of it (`arweave-js`'s own
`chunkData`/`generateTransactionChunks`, and this codebase's first upload
engine) require the **entire payload in memory as one buffer** before they
can even start: once to read every file, again to concatenate them into a
final bundle, and again (encrypted uploads) to hold the base64-and-encrypted
copy. For a few megabytes this is invisible. For a 6 GB NFT-image folder,
it reliably crashes the tab.

The fix is not a bigger cap — someone always has more data than whatever
number gets picked. The fix is a pipeline that never holds more than
"roughly one 256 KiB chunk, plus bookkeeping" in memory, regardless of
whether the total upload is 1 MB or 1 TB.

## The three packages involved

| Package | Role |
| --- | --- |
| `@ancientpantheon/arweave-core` | Framework-agnostic Arweave protocol primitives. Owns the Merkle/chunking math and transaction creation — anything that needs the real `arweave` library. |
| `@ancientpantheon/codex-arweave` (private, bundled into `codex`) | The Codex-specific orchestration: OPFS file I/O, chunked encryption, the resumable post loop, the Worker wiring, and the `UploadWizard` UI. |
| `apps/codex-playground` (sample host app) | Where the real signing key (`jwk`), the `LibraryStore`, and the `GatewayPool` actually live, and where the real `Worker` gets constructed. `UploadWizard` itself never touches any of these directly — see "Why the host app, not the UI component" below. |

## The pipeline, top to bottom

A real upload — public or encrypted, one file or a thousand-file bundle —
goes through five stages, each one bounded-memory by construction:

```
1. ASSEMBLE   →  2. ENCRYPT (optional)  →  3. data_root  →  4. POST  →  5. (resume if interrupted)
   one file          one 256 KiB             streaming        one 256 KiB    pick up from the
   at a time,         chunk at a              Merkle pass      chunk at a     last checkpointed
   signed, written    time, written            over the         time, from     chunk — never
   to an OPFS file     to the same              OPFS file        the OPFS       re-signs, never
   at its offset        OPFS file                                 file          re-reads, never
                                                                                 re-posts
```

All of this runs inside a dedicated Web Worker, not the main UI thread —
more on why below.

### 1. Assembling the bundle — `codex-arweave/src/library/streaming/`

- **`bundleAssemblyFile.ts`** — the raw file I/O seam. `BundleAssemblyFile`
  is a tiny interface (`write(offset, bytes)` / `read(offset, length)` /
  `close()`) backed for real by the Origin Private File System (OPFS) —
  `navigator.storage.getDirectory()` → a real file handle → a real
  `FileSystemSyncAccessHandle`. A `FakeBundleAssemblyFile` (in-memory,
  `fakeBundleAssemblyFile.ts`) implements the same interface for Node-side
  tests.
- **`assembleBundleToFile.ts`** — the per-file loop. For each file: reads it
  (optionally through the chunked encryptor below), signs it as an ANS-104
  data item via `arbundles`, and writes the signed bytes directly into the
  OPFS file at the correct running offset — then discards that file's bytes
  before moving to the next one. The manifest (which needs every file's
  final id) is built last, from the small id list accumulated along the
  way; it never needed the bulk data itself.

Peak memory for this stage: one file's bytes, not the whole bundle's.

### 2. Streaming encryption (only for encrypted uploads) — `crypto/streamingFileEncryption.ts`

The original (and still-default-for-small-items) encryption scheme
base64-encodes an entire file, then runs one `crypto.subtle.encrypt` call
over the whole thing — a second full-payload memory ceiling, independent of
the assembly one above. `streamingFileEncryption.ts` adds a **chunked**
sibling:

- **`ENCRYPTION_CHUNK_SIZE = 262144`** (256 KiB) — an independent constant
  from the protocol's own chunk size; the two never need to align, since the
  outer Merkle chunking (stage 3) operates on whatever final bytes end up in
  the OPFS file, with no awareness of what they represent.
- **Per-chunk framing**: `IV (12 bytes) ‖ ciphertext+tag (16 bytes)`, a
  fresh random IV per chunk (the same "always a fresh IV" rule the original
  scheme already used, just called more often). No length-prefix needed —
  chunk boundaries are deterministic from `(totalPlaintextLength,
  ENCRYPTION_CHUNK_SIZE)` alone.
- **`encryptStreamToFile`** reads one plaintext chunk, encrypts it, writes
  the ciphertext chunk straight into the OPFS bundle file, discards both
  buffers, repeats — never more than one chunk's plaintext + one chunk's
  ciphertext resident at once.
- **`decryptStream`** is the mirror — needed not just for eventually
  downloading large files, but because it's how the dry-run feature (stage
  6 below) proves an upload's own ciphertext actually decrypts back to the
  original bytes.
- **Versioning**: every encrypted upload carries a `Codex-Encryption-Version`
  tag (see `ARWEAVE_TAG_SCHEMA.md`). The chunked scheme is version `"2"`;
  the original whole-file scheme stays `"1"` forever, untouched, so every
  already-on-chain encrypted item keeps decrypting exactly as it always has.
  A decrypt path checks this tag and picks the matching algorithm — it is
  never guessed from the ciphertext's shape.

### 3. The streaming `data_root` — `arweave-core/src/upload/streaming/`

Arweave's own protocol is a Merkle tree over 256 KiB chunks; the
`data_root` is that tree's root hash, and it's what actually gets signed
into the transaction. `arweave-js`'s own implementation requires a
full in-memory buffer to compute it.

- **`planChunkBoundaries.ts`** — a pure function, `(totalLength) →
  ChunkBoundary[]`. Reimplements `arweave-js`'s exact chunking rule
  (including its "rebalance a too-small final chunk" branch) from nothing
  but a total byte count — no I/O.
- **`computeStreamingDataRoot.ts`** — given a `(offset, length) →
  Promise<Uint8Array>` reader and a total length, reads and hashes one
  chunk at a time (reusing `arweave-js`'s own `generateLeaves`/`buildLayers`/
  `crypto.hash` — the only *new* code is "read on demand instead of slicing
  a resident buffer"), discards each chunk after hashing it, and returns the
  same `{ data_root, chunks, proofs }` shape `generateTransactionChunks`
  would have produced from a full buffer.

Verified, in both packages' test suites, **byte-identical** to the real
`arweave-js` output across every edge case (empty input, exact chunk
multiples, the rebalancing branch, large multi-chunk composites) — this is
the correctness bar that makes everything built on top of it trustworthy.

### 4. Posting — `createStreamingTransaction.ts` + `streamingPost.ts`

- **`createStreamingTransaction`** (arweave-core) builds and signs a real
  `arweave-js` `Transaction` directly from the already-computed
  `data_root` — the transaction's own `data` field stays an empty buffer
  the whole time; only the small `data_root`/`data_size`/tags/owner
  structure ever gets hashed and signed.
- **`buildStreamingChunkBody.ts`** (codex-arweave) builds one chunk's POST
  body (`data_root`, `data_size`, `data_path`, `offset`, `chunk`) by reading
  exactly that chunk's bytes from the OPFS file — proven byte-identical to
  what the real, non-streaming `TransactionUploader.getChunk()` would
  produce for the same logical chunk.
- **`streamingPost.ts`**'s `streamingPostBundle` posts the transaction, then
  every chunk in order, retrying a failed chunk in place up to a fixed
  retry count before giving up.

### 5. Resumability — `streamingPostResumeStore.ts` + `resumeStreamingPost`

After the transaction posts, and after **every** successfully-posted chunk,
a small checkpoint (`{ chunkIndex, txPosted, tx fields, chunk metadata }`)
is written to a real IndexedDB-backed store (`StreamingPostResumeStore`,
mirroring the same pattern this codebase already uses elsewhere for
IndexedDB-backed state). If the upload is interrupted — tab closed, laptop
lid shut, connection dropped — `resumeStreamingPost(id, pool, opts)`:

1. Loads the persisted checkpoint.
2. Reopens the **same** OPFS file by its persisted name.
3. Reconstructs the already-signed transaction directly from the persisted
   fields — **no re-signing, no re-reading the original source files.**
4. Continues posting from the persisted `chunkIndex` — never re-posting an
   already-successful chunk.

On full completion, both the OPFS file and the resume record are deleted.

## Why a dedicated Worker, and why the host app wires it (not `UploadWizard`)

`FileSystemFileHandle.createSyncAccessHandle()` — the primitive the whole
OPFS layer above depends on — **only works inside a dedicated Worker**, by
browser spec. Calling it from the main document thread throws. This was
discovered the hard way: the first version of this pipeline was fully
built and unit-tested, but when actually driven in a real browser, every
real upload was silently still taking the old capped fallback path, because
the OPFS-support probe always failed on the main thread.

The fix: `library/streaming/uploadWorker.ts` is a thin Worker entry point
(it installs a `Buffer` polyfill the Worker's own global scope doesn't
otherwise have, then calls into the exact same tested upload logic every
other caller uses) and `library/streaming/StreamingUploadRunner.ts` is the
main-thread seam that talks to it — `postMessage`s the upload request in,
listens for `route`/`progress`/`done`/`error` messages back out. This
mirrors a pattern already established elsewhere in this codebase for
off-main-thread key generation (`keygen/worker.ts` + `KeygenRunner.ts`).

**`UploadWizard.tsx` itself never constructs a Worker, never touches a real
signing key, and never holds a `LibraryStore`/`GatewayPool` of its own** —
it's a pure, host-injected-callback component (the same architectural rule
this whole app follows: a UI component describes *what* should happen, the
host app provides *how*). The real wiring — decrypting the signing key,
constructing the real `StreamingUploadRunner`, routing progress/route
callbacks back up to the UI — lives in the host app's own adapter
(`apps/codex-playground/src/realArweaveAdapter.ts`'s `uploadAndTrack`/
`uploadFilesAndTrack`/`runDryRunUpload` closures). A different host app
wires its own equivalent of that adapter; `UploadWizard` stays reusable.

## The "Test this upload" feature (dry run)

A second button next to the real Confirm button: **"Test this upload (free
— runs locally, nothing is sent to Arweave)."** This exists so a real,
possibly multi-gigabyte upload can be proven correct *before* spending real
AR or risking a failed multi-hour upload.

- **`arweave-core/src/upload/localDryRunGateway.ts`** — a shippable
  (production code, not test-only) stand-in gateway. Implements the exact
  same `UploadGatewayApiFactory`/`StreamingUploadGatewayApiFactory`
  contracts a real gateway satisfies, captures every posted
  transaction/chunk in memory **keyed by the chunk's own real `offset`**
  (matching how a real gateway addresses chunks — so a retried POST to an
  already-accepted offset is correctly treated as the harmless no-op it
  actually is, not a duplicate), and never makes a single network call —
  structurally proven (no `fetch`, no `Api` import, anywhere in the file).
- **`codex-arweave/src/library/streaming/dryRunUpload.ts`**'s
  `runUploadDryRun` runs a real upload through the real engine — real OPFS
  assembly, real chunked encryption, real streaming `data_root`, real post
  loop — against that local gateway instead of a real one. It deliberately
  interrupts itself after a few chunks and calls the real
  `resumeStreamingPost` to prove resumability actually works, then
  self-verifies independently of trusting this codebase's own correctness:
  every posted chunk's Merkle proof is checked via `arweave-js`'s own
  `validatePath` (not this project's code), and an encrypted file's
  captured ciphertext is decrypted back and compared byte-for-byte to the
  original. It never calls into the real `LibraryStore` — a dry run cannot
  leave any trace in your actual upload history.
- The UI renders the result in a panel that's structurally separate from
  the real upload's progress/success state — a dry-run result can never be
  mistaken for a completed real upload.

## When the engine doesn't apply

If `isStreamingUploadSupported()` — a real functional probe (open a
throwaway OPFS file, actually try the Worker-only primitive, not just check
whether a method name exists) — resolves `false` (an older browser, a
sandboxed/private-browsing context that denies storage access), the whole
upload action falls back to the original, fully-in-memory path, with an
explicit, honestly-worded size ceiling (2 GiB) and a UI message explaining
why. This is a deliberate choice: a user on an unsupported browser gets a
working, if size-limited, upload rather than a confusing failure.

## File map

```
packages/arweave-core/src/upload/
  streaming/
    planChunkBoundaries.ts        pure chunk-boundary math
    computeStreamingDataRoot.ts   streaming Merkle data_root
    createStreamingTransaction.ts transaction creation + gateway-post seam
  localDryRunGateway.ts           shippable local/no-op gateway

packages/codex-arweave/src/
  crypto/
    fileEncryption.ts             original whole-file AES-GCM (v1, untouched)
    streamingFileEncryption.ts    chunked AES-GCM (v2)
  library/
    flow.ts                       uploadAndTrack / performUploadAndTrack / resolveEncryptionKey
    streaming/
      bundleAssemblyFile.ts       OPFS file I/O seam (+ fakeBundleAssemblyFile.ts for tests)
      assembleBundleToFile.ts     per-file assembly + optional chunked encryption
      buildStreamingChunkBody.ts  one chunk's POST body
      streamingPost.ts            streamingPostBundle / resumeStreamingPost
      streamingPostResumeStore.ts IndexedDB-backed checkpoint store
      isStreamingUploadSupported.ts  real OPFS-support probe
      uploadBundleStreaming.ts    drop-in streaming replacement for uploadBundle/uploadData
      uploadWorker.ts             the thin Worker entry point
      StreamingUploadRunner.ts    the main-thread Worker-talking seam
      dryRunUpload.ts             the "Test this upload" engine
      dryRunWorker.ts / StreamingDryRunRunner.ts   the dry run's own Worker wiring
    panel/
      UploadWizard.tsx            the UI: Confirm + Test buttons, progress, disclaimer

apps/codex-playground/src/
  realArweaveAdapter.ts           the real host-app wiring (jwk, store, pool, the real Worker)
```

## Known limitations

- **Downloading/viewing a large uploaded item is not streaming.** This
  whole effort covers *upload* only; `LibraryArea.tsx`'s download path
  still fetches a full response into memory before decrypting/displaying
  it. A genuinely large downloaded item needs its own future streaming
  pass — a separate, not-yet-started project.
- **The streaming engine's internal upload id is not yet guaranteed to
  match the real on-chain `Codex-Upload-Id` tag** in every case (a known,
  flagged gap from `assembleBundleToFile` not yet exposing that value
  externally). Doesn't affect normal upload or dry-run behavior; would
  matter if a future "rebuild Library from chain" pass needs to correlate
  a streaming-engine upload by that specific id.
- **Peak memory and throughput at true multi-gigabyte scale** are proven
  bounded/healthy up to the scales actually driven in a real browser during
  development (hundreds of megabytes, with linear, non-degrading
  throughput) — not yet independently re-measured at the full multi-gigabyte
  scale that originally motivated this project. The architecture gives no
  reason to expect different behavior at larger scale (nothing in the
  pipeline holds more than one chunk resident regardless of total size),
  but "give it no reason to break" is not the same claim as "measured at
  that exact scale" — worth a real run before trusting it with the largest
  real-world uploads.

## How two real bugs were found and fixed here

Worth knowing, as a model for how to trust (or re-verify) any part of this
system: the dry-run feature's first real-browser run reported a failure —
a resumed multi-file bundle appeared corrupted. A rigorous, evidence-based
debug investigation (reproduce → rank hypotheses → test cheapest-first →
build a verified evidence chain → fix at the proven root cause → regression
test that fails before the fix and passes after) found the **real upload
engine was never broken** — the corruption was in the dry-run's own
gateway stand-in, which recorded posted chunks by arrival order instead of
by their real `offset`, so a harmless retried chunk POST (idempotent on a
real gateway) got miscounted as a duplicate. Fixed in
`localDryRunGateway.ts`, with a regression test that reproduces the
original symptom and real-browser re-verification at the original
bug-report's scale.

That same investigation surfaced a second, independent, genuinely real bug:
`streamingPost.ts`'s checkpoint-save could, in a narrow timing window,
regress backward on a network-level retry — fixed with a monotonicity
guard at the checkpoint-write site, also independently verified with its
own regression test.

Both are reflected in this package's `CHANGELOG.md`. The lesson generalizes:
when this pipeline's *test tooling* disagrees with the pipeline itself,
don't assume the simpler-looking explanation (the production code is
broken) — verify which one is actually wrong before fixing anything.
