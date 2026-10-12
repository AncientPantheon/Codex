# Arweave Split-Bundle Upload — Project Design

## Problem

A bundle upload needs its whole concatenated byte stream to exist in OPFS
staging before it can be hashed and posted (one shared Merkle tree over
everything) — so a bundle's peak disk usage is roughly its own total size.
A user with less free disk space than their upload's total size cannot
bundle it in one pass, and the real-world case motivating this (a
120 GB folder, 48 GB free) is not a hypothetical.

The two alternatives considered and rejected in the owner conversation
that shaped this:
- **Let the user point staging at an arbitrary chosen drive.** Not
  buildable as a fast path — `createSyncAccessHandle()`, the primitive
  the whole pipeline's speed depends on, is restricted to OPFS in every
  current browser; it throws on a folder chosen via the regular picker.
- **Upload every file as its own fully independent transaction.** Removes
  the disk-space problem almost entirely, but reintroduces real
  throughput cost (thousands of separate anchor/price/tx/chunk round
  trips, mostly sequential overhead) that the owner correctly flagged as
  a real regression, for no actual benefit — rebuild/Library-load cost
  turns out to be identical either way (`queryOwnerUploads` already
  enumerates individual file-level entries whether they're independent
  transactions or bundle members, since Arweave gateways index bundle
  contents individually by tag — confirmed by reading `rebuild/query.ts`
  directly), so independent transactions traded away bundling's real
  throughput advantage for a rebuild-cost benefit that doesn't exist.

## Approach

**Keep bundling. Split automatically into the minimum number of
roughly-equal bundles that each fit within a safe free-space budget,
instead of one all-or-nothing bundle.** For an in-budget upload (the
common case), behavior is unchanged — still exactly one bundle, exactly
today's path. Splitting only activates when the total genuinely exceeds
what's safely available.

### 1. Free-space check + bundle-splitting planner

A real check against `navigator.storage.estimate()` (`{usage, quota}` for
the origin) computes a safe per-attempt byte budget (with real margin
below the raw quota estimate — the estimate itself is approximate, and
OPFS needs room for more than just the bundle's own final size during
assembly). A pure planner function then partitions the selected file list
into K groups: `K = ceil(totalSize / budget)`, target size per group =
`totalSize / K` (even division, not greedy-fill-then-dump-remainder), so
K bundles come out roughly equal-sized, matching the owner's own stated
expectation ("3 equal sized transactions").

**Known, explicitly out-of-scope edge case**: a SINGLE file larger than
the per-bundle budget cannot be split under this architecture (bundling
boundaries are per-file, not per-byte-within-a-file) — such a file gets
its own, over-budget bundle, with a clear warning surfaced rather than a
silent failure or a crash. A true fix (streaming a single large file's
data_root/post directly from its own source location, using a stored-IV
replay trick to avoid re-staging encrypted content on the second pass, so
even a 100 GB single file needs only kilobytes of scratch space) is a
real, separate, future improvement — not built in this round.

### 2. Standalone manifest-only upload

A new, small primitive: posts a manifest (the SAME `arweave/paths` JSON
format already used inline inside a single bundle, built from a flat
`{path, id}[]` list spanning ALL K bundles' files, not just one) as its
OWN top-level transaction — reusing `buildUploadTags`'s already-generic
`itemType: "manifest"` support, tagged with the SAME `Codex-Upload-Id`
value shared by every one of the K bundles' files, so the whole K+1-
transaction sequence is recognizable as one logical upload action. No
bundle-building needed for this step — a manifest is tiny JSON, posted as
a plain, non-chunked (or trivially-chunked) native transaction.

### 3. Multi-bundle sequential orchestration + cross-sequence resumability

Runs the K bundles ONE AT A TIME (never concurrently — concurrent bundles
would need concurrent OPFS staging, defeating the whole point), reusing
the EXISTING, unmodified per-bundle engine (`uploadBundleStreaming`/
`streamingPostBundle`/its own resume mechanism) for each one — each
bundle's OPFS file is fully used, posted, and released before the next
bundle's assembly starts. Once every bundle's files are posted, posts the
final manifest (step 2).

A new, small persisted "plan" record (mirroring `StreamingPostResumeStore`'s
existing IndexedDB convention) tracks: the computed K-way file grouping
(decided once, up front — never recomputed mid-run, so a reload doesn't
reshuffle which files belong to which bundle), which bundles have fully
completed, and the shared `uploadId`/manifest-tag-list accumulated so
far. On a crash/reload mid-sequence: already-completed bundles are
skipped entirely (never re-signed, never re-posted — mirrors the
per-bundle resume engine's own guarantee, one level up); an in-flight
bundle resumes via the EXISTING single-bundle resume mechanism, unchanged;
remaining not-yet-started bundles continue in order; the manifest only
ever posts once, after every bundle is confirmed complete.

### 4. UI

Before starting, if splitting is needed, the Upload Wizard shows the plan
plainly ("your N GB selection will upload as K bundles of about M GB
each, based on your available storage") rather than silently proceeding.
A single, unified progress indicator spans the WHOLE sequence — "Bundle 2
of 3 — chunk 450/900" plus an overall "55% of total upload" figure
computed from bytes-across-all-bundles, not a progress bar that resets to
0% at the start of every bundle (explicitly requested by the owner).

## Acceptance criteria

- [ ] A selection that fits within the free-space budget uploads as
      exactly one bundle, byte-for-byte identical behavior to today —
      zero regression to the common case.
- [ ] A selection exceeding the budget automatically splits into the
      minimum K, roughly-equal-sized bundles (verified: no K-1-bundle
      plan could have fit every bundle within budget).
- [ ] All K bundles' files are covered by exactly ONE shared manifest,
      correctly referencing every file's real final id and path.
- [ ] The progress indicator reflects whole-sequence progress throughout
      — verified it does not reset/restart visually at each bundle
      boundary, and an "overall" figure is accurate against total bytes.
- [ ] A simulated crash/reload partway through a multi-bundle sequence
      resumes correctly: completed bundles are never re-signed/re-posted,
      the in-flight bundle resumes from its real last checkpoint, and the
      manifest posts exactly once, only after genuine full completion.
- [ ] A single file larger than the per-bundle budget is handled with an
      explicit, honest warning — never a silent failure, never a crash.
- [ ] Full real-browser verification at a representative (if scaled-down)
      multi-bundle scenario, not just unit-level.

## Out of scope

- Splitting a single file's own data across multiple transactions/bundles
  (see the known edge case above — flagged, not solved, this round).
- The "user-chosen alternate scratch drive" and "fully independent
  per-file transactions" directions — both superseded by this approach.
- Concurrent/parallel bundle uploads (deliberately sequential, since
  concurrent bundles would need concurrent full-bundle OPFS staging,
  reintroducing the original space problem).
