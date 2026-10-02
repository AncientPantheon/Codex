# Legacy Prime Migration — Design

Topic 2 of `docs/work/codex-seed-restore/design.md`. Makes an existing
codex eligible for `arweave-seed-restore` (Topic 1) when its Prime Ouronet
account and a Prime Arweave seed don't already share origin words — most
commonly because the codex was bootstrapped with a koala (Kadena-wallet
mnemonic) seed rather than Codex's own DALOS-native derivation.

This is the highest-stakes topic in the project: it moves real on-chain
funds (native STOA and urSTOA). Every claim about contract behavior below
was verified directly against the deployed source
(`stoa-coin/upgrades/live-coin-module.pact`), not assumed.

## Problem

DALOS's own word-derivation can now produce valid StoaChain (chainweb) keys
directly from the same words used for the Ouronet identity — but
historically, a codex's attached StoaChain keys were often derived via a
*different* algorithm (koala), even when the Ouronet identity itself came
from the same words. A koala-keyed codex's Ouronet account is still fully
DALOS-derivable from its words (confirmed — DALOS's `seedWords` mode
accepts any words regardless of origin), but its *chainweb* keys, and by
extension any Prime Arweave seed installed for recovery, are not yet
aligned with that single root. This topic closes that gap.

## Approach

### The three-option menu

Presented once, as a "this is now possible" opportunity:

