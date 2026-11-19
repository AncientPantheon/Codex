## Wave 1

- [ ] T1: Add the `Codex_Shape_Version` field (exact name) across the
      core snapshot/export types, the codec's emit/accept paths, and a new
      pure pre-unlock detection utility. In
      `packages/codex-core/src/adapters/types.ts`: add
      `Codex_Shape_Version?: string` to `CodexSnapshotBase` (alongside the
      existing `schemaVersion: number` field, ~line 34-43), with a doc
      comment explaining it is DISTINCT from `schemaVersion` (travels in
      the export; `schemaVersion` explicitly does not) and from
      `CODEX_PACKAGE_VERSION_OUTPUT` (per-codex-instance shape, not
      per-app-build). In `packages/codex-core/src/codex/types.ts`: add
      `readonly Codex_Shape_Version?: string` to `PlaintextCodex` (~line
      90-98, same optionality discipline as the existing `foreignKeys?`
      field) and to `CodexExportV1_3` (~line 224). In
      `packages/codex-core/src/codex/codec.ts`: `buildCodexExport` emits
      `Codex_Shape_Version` on the returned object only when
      `codex.Codex_Shape_Version !== undefined` (same omit-when-absent
      spread pattern already used for `pureKeypairs`/`arweaveSeeds`/
      `watchList`, ~line 94-111); `deserializeCodex`'s
      `KNOWN_TOP_LEVEL_FIELDS` Set (~line 128-154) gets `"Codex_Shape_Version"`
      added as an 11th entry, with a one-line comment noting it is the
      11th and what it's for. Create
      `packages/codex-core/src/codex/shapeVersion.ts` (new) exporting:
      `detectCodexShapeVersion(rawJson: string): string | undefined` —
      defensively `JSON.parse`s `rawJson` inside try/catch (any parse
      failure, non-object result, or missing/non-string field yields
      `undefined`, never throws — same discipline as this session's
      `deriveBackupLineage` in `codex-arweave/src/library/flow.ts`), reads
      `parsed.Codex_Shape_Version` when it is a string, else `undefined`;
      and `formatCodexShapeVersionLabel(v: string | undefined): string` —
      returns `` `v${v}` `` when `v` is defined, else the literal string
      `"Unversioned"`. Export both from
      `packages/codex-core/src/index.ts` (new export block near the
      existing `CODEX_FORM_VERSION` export, ~line 17). Done when:
      `buildCodexExport({...validPlaintextCodex, Codex_Shape_Version:
      "1.0.0"})` includes `Codex_Shape_Version: "1.0.0"` in its return
      value, and `buildCodexExport({...validPlaintextCodex})` (field
      omitted) has no `Codex_Shape_Version` key at all on the returned
      object; `deserializeCodex` on a valid envelope carrying
      `Codex_Shape_Version: "1.0.0"` round-trips it onto the returned
      `PlaintextCodex` without throwing `CodexUnknownFieldError`, and an
      envelope WITHOUT the field also deserializes successfully with
      `Codex_Shape_Version === undefined` on the result;
      `detectCodexShapeVersion` returns `"1.0.0"` when called on
      `JSON.stringify({Codex_Shape_Version: "1.0.0", ...})`, returns
      `undefined` on malformed JSON (`"{not json"`) without throwing, and
      — read from disk directly in the test —  returns `undefined` when
      called on the raw text of both
      `Miscellaneous/_Codices/Foreign/Ionut_OuronetCodex_2026-10-11_13-22-23.json`
      and
      `Miscellaneous/_Codices/Foreign/Iounut-Latests_OuronetCodex_2026-10-11_13-22-23.json`
      (absolute paths from the repo root's parent —
      `../../../../Miscellaneous/_Codices/Foreign/...` from
      `packages/codex-core/tests/`, or resolve via `path.resolve` from
      `import.meta.url`; state the exact resolution you used);
      `formatCodexShapeVersionLabel("1.0.0") === "v1.0.0"` and
      `formatCodexShapeVersionLabel(undefined) === "Unversioned"`.
  - files: `packages/codex-core/src/adapters/types.ts`,
    `packages/codex-core/src/codex/types.ts`,
    `packages/codex-core/src/codex/codec.ts`,
    `packages/codex-core/src/codex/shapeVersion.ts` (new),
    `packages/codex-core/src/index.ts`,
    `packages/codex-core/tests/codec-shape-version.test.ts` (new),
    `packages/codex-core/tests/shape-version-detect.test.ts` (new)

## Wave 2 (depends on Wave 1)

