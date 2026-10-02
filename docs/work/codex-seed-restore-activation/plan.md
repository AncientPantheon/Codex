## Wave 1

- [x] T1: The eligibility detector. Read
      `packages/codex-arweave/src/seeds/derivePrimeSeed.ts`'s
      `deriveArweaveSeedAtPositionZero` (built this session) and
      `packages/codex-arweave/src/seeds/index.ts`'s `"./seeds"` subpath
      export (added this session so a host app can reach it) in full
      first. New function `checkArweaveRestoreEligibility(params: {
      ouronetBitstring: string; primeArweaveAddress: string;
      workerFactory: () => Worker; onProgress?: (p: KeygenProgress) =>
      void }): Promise<boolean>` in a new module — calls
      `deriveArweaveSeedAtPositionZero({ bitstring: params.ouronetBitstring,
      workerFactory: params.workerFactory, onProgress: params.onProgress })`
      and resolves `true` iff the derived key's address equals
      `params.primeArweaveAddress` (case-sensitive exact match — Arweave
      addresses are base64url, not case-insensitive), `false` otherwise.
      A derivation failure (the underlying promise rejecting) propagates —
      never silently resolves `false`, which would misreport a technical
      failure as "not eligible."

      Follow TDD: write the failing test first (inject a fake
      `workerFactory` mirroring `tests/seeds-derive-prime-seed.test.ts`'s
      own `FakeWorker` convention — read that file and reuse its pattern
      rather than inventing a new one), confirm it fails, then implement.

      Done when: given a fake worker whose derived key's address matches
      `primeArweaveAddress`, resolves `true`; given a non-matching
      address, resolves `false`; given a worker that errors, the error
      propagates (not swallowed into `false`).
  - files: `packages/codex-arweave/src/seeds/checkRestoreEligibility.ts`
    (new), `packages/codex-arweave/tests/
    seeds-check-restore-eligibility.test.ts` (new)

## Wave 2 (depends on Wave 1)

