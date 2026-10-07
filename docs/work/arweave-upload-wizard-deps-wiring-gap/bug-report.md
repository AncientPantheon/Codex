# Bug report: real `ArweavePanel.tsx` never wires `runDryRunUpload`/`isStreamingUploadSupported` to `UploadWizard`

## Found by

Direct code reading, immediately after fixing the sibling
`arweave-streaming-ui-support-probe-worker` bug — that fix's own report
flagged this exact gap ("mirroring the existing flagged gap for
`runDryRunUpload`"), confirmed by reading `ArweavePanel.tsx` directly.

## Confirmed facts

- `packages/codex-arweave/src/panel/ArweavePanel.tsx` (~line 1339-1362),
  the component that actually renders in the real app, constructs
  `<UploadWizard>` with `accounts`/`ouronetAccounts`/`pool`/
  `uploadAndTrack`/`uploadFilesAndTrack`/`openUrl`/`revealAccountSecret`/
  `getBalance`/`ensureCodexUnlocked`/`onAccountUsedForEncryption`/`onClose`
  — **no `runDryRunUpload`, no `isStreamingUploadSupported`.**
- `UploadWizard.tsx` conditionally renders its "Test this upload" button
  AND its result panel only when `runDryRunUpload` is truthy
  (`{runDryRunUpload ? (...) : null}`, both the button and the panel) —
  confirmed by direct read, two call sites (~line 1706, ~1728). **The
  button has never been visible in the real app since it was built.**
- `isStreamingUploadSupported` (absent → defaults to the broken
  main-thread direct call, now fixed at the source in the sibling bug —
  but still never overridden here with the new Worker-backed version,
  since nothing passes it through) — same absence pattern.
- `apps/codex-playground/src/realArweaveAdapter.ts`'s `buildRealPanelDeps`
  DOES already construct both `runDryRunUpload` (from
  `arweave-upload-dry-run` T3) and `isStreamingUploadSupported` (from the
  just-fixed sibling bug) correctly — but as EXTRA fields on an
  intersection type beyond `ArweavePanelDeps` itself (both tasks flagged
  this explicitly: `ArweavePanel.tsx`/`context.tsx` were out of their
  respective file scopes). `ArweavePanelDeps` (in `context.tsx`) never
  declared either field, so `ArweavePanel.tsx` — typed against that
  narrower interface — has no way to even see them, let alone pass them
  to `<UploadWizard>`.
- Side note, NOT a bug: `ArweavePanelDeps.uploadAndTrack`/
  `uploadFilesAndTrack` are also typed WITHOUT the 4th optional
  `callbacks` parameter `UploadWizard` actually calls them with — but
  since JavaScript doesn't enforce function arity at runtime, the real
  underlying functions (which DO accept a 4th arg, per the
  `arweave-streaming-worker-wiring` fix) still receive and use it
  correctly despite the imprecise TYPE. Worth tightening for type
  honesty while in this file, not a functional bug on its own.

## Impact

Two real, user-facing consequences, both live in production right now:
1. The OPFS-support banner/cap in the real app was always wrong (separate,
   now-fixed sibling bug) — but even with that fix landed, nothing passes
   the corrected Worker-backed check through to the real rendered panel.
2. **The "Test this upload" dry-run feature — built, tested, and verified
   working in isolation — has never actually been visible to a real user.**
   This is exactly the safety net the owner would have wanted to use
   before attempting the 6 GB real upload that surfaced the sibling bug.

## Fix direction

- Add `runDryRunUpload?: (...) => Promise<DryRunResult>` and
  `isStreamingUploadSupported?: () => Promise<boolean>` to
  `ArweavePanelDeps` (context.tsx), matching `UploadWizardProps`'s real
  current shapes exactly.
- Update `ArweavePanel.tsx`'s `<UploadWizard>` JSX to pass
  `runDryRunUpload={deps.runDryRunUpload}`
  `isStreamingUploadSupported={deps.isStreamingUploadSupported}`.
- Optionally tighten `uploadAndTrack`/`uploadFilesAndTrack`'s declared
  type to include the 4th `callbacks` parameter for type honesty (not
  required for functional correctness, since it already works at
  runtime — but worth doing while touching this file).
- Verify in a REAL browser, through the REAL `ArweavePanel.tsx` render
  (not a bypass): the Test button is now visible, clicking it runs a real
  dry run and renders a result, and the OPFS-support banner now reflects
  genuine support.


---
**STATUS: RESOLVED (2026-10-08).** `ArweavePanelDeps` (context.tsx)
widened with `runDryRunUpload`/`isStreamingUploadSupported`;
`ArweavePanel.tsx` now threads both through to the real `<UploadWizard>`
render. Verified through the real, unmodified production wiring in a real
browser: the "Test this upload" button is now visible and functional —
a real dry run against a real account returned `PASS`, with
`streamingSupported: Yes` confirming the sibling probe fix is reached
too. codex-arweave 892/1-skip, codex-playground 223/223, both clean
typechecks.

