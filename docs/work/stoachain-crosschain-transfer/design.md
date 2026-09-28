# stoachain-crosschain-transfer — Design

(Topic 1 of 3 in `docs/work/chainweb-crosschain-transfers/design.md` — read that first.)

## Problem

`SendStoaModal.tsx` hardcodes a single chain for both sender and receiver (its own doc comment:
"cross-chain requires a separate SPV continuation flow this modal doesn't do"). StoaChain's own
`coin.C_TransferAcross` (confirmed live, `coin-live.pact:589-592`: a thin `defun` wrapper over the
real `transfer-crosschain` defpact) is never called anywhere in Codex.

## Approach

**The crosschain mechanics are already published and installed — no reimplementation.** Confirmed
live: `@ouronet/ouronet-core@4.6.0` (already installed, matches Codex's own `>=4.6.0`/`^4.6.0`
range) exports `src/interactions/crossChainFunctions.ts` in full — `buildCTransferAcross`,
`submitCrossChainTransfer`, `pollTransactionStatus`, `pollSpvProof`, `buildContinuationTransaction`,
`submitContinuation` — byte-identical doc comments to OuronetUI's own already-shipped, audited
(3 named audit-finding closures in its own history) source. This topic wires Codex's UI to these
existing functions; it does not re-derive the crosschain protocol.

**Two distinct signing paths, matching `buildCTransferAcross`'s own two branches** (confirmed live
against its source):

- **Source chain "0"**: gas paid by the Ouronet Gas Station (`DALOS.GAS_PAYER`). Built INLINE (not
  via `buildCTransferAcross`) using the SAME shape `SendStoaModal.tsx` already uses for same-chain
  sends — `execute()`'s own `build` callback, with `capsKeyPub`/`gasLimit`/`gasPrice` auto-resolved
  and auto-calibrated by the existing pipeline (`CodexSigningStrategy.execute`'s "simulate →
  calibrate gas" step, `@stoachain/stoa-core/gas`'s `calculateAutoGasLimit` — unchanged, already
  used by every other CFM modal). Pact code: `(coin.C_TransferAcross ...)`. Sender's own key added
  via the SAME unscoped `guardPubs` loop `SendStoaModal.tsx` already uses — an unscoped signer
  "authorizes ANY capability requested for that key during execution" (that file's own doc comment),
  which covers `coin.TRANSFER_XCHAIN` exactly as it already covers `coin.TRANSFER` for same-chain
  sends; no separate scoped-capability signer needed.
- **Any other source chain**: gas paid by `stoa-xchain-gas` (confirmed live: the CURRENT real
  account name; `kadena-xchain-gas` is a stale name that survives only in OuronetUI's own doc
  comments/UI copy, not in the code path actually executed — see project design's own note). This
  account's own on-chain guard hard-caps `gasLimit <= 850` — NOT the calibrated
  `calculateAutoGasLimit` value, which could legitimately exceed 850 and fail the guard. Built via
  `buildCTransferAcross` DIRECTLY (bypassing `execute()`, which always injects a gas-station
  capsKeyPub — there is no "no gas signer" mode in that pipeline), resolving the sender's own
  keypair via `useGetKeypair()` (mirrors `StakeUrStoaModal.tsx`'s own "resolved at confirm-time only"
  pattern), signing with `CodexSigningStrategy.sign({tx, capsKey: senderKeypair, guardKeypairs: []})`
  (the low-level, resolver/client-agnostic primitive — its own doc comment: "Pure — doesn't touch
  the resolver or the client"), then `submitCrossChainTransfer(signed, sourceChain)`.

**The continuation is submitted automatically, matching OuronetUI's own flow exactly**: after the
initiate step's `pollTransactionStatus` confirms success, `pollSpvProof` polls (30 attempts, 5s
apart, matching the imported default) for the SPV proof, then `buildContinuationTransaction` +
`submitContinuation` (UNSIGNED — "can be executed by anyone", confirmed by the imported function's
own doc comment) completes the transfer on the target chain. A multi-step status is shown throughout
(`configure → submitting → confirming → waiting-spv → completing → done | error`, the same state
machine shape OuronetUI's own `CrossChainTransfer.tsx` uses) — never a single opaque spinner for a
flow that can take 100+ seconds.

**Chain selector**: a new, reusable `ChainSelector` component (10 numbered buttons, 0-9), mirroring
OuronetUI's own `ChainSelector` inline component exactly — two instances (source, target), the
target's own selector disables whichever chain is currently selected as source (and auto-advances
off it if the user changes source to collide with the current target), defaulting to source `"0"` /
target `"1"` on open. Choosing the SAME chain on both keeps today's exact same-chain path
(`C_Transfer`/`C_TransferAnew`, unchanged) — the selector doesn't force a crosschain call when the
user just wants today's existing behavior with the chain made explicit instead of implicit.

**Tooltip**: `coin.C_TransferAcross` is root-namespace (`coin`, not `ouronet-ns`) and is NOT in the
installed registry's `STOA_SIGNATURES` table (confirmed live — same class of gap as the previously
-found-and-reported `coin.C_UR|TransferAnew`). Rather than leaving this one launcher with no
tooltip at all (failing the project's own acceptance criterion), this topic adds ONE small, clearly
-flagged local spec for this single entrypoint — verified against the deployed contract the same way
the (now-deleted) `nativeStoaSpecs.ts` verified its own 7 entries, with a source-comparison test that
fails loudly on drift and skips visibly when the sibling Pact checkout is absent. Deleted once the
registry adds this entry upstream — same disposition as the `C_UR|TransferAnew` gap.

**Alternatives considered:**
- *Reimplement the crosschain build/poll/continue functions locally instead of importing
  `@ouronet/ouronet-core`'s.* Rejected: they're already installed, already audited (3 named
  audit-finding closures), and importing them is the entire point of this session's own
  "we render from ONE implementation" discipline — reimplementing would be the exact drift class
  this whole project has been correcting.
- *Use `calculateAutoGasLimit`'s calibrated output for the non-chain-0 gas-payer path too.*
  Rejected: `stoa-xchain-gas`'s own on-chain guard is a hard `<= 850` ceiling; a calibrated value
  that happens to exceed it would fail the guard check on submit, not gracefully degrade. Use the
  same hardcoded `850` `buildCTransferAcross` itself already uses for this path.
- *Build a brand-new modal component instead of extending `SendStoaModal.tsx`.* Rejected: the
  same-chain path must stay byte-identical to today (same validation, same UI copy, same success/
  error handling) — extending in place, gated behind the new chain selector, is lower-risk than a
  parallel component that could silently drift from the original's own edge-case handling.

## Acceptance criteria

- [ ] Opening Send shows a source-chain and target-chain selector (10 buttons each), defaulting to
      0/1; selecting the same chain on both behaves exactly as today.
- [ ] Selecting different chains fires `coin.C_TransferAcross` on the source chain via the correct
      signing path for that chain (gas-station-signed on chain 0, unsigned-gas/self-signed-transfer
      elsewhere), then automatically polls for and submits the SPV continuation with no user action
      required, showing a multi-step status throughout.
- [ ] The non-chain-0 gas-payer path never submits a `gasLimit` above 850.
- [ ] A `PreZbomHint` tooltip appears on the Send button showing `coin.C_TransferAcross`'s real
      5-parameter signature (verified against the deployed contract), with the same gold `stoa`
      border/label the existing native cards already use.
- [ ] Full workspace typecheck + test green.

## Out of scope

- Everything Kadena — topics 2/3.
- A durable "pending crosschain transfers" list surviving app restart (see project design's own
  "Out of scope").
