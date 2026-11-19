# Locked entities, and the Former Codex Prime designation

Two owner requests from one session, sharing one surface
(`OuronetAccountsTab.tsx`) and one root cause: **the codex knows things about
an entity that it never shows the owner.**

Owner, verbatim:

> The former Prime Ouronet Account is now "Initial Seed". It would have to be
> "Former Codex Prime", because that was its designation before: Codex Prime.
> and we need to keep this designation for this account for old account.

> the Seed that is responsible for the keys that i kept on my ouronet account
> ... should be undeletable, which it is, but we have no way to see which
> entries are protected. Such Protected Seeds or account should have a lock
> medalion with protected. and delete button should not be availabe for them.
> Wed see directly, aha, this is a protected seed or account. This goes as
> well for pure keys of course.

Owner decisions taken for this design:

1. *"We use Former for displacements, but note displacements can only happen
   once, because only once we can apply the pending settings."*
2. The medallion word is **"Locked"**, not "Protected".
3. The live delete-protection bugs are **in scope**, not deferred.

---

## PART A — "Former Codex Prime"

### A1. What is broken

On the owner's sealed codex, the displaced account renders only its stored
name ("Initial Seed"). No designation at all. Two independent causes:

**Cause 1 — nothing records it.** `recordFormerMasterIds`
(`codex-core/src/codex/masterSeed.ts:120-157`) takes the outgoing id
*exclusively* from `previous?.ouroAccountId`. On a first migration the codex
has no `codexMasterSeed` row, so `previous === undefined`, so `appendDisplaced`
returns at its first guard and appends nothing. The feature only ever worked
from the SECOND master move onward — which, per owner decision (1), cannot
happen. So for the Ouronet face it has never worked at all.

This is pinned as intended behaviour today by
`codex-core/tests/master-seed-row.test.ts:102-106` and
`codex-ouronet/tests/state-codex-master-seed-row.test.ts:89-96`. Those
assertions were written against the wrong model and must be amended, not
worked around.

**Cause 2 — the evidence is destroyed before the row is written.**
`runFinalize`'s Write 1 (`LegacyPrimeMigrationWizard.tsx:7053`) calls
`ensurePrimeSeedAccountPairingAndPromote`, whose step 6 (`store.ts:2712`)
calls `promoteSeedAndAccountToPrime`, which flips `isPrime` to `false` on
every other account (`store.ts:2573-2576`). Write 2 — the master row — runs at
`:7103`, AFTER that. So by the time anything could notice a displacement, the
legacy prime carries no flag, no row entry, and no distinguishing stored name.

Its stored name is NOT recoverable as a signal either: the v0.2 kickstart path
takes a caller-supplied name (`store.ts:2124-2128`), which is why the owner's
account reads "Initial Seed" rather than the v0.3 literal `"CodexPrime"`
(`store.ts:1209`). Name-matching is exactly what `masterNames.ts:171-173`
forbids.

**Therefore: the legacy prime's id must be captured BEFORE Write 1. There is
no later point at which it can be reconstructed.**

### A2. Why `formerOuroAccountIds` is the wrong home for this

Pre-seal, the master row may be re-pointed any number of times: the wizard is
re-runnable by design (the Retry button shipped this week), and every run
executes Write 2 with whatever account that run resolved. The append-only
history therefore accumulates every *candidate* that briefly held the row —
accounts that were never applied and never displaced anything.

Designations only become visible at the seal, so at seal time that list may
hold several ids with equal claim to a "Former" title. Only one of them is a
real displacement.

Compounding it: on a retry, "the account carrying `isPrime` before this run's
promotion" is the PREVIOUS CANDIDATE, not the owner's original account.
A capture that re-runs each finalize records the wrong account.

**Decision.** A dedicated, write-once field:

```ts
/** `IOuroAccount.id` of the account that was this codex's CodexPrime before
 *  it ever settled a master. Written ONCE, by the first finalize that
 *  promotes a different account, and never overwritten. */
readonly legacyPrimeOuroAccountId?: string;
```

Write-once is the load-bearing property, not an optimisation.
`formerOuroAccountIds` stays exactly as it is — an honest audit trail of ids
that have held the row — and stops being consulted for the Ouronet
designation.

### A3. The designation

Owner decision (1) collapses the two-title model I had proposed. If exactly
one displacement is possible, and it is always kickstart-prime → settled
master, then an Ouronet account can never legitimately read "Former Codex
Ouronet Master". That constant is wrong for accounts.

- `FORMER_OURONET_CODEX_MASTER` (`"Former Codex Ouronet Master"`) is
  **removed**. It shipped yesterday, is consumed only by
  `OuronetAccountsTab.tsx`, and describes a state that cannot occur.
