# Migration Pending → Apply — Design

Supersedes the thin `migration-stage-3-apply` topic sketched in
`docs/work/migration-completion/design.md:62`. That topic folder never existed;
this is it.

## Problem

The eligibility wizard seals the codex the moment Finalize runs. The owner's
model is the opposite, and he has stated it twice with the same analogy:

> "remember my example of how you set partitions in a partition manager, and
> you can reset them as much as you want, but they get written once you click
> apply? So using the wizard for the first time places the codex in a pending
> state. This pending state can be placed in a new pending state forever, until
> the apply button seals it forever. The finalize at the end simply writes a new
> pending state. Clicking apply and going ahead with what is there, that seals
> it, and makes further modifications impossible. (the apply can be with or
> without transaction firing — if your pending state doesn't need any
> transactions fired, you can seal it without, just like that)"

Today none of that holds:

- **Finalize seals.** It stamps `primeAlignment: "aligned"`
  (`store.ts:2870-2874`), and `ensurePrimeSeedAccountPairingAndPromote` /
  `promoteSeedAndAccountToPrime` then **throw permanently** on that stamp
  (`store.ts:2504-2510`, `:2442-2447`). There is no un-stamp anywhere. So
  re-running the wizard after a completed finalize dead-ends at Finalize with
  an error.
- **The pending state is destroyed on the common path.** On clean success
  `runFinalize` calls `completeMigration()`
  (`LegacyPrimeMigrationWizard.tsx:7152`), which sets `migrationProgress` to
  `undefined` and persists `null` so the adapter **removes the shard**
  (`store.ts:1825-1836`, `LocalStorageCodexAdapter.ts:200-207`). Nothing is
  left to apply or to display.
- **There is no Apply button and no transaction list.** Stage 3 was never
  built. The only on-chain surface that exists is `PendingKeyChangesSection`,
  which launches the two generic rotate modals one at a time.
- **The eligible state is not even a button.** `CodexIdPage.tsx:1048-1055`
  renders a `<div role="status">`, so there is nowhere for "Retry the
  Eligibility Wizard" to live.

## Approach

**Finalize writes a pending state. Apply seals.** The seal moves from
Finalize to Apply; everything else follows from that.

### The pending state is a finalized plan, written only by Finalize

A new `pending` record on `MigrationProgress` holds what the last completed
Finalize decided, and what Apply would execute. It is written **only** at the
end of `runFinalize`, and it **replaces** any previous one wholesale — a new
finalize is a new plan, exactly as re-partitioning replaces the previous
layout.

This is deliberately **separate from `selection`**. `selection` is written
eagerly, at radio-click time (`LegacyPrimeMigrationWizard.tsx:7749`, `:7774`),
because it powers resume of an interrupted wizard
(`migrationResume.ts`). Reusing it as the pending state would violate the
owner's rule that cancelling must not disturb what Apply will do. Two fields,
two jobs:

| field | written when | purpose |
|---|---|---|
| `selection` | on every choice click | resume an interrupted wizard |
| `pending` | only at the end of Finalize | what Apply will execute and seal |

So: open the wizard and cancel → `pending` untouched. Change selections and
cancel → `pending` untouched. Reach Finalize → `pending` replaced.

### `completeMigration()` is no longer called on success

The record must survive Finalize, because the record *is* the pending state.
Finalize's `"success"` path stops deleting it. `abandonMigration()` keeps its
current meaning for an explicit discard.

### Apply seals, with or without transactions

Apply is enabled whenever a `pending` record exists. It opens a popup listing
the transactions that would fire, then seals. Sealing means:

1. stamp `primeAlignment: "aligned"` — moved here from Finalize;
2. mark the migration applied (`stage: "done"`, plus an `applied` marker);
3. after which the wizard cannot be re-run, and the middle button is locked
   green.

A pending state with **no** transactions seals immediately and legitimately —
the owner was explicit that this is a valid outcome, not an error. The popup
says so plainly rather than hiding the button.

This scope wires the **button and the popup only**. Execution is deliberately
deferred — the owner: *"we'll wire its functionality later, for now it should
open a popup listing what exactly will be executed on chain."*

### The transaction list is real, not a summary

