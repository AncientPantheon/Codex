# Changelog

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
