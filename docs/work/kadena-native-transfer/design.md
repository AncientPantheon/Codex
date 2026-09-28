# kadena-native-transfer — Design

## Problem

Codex has zero write capability against real Kadena mainnet. `src/kadena/kadenaReads.ts` is
explicitly read-only by design (its own doc comment: "Signing/submitting... needs its own
wiring... future work, not attempted here"), and `StoaAccountsTab.tsx` explicitly hides the
"Send" action whenever `activeNetwork === "kadena"` (its own doc comment: "signing/submitting
against real Kadena mainnet isn't wired yet"). A user viewing a Kadena-mode account today has no
way to move funds at all, same-chain or cross-chain.

This topic covers same-chain only (`coin.transfer` / `coin.transfer-create`). Crosschain
(`coin.transfer-crosschain`) is topic 3, deliberately sequenced after this one since it reuses
this topic's signing/gas-calibration pipeline directly.

## Approach

Mirror `SendStoaModal.tsx`'s shape as closely as the two chains' real differences allow, reusing
every already-built, chain-agnostic piece rather than re-deriving it:

- **New `SendKadenaModal.tsx`**, same modal shell (`CodexModalShell`/`ModalExecuteRow`/
  `ModalFeedback`), same `ChainSelector` component topic 1 built — passed `chainCount={20}` (the
  prop was deliberately pre-built for exactly this in topic 1's own review). Kadena has no
  cross-chain selector in THIS topic (single "Chain" picker, not source+target) — same-chain only.
- **Self-funded gas, no gas station.** Real Kadena mainnet has no Ouronet-style shared gas-payer
  account (confirmed exhaustively in the project design's own research). The sender's own key
  signs both the `coin.GAS` capability (no args — confirmed live,
  `coin-v6.pact:43`: `(defcap GAS () "Magic capability..." true)`) and the `coin.TRANSFER`
  capability (`sender receiver amount` — confirmed live, `coin-v6.pact:73-80`, a `@managed`
  capability keyed by `amount`). `senderAccount` in `.setMeta` is the sender's own account, not a
  gas station.
- **Gas price fixed at `10000`** — the user's own explicit, authoritative correction this round
  ("10000 is the gas price, not the gas limit"). NOT derived via `@stoachain/stoa-core/gas`'s
  `stoaGasMeta()` — that formula is StoaChain's own rising Yin Engine floor (genesis
  2026-02-23, ticks upward from 10000 ANU), a StoaChain-specific number that happens to start at
  the same digits but is architecturally a different thing; using it here would silently drift
  Kadena's price off the fixed value the user specified. A new `KADENA_GAS_PRICE = 10000` constant
  in `SendKadenaModal.tsx` documents this distinction explicitly.
- **Gas limit calibrated via the SAME `calculateAutoGasLimit`** (`@stoachain/stoa-core/gas`) every
  other CFM modal already uses — confirmed chain-agnostic (a pure function over a simulated-gas
  number, no StoaChain-specific state). Fed from a `dirtyRead` simulation against the real Kadena
  node directly (`createClient(kadenaPactUrl(...)).dirtyRead(...)`, the exact primitive
  `kadenaReads.ts` already uses for balance reads) — mirrors `rotatePaymentKeyLive.ts`'s own
  self-contained "simulate → calibrate → rebuild → sign → submit" shape exactly, just pointed at
  Kadena's own client instead of StoaChain's `getFailoverClient`.
  - `kadenaPactUrl` is currently a private (un-exported) helper in `kadenaReads.ts` — exported
    for reuse here rather than duplicating the URL template (same "one canonical implementation"
    rule this whole project follows). `getActiveKadenaNodeUrl()` is already exported and reused
    as-is.
- **Signing** via `useSignTransaction()`'s `sign` (the low-level `CodexSigningStrategy.sign`
  primitive, "Pure — doesn't touch the resolver or the client" per its own doc comment) +
  `useGetKeypair()` — the EXACT pattern topic 1 already established for StoaChain's non-chain-0
  crosschain path (self-funded, no `execute()`). `creationTime` via `safeCreationTime()`
  (`@stoachain/stoa-core/pact`) — confirmed chain-agnostic (`Date.now()/1000 - 30`, no StoaChain
  coupling).
- **Submitting/polling** via the same Kadena `createClient(...)` instance's own `submitOne`/
  `getStatus` (confirmed in `@stoachain/kadena-stoic-legacy/client`'s own `IClient` interface —
  the exact client `kadenaReads.ts` already builds for reads, just also exposing `submit`/
  `pollStatus`/`getStatus` alongside `dirtyRead`).
- **Toast integration.** `toastManager.ts`'s `submitted(requestKey, chainId)` today only knows how
  to poll StoaChain (`'stoachain'`, hardcoded `@stoachain/stoa-core/constants`'s `getPactUrl`) or
  Arweave (`'arweave'`, via an injected `pollFn` — no Pact-style poll model). Kadena needs a THIRD
  case: real Pact-style request-key polling, but against a different node/networkId than
  StoaChain. Rather than reimplement the injected-`pollFn` idea for a third chain under a
  mislabeled `'arweave'` tag, `ToastChain` gains a first-class `'kadena'` member, reusing the
  EXACT same generic "injected poll callback" mechanism Arweave already established (renaming the
  now-not-arweave-only private `_pollArweaveConfirmation` to `_pollViaInjectedFn`, no behavior
  change to the Arweave path). `SendKadenaModal.tsx` supplies a `pollFn` built from the Kadena
  client's own `getStatus`. `MultiStepToastContainer.tsx`'s `CHAIN_THEME` (a `Record<ToastChain,
  ...>`, so the compiler forces this) gets a `kadena` entry: accent `#22c55e` (matches
  `@ouronet/talos-registry`'s own `CHAIN_PALETTE.kadena` — the tooltip canon and the toast now
  agree on "green means Kadena"), explorer link `https://explorer.chainweb.com/mainnet/tx/<id>`
  (Kadena's own public chainweb explorer's documented tx-URL convention — **flagged as unverified
  by a live fetch**, no web access in this environment; this environment already has one
  precedent for "our own explorer might be wrong, fix on report" in `kadenaExplorerUrl`'s own doc
  comment, so the same honesty applies here).
- **Tooltips**: `coin.transfer` and `coin.transfer-create` are ALREADY in the installed registry's
  `KADENA_SIGNATURES` table (confirmed live — no gap, unlike topic 1's `coin.C_TransferAcross`).
  No local stopgap needed; `PreZbomHint entrypoint={["coin.transfer", "coin.transfer-create"]}`
  works today exactly like every other already-migrated launcher.
- **Injection guard**: same charset allowlist class as topic 1's CRITICAL finding
  (`SAFE_ACCOUNT_RX`), applied to the receiver BEFORE any pact-code interpolation or existence
  check — built in from the start this time, not discovered in review.
- **`tx-gas-meta-surface.test.ts` gains a fourth site category.** This new site is self-contained
  (no injected `execute()` ctx — same as `SELF_CONTAINED_TX_SITES`) but does NOT spread
  `stoaGasMeta(...)` (gas price is a fixed literal, not StoaChain's rising floor) — the existing
  two categories (ctx-injected; self-contained-via-stoaGasMeta) don't fit. A new
  `FIXED_GAS_PRICE_TX_SITES` set is added with its own dedicated checks: still inventoried (a),
  `.setMeta` still literally carries `gasPrice`/`creationTime` (b)/(c), exempt from the
  ctx-destructure requirement (d)/(e) like the self-contained category, but instead of requiring
  `stoaGasMeta(safeCreationTime())`, requires `safeCreationTime()` alone (real clock read,
  legitimate for a self-contained site) AND a literal fixed gas-price constant (not derived).

**Alternatives considered:**
- *Route Kadena sends through `CodexSigningStrategy.execute()`.* Rejected: `execute()` always
  auto-resolves a gas-station `capsKeyPub` internally — there is no "self-funded, no gas signer"
  mode in it (confirmed reading `codexStrategy.js` in topic 1). Would need its own new mode added
  to a widely-shared primitive for a single caller; the low-level `sign()` primitive already fits.
- *Mislabel the Kadena toast as `chain: 'arweave'` to reuse its `pollFn` escape hatch without
  touching `toastManager.ts`.* Rejected: wrong accent color, wrong dismiss timing (10x longer,
  tuned for Arweave's ~2min blocks vs. Kadena's ~30s), and a toast literally saying "Arweave" for
  a Kadena send — confusing by construction. The real fix (a first-class `'kadena'` chain kind) is
  a small, well-precedented, compiler-enforced extension of a pattern already proven for Arweave.
- *Hardcode Kadena's gas price via a new `kadenaGasMeta()` mirroring `stoaGasMeta()`'s shape.*
  Rejected as unnecessary: there is no rising-floor formula to encapsulate — it is one fixed
  literal, so a bare constant is simpler and doesn't imply a formula that doesn't exist.

## Acceptance criteria

- [ ] Viewing a Kadena-mode account shows a "Send KDA" action (same position/chrome as native
      Stoa's own Send action), with a `PreZbomHint` tooltip via `coin.transfer`/
      `coin.transfer-create`.
- [ ] The Send KDA modal shows a 20-chain selector (`ChainSelector` with `chainCount={20}`),
      receiver/amount inputs, and the sender's real balance on the selected chain (reusing the
      already-fixed `KADENA_CHAINS`/`perChain` wiring from the earlier balance-grid fix).
  - [ ] `coin.transfer` fires when the receiver account already exists on the selected chain;
        `coin.transfer-create` fires when it doesn't (k: receivers only, mirrors
        `SendStoaModal.tsx`'s own existing-vs-new branch).
- [ ] Gas is paid entirely by the sender: `coin.GAS` + `coin.TRANSFER` capabilities both signed by
      the sender's own key, gas price fixed at `10000`, gas limit calibrated via
      `calculateAutoGasLimit` against a real dirty-read simulation — never an Ouronet Gas Station
      signer anywhere in this flow.
- [ ] A receiver address containing characters outside the allowlisted account charset is
      rejected before any pact-code interpolation or existence check (same protection class as
      the CRITICAL finding topic 1 fixed after the fact — built in from the start here).
- [ ] The submitted transaction is tracked by a toast that correctly polls Kadena's own node for
      confirmation (not StoaChain's), with its own visually distinct (green) accent.
- [ ] Full workspace typecheck + test green, nectar review clean pass, `docs/work/
      kadena-native-transfer/{plan.md,review.md}` written.

## Out of scope

- Cross-chain Kadena transfers (`coin.transfer-crosschain`) — topic 3.
- A durable multi-chain aggregate balance display beyond what already exists (this topic reads
  balances the same way the existing grid already does).
- Verifying `https://explorer.chainweb.com/mainnet/tx/<id>` against a live fetch (no web access
  in this environment) — flagged for the user/a future session to confirm or correct.
