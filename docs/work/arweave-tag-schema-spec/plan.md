## Wave 1

- [x] T1: Add the `Codex-Encryption-Version` tag to the schema. Read
      `packages/arweave-core/src/upload/tags.ts` in full first — mirror
      the EXACT existing `encrypted`/`encryptorAddress` two-way-implication
      pattern for the new field, since the rule is identical:
      `Codex-Encryption-Version` and `Codex-Encryptor` appear together or
      not at all. Add `TAG_CODEX_ENCRYPTION_VERSION = "Codex-Encryption-Version"`
      and an exported constant for the current value,
      `CODEX_ENCRYPTION_VERSION_CURRENT = "1"` (mirroring
      `CODEX_TAG_SCHEMA_VERSION_CURRENT`'s own existing pattern — a pinned
      constant, never caller-supplied, bumped only when the real encryption
      procedure changes). Add an optional `encryptionVersion?: string`
      field to `BuildUploadTagsParams`; validate: present requires
      `encrypted === true` (else throw, same reason-shape as the existing
      `encryptorAddress`-requires-`encrypted` check); `encrypted === true`
      requires `encryptionVersion` present (else throw) — this field is
      NOT optional once encrypted, unlike `appId`/`appVersion`, because an
      encrypted upload with no stamped procedure version is exactly the
      permanent-data risk this topic exists to close. Join
      `RESERVED_NAMES`. Emit immediately after `Codex-Encryptor` in the tag
      order.

      Follow TDD: write the failing tests first, confirm they fail, then
      implement.

      Done when: `encrypted: true, encryptorAddress, encryptionVersion:
      "1"` emits `Codex-Encryption-Version: "1"` right after
      `Codex-Encryptor`; `encrypted: true` without `encryptionVersion`
      throws; `encryptionVersion` without `encrypted: true` throws;
      `encrypted: false` never emits it even if (incorrectly) supplied —
      throws instead, same as the existing `encryptorAddress`-without-
      `encrypted` case.
  - files: `packages/arweave-core/src/upload/tags.ts`,
    `packages/arweave-core/tests/upload-tags.test.ts`

## Wave 2 (depends on Wave 1)

- [x] T2: Thread `encryptionVersion` through the real upload entry points.
      Read `packages/arweave-core/src/upload/upload.ts`, `types.ts`, and
      `bundle.ts` in full first (current shape, post all prior
      `arweave-upload-encryption` work — `encrypted`/`encryptorAddress`
      are already required-when-encrypted fields there). Add
      `encryptionVersion?: string` to `UploadParams`/`UploadBundleParams`,
      forwarded verbatim to `buildUploadTags` exactly like
      `encryptorAddress` already is, including the bundle path's existing
      asymmetry (every FILE item gets it when encrypted; the MANIFEST item
      never does, same as `Codex-Encrypted`/`Codex-Encryptor` already
      work). Rewrite the existing `encrypted: true` test fixtures in both
      test files to include `encryptionVersion` (the two-way validation
      from T1 means they'll now fail without it) and add a new assertion
      per file confirming `Codex-Encryption-Version` round-trips onto the
      posted tags correctly, including the bundle-asymmetry case.

      Follow TDD: update/add the failing tests first, confirm they fail,
      then implement, then refactor.

      Done when: an encrypted single-file or bundle upload posts
      `Codex-Encryption-Version` correctly (files: yes, manifest: no); every
      existing `encrypted: true` test in both files still passes with the
      new required field added to its fixture.
  - files: `packages/arweave-core/src/upload/upload.ts`,
    `packages/arweave-core/src/upload/types.ts`,
    `packages/arweave-core/src/upload/bundle.ts`,
    `packages/arweave-core/tests/upload.test.ts`,
    `packages/arweave-core/tests/upload-bundle.test.ts`

- [x] T3: Write the canonical tag schema spec document and ship it. New
      file `packages/codex/ARWEAVE_TAG_SCHEMA.md` — read
      `packages/codex/IMPORT_EXPORT_CONTRACT.md` first for this package's
      established spec-document style/structure and mirror it exactly
      (not reinvent a different format). Content: every tag this project
      has ever defined (`App-Name`, `Content-Type`, `Codex-Item-Id`,
      `Codex-Owner`, `Codex-Tag-Schema-Version`, `Codex-Upload-Id`,
      `Codex-Item-Type`, `Codex-Category`, `Codex-Asset-Type`,
      `Codex-App-Id`, `Codex-App-Version`, `Codex-Encrypted`,
      `Codex-Encryptor`, `Codex-Encryption-Version`, `Codex-Path` — ground
      every exact name and current emission-order position by reading
      `packages/arweave-core/src/upload/tags.ts` and
      `packages/arweave-core/src/upload/bundle.ts` directly, do not trust
      this list from memory), in their real canonical emission order, each
      with: what it means, when it's present vs. omitted, and which
      `Codex-Tag-Schema-Version` introduced it. A dedicated section,
      "Encryption procedure versions," with a `## Version 1` subsection
      documenting the EXACT current scheme in enough detail to
      reimplement from the document alone: PBKDF2-SHA512, 600,000
      iterations, AES-256-GCM, the deterministic salt derivation from the
      account's bitstring, the 12-byte-IV-prepended-to-ciphertext byte
      layout, and the base64-encode-before-encrypt step — read
      `packages/codex-arweave/src/crypto/fileEncryption.ts` and
      `packages/codex-arweave/src/library/flow.ts`'s actual encryption
      composition directly to document this precisely, not from memory.

      Ship it: add `"ARWEAVE_TAG_SCHEMA.md"` to `packages/codex/
      package.json`'s `files` array (mirroring exactly how
      `IMPORT_EXPORT_CONTRACT.md` is already listed there), and add a
      short pointer line to it in `packages/codex/README.md` near the
      existing `IMPORT_EXPORT_CONTRACT.md` pointer.

      Done when: `npm pack --dry-run` on the `codex` package (or
      equivalent tarball-content check) confirms `ARWEAVE_TAG_SCHEMA.md`
      is actually included; every tag name/position documented matches
      the real current code exactly (spot-check at least 3 against the
      actual source, not just internal consistency).
  - files: `packages/codex/ARWEAVE_TAG_SCHEMA.md` (new),
    `packages/codex/package.json`, `packages/codex/README.md`

