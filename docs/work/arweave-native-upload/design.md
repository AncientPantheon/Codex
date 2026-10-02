# Arweave Native Upload & Data Foundation — Design

Topic 1 of the `arweave-upload-library` project
(`docs/work/arweave-upload-library/design.md`). Topic 2 (the PermaLibrary
browser) is shaped separately, after this is approved and consumes what this
topic produces.

**Approved in full — this document is the standing reference for every
decision below.** At planning time this topic itself proved too large for a
single plan (the plan skill's own escalation rule: more than ~10 tasks or 3
waves means split, not cram). Nothing below changes as a result — this is a
sequencing decision, not a design revision. It's broken into four
build-order sub-topics, each with its own short design.md that points back
here for full rationale rather than repeating it:

## Topics

1. `arweave-native-bundle` — §1 (native upload, no Turbo) + the
   schema-versioning/upload-grouping/item-type slice of §2's tag schema.
   Public uploads only; no categories or encryption yet. The foundation
   everything else attaches to.
2. `arweave-upload-categories` — the rest of §2 (the full category
   taxonomy, provenance edge cases, `codex-backup` special handling) + §2a
   (app-version lineage tags) + mandatory-category upload UI. Depends on
   Topic 1's tag-versioning scaffold.
3. `arweave-upload-encryption` — §3 (Ouronet-account-keyed encryption) +
   the `Codex-Encrypted`/`Codex-Encryptor` tags + encrypted-upload UI +
   decrypt-on-download and retroactive-add from §4. Depends on Topics 1–2.
4. `arweave-account-safety` — §5 (non-removable-account invariant) + §6
   (session safety: `dirty` reminder, `beforeunload`, `requestLogout`,
   `SESSION_LIFECYCLE_CONTRACT.md`). Depends on Topic 3 (the local flag is
   set by the encryption flow).

Topic 1 is shaped below (already covered by this document) and planned next.

## Problem

`docs/Codex-Arweave-Upload-Handoff.md` asks Codex to become a real Arweave
uploader: single file / multiple files / a whole folder, uploaded as one
atomic, natively-paid transaction, public or encrypted, with a per-account
Library of direct + download links.

