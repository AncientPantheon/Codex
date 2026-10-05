Depends on `arweave-streaming-encryption` being complete (its `encryptStreamToFile`/`decryptStream`
primitives and `assembleBundleToFile`'s `encryption` param are read directly by T2 below). Do not
start T2/T3 until that sub-topic's plan.md shows all tasks `[x]`.

## Wave 1

- [x] T1: OPFS-support detection seam. Read
      `packages/codex-arweave/src/library/streaming/bundleAssemblyFile.ts`
      in full first — its injectable `getDirectory` seam is what this
      task's detector will actually call through. Read
      `docs/work/arweave-streaming-ui/design.md`'s "OPFS-support
      detection" section for the exact requirement: do not just check
      `typeof navigator.storage?.getDirectory === "function"` (a false
      positive in some restricted contexts) — actually attempt to open a
      throwaway OPFS file via the real
      `openOpfsBundleAssemblyFile`/`getDirectory` path, write nothing or a
      trivial marker, then delete it, inside a try/catch; `false` on ANY
      thrown error, `true` only on genuine success.

      Export `isStreamingUploadSupported(opts?: { getDirectory?: () =>
      Promise<OpfsDirectoryHandleLike> }): Promise<boolean>` — injectable
      for tests (mirror the existing `getDirectory` injection convention
      exactly), defaulting to the real `navigator.storage.getDirectory`.

      Follow TDD: write failing tests first covering — a fake
      `getDirectory` that succeeds end-to-end resolves `true`; one that
      throws at `getDirectory()` itself resolves `false` (never throws
      out of this function); one that throws later (e.g. at
      `getFileHandle`/`createSyncAccessHandle`) also resolves `false`;
      confirm the throwaway file is actually cleaned up (removed) after a
      successful check, not left behind. Confirm red-for-missing-module
      first, then implement.

      Done when: the detector never throws under any failure mode, is
      proven `false` for at least two distinct failure injection points,
      `true` for the success path, and leaves no residue file behind on
      success.
  - files: `packages/codex-arweave/src/library/streaming/
    isStreamingUploadSupported.ts` (new), `packages/codex-arweave/tests/
    streaming-upload-supported.test.ts` (new)

- [x] T2 (parallel with T1 — independent file scope): The actual
      streaming routing function. Read `packages/codex-arweave/src/
      library/flow.ts` in FULL first (both the bundle and single-file
      branches of `uploadAndTrack`) — this task does NOT edit `flow.ts`
      yet (that's T3, Wave 2, once T1+T2 both exist); it builds the
      streaming-engine-calling function `flow.ts` will route to.

      Also read, in full: `packages/codex-arweave/src/library/streaming/
      assembleBundleToFile.ts` (as it will exist once
      `arweave-streaming-encryption`'s T2 lands — re-read it fresh at
      build time, do not rely on a stale mental model, since its
      `encryption` param is new), `computeStreamingDataRoot.ts`,
      `createStreamingTransaction.ts`, `streamingPost.ts`'s
      `streamingPostBundle`, and `streamingPostResumeStore.ts`.

      Build `uploadBundleStreaming(params: UploadBundleStreamingParams,
      opts: UploadBundleStreamingOptions): Promise<UploadBundleResult>` (name
      your own types precisely — the RETURN SHAPE must be
      `UploadBundleResult`-COMPATIBLE, i.e. whatever `uploadBundle`
      — the EXISTING in-memory bundler, `arweave-core/src/upload/
      bundle.ts` — already returns, since callers must not be able to
      tell which engine ran): opens an OPFS bundle-assembly file, calls
      `assembleBundleToFile` (with `encryption` set when the caller passes
      an already-derived `CryptoKey`, matching `arweave-streaming-
      encryption`'s T2 contract exactly), computes the streaming
      data_root, creates+signs the transaction via
      `createStreamingTransaction`, posts via `streamingPostBundle` with a
      resume record wired through a REAL `StreamingPostResumeStore`
      instance, and returns `{ id, manifestId, fileIds, reward, ownerAddress
      }`-shaped data matching `UploadBundleResult`'s real current fields
      (ground this exactly — read `bundle.ts`'s real return type, do not
      guess the field names).

      Build the single-file analog, `uploadStreaming(...)`, matching
      `uploadData`'s real `UploadResult` shape the same way, for the
      single-file branch.

      Follow TDD: write failing tests first comparing a streaming-engine
      run against a FAKE gateway (same convention `streaming-post.test.ts`
      already uses) to an UNENCRYPTED in-memory `uploadBundle`/`uploadData`
      run against an equivalent fake, on the SAME input files, asserting
      the RETURNED SHAPE's keys/types match (not necessarily identical ids,
      since signing is non-deterministic — same caveat every prior
      sub-topic's comparison tests already documented and solved via a
      deterministic-sign stub where exact-id comparison was required;
      decide here whether exact-id comparison is actually needed for THIS
      test or shape-comparison suffices, and justify your choice). Also
      cover: an ENCRYPTED run's posted ciphertext bytes, decrypted via
      `arweave-streaming-encryption`'s `decryptStream` using the same key,
      round-trip to the original file bytes. Confirm red-for-missing-module
      first, then implement.

      Done when: both functions produce `UploadBundleResult`/`UploadResult`
      -shaped output indistinguishable in SHAPE from the existing in-memory
      functions' own output, for both encrypted and unencrypted input, with
      a real resume record genuinely written/cleared via a real
      `StreamingPostResumeStore` (not a bypassed/mocked store) during a
      normal successful run.
  - files: `packages/codex-arweave/src/library/streaming/
    uploadBundleStreaming.ts` (new), `packages/codex-arweave/tests/
    streaming-upload-bundle.test.ts` (new)

## Wave 2 (depends on Wave 1)

- [x] T3: Wire routing into `flow.ts`, add persistent progress state, and
      remove the cap. Read `packages/codex-arweave/src/panel/
      UploadWizard.tsx` in FULL first, specifically `onConfirmUpload`,
      the `phase`/`CostState`-style discriminated-union pattern already
      used for other async state in this file (mirror that exact pattern
      for the new progress state, don't invent a new state-shape
      convention), and the `MAX_TOTAL_SIZE_BYTES`/`totalSizeCapMessage`/
      `fileCapMessage` block (~lines 392-418, 833-853) this task removes
      for the streaming path.

      In `flow.ts`: `uploadAndTrack`/`uploadFilesAndTrack` call T1's
      `isStreamingUploadSupported()` once per upload action; when `true`,
      route to T2's `uploadBundleStreaming`/`uploadStreaming` (passing
      through the SAME already-derived encryption key this function
      already computes today — no behavior change to key derivation
      itself); when `false`, fall through to EXACTLY today's in-memory
      path, UNCHANGED, plus returning/surfacing a clear "streaming
      unsupported, size-limited fallback in use" signal the UI can show
      (exact mechanism — a return field, a thrown-and-caught sentinel, an
      options callback — is your call; document it).

      In `UploadWizard.tsx`: add a new progress state (mirror
      `CostState`'s discriminated-union shape) fed by `onProgress` threaded
      through from `uploadAndTrack`'s streaming branch down to
      `streamingPostBundle`'s own `onProgress` callback — plumb this
      through `UploadAndTrackOptions`/`UploadBundleStreamingOptions` as a
      new optional field, additive, not breaking the existing call shape.
      Render it as a PERSISTENT (not dismissible, not a toast) element
      during the `"uploading"` phase showing chunk/byte progress and the
      active stage (assembling / computing data_root / posting /
      resuming). Remove `MAX_TOTAL_SIZE_BYTES`'s block-on-add behavior
      when streaming is supported (detected once, cached for the wizard's
      session); when unsupported, KEEP an explicit, clearly-worded
      ceiling (ground an actual real number for the in-memory fallback
      path rather than keeping 1 GiB "because it was already there" —
      state your reasoning in the report either way) with honest messaging
      that this is a browser-support limitation, not an arbitrary product
      choice.

      Follow TDD: extend the existing `tests/e4-panel-upload-wizard.test.tsx`
      suite — write failing tests first for: streaming-supported + an
      upload exceeding today's old cap completes without being blocked;
      streaming-UNsupported (inject `false`) + the same oversized selection
      IS still blocked, with the new honest fallback message, not the old
      one verbatim (update/replace the old cap-message test expectations
      to match); progress state updates are rendered and persist across
      re-renders during an in-flight upload (drive a fake `onProgress`
      call and assert the DOM reflects it). Confirm red-for-the-right-reason
      first for each new/changed assertion, then implement.

      Done when: a real (fake-gateway-backed, at the test level) upload
      exceeding 1 GiB succeeds end-to-end through `UploadWizard` when
      streaming is supported; the unsupported fallback still enforces an
      explicit, honestly-messaged ceiling; progress is visibly rendered and
      persists throughout; full `codex-arweave` suite passes (unscoped,
      same one known pre-existing `node:sqlite` failure allowed); clean
      typecheck.
  - files: `packages/codex-arweave/src/library/flow.ts`,
    `packages/codex-arweave/src/panel/UploadWizard.tsx`,
    `packages/codex-arweave/tests/e4-panel-upload-wizard.test.tsx`,
    `packages/codex-arweave/tests/flow.test.ts` (or this package's actual
    existing flow test file — confirm its real name before editing)

## Wave 3 (depends on Wave 2)

- [x] T4: The disclaimer banner + documentation page stub, and the real-
      browser capstone proof for this sub-topic. Read
      `docs/work/arweave-streaming-ui/design.md`'s "disclaimer banner +
      documentation page" section. Check this app
      (`apps/codex-playground` and/or the real host app, whichever
      actually renders `UploadWizard` in production — ground which one
      before writing anything) for ANY existing precedent of serving a
      user-facing docs page (a route, a static asset, a modal) — follow
      that precedent if one exists; if genuinely none exists, build the
      SMALLEST reasonable thing (e.g. a dedicated route/component
      rendering a markdown-sourced explainer) rather than inventing new
      app infrastructure, and document the choice.

      Add a persistent (non-dismissible-and-forgotten — a static element,
      not a toast) info element in `UploadWizard.tsx`'s Files or Review
      step, plain language, explaining: large uploads now stream from
      disk instead of loading fully into memory; this requires OPFS
      browser support (named plainly, e.g. "your browser's private
      storage," not the API name) with the fallback behavior stated; a
      link to the documentation page. Create the documentation page with
      an initial section covering the general pipeline in plain terms,
      leaving an explicit placeholder section
      (`<!-- arweave-upload-dry-run: self-test section goes here -->` or
      your own clear marker) for the sibling `arweave-upload-dry-run`
      sub-topic to fill in later — do not invent content for that section
      yourself, it isn't built yet.

      Then run the real-browser capstone check for THIS sub-topic (same
      established CDP-driven-headless-Chromium convention as every prior
      sub-topic's final task): drive a real upload through the ACTUAL
      `UploadWizard` component (or the closest real integration point
      reachable in `apps/codex-playground`) big enough to have been
      blocked by the old 1 GiB cap, encrypted, against a faithfully-faked
      gateway, confirm it completes, confirm the progress element actually
      updates with real values during the run (not just that it's present
      in the DOM once), and confirm the resulting Library entry is
      shape-correct. Report exactly what was and wasn't verified, honestly,
      same bar as every prior real-browser report this project has
      produced.

  - files: `packages/codex-arweave/src/panel/UploadWizard.tsx`, one new
    documentation page/route (exact path decided at build time per the
    grounding above — document it clearly in the report so
    `arweave-upload-dry-run` can find and extend it), plus whichever
    throwaway verification script is needed (deleted after use).
