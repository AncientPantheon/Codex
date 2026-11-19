# Legacy Prime Migration Wizard — Design

Sub-topic 3 of `docs/work/legacy-prime-migration/design.md`. Read that
document in full first — this one assumes its grounding (the three-option
menu, the real contract-verified sweep mechanics, the vault-floor
constraint, the lock-in rule, and the `primeAlignment`/`Codex-Prime-
Alignment` marker) and focuses specifically on the user-facing wizard: what
each page shows, in what order, and exactly what triggers the fund-moving
sweep. Depends on both other sub-topics landing first
(`stoachain-prime-promotion`, `stoachain-migration-sweep`).

## Problem

The parent design's three-option menu was previously described as always
triggering a fund sweep, regardless of which option was picked. That's
wrong. The real decision tree has TWO separate, independent choices the
user makes — which Ouronet account becomes Prime, and which payment/guard
keys that account uses — and the sweep is triggered by the second
decision, not the first. Getting this sequencing right in the actual UI
is the point of this document.

## Approach — the page flow

### Entry point

The Codex ID page's "Make This Codex Eligible" button (currently a
disabled "coming soon" placeholder) opens this wizard in a popup —
`CodexModalShell`, the same chrome the codex-backup wizard already uses
(`CodexIdPage.tsx`'s own recently-added pattern).

### Page 1 — Why & what

Reuses the Codex ID page's own "Migration" informatics tab content (the
chronology/Koala/Master-Seed explanation, already corrected and shipped).
States plainly, up front: this is irreversible. Once this wizard
completes, the resulting Prime Ouronet Account, Prime Chainweb Seed, and
Prime Arweave Seed are locked — permanently, per the parent design's
lock-in rule.

### Page 2 — Choose the Prime Ouronet Account

Three choices (the account-IDENTITY decision, separate from the key
decision on Page 3). **CORRECTED** (owner correction, this session): the
original version of this section filtered candidates by `SeedType ===
"stoic"` on `IStoaChainSeed` — wrong entity. This page picks a Prime
**Ouronet Account**, not a Chainweb seed; the two are derived
independently (confirmed via `SpawnAccountModal.tsx`: an `IOuroAccount`
can be spawned directly, with no paired Chainweb seed at all, via 7
derivation modes). The real per-account signal for "was this built from
arbitrary, non-dictionary words" is `IOuroAccount.originSeedTab`, stamped
at spawn time:

- `"write-seed"` (DALOS Custom, 4-256 arbitrary words) — the ONE
  non-dictionary-gated word-based mode. **Optimal.**
- `"12-words"` (Chainweaver wordlist) / `"24-words"` (Koala/BIP39
  wordlist) — real, known words, but dictionary-gated. **Sub-optimal, but
  still a genuine candidate** — the user DOES know these words, they're
  just drawn from a constrained dictionary.
- `undefined` (bitmap / bitstring / int10 / int49 direct-key-material
  origin, OR a legacy account that predates this field entirely) — **NOT
  a candidate at all**, excluded from the picker. There are no seed words
  on record for these — nothing to write down, nothing to recover from.
  Owner correction: "those wouldn't be compatible, since we need to know
  the seed words."

Any account with a known word origin (`originSeedTab !== undefined`) is
technically acceptable — the tiering below is a recommendation, not a
filter:

1. **Keep your current account.** No identity change. Tagged RECOMMENDED
   only if the CURRENT account's own `originSeedTab === "write-seed"`.
   **Edge case, flagged for confirmation:** if the current account has
   `originSeedTab === undefined` (no known words at all), keeping it
   never actually achieves true words-only-restore eligibility — the
   wizard's whole purpose. Current plan: keep this option always
   selectable (it's "no change," categorically different from picking a
   candidate) but show an explicit warning in that specific case, rather
   than disabling it outright. Open to revisiting if the owner wants it
   disabled instead.
2. **Choose an existing account with a known word origin.** Lists every
   OTHER account (excluding the current one) whose `originSeedTab !==
   undefined`. Never hidden per-item — each listed account is individually
   tagged RECOMMENDED (`"write-seed"`) or shown plain/sub-optimal
   (`"12-words"`/`"24-words"`). The block itself is hidden only when there
   are zero qualifying OTHER accounts.
3. **Type new words.** Always optimal by construction. Tagged RECOMMENDED
   only when NEITHER the current account NOR any other existing account is
   already optimal (i.e., no existing `"write-seed"` candidate anywhere) —
   no point creating a brand-new, empty, unactivated account when a good
   one already exists. Explicit, impossible-to-miss warnings before the
   user commits:
   - This creates a brand-new Ouronet account that **must be activated
     on-chain** before it's usable — a separate, real transaction.
   - The new account **starts completely empty** — no funds, no history.
     Nothing carries over to it automatically; only the sweep (if
     triggered) moves anything into it.

