# chainweb-crosschain-transfers — Design

## Problem

Codex has no crosschain transfer capability on either chainweb network it supports, and no
transfer capability at all (same-chain or cross) on Kadena mainnet:

1. **StoaChain's `SendStoaModal.tsx`** hardcodes a single chain for both sender and receiver
   (`STOACHAIN_CHAIN_ID`, confirmed at `SendStoaModal.tsx`'s own doc comment: "Native Stoa is a
   braided multi-chain coin... cross-chain requires a separate SPV continuation flow this modal
   doesn't do"). StoaChain's own `C_TransferAcross` (a thin wrapper over the real `transfer-crosschain`
   defpact — confirmed live: `coin-live.pact:589-592`) is never called anywhere in Codex.
2. **Kadena mainnet has zero write capability.** `src/kadena/` is read-only by explicit design
   (`kadenaReads.ts`'s own doc comment: "Signing/submitting... needs its own wiring... future work,
   not attempted here") — no send, same-chain or cross-chain.
3. **A real, separate bug** (already fixed in this same round, see below): the Kadena account's
   expanded per-chain balance grid only ever showed 10 rows (StoaChain's own chain count),
   silently dropping any Kadena balance on chains 10-19, because both render sites in
   `StoaAccountsTab.tsx` imported `STOA_CHAINS` unconditionally regardless of `activeNetwork`.

## Approach

Three topics, each independently shippable, in dependency order (2 and 3 both reuse patterns
established in 1, though neither directly imports its code):

1. **`stoachain-crosschain-transfer`** — add a source-chain/target-chain selector to native Stoa's
   Send flow (10 chains, mirrors OuronetUI's own already-shipped `CrossChainTransfer.tsx` 0-9 button
   grid exactly — same component is reused for the existing same-chain case when source === target),
   wire `C_TransferAcross` for the initiate step, and auto-submit the SPV-proof continuation exactly
   as OuronetUI already does (poll → build `cont` tx → submit, no signature required on the
   continuation — "can be executed by anyone" per the on-chain defpact's own step-1 shape). Reuses
   `@stoachain/stoa-core/gas`'s own `calculateAutoGasLimit` — the SAME calibration function every
   other CFM modal already goes through via `CodexSigningStrategy.execute`'s "simulate → calibrate
   gas" step — for both the initiate and continuation steps, clamped to the `stoa-xchain-gas`
   account's own on-chain 850 gas-limit guard for the non-chain-0 gas-payer path. Uses the REAL
   current account name `stoa-xchain-gas` (confirmed live in `ouronet-core`'s own source/changelog),
   not the stale `kadena-xchain-gas` name that survives only in OuronetUI's own doc comments/UI copy
   for the same code path.
2. **`kadena-native-transfer`** — a new Kadena Send modal for same-chain transfers
   (`coin.transfer`/`coin.transfer-create`, KIP-0002 lowercase-kebab names, confirmed live in
   `coin-v6.pact`), with its own 20-chain selector (Kadena is braided multi-chain too — the same
   `senderChainBalance`-per-chain problem `SendStoaModal.tsx` already solves for Stoa, just with
   twice the chains). Self-funded gas throughout: the sender's own key pays via `useGetKeypair()` +
   `CodexSigningStrategy.sign()` (the low-level, resolver/client-agnostic primitive — confirmed by
   its own doc comment: "Pure — doesn't touch the resolver or the client"), never the high-level
   `execute()` pipeline (which always auto-selects an Ouronet Gas Station key — there is no such
   station on real Kadena mainnet). Gas price fixed at `10000` (the user's own stated floor); gas
   LIMIT calibrated via the SAME `calculateAutoGasLimit` used everywhere else in this codebase, fed
   from a dirty-read simulation against the Kadena node directly (`kadenaReads.ts`'s own
   `createClient`/`kadenaPactUrl` primitives, not stoa-core's StoaChain-bound client).
3. **`kadena-crosschain-transfer`** — Kadena's own `transfer-crosschain` (confirmed live, a genuine
   2-step defpact identical in shape to StoaChain's forked copy: `coin-v6.pact:97-108,528-556`).
   **No real Kadena-mainnet equivalent of `stoa-xchain-gas` exists** (confirmed: exhaustively grepped
   the Kadena coin-contract tree in `00_KadenaSandbox/`for any such account — zero hits; every
   `kadena-xchain-gas` reference anywhere in the source tree is StoaChain/Ouronet's own legacy name
   for its own account, documented in StoaChain's own genesis module, not a Kadena-mainnet primitive).
   So the sender's own key pays gas on BOTH legs: the initiate step on the source chain (same key as
   topic 2), and — since a Kadena defpact's continuation "can be executed by anyone" but still needs
   ITS OWN funded gas payer on the target chain — the continuation too, using whatever balance the
   sender already holds on the target chain. When the sender has none there yet, the transfer is left
   in a genuine **pending/unclaimed** state after the initiate step succeeds (the receiver's funds are
   provably committed on-chain via the yielded continuation data; the continuation itself can be
   submitted later by anyone, including the sender once they've moved gas to the target chain, or the
   receiver, or a future "claim" affordance) — Codex surfaces this plainly rather than pretending the
   transfer completed.

**Alternatives considered:**
- *Route Kadena crosschain gas through a Codex-operated shared account, mirroring `stoa-xchain-gas`.*
  Rejected for this round: stands up new, ongoing-liability infrastructure (a funded, monitored
  mainnet account Codex itself would need to keep solvent) — a real option, but a business/ops
  decision, not a code decision, and explicitly out of scope until made deliberately.
- *Block Kadena crosschain entirely until a gas-payer story exists.* Rejected: same-chain Kadena
  transfers (topic 2) don't need this at all, and a user who already holds KDA on both source and
  target chains can complete a crosschain transfer today with the self-funded design — leaving it
  out entirely would block a working case to avoid an edge case that already degrades honestly.

## Acceptance criteria

- [ ] Native Stoa's Send flow shows a source-chain and target-chain selector (10 chains); choosing
      the same chain on both behaves exactly as today (unchanged `C_Transfer`/`C_TransferAnew`
      same-chain path); choosing different chains fires `C_TransferAcross`, then automatically polls
      for and submits the SPV-proof continuation, with a visible multi-step status (matching
      OuronetUI's own `configure → submitting → confirming → waiting-spv → completing → done | error`
      shape) rather than a single opaque "submitting" spinner.
- [ ] A Kadena Send modal exists, wired to the (already-fixed) 20-chain balance grid, with its own
      chain selector; same-chain sends use `coin.transfer`/`coin.transfer-create`; the sender's own
      key pays gas (price `10000`, limit calibrated the same way every other CFM modal calibrates
      gas) — no Ouronet Gas Station involvement anywhere in this flow.
- [ ] Choosing different source/target chains on the Kadena Send modal fires `coin.transfer-crosschain`
      and attempts the same auto-continuation Stoa's own crosschain flow uses, self-funded; when the
      sender has no gas on the target chain, the UI shows a clear pending/unclaimed state (not a
      false "done") with the request key / pact id needed to complete it later.
- [ ] Every new launcher (Stoa crosschain, Kadena same-chain, Kadena crosschain) gets a
      `PreZbomHint` tooltip via the same canon (`tooltipModel`/`tooltipModels`) already wired for
      every other launcher — `C_TransferAcross` and Kadena's `transfer-crosschain` are not in the
      installed registry's tables today (confirmed), so this topic also decides how those specific
      tooltips are sourced (see each topic's own design for the resolved approach — likely a small,
      clearly-flagged local addition mirroring the shape of the registry's own `STOA_SIGNATURES`,
      pending an upstream fix, matching how the missing `coin.C_UR|TransferAnew` gap was already
      handled/reported this session).
- [ ] Full workspace typecheck + test green, every topic closed with its own nectar review.

## Out of scope

- A Codex-operated shared Kadena crosschain gas-payer account (see Alternatives).
- Any change to OuronetUI's own `CrossChainTransfer.tsx`/`crossChainFunctions.ts` — read-only
  reference, ported from, never edited.
- A UI to manually resume/claim a pending Kadena crosschain transfer from a PAST session (this
  round only surfaces the pending state at the moment of the original send; a durable "your pending
  crosschain transfers" list is a natural follow-up, not attempted here).
- MinerTransfer.tsx-style N-chain parallel aggregate sends (OuronetUI's own bulk/miner tool) — this
  project is single-transfer only, matching `SendStoaModal.tsx`'s own existing scope.

## Topics

1. `stoachain-crosschain-transfer` — chain selector + `C_TransferAcross` + auto-continuation for
   native Stoa sends.
2. `kadena-native-transfer` — same-chain Kadena send, self-funded gas, 20-chain selector.
3. `kadena-crosschain-transfer` — Kadena `transfer-crosschain`, self-funded both legs, pending state.