- [ ] T2: Rename the `CODEX_FORM_VERSION` constant to
      `CODEX_PACKAGE_VERSION_OUTPUT`, renaming its file to match. Rename
      `packages/codex-core/src/codexFormVersion.ts` to
      `packages/codex-core/src/codexPackageVersionOutput.ts`, renaming the
      exported `CODEX_FORM_VERSION` constant to
      `CODEX_PACKAGE_VERSION_OUTPUT` (same `"1.0.0" as const` value,
      unchanged) and updating its doc comment to clarify it answers "what
      version of the Codex package/app produced this output," explicitly
      distinct from the new per-codex `Codex_Shape_Version` field (T1) —
      name and reference the sibling field in the comment so a future
      reader doesn't reintroduce the old confusion. Update
      `packages/codex-core/src/index.ts`'s export line (~line 17) to
      `export { CODEX_PACKAGE_VERSION_OUTPUT } from
      "./codexPackageVersionOutput.js";`. Update the two real consumer
      import sites to the new name, changing ONLY the imported identifier
      — zero behavior change: `packages/codex-ouronet/src/ui/settings/CodexInfoCard.tsx`
      (~line 29 `import { CODEX_FORM_VERSION } from
      "@ancientpantheon/codex-core";` → `CODEX_PACKAGE_VERSION_OUTPUT`;
      its ~line 150-151 usage updates to match — the actual two-row
      display logic is T4's job, not this task's, so here ONLY rename the
      import/usage 1:1, do not restructure the card) and
      `packages/codex-arweave/src/library/flow.ts` (~line 87 `import {
      reencryptBackupSecretFields, CODEX_FORM_VERSION } from
      "@ancientpantheon/codex-core";` → `CODEX_PACKAGE_VERSION_OUTPUT`;
      ~line 1463 `{ name: TAG_CODEX_FORM_VERSION, value:
      CODEX_FORM_VERSION }` → `{ name: TAG_CODEX_FORM_VERSION, value:
      CODEX_PACKAGE_VERSION_OUTPUT }` — the TAG KEY constant
      `TAG_CODEX_FORM_VERSION` itself (and its own string value,
      `"Codex-Form-Version"`) does NOT change — only the VALUE constant's
      name changes). Done when: `grep -rn "CODEX_FORM_VERSION"
      packages/codex-core/src packages/codex-ouronet/src
      packages/codex-arweave/src` returns zero matches (the renamed
      constant no longer exists under its old name anywhere in source);
      `packages/codex-arweave/tests/e3-library-flow.test.ts`'s existing
      test "tags Codex-Form-Version with the REAL CODEX_FORM_VERSION
      constant..." (~line 832-846) still passes after updating its own
      import (~line 52, 69) to `CODEX_PACKAGE_VERSION_OUTPUT` — rename the
      test's own import/variable references, do not change its
      assertions, confirming the wire tag value is byte-identical to
      before the rename; `packages/codex-ouronet/tests/ui-codex-settings-info-cards.test.tsx`'s
      existing "Codex Form" row test still passes after the same import
      rename (do not touch its assertions in this task — T4 restructures
      that test's assertions for the two-row display, this task only
      keeps it green through the rename).
  - files: `packages/codex-core/src/codexFormVersion.ts` (renamed to
    `packages/codex-core/src/codexPackageVersionOutput.ts`),
    `packages/codex-core/src/index.ts`,
    `packages/codex-ouronet/src/ui/settings/CodexInfoCard.tsx`,
    `packages/codex-arweave/src/library/flow.ts`,
    `packages/codex-arweave/tests/e3-library-flow.test.ts`,
    `packages/codex-ouronet/tests/ui-codex-settings-info-cards.test.tsx`

