# Changelog

## 0.5.0 — 2026-09-27

**MINOR — fix `StoaChainSeedType`/`SeedType` divergence that broke every
headless-resolver consumer's typecheck on a "stoic" (Stoa Dalos) seed.
Reported externally: Pythia's `keyResolver.ts:88` failed with
`TS2322: Type '"stoic"' is not assignable to type 'StoaChainSeedType'` on
every deploy that bumps `@ancientpantheon/codex` to `@latest`, because
`headlessResolver.ts`'s `StoaChainSeedType` stayed a 3-member mirror of
codex-ouronet's `SeedType` after `SeedType` gained a 4th member ("stoic")
for Stoa Dalos seeds — its doc comment's "verbatim" claim was never
enforced.**

- `StoaChainSeedType` now carries all four members
  (`"koala" | "chainweaver" | "eckowallet" | "stoic"`) — it is the DATA label
  on `StoaChainSeedLike.seedType`/`SnapshotSlice`, restoring assignability
  for any real `CodexSnapshot`.
- New export `MnemonicSeedType` (the original 3-member list) — the
  CAPABILITY type for the two positions that actually perform mnemonic-based
  derivation: `HeadlessResolverDeps.deriveStoaChainKeypair`'s `seedType`
  parameter and `ResolvedStoaChainKeypair.seedType`. Neither widened: this
  factory never derives or resolves a "stoic" key — that's
  `resolveStoicKeypair`'s job entirely outside codex-core (a stoic seed's
  secret decrypts to a DALOS bitstring, not a mnemonic, and routing it
  through `StoaChainWalletBuilder.createWalletPairFromMnemonic` would
  silently derive the wrong key via the wrong algorithm).
- `getKeyPairByPublicKey`'s derived-account loop now skips any
  `seedType: "stoic"` seed before the mnemonic derivation call — a
  compiler-enforced guard (the skip narrows `seed.seedType` to
  `MnemonicSeedType` for the rest of the loop body), not just a doc-comment
  promise. If a stoic account ever reaches this generic factory anyway
  (shouldn't happen — real callers resolve stoic seeds earlier), it now
  falls through to the existing "not found" error instead of a silent
  wrong-key derivation.
- New compile-time parity test in `@ancientpantheon/codex-ouronet`
  (`tests/type-seedtype-parity.test.ts`) fails `tsc` the moment `SeedType`
  and `StoaChainSeedType` diverge again in either direction.

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