A partial pass already shipped (git: "E1-E3 — Arweave keyring + signer/send +
upload/library/rebuild", "E4: Foreign-Chains tab + Arweave panel") and was
then explicitly parked ("no further investment — mount as-is") in
`docs/work/codex-class-ia-arweave/design.md`. What exists today:

- Upload goes through **Turbo**, a third-party bundler service
  (`@ardrive/turbo-sdk`, `upload.ardrive.io`) — not the self-posted native L1
  payment the handoff requires.
- **Single file only.** No multi-file/folder bundling, no manifest. `arbundles`
  isn't installed anywhere; only `arweave` (arweave-js) is.
- **No encryption anywhere.** The Library is explicitly, deliberately
  public-metadata-only by design ("no key material, no ciphertext, no
  password... deliberately NO field for a secret").
- **No categorization** — nothing distinguishes an NFT asset from a personal
  photo from a legal document, and the tag schema has no version marker, so
  there's no defined way to add fields later without guessing what old
  uploads do or don't have.
- No non-removable-account invariant — `deleteOuroAccount` only guards the
  Prime account; every other account is unconditionally deletable today, with
  no awareness that an account might have permanent on-chain ciphertext
  depending on it.
- No retroactive "add an existing upload to my Library" path.
- No save-reminder / logout-awareness system beyond a raw `dirty` boolean
  that a couple of panels passively render as "· Unsaved" text.

This topic covers replacing the upload path, adding encryption keyed to an
Ouronet account, a versioned + categorized tag schema, hardening account
deletion against orphaning permanent ciphertext, and the session-safety layer
that makes all of this safe to use without forcing a scary blocking warning
on every exit.

## Approach

### 1. Native upload, no third-party bundler

Replace Turbo entirely with native `arweave-js` + `arbundles`: build data
items per file, sign, compute deterministic post-sign ids, build an
`arweave/paths` manifest referencing those ids, bundle everything
(`bundleAndSignData`), wrap as one L1 transaction, and post it — paid from
the user's own AR balance, signed by the same Arweave key already custodied
today for `SendArweaveModal`'s transfers (`decryptArweaveKey`, unlock-gated,
encrypted at rest). One upload action = one atomic bundle = one payment, for
1 file or 1,000.

*Alternative rejected:* keep Turbo and layer multi-file/encryption on top —
rejected because it keeps a third-party dependency the owner explicitly
doesn't want, and native bundling is required anyway for folders, so there's
no work saved by keeping both paths.

### 2. Tag schema — versioned, extended (not replaced), and categorized

**Versioning.** Every upload carries a `Codex-Tag-Schema-Version` tag
(currently `"1"`). It bumps only when a *required* tag's shape or meaning
changes — adding a new *optional* tag is never a version bump. Every reader
(rebuild, Library, decrypt) branches on this version and treats a missing
optional tag as "unset," never as an error — an upload made by an older
Codex must always keep working in a newer one.

**Existing tags, unchanged.** `App-Name` (`"AncientPantheon-Codex"` — already
the "made by Codex" marker on every upload, nothing new needed here),
`Content-Type`, `Codex-Item-Id`, `Codex-Owner`. These stay exactly as they
are — they're the GraphQL rebuild anchor today and must keep working
unmodified.

**New tags this pass:**
- `Codex-Tag-Schema-Version` — see above.
- `Codex-Upload-Id` — groups N files + a manifest from one upload action into
  one addressable unit.
- `Codex-Item-Type` — `file` | `manifest`.
- `Codex-Encrypted` — `true` | `false`.
- `Codex-Encryptor` (encrypted uploads only) — the **public address** of the
  Ouronet account that did the encrypting. Never key material, per the
  handoff's own tag-permanence rule. Independent of `Codex-Owner`: the
  Arweave account that *paid for and posted* the transaction and the Ouronet
  account that *encrypted* it are two separate identities — an upload can be
  posted by Arweave Account X and encrypted by Ouronet Account Y.
- `Codex-Category` — see taxonomy below.
- `Codex-Asset-Type` (only present when `Codex-Category` is `nft-data`) — one
  of the same 7 values OuronetUI's NFT viewer already uses for
  `asset-type` (`image` / `audio` / `video` / `document` / `archive` /
  `model` / `exotic`), so an NFT-tagged Arweave upload already carries the
  exact classification OuronetUI's NFT system expects, without a translation
  layer, should a future "mint an NFT backed by this upload" feature want it.

**Reserved-namespace discipline.** All `Codex-*` tag names above join the
existing reserved set `buildUploadTags` already enforces (no app-metadata
entry may reuse a required name). This is what keeps the door open for a
future, out-of-scope Email/Chat-style layer to add its own tags (`To`,
`From`, `Subject`, thread ids, ...) on the same storage primitive without
ever colliding with Codex's own.

**Category taxonomy (`Codex-Category` values), v1:**

| Group | Categories |
|---|---|
| Personal | `personal-photos`, `personal-videos`, `personal-audio`, `journals-writing`, `personal-documents`, `medical-records` |
| Financial & Legal | `financial-records`, `legal-records`, `certificates-credentials` |
| Creative & Professional | `creative-work`, `nft-data`, `software-code`, `website-dapp-hosting`, `research-data`, `publications-books` |
| Public / Web3-native | `public-statement`, `proof-timestamping` |
| Legacy & Family | `memorial-legacy`, `historical-archive`, `genealogy-family-history` |
| Correspondence | `correspondence-archive` (a plain archived email/letter export — *not* an email engine; see Out of scope) |
| Gaming | `gaming-virtual-assets` |
| Events | `event-records` |
| Codex | `codex-backup` — special handling, see below |
| Fallback | `general-other` (a deliberate, consciously-chosen catch-all) |

**Category selection is mandatory at upload time** — no upload completes
without one of the values above actively chosen; there is no silent
"uncategorized" default. `general-other` still exists, but as a conscious
pick for genuine edge cases, not a default nobody chose.

This list is a curated, Codex-owned enum, not free text — free text
fragments ("family photos" vs "Family Photos" vs "pics") and defeats
categorized browsing. It's additive-extensible under the same versioning
rule as any other tag: a category added in a later Codex version is just
another valid string value, and an older Codex reading it displays the raw
value rather than a friendly label instead of erroring or hiding the entry.

**Two provenance edge cases, both distinct from the enum above and neither
ever written as an on-chain tag value:**
- **Legacy-uncategorized** — a genuine Codex upload (its `App-Name` tag
  matches) made before `Codex-Category` existed. It has no category tag at
  all, permanently (tags can't be retrofitted onto posted data) — the
  Library shows these in a local "Needs categorizing" grouping, never
  mistaken for a real category.
- **`foreign`** — *is* a real category value, but reserved specifically for
  retroactive-add: an on-chain item the user chose to track that does **not**
  carry Codex's own `App-Name` tag at all. Rather than guess a content
  category for something Codex didn't create, it's marked `foreign` —
  provenance, not content type.

**`codex-backup` — special handling, not a normal upload.** This category
exists for backing up the codex's own encrypted export to Arweave — directly
solving the "remember to save your codex" problem from a different angle: a
real, permanent, off-device backup instead of relying on the user
remembering to download a file.

- **The payload is the codex's existing encrypted export as-is** — the same
  ciphertext `smartEncrypt`/the V2 cipher already produces for a normal
  backup download. This does **not** additionally pass through this
  feature's Ouronet-account encryption layer — doing both would mean needing
  *both* the codex password *and* a specific unlocked Ouronet account to ever
  recover it, which is more fragile, not more secure. A `codex-backup` entry
  is therefore posted through the "public" (no additional encryption) path,
  `Codex-Encrypted: false` — "public" here describing this feature's
  handling, not the payload's actual readability, which is still fully
  governed by the codex password.
- **A materially bigger warning than the standard per-upload permanence
  notice is required before this specific action.** The risk isn't "one file
  leaked" — it's "whatever the codex password is *at the moment of this
  upload* is now the only thing protecting the whole codex's plaintext,
  forever, with no rotation or revocation possible once posted." The confirm
  dialog for this category must say so explicitly, distinctly from
  `UPLOAD_PERMANENCE_WARNING`.
- **Successfully posting a `codex-backup` clears the `dirty` flag**, exactly
  like a local save/download does (§6) — it's a legitimate save, not a
  bypass of the save-reminder system.

### 2a. App/website version lineage

Two more tags, orthogonal to category (most relevant to `software-code` and
`website-dapp-hosting`, not restricted to them): `Codex-App-Id` — a stable
identifier the user sets once and reuses across every subsequent upload of
the *same* app/site, so versions are linkable — and `Codex-App-Version` — a
free-text version label on that specific upload (`"1.0.0"`, a date, whatever
the user wants; not semver-enforced).

This is **not** mutable versioning — nothing here edits or replaces existing
data (still correctly out of scope, see below). Every version is its own
separate, permanent, immutable upload; these two tags only make them
linkable into a lineage. This mirrors how Arweave-hosted apps already work
in the wild in practice — a fresh immutable manifest per deploy, with a
separate naming layer (e.g. ArNS) optionally pointing a human-readable name
at the current one. ArNS-style "latest version" pointing is a natural future
extension and stays out of scope here, but this tag design doesn't block it.
Rendering an app's version timeline is a Topic 2 (browsing) concern; this
topic only defines the tags that make it possible.

### 3. Encryption — reuse the existing V2 cipher, keyed by an Ouronet account

Ouronet accounts are DALOS keys: a 1600-bit private-key scalar, always
available in three equivalent text spellings (`bitString` / `int10` /
`int49`) on the same `FullKey` object regardless of which of the six
generation paths produced it. Rather than a new envelope/KEK scheme:

- Reuse `encryptStringV2` / `smartDecrypt` verbatim — the exact
  PBKDF2-SHA512(600k) → AES-256-GCM cipher already protecting every other
  secret in the codex (every account's `secret`, every seed, every foreign
  key). This *is* "Ouronet's own encryption method."
- Key the cipher with the selected account's private key, **always
  normalized to its `bitString` form first** — the three spellings are one
  number, not three keys, so normalizing to one canonical spelling before
  the KDF guarantees an account decrypts its uploads correctly no matter
  which input path originally created it.
- Derive the AES key **once per upload action**, not once per file — PBKDF2
  at 600k iterations is deliberately expensive, and a folder of hundreds of
  files re-running it per file would add real, avoidable delay. Same cipher
  math, factored so the costly step runs once.
- Default encrypting account: the codex's Prime Ouronet account (already
  permanently non-removable for unrelated reasons — the safe default). The
  user may pick any other Ouronet account already in the codex instead.

*Alternatives rejected:* true asymmetric encryption via an ed25519→X25519
conversion — rejected, nothing here needs a third party to encrypt *to* an
account without that account being unlocked; `@ouronet/dalos-crypto/gen1`'s
AES module — rejected, its own doc header says it's a legacy CLI-only format
("NOT used by the Ouronet UI"), bitstring-oriented with a documented
leading-zero-byte loss unsuited to arbitrary binary file content; a new
envelope/wrapped-DEK scheme — rejected as unneeded complexity once the KEK
*is* an already-custodied, already-backed-up account key rather than
something new to escrow.

### 4. Library data model — disposable cache, metadata-list shape, extended

The existing architecture already gets two things right and neither changes:
the Library was never part of the codex JSON snapshot (so it can never
"bloat the codex," regardless of upload volume), and it's already fully
reconstructable from chain via GraphQL tag queries. It remains exactly that —
a responsiveness cache whose only job is showing an upload as `pending`
before GraphQL has indexed it, never a source of truth, never something that
needs saving or backing up.

Every entry gains the new tag fields above (`category`, `encrypted`,
`encryptor`, `uploadId`, `itemType`, `schemaVersion`) so Topic 2 can build
Public/Private-first, multi-account, category-filtered browsing without
another schema pass. **This topic does not build that browsing UI** — today's
single-owner `list(owner)`/`rebuildLibrary(owner)` stay as they are here;
Topic 2 owns extending the query surface to aggregate across every Arweave
account the codex holds. What this topic does add:

- **Download button per entry.** Public entries download directly; encrypted
  entries fetch ciphertext, look up the tagged encrypting account, and
  decrypt on the spot if that account is present and unlocked.
- **Retroactive add.** A user pastes/selects a data-item or manifest id;
  Codex fetches its tags from chain, verifies they belong to an account the
  user actually holds, and inserts it into that account's Library — for
  uploads made elsewhere, or made locally but never confirmed into this
  device's cache.
- **Manifest privacy:** folder/file structure and filenames stay **public**
  even for encrypted uploads — only file contents are encrypted. Keeping the
  manifest itself public means gateways can still resolve
  `.../manifest-id/path/to/file` natively; encrypting the manifest too would
  mean Codex resolving every path itself for no privacy benefit anyone
  asked for.
- **Metadata rows, not a media gallery.** An entry is filename / category /
  date / size / status / account(s) plus Open (public: direct gateway link,
  rendered natively by the browser) / Download (private: decrypt then hand
  off the file) — never an inline thumbnail, player, or custom viewer. See
  Out of scope.

### 5. Non-removable-account invariant — hybrid, never network-blocking

`deleteOuroAccount` gains a second guard, alongside the existing Prime-only
one:

- **Primary gate — a local flag**, set the instant an account first encrypts
  a confirmed upload. Checking it is instant, offline, and has zero
  dependency on Arweave being reachable — this is the path that runs on
  every normal delete attempt.
- **Safety net — a chain query**, run only when the local flag is *absent*
  (the gap case: this device never recorded the flag — a different device
  did the encrypting, or the local session ended before it was saved). If
  the chain shows a confirmed encrypted upload tagged to this account, the
  delete is blocked exactly as if the local flag had been set.
- **Escape hatch — an explicit, off-by-default codex setting** ("allow
  deleting Ouronet accounts without the Arweave safety check," strongly
  worded, not recommended) so a delete can never be held hostage by Arweave
  being unreachable for a user who's made an informed choice to skip the
  network check entirely.

*Alternatives rejected:* chain-query-only — rejected, makes every account
deletion hard-depend on network reachability, which the owner explicitly
ruled out; local-flag-only — rejected, reintroduces exactly the
never-saved/cross-device orphaning risk the chain query exists to catch.

### 6. Session safety — reusing existing `dirty` infrastructure, not building new

`codex-ouronet`'s store already has a `dirty` flag flipped on every mutation
(including, automatically, the moment the non-removable flag above gets
set), an `onCodexDirty` hook already fired by `CodexProvider`, and passive
"· Unsaved" text in a couple of existing panels. What's added is the active
layer:

- **`beforeunload` handled entirely by Codex itself**, no host cooperation
  needed — Codex attaches this the moment it mounts in a browser and checks
  its own `dirty` state. This alone covers "closed the tab without saving"
  unconditionally, regardless of which app embeds Codex.
- **A `requestLogout(hostLogoutFn)` wrapper Codex exposes.** Codex cannot
  own a host app's actual "Log out" button (it doesn't own their navigation
  or auth session) — but a host's logout handler can call
  `codex.requestLogout(realLogoutFn)` instead of calling `realLogoutFn`
  directly; Codex checks its own state, shows its own warning if needed, and
  only invokes the host's real logout once it's safe (or overridden). This
  is documented as the one sanctioned integration point, not silently
  assumed to be used correctly — see below.
