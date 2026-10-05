# Bug report: resumed multi-file bundle upload "corrupted" — RESOLVED

**Status: RESOLVED (2026-10-04).** The original framing of this bug report
was wrong — see "What actually happened" below. Kept for history; do not
re-open the OPFS/resume-engine investigation this file originally pointed
at without re-reading the resolution first.

## Original symptom (as reported by `arweave-upload-dry-run` T3's capstone)

A 3-file encrypted bundle, posted via `streamingPostBundle`, deliberately
interrupted after 1 chunk, then completed via `resumeStreamingPost`:
the reassembled bundle (captured chunks concatenated in POST-ORDER) was
corrupted — inflated by exactly 2×262144 bytes, later files'/manifest's
ANS-104 headers didn't parse, an independent Merkle-proof oracle reported
a real `data_root` mismatch. Originally believed to be specific to real
OPFS reopened across the interrupt→resume boundary, since it didn't
reproduce under Node against the fake in-memory assembly file.

## What actually happened (root cause, found by a full hypothesis-ranked
debug investigation, evidence chain in the investigation's own report)

**The upload was never corrupted. The dry-run engine's own verification
harness was mis-reassembling correct bytes.** The "only reproduces against
real OPFS" framing was a confound: the real-browser repro used the real
`createGatewayPool` (which retries each operation up to
`maxAttemptsPerEndpoint`, default 3, on failure), while every Node-level
test used `tests/e3-helpers.ts`'s `makeHealthPool()`, whose `execute` runs
an operation exactly once. Reproduced in Node, against the FAKE file, in
under a minute, just by swapping the pool — OPFS was never actually
involved.

**Real root cause**: `streamingPostBundle` wraps "post tx + every chunk
from index 0" in ONE `pool.execute` call. On the interruption (that test's
chunk 0 throws, by design, to force the resume path), the pool RETRIES the
whole operation up to 3 times before giving up and letting
`resumeStreamingPost` take over — so chunk 0 gets POSTED 3 TIMES before the
interruption is "accepted." On a real Arweave gateway, re-POSTing an
already-accepted chunk at the same `offset` is a documented no-op
(`streamingPost.ts`'s own comment already says so) — but
`packages/arweave-core/src/upload/localDryRunGateway.ts` (the dry-run
stand-in gateway) recorded posted chunks as a plain arrival-ordered
APPEND list, not keyed by `offset` — so 3 posts of chunk 0 became 3
entries in the captured list, not 1. `runUploadDryRun`'s byte
reassembly (`concatBytes(capturedChunks)`) then produced a payload with
chunk 0's bytes duplicated twice — exactly "2 extra 262144-byte chunks,"
the bug report's own signature.

Confirmed directly: deduping the captured list down to one entry per
`data_root` makes the independent `arweave-js` Merkle-proof oracle pass
and the deduped byte count match `data_size` exactly.

## Fix (applied, verified)

`packages/arweave-core/src/upload/localDryRunGateway.ts`: capture model
changed from `Map<dataRoot, Uint8Array[]>` (arrival order) to
`Map<dataRoot, Map<offset, bytes>>` (keyed by the chunk's real posted
`offset`, as a real gateway addresses chunks) — `getCapturedChunks`
returns entries sorted by ascending offset, deduplicated by construction.
Re-posting a known offset is now a true no-op, matching real gateway
semantics. **`streamingPost.ts`/`bundleAssemblyFile.ts`/
`StreamingPostResumeStore` were NOT touched** — they behaved correctly the
entire time; evidence showed the "corruption" was 100% in the
verification harness, not the upload engine.

Regression tests (`arweave-core/tests/local-dry-run-gateway.test.ts`,
`codex-arweave/tests/streaming-dry-run-upload.test.ts`, the latter pinned
to the REAL `createGatewayPool` specifically so this fidelity gap cannot
silently reopen) proven to fail pre-fix, pass post-fix. Real-browser
re-verification at both original bug-report scales (~460 KB/3 files,
6 MB/3 files) confirms `chunksPosted` dropped by exactly 2 at both scales
and `success: true`/`proofsValid: true` post-fix.

## A second, separate, genuine bug found along the way (NOT fixed here —
tracked separately)

`streamingPost.ts`'s checkpoint-save runs after EVERY tx-post attempt
(including retries), which can regress the persisted `chunkIndex` back to
0 on a pool retry. See `docs/work/arweave-streaming-checkpoint-regression/`
for the dedicated tracking of this one — it's real, narrow-window, and
was correctly left alone here per minimal-fix discipline (unrelated root
cause to this bug, and touching shared resume-engine code deserves its
own isolated fix + regression test, not a bundled change).
