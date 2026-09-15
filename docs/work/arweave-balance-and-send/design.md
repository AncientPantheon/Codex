# Arweave Balance & Send — Design

## Problem

Arweave account rows in `ArweaveAccountsArea.tsx` show address, copy, ViewBlock explorer
link, and delete — but the value cell is hardcoded to `"Empty"` (balances were explicitly
out of scope for the work that built this row) and there is no way to send AR from an
account. Chainweb's rows already show live Stoa/UrStoa balances and have full
Send/Stake/Unstake/Collect/Transfer wired with toast feedback — the two chains' Accounts
pages don't read as one product yet.

The read/send plumbing for Arweave already exists and is tested in `arweave-core`
(`getBalance`, `sendTransfer`, `signTransaction`, mandatory fee-cap enforcement) and even
has a built UI (`SendArea.tsx`/`BalanceArea.tsx`) — but that UI was never mounted into the
live panel (`ArweavePanel.tsx`'s `CATEGORIES` list only has
`seeds/pure-keys/accounts/upload/library`), and two playground-level stubs
(`decryptArweaveKey`, `send`) throw unconditionally in real mode. Nothing here is reachable
end-to-end today, even for a developer who wanted to try it.

## Approach

Wire balance + send inline into `ArweaveAccountsArea`'s existing row cluster (matching
Chainweb's `AddressRow` parity), reusing arweave-core's already-tested pipeline rather than
resurrecting the orphaned `SendArea`/`BalanceArea` tab components (left as-is, unmounted).

**Balance.** Replace the hardcoded `"Empty"` value cell with a live read.
`ArweaveAccountsArea` already accepts a `getBalance` prop (currently used only for the
delete-guard, never displayed) — reuse it, firing one `getBalance(address)` call per
visible row in parallel via `Promise.allSettled` (no batching exists in arweave-core;
Arweave has no bulk-read endpoint), with a "Live balances / Refresh" control mirroring
`StoaAccountsTab`'s existing convention. Displayed via `winstonToAr` (already in
`arweave-core/units.ts`).

**Gateway.** Replace the playground's `localhost:1984` testnet-only default with a real
mainnet pool via the existing `createGatewayPool` mechanism, configured with a single
endpoint — `https://arweave.net`, Arweave's own reference gateway — per your instruction to
use "an official gateway." The pool abstraction supports adding more endpoints later
without further plumbing changes.

**Send — new modal, inline in the row cluster** (next to copy/explorer/delete), mirroring
`SendStoaModal`'s shell (`CodexModalShell`, `ModalExecuteRow`, `ModalFeedback`, toast via
`txPending`) but NOT its `useSignTransaction()` dispatch — Arweave has no
`CodexSigningStrategy`/gas-station equivalent. The modal resolves the JWK directly via
`decryptArweaveKey(entry)` at submit time only (never cached), following the same "resolve
secret material only at submit" discipline as the Chainweb `useGetKeypair()` family, and
uses `codex-arweave`'s own established lock-detection idiom (`isCodexLockedError`
name-based duck-type, not `instanceof` — `codex-arweave` doesn't value-import
codex-ouronet's error class today, and this keeps that boundary intact).

**New `sendFrom` deps member — additive, not a breaking change to `send`.**
`ArweavePanelDeps.send` today takes `{target, quantity, maxRewardWinston}` with no sender
identity — it was designed for a single implicit key. The row UI needs to send FROM a
specific entry. Rather than changing `send`'s signature (which would force touching the
still-tested, if unmounted, `SendArea.tsx`), add a new deps member:
`sendFrom(entry: ForeignKeyEntry, req: ArweaveSendRequest): Promise<ArweaveSendResult>`.
Its real implementation in `realArweaveAdapter.ts` chains: `decryptArweaveKey(entry)` → JWK,
then the adapter's existing `buildSend(...)` → `post(built, jwk)` (which itself calls
arweave-core's tested `sendTransfer` — anchor, price, fee-cap check, sign, post, with pool
rotation). No new crypto/signing code — pure composition of existing, tested primitives.

