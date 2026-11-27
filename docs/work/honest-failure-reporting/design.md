# Honest failure reporting

Five defects found while a real user repaired two damaged codexes. They share
one disease: **code that fails, or declines to act, without saying so.**

Established by investigation against the owner's real exported codex
(`Ionut_OuronetCodex_v1.0.0_2026-11-26`), decrypted and measured:

```
[0] "Prime Codex Seed"  stoic  secret = 1600 chars, binary   wordsSecret = 154 chars, 24 tokens
[1] "FormerKoala"       koala  secret = 154 chars, 24 tokens (correct for koala)
```

**The data is correct and the repair engine worked.** Nothing here is a
correctness bug in the crypto or the repair. Every item below is a REPORTING
failure — but two of them cost the owner hours and one risks data loss.

The reveal failure was reproduced exactly against those real bytes:

```
seedWords mode: OK
bitString mode: InvalidBitStringError: invalid bitstring (length 154,
                expected 1600) ... non-binary character "b" at position 0
```

identical to the owner's console. Cause: a 24-word phrase routed through the
bitstring path — the pre-repair state of seed [0].

## 1. The wizard probe never settles (the one that cost the most time)

`LegacyPrimeMigrationWizard.tsx` ~`:1505-1508`:

```tsx
const pending = existingCandidates.filter(...);
if (pending.length === 0) {
  setProbePhase("settled");
  return;                       // <-- NO cleanup returned
}
```

The effect claims `startedPassRef.current = passKey` at ~`:1498` and then
returns **without a cleanup**, so the claim is never released. Under
`<StrictMode>` (dev) the effect re-runs: a sibling effect ~`:1355` pushes
`probePhase` back to `"pending"`, then ~`:1497` sees the stale claim and
declines to run. Terminal state is never reached.

Result: *"Reading your Ouronet accounts…"* with **no counter**, forever, no
CPU, no error, no retry. The precondition — zero candidate accounts — is
ordinary: `computeExistingAccountCandidates` excludes the current prime, every
Smart account and every APOLLO account.

Worse, **every diagnostic the wizard owns is rendered BELOW the early return
at ~`:1777`** — `probeErrors` (~`:2233-2266`), the inline unlock prompt
(~`:2008`), and `classifyDecryptError`'s typed taxonomy (~`:1367-1376`). They
are unreachable precisely when they are needed.

Continue is NOT blocked (it gates on `accountSeedResolving` only when
`accountChoice.kind === "existing"`), so this is misleading rather than
blocking — arguably worse, because a disabled button with a reason tells you
where you stand while a permanent spinner does not.

**Fix:** every exit from that effect must leave a definite state and release
its claim. Add a wall-clock watchdog that flips to settled with a visible
"could not read N accounts". Surface errors inside the progress panel rather
than only below it. Add the missing `.catch` to the fire-and-forget at ~`:1514`.

## 2. The repair stamps completion unconditionally

`structural-migration/index.ts` ~`:298-300`:

```ts
next.Codex_Shape_Version = STRUCTURAL_SHAPE_TARGET_VERSION;
if (next.Codex_Shape_Version !== STRUCTURAL_SHAPE_TARGET_VERSION) throw ...
```

The stamp never consults `skipped`, and the "postcondition" compares a value
to the literal assigned on the line above — a tautology that can never fire.

Once stamped, `useNeedsStructuralUpgrade` returns false and `CodexIdPage`
replaces "Upgrade Codex Now" with "✓ Versioned" **permanently**. A codex with
a skipped, still-unreadable seed is marked structurally current with no retry
path.

The engine also has three distinct silent `continue`s — not-stoic (~`:126`),
empty secret (~`:244`), already-current (~`:268`) — which are indistinguishable
to the caller. With no counters, "examined nothing" and "everything was
already fine" both render as `Fixed 0 seeds.`

**Fix:** stamp only when `skipped.length === 0`. Replace the tautology with a
real assertion. Widen the result with `examined` / `alreadyCurrent` /
`notEligible` so the UI can say which of the three happened.

## 3. A word-shaped plaintext is overwritten without a real check — DATA LOSS RISK

`validateSeedWords` is extremely permissive: 1–256 tokens of DALOS runes,
where the rune set includes all of `[0-9A-Za-z]`. The repo's own test comment
admits *"plain prose … happily accepts"*.

So step 4 (~`:274-280`) treats almost any alphanumeric plaintext as words, and
`applyWordsFix` (~`:176-181`) **overwrites `secret`** with
`seedWordsToBitString(<whatever>)` — a well-formed but wrong key — writing
`wordsSecret` only when it was previously empty. On anything that is not
really words, the only copy is destroyed.

**Fix:** a positive word-shape test before any overwrite (token count and
per-token length bounds), and never discard the original without preserving it.

## 4. "Could not derive bitstring" explains nothing

`rebuildFullKey` catches a precisely-typed `InvalidBitStringError` and returns
`null` (~`:65-68`); `DalosSecretReveal` renders a bare *"Could not derive
bitstring."* The real diagnosis — *"this is 154 characters of words, not 1600
bits"* — is inside the thrown message and is discarded.

**Fix:** return a typed reason instead of `null` and render it. **Never
auto-convert at a reveal surface** — a read-only view must not rewrite stored
key material.

## 5. A crypto library's internal string, shown raw

`SeedWordsTab.tsx` ~`:738` prints `err.message` verbatim, so a user sees
`AES-GCM auth-tag failure`. Distinct, actionable failure modes collapse into
one opaque line: wrong password, corrupt envelope, unsupported format, a
module-load failure, a locked codex.

A typed classifier already exists in a sibling file
(`LegacyPrimeMigrationWizard.tsx` ~`:1367-1376`) and is not reused.
`smartDecryptWithDetails` exists in `@stoachain/stoa-core` and has **zero**
callers in this repo; it would let the UI flag a legacy V1 envelope.

On the owner's second codex this matters concretely: the codex unlocks and
private keys reveal while both seeds fail the auth tag — meaning those blobs
are under a **different password**. The data is intact and there is nowhere to
say so.

**Fix:** lift the classifier into a shared module and use it. On
`WrongPasswordError`, say the seed was encrypted with a different password and
that the data is intact.

## Out of scope

A per-seed "try another password" recovery flow. The reconciliation hook
(`requestMissingData`) accepts seed WORDS only — a password branch, a scoped
single-seed run, and rejection feedback are all new. Worth doing; too large for
this round, and item 5 makes the condition legible first.

## Acceptance criteria

1. The probe reaches a terminal state on every path, including zero
   candidates, and under a StrictMode double-mount.
2. A stalled or failed probe is visible WITH its errors, not replaced by a
   spinner.
3. `Codex_Shape_Version` is stamped only when nothing was skipped; the retry
   button survives a partial run.
4. The repair distinguishes examined-none, already-current, not-eligible and
   skipped, and the UI renders which occurred.
5. No plaintext is converted to a bitstring and written over `secret` unless it
   passes a positive word-shape test.
6. A non-bitstring reveal says what the stored value actually looks like.
7. A decrypt failure is classified; a wrong-password failure says the data is
   intact and the password differs.
8. No regression. Baselines: codex-core 437, codex-ouronet 2397 (+1 known pact
   drift), codex-arweave 1137 + 1 skipped, codex-ui 314, codex 13,
   arweave-core 517, playground 249.
