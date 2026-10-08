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

## 4. The codex-backup dual-key envelope procedure (`Codex-Backup-Encryption-Version`)

A codex-backup upload (`Codex-Category: codex-backup`) is encrypted under a
genuinely different, independently-versioned procedure from §3 above —
`Codex-Backup-Encryption-Version` is a SEPARATE axis from
`Codex-Encryption-Version`, protecting a different payload shape (a whole
codex export, not one file) with a different goal (hiding the export's
*shape* — field names, keyring counts — not just its values, which were
already ciphertext under the codex's local password even before this
procedure existed). Grounded directly against
`packages/codex-arweave/src/crypto/backupEnvelope.ts`,
`packages/codex-core/src/codex/backupReencryption.ts`, and
`packages/codex-arweave/src/library/flow.ts`'s `backupCodexToLibrary`/
`restoreCodexFromBackupEnvelope` (read directly while writing this
section), in enough detail to reimplement the whole scheme from this
document alone.

### Version 1

`Codex-Backup-Encryption-Version: "1"` identifies the following scheme.

#### The two DEKs

A fresh, random 256-bit AES-GCM key (`crypto.subtle.generateKey`,
extractable) is generated TWICE, per upload, independently — never the same
key for both roles:

- **IDEK** ("internal DEK"): re-encrypts every one of the export's three
  documented secret-ciphertext fields (`arweaveSeeds[].secret`,
  `foreignKeys.keys[].encryptedKeyfile`, `pureKeypairs[].encryptedPrivateKey`
  — `IMPORT_EXPORT_CONTRACT.md` §2) from "ciphertext under the codex's local
  password" to "ciphertext under the IDEK." After this step the export needs
  nothing but the IDEK to decrypt its individual secret fields — never the
  codex password again, at any point, forever.
- **EDEK** ("external DEK"): encrypts the WHOLE resulting (IDEK-reencrypted)
  export JSON string, ONCE MORE, as a single opaque blob. This is what hides
  the export's shape: the bytes actually posted to chain are undifferentiated
  ciphertext — no field name, no array length, nothing about structure
  survives (`JSON.parse` on the posted bytes throws).

Neither DEK is ever discarded: each is immediately WRAPPED (encrypted, under
one or more real keys — see below) and the wrapped result stored as a small
tag alongside the upload. This is the standard envelope-encryption pattern:
one copy of the (potentially large) content, arbitrarily many small
wrapped-key tags, one per recognized unlock path.

#### Step-by-step wrap order (backup time)

