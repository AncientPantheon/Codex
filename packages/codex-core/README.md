# @ancientpantheon/codex-core

Chain-agnostic Codex substrate: the CK-wrapping vault + encryption model, the `CodexAdapter` storage interface, the `CodexSnapshot` data model, the `ForeignChainAdapter` registry seam, the `foreignKeys` keyring model, the canonical serialization codec (envelope 1.2/1.3), and the headless connection/resolver factory. No React, no Ouronet, no Pact — the pure core every chain module builds on.

## Consumption

Internal member package — `"private": true`, **never published to npm on its own**. The consumer-facing surface is [`@ancientpantheon/codex`](../codex), which bundles this module's compiled output into its own `dist`. Inside the monorepo, sibling packages depend on it through the workspace (`"*"`).

## Status

Version `0.6.0` — built and in active use (imported by codex-ui, codex-ouronet, codex-arweave, and the aggregator). Bundled into `@ancientpantheon/codex`.

## Version history

**v0.6.0** — New `codex/backupReencryption.ts`: `reencryptBackupSecretFields`, a sanctioned function (per `IMPORT_EXPORT_CONTRACT.md`'s own extension protocol) that walks an export's three known secret-ciphertext fields, re-encrypting each under caller-supplied `decryptField`/`encryptField` callbacks, reusing the existing sanctioned codec parse/serialize path internally rather than hand-parsing the wire shape. Backs `@ancientpantheon/codex-arweave`'s new whole-codex Arweave backup encryption engine — see that package's and the aggregator's own changelogs.

## Version history

**v0.2.0** — Connection-layer core (ChainConnection seam + resolver factory + network-settings model); codec widened to envelope 1.3; generic CodexAdapter / Snapshot / ForeignChainAdapter / vault seams.
