Depends on `arweave-streaming-encryption`, `arweave-streaming-ui`, AND `arweave-streaming-worker-wiring`
being complete (Wave 1 below reads `isStreamingUploadSupported`, `uploadBundleStreaming`/
`uploadStreaming`, `decryptStream`, and the documentation page `arweave-streaming-ui` T4 creates).
Do not start until all three of those plan.md files show every task `[x]`.

**Why `arweave-streaming-worker-wiring` was added as a dependency (discovered after this plan was
first written):** `arweave-streaming-ui`'s T4 real-browser check found that `isStreamingUploadSupported()`
always resolves `false` on the main thread in a real browser (`createSyncAccessHandle()` is
Worker-only) — so without that sub-topic's Worker wiring, THIS feature's own dry-run engine would
silently only ever exercise the in-memory fallback path too, never actually proving the streaming
engine works. Build worker-wiring first.

## Wave 1

- [x] T1: The shippable local/no-op gateway. Read
      `packages/arweave-core/src/upload/types.ts` (for the real,
      current `UploadGatewayApiFactory` shape) and
      `packages/arweave-core/src/upload/streaming/
      createStreamingTransaction.ts` (for the real, current
      `StreamingUploadGatewayApiFactory` shape) in FULL first — ground
      both exact interfaces directly, do not guess from this plan's
      paraphrase. Read `tests/e3-helpers.ts`'s existing TEST-ONLY fake
      gateway for a style precedent (what a realistic success response
      shape looks like) — do not import or modify it; this task's module
      is new, separate, production-shippable code.

      Build `createLocalDryRunGatewayApiFactory(): { factory: <a value
      satisfying BOTH real factory shapes, or two separate factories if
      the two interfaces can't reasonably share one implementation —
      your call, document which>; getCapturedTx(id): ...; getCapturedChunks
      (id): Uint8Array[]; reset(): void }`. Every method accepts its input,
      stores it in an in-memory `Map`, and returns a realistic success
      response — NO `fetch` call, no `Api` import from `arweave`, nothing
      that could reach a real network, anywhere in this file (grep your
      own finished file for `fetch`/`Api`/`http` as a self-check before
      reporting done).

      Follow TDD: write failing tests first proving — posting a
      transaction then a chunk via the factory's client succeeds and is
      retrievable via `getCapturedTx`/`getCapturedChunks`; `reset()`
      clears all captured state; a structural assertion (e.g. mocking
      global `fetch` and asserting zero calls across a full post
      sequence) that nothing in this module ever reaches the network.
      Confirm red-for-missing-module first, then implement.

      Done when: both real gateway contracts are satisfiably implemented
      (confirmed by `tsc` structural typing, not just "it compiles because
      we used `any`"), zero network reachability is structurally proven,
      and captured state round-trips exactly what was posted.
  - files: `packages/arweave-core/src/upload/localDryRunGateway.ts` (new),
    `packages/arweave-core/tests/local-dry-run-gateway.test.ts` (new)

## Wave 2 (depends on Wave 1)

- [x] T2: The dry-run engine. Read `docs/work/arweave-upload-dry-run/
      design.md`'s "The dry-run engine" section in full, plus — in full —
      `packages/codex-arweave/src/library/flow.ts` (the real
      `uploadAndTrack`/`uploadFilesAndTrack` entry points this mirrors the
      PARAMETER SHAPE of), `packages/codex-arweave/src/library/streaming/
      uploadBundleStreaming.ts` (from `arweave-streaming-ui`, as it
      actually exists once that sub-topic lands — re-read fresh),
      `isStreamingUploadSupported.ts`, `streamingPostResumeStore.ts`, and
      `arweave-streaming-encryption`'s `decryptStream`.

      Build `runUploadDryRun(params, opts): Promise<DryRunResult>` per the
      design doc's exact behavior list (routes through the real
      support-detection; injects T1's local gateway; NEVER calls
      `store.append`; self-verifies via `decryptStream` round-trip for
      encrypted input and `arweave`'s own `validatePath` for every chunk's
      proof against the computed `data_root`; deliberately interrupts
      after a few chunks of the largest file and calls
      `resumeStreamingPost` against the same local gateway + a REAL
      `StreamingPostResumeStore` to prove completion; cleans up its own
      OPFS file + resume record unconditionally, success or failure).

      Follow TDD: write failing tests first covering — a normal
      multi-file, mixed encrypted/unencrypted selection reports
      `success: true` with `proofsValid: true`, `decryptRoundTripOk: true`
      for the encrypted files, `resumeTested: true`; a deliberately
      corrupted/mismatched encryption key makes the run report
      `success: false` with a clear reason in `errors` (not a silent false
      pass); zero Library/`store.append` calls occur (spy on `store`,
      assert never called); the OPFS file and resume record are both gone
      after the run completes, in BOTH the success and induced-failure
      cases (structurally check, e.g. via the real `StreamingPostResumeStore
      .load` resolving `null` afterward). Confirm red-for-missing-module
      first, then implement.

      Done when: every behavior above is proven, including the
      induced-failure case (a dry run that actually fails must be
      distinguishable from one that passes — this is the single most
      important property of a "trust this before you spend real money"
      feature, verify it doesn't rubber-stamp).
  - files: `packages/codex-arweave/src/library/streaming/
    dryRunUpload.ts` (new), `packages/codex-arweave/tests/
    streaming-dry-run-upload.test.ts` (new)

## Wave 3 (depends on Wave 2)

- [x] T3: The UI entry point, documentation section, and the real-browser
      capstone proof.

      **CRITICAL — read before touching `UploadWizard.tsx`**:
      `arweave-streaming-worker-wiring`'s T3 found, the hard way (one
      aborted dispatch), that `UploadWizard.tsx` is a PURE host-injected-
      callback component — it never imports `library/flow.ts`, never
      holds a real `store`/signing `jwk`/`pool` of its own. Every real
      upload action is a callback PROP, implemented for real in
      `apps/codex-playground/src/realArweaveAdapter.ts` (which DOES hold
      `store`/`pool`/`jwk`). `runUploadDryRun` (T2) needs exactly those
      same things (`store`-shaped access is irrelevant here since it's
      never called, but `pool`/`jwk`-equivalent access for building a
      real signed-but-undelivered transaction is NOT optional). Do the
      SAME two-layer wiring here, do not repeat the mistake: (a) add a
      new optional callback prop on `UploadWizard`, e.g.
      `runDryRunUpload?: (files: File[], selection: UploadWizardSelection,
      accountId: string) => Promise<DryRunResult>` (mirroring the EXACT
      shape of the existing `uploadAndTrack`/`uploadFilesAndTrack` props),
      wired to a new button; (b) implement that prop for real in
      `apps/codex-playground/src/realArweaveAdapter.ts`, where
      `decryptArweaveKey`/`store`/`resolvedPool` already exist, calling
      T2's `runUploadDryRun` there. Read
      `apps/codex-playground/src/realArweaveAdapter.ts`'s
      `uploadAndTrack`/`uploadFilesAndTrack` closures (as they exist now,
      POST `arweave-streaming-worker-wiring`) for the exact real pattern
      to mirror — same `decryptArweaveKey(findEntryForAddress(...))` call,
      same shape of key/selection handling, just routed into
      `runUploadDryRun` instead of the real upload runner.

      Read `packages/codex-arweave/src/panel/UploadWizard.tsx`'s Review
      step in full first (the step `onConfirmUpload`'s button lives in),
      and the documentation page `arweave-streaming-ui` T4 created
      (locate its exact path from that task's own build report) — find
      the explicit placeholder section marker it left and fill it in, do
      not create a second, separate page.

      Add a second button next to the real Confirm button in
      `UploadWizard.tsx`: **"Test this upload (free — runs locally,
      nothing is sent to Arweave)"**, calling the new `runDryRunUpload`
      prop with the wizard's current file selection/encryption choice.
      Render the `DryRunResult` in a dedicated, clearly-separate panel
      (never touching `phase`/`uploading`/`done` — a dry run result must
      be visually and structurally impossible to confuse with a real
      completed upload). Write the documentation section per the design
      doc's exact content requirements (what the button does/does NOT
      do, what each result field means, what to do on failure).

      Follow TDD: extend `tests/e4-panel-upload-wizard.test.tsx` (for the
      `UploadWizard.tsx` prop/button/panel-rendering behavior, injecting a
      fake `runDryRunUpload`) AND whichever `apps/codex-playground/tests/
      *.test.ts` file already covers `realArweaveAdapter.ts`'s
      `uploadAndTrack`/`uploadFilesAndTrack` (per
      `arweave-streaming-worker-wiring` T3-revised's own precedent — same
      file, extend it again) for the real adapter-level wiring. Write
      failing tests first for: the Test button is present and enabled
      under the same conditions as Confirm; clicking it calls
      `runUploadDryRun` (not the real upload path) and renders its result
      in the dedicated panel; the real `phase` state is untouched by a
      dry run (confirm it stays `"idle"`/wherever it started, never flips
      to `"uploading"`/`"done"`). Confirm red-for-the-right-reason first,
      then implement.

      Then run the real-browser capstone check for the WHOLE arweave-
      streaming-upload project (this is the final task of the final
      sub-topic): drive the real `UploadWizard`, click Test, with a
      realistic multi-file ENCRYPTED selection large enough to exercise
      multiple chunks and the interrupt/resume path, confirm the rendered
      result panel shows `success: true` with every sub-check passing, and
      confirm zero real network calls occurred (spy on `fetch` at the CDP-
      driven page level). Report exactly what was and wasn't verified,
      with the same honesty bar every prior real-browser report in this
      project has held to, and explicitly state: is the ENTIRE
      `arweave-streaming-upload` project (all of `arweave-streaming-data-
      root`, `arweave-opfs-bundle-assembly`, `arweave-streaming-post-core`,
      `arweave-streaming-post-resume`, `arweave-streaming-encryption`,
      `arweave-streaming-ui`, `arweave-streaming-worker-wiring`,
      `arweave-upload-dry-run`) now complete, per the original parent
      design doc's acceptance criteria
      (`docs/work/arweave-streaming-upload/design.md`) — check each
      bullet there explicitly and report pass/fail per bullet, not just a
      vague "yes."
  - files: `packages/codex-arweave/src/panel/UploadWizard.tsx`,
    `packages/codex-arweave/tests/e4-panel-upload-wizard.test.tsx`,
    `apps/codex-playground/src/realArweaveAdapter.ts`, whichever
    `apps/codex-playground/tests/*.test.ts` file already covers that
    adapter's `uploadAndTrack`/`uploadFilesAndTrack` (per
    `arweave-streaming-worker-wiring` T3-revised's precedent), the
    documentation page from `arweave-streaming-ui` T4 (extended, not
    replaced), plus a throwaway verification script (deleted after use).

