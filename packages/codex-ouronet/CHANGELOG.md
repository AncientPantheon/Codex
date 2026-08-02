# Changelog

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