- **An opt-out, default-on periodic reminder popup** nudging the user to
  save when `dirty` has been true for a while.

All of this is written into a new `SESSION_LIFECYCLE_CONTRACT.md`, shipped
inside the published package alongside `IMPORT_EXPORT_CONTRACT.md`, same
reasoning: a single authoritative doc any implementer (human or agent) hits
before wiring logout/save-reminder behaviour, rather than tribal knowledge
that gets silently reinvented per host app.

## Acceptance criteria

- [ ] A user can upload a single file, multiple files, or a folder (with
      subfolders) as one atomic native-Arweave bundle paid from their own
      custodied AR balance — no third-party bundler service is involved at
      any point.
- [ ] A user can choose public or encrypted mode per upload, and must
      actively choose a category from the v1 taxonomy — no upload completes
      with no category chosen; encrypted mode lets them pick which Ouronet
      account encrypts it (default: Prime), and only ciphertext plus public
      tags reach the chain — never plaintext, never key material.
- [ ] Retroactively adding an on-chain item that doesn't carry Codex's own
      `App-Name` tag files it under `foreign`, never a guessed content
      category.
- [ ] A user can back up their codex's existing encrypted export to Arweave
      under the `codex-backup` category; doing so shows a distinct,
      stronger warning than the standard upload-permanence notice (the
      current codex password becomes permanently locked-in for that
      backup), and a successful post clears the `dirty` flag.
