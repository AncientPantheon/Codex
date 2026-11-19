# Structural Migration Engine — Design

(Topic 2 of `docs/work/codex-versioning/design.md`. Fixes a codex's internal
*shape* only — never to be confused with the separate, deferred **Permaweb
Eligibility Migration Engine**, which later makes a structurally-current
codex eligible for Arweave upload. Structural migration always runs first;
eligibility migration assumes a structurally-sound input and never fixes
shape itself.)

## Problem

Two real, confirmed bugs from the debug session
(`docs/work/debug/two-real-codex-bugs.md`), both reproduced against the real
files `Miscellaneous/_Codices/Foreign/{Ionut,Iounut-Latests}_OuronetCodex_2026-10-11_13-22-23.json`
(password `<redacted-rotated-credential>`):

1. **(2a) A legacy `"stoic"` seed's `secret` field holds raw words, not the
   pre-converted DALOS bitstring the current code always assumes.**
   `IStoaChainSeed.secret`'s own doc comment (and `IArweaveSeed.secret`'s,
   identically) already states the invariant: `secret` must ALWAYS be the
   derived bitstring; the original words — recoverable only because
   `seedWordsToBitString` is a one-way hash — go in a separate `wordsSecret`
   field when known. `CreateStoaChainSeedModal.tsx` and
   `apps/codex-playground/src/ForeignChainsWiring.tsx` already write this
   correctly. These two real files predate that convention: their stoic
   seed's `secret` decrypts straight to space-separated words
   (`"bid day just attack address climb..."`), and
   `SeedWordsTab.tsx:691`'s `revealPrivateKey` hands that directly to
   `deriveStoaDalosKeypairAtIndex`, which requires an exact 1024/1600-char
   bitstring and throws.
2. **(2b) The UI mislabels this (and any other) derivation failure as "codex
   is locked."** `KeyFieldsHalves.tsx` (4 call sites) and `SeedWordsTab.tsx`
   (`handleView`, `copyToClipboard`'s private-key branch) each wrap the
   reveal/copy/derive call in a blind `catch { setErr("Unlock the codex to
   view/copy..."); }` — fired on ANY thrown error, including this one, even
   though the top bar demonstrably shows "unlocked." Fixing (2a) alone still
   leaves every OTHER possible derivation failure mislabeled the same way.

Both bugs block seed/key reveal entirely for any codex carrying this legacy
shape — confirmed to include the user's friend's two Foreign codices, and
now the user's newly-acquired real client codices.

## Approach

**A new, async-capable `ShapeMigration` engine, running strictly after the
existing pure `schemaVersion` chain (`migrations.ts`'s `applyMigrations`),
never merged into it.**

Why separate: `SchemaMigration.migrate` is a hard pure-sync contract
(`(snapshot) => snapshot`, no I/O) — proven, tested, and must stay that way
for the two migrations it already runs. Fixing (2a) needs the codex
password (to decrypt/re-encrypt) and can need user input (an unresolvable
seed), neither of which fits that contract. So this is a structurally
different kind of step, sequenced after schema migrations complete, mirroring
the project-level design's own call for "a new, explicitly-named step type
runs after the pure migrations."

**Shape of the engine itself — mirrors `rekeyCodex` (`src/rekey/index.ts`),
the one proven precedent for "password-aware, whole-codex, pure
`snapshot→snapshot`, skip-not-drop" in this codebase:**

- Works on a `structuredClone` of the input snapshot; the caller's snapshot
  is never mutated, even on a mid-way throw.
- Walks every `seedType: "stoic"` entry across `kadenaSeeds` AND
  `arweaveSeeds` (both carry the identical `secret`/`wordsSecret`
  convention per their own doc comments) via one drift-proof generator,
  same discipline as `iterateCodexSecretRefs`.
- Per stoic seed: decrypt `secret` with the password.
  - If it's already a valid bitstring (regex `/^[01]+$/`, length 1024 or
    1600) → no-op, already current shape.
  - If it's a valid DALOS word list (`validateSeedWords` from
    `@ouronet/dalos-crypto/gen1` returns `null`) → this is bug (2a)'s case:
    encrypt the original words into `wordsSecret` (only if not already
    set — never overwrite real data), run `seedWordsToBitString(words)`,
    encrypt the result into `secret`. Re-encryption uses the SAME password
    (this is a shape fix, not a password rotation).
  - If it's neither (corrupt, truncated, unrecognizable) → this seed is
    **unresolvable automatically**. The engine does not throw and does not
    silently skip it (same skip-not-drop discipline `rekeyCodex` already
    uses for undecryptable fields) — it returns a typed descriptor
    identifying exactly which seed/field needs the user's input (e.g.
    "re-enter this seed's words") through an injected async callback the
    caller supplies. If the caller provides a value, the engine validates
    it the same way and retries that one seed; if the caller declines
    (returns nothing), that seed is recorded as skipped and the engine
    continues with the rest of the codex.
