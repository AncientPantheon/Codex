# Arweave Streaming Worker Wiring — Project Design

## Problem

`arweave-streaming-ui`'s T4 real-browser capstone check just proved,
empirically, three independent ways, that the entire streaming-upload
engine built this session (`arweave-streaming-data-root`,
`arweave-opfs-bundle-assembly`, `arweave-streaming-post-core/-resume`,
`arweave-streaming-encryption`, and `arweave-streaming-ui` T1-T3's own
routing) is **unreachable in real production use today**:

`FileSystemFileHandle.createSyncAccessHandle()` — the primitive
`isStreamingUploadSupported()` and `bundleAssemblyFile.ts` both call —
throws `"... is not a function"` when called from the main document thread
(exactly how `UploadWizard.tsx`'s mount effect and `library/flow.ts`'s
`uploadAndTrack` both call it today) and only succeeds inside a dedicated
Worker. Net effect: `isStreamingUploadSupported()` always resolves `false`
in real production use; every real upload today silently takes the
2 GiB-capped in-memory fallback path, and the whole, fully-tested streaming
engine is dead code from the real user's point of view. This is a hard
blocker on the owner's explicit ask ("so that it is live on the codex") and
on the planned `arweave-upload-dry-run` feature, which would hit the exact
same wall.

## Grounding

