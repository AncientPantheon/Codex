# Changelog

## 0.9.2 — 2026-10-15

**PATCH — critical fix: `./arweave` could not be bundled for the browser.**
A real downstream consumer (OuronetUI) reported `@ancientpantheon/codex`
1.5.x failing `vite build` with `"read" is not exported by
node-stdlib-browser/esm/mock/empty.js` — invisible to `tsc`/`vitest`, only a
production bundler catches it. Root-caused to two layers: `await
import("arbundles")` in `assembleBundleToFile.ts`/`dryRunUpload.ts` resolved
arbundles' Node ESM build (bundling `fs`/`stream/promises` into the final
dist) instead of its real published browser build, because this package's
bundler doesn't apply the "browser" resolution condition by default. Fixed
by importing `"arbundles/web"` explicitly at both call sites — confirmed the
same signing surface (`ArweaveSigner`, `createData`, `sign`,
`longTo32ByteArray`, `Bundle`) is exported there. See
`@ancientpantheon/codex`'s own changelog entry for the second layer (axios,
pulled in transitively, needed a bundler-level fix) and the full
verification. No API or behavior change — the signing/streaming code paths
are identical, only which build of a dependency gets inlined changed.

## 0.9.1 — 2026-10-13

**PATCH — the Codex ID page, finalized (three rounds of owner-reported
UX fixes on top of 0.9.0's first build).**

1. **Informatics tabbed, not stacked.** The backup/migration explainers
   still read as one undifferentiated wall even after a visual-only
   re-style — split into three tabs ("How Backup Works" / "Encryption" /
   "Migration"), mirroring the Arweave panel's own established pill-tab
   pattern. Encryption mechanics (the one-time key, the two independent
   unlock paths, the PIN) now live in their own dedicated
   `CodexEncryptionInformatics` component/tab.
2. **Backup gated on eligibility, for real.** The real backend
   (`backupCodex`) already unconditionally requires the codex to be
   eligible — the button just never reflected that. It's now visibly
   disabled with honest copy until eligibility resolves true, instead of
   letting a click reach a guaranteed thrown error.
3. **Backup opens as a real popup.** Uses the same modal chrome
   (`CodexModalShell`) every other write-action in this app already
   uses, instead of rendering its confirm/progress/result states inline
   on the page.
4. **Eligibility explanation corrected, twice**, after direct
   owner clarification: the real historical cause (Koala was what
   onboarding has always used, not the only possible mechanism; most
   codexes also derived their Ouronet Account from the same words;
   Arweave support simply came later) replaces an earlier, wrong
   "wallet-imported vs. fresh words" framing. Added the previously-missing
   explanation of what migration is actually FOR and why a Master Seed
   matters: one seed generating the Ouronet Account, Chainweb keys, and
   Prime Arweave Seed together is what lets seed-words-only restore
   locate an Arweave backup of everything else a codex holds.
5. **Full width.** The page and its informatics cards no longer impose
   an artificial reading-width cap that left real empty space on wide
   viewports — both now fill their container.

## 0.9.0 — 2026-10-12

**MINOR — arbitrarily-large folder uploads, finished end to end; plus two
new in-app informatics pages; plus the Codex ID page promoted to a
top-level tab on both desktop and mobile.**

**Split-bundle upload, now genuinely reachable (not just built).** A
folder selection too large to fit in available disk space is no longer
blocked or demanding impossible free space — it automatically splits
into the minimum number of sequential bundle uploads that each fit a
computed safe byte budget (`checkAvailableStorageBudget`/
`planSplitBundles`), tied together by one shared manifest covering every
file across every bundle. Runs strictly sequentially (never concurrently)
through the existing, unmodified per-bundle engine; a plan is persisted
before the first bundle starts so an interruption resumes correctly —
completed bundles are never re-signed or re-posted, the in-flight bundle
resumes from its own real checkpoint. The Upload Wizard shows the
computed plan before starting ("this N GB selection will upload as K
bundles of about M GB each") and a whole-sequence progress view that
never resets at a bundle boundary. The common (fits-in-one-bundle) case
is provably unchanged — same call, same arguments, same result shape.

Like every other real upload in this package, the split-bundle engine
runs its disk-staging work in a dedicated Worker (`splitUploadWorker.ts`
+ `SplitUploadRunner.ts`, mirroring the existing single-bundle
`uploadWorker.ts`/`StreamingUploadRunner.ts` pair exactly) — a hard
browser requirement (`createSyncAccessHandle()` only works off the main
thread), not a design choice. Real files cross the Worker boundary
directly (never pre-read on the main thread — for a multi-GB folder that
would defeat the whole point); the gateway pool and both persistence
stores are reconstructed fresh inside the Worker rather than sent across.

Found and fixed via real-browser verification (not merely unit tests):
the original host wiring minted a brand-new upload id on every call,
silently defeating the resumability a real interrupted upload depends
on — confirmed live (a killed mid-upload Worker, retried, re-signed and
re-posted an already-completed bundle under a new transaction id).
Fixed by persisting the pending upload id per account + selection
fingerprint, cleared only on genuine completion.

**New: an in-app informatics section on the Upload page**, explaining
the real upload mechanics in plain language — why a bundle has to be
fully assembled before it can be posted (one Merkle tree, one
signature), the 256 KiB chunking, why local disk space is needed and
roughly how much, and how an oversized selection now becomes multiple
sequential bundles automatically.

**Expanded: the Codex ID page's backup-encryption informatics**, now
explaining the mechanism in more depth — why either unlock path (Master
Seed words or the Codex Identity's Standard half) works alone (both
independently unlock the very same one-time key, not two different
keys), and what a PIN actually does mechanically (a real second key
generated from the PIN's digits REPLACES that path's ordinary lock,
rather than stacking on top of it).

**Codex ID, now independently mountable.** Previously reachable only 3
clicks deep (Blockchain Accounts → Arweave → a Codex ID tab inside that
panel), which had already caused real user confusion. The Codex ID page
content is extracted into its own standalone component, `CodexIdPage`
(new export, `panel` subpath), taking the same `ArweavePanelDeps` seam
every other panel component already reads — renderable both from its
original deep-link location (unchanged, still reachable the old way)
and directly, as its own top-level destination, wherever a host
chooses to mount it. The bundled standalone demo app (not part of this
package's own published surface) now does exactly that, as a reference
implementation — see its own source for the pattern.

## 0.8.0 — 2026-10-08

**MINOR — "Export Library" button, additive.** `panel/LibraryArea.tsx`
gains an Export button alongside the existing Rebuild control: downloads
a JSON file (`{exportedAt, itemCount, items}`) built from the SAME
already-loaded `entries` array the paginated UI itself reads (every
owner, every page — not a per-page export), reusing `openHrefFor`'s real
link composition (manifest-aware for bundled files) and the existing
filename-extraction convention verbatim rather than re-deriving either.
Each item carries `filename`/`link`/`id`/`owner`/`contentType`/`status`/
`isManifest`/`uploadId`. Reuses the existing `saveBytesAsFile` download
trigger already used for individual file downloads — no new download
mechanism. Works cleanly on an empty Library (`items: []`, button never
disabled/hidden).

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
