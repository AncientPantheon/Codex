# Codex Arweave Tag Schema

**This is a normative contract, not a description.** Every statement below
using MUST / MUST NOT / NEVER is a hard rule for any application embedding
`@ancientpantheon/codex`'s Arweave upload surface, and for any application
that later rebuilds or reads a Codex upload from chain. It exists because
Arweave data is **permanent** — a tag, once posted, cannot be edited,
reinterpreted, or retroactively corrected. A tag-schema mistake made today is
not a bug you fix in the next release; it is a bug every past upload carries
forever. This document is the single place that ends the guessing about what
tag a given upload carries, in what order, under what condition, for every
tag this project has ever defined — and the single place documenting exactly
which cryptographic procedure produced an encrypted upload's ciphertext.

If you are integrating with Codex's Arweave uploads and you find yourself
about to hand-roll a tag name, a tag order, or an encryption/decryption
routine instead of reading this document (and the source it is grounded
against) — stop. The tag names are exact strings, GraphQL tag matching on
Arweave is exact-string, and an encrypted upload decrypted under the wrong
procedure version fails its AES-GCM auth-tag check silently-from-the-user's-
perspective (a cryptic `OperationError`), not with a helpful message.

## 1. Two independent versioning axes — and why they are not the same concern

Every Codex upload carries two separate version tags, and conflating them is
a category error:

- **`Codex-Tag-Schema-Version`** — which TAGS exist on an upload, and what
  each one MEANS. This versions the shape of the metadata envelope itself:
  the set of tag names, their presence/absence rules, and their semantics.
  It bumps only when a REQUIRED tag's shape or meaning changes; adding a new
  OPTIONAL tag is never a version bump (see `tags.ts`'s own doc comment on
  `CODEX_TAG_SCHEMA_VERSION_CURRENT`). Every tag documented in §2 below has
  existed under schema version `"1"` since it was introduced — this project
  has never bumped this value, because every tag added since the four
  original required tags has been added as an OPTIONAL tag.
- **`Codex-Encryption-Version`** — which exact cryptographic PROCEDURE
  produced an encrypted upload's ciphertext bytes: the KDF, the cipher, the
  salt derivation, the IV handling, the pre-encryption encoding. This is
  wholly independent of what tags exist — it describes how to turn the
  ciphertext bytes back into plaintext, not how to find or interpret the
  tags around them.

**Why both matter, independently, for a permanent, non-migratable data
store:** a conventional database can run a migration that rewrites every old
row to a new shape, or re-encrypts every old ciphertext under a new scheme,
the moment either changes. Arweave data cannot be rewritten, re-tagged, or
re-encrypted in place — a given transaction's bytes and tags are fixed
forever the moment it confirms. That means:

- If only `Codex-Tag-Schema-Version` existed, a future encryption-procedure
  change would have no way to stamp *which* procedure a given ciphertext
  needs, and a decrypt path would have to guess (or worse, assume every
  upload uses the current procedure) — silently producing garbage plaintext
  for old data, or failing closed for no diagnosable reason.
- If only `Codex-Encryption-Version` existed, there would be no way to know
  which tags a given upload is guaranteed to carry at all — a rebuild-from-
  chain path could not distinguish "this upload predates `Codex-Category`"
  from "this upload is malformed."

Keeping them as two separate, independently-bumped tags means a future
change to either concern — a new required tag, or a new encryption scheme —
never forces a bump of the other, and a decrypt/rebuild path reading an old
upload from years ago always has an exact, explicit answer to both "what
tags should I expect here" and "what procedure decrypts this."

## 2. Every tag, in real canonical emission order

The tag list below is grounded directly against `buildUploadTags` in
`packages/arweave-core/src/upload/tags.ts` (the ONE canonical source of the
tag contract — GraphQL tag matching is exact-string, so upload and rebuild
MUST share one spelling, hence one module owns every constant) and against
`packages/arweave-core/src/upload/bundle.ts` (the `Codex-Path` tag and the
file-vs-manifest asymmetry), read directly while writing this document, not
recalled from memory.

