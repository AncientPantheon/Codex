# Changelog

All notable changes to `@ancientpantheon/arweave-core`.

## 0.4.0 — 2026-10-05

**MINOR — streaming-upload primitives, fully additive.** Removes the
library-level ceiling on upload size: `arweave-js`'s own chunking/Merkle
API (`chunkData`, `generateTransactionChunks`) requires a fully-materialized
buffer, even though the Arweave protocol itself already works in 256 KiB
chunks at its core. New `planChunkBoundaries`/`computeStreamingDataRoot`
port that algorithm to a streaming input — read-as-you-go, one chunk
resident at a time — verified byte-identical to the library's own
buffer-based output across every fixture tried (0 bytes, exact chunk
boundaries, the rebalancing-branch edge case, multi-chunk composites).
`createStreamingTransaction` builds and signs a transaction directly from
an already-computed streaming `data_root`, paired with a new
`StreamingUploadGatewayApi`/`StreamingUploadGatewayApiFactory` seam for
posting the transaction and its chunks one at a time from any byte
source. `createLocalDryRunGatewayApiFactory` is a new, production-code
(not test-only) local/no-op gateway satisfying both the classic
`UploadGatewayApiFactory` and the new streaming factory — captures every
posted transaction/chunk in memory, addressed by the chunk's own real
`offset` (matching how a real gateway treats a retried chunk POST at a
known offset as an idempotent no-op), with zero network reachability
anywhere in the module, structurally verified. No breaking changes — the
native upload engine from 0.3.0 (`uploadData`/`uploadBundle`) is
untouched and remains the default path.

## 0.3.0 — 2026-10-02

**MINOR — native upload engine replaces the Turbo bundler.** Uploads now
build and sign ANS-104 bundles natively and post them as a single
self-signed transaction via arweave-js's chunked, resumable uploader
(`postArweaveData`) — no third-party bundling service in the upload path
anymore; the `@ardrive/turbo-sdk` dependency this package added in 0.1.0
is gone. New `uploadBundle` primitive (N files + 1 manifest, one atomic
transaction, a real default `"index"` path so a bare manifest link
resolves to real content). The tag schema gained independent versioning
for the tag set itself (`Codex-Tag-Schema-Version`) versus the exact
encryption procedure that produced a given upload's ciphertext
(`Codex-Encryption-Version`), plus category/asset-type/app-lineage tags —
see `@ancientpantheon/codex`'s shipped `ARWEAVE_TAG_SCHEMA.md` for the
full, versioned reference. `rebuild`'s `queryOwnerUploads` gained
per-page progress reporting and a new tag-only (no-owner) query,
`queryUploadsByTag`, for lookups that aren't scoped to a known address.
Fixed a real bug found via a live reproduction against the actual
`arbundles` library: its `DataItem.sign()`/`rawId` path unconditionally
re-derives the item id via a Node-only `crypto.createHash` call even
after a correct WebCrypto signature already succeeded, which would crash
any browser bundle that reached it — uploads now sign via `arbundles`'
standalone WebCrypto-only `sign()` function and reassemble the bundle
directly, never touching the broken path.

## 0.2.0 — 2026-07-11

Injectable gateway endpoints. The gateway pool now accepts its endpoint list at construction, so a host — the Codex connection layer — can drive Arweave reads/posts from its own network settings instead of the package's hard-coded default pool. No breaking changes to the read/transfer/upload/rebuild surface.

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
