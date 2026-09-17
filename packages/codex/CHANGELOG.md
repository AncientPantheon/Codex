# Changelog

All notable changes to `@ancientpantheon/codex`.

## 0.11.0 — 2026-09-17

**MINOR — two new chain capabilities: native Arweave (balance, send, keyring,
seeds) and direct native Stoa/UrStoa movement (vault actions + send). No
breaking changes. `codex`-only release** (`arweave-core` unchanged).

### Added — Arweave: keyring, seeds, live balance + native send

- **Pure Keys** category wired end-to-end: random RSA-4096 generation via a
  Generate/Save two-step flow (free reroll before commit), PEM keyfile
  import (private+public `.pem`, cross-validated via WebCrypto, discarded
  after save) alongside JSON-keyfile import, per-row RSA parameter details,
  a balance-aware delete guard (blocks deleting a funded seedless key, warns
  on a seed-protected one), and Chainweb-style collapsible rows.
- **Seeds**: Direct Deterministic RSA Generation (BitString/Bitmap/Base-10/
  Base-49, 1024/1600-bit) alongside Seed Words Deterministic RSA Generation;
  a unified 3-tile "enter your own seed" picker (Stoa Dalos / Dictionary
  12-word / Dictionary 24-word); unified seed reveal UI with DALOS-charset
  info and a worst-case entropy preview.
- **Live balances + native AR send**: every account row shows a real
  on-chain balance (with a manual refresh control) instead of a hardcoded
  placeholder. The Send AR modal offers a "Fee Included" (typed amount is
  the total debited) / "Fee On Top" (typed amount is exactly what the
  recipient gets) toggle with an estimated-arrival line, live balance-aware
  validation, and the codex-unlock gate now pops the real password prompt
  on a locked codex instead of dead-ending on a static error.
