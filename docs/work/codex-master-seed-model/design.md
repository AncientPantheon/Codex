# Codex Master Seed — Naming Model, Lock Model, and Eligibility Scope

Owner spec, this session. Supersedes the "Prime" naming used across the
codex and extends `docs/work/prime-payment-and-guard-step/design.md`.
Parent context: `docs/work/legacy-prime-migration-wizard/design.md`.

## Problem

Three separate concepts in this codex are all derived from ONE set of seed
words, but they are named inconsistently ("CodexPrime", "Prime Codex Seed",
"Prime Arweave Seed"), stored as three unrelated entities, and never
presented as the single thing they actually are. There is no row in the
codex format that says "this is the seed this codex is built on".

Separately, the owner's eligibility flow needs certain seeds and certain
derived key POSITIONS to become non-removable. The owner believes tags for
this already exist. For seeds that is true; **for key positions it is not**
(see "Lock model" below) — and a boolean flag is the wrong shape for what
the flow actually requires.

## The Master Seed model

One seed-word set → one 1600-bit DALOS bitstring → three deterministic
derivations, all via Stoa Dalos:

| # | Derivation | Cardinality | New name |
|---|---|---|---|
| 1 | Ouronet account | singular | **Ouronet Codex Master** |
| 2 | Chainweb keys (positions 0,1,…) | multiple, deterministic | **Master Chainweb Seed** |
| 3 | ArWeave accounts | multiple, deterministic | **Master ArWeave Seed** |

Collectively these are the **Codex Master Seed** — a new first-class
concept that gets its own section on the Codex ID page and **its own row in
the codex format (a new persisted field; does not exist today)**.

Rationale, in the owner's words: the seed is the same, only its uses
differ. Every future chain added to the codex derives its addresses from
this one seed.

### Rename table

| Concept | Current display name | New display name |
|---|---|---|
| The master Ouronet account | `CodexPrime` | Ouronet Codex Master |
| The master Chainweb seed | Prime Codex Seed | Master Chainweb Seed |
| The master ArWeave seed | Prime Arweave Seed | Master ArWeave Seed |
| The three, as one thing | *(no name)* | Codex Master Seed |
| The codex's StoaChain identity | Codex ID / Codex Identity | **Codex Stoic Identity** |

**Scope decision — DISPLAY ONLY.** Internal identifiers (`isPrime`,
`primeAlignment`, `CodexPrimeProtectedError`,
`promoteSeedAndAccountToPrime`, `kickstartPrimeArweaveSeed`) are NOT
renamed. Renaming persisted field names would be a codex-format migration
with zero user-visible benefit, on top of a format change this project is
already mid-way through (`Codex_Shape_Version`). The one genuinely new
persisted thing is the Codex Master Seed row itself.

**One rename is DATA, not display:** `store.ts:1072` writes
`name: "CodexPrime"` as the stored account name at kickstart. Renaming it
changes what new codices persist, so old and new codices would disagree —
the display layer must therefore resolve the master account positionally
(as `OuronetAccountsTab.tsx:503` already does) rather than by matching the
stored string.

**Measured rename surface: 46 files** contain these literals, mostly as
repeated inline strings — e.g. `accounts.indexOf(acc) === 0 ? "CodexPrime"
: …` duplicated across `RotatePaymentKeyModal.tsx:138`,
`RotateGuardModal.tsx:120`, `RevokeDualLinkModal.tsx:199`,
`ReleaseStoicTagModal.tsx:145`, `AddressBookPicker.tsx:54`,
`ActivateStandardAccountModal.tsx` (×6). There is no single source of
truth. **The rename must therefore introduce exported name constants
FIRST**, then replace call sites — otherwise the names drift apart again
exactly as they already have.

*Spelling — deliberate.* **ArWeave**, intercapital, confirmed by the owner:
"ar" for *archive* and "weave" for the woven structure of its ledger, which
is not technically a blockchain. This is the project's own spelling for the
Master ArWeave Seed and is NOT to be auto-corrected to "Arweave". Existing
strings elsewhere in the repo spell it "Arweave"; those are not in this
rename's scope and stay as they are until separately decided.

## Lock model — the part that does not exist yet

### What actually exists today (verified, not assumed)

