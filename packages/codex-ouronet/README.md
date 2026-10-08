# @ancientpantheon/codex-ouronet

The Ouronet-native Codex module (lifted from stoa-js): the Kadena/Pact signer, the double-Apollo `ICodexIdentity`, CodexPrime, CodexGuard, seed derivation, the zbom Pact editor + debouncer, the connection seam (Pythia global + direct-node), the Apollo→Pythia deploy + ownership verifier, and `ouronet-ns.CODEX` registration. Composes on top of codex-core + codex-ui.

## Consumption

Internal member package — `"private": true`, **never published to npm on its own**. It's the flagship member: its provider/hooks/ui/adapters/connection reach consumers through the [`@ancientpantheon/codex`](../codex) aggregator (subpaths `./provider`, `./hooks`, `./ui`, `./ouronet`), which bundles this module's compiled output into its own `dist`.

## Status

Version `1.1.1` — built and in active use; drives the standalone playground and the aggregator's Ouronet surface. Bundled into `@ancientpantheon/codex`.

## Version history

**v1.1.1** — Bugfix: `kickstartCodex`'s `fresh-dalos` path stored the
CodexPrime account's private scalar in its `secret` field while labelling
`originMode: "seedWords"` — mismatching the convention every bitstring
re-derivation consumer (`bitStringOf`, `rebuildFullKey`, and others) relies
on, which made real bitstring re-derivation silently produce the wrong
value for any freshly-kickstarted `fresh-dalos` codex. Root-caused via a
disciplined, evidence-based investigation (real reproduction, ranked
hypotheses, a real round-trip regression test using an address-derived-
from-bits fake so a wrong *value*, not just a wrong length, would be
caught) after it broke a new downstream feature
(`@ancientpantheon/codex-arweave`'s whole-codex Arweave backup). Fixed at
the source: `fresh-dalos` now stores the origin words in `secret`,
matching its declared `originMode`. A codex kickstarted before this fix
now fails any affected re-derivation with a clean, non-crashing result
rather than a confusing error — restoring such a codex to full
correctness is a separate, not-yet-built migration step.

## Version history

**v0.5.0** — Apollo→Pythia deploy (`C_DeployApiKey`) + Standard/Smart activation, batch registered-key read (URC_0031) through the debouncer, registered-key display, and the `/apollo-verify` Apollo-ownership verifier.

**v0.4.0** — Rewired onto the codex-core + codex-ui seams (D5 carve terminus); connection layer (Pythia + StoaChain/Arweave connectors).
