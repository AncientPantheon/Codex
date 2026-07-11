# @ancientpantheon/codex-ui

The React/browser interface layer of the Codex family — the chain-generic `<CodexProvider>`, the 16 store-backed hooks (`useCodex`, `useCodexAuth`, `useOuroAccounts`, …), the headless UI leaves + settings cards, and the generic `ForeignChainsTab` shell. Compiled with the `DOM` lib and the `react-jsx` transform; React is a peer dependency.

## Consumption

Internal member package — `"private": true`, **never published to npm on its own**. Its provider, hooks, and UI leaves reach consumers through the [`@ancientpantheon/codex`](../codex) aggregator (subpaths `./provider`, `./hooks`, `./ui`), which bundles this module's compiled output into its own `dist`. codex-ouronet composes on top of it and re-exports the byte-stable names.

## Status

Version `0.4.0` — built and in active use (the provider/hooks/UI substrate that codex-ouronet and the aggregator compose). Bundled into `@ancientpantheon/codex`.

## Version history

**v0.4.0** — D5 carve terminus: the chain-generic provider, 16 hooks, MOVE-set UI leaves + settings cards, and `ForeignChainsTab` shell live here with injected seams.
