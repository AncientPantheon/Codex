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

**CORRECTED (owner refinement, 2026-10-13): the sweep is NOT universal
across the three options — it was never really about which of the three
top-level options was picked.** The real trigger is narrower and more
precise: the account IDENTITY (which Ouronet account becomes Prime) and
the account's PAYMENT/GUARD KEYS are two *separate* decisions. A user who
promotes an existing, already-activated account AND chooses to keep that
account's existing keys as-is needs no sweep at all — nothing is moving,
only which account is flagged Prime changes. The sweep is needed
specifically whenever NEW payment/guard keys get defined (via the Stoic
Dalos Derivation, from whichever words the chosen/typed account uses) —
which happens to be unavoidable for option 1 (a brand-new account has no
existing keys to keep) and the keep-current path (re-deriving via Dalos
necessarily produces different keys than the account's original
koala-derived ones), but is genuinely optional for option 2 when the
promoted account's existing keys are kept. See
`legacy-prime-migration-wizard/design.md` for the full, corrected
page-by-page flow this implies.

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

### The lock-in rule (added 2026-10-13, owner decision)

Once a codex is eligible, its Prime Ouronet Account, Prime Chainweb Seed,
and Prime Arweave Seed are **locked in place** — none of the three can
ever be changed again. This is deliberate, not an oversight: the whole
point of eligibility is "these three are the same root," and allowing any
one of them to drift afterward would silently re-break that alignment for
a codex the user (and anyone inspecting a future backup) now believes is
permanently restorable by seed words alone.

Enforcement point: `promoteSeedAndAccountToPrime` (Topic 1) must refuse —
throw, zero mutation — if the codex is already aligned. The Prime Arweave
Seed (re)installation path (`kickstartAndInstallPrimeArweaveSeed` and
whatever Topic 3's wizard calls at the end of a migration) needs the
identical guard. Both checks read the SAME stored fact (below), never
re-derive eligibility live for this purpose — a lock is a recorded
decision, not a recomputed one.

### Marking a codex's alignment shape (added 2026-10-13, owner question)

**The question:** can we use the codex's own shape/form versioning to mark
a codex "eligible-shape" vs "ineligible-shape", given a freshly-kickstarted
codex is now built directly in the eligible shape?

**Answer: not the existing `CODEX_FORM_VERSION` constant itself** — that's
a single, hardcoded, codebase-release-wide value (`packages/codex-core/src/
codexFormVersion.ts`, currently `"1.0.0"`, bumped manually per the owner's
own documented MAJOR/MINOR/PATCH policy for "what shape milestone does
THIS VERSION OF THE APP produce"). Every codex built by the same app
build shows the identical value regardless of its own individual
alignment — repurposing it would conflate "which app version wrote this"
with "is this particular user's codex aligned," a real category error:
two users on the identical app build can have different alignment (one
just migrated, one hasn't).

**What's actually needed: a new, per-codex-instance field**, following the
SAME naming/provenance discipline `CODEX_FORM_VERSION` already
established, but tracking a different axis:

- A new persisted field on the codex snapshot — e.g. `primeAlignment:
  "legacy" | "aligned"` — absent/`"legacy"` for any codex that predates
  this field (same safe-default discipline every other optional snapshot
  field already follows: never silently reinterpreted, coalesced on
  read). A fresh kickstart stamps `"aligned"` immediately at creation
  (its three Prime values are aligned by construction). A completed
  migration (Topic 3's wizard) stamps `"aligned"` as its final step, in
  the SAME atomic update that also applies the lock-in guard's
  precondition.
- A new Arweave tag, e.g. `Codex-Prime-Alignment`, carrying the same
  value, written on every codex-backup upload alongside the existing
  `Codex-Form-Version` tag. This lets restore tooling know — from tags
  alone, before any decryption — whether a given backup came from an
  eligible codex, directly useful for the "pick which past backup to
  restore" design already noted in `codex-backup-envelope-encryption`'s
  own informatics (`CodexBackupInformatics.tsx`'s "multiple independent
  backups" section).

This is additive, mechanical, and small — folds into Topic 1's own build
(the lock-in guard and the stamp are the same piece of work) rather than
needing its own sub-topic.

### Future context, not in scope here (noted 2026-10-13)

A planned, later feature: a StoaChain-resident Codex Identity (the
existing dual-Apollo-half concept) that, once built, will publish a
registry of every Arweave upload a codex has ever made, on-chain. That
would eventually give restore tooling a much better source than "poll the
Arweave address's own transaction history" for "which backups exist" —
but it doesn't exist yet, isn't a precondition for this migration project,
and this project's own `Codex-Prime-Alignment` tag works standalone
either way (an on-chain registry, when it arrives, would just index tags
that are already there).

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
- [ ] Once a codex resolves aligned (`primeAlignment === "aligned"`),
      `promoteSeedAndAccountToPrime` and the Prime Arweave Seed
      (re)installation path both refuse — zero mutation — any further
      attempt to change the Prime Ouronet Account, Prime Chainweb Seed, or
      Prime Arweave Seed.
- [ ] A freshly-kickstarted codex is stamped `primeAlignment: "aligned"`
      at creation; a codex predating this field reads as `"legacy"`
      (absent, never silently reinterpreted); a completed migration
      stamps `"aligned"` as its final atomic step.
- [ ] Every codex-backup upload carries a `Codex-Prime-Alignment` tag
      matching the codex's own `primeAlignment` value at the moment of
      that specific backup.

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

Four sub-topics. Revised sequencing (owner decision, 2026-10-13): 2 is no
longer a hard precondition for 3 — 3 and 4 can be built and fully verified
(via mockup mode) before 2 exists at all, lowering the bar for green-
lighting 2 since the wizard's own correctness is already settled by then.

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
   No longer blocks 3/4 from starting — see revised sequencing above.
3. `legacy-prime-migration-wizard` — the user-facing wizard (full
   page-by-page design in its own `docs/work/legacy-prime-migration-
   wizard/design.md`): the account-identity choice, the separate
   payment/guard-key choice, the conditional sweep, and finalize
   (promotion + Prime Arweave Seed creation via the already-built
   `deriveArweaveSeedAtPositionZero`/generic keygen-at-index mechanism).
   Depends on 1. Can run against EITHER the real sweep engine (once 2
   lands) or sub-topic 4's mockup engine in the meantime — the wizard's
   own page flow is identical either way.
4. `legacy-prime-migration-mockup` — a local, no-op stand-in for the one
   on-chain seam (`getFailoverClient`) every relevant transaction goes
   through, plus an ephemeral scratch copy of the local state Page 7
   writes, so the full wizard flow (3) can be exercised end-to-end on a
   real codex with zero real transactions and zero real state mutation.
   Mirrors the already-shipped `arweave-upload-dry-run` pattern. Depends
   on 3 (needs the wizard's pages to inject into) but not on 2.
