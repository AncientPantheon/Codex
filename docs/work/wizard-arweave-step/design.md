# Wizard Arweave Step — Design

Follow-up to `docs/work/arweave-master-accounts/design.md`, which built the
right predicate and the right generator but wired them as **invisible logic
inside finalize**. Owner, after testing that: *"how can the codex be eligible,
if the wizard has no step for verifying if the codex has arweave account? …
There should be a separate step regarding the arweave account verification."*

## Problem

Two defects, one visible and one structural.

**1. There is no step.** The Arweave check happens inside `runFinalize`, so
there is nothing to watch, nothing to confirm, and no way for the owner to
distinguish a real check from a no-op. The requirement was stated twice and
answered with hidden logic both times.

**2. The violet ticker and the eligibility gate ask different questions.**
`arweave-master-accounts` claimed they shared one predicate. They do not —
only `runFinalize` was moved onto `codexHoldsMasterArweaveAccounts`; the
dashboard's ticker still calls `resolveArweaveMatchSeedId`
(`LegacyPrimeMigrationWizard.tsx:5383`):

| | asks |
|---|---|
| Violet ticker | does any Arweave seed's bitstring match a **Chainweb seed's**? — never inspects accounts #0/#1 |
| Finalize gate | does an Arweave seed match the **chosen account's** bitstring **and** do foreign keys #0 **and** #1 exist under it? |

So finalize can be satisfied while the square stays dark — which is exactly
what the owner saw, and why the fix looked like no change at all.

## Approach

### A real step, between Review and Finalize

`"arweave"` is inserted into `LegacyPrimeMigrationWizardStep` between
`"review"` and `"finalize"`, with entries in `STEP_LABELS`,
`STEP_DISPLAY_NUMBER` (it becomes step **5**; `review` stays 4 and the
subtitle reads "of 5") and `STEP_ORDER`. The flow becomes
intro → account → payment → guard → review → **arweave** → finalize.

The step states, in the owner's own order:

1. **Is there an Arweave seed identical to the Codex Master Seed?** The master
   bitstring is already settled by this point (it comes from the account
   chosen on step 2). Shown as a named row with its own tick.
2. **Does account #0 exist under it?** Own tick.
3. **Does account #1 exist under it?** Own tick.

and resolves to exactly one of:

- **Satisfied** — seed matches and both accounts exist. Nothing is written;
  the step says so plainly and the violet square is lit.
- **Incomplete** — anything else: no Arweave seed at all, a seed that does not
  match the Codex Master Seed, or a matching seed missing #0 and/or #1. A
  **Generate** button produces precisely what is missing, with the real
  per-key progress already built in `arweave-master-accounts` T2
  (`onProgress`, driven by the worker's own events).

**Generate is manual, not automatic.** Each RSA-4096 key takes seconds; a
multi-second derivation must not start behind the owner's back on arrival at
a step. This also makes the step legible: you press it, you watch it, you see
the square light.

Pre-existing Arweave seeds and keys are never deleted or replaced — a
non-matching seed is left exactly where it is and a matching one is added
alongside, per `arweave-master-accounts`'s own reasoning (those are real keys
that may hold permanent data).

### Continue is gated on the check, not on the attempt

Continue out of the Arweave step is blocked until the predicate genuinely
returns `ok`, so **Finalize is unreachable until the codex really holds #0 and
#1 under the Codex Master Seed**. The blocked reason says which part is
missing. This is what the owner asked for: *"after successfully adding them or
detected that they exist, then the purple square check would be lit, and the
finalize button THEN becomes available."*

### One predicate, actually

The dashboard's violet ticker is rewired onto
`codexHoldsMasterArweaveAccounts`, replacing `resolveArweaveMatchSeedId` as
the ticker's source. After this the square means exactly one thing everywhere
it appears — *the codex holds Arweave accounts #0 and #1 under the Codex
Master Seed* — and the step, the ticker and finalize cannot disagree, because
there is one function to disagree with.

`resolveArweaveMatchSeedId` is not deleted (other callers exist); it simply
stops driving this ticker.

### Alternatives considered

- **Keep the check inside finalize and just light the ticker** — rejected: the
  owner asked for a step twice; invisible verification is the thing being
  complained about.
- **Auto-generate on entering the step** — rejected: seconds-long RSA work
  starting unprompted, on a screen the owner wants to be able to read.
- **Put the step before Review** — rejected: Review is the stage 1→2 gate
  ("everything chosen, before anything is written"), and generating Arweave
  accounts *writes to the codex*. It belongs after that boundary.

## Acceptance criteria

- [ ] The wizard shows an "Arweave accounts" step between Review and Finalize,
      numbered 5, and the subtitle reads "of 5".
- [ ] On a codex already holding a matching seed with #0 and #1, the step
      reports all three checks satisfied, writes nothing, and Continue is
      immediately enabled.
- [ ] On a codex with no Arweave seed, the step reports all three missing and
      Continue is blocked until Generate completes.
- [ ] On a codex whose Arweave seed does NOT match the Codex Master Seed, the
      step says so, and Generate adds a matching seed plus #0 and #1 while
      leaving the existing seed and its keys present.
- [ ] On a codex holding a matching seed with only #0, Generate derives only
      #1.
- [ ] Generate shows per-key progress driven by the worker's own events.
- [ ] The violet square on the Codex Master Seed card is lit if and only if
      the codex holds #0 and #1 under that seed.
- [ ] Finalize cannot be reached while the check is unsatisfied.

## Out of scope

- Changing what `arweave-master-accounts` built — this topic adds the step and
  the gate, and rewires the ticker; the predicate and the generator stay as
  they are.
- Removing finalize's own post-derivation re-check. It becomes belt-and-braces
  rather than the only guard, and stays.
- Deriving positions beyond #1, or any funding/upload behaviour.
