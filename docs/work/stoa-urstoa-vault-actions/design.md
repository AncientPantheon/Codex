# Stoa/UrStoa toggle + vault actions + native Send — design

Chainweb Accounts (`StoaAccountsTab.tsx`) gains a Stoa/UrStoa toggle, four
UrStoa vault action buttons, and a native Stoa Send button. Everything here
already ships in OuronetUI — this is a port, using library functions
`@ouronet/ouronet-core@^4.6.0` (already a dependency) already publishes.

## Resolved design decisions (both were open questions; both are settled)

**1. `executeStakeUrStoa`/`executeUnstakeUrStoa`/`executeCollectUrStoa`/
`executeNativeUrStoaTransfer`'s `gasStationKey`/`paymentKeypair` params.**
Confirmed by reading the real OuronetUI source
(`OuroborosNetwork/daimons/OuronetUI/src/components/StakeUrStoaModal.tsx`,
the "Patronless / gasless" comment at ~line 204): there is no separate
gas-station secret. The flow is patronless — the PAYMENT KEY ITSELF signs
both the `DALOS.GAS_PAYER` capability and the `coin.URV|STAKE`/`UNSTAKE`/
`COLLECT` capability. `gasStationKey` is a misleadingly-named parameter;
callers pass the SAME decrypted payment keypair for it and for
`paymentKeyAddress`'s owning key.

**2. How to get that decrypted keypair, on demand, unlock-gated.**
`packages/codex-ui/src/hooks/useGetKeypair.ts`'s `useGetKeypair()` is the
already-established seam for exactly this — `(publicKey) =>
Promise<IStoaChainKeypair>`, delegates to the injected
`InternalCodexResolver.getKeyPairByPublicKey`, throws `CodexLockedError`
when locked. This is what OuronetUI's wallet-context calls
`getStoaChainKeyPairsByPublicKey`. Use it directly in every new modal below —
call it only at confirm-time (never eagerly), same discipline every other
decrypt-on-demand flow in this codebase already follows.

Native Stoa's Send has no equivalent library function (OuronetUI's own Send
button, `transfer-token.tsx`, builds the Pact code inline) — build it via the
EXISTING generic seam, `packages/codex-ui/src/hooks/useSignTransaction.ts`'s
`execute` (a bound `CodexSigningStrategy.execute`), mirroring
`packages/codex-ouronet/src/components/RotatePaymentKeyModal.tsx`'s exact
pattern (that component already builds+signs+broadcasts an arbitrary Pact tx
this same way).

## Bulk UrStoa balance read

No library function does this in bulk. Mirror
`packages/codex-ouronet/src/ui/internal/useStoaChainBalances.ts`'s "Read A"
exactly (one `pactRead` call batching every address via `map`/`try`), but:
- ONE chain only, chain `"0"` (UrStoa is not deployed across `STOA_CHAINS`
  the way native `coin` is — confirmed via OuronetUI's `KADENA_CHAIN_ID`
  constant, hardcoded everywhere UrStoa is read/written).
- The batched Pact expression per address returns three fields:
```
(map (lambda (a) (try { "account": a, "balance": 0.0, "staked": 0.0, "earnings": 0.0, "exists": false }
  { "account": a,
    "balance": (coin.UR_UR|Balance a),
    "staked": (coin.UR_URV|UserSupply a),
    "earnings": (coin.URC_URV|ClaimableRewards a),
    "exists": true })) [addrs]
```

## UI

- Toggle: Stoa / UrStoa, near the existing "Live balances"/"Refresh" header
  controls in `StoaAccountsTab.tsx`.
- UrStoa view: each row shows `"{wallet} [{staked}]"` using the SAME number
  formatting helper the file already uses for Stoa amounts. Four small
  square icon buttons per row: Transfer, Stake, Unstake, Collect.
- Native Stoa Send button: always visible (not gated by the toggle — it's
  about native Stoa specifically).
- Every action opens a `CodexModalShell`-based modal (amount input for
  Transfer/Stake/Unstake/Send, straight confirm for Collect), in-flight /
  success / error states mirroring `RotatePaymentKeyModal.tsx`, success
  calls the balance hook's `refresh()`.
- Send's Pact code mirrors OuronetUI's `transfer-token.tsx`: `coin.C_Transfer`
  when the receiver account already exists, `coin.C_TransferAnew` (create +
  transfer) when it doesn't — check receiver existence the same way
  `executeCollectUrStoa`'s own `accountExists` branch already does for a
  different action (`checkCoinAccountExists`-style probe, or the equivalent
  generic one for native coin).

## Out of scope (later phases)

Arweave balance/send, address book, upload/library — not this pass.