- `packages/codex-arweave/src/keygen/worker.ts` + `KeygenRunner.ts` are
  this exact codebase's own existing, working precedent for "heavy/
  Worker-only work, driven from the main thread": a deliberately **thin,
  TDD-exempt** worker entry file (`worker.ts`, its own doc comment says so
  explicitly — "the seam, the fake, and the typed narrowing carry the
  tested logic") that does nothing but postMessage plumbing around an
  already-tested library call, plus a fully-tested main-thread seam
  (`KeygenRunner.ts`) exposing: a `WorkerLike` structural interface, an
  injectable `workerFactory: () => Worker` option (never a hardcoded `new
  Worker(new URL(...))` — the file's own module comment states this is
  deliberate, for testability), a discriminated-union message protocol
  type (`KeygenWorkerMsg`), and both a real (`createWorkerKeygenRunner`)
  and fake (`FakeKeygenRunner`) implementation of a shared `KeygenRunner`
  interface.
- `CryptoKey` values ARE structured-cloneable across `postMessage` per the
  HTML spec's serializable-object list, REGARDLESS of their `extractable`
  flag — confirmed, not assumed, against the spec (this matters: the
  already-derived AES key for an encrypted upload can cross into the
  Worker directly; it does not need to be re-derived there, and the
  Ouronet account secret/bitstring it was derived from never needs to
  leave the main thread at all).
- `File`/`Blob` objects are likewise structured-cloneable across
  `postMessage` (the browser clones the underlying blob reference, not a
  byte-for-byte copy up front) — the file set the user picked in
  `UploadWizard` can be handed into the Worker directly.
- **What canNOT cross a Worker boundary**: `encryptFor.revealAccountSecret`
  (`flow.ts`'s `EncryptForOptions`) is a live CALLBACK FUNCTION the host
  app injects to reveal an Ouronet account's secret — functions are not
  structured-cloneable. `uploadAndTrack`'s own `resolveEncryptionKey(
  encryptFor)` step (which calls this callback, then
  `deriveAccountAesKey`) MUST stay on the main thread; only its OUTPUT (an
  already-derived `CryptoKey`, or `undefined`) crosses into the Worker.
- T4 also found, and deliberately did NOT fix (correctly, since the real
  fix is this entire sub-topic): a missing Worker `Buffer` polyfill —
  `arbundles`' signer construction references the bare `Buffer` global,
  which `apps/codex-playground/src/polyfills.ts` only installs on the main
  thread (`main.tsx`'s first import); a separately-spawned Worker has its
  own global scope and never sees it.

## Approach

### 1. Factor the resolved-key upload logic out of `uploadAndTrack`

In `library/flow.ts`, extract the part of `uploadAndTrack`/
`uploadFilesAndTrack` that runs AFTER `resolveEncryptionKey` into a
separately-exported function (e.g. `performUploadAndTrack(params,
resolvedKey: CryptoKey | undefined, opts)`) — pure refactor, zero behavior
change. The existing public `uploadAndTrack` becomes a thin wrapper:
resolve the key (unchanged, still calls the real callback), then call
`performUploadAndTrack`. Every existing test for `uploadAndTrack` must
keep passing completely unmodified — this is the regression bar proving
the refactor is behavior-preserving. This factored function is what both
the existing main-thread callers AND the new Worker entry call.

### 2. The thin Worker entry

`packages/codex-arweave/src/library/streaming/uploadWorker.ts` — mirrors
`keygen/worker.ts`'s thinness exactly (TDD-exempt by the same convention:
"the seam, the fake, and the typed narrowing carry the tested logic").
Receives a `{ kind: "start", params, resolvedKey? }`-shaped message
(files, selection fields, the ALREADY-DERIVED key or `undefined` —
NEVER `encryptFor`/a callback), installs the `globalThis.Buffer` guarded
polyfill (mirrors `polyfills.ts`'s own convention, fixing T4's documented
gap, scoped to this one entry file), calls `performUploadAndTrack`, posts
back a discriminated-union progress/done/error protocol (mirror
`KeygenWorkerMsg`'s shape: `{kind: "progress", ...}` / `{kind: "route",
route: "streaming"|"fallback"}` / `{kind: "done", result}` / `{kind:
"error", message}`).

### 3. The main-thread runner seam

Mirrors `KeygenRunner.ts`'s pattern exactly: a `WorkerLike` structural
interface, `workerFactory: () => Worker` (injectable, never hardcoded), a
`StreamingUploadRunner` interface, `FakeStreamingUploadRunner` (for
`UploadWizard`'s own tests — no real Worker needed there), and
`createWorkerStreamingUploadRunner(options)` wrapping the postMessage
protocol into a `Promise` plus a progress callback. Fully TDD'd against a
`WorkerLike` fake (no real browser needed at this level — same as
`KeygenRunner.ts`'s own tests).

### 4. Wire the HOST ADAPTER, not `UploadWizard.tsx`

**Corrected after T3's first dispatch attempt found the real seam
(2026-10-03):** `UploadWizard.tsx` is a pure, host-injected-callback
component — confirmed by reading it in full — it never imports
`library/flow.ts`, never holds a `store`/real signing `jwk`, and already
builds a `UploadWizardUploadCallbacks { onProgress?, onRouteDecided? }`
object (built in `arweave-streaming-ui` T3) that it passes as an optional
4th argument to its injected `uploadAndTrack`/`uploadFilesAndTrack` props,
with its own doc comment stating the expectation that "whoever supplies
these props forwards both callbacks straight into `library/flow.ts`'s own
`uploadAndTrack` options." **That forwarding was never actually built.**
The real implementation of those props,
`apps/codex-playground/src/realArweaveAdapter.ts`'s `uploadAndTrack`/
`uploadFilesAndTrack` closures, take only 3 parameters (no `callbacks`
at all) — TypeScript's contravariant parameter-count assignability rule
lets a 3-parameter function satisfy a 4-parameter prop type silently, so
this compiles clean while quietly dropping every `onProgress`/
`onRouteDecided` callback UploadWizard ever passes. These closures
already hold the real `jwk`/`store`/`resolvedPool` and call
`library/flow.ts`'s real `uploadAndTrack` directly, on the main thread —
exactly the call site that needs to switch to the new Worker-backed
runner.

So the actual fix lives in **`apps/codex-playground/src/realArweaveAdapter.ts`**
(plus exporting `flow.ts`'s already-existing, currently-unexported
`resolveEncryptionKey(encryptFor): Promise<CryptoKey>` for the adapter to
call directly): accept the 4th `callbacks` parameter; resolve
`selection.encryptFor` into a `CryptoKey | undefined` via
`resolveEncryptionKey` on the main thread (unchanged — the live
`revealAccountSecret` callback cannot cross a Worker boundary); construct
a `createWorkerStreamingUploadRunner` and call
`.run(params, resolvedKey, {store, pool, onRoute: callbacks?.onRouteDecided,
onProgress: callbacks?.onProgress})` instead of calling `library/flow.ts`'s
`uploadAndTrack` directly. `UploadWizard.tsx` itself needs **zero changes** —
it was already built correctly for this; the gap was entirely on the host
adapter's side.

### 5. Real-browser re-verification

Rerun a T4-style capstone check, this time confirming
`isStreamingUploadSupported()` genuinely resolves `true` from inside the
real Worker in a real browser (not faked, not assumed) — this is the one
thing that was never actually true until this sub-topic ships — and that a
real `UploadWizard` upload genuinely posts `route: "streaming"`, not
`"fallback"`, end to end.

## Acceptance criteria

- [ ] `isStreamingUploadSupported()`, called for real inside the real
      Worker entry built here, resolves `true` in a real browser —
      verified directly, not inferred.
- [ ] A real `UploadWizard` upload (encrypted and unencrypted, exceeding
      the old 2 GiB fallback cap) completes via the `"streaming"` route in
      a real browser, proven by a real-browser check, not just by unit
      tests against a fake worker.
- [ ] `uploadAndTrack`'s existing public behavior and full existing test
      suite are completely unchanged (the refactor in step 1 is provably
      behavior-preserving).
- [ ] The progress UI continues to render live, updating values during a
      real Worker-backed upload (not just once).
- [ ] Full `codex-arweave`/`arweave-core` suites pass; clean typecheck both
      packages.

## Out of scope

- Any change to the already-built streaming engines themselves
  (`assembleBundleToFile`, `computeStreamingDataRoot`,
  `createStreamingTransaction`, `streamingPostBundle`/
  `resumeStreamingPost`) beyond the one Worker-context `Buffer` polyfill
  fix already identified.
- Performance tuning for very large (multi-GiB) real uploads — T4 flagged
  an unexplained slowdown/memory blowup on a ~1.17 GiB real fixture that
  was never root-caused; that remains a separately-tracked open question,
  not something this sub-topic claims to fix.
- `arweave-upload-dry-run`'s own feature work — that sub-topic depends on
  this one being complete (its dry-run engine would hit the identical
  Worker-only wall otherwise) but is planned/built separately.
