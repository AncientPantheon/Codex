# Two real bugs — debug session (2026-10-18)

**Status as of 2026-10-31 resume: BOTH RESOLVED.** 2b was already fixed by a
prior session (confirmed on resume — `describeKeyError` in
`KeyFieldsHalves.tsx` cites this file by path). 2a and 1 are fixed in this
session; see each bug's own "RESOLVED" block below for the evidence chain,
the fix, and the regression tests. Not yet committed — see the chat summary
for the suggested commit message, awaiting approval.

## Bug 2 — seed/key reveal fails on a real legacy "stoic" codex ("Unlock the codex to view the private key" shown while unlocked)

### Symptom

Real codex files at `Miscellaneous/_Codices/Foreign/{Ionut,Iounut-Latests}_OuronetCodex_2026-10-11_13-22-23.json`
(password `<redacted-rotated-credential>`), both `version: 1.2`, both with a single
`kadenaWallets[0]` tagged `seedType: "stoic"`. Viewing that seed's private
key in the real app:
- OuronetUI: "Could not derive bitstring." (DalosSecretReveal.tsx)
- codex-playground standalone (reproduced live, see below): "Unlock the
  codex to view the private key." shown on the Key #0/#1 rows, even though
  the top bar clearly reads "unlocked · Nm:Ss".

### Reproduction (confirmed, real browser, real file)

1. `apps/codex-playground` dev server on :3007, headless chromium via CDP
   (`node_modules/ws`, same pattern used earlier this session).
2. `DOM.setFileInputFiles` → load `Ionut_OuronetCodex_2026-10-11_13-22-23.json`.
3. Unlock with `<redacted-rotated-credential>` → succeeds (confirms password is
   correct; "CodexPrime" account renders).
4. Blockchain Accounts → Stoa-Chainweb → Seeds → expand "Prime Codex Seed" →
   click "Show private key" on Key #0.
5. **Result:** "Unlock the codex to view the private key." appears under
   Key #0, top bar still shows "unlocked · 28:13".
6. **Console, right before the error:** `[ouronet-core/crypto] V1-format
   encrypted blob decoded successfully...` — i.e. the decrypt of
   `seed.secret` genuinely SUCCEEDED. The error is NOT a decrypt failure.

### Evidence chain

