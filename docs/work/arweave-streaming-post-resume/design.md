# Arweave Streaming Post Resume — Design

Sub-topic 2 of `docs/work/arweave-streaming-post/design.md`. Depends on
sub-topic 1 (`arweave-streaming-post-core`, built) — adds persisted
resumability on top of the now-working, uninterrupted streaming post
path, plus the full real-browser end-to-end proof.

## Problem

`packages/codex-arweave/src/library/streaming/streamingPost.ts` (built
this session) has no persisted progress — a browser close, crash, or
reload mid-upload means the entire multi-gigabyte upload restarts from
chunk 0, including re-signing the transaction, defeating much of this
architecture's purpose for exactly the large, long-running uploads it
exists for.

## Approach

**Reuse, don't invent, this project's existing IndexedDB seam.**
`packages/codex-arweave/src/library/types.ts`'s `IdbDatabaseLike`/
`IdbOpenDbRequestLike` (injectable, `fake-indexeddb`-driven under Node
for tests) and `packages/codex-arweave/src/library/indexedDbStore.ts`
(the existing concrete store built on those seams) are the established
pattern — mirror `indexedDbStore.ts`'s structure exactly for a new
resume-record store, not a new persistence convention.

**What gets persisted, minimal and small** (never the bulk bundle
bytes — those stay in OPFS, already durable on their own): the OPFS
file's name (to reopen it), the already-signed transaction's
serializable fields (owner, tags, target, quantity, reward, last_tx,
signature, id, data_root, data_size — everything needed to reconstruct
the SAME `SignedStreamingTransaction` without re-signing), the
`chunks`/`proofs` metadata (small, independent of total data size
beyond chunk count), `chunkIndex` (how many chunks have been
successfully posted so far), and `txPosted` (whether the initial
transaction-post step succeeded). Written incrementally as the loop
progresses — ground the exact write cadence during implementation (e.g.
after every chunk, or batched, trading IndexedDB write volume against
how much could be redone after an ungraceful crash).

**Resuming**: given a resume-record id, reload the record, reopen the
same-named OPFS file, reconstruct the signed transaction directly from
the persisted fields (no `createStreamingTransaction`/signing call at
all — that's the whole point), and continue the SAME streaming post
loop from the persisted `chunkIndex`/`txPosted` — must never re-post an
already-successful chunk, never re-sign, never re-read original source
files.

**Completion**: once every chunk posts successfully, the resume record
is cleared. What happens to the OPFS bundle file itself on completion
(delete it, leave it) is a policy decision — default to deleting it
(nothing further needs it once posted), but make this an explicit,
overridable option rather than a silent hardcoded choice.

**The capstone real-browser proof**: a genuine, driven-browser,
end-to-end run — assemble a real multi-file bundle into OPFS, compute
its streaming `data_root`, post it with a simulated interruption partway
through (kill the loop after N chunks), resume from the persisted
record, and confirm completion against a real or faithfully faked
gateway — proving the WHOLE pipeline (not each piece in isolation,
already proven) works together. Same throwaway-script convention
already used twice this session for real-browser checks, not new
permanent test infrastructure.

## Acceptance criteria

- [ ] A resume record persists after a configurable point in the
      streaming post loop's progress (at minimum, after the initial
      transaction post and after each successfully-posted chunk).
- [ ] Resuming from a persisted record never re-signs the transaction,
      never re-reads the original source files, and never re-posts a
      chunk index already confirmed successful.
- [ ] A simulated mid-upload interruption and resume reaches the exact
      same final transaction id/completion state as an uninterrupted
      run of the same input would.
- [ ] The resume-record store follows the exact same
      `IdbDatabaseLike`-seam pattern `indexedDbStore.ts` already
      establishes — verified by direct structural comparison, not a
      new ad-hoc persistence mechanism.
- [ ] A real, driven-browser, end-to-end run (assembly → data_root →
      post → interrupt → resume → completion) is proven against a real
      or faithfully faked gateway and described precisely in the build
      report — not assumed from the unit-level proofs alone.

## Out of scope

- The progress UI and removing the 1 GiB cap (Topic 4 of the parent
  project).
- OPFS-support detection/fallback routing (Topic 4).
- Cross-device/cross-browser-profile resumability (OPFS and IndexedDB
  are both origin-and-profile-local by design — resuming on a
  different device/browser is out of scope, same limitation the
  platform itself has).
