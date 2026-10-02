# Codex ID Page — Project Design

## Problem

Today, nothing in the real app surfaces the three things a user needs in
one place to understand and act on their codex's permaweb posture:
whether their codex is eligible for seed-words-only restore (built,
`codex-seed-restore-activation`, but only shown deep inside the Arweave
panel's Library tab), a path to fix it when not eligible (the
`legacy-prime-migration` wizard, designed but not yet built, paused
pending real-fund-movement sign-off), and — the gap this project starts
with — a genuinely safe way to back up the *whole running codex* itself
to Arweave, not just individual uploads.

The existing codex-backup upload (`uploadCodexBackup`/
`backupCodexToLibrary`, built in `arweave-upload-categories` and extended
in `codex-recovery-backup-tagging`) has two real problems, found while
preparing to use it for the first time: it leaves the exported JSON's
*shape* (field names, account/seed counts) publicly readable even though
individual secret values are ciphertext, and its recovery mechanism ties
restoration to the user's own arbitrary, locally-chosen password rather
than being purely derivable from seed words alone. A third, smaller gap:
the backup's `Codex-App-Version` tag is populated from a timestamp, not
from the codex's actual shape-version constant (`CODEX_FORM_VERSION`).

## Approach

Two topics, sequenced — the encryption engine has to exist and be solid
before the page that triggers it is worth building:

1. `codex-backup-envelope-encryption` — rebuilds the codex-backup upload's
   cryptography so the entire export becomes opaque on-chain and fully
   seed-derivable (no password dependency at all), replacing the
   password-recovery-tag mechanism with a proper dual-key envelope scheme.
   Also fixes the version-tag gap. Shaped in full below — the whole
   mechanism was worked through in exhaustive technical detail across a
   long design conversation, captured in its own design doc.
2. `codex-id-page` (same slug, the actual UI) — the new page: eligibility
   status (reusing the already-built detector), a migration entry point
   when not eligible (opens the `legacy-prime-migration` wizard once that
   exists), and the "upload this running codex" action itself, using
   Topic 1's encryption engine. Shaped once Topic 1 is built.

Topic 1 is shaped in full at
`docs/work/codex-backup-envelope-encryption/design.md` and is the next
one to plan and build.
