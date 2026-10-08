# Changelog

## 0.7.0 — 2026-10-08

**MINOR — Codex ID page + codex-backup dual-key envelope encryption.**
New `panel/ArweavePanel.tsx` "Codex ID" tab: live eligibility status
(reusing `checkArweaveRestoreEligibility`), two new explainer components
(`CodexBackupInformatics.tsx`, `CodexMigrationInformatics.tsx`), and a
real "back up this codex" action (reusing the existing `CodexBackupArea`
mount). `library/flow.ts`'s `backupCodexToLibrary` is rebuilt around a
new `crypto/backupEnvelope.ts` (DEK generation, AES-GCM content
encryption, scalar-wrapped DEK export/import): a fresh IDEK re-encrypts
every secret field (via `@ancientpantheon/codex-core`'s new
`reencryptBackupSecretFields`), a fresh EDEK seals the whole result as
one opaque blob, both wrapped under the Master Seed and/or Standard
Apollo bitstrings, either optionally PIN-protected (RSA-4096 keygen at a
PIN-chosen position, reusing the existing Worker-wrapped keygen
primitive — never a new main-thread RSA call). New
`restoreCodexFromBackupEnvelope` + `determineBackupSourceRouting` handle
the inverse, tag-presence-routed, for both default and PIN'd sources. The
old `Codex-Backup-Recovery-Key` password-tag mechanism is fully removed.
`Codex-Form-Version` (the real codex-shape constant) replaces a
timestamp-derived tag on backup uploads.

Also: fixed a real-browser-discovered bug (not in this package) in how a
freshly-kickstarted codex's secret was stored upstream, which made the
new backup feature's bitstring-reveal chain fail for any new codex — see
`@ancientpantheon/codex-ouronet`'s own changelog.

## 0.6.1 — 2026-10-08

**PATCH — two real-world wiring gaps, found from an owner bug report.**
`isStreamingUploadSupported.ts`'s probe internally calls
`createSyncAccessHandle()`, which by spec only works inside a dedicated
Worker — but `UploadWizard.tsx`'s own `useEffect` called it directly on
the main thread (used only to decide the Files-step banner and whether
the 2 GiB fallback cap applies), so it always reported "unsupported" in
every browser, regardless of real capability. New
`library/streaming/supportProbeWorker.ts` + `SupportProbeRunner.ts` move
this check into a Worker, mirroring the upload/dry-run paths' own already
-correct wiring. Separately, `ArweavePanelDeps` (`panel/context.tsx`)
gained `runDryRunUpload`/`isStreamingUploadSupported` fields — previously
constructed by the real host adapter but never declared on this
interface, so `ArweavePanel.tsx` had no way to thread either through to
`UploadWizard`, meaning the "Test this upload" dry-run button (shipped in
0.6.0) has never actually been visible to a real user until now. Both
re-verified end to end through the real, unmodified `ArweavePanel`/host-
adapter wiring in a real browser.

## 0.6.0 — 2026-10-05

**MINOR — streaming (arbitrary-size) upload engine.** New `library/streaming/` module tree: `bundleAssemblyFile`/`assembleBundleToFile` (incremental OPFS-backed bundle construction, one file resident at a time), `crypto/streamingFileEncryption` (chunked AES-256-GCM, 256 KiB plaintext windows, a sibling to the existing whole-file `fileEncryption` module which stays untouched — old encrypted uploads keep decrypting exactly as before), `streamingPost`/`streamingPostResumeStore` (chunk-by-chunk posting with IndexedDB-backed resume checkpointing), `isStreamingUploadSupported` (a real OPFS-support probe, not a feature-detect guess), `uploadBundleStreaming` (the streaming-engine-backed drop-in for the classic `uploadBundle`/`uploadData`), and `uploadWorker`/`StreamingUploadRunner` (the dedicated-Worker wiring — OPFS sync-access-handles are Worker-only by spec, so the real upload call chain now runs off the main thread). `library/flow.ts`'s `uploadAndTrack`/`uploadFilesAndTrack` route through streaming automatically when supported; the old in-memory path remains as an honest, explicitly-capped (2 GiB) fallback otherwise. `UploadWizard.tsx` gains a persistent progress indicator, a route-decision indicator, a plain-language disclaimer banner, and a "Test this upload" dry-run button backed by a new `dryRunUpload` engine (`@ancientpantheon/arweave-core`'s new `createLocalDryRunGatewayApiFactory`, zero real network) that self-verifies its own result via an independent Merkle-proof check and a decrypt round-trip, and deliberately exercises the interrupt/resume path. No breaking changes to any existing export.

## 0.4.0 — 2026-09-24

**MINOR — Pantheonic-mobile compliance for the whole Arweave panel, plus
Super Max wallet sweep. No breaking changes.**

- **Mobile layouts for `ArweaveAccountsArea`, `ArweaveSeedsArea`,
  `PureKeysArea`.** Icon-only sticky sub-tab bar, 2-line compact account/seed
  rows, icon-only seed-source buttons (own seed / Ouronet account / Chainweb
  seed), a triple-dot row-actions menu portaled to `document.body` (escaping
  the swipe carousel's `transform`, which otherwise mispositions any
  `position: fixed` descendant), and — mirroring the Chainweb side — a real
  full-screen detail view on tap instead of an inline expand: seed rows and
  Pure Key rows both now portal their expanded content into a full-screen
  `CodexModalShell`. The Pure Key detail view specifically was restructured
  into a vertical stack (single-line truncated address, action buttons, then
  the RSA-parameter disclosure), each on its own row.
- **`ArweaveAddressHighlight`** (in `ArweaveAccountsArea.tsx`) is now
  exported and reused by `PureKeysArea.tsx` instead of duplicating the
  width-measurement/truncation logic.
- **`wordsSecret` on `IArweaveSeed`** (mirrors the same new field on
  `IStoaChainSeed` in `codex-ouronet`): a seed created from typed/generated
  words can now show those real words back on later reveal.
- **Send AR: Super Max.** A second, riskier "empty the wallet" mode
  alongside the existing (buffered) Max — forces "Fee Included", fills the
  whole balance, and uses the exact live-quoted fee with no safety buffer.
  Both now carry an explanatory tooltip via the shared `ActionTooltip`.

## 0.0.1 — 2026-07-04

- Initial package skeleton.