- [ ] Two uploads sharing the same `Codex-App-Id` are linkable as versions of
      the same app/site via `Codex-App-Version`, without either upload
      mutating or replacing the other.
- [ ] Every upload carries `Codex-Tag-Schema-Version`, and an entry missing a
      tag a later version introduced still loads and displays without error.
- [ ] The Library lists every upload for a given account newest-first, shows
      pending vs. confirmed status, shows its category, and every entry has
      a direct link plus a download action that decrypts on the spot for
      encrypted entries using the tagged encrypting account — as a metadata
      row, never an inline thumbnail or media player.
- [ ] Deleting a non-Prime Ouronet account that has ever encrypted a
      confirmed upload is blocked by default; the block resolves instantly
      offline when the local flag is set, and falls back to a chain check
      only when it isn't. An explicit, off-by-default setting can bypass the
      chain check (never the local flag) with a clear warning.
- [ ] A user can manually add an existing on-chain upload (by id or manifest
      id) into their Library, and it is tag-verified before being accepted.
- [ ] Closing the browser tab with unsaved changes triggers Codex's own
      warning regardless of which app embeds it; a host that routes its
      logout button through `requestLogout()` gets the same protection on
      logout too.
- [ ] An opt-out, default-on reminder periodically nudges the user to save
      the codex while changes are unsaved.
