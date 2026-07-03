# Codex

> *The keeper of keys.*

A **chain-agnostic wallet primitive** — seeds encrypted at rest,
chain-aware signing, per-chain adapters. The Codex is deployed in two
very different postures with the same code:

- **With user keys**, inside user-facing wallets — OuronetUI,
  StoaWallet, the StreamingPlatform. The user's spirit drives the
  signing decisions (a *Daimon* in the Pantheon taxonomy).
- **With operator keys**, inside autonomous agents — Aletheia,
  Caduceus-Automaton, Dalos-Automaton, Mnemosyne-Automaton. A
  Khronoton schedule drives the signing decisions (an *Automaton*).

Same primitive, different key vaults, different blast radii.

## Role in the Pantheon architecture

Codex is one of the **three Constructors** — the chain-agnostic
primitives every entity in the ecosystem composes:

| Constructor | Question it answers | This repo |
| ----------- | ------------------- | --------- |
| **Pythia**  | What is the state of the world? | [AncientPantheon/Pythia](https://github.com/AncientPantheon/Pythia) |
| **Codex**   | Who am I, and how do I sign?    | ✅ |
| **Khronoton** | When do I act?                | [AncientPantheon/Khronoton](https://github.com/AncientPantheon/Khronoton) |

## Provenance — migrated from stoa-js

The Codex originated as
[`@stoachain/ouronet-codex`](https://www.npmjs.com/package/@stoachain/ouronet-codex)
inside the `StoaChain/stoa-js` monorepo — an Ouronet-specific
encrypted-multi-wallet React component. This repo is its
generalisation: the core extracts here as `@ancientpantheon/codex-core`
(chain-agnostic), and Ouronet becomes one adapter among many. The old
package is retired or converted to a thin compatibility shim after the
migration.

## Planned packages

| Package | Purpose |
| ------- | ------- |
| `@ancientpantheon/codex-core` | The wallet primitive — vault, key derivation, signing surface |
| `@ancientpantheon/codex-adapters-*` | Per-chain adapters (ouronet, arweave, bitcoin, ethereum, …) |

## Status

**Scaffold.** Migration from `stoa-js/packages/ouronet-codex/` is
Phase 3 of the AncientPantheon kickstart plan.

## License

See [LICENSE](LICENSE) — all rights reserved pending a final
(expected permissive) license decision before first release.
