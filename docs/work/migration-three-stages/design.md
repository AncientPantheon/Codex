# Eligibility Migration — Three Stages, Resumable — Design

Owner, this session: *"Stage one are the selection pages. Stage 2 is writing
the selections onto the codex. Stage 3 is executing the migration
transactions, should any of them be needed."* Plus: resume a wizard that was
left unfinished, showing the user what he chose — which means *"saving
choices within the codex itself before it is migrated to eligible status."*

## Problem

The wizard has no stages. `finalize` interleaves deriving, mutating the
store, and transacting-that-does-not-exist, and then dead-ends:

```ts
if (sweepNeeded) {          // hardcoded true today
  setFinalizeStatus("sweep-needed");
  return;                   // no row written, no alignment stamp
}
```

Measured: **zero chain calls exist anywhere in the wizard**
(`signTransaction|execute(|submit(` → 0 matches). And nothing survives a
close: `paymentChoice`/`guardChoice` live in React state only, so closing the
wizard discards every decision.

## The three stages

| Stage | Does | Costs if interrupted |
|---|---|---|
| **1 — Selection** | the choice pages | nothing; re-choosable |
| **2 — Commit** | writes the selections onto the codex | must be atomic-or-resumable |
| **3 — Execute** | the migration transactions | real money mid-flight |

The boundary that matters is **1→2**: stage 1 writes nothing and can be
abandoned freely; stage 2 is the first irreversible act. Today that boundary
does not exist, which is why "Continue" on step 3 went straight into a
half-finalize.

## Resume — what persists, and what deliberately does not

A new codex field, `migrationProgress`, travelling in the export exactly like
`Codex_Shape_Version`, `masterKeyLocks` and `codexMasterSeed` before it — so
resume survives a browser close AND moves with an exported codex, which is
the owner's stated reason for putting it in the codex at all.

```
migrationProgress?: {
  stage: "selection" | "committing" | "executing" | "done"
  startedAt, updatedAt
  selection?: { account, payment, guard, derivationMethod }
  committed?: { seedId, accountId, arweaveSeedId?, locksWritten, rowWritten }
  execution?: { steps: [{ id, state, txHash?, error? }] }
}
```

### It stores NO seed words

`LegacyPrimeMigrationAccountChoice` has a `{ kind: "new-words"; words }`
variant carrying **raw plaintext seed words**. Persisting that verbatim would
write seed words in cleartext into the codex and into every export file on
disk — the one thing this project encrypts everything else to avoid.

**Decision: the `"new-words"` selection is NOT resumable.** The row records
that a new-words run was in progress, never the words; resuming asks the user
to retype them. Two reasons it costs almost nothing:

1. `new-words` is **already unsupported by finalize** — a pre-existing,
   documented gap, so nothing regresses.
2. The alternative is encrypting the words as a new secret field, which drags
   in a re-key obligation on every password change (the
   `CODEX_IDENTITY_SECRET_FIELDS` treatment) for a path that cannot complete
   anyway.

`keep-current` and `existing` persist as **ids only** — no secret, nothing to
re-key — and those are the two paths that actually work.

### Resume shows the user what he chose

On re-open with a `migrationProgress` row, the wizard jumps to the recorded
stage and renders the recorded choices as already-selected, with a banner
naming when the run started. Never silently: a resumed run says it is one.

**Staleness is checked, not assumed.** A recorded `accountId` or `seedId` can
point at an entity that has since been deleted or renamed. On resume every id
is re-resolved; anything that no longer exists demotes that decision back to
unchosen and says why, rather than resuming onto a dangling reference.

## Stage 2 — atomic-or-resumable

Stage 2 performs four writes: pair+promote the seed, write the
`codexMasterSeed` row, write the `masterKeyLocks` from the chosen guard, and
stamp alignment. A crash between them currently leaves the codex in a state
nothing records.

`committed` records each as it lands, so a resumed stage 2 skips what already
happened instead of redoing it. The alignment stamp goes **last**, so a codex
is never marked eligible on a partial commit.

## Stage 3 — the open question

Still unanswered from the original wizard design, and it changes stage 3's
architecture rather than its content:

> If the browser dies mid-sweep, does stage 3 **resume from real on-chain
> state** (re-read balances, work out what already moved), or **re-run from
> scratch** (re-check balances, skip what is already where it should be)?

The `execution.steps` shape above supports either; which one is built decides
whether a recorded `txHash` is authoritative or merely a hint. **Not guessed
at** — needed before stage 3 is built. Stages 1 and 2 do not depend on it.

## Acceptance criteria

- [ ] Closing the wizard after choosing, then re-opening it, restores the
      stage and shows the recorded choices as selected.
- [ ] A resumed run says it is resumed, and when it started.
- [ ] `migrationProgress` survives an export → import round trip.
- [ ] No seed words appear in `migrationProgress` under any path, proven by
      a test over a `new-words` run.
- [ ] A recorded id that no longer resolves demotes that decision and
      explains, instead of resuming onto a dangling reference.
- [ ] Stage 2 records each write as it lands, and stamps alignment last.
- [ ] Abandoning stage 1 writes nothing to the codex.

## Out of scope

- Stage 3's transactions (blocked on the resumability question above).
- Resuming a `"new-words"` selection.

## Topics

1. `migration-progress-row` — the persisted field + round trip + the
   no-secrets guarantee.
2. `wizard-stage-boundaries` — split the wizard into the three stages, with
   stage 2 as a real commit step rather than a side effect of Continue.
3. `wizard-resume` — restore-and-show, with staleness re-resolution.
4. `migration-execute` — stage 3. Blocked.
