## Wave 1

- [x] T1: The pure chunked-AES-GCM streaming encrypt/decrypt primitives.
      Read `packages/codex-arweave/src/crypto/fileEncryption.ts` in full
      first — do NOT modify it; this task ADDS a sibling v2 module, the v1
      whole-blob functions stay untouched forever (every already-on-chain
      encrypted item depends on v1 never changing). Read
      `docs/work/arweave-streaming-encryption/design.md` in full for the
      exact envelope shape (per-chunk `IV(12) ‖ ciphertext+tag(16)`,
      boundaries computed from `(totalPlaintextLength, chunkSize)`, no
      length-prefix framing, fresh random IV per chunk via
      `crypto.getRandomValues` — identical precedent to v1, just called
      once per chunk instead of once per file).

      Also read `packages/arweave-core/src/upload/streaming/
      planChunkBoundaries.ts` for the exact style of a pure,
      length-only boundary planner (reuse the SHAPE of that approach for
      computing this module's own chunk boundaries — note this module's
      own boundary rule is SIMPLER than that one's: no Arweave-protocol
      "rebalance tiny final chunk" rule applies here, since this is a
      purely internal framing with no protocol interop requirement; every
      chunk is exactly `ENCRYPTION_CHUNK_SIZE` except the last, which is
      the remainder, however small — do not port the rebalancing branch).

      Define and export (exact names are your call, keep them close to
      these):
      - `ENCRYPTION_CHUNK_SIZE` (256 KiB = 262144 — a LOCAL constant in
        this new module; do not import `arweave-core`'s `MAX_CHUNK_SIZE`,
        the two are independent numbers that happen to match today,
        matching the established "codex-arweave does not take a direct
        type/value dependency on arweave-core's internals" convention).
      - A local `ByteRangeReader`-shaped type (mirror
        `computeStreamingDataRoot.ts`'s own shape: `(offset, length) =>
        Promise<Uint8Array>`) and a local `ByteRangeWriter`-shaped type
        (mirror `BundleAssemblyFile.write`'s shape: `(offset, bytes) =>
        Promise<void>`) — both duplicated locally rather than imported,
        same convention `buildStreamingChunkBody.ts`'s `StreamingChunkMeta`
        already established for exactly this reason.
      - `encryptStreamToFile(params: { read: ByteRangeReader;
        totalPlaintextLength: number; key: CryptoKey; write:
        ByteRangeWriter }): Promise<{ totalCiphertextLength: number;
        chunkCount: number }>` — reads one plaintext chunk at a time via
        `read`, encrypts it (fresh IV per chunk), writes the framed
        ciphertext chunk via `write` at the correct running ciphertext
        offset, discards the plaintext/ciphertext chunk before reading the
        next. Never holds more than one chunk's plaintext and one chunk's
        ciphertext in memory at once.
      - `decryptStream(params: { read: ByteRangeReader;
        totalCiphertextLength: number; totalPlaintextLength: number; key:
        CryptoKey }): AsyncGenerator<Uint8Array>` — computes the same
        boundaries from `totalPlaintextLength`, reads and decrypts one
        framed chunk at a time, yields plaintext chunks in order. A
        decrypt failure (wrong key) on any chunk throws (propagate
        WebCrypto's own `OperationError`, do not catch/reword it) and
        stops iteration there.

      Follow TDD, strictly: write the failing tests FIRST in
      `packages/codex-arweave/tests/streaming-file-encryption.test.ts`
      (new file, matches this package's existing flat `tests/` convention
      — see `tests/crypto-file-encryption.test.ts` for the v1 module's own
      test style/fixture conventions to mirror). Required cases, each
      against a REAL `CryptoKey` (derive one via the real, unmodified
      `deriveAccountAesKey` from a fixed test bitstring — do not mock
      WebCrypto):
      - Round-trip byte-identical for fixture plaintext lengths: 0,
        1 byte, `ENCRYPTION_CHUNK_SIZE - 1`, exactly
        `ENCRYPTION_CHUNK_SIZE`, `ENCRYPTION_CHUNK_SIZE + 1`, and a
        multi-chunk composite (e.g. `3 * ENCRYPTION_CHUNK_SIZE + 1000`) —
        encrypt via `encryptStreamToFile` into a fake in-memory
        byte-array-backed reader/writer pair, then decrypt via
        `decryptStream` and concatenate every yielded chunk; assert
        byte-identical to the original plaintext fixture, for every size.
      - `chunkCount` matches `Math.ceil(totalPlaintextLength /
        ENCRYPTION_CHUNK_SIZE)` (with the 0-byte case asserted explicitly
        — document what 0 bytes produces: either 0 chunks or 1
        zero-length chunk, your call, but assert it precisely either way).
      - Decrypting with a key derived from a DIFFERENT bitstring throws on
        the FIRST chunk it tries to decrypt (assert the throw, and that no
        prior successfully-decrypted chunks were already yielded before
        the throw if your generator yields eagerly — document whichever
        is actually true).
      - The `write` callback is NEVER asked to write more than one
        chunk's worth of ciphertext bytes in a single call (structural
        assertion via a spy, same technique `computeStreamingDataRoot`'s
        own tests used for its reader).
      - Peak-memory-bounded structural proof: same `WeakRef` + exposed-`gc`
        technique `streaming-assemble-bundle-to-file.test.ts` already
        established in this package (read that file's test for the exact
        mechanics and the V8 same-iteration-binding nuance it already
        documents) — prove a plaintext/ciphertext chunk buffer from
        iteration N is garbage-collectable before iteration N+2 starts,
        across a multi-chunk fixture.

      Confirm every new test fails first for the right reason (missing
      module), then implement, then confirm green.

      Done when: round-trip correctness is proven byte-exact across every
      fixture size including the 0-byte and partial-final-chunk edges,
      wrong-key failure is proven loud and immediate, and the
      one-chunk-at-a-time memory bound is structurally proven, not
      assumed — all via real WebCrypto (`globalThis.crypto.subtle`), never
      mocked.
  - files: `packages/codex-arweave/src/crypto/streamingFileEncryption.ts`
    (new), `packages/codex-arweave/tests/streaming-file-encryption.test.ts`
    (new)

## Wave 2 (depends on Wave 1)

- [x] T2: Wire the v2 envelope into the streaming bundle-assembly pipeline,
      and bump the on-chain version tag. Read
      `packages/codex-arweave/src/library/streaming/assembleBundleToFile.ts`
      in full first — the existing per-file loop this task adds an
      OPTIONAL encrypt-then-write step to (gated on whether this upload
      action is encrypted), without changing its unencrypted behavior at
      all. Also read `packages/codex-arweave/src/library/flow.ts`'s
      `uploadAndTrack`/`encryptFileForUpload` call sites (T2 of
      `arweave-streaming-ui`, built separately, is what will actually
      ROUTE real uploads through this — your job here is making the
      capability exist and be correct in isolation, not wiring the real
      UI/flow.ts call sites; confirm this scope boundary against
      `arweave-streaming-ui`'s plan if it already exists by the time you
      start, and flag explicitly if the boundary is unclear).

      Add an optional `encryption?: { key: CryptoKey }` parameter to
      `assembleBundleToFile`'s params (exact shape is your call — keep it
      narrow and additive, the unencrypted call shape must not change).
      When present, each file's bytes are read via T1's chunked
      `encryptStreamToFile` (ciphertext written to the OPFS bundle file)
      INSTEAD OF the raw plaintext, before that file's `arbundles`
      data-item signing step — ground exactly where in the existing loop
      raw bytes currently flow to signing, and insert the encrypt step
      there, writing framed ciphertext bytes rather than plaintext at that
      file's offset. Each file's manifest-visible size becomes its
      CIPHERTEXT length (28 bytes larger than plaintext per full chunk,
      exactly as the design doc specifies) — ground how the existing
      per-file byte-length bookkeeping works and make sure offsets for
      SUBSEQUENT files in the same bundle account for the larger
      ciphertext length, not the original plaintext length.

      Also: in `packages/arweave-core/src/upload/tags.ts`, read the
      `CODEX_ENCRYPTION_VERSION_CURRENT` doc comment and bump its value
      from `"1"` to `"2"` — grep the whole monorepo first for every read
      site of this constant (not just `codex-arweave`) to confirm nothing
      hardcodes an expectation of `"1"` specifically rather than "whatever
      the current constant is" (the whole point of this constant existing
      is that callers always read it, never hardcode a literal version
      string — verify this holds, don't assume it).

      Follow TDD: write failing tests first in
      `packages/codex-arweave/tests/streaming-assemble-bundle-to-file.test.ts`
      (the existing file from `arweave-opfs-bundle-assembly` — extend it,
      don't replace it) covering: an encrypted multi-file bundle assembled
      this way, when each file's ciphertext bytes are decrypted via T1's
      `decryptStream` (using the SAME key, and each file's own tracked
      plaintext length), round-trips byte-identical to that file's
      original content; an unencrypted bundle assembled through the SAME
      function with `encryption` omitted behaves EXACTLY as today (full
      existing test suite from that sub-topic must still pass unmodified).
      Confirm new tests fail first for the right reason, then implement.

      Done when: a real encrypted multi-file bundle, assembled via this
      function, is provably decryptable chunk-by-chunk back to the exact
      original bytes of every file; the unencrypted path has zero
      behavior change (full pre-existing suite for this file passes
      unmodified); `CODEX_ENCRYPTION_VERSION_CURRENT` reads `"2"`
      everywhere it's consumed, with no leftover hardcoded `"1"` literal
      anywhere outside this constant's own definition and the (left
      alone) v1 decrypt path's own version-check branch (which legitimately
      must still recognize `"1"` as "use the old decrypt method" — that is
      not a bug, document it as intentional).
  - files: `packages/codex-arweave/src/library/streaming/assembleBundleToFile.ts`,
    `packages/codex-arweave/tests/streaming-assemble-bundle-to-file.test.ts`,
    `packages/arweave-core/src/upload/tags.ts`

## Wave 3 (depends on Wave 2)

- [x] T3: The real-browser proof, plus a true end-to-end round-trip
      self-check. Not new permanent infrastructure — reuse the
      established throwaway-CDP-script convention (headless Chromium
      driven over raw CDP WebSocket, Worker-hosted since OPFS sync-access
      handles are Worker-only, scratch files deleted after use) already
      used three times in this project (`arweave-opfs-bundle-assembly` T2,
      `arweave-streaming-post-core` T3's lazily-noted browser check,
      `arweave-streaming-post-resume` T3). Check that last one's report
      for the exact current mechanics (Vite dev server for
      `apps/codex-playground`, CDP on a chosen port, `Target.createTarget`
      + `Page.navigate` + `Runtime.evaluate`/console polling).

      Drive, in a real browser, inside a real Worker: assemble a real
      multi-file ENCRYPTED bundle via T2's extended
      `assembleBundleToFile` into a real OPFS file, using a real
      `CryptoKey` derived via the real, unmodified `deriveAccountAesKey`.
      Then, in the same real environment, decrypt every file's ciphertext
      bytes back via T1's `decryptStream`, reading from the SAME real OPFS
      file, and confirm byte-identical to the original source files.
      Independently re-verify peak memory stayed bounded in this REAL run
      too if practically measurable in this sandbox (e.g. via
      `performance.memory` if available in the headless Chromium build
      used, otherwise state plainly that this particular criterion could
      only be structurally proven under Node, not independently
      remeasured live in-browser, and why).

      Report, in full honest detail: exactly what you ran, what you
      observed, and any limitation (mirroring the honesty bar every prior
      real-browser check in this project has held to — e.g. the
      `arweave-streaming-post-resume` T3 report's explicit "no real funded
      gateway was used" caveat is the model to follow here for whatever
      this run genuinely couldn't verify).

      If the real-browser run surfaces a genuine bug (this has happened in
      EVERY real-browser check this project has run so far — the
      `node:crypto`-only merkle import, the `"base64url"` encoding gap, the
      delete-before-close OPFS race), fix it in whichever real source file
      actually needs it, rerun the full `codex-arweave` test suite +
      typecheck to confirm no regression, and report the deviation
      clearly — the exact discipline every prior task here has followed.

  - files: none expected to persist (throwaway verification script,
    deleted after use) — if a genuine bug surfaces, fix it in whichever
    file actually needs it and report the deviation.