**STATUS (2026-10-04, UPDATED — RESOLVED): T3's own listed deliverables
(UI button/panel, real adapter wiring, docs section, both test suites
green, both typechecks clean) are DONE.** T3's own real-browser capstone
found an apparent corruption in the resumed-bundle byte count (inflated by
exactly two extra 256 KiB chunks), originally suspected to be a real OPFS/
resume-engine defect — see `docs/work/arweave-streaming-resume-opfs-corruption/`
for the full investigation. **Root cause, found by a rigorous
hypothesis-ranked debug investigation: the upload engine was never
corrupted.** The dry-run feature's own verification harness
(`localDryRunGateway.ts`) recorded posted chunks by arrival order instead
of by `offset` (how a real gateway actually addresses them), so a
pool-level retry re-posting an already-accepted chunk — a real,
documented, harmless no-op on a real gateway — got miscounted as a
duplicate. Fixed, with a regression test proven to fail pre-fix and pass
post-fix, plus real-browser re-verification at both original bug-report
scales confirming the fix. `streamingPost.ts`/`bundleAssemblyFile.ts`/
`StreamingPostResumeStore` were never touched for this — they were correct
the whole time.

That investigation also surfaced a SEPARATE, genuine, narrow-window bug
(not the cause of the above): the real checkpoint-save COULD regress
backward on a pool-level retry, independently confirmed and fixed — see
`docs/work/arweave-streaming-checkpoint-regression/` (regression test
proven to fail pre-fix, pass post-fix; `codex-arweave`'s full suite: 880
passed, 1 skipped, same single pre-existing unrelated failure).

**With both resolved, the entire `arweave-streaming-upload` project
(`arweave-streaming-data-root`, `arweave-opfs-bundle-assembly`,
`arweave-streaming-post-core`, `arweave-streaming-post-resume`,
`arweave-streaming-encryption`, `arweave-streaming-ui`,
`arweave-streaming-worker-wiring`, `arweave-upload-dry-run` — every
sub-topic plan shows every task `[x]`) is complete.**