**Fee cap — auto-computed, not a manual field.** `sendTransfer` mandates a
`maxRewardWinston` cap but no standalone fee-estimate export exists yet. Add a small
`estimateFee(pool, byteSize, target)` export to `arweave-core` (extracted from
`tx/transfer.ts`'s existing internal price-fetch — not new logic), called by the modal to
show a live "Network fee: ~X AR" and to auto-set the cap to that quote × 1.2 (buffer for
quote drift between estimate and submit). Rejected: mirroring `SendArea.tsx`'s manual
required fee-cap field — correct, but a technical field out of place in a flow that should
read as simply as `SendStoaModal` (recipient + amount + submit). If the live quote at
submit time still exceeds the buffered cap (rare), `sendTransfer` throws
`RewardExceedsCapError`, surfaced as a normal retryable error, never swallowed.

**Two real-mode stub fixes (prerequisites, folded in).**
1. `realArweaveAdapter.ts`'s `decryptArweaveKey` is currently hardcoded to throw,
   ignoring the working `persistence?.decryptArweaveKey`. Fix it to fall back like every
   sibling method there already does — this backlog item has no purpose on its own now.
2. `realArweaveAdapter.ts`'s existing `send` stub is left untouched (nothing in this
   design calls it); the NEW `sendFrom` gets the real implementation instead.

**Sendability.** Every `ForeignKeyEntry` in the "Codex Accounts" tab implies a real
encrypted key (confirmed — no watch-only variant exists in the type today), so the Send
button appears on every row unconditionally; no gating logic needed. The separate "Watched
Accounts" sub-tab (currently a hardcoded 0-count stub) is untouched — wiring a real
watch-list is explicitly future work per your own roadmap.

**Explorer link.** Already wired (`viewblock.io/arweave/address/<address>` — confirmed as
the explorer Arweave's own docs point to) — no new work, listed here only for completeness.

## Acceptance criteria
- [ ] Each Arweave account row in "Codex Accounts" shows a live AR balance (via
      `winstonToAr(getBalance(address))`) instead of the hardcoded `"Empty"` text.
- [ ] Balance reads run against a real mainnet gateway (`https://arweave.net`), not the
      `localhost:1984` testnet placeholder, when the playground is in "real" mode.
- [ ] A refresh control re-fires all visible rows' balance reads on demand (mirroring
      `StoaAccountsTab`'s "Live balances / Refresh").
- [ ] Each row has a Send button opening a modal (recipient + amount only) that: shows a
      live estimated network fee, resolves the signing JWK only at submit time via
      `decryptArweaveKey`, submits via the new `sendFrom` deps member, shows the standard
      submit → confirming → confirmed toast, and surfaces `CodexLockedError` /
      insufficient-balance / fee-cap-exceeded as distinct, readable error messages (never
      swallowed or generic).
- [ ] `realArweaveAdapter.ts`'s `decryptArweaveKey` no longer throws unconditionally — it
      uses the working `persistence?.decryptArweaveKey` path in real mode.
- [ ] A successful send refreshes that row's balance automatically (same "success refreshes
      the active view" convention as the UrStoa modals).
- [ ] No changes to signing/crypto primitives themselves (`signTransaction`,
      `sendTransfer`) — this work only composes and wires existing, already-tested
      arweave-core functions.

## Out of scope
- Resurrecting or deleting the orphaned `SendArea.tsx`/`BalanceArea.tsx` tab components —
  left mounted nowhere, untouched, still tested.
- Watch-only / observed Arweave addresses (the "Watched Accounts" sub-tab stays a 0-count
  stub) — explicitly a later phase per your own roadmap (Address Book + observe wiring).
- Multi-gateway failover pool (more than the single `arweave.net` endpoint) — the pool
  mechanism supports it, but only one endpoint is configured now, per your instruction to
  "just use an official gateway."
- Upload capability / Upload Library (your phase A) — separate, later work.
- Address Book updates for Arweave (your phase B) — separate, later work.
- Bulk/batched balance reads — no such capability exists in arweave-core; out of scope to
  build one now (parallel per-address reads are sufficient at current account-list scale).