- [ ] T3: Add `Codex_Shape_Version` to the live codex-ouronet store,
      persisted the same way `schemaVersion` already is, stamped on fresh
      creation only. In `packages/codex-ouronet/src/state/store.ts`: add
      `Codex_Shape_Version: string | undefined` to `CodexStoreState`
      (~line 304, alongside the existing `schemaVersion: number` field);
      default it to `undefined` in the initial state object (~line 713,
      alongside `schemaVersion: 0`); include it in every snapshot-building
      object literal that currently includes `schemaVersion` as part of
      building/persisting a `CodexSnapshot` (grep `schemaVersion:` in this
      file to find every site — confirmed present at minimum around lines
      646, 1023, 1176, 1229, 2263, 2297; each site either reads the
      current live value or participates in persisting/restoring it —
      mirror `schemaVersion`'s own handling at each site exactly, 1:1, no
      new logic). In `kickstartCodex` (the fresh-codex-creation action,
      same function whose `seedType: "koala"` default was confirmed
      earlier this session around line 902): after the existing seed/
      account creation, stamp `Codex_Shape_Version: "1.0.0"` into the
      state via the same `set({...})` call that already sets this
      action's other fields — a fresh codex IS already in the current
      shape, so this is NOT deferred to any future migration step. An
      IMPORTED codex (`recoverCodexFromMnemonic`/`init`/restore path) must
      NOT set `Codex_Shape_Version` itself — it reads whatever the loaded
      snapshot carries (`undefined` for a codex lacking the field,
      exactly like the `codexIdentity`/`readPrimeAlignment`-style coalesce
      pattern already used in this file for fields that predate a given
      codex — state which exact precedent line you mirrored). Done when:
      `createCodexStore()` → `kickstartCodex(...)` → `store.getState().Codex_Shape_Version
      === "1.0.0"`; a store initialized from a `MemoryCodexAdapter` seeded
      with a snapshot that has no `Codex_Shape_Version` key results in
      `store.getState().Codex_Shape_Version === undefined` after
      `init()`/load completes — never silently stamped; the value
      round-trips through `adapter.saveAll()`/`adapter.loadAll()` the same
      way `schemaVersion` already does (a dedicated test stamping it,
      reloading, and reading it back); existing `schemaVersion`-focused
      tests in `tests/state-store.test.ts` still pass unmodified (this is
      a purely additive sibling field, never touching `schemaVersion`'s
      own logic).
  - files: `packages/codex-ouronet/src/state/store.ts`,
    `packages/codex-ouronet/tests/state-store.test.ts`

- [ ] T5: Wire the pre-unlock version label into `codex-playground`'s own
      load/unlock flow — the minimal real demonstration. In
      `apps/codex-playground/src/UnlockScreen.tsx`: change
      `export function UnlockScreen(): ReactElement` to accept a new
      optional prop, `export function UnlockScreen({ shapeVersion
      }: { shapeVersion?: string } = {}): ReactElement`, importing
      `formatCodexShapeVersionLabel` from `@ancientpantheon/codex-core`
      and rendering `formatCodexShapeVersionLabel(shapeVersion)` (e.g. as
      a small label/badge near the existing `<h1 className="cxpg-title">Unlock
      your Codex</h1>`, ~line 73 — exact placement/styling your call,
      state it) — ALWAYS rendered (shows "Unversioned" when `shapeVersion`
      is `undefined`, not hidden), visible before the password `<input>`
      receives focus or any keystroke. In `apps/codex-playground/src/App.tsx`'s
      `EncryptedSession` component (~line 785-839, where `backupText` is
      already a prop in scope): import `detectCodexShapeVersion` from
      `@ancientpantheon/codex-core`, compute
      `const shapeVersion = detectCodexShapeVersion(backupText);` once per
      render (cheap pure call, no memoization needed), and change the
      existing `return <UnlockScreen />;` (~line 837) to
      `return <UnlockScreen shapeVersion={shapeVersion} />;`. Done when: a
      Vitest render test of `<UnlockScreen shapeVersion="1.0.0" />` finds
      the text "v1.0.0" in the rendered output, and
      `<UnlockScreen shapeVersion={undefined} />` (and `<UnlockScreen />`
      with no prop at all) finds the text "Unversioned"; a REAL BROWSER
      check (headless chromium via CDP, the pattern already established
      this session — `node_modules/ws`, `DOM.setFileInputFiles`) loading
      one of the two real `Miscellaneous/_Codices/Foreign/*.json` files
      through the actual running `apps/codex-playground` dev server shows
      "Unversioned" on the unlock screen BEFORE the password field is
      interacted with — quote the exact `innerText` captured as evidence
      in your report, the same discipline used earlier this session's
      real-browser verifications.
  - files: `apps/codex-playground/src/UnlockScreen.tsx`,
    `apps/codex-playground/src/App.tsx`,
    `apps/codex-playground/tests/unlock-screen-shape-version.test.tsx` (new
    — check `apps/codex-playground`'s actual test directory name/location
    first via its own `package.json`/`vite.config`/existing test files
    before creating; use whatever convention already exists there)

## Wave 3 (depends on Wave 2)

