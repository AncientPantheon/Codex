# Changelog

## 0.9.0 — 2026-08-08

**MINOR — additive, no breaking changes.** Pythia consumer-API-key management in
the Ouronet accounts view.

- **Two new account sub-tabs** (after Standard/Smart):
  - **Single API** — two columns of the codex's Apollo halves (Standard ₱. left,
    Smart Π. right), each with search + pagination and a live UNLINKED / LINKED /
    not-deployed status (read from `DPL-UR.URC_0031`). Pick one unlinked half from
    each side and **Link** them into a dual API key.
  - **Dual API** — the codex's mutually-linked ₱.|Π. composite keys, read via the
    new `DPL-UR.URC_0033_DualApiKeyMapper` (`UR_DualLinkRowOrNull` per composite)
    with Pythia deploy/rename prices from `DPL-UR.URC_0034_PythiaPrices`. Shows
    consumer-lane, active/revoked status, and per-key **Rename lane** / **Revoke**.
- **Three ZBOM transaction modals**, authorized by BOTH half-owners (`P|TS`):
  **Link** (no fee), **Rename lane** (100 STOA, undiscounted, 4-way split derived
  from INFO), **Revoke** (1 IGNIS kill-switch). Costs + split receivers come from
  the on-chain INFO, so they never drift when prices change. Both half-owners'
  ownership guards are resolved from chain, deduped when shared, and any owner key
  the Codex doesn't hold is requested via the standard manual-key input.
- **Post-transaction UI refresh** — a `usePostTxRefresh` hook subscribes to the
  `onTxConfirmed` event (which nothing consumed before), so `URC_0027` account
  state, `URC_0031` API-key status, and the dual-link/price reads all re-fetch
  automatically once any Codex transaction confirms — no manual reload.
- New read helpers on the `./zbom`-adjacent pythia seam:
  `getDualApiKeySelectorData`, `getPythiaPrices`, `isApiKeyLinked`, `buildDualKey`
  / `splitDualKey`, and the Link/Rename/Revoke builders. `isApiKeyRegistered` now
  reads the mapper's explicit `is-registered` flag (owner-account fallback), and
  linkage is detected by "counterpart is an Apollo account" rather than a sentinel
  string (fixes registered-but-unlinked halves reading as linked). Also fixes
  `SigningZone` showing a permanent "Waiting for account data…" spinner for
  owner-only (no-patron) transactions.

## 0.8.1 — 2026-08-03

**PATCH — bug fix.** The Ouronet account card no longer hides an account's
Payment Key when that payment-key address has never held STOA. Every registered
Ouronet account is assigned a payment key at activation; the chain's
`payment-key-existance` flag reports only whether that address has ever held
STOA (a coin-table row) — virgin (never funded) vs funded — not whether a
payment key exists. The card wrongly gated the whole Payment Key section on that
flag, so a virgin payment key vanished entirely. It now surfaces the payment-key
address whenever the chain returns one (regardless of funding) and shows a
subtle "virgin · never funded" marker instead of dropping the section; the
funding flag drives only the balance/marker. (`OuronetAccountsTab`.)

## 0.8.0 — 2026-08-03

**MINOR — additive, no breaking changes.** Adds `createHeadlessKadenaResolver`
(exported from the `./resolver` subpath) — a server-safe, pre-bound Kadena
`KeyResolver` for headless Khronoton automatons. A consumer supplies a
`loadSnapshot` + `getPassword` thunk pair and binds NO `@stoachain` crypto
itself; all seedType-aware derivation (koala / chainweaver / eckowallet /
pure-foreign, with the wrong-key refusal guard) delegates to codex-core's one
canonical `createHeadlessCodexResolver`. The real `@stoachain` deps binding
(previously private inside `InternalCodexResolver.ts`) is extracted into a shared
server-safe `headlessKadenaDeps.ts` that both the browser and headless resolvers
consume — one derivation path, no duplication. `InternalCodexResolver` behaviour
is unchanged.

## 0.7.0 — 2026-07-30

**MINOR — additive, no breaking changes.** Adds `autoSignApolloChallenge` — the
headless, fully autonomous counterpart to `signApolloOwnership`
(docs/HANDOFF-pythia-autonomous-connector.md). Lets a server-side Automaton
(Pythia first) prove ₱./Π. Apollo-account ownership on a recurring timer with
zero browser and zero human prompt: given an already-decrypted Codex snapshot
+ codex password (per the `automaton/02` master-key auto-unlock standard), it
locates the matching account, `smartDecrypt`s its secret, and signs the same
canonical challenge message the existing browser `/apollo-verify` flow uses —
so its output verifies against Pythia's existing verifier unchanged. Throws a
clear, named error if the account isn't in the snapshot, never a silent no-op.

New `./apollo-verify` subpath export — React-free, so a headless consumer can
import `signApolloOwnership` / `buildApolloOwnershipMessage` /
`autoSignApolloChallenge` without pulling React through the module graph (the
existing `./ui` subpath keeps re-exporting the same 3 pre-existing names too,
byte-for-byte unchanged).

## 0.0.1 — 2026-07-04

- Initial package skeleton.
