# Arweave Upload Categories & App Lineage — Design

Sub-topic 2 of 4 under `docs/work/arweave-native-upload/design.md` (the rest
of §2 beyond schema-versioning, plus §2a). Read that document for full
rationale; this document scopes exactly what's built here. Depends on
Topic 1 (`arweave-native-bundle`, built and verified: `buildUploadTags` with
`Codex-Tag-Schema-Version`/`Codex-Upload-Id`/`Codex-Item-Type`, native
`uploadData`/`uploadBundle`, `UploadArea.tsx`'s multi-file/folder picker,
`LibraryEntry.uploadId`).

## Problem

Every upload today is unclassified — nothing distinguishes an NFT asset from
a personal photo from a legal document, there's no way to group multiple
versions of the same uploaded app/site, and there's no dedicated path for
backing up the codex's own encrypted export to Arweave (a real, permanent,
off-device alternative to "remember to download a file locally"). Without
mandatory categorization, the Library becomes unnavigable at scale — the
whole reason this taxonomy exists.

## Approach

**`Codex-Category` tag — mandatory at upload time, curated enum (not free
text).** No upload completes without one of these chosen:

| Group | Categories |
|---|---|
| Personal | `personal-photos`, `personal-videos`, `personal-audio`, `journals-writing`, `personal-documents`, `medical-records` |
| Financial & Legal | `financial-records`, `legal-records`, `certificates-credentials` |
| Creative & Professional | `creative-work`, `nft-data`, `software-code`, `website-dapp-hosting`, `research-data`, `publications-books` |
| Public / Web3-native | `public-statement`, `proof-timestamping` |
| Legacy & Family | `memorial-legacy`, `historical-archive`, `genealogy-family-history` |
| Correspondence | `correspondence-archive` |
| Gaming | `gaming-virtual-assets` |
| Events | `event-records` |
| Codex | `codex-backup` (special handling, see below) |
| Provenance | `foreign` (reserved for Topic 3's retroactive-add — not selectable from the upload UI itself; a real category value in the enum, never guessed for content this feature actually created) |
| Fallback | `general-other` (a deliberate, consciously-chosen catch-all — never a silent default) |

A genuine Codex-made upload that predates this tag (Topic 1 uploads, or any
future upload made before this ships) has no category tag at all,
permanently — the Library shows these in a local "Needs categorizing"
grouping (Topic 4's PermaLibrary browser concern, not built here); this is
distinct from `general-other`, which is an active choice, and from
`foreign`, which marks non-Codex provenance.

**`Codex-Asset-Type`** — present only when `Codex-Category` is `nft-data`,
one of the same 7 values OuronetUI's NFT viewer's `asset-type` already uses:
`image` / `audio` / `video` / `document` / `archive` / `model` / `exotic`.

**`Codex-App-Id` / `Codex-App-Version`** — orthogonal to category (most
relevant to, but not restricted to, `software-code`/`website-dapp-hosting`).
`Codex-App-Id` is a stable identifier the user sets once and reuses across
every subsequent upload of the same app/site; `Codex-App-Version` is a
free-text label on that specific upload. Not mutable versioning — every
version is still its own separate, permanent, immutable upload; these two
tags only make them linkable into a lineage (rendering that lineage as a
timeline is Topic 4's job).

**Mandatory-category UI.** `UploadArea.tsx`'s upload flow (both the
single-file and the Topic-1-built multi-file/folder bundle path) gains a
required category picker — the confirm/upload action stays disabled until
one is chosen. The optional `Codex-App-Id`/`Codex-App-Version` fields and,
when `nft-data` is picked, the required `Codex-Asset-Type` picker, appear
alongside it.

**`codex-backup` — a distinct upload path, not just a category label.** The
payload is the codex's *existing* export as-is — the exact JSON string
`useCodexBackup().exportForCloud()` already produces today for the
download/cloud-backup flow, where every secret field (seeds, keyfiles,
private keys) is already individually encrypted at the codex password via
the existing cipher; surrounding structural fields (labels, public
addresses, counts) are plaintext exactly as they already are in that export
— this task changes nothing about that shape, it only uploads the same
string. This feature's own Ouronet-account
encryption layer (Topic 3, not yet built) is never applied on top; doing
both would need both the codex password *and* a specific unlocked Ouronet
account to ever recover it. A new function wraps the existing export
ciphertext as the upload payload, tags it `Codex-Category: codex-backup`,
and posts it via Topic 1's single-file `uploadData` (never the bundle path —
this is always exactly one file). It shows a distinct, stronger warning
before this specific action (not the standard per-file permanence notice) —
the risk is that the codex password *at the moment of this upload* becomes
the only thing protecting the whole codex's plaintext, forever, with no
rotation or revocation possible once posted. On success, it clears the
codex's existing `dirty` flag (the same store action any other save/download
already uses) — this is a legitimate save, not a bypass of that signal.

