# migration-execute, round 2 — the keyset update, a lossless unstake, and two display bugs

Follows `docs/work/migration-execute/`, which shipped the chain engine. Four
items, all from owner observation against a live codex.

## 1. The unstake must collect first, in ONE transaction

Owner:

> when we unstake, that transaction must do 1) Collect via `coin.C_URV|Collect`
> 2) Unstake, in a single tx, so that no dust remains uncollected. A 2-row
> `coin.xxx` transaction can still be sponsored by the gas station.

Correct, and the pattern already ships. `executeCollectUrStoa`
(`@ouronet/ouronet-core/dist/interactions/urStoaFunctions.js:441-461`) already
sends **two expressions in one gas-station-sponsored transaction**:

```js
`(coin.C_CreateAccount "${addr}" (read-keyset "ks"))\n(coin.C_URV|Collect "${addr}")`
```

with both capabilities on the single gas-station signer. So this is a proven
shape, not a new one.

Step C becomes one transaction:

```
(coin.C_URV|Collect "<old payment address>")
(coin.C_URV|Unstake "<old payment address>" <staked amount>)
```

Signer: the gas-station key carrying `DALOS.GAS_PAYER`, `coin.URV|COLLECT`
**and** `coin.URV|UNSTAKE` together.

Collect runs FIRST so rewards land in the liquid balance before the unstake;
step D then moves the whole thing and nothing is stranded.

**This closes a real hole**: today the engine READS `URC_URV|ClaimableRewards`
and never collects it, so pending rewards were left on the old key forever.

`executeUnstakeUrStoa` emits only the single expression, so this needs its own
builder rather than a delegate — modelled on `executeCollectUrStoa`'s, which
is the in-repo precedent for a multi-expression sponsored transaction.

**One thing the implementer must verify, not assume**: whether `Collect`
changes the STAKED balance or only the liquid one. The unstake amount is read
from `UR_URV|UserSupply` before the transaction is built. If Collect credits
rewards into the STAKE, that figure is stale by the time Unstake runs and the
amount must be derived differently. Check against the contract's behaviour;
do not guess.

## 2. `define-keyset` — the keyset-ref update, as a real step

Previously declared out of scope. Two of the three reasons were wrong, and the
owner has corrected them.

**Finding the target — I was wrong.** I claimed `update-keyset-recommended` /
`update-keyset-custom` "don't record which keyset to update". Owner:

> If the selected Ouronet Account has a guard tied to a keyset-ref, which can
> be detected, that's exactly the keyset ref that is getting updated.

The target is derivable from the account's live guard. Nothing new needs
recording. If the account's guard is NOT a keyset-ref, there is no reference
to update and the step reports non-executable with that reason.

**Gas** — settled by the owner: gas-station sponsorship applies.

**Signers — the genuine constraint, now with a specified answer.** A
`define-keyset` must be satisfied by the keyset's CURRENT keyset. Owner:

> You may look up in the codex, see if existing keys match this. If no keys can
> be found, we simply say so … You have two options: a) Forfeit the update, and
> the keyset remains as is. b) Provide the key/private key counterparts, until
> the verification of the keyset can be constructed.

So: resolve as many of the current keyset's keys from the codex as possible. If
the count reaches the keyset's predicate threshold, the step runs
unattended like any other. If not, the chain does not start — see §3.

Pact shape: `(define-keyset "<ns>.<ksn>" (read-keyset "ks"))` with
`.addData("ks", { keys, pred })` carrying the NEW definition.

**Ordering.** The keyset update occupies G's slot and is mutually exclusive
with `rotate-guard` — `planMigrationChain` already suppresses G for the
`update-keyset-*` kinds, and that stays. It is last for the same reason G is:
it changes the signing set.

## 3. The manual-key path — and why it does NOT interrupt the loop

Owner's worked example:

> This keyset ref is a keyset of 9 keys with a predicate 5 of 9. The user is
> presented with the list of 9 keys, and for each key a field where he may
> enter the private key. Entering a private key on that field, the UI verifies
> that it fits, and once 5 of 9 are verified this way, then the update could
> proceed.

**This is a PRECONDITION, resolved before the first transaction — never a
mid-chain prompt.** The owner's standing rule is that once the chain starts it
runs to completion without stopping to ask anything. So:

