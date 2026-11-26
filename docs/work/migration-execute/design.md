# migration-execute — the on-chain transaction chain

Unblocks `docs/work/migration-three-stages/design.md`'s Stage 3, which has
stood as **"Blocked"** pending the resume decision settled below.

The owner's statement of the feature:

> Transactions need to be executed when 1) payment key changes, 2) guard of
> the Ouronet Account changes.
>
> When the payment key changes, we also need to drain everything from the old
> payment key to the new one: (a) move all native STOA, (b) move all native
> urSTOA, (c) if the user has urSTOA staked in vault, unstake it, move it and
> re-stake it over the new address, (d) unity move — mental placeholder.
>
> Guard update means either a keyset ref update, which is not an Ouronet tx —
> simply a keyset update requiring the tx to be satisfied by the current
> keyset — or a direct rotate guard of the Ouronet account.
>
> All the needed transactions must be chained one after the other and sent
> sequentially to the chain.

And on how it runs:

> Once the chained transactions are sent to the blockchain, the UI should be
> in a loop to send them all. There should be no interrupting it.

## 1. What already exists — this is assembly, not new capability

Every leaf transaction is built, shipped and mainnet-verified. None of it
needs inventing:

| operation | call | where |
|---|---|---|
| native STOA transfer (same chain) | `coin.C_Transfer` / `C_TransferAnew` | `ui/internal/SendStoaModal.tsx` |
| native STOA cross-chain | `coin.C_TransferAcross` + SPV + continuation | `SendStoaModal.tsx:415-510` |
| urSTOA transfer | `coin.C_UR\|Transfer` family | `TransferUrStoaModal.tsx` → `ouronet-core` |
| urSTOA unstake | `coin.C_URV\|Unstake` | `UnstakeUrStoaModal.tsx` → `executeUnstakeUrStoa` |
| urSTOA stake | `coin.C_URV\|Stake` | `StakeUrStoaModal.tsx` → `executeStakeUrStoa` |
| rotate payment key | `TS01-C1.DALOS\|C_RotateStoa` | `zbom/rotatePaymentKeyLive.ts` |
| rotate guard (direct keyset) | `C_RotateGuard` + `(read-keyset "ks")` | `zbom/modals/RotateGuardModal.tsx` → `ouronet-core` |
| rotate guard (point at existing) | `C_RotateGuard` + `(keyset-ref-guard …)` | same, `mode: "existing"` |

Sequential execution is also already proven in production.
`SendStoaModal`'s cross-chain path runs a three-step dependent chain —
*Confirming on source chain → Waiting for cross-chain proof → Completing on
target chain* — with confirmation gating between steps, SPV wait, continuation
submit, and deliberate partial-failure wording. `SendKadenaModal` does the
same for Kadena mainnet. The supporting machinery (`createMultiStepToast`,
`ToastController.updateStep`, `pollStoaChainConfirmation(ctrl, stepIdx, …)`)
is already step-indexed for exactly this.

The store already computes *whether* a sweep is owed —
`ensurePrimeSeedAccountPairingAndPromote` is documented as determining
"whether a fund-moving sweep is needed… Never performs any fund-moving sweep
itself." This topic builds the thing that performs it.

**The single transaction that does not exist anywhere is `define-keyset`.**
See §6.

## 2. The chain

Owner decision: **consolidate first.** Native STOA is spread across chains
0-9; chains 1-9 are swept onto chain 0, then moved once.

```
A. CONSOLIDATE   for each chain 1..9 with a non-zero balance on the OLD key:
                   cross-chain transfer → chain 0, same (old) key
                 [each is the proven 3-step source → SPV → target flow]

B. DRAIN STOA    chain 0: old key → new key, native STOA

C. UNSTAKE       old key: coin.C_URV|Unstake   (only if staked > 0)
D. MOVE urSTOA   old key → new key, coin.C_UR|Transfer
E. RESTAKE       new key: coin.C_URV|Stake     (only if D moved anything)

F. ROTATE PAY    TS01-C1.DALOS|C_RotateStoa → new payment key

G. ROTATE GUARD  TS01-C1.DALOS|C_RotateGuard  (LAST)
```

### Why this order

**The guard goes last** because rotating it changes who can sign. Every step
before it is authorized by the guard that exists today; the moment G lands,
the signing set changes. Putting G anywhere earlier means every subsequent
step must be signed by a guard the user has only just adopted — a strictly
worse failure mode, since a mistake there strands the remaining steps with no
way to sign them.

**The drain precedes F** for the same reason in the money dimension: A-E are
signed by the OLD payment key, which must still be present in the codex. F
re-points the Ouronet account at the new key. Draining after F would mean
moving funds out of a key the account no longer names.

**C→D→E is forced, not chosen.** `executeStakeUrStoa` / `executeUnstakeUrStoa`
take `{ paymentKeyAddress, amount, gasStationKey }` and **no destination** —
staking acts on the account itself. So "move staked urSTOA" is necessarily
unstake at the source, transfer, re-stake at the destination. There is no
primitive that shortcuts it.

**(d) unity move** is a placeholder. No code, not even a name, exists in the
repo (`grep -i '\bunity\b'` → zero matches). Out of scope; the step list is
built so a step can be inserted without reshaping the engine.

## 3. How it runs — one uninterrupted loop

Owner: *"the UI should be in a loop to send them all. There should be no
interrupting it."*

One press. The engine walks the steps in order, awaits confirmation of each
before starting the next, and never prompts. No per-step confirmation, no
"continue?" dialogs. Progress is reported through the existing multi-step
toast, which is what that component is for.

The codex is unlocked once, up front, via the established
`ensureCodexUnlocked` gate — not per step. A chain that stops halfway to ask
for a password is the interruption the owner ruled out.

