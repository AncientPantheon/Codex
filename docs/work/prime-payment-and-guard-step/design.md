# Prime Payment Key & Guard (Wizard Step 3) — Design

Supersedes the "Page 3" section of
`docs/work/legacy-prime-migration-wizard/design.md`, which modelled this
step as a single derivation-METHOD radio. Owner spec, this session.

## Problem

Step 3 today asks one question — Stoic Dalos vs Advanced native derivation —
and renders two static sentences. It never shows what the account's keys
*currently* are, never distinguishes the payment key from the guard, offers
no way to keep either unchanged, and has no advanced path at all.

The owner's correction: Step 3 settles **two independent things** — the
**payment key** and the **guard** — and each needs its current value shown
(with the guard's keyset references unfolded), a recommended option, a
"keep as is" option, and for the guard, advanced options.

### Ground truth from the owner's real codex (43 accounts, 10 seeds)

Measured directly from `OuronetCodex_v1.0.0_2026-10-27T…json`, not assumed:

| Guard shape | Count |
|---|---|
| `null` / absent | **31** |
| `{pred, keys}` — direct keyset | 10 |
| `{pred, keys, keysetRef}` — direct keyset annotated with its origin ref | 2 |

- Predicates actually in use: `keys-any` ×9, `keys-all` ×3.
- One guard holds **13 keys**; eight hold 2; three hold 1.
- **`isPrime` is set on 0 accounts and `parentSeedId` on 0 accounts.**
- Seed `[0] "Initial Seed"` is `koala`, `isPrime: true`, 11 positions.
- The owner's quoted FROM key `35d9be77…e54f` is **"Initial Seed" Key #0**,
  and it currently appears inside `AncientHodler`'s guard under `keys-any`
  over 2 keys.

Three consequences the spec did not account for:

1. **"Keep as is" is the majority case for the guard** — 31 of 43 accounts
   have no guard at all. The UI must state that honestly rather than
   rendering an empty keyset.
2. **A guard is not two-shaped, it is five-shaped.** `GuardTree.tsx:23-42`
   already models the real runtime union: `KeysetGuard`, `KeysetRefGuard`
   (`{keysetref:{ns,ksn}}`, lowercase/nested — a shape `IKeyset` cannot even
   represent), `CapabilityGuard` (`cgName`), `UserGuard` (`fun`), plus
   `null`. `IOuroAccount.guard: IKeyset | null` is a **lie about runtime** —
   `OuronetAccountsTab.tsx:95-100` casts chain data straight in.
3. **`IKeyset.keysetRef` (camelCase string) and `KeysetRefGuard.keysetref`
   (nested object) are different things.** The first is a direct keyset that
   remembers its origin; only the second is an actual
   `(keyset-ref-guard …)`. The owner's 2 "reference" accounts (`DALOS`,
   `HOV`) are the **first** kind — they already carry resolved keys.

## Approach

One step, two ordered sections, matching the owner's own numbering:
payment key first, then guard. Each section shows CURRENT → CHOICE → RESULT.

### Section 1 — Payment key

- **Display current**: the account's payment key and its ties — which seed
  and which position back it (`"Initial Seed" · Key #0`), via the existing
  `MeasuredHexHighlight` primitive already used at
  `LegacyPrimeMigrationWizard.tsx:1909`.
- **Options**: `Keep as is` / `Stoa Dalos derivation, position 0`
  (RECOMMENDED).
- **Result**: an explicit `FROM <old> → TO <new>` pair, always rendered once
  a choice is made; for `Keep`, FROM and TO are the same value and it says so.

### Section 2 — Guard

- **Display current** via the existing `GuardTree` renderer (it already
  handles all five shapes, `null` included). For a true `KeysetRefGuard`,
  expand it — see the gap below.
- **Default options**, exactly two, picked by what the current guard is:
  - current is a **direct keyset** → "Upgrade this keyset to `keys-all` over
    your position-1 key".
  - current is a **keyset reference** → "Upgrade this reference to
    `keys-all` over your position-1 key".
  - plus **Keep as is**, always.
- **Advanced**: (a) define a custom keyset — any keys, any predicate; (b)
  re-point an existing keyset reference at a key the user names.

### Why position 0 pays and position 1 guards, alone

Not a new rule — the convention is already in production at
`ActivateStandardAccountModal.tsx:212-223`:

```ts
const primeKey0 = kadenaSeeds[0]?.accounts?.[0]?.publicKey ?? "";
const primeKey1 = kadenaSeeds[0]?.accounts?.[1]?.publicKey ?? "";
const autoStoaChainAddr = primeKey0 ? `k:${primeKey0}` : "";        // payment
const effectiveGuardKeys = autoMode ? (primeKey1 ? [primeKey1] : []) : …;  // guard
const effectiveGuardPred = autoMode ? "keys-all" : …;
```

