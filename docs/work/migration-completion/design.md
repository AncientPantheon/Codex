# Migration Completion — the eligibility wizard's back half — Design

## Problem

The eligibility wizard guides every selection and writes them onto the codex,
then stops. Measured in the current tree:

- `migrationProgress` is fully wired (codec, store, adapters, backup, wizard),
  but its `execution` field is only ever *passed through* — nothing writes it
  (`state/store.ts`: `...(current?.execution ? { execution: current.execution } : {})`).
- There are **zero** `signTransaction` / `submit(` / `execute(` calls anywhere
  in `LegacyPrimeMigrationWizard.tsx`.
- `ensurePrimeArweaveSeed` derives Arweave **position #0 only**
  (`deriveArweaveSeedAtPositionZero`); position #1 does not exist.
- A long wizard session outlives the codex's absolute unlock window, and every
  password touch point then dead-ends on a raw error instead of asking again.

So the codex can be *staged* eligible, but never *sealed* — and on real data
the flow dies before it gets that far.

Owner's framing, which this project adopts wholesale: a **disk partition
manager**. The wizard lets you tinker; Finalize writes the intended result
down "virtually"; a separate **Apply** shows the on-chain transactions that
would realise it and executes them. Until Apply runs, nothing is sealed and
the wizard can be re-run freely.

## Approach

This is the already-approved three-stage model from
`docs/work/migration-three-stages/design.md` — *"Stage one are the selection
pages. Stage 2 is writing the selections onto the codex. Stage 3 is executing
the migration transactions"* — carried to completion. Stages 1 and 2 are
built. **Stage 3 does not exist**, and two prerequisites block reaching it on
real data.

Nothing here redesigns the stage model. It fills in what was specified and
never built, in dependency order: the codex must stay usable long enough to
finalize at all, the Codex Master Seed must actually produce its Arweave
accounts, and only then is there something coherent to apply on chain.

### Alternatives considered

- **Build Apply first, fix the blockers after** — rejected: Apply's whole
  input is a completed Stage 2, which currently cannot be reached on the
  owner's real codex. It would be built and demoed against fixtures only.
- **Fold Arweave generation into the Apply step** — rejected: Arweave account
  derivation is a *codex-side* act with no transaction attached. Per the
  owner, permaweb eligibility "is made by the FIRST finalise step"; Apply
  "simply seals the process in". Keeping derivation in Stage 2 preserves that
  boundary, and keeps Apply purely about chain.
- **One combined feature** — rejected: the three pieces have different risk
  profiles (UX-only, local-crypto, real-money-on-chain) and different test
  strategies. They are separately shippable and separately verifiable.

## Topics

1. `wizard-unlock-lifecycle` — the codex stays usable across a long wizard
   session: every password touch point prompts and resumes instead of
   dead-ending. **Blocks everything else.**
2. `arweave-master-accounts` — the Codex Master Seed produces Arweave accounts
   **#0 and #1**, generating only what is genuinely missing.
3. `migration-stage-3-apply` — Stage 3: build the chain-transaction list from
   the staged plan, show it to the user, and wire Execute.

## Acceptance criteria

- [ ] A wizard run that takes longer than the codex's unlock window completes
      without the user losing their staged selections.
- [ ] After Finalize on a codex with no Arweave seed, the codex holds Arweave
      accounts at positions #0 and #1 derived from the Codex Master Seed.
- [ ] After Finalize, the Settling Dashboard's violet (Arweave) ticker sits on
      the Codex Master Seed card.
- [ ] Finalize writes a staged plan to `migrationProgress` and sends nothing to
      chain.
- [ ] Before Apply has been run, re-opening the wizard lets the user change
      their selections and re-finalize.
- [ ] The Apply step lists the exact transactions it would send, and sends
      none of them until Execute is pressed.

## Out of scope

- Changing the three-stage model itself — `migration-three-stages/design.md`
  stays authoritative for stage boundaries, `migrationProgress`'s shape, and
  the "no seed words are ever persisted" rule.
- Rolling back an *already-applied* migration. Apply is the sealing act; undo
  after sealing is a separate problem.
- Any new Arweave capability beyond accounts #0 and #1 (uploads, bundles,
  funding) — those already have their own topics under `docs/work/`.
