This sub-topic is a hard blocker: `arweave-upload-dry-run` depends on it being complete (its
dry-run engine would hit the identical Worker-only OPFS wall otherwise). Do not start
`arweave-upload-dry-run` until every task below is `[x]`.

## Wave 1

- [x] T1: Factor `performUploadAndTrack` out of `uploadAndTrack`, and
      build the thin Worker entry. Read `packages/codex-arweave/src/
      library/flow.ts` in FULL first — both branches of `uploadAndTrack`/
      `uploadFilesAndTrack`, and `resolveEncryptionKey`. Read
      `packages/codex-arweave/src/keygen/worker.ts` in full for the exact
      "thin, TDD-exempt entry" style to mirror (its own module doc comment
      explains why it's thin and untested directly).

      In `flow.ts`: extract everything that currently runs AFTER
      `resolveEncryptionKey` resolves (in both the bundle and single-file
      branches) into a new exported function, e.g.
      `performUploadAndTrack(params: UploadAndTrackParams, resolvedKey:
      CryptoKey | undefined, opts: PerformUploadAndTrackOptions):
      Promise<UploadAndTrackResult>` — a PURE REFACTOR, zero behavior
      change. `uploadAndTrack` itself becomes: resolve the key (unchanged
      — still calls the real `encryptFor.revealAccountSecret` callback),
      then call `performUploadAndTrack`. Every existing test for
      `uploadAndTrack`/`uploadFilesAndTrack` in `tests/e3-library-flow.test.ts`
      must pass COMPLETELY UNMODIFIED — this is the regression bar proving
      the refactor is behavior-preserving. If you find you need to touch
      even one existing assertion to make this pass, STOP and reconsider
      the refactor boundary — that's a signal of an accidental behavior
      change, not a cosmetic one.

      Then build `packages/codex-arweave/src/library/streaming/
      uploadWorker.ts` — a thin Worker entry (TDD-exempt, same convention
      as `keygen/worker.ts`): on a `{kind: "start", params, resolvedKey?}`
      message, install a guarded `globalThis.Buffer` polyfill (mirror
      `apps/codex-playground/src/polyfills.ts`'s exact
      `globalThis.Buffer = globalThis.Buffer ?? Buffer` convention,
      scoped locally to this file — this is the fix for the Worker
      `Buffer` gap `arweave-streaming-ui` T4 found and deliberately left
      unfixed, flagging it for here), then calls `performUploadAndTrack`,
      posting back a discriminated-union protocol mirroring
      `KeygenWorkerMsg`'s shape: `{kind: "route", route: "streaming" |
      "fallback"}` (fired once `isStreamingUploadSupported()` resolves
      inside the worker, BEFORE the upload itself proceeds), `{kind:
      "progress", uploadedChunks, totalChunks}`, `{kind: "done", result}`,
      `{kind: "error", message}`.

      Write NEW unit tests (not a modification of the existing ones)
      directly invoking `performUploadAndTrack` with an already-resolved
      key, covering at minimum: an encrypted call with a real derived key
      behaves identically to calling `uploadAndTrack` with the matching
      `encryptFor` (same result shape, same posted tags); an unencrypted
      call with `resolvedKey: undefined` behaves identically to omitting
      `encryptFor` from `uploadAndTrack`. Confirm red-for-missing-export
      first, then implement.

      Done when: `performUploadAndTrack` exists and is called by the
      unchanged-behavior `uploadAndTrack`; the FULL pre-existing
      `e3-library-flow.test.ts` suite passes with ZERO modifications; new
      tests prove `performUploadAndTrack` is behaviorally equivalent to
      the pre-refactor inline logic; `uploadWorker.ts` exists, compiles,
      and is structurally reviewed (not unit-tested, per the TDD-exempt
      convention) to confirm it correctly installs the `Buffer` polyfill
      before any import that needs it and posts the documented message
      shapes.
  - files: `packages/codex-arweave/src/library/flow.ts`,
    `packages/codex-arweave/src/library/streaming/uploadWorker.ts` (new),
    `packages/codex-arweave/tests/streaming-perform-upload-and-track.test.ts`
    (new)

## Wave 2 (depends on Wave 1)

- [x] T2: The main-thread runner seam. Read `packages/codex-arweave/src/
      keygen/KeygenRunner.ts` in FULL first — this is the EXACT pattern to
      mirror: `WorkerLike` structural interface, injectable `workerFactory:
      () => Worker` option (never a hardcoded `new Worker(new URL(...))`),
      a discriminated-union message-protocol type, a shared runner
      interface with both a real (`createWorker...`) and fake
      (`Fake...Runner`) implementation.

      Build, in a new file `packages/codex-arweave/src/library/streaming/
      StreamingUploadRunner.ts`:
      - `StreamingUploadWorkerMsg` — the discriminated union T1's worker
        posts (`route`/`progress`/`done`/`error`), matching T1's real
        shape exactly (re-read `uploadWorker.ts` fresh, don't guess).
      - `WorkerLike` — mirror `KeygenRunner.ts`'s own interface verbatim
        (same minimal `postMessage`/`onmessage`/`terminate` surface).
      - `StreamingUploadRunner` interface: a single method, e.g.
        `run(params, resolvedKey, opts: {onRoute?, onProgress?}):
        Promise<UploadAndTrackResult>`.
      - `FakeStreamingUploadRunner implements StreamingUploadRunner` —
        synchronous/deterministic, for `UploadWizard`'s own tests, mirror
        `FakeKeygenRunner`'s shape and configurability (success/error
        injection, programmable progress events).
      - `createWorkerStreamingUploadRunner(options: { workerFactory: () =>
        Worker }): StreamingUploadRunner` — the real implementation:
        constructs the worker via the injected factory, posts the
        `{kind:"start",...}` message, wires `onmessage` to resolve/reject
        the returned promise and invoke `onRoute`/`onProgress` as the
        corresponding messages arrive, terminates the worker on
        completion (success or error) — mirror `createWorkerKeygenRunner`'s
        exact lifecycle handling.

      Follow TDD: write failing tests first (using a `WorkerLike` fake you
      construct in the test, exactly as `KeygenRunner.test.ts`-equivalent
      tests already do for keygen — find and read that existing test file
      for the convention) covering: a successful run resolves with the
      posted `done` result and fires `onRoute`/`onProgress` in the right
      order; an `error` message rejects the returned promise with that
      message; the worker is terminated after both success and error.
      Confirm red-for-missing-module first, then implement.

      Done when: `FakeStreamingUploadRunner` and the real
      `createWorkerStreamingUploadRunner` both satisfy the same
      `StreamingUploadRunner` interface (checked by `tsc`, not just "it
      compiles with `any`"), and the real implementation's full
      message-protocol lifecycle (route → progress → done/error →
      terminate) is proven against a `WorkerLike` fake.
  - files: `packages/codex-arweave/src/library/streaming/
    StreamingUploadRunner.ts` (new), `packages/codex-arweave/tests/
    streaming-upload-runner.test.ts` (new)

## Wave 3 (depends on Wave 2)

- [x] T3 (ORIGINAL, WRONG FILE SCOPE — superseded by T3-revised below,
      kept for history): attempted against `UploadWizard.tsx` directly.
      Blocked and correctly aborted with zero edits: that component never
      touches `flow.ts`/`store`/a real signing `jwk` — it's a pure
      host-injected-callback component. The real seam is the host
      adapter. `design.md`'s §4 has been corrected accordingly. See
      T3-revised.

- [x] T3-revised: Wire the HOST ADAPTER to the runner (the real seam —
      see `design.md`'s corrected §4 for the full grounding of WHY this,
      not `UploadWizard.tsx`, is the right place). Read, in full:
      `apps/codex-playground/src/realArweaveAdapter.ts` (specifically the
      `uploadAndTrack`/`uploadFilesAndTrack` closures — note they
      currently take only 3 parameters, no `callbacks`, and call
      `library/flow.ts`'s real `uploadAndTrack` directly on the main
      thread with the real `jwk`/`store`/`resolvedPool` they already
      hold), `packages/codex-arweave/src/panel/UploadWizard.tsx`'s
      `UploadWizardUploadCallbacks`/`UploadWizardProps.uploadAndTrack`
      type (confirm — don't just trust this plan — that it already
      passes `callbacks` as an optional 4th argument; this component
      itself needs NO changes), `library/flow.ts`'s `resolveEncryptionKey`
      (currently unexported — read its real signature) and
      `performUploadAndTrack`, and T2's `StreamingUploadRunner.ts`
      (`StreamingUploadRunner`/`createWorkerStreamingUploadRunner`/
      `StreamingUploadRunnerOptions`'s real current shape).

      1. In `packages/codex-arweave/src/library/flow.ts`: export
         `resolveEncryptionKey` (additive — just add `export` to the
         existing declaration; zero behavior change, confirm by re-running
         the full existing `flow.ts` test suite unmodified).
      2. In `apps/codex-playground/src/realArweaveAdapter.ts`: give
         `uploadAndTrack`/`uploadFilesAndTrack` a 4th optional `callbacks`
         parameter (matching `UploadWizardUploadCallbacks`'s real shape).
         Inside each: resolve `selection.encryptFor` via the now-exported
         `resolveEncryptionKey` (main thread, unchanged — the live
         `revealAccountSecret` callback cannot cross a Worker boundary;
         `undefined` key when `encryptFor` is absent). Construct a
         `createWorkerStreamingUploadRunner({ workerFactory: () => new
         Worker(new URL("@ancientpantheon/codex-arweave/library/streaming/
         uploadWorker.js" /* or whatever the real resolvable specifier/
         relative path actually is from THIS file — ground it, don't
         guess; it may need to be a relative path into the package's
         source or dist depending on how this app resolves that package
         today */, import.meta.url), { type: "module" }) })` and call
         `.run(params, resolvedKey, { store, pool: resolvedPool, onRoute:
         callbacks?.onRouteDecided, onProgress: callbacks?.onProgress })`
         INSTEAD OF calling `libraryUploadAndTrack` (= `flow.ts`'s
         `uploadAndTrack`) directly. Keep the existing
         `decryptArweaveKey`/`bufferedFeeCap`/bundle-vs-single-file
         result-shape-guard logic exactly as it is — only the actual
         upload-performing call changes.

      Follow TDD: `apps/codex-playground/tests/codex-backup-wiring.test.ts`
      and `tests/arweave-restore-eligibility-wiring.test.ts` (both already
      exercise `uploadAndTrack`/`uploadFilesAndTrack` on this adapter —
      confirmed via grep) are your regression bar; extend whichever is the
      more natural fit (or add a focused new test file if neither fits
      well — your call, document it) with failing tests FIRST covering:
      `callbacks.onRouteDecided`/`callbacks.onProgress` are actually
      invoked (inject a `FakeStreamingUploadRunner`-equivalent seam —
      you'll likely need to make the runner constructor/instance
      injectable on the adapter's own options for this, mirroring how
      `pool`/`store` are already injectable there); an encrypted call
      still produces the exact same result shape as before (oracle:
      compare against calling `library/flow.ts`'s real `uploadAndTrack`
      directly with the same inputs, same technique prior sub-topics in
      this project used for shape-parity proofs). Confirm red-for-the-
      right-reason first, then implement, then confirm green.

      Done when: `callbacks.onProgress`/`onRouteDecided` are genuinely
      invoked end-to-end from the adapter (proven by a test, not assumed);
      the adapter's upload-performing call site goes through
      `StreamingUploadRunner`, not a direct `flow.ts` call; result shape
      is unchanged for both single-file and bundle, encrypted and
      unencrypted; the real default `workerFactory`'s Worker-construction
      expression resolves correctly for this app's bundler (confirm via
      `apps/codex-playground`'s own typecheck/build staying clean — a
      full real-browser proof is NOT required here, that's T4).
  - files: `packages/codex-arweave/src/library/flow.ts` (the one-line
    export), `apps/codex-playground/src/realArweaveAdapter.ts`, plus
    whichever existing `apps/codex-playground/tests/*.test.ts` file you
    extend (or, if genuinely warranted, one new focused test file in that
    same directory — document the choice).

## Wave 4 (depends on Wave 3)

- [x] T4: The real-browser re-verification — this is the actual payoff
      proof for the whole sub-topic. Reuse the established throwaway-CDP
      convention. Drive the real `UploadWizard` (same integration approach
      `arweave-streaming-ui` T4 used) through an encrypted multi-chunk
      upload, and this time confirm, directly and for real (not faked):
      - `isStreamingUploadSupported()`, called from inside the REAL
        worker this sub-topic wires up, resolves `true`.
      - The upload's posted/observed route is `"streaming"`, not
        `"fallback"`.
      - The progress element updates live with real changing values
        during the run.
      - The resulting data is shape-correct (same oracle-comparison
        technique prior real-browser tasks used).

      If a genuine bug surfaces (the Worker `Buffer` gap should already be
      fixed by T1, but confirm this for real here — don't just trust the
      unit-level fix), fix it in whichever real file needs it, rerun both
      packages' full suites + typechecks, and report the deviation
      clearly, per this project's established discipline.

      Report honestly: does this fully resolve the "unreachable in
      production" finding from `arweave-streaming-ui` T4, or does
      something new surface? Also: does the ~1.17 GiB slowdown T4 flagged
      (and explicitly left unexplained) reproduce here now that the real
      Worker path is actually exercised, or was that slowdown itself an
      artifact of running OPFS/signing on the main thread (which this
      sub-topic moves off of)? Investigate this specifically if time
      allows — it would be a meaningful, relevant finding either way.

  - files: none expected to persist (throwaway verification script,
    deleted after use) — any genuine bug fix goes in whichever real file
    needs it, clearly flagged.