### Page 3 — Choose the payment key + guard key

**CORRECTED** (owner clarification, this session): the words are NEVER
re-chosen here — they are always exactly whichever words back the Page-2
account (kept, promoted, or freshly typed). Page 3 is purely a
**derivation-method** choice applied to those SAME, fixed words:

- **Stoic Dalos Derivation (default, recommended).** Position 0 derives
  the payment key, position 1 derives the guard key, guard is a
  `keys-all` predicate over both. Always available, always the default.
- **Advanced / native-format derivation (not recommended, clearly
  labeled "advanced").** Offered ONLY when the Page-2 account's own words
  are dictionary-gated (`originSeedTab === "12-words"` or `"24-words"`)
  — derives via that word format's OWN native mnemonic pipeline (e.g.
  `StoaChainWalletBuilder.createWalletPairFromMnemonic`, the same
  function Chainweaver/Koala seeds already use) instead of Stoic Dalos.
  Never offered for a `"write-seed"`-origin account or freshly-typed
  words — there is no "native" dictionary format for arbitrary words to
  fall back to.

There is no longer an "accept the existing keys, unchanged" choice as a
separate branch — every path derives keys from the Page-2 words via one
of the two methods above. **Determining whether a sweep is needed**
(`sweepNeeded`) is therefore a comparison, not a branch: `true` whenever
the derived payment/guard keys differ from whatever currently controls
the chosen account (its existing `guard`/`paymentKeyGuard`); `false` only
in the (likely common) case where the Page-2 choice was "keep your
current account" AND its derived keys happen to already match what's
currently in force — i.e. nothing actually needs to move.

**Full transparency, always:** the page shows plainly which words and
which derivation path produced the keys in play. Never a black box.

**This is also where the Prime Chainweb Seed gets established**: deriving
keys here (either method) requires a real `IStoaChainSeed` holding these
exact words. If the Page-2 account has no seed already paired to it via
`parentSeedId` (the common case for an account spawned directly via
`SpawnAccountModal.tsx`, with no Chainweb seed at all), Finalize (Page 7)
creates one from these words and links it — `updateOuroAccount` already
supports freely setting `parentSeedId` post-hoc, confirmed; no new store
primitive needed for this.

### Page 4 — The sweep plan (only when new keys were chosen)

An itemized list of every real operation about to run, grounded in the
parent design's contract-verified mechanics — never described as "a
single transaction":

- Per-chain native STOA found on the old payment key and old guard key,
  and the plan to aggregate to chain 0, then transfer to the new keys.
- urSTOA found (free, staked, and claimable) on both old keys, and the
  unstake → collect → transfer → restake sequence that will run under
  the new payment key.
- Explicit source → destination pairing for every amount.

Requires an explicit "confirm and proceed" — never an implicit default.

### Page 5 — Executing the sweep (only when Page 4 ran)

