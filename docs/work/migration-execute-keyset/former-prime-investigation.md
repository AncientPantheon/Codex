# "Former Codex Prime" does not render on the owner's settled codex — findings

Investigation for `migration-execute-keyset/plan.md` T1 / `design.md` §4,
acceptance criterion 10. **No production file was touched.** One spec was
added: `packages/codex-ouronet/tests/former-prime-provenance.test.ts`.

## Verdict, in one paragraph

The rendering path is correct and the write path is correct. The designation is
missing because the owner's `codexMasterSeed` row carries no
`legacyPrimeOuroAccountId` — and the overwhelmingly likely reason is that his
codex was **sealed by a build that predates the field**, which landed in
`f44f7e3` (2026-11-19). Nothing in the tree can reconstruct the id, and
`ouroAccounts[0]` is **not** a safe substitute, so **no backfill should be
written**. The owner should expect the displaced account to keep showing its
own stored name ("Initial Seed") on this codex, and to show "Former Codex
Prime" on any codex settled by `f44f7e3` or later. The design's stated reason
for the loss (a race inside the finalize) is **wrong**; the real reason is
stated in §3 below, and the correct capture order is now pinned by a test.

## 1. Exactly when the designation renders, and when it does not

`OuronetAccountsTab.tsx` row-level, in evaluation order:

| # | Condition | Where |
|---|---|---|
| 1 | the row is NOT a Codex-ID half (`primeName` falsy) — otherwise `primeName` wins outright | `:599`, `:641` |
| 2 | the row is NOT the master identity | `:611`, `:621` |
| 3 | the migration is **SEALED** (`migrationProgress.appliedAt` set) | `masterSeed.ts:302` via `isMigrationSealed` |
| 4 | `account.id` is non-empty | `masterSeed.ts:303` |
| 5 | `codexMasterSeed.legacyPrimeOuroAccountId` is present and non-empty | `masterSeed.ts:270`, `:307` |
| 6 | that id **equals this row's `account.id`** | `masterSeed.ts:307` |
| 7 | that id is **not** `codexMasterSeed.ouroAccountId` (the current holder) | `masterSeed.ts:306` |

All seven hold ⇒ `designation = FORMER_CODEX_PRIME`
(`OuronetAccountsTab.tsx:646`, constant at `codex-core/src/codex/masterNames.ts:88`),
painted muted silver. Any one of them failing ⇒ `designation === undefined` ⇒
the row is titled by its own stored name (`:648`), which is exactly the
owner's symptom.

Three of the seven also tell us something diagnostic:

- **The seal is almost certainly not the cause.** On an UNSEALED codex
  `useMasterOuronetIdentity` answers `accounts[0]` for the master
  (`OuronetAccountsTab.tsx:486-488`), so the index-0 pre-migration account
  would be wearing the *gold* "Codex Ouronet Master" instead of its stored
  name. The owner sees the stored name, so either the codex is sealed, or the
  displaced account is not index 0. The master designation and the former
  designation read the SAME `sealed` value, so: **if "Codex Ouronet Master"
  renders on the settled account, the seal is in place and the absence is the
  field itself.** That is the one-glance check.
- **Condition 7 is the "displaced nobody" case** and must stay absent — see §4.
- `codexMasterSeed` and `migrationProgress` both come from the store
  (`codex-ui/src/hooks/useCodex.ts:84` is `store((s) => s.codexMasterSeed)`),
  so there is no stale-context failure mode to chase.

Already covered by existing specs, re-checked rather than re-derived:
field present + sealed ⇒ "Former Codex Prime" renders muted silver
(`tests/ui-ouronet-accounts-tab.test.tsx:429-445`); history present but field
absent ⇒ no designation at all (`:447-461`); sealed-but-unapplied ⇒ nothing
(`:479-501`).

## 2. Is the field absent on a codex finalized before the capture shipped? Yes

Verified with `git log -S legacyPrimeOuroAccountId`:

