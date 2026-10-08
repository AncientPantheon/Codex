# @ancientpantheon/codex-arweave

The Arweave Codex module: the `foreignKeys` JWK keyring integration, the sibling RSA signer, native AR send + balance/confirmation, the upload/library feature (Memory / IndexedDB / SQLite stores), the injectable connection seam, and the Arweave UI panel. Builds on `@ancientpantheon/arweave-core` + `@ancientpantheon/codex-core`.

## Consumption

Internal member package — `"private": true`, **never published to npm on its own**. Its adapter, keyring, connection, and panel reach consumers through the [`@ancientpantheon/codex`](../codex) aggregator (subpath `./arweave`), which bundles this module's compiled output into its own `dist`. The heavy Arweave runtime (`arweave`, `@ardrive/turbo-sdk`) stays external — the aggregator declares it as a dependency and the consumer's bundler resolves the web build.

## Status

Version `0.8.0` — built and in active use. Bundled into `@ancientpantheon/codex`.

## Version history

**v0.8.0** — "Export Library" button in `LibraryArea.tsx`: downloads a JSON file (`{exportedAt, itemCount, items}`) covering every Library entry across every configured owner and every page (not just what's currently rendered), with each item's real filename and real access link (manifest-aware for bundled files — a per-file link, not a bare manifest link). Built for constructing NFT metadata-update transactions after a large batch upload.

**v0.7.0** — Codex ID page (eligibility status, backup/migration explainers, the real "back up this codex" action) and the codex-backup dual-key envelope encryption engine (`backupCodexToLibrary` rebuilt: fresh per-upload IDEK/EDEK, two independent default unlock sources, optional Arweave-PIN protection per source, full restore path for both). See `@ancientpantheon/codex`'s own changelog for the full feature description and `ARWEAVE_TAG_SCHEMA.md` for the procedure.

**v0.6.1** — Bugfix: the OPFS browser-support probe backing the Upload Wizard's Files-step banner/cap ran on the main thread, where it's spec'd to always fail — moved into a dedicated Worker (`supportProbeWorker.ts`/`SupportProbeRunner.ts`), mirroring the real upload and dry-run paths' own already-correct Worker wiring. `ArweavePanelDeps` also gained `runDryRunUpload`/`isStreamingUploadSupported` (previously constructed by the real adapter but never declared on this interface, so `ArweavePanel.tsx` had no way to pass either through to `UploadWizard` — the "Test this upload" button was never actually reachable by a real user as a result). Both found and fixed from a real owner bug report, re-verified through the real, unmodified app in a real browser.

**v0.6.0** — Streaming (arbitrary-size) upload engine: OPFS-backed incremental bundle assembly, chunked AES-GCM encryption (new envelope version, old items unaffected), resumable chunk-by-chunk posting with IndexedDB checkpointing, all wired through a dedicated Worker (`library/streaming/`), plus a "Test this upload" dry-run feature in the Upload Wizard. Both encrypted and unencrypted uploads route through this engine now; the old in-memory path remains only as an honest, explicitly-capped (2 GiB) fallback when the browser lacks the needed storage APIs. See `@ancientpantheon/codex`'s `ARWEAVE_STREAMING_UPLOAD_ARCHITECTURE.md` for the full technical walkthrough.

**v0.2.0** — Arweave ForeignChainAdapter, foreignKeys keyring + sibling RSA signer, native AR send/balance/rotation, upload/library + rebuild, the Foreign-Chains Arweave panel, and the injectable connection seam.
