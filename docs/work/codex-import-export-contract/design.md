# Codex Import/Export Contract — Design

## Problem

`@ancientpantheon/codex` defines exactly one sanctioned way to load and save a
Codex JSON snapshot (`useCodexBackup()`, backed by `codex-core`'s
`buildCodexExport`/`deserializeCodex` codec), but nothing says so anywhere a
consuming implementer would see it before writing code. This session's live
incident is the direct cost of that gap: OuronetUI's `auth-context.tsx` hand-rolled
its own JSON parser for the "Recovery File" flow — wrong field names
(`kadenaWallets`/`ouronetWallets`/`addressBook` read as if they were the wire
shape, `pureKeypairs` read ad hoc), no `arweaveSeeds` handling at all, and
purely-additive writes with no reset — producing an "Undefined" Arweave seed, 34
duplicated pure-key entries, and a downstream RSA-parameter decrypt error. None
of this would compile-fail or lint-fail; it silently degrades at runtime, and
the only reason it surfaced was a user noticing wrong numbers on screen.

Today, answering "how do I load/save a codex" requires reading five source
files across two packages (`codex-core/src/codex/types.ts`, `codec.ts`,
`codex-ui/src/hooks/useCodexBackup.ts`, `codex-ouronet/src/adapters/*`, and the
devtool-only `codex-playground/src/loadCodex.ts`) and correctly inferring which
parts are the sanctioned contract versus internal/dev-only machinery. Every
future consumer (and every future blockchain/keyring/encryption addition) pays
that reverse-engineering cost again, or — as just happened — gets it wrong
silently.

## Approach

Ship a single markdown file, `packages/codex/IMPORT_EXPORT_CONTRACT.md`, inside
the **published** aggregator package (added to its `package.json` `files`
array so it lands in the npm tarball itself — not a repo-root `docs/` doc that
an external consumer would never see), stating the import/export rules as
directives, not descriptions: what an implementer MUST call, MUST NOT
hand-parse, and does NOT need to know because Codex owns it internally. A
one-line pointer to it is added near the top of `packages/codex/README.md` so
it's discoverable from the first thing anyone reads.

The document is grounded in the actual current source (already re-verified
this session, not from memory):

- **The wire schema** — `CodexExportV1_3` (`codex-core/src/codex/types.ts`):
  `kadenaWallets`, `ouronetWallets`, `addressBook`, `uiSettings` (always
  present); `foreignKeys` (a `{schemaVersion, keys}` **block**, omitted when
  empty); `pureKeypairs`, `arweaveSeeds`, `watchList` (bare **arrays**, each
  omitted when empty — NOT block-wrapped like `foreignKeys`). The doc will
  give the wire shape of every field, not just names, and call out the
  block-vs-bare-array distinction explicitly since it's the exact kind of
  thing a hand-rolled parser gets wrong silently.
- **The one sanctioned entry point** — `useCodexBackup()` from
  `@ancientpantheon/codex/hooks`: `importFromFile`, `importFromCloud`,
  `exportForCloud`, `downloadAsJson`. The doc states plainly: never call
  `deserializeCodex`/`buildCodexExport` directly, never write a parser against
  the JSON shape by hand, never invent your own storage-key reads. If the four
  operations above don't cover a need, that's a signal to extend
  `useCodexBackup`, not to bypass it.
- **The dev-tool exception, named explicitly so it can't be copied by
  mistake** — `codex-playground/src/loadCodex.ts`'s `hydrateFromPlaintextSnapshot`
  (mode-2) is a pre-mount, in-memory seeding shim for the playground's own dev
  harness (constructs a fresh `MemoryCodexAdapter` and `saveAll`s a raw
  `CodexSnapshot` object *before* `<CodexProvider>` mounts). It is not a
  backup-file reader, does no validation beyond object-shape, and is not part
  of the public package surface. The contract doc states this is NEVER the
  integration point for a real consuming app loading a user-supplied JSON
  file — real apps always go through `importFromFile`/`importFromCloud` after
  `<CodexProvider>` is mounted with a real adapter.
