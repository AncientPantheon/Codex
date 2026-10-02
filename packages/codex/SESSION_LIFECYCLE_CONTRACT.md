# Codex Session Lifecycle Contract

**This is a UX convenience contract, not a safety or funds-protection
contract.** Every mechanism described below — the `dirty` flag, the
`beforeunload` guard, `useRequestLogout()` — exists to remind a user that
their changes live in exactly one place (this browser's local storage)
until they take an explicit external-backup action. None of it prevents
data loss, none of it is a gate a user cannot bypass, and — see the
disclaimer immediately below — none of it has any role in Codex's actual
funds-safety guarantee for Arweave uploads. If you are integrating Codex
and you find yourself reaching for `dirty`/`useRequestLogout()` to try to
*block* an action "for safety," stop: that is not what this mechanism is
for, and the real safety guarantee for Arweave uploads already exists
independently of anything in this document (see §0).

## 0. Disclaimer — this has NO role in the Arweave non-removable-account invariant

Codex separately enforces that an Ouronet account which has ever encrypted
a confirmed Arweave upload can never be deleted: `deleteOuroAccount` checks
a local `hasEncryptedArweaveUpload` flag synchronously and refuses to
delete the account if it is set, backstopped by a separate chain-truth
pre-flight (`checkAccountEncryptedArweaveUploads`) a delete-account UI must
call before invoking `deleteOuroAccount` when the local flag is absent —
so the guarantee holds even if local state is wrong, lost, or never set
(see `docs/work/arweave-non-removable-account/design.md`).

**Nothing in this document touches that invariant, in either direction.**
`dirty`, `clearDirty()`, the `beforeunload` guard, and every outcome of
`useRequestLogout()` (§3) are entirely about whether *this browser's local
storage* is currently the only copy of a user's codex. They say nothing
about, and have no effect on, whether an Ouronet account is deletable, and
they must never be read or presented as implying "you'll lose your Arweave
upload" — that is never true, and is guaranteed independently of
everything below, including a user who ignores every reminder this
document describes and closes the tab anyway.

## 1. What `dirty` actually tracks

`dirty` does **NOT** mean "unsaved to local storage." Verified directly
against `packages/codex-ouronet/src/state/store.ts`'s `persistAndTouch`
helper (the function every mutating store action routes through):

```ts
const persistAndTouch = async (
  saver: (a: CodexAdapter) => Promise<void>
): Promise<void> => {
  const adapter = get().adapter;
  if (!adapter) {
    throw new Error(
      "Codex store has no adapter wired. Call actions.init(adapter) first."
    );
  }
  await saver(adapter);
  const meta = await adapter.touch(get().deviceVariant);
  set({
    dirty: true,
    lastUpdatedAt: meta.lastUpdatedAt,
    lastUpdatedDevice: meta.lastUpdatedDevice,
  });
};
```

`dirty: true` is set **after** `await saver(adapter)` — i.e. after the
mutation has already been durably written through the adapter (local
storage, or whichever `CodexAdapter` the host wired at `init()`). By the
time `dirty` ever becomes `true`, the change it is flagging is already
safe on this device. Closing or refreshing the tab loses nothing; the
adapter already has it.

What `dirty` actually tracks is divergence from the **last external
backup**: it is cleared only by the `clearDirty()` action (`set({ dirty:
false })`, store.ts), never by a routine mutation or a routine persist.
The real risk `dirty === true` signals is narrower and more serious than
"you might lose your last edit on tab close" — it is "this device's local
storage is the *only* copy of these changes; nothing outside this
browser/profile has them yet," a real loss scenario on browser-data
clearing, device loss, or profile corruption, not on a routine tab close.

## 2. `clearDirty()` — what actually calls it today

Grepped directly against `packages/codex-ouronet`, `packages/codex-ui`,
and `apps/codex-playground` while writing this document — not recalled
from memory. There are three places `clearDirty()` is reachable today,
and they are not all equivalent:

1. **`completeLogoutRequest("backed-up")`**, internal to
   `packages/codex-ouronet/src/state/store.ts`. When the logout-
   confirmation flow (§3) resolves with `"backed-up"`, the store action
   itself calls `actions.clearDirty()` — a `<LogoutConfirmModal>`
   confirming a real backup completed never needs its own separate call
   to clear the flag.
2. **`onBackupSuccess={clearDirty}`**, wired twice in
   `apps/codex-playground/src/App.tsx` (once per `ForeignChainsWiring`
   mount — Arweave mode and Stoa mode). This is forwarded through
   `ForeignChainsWiring` → `buildArweaveWiring` → `ArweavePanelDeps.
   onBackupSuccess`, whose own doc comment in
   `apps/codex-playground/src/ForeignChainsWiring.tsx` states it fires
   "after a codex-backup upload resolves" — i.e. after a confirmed
   Arweave codex-backup upload completes, not on every upload attempt.
3. **Exposed, but NOT auto-invoked, via `useCodexBackup().clearDirty`**
   and threaded through `<BackupRestorePanel>`'s render-prop args
   (`BackupRestoreRenderArgs.clearDirty`). Neither `useCodexBackup()`'s
   `downloadAsJson()` nor `BackupRestorePanel`'s default "Download as
   JSON" button calls `clearDirty()` itself — it is handed to the host/
   consumer to call once *it* has confirmed the downloaded JSON actually
   represents a safe external copy. As of this writing, no call site in
   this codebase wires `clearDirty()` automatically to a JSON download;
   a host building its own "back up now" UI around `downloadAsJson()` is
   responsible for calling `clearDirty()` itself if it wants that path to
   clear the flag.

"External backup," concretely, means either of the two backup mechanisms
Codex ships today: a JSON file produced by `useCodexBackup().
downloadAsJson()` (manually confirmed and cleared by whatever UI wires
it), or a confirmed Arweave codex-backup upload (automatically cleared via
`onBackupSuccess`). Both are copies that exist outside this browser's
local storage; that is what "external" means here.

## 3. The `beforeunload` guard — browser-chrome limitation

`useCodexUnsavedChangesGuard()` (`packages/codex-ui/src/hooks/
useCodexUnsavedChangesGuard.ts`) arms the browser's native "leave site?"
prompt while `store.dirty === true` and disarms it once the codex is
clean, using the exact same native pattern
`packages/codex-arweave/src/panel/ArweavePanel.tsx`'s own, separate
`beforeunload` effect (its in-flight-upload guard, untouched by this
hook) already uses: `event.preventDefault(); event.returnValue = "";`.

That existing effect's own comment states the limitation this document
inherits verbatim:

> `beforeunload` cannot show custom copy — only the browser's own "leave
> site?" chrome — so this is intentionally the bare standard pattern, not
> an attempt at the dialog above.

There is no copy to design here: the browser owns the prompt's text
entirely, and every modern browser ignores any custom string a page
supplies. `useCodexUnsavedChangesGuard()`'s only job is deciding *when*
that native prompt is armed — keyed off the real, codex-wide `dirty` flag
(§1), not the Arweave panel's narrower upload-in-flight signal, which
remains a separate, additive guard.

## 4. `useRequestLogout()` — the four outcomes

`useRequestLogout(): () => Promise<"clean" | "backed-up" |
"proceeded-without-backup" | "cancelled">`, exported from `codex-ui`, is
the sanctioned integration point for a host app to call immediately
before it tears down a session (clears the cached password, navigates
away from the unlocked codex, etc.). Grounded against the real store
actions in `packages/codex-ouronet/src/state/store.ts`
(`requestLogoutConfirmation` / `completeLogoutRequest` /
`cancelLogoutRequest`, already built):

> **Verified against the shipped hook.** `packages/codex-ui/src/hooks/
> useRequestLogout.ts` has since landed; the outcome semantics below were
> re-checked against its real implementation (and its test file,
> `packages/codex-ui/tests/hooks-use-request-logout.test.tsx`) and match
> exactly — no correction was needed.

| Outcome | How it's reached | Effect on `dirty` |
|---|---|---|
| `"clean"` | The codex was already clean (`store.dirty === false`) when `useRequestLogout()`'s returned function was called. Resolves instantly; no pending request is created; `<LogoutConfirmModal>` never renders. | Untouched (was already `false`). |
| `"backed-up"` | The user was prompted (codex was dirty) and chose "back up now," and a real backup actually completed. The modal calls `completeLogoutRequest("backed-up")`. | Set to `false` — `completeLogoutRequest` calls `clearDirty()` internally on this outcome (§2, call site 1). |
| `"proceeded-without-backup"` | The user was prompted and chose "continue without backing up." The modal calls `completeLogoutRequest("proceeded-without-backup")`. | **Left unchanged (stays `true`)** — this outcome never calls `clearDirty()`; the divergence from the last external backup is still real, the user simply chose to proceed anyway. |
| `"cancelled"` | The user was prompted and chose "cancel, stay logged in" (or dismissed the prompt — Esc, backdrop click). The modal calls `cancelLogoutRequest()`. | **Unchanged either way** — `cancelLogoutRequest()` never touches `dirty`. The caller must not proceed with logout/teardown on this outcome. |

The fast path (`"clean"`) is documented, by invariant, to live in the hook
itself, never in `requestLogoutConfirmation()`: the store action's own
JSDoc states it "does NOT check `dirty` itself and will unconditionally
create a pending request... every time it's called" — calling
`requestLogoutConfirmation()` directly on a clean codex still surfaces a
prompt. A caller that wants the clean-codex fast path MUST go through
`useRequestLogout()`, not the raw store action.

A host app that never calls `useRequestLogout()` at all loses nothing it
doesn't already risk today — this mechanism is strictly additive, and no
existing logout/lock path is forced through it.

## 5. Shipped alongside

This document ships inside the published `@ancientpantheon/codex` npm
package (see `package.json`'s `files` array), the same way
`IMPORT_EXPORT_CONTRACT.md` and `ARWEAVE_TAG_SCHEMA.md` already do.
