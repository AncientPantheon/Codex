# Codex Session Lifecycle — Design

Topic 2 of `docs/work/arweave-account-safety/design.md`. Independent of
Topic 1 (`arweave-non-removable-account`, built): that topic's invariant is
already enforceable with zero local/session state (chain truth via
`checkAccountEncryptedArweaveUploads` is the backstop), so this topic is
pure UX — it is not a safety mechanism and must never be framed as one.

## Problem

**Correcting an initial misreading, confirmed by reading `store.ts`
directly before writing anything further:** `dirty` does NOT mean
"unsaved to local storage" — every mutating store action already persists
through the adapter synchronously via `persistAndTouch` (confirmed:
`persistAndTouch` sets `dirty: true` *after* awaiting the adapter write,
not before). Closing the tab loses nothing; the browser's local storage
already has it. `dirty` actually means "diverged since the last *external*
backup" — it's cleared only by `clearDirty()`, which today is wired to two
places: a successful Arweave codex-backup upload
(`onBackupSuccess={clearDirty}` in `apps/codex-playground/src/App.tsx`)
and `BackupRestorePanel`'s JSON-download flow. So the real risk `dirty`
protects against is narrower and more serious than "lost edits on tab
close": it's "this browser's local storage is the *only* copy of these
changes, and nothing outside this browser/device has them" — a real loss
scenario on browser-data clearing, device loss, or profile corruption, not
on a routine tab close.

Today nothing acts on this signal at all. The one existing `beforeunload`
handler in the codebase (`packages/codex-arweave/src/panel/ArweavePanel.tsx`,
~line 702) is narrowly scoped to an in-flight upload generation — it says
nothing about general backup-divergence, and lives inside an
Arweave-specific component, not somewhere a host app can reuse for the
whole codex. There is also no sanctioned pre-logout hook: a host app
wanting to ask "back this up first?" before tearing down a session has
nowhere to plug in.

**Explicitly not a safety mechanism for the non-removable-account
invariant specifically.** The user's original concern that motivated this
topic (stated at the very start of the parent project) was the opposite of
what might be assumed: they do NOT want a scary "you'll lose your upload"
warning blocking logout, because *that* invariant is already —
independently — enforced by chain truth, not by local state (Topic 1).
This topic is a separate, genuinely-useful reminder for a real but
different risk: local storage is a single point of failure until an
external backup exists. It must read as "back this up somewhere outside
this browser" — never as "you'll lose your Arweave upload" (that's never
true) and never phrased as blocking/mandatory (the user must always be
able to proceed without backing up, exactly as they can today).

## Approach

Two pieces, both new, both living in `codex-ui` (chain-agnostic, same
layer `useCodexBackup` already lives in — no Arweave-specific knowledge
belongs here):

**1. A generic dirty-state `beforeunload` guard.** A new hook,
`useCodexUnsavedChangesGuard(): void` (or folded as an opt-in effect
inside `useCodexBackup` itself — the plan step decides based on whichever
keeps `useCodexBackup`'s existing single-responsibility doc comment true),
installs the exact same native pattern `ArweavePanel.tsx` already uses
(`event.preventDefault(); event.returnValue = ""`) whenever
`store.dirty === true`, removed when clean. This is pure browser-native
UX — no custom copy is possible for `beforeunload` (confirmed by the
existing code's own comment), so there is nothing to design here beyond
"install it generically, keyed off the real dirty flag, not just the
upload-in-flight case."

**2. A sanctioned `requestLogout()` integration point.** A new exported
hook from `codex-ui`, `useRequestLogout(): () => Promise<"clean" |
"backed-up" | "proceeded-without-backup" | "cancelled">`, callable by a
host app immediately before it tears down a session (clears the password,
navigates away from the unlocked codex, etc.). If `store.dirty` is false,
it resolves `"clean"` immediately with no prompt — nothing to back up.
If `store.dirty` is true, it surfaces a small, host-renderable choice
("back up now" / "continue without backing up" / "cancel, stay logged
in") via the exact same resolver-based-promise seam
`useRequestPassword`/`store.requestPassword` already establishes (read
`packages/codex-ui/src/hooks/useRequestPassword.ts` and
`packages/codex-ouronet/src/state/store.ts`'s `pendingPasswordRequest`
slice + `requestPassword()` action in full — mirror that exact shape: a
new `pendingLogoutRequest` slice, a new store action that creates the
pending entry and returns the promise, and a new modal-style component in
`codex-ui` that reads the pending slice and resolves/rejects it, the same
division of responsibility `PasswordModal.tsx` already has). "Back up
now" does not itself invent a new backup mechanism — it surfaces
whichever backup affordance the host already has wired (JSON download via
`useCodexBackup().downloadAsJson`, or Arweave backup if the host has that
panel mounted); the modal only needs to call `clearDirty()` once the host
confirms a backup actually completed, mirroring how `onBackupSuccess`
already does this for the Arweave path today. A host app that never calls
`requestLogout()` loses nothing it doesn't already risk today — this is
strictly additive, no existing logout path is forced through it.

**3. `SESSION_LIFECYCLE_CONTRACT.md`**, shipped in `packages/codex`
exactly the way `IMPORT_EXPORT_CONTRACT.md`/`ARWEAVE_TAG_SCHEMA.md`
already are (added to `package.json`'s `files` array, pointed to from
`README.md`), documenting: what `isDirty` actually tracks, the
`beforeunload` guard's native-browser-chrome limitation, and
`requestLogout()`'s contract — explicitly stating it is a convenience
checkpoint, not a security or funds-safety gate.

## Acceptance criteria

- [ ] Closing/refreshing the tab while the codex has diverged from its
      last external backup (`store.dirty === true`) triggers the
      browser's native "leave site?" prompt; a codex with no backup
      divergence never does.
- [ ] A host app calling `useRequestLogout()`'s returned function on a
      clean (`dirty === false`) codex resolves `"clean"` immediately with
      no prompt.
- [ ] A host app calling it on a dirty codex is offered a back-up-now /
      continue-without-backing-up / cancel choice, and the returned
      outcome accurately reflects what happened (`"backed-up"` →
      `clearDirty()` was actually called; `"proceeded-without-backup"` →
      `dirty` is left `true` and the caller proceeds anyway;
      `"cancelled"` → caller does not proceed, nothing changes).
- [ ] `apps/codex-playground` wires `useRequestLogout()` into its own
      logout/lock action for real, local, manual testing — not left
      unmounted.
- [ ] `SESSION_LIFECYCLE_CONTRACT.md` ships in the `codex` npm package,
      correctly documents what `dirty` actually tracks (divergence from
      last external backup, not unsaved-to-local-storage), and explicitly
      disclaims any role in the non-removable-account invariant.

## Out of scope

- Anything about the non-removable-account invariant (Topic 1, already
  built and independently chain-truth-backed) — this topic must not touch
  `deleteOuroAccount`, `hasEncryptedArweaveUpload`, or
  `checkAccountEncryptedArweaveUploads`.
- Auto-save / periodic background save — only an on-demand reminder at
  the two points named above (unload, explicit logout request).
- Per-field dirty granularity ("only your address book changed") — the
  existing single boolean `store.dirty` is the only signal this topic
  reads or writes.
