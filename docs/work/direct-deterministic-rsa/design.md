# Direct Deterministic RSA Generation — Design

Wires the previously-placeholder "Direct Deterministic RSA Generation" mode in
`ArweaveSeedsArea.tsx`'s define-box toggle (built earlier as
`DirectGeneratorPlaceholder` — four disabled tiles, no logic).

## Problem

Seed-Based (options 1/2/3) always derives its 1600 bits from words. There is no
way to seed an Arweave key directly from a bitstring, bitmap, or base-10/49
scalar the way `SpawnAccountModal` already lets a user do for Ouronet accounts.

## Approach

**Reuse, do not re-derive.** `SpawnAccountModal.tsx` already implements this
exact input quartet and its real validation lives in `@ouronet/dalos-crypto`:

- **Width toggle**: 1024-bit or 1600-bit, default 1600. 1600 = `DALOS_ELLIPSE`
  (`@ouronet/dalos-crypto/gen1`); 1024 = `APOLLO` (`@ouronet/dalos-crypto/historical`
  — same `{s, r}` shape `validateBitString`/`validatePrivateKey` already expect).
- **BitString**: `validateBitString(bits, ellipse)` — exact length, `0`/`1` only.
  A "Random BitString" button (`crypto.getRandomValues`, mirroring
  `SpawnAccountModal`'s `randomBits()`) plus a manual textarea.
- **Base-10 / Base-49**: `validatePrivateKey(value, base, ellipse)` — the
  already-clamped-scalar rule (`"1" + <e.s bits> + "00"`). A "Random Scalar"
  button (draw a random bitstring, read back its canonical `int10`/`int49` via
  `fromBitString`) plus a manual input.
- **Bitmap**: `BitmapKeyInput` (now exported from `@ancientpantheon/codex-ouronet/ui`,
  alongside `DalosSecretReveal`/`CodexModalShell`) mounted with `rows`/`cols`
  matching the selected width (40×40 / 32×32) — it ALREADY does draw, randomize,
  AND import (decode → validate dimensions → discard the file, keep only the
  bitmap) from the earlier bitmap-import round. No new bitmap logic needed;
  convert its `Bitmap` output to a bitstring via `bitmapToBitString` (1600) or
  the same dimension-generic local conversion `SpawnAccountModal` already uses
  for Apollo (1024, since core's `bitmapToBitString` hardcodes 40×40).

**The one auto-correction rule, applied uniformly to BitString and Base-10/49**
(explicitly requested for the scalar case; extended to bitstring too since its
"wrong width" case is the same kind of ambiguity, trivially resolved by length):
if the typed/pasted value is invalid for the CURRENTLY selected width but valid
for the OTHER supported width, the toggle silently flips to that width and the
value is accepted — never a refusal a user has to manually work around by
guessing which toggle position to try first. Only a value invalid for BOTH
widths is refused. Bitmap does NOT get this treatment: `BitmapKeyInput` already
owns its own dimension-mismatch refusal, and its rows/cols are physically fixed
by the toggle before a file is even chosen.

**No words, ever.** A Direct-defined seed has `words: undefined` by
construction — `ArweaveSeedRecord`'s existing bitstring-only reveal fallback
already handles this correctly (built during the seed-reveal work). Confirmed
in the acceptance criteria below, not new work.

**`ArweaveSeedRecord` gains `bitLength?: 1024 | 1600`** (absent = 1600, matching
the parent project's original plan for this field) so `SeedRow`'s subtitle
("1600-bit DALOS seed") reads correctly for a 1024-bit Direct seed too.

## Acceptance criteria

- [ ] A width toggle (1024/1600, default 1600) is visible only in Direct mode.
- [ ] BitString: random-generate button + manual entry; refused if it cannot
      resolve to EITHER width's exact bit length.
- [ ] Base-10/49: random-generate button + manual entry; refused unless it is a
      correctly-clamped scalar for one of the two widths.
- [ ] Typing/pasting a value shaped for the OTHER width auto-flips the toggle
      and accepts it, for BitString and Base-10/49.
- [ ] Bitmap: the SAME `BitmapKeyInput` (draw/randomize/import) sized to the
      selected width; a successful import never persists the uploaded file,
      only the resulting bitmap/bits.
- [ ] Confirm defines a seed with the resolved bits, `words: undefined`, and a
      `sourceLabel`/`bitLength` describing the direct source and width.
- [ ] Viewing such a seed's reveal shows no Seed/words tab — only Bitmap /
      BitString / Base-10 / Base-49, derived at the CORRECT width (1024 or
      1600), with the correct subtitle bit count.
- [ ] Generation (existing `startRun`/RSA search) works unchanged against a
      1024-bit Direct seed exactly as it already does against 1600-bit ones.

## Out of scope

- Any change to Seed-Based (options 1/2/3) — still 1600-only.
- Auto-toggle for Bitmap uploads (owned by `BitmapKeyInput`'s own fixed
  rows/cols, not re-derived here).