`buildUploadTags` emits, in this exact order, for every upload item (file or
manifest):

1. the seven tags below (REQUIRED or always-emitted-once-validated),
2. then the OPTIONAL tags in §2's listed order, each only if its own
   condition holds,
3. then any `appMetadata` entries in the caller's own order — this is where
   `Codex-Path` (bundle uploads only, never a single-file upload) is
   appended, since `bundle.ts` passes it as an `appMetadata` entry, not a
   dedicated `buildUploadTags` field.

All tags below belong to `Codex-Tag-Schema-Version: "1"` — the only schema
version this project has ever shipped.

| # | Tag name | Meaning | Present when | Introduced |
|---|---|---|---|---|
| 1 | `App-Name` | The pinned application identifier the rebuild filter keys on. | Always. Defaults to `DEFAULT_APP_NAME` (`"AncientPantheon-Codex"`) when the caller omits `appName`; when explicitly provided it must be a non-empty string. | Schema v1 (original four required tags). |
| 2 | `Content-Type` | The item's MIME type. | Always. Required, non-empty string. | Schema v1. |
| 3 | `Codex-Item-Id` | The caller-assigned uuid identifying this specific upload item. | Always. Required, non-empty string. | Schema v1. |
| 4 | `Codex-Owner` | The uploader's canonical 43-char base64url Arweave address, verbatim. | Always. Validated via `isCanonicalAddress`. | Schema v1. |
| 5 | `Codex-Tag-Schema-Version` | The tag schema version this upload's tag set conforms to. | Always. Value is always `CODEX_TAG_SCHEMA_VERSION_CURRENT` (`"1"` today) — never caller-supplied. | Schema v1. |
| 6 | `Codex-Upload-Id` | Groups N files + a manifest produced by one upload action. | Always. Defaults to a generated `globalThis.crypto.randomUUID()` when the caller omits `uploadId`; when explicit, must be a non-empty string. | Schema v1. |
| 7 | `Codex-Item-Type` | `"file"` or `"manifest"` — what kind of item this is within its upload action. | Always. Defaults to `"file"` when omitted. | Schema v1. |
| 8 | `Codex-Category` | The curated upload-taxonomy value (one of `UPLOAD_CATEGORIES`, 26 values across 11 groups — e.g. `"personal-photos"`, `"nft-data"`, `"codex-backup"`). | Present only when the caller supplies `category`; omitted entirely otherwise. Real mandatory-category enforcement is a caller's job one layer above `buildUploadTags`, not this tag-builder's. | `arweave-upload-categories` T1. |
| 9 | `Codex-Asset-Type` | The NFT asset kind (one of `NFT_ASSET_TYPES`: `"image"`, `"audio"`, `"video"`, `"document"`, `"archive"`, `"model"`, `"exotic"`). | Present if and only if `category === "nft-data"` — a two-way implication: supplying `assetType` without `category: "nft-data"` throws, and `category: "nft-data"` without `assetType` throws. | `arweave-upload-categories` T1. |
| 10 | `Codex-App-Id` | A stable identifier reused across one app/site's own uploads (e.g. a backup's `codexIdentity.formatted`). | Present only when the caller supplies `appId`; omitted otherwise. Independent of `appVersion` — either may appear without the other. | `arweave-upload-categories` T1. |
| 11 | `Codex-App-Version` | A free-text label on this one specific upload (e.g. a backup's `lastUpdatedAt`). | Present only when the caller supplies `appVersion`; omitted otherwise. Independent of `appId`. | `arweave-upload-categories` T1. |
| 12 | `Codex-Encrypted` | `"true"` or `"false"` (the literal string) — whether this item's content bytes are ciphertext. | Present whenever the caller EXPLICITLY supplies `encrypted` (`true` or `false`) — unlike `Codex-Category`, a `false` value is still emitted, never omitted, so "was this encrypted" is never ambiguous on a real upload. Omitting `encrypted` entirely emits no tag at all (backward compatible with every pre-encryption caller). | `arweave-upload-encryption` T2. |
| 13 | `Codex-Encryptor` | The encrypting account's public address only (an OURONET address, not an Arweave address — a different chain, a different address format; `arweave-core` validates only that a non-empty string was supplied, never the Ouronet address shape itself, since this package has zero dependency on any `codex-*` package). | Present if and only if `encrypted === true` — a two-way implication: supplying `encryptorAddress` without `encrypted === true` throws, and `encrypted === true` without `encryptorAddress` throws. | `arweave-upload-encryption` T2. |
| 14 | `Codex-Encryption-Version` | Which encryption PROCEDURE (see §3 below) produced this item's ciphertext — distinct from `Codex-Tag-Schema-Version`, which versions the tags, not any one tag's cryptographic meaning. | Present if and only if `encrypted === true` — the same two-way implication as `Codex-Encryptor`, with one difference: UNLIKE `Codex-App-Id`/`Codex-App-Version`, this field is NEVER optional once `encrypted === true`. An encrypted upload with no stamped procedure version is exactly the permanent-data risk this tag exists to close — Arweave data can never be retroactively re-tagged with a procedure version after the fact. Callers always pass the pinned `CODEX_ENCRYPTION_VERSION_CURRENT`, never a free-form value. | `arweave-tag-schema-spec` T1. |
| 15 | `Codex-Path` | The file's path relative to the upload root, subfolders preserved with forward slashes (e.g. `"sub/dir/file.txt"`). Module-local to `bundle.ts` (`const TAG_CODEX_PATH = "Codex-Path"`) — **not exported from `arweave-core`'s public barrel** (`src/index.ts`); any consumer needing to read this tag back (e.g. `codex-arweave`'s `library/flow.ts`/`panel/LibraryArea.tsx`) re-declares the same literal locally rather than importing it. | Present only on FILE items of a bundle upload (`uploadBundle`'s multi-file/folder path), carried as an `appMetadata` entry — never emitted by the single-file `uploadData` path, and never present on the bundle's own manifest item. | Introduced alongside bundle uploads (Phase 4 T6), predates the `arweave-tag-schema-spec` topic. |

### The file-vs-manifest tagging asymmetry (bundle uploads only)

A bundle upload (`uploadBundle`, reached for 2+ files or an explicit folder
selection) produces N file items plus one manifest item, all sharing one
`Codex-Upload-Id`. `category`/`assetType`/`appId`/`appVersion` are applied
**identically** to every file item and the manifest item — a per-upload-
action choice. `encrypted`/`encryptorAddress`/`encryptionVersion` are **not**
applied uniformly:

- Every FILE item gets `Codex-Encrypted`/`Codex-Encryptor`/
  `Codex-Encryption-Version` exactly as the caller specified for the batch.
- The MANIFEST item is **always** tagged `encrypted: false` — carrying no
  `Codex-Encryptor` and no `Codex-Encryption-Version` tag at all — regardless
  of what the caller passed for the files. The manifest's own JSON body (the
  folder/file path → data-item-id mapping) must stay public and
  gateway-readable so a gateway can resolve subpaths, even when every file
  it points to is encrypted; only file CONTENTS are ever encrypted, never the
  structural mapping between a path and its item id.