| Entity | Flag | Blocks deletion? |
|---|---|---|
| `IStoaChainSeed` | `isPrime` (`entities.ts:89`) | **Yes** — `CodexPrimeSeedProtectedError` |
| `IOuroAccount` | `isPrime` (`:284`) | **Yes** — `CodexPrimeProtectedError` |
| `IOuroAccount` | `hasEncryptedArweaveUpload` (`:308`) | **Yes** |
| `IPureKeypair` | `isCodexGuard` / `wasCodexGuard` / `isDuoPurePrime` | **Yes** |
| `IArweaveSeed` | `isPrime` (`:156`) | **No — deliberately** |
| **`WalletAccount` (a key POSITION)** | **none** | **No — nothing exists** |

```ts
export interface WalletAccount {   // entities.ts, verbatim — no lock field
  index: number;
  publicKey: string;
  derivationPath: string;
  guard?: string[];
}
```

Worse, position removal does not go through a delete action at all. It goes
through `updateStoaChainSeed` (`store.ts`), which is a blind replace:

```ts
async updateStoaChainSeed(seed: IStoaChainSeed) {
  const next = get().kadenaSeeds.map((s) => (s.id === seed.id ? seed : s));
  set({ kadenaSeeds: next });
  await persistAndTouch((a) => a.saveStoaChainSeeds(next));
},
```

The "Cannot delete first key of Prime seed" affordance
(`SeedWordsTab.tsx:353`) only *disables a button*. **Position locking today
is cosmetic.**

### Why a boolean tag is the wrong shape

The owner's own requirements rule it out:

1. *"a custom keyset … 5 of 7 over multiple keys of multiple seeds"* — the
   locked set spans **many seeds at many positions**. `isPrime` designates
   one prime seed; it cannot express this.
2. *"when that namespace keyset would change, so too should the not-remove
   tags of seeds and keys"* — locks must be **released**, not only added.
   A bare boolean carries no provenance, so nothing can tell whether a
   position is still locked for some *other* reason. Releasing it blindly
   would silently unlock something another rule still needs.

### The model this design adopts

A lock is a **reason-tagged, recomputable** entry, not a flag:

```
{ seedId, position, reason }
  reason ∈ "master-payment-key" | "master-guard-key"
```

- Adding a lock records WHY.
- "Secure Master Account" RECOMPUTES the whole set and releases entries
  whose reason no longer holds — safe precisely because provenance is
  recorded.
- A position stays locked while ANY reason still applies.

Enforcement must live in the **store**, not the UI: `updateStoaChainSeed`
must reject an update that drops a locked position, and
`deleteStoaChainSeed` must reject a seed holding one. Proven by tests that
call the store directly.

## Guard handling — settled

Three options, by what the account's current guard is:

1. **Recommended** — `keys-all` over the single position-#1 key of the
   Master Seed (Stoa Dalos). Matches the convention already in production
   at `ActivateStandardAccountModal.tsx:212-223`.
2. **Custom keyset** (advanced) — any keys the codex holds, any predicate.
3. **Keep the existing keyset as is**, including a namespace keyset.

**Namespace keysets are never modified by this migration** (owner
decision). Instead the migration *unpacks* the keyset, finds which of its
keys live in this codex, and **locks those seeds and positions**. Changing
the on-chain keyset is explicitly out of scope; the user re-runs "Secure
Master Account" afterwards to re-sync the locks.

## Secure Master Account — a new, user-triggered action

Deliberately manual, because the chain can change without the codex
knowing. It:

1. Reads the Ouronet Codex Master's payment key and guard (unfolding a
   keyset reference).
2. Maps every key found back to a `(seedId, position)` in this codex.
3. Adds locks for what is now in use; releases locks whose reason lapsed.
4. Reports exactly what changed — never silently.

## Payment key — current scope

Position #0, rendered as a `k:` account. The chain supports any account
type as the payment key provided the codex holds spendable keys for it;
**UI support for other account types is explicitly deferred**, not denied.

## Codex Stoic Identity + Arweave restore

### What is ALREADY built (better than the spec assumed)

The dual-source backup envelope exists and is unit-tested. Every codex
backup already wraps its two data keys under **both** sources:

```ts
export type BackupUnlockSource = "masterSeed" | "standardApollo";  // flow.ts:1476
```

- A fresh IDEK + EDEK per upload; IDEK re-encrypts the three secret
  fields, EDEK encrypts the whole export (`flow.ts:1414-1468`).
- Each key is wrapped under the Master Seed's 1600-bit bitstring AND the
  Codex Identity's Standard-half 1024-bit bitstring.