- **What Codex owns internally (implementers must NOT reimplement or worry
  about)** — schema migrations (`schemaVersion`, `migrateToCurrent`/
  `applyMigrations` in `codex-ouronet/src/state/store.ts`, run automatically
  inside `actions.init`, itself called by `importFromCloud`); the
  reader-before-writer version gate (the codec always accepts "1.2" and "1.3"
  on read, always writes "1.3" — a consuming app never chooses a version);
  the unknown-top-level-field fail-closed check (`CodexUnknownFieldError` —
  a genuinely malformed/foreign JSON throws instead of silently partial-importing,
  *when routed through the real codec* — the exact protection OuronetUI's
  bypass forfeited); per-entry shape validation for every keyring; and adapter
  storage internals (`MemoryCodexAdapter` vs `LocalStorageCodexAdapter` — how a
  snapshot round-trips to actual disk/localStorage is the adapter's job, never
  the caller's).
- **Extension protocol** — a checklist of every file that MUST change
  together when a new blockchain, keyring, or encryption scheme is added,
  so this doesn't drift again the way `StoaChainSeedType` drifted from
  `SeedType` earlier this session: `codex-core/src/codex/types.ts` (new field
  on `PlaintextCodex` + the wire envelope), `codec.ts` (`KNOWN_TOP_LEVEL_FIELDS`
  allow-list entry + a shape validator + the emit-when-non-empty branch in
  `buildCodexExport`), `codex-ui/src/hooks/useCodexBackup.ts`
  (`buildSnapshotFromState`, `buildBackupPayload`, and `importFromCloud`'s
  `next: CodexSnapshot` field-by-field merge), the `CodexSnapshot` type
  (`codex-ouronet/src/adapters/types.ts`), the store's migration chain if
  `schemaVersion` needs bumping — and this contract document itself, in the
  same change.
- **Secret-field fallback discipline, documented as observed behavior** — a
  secret-bearing keyring omitted from an *older* backup must not wipe a
  live value already in the store on restore. The doc will state the actual,
  current per-field behavior as ground truth (not aspiration): `arweaveSeeds`
  and `watchList` fall back to the current in-store value when the parsed
  backup omits the field (`parsed.X ?? current.X ?? []`); `pureKeypairs` does
  not (`parsed.pureKeypairs ?? []`); and — a discovered inconsistency worth
  flagging to the user separately, not silently fixed as part of writing this
  doc — `foreignKeys` *also* does not fall back to `current.foreignKeys`
  despite being described as funds-critical alongside `arweaveSeeds`
  elsewhere in the same file's comments (`useCodexBackup.ts` lines ~221-226).
  I'll surface this as an explicit open question below rather than changing
  behavior inside a documentation task.

### Alternatives considered

- **Put it only in `README.md`** — rejected: the aggregator README already
  carries Status/version-history/bundled-member-versions content; folding in
  an exhaustive field-by-field contract would bury it. A dedicated file, with
  one pointer line from the README, keeps both readable.
- **Put it in repo-root `docs/`** — rejected: `docs/` never ships in the npm
  tarball (`packages/codex/package.json`'s `files` array is `["dist",
  "CHANGELOG.md", "README.md"]`); an external implementer inspecting
  `node_modules/@ancientpantheon/codex` would never see it. The whole point is
  zero-guessing for implementers who only have the published package.
- **Enforce via a runtime contract-test helper shipped from the package**
  (discussed earlier in conversation) — not rejected, but out of scope here:
  the user's explicit ask this round is the written ruleset. A shippable
  contract-test fixture/helper is a natural follow-up once the doc exists, and
  is called out under Out of scope so it isn't silently dropped.

## Acceptance criteria

- [ ] `packages/codex/IMPORT_EXPORT_CONTRACT.md` exists and is added to
      `packages/codex/package.json`'s `files` array, so `npm pack` /
      `npm view @ancientpantheon/codex` includes it in the published tarball.
- [ ] The document enumerates every field of the `"1.3"` wire envelope
      (`kadenaWallets`, `ouronetWallets`, `addressBook`, `uiSettings`,
      `foreignKeys`, `pureKeypairs`, `arweaveSeeds`, `watchList`), stating for
      each: its wire shape (block vs bare array), whether it's omitted when
      empty, and which in-memory `CodexSnapshot` field it maps to.
- [ ] The document names `useCodexBackup()`'s four operations
      (`importFromFile`, `importFromCloud`, `exportForCloud`,
      `downloadAsJson`) as the ONLY sanctioned entry points, and explicitly
      states that hand-parsing the JSON shape, calling `deserializeCodex`/
      `buildCodexExport` directly, or reading/writing adapter storage keys
      directly are all unsupported.
- [ ] The document explicitly calls out `codex-playground`'s
      `hydrateFromPlaintextSnapshot`/mode-2 path as a dev-tool-only shim that
      real consuming apps must never copy, and states the reason (no
      validation, pre-mount only, not part of the public API surface).
- [ ] The document lists, as a single checklist, every file a future change
      (new blockchain / new keyring / new encryption scheme) must touch
      together, naming each file's exact repo-relative path.
- [ ] The document states which concerns are entirely internal to Codex and
      must never be reimplemented by a consumer: schema migrations, the
      version-accept/version-write gate, unknown-field rejection, per-entry
      shape validation, and adapter storage mechanics.
- [ ] `packages/codex/README.md` gains a one-line pointer to the new document,
      placed near the top (e.g. directly under the existing intro/Status
      area) so it's the first thing a reader sees.
- [ ] Running the existing test suites for `codex-core`, `codex-ui`, and the
      aggregator `codex` package still passes unchanged (this is a
      documentation-only change; no source files change behavior).

## Out of scope

- Fixing the `foreignKeys`-vs-`arweaveSeeds`/`watchList` fallback-discipline
  inconsistency discovered while grounding this design (flagged to the user
  as a separate open question, not bundled into a docs change).
- Building a runtime schema-validator upgrade or an exported contract-test
  helper/fixture for consumers to wire into their own CI (a real, separate
  enforcement mechanism discussed earlier in conversation; this topic covers
  only the written contract).
- Actually fixing OuronetUI's `auth-context.tsx`/`useArweavePanelDeps.ts` (the
  live bug already root-caused and handed off separately this session) — this
  topic is Codex-repo documentation only.
- A general "how to integrate Codex into a host app" onboarding guide beyond
  import/export (provider wiring, adapter selection, theming, etc.) — scoped
  strictly to the import/export contract per the user's explicit ask.