- New: `FORMER_CODEX_PRIME = "Former Codex Prime"`, pinned by exact value in
  `master-names.test.ts` like its siblings. NOT derived from another constant:
  "Codex Prime" is a retired historical designation, not a re-wording of a
  live one, so it must not move if a live name is re-worded.
- New predicate beside `isFormerMasterAccount`:
  `isLegacyPrimeAccount(accountId, row, progress)` — true iff
  `row.legacyPrimeOuroAccountId === accountId`, the account is not the current
  master, and `isMigrationSealed(progress)`. Seal-gated like its siblings, and
  for the same reason: *"Only when sealing we get to see the new
  designations."*
- `isFormerMasterAccount` is **kept** — it is correct for what it says and is
  the right answer should a second displacement ever become possible — but
  nothing renders it for accounts after this change. Stated here so the next
  reader does not take its existence as evidence of a live surface.

Rendering reuses the two-name slot already built: designation on the title
line, the account's own stored name beneath, muted, never gold.

### A4. Explicitly NOT in scope

The displaced legacy prime **seed** also loses its `isPrime` flag to the same
promotion and also renders only its stored name. The owner did not ask for a
seed designation — only for its protection to be visible, which is Part B.
Flagged, not built.

---

## PART B — The "Locked" medallion, and the lies behind it

### B1. The real problem is not the missing badge

Protection is enforced in four places and communicated in five different ways:

| entity | store rule | what the owner sees |
|---|---|---|
| Ouronet account | `isPrime`, `hasEncryptedArweaveUpload` | disabled button + tooltip |
| Chainweb seed | `isPrime`, master-key lock | menu item HIDDEN for prime; **nothing** for locks |
| Chainweb key position | master-key lock | disabled only for prime+index 0; **nothing** for locks |
| Pure keypair | `isCodexGuard` / `wasCodexGuard` / `isDuoPurePrime` | disabled + **a visible badge** |
| Arweave seed | **none** | nothing — always deletable |

Four of these let the owner click a live Delete on something the store will
refuse. That is the defect; the badge is the remedy.

### B2. The four live bugs, all confirmed in code

1. **Master-key locks on seeds — the owner's own case.**
   `deleteStoaChainSeed` throws `CodexMasterKeyLockedError`
   (`store.ts:1975-1978`); `SeedWordsTab`'s delete item is gated only on
   `isPrime` (`:490`). A non-prime locked seed shows a live Delete, and
   `handleDeleteSeed` (`:1219-1222`) catches the error and replaces it with
   `"This seed is protected and cannot be deleted."` — discarding a message
   that names the reason and tells the owner how to resolve it
   (`errors/types.ts:158-161`).

2. **Locked key positions — worse.** `updateStoaChainSeed` enforces the
   position guard (`store.ts:1749-1759`), but `KeyRow` disables delete only
   for `isPrime && index === 0` (`SeedWordsTab.tsx:353-355`), and
   `handleDeleteKey` (`:1253-1255`) has **no catch at all** — an unhandled
   rejection and silence. The store's own comment says it:
   *"The seeds UI's disabled delete button is cosmetic; this is the real thing."*

3. **`hasEncryptedArweaveUpload`.** `deleteOuroAccount` throws
   `CodexArweaveEncryptionProtectedError` (`store.ts:2508-2510`);
   `deleteProtected` (`OuronetAccountsTab.tsx:669`) never reads the flag.
   Enabled button, silent failure.

4. **The finalize→seal window.** `isPrime` moves at finalize, but
   `useMasterOuronetIdentity` returns `accounts[0]` until sealed. A promoted
   account not at array index 0 therefore shows an enabled delete the store
   refuses with `CodexPrimeProtectedError`.

### B3. Arweave seeds: no protection at any layer

`deleteArweaveSeed` (`store.ts:2052-2057`) is an unguarded filter. The master
ArWeave seed can be deleted outright, leaving `codexMasterSeed.arweaveSeedId`
dangling while `describeCodexMasterSeed` still reports that face as
established. `ArweaveSeedsArea.tsx:3120-3122` admits it:
*"The Prime seed is deletable FOR NOW (development)."*

Owner decision (3) ends that. The settled master ArWeave seed becomes
undeletable at the **store** layer — the only layer that can actually hold —
with the UI reading the same fact.

### B4. The rule, stated once

One exported predicate per entity type, each answering a single question:
**would the store refuse to delete this?** The UI renders the medallion and
withholds the delete control from that answer, so the two cannot disagree.

Requirements:

- Render-time cheap. All inputs are in-memory (`masterKeyLocks` is a plain
  array; the flags are booleans). No decrypt, no chain read. Anything
  requiring an async probe is out of scope — see B6.
