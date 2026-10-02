# Arweave Upload Encryption — Design

Sub-topic 3 of the `arweave-upload-library` project (see
`docs/work/arweave-native-upload/design.md`'s own Topics list — this is the
one originally described there as "§3 Ouronet-account-keyed encryption +
the `Codex-Encrypted`/`Codex-Encryptor` tags + encrypted-upload UI +
decrypt-on-download and retroactive-add from §4," deferred until now).
Depends on `arweave-native-bundle` (built) and `arweave-upload-categories`
(built). This topic ships the encryption **pipeline** — the cipher, the
tags, decrypt-on-download, retroactive-add. The full Upload Wizard UI
(account/mode/files/category/cost-summary as a real multi-step flow) is a
separate, later topic that consumes this one; this topic's own UI surface
is deliberately minimal (wire the capability into the existing areas, not
redesign them).

## Problem

Every upload today is public. There's no way to protect a file's contents
while still keeping it permanently retrievable by its owner, and nothing
stops an Ouronet account that's encrypted something from being deleted out
from under that permanent ciphertext.

## Approach

**The cipher — no new crypto, reuse what's already being built.** Same
convention as `docs/work/codex-recovery-backup-tagging/design.md`'s T1
(not yet built as of this writing — build it here first if it still doesn't
exist by the time this is picked up, and that sibling plan's T1 becomes a
no-op reuse rather than a duplicate): `encryptWithAccountKey`/
`decryptWithAccountKey`, thin wrappers over `encryptStringV2`/
`smartDecrypt` (`@stoachain/stoa-core/crypto`), keyed by an Ouronet
account's private key **normalized to its canonical bitstring form** —
never base10/base49, per the established rule that different spellings of
the same key derive different AES keys unless normalized first.

**Getting the plaintext key material.** `packages/codex-arweave/src/panel/
context.tsx`'s existing `revealAccountSecret?: (accountId: string) =>
Promise<string | null> | string | null` is already the established,
unlock-gated seam for this — `ArweaveSeedsArea.tsx` already uses it. Reuse
it verbatim; do not build a second way to reach an account's secret.

**Derive once per upload action, not once per file.** PBKDF2 at 600k
iterations is deliberately expensive; a folder of many files re-running it
per file would add real, avoidable delay. One derivation, reused via plain
AES-GCM for every file in the same upload action.

**Default encrypting account: the Prime Ouronet account** (already
permanently non-removable for unrelated reasons — the safe default). The
uploader may pick any other Ouronet account already in the codex instead.

**New tags** (joining the existing schema, same reserved-namespace
discipline as every prior tag added this project): `Codex-Encrypted`
(`"true"` | `"false"`) on every upload; `Codex-Encryptor` — the
**public address only** of the account that encrypted it, present only
when `Codex-Encrypted` is `"true"`. Never key material, per the
handoff's own tag-permanence rule, carried through every tag-schema
decision this project has made so far.

**Manifest stays public even for encrypted uploads** (already decided,
`arweave-native-upload/design.md`'s original §4) — only file *contents*
are encrypted; folder/file structure stays gateway-resolvable.

**Decrypt-on-download.** The Library's entries (today, `LibraryArea.tsx`,
has no download affordance at all — only an "Open" link to the raw
gateway URL) gain a Download action: for a public entry, identical to
Open; for an encrypted entry (`Codex-Encrypted: true`), fetch the
ciphertext, look up the `Codex-Encryptor` address, resolve that account's
secret via `revealAccountSecret` (failing clearly, not silently, if the
account isn't present/unlocked or isn't held by this codex at all), decrypt
with `decryptWithAccountKey`, and hand the user the plaintext file with its
original filename/content-type (carried in existing tags).

**Retroactive add.** A small form: paste/select a data-item or manifest id;
fetch its tags from chain; verify they belong to an account this codex
actually holds (`Codex-Owner` matches one of this codex's own addresses);
insert it into that account's Library like any other confirmed entry. If
tagged encrypted, decryption then "just works" automatically via the
already-built decrypt-on-download path — no separate re-entry of key
info needed.

**Non-removable-account flag — set here, enforced elsewhere.** The moment
an account is actually used to encrypt a confirmed upload, this topic marks
it locally (a simple flag write — the actual deletion-blocking logic,
chain-query safety net, and override setting are `arweave-account-safety`'s
job, not this topic's; this topic's only obligation is making sure the flag
gets set at the right moment, reliably, so that later topic has something
correct to enforce).

## Acceptance criteria

- [ ] `encryptWithAccountKey`/`decryptWithAccountKey` exist (reused from
      `codex-recovery-backup-tagging` if already built by then, built here
      otherwise) and are the one place this bitstring-keyed convention
      lives.
- [ ] An upload can be marked encrypted, keyed to a chosen Ouronet account
      (default: Prime), with the AES key derived once per upload action
      regardless of file count.
- [ ] Every upload carries `Codex-Encrypted`; an encrypted one also carries
      `Codex-Encryptor` holding only the encrypting account's public
      address.
- [ ] A Library entry for an encrypted upload has a Download action that
      decrypts on the spot using the tagged account, when that account is
      present and unlocked in this codex — and fails with a clear,
      specific message (never a silent wrong result) when it isn't.
- [ ] A user can add an existing on-chain upload (by id or manifest id) to
      their Library, and it's verified against tags (ownership) before
      being accepted; if encrypted, decrypt-on-download works on it
      immediately with no extra setup.
- [ ] The instant an account first encrypts a confirmed upload, it's
      flagged locally as having done so — checkable by
      `arweave-account-safety`'s later deletion guard.
- [ ] The full existing test suites for `arweave-core` and `codex-arweave`
      still pass; typecheck stays clean across both.

## Out of scope

- The actual deletion-blocking enforcement (local-flag check, chain-query
  fallback, override setting) — `arweave-account-safety`.
- The full multi-step Upload Wizard UI (account/mode/files/category/
  cost-summary as a real guided flow, real visual design system usage) —
  a separate, later topic. This topic wires real capability into the
  existing areas; it does not redesign them.
- True asymmetric (encrypt-to-an-account-without-unlocking-it) encryption
  — already ruled out in the original design, still ruled out here.