1. Preconditions run. If the codex cannot satisfy the keyset, the chain
   **refuses and starts nothing**, naming the shortfall.
2. The refusal offers the two options: forfeit (proceed with everything else,
   the keyset stays as it is) or supply keys.
3. Supplying keys happens entirely before the press that starts the chain.
4. With the threshold met, the chain runs start-to-finish, unattended.

This also means a forfeit is a legitimate outcome, not an error: the rest of
the migration still executes.

**The mechanism already exists and must be reused, not rebuilt.**
`ActivateStandardAccountModal.tsx:290-301` and `:600-612` already implement
exactly the described UI: a row per unresolved public key, a private-key
input, `derivePubKey(priv) === pub` verification on entry, a green check and a
`resolvedManualKeys` map. The signing side already accepts it —
`collectGuardSigners(analysis, getKeypair, manualKeys)` takes
`Record<pub, privateKey>` and already stops at `analysis.threshold`
(`rotateOps.ts:93-106`). The work is extracting that UI into something
reusable and pointing it at a keyset's key list.

## 4. Two display bugs on a settled codex

**Ordering — a real bug.** `OuronetAccountsTab.tsx:1482-1486`:

```js
const aI = hydratedAccounts.indexOf(a), bI = hydratedAccounts.indexOf(b);
if (aI === 0) return -1;
if (bI === 0) return 1;
return (a.name || a.address).localeCompare(b.name || b.address);
```

Array index 0 is force-pinned ahead of the alphabetical sort. On a settled
codex index 0 is the DISPLACED legacy prime, so it jumps to the top of "other
standard accounts" instead of sorting by name. This is the same positional
assumption `prime-identity-display` removed from gold, pinning and the badge —
it survived inside the comparator. The prime zone is computed separately
(`primeRows`/`primeIds`) and already excludes these rows, so the pin is
redundant as well as wrong.

**The designation — investigate before fixing.** The owner reports the
displaced account reads "Initial Seed" rather than "Former Codex Prime". The
rendering IS wired (`OuronetAccountsTab.tsx:89-90, 622, 646`). It depends on
`codexMasterSeed.legacyPrimeOuroAccountId`, which is written only by a
finalize that ran the capture added in `locked-entities-and-former-prime` T4.
A codex sealed before that shipped has no such record, and it is
**unreconstructable** — the promotion clears `isPrime` from the old account
before anything observes it.

So the first task is to determine which case this is, with evidence, and only
then decide. Do not "fix" a rendering path that is already correct.

If the field is genuinely absent on already-sealed codexes, consider whether a
one-time backfill is honest: on a SEALED codex with no
`legacyPrimeOuroAccountId`, is the account at index 0 necessarily the former
prime? State the answer and the risk; do not assume it.

## Out of scope

- Unity move — still a placeholder with no code.
- Any change to the A/B/D/E/F steps.

## Acceptance criteria

1. Step C sends ONE transaction containing Collect then Unstake, sponsored by
   the gas station, with all three capabilities on the signer.
2. The unstake amount is correct with respect to whatever Collect does to the
   staked balance — verified against contract behaviour, not assumed.
3. `define-keyset` executes as step G when the account's guard is a keyset-ref
   and the codex (optionally plus supplied keys) satisfies the current keyset.
4. When the guard is not a keyset-ref, the step reports non-executable with
   that specific reason.
5. When the keyset cannot be satisfied, the chain REFUSES and starts nothing,
   offering forfeit or supply.
6. The manual-key UI lists every key of the current keyset, verifies each
   entered private key by deriving its public key, and reports progress
   against the predicate threshold.
7. Supplying keys happens entirely before the chain starts; once started the
   chain never prompts.
8. Forfeit proceeds with every other step and is reported, not an error.
9. The account list sorts alphabetically with no index-0 pin; the prime zone is
   unaffected.
10. The "Former Codex Prime" question is answered with evidence before any fix.
11. No regression. Baselines: codex-core 413, codex-ui 314, codex-ouronet 2312
    (+1 known pact drift guard), codex-arweave 1137 + 1 skipped, codex 13,
    arweave-core 517, playground 249.
