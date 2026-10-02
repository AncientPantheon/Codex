## Wave 1

- [x] T1: Add a reusable, explicitly-named account-keyed cipher wrapper —
      `encryptWithAccountKey(plaintext: string, bitstring: string):
      Promise<string>` and `decryptWithAccountKey(ciphertext: string,
      bitstring: string): Promise<string>` — in a new module. Both are thin
      wrappers: `encryptWithAccountKey` calls `encryptStringV2(plaintext,
      bitstring)` and `decryptWithAccountKey` calls `smartDecrypt(ciphertext,
      bitstring)`, both imported from `@stoachain/stoa-core/crypto` (read
      `packages/codex-arweave/src/keyring/foreignKeys.ts` first — it already
      imports `CryptoSeam`-shaped crypto from this exact package family;
      match its import style). `bitstring` MUST be the raw 1600-bit `"0"`/`"1"`
      string form (never base10/base49/any other representation) — the
      module's doc comment must state this explicitly as the ONE canonical
      form, matching `docs/work/arweave-upload-categories/design.md` §3's
      established convention, and must NOT re-derive or validate the
      bitstring's shape itself (that's `resolveSeedBitString.ts`'s job,
      already enforced upstream of every caller). No new cipher logic — this
      task adds zero cryptographic code of its own, only the two named
      wrapper functions and their documentation. Follow TDD: write the
      failing round-trip test first, confirm it fails (module doesn't exist
      yet), then implement.

      Done when: `encryptWithAccountKey` then `decryptWithAccountKey` with
      the same bitstring round-trips a plaintext string exactly;
      `decryptWithAccountKey` with a DIFFERENT bitstring than the one used
      to encrypt throws (wrong-key failure, mirroring `smartDecrypt`'s own
      `WrongPasswordError`/auth-tag-failure behavior — do not swallow or
      reinterpret this error, let it propagate).
  - files: `packages/codex-arweave/src/crypto/accountKeyCipher.ts` (new),
    `packages/codex-arweave/tests/crypto-account-key-cipher.test.ts` (new)

## Wave 2 (depends on Wave 1)