1. **Write brand-new custom DALOS words.** A genuinely new Ouronet
   identity. Default *recommended* choice **when no better option exists**
   (see #2). Costs the most: everything tied to the old identity — not
   just StoaChain coin — has to migrate to the new one, not just the
   coin/urSTOA sweep this topic otherwise covers.
2. **Promote an existing Ouronet account already in the codex, already
   derived from custom (non-dictionary) words.** *Optimal and
   recommended* — the conditional top default whenever the codex already
   contains such an account. Avoids both #1's "invent a new identity" step
   and its full-asset migration cost.
3. **Keep the current Prime account exactly as it is**, dictionary/koala
   words included. Re-derive its chainweb keys via Codex's own DALOS
   derivation (instead of koala) from those same words, and derive the
   Prime Arweave seed from those same words too (valid regardless of the
   words' koala origin). *Not recommended* — continuing to rely on
   dictionary-word entropy rather than fully custom words — but available,
   for whoever doesn't want their identity to change at all. If chosen and
   an old koala-derived chainweb seed already exists, the user is
   explicitly asked whether to keep it present in the codex (fully swept,
   no longer Prime) or discard it — never assumed either way.

**Universal rule:** the sweep below is mandatory under all three options,
because all three produce new chainweb accounts under Prime — there is no
path that skips it.

### The sweep — grounded against the real contract

**Native STOA** (present across every StoaChain chain): aggregate every
chain's balance to chain 0 first, then move the consolidated total from the
old payment key to the new one. This is several sequential (and
cross-chain, itself multi-transaction) operations, not one signature —
never described to the user as "a single tx."

**urStoa — unstake, then collect** (confirmed safe ordering, not assumed):
`C_URV|Unstake` in the live contract calls `XI_URV|UpdatePendingRewards`
*before* touching the staked amount, so unstaking credits whatever accrued
up to that instant into the pending-rewards ledger rather than discarding
it — the contract's own comments confirm both orderings were deliberately
made safe, but unstake-then-collect is the tightest sequence (smallest
window for anything to accrue unaccounted-for). Collecting sweeps the full
current pending-rewards bucket; the contract already special-cases the
last-staker case to avoid stranding rounding dust. Any already-unstaked
(free) urSTOA balance moves directly, no unstake step needed.

**The guard key is swept too, separately.** Even though its role is
spending authority for the Ouronet account, it can independently hold
STOA/urSTOA balances on-chain — same sweep treatment as the payment key.

**Restake after the sweep**, under the new payment key, so the user's
staked position matches what they had before — just under new keys.

**A hard constraint, not a dust issue — must be detected and reported, not
silently absorbed:** the vault enforces `vault-remaining >= 1.0` URSTOA
**globally**, across every staker combined, on every unstake call. If this
user's unstake would push the whole vault below that floor, the call
reverts outright. The migration flow must detect this case and tell the
user plainly what couldn't move and why — never retry indefinitely, never
claim success anyway.

**Verify, don't just fire-and-hope.** After the sweep sequence, re-read
every relevant balance (native STOA per chain, free urSTOA, staked urSTOA,
claimable rewards) on both old keys. Anything still nonzero (for any reason
not already covered above) is surfaced to the user explicitly, not silently
dropped.

### End state

Whichever of the three options is chosen, the result satisfies Topic 1's
precondition: a Prime Arweave seed derived from the same words as the
(possibly newly-designated) Prime Ouronet account, with the old chainweb
keys fully emptied. "The goal is to generate everything that is prime from
that initial set of words" — ideally not dictionary-restricted, but always
functional even when it is (option 3).

## Acceptance criteria

- [ ] The three-option menu presents option 2 as the default whenever an
      eligible existing custom-worded account exists in the codex; option 1
      as the default otherwise; option 3 always available, always visibly
      marked not recommended.
- [ ] Whichever option is chosen, the resulting codex has a Prime Arweave
      seed derived from the same words as its (possibly newly-designated)
      Prime Ouronet account.
- [ ] After migration, the old payment key and old guard key hold zero
      native STOA (every chain) and zero urSTOA (free, staked, and
      claimable-reward) — or, where the vault-floor constraint blocks full
      unstaking, the user sees a clear, specific report of exactly what
      couldn't move and why.
- [ ] urSTOA is unstaked, then collected — never collected before
      unstaking — and restaked under the new payment key once the sweep
      completes.
- [ ] Choosing option 3 with an existing koala chainweb seed present
      explicitly asks whether to keep or discard that seed from the codex
      after it's fully swept.
- [ ] Every fund-moving step requires explicit user confirmation before
      signing; a failure at any step leaves the codex in a clearly
      reportable, never silently-partial, state.
- [ ] Nothing here claims "a single transaction" anywhere a multi-step or
      cross-chain operation is actually required.

## Out of scope

- NFTs or any other Pact-module asset beyond native STOA and urSTOA —
  explicitly not swept by this pass (confirmed intentional).
- Any chain configuration beyond StoaChain's own documented chain set.
- The restore-by-seed-words flow itself — Topic 1
  (`arweave-seed-restore`); this topic only makes a codex eligible for it.

## Topics

This project-scale split happened after a grounding audit of what already
exists in this codebase (the same escalation this session has hit
repeatedly on large topics — see `arweave-native-upload`,
`arweave-seed-restore`). The audit found:

- **Native STOA per-chain read** and **single-hop cross-chain transfer**
  are already built and shipped (`useStoaChainBalances`, `SendStoaModal.tsx`
  + `@ouronet/ouronet-core/interactions/crossChainFunctions.ts`'s
  `buildCTransferAcross`/`submitCrossChainTransfer`/`pollSpvProof`/
  `buildContinuationTransaction`). Aggregate-to-chain-0 sequencing is new.
- **Every urSTOA Pact call this migration needs** (read staking state;
  unstake; collect; stake/restake; move free urSTOA) is already built,
  tested, and wired into shippable modals
  (`useUrStoaBalances`/`executeUnstakeUrStoa`/`executeCollectUrStoa`/
  `executeStakeUrStoa`/`executeNativeUrStoaTransfer`). Only the
  unstake→collect→sweep→restake sequencing is new.
- **A real, consequential gap, found by this audit, not previously known:**
  no "promote an existing account/seed to Prime" store action exists
  anywhere in `codex-ouronet`. `updateOuroAccount`/`updateStoaChainSeed`
  are dumb merge-by-id with ZERO `isPrime` invariant enforcement — naively
  setting `isPrime: true` on a second entity would NOT demote the
  previous Prime, producing two simultaneously-Prime entities (a
  corrupted-state bug). This blocks options 2 AND 3 of the three-option
  menu (option 3 re-derives the CURRENT Prime's keys in place, so it
  doesn't strictly need promotion, but the Prime Arweave seed step at the
  end does need a clean, single source of truth for "who is Prime right
  now" either way) and is foundational, safe (pure local state, zero
  on-chain calls), and independently buildable/testable first.
- **A grounding caveat, found by this audit:** the vault-floor constraint
  (`vault-remaining >= 1.0`, cited above) does not appear anywhere
  greppable in this repo's source tree or its installed
  `@ouronet/ouronet-core`/`@stoachain/stoa-core` dependencies — it was
  verified earlier in this project against the live deployed contract
  source directly (outside this repo's own tree), not from anything
  re-verifiable inside this sandbox going forward. Sub-topic 2 below must
  therefore detect this condition defensively (pattern-matching the
  revert's error message/code, the same style `createSimulationError`
  already uses for other revert categories), NOT by hardcoding a call to
  an assumed, specific precheck contract function this codebase cannot
  independently confirm exists with that exact name.

Three sub-topics, sequenced (each depends on the one before it):

1. `stoachain-prime-promotion` — the foundational, funds-free gap: one
   new, atomic store action that swaps which seed+account pair is Prime,
   enforcing the single-Prime invariant on both sides together. Shaped,
   planned, and built first — safe to build fully autonomously.
2. `stoachain-migration-sweep` — the actual fund-moving engine: native
   STOA aggregate-and-transfer, urSTOA unstake→collect→restake, the guard
   key swept the same way, vault-floor detection, and post-sweep
   zero-balance verification. Headless/composable (library functions, no
   UI yet), built on the existing primitives audited above. **This is the
   highest-stakes sub-topic — real fund movement, confirm the approach
   before building it, even under a general autonomous-build instruction.**
3. `legacy-prime-migration-wizard` — the user-facing three-option wizard
   tying 1 and 2 together (new words via the existing
   `CreateStoaChainSeedModal.tsx` pattern for option 1, promotion for
   options 2/3, the sweep behind explicit per-step confirmation, ending
   with re-installing the Prime Arweave seed via the already-built
   `deriveArweaveSeedAtPositionZero`/kickstart-T4 pattern). Depends on 1
   and 2 both landing first.