- `Codex-Path` only ever appears on file items — the manifest item carries no
  `Codex-Path` tag (it has no single "path" of its own; it IS the path map).

A single-file upload (`uploadData`) has no manifest item and no `Codex-Path`
tag at all — the asymmetry above is specific to the bundle path.

## 3. Encryption procedure versions

Grounded directly against `packages/codex-arweave/src/crypto/
fileEncryption.ts` (the derive-once-per-upload-action AES cipher) and
`packages/codex-arweave/src/library/flow.ts`'s `encryptFileForUpload`
composition (the exact byte layout posted to chain), read directly while
writing this document.

### Version 1

`Codex-Encryption-Version: "1"` identifies the following scheme, in enough
detail to reimplement from this document alone.

**Key derivation.** One AES key is derived ONCE per upload action (not once
per file, for performance — PBKDF2 at this iteration count is deliberately
expensive) from an Ouronet account's canonical 1600-bit `"0"`/`"1"`
bitstring:

- **KDF:** PBKDF2.
- **Hash:** SHA-512.
- **Iterations:** 600,000 (OWASP's current minimum for PBKDF2-SHA512 at time
  of writing — matched to `@stoachain/stoa-core/crypto`'s own V2 cipher for
  consistency/auditability across the codebase's encrypted-blob conventions,
  though this module does NOT share V2's on-wire envelope format).
- **Key material input:** the UTF-8-encoded bytes of the account's bitstring
  itself, imported as raw PBKDF2 key material.
- **Output:** an AES-GCM `CryptoKey`, 256-bit (`length: 256`), usable for
  both `encrypt` and `decrypt`.

**Salt derivation (deterministic, not random).** PBKDF2 ordinarily takes a
random salt, but this module must re-derive the IDENTICAL key from nothing
but the bitstring on a later call (e.g. after a page reload) with no stored
salt to retrieve — a random salt would silently derive a different key on
every call. The salt is instead computed deterministically:

1. Build the string `"codex-arweave/file-encryption/salt/v1:" + bitstring`
   (the namespace prefix is fixed and versioned — `v1` — so this salt
   derivation can never collide with an unrelated hash of the same bitstring
   computed elsewhere in the codebase for a different purpose).
2. UTF-8-encode that string.
3. SHA-256 the encoded bytes.
4. Use the raw 32-byte digest directly as the PBKDF2 `salt` parameter (no
   truncation — PBKDF2's `salt` accepts any byte length, and a longer,
   hash-derived salt is adequate here since PBKDF2's security against
   precomputation comes from the salt being UNIQUE per key-derivation input,
   not from being secret or random).

Two calls to the key-derivation function with the SAME bitstring always
compute the SAME salt, and therefore the SAME PBKDF2 output, and therefore
the SAME AES-GCM key.

**Cipher.** AES-256-GCM (AES-GCM, 256-bit key — the key derived above).

**IV.** 12 bytes (the standard 96-bit GCM nonce size), generated fresh via
`crypto.getRandomValues` on EVERY encrypt call — never reused across files,
even though the same derived key is reused across every file in one upload
action. IV length and freshness match `@stoachain/stoa-core/crypto`'s own V2
cipher.

**Pre-encryption encoding and byte layout.** For one file's raw bytes, the
exact sequence that produces the bytes actually posted to chain is:

1. Base64-encode the file's raw bytes (standard alphabet).
2. UTF-8-encode that base64 STRING into bytes.
3. AES-256-GCM-encrypt those bytes under the derived key with a fresh
   12-byte IV, producing `{ ciphertext, iv }`.
4. Compose the final posted bytes as **IV prepended to ciphertext**: a
   single byte buffer of length `iv.byteLength + ciphertext.byteLength`,
   with the 12 IV bytes first, immediately followed by the ciphertext bytes
   — no separator, no length prefix, no additional envelope.

Decrypting is the exact inverse, in reverse order: split off the leading 12
IV bytes, AES-256-GCM-decrypt the remainder under the same derived key and
that IV (an auth-tag mismatch — e.g. decrypting under a key derived from a
DIFFERENT bitstring — throws rather than returning garbage plaintext),
UTF-8-decode the result back to the base64 string, then base64-decode that
string back to the file's original raw bytes.

**Future versions.** Version `1`'s decrypt logic must never be removed once
shipped — real uploaded data may depend on it forever. A future encryption-
procedure change ships as a new `## Version N` subsection here, a bumped
`CODEX_ENCRYPTION_VERSION_CURRENT`, and a decrypt path that branches on the
posted `Codex-Encryption-Version` tag to run the correct historical
procedure, never only the current one.