| # | Hypothesis | Test | Result | Verdict |
|---|---|---|---|---|
| 1 | `seed.secret` is a V1 envelope, password is wrong | Decode base64 of `kadenaWallets[0].secret` in both real files | `{"ciphertext":...,"iv":...,"salt":...}`, no `v` field → genuine V1 envelope, both files byte-identical | confirmed envelope shape; password correctness untested yet |
| 2 | `smartDecrypt` itself can't decrypt V1 ciphertext in this installed `@stoachain/stoa-core` | `node` script calling `smartDecrypt` directly on real ciphertext + real password | `Error: Cannot find module '.../crypto/v1' imported from .../crypto/v2.js` — `smartDecrypt`'s non-V2 branch does `await import("./v1")`, **missing the `.js` extension**, illegal under Node's strict ESM resolver (confirmed at `node_modules/@stoachain/stoa-core/dist/crypto/v2.js:280`) | **CONFIRMED real upstream bug in `@stoachain/stoa-core`** — but only reproduces under Node's strict resolver |
| 3 | Same bug reproduces in the browser (Vite) | Real CDP repro through the actual app UI (steps above) | The SAME `smartDecrypt` call (inside `revealPrivateKey` in `SeedWordsTab.tsx:689`) **succeeded** in the browser — the "V1-format... successfully" warning fired, meaning `crypto.subtle.decrypt` returned real plaintext | **KILLED** — Vite's dev-server module resolution is more lenient than Node's and does NOT hit the same `./v1` resolution failure. The upstream stoa-core bug (#2) is real but is NOT what the user is hitting in the browser. |
| 4 | The decrypted plaintext itself is malformed for what `seedType: "stoic"` expects | Decrypted `seed.secret` directly (Node script): `"bid day just attack address climb actual puppy suggest expre..."` — real English words (BIP39-shaped), NOT a DALOS bitstring | `deriveStoaDalosKeypairAtIndex(secretPlain, index)` (`stoaDalosKeygen.ts`) expects a 1600-bit DALOS bitstring, not space-separated words — this is a type/shape mismatch, not a crypto failure | **CONFIRMED as the proximate cause** — `generateFromBitStringAtIndex` fails on word input, `SeedWordsTab.tsx`'s `revealPrivateKey` (line 686-703) has NO fallback/conversion step |
| 5 | The error message itself is misleading (separate, compounding bug) | Read `KeyFieldsHalves.tsx` lines 111-117, 128-136 | `catch { setErr("Unlock the codex to view the private key."); }` — a **blind catch-all**, fires on ANY thrown error regardless of cause, including this one | **CONFIRMED, separate bug**: even once the root derivation bug is fixed for THIS case, any OTHER real error would still show this same misleading "please unlock" text on an already-unlocked codex |

### Root cause, precise

Two independent, stacked bugs, both real and both fixable within this
repo (NOT upstream — `@stoachain/stoa-core`'s `./v1` extension bug exists
but is NOT what's firing here, confirmed killed at hypothesis #3):

**2a — Legacy "stoic" seeds whose `secret` stores WORDS, not a
pre-converted bitstring, break key derivation.**
`CreateStoaChainSeedModal.tsx` (current, correct convention) stores
`secret: await encryptStringV2(bitString, password)` — i.e. `seedWordsToBitString(words)`
is run BEFORE encryption, so `secret` always decrypts to a bitstring
today. But `SeedWordsTab.tsx`'s `revealPrivateKey` (and whatever backs
`DalosSecretReveal.tsx`'s bitstring display) assumes EVERY `seedType:
"stoic"` seed's `secret` follows this convention. This real `version: 1.2`
codex's "Prime Codex Seed" does not — it decrypts straight to words. This
is real legacy data (predates the current bitstring-pre-conversion
convention, or was imported/created through an older/different path) —
the exact kind of codex the whole `legacy-prime-migration` project this
session has been building toward exists to eventually handle, but THIS
specific break (can't even READ the existing key) is unrelated to that
migration work and should be fixed independently: detect the shape of
the decrypted secret and run it through `seedWordsToBitString` when it
isn't already bitstring-shaped, rather than assuming.

**2b — `KeyFieldsHalves`'s blind catch-all mislabels every decrypt/derive
failure as "codex is locked," even when it demonstrably isn't.**
Independent of 2a: fix the message to not claim "unlock the codex" when
the codex IS unlocked (e.g. surface the real error, or at minimum a
generic "could not read this key" message that doesn't point the user at
the wrong remedy).

### NOT the cause (ruled out, do not re-test)

- Password correctness — confirmed correct (unlock succeeds, and `smartDecrypt` itself succeeds in-browser).
- The uncommitted migration-wizard work (`store.ts` etc.) — not yet reached in this trace; the break is entirely within `SeedWordsTab.tsx`/`KeyFieldsHalves.tsx`/`stoaDalosKeygen.ts`, none of which the migration wizard touches. Ruled out by code-path tracing, not just absence of evidence — see files above.
- `@stoachain/stoa-core`'s own `smartDecrypt` V1-fallback (real bug, confirmed at v2.js:280, but confirmed NOT what fires in the browser — hypothesis #3 killed).

### Fix status: RESOLVED (both halves), 2026-10-31 resume

**2b was already fixed by a prior, unrecorded session** — found on resume,
not re-done: `KeyFieldsHalves.tsx`'s `describeKeyError()` now discriminates
the sentinel `Error("locked")` (genuine lock state) from any other thrown
error, and its own doc comment cites this file by path. Confirmed still
live in the working tree, uncommitted alongside this session's other
changes.

**2a — fixed in this session.** Root cause confirmed exactly as diagnosed
above: `deriveStoaDalosKeypairAtIndex` (`src/wallet/stoaDalosKeygen.ts`)
assumed its input was always the pre-converted 1600-bit bitstring, with no
defense against a legacy `secret` that decrypts straight to the raw words.

Fix: added `toDalosBitString()` inside `stoaDalosKeygen.ts` — detects shape
via the same `/^[01]+$/` convention `codex-arweave`'s own
`resolveSeedBitString.ts` already uses (bitstring → pass through unchanged;
not bitstring-shaped → split on whitespace, `validateSeedWords` +
`seedWordsToBitString`, mirroring `CreateStoaChainSeedModal.tsx`'s own
`originModePlaintextToBitString` split convention exactly). Applied inside
`deriveStoaDalosKeypairAtIndex` itself — the ONE shared entry point both the
seed-reveal UI (`SeedWordsTab.tsx`, two call sites) and the SIGNING resolver
(`resolveStoicKeypair` in `headlessKadenaDeps.ts`) go through — so both are
fixed by one change instead of patched separately.

Evidence the fix is real, not cosmetic: reverted the fix via `git stash`
and re-ran the new regression test — it failed red (`1 failed`) exactly as
expected; restored, it passes.

Regression tests:
- `packages/codex-ouronet/tests/stoa-dalos-keygen.test.ts` (new, 5 tests) —
  bitstring input unchanged, legacy words derive the SAME key as their
  pre-converted bitstring, whitespace tolerance, and malformed input throws
  the library's own word-naming error rather than crashing opaquely.
- `packages/codex-ouronet/tests/resolver-internal.test.ts` — new fixture
  `makeLegacyStoicSeedWithRawWordsSecret()` + new test proving
  `InternalCodexResolver.getKeyPairByPublicKey` (the real seam
  `RotatePaymentKeyModal`/`RotateGuardModal` sign through) now resolves a
  legacy word-shaped stoic seed correctly end-to-end.

All 17 tests in that file still pass; full `codex-ouronet` suite:
1796/1797 (the 1 is the pre-existing, unrelated pact-signature drift).
`tsc --noEmit` clean.

---

## Bug 1 — Rotate Payment Key / Rotate Guard: "AES-GCM auth-tag failure"

### Status: RESOLVED, 2026-10-31 resume

**Frontier step 1 — shared signing seam: CONFIRMED.** Both
`RotatePaymentKeyModal.tsx` and `RotateGuardModal.tsx` call `useGetKeypair()`
(`../../hooks/index.js`), which resolves through the identical
`InternalCodexResolver.getKeyPairByPublicKey` → `resolveStoicKeypair` seam —
same `password = cache.value` (the ONE cached password, used uniformly for
every stoic seed's secret), same `smartDecrypt` call. Confirmed by reading
`InternalCodexResolver.ts` and `headlessKadenaDeps.ts` directly, not
inferred from the modals' similar wiring.

**Frontier step 2 — real CODE bug, not just data state: CONFIRMED.** The
"vs" framing in the original question turned out to collapse: the stuck
DATA state (one secret on a stale password) is itself produced — and then
permanently concealed — by a real CODE bug:

1. `rekeyCodex` (`src/rekey/index.ts`) is BY DESIGN "skip-not-drop": a field
   that fails to decrypt under `oldPassword` keeps its original ciphertext
   and is recorded in a `skipped: RekeySkip[]` array — proven correct and
   already covered by `rekey.test.ts`'s own
   "skips (does not drop) a field encrypted under a different password"
   test. This part is working as designed, not the bug.
2. The store's `changeCodexPassword` (`state/store.ts`) correctly returns
   `{ skipped }` to its caller.
3. **The bug:** `CodexSettingsSection.tsx`'s `defaultChangePassword` — the
   seam `ChangePasswordCard` uses out of the box — called
   `await actions.changeCodexPassword(currentPassword, newPassword)` and
   discarded the result entirely. `ChangePasswordCard.tsx`'s own
   `handleSubmit` treats ANY non-throwing resolution as full success
   (`setOpen(false); reset();`) — there is no partial-success state in its
   contract. So a skip was reported by the store and then silently thrown
   away by the only consumer in this codebase, leaving the user told
   "success" while a secret (e.g. a stoic seed's `secret` — the exact field
   `resolveStoicKeypair` reads for Rotate Payment Key / Rotate Guard
   signing) stays on the OLD password, permanently, with zero signal.

The data state this produces is self-sustaining and compounding: once a
field is stuck, every SUBSEQUENT password change re-verifies
`oldPassword` against the (correct) majority of fields, skips that one lone
field again (now two+ generations stale), and reports the same false
"success" — so the next real signing attempt against it genuinely fails
`smartDecrypt` with "AES-GCM auth-tag failure", on an already-unlocked,
correctly-authenticated codex. Exactly the symptom reported.

Fix: added `CodexPasswordChangeIncompleteError` (`errors/types.ts`,
exported from the barrel), carrying the structured `skipped` list.
`defaultChangePassword` now throws it when `skipped.length > 0` — nothing
in `rekeyCodex` or the store changed; only the discard at the UI seam.
Throwing routes through `ChangePasswordCard`'s own pre-existing `catch`, so
the fix needed zero changes in codex-ui.

Evidence the fix is real: reverted via `git stash`, re-ran the new
regression test — it failed red (`1 failed`) with the UI showing success
and the error text absent, exactly the bug; restored, it passes, and a
second test confirms the ordinary (nothing skipped) path still closes the
form with no error, unchanged.

Regression tests (`tests/ui-codex-settings-section.test.tsx`, new describe
block): one seeds a `MemoryCodexAdapter` with two pure-keypairs under two
different old passwords (reproducing the "already stuck" state directly,
real crypto, no mocks), submits a password change with the majority
password, and asserts the card surfaces
`"could not be moved to the new password"` and stays open instead of
closing; the other proves the happy path is unaffected.

Full `codex-ouronet` suite after both fixes: 1796/1797 (the 1 is the
pre-existing, unrelated pact-signature drift). `tsc --noEmit` clean.

### Original investigation (superseded by the above, kept for the trail)

Confirmed so far:
- `_tx.fail(error?.message ?? "Failed")` in `RotatePaymentKeyModal.tsx`
  passes the REAL thrown error's `.message` straight to the toast — NOT a
  hardcoded/generic string. So "AES-GCM auth-tag failure" is genuinely
  `WrongPasswordError`'s real message (per `@stoachain/stoa-core`'s
  `v2.js:138`/`171` — thrown only on an actual `crypto.subtle.decrypt`
  `OperationError`, i.e. a real auth-tag mismatch), not a mislabeled
  different error (ruling out a Bug-2-style "wrong error shown" issue for
  THIS bug specifically).
- Signing for a `stoic`-type Prime seed/account goes through
  `InternalCodexResolver.getKeyPairByPublicKey` → `resolveStoicKeypair`
  (`headlessKadenaDeps.ts:160-177`) → `smartDecrypt(seed.secret,
  password)` at line 169 — the SAME `smartDecrypt` call implicated in Bug
  2, on the SAME kind of seed.
- NOT yet confirmed: whether the user's actual dev-wallet codex (the one
  Rotate Payment Key failed on) has a genuine password mismatch for this
  specific key (e.g. a partially-completed earlier password change, per
  the user's own separately-reported stuck "Submitting…" Change Password
  issue), vs. a code-level bug independent of data state.

### Next steps (frontier)

1. Check whether Rotate Guard shares the exact same `resolveStoicKeypair`/
   `getKeyPairByPublicKey` signing seam as Rotate Payment Key (user
   explicitly flagged Rotate Guard was never separately verified) — read
   `RotateGuardModal.tsx`'s full signing flow.
2. Determine if there's a real, reproducible CODE bug (e.g. wrong secret/
   wrong public key being looked up, a stale cached password, a mismatch
   between which account's guard vs payment key gets resolved) vs. this
   being purely a DATA-state issue specific to the user's own dev-wallet
   codex (can't fully confirm without their exact browser state, but can
   rule in/out code-level causes via static tracing).
