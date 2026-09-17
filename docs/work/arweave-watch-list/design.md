# Arweave Watch List — Design

## Problem

Arweave account rows now show real balances (via the mainnet-reachable
`getBalance` pipeline landed this session), but there is no way to observe an
address the Codex does not hold a private key for. This blocks the immediate
need — verifying a real, Binance-funded Arweave address reads correctly end to
end — and more generally blocks tracking any third-party address. Chainweb
already solved this with a working watch-list feature; Arweave's UI has the
"Watched Accounts" sub-tab shell built and waiting (`ArweaveAccountsArea.tsx`),
but it is a hardcoded `WATCHED_COUNT = 0` stub with no add flow, no list, and
no backing data at all.

## Approach

**Extend Chainweb's existing shared watch-list store slice, don't build a
parallel one.** `WatchListEntry.type` is currently `"ouronet" | "stoa"`, with
`"ouronet"` already reserved but never wired to anything — the union already
anticipated more than one non-Chainweb value. Add `"arweave"` to that same
union and reuse the entire already-tested persistence path (the `watchList`
store slice, `addWatchListEntry`/`deleteWatchListEntry` actions, and the
`"stoa-watch-list"` localStorage key) rather than inventing new storage.

**Keep `ArweaveAccountsArea.tsx` presentational, per its own documented rule**
("never reads a store"). Chainweb's `StoaAccountsTab.tsx` calls `useWatchList()`
directly because it lives inside the same package as the store; `codex-arweave`
does not and should not gain that coupling. Instead, the bridge lives where
every other Arweave deps seam already lives — the playground's wiring layer
(`ForeignChainsWiring.tsx` / `realArweaveAdapter.ts` / `mockArweaveAdapter.ts`):
call `useWatchList()` there, filter to `type === "arweave"`, and expose three
new `ArweavePanelDeps` members:
- `watchedAddresses: WatchListEntry[]` (pre-filtered to this chain)
- `addWatchedAddress(address: string, label?: string): Promise<void>` (defaults
  `type: "arweave"`, generates the `id`/`createdAt` the same way Chainweb's
  `handleAddWatch` does)
- `removeWatchedAddress(id: string): Promise<void>`

**Validation reuses `validateAddress(ARWEAVE_CHAIN_ID, address)`** (from
`@ancientpantheon/codex-ouronet/hooks`), already imported and used in this
exact package (`SendArea.tsx`) for the same purpose — a real format check,
not Chainweb's weak "starts with a known prefix" gate. Also reject (mirroring
Chainweb's own two guards): an address that's already a Codex-owned Arweave
key, and an address already on the watch list.

**Watched row rendering reuses `AccountRow` as much as possible**: live
balance via the same `getBalance` prop already wired (this session's balance
work), copy button, ViewBlock explorer link — all identical to a Codex-owned
row. Differs only by omitting the Send button (no private key exists to sign
with) and adding a remove button + inline label editor, mirroring exactly how
Chainweb's watched rows differ from its keyed rows.

**Alternatives considered and rejected:**
- A separate, Arweave-only watch list with its own storage key — duplicates
  add/remove/persist logic that already exists and works, against the
  "reuse, don't rebuild" principle the rest of this feature area has followed.
- Folding watched addresses into `ForeignKeyEntry` (the array real keys live
  in) — `encryptedKeyfile` is a mandatory, secret-bearing field with many
  consumers (codec/backup validation, delete-guard, RSA reveal) that assume a
  real key; retrofitting a keyless variant reopens exactly the kind of
  funds-critical surface that caused the `arweaveSeeds` backup bug fixed
  earlier this session, for a feature that doesn't need to touch any of it.

## Acceptance criteria
- [ ] Typing a syntactically valid Arweave address into the Watched Accounts
      tab and confirming adds it to the watch list.
- [ ] An invalid Arweave address is rejected with a clear message before being
      added (never silently accepted).
- [ ] An address that is already a Codex-owned Arweave key is rejected with a
      clear message (mirrors Chainweb's duplicate-ownership guard).
- [ ] An address already on the watch list is rejected as a duplicate.
- [ ] A watched row shows a live AR balance through the same real/mock
      `getBalance` pipeline already wired for Codex Accounts rows —
      verifiable end to end with a real funded address once real mode is on.
- [ ] A watched row has copy, explorer link, an editable label, and a remove
      button, and does NOT have a Send button.
- [ ] The watch list survives a page reload.
- [ ] Chainweb's own watch-list behavior, stored data, and existing tests are
      completely unaffected by this change.

## Out of scope
- Cross-device sync of the Arweave watch list beyond whatever Chainweb's
  watch list already does or doesn't support — no new sync mechanism.
- Including the watch list in the JSON backup export/import — Chainweb's own
  watch list is deliberately excluded from that codec too; this stays symmetric.
- Any watched-row action beyond observe/label/remove — no send, no delete-key
  (nothing to delete), no stake/vault actions (Arweave has none regardless).
