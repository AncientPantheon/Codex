# kadena-crosschain-transfer — Design

## Problem

Codex's Kadena Send modal (`SendKadenaModal.tsx`, built in the sibling `kadena-native-transfer`
topic) is same-chain only. Real Kadena mainnet's own `coin.transfer-crosschain` — a genuine 2-step
`defpact` (debit + yield on the source chain, then a `resume` continuation that credits the
receiver on the target chain, confirmed live: `coin-v6.pact:97-108,120-125,528-586`) — is never
called anywhere in Codex. There is no way to send KDA across Kadena's own 20 chains today.

## Approach

Extend `SendKadenaModal.tsx` in place — same file, same shape topic 1 (`stoachain-crosschain-transfer`)
used to extend `SendStoaModal.tsx` — rather than a new modal: a second `<ChainSelector>` (source +
target, mirroring `ChainSelector`'s already-built `disabledChain` collision-avoidance), branching
same-chain (unchanged, already-shipped `coin.transfer`/`coin.transfer-create`) vs. cross-chain
(`coin.transfer-crosschain`, new this topic).

**Load-bearing discovery this topic's research turned up, changing the approach from what the
project design assumed:** `@ouronet/ouronet-core/interactions/crossChainFunctions` — the package
topic 1 imported directly for StoaChain's own crosschain mechanics ("do NOT reimplement it") — is
**not usable for real Kadena mainnet at all**. Every function in it (`pollTransactionStatus`,
`fetchSpvProof`, `buildCrossChainTransfer`/`buildCTransferAcross`, `buildContinuationTransaction`,
`submitContinuation`, `listenForCompletion`) hardcodes `.setNetworkId(KADENA_NETWORK)` /
`networkId: KADENA_NETWORK`, and `KADENA_NETWORK` is itself re-exported straight from
`@stoachain/stoa-core/constants` — confirmed by reading that file's own import line. This is the
exact "Kadena" naming trap this whole project has already hit twice (`KADENA_CHAIN_ID`,
`KADENA_CHAINS` both turned out to be stale StoaChain aliases) — `KADENA_NETWORK` here means
`"stoa"`, not `"mainnet01"`. A transaction or SPV-proof request built through any of these functions
would be rejected (or silently wrong) against a real Kadena node. `buildContinuationTransaction`
additionally hardcodes `gasLimit: 850` (StoaChain's `stoa-xchain-gas` account's own on-chain cap —
meaningless for Kadena) and spreads `stoaGasMeta(safeCreationTime())` (StoaChain's own rising Yin
Engine price floor — wrong for Kadena's fixed `10000`). None of this package is imported into this
topic's code; this mirrors exactly why `kadenaReads.ts` exists as a from-scratch reimplementation of
reads instead of reusing `stoa-core`'s `pactRead` — same trap, same fix.

**What real Kadena's own client (`@stoachain/kadena-stoic-legacy/client`'s `createClient(...)`,
already used by `kadenaReads.ts` and `SendKadenaModal.tsx`'s same-chain path) already gives for
free**, confirmed reading its own `.d.cts`: `pollOne(descriptor, options)` (blocks until the tx
resolves or `options.timeout` elapses — the exact "wait for initiate confirmation" primitive topic
1 hand-rolled for StoaChain), `pollCreateSpv(descriptor, targetChainId, options)` (blocks until the
SPV proof is available or `options.timeout` elapses — the exact "wait for SPV proof" primitive
topic 1's imported package gave it, built here instead), and `submitOne(signedTx)` (already used by
this file's same-chain path). No hand-rolled retry loop needed for either wait — `IPollOptions`'s
own `timeout`/`interval` fields cover it.

**Capability shapes** (confirmed live, `coin-v6.pact:97-108,120-125`): the INITIATE step signs
`coin.GAS` (no args, self-funded — same as the same-chain path) + `coin.TRANSFER_XCHAIN` (`sender
receiver amount target-chain` — note: NOT the same arg list as the function call itself, which
additionally takes `receiver-guard`; the capability's own `@managed`/`amount`-keyed shape doesn't
include it). The CONTINUATION step's own `resume` body only needs an internal, unmanaged `CREDIT`
capability — nothing a submitting signer must sign for — but the account SUBMITTING it still pays
real gas, and unlike StoaChain's `stoa-xchain-gas` (a purpose-built, signature-less gas-sponsor
account — confirmed via `crossChainFunctions.ts`'s own doc comment: "for the public gas station
path... no signature is needed... For user-paid-gas paths the transaction MUST be signed before
this function is called"), Kadena's sender pays with their OWN real keyset-guarded account, which
DOES require a real signature. So, unlike topic 1's `submitContinuation` call (never signed, for
either of StoaChain's two permissive gas-payer accounts), this topic's continuation transaction
must be **signed** (via the same `sign()` + `useGetKeypair()` primitive already used for the
initiate step, reusing the already-resolved keypair) before it is submitted.

**Self-funded, both legs, matching the approved project design exactly:** the sender's own key pays
gas on the SOURCE chain for the initiate step (same as same-chain sends) and on the TARGET chain
for the continuation, using whatever KDA balance the sender already holds there. Gas price is the
same fixed `KADENA_GAS_PRICE = 10000` on both legs; gas limit is calibrated the same
simulate-then-`calculateAutoGasLimit` way already established, run once for the initiate build and
again for the continuation build (a real `dirtyRead` simulation of a `Pact.builder.continuation({...})`
is not fundamentally different from simulating an `.execution({...})` — both produce the same
`ICommandResult` envelope this file's same-chain path already parses).

**The pending/unclaimed case, per the already-approved project design:** if the sender has no gas
on the target chain, the continuation's own simulation fails with an on-chain "insufficient funds"
refusal. This is explicitly NOT a hard failure — the initiate step already succeeded and the
receiver's funds are provably committed on-chain (yielded, per the defpact's own step-0 body); only
the *claim* is outstanding. The modal surfaces a distinct, honest **"pending / unclaimed"** status
(never "done", never "error") naming the target chain and the pact id (== the initiate step's own
`requestKey` — Pact's own model: a defpact's `pactId` is its originating transaction's hash) needed
to complete it later — by the sender (once they fund that chain) or, since `coin.transfer-crosschain`'s
own continuation needs no signature to complete the CREDIT itself, in principle by anyone willing to
pay that leg's gas. A future "claim a pending transfer" affordance is out of scope (see below); this
topic only needs to surface the state honestly at send time, matching the project design's own
"Codex surfaces this plainly rather than pretending the transfer completed."

**State machine** — extends `CrossChainStatus`'s existing five terminal states (topic 1's own
`configure → submitting → confirming → waiting-spv → completing → done | error`) with one more:
`pending-unclaimed` (continuation build/simulation failed for a gas/funding reason specifically —
distinguished from a hard `error` by matching the on-chain refusal message the same way
`createSimulationError` already categorizes "insufficient funds", reusing that exact classification
rather than inventing a second one).

**Tooltip**: `coin.transfer-crosschain` is already in the installed registry's `KADENA_SIGNATURES`
table (confirmed in topic 2's own research) — no stopgap needed, same as `coin.transfer`/
`coin.transfer-create`.

**Alternatives considered:**
- *Reuse `@ouronet/ouronet-core/interactions/crossChainFunctions` after all, passing Kadena's own
  values where the functions accept parameters.* Rejected: the `networkId` is NOT a parameter on
  any of these functions — it's a closed-over module import, not overridable per-call. Would need
  to fork/monkeypatch the imported module, which is worse than a from-scratch implementation against
  the already-Kadena-correct client this package already has.
- *Hand-roll a manual poll loop for the initiate confirmation and SPV proof, mirroring topic 1's own
  `waitForInitiateConfirmation`/`pollSpvProof` shapes exactly.* Rejected as unnecessary: Kadena's own
  client already provides `pollOne`/`pollCreateSpv` with equivalent timeout/interval options built in
  — reusing the library's real primitive is less code and less risk of a subtly-wrong reimplementation
  than re-deriving the same retry loop a third time (StoaChain's poll, Arweave's poll, and now this).

## Acceptance criteria

- [ ] `SendKadenaModal.tsx` shows a source-chain and target-chain selector (20 chains each,
      collision-avoided); choosing the same chain on both behaves exactly as the already-shipped
      same-chain path (unchanged `coin.transfer`/`coin.transfer-create`); choosing different chains
      fires `coin.transfer-crosschain`.
- [ ] The cross-chain path signs `coin.GAS` + `coin.TRANSFER_XCHAIN` for the initiate step (self-funded
      on the source chain), waits for its real on-chain confirmation, fetches the SPV proof, builds
      and SIGNS a continuation transaction (self-funded on the target chain — unlike StoaChain's
      unsigned continuation, since there is no permissive Kadena-mainnet gas-sponsor account), and
      submits it — all against Kadena's own client/networkId, never StoaChain's.
- [ ] When the sender has no KDA on the target chain, the modal shows a distinct "pending / unclaimed"
      state (never a false "done", never a bare "error") naming the target chain and the request key
      needed to complete the transfer later — the initiate step's own on-chain commitment is not lost
      or misrepresented.
- [ ] The same receiver-charset injection guard, k:-account-only restriction, and gas-limit
      sanity-guard already built into this file's same-chain path apply identically to the
      cross-chain path.
- [ ] Full workspace typecheck + test green, nectar review clean pass, `docs/work/
      kadena-crosschain-transfer/{plan.md,review.md}` written.

## Out of scope

- A UI to manually resume/claim a PAST pending Kadena crosschain transfer from a prior session (this
  topic only surfaces the pending state at the moment of the original send, matching the project
  design's own explicit "Out of scope" for this exact feature).
- Any change to `@ouronet/ouronet-core/interactions/crossChainFunctions` — confirmed StoaChain-only,
  left untouched; not imported by this topic's code at all.
- A Codex-operated shared Kadena crosschain gas-payer account (already out of scope at the project
  level).
