# Arweave Native Bundle Upload — Design

Sub-topic 1 of 4 under `docs/work/arweave-native-upload/design.md` (§1 and
the versioning/grouping/item-type slice of §2). Read that document for full
rationale, alternatives considered, and the complete tag-schema picture this
topic only partially builds. This document scopes exactly what's built here
and what's deferred to sub-topics 2–4.

## Problem

Today's Arweave upload (`packages/arweave-core/src/upload/upload.ts`) goes
through Turbo, a third-party bundler service, and only ever posts a single
file — no folders, no multi-file bundling, no manifest. The parent design
requires native, self-posted, atomically-bundled uploads paid directly from
the user's own AR balance, with no third-party bundler anywhere in the path.
Nothing about categories or encryption is needed to build this — those
attach to the pipeline this topic builds, in later sub-topics.

## Approach

- **Native single-item posting.** A new primitive in `arweave-core` builds
  an Arweave transaction from bytes + tags, signs it with the caller's JWK
  (the same custody already used by `SendArweaveModal`'s transfers via
  `decryptArweaveKey`), and posts it via the chunked uploader — no Turbo
  client anywhere in this path. `upload.ts`'s existing `uploadData` is
  rewired to call this instead of the Turbo client by default; the Turbo
  client code is removed, not left as a silent dead path (per the parent
  design's "replace entirely" decision).
- **Bundling for multi-file/folder.** A new `BundleBuilder` uses `arbundles`
  (newly added dependency): build a signed data item per file, compute their
  post-sign ids, build an `arweave/paths` manifest referencing those ids,
  `bundleAndSignData` everything, wrap as one L1 transaction via the same
  native posting primitive above, and post it — one atomic bundle, one
  payment, for 1 file or many. A single file still takes the simpler direct
  path (no bundle/manifest overhead for one item).
- **Tag-versioning scaffold.** `Codex-Tag-Schema-Version` (`"1"`),
  `Codex-Upload-Id` (groups a bundle's items + manifest as one unit), and
  `Codex-Item-Type` (`file` | `manifest`) are added to the existing tag
  builder, alongside the four unchanged tags (`App-Name`, `Content-Type`,
  `Codex-Item-Id`, `Codex-Owner`) that stay exactly as they are — they're the
  live GraphQL rebuild anchor and must keep working unmodified. Categories,
  encryption tags, and app-lineage tags are **not** added here — they're
  sub-topics 2–3's job, layered onto this same tag builder.
- **Rebuild stays working.** `queryOwnerUploads`/`rebuild.ts` are updated to
  read the new tags where present and to keep working unmodified against
  uploads that predate them (schema-version-gated, never erroring on an
  absent optional tag).

## Acceptance criteria

- [ ] A user can upload a single file as one native, self-posted Arweave
      transaction paid from their own AR balance — no Turbo/third-party
      bundler call happens anywhere in the path.
- [ ] A user can upload multiple files, or a folder with subfolders, as one
      atomic bundle (one signed L1 transaction, one payment); the resulting
      manifest link browses subpaths and each file also has its own direct
      link.
- [ ] Every upload (single-file or bundle) carries
      `Codex-Tag-Schema-Version`, `Codex-Upload-Id`, and `Codex-Item-Type`,
      alongside the unchanged four existing tags.
- [ ] `queryOwnerUploads`/the rebuild path correctly reconstructs both a
      single-file upload and a multi-file bundle (files + manifest grouped
      under one `Codex-Upload-Id`) from chain, and does not error or drop an
      older upload that predates the new tags.
- [ ] The full existing `arweave-core` and `codex-arweave` test suites still
      pass; no Turbo-specific test asserts behavior that no longer exists
      without being removed or rewritten to match the native path.

## Out of scope

- Categories, `codex-backup`, app-version lineage tags — `arweave-upload-categories`.
- Encryption, encrypted-upload UI, decrypt-on-download — `arweave-upload-encryption`.
- The non-removable-account invariant, session-safety layer — `arweave-account-safety`.
- Any UI beyond what's needed to prove the pipeline works end to end —
  `UploadArea.tsx`'s fuller rework (category picker, encryption toggle)
  happens in later sub-topics, not here.