`tooltipModel(key, values?)` from `@ouronet/talos-registry` is a pure function
— no React, no modal, no chain read — returning `exec` (the fully-qualified
call as it would be typed in a transaction) and `slots` (every execution
parameter, in declared order, with its Pact type). The two entrypoints are
`ouronet-ns.TS01-C1.DALOS|C_RotateGuard` (`RotateGuardModal.tsx:355`) and
`ouronet-ns.TS01-C1.DALOS|C_RotateStoa` (`RotatePaymentKeyModal.tsx:352`).

Three canon rules apply (`PreZbomHint.tsx:24-42`): `tooltipModel` **throws**
on an unknown key, so gate on `chainOf(key) !== undefined`; `values` merge
**by parameter name**, never positionally, using
`ouronetAccountFillValues`/`resolvePatronFillValue` from `preZbomFillMap.ts`
(the real parameter names are `patron`/`executor`, not `account` — eight
launchers have already silently no-op'd on exactly this); and a slot marked
`prefillable: false` must never be prefilled into anything that can reach a
signed transaction.

Which changes are outstanding comes from the existing
`computeOutstandingKeyChanges` — the same function
`PendingKeyChangesSection` already uses — so the popup and the existing card
cannot disagree.

### The middle button becomes a four-state machine

`CodexIdPage.tsx`'s step-2 slot, today three states driven by `step2Done =
isEligible`:

| state | condition | renders |
|---|---|---|
| not versioned | `!step2Enabled` | disabled "Make Codex Permaweb Eligible" |
| no pending | enabled, no `pending` | "Make Codex Permaweb Eligible" (gold) |
| pending, unsealed | `pending` exists, not applied | **green** "Retry the Eligibility Wizard" **+ Apply beneath** |
| sealed | applied | locked green "✓ Permaweb Eligible", no launcher |

The eligible `<div role="status">` becomes a real `<button>` in the
pending-unsealed state. The Apply button sits **beneath** it, inside the
`codex-id-step-2` card.

### Alternatives considered

- **Reuse `selection` as the pending state** — rejected: it is written at
  radio-click time, so cancelling a wizard would silently change what Apply
  executes, violating the owner's stated rule.
- **Keep sealing at Finalize and add a separate un-seal action** — rejected:
  two opposing writes to a funds-critical lock is a worse shape than one write
  that happens at the right moment.
- **Put the Apply button on `PendingKeyChangesSection`** — rejected: the owner
  specified "beneath the middle Make Eligible button". The card remains as the
  detailed per-change view.
- **Have the popup mount `FunctionInfoZone`** — rejected: it is coupled to the
  signing modal's chain-read plumbing. `tooltipModel` is the pure seam.

## Acceptance criteria

- [ ] Running the wizard to Finalize writes a pending state and does **not**
      seal the codex; `migrationProgress` survives.
- [ ] Re-running the wizard after a previous Finalize completes successfully
      and replaces the pending state, as many times as the user likes.
- [ ] Opening the wizard and cancelling — with or without changing selections
      — leaves the existing pending state byte-identical.
- [ ] With a pending state, the middle button is green and reads "Retry the
      Eligibility Wizard", and an Apply button appears beneath it.
- [ ] Apply opens a popup listing each transaction that would be executed, with
      its fully-qualified call and its ordered execution parameters.
- [ ] A pending state with no outstanding transactions still offers Apply, and
      the popup states plainly that nothing needs to be sent.
- [ ] Sealing via Apply locks the middle button green permanently; the wizard
      can no longer be launched and a further finalize is impossible.
- [ ] A guard choice of `update-keyset-recommended` / `update-keyset-custom`
      is reported in the popup as having nothing executable, rather than being
      silently omitted.

## Out of scope

- **Executing the transactions.** The popup lists; Execute is wired later, per
  the owner.
- Prefilling the existing rotate modals with the recorded choice
  (`migration-stage-3a/plan.md:58-60` parked this).
- Asset migration (Part B).
- Fixing `guardRotationNeeded`'s chain-only semantics, which makes a
  payment-key-only migration produce no outstanding change
  (`store.ts:2596-2604`). Pre-existing; noted in `backlog.md`.
- The Ouronet accounts list still pinning row 0 as Prime rather than the
  settled master (`OuronetAccountsTab.tsx:1311`). Separate topic.