- **Real on-chain transaction confirmation.** The send toast now polls
  Arweave's own gateway (`getTransactionStatus`, the same primitive the
  Library's upload-confirmation flow already uses) every 15s for up to
  ~10 minutes instead of guessing "done" the instant the broadcast
  succeeds, and links "View on Explorer" at ViewBlock's Arweave tx page
  with a distinct violet accent (not StoaChain's explorer/gold — the old
  link pointed an Arweave tx id at StoaChain's explorer, a dead link). The
  settled toast stays visible 10x longer, and carries an honest caption
  about third-party explorer indexing lag.
- **Balance freshness.** The Accounts view now refreshes every visible
  balance on real transaction confirmation (not just at broadcast time,
  before a debit is final) and shows a live "Updated Xs ago" label next to
  "Live balances" so staleness is never a guess.
- **Watch-list persistence.** Watched addresses (and the Prime Arweave
  Seed) now round-trip through the codex JSON backup export/import — both
  were previously dropped silently on reload. "Real" gateway mode is now
  the default (mock mode moved to Codex UI Settings, no longer shown on the
  main Accounts view), with a one-time migration off a stale local gateway
  default and a fixed "Watch" button that previously threw on first use.

### Added — direct native Stoa / UrStoa movement

- **UrStoa vault actions** on the Chainweb Accounts tab: a Stoa/UrStoa
  toggle shows liquid + staked + claimable balances (bulk chain-0 read) and
  exposes **Transfer / Stake / Unstake / Collect** as icon buttons with
  live-data tooltips; Stoa mode keeps a single Send button. Every action
  shows the standard submit/confirming/confirmed toast, and the row
  highlight now accounts for staked/claimable balances, not just liquid.
- **Native Stoa send** (`coin.C_Transfer`/`coin.C_TransferAnew`) now shows
  which of the 10 braided chains the transfer actually executes on and the
  sender's balance ON that specific chain — a balance on chain 3 doesn't
  fund a send that runs on chain 0.
- **Locked-codex fix**, applied uniformly to all six modals above plus Send
  AR: a signed action attempted on a locked codex now pops the real
  password prompt and resumes automatically, instead of showing a static
  "Codex is locked" error and dead-ending. A cancelled prompt stops
  quietly — declining to unlock isn't a failure.

## 0.10.0 — 2026-08-10

**MINOR — fixes a real transaction bug on every signed transaction; raises two
peer floors. `codex`-only release** (`arweave-core` unchanged).

### Fixed — `meta.gasPrice` was never set

All **13** signed/submitted transaction-building sites omitted `gasPrice`
entirely, so Pact's client default (`1e-8`) went out on the wire instead of the
live Yin Engine floor — under-priced commands that chainweb can reject.

`@stoachain/stoa-core@4.4.0` exports the canonical Yin Engine gas formula
(`minGasPriceAnu`, `anuToStoaNumber`, `stoaGasMeta` from
`@stoachain/stoa-core/gas`), and `CodexSigningStrategy.execute()` now performs
**one** `stoaGasMeta()` clock read per call and injects `gasPrice` +
`creationTime` into every `build(ctx)` callback, alongside the `gasLimit` it
already injected. Every site now accepts both from that ctx and spreads them
into `.setMeta({...})`, consistently — no site calls `stoaGasMeta()` or
`safeCreationTime()` itself.

This also fixes a **latent request-key bug**: the strategy invokes `build()`
twice (a gas-measuring simulation pass, then the real pass). The old per-call
`safeCreationTime()` produced a *different* `creationTime` between the two
passes, changing the command hash. Taking `creationTime` from the injected ctx
guarantees both passes see identical values.

Two operations (`RotateGuard`, `RotatePaymentKey`) additionally exist as
delegating modals that call `rotateGuard()` / `rotateKadenaPaymentKey()` in
`@ouronet/ouronet-core`; those were fixed upstream and need no local change —
the re-pin alone corrects them.

### Added

- `tests/tx-gas-meta-surface.test.ts` — a shape guard locking the exact inventory
  of transaction sites and asserting every one passes `gasPrice` + `creationTime`
  from the injected ctx (and re-reads no clock). A new transaction site fails the
  suite until it satisfies the gas contract.

### Changed — peer floors (action required)

Consumers **must** provide:

- `@stoachain/stoa-core` **>=4.4.0** (was >=4.3.0)
- `@stoachain/kadena-stoic-legacy` **>=4.4.0** (was >=4.3.0)
- `@ouronet/ouronet-core` **>=4.6.0** (was >=4.3.0)

## 0.9.1 — 2026-08-10

**PATCH — Address Book display fixes, no API changes. `codex`-only release**
(`arweave-core` unchanged).

- **No more horizontal bulge.** Long, unbreakable Ouronet addresses in the
  Address Book no longer expand a card past the page width. The entry-list grid
  now uses `grid-template-columns: minmax(0, 1fr)` so the single column is clamped
  to the container and long rows truncate instead of overflowing. Fixes all three
  sub-tabs (Ouronet, StoaChain™, StoicTags) in one change.
- **Consistent address rendering.** Ouronet Address Book entries now use the same
  `OuronetAddressHighlight` component as the Ouronet Accounts tab — blue-bold
  first-3/last-3 highlight, fills the available width, centered `start … end`
  middle-truncation.
- **No display "retract".** `MiddleEllipsis` and `OuronetAddressHighlight` render
  directly in their final truncated form (kept hidden until the measured width
  settles) — no visible "long → shrink" flash on mount.
- **Removed the erroneous `KADENA:MAINNET` chain chip** from Address Book rows —
  everything sits on StoaChain, which is mainnet-only.

## 0.9.0 — 2026-08-08

**MINOR — additive, no breaking changes. `codex`-only release** (`arweave-core`
unchanged).

Pythia consumer-API-key management in the Ouronet accounts view. Two new account
sub-tabs — **Single API** (link Apollo ₱./Π. halves into a dual API key) and
**Dual API** (manage the linked composite keys) — plus three ZBOM transaction
modals authorized by both half-owners: **Link** (no fee), **Rename lane** (100
STOA, 4-way split), and **Revoke** (1 IGNIS kill-switch). Costs and split
receivers are read from the on-chain INFO so they never drift. Also adds a
**post-transaction refresh**: the whole accounts view now re-reads chain state
automatically once any Codex transaction confirms (activation, guard, payment
key, API-key status, dual links), instead of requiring a manual reload. Fixes
registered-but-unlinked API halves reading as linked, and a stale signing-zone
spinner on owner-only transactions.

## 0.8.1 — 2026-08-03

**PATCH — bug fix.** The Ouronet account card no longer hides an account's
Payment Key when that payment-key address has never held STOA. Every registered
Ouronet account is assigned a payment key at activation; the chain's
`payment-key-existance` flag reports only whether that address has ever held
STOA (virgin vs funded), not whether a payment key exists — but the card gated
the whole Payment Key section on it, so a virgin (never-funded) payment key
vanished entirely. It now shows the payment-key address whenever the chain
returns one, with a "virgin · never funded" marker instead of dropping the
section.

## 0.8.0 — 2026-08-03

**MINOR — additive, no breaking changes. `codex`-only release** (`arweave-core`
unchanged).

**`createHeadlessKadenaResolver`** — a new export from
`@ancientpantheon/codex/ouronet`: a server-safe, pre-bound Kadena `KeyResolver`
(`{ getKeyPairByPublicKey, listCodexPubs }`) for headless Khronoton automatons
(Pythia, Mnemosyne). A consumer supplies only a `loadSnapshot` + `getPassword`
thunk pair and binds **zero** `@stoachain` crypto itself — all seedType-aware
derivation (koala / chainweaver / eckowallet / pure-foreign, with the wrong-key
refusal guard) is delegated to Codex's one canonical headless resolver. This
replaces the per-consumer hand-rolled `KeyResolver` derivations that had drifted
koala-only and caused a live signing failure on non-koala operator seeds.
Importing it from `/ouronet` loads no React/DOM (headless Node-safe). The
existing browser `InternalCodexResolver` now shares the exact same derivation
binding (extracted, not duplicated).

## 0.7.0 — 2026-07-30

**MINOR — additive, no breaking changes. `codex`-only release** (`arweave-core`
is unchanged at this tag).

**`autoSignApolloChallenge`** — a new export from `@ancientpantheon/codex/ouronet`
letting a server-side Automaton (Pythia first) prove ₱./Π. Apollo-account
ownership autonomously, on a recurring timer, with zero browser and zero human
prompt (docs/HANDOFF-pythia-autonomous-connector.md). Given an already-decrypted
Codex snapshot + codex password, it reuses the exact canonical challenge
message and `dalos-apollo` Schnorr signing already proven by the existing
browser `/apollo-verify` flow, so a signature it produces verifies against
Pythia's existing verifier unchanged. Same precedent as `rekeyCodex` in
0.6.0 — a pure, server-callable primitive surfaced through this barrel for a
headless consumer.

## 0.6.1 — 2026-07-22

**PATCH — dependency rename, no behaviour change.**

The Ouronet libraries moved out of `StoaChain/stoa-js` into [`OuroborosNetwork/ouronet-libs`](https://github.com/OuroborosNetwork/ouronet-libs) in the Phase-4 reorganisation, so that published identity matches org ownership. The peer and dev dependencies follow:

| Was | Now |
|---|---|
| `@stoachain/ouronet-core` | `@ouronet/ouronet-core` |
| `@stoachain/dalos-crypto` | `@ouronet/dalos-crypto` |

The old names are deprecated on npm. The chain-level packages (`@stoachain/stoa-core`, `@stoachain/kadena-stoic-legacy`) are unchanged — they still ship from `stoa-js`.

**Codec version gate updated.** The published core's `deserializeCodex` now accepts BOTH `"1.2"` and `"1.3"` while `buildCodexExport` still stamps `"1.2"`. `guard-codec-version-gate` previously asserted that `"1.3"` must be *rejected*; that was correct while this scope pinned a 1.2-only dist, and wrong once the core widened its reader. The load-bearing assertion is the WRITER staying at `"1.2"` — a reader narrower than the writer is the funds-loss direction, never the reverse. The gate now asserts the writer pin and that the reader accepts 1.3 forward-compatibly.

Also fixes a Windows-only false positive in the `arweave.net` hardcoded-endpoint guard, whose comment-stripper missed `//` comments on a CRLF checkout.

**1570 specs pass.**

## 0.6.0 — 2026-07-12

Add codex password rotation — the transform was missing from the package (only the `ChangePasswordCard` form + a consumer seam existed; the actual re-encryption lived in OuronetUI's app).

- **`rekeyCodex(snapshot, oldPassword, newPassword)`** — a pure, isomorphic (Node + browser), store-free `snapshot → snapshot` transform exported from `@ancientpantheon/codex/ouronet`. Re-encrypts EVERY codex-password secret (kadenaSeeds, ouroAccounts secret+backup, pureKeypairs, foreignKeys, and all CodexID `encrypted*` fields — the full inventory, owned in one place so it can't drift) old→new (output V2). Pre-flight verifies the old password (`WrongPasswordError` before any mutation); un-decryptable fields are skip-not-dropped (kept verbatim + reported).
- **`changeCodexPassword(old, new)`** store action + default `onChangePassword` wiring — `ChangePasswordCard` now works out of the box (rekey + `saveAll` + re-cache the session). A consumer-supplied `onChangePassword` still wins.

Resolves Mnemosyne Handoff 07. Additive — no breaking changes.

## 0.5.1 — 2026-07-12

Fix the STOA fee mark in the zbom cost row (`StoaChainCostDisplay`): it pointed at `/images/coins/WSTOA.svg` from the host app's public root, which broke (missing image) in consumers that don't ship that asset — e.g. Mnemosyne consuming the bundled package. Now renders the gold ❖ glyph inline (OuronetUI's canonical Stoa glyph), self-contained in the bundle so it displays identically in every consumer. No API changes.

## 0.5.0 — 2026-07-11

First functional aggregate. The six subpath barrels (root + `./provider`, `./hooks`, `./ui`, `./ouronet`, `./arweave`) are wired to the internal members, and the members (`codex-core`, `codex-ui`, `codex-ouronet`, `codex-arweave`) are **bundled** into `dist` via tsup — both the runtime JS and the `.d.ts` are self-contained, so a TypeScript consumer type-checks against only this package + `@ancientpantheon/arweave-core`. Added the merged `./ui.css` export, the `arweave`/`@ardrive/turbo-sdk` external deps, and an auto-generated bundled-member-versions table in the README.

## 0.0.1 — 2026-07-04

Initial package skeleton — the empty-but-buildable consumer-facing aggregator scaffold. Wires the root entry point plus the five subpath barrels (`./provider`, `./hooks`, `./ui`, `./ouronet`, `./arweave`), each an empty `export {};` module. No aggregation content yet; publish-eligible but unpublished.
