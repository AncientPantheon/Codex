# Arweave Account Rows — Design

Sub-topic 1 of the `key-material-provenance` project
(`docs/work/key-material-provenance/design.md`, criteria A). Scope, approach and
acceptance criteria below are extracted from that parent design and re-grounded
against the current code, since the surface changed substantially across the
conversation that produced it.

## Problem

An Arweave address row (`AccountRow` in
`packages/codex-arweave/src/panel/ArweaveAccountsArea.tsx`) shows only a position
badge and the address — no value, no copy, no explorer link, no delete. A
Chainweb address row (`AddressRow` in
`packages/codex-ouronet/src/ui/tabs/StoaAccountsTab.tsx`) shows all four. The two
chains' Accounts pages should read as one product; today Arweave reads as an
unfinished one.

Separately, a generated Arweave key cannot be removed individually — the only
delete is the whole-seed cascade (`ArweaveSeedsArea`'s `onDeleteSeed`). The
primitive to delete one key already exists (`deleteForeignKey`, declared on
`ArweavePanelDeps` in `packages/codex-arweave/src/panel/context.tsx:94`), but
nothing in the UI calls it, and — found while grounding this design — the
playground's own wiring never connects it to the real store action either: both
`apps/codex-playground/src/mockArweaveAdapter.ts:203` and
`apps/codex-playground/src/realArweaveAdapter.ts:277` hardcode
`deleteForeignKey: async () => {}`, so even a correctly-wired delete button would
currently do nothing end-to-end in the app.

A third, unrelated but funds-critical bug surfaced in the same grounding pass:
`packages/codex-ouronet/src/state/store.ts`'s `migrateToCurrent()` action builds
its `CodexSnapshot` inline (~line 1883) and omits `foreignKeys` entirely. Every
other snapshot builder in the file (`buildForeignKeySnapshot`, and `init()`'s own
`preMigration` builder at ~line 943) explicitly threads `foreignKeys` through for
exactly this reason — omitting it from a `saveAll` write overwrites the on-disk
shard, because `LocalStorageCodexAdapter.saveAll` (line 143) writes
`JSON.stringify(snapshot.foreignKeys ?? [])` unconditionally. So any time a
migration actually runs, every Arweave (and other foreign-chain) key in the
codex is silently wiped to `[]`.

## Approach

**Value, copy, explorer, delete — ported from Chainweb, not reinvented.**
`StoaAccountsTab`'s row cluster (copy → explorer → delete, right-aligned, click
events stopped from bubbling into the row's own toggle) is the reference shape.
Codex-arweave cannot import `IconButtons.tsx`'s `lucide-react` icons (that
package resolves to the repo-root's stale React 18 from this package — see the
module JSDoc in `ArweaveSeedsArea.tsx`/`ArweavePanel.tsx`), so the three new
glyphs (copy, external-link, trash) are authored as local inline SVG in
`ArweaveAccountsArea.tsx`, matching the file's existing `svgBase`/`EyeGlyph`
convention rather than the ones in `ArweaveSeedsArea.tsx` (different module,
kept self-contained on purpose, same as today).

The value cell always reads `"Empty"` — balances are out of scope for this
project entirely (design.md's own "Out of scope"). No store read, no adapter
call: a static, styled span, matching Chainweb's own "Empty" state (grey,
`bal.isEmpty` case) rather than its funded (gold) one, since Arweave has no
balance seam wired at all.

**Explorer URL: `https://viewblock.io/arweave/address/<address>`.** There is no
existing Arweave explorer constant anywhere in the codebase — `codex-arweave`
deliberately holds no `arweave.net` literal (`createArweaveConnection.ts`) — so
this is a new, local decision, a plain template-literal function exactly like
Stoa's `explorerUrl` in `StoaAccountsTab.tsx:41`.

**Delete is confirm-then-delete, matching Arweave's OWN existing pattern** (the
seed-delete confirm strip in `ArweaveSeedsArea.tsx`), not Chainweb's immediate
`onRemove`. Regenerating a deleted key costs real RSA-4096 search time
(~6.7s/key), so a stray click must not be destructive.

