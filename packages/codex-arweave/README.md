# @ancientpantheon/codex-arweave

The Arweave Codex module: the `foreignKeys` JWK keyring integration, the sibling RSA signer, native AR send + balance/confirmation, the upload/library feature (Memory / IndexedDB / SQLite stores), the injectable connection seam, and the Arweave UI panel. Builds on `@ancientpantheon/arweave-core` + `@ancientpantheon/codex-core`.

## Consumption

Internal member package — `"private": true`, **never published to npm on its own**. Its adapter, keyring, connection, and panel reach consumers through the [`@ancientpantheon/codex`](../codex) aggregator (subpath `./arweave`), which bundles this module's compiled output into its own `dist`. The heavy Arweave runtime (`arweave`, `@ardrive/turbo-sdk`) stays external — the aggregator declares it as a dependency and the consumer's bundler resolves the web build.

## Status

Version `0.2.0` — built and in active use. Bundled into `@ancientpantheon/codex`.

## Version history

**v0.2.0** — Arweave ForeignChainAdapter, foreignKeys keyring + sibling RSA signer, native AR send/balance/rotation, upload/library + rebuild, the Foreign-Chains Arweave panel, and the injectable connection seam.
