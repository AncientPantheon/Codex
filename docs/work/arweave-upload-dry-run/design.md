# Arweave Upload Dry Run — Project Design

## Problem

The owner's explicit ask: a way to test the real streaming-upload
implementation against his OWN real files — including the actual 6.25 GB /
5,982-file NFT folder driving this whole project — **without** spending real
AR, risking a botched real upload, or needing to trust test-suite coverage
alone. The existing rigor this project already applies (real-browser CDP
checks, byte-identical comparisons against independent oracles) proves the
ENGINE is correct; it does not give the owner a way to press a button in the
actual app and see his actual files pass or fail before he commits to the
real thing.

## Grounding

- `arweave-core`'s `UploadGatewayApiFactory` (`src/upload/types.ts`) and
  `StreamingUploadGatewayApiFactory` (`src/upload/streaming/
  createStreamingTransaction.ts`) are the real seams every upload path
  (classic and streaming) already posts through. Every existing test fake
  implementing these lives ONLY in test files (`tests/e3-helpers.ts`,
  `streaming-post.test.ts`, etc.) — there is no shippable, production-code
  local/no-op gateway implementation anywhere today. Building one is new
  work, not a refactor of existing fakes (existing test fakes are untouched).
- `arweave`'s own `generateProofs`/`validatePath` (already used by
  `arweave-streaming-post-resume`'s T3 real-browser check as an independent
  correctness oracle) is a strong, already-proven-reachable way to verify a
  captured chunk's Merkle proof against a computed `data_root` without
  trusting this project's own code to grade its own homework.
- `StreamingPostResumeStore`/`resumeStreamingPost` already exist and are
  unit-and-real-browser-proven in isolation — but have never been exercised
  against a user's own real file selection inside the real app.

## Approach

### A shippable local/no-op gateway (new production code, not test-only)

`packages/arweave-core/src/upload/localDryRunGateway.ts`: a
`createLocalDryRunGatewayApiFactory()` implementing BOTH the classic
`UploadGatewayApiFactory` and `StreamingUploadGatewayApiFactory` contracts
(ground their exact real shapes at build time), accepting every
tx/chunk POST, storing bytes in memory keyed by tx id, returning realistic
success responses — zero network calls, zero AR spent, by construction (no
`fetch`/`Api` call anywhere in this module). Exposes an inspection surface
(e.g. `getCapturedChunks(txId)`, `getCapturedTx(txId)`) for the self-verify
pass below. This is genuinely reusable beyond this one feature (anything
needing a safe local stand-in for the gateway contract), but this sub-topic
scopes it to exactly what the dry-run feature needs — no speculative extra
surface.

### The dry-run engine

`packages/codex-arweave/src/library/streaming/dryRunUpload.ts`:
`runUploadDryRun(files, selection, opts) → Promise<DryRunResult>` — mirrors
the real `uploadAndTrack`/`uploadFilesAndTrack` entry point's parameter
shape exactly (so the UI calls it with the SAME state the wizard already
built), and:

1. Runs `isStreamingUploadSupported()` (from `arweave-streaming-ui`) — the
   dry run reflects whatever would ACTUALLY happen for a real upload right
   now, streaming or fallback, never a fictional idealized path.
2. Executes the real upload logic with the local dry-run gateway factory
   injected in place of the real one — same code path as a real upload,
   different destination.
3. **Never calls `store.append`** — no Library persistence, by construction
   (not a flag that could be left on by accident).
4. **Self-verifies**, using only independent checks, not "it didn't throw":
   - For encrypted uploads: decrypts the captured ciphertext chunks (via
     `arweave-streaming-encryption`'s `decryptStream`) and compares,
     byte-for-byte, to the original selected files.
   - For every upload: validates every captured chunk's Merkle proof
     against the computed `data_root` via `arweave`'s own `validatePath` —
     the same real gateway-side check a real `/chunk` POST would be
     subjected to.
   - **Deliberately interrupts and resumes**: stops the post loop after a
     few chunks of the largest file (same fake-gateway-throws-after-N
     technique every unit test in this project already uses), then calls
     `resumeStreamingPost` against the SAME local gateway and a REAL
     `StreamingPostResumeStore`, and confirms completion — this is the
     single highest-value thing to prove with the owner's own real files,
     since resumability is exactly what protects a multi-gigabyte real
     upload from a closed laptop lid or dropped connection.
5. Cleans up its own throwaway OPFS file and resume record unconditionally
   (success or failure), leaving no residue.
6. Returns a plain result: `{ success, filesTested, totalBytes,
   chunksPosted, resumeTested, proofsValid, decryptRoundTripOk, elapsedMs,
   errors: string[] }` — enough for a non-engineer to read as a clear
   pass/fail plus evidence.

### The UI entry point

A second button in the Upload Wizard's Review step, alongside (not
replacing) the real "Confirm Upload" button: **"Test this upload (free —
runs locally, nothing is sent to Arweave)"**. Calls `runUploadDryRun` with
the wizard's current real file selection, shows a dedicated result panel
(separate from the real `phase`/`uploading`/`done` state machine — a dry
run can never be confused with a real completed upload), including a plain-
language pass/fail banner, the stats above, and any errors in full.

### The documentation page section

Extends the documentation page `arweave-streaming-ui` creates (the
"self-test section" placeholder it explicitly leaves): explains, in plain
language, what the Test button does (and does not do — e.g. "no AR is
spent, nothing is posted to Arweave, your files never leave your browser"),
what each line of the result panel means, and what to do if it reports
failure (don't proceed with the real upload; what information to report).

## Acceptance criteria

- [ ] Running the dry run against the owner's own real large file selection
      (a multi-gigabyte set, both encrypted and unencrypted) in a real
      browser completes, with every self-verification check (proof
      validation, decrypt round-trip where applicable, resume test) passing
      and a clear, honest `DryRunResult` shown in the UI.
- [ ] A deliberately-broken input (e.g. a corrupted/mismatched key) makes the
      dry run report FAILURE clearly, not a false pass — verified by an
      actual induced-failure test, not assumed.
- [ ] No real network request to any Arweave gateway occurs during a dry
      run — verified structurally (e.g. a spy on `fetch`/the real `Api`
      asserting zero calls) across a full dry-run execution including the
      interrupt/resume phase.
- [ ] No Library entry, resume record, or OPFS file persists after a dry run
      completes (success or failure) — verified directly.
- [ ] The documentation page's self-test section exists and is reachable
      from the dry-run button's immediate vicinity.

## Out of scope

- Any change to the real upload path's own correctness guarantees — this
  sub-topic only ADDS a parallel, safe way to exercise it, never modifies
  how a real upload behaves.
- Making the local dry-run gateway a general-purpose testing utility for
  other parts of the codebase beyond what this feature itself needs.