**The delete callback threads through four layers**, purely as a prop —
`ArweaveAccountsArea` remains presentational and adds no store access:

```
AccountRow.onDeleteKey?(entry)
  → GroupSection (forwards)
    → ArweaveAccountsArea.onDeleteKey?(entry)
      → ArweavePanel's handleDeleteKey(entry.id)
        → prune entry.id out of ArweavePanel's own `sessionKeys` state
        → deps?.deleteForeignKey(entry.id)
```

The session-overlay prune is required for the same reason
`ArweavePanel.handleDeleteSeed` already prunes `sessionSeeds`: `arweaveKeys` is
computed as `deps.foreignKeys` merged with `sessionKeys` BY ID, session entry
winning. A key generated this session lives only in `sessionKeys` until the host
echoes back an updated `foreignKeys` prop; if delete only called
`deps.deleteForeignKey` without also pruning `sessionKeys`, that key would keep
rendering (or reappear) until the host's next round-trip — the exact resurrection
bug already fixed once for seeds.

**The playground's `deleteForeignKey` stub gets the same fix already applied to
`addForeignKey`/`generateArweaveKey`/`decryptArweaveKey`**: threaded from
`actions.deleteForeignKey` (the real store action) through
`createArweaveKeyPersistence` (so both `mode: "mock"` and `mode: "real"` panel
deps pick it up), because a seeded Arweave key is local cryptography with no
network and no funds — mock mode has no legitimate fake reason to swallow a
delete either.

**The `migrateToCurrent` fix mirrors `init()`'s already-correct pattern**: thread
`foreignKeys: state.foreignKeys` into the inline snapshot builder, and
`foreignKeys: migrated.foreignKeys ?? []` into the post-migration `set(...)`
call — the exact two lines `init()` already has for the same reason.

**Alternatives considered**

- *Reuse `IconButtons.tsx` directly* — rejected: the `lucide-react` resolution
  hazard is a hard constraint already documented in this package, not a style
  preference.
- *Immediate delete (no confirm), matching Chainweb* — rejected: an Arweave key
  costs CPU time to regenerate; Chainweb's Stoa keys do not carry the same cost.
- *Add a new `removeForeignKey` seam* — rejected once grounding confirmed
  `deleteForeignKey` already exists on `ArweavePanelDeps` and is already the
  correct shape; the gap is wiring, not a missing primitive.

## Acceptance criteria

- [ ] Each Arweave address row shows a value (reading `Empty`), a copy button,
      and an explorer button, visually matching the Chainweb row cluster's
      order (value, then copy/explorer/delete, right-aligned).
- [ ] The copy button places the row's full address on the clipboard
      (`navigator.clipboard.writeText`).
- [ ] The explorer button is a link to
      `https://viewblock.io/arweave/address/<address>`, opening in a new tab
      (`target="_blank"`, `rel="noopener noreferrer"`).
- [ ] Each row has a delete control that requires confirmation before removing
      the key (click → confirm/cancel strip → confirm), matching Arweave's
      existing seed-delete confirm pattern rather than Chainweb's immediate
      delete. Omitting the delete callback hides the control entirely.
- [ ] A deleted key stays deleted: it does not reappear from the panel's
      session overlay (a key generated and deleted in the same session does not
      resurrect when the host's `foreignKeys` prop is stale or slow to update),
      and it is absent after a reload (the real store's `deleteForeignKey`
      action is actually invoked, not a no-op stub).
- [ ] A `saveAll` triggered by `migrateToCurrent()` no longer wipes
      `foreignKeys` to `[]` — a foreign key present before a migration is still
      present, in both live state and the persisted snapshot, after one runs.

## Out of scope

- Wiring real Arweave balances — the value cell renders `Empty` by construction.
- Fixing `buildRealPanelDeps`'s unrelated pre-existing `decryptArweaveKey` bug
  (it always throws in real mode, ignoring the armed persistence path) — found
  during grounding, not part of this criterion set, logged to the backlog.
- Bulk/multi-select delete — one row, one confirm, one delete.