- [ ] Wiping the Library store and rebuilding from chain reproduces the same
      list — the Library never needs to be backed up itself.
- [ ] `SESSION_LIFECYCLE_CONTRACT.md` ships in the published package and
      documents `requestLogout()`, the `dirty` signal, and the reminder
      setting.

## Out of scope

- Running a public bundler-as-a-service for third parties.
- Mutable file versioning / rename-in-place.
- Fiat or alt-token payment — native AR only.
- True asymmetric (encrypt-to-an-account-without-unlocking-it) encryption.
- **An Arweave-native email/chat engine** (the Weavemail-style precedent).
  This is a protocol-level product (addressing another person, inbox/outbox,
  threading) on top of this storage layer, not a category inside it. The
  `correspondence-archive` category covers passive archiving of an exported
  email/letter only; the reserved-tag-namespace discipline in §2 keeps this
  door open for a real future layer without extra work now.
- **The PermaLibrary browsing experience itself** — Public/Private-first
  navigation, multi-account aggregation, category/filter/search UI,
  thumbnails-or-not decisions at scale, the full-page surface replacing
  today's embedded panel, and the product's own name/branding (candidates
  discussed: Kleos, Codex Aeternum — not yet decided; Mnemosyne ruled out,
  already used by the codex storage layer). All of that is Topic 2
  (`arweave-permalibrary`), shaped separately once this topic is approved.
- Extending the non-removable-account invariant to the separate Arweave
  "foreign keys" / pure-key RSA system (`deleteForeignKey` has the same
  unconditional-delete gap today, but the owner scoped this pass to Ouronet
  accounts specifically) — flagged as a related follow-up, not built here.
- A general retrofit of save-reminder UX across every existing mutation path
  in Codex — the mechanism is built generically, but this pass only wires it
  into the flows this feature actually introduces.
