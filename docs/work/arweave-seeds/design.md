# Arweave Seeds — Design

## Problem

Arweave → Seeds is an empty placeholder. A Codex has no Arweave seed and no way
to make one, so no Arweave address can exist. What it DOES have is 1600-bit
DALOS key material already sitting in the vault (Ouronet accounts) and seed
words (Ouronet + Chainweb) that convert to 1600 bits. Nothing surfaces that.

Arweave keys are RSA-4096, derived deterministically from a 1600-bit bitstring.
Generation is SLOW — measured **6.7 s/key** on a dev box (indices 0/1/2 took
6.8 / 4.8 / 8.4 s; prime-search variance is large). So this is not a click-and-
wait form: it is a long-running, resumable, cancellable batch.

## Approach

**One rule: every Arweave seed is a 1600-bit DALOS-ellipse bitstring.** All three
sources converge on that single input to the deterministic RSA search.

A **Prime Arweave Seed** always occupies the first row of Arweave → Seeds. Until
defined it shows as undefined with a `Define Prime Arweave Seed` action. Defining
it — and adding any later seed — uses the SAME three options:

1. **Enter your own seed**
   - a. *Free Seed Input* (default) — DALOS style: 1–256 words, each 1–256 glyphs,
     gated by gen1's `validateSeedWords` (the 256-glyph DALOS charset).
   - b. *Restricted Seed Input* — BIP-dictionary gated, same as Chainweb seeds.
     Two variants: type your own, or generate a random phrase.
2. **Use an existing Ouronet account's bitstring** — pick from ACTIVATED accounts.
   Default: CodexPrime. No typing, no conversion: the value is already 1600 bits.
3. **Use an existing Chainweb seed** — direct capture, no typing. Default: the
   Prime Codex Seed. Its BIP39 words are converted through the DALOS ellipse.

| source | conversion to 1600 |
| --- | --- |
| 1 — typed words | `seedWordsToBitString(words)` |
| 2 — Ouronet account | none; `rebuildFullKey(...).privateKey.bitString` |
| 3 — Chainweb seed words | `seedWordsToBitString(words)` |

**Each seed owns its own index space** — `#0` is per-seed, not global. A stored
Arweave key is identified by `(seedId, index)`.

**Generation** mirrors the Crypto Lab, extended because RSA batches: `Default —
just #0` · `Custom position — #0 plus one more` · `Up to — #0 through N` ·
`Skipping intervals — a list of ranges`.

**The per-run ceiling is progressive, not flat.** While the Codex holds ZERO
Arweave keys the ceiling is **100**; once at least one Arweave key exists it
rises to **1000**. Rationale: at 6.7 s/key a first-ever run of 1000 is ~1.9 h of
CPU against a path the user has never seen work — 100 (~11 min) proves the
pipeline end-to-end first. The gate is Codex-wide (any Arweave key, under any
seed), not per-seed: it exists to prove the machinery, which only has to be
proven once.

**Already-populated positions are skipped, never fatal.** Per
`docs/HANDOFF-rsa4096-skip-populated-indices.md`: filter wanted indices against
the keystore, rebuild ranges from the misses, call
`generateFromBitStringAtRangesAsync`. The library needs no change.

**Index 0 is the one exception, and it is verified, not assumed**: `ranges.js`
does `const seen = new Set([0])` — index 0 is force-generated on EVERY call
regardless of the ranges passed. So the pre-filter cannot suppress it, and the
authoritative never-clobber guard lives in `onResult`, applied to EVERY index:

```ts
async function onResult(index, result) {
  if (await keystore.has(seedId, index)) return; // never overwrite
  await store(seedId, index, result);
}
```

**Alternatives considered**

- *Apollo 1024-bit bitstrings as RSA input* — rejected for this pass: mixing 1024
  and 1600 sources means two seed classes in storage and UI for no current gain.
  Deferred deliberately, not forgotten.
- *Re-deriving option 2's seed from the account's words via the ellipse* —
  rejected: it only works for words-origin accounts and would produce a value
  that is NOT the account's key. Taking the bitstring directly works for all
  origin modes.
- *Generating on the main thread* — rejected: at 6.7 s/key it freezes the tab.

### Seed deletion (added after first hands-on review)

A seed can be DELETED, and deleting it deletes every RSA key generated from it —
those keys are meaningless without the seed that reproduces them, and orphaning
them would populate Accounts with entries no seed can regenerate.

The Prime Arweave Seed is **permanent in the shipped build** (defining it is a
one-way act, warned about at definition time). **For development it is deletable**
so the flow can be re-run; the restriction lands before release. The warning copy
ships now — only the block is deferred.

### Restricted Seed Input gating

Option 1b is dictionary-gated, mirroring Chainweb seeds: the user may TYPE their
own phrase (that variant is required), but every word must exist in the BIP
English wordlist — otherwise it is not "restricted" and is indistinguishable from
Free Seed Input. The second variant generates a random valid phrase. Free Seed
Input (1a) remains unrestricted beyond the DALOS charset.

## Acceptance criteria

- [ ] Arweave → Seeds shows a Prime Arweave Seed row FIRST, marked undefined,
      with a `Define Prime Arweave Seed` action, even in a Codex with no Arweave
      material.
- [ ] Defining a seed offers all three options; options 2 and 3 are each
      independently disabled when that source has no entries (a missing default
      does NOT imply an empty Codex).
- [ ] Free Seed Input rejects a word outside the DALOS 256-glyph charset, and
      rejects >256 words or a word >256 glyphs, naming the offending word.
- [ ] A seed defined by any of the three options stores a 1600-bit bitstring;
      a source that cannot produce exactly 1600 bits is refused, not truncated.
- [ ] Opening a seed with no generated addresses shows it as unused, with a
      generate action that produces Arweave `#0`.
- [ ] Generating a range that includes already-populated positions completes
      without error and does not overwrite any existing key — including index 0,
      which the library regenerates regardless.
- [ ] With no Arweave key in the Codex, a run of more than 100 positions is
      refused at the UI, and the limit shown to the user says 100.
- [ ] With at least one Arweave key present, the ceiling is 1000 and a request
      above it is refused at the UI.
- [ ] A run shows live progress, can be cancelled, and keys already generated
      remain stored after a cancel or a closed tab.
- [ ] Every generated key appears in Arweave → Accounts, grouped by its seed and
      labelled with its index — the same shape Chainweb Accounts uses today.
- [ ] With no Arweave keys in the Codex, Accounts shows an explicit empty state —
      never a mock/demo entry.
- [ ] Deleting a seed removes the seed AND every RSA key generated from it; no
      orphaned key survives in Accounts.
- [ ] Defining the Prime Arweave Seed warns that it is permanent; it remains
      deletable in development builds.
- [ ] Restricted Seed Input accepts a typed phrase only when every word is in the
      BIP English wordlist, and offers a generate-for-me variant.

## Out of scope

- **Apollo (1024-bit) bitstrings as RSA input** — explicitly deferred to a later
  pass, by decision.
- **Any chain read** — no balance, no ownership, no gateway calls. Cryptography
  and storage only.
- The other four Arweave categories (Pure Keys / Accounts beyond listing / Upload
  / Library) stay as they are; only Seeds and the Accounts listing are wired.
- Publishing. Local verification only.
