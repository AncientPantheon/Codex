# StoaChain Prime Promotion — Design

Sub-topic 1 of `docs/work/legacy-prime-migration/design.md`. Funds-free,
pure local state — safe to build fully autonomously. Foundational: Topics
2 (the sweep) and 3 (the wizard) both need a working, invariant-safe way
to change which seed+account pair is Prime.

## Problem

A grounding audit (not previously known) found: no "promote an existing
seed/account to Prime" store action exists anywhere in `codex-ouronet`.
`updateOuroAccount`/`updateStoaChainSeed` are dumb merge-by-id with ZERO
`isPrime` invariant enforcement — naively setting `isPrime: true` on a
second entity via either would NOT demote the previous Prime, producing
two simultaneously-`isPrime: true` entities (corrupted state, silently).

**The invariant is causal, not independent, confirmed by reading
`entities.ts` directly:** `IOuroAccount.isPrime` is NOT a free-standing
flag — the Prime Ouronet account's prime-ness is causally tied to a
specific `IStoaChainSeed.isPrime` seed via the account's own seed-id field
("Set by `kickstartCodex` on the CodexPrime account so the prime-account
invariant is causal... rather than positional"). So "promote" must always
act on a SEED+ACCOUNT PAIR together, atomically — never a seed alone or
an account alone, which would desynchronize the causal link the rest of
the codebase (and the Prime Arweave seed derivation this whole project
depends on) assumes holds.

(`IArweaveSeed.isPrime` is a third, separately-tracked prime marker, not
touched by this topic — Topic 3 re-derives/re-installs it fresh after a
migration completes, it is never "promoted" from an existing entry.)

## Approach

One new, atomic store action:
`promoteSeedAndAccountToPrime(seedId: string, accountId: string):
Promise<void>` in `packages/codex-ouronet/src/state/store.ts`. Validates
first (throws, no partial mutation, on any failure):
- `accountId` must reference an `IOuroAccount` whose own seed-id field
  equals `seedId` (the causal link must already be true — this action
  promotes an existing, already-correctly-derived pair; it does not
  establish the derivation relationship itself, that's the caller's job,
  e.g. via the already-existing `CreateStoaChainSeedModal.tsx` flow for a
  brand-new seed+account, or already-true for an existing one).
- Exactly one `IStoaChainSeed` may ever have `isPrime: true` — the action
  sets the target seed's `isPrime: true` and, in the SAME state update,
  sets every other seed's `isPrime` to `false`/absent.
- Exactly one `IOuroAccount` may ever have `isPrime: true` — same
  atomic swap on the accounts collection.
- Both collection updates happen in one `set()` call (one state
  transition, one persisted snapshot) — never two sequential updates that
  could leave an intermediate, inconsistent state observable or
  interrupted mid-way.

Read `kickstartCodex`'s own atomic multi-field `set()` pattern first and
mirror its transactionality discipline exactly, rather than inventing a
new one.

## Acceptance criteria

- [ ] `promoteSeedAndAccountToPrime(seedId, accountId)` results in
      exactly the targeted seed and account having `isPrime: true`, and
      every other seed/account in their respective collections having
      `isPrime` false/absent — verified by checking the FULL collection,
      not just the two targeted entities.
- [ ] Calling it with an `accountId` whose seed-id does not match
      `seedId` throws, with zero mutation to either collection.
- [ ] Calling it with an unknown `seedId` or `accountId` throws, with
      zero mutation.
- [ ] The state transition is atomic — a reader observing the store
      between the old and new prime never sees two prime seeds, two prime
      accounts, zero prime seeds, or zero prime accounts.
- [ ] Promoting the CURRENT Prime pair to Prime again (a no-op in
      effect) succeeds without error and leaves state unchanged.

## Out of scope

- Any on-chain/fund-moving behavior — this is pure local state.
- Establishing a NEW seed+account derivation pair (adding a seed, adding
  an account derived from it) — already-existing flows
  (`CreateStoaChainSeedModal.tsx`/`addStoaChainSeed`/`addOuroAccount`)
  cover that; this topic only promotes an already-correctly-derived pair.
- Re-deriving/re-installing the Prime Arweave seed after a promotion —
  Topic 3 (`legacy-prime-migration-wizard`)'s job, triggered after a full
  migration completes, not by this action itself.
- `IArweaveSeed.isPrime` — untouched by this topic.
