# Debug findings — "seed bitstring must be exactly 1024/1600 characters" on codex backup

Companion to `bug-report.md`. Written per the debug methodology's persistence rule.

## Symptom

Clicking "Back up codex to Arweave" (either UI mount) fails with:

```
generateFromBitStringAtRangesAsync: failed at index 0 (0 of 1 completed
before this): seed bitstring must be exactly 1024 (APOLLO) or 1600 (DALOS
Genesis) characters
```

## Reproduction (cheap, Node-level — no browser, no fake gateway)

`apps/codex-playground/tests/arweave-restore-eligibility-real-roundtrip.test.ts`
— real `kickstartCodex` + real `kickstartAndInstallPrimeArweaveSeed` + real
`createRevealAccountSecret` + real `buildRealPanelDeps`, with the RSA-4096
keygen faked DETERMINISTICALLY IN ITS BITS. Runs in ~2.3 s.

Pre-fix output:

```
AssertionError: promise rejected "Error: seed bitstring must be exactly 102…" instead of resolving
Caused by: Error: seed bitstring must be exactly 1024 (APOLLO) or 1600 (DALOS Genesis) characters
 ❯ ../../packages/codex-arweave/src/keygen/KeygenRunner.ts:332:31
```

## Evidence chain

### E0 — what the error actually checks

`packages/codex-arweave/node_modules/@ouronet/dalos-crypto/dist/rsa4096/stream.js`:

```js
export function validateSeedBitString(s) {
    if (!ALLOWED_SEED_BIT_STRING_LENGTHS.has(s.length)) {
        throw new Error('seed bitstring must be exactly 1024 (APOLLO) or 1600 (DALOS Genesis) characters');
    }
```

A raw `String.length` check. The error raised is the LENGTH one, not the
`"only '0' and '1'"` one → the input's length was neither 1024 nor 1600.
`"… (0 of 1 completed before this)"` ⇒ `total === 1` ⇒ `ranges: [{start:0,end:0}]`.

### H1 — the error comes from the PIN wrap path in `backupCodexToLibrary`

Test: read `buildSourceWrapTags` (`packages/codex-arweave/src/library/flow.ts:1145+`).
Result: the PIN branch is entered only when `pin !== undefined`; the real
backup supplies no PIN, so the Default branch runs and performs NO keygen at
all. **KILLED.**

### H2 — `createRevealStandardApolloBitstring` / `createRevealArweaveSeedSecret` yields a malformed value

Test: trace their consumers. Both values are only ever used by
`backupCodexToLibrary`'s Default wrap branch (no keygen, per H1), and the
failing call has `total === 1` which only `deriveArweaveSeedAtPositionZero`
(`ranges: [{start:0,end:0}]`) produces. **KILLED** — neither of the two
bitstrings the bug report nominated is the culprit.

### H3 (CONFIRMED) — `resolveRestoreEligibility` feeds an Ouronet account's raw decrypted `secret` straight in as if it were a bitstring

`apps/codex-playground/src/realArweaveAdapter.ts:739-746`:

```ts
const ouronetBitstring = await revealAccountSecret(primeOuronetAccountId);
if (ouronetBitstring === null || ouronetBitstring === "") return false;

return deriveRestoreEligibility({
  ouronetBitstring,
  primeArweaveAddress,
  workerFactory,
});
```

…and the prop's own doc comment records the false premise:

```
/** `codex-seed-restore-activation` T3: unlock-gated reveal of an Ouronet
 *  account's decrypted secret — for a `dalos`-curve account this IS its
 *  1600-bit bitstring. …
```

That premise is false. `createRevealAccountSecret`
(`ForeignChainsWiring.tsx:276-293`) returns `smartDecrypt(account.secret, …)`
verbatim, and `IOuroAccount.secret` is NOT a bitstring.

Observed (instrumented run of the reproduction above, instrumentation since
reverted):

