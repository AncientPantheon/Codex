# Bug report: checkpoint can regress backward on a pool-level retry — RESOLVED

**Status: RESOLVED (2026-10-04).** Independently confirmed (not just
trusted from this write-up) via a regression test showing the real
persisted sequence `[0, 1, 0, 1, 0, 1]` against today's pre-fix code —
`chunkIndex` regressing `1 → 0` on every one of the pool's 3 retry
attempts. Fixed with a monotonicity clamp at the real `saveCheckpoint`
construction site in `streamingPost.ts` (~line 296): a closure-local
`highestPersistedChunkIndex` that makes any write with a smaller
`chunkIndex` a no-op. Chosen over "read live checkpoint state per retry"
because that alternative would have silently changed documented behavior
— this module's own doc comment explicitly specifies a pool-level retry
restarts the ENTIRE post from scratch (mirroring the stock
`postArweaveData` path), never resuming a partial attempt across a
rotation; deriving `startChunkIndex` from live state on retry would have
quietly turned a "rotation" into a "resume," a bigger behavioral change
than this bug warranted fixing. The clamp fixes only the defect (progress
being erased from the persisted record) and leaves the restart semantics
untouched. Post-fix persisted sequence: `[0, 1, 1, 1]` — monotonic.
Regression test added to `packages/codex-arweave/tests/streaming-post.test.ts`
(proven to fail pre-fix, pass post-fix). Full `codex-arweave` suite: 880
passed, 1 skipped, same single pre-existing unrelated `node:sqlite`
failure. Also confirmed, as a useful scope-narrowing side-finding:
`resumeStreamingPost`'s own checkpoint write can never regress (every real
call site always passes `txPosted: true`, so the vulnerable branch is
unreachable from the resume path) — the defect had exactly one reachable
site, now fixed.

---

*Original report below, kept for history.*

## Discovered by

A side-finding during the `arweave-streaming-resume-opfs-corruption`
debug investigation (2026-10-04) — NOT the bug that investigation was
originally opened to chase (that one, a dry-run-gateway verification-harness
bug, is separately resolved; see that topic's `bug-report.md`). This is a
real, separate, narrow-window defect found along the way and deliberately
left unfixed there, per minimal-fix debugging discipline (one cause, one
change — this is a different cause).

## The mechanism (pinpointed, not a guess — exact file/line)

`packages/codex-arweave/src/library/streaming/streamingPost.ts`,
`postTxAndRemainingChunks` (~line 454-493), specifically:

```ts
if (!txAlreadyPosted) {
  await withAbort(api.postTransaction(tx), signal);
  await saveCheckpoint?.(startChunkIndex, true);   // <-- line ~469
}
```

This whole function is the thing `GatewayPool.execute` (default
`maxAttemptsPerEndpoint: 3`) wraps and retries on failure — confirmed
directly during the sibling investigation (that's the exact mechanism
that produced the "chunk 0 posted 3 times" symptom there). `execute`
re-invokes the SAME closure on each retry, with the SAME captured
`startChunkIndex`/`txAlreadyPosted` arguments from the ORIGINAL call —
never the live, currently-persisted checkpoint state.

Sequence that regresses the checkpoint:
1. Attempt 1: tx posts, `saveCheckpoint(0, true)` (fine — this is the
   first checkpoint). Chunk 0 posts successfully,
   `saveCheckpoint(1, true)` (chunk 0's real progress, correctly
   recorded). Chunk 1 then fails `MAX_CHUNK_RETRIES` times in place and
   the function throws.
2. `pool.execute` catches the throw and retries the WHOLE function from
   the top, with the ORIGINAL `startChunkIndex: 0`/`txAlreadyPosted: false`
   — NOT the real current progress (`chunkIndex: 1`).
3. `!txAlreadyPosted` is `true` again (stale closure value) → tx re-posts
   (harmless — idempotent id) → `saveCheckpoint(startChunkIndex=0, true)`
   runs again, **overwriting the persisted `chunkIndex` from 1 back down
   to 0** — a real regression of already-achieved, correctly-recorded
   progress.
4. Normally this self-heals within the same attempt: the chunk loop then
   re-posts chunk 0 (harmless/idempotent on a real gateway — confirmed by
   the sibling investigation) and re-saves `chunkIndex: 1` once it
   succeeds again, so by the time attempt 2 *completes*, the persisted
   state is correct again.

## The actual exposure (narrow, but real)

**If the process crashes/closes in the window between step 3's regressive
write and step 4's self-healing re-write** (e.g. right after
`saveCheckpoint(0, true)` persists, before the retried chunk loop gets far
enough to save `chunkIndex: 1` again), the PERSISTED resume record is left
at `chunkIndex: 0` even though chunk 0 (and possibly more) had already
been successfully posted and durably accepted by the gateway before the
crash. A later `resumeStreamingPost` call would then:
- Re-read chunk 0's source bytes from OPFS (wasteful, not wrong — the
  content is unchanged).
- Re-post chunk 0 (harmless/idempotent on a real gateway, per the same
  offset-addressed-chunk semantics the sibling bug's fix already
  documented).

So the practical blast radius is **wasted bandwidth/time re-posting
already-accepted chunks after an unlucky crash**, not actual data
corruption or a failed upload — but it is still a genuine, measurable
violation of this module's own documented guarantee ("never re-posts an
already-successful chunk," stated explicitly in this same file's
`StreamingPostOptions.saveCheckpoint` doc comment) for exactly the crash
scenario the whole resumability feature exists to protect against (a
closed laptop lid, a dropped connection) landing at an unlucky moment.

## Suggested fix direction (not yet applied, not yet verified — this is a
starting point for whoever picks this up, follow the same reproduce→
hypothesize→evidence→fix discipline rather than applying this blindly)

Make the checkpoint write monotonic: a `saveCheckpoint(chunkIndex,
txPosted)` call should never persist a SMALLER `chunkIndex` than what's
already durably recorded for this upload action. Candidate approaches:
- Guard inside whatever concretely implements the `saveCheckpoint`
  callback (check `uploadBundleStreaming.ts`/`streamingPostBundle`'s
  construction site for where this closure is actually built) — read the
  current persisted record before writing, skip or clamp a regressive
  write.
- Or: restructure so `pool.execute`'s retried closure reads the LIVE
  current checkpoint state (not a stale closure value) before deciding
  whether `txAlreadyPosted`/`startChunkIndex` apply on a given attempt.

Whichever direction is taken, write the regression test FIRST (prove it
fails against today's code — e.g. a pool stub that fails chunk 1 enough
times to trigger one outer retry, with a spy/real `StreamingPostResumeStore`
asserting the persisted `chunkIndex` is never observed to decrease across
the whole call), then apply the minimal fix, then confirm it passes.
