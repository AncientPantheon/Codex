# Arweave Streaming UI — Project Design

## Problem

Four engines now exist, fully built and tested, that together can upload a
file set of arbitrary size with bounded memory:

1. `arweave-streaming-data-root` — streaming Merkle root computation.
2. `arweave-opfs-bundle-assembly` — incremental OPFS-backed bundle writing.
3. `arweave-streaming-post-core` / `-resume` — chunk-by-chunk posting,
   checkpointed and resumable.
4. `arweave-streaming-encryption` (in progress) — chunked AES-GCM so
   encrypted uploads don't fully materialize in memory either.

**None of them are reachable from the real app.** Grounded directly against
the real call chain: `UploadWizard.tsx`'s `onConfirmUpload` →
`library/flow.ts`'s `uploadAndTrack`/`uploadFilesAndTrack` →
`arweave-core`'s `uploadData`/`uploadBundle` — the original, fully-in-memory,
hold-everything-then-concat-then-sign-then-post path, completely untouched
by any of the four engines above. The 1 GiB cap
(`UploadWizard.tsx`'s `MAX_TOTAL_SIZE_BYTES`) exists specifically because
this real path still has no other ceiling. The owner has confirmed: BOTH
encrypted and unencrypted uploads must route through the new engines — no
permanent carve-out for either.

## Grounding

- **`onConfirmUpload`** (`UploadWizard.tsx` ~line 922): gates on
  `phase !== "uploading"`, unlocks the codex if needed, then calls
  `uploadFilesAndTrack(files, selection, accountId)` (bundle, 2+ files) or
  `uploadAndTrack(files[0], selection, accountId)` (single file), sets
  `phase` to `"uploading"` → `"done"`/`"error"`. No progress value exists
  today — `"uploading"` is a flat, numberless state.
- **`uploadAndTrack`** (`flow.ts`): for 2+ files, fully encrypts every file
  in memory (if `encryptFor` set) via `encryptFileForUpload`, THEN calls
  `uploadBundle(pool, bundleParams, {apiFactory})` (the original in-memory
  bundler/poster), THEN appends Library entries. For a single file, the
  analogous single-file path via `uploadData`.
- **No OPFS-support-detection helper exists anywhere in this codebase**
  (confirmed via exhaustive grep) — `bundleAssemblyFile.ts`'s
  `openOpfsBundleAssemblyFile` takes an **injectable** `getDirectory`
  function but has no "is this even available" check of its own; callers
  are expected to know. `UploadWizard.tsx` currently assumes nothing about
  OPFS at all — the in-memory path works everywhere by construction (no
  OPFS dependency), which is exactly why it's never had to detect anything.

## Approach

### 1. OPFS-support detection (new, small, grounded not assumed)

A seam, e.g. `isStreamingUploadSupported(): Promise<boolean>` — not just
"does `navigator.storage?.getDirectory` exist" (a false positive in some
restricted contexts), but an actual attempted open-and-discard of a
throwaway OPFS file, since the only reliable way to know a browser context
genuinely grants OPFS access (private browsing, iframe sandboxing, storage
quota denial) is to try it. Cheap (one tiny file, deleted immediately) and
run once per upload session, not per file.

### 2. Routing: one real upload action, two engines underneath

`uploadAndTrack`/`uploadFilesAndTrack` gain a routing branch: when
streaming is supported (per #1), build via the streaming engines
(`assembleBundleToFile` with `arweave-streaming-encryption`'s optional
`encryption` param when `encryptFor` is set, `computeStreamingDataRoot`,
`createStreamingTransaction`, `streamingPostBundle` with a resume record
persisted via `StreamingPostResumeStore`); when unsupported, fall back to
today's exact in-memory path unchanged — **with a visible, honest message**
that this fallback has a size limit (not a silent failure, not a
same-cap-forever situation masquerading as "fixed"). The CALLER-FACING
return shape (`UploadResult`/`UploadBundleResult`, and therefore the
Library entries built from it) must stay identical regardless of which
engine actually ran — this is an internal routing decision, not a new
public contract.

### 3. Persistent progress UI

`streamingPostBundle`/`resumeStreamingPost` already expose
`onProgress(uploadedChunks, totalChunks)`. `UploadWizard`'s `uploading`
phase becomes a real state carrying that progress (chunk counts, and a
derived byte/percentage figure), rendered as a persistent, always-visible
element for the duration of the upload — not a toast, not something a
stray click can dismiss and lose track of (the acceptance criterion the
parent `arweave-streaming-upload` design doc already locked in). Also
surfaces which stage is active (assembling / computing data_root / posting
/ resuming after an interruption) since those are now genuinely distinct,
separately-timed phases a large upload will visibly sit in.

### 4. Cap removal, honestly

Once streaming is live and this sub-topic's acceptance criteria are met,
`MAX_TOTAL_SIZE_BYTES` and its block-on-add UI in `UploadWizard.tsx` are
removed for the streaming path. The in-memory fallback path (OPFS
unsupported) keeps SOME explicit, clearly-messaged ceiling — ground the
actual number against real browser memory limits rather than keeping the
same 1 GiB by coincidence; state the reasoning either way in the build
report.

### 5. The disclaimer banner + documentation page

A short, factual, persistently-visible note in the Upload Wizard (not a
one-time dismissible toast) linking to a real documentation page that
describes the whole pipeline in plain terms: what streaming upload does,
why OPFS matters, what the dry-run/self-test feature (`arweave-upload-
dry-run`, a sibling sub-topic) is for and how to use it, and what happens
if OPFS isn't available. This is written for the owner (and any future
Codex user), not for engineers — plain language, no internal type/function
names. Exact placement (a new in-app docs route vs. a static `.md` served
from the repo vs. an external link) is a build-time decision, grounded
against how this app already serves any existing user-facing docs (check
for precedent before inventing a new mechanism).

## Acceptance criteria

- [ ] A real upload (both single-file and bundle, both encrypted and
      unencrypted) of a file set whose total size exceeds today's 1 GiB cap
      completes successfully through the real `UploadWizard` UI, with no
      cap blocking it, when OPFS is supported.
- [ ] When OPFS is unsupported, the exact same UI gracefully falls back to
      the existing in-memory path with a clear, honest message about its
      size limit — never a silent failure, never a confusing error.
- [ ] A persistent, always-visible progress indicator reflects real
      chunk/byte progress throughout a streaming upload, through every
      stage (assembly, data_root computation, posting), including after a
      resume.
- [ ] `Library` entries produced by a streaming upload are indistinguishable
      in shape from ones produced by the old in-memory path (same fields,
      same tag schema) — verified by direct comparison, not assumed.
- [ ] The Upload Wizard shows a persistent disclaimer/info element linking
      to a real documentation page describing the pipeline, reachable
      without leaving the upload flow.
- [ ] Full `codex-arweave`/`arweave-core` suites pass; clean typecheck both
      packages.

## Out of scope

- The actual dry-run/offline self-test feature — a sibling sub-topic,
  `arweave-upload-dry-run`, depends on this one's routing function existing
  but is planned/built separately.
- Streaming the DOWNLOAD/view path (`LibraryArea.tsx`) — still a known,
  separately-flagged gap (see `arweave-streaming-encryption`'s design doc).
- Any change to the Arweave protocol wire format, gateway API, or chunk
  size.
