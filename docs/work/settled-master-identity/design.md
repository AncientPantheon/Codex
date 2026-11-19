# Settled Master Identity — Design

Follow-up to `docs/work/codex-master-seed-model/design.md`, which established
the Codex Master Seed concept and its persisted `codexMasterSeed` row. That
row now gets written by the eligibility wizard — but nothing downstream reads
it to decide *who the master is*. Precedes
`docs/work/migration-completion/design.md`'s topic 2
(`arweave-master-accounts`), because both of the problems below make testing
that work slower and its results read wrong.

## Problem

Two defects, both rooted in the same thing: **the account the wizard settled
as master is not the account the rest of the app treats as master.**

1. **It still shows its old name.** After the wizard settles AncientHodler as
   the Ouronet Codex Master, every screen keeps calling it "AncientHodler".
   The name comes from `masterOuronetAccountName(index, storedName,
   explicitName)` in `packages/codex-core/src/codex/masterNames.ts`, whose
   rule is purely positional:

   ```ts
   if (index === 0) return OURONET_CODEX_MASTER;
   ```

   Whichever account happens to sit at list index 0 gets the master name —
   settling a *different* one changes nothing. Owner: *"The former
   AncientHodler Account must be the Ouronet Codex Master, because that is
   what the Wizard settled… It must [not] appear as AncientHodler any more
   but as Ouronet Codex Master (beneath it its former name)."*

   This is the same positional assumption that already caused trouble in
   `CodexIdPage.tsx` (`currentPrimeAccount = allAccounts[0]`), whose own
   comment records four rounds of getting it wrong.

2. **Selecting an account is slow, for no necessary reason.** The Settling
   Dashboard's blue ticker waits on `resolveAccountSeedId`, which never
   consults `IOuroAccount.parentSeedId` — the field that literally records
   *"ID of the IStoaChainSeed this account was derived from"*. Instead it
   brute-forces: decrypt the account's secret, then **decrypt every candidate
   seed in turn**, comparing bitstrings until one matches. Each decrypt is
   PBKDF2 at **600,000 iterations**, deliberately slow, run **serially**. With
   N seeds that is up to **N+1** of them before the ticker can light. Owner:
   *"why is there a latency period between when i choose the Ouronet Account
   and when the Blue square gets light up? i dont get it?"*

## Approach

### 1. Naming becomes identity-first, positional only as fallback

`masterOuronetAccountName` gains the ability to answer "is THIS account the
settled master?" from `codexMasterSeed.ouroAccountId`, and uses position only
when no master has been settled (a codex that never ran the wizard, which must
keep behaving exactly as it does today).

Applied at **all three** display sites that share this helper, so one account
can never read under two different names depending on where you are:
`OuronetAccountsTab` (the account rows), and the ZBOM `StoicTagPicker` and
`AddressBookPicker` dropdowns.

Presentation differs by the room available, which is a deliberate split:

- **Account rows and the Codex ID card** — name reads `Ouronet Codex Master`,
  with the former name (`AncientHodler`) rendered beneath it as secondary
  text. The former name is never destroyed, only demoted.
- **The two dropdowns** — one line only, so `Ouronet Codex Master
  (AncientHodler)` inline rather than inventing a two-line option.

An account with no prior name of its own simply shows `Ouronet Codex Master`
with nothing beneath.

### 2. `parentSeedId` reorders the search; it never replaces verification

`resolveAccountSeedId` tries the seed named by `account.parentSeedId`
**first**, then falls through to the existing full scan. The decrypt-and-
compare that proves the match is **unchanged** — the claimed parent is still
verified before it is believed.

This is deliberate, and it is the whole design. `parentSeedId` is a
provenance stamp written at account-creation time — structurally identical to
`originSeedTab`, which this very wizard already learned the hard way is
*"never derived from, or verified against, the actual stored secret"* and
misreports both ways on real codices. Trusting it as a shortcut would re-run
that bug with worse consequences (wrong seed attribution on a funds-bearing
account). Reordering costs nothing if the stamp is stale or absent — it just
falls through to today's behaviour — while collapsing the common case from
**N+1** decrypts to **2**.

Additionally, each seed's decrypted bitstring is **memoised for the wizard's
lifetime**. Seeds cannot change mid-run, so re-deriving them on every account
switch is pure waste; this is what makes switching between accounts
near-instant after the first pass.

### Alternatives considered

- **Trust `parentSeedId` outright and skip the decrypt** — rejected above:
  an unverified provenance stamp deciding seed attribution is precisely the
  `originSeedTab` failure, and this one would mis-attribute funds-bearing
  keys.
- **Rename the stored account to "Ouronet Codex Master"** — rejected: it
  destroys the former name the owner explicitly wants kept visible, and it
  makes a display concern irreversible in persisted data.
- **Fix naming only on the Codex ID card** — rejected (owner's own pick):
  leaves the account rows and both dropdowns disagreeing about the same
  account's name.
- **Parallelise the candidate decrypts instead of reordering** — rejected:
  N parallel 600k-iteration PBKDF2 runs is a UI-freezing thundering herd, and
  it still does N times the work to learn one answer.

## Acceptance criteria

- [ ] After the wizard settles an account as master, that account's rows show
      `Ouronet Codex Master`, with its former name beneath it.
- [ ] The same account reads `Ouronet Codex Master (<former name>)` in the
      StoicTag and AddressBook pickers.
- [ ] An account that was never settled as master, in a codex that never ran
      the wizard, is named exactly as it is today (position 0 still wins).
- [ ] Settling a master that is NOT at list index 0 moves the master name onto
      it, and off whichever account held it positionally.
- [ ] A chosen account whose `parentSeedId` names the correct seed lights the
      blue ticker after at most two decrypts.
- [ ] A chosen account whose `parentSeedId` is absent, stale, or names the
      wrong seed still resolves to the correct seed, by full scan.
- [ ] Switching back to a previously-resolved account does not re-decrypt any
      seed.

## Out of scope

- Renaming or reordering any stored entity. This changes how the master is
  *displayed* and how its seed is *found*, never what is persisted.
- Changing `codexMasterSeed`'s shape, or who writes it —
  `codex-master-seed-model` stays authoritative for that.
- The Arweave face of the master (`arweave-master-accounts`, the next topic).
- Making `parentSeedId` trustworthy, or backfilling it on legacy accounts —
  this design deliberately assumes it may lie.