## 4. Resume — by reading the chain, not by replaying a cursor

This is the decision `migration-three-stages/design.md` left open:

> *"If the browser dies mid-sweep, does stage 3 resume from real on-chain
> state (re-read balances, work out what already moved), or re-run from
> scratch… which one is built decides whether a recorded `txHash` is
> authoritative or merely a hint. Not guessed at."*

**Decided: re-read on-chain state.** Every step is a PREDICATE over chain
state, not a position in a script:

| step | runs only if |
|---|---|
| A(n) | old key's balance on chain n > 0 |
| B | old key's chain-0 STOA balance > 0 |
| C | old key's staked urSTOA > 0 |
| D | old key's liquid urSTOA > 0 |
| E | new key's liquid urSTOA > 0 |
| F | account's registered payment key ≠ new key |
| G | account's on-chain guard ≠ chosen guard |

Consequences, all of them wanted:

- **The chain is idempotent.** Re-running it is safe. Re-running a drain on an
  already-empty chain is a no-op, not a double-spend.
- **Recovery needs no new UI.** The browser dying is not a special state; the
  user presses the same button again and the engine skips what landed.
- **A recorded `txHash` is a HINT, never authority.** This settles the
  question `MigrationExecutionStep.txHash`'s own doc comment defers.

Rejected alternative — a durable step cursor — fails in precisely the case
that matters: a transaction lands and the tab dies before the write. Replay
then re-sends a transfer that already happened. Chain state cannot lie that
way. It costs extra reads; that is the correct trade when the failure mode is
moving money twice.

`MigrationProgress.execution.steps` (already declared in
`codex-core/src/codex/migrationProgress.ts:118-126`, never written) becomes
the record of what the engine DID — for display and support — and is read by
nothing to decide what to do next.

## 5. Preconditions, checked once before the loop starts

A chain that dies at step 7 of 20 for a reason knowable at step 0 is a bug.
Before the first transaction:

- the OLD payment key's keypair is present in the codex and decryptable
  (without it, A-E cannot be signed at all)
- the chosen guard's keys resolve, and the current guard is satisfiable
- aggregate gas: the patron's IGNIS covers F and G; the gas station covers
  the `coin.*` steps. **Nothing in the repo currently sums gas across N
  transactions** — this is new.
- the payment key is converted to the account-string form `C_RotateStoa`
  expects. `pending.paymentPublicKey` is a bare 64-hex key; the rule is
  seed-type dependent and already encoded at `store.ts:2680`
  (`seedType === "stoic" ? paymentPublicKey : \`k:${paymentPublicKey}\``).
  Nothing currently converts it.

## 6. Out of scope, and why

**`define-keyset` — the keyset-ref update.** The owner's guard case (2) first
branch. There is **zero code** for it: not in `PACT_SIGNATURES`, not in
`ouronet-core`, no builder anywhere. It is also not an Ouronet `C_*` call, so
the Ouronet gas station is not obviously available to pay for it, and it must
be satisfied by the keyset's CURRENT keyset — which this codex may not hold.
Additionally the two `update-keyset-*` selection kinds carry **no reference
identity** (`ns`/`ksn` exist only on `use-existing-keyset`), so the target
would have to be re-derived from the account's live guard.

Too many unverified assumptions to bundle into this round. The engine treats
it as a step it cannot execute and says so, exactly as the Apply popup does
today.

**Unity move (d)** — placeholder, no code exists.

## 7. Two defects to fix first, not build on

1. **`components/RotatePaymentKeyModal.tsx` emits a dead function.** It calls
   `buildRotateKadenaPactCode` → `DALOS|C_RotateKadena`, which no longer
   exists on chain — the exact rename `rotatePaymentKeyLive.ts`'s header
   documents as *"no such member"*. The `zbom/modals` copy was fixed; this
   publicly-exported duplicate was not.
2. **`outstandingKeyChanges.ts:96` reads the wrong field.** It takes
   `account.chainPublicKey` as "the account's live payment key", but per the
   selector mapping that field is the account's own public key;
   `stoaChainLedger` is the payment key. So the already-in-force check
   compares the wrong two values.

## 8. One contradiction the owner must settle

Two shipped surfaces disagree about whether any of this is required:

- `CodexMigrationInformatics.tsx:188-194`: moving funds is *"a genuinely
  necessary part of becoming eligible."*
- `PendingKeyChangesCard.tsx:11-23`: *"Applying these is OPTIONAL… Nothing is
  lost by never pressing these buttons."*

The engine's copy must say one or the other. Recorded here; not resolved by
this design.

## Acceptance criteria

1. A headless, testable entry point exists for each leaf operation in §1 —
   callable without mounting a React modal.
2. A chain engine runs the §2 steps in order, awaiting confirmation between
   them, with no user interaction after the single initiating press.
3. Each step is gated on its §4 predicate, read from chain, so the chain is
   idempotent and re-pressing resumes correctly after a crash.
4. Consolidation covers chains 1-9 and skips zero balances.
5. The urSTOA path is unstake → transfer → re-stake, each skipped when its
   predicate is false.
6. The guard rotation is last; the drain precedes the payment-key rotation.
7. §5's preconditions are checked ONCE before the first transaction, with a
   single clear refusal naming what is missing.
8. Progress uses the existing multi-step toast; `execution.steps` records what
   happened and is authoritative for nothing.
9. `define-keyset` is reported as not executable, never silently skipped.
10. §7's two defects are fixed, with tests.
11. No existing suite regresses. Baselines: codex-core 346, codex-ui 314,
    codex-ouronet 2165 (+1 known pact drift guard), codex-arweave 1136 + 1
    skipped, codex 13, arweave-core 517, playground 249.
