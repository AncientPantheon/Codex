## Wave 1

- [x] T1: Free-space check + bundle-splitting planner — pure logic,
      package-boundary-clean. Read `docs/work/arweave-split-bundle-upload/
      design.md` in full first. Read `packages/codex-arweave/src/library/
      streaming/isStreamingUploadSupported.ts` for this package's existing
      `navigator.storage`-structural-typing convention (mirror it — a
      narrow local interface, never widening `tsconfig`'s `lib`).

      Build, in a new file `packages/codex-arweave/src/library/streaming/
      planSplitBundles.ts`:
      - `checkAvailableStorageBudget(opts?: { estimate?: () =>
        Promise<{usage: number; quota: number}> }): Promise<{
        availableBytes: number; safeBudgetBytes: number }>` — calls the
        real (or injected, for tests) `navigator.storage.estimate()`,
        computes `availableBytes = quota - usage`, and a `safeBudgetBytes`
        meaningfully BELOW that (your call on the exact safety margin —
        document the reasoning: the estimate is approximate, and a
        bundle's OWN assembly needs room beyond just its final size
        during the process — e.g. consider reserving some percentage or a
        fixed floor, state and justify whichever you choose).
      - `planSplitBundles(files: readonly {path: string; size: number}[],
        budgetBytes: number): { bundles: {path: string; size: number}[][];
        oversizedFiles: {path: string; size: number}[] }` — a PURE function
        (no I/O): partitions `files` into the minimum number of groups K
        such that each group's total size fits within `budgetBytes`,
        with groups as close to EQUAL size as possible (target = totalSize
        / K, not greedy-fill-then-dump-remainder-unevenly into the last
        group). A single file LARGER than `budgetBytes` on its own cannot
        be split under this architecture — route it into
        `oversizedFiles` instead of silently forcing it into an
        over-budget group; the caller decides how to surface this (your
        job here is just to report it accurately, not to decide UI
        behavior).

      Follow TDD: write failing tests first in `packages/codex-arweave/
      tests/streaming-plan-split-bundles.test.ts` covering:
      `checkAvailableStorageBudget` computes `availableBytes`/
      `safeBudgetBytes` correctly from an injected fake estimate, and the
      safety margin is genuinely smaller than the raw available bytes
      (never equal, never larger); `planSplitBundles` returns exactly 1
      group when total size fits in budget (the common-case regression
      guard — confirm it would NEVER split when splitting isn't needed);
      a total exceeding budget splits into the minimum K with group sizes
      within a reasonable tolerance of equal (assert no group exceeds
      budget, and the largest/smallest group size ratio stays bounded —
      pick and justify a reasonable tolerance); a single oversized file is
      routed to `oversizedFiles`, never silently included in a group that
      exceeds budget; an empty file list returns `{bundles: [], 
      oversizedFiles: []}` cleanly. Confirm red-for-missing-module first,
      then implement.

      Done when: the planner is proven correct (never splits when
      unnecessary, never exceeds budget per group except the explicitly-
      reported oversized-file case, groups are roughly equal) and the
      storage-budget check is proven against an injected fake (real
      `navigator.storage.estimate()` is the default, untested directly at
      this level — real-browser verification is a later task).
  - files: `packages/codex-arweave/src/library/streaming/
    planSplitBundles.ts` (new), `packages/codex-arweave/tests/
    streaming-plan-split-bundles.test.ts` (new)

- [x] T2 (parallel with T1 — independent file scope): The standalone
      manifest-only upload primitive. Read `packages/codex-arweave/src/
      library/streaming/assembleBundleToFile.ts`'s existing inline
      manifest-building code (the `manifestBody`/`manifestTags`/
      `MANIFEST_CONTENT_TYPE`/`MANIFEST_FORMAT` block near the end of
      that file) in full — reuse the EXACT same manifest JSON shape/
      format, never a second, divergent manifest format. Read
      `packages/arweave-core/src/upload/tags.ts`'s `buildUploadTags`
      (confirm its real current `itemType: "manifest"` + `uploadId`
      support) and `packages/arweave-core/src/upload/upload.ts`'s
      `uploadData` (the plain, non-bundled native upload primitive — a
      manifest is tiny JSON; it does not need the full streaming/chunked
      machinery, confirm `uploadData` is the right, simplest fit, or
      ground why a different existing primitive fits better).

      Build `postSplitUploadManifest(params: { jwk: ArweaveJwk; files:
      {path: string; id: string}[]; uploadId: string; maxRewardWinston:
      bigint; ...whatever else buildUploadTags/uploadData genuinely
      require }, opts): Promise<{manifestId: string}>` — builds the SAME
      `arweave/paths` manifest JSON format as the inline bundle manifest
      (first file's path as default resolution target, same convention),
      tagged via `buildUploadTags` with `itemType: "manifest"` and the
      GIVEN `uploadId` (shared across every bundle's files in the split
      sequence — this function does not generate the id itself, it's
      handed one), posts it as its own plain transaction via `uploadData`
      (or whichever primitive you grounded as correct above).

      Follow TDD: write failing tests first in `packages/codex-arweave/
      tests/streaming-split-upload-manifest.test.ts` (fake-gateway-backed,
      no real network) covering: the posted manifest JSON exactly matches
      the format `assembleBundleToFile`'s own inline manifest produces for
      equivalent input (byte-for-byte or structurally-equal JSON — pick
      whichever is the stronger, correct assertion and justify it); the
      posted tags include `itemType: "manifest"` and the given `uploadId`;
      an empty file list is handled explicitly (your call: reject clearly,
      or post a valid empty manifest — state and justify whichever).
      Confirm red-for-missing-module first, then implement.

      Done when: a posted manifest from this NEW standalone primitive is
      format-identical to today's inline-bundle manifest for the same
      input, correctly tagged for grouping with its sibling bundles.
  - files: `packages/codex-arweave/src/library/streaming/
    postSplitUploadManifest.ts` (new), `packages/codex-arweave/tests/
    streaming-split-upload-manifest.test.ts` (new)

## Wave 2 (depends on Wave 1)

- [x] T3: The multi-bundle plan persistence store. Read
      `packages/codex-arweave/src/library/streaming/
      streamingPostResumeStore.ts` in FULL first — this is the EXACT
      IndexedDB-backed pattern to mirror (same `static open`, same
      object-store-created-in-`onupgradeneeded`, same "writes resolve on
      `transaction.oncomplete`, never `onsuccess`" discipline, same
      real-`fake-indexeddb`-backed test convention).

      Define and build `SplitUploadPlanStore` persisting a
      `SplitUploadPlanRecord`: the shared `uploadId`, the COMPUTED K-way
      file grouping from T1's planner (decided ONCE, up front — this
      record is what makes it never get recomputed/reshuffled on a
      reload), which bundle indices have fully completed (and each
      completed bundle's resulting file-id list — needed to build the
      final manifest without re-deriving anything), and whatever minimal
      additional state the orchestrator (T4, next task) will need to
      resume cleanly (ground this WITH T4's actual needs in mind — read
      T4's own task text below before finalizing this record's shape, or
      revise this store after T4 is drafted if a gap appears; a small
      amount of co-design across these two sequential tasks is expected
      and fine).

      Follow TDD, same discipline as `streamingPostResumeStore.test.ts`:
      save/load/delete round-trips every field exactly; loading a
      never-saved id resolves `null`; a second save with the same id
      overwrites, never duplicates.

      Done when: round-trip save/load/delete proven byte-exact via real
      `fake-indexeddb`, mirroring the established store pattern exactly.
  - files: `packages/codex-arweave/src/library/streaming/
    splitUploadPlanStore.ts` (new), `packages/codex-arweave/tests/
    streaming-split-upload-plan-store.test.ts` (new)

- [x] T4: The multi-bundle sequential orchestration engine. Depends on
      T1, T2, T3 all landing first — read each of their REAL final files
      fresh before starting, don't rely on their task descriptions above.
      Also re-read `packages/codex-arweave/src/library/streaming/
      uploadBundleStreaming.ts` (`uploadBundleStreaming`'s real current
      signature — this is the EXISTING, UNMODIFIED per-bundle engine
      every one of the K bundles runs through, completely unchanged) and
      `streamingPost.ts`'s `onProgress` shape (what a single bundle
      already reports — your aggregation wraps this, doesn't replace it).

      Build `runSplitBundleUpload(params, opts: { onOverallProgress?:
      (bundleIndex: number, totalBundles: number, bundleUploadedChunks:
      number, bundleTotalChunks: number, overallBytesUploaded: number,
      overallTotalBytes: number) => void; ... }): Promise<{manifestId:
      string; bundleResults: UploadBundleResult[]}>`:
      1. Use T1's `checkAvailableStorageBudget`/`planSplitBundles` to
         compute the K-way grouping (or confirm, if ALREADY computed and
         persisted via T3's store for a RESUMED run, reuse the persisted
         plan verbatim — never recompute mid-sequence, per the design
         doc's own explicit requirement).
      2. Persist the plan via T3's store BEFORE starting bundle 0.
      3. For each bundle index 0..K-1, IN ORDER, NEVER CONCURRENTLY: if
         T3's record shows this bundle already completed, skip it
         entirely (no re-sign, no re-post — reuse its persisted file-id
         list); otherwise run it via the EXISTING, unmodified
         `uploadBundleStreaming` (which already has its OWN internal
         resume mechanism for an in-flight interruption — you are not
         rebuilding that, just calling it), threading its own
         `onProgress` into your `onOverallProgress` aggregation (compute
         `overallBytesUploaded` from completed-bundles' byte totals plus
         the current bundle's own in-flight progress). On that bundle's
         completion, persist its completion + file-id list to T3's store
         immediately.
      4. Once every bundle is complete, call T2's
         `postSplitUploadManifest` with the FULL flattened file-id list
         across all K bundles and the shared `uploadId`.
      5. On full success, clean up T3's plan record (mirroring the
         per-bundle resume store's own "delete on completion" discipline).

      Follow TDD: write failing tests first (fake-gateway-backed, fake
      per-bundle engine or the real one with small fixture sizes — your
      call on fidelity vs. test speed, justify it) covering: an in-budget
      selection runs as exactly 1 bundle, byte-identical result to calling
      `uploadBundleStreaming` directly (the critical no-regression-for-
      the-common-case proof); an over-budget selection runs K bundles
      sequentially, NEVER concurrently (assert via a spy that bundle N+1
      never starts before bundle N's own completion is observed); the
      final manifest references every file across every bundle correctly;
      a SIMULATED interruption after bundle 1 of 3 completes, followed by
      a fresh `runSplitBundleUpload` call reusing the same persisted
      plan, skips bundle 0 (no re-sign, no re-post — spy-proven), resumes
      bundle 1 from ITS OWN real checkpoint (not from scratch), and
      completes bundle 2, posting the manifest exactly once, only after
      genuine full completion. Confirm red-for-the-right-reason first,
      then implement.

      Done when: every acceptance criterion in the parent design doc
      involving orchestration/resumability is proven at the unit level
      (real-browser proof is the final task). Full `codex-arweave` suite
      passes (unscoped, the one known pre-existing `node:sqlite` failure
      allowed); clean typecheck.
  - files: `packages/codex-arweave/src/library/streaming/
    runSplitBundleUpload.ts` (new), `packages/codex-arweave/tests/
    streaming-run-split-bundle-upload.test.ts` (new), possibly a small
    additive revision to T3's `splitUploadPlanStore.ts` if genuinely
    needed once this task's real requirements are clear (flag if touched)

## Wave 3 (depends on Wave 2)

- [x] T5: UI wiring (DONE, but with a flagged gap — see note below).
      Read `packages/codex-arweave/src/panel/
      UploadWizard.tsx` in FULL first — specifically the existing
      progress-state machinery T3 of `arweave-streaming-ui` already built
      (`UploadProgressState`, the `"uploading"` phase rendering) and
      `onConfirmUpload`'s real current call into the streaming engine
      (via the host adapter's injected `uploadFilesAndTrack`/callbacks —
      re-read the real current wiring, several layers have changed this
      session).

      Before starting a bundle (multi-file) upload, run T1's
      `checkAvailableStorageBudget`/`planSplitBundles` against the real
      selection. If splitting is needed, show the plan plainly BEFORE
      upload starts ("this N GB selection will upload as K bundles of
      about M GB each") — your call on exact placement/copy, matching
      this file's own established plain-factual tone (mirror the
      existing cap-message/disclaimer copy style, not an alarming one).
      Extend the progress state to carry `{bundleIndex, totalBundles,
      overallBytesUploaded, overallTotalBytes}` alongside the existing
      per-bundle chunk counts, fed by T4's `onOverallProgress`. Route an
      over-budget selection through T4's `runSplitBundleUpload` instead of
      the existing single-bundle call; an in-budget selection's call path
      is UNCHANGED (confirm this precisely — zero behavior change to the
      common case is non-negotiable).

      Follow TDD: extend `tests/e4-panel-upload-wizard.test.tsx` — write
      failing tests first for: an in-budget selection's upload call path
      is unchanged (same function called, same arguments shape); an
      over-budget selection shows the pre-upload split-plan message and
      routes through the new orchestrator; the progress UI shows
      bundle-index/total and an overall percentage that does not reset to
      0 at a bundle boundary (simulate two bundles' worth of progress
      events, assert the rendered overall figure only ever increases).
      Confirm red-for-the-right-reason first, then implement.

      Done when: the common (in-budget) case is provably unchanged, an
      over-budget case shows the plan and routes correctly, and the
      progress UI genuinely reflects whole-sequence state. Full
      `codex-arweave` suite passes (unscoped); clean typecheck.
  - files: `packages/codex-arweave/src/panel/UploadWizard.tsx`,
    `packages/codex-arweave/tests/e4-panel-upload-wizard.test.tsx`, and
    whatever host-adapter wiring (`apps/codex-playground/src/
    realArweaveAdapter.ts`) is genuinely needed to thread the new
    orchestrator through to production — mirror the EXACT two-layer
    wiring pattern (`UploadWizard` stays a pure callback-prop component;
    the host adapter does the real work) already established and
    hard-learned twice this session; flag clearly if this file is touched

**IN PROGRESS (dispatched):** T5b — Worker wrapper for `runSplitBundleUpload`
(mirrors `arweave-streaming-worker-wiring`'s already-shipped
`StreamingUploadRunner.ts`/`uploadWorker.ts` pattern) + full production
wiring from `buildRealPanelDeps` through to `<UploadWizard>` + a new
upload-process informatics section on the Upload page. Running in parallel
with an unrelated nav-restructure task (promoting "Codex ID" to a top-level
tab) that touches the same file (`ArweavePanel.tsx`) in a different,
non-overlapping region (`active === "codex-id"` vs `active === "upload"`).
T6 (real-browser verification) follows once both land.

**GAP flagged by T5, not yet resolved (superseded by the above once it lands):** `runSplitBundleUpload` (T4) runs its
OPFS work on the main thread. Every real production upload path in
`apps/codex-playground/src/realArweaveAdapter.ts` routes through
`resolvedStreamingUploadRunner`, a Worker-backed wrapper
(`StreamingUploadRunner.ts`), because `createSyncAccessHandle()` is
Worker-only in a real browser. T5 deliberately did NOT wire
`uploadFilesAndTrackSplit` into `buildRealPanelDeps` because doing so today
would either throw in a real browser or require inventing a new
Worker-backed runner outside its scope. `UploadWizard.tsx`'s side is fully
built/tested and ready to receive such a runner once it exists. T6 (real-
browser verification) cannot exercise the split path for real without this
wrapper — a new task (T5b) is needed first: build a Worker-backed wrapper
for `runSplitBundleUpload`, mirroring `StreamingUploadRunner.ts`'s existing
postMessage-protocol pattern, then wire it into `realArweaveAdapter.ts`
exactly as the existing single-bundle runner is wired. Holding pending
go-ahead before dispatching.

## Wave 4 (depends on Wave 3)

- [ ] T6: Real-browser verification at representative scale. Reuse the
      established throwaway-CDP convention. Drive the real production
      wiring with a fixture selection sized to force a REAL multi-bundle
      split at a tractable scale (e.g. an artificially small injected
      `budgetBytes`/fake storage estimate, rather than literally staging
      gigabytes in this sandbox — the splitting/sequencing/resume LOGIC
      is what needs proving, not raw data volume; state this scaling
      choice and why it's still a faithful proof).

      Confirm, for real: an over-budget selection genuinely produces K
      sequential (never concurrent) real bundle uploads against a
      faithfully-faked gateway; the final manifest, fetched back and
      parsed, correctly resolves every file across every bundle; the
      progress UI visibly reflects whole-sequence progress across a real
      bundle boundary (capture multiple snapshots, confirm no reset); a
      REAL interruption (kill the posting loop after bundle 1 completes,
      same technique prior resumability real-browser checks used) followed
      by a fresh run resumes correctly — bundle 0 never re-touched, bundle
      1 (or wherever the interruption landed) resumes from its real
      checkpoint, completion reached, manifest posted exactly once.

      If this surfaces a genuine bug, fix it in whichever real file needs
      it, rerun the full suite + typecheck, report the deviation clearly.

      Done when: the whole plan→split→sequence→resume→manifest pipeline
      is proven working together in a real browser, with a precise,
      honest account of exactly what was and wasn't verified (same bar
      every prior real-browser report in this project has held to).
  - files: none expected to persist (throwaway verification script,
    deleted after use) — any genuine bug fix goes in whichever real file
    needs it, clearly flagged.