- [x] T2: The UI eligibility status + the `ArweavePanelDeps` seam. Read
      `packages/codex-arweave/src/panel/context.tsx`'s `ArweavePanelDeps`
      (in particular `revealAccountSecret`'s existing optional-seam shape
      — `(accountId: string) => Promise<string | null> | string | null`
      — as the closest precedent for an optional, host-supplied,
      Promise-returning seam) and `packages/codex-arweave/src/panel/
      ArweaveSeedsArea.tsx` and `CodexBackupArea.tsx` in full first, to
      decide (and justify in your report) which area is the right mount
      point — whichever one already has access to both "this is the Prime
      Arweave seed" and "here's where a status row/banner already
      renders" without inventing new layout.

      Add `checkArweaveRestoreEligibility?: () => Promise<boolean>` to
      `ArweavePanelDeps` (host-supplied, no params — the host already has
      everything it needs to answer the question itself; `codex-arweave`'s
      UI layer never touches an Ouronet account's bitstring directly,
      preserving this project's host-app-bridges-isolated-packages
      pattern). Build a new UI component (e.g.
      `ArweaveRestoreEligibilityStatus.tsx`) that, when `deps.
      checkArweaveRestoreEligibility` is present: shows a real,
      honest "checking…" state while the call is in flight (this can take
      several seconds — an RSA-4096 derivation runs underneath; never a
      silent freeze), then "eligible — your next backup will include a
      seed-word recovery point" or "not yet eligible" (plain, factual
      copy — no urgency/scare language, this is informational). When the
      seam is absent (undefined), render nothing (same "absent seam →
      graceful no-op" discipline every other optional `ArweavePanelDeps`
      field in this codebase already follows) — the mock adapter is not
      required to implement this for this task (a sibling task wires the
      real one). Mount the new component in `ArweavePanel.tsx` at the
      location chosen above.

      Follow TDD: write the failing tests first (a fake
      `checkArweaveRestoreEligibility` resolving `true`, resolving
      `false`, and a pending/never-resolving case to assert the
      "checking…" state renders), confirm they fail, then implement.

      Done when: with a fake seam resolving `true`, the component shows
      the eligible copy; resolving `false`, the not-yet-eligible copy;
      while pending, the checking state; with the seam absent, nothing
      renders (verified by a real mount through `ArweavePanel`, not the
      component in isolation only).
  - files: `packages/codex-arweave/src/panel/context.tsx`,
    `packages/codex-arweave/src/panel/ArweaveRestoreEligibilityStatus.tsx`
    (new), `packages/codex-arweave/src/panel/ArweavePanel.tsx`,
    `packages/codex-arweave/tests/` (new test file matching this
    package's existing panel-component test naming convention)

## Wave 3 (depends on Wave 2)

- [x] T3: Real host-app wiring — the eligibility check AND making a real
      backup actually carry the recovery tag when eligible. Read
      `apps/codex-playground/src/realArweaveAdapter.ts`'s current
      `backupCodex` implementation (confirmed this session to pass
      NEITHER `codexPassword` NOR `primeArweaveSeedBitstring` NOR
      `cryptoSeam` into `backupCodexToLibrary` — read the exact current
      state fresh, do not assume) and `apps/codex-playground/src/
      ForeignChainsWiring.tsx`'s existing `revealAccountSecret` wiring
      (~line 923, the closest precedent for "reach an unlocked codex's
      secret material from the host layer") in full first.

      Investigate and ground (report your findings): how does this host
      app currently reveal an ARWEAVE SEED's (not an Ouronet account's)
      own plaintext bits on demand? `ArweaveSeedsArea.tsx` has its own
      "decrypt on demand" pattern for Chainweb-seed-derived entries (grep
      it, read the surrounding context) — determine whether that's backed
      by an existing `ArweavePanelDeps` seam reusable here, or whether one
      needs to be added. Also determine how to find "the Prime Arweave
      seed" and "the Prime Ouronet account" from the host's own store
      access (mirror whichever pattern `kickstartPrimeArweaveSeed.ts`,
      built this session for T4 of the sibling `codex-recovery-backup-
      tagging` plan, already uses to find/derive these — read that file
      first, it is the closest and most recent precedent in this exact
      codebase).

      Implement `ArweavePanelDeps.checkArweaveRestoreEligibility` in
      `buildRealPanelDeps`/`ForeignChainsWiring.tsx`: reveal the Prime
      Ouronet account's bitstring (via the existing `revealAccountSecret`
      seam or equivalent), read the Prime Arweave seed's stored address,
      and call T1's `checkArweaveRestoreEligibility`. Also update
      `backupCodex`: before calling `backupCodexToLibrary`, run the same
      eligibility check (cache the result for the duration of one backup
      call — do not force the user through two separate multi-second RSA
      derivations for one logical action); when eligible, additionally
      reveal the Prime Arweave seed's own plaintext bitstring (the seam
      grounded above) and pass `codexPassword` (the same plaintext
      already available to this call site — read how it currently obtains
      the export payload/password material), `primeArweaveSeedBitstring`,
      and a `CryptoSeam` instance (mirror how `accountKeyCipher.ts`'s
      other real call sites in this host app already obtain one — ground
      this, do not guess) into `backupCodexToLibrary`'s options. When not
      eligible, call it exactly as today (no new params) — explicit
      regression guard.

      Follow TDD: extend the existing playground test coverage for
      `realArweaveAdapter.ts`/`ForeignChainsWiring.tsx` (grep for the
      existing `backupCodex`/`onBackupSuccess` test as the precedent to
      mirror), confirm the new tests fail first, then implement.

      Done when: a mocked/fake-keygen "eligible" scenario results in
      `backupCodexToLibrary` being called with all three new params, and
      the posted tags (traced through to a real or faked
      `uploadCodexBackup` call) include a `Codex-Backup-Recovery-Key` that
      decrypts back to the exact codex password; an "ineligible" scenario
      results in `backupCodexToLibrary` being called with none of the
      three (byte-identical to pre-this-task behavior). The full
      `codex-arweave`, `codex-ouronet`, `codex-ui`, and `codex-playground`
      test suites pass (unscoped — check for and fix any gap outside this
      task's own file list, flagging explicitly if found, matching every
      prior task in this project; the one known pre-existing unrelated
      failure is `codex-arweave`'s `tests/e3-library-store.test.ts`
      `node:sqlite` sandbox limitation). `npx tsc -b`/each package's
      `typecheck` script is clean for every touched package. `npm run
      build --workspace=@ancientpantheon/codex-playground` succeeds
      (rebuild any touched package's own dist first if stale-dist
      resolution bites — a repeatedly-hit gotcha in this project).
  - files: `apps/codex-playground/src/realArweaveAdapter.ts`,
    `apps/codex-playground/src/ForeignChainsWiring.tsx`, plus whichever
    existing playground test file(s) cover `backupCodex`/
    `onBackupSuccess` wiring (grep to confirm the right file(s) before
    adding a new one)
