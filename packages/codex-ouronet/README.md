# @ancientpantheon/codex-ouronet

The Ouronet-native Codex module (lifted from stoa-js): the Kadena/Pact signer, the double-Apollo `ICodexIdentity`, CodexPrime, CodexGuard, seed derivation, the zbom Pact editor + debouncer, the connection seam (Pythia global + direct-node), the Apollo→Pythia deploy + ownership verifier, and `ouronet-ns.CODEX` registration. Composes on top of codex-core + codex-ui.

## Consumption

Internal member package — `"private": true`, **never published to npm on its own**. It's the flagship member: its provider/hooks/ui/adapters/connection reach consumers through the [`@ancientpantheon/codex`](../codex) aggregator (subpaths `./provider`, `./hooks`, `./ui`, `./ouronet`), which bundles this module's compiled output into its own `dist`.

## Status

Version `0.5.0` — built and in active use; drives the standalone playground and the aggregator's Ouronet surface. Bundled into `@ancientpantheon/codex`.

## Version history

**v0.5.0** — Apollo→Pythia deploy (`C_DeployApiKey`) + Standard/Smart activation, batch registered-key read (URC_0031) through the debouncer, registered-key display, and the `/apollo-verify` Apollo-ownership verifier.

**v0.4.0** — Rewired onto the codex-core + codex-ui seams (D5 carve terminus); connection layer (Pythia + StoaChain/Arweave connectors).
