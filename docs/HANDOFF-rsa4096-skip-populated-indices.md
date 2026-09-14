# Handoff for Codex agent — skip already-populated Arweave address indices during RSA-4096 generation

Follows on from `HANDOFF-arweave-dalos-crypto-seeded-keygen.md` (read that
one first if you haven't wired up the seeded RSA-4096 generation path yet —
this handoff assumes it's done). Scope here is narrower: the "generate a
range/batch of addresses" UI needs to skip positions Codex already has a
key for, instead of blindly regenerating (or worse, crashing on) them.

Verified directly against the actual running source this session — both the
Go reference (`RSA4096/indexed.go`, `batch.go`, `ranges.go`) and its TS
mirror (`ts/src/rsa4096/indexed.ts`, `batch.ts`, `ranges.ts`) — not from
memory.

## The one fact that settles this: no `@ouronet/dalos-crypto` change is needed

`generateFromBitStringAtIndex` / `generateBatchFromBitString` /
`generateFromBitStringAtRanges` (and their `Async` siblings) are PURE,
STATELESS functions of `(seed, index)`. They have zero knowledge of Codex,
its keystore, or what's "already populated" anywhere. Concretely:

- They will NOT crash on an already-populated index — there's no way for
  them to know one exists. They just deterministically re-run the prime
  search and return the exact same `KeyGenResult` as before (pure function
  -> byte-identical output every time for the same seed+index).
- They also won't skip it on their own, for the same reason — there's
  nothing inside the library to check against.

**"Skip if populated" is application state Codex owns. It does not belong
in the crypto library, and building it there would mean a new package
version, a new parameter shape to keep in sync across Go and TS forever,
for something that's really just a one-line filter on Codex's side.** Do
not wait on any `@ouronet/dalos-crypto` change to start this work — nothing
needs to change there.

## The actual fix: filter the ranges before calling the generator

`generateFromBitStringAtRanges(seedBitString, ranges, onProgress, onResult)`
already does exactly what's wanted here, structurally — it takes an
arbitrary list of `{start, end}` index ranges, deduplicates + sorts them,
and generates each exactly once. So the fix is simply: **before calling it,
narrow the ranges down to the indices Codex doesn't already have a key
for.**

```ts
import { generateFromBitStringAtRangesAsync, type IndexRange } from "@ouronet/dalos-crypto/rsa4096";

// 1. Resolve whatever the user picked in the UI (a single range, several
//    disjoint ranges, "first N", etc.) into one flat list of wanted indices.
const wantedIndices = expandUserSelectionToIndices(userSelection); // however the UI already represents this

// 2. Filter out anything already in Codex's keystore.
const missing: number[] = [];
for (const idx of wantedIndices) {
  if (!(await keystore.has(idx))) missing.push(idx);
}

// 3. Turn the filtered list back into ranges. Singleton ranges are simplest
//    and perfectly correct -- generateFromBitStringAtRanges sorts/dedupes
//    internally regardless of how granular the input ranges are:
const ranges: IndexRange[] = missing.map(i => ({ start: i, end: i }));
// (Optional, purely cosmetic: coalesce consecutive missing indices back
//  into wider ranges to keep this array smaller. Not required for
//  correctness -- the library doesn't care either way.)

const results = await generateFromBitStringAtRangesAsync(seed, ranges, onProgress, onResult);
```

Use the `Async` variant (not the sync one) anywhere near UI code — each
address's generation is multi-second, CPU-bound work, and the `Async`
functions yield to the event loop periodically so a progress bar can
actually repaint, same guidance as the earlier handoff.

## The one real exception: index 0 can be skipped at STORAGE, but not at GENERATION

`generateFromBitStringAtRanges` **unconditionally force-includes index 0 in
every call**, regardless of what `ranges` you pass in — even an empty array.
That's deliberate, documented library behavior ("a caller asking for other
ranges too should get it for free"), and there is no parameter to opt out of
it.

Practical consequence: if position 0 is already populated and gets filtered
out of `wantedIndices`/`missing` above, **the library will still run the
full prime search for index 0 anyway** — filtering it out of your `ranges`
array has no effect on that one index specifically. This is not harmful
(the function is pure and deterministic, so it just costs a redundant few
seconds of CPU, not wrong data or a crash), but it does mean:

- Index 0 is the ONE position where you cannot avoid paying the generation
  cost, even when it's already known.
- You still need — and this is the important part — to make sure
  `onResult` doesn't blindly overwrite an existing stored key for index 0
  (or any index) once the result comes back.

So put the actual "don't clobber" guard in `onResult`, as a second,
authoritative check, not just in the pre-filter:

```ts
async function onResult(index: number, result: KeyGenResult) {
  if (await keystore.has(index)) return; // already populated -- do not overwrite
  await keystore.store(index, result);
}
```

This makes the feature correct even if the pre-filter step is ever skipped,
buggy, or racing against a concurrent write — the store-time check is the
one that actually enforces "never clobber an existing address," and it's
cheap insurance to apply uniformly to every index, not just 0.

## Net effect, per index

| Index | Already populated? | Generation cost paid? | Gets (re)stored? |
|---|---|---|---|
| any index != 0 | no | yes (correctly — it's new) | yes |
| any index != 0 | yes | **no** (filtered out before the call) | no |
| 0 | no | yes | yes |
| 0 | yes | **yes** (unavoidable — library forces it) | **no** (guarded in `onResult`) |

## Progress bar note

Because index 0 always runs through the search even when already known, a
combined progress bar driven by `generateFromBitStringAtRanges`'s own
`onProgress`/`BatchProgressEvent.OverallProgress` will show index 0 taking
its normal share of the bar, even on a run where its result ends up
discarded at the `onResult` step. This is purely cosmetic — worth knowing so
it isn't mistaken for a bug during testing.

## Explicitly out of scope

- No change to `@ouronet/dalos-crypto` (Go or TS side), no new version to
  publish, no corpus regeneration.
- No change to `generateBatchFromBitString`'s own contract (still always
  generates the full `[startIndex, startIndex+count-1]` range with no skip
  hook) — this feature is being built specifically against
  `generateFromBitStringAtRanges` instead, per the above.
