## Wave 1

- [ ] T1: Declare `arbundles` as a new dependency of `arweave-core`, unused
      by any code until T6. — done when: `packages/arweave-core/package.json`
      lists `arbundles` under `dependencies`, and `npm install` (run from the
      repo root, workspace-aware) resolves it without error.
  - files: `packages/arweave-core/package.json`

- [ ] T2: Extend the upload tag schema with `Codex-Tag-Schema-Version`,
      `Codex-Upload-Id`, and `Codex-Item-Type`, backward-compatible with
      every existing caller of `buildUploadTags`. Add exported constants
      `TAG_CODEX_TAG_SCHEMA_VERSION = "Codex-Tag-Schema-Version"`,
      `CODEX_TAG_SCHEMA_VERSION_CURRENT = "1"`,
      `TAG_CODEX_UPLOAD_ID = "Codex-Upload-Id"`,
      `TAG_CODEX_ITEM_TYPE = "Codex-Item-Type"`. Extend
      `BuildUploadTagsParams` with two **optional** new fields —
      `uploadId?: string` (defaults to a generated UUID via
      `globalThis.crypto.randomUUID()`, mirroring `upload.ts`'s existing
      `itemId` default pattern, when omitted) and
      `itemType?: "file" | "manifest"` (defaults to `"file"` when omitted) —
      optional so every existing call site (`upload.ts`, untouched until T5)
      keeps compiling and behaving identically until T5 explicitly wires
      real values through. `buildUploadTags` emits, immediately after the
      existing four required tags and before `appMetadata`: `Codex-Tag-Schema-Version`
      (always `CODEX_TAG_SCHEMA_VERSION_CURRENT`, never caller-supplied),
      `Codex-Upload-Id`, `Codex-Item-Type`. All three new tag names join
      `REQUIRED_UPLOAD_TAG_NAMES`/the reserved-name set, so an `appMetadata`
      entry reusing any of them throws `InvalidUploadParamsError` exactly
      like the existing four do. A non-empty-string violation on a
      caller-supplied `uploadId`, or an `itemType` outside `"file"|"manifest"`,
      throws `InvalidUploadParamsError` with the same field/reason shape as
      the existing `ownerAddress`/`contentType` checks. — done when:
      `buildUploadTags({...4 required...})` (no new fields) returns a
      7-tag array (4 existing + the 3 new, in the documented order) with
      generated defaults; `buildUploadTags({...4 required..., uploadId: "u1",
      itemType: "manifest"})` returns those exact values verbatim;
      `buildUploadTags({...4 required..., itemType: "bogus" as any})` throws
      `InvalidUploadParamsError`; an `appMetadata` entry named
      `"Codex-Upload-Id"` throws the existing reserved-name error.
  - files: `packages/arweave-core/src/upload/tags.ts`,
    `packages/arweave-core/tests/upload-tags.test.ts`

- [ ] T3: Add a native (non-bundler-service) Arweave data-upload posting
      primitive, mirroring `tx/transfer.ts`'s `sendTransfer` composition
      (pool-driven anchor fetch → pool-driven price quote → fully-offline
      `createTransaction` build → `signTransaction` (the isolated T3.3
      signer, `src/signing/sign.ts`) → pool-driven post) but for a `data` +
      `tags` payload instead of a `target`/`quantity` transfer, and using
      the **chunked** uploader (`transactions.getUploader(tx)` /
      `uploader.uploadChunk()` loop, resuming on a failed chunk) rather than
      `sendTransfer`'s single `postTransaction` call, since a data payload
      commonly exceeds one request unlike a dataless transfer. Reuses
      `createEndpointClientFactory` (`tx/endpointClient.ts`) for per-endpoint
      arweave-js instances and the same `withAbort` pool-attempt-cancellation
      pattern already in `tx/transfer.ts`/`reads/fee.ts`. Requires
      `estimateFee`'s `target` parameter to become optional
      (`target?: string`, forwarded as `undefined` to `getPrice` when
      omitted) so a price quote can be fetched for a byte size with no
      transfer recipient — existing callers passing a real `target` string
      are unaffected (backward compatible). Carries the same
      fee-cap-required discipline `sendTransfer` already enforces: a
      required `maxRewardWinston` param, quote-exceeds-cap throws before any
      signing. Exported as `postArweaveData(pool: GatewayPool, params: {
      jwk: ArweaveJwk; data: string | Uint8Array; tags: Tag[];
      maxRewardWinston: bigint }, opts?: { apiFactory?: ...injectable, mirroring
      `SendTransferOptions.apiFactory` }): Promise<{ id: string; reward:
      bigint }>` from a new file. — done when: given a fake injected
      `apiFactory` (mirroring `tx-transfer.test.ts`'s existing fake pattern),
      `postArweaveData` builds an offline transaction carrying the given
      `data`/`tags`, signs it, and posts it via a chunked-upload loop against
      the pool's chosen endpoint, resolving `{ id, reward }`; omitting
      `maxRewardWinston` throws before any pool call; a quote exceeding
      `maxRewardWinston` throws before signing; a chunk-upload failure on one
      chunk is retried/resumed rather than restarting the whole upload.
  - files: `packages/arweave-core/src/reads/fee.ts`,
    `packages/arweave-core/tests/reads-fee.test.ts`,
    `packages/arweave-core/src/upload/nativeUpload.ts` (new),
    `packages/arweave-core/tests/upload-native.test.ts` (new)

## Wave 2 (depends on Wave 1)

- [ ] T4: Update the GraphQL rebuild path to read the three new tags
      additively — `OwnerUploadRecord`/`queryOwnerUploads` continue to
      return exactly what they do today, plus the new tags are present in
      each record's `tags` array (no field removed or renamed, so
      `codex-arweave`'s existing `rebuild.ts`, untouched this wave, keeps
      compiling and passing against records that now happen to carry 3 more
      tags). A record whose tags lack `Codex-Tag-Schema-Version` (an upload
      that predates this schema) is still returned normally, never dropped
      or erroring. — done when: a GraphQL fixture with all 7 tags round-trips
      through `queryOwnerUploads` with every tag intact; a fixture using only
      the original 4 tags (simulating a pre-existing upload) still returns a
      valid record with no thrown error.
  - files: `packages/arweave-core/src/rebuild/query.ts`,
    `packages/arweave-core/src/rebuild/types.ts`,
    `packages/arweave-core/tests/rebuild-query.test.ts`

