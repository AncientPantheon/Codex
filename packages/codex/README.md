# @ancientpantheon/codex

The consumer-facing multi-chain Codex aggregator. **Install this single package to get the whole wallet** — the chain-agnostic core, the browser interface layer, and every chain module — re-exposed through subpath exports:

| Import | What you get |
| --- | --- |
| `@ancientpantheon/codex` | the chain-agnostic root: codec, vault, adapter/snapshot + foreign-chain contracts, connection/resolver factory (no React) |
| `@ancientpantheon/codex/provider` | the composed top-level `<CodexProvider>` |
| `@ancientpantheon/codex/hooks` | the React hooks (`useCodex`, `useCodexAuth`, `useOuroAccounts`, …) |
| `@ancientpantheon/codex/ui` | the full UI (tabs, settings, cards, the debouncer) |
| `@ancientpantheon/codex/ouronet` | the Ouronet (Kadena/Pact) chain module — adapter, connection, identity, resolver, state, errors, types |
| `@ancientpantheon/codex/arweave` | the Arweave chain module — adapter, keyring, connection, panel |
| `@ancientpantheon/codex/ui.css` | the merged stylesheet (`import "@ancientpantheon/codex/ui.css"`) |

A React app gets the full multi-chain wallet from one dependency; a headless consumer imports only the core it needs without pulling React.

## Install

```bash
npm install @ancientpantheon/codex @ancientpantheon/arweave-core
```

`@ancientpantheon/arweave-core` is the aggregate's one external `@ancientpantheon` dependency (published separately). You also provide the peers you already have: `react`, `react-dom`, the `@stoachain/*` chain primitives, `@noble/curves`, and `lucide-react`.

## How the bundle works

The four internal member packages (`codex-core`, `codex-ui`, `codex-ouronet`, `codex-arweave`) stay **private** and are **bundled** — their compiled JS *and* types are inlined into this package's `dist` (via tsup). A consumer never installs or resolves them. Everything third-party (React, the `@stoachain/*` primitives, `zustand`, CodeMirror, `arweave`, `@ardrive/turbo-sdk`, …) stays external and is provided through this package's `dependencies`/`peerDependencies`.

**Browser note:** `@ardrive/turbo-sdk` ships a Node build at its root export. A browser consumer (Vite/Next/webpack) must alias it onto its `/web` build — the same aliasing `arweave-core` documents — so the browser crypto driver is bundled instead of the Node build.

## Status

Version `0.8.1` on public npmjs. The aggregate: the six subpath barrels wired to the members and the members bundled in (JS + types self-contained — a TypeScript consumer type-checks against only this package + `arweave-core`).

## Version history

**v0.8.1** — bug fix. The Ouronet account card no longer hides an account's Payment Key when that payment-key address has never held STOA. The chain's `payment-key-existance` flag reports funding (virgin vs funded), not whether a payment key exists — every registered account has one — so the card now shows the payment-key address regardless of funding, with a "virgin · never funded" marker instead of dropping the whole section.

**v0.8.0** — additive, no breaking changes. Adds `createHeadlessKadenaResolver`, exported from `@ancientpantheon/codex/ouronet`: a server-safe, pre-bound Kadena `KeyResolver` for headless Khronoton automatons (Pythia, Mnemosyne). A consumer supplies a `loadSnapshot` + `getPassword` thunk pair and binds **zero** `@stoachain` crypto itself — all seedType-aware derivation (koala / chainweaver / eckowallet / pure-foreign, with the wrong-key refusal guard) is delegated to Codex's one canonical headless resolver instead of hand-rolled per consumer. Loads no React/DOM from `/ouronet`. `codex`-only release (`arweave-core` unchanged).

**v0.7.0** — additive, no breaking changes. Adds `autoSignApolloChallenge`, exported from `@ancientpantheon/codex/ouronet`: lets a server-side Automaton (Pythia first) prove ₱./Π. Apollo-account ownership autonomously, on a recurring timer, with zero browser and zero human prompt. Reuses the exact canonical challenge message and `dalos-apollo` Schnorr signing already proven by the existing browser `/apollo-verify` flow, so a signature it produces verifies against Pythia's existing verifier unchanged. `codex`-only release (`arweave-core` unchanged).

**v0.6.1** — dependency rename, no behaviour change. Released 2026-07-22. The Ouronet libraries moved to `@ouronet/ouronet-core` and `@ouronet/dalos-crypto` in the Phase-4 reorganisation; the old names are deprecated. The codec version gate now reflects the core's widened reader (accepts `"1.2"` and `"1.3"`) while asserting the writer stays pinned at `"1.2"`. **1570 specs pass.**

**v0.6.0** — Codex password rotation. New `rekeyCodex(snapshot, old, new)` — a pure, isomorphic transform (from `@ancientpantheon/codex/ouronet`) that re-encrypts the WHOLE secret inventory old→new (pre-flight verify, skip-not-drop, V2 output). Plus a `changeCodexPassword` store action wired as the default `onChangePassword`, so the change-password card works out of the box. Resolves Handoff 07.

**v0.5.1** — Fix the zbom STOA fee mark (`StoaChainCostDisplay`): render the gold ❖ glyph inline instead of an `<img>` to a host-app asset that broke in consumers (e.g. Mnemosyne). Self-contained in the bundle. No API changes.

**v0.5.0** — First functional aggregate: wired + bundled `codex-core`/`codex-ui`/`codex-ouronet`/`codex-arweave` through `provider`/`hooks`/`ui`/`ouronet`/`arweave` + `ui.css`; tsup dts-rollup so the `.d.ts` are self-contained.

**v0.0.1** — Initial package skeleton (empty barrels).

## Bundled member versions

<!-- BEGIN member-versions (generated by scripts/gen-readme-versions.mjs) -->
| Member package | Version |
| --- | --- |
| `@ancientpantheon/codex-core` | `0.2.0` |
| `@ancientpantheon/codex-ui` | `0.4.0` |
| `@ancientpantheon/codex-ouronet` | `0.8.1` |
| `@ancientpantheon/codex-arweave` | `0.2.0` |
| `@ancientpantheon/arweave-core` | `0.2.0` |
<!-- END member-versions -->