- Each predicate returns the REASON, not just a boolean, so the medallion's
  tooltip and the error banner can both name it.
- The store stays the enforcer. The UI never becomes the only guard.

### B5. The medallion

Word: **"Locked"** (owner decision 2). `ArweaveAccountsArea` already uses
"Protected" for an unrelated tier (a seed whose words are held); two meanings
of one word on one screen is how the drift we spent this week removing starts.

Shape reuses `PureKeypairsTab.tsx:286-290`, the one surface that already does
this correctly: a `<Lock size={10} />` pill, `borderRadius: 9999`,
`fontSize: 10`, `fontWeight: 600`, `color: C`, `backgroundColor: C + "20"`.
No new visual language.

Constraints the tests impose, each verified in the map:

- The glyph must NOT be `🔒` on the Ouronet accounts row: that row's Prime
  pill is already `🔒 Prime`, and `ui-ouronet-accounts-tab.test.tsx:426`
  queries `getByText(/🔒\s*Prime/)`, which throws on a second match.
- The mobile `IconBadge` label must not be `"Prime"` or `"Standard"`:
  `ui-ouronet-accounts-tab-mobile.test.tsx:264-266` uses
  `getByLabelText("Prime")` (throws on >1) and `:274` asserts
  `getAllByLabelText("Standard")` has length exactly 2.
- The medallion must not use `#ceac5f` on an Ouronet account row:
  `ui-ouronet-accounts-tab.test.tsx:415` asserts exactly one gold row.
- Compact mobile rows must not grow: `ui-ouronet-accounts-tab-mobile.test.tsx`
  `:167-203` pins chunk sizes derived from MEASURED row height. Use
  `ArweaveAccountsArea.tsx:984-1001`'s absolutely-positioned straddling pill
  where height is measured.

Delete control: **removed, not disabled**, per the owner's *"delete button
should not be available for them"*. This changes `OuronetAccountsTab` and
`PureKeypairsTab`, which currently render a disabled button — and two existing
tests assert `.disabled === true` on exactly that
(`ui-ouronet-accounts-tab.test.tsx:481-498`,
`ui-pure-keypairs-tab.test.tsx:124`). Those pin a behaviour the owner has now
overruled; they must be rewritten to assert absence, deliberately and with the
reason recorded.

### B6. Out of scope, stated so it is not mistaken for an oversight

- `ArweaveAccountsArea`'s `"blocked"` delete tier needs an async
  `getBalance` chain read (`:1147-1171`). It cannot be a render-time
  medallion without a batch pre-fetch.
- `hasEncryptedArweaveUpload === true` is authoritative; its ABSENCE is not —
  the real answer needs `checkAccountEncryptedArweaveUploads`, an async chain
  query. The medallion may claim protection, never un-protection.
- Renaming the Arweave "Protected" tier. We take the other word instead.
- The duplicated `seedNames.ts` in `codex-ouronet` and `codex-ui`, and the
  third "is this the prime?" rule it carries
  (`seed.name === "Initial Seed"`). Logged in `backlog.md`.

---

## Acceptance criteria

**Part A**

1. A first migration records the legacy prime's id in
   `codexMasterSeed.legacyPrimeOuroAccountId`, captured BEFORE Write 1's
   promotion.
2. Re-running the wizard does NOT overwrite it: after two finalizes naming two
   different accounts, the field still names the ORIGINAL kickstart prime.
3. On a sealed codex the displaced account renders "Former Codex Prime" with
   its own stored name beneath, muted, not gold.
4. On an unsealed codex — including finalized-but-unapplied — no designation
   appears.
5. `FORMER_OURONET_CODEX_MASTER` no longer exists; `FORMER_CODEX_PRIME` is
   pinned by exact value.

**Part B**

6. Each of the four entity types exports a reason-returning "would the store
   refuse?" predicate, unit-tested, reading only in-memory state.
7. Every entity the store would refuse renders a "Locked" medallion naming the
   reason, and renders NO delete control — on both desktop and mobile forks.
8. The four live bugs are closed: a locked seed, a locked key position, an
   encryption-protected account and a finalize-window promoted account all
   show Locked and no delete control.
9. `deleteArweaveSeed` refuses the settled master ArWeave seed at the store
   layer, with a typed error, and the UI reflects it.
10. Where an error still can surface, the store's own message is shown — not
    replaced by a generic string. `handleDeleteKey` no longer leaves an
    unhandled rejection.
11. No existing test is weakened. The two that pin `disabled === true` are
    rewritten to assert absence, with the owner's instruction recorded in the
    test.