- [ ] T5: Replace Turbo with T3's native primitive for the single-file
      upload path, and remove Turbo entirely from this package.
      `uploadData` (`upload.ts`) now calls `postArweaveData` (T3) instead of
      a `TurboUploadClient`; it calls `buildUploadTags` (T2) passing a real
      `itemId`-derived or generated `uploadId` and `itemType: "file"`
      explicitly (no longer relying on T2's defaults, which existed only to
      keep this file compiling before this task ran); the `clientFactory`
      injection seam in `UploadOptions` is replaced by an equivalent
      injectable seam for `postArweaveData`'s `opts.apiFactory` (tests inject
      a fake, exactly as `tx-transfer.test.ts` already does — no real network
      call in any test). Delete `packages/arweave-core/src/upload/turboClient.ts`
      entirely. Remove `@ardrive/turbo-sdk` from `package.json`'s
      dependencies. Remove the `TurboUploadClient`/`TurboUploadClientFactory`
      exports from `src/index.ts` and `src/upload/types.ts` (replaced by
      whatever seam type T3/this task actually expose); update the
      `// ── Upload: Turbo bundling path...` comment block in `src/index.ts`
      (lines ~139–146) to describe the native path instead. Rewrite
      `tests/upload.test.ts` to exercise the native path (fake `apiFactory`
      injection) — no test may reference Turbo, `@ardrive/turbo-sdk`, or
      `TurboUploadClient` anywhere in this package afterward. — done when:
      `grep -ri turbo packages/arweave-core/src packages/arweave-core/tests`
      returns no matches; `uploadData` with a fake injected `apiFactory`
      posts a signed native transaction carrying the full 7-tag set and
      resolves `{ id, ownerAddress, itemId, tags }` exactly as it does today;
      the full `arweave-core` test suite and `npx tsc -b packages/arweave-core
      --force` are clean.
  - files: `packages/arweave-core/src/upload/upload.ts`,
    `packages/arweave-core/src/upload/types.ts`,
    `packages/arweave-core/src/upload/turboClient.ts` (deleted),
    `packages/arweave-core/src/index.ts`, `packages/arweave-core/package.json`,
    `packages/arweave-core/tests/upload.test.ts`