- [ ] T4: `CodexInfoCard.tsx` shows two distinct, correctly-labeled rows
      instead of one conflated one. In
      `packages/codex-ouronet/src/ui/settings/CodexInfoCard.tsx`: the
      existing row at ~line 148-151 (`label="Codex Form"
      value={CODEX_PACKAGE_VERSION_OUTPUT}` after T2's rename) stays, but
      its `label` changes to `"Codex Package"` (answers: what app/package
      version is running right now — a build constant, same for every
      codex opened in this session). Add a NEW row immediately
      above/beside it, `label="Codex Shape"`, whose `value` is
      `formatCodexShapeVersionLabel(useCodex().Codex_Shape_Version)` (the
      REAL per-codex value from the live store via the existing
      `useCodex()` hook this file already imports and uses for
      `schemaVersion`, ~line 10-11's own doc comment already names the
      pattern to mirror) — import `formatCodexShapeVersionLabel` from
      `@ancientpantheon/codex-core`. Update the file's own top-of-file doc
      comment (~line 6-12, which currently explains "Schema Version" vs
      "Codex Form" as deliberately separate rows) to instead explain all
      THREE now-present concepts (Schema Version / Codex Shape / Codex
      Package) and why each is distinct — do not leave the old two-concept
      explanation in place describing a row that no longer means what it
      says. Done when: rendering `<CodexInfoCard>` under a
      `<CodexProvider>` whose store has `Codex_Shape_Version: "1.0.0"`
      shows BOTH a "Codex Shape" row reading "v1.0.0" AND a "Codex
      Package" row reading `CODEX_PACKAGE_VERSION_OUTPUT`'s literal value
      ("1.0.0" today, incidentally the same string — the test must assert
      BOTH rows exist with their own labels, not merely that "1.0.0"
      appears somewhere, so a future divergence between the two values is
      actually caught); a store with `Codex_Shape_Version: undefined`
      shows "Codex Shape: Unversioned" while "Codex Package" still shows
      the real build constant unaffected; the existing
      `packages/codex-ouronet/tests/ui-codex-settings-info-cards.test.tsx`
      test covering this card's "Codex Form" row (left green-but-renamed
      by T2) is updated here to reflect the real "Codex Package"/"Codex
      Shape" two-row structure — state exactly what changed in the
      test and why.
  - files: `packages/codex-ouronet/src/ui/settings/CodexInfoCard.tsx`,
    `packages/codex-ouronet/tests/ui-codex-settings-info-cards.test.tsx`

- [ ] T6: Export filename carries the shape version. In
      `packages/codex-ui/src/hooks/useCodexBackup.ts`: locate where
      `buildSnapshotFromState()`/the live state assembles the snapshot
      passed to `buildBackupPayload` (read the full current
      `exportForCloud`/`downloadAsJson` implementation first, ~line
      140-189, to confirm exactly how/whether `Codex_Shape_Version` from
      the live store already flows through this assembly after T3 — if
      `buildSnapshotFromState` spreads the whole live state generically it
      may already carry the field with zero code change here; if it
      enumerates fields explicitly, add `Codex_Shape_Version:
      state.Codex_Shape_Version` to that enumeration; state which case was
      true and what you changed, if anything). Change `downloadAsJson`'s
      default-filename template (~line 180-183) from
      `` `OuronetCodex_${new Date().toISOString().replace(/[:.]/g, "-")}.json` ``
      to read the shape version off the already-computed snapshot/export
      payload and build
      `` `OuronetCodex_v${shapeVersion ?? "unversioned"}_${timestamp}.json` ``
      — do not re-parse the JSON string to get this value; read it from
      the same in-memory object already produced by `exportForCloud()`'s
      own `buildBackupPayload(snapshot)` call. Done when: calling
      `downloadAsJson()` (no explicit filename argument) against a store
      with `Codex_Shape_Version: "1.0.0"` triggers a download whose
      `a.download` value matches
      `/^OuronetCodex_v1\.0\.0_.+\.json$/` (assert via a test spying on
      `document.createElement`/the anchor's `.download` property, mirroring
      however this file's EXISTING `downloadAsJson` tests already spy on
      the DOM download mechanism — reuse that exact harness, do not invent
      a new one); a direct unit test of the filename-template logic alone
      (extracted as its own small pure function if not already separable,
      your call — state what you did) confirms the `"unversioned"` branch
      renders correctly for an `undefined` shape version, since no real
      post-T1 export can ever be missing the field to test this
      end-to-end.
  - files: `packages/codex-ui/src/hooks/useCodexBackup.ts`,
    `packages/codex-ui/tests/use-codex-backup.test.ts` (confirm this
    exact filename via `ls packages/codex-ui/tests/ | grep -i backup`
    before editing — use whatever the real existing test file for this
    hook is actually named)