- Four tags are posted: `Codex-Backup-{IDEK,EDEK}-{MasterSeed,StandardApollo}-Default`
  (`arweave-core/src/upload/tags.ts:163-186`), plus `-Pin` variants.
- `restoreCodexFromBackupEnvelope({ source, bitstring, … })` exists
  (`flow.ts:1695`).

So the owner's "two ways to restore" is **already true at the crypto
layer**. The Standard Apollo half is exactly the "optional path".

### The three gaps that make path 2 impossible today

1. **There is no restore flow at all.**
   `restoreCodexFromBackupEnvelope` has **zero callers** and is not
   exported from the package barrel. The product already says so:
   `CodexBackupInformatics.tsx:73` — *"There is no restore screen yet to
   do this with."*
2. **The Stoic Identity can DECRYPT but cannot LOCATE.** Finding a backup
   means querying Arweave by owner address (`queryOwnerUploads`), and that
   address derives **only** from the Master Seed's Arweave account at
   index 0. The Standard Apollo half unlocks a backup you have already
   found; it cannot find one.
3. **No backup carries the identity at all.** `deriveBackupLineage` sets
   `Codex-App-Id` from `codexIdentity.formatted` (`flow.ts:946`), but
   `buildBackupPayload`/`buildCodexExport` **never emit `codexIdentity`**
   (a deliberate privacy decision, `codec.ts:174`). So that tag is never
   written, and nothing on-chain identifies which codex a backup belongs
   to.

Consequence: **"restore via Stoic Identity" needs an INDEX, not more
crypto** — somewhere that maps an identity to its backup locations. A
prior design already identified and deferred exactly this
(`codex-backup-envelope-encryption/design.md:245-250`: *"Storing Arweave
backup links on StoaChain under the Codex Identity — the 'find my backups
via Codex ID alone' index"*). That is the real work behind the owner's
optional path.

### Identity status, for the record

The Codex Stoic Identity is **local-only**. Nothing reaches any chain:
`buildRegisterCodexIdentityTx` (`store.ts:2427`) is an explicit
placeholder with no caller, and the "Define Codex Identity" button
(`ObservationalCodexId.tsx:442`) is permanently disabled because
`onDefineIdentity` is never supplied by either mount. The only live path
that creates an identity is `kickstartCodex` on a brand-new codex.

## Acceptance criteria

- [ ] The three master names appear from single exported constants, and no
      inline `"CodexPrime"` literal remains in the renamed surfaces.
- [ ] The Codex ID page shows a Codex Master Seed section naming all three
      derivations of the one seed.
- [ ] The codex format carries a Codex Master Seed row that survives an
      export → import round trip.
- [ ] A locked key position cannot be removed **via a direct store call**,
      not merely via a disabled button.
- [ ] A locked seed cannot be deleted via a direct store call.
- [ ] Choosing "keep the existing keyset" locks every seed+position whose
      key appears in that keyset, including an unfolded namespace keyset.
- [ ] "Secure Master Account" both adds new locks and releases lapsed ones,
      and reports the delta.
- [ ] The informatics explainer states the Master Seed threefold model, the
      Codex Stoic Identity, and both Arweave restore paths — including,
      honestly, that no restore screen exists yet.
- [ ] A backup records which codex it belongs to, so an identity-based
      lookup has something to match on.

## Out of scope

- Modifying any on-chain namespace keyset.
- Renaming persisted internal fields/flags.
- UI support for non-`k:` payment-key account types.
- The fund sweep itself (wizard pages 4-6).

## Topics

1. `master-naming-constants` — exported name constants + display rename
   across the 46-file surface; informatics explainer rewrite.
2. `codex-master-seed-row` — the new persisted codex-format field, Codex ID
   section, export/import round trip.
3. `position-lock-invariant` — reason-tagged lock entries + real store
   enforcement in `updateStoaChainSeed` / `deleteStoaChainSeed`.
4. `secure-master-account` — the rescan/reconcile action and its report.
5. `step3-guard-and-payment` — the wizard Step 3 UI itself (see the
   sibling `prime-payment-and-guard-step/design.md`).
6. `arweave-identity-restore` — the optional Codex Stoic Identity restore
   path. NOTE: the envelope crypto is already built; the missing pieces
   are (a) any restore flow at all, (b) an identity→backup INDEX so the
   identity path can locate a backup, and (c) emitting an identifier into
   the backup in the first place. Largest and least-ready topic.