```
[INSTRUMENTATION] bad bits length = 286 value = "4rdLm1dwIIduEo31JAHfoJ277i1wL9fMF59lFGvAyx1tvtIA8BeFgqzCGDHI1szbogfuAKIkIxe3jvfsGt1s41vecgsIkomMLA4czEuhICad8cv84FsHpDA2t6wgi7qE3qe3vBpHGoozmye4cmxKblB0D2Gw585Efl69HDDy546go0HloqG3ACxFxl9pDkgl0h9oitKJyq0B0EBKncfLLKkBqGdzzavIrbD999f75Az7t1rtcbcH24m3yaLsijDzcbyrlopehxxHy7t02u6wKE1cwcID4j"
```

286 characters of base-49 — the DALOS private scalar, not a bitstring.
**CONFIRMED.**

Origin of that value — `packages/codex-ouronet/src/state/store.ts:903`
(`kickstartCodex`):

```ts
secret: await encryptStringV2(primeKey.keyPair.priv, ck),
```

Direct probe of the real primitive (throwaway script, since deleted):

```
priv.length        = 286
privateKey.int49   = 286 equal to priv? true
bitString.length   = 1600
```

### H4 (CONFIRMED) — the stored `secret` does not match the `originMode` the account records, so even the correct `bitStringOf` conversion yields the WRONG bitstring

Convention, established by the only other account-creation path
(`SpawnAccountModal.tsx:303-306`):

```ts
secret: await encryptStringV2(secretPlaintextFor(), password),   // the ORIGINAL input, per originMode
backup: await encryptStringV2(preview.keyPair.priv, password),   // the private key
```

…and by `IOuroAccount.originMode`'s own doc (`types/entities.ts:42-44`):
"DALOS key-generation mode that produced an ouro account. Determines how the
reveal modal re-derives the account". Every consumer relies on it:
`bitStringOf` / `rebuildFullKey` (`codex-identity/rebuildFullKey.ts:91-93`),
`signApolloOwnership.ts:110-111`, `ArweaveSeedsArea.tsx:1525,2049`,
`LibraryArea.tsx:1063`, `CreateStoaChainSeedModal.tsx:137-142`.

`kickstartCodex` violates it: for `fresh-dalos` it records
`originMode: "seedWords"` (store.ts:906-907) but writes `keyPair.priv` into
`secret` and leaves `backup: ""`.

Probe (throwaway script, since deleted):

```
bitStringOf(acct, priv):  len = 1600 matches real bitString? false
bitStringOf(acct, words): len = 1600 matches real bitString? true
rebuildFullKey(priv,'integerBase49','dalos'): matches? true addr matches? true
```

The Prime Arweave Seed's own bitstring is `bitStringOf(codexPrime, words)`
(`kickstartPrimeArweaveSeed.ts:136-137`) — i.e. the WORDS branch. So
eligibility can only match if `resolveRestoreEligibility` reproduces that
same value. **CONFIRMED.**

## Root cause

A two-link chain, both links proven:

1. `kickstartCodex` stores the CodexPrime account's private key in `secret`
   while labelling `originMode: "seedWords"`, breaking the
   `secret`-matches-`originMode` contract every re-derivation consumer uses
   (and leaving `backup`, where the private key belongs, empty).
2. `resolveRestoreEligibility` never converts the revealed secret into a
   bitstring at all — it passes the plaintext through under the name
   `ouronetBitstring`, on a doc'd premise ("for a `dalos`-curve account this
   IS its 1600-bit bitstring") that was never true.

Link 2 alone produces the reported crash. Link 1 alone would still crash
(words are ~37 characters, also not 1024/1600). Both must be corrected for
the backup to actually work.

### Verification that BOTH links are load-bearing

With link 2 fixed and link 1 still broken, the reproduction stops crashing but
reports the codex ineligible:

```
AssertionError: expected false to be true // Object.is equality
- true
+ false
```

With both fixed: `Test Files 1 passed (1) / Tests 2 passed (2)`.

## The fix

Three files, minimal:

