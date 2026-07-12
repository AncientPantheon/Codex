# Changelog

All notable changes to `@ancientpantheon/codex`.

## 0.5.1 — 2026-07-12

Fix the STOA fee mark in the zbom cost row (`StoaChainCostDisplay`): it pointed at `/images/coins/WSTOA.svg` from the host app's public root, which broke (missing image) in consumers that don't ship that asset — e.g. Mnemosyne consuming the bundled package. Now renders the gold ❖ glyph inline (OuronetUI's canonical Stoa glyph), self-contained in the bundle so it displays identically in every consumer. No API changes.

## 0.5.0 — 2026-07-11

First functional aggregate. The six subpath barrels (root + `./provider`, `./hooks`, `./ui`, `./ouronet`, `./arweave`) are wired to the internal members, and the members (`codex-core`, `codex-ui`, `codex-ouronet`, `codex-arweave`) are **bundled** into `dist` via tsup — both the runtime JS and the `.d.ts` are self-contained, so a TypeScript consumer type-checks against only this package + `@ancientpantheon/arweave-core`. Added the merged `./ui.css` export, the `arweave`/`@ardrive/turbo-sdk` external deps, and an auto-generated bundled-member-versions table in the README.

## 0.0.1 — 2026-07-04

Initial package skeleton — the empty-but-buildable consumer-facing aggregator scaffold. Wires the root entry point plus the five subpath barrels (`./provider`, `./hooks`, `./ui`, `./ouronet`, `./arweave`), each an empty `export {};` module. No aggregation content yet; publish-eligible but unpublished.
