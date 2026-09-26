# Changelog

## 0.4.0 — 2026-09-26

**MINOR — new `CODEX_FORM_VERSION` export ("1.0.0"). Owner ruling: "schema
version reads 0, now that we settled the form with foreign blockchain
integration on arweave, id say lets name it version 1.0.0."**

- A new, purely additive, cosmetic constant — deliberately NOT a repurposing
  of `CodexSnapshotBase.schemaVersion` (owned by `@ancientpantheon/codex-ouronet`'s
  migration runner, a load-bearing integer state machine ~40 tests assert
  numeric comparisons against) or either of the two OTHER unrelated
  "schema version" fields already in this codebase (`ForeignKeysBlock.schemaVersion`
  in the codec's wire format; each consumer's own `IConsumerSettings.schemaVersion`).
  See `codexFormVersion.ts`'s own doc comment for the full reasoning and the
  versioning policy this establishes going forward (additive-only,
  back-compatible minors; a major reserved for a genuinely breaking snapshot
  shape) — extending the SAME additive-only discipline already in force on
  every other version axis in this codebase (the "1.2"/"1.3" envelope
  reader, `ForeignKeysBlock`'s forward-stamp-only policy) to a new,
  product-facing milestone marker.
- Surfaced in `@ancientpantheon/codex-ouronet`'s `CodexInfoCard` as a new
  "Codex Form" row, alongside (not replacing) the existing "Schema Version"
  row — see that package's own CHANGELOG for the full UI change.

## 0.0.1 — 2026-07-04

- Initial package skeleton.