1. `packages/codex-ouronet/src/state/store.ts` (`kickstartCodex`, step 8d) —
   for `codexPrimeSeed.source === "fresh-dalos"`, `secret` now holds the WORDS
   (what its own `originMode: "seedWords"` declares) instead of
   `primeKey.keyPair.priv`. The other three sources are untouched: none can
   reach the Arweave-seed path (`kickstartAndInstallPrimeArweaveSeed` refuses
   every source but `fresh-dalos`), and `keyPair.priv` stays fully
   re-derivable from the words through `rebuildFullKey`.
2. `apps/codex-playground/src/realArweaveAdapter.ts` —
   `resolveRestoreEligibility` now runs the revealed plaintext through
   `bitStringOf(primeOuronetAccount, secretPlaintext)` instead of passing it
   straight in, and takes a new `primeOuronetAccount` prop (the conversion
   needs the account's `originMode`/`originCurve`). A `null` conversion folds
   into "not eligible", never a throw — the same failure contract as every
   other branch there. The `revealAccountSecret` doc comment's false premise
   is replaced with the actual contract.
3. `apps/codex-playground/src/ForeignChainsWiring.tsx` — `buildArweaveWiring`
   threads `primeOuronetAccount` from the SAME `isDefault` entry
   `primeOuronetAccountId` already comes from.

## Known residual (NOT fixed here — flagged, not guessed)

A codex kickstarted BEFORE this fix still has `keyPair.priv` in its
CodexPrime `secret`, so `bitStringOf` resolves a different bitstring than the
one its Prime Arweave Seed was derived from, and
`checkArweaveRestoreEligibility` resolves `false` for it. The effect is a
clean refusal ("back up is unavailable until both are set up") — never a
crash, and never a wrong/undecryptable envelope. Making those codices
eligible again needs either a state migration (rewrite `secret` to the words,
which are still recoverable from the fresh-dalos backing
`primeOuroAccountSeed.secret`, store.ts step 10) or an explicit
`integerBase49` fallback in the conversion. Both are real design decisions
with their own blast radius, outside this bug's minimal fix.

## Regression test

`apps/codex-playground/tests/arweave-restore-eligibility-real-roundtrip.test.ts`
— 2 tests, no pre-sized fake bitstring anywhere, and a keygen fake whose
address is DERIVED FROM ITS BITS (so a wrong-valued bitstring fails, not just
a wrong-length one):

- `checkArweaveRestoreEligibility` resolves `true` on a codex built by the
  real `kickstartAndInstallPrimeArweaveSeed`.
- `backupCodex` (the reported symptom's own entry point) reaches
  `backupCodexToLibrary` with `primeArweaveSeedBitstring` matching
  `/^[01]{1600}$/` and `standardApolloBitstring` matching `/^[01]{1024}$/`.

Pre-fix (fix lines reverted in place): both fail with
`Error: seed bitstring must be exactly 1024 (APOLLO) or 1600 (DALOS Genesis) characters`.
Post-fix: both pass.

`arweave-restore-eligibility-wiring.test.ts` was updated too — 3 of its tests
encoded the disproven premise (they called `buildRealPanelDeps` with no
account at all). They now pass `FAKE_PRIME_ACCOUNT`; their constant-address
worker fake is left as-is, and a comment records that value-level coverage
lives in the new round-trip file.

## Suite results

- `apps/codex-playground`: 228 passed / 228, `tsc --noEmit` clean.
- `packages/codex-ouronet`: 1485 passed / 1486, `tsc --noEmit` clean. The one
  failure is `tests/pact-signatures.test.ts > "a fresh run reproduces the
  committed file byte-for-byte"` — PRE-EXISTING, verified by re-running it
  with this fix reverted (still fails), and unrelated (a generated-file drift
  guard).

## Why no test caught it

Every pre-existing test of this chain injects a fake, already-correctly-sized
bitstring as `revealAccountSecret`'s result
(`arweave-restore-eligibility-wiring.test.ts:81`:
`const OURONET_BITSTRING = "1".repeat(1600);`) and a fake worker whose address
is a CONSTANT, independent of the bits it receives
(`makeFakeWorker(DERIVED_ADDRESS)`) — so neither the wrong length nor a wrong
value could ever be observed.
