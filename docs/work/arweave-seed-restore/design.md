# Arweave Seed Restore — Design

**Split into two sub-topics at planning time** (this topic's own scope
exceeded a single plan — same escalation the `arweave-upload-library`
project's Topic 1 hit): `codex-recovery-backup-tagging` (the backend
pipeline: the account-keyed cipher helper, the `Codex-Backup-Recovery-Key`
tag, auto-installing the Prime Arweave seed at kickstart) is shaped and
planned first; `codex-seed-restore-flow` (the actual restore-by-seed-words
UI, depending on the first) follows. Everything below is still the full,
approved rationale for both.

Topic 1 of `docs/work/codex-seed-restore/design.md`. Builds directly on the
already-shipped `codex-backup` upload category
(`docs/work/arweave-upload-categories/design.md`) and its encryption
conventions (`docs/work/arweave-upload-categories/design.md` §3 — the
bitstring-normalized, reuse-the-existing-V2-cipher convention already
established for per-upload Ouronet-account-keyed encryption).

## Problem

A codex-backup upload exists on Arweave the moment a user makes one, but
today it's only useful to someone who already has the codex (to know where
to look) and the password (to decrypt it once found). Someone restoring
from nothing but memorized seed words has neither. This topic makes the
backup itself the recovery path.

## Approach

**The precondition.** This only works when the Prime Ouronet account and
the Prime Arweave seed were derived from the *same* DALOS seed words — true
by default for any codex created fresh today, and made true for existing
codices by Topic 2. Given that, the Prime Arweave account (and its private
key) is fully re-derivable from nothing but those words, at any time, by
anyone who has them.

**Encrypting the password, not just the export.** At backup time, in
addition to the export itself (already encrypted under the codex password,
unchanged from today), the codex password is *separately* encrypted under a
key derived from the Prime Arweave account's private key — normalized to
its canonical bitstring form first, exactly the convention already
established for upload encryption, no new key-derivation convention
introduced. The result is attached as a new public tag on the *same*
codex-backup upload transaction (`Codex-Backup-Recovery-Key`) — tags are
returned by the same chain query that finds the upload in the first place,
so restoring never needs a second round-trip just to learn where the
recovery key lives.

**Explicitly accepted tradeoff.** This permanently publishes an encrypted
copy of the actual codex password, forever, protected only by the Prime
Arweave private key's entropy. Confirmed accepted by the owner: the
underlying key is a 1600-bit DALOS scalar, and if that's ever compromised
the rest of the codex is already exposed regardless, so this isn't a new
category of risk — the password ciphertext just rides along with it.

**The restore flow.**
1. User types their seed words. Nothing else — no file, no password.
2. The DALOS scalar, then the Prime Arweave account (same derivation used
   at creation), then its address, are recomputed locally.
3. Query the chain (GraphQL: `Codex-Owner` = that address,
   `Codex-Category` = `codex-backup`) for every matching upload.
4. Present them as a list, newest first, with the newest selected by
   default — never a silent auto-pick — and an explicit control to choose
   an older one instead, for whenever the newest is suspect or the user
   specifically wants an earlier state.
5. On confirming a choice: decrypt that entry's `Codex-Backup-Recovery-Key`
   tag using the freshly re-derived Prime Arweave private key (bitstring
   form) → the recovered codex password → decrypt the actual export with
   it → the full codex, in memory.
6. Before anything is persisted into the browser, the user is prompted to
   set a *new* password — the recovered old one is never silently reused
   as the go-forward password.
7. Only after a new password is set does the codex get written to local
   storage.

**Honest failure, always.** Wrong or incomplete seed words, or a correctly
re-derived account with no backups on chain, must produce a clear "nothing
found here" result — never something that looks like a match but isn't, and
never a silent hang indistinguishable from "still searching."

## Acceptance criteria

- [ ] A codex-backup upload carries `Codex-Backup-Recovery-Key`: the codex
      password, encrypted under the Prime Arweave account's private key
      (bitstring-normalized), alongside the existing encrypted export.
- [ ] Typing in the correct seed words alone reconstructs the Prime Arweave
      address and locates every codex-backup upload tagged to it, with no
      other input required.
- [ ] Multiple backups under one account are shown as a list, newest
      selected by default, with an explicit affordance to pick an older
      one.
- [ ] Confirming a selection decrypts and loads the codex, then requires
      setting a new password before anything is persisted locally.
- [ ] Incorrect/incomplete words, or a valid account with zero backups,
      produce a clear, unambiguous "not found" result.
- [ ] The password-recovery encryption reuses the existing V2 cipher and
      the bitstring-normalization convention verbatim — no second key
      derivation scheme introduced anywhere in this feature.

## Out of scope

- Any codex whose Prime Ouronet account and Prime Arweave seed don't
  already share origin words — `legacy-prime-migration` (Topic 2) is what
  makes that true; this topic assumes it already is.
- The migration wizard, the three-option menu, and the fund sweep — Topic 2.
- Funding the Prime Arweave account with AR in the first place (an existing
  send/balance concern, not new to this feature).
