# @ancientpantheon/codex

The consumer-facing multi-chain Codex aggregator. Install this single package to get the whole wallet — the chain-agnostic core, the browser interface layer, and every chain module — re-exposed through subpath exports:

- `@ancientpantheon/codex` — the aggregate root surface
- `@ancientpantheon/codex/provider` — the top-level provider
- `@ancientpantheon/codex/hooks` — React hooks
- `@ancientpantheon/codex/ui` — UI components
- `@ancientpantheon/codex/ouronet` — the Ouronet chain entry point
- `@ancientpantheon/codex/arweave` — the Arweave chain entry point

A React app gets the full multi-chain wallet from one dependency; a headless consumer imports only the core + chain primitives it needs, without pulling React. The four internal member packages (`codex-core`, `codex-ui`, `codex-ouronet`, `codex-arweave`) stay private workspace packages that this aggregator bundles — they are never published to npm.

## Status

Version `0.0.1` is an unpublished skeleton — the empty-but-buildable package scaffold with the five aggregator subpath barrels wired but no real content yet. Not on npm. Once the aggregation surface is filled and released, this line becomes the gate-matching form `` `X.Y.Z` on public npmjs ``.

## Version history

**v0.0.1** — Initial package skeleton.