- [x] T2: Add the `Codex-Backup-Recovery-Key` tag to the codex-backup
      upload path. Read `packages/arweave-core/src/upload/codexBackup.ts`
      and `packages/codex-arweave/src/library/flow.ts`
      (`backupCodexToLibrary`) in full first — both already forward
      `appId`/`appVersion` as optional pass-throughs derived from parsing
      `exportJson`; this task adds a similarly-optional, similarly-forwarded
      new input, NOT a new tag-schema constant in `arweave-core/src/upload/
      tags.ts` (do not touch that file — the existing `appMetadata?:
      readonly Tag[]` parameter on `UploadParams`/`BuildUploadTagsParams`
      is exactly the seam for an application-level tag like this one; using
      it means zero changes are needed anywhere in `tags.ts`).

      In `backupCodexToLibrary`: add two new optional parameters to
      `BackupCodexToLibraryOptions` — `codexPassword?: string` (the
      plaintext password the codex is currently unlocked with; opaque to
      this function, exactly like `exportJson` already is — never logged,
      never echoed) and `primeArweaveSeedBitstring?: string` (the Prime
      Arweave seed's raw bitstring, also opaque and never logged). When
      BOTH are present: call T1's `encryptWithAccountKey(codexPassword,
      primeArweaveSeedBitstring)` to get the ciphertext, and pass
      `{ name: "Codex-Backup-Recovery-Key", value: ciphertext }` as an
      `appMetadata` entry into the underlying `uploadCodexBackup`/
      `uploadData` call. When EITHER is absent, proceed exactly as today —
      no tag, no error, no placeholder value (a codex with no Prime Arweave
      seed yet must still be able to back up normally).

      `uploadCodexBackup` itself does not need to change — `appMetadata` is
      already a parameter `uploadData` accepts and `uploadCodexBackup`
      already forwards params through to it (confirm this yourself by
      reading `uploadCodexBackup`'s current body before assuming it needs
      an edit; if it turns out `appMetadata` isn't already threaded through
      from `UploadCodexBackupParams` to `uploadData`, add exactly that one
      pass-through field, nothing else, to `UploadCodexBackupParams`).

      Follow TDD: write the failing tests first, confirm they fail, then
      implement.

      Done when: given both `codexPassword` and `primeArweaveSeedBitstring`,
      the posted upload carries a `Codex-Backup-Recovery-Key` tag whose
      value, run through T1's `decryptWithAccountKey` with the same
      bitstring, yields the exact original password string; given either
      one absent, no such tag is posted and the backup still succeeds
      exactly as it does today (regression guard — assert the existing
      tag set is otherwise unchanged).
  - files: `packages/arweave-core/src/upload/codexBackup.ts` (only if the
    `appMetadata` pass-through genuinely doesn't already exist — verify
    first),
    `packages/arweave-core/tests/upload-codex-backup.test.ts` (same
    condition), `packages/codex-arweave/src/library/flow.ts`,
    `packages/codex-arweave/tests/e3-library-flow.test.ts`

- [x] T3: Add a Prime Arweave seed auto-derivation function. New function
      `deriveArweaveSeedAtPositionZero(params: { bitstring: string;
      workerFactory: () => Worker; onProgress?: (p: KeygenProgress) =>
      void }): Promise<SeededKey>` in a new module, built on
      `runSeededBatch` (`packages/codex-arweave/src/keygen/KeygenRunner.ts`
      — read it and `packages/codex-arweave/src/seeds/planIndexRanges.ts`
      in full first). Call `runSeededBatch` with `ranges: [{ start: 0, end:
      0 }]` (index 0 is force-included by the underlying library regardless,
      per `planIndexRanges.ts`'s own documented behavior — this task does
      not need to special-case that, just request it explicitly for
      clarity) and resolve with the single `SeededKey` delivered via
      `onKey` (reject if the batch completes with zero keys delivered, or
      if it's cancelled/aborted — surface the underlying error rather than
      hanging). This function does NOT persist anything or know about
      `ArweaveSeedEntry`/the codex store — it is a pure derivation
      primitive; building the actual `ArweaveSeedEntry` (id, label, secret
      — encrypted via whatever this package's existing seed-persistence
      path already uses, read `ArweaveSeedsArea.tsx`'s own "Option 2"
      define-seed flow to mirror its exact persistence shape rather than
      inventing a new one) and calling `addArweaveSeed`/`isPrime: true` is
      T4's job, at the layer that actually has access to the codex store.

      Follow TDD: write the failing test first (inject a fake
      `workerFactory`/fake worker mirroring this package's existing
      keygen-test conventions — grep `tests/` for the existing pattern used
      to test `runSeededBatch`/`ArweaveSeedsArea`'s generate flow and mirror
      it exactly rather than inventing a new fake-worker shape), confirm it
      fails, then implement.

      Done when: given a fake worker that delivers exactly one key at index
      0, `deriveArweaveSeedAtPositionZero` resolves that key; given a fake
      worker that errors, it rejects with the underlying error (never a
      generic/reworded message that hides what actually failed).
  - files: `packages/codex-arweave/src/seeds/derivePrimeSeed.ts` (new),
    `packages/codex-arweave/tests/seeds-derive-prime-seed.test.ts` (new)

## Wave 3 (depends on Wave 2)

- [x] T4: Wire Prime Arweave seed installation to run automatically right
      after a codex is kickstarted, and make it testable locally in
      `apps/codex-playground`. Start by investigating, and document your
      findings in your final report (this is genuinely open — do not guess
      past it):
      - `packages/codex-ui/src/hooks/useCodexLifecycle.ts`'s `kickstart` is
        currently a bare pass-through to `codex-ouronet`'s
        `kickstartCodex` store action, with zero orchestration logic.
        `codex-ui` does NOT currently depend on `codex-arweave` (confirmed
        absent from `packages/codex-ui/package.json`) — deliberately, since
        `codex-ui` is the chain-agnostic layer (the generic
        `ForeignChainsTab` architecture from
        `docs/work/codex-class-ia-arweave/design.md`). Adding a
        codex-arweave dependency to codex-ui would break that genericity —
        do NOT do this. The orchestration belongs at the HOST APP layer
        (mirroring exactly how `apps/codex-playground/src/App.tsx` already
        composes `useCodexBackup()` together with `ForeignChainsWiring`'s
        Arweave-specific deps for the codex-backup feature, per
        `docs/work/arweave-upload-categories/design.md`'s addendum) — never
        inside any `codex-*` package itself.
      - At the time of this writing, no file under `apps/` calls
        `useCodexLifecycle()`'s `kickstart` at all (confirmed via grep) —
        meaning there may be no existing "create a brand-new codex" UI flow
        in the playground to hook into yet. Confirm this yourself; if
        true, this task must add a MINIMAL one — a single button/form
        sufficient to actually exercise kickstart + Prime Arweave
        auto-install locally (the user explicitly wants this testable
        locally, not left stubbed) — it does not need to be polished UI,
        it needs to be real and clickable. If a kickstart flow DOES exist
        somewhere not caught by this grep (e.g. reached indirectly), wire
        into that instead of adding a duplicate.
      - `addArweaveSeed` is not currently exposed through any `codex-ui`
        hook (confirmed via grep) — reach it the same way
        `useCodexLifecycle.ts` itself reaches `kickstartCodex`:
        `useCodexStore()` → `store((s) => s.actions)` → the action
        directly. Mirror that exact pattern rather than adding a new hook
        abstraction for one call site, unless you find a clear existing
        precedent this codebase already uses for exposing a single store
        action to a host app (in which case, follow that instead and cite
        it in your report).

      The orchestration itself, once you've found or built the call site:
      after `kickstart()` resolves successfully, derive the new Ouronet
      account's bitstring (the same value already used to seed the Prime
      Ouronet account — read `kickstartCodex`'s actual return shape to find
      it, do not assume a field name), call T3's
      `deriveArweaveSeedAtPositionZero`, build the resulting
      `ArweaveSeedEntry` (mirroring `ArweaveSeedsArea.tsx`'s "Option 2"
      persistence shape, `isPrime: true`), and call `addArweaveSeed`.
      Surface the ~6.7-second derivation as a real, visible in-progress
      state in whatever UI this runs behind — never a silent multi-second
      freeze.

      Follow TDD where the orchestration logic itself can be unit-tested
      (the "kickstart succeeds → Arweave seed gets installed" composition,
      independent of whatever minimal UI wraps it); for any new UI surface
      added, add a test file following this package's/the playground's
      existing UI-test conventions.

      Done when: triggering kickstart in the (possibly newly-added, minimal)
      playground flow results in a Prime Arweave seed
      (`isPrime: true`, derived from the same bitstring as the new Ouronet
      account) actually appearing in the codex's Arweave seeds — verified
      both by a unit test of the orchestration composition AND by you
      confirming manually (build the playground, describe exactly how you
      verified it in your report — a screenshot description or an explicit
      step-by-step you actually ran, not an assumption it works) that a
      fresh kickstart in the running app produces a visible Prime Arweave
      seed with no separate manual step.
      The full `codex-arweave`, `codex-ui`, `codex-ouronet`, and
      `codex-playground` test suites pass; `npx tsc -b` is clean for every
      touched package; `npm run build --workspace=@ancientpantheon/codex-playground`
      succeeds.
  - files: `packages/codex-ui/src/hooks/useCodexLifecycle.ts` (only if
    investigation shows orchestration belongs there rather than at the host
    app — justify in your report if you deviate from the host-app-only
    guidance above), `apps/codex-playground/src/App.tsx` and/or a new file
    for the minimal kickstart UI if none exists, plus whichever test files
    your investigation determines are the right home for the new coverage.
