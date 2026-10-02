## Wave 1

- [ ] T1: Extend the tag schema with categories, NFT asset-type, and app
      lineage — all OPTIONAL at this layer (validated when present), so
      every existing caller of `buildUploadTags` (`upload.ts`, `bundle.ts`,
      untouched this task) keeps compiling; real enforcement ("category is
      mandatory") is added one layer up, in Wave 2, which is what actually
      calls this function with real values. Add exported constants:
      `TAG_CODEX_CATEGORY = "Codex-Category"`,
      `TAG_CODEX_ASSET_TYPE = "Codex-Asset-Type"`,
      `TAG_CODEX_APP_ID = "Codex-App-Id"`,
      `TAG_CODEX_APP_VERSION = "Codex-App-Version"`. Add an exported
      `UploadCategory` union type + `UPLOAD_CATEGORIES: readonly
      UploadCategory[]` runtime array with EXACTLY these 19 values (used
      both for validation and, later, to drive a UI picker — order matters,
      keep it in this grouped order):
      `"personal-photos"`, `"personal-videos"`, `"personal-audio"`,
      `"journals-writing"`, `"personal-documents"`, `"medical-records"`,
      `"financial-records"`, `"legal-records"`, `"certificates-credentials"`,
      `"creative-work"`, `"nft-data"`, `"software-code"`,
      `"website-dapp-hosting"`, `"research-data"`, `"publications-books"`,
      `"public-statement"`, `"proof-timestamping"`, `"memorial-legacy"`,
      `"historical-archive"`, `"genealogy-family-history"`,
      `"correspondence-archive"`, `"gaming-virtual-assets"`,
      `"event-records"`, `"codex-backup"`, `"foreign"`, `"general-other"`.
      (Note: that's 26 values, not 19 — the design doc's grouped table has
      26 entries total across its 11 groups; count every row, not the group
      count.) Add an exported `NftAssetType` union type +
      `NFT_ASSET_TYPES: readonly NftAssetType[]` with exactly these 7
      values: `"image"`, `"audio"`, `"video"`, `"document"`, `"archive"`,
      `"model"`, `"exotic"`.

      Extend `BuildUploadTagsParams` with four new optional fields:
      `category?: UploadCategory`, `assetType?: NftAssetType`,
      `appId?: string`, `appVersion?: string`. Validation (mirroring the
      existing `itemType` non-empty/enum-membership pattern, each throwing
      `InvalidUploadParamsError` with the matching field name):
      - `category`, when provided, must be one of `UPLOAD_CATEGORIES`.
      - `assetType`, when provided, requires `category === "nft-data"`
        (throws `InvalidUploadParamsError("assetType", "requires-nft-category", ...)`
        otherwise) and must be one of `NFT_ASSET_TYPES`.
      - `category === "nft-data"` requires `assetType` to be present
        (throws `InvalidUploadParamsError("assetType", "required-for-nft-category", ...)`
        otherwise) — the two rules together mean `assetType` is present if
        and only if `category` is `"nft-data"`.
      - `appId`/`appVersion`, when provided, must each be non-empty strings
        (same shape as the existing `appName` check); no cross-field rule
        between them (either may appear without the other).

      `buildUploadTags` emits these four tags — in the order
      `Codex-Category`, `Codex-Asset-Type`, `Codex-App-Id`,
      `Codex-App-Version` — immediately after the three existing
      schema/upload-id/item-type tags and before `appMetadata`, but ONLY the
      ones actually provided (an omitted optional field emits no tag — do
      not emit an empty-string placeholder). All four new tag names join
      `RESERVED_NAMES` (an `appMetadata` entry reusing any of them throws
      the existing reserved-name error).

      Follow TDD: write the failing tests first, confirm they fail, then
      implement, then refactor.

      Done when: `buildUploadTags({...7 required/defaulted...})` (no new
      fields) still returns exactly the same 7-tag array as before this
      task (no regression); adding `category: "nft-data", assetType: "video"`
      appends both tags in the documented order; `category: "nft-data"`
      alone (no `assetType`) throws; `assetType: "video"` alone (no
      `category`, or `category` set to anything other than `"nft-data"`)
      throws; `category: "not-a-real-category" as any` throws; `appId`/
      `appVersion` each round-trip verbatim when provided; an `appMetadata`
      entry named `"Codex-Category"` throws the reserved-name error.
  - files: `packages/arweave-core/src/upload/tags.ts`,
    `packages/arweave-core/tests/upload-tags.test.ts`

## Wave 2 (depends on Wave 1)

- [ ] T2: Make category mandatory (and asset-type/app-lineage available) on
      the single-file native upload path. `UploadParams` (`upload/types.ts`)
      gains a REQUIRED `category: UploadCategory` field plus optional
      `assetType?: NftAssetType`, `appId?: string`, `appVersion?: string` —
      all four forwarded verbatim to `buildUploadTags` inside `uploadData`
      (`upload.ts`). Rewrite `tests/upload.test.ts`'s existing `UploadParams`
      fixtures to include a `category` (any valid value from T1's
      `UPLOAD_CATEGORIES`) so they keep passing, and add new tests: an
      `nft-data` upload with a valid `assetType` succeeds and the posted
      tags include both; omitting `category` entirely is a TypeScript
      compile-time error (assert this by NOT casting around it anywhere in
      the test file — a plain missing-field omission should fail `tsc`) —
      document this as a type-level guarantee in a comment rather than a
      runtime test, since TypeScript required-field omission cannot be
      asserted at runtime the same way a validation throw can.
  - files: `packages/arweave-core/src/upload/upload.ts`,
    `packages/arweave-core/src/upload/types.ts`,
    `packages/arweave-core/tests/upload.test.ts`

- [ ] T3: Same mandatory-category treatment for the bundle path.
      `UploadBundleParams` (`upload/bundle.ts`) gains the same REQUIRED
      `category: UploadCategory` plus optional `assetType?`/`appId?`/
      `appVersion?`, applied identically to every file item AND the
      manifest item in the batch (all items of one upload action share the
      same category/asset-type/app-lineage — this is a per-upload-action
      choice, not a per-file one). Rewrite `tests/upload-bundle.test.ts`'s
      fixtures to include a `category`, and add a test asserting every
      produced item (files + manifest) carries the same `Codex-Category`
      tag value.
  - files: `packages/arweave-core/src/upload/bundle.ts`,
    `packages/arweave-core/tests/upload-bundle.test.ts`

- [ ] T4: Add a dedicated codex-backup upload primitive. New function
      `uploadCodexBackup(pool: GatewayPool, params: { jwk: ArweaveJwk;
      exportJson: string; maxRewardWinston: bigint }, opts?: {
      apiFactory?: UploadGatewayApiFactory }): Promise<UploadResult>` in a
      new file. `exportJson` is an OPAQUE string payload — this function
      does not know or care about codex internals (no import from any
      `codex-*` package; `arweave-core` has and must keep zero dependency on
      them) — the caller (a later task, in `codex-arweave`) is responsible
      for actually producing that string via the codex's own existing
      export flow. Internally: call `uploadData` (T2's now-category-required
      signature) with `data: params.exportJson`, `contentType:
      "application/json"`, `category: "codex-backup"` (hardcoded — this
      function is the ONLY caller allowed to set this category; do not
      expose a way to override it), forwarding `jwk`/`maxRewardWinston`/
      `opts` verbatim. No `assetType`/`appId`/`appVersion` — none apply to
      a codex-backup upload. Follow TDD: write the failing tests first in a
      new test file, confirm they fail, then implement.

      Done when: given a fake injected `apiFactory` (same pattern as
      `upload.test.ts`/`upload-native.test.ts`), `uploadCodexBackup`
      uploads the given `exportJson` string verbatim as the payload,
      tagged `Codex-Category: codex-backup` and
      `Content-Type: application/json`, and resolves the same
      `UploadResult` shape `uploadData` does.
  - files: `packages/arweave-core/src/upload/codexBackup.ts` (new),
    `packages/arweave-core/tests/upload-codex-backup.test.ts` (new)

## Wave 3 (depends on Wave 2)

- [ ] T5: Wire categories, app lineage, and the codex-backup upload into
      `codex-arweave` end to end.

      **`src/index.ts`**: add exports for T1's `UploadCategory`/
      `UPLOAD_CATEGORIES`/`NftAssetType`/`NFT_ASSET_TYPES`/the 4 new tag
      name constants, and T4's `uploadCodexBackup` + its param/result types.

      **`src/library/flow.ts`**: `uploadAndTrack` and `uploadFilesAndTrack`
      (read the current file first — these were built/renamed during the
      prior `arweave-native-bundle` plan; confirm their exact current
      signatures before changing them) both gain a REQUIRED `category:
      UploadCategory` parameter plus optional `assetType?`/`appId?`/
      `appVersion?`, threaded straight through to `uploadData`/
      `uploadBundle`. Add a new function `backupCodexToLibrary(exportJson:
      string, opts: { store: LibraryStore; pool: GatewayPool; jwk:
      ArweaveJwk; maxRewardWinston: bigint; apiFactory?; onSuccess?: () =>
      void }): Promise<UploadResult>` — calls `uploadCodexBackup`, and ONLY
      on success (upload-then-append discipline, same as every other flow
      function in this file) appends a `LibraryEntry` AND calls
      `opts.onSuccess?.()` (the call site, in codex-ouronet's store, is
      responsible for actually clearing `dirty` via the existing
      `clearDirty()` action — this function must not import from
      `codex-ouronet`, keeping the same cross-package isolation
      `library/flow.ts` already maintains elsewhere in this file; read this
      file's own module doc comment on that isolation rule before writing
      anything).

      **`src/panel/UploadArea.tsx`**: add a required category picker (a
      `<select>` populated from `UPLOAD_CATEGORIES` EXCLUDING `"foreign"`
      (reserved for a later topic's retroactive-add flow — never a choice a
      user actively uploading something new should see) and
      `"codex-backup"` (has its own dedicated entry point, `CodexBackupArea`
      below, which sets that category itself and is never user-chosen from
      a dropdown) — so this picker offers exactly 24 of the 26 enum values,
      grouped via `<optgroup>` matching the design doc's 11 groups (minus
      the Codex and Provenance groups, which have no selectable member
      here). The Upload button
      stays disabled until both a file/folder selection AND a category are
      present (extend the existing `disabled={files.length === 0 ||
      pending}` condition). When `nft-data` is selected, an additional
      required `<select>` for `assetType` (from `NFT_ASSET_TYPES`) appears,
      and the Upload button also stays disabled until it has a value.
      Optional text inputs for `appId`/`appVersion` are always visible
      (never block the button). Extend the tag preview to include whichever
      of the 4 new tags currently have a value. Wire the chosen
      category/assetType/appId/appVersion into the `uploadAndTrack`/
      `uploadFilesAndTrack` calls.

      **A new `src/panel/CodexBackupArea.tsx`**: a small, separate
      component (codex-backup is "back up the codex itself," not a
      file-picker flow — it does not belong inside `UploadArea.tsx`'s
      file-selection UI). A single "Back up codex to Arweave" button; on
      click, shows a confirm dialog with DIFFERENT text from
      `UPLOAD_PERMANENCE_WARNING` — name the specific risk: the codex
      password *at the time of this upload* becomes the only thing
      protecting every secret in the backup, permanently, with no rotation
      or revocation possible once posted (write this as a new exported
      constant, e.g. `CODEX_BACKUP_PERMANENCE_WARNING`, in
      `library/constants.js`, mirroring how `UPLOAD_PERMANENCE_WARNING` is
      already defined there — never inline the string in the component).
      On confirm, calls an injected `backupCodex: (exportJson: string) =>
      Promise<{ id: string }>` prop (the component itself does not know how
      to produce `exportJson` or clear `dirty` — those are the consuming
      app's job, matching this package's existing dependency-injection
      pattern for every other panel area) and shows a direct link to the
      result on success, or an error view on failure — mirror
      `UploadArea.tsx`'s existing phase-state-machine structure
      (idle/confirming/uploading/done/error) rather than inventing a new
      shape.

      Follow TDD throughout: extend the failing tests first in each
      existing test file (plus a new one for `CodexBackupArea.tsx`),
      confirm they fail, then implement, then refactor.

      Done when:
      - `uploadAndTrack`/`uploadFilesAndTrack` reject (at the type level,
        and — for a present-but-invalid value — at runtime) a call missing
        `category`, exactly mirroring T2/T3's underlying enforcement.
      - `UploadArea.tsx`: the Upload button is disabled with a file
        selected but no category chosen; selecting `nft-data` reveals the
        asset-type picker and keeps the button disabled until it has a
        value too; a non-nft category never shows that picker; the category
        `<select>` never renders an option for `"foreign"` or
        `"codex-backup"` (assert their exact absence from the rendered
        options, not just presence of a plausible subset).
      - `CodexBackupArea.tsx`: clicking "Back up codex to Arweave" shows
        the distinct backup-specific warning text (not
        `UPLOAD_PERMANENCE_WARNING`'s text); confirming calls the injected
        `backupCodex` prop and shows a result link on success.
      - **The FULL, unscoped `codex-arweave` test suite passes** (`npx
        vitest run` from `packages/codex-arweave`, not filtered to this
        task's own files) — Wave 3 of the prior `arweave-native-bundle`
        plan found real breakage in files outside its own declared scope
        this exact way; check for the same class of gap here (e.g.
        `src/adapter/arweaveAdapter.ts`'s `upload` method, or any other
        existing caller of `uploadAndTrack`/`UploadParams`) and fix it if
        found, flagging it explicitly in your report the same way that
        task did, even though it isn't itself in this task's `files:` list
        below.
      - `npx tsc -b packages/arweave-core --force` and
        `npx tsc -b packages/codex-arweave --force` are both clean.
  - files: `packages/arweave-core/src/index.ts`,
    `packages/codex-arweave/src/library/flow.ts`,
    `packages/codex-arweave/src/library/constants.ts`,
    `packages/codex-arweave/src/panel/UploadArea.tsx`,
    `packages/codex-arweave/src/panel/CodexBackupArea.tsx` (new),
    `packages/codex-arweave/tests/e3-library-flow.test.ts`,
    `packages/codex-arweave/tests/e4-panel-upload.test.tsx`,
    `packages/codex-arweave/tests/e4-panel-codex-backup.test.tsx` (new)
