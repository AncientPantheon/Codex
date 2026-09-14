# Key Material Provenance & I/O — Design

## Problem

Four gaps, all about how key material is *surfaced, moved, and sourced*:

1. **Arweave address rows are inert.** A Chainweb account row shows a value plus
   copy and explorer buttons; an Arweave row shows a position badge and an
   address, nothing else.
2. **A generated Arweave key cannot be removed individually.** The only delete is
   the whole-seed cascade. `deleteForeignKey` exists on the store and on
   `ArweavePanelDeps`, but its sole caller is the dead `KeyringArea` demo.
3. **An Arweave seed cannot be inspected.** Ouronet accounts have the Secret
   Reveal modal (Seed / Bitmap / BitString / Base-10 / Base-49); an Arweave seed
   has no reveal at all. The modal also has no bitmap export, and the Spawn
   modal's bitmap input has no import — so a bitmap can be drawn but never saved
   or reloaded.
4. **The RSA generator conflates seeds with raw key material.** Option 2 ("Use an
   Ouronet account") accepts *any* activated DALOS account and captures its
   bitstring. But an account whose key came from a bitmap, a bitstring, or a
   base-10/49 scalar has **no seed** — calling the result a "seed" is a lie about
   provenance, and it silently mixes two different generation models.

## Approach

### The organising rule

**Provenance decides the generator.** Key material that came from *words* feeds
the **Seed-Based Deterministic RSA Generator**. Key material that came from a
*direct representation* (bitstring / bitmap / base-10 / base-49) feeds the new
**Direct Deterministic RSA Generator**. Same RSA search underneath — the split is
about honesty of provenance, not about crypto.

This rule resolves an otherwise-awkward requirement. Seed words **cannot be
recovered from a stored seed**: `seedWordsToBitString` is a seven-fold Blake3
hash, strictly one-way. So "reveal seed words" is only possible if the words are
stored. Under the provenance rule, *every* Seed-Based source has words by
construction — option 1 is typed words, option 3 is Chainweb words, and option 2
(now filtered to `originMode === "seedWords"`) has words as its account
plaintext. The reveal becomes universally available rather than a per-seed maybe.
The two requirements fall out of one another.

### The generator split

The toggle lives in the **upper-right of the define box**, which is the surface
that chooses the input source. The `Seeds` category keeps its name and now lists
both kinds of source row, each carrying a kind badge.

| | Seed-Based | Direct |
| --- | --- | --- |
| title | Seed-Based Deterministic RSA Generation | Direct Deterministic RSA Generation |
| inputs | 1 typed words · 2 Ouronet account · 3 Chainweb seed | BitString · Bitmap · Base-10 · Base-49 |
| widths | 1600 only (Apollo stays deferred) | 1024 **or** 1600, curve-selected |
| words stored | yes | no |
| reveal tabs | Seed + Bitmap + BitString + Base-10 + Base-49 | the four non-word tabs |

Seed-Based stays 1600-only, matching the standing decision ("we use only 1600 bit
input for options 1 2 3"). Direct is where 1024 arrives, because the RSA layer
already permits it: `ALLOWED_SEED_BIT_STRING_LENGTHS = Set{1024, 1600}`.

### The direct-input validators already exist — reuse, do not re-derive

`SpawnAccountModal` already implements exactly this input quartet, and the real
rules live in `@ouronet/dalos-crypto/gen1`:

- **BitString** — `validateBitString(bits, e)`: exactly `e.s` chars, each `0`/`1`.
- **Bitmap** — `validateBitmap` is hardcoded 40x40; Apollo has **no**
  `generateFromBitmap` at all, so the 32x32 path converts to a bitstring first
  (the pattern `SpawnAccountModal` already uses, and which
  `OuronetUI/src/lib/dalos/bitmap-local.ts` canonicalises via
  `bitmapDimensionsFor(curve)`).
- **Base-10 / Base-49** — `validatePrivateKey(n, base, e)`. The integer is **not
  raw entropy; it is the already-clamped scalar**, so its binary form must be
  `"1" + <e.s bits> + "00"`. Admissible set: `2^(e.s+2) <= n < 2^(e.s+3)` and
  `n % 4 == 0`. Concretely 483 decimal / 286 base-49 digits for DALOS; 309-310
  decimal / 183 base-49 digits for Apollo. This is the restriction the spawn
  popup enforces, and the Direct generator inherits it unchanged.

### The 1-bit bitmap format

StoicDigest's `keyBitmapBMP(bits, cols)` is a real uncompressed 1bpp Windows BMP:
14-byte file header + `BITMAPINFOHEADER` + a 2-colour palette (index 0 white,
index 1 black), rows padded to a 4-byte stride, bottom-up, MSB-first. It is
already curve-generic via `cols`, so 32x32 works unchanged. It is ported
**verbatim** into `codex-core` (pure, no React, no DALOS coupling) and paired
with a new reader.

**The reader is where the funds risk is.** A valid 1bpp BMP may define index 0 as
black, which would import a *bit-inverted* key — a completely different account,
silently. So the reader reads the palette rather than assuming `1 = black`, and
additionally rejects `biBitCount != 1`, handles negative height (top-down rows),
honours the stride padding, and requires dimensions matching the selected curve
exactly.

On-screen polarity differs between surfaces (StoicDigest is black-on-white,
Codex's `BitmapGrid` is accent-on-near-black) but the *semantics* are identical —
bit `1` is ink in both — so export/import round-trips without inversion.

**Alternatives considered**

- *Derive words from the stored bitstring* — impossible, not merely expensive;
  the conversion is a one-way hash.
- *Reveal only the four non-word tabs and drop the words requirement* — rejected:
  the requested affordance is literally "reveal seed words", and the provenance
  rule makes storing them coherent rather than a special case.
- *A separate top-level tab for the Direct generator* — rejected in favour of the
  toggle, per "or even better title it as such. And add a toggle in its upper
  right corner". Both generators produce rows into the same index-spaced list, so
  splitting the tab would split one list in two.
- *Re-implement the direct-input validators inside codex-arweave* — rejected;
  divergence between the spawn modal's rules and the generator's rules is exactly
  the class of bug that costs funds.
- *Keep the inline-SVG rule and re-author `DalosSecretReveal` lucide-free* —
  rejected; the ban is a gap in `codex-arweave`'s vitest config, not a property
  of the package. Porting the three-line workaround is smaller and unblocks all
  future reuse.

### Storage changes

`IArweaveSeed` (in `codex-ouronet/src/types/entities.ts`) gains three optional
fields, all backward-compatible — absent means the legacy reading:

- `kind?: "seed" | "direct"` — absent = `"seed"`.
- `bitLength?: 1024 | 1600` — absent = `1600`.
- `wordsSecret?: string` — `encryptStringV2(words.join(" "), password)`. Present
  only for `kind: "seed"`. Ciphertext, guarded the same way `secret` already is.

`rekeyCodex` must re-encrypt `wordsSecret` alongside `secret`, and the inventory
guard bumps accordingly.

## Acceptance criteria

**A — Arweave account rows**
- [ ] Each Arweave address row shows a value (reading `Empty`, since balances are
      not wired), a copy button, and an explorer link button, visually matching
      the Chainweb row cluster.
- [ ] The copy button places the full address on the clipboard; the explorer
      button opens `https://viewblock.io/arweave/address/<address>` in a new tab.
- [ ] Each row has a delete control that requires confirmation before removing
      the key, matching the existing Arweave confirm-then-delete pattern rather
      than Chainweb's immediate delete.
- [ ] A deleted key stays deleted: it does not reappear from the panel's session
      overlay, and it is absent after a reload.
- [ ] A `saveAll` that runs a snapshot migration no longer wipes `foreignKeys`.

**B — Arweave seed reveal**
- [ ] An Arweave seed row has a reveal control that opens the same Secret Reveal
      modal used by Ouronet accounts.
- [ ] For a Seed-Based source the modal shows all five tabs, and the Seed tab
      lists the original words.
- [ ] For a Direct source the modal shows the four non-word tabs and no Seed tab.
- [ ] A 1024-bit Direct source renders a 32x32 bitmap and a 1024-bit BitString;
      a 1600-bit source renders 40x40 / 1600.
- [ ] Words are stored as ciphertext only: no plaintext word ever reaches the
      snapshot or localStorage, and a password change re-seals them.

**C — 1-bit bitmap export / import**
- [ ] The reveal modal's Bitmap panel has a download control that produces an
      uncompressed 1bpp BMP whose pixels reproduce the bitstring exactly.
- [ ] The Spawn Standard / Smart Account bitmap section has an import control
      that loads such a file into the grid.
- [ ] A file exported from a key and re-imported yields the identical address
      (round-trip).
- [ ] Import refuses, with a distinct message each: a non-BMP file, a BMP that is
      not 1 bit per pixel, and a BMP whose dimensions do not match the selected
      curve.
- [ ] A 1bpp BMP with an inverted palette (index 0 black) imports to the same
      bitmap as its non-inverted equivalent, not to the bit-flipped key.

**D — Seed-Based / Direct RSA generator split**
- [ ] The define box is titled "Seed-Based Deterministic RSA Generation" and
      carries a toggle in its upper-right corner.
- [ ] Toggling it presents "Direct Deterministic RSA Generation" with a curve
      selector and the four direct input modes.
- [ ] Option 2 offers only Ouronet accounts whose origin is seed words; an
      account created from a bitstring, bitmap, or scalar is not listed.
- [ ] The Direct generator accepts a 1024-bit Apollo input and a 1600-bit DALOS
      input, and refuses any other width rather than padding.
- [ ] A base-10 or base-49 input that is not a correctly clamped scalar for the
      selected curve is refused with the library's reason, and a correctly
      clamped one is accepted.
- [ ] Both source kinds appear in the Seeds list with a badge identifying which,
      each owning its own index space, and both cascade-delete their keys.

## Out of scope

- Wiring real Arweave balances — the value cell renders `Empty` by construction.
- Arweave send / receive transactions.
- Apollo (1024-bit) input for the **Seed-Based** generator; it remains 1600-only.
- The numbers/letters toggle on the RSA parameters panel (previously deferred).
- Blocking deletion of the Prime Arweave Seed (still dev-deletable by decision).

## Topics

1. `arweave-account-rows` — value + copy + explorer buttons, per-key
   confirm-delete with a `removeForeignKey` seam and the session-overlay fix,
   plus the `migrateToCurrent` foreignKeys-wipe repair. (criteria A)
2. `dalos-bitmap-io` — the 1bpp BMP writer/reader in `codex-core`, the download
   control in the reveal modal, and the import control in the spawn modal
   (including making `BitmapKeyInput` controllable). (criteria C)
3. `arweave-seed-reveal` — `wordsSecret` storage + rekey, the `codex-arweave`
   lucide harness fix, and mounting the Secret Reveal for Arweave seeds.
   (criteria B)
4. `deterministic-rsa-modes` — the define-box toggle, the Direct generator and
   its reused validators, the option-2 provenance filter, and `kind`/`bitLength`
   storage. (criteria D)

Order is dependency-driven: topic 2 lands the BMP codec that topic 3's reveal
exports; topic 3 lands the `IArweaveSeed` extension and the harness fix that
topic 4's Direct sources extend. Topic 1 is independent and can run first or in
parallel.