## Wave 3 (depends on Wave 2)

- [x] T4: Wire the real emission and fix the preview UI. Read
      `packages/codex-arweave/src/library/flow.ts`'s current encryption
      composition (`arweave-upload-encryption`'s T5) and
      `packages/codex-arweave/src/panel/UploadArea.tsx`'s `previewTags`
      (already extended once this session for `encrypted`/
      `encryptorAddress`) and `packages/codex-arweave/src/panel/
      UploadWizard.tsx`'s Review step tag-preview rendering, all in full,
      before changing anything.

      In `flow.ts`: whenever `encryptFor` is present, set
      `encryptionVersion` to the current pinned value (import
      `CODEX_ENCRYPTION_VERSION_CURRENT` from `@ancientpantheon/arweave-core`
      — add it to that package's public `index.ts` export list if it
      isn't already there, the same gap pattern `TAG_CODEX_ENCRYPTED`/
      `TAG_CODEX_ENCRYPTOR` had before a direct fix earlier this session;
      check first rather than assume) on the real `uploadData`/
      `uploadBundle` call — never caller-suppliable, always the pinned
      current value, exactly like `uploadCodexBackup` hardcodes its own
      category.

      In `previewTags` (`UploadArea.tsx`): extend the same way
      `encrypted`/`encryptorAddress` were added — an optional
      `encryptionVersion` field in the `selection` param, emitted
      alongside `Codex-Encryptor` under the identical presence rule.

      In `UploadWizard.tsx`'s Review step: rebuild the tag-preview list to
      show a FIXED, CANONICAL set of rows in a FIXED order — sourced
      from/matching T3's spec document's own canonical ordering — rather
      than only rendering whatever `previewTags` happens to currently
      return. For any row that doesn't apply to this specific upload
      (e.g. `Codex-Encryptor`/`Codex-Encryption-Version` on a Public
      upload, `Codex-App-Id`/`Codex-App-Version` outside
      `software-code`/`website-dapp-hosting`), render that row with a
      clear "— does not apply (public upload)" / "— does not apply (not
      an app/site upload)" placeholder instead of omitting the row
      entirely. This is presentation-only — do NOT change what
      `previewTags`/the real upload call actually emit on chain; a public
      upload still omits these tags for real, the preview just always
      shows where they WOULD go.

      Follow TDD: write the failing tests first (encrypted upload's
      posted tags include the correct `Codex-Encryption-Version`; the
      preview shows a fixed row set/order for both a Public and an
      Encrypted selection, with the correct placeholder text for
      inapplicable rows in each case), confirm they fail, then implement,
      then refactor.

      Done when: a real encrypted upload through this wizard posts
      `Codex-Encryption-Version` correctly; the Review step's tag list has
      the SAME rows, in the SAME order, for a Public upload and an
      Encrypted upload (only the inapplicable rows' displayed text
      differs, never their presence). The full `arweave-core` and
      `codex-arweave` test suites pass (unscoped — check for and fix any
      gap outside this task's own file list, flagging explicitly if
      found, matching every prior task in this project).
      `npx tsc -b packages/arweave-core --force` and `npx tsc -b
      packages/codex-arweave --force` are both clean.
  - files: `packages/arweave-core/src/index.ts` (only if
    `CODEX_ENCRYPTION_VERSION_CURRENT` isn't already exported — verify
    first), `packages/codex-arweave/src/library/flow.ts`,
    `packages/codex-arweave/src/panel/UploadArea.tsx`,
    `packages/codex-arweave/src/panel/UploadWizard.tsx`,
    `packages/codex-arweave/tests/e3-library-flow.test.ts`,
    `packages/codex-arweave/tests/e4-panel-upload-wizard.test.tsx`
