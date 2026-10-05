## Wave 1

- [x] T1: The resume-record IndexedDB store. Read
      `packages/codex-arweave/src/library/indexedDbStore.ts` in full
      first — this is the EXACT pattern to mirror, not a new
      convention: a `static open(opts: { indexedDB: IdbFactoryLike;
      databaseName: string })` factory using the injectable
      `IdbFactoryLike`/`IdbDatabaseLike` seams from `library/types.ts`
      (so `fake-indexeddb` drives it under Node in tests, no `lib:
      ["DOM"]` needed), a keyPath-based object store created in
      `onupgradeneeded`, and — critically — every WRITE promise
      resolving on `transaction.oncomplete`, never `request.onsuccess`
      (the file's own doc comment explains why: `onsuccess` fires
      before the transaction commits, so resolving there risks a
      following read missing the write — read-only requests may
      resolve on `onsuccess`, writes must not).

      Define the resume record's shape (e.g. `StreamingPostResumeRecord`):
      an id (the upload/bundle identifier, used as the keyPath), the
      OPFS file's name, the signed transaction's serializable fields
      (owner, tags, target, quantity, reward, last_tx, signature, id,
      data_root, data_size — ground the exact field list against
      `SignedStreamingTransaction`'s real shape, built in
      `packages/arweave-core/src/upload/streaming/
      createStreamingTransaction.ts` this session), the `chunks`/
      `proofs` metadata, `chunkIndex`, and `txPosted`. Implement a
      store (mirror `IndexedDBLibraryStore`'s class shape) with `save
      (record)`, `load(id): Promise<StreamingPostResumeRecord | null>`,
      and `delete(id): Promise<void>`.

      Follow TDD: write the failing tests first (using `fake-indexeddb`,
      already a declared dependency — check how existing
      `indexedDbStore` tests inject it and mirror that setup exactly):
      save then load round-trips every field exactly (including the
      `Uint8Array`-typed proof/signature bytes — IndexedDB's structured
      clone handles typed arrays natively, verify this empirically
      rather than assuming); loading a never-saved id resolves `null`,
      never throws; delete removes the record (a subsequent load
      resolves `null`); a second `save` with the same id overwrites
      rather than erroring or duplicating. Confirm failing first, then
      implement.

      Done when: round-trip save/load/delete is proven byte-exact for
      every field, including typed-array fields, via real `fake-indexeddb`
      -backed tests (not a hand-rolled mock that could silently diverge
      from real IndexedDB semantics).
  - files: `packages/codex-arweave/src/library/streaming/
    streamingPostResumeStore.ts` (new), `packages/codex-arweave/tests/
    streaming-post-resume-store.test.ts` (new)

## Wave 2 (depends on Wave 1)

- [x] T2: Wire persistence into the streaming post loop + the resume
      entry point. Read `packages/codex-arweave/src/library/streaming/
      streamingPost.ts` (built this session) in full first — the
      existing uninterrupted post loop this task adds checkpointing and
      a resume path to, without changing its core chunk-posting
      mechanics.

      After the initial transaction-post step succeeds, and after each
      successfully-posted chunk (or a reasonable batch — your call,
      document the tradeoff against IndexedDB write volume), call T1's
      store to persist/update the resume record with the current
      `chunkIndex`/`txPosted` state. On full completion (every chunk
      posted), delete the resume record; make OPFS-file cleanup an
      explicit, overridable option (default: delete it) rather than a
      silently hardcoded choice either way.

      Add a `resumeStreamingPost(id, pool, opts)` entry point: loads the
      persisted record via T1's store, reopens the OPFS file by its
      persisted name (via the existing `openOpfsBundleAssemblyFile`/
      equivalent seam from the prior sub-topic), reconstructs the signed
      transaction DIRECTLY from the persisted fields (no call to
      `createStreamingTransaction`, no signing — this is the whole
      point), and continues the same chunk-posting loop starting from
      the persisted `chunkIndex`/`txPosted`.

      Follow TDD: write the failing tests first — run a streaming post
      against a fake gateway that's configured to fail/stop after N
      chunks (simulating an interruption), confirm the resume record
      reflects exactly N chunks posted; call `resumeStreamingPost` with
      a fresh fake gateway (and assert, via a spy, that it is NEVER
      asked to post chunks 0..N-1 again, and that no signing
      function/`createStreamingTransaction` is called during resume);
      confirm the resumed run completes and posts the remaining chunks
      in order; confirm the final state (transaction id, total chunks
      posted) matches what an uninterrupted run of the identical input
      would produce. Confirm all new tests fail first, then implement.

      Done when: a simulated interruption-then-resume reaches the exact
      same completion state as an uninterrupted run; resume provably
      never re-signs, never re-reads source files, never re-posts an
      already-successful chunk. The full `codex-arweave` AND
      `arweave-core` test suites pass (unscoped — check for and fix any
      gap outside this task's own file list, flagging explicitly if
      found; the one known pre-existing unrelated failure is
      `codex-arweave`'s `tests/e3-library-store.test.ts` `node:sqlite`
      sandbox limitation). Clean typecheck both packages.
  - files: `packages/codex-arweave/src/library/streaming/streamingPost.ts`,
    `packages/codex-arweave/tests/streaming-post.test.ts`

## Wave 3 (depends on Wave 2)

- [x] T3: The real, driven-browser, end-to-end proof. Not a new
      permanent test-infrastructure task — the same throwaway-script
      convention already used twice this session for real-browser
      verification (a headless Chromium instance driven over the raw
      CDP WebSocket protocol, or equivalent — reuse whatever approach
      the prior two real-browser checks this session already
      established rather than inventing a third pattern; check recent
      build reports in this session's history for the exact mechanics
      that already worked).

      Drive, in a real browser: assemble a real multi-file bundle via
      `assembleBundleToFile` into a real OPFS file; compute its
      streaming `data_root`/`proofs`; post it via `streamingPost`
      against either a real testnet-shaped faithfully-faked gateway or
      (if practical and safe — no real funds risk, confirm this before
      attempting) a real gateway's `/tx`+`/chunk` endpoints with a
      throwaway keyfile and minimal real cost; deliberately interrupt
      the run after a few chunks (e.g. by killing the posting loop
      mid-way in the driven script, not by crashing the browser itself);
      call `resumeStreamingPost` fresh; confirm completion. Read back
      and independently verify the final state (e.g. via the gateway's
      own tx-status read, or by cross-checking the posted chunks'
      Merkle proofs validate against the data_root — whichever is more
      practical/conclusive given what's actually reachable in this
      sandbox).

      Describe exactly what you ran, what you observed, and any
      limitation of the verification (e.g. if a real gateway wasn't
      practical/safe to use and a faithful fake was used instead,
      explain why and what would still need a final real-gateway check
      before this ships to production use) in full detail in your
      report — this is the capstone proof for the whole streaming-post
      sub-project, treat it with the rigor that implies.

      Done when: the full pipeline (OPFS assembly → streaming data_root
      → streaming post → interruption → resume → completion) is proven
      working together in a real browser, not just unit-proven in
      isolation, with a precise, honest account of exactly what was and
      wasn't verified against real infrastructure.
  - files: none expected to persist (a throwaway verification script,
    deleted after use, per the established convention) — if the
    investigation surfaces a genuine bug requiring a real code fix
    (as happened twice already this session), fix it in whichever file
    actually needs it and report the deviation clearly, the same
    discipline every prior task in this project has followed.