1. Generate IDEK, generate EDEK (two independent `generateDek()` calls).
2. For each of the three documented secret fields present in the export:
   decrypt its existing ciphertext under the codex's current local password
   (the same cipher the field was already encrypted with), then
   AES-256-GCM-encrypt the resulting plaintext under the IDEK (plain
   already-raw-key AES-GCM, `encryptWithDek` — no PBKDF2/derivation step;
   see §3's own "two genuinely different operations" distinction, which
   applies here identically: wrapping a DEK is password-shaped cipher use,
   encrypting CONTENT under an already-raw DEK is plain AES-GCM). Write the
   result back in place, in the SAME field path, so the export's shape is
   otherwise completely unchanged (`reencryptBackupSecretFields`,
   `codex-core`'s own sanctioned field-transform — the only function
   permitted to walk these three field paths, per `IMPORT_EXPORT_CONTRACT.md`
   §1's "never hand-parse" rule).
3. AES-256-GCM-encrypt the WHOLE resulting (IDEK-reencrypted) export JSON
   string, as raw UTF-8 bytes, under the EDEK — one single opaque blob.
4. Byte layout for BOTH step 2's per-field ciphertext and step 3's whole-blob
   ciphertext (the SAME layout, reused at two different "layers"): a fresh
   12-byte AES-GCM IV (`crypto.getRandomValues`, never reused), AES-GCM-
   encrypt, then compose `IV (12 bytes) ‖ ciphertext`, base64-encode the
   whole combined buffer (standard alphabet). This is the posted/stored
   STRING form in every case.
5. Wrap both DEKs under each wrap source actually in use for this upload
   (see "Wrap sources" below) — producing that source's two wrapped-key
   tags (one for IDEK, one for EDEK).
6. Post the step-3 opaque blob (the base64 string from step 4, UTF-8-encoded
   to bytes) as the upload's data payload, `Content-Type: application/json`,
   `Codex-Category: codex-backup`, together with every wrapped-key tag from
   step 5 plus `Codex-Backup-Encryption-Version: "1"` and `Codex-Form-Version`
   (carrying `@ancientpantheon/codex-core`'s real `CODEX_FORM_VERSION`
   constant — the product-facing "shape of the codex" version, NOT a
   timestamp; a prior, now-removed convention derived this tag from the
   export's `lastUpdatedAt`, which answered "when," not "what shape").

#### Wrap sources

Wrapping a DEK means: export its raw 32 bytes (`crypto.subtle.exportKey
("raw", dek)`), base64-encode them into a plaintext string, and encrypt that
STRING via the injected `CryptoSeam` (the real PBKDF2-SHA512/600k-iteration
AES-256-GCM V2 envelope, `encryptStringV2`/`smartDecrypt` — the same cipher
§3 above and `accountKeyCipher.ts` already use) keyed by a password-shaped
string specific to the wrap source below. Unwrapping is the exact inverse:
seam-decrypt the wrapped string back to the base64 plaintext, base64-decode
it, re-import the raw bytes as an AES-256-GCM `CryptoKey`.

**Two DEFAULT sources, always present unless that source is PIN-protected
instead (see below) — EITHER alone is sufficient to restore (deliberate OR
redundancy, an explicitly accepted tradeoff: whichever secret is weaker
becomes the effective protection level):**

1. **Master Seed** — the Prime Arweave seed's raw 1600-bit `"0"`/`"1"`
   canonical bitstring, interpreted as an unsigned big-endian binary integer
   ("the scalar": `BigInt("0b" + bitstring)`).
2. **Standard Apollo** — the Codex Identity's Standard half's raw 1024-bit
   `"0"`/`"1"` canonical bitstring (APOLLO's own S=1024 width), the SAME
   scalar interpretation, independently.

For EACH of the two sources above, the SAME scalar is wrapped under TWO
different string spellings, one per DEK — different spellings of the same
number are different strings to the cipher, so they produce different
wrapped ciphertext even though they protect the same underlying value:

- `base49(scalar)` (the same 49-character alphabet as
  `@ouronet/dalos-crypto/gen1`'s `bigIntToBase49`, positional,
  most-significant-digit-first, no padding, `0n → "0"`) wraps the **IDEK**.
- `base10(scalar)` (`scalar.toString(10)`) wraps the **EDEK**.

This yields exactly 4 wrapped-key tags when BOTH default sources are in
play (2 sources × 2 DEKs), carried as:

| Tag name | Wraps | Source | Scalar spelling |
|---|---|---|---|
| `Codex-Backup-IDEK-MasterSeed-Default` | IDEK | Master Seed | `base49(scalar)` |
| `Codex-Backup-EDEK-MasterSeed-Default` | EDEK | Master Seed | `base10(scalar)` |
| `Codex-Backup-IDEK-StandardApollo-Default` | IDEK | Standard Apollo | `base49(scalar)` |
| `Codex-Backup-EDEK-StandardApollo-Default` | EDEK | Standard Apollo | `base10(scalar)` |

**The Arweave-PIN wrap path — a STRICTLY OPT-IN third option, per source,
MUTUALLY EXCLUSIVE with that source's own Default pair:**

A user may additionally (or instead) protect either default source with a
PIN: a 6-to-15-digit numeric string (6 is the brute-force-cost floor the
design accepts — ~78 days of continuous ~6.7s-per-guess RSA-4096 keygen at
worst case, ~21 years at 8 digits; 15 is the ceiling, one digit short of
`Number.MAX_SAFE_INTEGER`'s own 16-digit boundary so a maximal PIN still
parses to an exact integer with zero floating-point precision loss). PIN
shape is validated BEFORE any keygen is attempted — a real RSA-4096
keygen-at-position costs ~6.7s per key, and the underlying primitive always
force-generates index 0 alongside whatever position is requested (so ~13.4s
per call), making cheap validation-first mandatory.

Deriving the keygen position from the PIN: `position = 1 + (Number(pin) %
RSA4096_MAX_INDEX)`, where `RSA4096_MAX_INDEX = 0xffffffff` (the
`@ouronet/dalos-crypto/rsa4096` keygen-at-position primitive's own uint32
index ceiling). The `+ 1` guarantees the result is NEVER `0` — index 0 is
the seed's already-PUBLIC primary address, and a PIN reducing to it would
silently defeat that PIN's own secrecy entirely. (Two different PINs
reducing to the same non-zero position does not weaken either PIN's
brute-force resistance — the ~6.7s cost is paid once per PIN VALUE an
attacker tries, not once per distinct position.)

An RSA-4096 keypair is then derived at that position from the SAME source
bitstring (Master Seed's or Standard Apollo's), via the existing
Worker-wrapped keygen-at-position primitive (`runSeededBatch` /
`generateFromBitStringAtRangesAsync`) — never a main-thread RSA call. The
keypair's CRT primes wrap the two DEKs (the SAME `wrapDekWithScalar`/
`unwrapDekWithScalar` functions as the default path — a JWK prime string
fits their `scalarString` input as-is, no separate "wrap with a raw bigint"
function needed):

- `p` (the keypair's first CRT prime, as its base64url JWK string encoding)
  wraps the **IDEK**.
- `q` (the second CRT prime, same encoding) wraps the **EDEK**.

**Mutual exclusivity (the single most safety-critical property of this
path):** when a source is PIN-protected, that source's `...-Pin` tag pair
is posted and its `...-Default` pair is NEVER also posted — an unprotected
default sitting alongside a PIN'd wrap would defeat the PIN entirely. The
OTHER source (if used at all) is completely independent and may be
PIN-protected, left at its default, or (in a future, not-yet-built variant)
omitted — each source's choice is made separately. The 4 sibling PIN tag
names (replacing their `-Default` counterpart one-for-one, per source, when
that source is PIN'd):

| Tag name | Wraps | Source | Prime |
|---|---|---|---|
| `Codex-Backup-IDEK-MasterSeed-Pin` | IDEK | Master Seed | `p` |
| `Codex-Backup-EDEK-MasterSeed-Pin` | EDEK | Master Seed | `q` |
| `Codex-Backup-IDEK-StandardApollo-Pin` | IDEK | Standard Apollo | `p` |
| `Codex-Backup-EDEK-StandardApollo-Pin` | EDEK | Standard Apollo | `q` |

Exactly 4 wrapped-key tags are posted on any upload either way — 2 per
source, Default-or-Pin, never both for the same source, never 8.

#### Restore routing (tag-presence-based, never a failed blind attempt)

Because each source has two DISTINCTLY-named tag pairs rather than one,
whether a PIN is needed is known from tag PRESENCE ALONE, before any
unwrap/keygen is even attempted — checking the IDEK tag name is sufficient
(the EDEK tag of the same pair is always present alongside it, by the
mutual-exclusivity guarantee above, on any upload this scheme itself
produced):

1. That source's `...-Default` IDEK tag is present → unwrap directly with
   the default scalar spellings; no PIN is ever asked.
2. `...-Default` is absent, that source's `...-Pin` IDEK tag is present →
   a PIN is known to be needed; prompt for it now, then derive the RSA
   keypair at its position and unwrap with `p`/`q`.
3. Neither tag is present → this source was simply never used to wrap this
   particular upload; tell the restorer plainly (try the other source)
   rather than leaving them on a silent/ambiguous failure.

#### Restore order (the exact inverse of the wrap order)

Given a candidate source's bitstring (and its PIN, if routing step 2 above
applies):

1. Resolve the unwrap key material for the chosen route — the default
   scalar's `base49`/`base10` spellings, or the PIN-derived keypair's `p`/`q`.
2. Unwrap the EDEK tag, then the IDEK tag, via the seam's decrypt direction
   (a wrong bitstring or wrong PIN fails loudly here — an AES-GCM auth-tag
   mismatch or the V2 cipher's own wrong-key failure, never a
   plausible-looking wrong success).
3. Base64-decode the posted opaque blob, split off its leading 12-byte IV,
   AES-256-GCM-decrypt the remainder under the unwrapped EDEK — recovering
   the IDEK-reencrypted export JSON string.
4. For each of the three documented secret fields present: base64-decode,
   split IV, AES-256-GCM-decrypt under the unwrapped IDEK (the SAME byte
   layout as step 3, a different "layer") — recovering the field's TRUE
   plaintext, with no password of any kind involved at any point in this
   whole restore procedure.
5. The result is the fully plaintext codex export JSON. From here, restore
   hands off to the existing "prompt for a brand-new password, encrypt
   locally, inject into the browser" step — the old, now-fully-removed
   password ciphertext is never reconstructed and never reused as the
   go-forward password.

#### Degrade path

A codex that is not ELIGIBLE for this scheme at all (no Prime Arweave seed
sharing origin words with Prime Ouronet — `checkArweaveRestoreEligibility`)
simply never has its backup action invoked with this envelope's 4 required
inputs (`codexPassword`, the Master Seed bitstring, the Standard Apollo
bitstring, a `CryptoSeam`) — there is no degraded/partial envelope mode; an
ineligible codex's backup path is gated entirely upstream of the upload
function itself, never silently downgraded to an unwrapped, partially
wrapped, or wrong-but-claimed-successful upload.

#### The now-fully-removed prior mechanism

This version-1 envelope REPLACES, outright, the previous
`Codex-Backup-Recovery-Key` tag (which encrypted the codex's local password
under the Prime Arweave seed's key and tagged it alongside the backup). No
real backup was ever made under that mechanism, so there is no
backward-compatibility reader for it — a codex-backup upload NEVER carries
a `Codex-Backup-Recovery-Key` tag under this or any later version.

**Future versions.** Version `1`'s unwrap/decrypt logic must never be
removed once shipped. A future envelope-procedure change ships as a new
`## Version N` subsection here, a bumped
`CODEX_BACKUP_ENCRYPTION_VERSION_CURRENT`, and a restore path that branches
on the posted `Codex-Backup-Encryption-Version` tag to run the correct
historical procedure, never only the current one.