- [ ] T6: Add a `BundleBuilder` for multi-file/folder uploads — one atomic
      ANS-104 bundle, one payment, for N files (with subfolder paths
      preserved) plus a manifest. For each input file: build a signed
      `arbundles` data item (`ArweaveSigner` from the caller's jwk,
      `createData(body, signer, { tags })` using T2's `buildUploadTags` with
      `itemType: "file"` and a shared `uploadId` for the whole batch,
      `Codex-Path` tag carrying the file's relative path), `await
      item.sign(signer)`, capturing the deterministic post-sign `item.id`.
      Build the manifest JSON (`{ manifest: "arweave/paths", version:
      "0.2.0", paths: { <path>: { id: <item.id> }, ... } }`), wrap it as its
      own signed data item tagged via `buildUploadTags` with
      `itemType: "manifest"` and `Content-Type:
      "application/x.arweave-manifest+json"` and the same `uploadId`.
      `bundleAndSignData(signer, [...fileItems, manifestItem])`, then post
      the resulting bundle as one transaction via T3's `postArweaveData`
      (`Bundle-Format: binary`, `Bundle-Version: 2.0.0` tags on the wrapping
      transaction). A single input file uses `uploadData`/T5's simple path
      instead — this task's entry point is only reached for 2+ files or an
      explicit folder selection. Exported as `uploadBundle(params: { jwk,
      files: { path: string; data: Uint8Array; contentType: string }[];
      maxRewardWinston: bigint }, opts?): Promise<{ manifestId: string;
      fileIds: { path: string; id: string }[]; uploadId: string }>` from a
      new file. — done when: given 3 files across 2 subfolders and a fake
      injected `apiFactory` (same seam T5 introduced), `uploadBundle`
      resolves a `manifestId`, 3 `fileIds` each keyed by their original
      relative path, and a shared `uploadId`; every produced data item
      (files + manifest) carries the same `Codex-Upload-Id` value; the
      manifest's `paths` map resolves each path to its file item's exact id;
      exactly one `postArweaveData` call is made for the whole batch (one
      atomic bundle, one payment) — asserted via the fake `apiFactory`'s call
      count.
      Not yet re-exported from `src/index.ts` in this task — T5 (same wave)
      also edits `index.ts`, so both tasks editing it concurrently would
      conflict; T7 (Wave 3) adds the `uploadBundle` export line once both
      Wave 2 tasks have landed.
  - files: `packages/arweave-core/src/upload/bundle.ts` (new),
    `packages/arweave-core/tests/upload-bundle.test.ts` (new)

## Wave 3 (depends on Wave 2)

- [ ] T7: Add the deferred `export { uploadBundle } from "./upload/bundle.js";`
      (and its param/result types) to `packages/arweave-core/src/index.ts`
      (T6's export, held back from Wave 2 to avoid a concurrent-edit
      conflict with T5 on the same file). Then extend `codex-arweave`'s
      upload/library flow and Upload UI to support multi-file and folder
      uploads end to end. In `library/flow.ts`,
      `uploadAndTrack` gains a bundle-aware path: given 2+ files, it calls
      T6's `uploadBundle` instead of T5's single-file `uploadData`, and
      appends one `LibraryEntry` **per returned file id plus one for the
      manifest id** (not just one entry) — every appended entry carries the
      same `uploadId` (a new `uploadId: string` field added to
      `LibraryEntry`/`types.ts`, additive, existing single-file entries get
      the item's own id as their `uploadId` for consistency) and `status:
      "pending"`; a throwing bundle upload still leaves the store untouched
      (upload-then-append, exactly as the single-file path already
      guarantees). `library/rebuild.ts`'s `recordToEntry` is updated to read
      the new `Codex-Upload-Id`/`Codex-Item-Type` tags into the same new
      `uploadId` field (falling back to the record's own `id` when the tag
      is absent — a pre-existing upload). In `panel/UploadArea.tsx`: the
      single `<input type="file">` becomes a file **and** folder picker (an
      additional `<input type="file" webkitdirectory>` control, or an
      equivalent toggle between "files" and "folder" selection modes); the
      tag preview shown before upload lists the full new required tag set
      (schema version, upload id placeholder, item type) alongside the
      existing four; selecting 2+ files or a folder routes through the new
      bundle-aware `uploadAndTrack` path and, on success, shows the manifest
      link plus a count of files uploaded, distinct from the existing
      single-file result view. — done when: `library/flow.ts`'s
      `uploadAndTrack` given 3 files appends exactly 4 `LibraryEntry` rows
      (3 files + 1 manifest) sharing one `uploadId`, and given 1 file still
      appends exactly 1 row exactly as it does today (no regression);
      `library/rebuild.ts` correctly reconstructs a bundle's grouped entries
      from a GraphQL fixture carrying the new tags; `UploadArea.tsx` lets a
      test pick multiple files via its file input and renders a distinct
      "N files uploaded" result (not the single-file result view) after a
      successful mocked bundle upload; the full `codex-arweave` test suite
      and `npx tsc -b packages/codex-arweave --force` are clean.
  - files: `packages/arweave-core/src/index.ts`,
    `packages/codex-arweave/src/library/flow.ts`,
    `packages/codex-arweave/src/library/types.ts`,
    `packages/codex-arweave/src/library/rebuild.ts`,
    `packages/codex-arweave/src/panel/UploadArea.tsx`,
    `packages/codex-arweave/tests/e3-library-flow.test.ts`,
    `packages/codex-arweave/tests/e3-rebuild.test.ts`,
    `packages/codex-arweave/tests/e4-panel-upload.test.tsx`
