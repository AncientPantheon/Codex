# Codex Shape Version Stamp — Design

Topic 1 of `docs/work/codex-versioning/design.md` (approved). Read that
first — this document only covers the foundation: the field itself,
read/write plumbing, and a minimal real demonstration. **No migration
logic here** — detecting "this codex needs an upgrade" and actually
upgrading it is Topic 2/3's job. This topic only makes the field exist,
persist correctly, and be visible pre-unlock.

## Problem

There is no field anywhere — live store or exported JSON — that answers
"what shape is this specific codex's data in." `CODEX_FORM_VERSION`
(`codex-core/src/codexFormVersion.ts`) is a global, never-bumped, build-time
constant (confirmed: used in exactly two places — `CodexInfoCard.tsx`'s
static "Codex Form" row, which is why the owner sees "v1.0.0" on every
codex regardless of real age, and `codex-arweave/src/library/flow.ts`'s
Arweave-backup `Codex-Form-Version` tag). `schemaVersion`
(`PlaintextCodex`'s own field) is explicitly documented as NOT traveling in
the export ("device-local, does not travel") — it answers a different,
narrower question (has the local V1→V2 encryption upgrade run) and must
keep that scope; this project does not touch it.

The name `CODEX_FORM_VERSION` is itself part of the problem — it reads as
if it's about the codex's own data shape, but it actually answers "what
version of the Codex *package/app* produced this output," a completely
different question from "what shape is *this file's* data." Owner's own
words: "it has nothing to do with the version of the Codex package that
outputed the codex, it grows on its own."

## Approach

**Two distinct, correctly-named entities — never one field doing both jobs.**

### 1. `Codex_Shape_Version` — the per-codex-instance field (NEW)

Exact name, per explicit owner instruction. Semver string, optional,
travels in the export (unlike `schemaVersion`), default target `"1.0.0"`
for anything created from this point forward. Answers: *"what shape is
THIS specific codex's data in"* — grows independently, per codex instance,
driven by the migration engine (Topic 2), never by which package version
happens to be running.

### 2. `CODEX_PACKAGE_VERSION_OUTPUT` — rename of the existing constant

Same global, build-time constant `CODEX_FORM_VERSION` already is today —
unchanged value/behavior, renamed for clarity per owner's explicit ask
("CodexPackageVersionOutput or something, what codex package version made
the codex upload/export"). File renamed
`codexFormVersion.ts` → `codexPackageVersionOutput.ts`. Its ONE external
consumer, the Arweave-backup tag, **keeps its existing wire key
`Codex-Form-Version` unchanged** — that tag is already stamped on real,
already-uploaded backups; renaming the wire key would break tag-based
lookups against historical data for zero benefit. Only the TypeScript
constant name changes; what it writes into stays byte-identical.

### Field placement (`Codex_Shape_Version`)

- `codex-core/src/codex/types.ts`: `PlaintextCodex.Codex_Shape_Version?: string` —
  same optionality/doc-comment discipline as `foreignKeys?`/`arweaveSeeds?`.
- `codex-core/src/codex/codec.ts`: `buildCodexExport` emits it only when
  present (same omit-when-absent discipline as every other optional field
  there); `deserializeCodex`'s `KNOWN_TOP_LEVEL_FIELDS` allow-lists it
  (exact precedent: this session's own `codexIdentity` allow-list fix).
- `codex-ouronet/src/state/store.ts`: a new `Codex_Shape_Version:
  string | undefined` field on `CodexStoreState`, persisted through the
  same `set({...})` snapshot shape `schemaVersion` already uses (same
  three call sites). `kickstartCodex` (fresh codex creation) stamps it
  `"1.0.0"` immediately — a brand-new codex IS already in the current
  shape. An IMPORTED codex that lacks the field on its source JSON stays
  `undefined` in the live store — Topic 1 never silently stamps a loaded
  codex as current; that would be dishonest (its shape hasn't actually
  been verified/migrated yet). `buildSnapshotFromState`/`buildBackupPayload`
  (`codex-ui/src/hooks/useCodexBackup.ts`) carry it through unchanged, same
  as every other snapshot field.

### Pre-unlock detection — the actual new capability

A new pure function, `codex-core/src/codex/shapeVersion.ts`:

```ts
export function detectCodexShapeVersion(rawJson: string): string | undefined
```

Parses the raw text defensively (same discipline as `deriveBackupLineage`
earlier this session — malformed/unparseable input yields `undefined`,
never throws), reads `Codex_Shape_Version` off the top level ONLY — no
decryption, no password, callable on a `File`'s raw text the instant it's
selected, before any store/adapter is touched. `undefined` return means
"Unversioned" — a presence check, not a heuristic guess, matching the
project design's own Approach-C-narrowed-to-one-binary decision.

A second tiny pure helper, `formatCodexShapeVersionLabel(v: string |
undefined): string`, returns `` `v${v}` `` or `"Unversioned"` — one
canonical display string every consumer (playground, OuronetUI,
`CodexInfoCard`) uses, so the wording never drifts between apps.

### Minimal real wiring (so this is actually demonstrable on localhost)

`apps/codex-playground`'s own `UnlockScreen.tsx` (shown after a `.json` is
picked, before password entry) calls `detectCodexShapeVersion` on the
raw file text the moment it's read and displays
`formatCodexShapeVersionLabel(...)` — e.g. "Unversioned" or "v1.0.0" —
right on that screen. This is real UI, but deliberately minimal (a label,
not a flow) — the full postpone/progress/flashing-button UX is Topic 3's
job once Topic 2's migration engine exists to actually DO something about
an old codex. OuronetUI's own equivalent screen is explicitly NOT wired in
this topic (owner's own repo, separate change, out of this repo's scope)
— the exported `detectCodexShapeVersion`/`formatCodexShapeVersionLabel`
functions are what make that possible later, which is the point of
shipping them from the shared package.

### Export filename

`useCodexBackup.ts`'s `downloadAsJson` default filename changes from
`` `OuronetCodex_${timestamp}.json` `` to
`` `OuronetCodex_v${Codex_Shape_Version ?? "unversioned"}_${timestamp}.json` `` —
reading `Codex_Shape_Version` off the same `snapshot` object
`buildSnapshotFromState()` already computes, no re-parsing.

### `CodexInfoCard.tsx`

Now shows TWO distinct, correctly-labeled rows instead of one conflated
one: "Codex Shape" (the real per-codex `Codex_Shape_Version`, or
"Unversioned") and "Codex Package" (the existing, renamed
`CODEX_PACKAGE_VERSION_OUTPUT` constant — what app version is running
right now). No more conflation of the two concepts in this one UI
location — this is the exact spot the owner's "both codices show v1.0.0"
confusion came from.

## Acceptance criteria

- [ ] A freshly created codex (`kickstartCodex`) has `Codex_Shape_Version
      === "1.0.0"` in the live store immediately after creation.
- [ ] Exporting that codex produces JSON containing `"Codex_Shape_Version":
      "1.0.0"` at the top level.
- [ ] `detectCodexShapeVersion` returns `"1.0.0"` when called on that
      exported JSON's raw text, and returns `undefined` when called on
      either of the two real `Miscellaneous/_Codices/Foreign/*.json` files
      (confirmed to lack the field) — without parsing error, without
      needing a password.
- [ ] Importing an old codex (lacking the field) leaves
      `store.getState().Codex_Shape_Version === undefined` — never
      silently stamped as current.
- [ ] `apps/codex-playground`'s `UnlockScreen.tsx` visibly shows "Unversioned"
      for a real legacy file and "v1.0.0" for a freshly-exported one, BEFORE
      the password field is interacted with — verified in a real browser.
- [ ] The exported filename contains the shape-version string, verified
      for the `v1.0.0` case end-to-end; the `unversioned` filename branch
      is verified by direct unit test of the template logic (no
      unversioned export can exist post-ship, by construction).
- [ ] `CodexInfoCard.tsx` shows "Codex Shape" (real per-codex value) and
      "Codex Package" (the renamed build constant) as two separate,
      correctly-labeled rows.
- [ ] The Arweave-backup `Codex-Form-Version` tag's actual wire value is
      byte-identical before and after the constant rename (verified by
      diffing a real backup's tag output against the pre-rename version).

## Out of scope

- Any migration/upgrade logic (Topic 2).
- The postpone/progress-bar/flashing-button/Codex-Upgrade-page UX (Topic 3).
- Wiring OuronetUI's own unlock screen (separate repo, owner's own change
  using the functions this topic exports).
- Renaming the Arweave `Codex-Form-Version` wire tag key itself — stays
  unchanged for backward tag-compatibility with already-uploaded backups.
- Touching `schemaVersion` in any way — it stays local-only, as documented.
