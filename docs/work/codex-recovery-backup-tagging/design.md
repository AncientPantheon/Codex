# Codex Recovery Backup Tagging — Design

Sub-topic 1 of 2 under `docs/work/arweave-seed-restore/design.md`. Read that
document for full rationale. This document scopes exactly the backend
pipeline: the reusable account-keyed cipher, the new recovery-key tag on
codex-backup uploads, and auto-installing a Prime Arweave seed at kickstart
so the precondition is true by default going forward. The actual
restore-by-seed-words UI is `codex-seed-restore-flow` (sub-topic 2),
planned after this.

## Problem

Nothing today ties a codex-backup upload to anything recoverable purely
from seed words: the Prime Arweave seed isn't installed automatically when
a codex is created, and even a manually-defined one has no way to unlock a
backup's password without the user already having it.

## Approach

**A reusable account-keyed cipher, not new crypto.** `encryptStringV2`/
`smartDecrypt` (`@stoachain/stoa-core/crypto`) already exist and already
take `(plaintext, password)` — the "convention" from
`docs/work/arweave-upload-categories/design.md` §3 is simply: pass a DALOS
account's 1600-bit bitstring (not its base10/base49 form, not a derived
RSA-4096 component — the raw root scalar) as the `password` argument, after
confirming the account's key is already available as that bitstring (every
Arweave seed in this codebase already is one, per
`packages/codex-arweave/src/seeds/resolveSeedBitString.ts`'s own rule). A
small, explicitly-documented wrapper (`encryptWithAccountKey`/
`decryptWithAccountKey`) makes that convention a named, reusable thing
instead of a bare cipher call with implicit meaning scattered wherever it's
used — this is genuinely shared infrastructure: this topic needs it for the
recovery-password tag, and a sibling topic (`arweave-upload-encryption`,
not yet built) will need the identical convention for per-upload
encryption. Built once, here, since this topic needs it first.

**The `Codex-Backup-Recovery-Key` tag.** `backupCodexToLibrary`
(`library/flow.ts`) and `uploadCodexBackup` (`upload/codexBackup.ts`) both
gain an optional pass-through: given the plaintext codex password (an
opaque string, exactly like `exportJson` already is — neither function
needs or gets access to anything else about the codex itself) and the
Prime Arweave seed's bitstring, `backupCodexToLibrary` derives the
ciphertext via `encryptWithAccountKey` and forwards it as a new tag,
`Codex-Backup-Recovery-Key`, alongside the existing tags. Omitted entirely
(no tag) when either input isn't supplied — a caller with no Prime Arweave
seed defined yet can still back up normally, just without a recovery
anchor.

**Auto-installing the Prime Arweave seed at kickstart — as a follow-on
step, not inside `kickstartCodex` itself.** Read `kickstartCodex`
(`packages/codex-ouronet/src/state/store.ts`) directly: it lives entirely
in `codex-ouronet`, which has (and must keep) zero dependency on
`codex-arweave` — the same cross-package isolation already enforced
everywhere else in this codebase (`library/flow.ts`'s own module doc
comment states the identical rule for the reverse direction). Baking
Arweave seed installation into `kickstartCodex` would violate that
boundary. Instead, this is a new orchestration step that runs immediately
after a successful `kickstartCodex` call, at whatever layer already has
both the new Ouronet account's bitstring and access to `codex-arweave`'s
own seed-installation primitives — deriving the Prime Arweave key at
position 0 from that same bitstring, using the existing seeded-keygen path
(`runSeededBatch`/`createWorkerKeygenRunner`, the same machinery
`ArweaveSeedsArea`'s own "Option 2: an Ouronet account's key" source
already uses — confirmed: index 0 is force-included on every seeded-batch
call, "a seed's #0 is its primary address," so this isn't new derivation
behavior, just triggering it automatically instead of requiring a manual
UI pick) — and installs the result as an `ArweaveSeedEntry` with
`isPrime: true`, mirroring the existing Prime-seed install pattern already
used elsewhere (`recoverCodexFromMnemonic`'s own prime-entity-install
shape is the closest existing precedent to mirror for "install and flag
prime").

## Acceptance criteria

- [ ] `encryptWithAccountKey(plaintext, bitstring)` /
      `decryptWithAccountKey(ciphertext, bitstring)` round-trip correctly,
      reuse `encryptStringV2`/`smartDecrypt` verbatim (no new cipher code),
      and are the ONE place in the codebase this bitstring-as-password
      convention is implemented.
- [ ] Given a codex password and a Prime Arweave seed's bitstring,
      `backupCodexToLibrary` posts a `Codex-Backup-Recovery-Key` tag whose
      value decrypts back to the exact password via
      `decryptWithAccountKey`.
- [ ] Omitting either input (no password supplied, no Prime Arweave seed
      defined) still succeeds with no recovery tag — never a thrown error,
      never a placeholder value.
- [ ] Completing kickstart for a brand-new codex results in an
      `ArweaveSeedEntry` with `isPrime: true`, derived from the same
      bitstring as the new Prime Ouronet account, with no separate manual
      step required.
- [ ] The full existing test suites for `arweave-core`, `codex-arweave`,
      and `codex-ouronet` still pass; typecheck stays clean across all
      three.

## Out of scope

- The restore-by-seed-words UI itself (deriving an address from typed
  words, querying the chain, presenting the backup list, decrypting,
  forcing a new password) — `codex-seed-restore-flow` (sub-topic 2).
- Anything for a codex whose Prime Ouronet account predates this change
  (no Prime Arweave seed, or one derived from different words) —
  `legacy-prime-migration` (Topic 2 of the parent project).