and `store.ts:2239-2241` already derives exactly this pair. This design
therefore **corrects** the current Step 3 copy ("a keys-all guard over
both"), which is the thing that is out of step, to `keys-all` over the
single position-1 key.

### Alternatives rejected

- *Split into two wizard pages.* Rejected: the owner said "this is what
  should be on step 3", and splitting would renumber every "Step 3 of 3"
  assertion in the existing suite for no user benefit.
- *Reuse `GuardEntryInput` wholesale for the recommended path.* Rejected
  for the default options: the recommendation is a single computed keyset,
  not something to hand-edit. `GuardEntryInput` is used only behind
  "Advanced", where hand-editing is the point.
- *Model the guard as `IKeyset | null` as the types claim.* Rejected: it is
  provably wrong at runtime. Read through `PactGuard`/`detectGuardKind`.

## Real gaps this uncovers (new work, not reuse)

1. **Nothing expands an account's keyset reference.** `describeKeyset()` is
   wired only into the editor tab (`inputs.tsx:929-942`). There is no
   function taking `{keysetref:{ns,ksn}}` → `{pred,keys}`. Needed for
   "unfold it and get the keys it references". Must degrade honestly when
   the chain read fails — show the ref, state it could not be resolved,
   never render a confident empty keyset.
2. **The custom-keyset builder cannot pick wallet keys.** The spec says
   "all the keys he has in wallet"; `GuardEntryInput`'s Define tab is
   free-text 64-hex entry only. Needs a picker mirroring
   `AddressBookPicker.tsx`, which already groups ouro accounts / seeds /
   pure keys.
3. **`IKeyset.pred` is narrower than the predicate list.**
   `entities.ts:57` allows `"keys-all" | "keys-any" | "keys-2"`;
   `GuardEntryInput` offers 17 (incl. 14 `stoa-ns.stoic-predicates.*`).
   Choosing a Stoic predicate cannot currently be persisted.
4. **The position lock the owner wants does not exist in state.**
   `SeedWordsTab.tsx:353` disables the delete button for
   `isPrime && index === 0` — **UI only**. Removal actually flows through
   `updateStoaChainSeed` (`store.ts:1606-1610`), a blind whole-object
   replace with no guard whatsoever. The lock is therefore cosmetic today.
5. **Seed deletion cascades.** `deleteStoaChainSeed` (`store.ts:1592`) also
   deletes every account whose `parentSeedId` matches. Only `isPrime` seeds
   are protected — so if the payment key is ever taken from a non-prime
   seed, nothing stops its removal.

## Open question — must be answered before the guard section is built

**What does "upgrade a keyset reference" mean on chain?** A
`(keyset-ref-guard "ouronet-ns.dh_hov-keyset")` points at a *named, shared*
keyset. Two incompatible readings:

- **(A) Rotate this account's guard to a direct keyset**, abandoning the
  reference. Affects only this account. Safe.
- **(B) Redefine the named keyset on chain**, so the reference now resolves
  to the new key. Affects **every account and contract pointing at that
  name** — for `ouronet-ns.dh_sc_dalos-keyset` that is potentially system-wide.

These are not variants of one action; (B) is a blast-radius decision.
Not guessed at.

## Acceptance criteria

- [ ] Step 3 shows the current payment key together with the seed name and
      position that back it, for a real account in the owner's codex.
- [ ] Step 3 shows the current guard rendered by shape, and says
      "no guard" plainly for the 31 accounts that have none.
- [ ] A true keyset-reference guard is expanded to its keys and predicate;
      when the chain read fails the UI says so and shows the raw ref.
- [ ] Both the payment-key and the guard section offer "Keep as is", and
      choosing it produces no key change for that half.
- [ ] The recommended guard is `keys-all` over the single position-1 key,
      and the recommended payment key is the position-0 key.
- [ ] After choosing, a `FROM … → TO …` pair is displayed for the payment
      key, with both values fully visible (truncated, not overflowing).
- [ ] Advanced lets the user build a custom keyset from keys already in the
      wallet, choosing any predicate offered, and that choice persists.
- [ ] Once a payment key is locked in, the backing seed cannot be deleted
      and its position 0 cannot be removed — enforced in the STORE, proven
      by a test that calls the store directly, not via the UI.

## Out of scope

- The sweep itself (Pages 4-6) — unchanged by this topic.
- Reading live on-chain balances for the old keys.
- Option (B) of the open question, unless explicitly chosen.

## Topics

1. `prime-guard-current-state` — read + render the current payment key,
   its ties, and the current guard incl. reference expansion. Read-only;
   ships value on its own and de-risks everything after it.
2. `prime-keys-choice-ui` — the two-section choice UI, Keep/Recommended,
   and the FROM → TO display.
3. `prime-keys-lock-invariant` — store-level enforcement of seed
   non-deletion and position-0 non-removal, closing the cosmetic-only gap.
4. `prime-guard-advanced` — custom keyset w/ wallet-key picker, predicate
   widening, and the keyset-reference re-point (pending the open question).
