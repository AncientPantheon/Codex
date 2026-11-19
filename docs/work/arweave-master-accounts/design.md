# Arweave Master Accounts — Design

Topic 2 of `docs/work/migration-completion/design.md`.

## Problem

The wizard tells the user **"This codex is now eligible"** while the Settling
Dashboard's violet ticker — the dashboard's own independent check that the
Arweave face is derived from the Codex Master Seed — is **dark**. The claim is
not merely premature; it is false, and the screen that could disprove it is
sitting right beside it.

Owner, stated more than once and restated after seeing this: *"it first has to
have shown a purple square box on the Codex Master Seed, which would mean the
codex holds #0 and #1 arweave accounts derived from the Codex Master Seed.
That's the last step that would make it eligible. And if it doesn't it would
have to make it on the spot."*

Three separate defects produce it.

**1. Only position #0 is ever derived.** `deriveArweaveSeedAtPositionZero`
(`packages/codex-arweave/src/seeds/derivePrimeSeed.ts`) runs
`ranges: [{ start: 0, end: 0 }]` — exactly one key. Position #1 does not exist
anywhere in the flow.

**2. The derived key is discarded.** `ensurePrimeArweaveSeed`
(`packages/codex-arweave/src/panel/CodexIdPage.tsx`) does:

```ts
await deriveArweaveSeedAtPositionZero({ bitstring: bitString, workerFactory });
const secret = await encryptStringV2Compatible(bitString, password);
await state.actions.addArweaveSeed({ … });   // the SEED row only
```

The awaited `SeededKey` is never captured and never reaches `addForeignKey`.
An Arweave ACCOUNT is a `ForeignKeyEntry` addressed by `(seedId, index)`; none
is ever written. So a full RSA-4096 derivation runs as pure proof-of-work and
its result is thrown away, leaving the codex with an Arweave seed row and
**zero Arweave accounts**.

**3. Eligibility is claimed from "the call didn't throw", not from the end
state.** `runFinalize` sets `arweaveOutstanding` only when
`ensurePrimeArweaveSeed` is absent or raises. Nothing verifies the codex now
holds #0 and #1 under the master seed. This is the same failure mode that has
recurred throughout this work — trusting a claim instead of verifying the
result (`originSeedTab`, `parentSeedId`, the stored guard) — and it is why
defects 1 and 2 could hide behind a success message.

## Approach

**Eligibility becomes a verified predicate, computed from the codex, not a
side effect that is assumed to have worked.**

### The predicate

`codexHoldsMasterArweaveAccounts(masterBitString, arweaveSeeds, foreignKeys)`
— a pure, injectable-decrypt function, mirroring `resolveArweaveMatchSeedId`'s
existing decrypt-and-compare discipline — is true iff:

1. some `IArweaveSeed` decrypts to exactly `masterBitString`, and
2. `foreignKeys` contains entries with that seed's `id` at **both**
   `index: 0` and `index: 1`.

This is the same fact the violet ticker already displays, so the ticker and
the eligibility claim can no longer disagree — they read one predicate.

### The three cases, resolved by that predicate

The owner's rules fall out of it rather than being enumerated separately:

- **No Arweave seed at all** (legacy codex) — predicate false at step 1.
  Create the seed from the Codex Master Seed bitstring, derive #0 and #1,
  persist both.
- **Arweave accounts from the SAME seed** — step 1 passes. Derive and persist
  only whichever of #0/#1 step 2 found missing; if both exist, do nothing.
- **Arweave accounts from a DIFFERENT seed** — step 1 fails against the master
  bitstring. Create a seed for the master bitstring and derive #0 and #1 under
  it. Pre-existing seeds and their accounts are left untouched: they are real
  keys that may hold real data, and nothing here is entitled to delete them.

### Deriving both positions

`deriveArweaveSeedAtPositionZero` is replaced at its call site by a range
covering both positions (`runSeededBatch` already accepts
`ranges: [{ start: 0, end: 1 }]`), and **both** delivered keys are persisted
via the existing `addForeignKey` path with `seedId` and `index` set, so
`(seedId, index)` addresses them exactly as `ForeignKeyEntry` documents.

Each RSA-4096 key takes seconds, so two of them need the progress affordance
this package already has (`RunProgress`-style, driven by the seeded worker's
real `batch-progress` events — not a fabricated bar).

### Finalize

Finalize runs the generation, then **re-evaluates the predicate** and claims
eligibility only if it now holds. If generation could not complete (no worker
wired, derivation failed, codex locked), it reports that honestly and does not
stamp alignment — the existing `arweave-unavailable` status already exists for
this and simply becomes reachable for the right reason.

### Alternatives considered

- **Keep `deriveArweaveSeedAtPositionZero` and call it twice** — rejected: two
  separate batches pay the worker startup twice and give two unrelated
  progress streams for one user-visible step.
- **Delete/replace Arweave seeds that derive from a different seed** —
  rejected: those are real keys that may hold permanently-stored data;
  eligibility needs the master's accounts to EXIST, not to be the only ones.
- **Claim eligibility and let the dashboard contradict it** — rejected; that
  is today's bug.

## Acceptance criteria

- [ ] After finalize on a codex with no Arweave seed, the codex holds an
      Arweave seed matching the Codex Master Seed plus foreign-key entries at
      index 0 AND index 1 under it.
- [ ] The Settling Dashboard's violet ticker is lit on the Codex Master Seed
      card at the moment the wizard claims eligibility — never dark.
- [ ] A codex already holding #0 and #1 under the master seed completes
      finalize without deriving anything new.
- [ ] A codex holding only #0 under the master seed derives exactly #1.
- [ ] A codex whose Arweave accounts derive from a different seed gains #0 and
      #1 under the master seed, and its pre-existing Arweave seeds and keys are
      still present afterwards.
- [ ] When the accounts cannot be generated, finalize says so and does NOT
      claim eligibility or stamp alignment.
- [ ] Deriving the two keys shows real progress driven by the worker's own
      events, not a fabricated timer.

## Out of scope

- Funding, uploading, or transacting with the new Arweave accounts.
- Deriving positions beyond #1.
- Stage 3 / Apply (`migration-stage-3-apply`) — this topic only writes the
  codex side, which is what eligibility is defined on.
- Backfilling `seedId`/`index` provenance onto Arweave keys written before
  those fields existed.
