# Bug report: UploadWizard's own OPFS-support banner/cap always reports "unsupported"

## Reported by

The owner, testing a real 6 GB folder upload through the real app in
Vivaldi (2026-10-07) — got the "this browser doesn't support the private,
on-device storage" banner and the 2 GiB fallback cap, on a genuinely
OPFS-capable (Chromium-based) browser.

## Root cause (confirmed by direct code reading, not a guess)

`packages/codex-arweave/src/library/streaming/isStreamingUploadSupported.ts`
internally calls `fileHandle.createSyncAccessHandle()` — by Web spec, this
**only works inside a dedicated Worker**, never on the main document
thread; calling it there always throws.

This was already correctly handled for:
- The real upload path — `uploadWorker.ts` calls the probe from inside a
  real Worker (`arweave-streaming-worker-wiring`).
- The dry-run feature — `dryRunWorker.ts` does the same
  (`arweave-upload-dry-run` T3's own flagged scope deviation).

But `packages/codex-arweave/src/panel/UploadWizard.tsx` (~line 866-875)
has its OWN, separate, THIRD call site: a plain `useEffect` on mount
calling `isStreamingUploadSupported()` directly — main thread, no Worker —
purely to decide what the Files-step banner says and whether the 2 GiB
fallback cap applies to file-adds. This call was never moved into a
Worker, so it ALWAYS throws internally and ALWAYS resolves `false` —
in every real browser, regardless of actual OPFS support.

`apps/codex-playground/src/realArweaveAdapter.ts` confirmed (via grep) to
never pass an `isStreamingUploadSupported` prop override to `UploadWizard`
— it only wires `uploadAndTrack`/`uploadFilesAndTrack`/`runDryRunUpload`,
leaving `UploadWizard`'s broken main-thread default in effect.

## Why this was never caught by prior real-browser verification

Every real-browser capstone check this session used fixture files well
under the 2 GiB fallback cap (100 MB, a few MB) specifically to keep test
runs fast and stable. The REAL upload itself still correctly routed
through streaming in those runs (that path's own, separately-Worker-wrapped
probe call was fine) — only the UI's own cosmetic banner/cap-gate call was
broken, and nothing in those tests ever tried to add a file large enough
to actually hit that gate and observe the block.

## Fix direction

Mirror the exact two-layer wiring pattern already used for the real
upload and the dry-run feature: move this ONE remaining main-thread
`isStreamingUploadSupported()` call into a Worker too, and have
`realArweaveAdapter.ts` pass the Worker-backed version down as
`UploadWizard`'s `isStreamingUploadSupported` prop (which already exists
and is already injectable — built for exactly this purpose, just never
wired to anything other than the broken default).


---
**STATUS: RESOLVED (2026-10-08).** Fixed by moving the check into a
dedicated Worker (`supportProbeWorker.ts` + `SupportProbeRunner.ts`),
wired through `realArweaveAdapter.ts`. A separate, bigger gap was found
and fixed alongside it — see `docs/work/arweave-upload-wizard-deps-wiring-gap/`.
Verified end-to-end through the real, unmodified `ArweavePanel` in a real
browser: banner now correctly shows no "unsupported" message, a
simulated 6 GB file is accepted without the false cap.