- On full completion (every stoic seed resolved or explicitly skipped),
  stamps `Codex_Shape_Version` to the current target value — enforced as a
  postcondition exactly like `applyMigrations` already enforces
  `schemaVersion`, so a run that doesn't reach the declared target fails
  loudly, never silently.
- The registry is a list (not a single hardcoded step), following
  `SCHEMA_MIGRATIONS`'s "never delete past entries" discipline — this ships
  with exactly one registered shape migration (the stoic-seed fix above),
  but the mechanism is built to hold more as future shape drift is found.

**Bug (2b), bundled in as agreed:** in both `KeyFieldsHalves.tsx` and
`SeedWordsTab.tsx`, replace the blind catches with a distinction: if the
failure came from `ensureUnlocked()`/`getCurrentPassword()` (the codex is
genuinely locked), keep the existing "Unlock the codex..." message
unchanged. Any OTHER thrown error (decrypt succeeded but derivation failed,
corrupt data, etc.) surfaces its own real message instead — never the
locked-codex text when the codex demonstrably isn't locked.

**What this topic does NOT build:** the user-facing trigger (the red-
flashing Codex ID button, the "Codex Upgrade" page, the postpone flow, the
progress bar UI) — that's Topic 3 (`upgrade-prompt-ui`), which will call
this engine and render its own UI around the `onProgress`-style callback and
the "needs user input" descriptor this engine exposes. Topic 2's own tests
exercise the reconciliation callback with a plain programmatic stub, not a
real UI.

### Alternatives considered

- **Lazy fix-on-read** (fix a stoic seed's shape the next time its secret
  is decrypted for any reason, e.g. inside `revealPrivateKey` itself).
  Rejected: mutates real secret data with no visible consent, no progress
  indication, and no `Codex_Shape_Version` stamp — directly contradicts the
  owner's explicit ask for a visible, user-controlled, postponable upgrade
  ceremony with a progress bar.
- **Unify into one async runner, replacing `SchemaMigration`/
  `applyMigrations` entirely.** Rejected: forces the two already-shipped,
  pure, zero-password schema migrations through an async/password-aware
  contract they never need, for zero behavioral gain — unjustified
  regression risk on working, tested code.

## Acceptance criteria

- [ ] Running the engine against the real `Ionut_OuronetCodex_...json` file
      (decrypted with its real password) converts its stoic seed's `secret`
      to a valid bitstring that `deriveStoaDalosKeypairAtIndex` derives a
      key from without throwing, and populates `wordsSecret` such that
      decrypting it yields the exact original words, byte-for-byte.
- [ ] The same holds for the real `Iounut-Latests_OuronetCodex_...json`
      file.
- [ ] A codex with no stoic-seed-shape issues (current convention already)
      completes the engine as a no-op on every other field, and
      `Codex_Shape_Version` is stamped to the current target value.
- [ ] When a stoic seed's decrypted `secret` is neither a valid bitstring
      nor valid DALOS words, the engine returns a typed "needs user input"
      result identifying exactly that seed (not a thrown error, not a
      silent skip).
- [ ] Supplying a value through the injected reconciliation callback lets
      the engine resolve that seed and complete the run in the same call.
- [ ] Declining to supply a value results in that seed recorded as skipped
      (not dropped — its original ciphertext is preserved verbatim) and the
      rest of the codex still completes.
- [ ] The engine never mutates its input snapshot argument (verified the
      same way `rekeyCodex`'s own purity is already tested).
- [ ] `KeyFieldsHalves.tsx` and `SeedWordsTab.tsx` no longer show "Unlock
      the codex..." for a genuinely-unlocked codex when the real failure is
      a derivation/shape error; a real lock-state failure still shows the
      existing lock message unchanged.
- [ ] Full existing `codex-ouronet` test suite stays green; no behavior
      change to `migrations.ts`'s pure schemaVersion runner.

## Out of scope

- The **Permaweb Eligibility Migration Engine** (separate, explicitly
  deferred project-level topic) — this topic never touches
  `permawebCapable` or any Arweave-eligibility concern.
- Any user-facing upgrade trigger UI — progress bar rendering, the red-
  flashing Codex ID nav indicator, the "Codex Upgrade" page/section. All of
  Topic 3 (`upgrade-prompt-ui`).
- The upstream `@stoachain/stoa-core` `smartDecrypt`'s `./v1` extension bug
  — confirmed real but confirmed NOT what fires in the browser (killed by
  hypothesis #3 in the debug doc); separate, out-of-repo concern.
- Re-validating shape for koala/chainweaver/eckowallet seed types — their
  `secret` already IS the real mnemonic in both old and new codices; no
  shape drift has been found or is suspected for them.
- The real client codices the user just acquired are USED as additional
  real-world verification once the engine is built, but are not committed
  into the repo as fixtures (same handling as the two existing Foreign
  files — read directly from their real filesystem path, never copied into
  version control).
