# Codex Backup Envelope Encryption — Design

Topic 1 of `docs/work/codex-id-page/design.md`. Rebuilds how a codex-backup
upload is encrypted, replacing the password-recovery-tag mechanism built in
`codex-recovery-backup-tagging`/wired in `codex-seed-restore-activation`
with a proper dual-key envelope scheme — worked through in full across a
long, explicit design conversation with the owner before any of this was
written. No real codex-backup upload has ever been made under the old
scheme (confirmed with the owner), so this topic REPLACES it outright
rather than maintaining two reader paths.

## Problem

Three real gaps, found while preparing for the first real upload:

1. **Structure leaks even though values don't.** The current codex-backup
   upload posts the export JSON close to as-is — every secret *value*
   inside is already ciphertext (under the user's local password), but
   the JSON *shape itself* (field names, array lengths — "43 accounts, 10
   seeds") is plaintext-readable by anyone who finds the permanent,
   public transaction. Explicit owner requirement: "we won't be exposing
   how many seed words or addresses it holds."
2. **Recovery is tied to the wrong secret.** The existing
   `Codex-Backup-Recovery-Key` mechanism encrypts the user's *local,
   arbitrarily-chosen password* under the Prime Arweave seed's key and
   tags it alongside the backup — recoverable, but it means the backup's
   permanent copy still carries a dependency on a password the user chose
   outside the seed-words system. The owner's explicit requirement: "the
   seeds must be enough to access the codex" — nothing else, ever.
3. **The version tag is wrong.** `Codex-App-Version` on a codex-backup is
   currently derived from the export's `lastUpdatedAt` (a timestamp), not
   from `CODEX_FORM_VERSION` (`@ancientpantheon/codex-core`) — the actual
   product-facing "shape of the codex" version. A reader of the tag today
   learns *when* a backup was made, not *what shape* it's in.

## Approach

### The envelope: two DEKs, not one, not zero

A fresh, random 256-bit AES key is generated **per upload**, twice — an
**IDEK** (internal DEK) and an **EDEK** (external DEK). Neither is ever
discarded: each is immediately **wrapped** (encrypted, ~32 bytes) under
one or more real keys and stored as a small tag alongside the upload —
the standard "envelope encryption" pattern. A DEK is not optional
indirection here: it is what makes "more than one key independently
unlocks this backup" cheap — one copy of the (potentially large) codex
content, arbitrarily many small wrapped-key tags, one per recognized
unlock path, each addable later with zero change to anything already
uploaded.

- **IDEK's job:** every individual codex secret field (today ciphertext
  under the user's local password) gets decrypted with that local
  password (known, because the codex is unlocked at backup time) and
  **re-encrypted under the IDEK** instead. The resulting export is
  self-contained: unlocking the IDEK and decrypting the fields requires
  nothing but what the IDEK itself unlocks — never the user's local
  password, old or new, at any point.
- **EDEK's job:** the entire resulting (IDEK-re-encrypted) export JSON
  string is encrypted **once more, as one opaque blob**, under the EDEK.
  This is what hides the shape/structure/counts — the uploaded bytes are
  undifferentiated ciphertext, nothing about field names or array
  lengths survives.
- Restore order: unwrap the EDEK (via whichever key you have) → decrypt
  the blob → get the IDEK-re-encrypted export → unwrap the IDEK (same key
  path) → decrypt every field → full plaintext codex, in memory, **with
  no password of any kind consulted up to this point** → prompt for a
  brand-new password → re-encrypt locally → inject into the browser. This
  is the existing restore flow from `arweave-seed-restore/design.md`,
  with the password-recovery-tag step replaced by this envelope unwrap.

### Default wrap sources (v1 — what this topic builds)

Exactly two independent unlock paths, both present by default on every
eligible upload (an upload has BOTH wrapped-IDEK and wrapped-EDEK entries
for EACH path below — four small wrapped-key tags total):

1. **Master Seed** (the Prime Arweave seed's 1600-bit DALOS bitstring).
   `base49(scalar)` wraps the IDEK; `base10(scalar)` wraps the EDEK — two
   different string-representations of the same number, each dedicated to
   exactly one layer, through the existing V2 cipher convention
   (PBKDF2-SHA512/600k → AES-256-GCM, same as every other password-shaped
   key derivation in this project — `encryptStringV2`/`smartDecrypt`).
2. **Standard Apollo** (the Codex Identity's Standard half — NOT the Smart
   half, and NOT the two combined; see "Out of scope" for why). Same
   base49/base10 convention, its own independent pair.

Either path alone is sufficient to restore — this is deliberate OR
redundancy (lose the master words but still have your Codex Identity, or
vice versa), explicitly accepted by the owner as a security/convenience
tradeoff: whichever of the two secrets is weaker becomes the effective
protection level, since either one suffices. This was a conscious choice,
not a default to question.

### The Arweave-PIN wrap path (MOVED IN SCOPE for this build round —
previously drafted as v2/out-of-scope; owner decision 2026-10-08: build it
now, in this same construction round, alongside the default paths above)

A third, STRICTLY OPT-IN wrap source, per default source above (so up to
two additional wrapped-key pairs: Master-Seed-PIN, Standard-Apollo-PIN —
whichever default sources the user chooses to also PIN-protect): derive an
RSA-4096 keypair at a user-chosen position (the PIN itself — an integer
between 6 and 15 digits, deliberately avoiding 16 digits' exact-
`Number.MAX_SAFE_INTEGER`-ceiling edge case) instead of the scalar's
*default* position; use the keypair's `p` prime to wrap the IDEK and `q`
to wrap the EDEK — one PIN, one keygen, both layers covered, same
one-keygen-covers-both-DEKs economy as the default path's single scalar
covering both spellings.

**Mutual exclusivity, not additive, per source:** when a PIN path is used
for a given source (e.g. Master Seed), the corresponding DEFAULT (no-PIN)
wrap entry for that SAME source is NOT also created — an unprotected
default path sitting right alongside the PIN'd one would defeat the PIN
entirely. The OTHER source (if used at all) is independent and may or may
not itself be PIN'd — each source's PIN-or-default choice is made
separately.

**Real asymmetry, already reasoned through:** the Arweave-PIN path's
~6.7-second-per-guess RSA-4096 keygen cost gives genuine brute-force
resistance even at a 6-digit floor (worst case ~78 days of continuous
guessing; 8 digits ~21 years) — a real security property, not just an
inconvenience. (The Stoic-PIN variant — a StoaChain/chainweb derivation
with no equivalent per-guess cost — remains OUT of scope for this round;
it would need a materially higher digit floor or may not belong as a
security-grade option at all. Only the Arweave-PIN variant above is being
built now.)

Forgetting a PIN is exactly as catastrophic as forgetting the seed words
themselves — no recovery, ever. The PIN-entry UI must present this with
equivalent gravity, be strictly opt-in (never nudged-on, never a default),
and — since this is a UI surface attackers specifically target — should
be designed with keylogger/shoulder-surfing resistance in mind (e.g. a
randomized keypad layout) rather than a plain text input, though the exact
entry-UI mechanics are a build-time decision for whichever task implements
it, not fully pinned down here.

**Restore-routing mechanic (settled, not a build-time guess):** each
source needs TWO distinctly-named tag pairs, not one, so whether a PIN is
needed is known from tag presence alone, never discovered via a failed
decrypt attempt — e.g. `Codex-Backup-IDEK-MasterSeed-Default` /
`Codex-Backup-IDEK-MasterSeed-Pin` (the same split mirrored on the EDEK
side, and independently per source). Restore flow, after resolving typed
words down to a given source's scalar: (1) `...-Default` tag present →
unwrap directly, no PIN ever asked; (2) `...-Default` absent,
`...-Pin` tag present → prompt for the PIN now (known to be needed, not
guessed blind), derive the RSA keypair at that position, unwrap with
`p`/`q`; (3) neither tag present → this source was simply not used as a
wrap path for this particular upload at all — tell the user plainly
rather than leaving them on a silent/ambiguous failure.

### No eligibility bypass — this reuses, not replaces, the existing gate

Whether an upload gets this treatment at all is still gated by the
already-built eligibility detector
(`checkArweaveRestoreEligibility`/`ArweavePanelDeps.
checkArweaveRestoreEligibility`, `codex-seed-restore-activation`). An
ineligible codex (no Prime Arweave seed sharing origin words with Prime
Ouronet yet) cannot use this scheme — `legacy-prime-migration` is what
makes a codex eligible, unchanged by this topic. The already-built host
wiring that reveals `codexPassword`/`primeArweaveSeedBitstring`/a
`CryptoSeam` instance when eligible (`codex-seed-restore-activation` T3)
is still exactly the right set of inputs this new scheme needs — what
changes is what `backupCodexToLibrary` *does* with them internally (full
envelope re-encryption, not a single password-tagging step), not the
host-app-level wiring that supplies them.

### The version tag fix

`Codex-App-Version` stops being populated from `lastUpdatedAt`. A new,
correctly-named tag (e.g. `Codex-Form-Version`) carries
`CODEX_FORM_VERSION` (`@ancientpantheon/codex-core`) — the real
product-facing shape version, additively alongside (not replacing) a
clearly-named timestamp tag if one is still wanted for its own sake.

### Documentation and versioning

The entire procedure — both DEKs, both default wrap sources, the exact
wrap/unwrap order, the base49/base10 convention — gets published the same
way the existing file-encryption procedure already is
(`packages/codex/ARWEAVE_TAG_SCHEMA.md`'s "Encryption procedure versions"
section), under a new, dedicated version axis (e.g.
`Codex-Backup-Encryption-Version`), independent of the per-file
`Codex-Encryption-Version` already in use for regular uploads — these are
genuinely different procedures protecting genuinely different payloads,
and must be versioned separately so either can evolve without implying
anything about the other.

## Acceptance criteria

- [ ] A real codex-backup upload through an eligible codex posts a fully
      opaque blob — no field name, no account/seed count, nothing about
      structure is recoverable without unwrapping a DEK first.
- [ ] Restoring via the Master Seed's words alone succeeds with zero
      password of any kind (old or new) consulted before the final
      "set a new password" prompt.
- [ ] Restoring via the Codex Identity's Standard half alone (independent
      of the Master Seed) succeeds identically.
- [ ] The IDEK and EDEK are each freshly, randomly generated per upload —
      never derived, never reused across uploads.
- [ ] `Codex-Form-Version` (or equivalently named tag) on a codex-backup
      upload carries the real `CODEX_FORM_VERSION`, verified against the
      actual constant, not a timestamp.
- [ ] The old `Codex-Backup-Recovery-Key` mechanism is fully removed from
      the codex-backup upload path (not left as a parallel/fallback
      scheme) — confirmed via the owner that no real upload under the old
      scheme exists to stay backward-compatible with.
- [ ] Opting a source into Arweave-PIN protection at upload time posts the
      `...-Pin` tag pair for that source and NEVER also the `...-Default`
      pair for the SAME source (mutual exclusivity verified directly, not
      assumed) — the other (non-PIN'd) source, if used, is unaffected.
- [ ] Restoring via a PIN'd source with the CORRECT PIN succeeds; with the
      WRONG PIN fails loudly (never silently wrong); the restore flow
      knows whether a PIN is needed from tag presence alone, before ever
      prompting — never discovers the need via a failed blind attempt.
- [ ] The full procedure is documented, versioned, and shipped in
      `packages/codex/ARWEAVE_TAG_SCHEMA.md` (or a dedicated sibling
      doc), in enough detail to reimplement from the document alone.
- [ ] An ineligible codex's codex-backup upload behaves exactly as the
      pre-this-topic fallback (whatever that degrades to once the old
      recovery-tag mechanism is removed — ground this explicitly during
      planning, it must not silently produce a broken/unencrypted-wrong
      upload).

## Out of scope (still deferred — not this round)

- **Stoic PIN** (the StoaChain/chainweb-derivation PIN variant, as opposed
  to the Arweave-PIN/RSA-keygen variant now IN scope above) — no
  equivalent per-guess brute-force cost, needs its own security analysis
  before it could be offered as a security-grade option, TBD when shaped.
- **Smart Apollo "pause" authority.** The Codex Identity's Smart half is
  reserved for a higher-authority, separate mechanism (e.g. revoking the
  Standard half as a valid wrap source for *future* uploads) — explicitly
  NOT an access-granting wrap source itself, and explicitly incapable of
  retroactively protecting anything already uploaded (the permaweb has no
  revocation; "pause" can only ever be prospective). Not shaped yet.
- **Codex Identity (2048-bit combined Standard+Smart) as a direct RSA/
  seed-derivation source.** A real, partially-grounded idea (the
  underlying crypto library's allowed seed-bitstring lengths already
  include both 1024 and 1600 bits per existing code) but NOT verified for
  2048 bits specifically — must be confirmed against the actual library
  before any topic relies on it.
- **The Codex Identity as its own transactional entity** (its own
  StoaChain/Arweave accounts, able to hold funds/post transactions in its
  own right) — a genuinely separate, larger product direction, noted so
  it isn't lost, not connected to this topic's scope at all.
- Storing Arweave backup links on StoaChain under the Codex Identity (the
  "find my backups via Codex ID alone" index) — related to the restore
  flow, not to this topic's encryption engine; revisit once the dual-key
  envelope (Master Seed + Standard Apollo) above is live, since it's what
  would make an Apollo-only *lookup* actually lead somewhere decryptable.