## Acceptance criteria

- [ ] An upload cannot complete without an actively chosen `Codex-Category`
      from the enum above; there is no silent default value ever written.
- [ ] Picking `nft-data` requires also picking one of the 7
      `Codex-Asset-Type` values before the upload can proceed; any other
      category never shows or requires that field.
- [ ] Two uploads sharing the same user-supplied `Codex-App-Id` are
      distinguishable by their different `Codex-App-Version` values; neither
      upload mutates or replaces the other.
- [ ] A user can back up the codex's existing encrypted export to Arweave
      under `codex-backup`; the upload shows a distinct warning naming the
      permanent-password-lockin risk (different text from the standard
      permanence warning), the payload posted is exactly the existing
      export ciphertext (no additional encryption applied), and a
      successful post clears the codex's `dirty` flag.
- [ ] `foreign` exists as a valid, tag-writable category value but is not
      offered as a choice in the upload picker (it's reserved for Topic 3's
      retroactive-add path).
- [ ] The full existing test suites for `arweave-core` and `codex-arweave`
      still pass; typecheck stays clean across both packages.

## Addendum — mounting + NFT metadata attachment (post-build, owner request)

Two things the owner asked for after Wave 3 landed, before local verification:

1. **Mount what was built.** `UploadArea`/`LibraryArea` have been placeholder
   categories in `ArweavePanel.tsx` since before this project started ("the
   remaining two keep their explicit empty placeholder... being replaced one
   category at a time") — nothing built in this whole project was actually
   reachable in the real app. This addendum wires `ArweavePanelDeps`
   (`context.tsx`) up to the CURRENT (Topic 1/2) shapes of
   `uploadAndTrack`/`uploadFilesAndTrack`/`backupCodexToLibrary` (the
   existing `ArweavePanelDeps.uploadAndTrack` type predates both — it's the
   old single-file-only, no-category shape), mounts `UploadArea`,
   `LibraryArea`, and a new `CodexBackupArea` into their categories in
   `ArweavePanel.tsx`, and updates `apps/codex-playground`'s real + mock
   Arweave adapters so local end-to-end testing is actually possible.

2. **NFT metadata is optional and explicit, not assumed.** Ouronet's own
   native NFTs store their metadata on StoaChain itself (flexible,
   modifiable, no Arweave dependency) — so by default an `nft-data` upload
   is just the bare asset file, nothing else. A disclaimer says so
   explicitly. For interoperability with other chains/marketplaces that DO
   expect an off-chain metadata JSON (or other format) alongside the asset,
   an optional second file picker lets the user attach one — if present, it
   rides in the SAME bundle as a second item (reusing Topic 1's
   already-built multi-file bundle path verbatim; no new upload-pipeline
   code). Codex does not rewrite or inject anything into that file's
   content (e.g. no automatic self-referencing Arweave id injected into a
   metadata JSON) — if a user wants their metadata to reference the asset's
   own Arweave link, they build that externally before attaching it here.

## Out of scope

- `Codex-Encrypted`/`Codex-Encryptor` tags and real per-file encryption —
  Topic 3 (`arweave-upload-encryption`). `codex-backup`'s payload is already
  ciphertext from the existing codex-export cipher, unrelated to that tag.
- Retroactive-add and the `foreign`-category assignment flow — Topic 3.
- Rendering an app's version timeline, a "Needs categorizing" grouping, or
  any other PermaLibrary browsing UI — Topic 4/the separate
  `arweave-permalibrary` project topic.
- The non-removable-account invariant and session-safety active layer
  (`requestLogout`, `beforeunload`, periodic reminder) — Topic 4
  (`arweave-account-safety`). This topic only reuses the codex's *existing*
  dirty-clearing action for `codex-backup`, nothing new there.
