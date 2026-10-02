# Arweave Account Safety — Project Design

The fourth and final topic of the original `arweave-upload-library` split
(`docs/work/arweave-native-upload/design.md` §5 + §6). Everything else from
that split is built; this is what's left.

## Problem

`library/flow.ts` already calls `onAccountUsedForEncryption` the instant an
account encrypts a confirmed upload — but nothing is wired to that callback
anywhere in the real app (confirmed by grep: `ArweavePanel.tsx`/
`UploadWizard.tsx`/`context.tsx` never reference it). Right now, a real
encrypted upload through the live wizard silently does nothing with this
signal — the non-removable-account invariant this whole project exists to
protect is currently inert. Separately, the save-reminder/logout-safety
layer that makes "exit without saving" safe was designed from the start of
this project and never built.

## Approach

Two topics, genuinely separate concerns (one is a deletion guard, the other
is session lifecycle), sequenced because the second's "what counts as
dirty" already includes the first's flag-write, but neither hard-blocks the
other's shaping:

1. `arweave-non-removable-account` — wire the already-built trigger to a
   real local flag, add the chain-query fallback for the gap case, add the
   explicit override setting, and guard `deleteOuroAccount` with it.
2. `codex-session-lifecycle` — the active save-reminder layer: Codex-owned
   `beforeunload`, the `requestLogout()` sanctioned integration point, the
   periodic reminder, and `SESSION_LIFECYCLE_CONTRACT.md` shipped the same
   way `IMPORT_EXPORT_CONTRACT.md`/`ARWEAVE_TAG_SCHEMA.md` already are.

Topic 1 is shaped below and planned/built next.