```
f44f7e3 2026-11-19 feat(codex): Locked medallion across five surfaces, and the Former Codex Prime designation
```

— one commit, both for the wizard
(`packages/codex-ouronet/src/ui/internal/LegacyPrimeMigrationWizard.tsx`) and
for `packages/codex-core/src/codex/masterSeed.ts`. `FORMER_CODEX_PRIME` and
`isLegacyPrimeAccount` landed in the same commit. The plan's citation is exact.

The window in which a codex can be sealed with no record is therefore bounded
and small:

- the wizard's finalize — the only writer of the row — first shipped in
  `237bd96` (2026-11-19, *"legacy prime migration wizard, eligibility sealing,
  and the prime identity model"*);
- `git log 237bd96..f44f7e3` is exactly two commits (`41daa87`, `f44f7e3`), and
  **no release was cut between them** — the only `release:` commit after
  `237bd96` is `77911e6` (`@ancientpantheon/codex` 1.7.0), which has `f44f7e3`
  as an ancestor (`git merge-base --is-ancestor f44f7e3 77911e6` ⇒ true).

So no *published* build can render the designation while lacking the capture.
A codex sealed from the **working tree / playground** during that two-commit
window can — and that is the owner's own development host, which is why this
is the probable case. In `237bd96`-era code the displaced account was
designated from the append-only `formerOuroAccountIds` ("Former Codex Ouronet
Master"), and that list is **absent on a first-ever settlement**
(`recordFormerMasterIds` → `appendDisplaced`, `masterSeed.ts:189-197`, pinned by
`codex-core/tests/master-seed-row.test.ts:100-108`), so a codex sealed then
recorded *nothing* about its predecessor under either name.

**Second possible cause, same symptom, still live.** The capture is
`ouroAccounts.find((a) => a.isPrime)?.id`
(`LegacyPrimeMigrationWizard.tsx:7058-7060`). If no stored account carried
`isPrime` at finalize time — e.g. a very old imported codex; the schema
migrations in `state/migrations.ts` never synthesise the flag, and
`addOuroAccount` only flags the FIRST account (`store.ts:2551`) — the capture
yields `undefined`, the spread at `:7142` omits the field, and the result is
indistinguishable from case 1. It cannot be distinguished after the fact
either, because the promotion then flags the new master and clears everyone
else (`store.ts:2648-2651`).

**How the owner determines which case he is in**, without any new code:
inspect the codex's stored `codexMasterSeed` row (LocalStorage key
`codexMasterSeed`, written whole by
`adapters/LocalStorageCodexAdapter.ts:208-212`, or the codex export, which
carries the row verbatim — `codex-core/src/codex/codec.ts:122-123`):

- `legacyPrimeOuroAccountId` present but the designation still missing ⇒ a
  rendering regression, and this finding is wrong. (Nothing observed suggests
  this; the path is tested.)
- field absent **and** `formerOuroAccountIds` absent ⇒ a first-ever settlement
  that recorded nothing: case 1 or 2, indistinguishable, unrecoverable.
- field absent but `formerOuroAccountIds` present ⇒ the row was written by
  `237bd96`-era code on a codex that had already settled once before; the list
  names candidates, not the one real displacement, which is precisely why the
  tab stopped reading it.

## 3. The design's stated reason is WRONG — the corrected reason

`design.md` §4 says the record is *"**unreconstructable** — the promotion
clears `isPrime` from the old account before anything observes it"*. That
describes a race that does not exist in the code:

```
LegacyPrimeMigrationWizard.tsx:7058-7060   const legacyPrimeOuroAccountId = codexStore?.getState()
                                             .ouroAccounts.find((a: IOuroAccount) => a.isPrime)?.id;   ← CAPTURE
LegacyPrimeMigrationWizard.tsx:7085         await actions.ensurePrimeSeedAccountPairingAndPromote(…)    ← PROMOTE
state/store.ts:2649-2650                      a.isPrime ? a : {…, isPrime: true} / clears every other   ← the clearing
LegacyPrimeMigrationWizard.tsx:7135-7145    await actions.setCodexMasterSeed({ …, legacyPrimeOuroAccountId })
```

The capture is a plain synchronous read of the store, **25 lines and one
`await` boundary ahead** of the promotion that destroys the evidence. The
order is correct, and both call sites are unique in the file. The write is also
safe against re-runs: `setCodexMasterSeed` routes every row write through
`recordFormerMasterIds`, where an already-recorded id wins forever
(`masterSeed.ts:170-171`), and the wizard omits the field entirely when the
finalize re-confirmed the sitting account (`:7142`).

**The real reason an older codex has no record: the field is younger than the
codex.** It did not exist before `f44f7e3`, and nothing else in the tree names
the pre-settlement prime — `formerOuroAccountIds` records displaced *masters*
(`appendDisplaced` only appends `previous?.ouroAccountId`), and a first-ever
settlement has no previous row, so that list is absent too.

Same verdict ("unreconstructable"), different reason, and the difference is
load-bearing: *"the code races itself"* would be a bug to fix now, and *"the
field is younger than the codex"* is not. To stop the design's wrong diagnosis
from ever becoming true, the capture order is now scanned from the source by
`tests/former-prime-provenance.test.ts` — a swap of those two statements fails
the build.

## 4. Backfill verdict: **NO.** `ouroAccounts[0]` is not necessarily the former prime

For it: `kickstartCodex`/recover install the prime ouro account at index 0
(`store.ts:2212-2215`), `addOuroAccount` appends and flags
`isPrime: account.isPrime ?? isFirst` (`:2551`), and
`resolveMasterOuronetAccount` already falls back to `accounts[0]` on an
unsealed codex (`masterOuronetAccount.ts:93`).

Against it, decisively:

1. **The displaced account is deletable after the seal.**
   `deleteOuroAccount` refuses only an account still carrying `isPrime`
   (`store.ts:2571-2575`), the promotion cleared that flag from the displaced
   one, and no rule in `ouronetAccountLock`
   (`codex-core/src/codex/lockedEntities.ts:135-166`) names a former prime
   either — so neither the store nor the row's delete affordance stops it.
   Delete it and `ouroAccounts[0]` names its neighbour, an account that was
   never prime. A backfill would hand that account a retired designation it
   never held. This is proven end-to-end through the public store API in
   `tests/former-prime-provenance.test.ts` ("lets the displaced prime be
   DELETED after the seal…"), including the counterfactual: the predicate
   answers `true` for the mislabelled survivor once the field is backfilled.
2. **Absence is AMBIGUOUS** between two states a backfill cannot tell apart:
   "the finalize displaced nobody" — correct, and it MUST stay absent, which
   is exactly what `isDisplacedHolder`'s `if (id === currentHolderId) return
   false` (`masterSeed.ts:306`) protects — and "the row is older than the
   capture", the lossy one. Note the corollary: when index 0 IS the settled
   master, a backfill is harmless *because* `:306` discards it; the dangerous
   case is precisely the one where the absence is ambiguous.
3. A backfill writes a **guess into a WRITE-ONCE field** (`masterSeed.ts:170-171`).
   It is permanent, it travels in every export (`codec.ts:122-123`), and it is
   never revisited. A wrong designation on an identity surface is worse than
   no designation.

The same objection applies to a write-time fallback for the "no account carried
`isPrime`" case in §2: at finalize the guess is better informed, but it is
still a guess recorded as a fact. Not recommended, and out of scope here.

## 5. Recommendation

**Change nothing.** Accept that codexes sealed before `f44f7e3` show the
displaced account's stored name, keep the designation honest for everything
sealed since, and let `tests/former-prime-provenance.test.ts` hold the capture
order and the no-backfill premise in place.

---

*Line citations follow the same frame as `plan.md` — the working tree during
this round's Wave 1, which already carries a sibling task's additions to
`state/store.ts`. Relative to `4fe4088` (HEAD at the time of writing) the
`store.ts` numbers are 56 lower; every other file is unshifted.*
