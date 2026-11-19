# Codex Format Versioning — Design

## Problem

Today "codex version" is four unrelated, unreconciled concepts, none of
which do what the owner actually needs:

1. `CODEX_FORM_VERSION` (`codex-core/src/codexFormVersion.ts`) — a hardcoded
   `"1.0.0" as const`. A single GLOBAL product-build label, not a
   per-codex-instance stamp. Its own doc comment already records the
   owner's original MAJOR/MINOR/PATCH policy intent — nobody has ever
   bumped it despite real capability additions landing since.
2. The codec's top-level `"version": "1.2"`/`"1.3"` (`codex-core/src/codex/codec.ts`,
   `ACCEPTED_VERSIONS`) — genuinely plaintext, genuinely visible pre-unlock,
   but answers "what wire/envelope shape is this JSON," never surfaced in
   any UI, and unrelated to the product-shape question above.
3. `codex-ouronet`'s `CURRENT_SCHEMA_VERSION` (`state/migrations.ts`) — a
   real, WORKING, tested migration runner (pure functions, integer-keyed
   registry 0→1→2→3, enforced postconditions). But it is never persisted
   in the exported JSON at all — a freshly-loaded codex's `schemaVersion`
   is inferred fresh on import, not read from the file. A real codex can
   go through this pipeline with zero record of what shape it started as.
4. `IConsumerSettings.schemaVersion` / `ForeignKeysBlock.schemaVersion` —
   two more, narrower, per-block version fields with no relation to any
   of the above.

The result, confirmed directly against two real external codex files
(`Miscellaneous/_Codices/Foreign/*.json`, debug session this conversation,
`docs/work/debug/two-real-codex-bugs.md`): both files show "v1.0.0" in the
UI (the dead global constant, identical for every codex ever) regardless
of their real age, and nothing anywhere records that one of them has a
`seedType: "stoic"` seed whose `secret` follows an OLDER convention
(raw words) than the current code assumes (pre-converted DALOS bitstring)
— which is what actually broke seed-reveal for that codex. There is no
mechanism to detect this kind of drift, no visible warning before the
user even unlocks, and no guided path to fix it.

## Approach

**One real, per-codex-instance semver field — `Codex_Shape_Version` (exact
name, owner-specified) — backed by the EXISTING `schemaVersion` migration
runner, not a new parallel mechanism.**

- `Codex_Shape_Version: string | undefined` lives at the top level of both
  the live store snapshot AND the exported JSON (plaintext, alongside the
  codec's own `version`/`exportedAt` fields — same allow-list mechanism
  already proven safe this session for `codexIdentity`). `undefined`/absent
  means **"Unversioned"** — a simple presence check, not a heuristic guess.
  This is the ONLY thing the UI needs to read before a password is ever
  typed: open the raw JSON (or probe `File` in the browser), look for this
  one field, show it or show "Unversioned."
