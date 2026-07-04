# Changelog

All notable changes to `@ancientpantheon/arweave-core`.

## 0.1.0 — 2026-07-05

First feature-complete, publish-ready release. Ships the full Arweave protocol surface:

- **Keys and address** — RSA-4096 key generation, keyfile import/export with validation, and canonical 43-char base64url address derivation.
- **Units** — lossless Winston ↔ AR conversion.
- **Gateway pool** — a config-driven, multi-endpoint pool with health-tracked rotation, backoff, and an origin-only endpoint policy; all reads and posts flow through it.
- **Transfer and reads** — native AR transfer (build, sign, post) plus address-balance and transaction-status (pending / confirmed / not-found with confirmation depth) reads through the pool.
- **Upload** — permanent-storage uploads through the Turbo bundling service, applying the required Codex tag schema (`App-Name`, `Content-Type`, `Codex-Item-Id`, `Codex-Owner` + app metadata) and returning the data-item id, with an injectable client seam.
- **Rebuild** — a paginated GraphQL query that reconstructs an owner's uploads from the on-chain tag index (owner + tag-schema filtered), empty-result-safe and with no silent truncation.

Adds the `@ardrive/turbo-sdk` runtime dependency, confined to this package.

## 0.0.1 — 2026-07-04

Initial package skeleton — empty, buildable, publish-eligible scaffold. No protocol surface yet.
