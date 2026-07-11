# @ancientpantheon/arweave-core

Framework-agnostic Arweave protocol library for the Codex family — the chain-native primitives for Arweave wallets, transaction signing, native AR transfers, gateway reads, and permanent-storage uploads, with no UI or framework dependencies. Consumed by the private `@ancientpantheon/codex-arweave` module and, transitively, by the public `@ancientpantheon/codex` aggregator.

## Status

`0.2.0` on public npmjs — the full Arweave protocol surface with injectable gateway endpoints. Ships key generation and keyfile import/export, canonical address derivation, Winston/AR unit conversion, a config-driven multi-endpoint gateway pool (endpoints injectable at construction so a host can point it at its own connection tier), native AR transfer, balance and transaction-status reads, permanent-storage uploads through the Turbo bundling service, and the GraphQL rebuild query that reconstructs an owner's uploads from the on-chain tag index.

## Install

```sh
npm install @ancientpantheon/arweave-core
```

Requires Node `>=20` (uses runtime-native WebCrypto and `crypto.randomUUID`). Browser consumers: see [Browser polyfills](#browser-polyfills) below.

## API overview

The package exposes a single entry point (`@ancientpantheon/arweave-core`) with explicit named exports, grouped here by capability. Every typed error a public function can throw is exported so consumers `instanceof`-catch rather than parse message strings.

### Keys and address

- `generateKey()` — generate a fresh RSA-4096 Arweave JWK (see the security note on generation cost below).
- `importKeyfile(json)` / `exportKeyfile(jwk)` — validate and round-trip a keyfile. Throws `InvalidKeyfileError`.
- `addressOf(jwk)` — derive the canonical 43-char base64url address. Throws `InvalidBase64UrlError`.
- Types: `ArweaveJwk`, `InvalidKeyfileReason`, `InvalidBase64UrlReason`.
- Design-stub derivation (default OFF): `DEFAULT_KEY_DERIVATION_FLAGS`, `generateFromMnemonic`, `deriveFromEthereumSignature`, `KeyDerivationFlags`, `KeyDerivationDisabledError`, `KeyDerivationNotImplementedError`.

### Units

- `arToWinston(ar)` / `winstonToAr(winston)` — lossless conversion using the `WINSTON_PER_AR` constant. Throws `InvalidAmountError`.

### Gateway pool

- `createGatewayPool(config)` — build a config-driven, multi-endpoint pool with health-tracked rotation and backoff. Throws `InvalidGatewayConfigError`; operations may reject with `GatewayPoolExhaustedError` (carrying per-attempt `GatewayAttempt` records).
- Types: `GatewayPoolConfig`, `GatewayPool`, `GatewayOperation`, `EndpointHealth`, `SleepFn`, `NowFn`. Error base: `GatewayError`.
- All reads/posts flow through one pool; a pathed (non-origin) endpoint surfaces `UnsupportedEndpointError`.

### Transfer

- `sendTransfer(pool, params, opts?)` — build, sign, and post a native AR transfer through the pool. Throws `InvalidTransferError`, `TransferPostFailedError`, `InvalidGatewayPriceError`, `RewardExceedsCapError`.
- Types: `TransferParams`, `TransferResult`, `SendTransferOptions`, `TransferGatewayApi`, `TransferGatewayApiFactory`.
- **The fee cap `maxRewardWinston` is REQUIRED** (a field of `TransferParams`, not an option). The reward is quoted by an untrusted rotating gateway and is signed and **paid verbatim**, so a compromised or MITM'd gateway could otherwise quote an inflated reward (e.g. 1000 AR) and burn it as miner fee. You **must** state the maximum reward you will pay: an absent cap throws `InvalidTransferError` (reason `missing-max-reward`) before any gateway is contacted, and a quote above the cap throws `RewardExceedsCapError` before anything is built or signed (the boundary is inclusive).
- **Worst-case wall time:** `sendTransfer` composes three sequential pool calls (anchor, price, post), each a full retry × backoff schedule; on a degraded pool this is minutes, not seconds. Each per-endpoint attempt is bounded by the pool's `requestTimeoutMs` (default 15 s) so a black-holed gateway is abandoned rather than stalling the call.

### Reads

- `getBalance(pool, address)` — winston balance for an address. Throws `InvalidAddressError`.
- `getTransactionStatus(pool, id, opts?)` — pending / confirmed / not-found status with confirmation depth (`DEFAULT_CONFIRMATION_DEPTH`). Throws `InvalidTransactionIdError`, `InvalidGatewayResponseError`.
- Types: `TransactionStatus`, `ConfirmedTransactionStatus`, `PendingTransactionStatus`, `NotFoundTransactionStatus`.
- **Single-gateway trust model.** Both reads resolve on the first pooled gateway that returns a well-formed answer — the result is **not** consensus-verified. A balance, a confirmation depth, and the `final` flag can all be fabricated by one malicious or out-of-sync gateway. For value decisions, cross-check across **independent** gateways (compare `blockIndepHash` at the reported height for tx status); do not treat a single read as authoritative.

### Upload

- `uploadData(params, opts?)` — upload a data item to the permaweb through the Turbo bundling service, applying the required Codex tag schema, and resolve the data-item id. Throws `InvalidUploadParamsError` (bad inputs), `InvalidKeyfileError` (bad jwk), `UploadFailedError` (client rejection or a malformed response id).
- `buildUploadTags(params)` — the pure tag-schema builder (required tags first, then app metadata). Throws `InvalidUploadParamsError`.
- `DEFAULT_APP_NAME` (`"AncientPantheon-Codex"`) and the required tag-name constants `TAG_APP_NAME`, `TAG_CONTENT_TYPE`, `TAG_CODEX_ITEM_ID`, `TAG_CODEX_OWNER` (plus the `REQUIRED_UPLOAD_TAG_NAMES` tuple).
- Types: `UploadParams`, `UploadResult`, `Tag`, `BuildUploadTagsParams`, and the injectable client seam `TurboUploadClient` / `TurboUploadClientFactory` / `UploadOptions`.

### Rebuild

- `queryOwnerUploads(pool, ownerAddress, opts?)` — query the gateway GraphQL index by owner + tag schema and return every matching upload as `{ id, tags }`, paginated. An owner with zero matching uploads resolves `[]` (a success, never an error). Throws `InvalidAddressError`, `InvalidRebuildParamsError`, `InvalidGatewayResponseError`, and `RebuildPageLimitError` (no silent truncation).
- `DEFAULT_REBUILD_PAGE_SIZE` (`100`), `DEFAULT_REBUILD_MAX_PAGES` (`50`).
- Types: `OwnerUploadRecord`, `QueryOwnerUploadsOptions`, `FetchFn`.
- **Tag values are UNVALIDATED wire strings — sanitize before rendering.** Each record's `id` is validated against the canonical 43-char base64url form inside the pool op (a non-canonical id from a hostile gateway throws and rotates, so `id` is safe to compose into `{gateway}/{id}` URLs). But `OwnerUploadRecord.tags` names and values are passed through verbatim from the answering gateway — a hostile gateway can return arbitrary strings (including HTML/script payloads). Treat them as untrusted input: **escape/sanitize tag names and values before rendering them** (a stored-XSS channel if rendered verbatim in a UI).

## Browser polyfills

This library targets Node by default. Under browser bundlers (Vite, Webpack), the Turbo SDK and arweave-js expect Node globals — configure the following.

**Node global polyfills.** Turbo/arweave-js reference `buffer`, `process`, and `crypto`. Provide them through your bundler:

```js
// vite.config.js
import { nodePolyfills } from "vite-plugin-node-polyfills";
export default {
  plugins: [nodePolyfills({ include: ["buffer", "process", "crypto"] })],
};
```

```js
// webpack.config.js
module.exports = {
  resolve: {
    fallback: { buffer: require.resolve("buffer/"), process: require.resolve("process/browser"), crypto: require.resolve("crypto-browserify") },
  },
};
```

**Turbo SDK alias (REQUIRED for browser bundling).** `@ardrive/turbo-sdk` has **no `browser` field**, and its root export is the **Node build** — it statically imports `fs`, `crypto`, and `node:stream`. A browser bundler resolving the package root therefore pulls the Node build into the graph. Because ESM static imports are resolved for the whole module graph regardless of runtime branches, injecting a web-built client through `uploadData`'s client seam selects the runtime client but does **not** remove the Node build from a non-code-splitting bundle. Browser consumers MUST either:

1. **Alias** `@ardrive/turbo-sdk` → `@ardrive/turbo-sdk/web` in the bundler config (this alias also rewrites arweave-core's own internal import), or
2. **Inject** a web-built client through `uploadData(params, { clientFactory })` — viable for code-splitting bundlers because `uploadData` resolves its default factory via a lazy dynamic import, letting the bundler drop the Node build when a client is always supplied.

```js
// vite.config.js — alias approach
export default {
  resolve: { alias: { "@ardrive/turbo-sdk": "@ardrive/turbo-sdk/web" } },
};
```

**No polyfill needed for:** arweave-js (it maps its own web build automatically via its `browser` field), and this library's key generation / address derivation (they use runtime-native WebCrypto).

Uploads target the Turbo bundling service (`upload.ardrive.io`), not an Arweave gateway — deliberately outside the gateway pool (a bundler service is not a gateway).

## Security guarantees

- **The JWK is the private key.** Treat a keyfile as a secret. This library never logs it and never transmits it: no code under `src/` writes to `console`, and error messages and structured fields carry **no** key material (`d`, `p`, `q`, ...) — a tested contract.
- **Signing stays local.** The library's own code never transmits the JWK. For uploads, the JWK goes only to the local signer the Turbo SDK constructs from it; ANS-104 data items are signed **client-side** by the arbundles `ArweaveSigner`. The **signed data item** is what leaves the machine — never the key. (Transfer signing is likewise local and offline-proven by test: build + sign touch no network.)
- **Key generation is slow by design.** `generateKey()` produces an RSA-4096 keypair and takes on the order of seconds. This is expected — RSA-4096 is Arweave's wallet standard. Generate keys ahead of time, not on a hot path.

## Permanence warning

- **Uploads are PERMANENT and PUBLIC.** Once a data item lands on Arweave it cannot be deleted or edited, and anyone can read it. If privacy is needed, **client-side encrypt the payload before uploading** and manage those encryption keys separately from your wallet JWK.
- **Tags are permanent, public, and indexed.** All tag names and values — including any `appMetadata` you supply and the `Codex-Item-Id` — are stored on-chain forever and are searchable by anyone via gateway GraphQL. **Never put PII or secrets in tags.** Encryption applies only to the data payload; it does not protect tag contents.

## Version history

**v0.2.0** — Injectable gateway endpoints: the gateway pool accepts its endpoint list at construction so a host (the Codex connection layer) can drive it from its own network settings instead of a hard-coded default.

**v0.1.0** — First feature-complete, publish-ready release: keys/address, Winston/AR units, config-driven gateway pool, native AR transfer, balance + transaction-status reads, Turbo permanent-storage uploads with the Codex tag schema, and the GraphQL rebuild query.

**v0.0.1** — Initial package skeleton.