- The CURRENT target value is **`"1.0.0"`** — per the owner's own framing,
  this is a deliberate reset: the first version where backward-compat
  detection and migration genuinely work. This field has NOTHING to do
  with which version of the Codex package/app is running (owner's own
  words) — that separate question is `CODEX_FORM_VERSION`, kept as its
  own concept but renamed `CODEX_PACKAGE_VERSION_OUTPUT` for clarity (see
  Topic 1's own design.md) since the old name was itself part of the
  confusion.
- Migrations are REAL, extending `migrations.ts`'s existing registry — not
  reinvented. Each registered migration keeps its existing pure
  `(snapshot) => snapshot` contract for shape-only changes, and ALSO
  stamps the new `Codex_Shape_Version` alongside `schemaVersion` as part
  of its postcondition, the same enforcement pattern already in place.
- **Interactive reconciliation, layered above the pure runner.** Some
  historical drift (the stoic-seed-words-vs-bitstring case) cannot be
  resolved by a pure function — detecting it is possible (the decrypted
  secret doesn't look like a 1600-bit bitstring), but FIXING it needs
  either a successful local conversion (`seedWordsToBitString` on the
  decrypted content) or, when that's ambiguous/fails, the user's input.
  A new, explicitly-named step type runs after the pure migrations,
  flagging exactly what's missing and exposing it to the UI's upgrade
  flow rather than silently failing or guessing.
- **Export filename carries the version** (e.g.
  `OuronetCodex_v1.0.0_2026-10-18T...json`) — a trivial addition once the
  field exists, but explicit per the owner's ask.
- **Upgrade UX**: detected at unlock (auto-offered, never forced —
  postponable), a progress bar reusing the `onProgress` callback shape
  `ChangePasswordCard` already ships (same pattern, not reinvented), a
  red-flashing indicator on the Codex ID nav button while a codex is
  below current version, and a new "Codex Upgrade" section inside the
  Codex ID page as the durable place to trigger/resume it later.

### Alternatives considered

- **A new, independent version mechanism** — rejected: becomes a fifth
  parallel version concept, the exact sprawl driving this whole request.
- **Pure heuristic/probabilistic detection, no persisted field** —
  rejected as the PRIMARY mechanism (can't give a confident pre-unlock
  badge, can't drive an export filename, can't resolve the stoic-seed
  case without decrypting first) — but its one narrow use (is the field
  present at all?) is exactly what "Unversioned" detection needs, so it
  survives as a single boolean check, not a classifier.

## Topics

1. **`codex-shape-version-stamp`** — the field itself (`Codex_Shape_Version`,
   exact name): schema, plaintext persistence (store + export), pre-unlock
   read path (raw JSON/File probe, no password needed), UI badge (version
   or "Unversioned"), export filename versioning. Foundation every other
   topic depends on.
2. **`structural-migration-engine`** (owner-named: "Structural Migration
   Engine") — fixes a codex's internal *shape* only, nothing to do with
   Arweave eligibility. Extends `migrations.ts`'s real registry with the
   concrete migrations needed (starting with the confirmed stoic-seed-shape
   fix), the new interactive-reconciliation step type for data the runner
   can't resolve alone, and the final `Codex_Shape_Version` stamp on
   success. A codex is "structurally current" when this has run — that is
   a strictly weaker claim than being Arweave-eligible (see Topic 4).
3. **`upgrade-prompt-ui`** — auto-offer-with-postpone at unlock, the
   progress bar, the red-flashing Codex ID nav indicator, the new "Codex
   Upgrade" page/section inside Codex ID. Drives Topic 2's engine; does
   not itself know about Permaweb eligibility.
4. **`permaweb-eligibility-migration-engine`** (owner-named: "Permaweb
   Eligibility Migration Engine") — explicitly DEFERRED (owner's own
   words: "will have to differ for now"). A SEPARATE, later migration
   pass — never to be conflated with Topic 2 — that takes a
   *structurally-current* codex (Topic 2 must have already run) and makes
   it eligible for Arweave upload, stamping a `permawebCapable: boolean`
   field. Ties into the already-designed (not-yet-built)
   `legacy-prime-migration-wizard` project. Noted here only so it isn't
   lost; not shaped or built as part of this project.

**Ordering invariant:** Structural Migration (Topic 2) always runs before
Permaweb Eligibility Migration (Topic 4) ever could, for a given codex.
Never the reverse — eligibility migration assumes a structurally-sound
input, it does not itself fix structural issues.

Shaping only Topic 1 now; 2 and 3 get shaped in turn once 1 is approved
and built. Topic 4 stays a backlog note.

## Acceptance criteria (project-level; Topic 1's own design.md will have
its own, narrower set)

- [ ] A codex exported today (or after Topic 1 ships) carries
      `Codex_Shape_Version: "1.0.0"` in its plaintext JSON, readable without
      a password.
- [ ] A codex that predates this field shows "Unversioned" in the UI the
      moment it's loaded/selected, before any password prompt.
- [ ] The two real `Miscellaneous/_Codices/Foreign/*.json` files, after the
      migration engine ships, both read correctly end-to-end (seed reveal
      included) without manual intervention, OR clearly prompt the user
      for exactly the missing piece if full auto-reconstruction isn't
      possible.
- [ ] Every migration step's postcondition is enforced the same way
      `migrations.ts` already enforces `schemaVersion` postconditions
      today — a migration that doesn't reach its declared target version
      fails loudly, never silently.
- [ ] An export's filename includes the codex format version.

## Out of scope

- The `permaweb-capable-flag` topic (explicitly deferred).
- Rebuilding or redesigning the existing `schemaVersion` integer runner —
  it is correct and stays as-is; this project extends its registry and
  adds a parallel semver stamp, nothing more.
- Any change to `@stoachain/stoa-core`'s own `smartDecrypt` — the real
  upstream `./v1` extension bug found during the debug session is a
  separate, out-of-repo concern (confirmed not to be what fires in the
  browser anyway, per the debug doc).