A checklist, not a single progress bar — one row per real transaction
(pending → signing → confirmed/failed), since these are discrete named
steps, not a continuous stream. The vault-floor constraint
(`vault-remaining >= 1.0` URSTOA globally, confirmed against the live
contract, undocumented anywhere in this repo's own dependency tree) shows
inline, specifically, if it reverts an unstake — never silently absorbed,
never retried blindly.

**Open question, not yet settled (flagged, not guessed at):**
resumability. This page runs multiple real, sequential transactions — if
the browser closes or crashes partway through, does the wizard need to
detect an in-progress sweep and resume from real on-chain state, or is
a from-scratch re-run (re-checking balances, skipping whatever already
moved) safe enough on its own? Needs a decision before this page is
built — see "Open questions" below.

### Page 6 — Verify (only when Page 4/5 ran)

Re-reads both old keys' balances after the sweep. Confirms zero for
everything that should have moved, or reports precisely what didn't and
why (the vault-floor case, or anything else unexpected) — never silently
dropped.

### Page 7 — Finalize

Always runs, regardless of which path got here:

1. If the Page-2 account has no Chainweb seed already paired to it (the
   common case), creates one from the Page-3-derived words/method and
   sets `parentSeedId` on the account via `updateOuroAccount` (confirmed
   this session: no restriction on mutating that field post-hoc).
2. Calls `promoteSeedAndAccountToPrime` (`stoachain-prime-promotion`) for
   that now-guaranteed-paired seed+account pair.
3. **Ensures the Prime Arweave Seed matches the Master Seed words**
   (owner clarification, this session — "the crux of the eligibility
   process"): confirmed this session that a structurally-current codex
   CAN genuinely have zero Arweave seeds at all (`arweaveSeeds: []` is a
   codex's real default, never required by the Structural Migration
   Engine) — so this is frequently the step that adds the Prime Arweave
   Seed for the first time, not merely reconciling an existing one.
   - If an existing Prime Arweave Seed already decrypts to these EXACT
     Master Seed words, nothing changes.
   - If one exists but was derived from DIFFERENT words (doesn't "fit"),
     a NEW Arweave seed is added from the Master Seed words instead of
     overwriting/discarding the mismatched one — same
     non-destructive, additive discipline `addArweaveSeed` already
     enforces (exactly-one-Prime invariant aside, both can coexist as
     ordinary seeds; only one is ever `isPrime`).
   - If none exists at all, one is created and installed as Prime —
     reusing the EXISTING generic keygen-at-index mechanism
     (`runSeededBatch`/`ArweaveSeedsArea.tsx`'s own "Generate" flow, the
     same one `kickstartAndInstallPrimeArweaveSeed` already uses for a
     fresh codex's position 0) — filling in whichever of position 0 and
     position 1 don't already exist for this seed. Nothing new to build
     for the keygen itself; straight reuse of an already-shipped
     capability.
4. Stamps `primeAlignment: "aligned"` on the codex — the lock-in, per the
   parent design's own rule.
5. Success screen, with an explicit reminder: the Prime trio is now
   permanently locked.

## Open questions

- **Sweep resumability** (Page 5, above) — the one genuinely undecided
  design question left. Needs an explicit answer before Page 5 gets
  built; everything else in this flow is grounded enough to build
  straight from this document plus the parent design.

## Acceptance criteria

- [ ] Page 2 and Page 3 are genuinely separate decisions — choosing to
      keep/promote an account never implies a specific key choice, and
      vice versa.
- [ ] "Type new words" (Page 2) always shows the activation-required and
      starts-empty warnings before the user can proceed past it.
- [ ] The "promote existing account" picker (Page 2) lists every OTHER
      `IOuroAccount` (excluding the current Prime one) whose
      `originSeedTab !== undefined` — i.e. a known word origin exists,
      regardless of which account (if any) it's paired with via a Chainweb
      seed. An account with `originSeedTab === undefined` (direct-key-
      material origin, or a legacy account predating this field) never
      appears, even sub-optimally — there are no recoverable words for it.
- [ ] Within that picker, each listed account is tagged RECOMMENDED when
      `originSeedTab === "write-seed"`, or shown plain/sub-optimal when
      `"12-words"`/`"24-words"` — both are genuine, clickable candidates,
      never hidden based on tier.
- [ ] "Keep your current account" (option 1) is tagged RECOMMENDED only
      when the CURRENT account's own `originSeedTab === "write-seed"`; it
      shows an explicit warning (not a hidden/disabled state) when the
      current account's `originSeedTab === undefined`, since keeping it
      would complete the wizard without achieving true words-only-restore
      eligibility.
- [ ] "Type new words" (option 3) is tagged RECOMMENDED only when neither
      the current account nor any other existing account already has
      `originSeedTab === "write-seed"`.
- [ ] Whichever keys are in play (Page 3), the words and derivation path
      that produced them are shown, not hidden.
- [ ] Page 3 never re-prompts for words — the words are always exactly
      whichever ones back the Page-2 account. Only the derivation METHOD
      (Stoic Dalos vs. the dictionary-native "advanced" alternative) is
      chosen here.
- [ ] The "advanced" derivation option on Page 3 is offered ONLY when the
      Page-2 account's own `originSeedTab` is `"12-words"` or
      `"24-words"` — never for `"write-seed"` or freshly-typed words.
- [ ] The sweep (Pages 4-6) is skipped entirely when the Page-3-derived
      keys match whatever currently controls the chosen account —
      confirmed by NOT calling any fund-moving function in that case.
- [ ] The sweep plan (Page 4) never describes a multi-step/cross-chain
      operation as "a single transaction."
- [ ] Page 7 first ensures the Page-2 account has a paired Chainweb seed
      (creating one from the Page-3 words/method and setting
      `parentSeedId` via `updateOuroAccount` if none exists), then runs
      `promoteSeedAndAccountToPrime` for that pair.
- [ ] Page 7 ensures the Prime Arweave Seed decrypts to the exact Master
      Seed words — reusing a correctly-matching existing one unchanged,
      adding a new one (not overwriting a mismatched one) when the
      existing Prime Arweave Seed's words differ, or creating one from
      scratch when none exists at all (confirmed possible: a
      structurally-current codex can have zero Arweave seeds).
- [ ] Page 7 stamps `primeAlignment: "aligned"` only after the above
      steps succeed — atomically with the lock-in, never before.

## Out of scope

- The sweep's own internal mechanics (contract call sequencing, vault-
  floor detection) — `stoachain-migration-sweep`'s job; this document
  only decides WHEN the wizard triggers it.
- The prime-promotion action's own internal validation — `stoachain-
  prime-promotion`'s job; this document only decides WHEN the wizard
  calls it.
- Resumability's actual answer — flagged above as still open.
