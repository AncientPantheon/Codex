# Changelog

All notable changes to `@ancientpantheon/codex`.

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
