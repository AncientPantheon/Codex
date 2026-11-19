# Wizard Seed Dashboard — Design

## Problem

The migration wizard already shows, per step, a Current/Settled-for box for the
account, payment key, and guard choice individually — but nothing shows the user
the one thing that actually determines eligibility: **which seed(s), among all the
ones in this codex, back each of those choices, and whether the Prime Arweave
address shares origin with the chosen Ouronet account's seed.** A user juggling
several seeds (an old legacy one, a freshly typed one, an imported one) has no way
to see at a glance "my account and my Arweave address trace back to the same
words" vs. "they don't — I'm not actually eligible yet."

## Approach

Add a `SeedDashboard` region, rendered directly below the sticky nav rectangle
(`navRow()`) on every step except `intro` (nothing is chosen yet) — i.e. on
`account`, `payment`, `guard`, `review`, `finalize`. One rectangle per **distinct
seed that is actually backing at least one of the four roles below** — a seed with
nothing attributed to it is omitted, matching the owner's own 3-rectangle example
(not every seed in the codex is shown, only the ones "in play").

### The four tickers, and how each is computed

All four reuse matching logic that already exists in this file or `keySource.ts`
— no new crypto, no new derivation primitive:

1. **Blue — Ouronet account.** The chosen account's own `publicKey` is matched
   against each seed's `accounts[].publicKey` — exactly `identifyKeySource`'s own
   loop (`keySource.ts:79-82`). Boolean presence only (an account has one key).
2. **Dark green — Payment key.** The SAME "settled for" payment key already
   computed by `PaymentSettledSummary` (either the kept current key or the
   freshly-derived one) is matched the same way. Boolean presence only.
3. **Dark gold — Guard key(s).** The SAME "settled for" guard keys already
   computed by `summarizeGuardChoice` are matched the same way, **individually**
   — the ticker additionally carries a count of how many of the guard's keys
   matched THIS seed (a keys-all/keys-any keyset can draw its members from
   different seeds). A key with no seed match (typed custom key, a pure keypair,
   an unresolved keyset-ref) contributes to no rectangle's count.
4. **Violet — Arweave address.** The codex's Prime Arweave Seed
   (`arweaveSeeds.find(s => s.isPrime)`, already a slice of the SAME store this
   wizard reads via `useCodexStoreOptional()` — confirmed in `store.ts:293`, no
   new prop needed) is decrypted with the ALREADY-IMPORTED `smartDecrypt`
   (`@stoachain/stoa-core/crypto`) to get its bitstring — per `IArweaveSeed`'s own
   doc comment, `secret` IS the 1600-bit bitstring directly for every
   seed-originated Arweave seed, same as `IStoaChainSeed.secret`. Each candidate
   Chainweb seed's `secret` is decrypted the same way, and the two bitstrings are
   compared for exact string equality. Match → violet lights on that seed's
   rectangle. No RSA re-derivation, no worker, no new package dependency (that
   would've meant `codex-ouronet` depending on `codex-arweave`, which already
   depends on `codex-ouronet` — a cycle). Decryption needs the cached password
   (`passwordCache`/`getPassword()`, already used elsewhere in this file); if
   unavailable or decryption fails, violet simply never lights (same
   graceful-degradation precedent as every other "can't prove it, so don't claim
   it" spot in this file) — never a false positive, never a thrown error visible
   to the user.

### Layout, per rectangle

- The seed's display name (reusing `getSeedDisplayName`/the existing "Master
  Chainweb Seed" naming convention for index 0).
- Tickers 1–3 (blue/green/gold) rendered together inside their own bordered
  sub-box — the owner's own grouping: these three are the "Ouronet string" (an
  account, its payment key, its guard), one coherent unit.
- Ticker 4 (violet) rendered separately, same rectangle, outside that sub-box —
  a distinct, Arweave-side concern.
- A trailing chevron that expands the rectangle to show exactly what each lit
  ticker is backing (e.g. "Payment key: 35d9…54f, position 0", "Guard keys:
  positions 1, 3") — it does **not** reveal the seed's plaintext words. This
  wizard already has an established, deliberate convention of never
  re-displaying recovered words once a seed is already stored (see the existing
  Payment step copy: *"Words: the selected existing account's words — already
  securely stored, not re-displayed here"*) — the dashboard keeps that line.

### Row order

Rows follow `allSeeds`'s own existing order (index 0 — conventionally the Master
Chainweb Seed — first), not a custom sort. This naturally puts the seed most
likely to be "fully lit" first, matching the owner's own example.

## Acceptance criteria

- [ ] On every step except `intro`, a rectangle renders for each seed that backs
      at least one of: the chosen account, the settled payment key, a settled
      guard key.
- [ ] A seed backing none of the four roles renders no rectangle.
- [ ] The guard ticker shows a count equal to the number of the settled guard's
      keys attributed to that specific seed, not the guard's total key count.
- [ ] A guard/payment key with no seed match (custom key, pure keypair,
      unresolved keyset-ref) lights no ticker on any rectangle, and the dashboard
      never throws or shows an error for this case.
- [ ] The violet ticker lights on the seed whose decrypted bitstring exactly
      matches the decrypted Prime Arweave Seed's bitstring, when a Prime Arweave
      Seed exists and the password is available to decrypt both; otherwise violet
      never lights, on any rectangle.
- [ ] Tickers 1–3 render inside one visually grouped sub-box per rectangle;
      ticker 4 renders outside that sub-box, same rectangle.
- [ ] Expanding a rectangle's chevron shows which specific key(s)/position(s)
      back each of its lit tickers; it never displays the seed's plaintext words.

## Out of scope

- Wiring a REAL `workerFactory`/Arweave-key-generation path — not needed: this
  design's violet ticker is bitstring equality, not RSA re-derivation, so there
  is no deferred "wiring" step left for it (unlike the earlier, wrong assumption
  that it needed one).
- Any new prop on `LegacyPrimeMigrationWizardProps` — every input this feature
  needs (`arweaveSeeds`, `allSeeds`, the already-settled payment/guard values,
  `passwordCache`/`getPassword`) is already available inside the component today.
- Handling legacy/pre-convention Arweave seeds whose `secret` might not be a
  directly-comparable bitstring (e.g. a Direct-mode seed typed in before this
  convention existed, or one that drifted format across versions) — out of scope
  for this round; `checkArweaveRestoreEligibility`'s own RSA-re-derivation path
  remains the authoritative eligibility check elsewhere in the app. This
  dashboard is a visual aid, not the eligibility gate itself.
- Showing the dashboard on the `intro` step.
