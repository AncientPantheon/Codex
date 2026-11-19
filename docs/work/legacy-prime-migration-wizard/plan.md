## Wave 1

- [x] T1: Add the `primeAlignment` field to codex state (the per-codex
      eligibility-shape marker from `legacy-prime-migration/design.md`'s
      "Marking a codex's alignment shape" section) and the lock-in guard
      on `promoteSeedAndAccountToPrime`. Mirror `schemaVersion`'s own
      top-level-state field pattern exactly (type declaration on the
      state interface, a default value for codices that predate it,
      included in the persisted snapshot shape alongside the existing
      collections). Add `primeAlignment: "legacy" | "aligned"` to the
      state interface (around where `schemaVersion: number` is declared,
      `packages/codex-ouronet/src/state/store.ts:294`), default
      `"legacy"` (mirroring `schemaVersion`'s own default at line 660),
      persisted the same way `schemaVersion` is (the `set({...})` snapshot
      shape around lines 597/969/1122). Add a new store action
      `stampPrimeAlignmentAligned(): Promise<void>` that sets
      `primeAlignment` to `"aligned"` — idempotent (calling it again when
      already `"aligned"` is a no-op, not an error). Add the lock-in
      refusal to the EXISTING `promoteSeedAndAccountToPrime` action
      (`store.ts` line ~1951): if `get().primeAlignment === "aligned"`,
      throw a `CodexError` with a clear message ("this codex's Prime trio
      is already locked — promoteSeedAndAccountToPrime refuses once
      aligned") BEFORE any of its existing validation/mutation, zero
      state change. Done when: `primeAlignment` defaults to `"legacy"` on
      a fresh store (verified by reading `store.getState().primeAlignment`
      immediately after store creation, no kickstart needed); after
      `stampPrimeAlignmentAligned()`, `store.getState().primeAlignment
      === "aligned"` and the value round-trips through
      `adapter.loadAll()`; calling `stampPrimeAlignmentAligned()` a second
      time resolves without error and leaves state unchanged; calling
      `promoteSeedAndAccountToPrime` on an aligned codex rejects with
      `CodexError` and leaves `kadenaSeeds`/`ouroAccounts` byte-identical
      to before the call (verified via `toEqual` against the pre-call
      snapshot, mirroring the existing zero-mutation tests in the same
      describe block); the 6 pre-existing `promoteSeedAndAccountToPrime`
      tests in `tests/state-store.test.ts` still pass unmodified (a
      "legacy" default codex is never blocked by the new guard).
  - files: `packages/codex-ouronet/src/state/store.ts`,
    `packages/codex-ouronet/tests/state-store.test.ts`

- [x] T2: The local no-op StoaChain/Kadena transaction client for mockup
      mode (`legacy-prime-migration-mockup/design.md`'s "A shippable
      local no-op chain client" section). Read
      `packages/codex-ouronet/node_modules/@stoachain/stoa-core/dist/
      network/failoverClient.js`'s real `getFailoverClient(chainId)`
      return shape (`{dirtyRead, submit, listen, pollOne}`) first — ground
      the exact real signatures, don't guess. Build
      `createLocalDryRunFailoverClient(): { dirtyRead, submit }` in a new
      file: `dirtyRead(transaction)` returns a realistic
      `{result: {status: "success", data: ...}, gas: <plausible number>}`
      shape WITHOUT making any real network/Pact-node call anywhere in
      this module (zero `fetch`/`createClient` calls — verified
      structurally, not just "it doesn't throw"); `submit(transaction)`
      returns `{requestKey: <synthetic-but-realistic base64url string>}`
      and records the call (the transaction object it was given,
      verbatim) into an in-memory, inspectable log the caller can read
      back (e.g. a `getSubmittedTransactions(): Array<{requestKey,
      transaction}>` export or a method on the returned object — your
      call on exact shape, state it). Mirrors
      `packages/arweave-core/src/upload/localDryRunGateway.ts`'s own
      "accept everything, store in memory, zero network calls by
      construction" discipline — read that file first and match its
      structure/doc-comment style. Done when: calling `submit` on any
      well-formed transaction object never makes a real network call
      (verified via a `fetch`/`createClient` spy asserting zero
      invocations across a call); `submit`'s recorded log contains the
      exact transaction object passed in, retrievable afterward; multiple
      `submit` calls each get their own distinct synthetic `requestKey`;
      `dirtyRead` resolves without throwing for a well-formed input and
      the returned shape has `result.status === "success"`.
  - files: `packages/codex-ouronet/src/mockup/localDryRunFailoverClient.ts`
    (new), `packages/codex-ouronet/tests/
    mockup-local-dry-run-failover-client.test.ts` (new)

- [x] T3: The wizard shell + Page 1 (intro) + the real entry-point wiring
      on the Codex ID page, replacing the disabled "coming soon"
      placeholder. Read `packages/codex-arweave/src/panel/UploadWizard.tsx`
      for the established single-large-component, internal-step-state
      wizard convention (its own `step`/`STEP_LABELS` pattern,
      `CodexModalShell` usage) and mirror it — this is the SAME shape of
      thing (a multi-page popup wizard), just Ouronet-domain instead of
      Arweave-domain. Read `packages/codex-ouronet/src/ui/internal/
      CreateStoaChainSeedModal.tsx` too (the design doc's own cited
      precedent for the account/seed-creation sub-flow Page 2 will later
      need). Build `LegacyPrimeMigrationWizard.tsx`: a
      `CodexModalShell`-wrapped component taking `{open: boolean, onClose:
      () => void}` plus whatever read-only codex data Page 1 needs (none,
      for intro content alone — it's static). Internal `step` state
      starting at `"intro"` (a string union type, extend it with
      `"account"` and `"keys"` now even though only `"intro"` has real
      content yet — T4/T5 fill those in, this task just needs the type to
      exist so later tasks extend the SAME file coherently). Page 1's
      content: reuse `CodexMigrationInformatics`'s own established prose
      register (read it for tone) for the "why/what" explanation, PLUS a
      new, clearly-set-apart warning block stating the lock-in rule
      verbatim: "once this completes, your Prime Ouronet Account, Prime
      Chainweb Seed, and Prime Arweave Seed are locked — permanently." A
      "Continue" button (disabled until this is the real wiring — for
      this task, since only "intro" exists, "Continue" can be present but
      need not yet navigate anywhere real; state clearly in the component
      what it currently does, e.g. a no-op or console-stub, so the NEXT
      task's dependency is obvious). Export `LegacyPrimeMigrationWizard`
      from `packages/codex-ouronet/src/components/index.ts` (mirroring
      how `RotatePaymentKeyModal` etc. are already exported there). Wire
      it into `packages/codex-arweave/src/panel/CodexIdPage.tsx`: replace
      the current unconditionally-disabled "Make This Codex Eligible
      (coming soon)" button with one that's enabled whenever
      `codexIdEligibility !== "eligible"` (i.e. exactly the cases it's
      currently shown at all) AND opens this new wizard via a
      `legacyPrimeMigrationWizardOpen` boolean state, instead of doing
      nothing. The OLD "coming soon" title/copy is replaced by real
      wizard-opening behavior — this is a deliberate, flagged behavior
      change from the currently-shipped disabled state. Done when:
      rendering `<LegacyPrimeMigrationWizard open onClose={fn} />`
      directly shows the intro content and the lock-in warning text, and
      calling the close handler (× button or equivalent) invokes the
      passed `onClose`; on the Codex ID page, for a not-yet-eligible
      codex, the "Make This Codex Eligible" button is no longer
      `disabled`, and clicking it opens the wizard modal (verified via a
      new testid, e.g. `legacy-prime-migration-wizard-modal`, appearing
      in the DOM); the wizard modal is absent before the button is
      clicked and present after; existing Codex ID page tests that assert
      the OLD disabled-button behavior are updated to match the new
      reality (do not leave a contradicting assertion in place).
  - files: `packages/codex-ouronet/src/ui/internal/
    LegacyPrimeMigrationWizard.tsx` (new), `packages/codex-ouronet/src/
    components/index.ts`, `packages/codex-ouronet/tests/
    ui-legacy-prime-migration-wizard.test.tsx` (new),
    `packages/codex-arweave/src/panel/CodexIdPage.tsx`,
    `packages/codex-arweave/tests/e4-panel-codex-id.test.tsx`,
    `packages/codex-arweave/tests/e4-panel-codex-id-extraction.test.tsx`

## Wave 2 (depends on Wave 1 T3)

- [x] T4: Page 2 — the Prime Ouronet Account identity choice. Extends
      `LegacyPrimeMigrationWizard.tsx`'s `step` state machine with
      `"account"`, reached via Page 1's "Continue" (wire it for real now
      — T3 left it a stub specifically for this task to complete). Three
      radio-style choices, read from real codex data (passed into the
      wizard as props — `currentPrimeSeed`/`currentPrimeAccount`/
      `allSeeds`/`allAccounts`, your call on exact prop shape, state it;
      `CodexIdPage.tsx` sources these from whatever hook/context already
      exposes `kadenaSeeds`/`ouroAccounts` to its siblings — read
      `ArweavePanel.tsx`'s own existing usage of
      `useOuroAccounts`/equivalent to find the real seam, don't invent a
      new one):
      1. "Keep your current account" — always available.
      2. "Choose an existing account with arbitrary words" — a picker
         listing every `IStoaChainSeed` with `seedType === "stoic"`
         already in the codex (the already-tracked signal confirmed
         during design — no new field), each paired with its derived
         `IOuroAccount` (via `parentSeedId`). Hidden entirely (not just
         disabled) when zero such seeds exist. Marked as the
         recommended/default choice whenever at least one exists.
      3. "Type new words" — a text entry (reuse
         `CreateStoaChainSeedModal.tsx`'s own word-entry UI component if
         it's already a separable piece; otherwise a minimal new input,
         your call, state which) PLUS two unmissable, always-rendered (not
         collapsible) warning lines: "This creates a new account that must
         be activated on-chain before use" and "This account starts
         completely empty — no funds, no history." Default-recommended
         only when #2 has zero candidates.
      Selecting any option stores the resolved choice in wizard state
      (which existing seed+account pair, OR the newly-typed words) for
      T5/later tasks to read — do not yet perform any account activation
      or any other side effect; this task is selection UI only. Done
      when: with zero `stoic`-seeded accounts in the fixture data, option
      2 does not render at all and option 1 is the one marked
      recommended; with at least one `stoic`-seeded account present,
      option 2 renders listing it and IS marked recommended instead;
      choosing option 3 always shows both warning lines, unconditionally,
      before any text can be entered; selecting any of the three options
      updates the wizard's own internal state to reflect the choice
      (verified by asserting on which option shows as selected/active
      after a click, e.g. via `aria-selected` or an active-state class/
      testid).
  - files: `packages/codex-ouronet/src/ui/internal/
    LegacyPrimeMigrationWizard.tsx`, `packages/codex-ouronet/tests/
    ui-legacy-prime-migration-wizard.test.tsx`

## Wave 3 (depends on Wave 2 T4)

- [x] T5: Page 3 — the payment key + guard key choice, with full
      transparency, and the sweep-trigger determination. Extends the same
      wizard with `step: "keys"`, reached via Page 2's continue action
      once an account choice is made. Two choices:
      - "Accept the existing keys" — ONLY offered when Page 2's choice
        was option 1 or 2 from T4 (an existing, already-activated
        account) — never offered after "type new words" (there are no
        existing keys to accept for an account that doesn't exist yet).
      - "Define new keys via Stoic Dalos Derivation" — always available;
        the only option at all when Page 2 chose "type new words" (no
        existing keys exist to accept) or "keep current" (re-deriving via
        Dalos from the SAME current words necessarily produces different
        keys than whatever that account originally used — this is not
        optional for that path, mark it as such in the UI, e.g. the
        "accept existing" option simply isn't rendered for the
        keep-current path either, consistent with the bullet above).
      Whichever is chosen, render a clearly-labeled block showing the
      ACTUAL words (or a reference to "your current account's words" when
      keeping/accepting, without re-displaying sensitive plaintext
      unnecessarily — your call on exact display vs. reference wording,
      state it and justify) and "Stoic Dalos Derivation" as the
      derivation path whenever new keys are chosen. Set wizard state:
      `sweepNeeded: boolean` — `false` only when "accept the existing
      keys" was chosen, `true` in every other reachable case (new-words
      path, keep-current path, or explicit "define new keys" on an
      existing account). This flag is what the NEXT plan's Page 4 will
      read to decide whether to show the sweep plan at all — this task
      only needs to set it correctly, not consume it. Done when: for an
      account chosen via Page 2 option 1 or 2, BOTH key choices render,
      and choosing "accept existing" sets `sweepNeeded` to `false`
      (verified by reading the wizard's exposed state after the choice —
      e.g. an `onStateChange` callback prop or similar inspection seam,
      your call on the exact mechanism, state it); for "type new words"
      or "keep current" (Page 2 option 1), "accept existing keys" is not
      rendered at all, and the only reachable path sets `sweepNeeded` to
      `true`; whenever new keys are the active choice, the derivation
      path "Stoic Dalos Derivation" is visible in the rendered output
      (`getByText`-findable).
  - files: `packages/codex-ouronet/src/ui/internal/
    LegacyPrimeMigrationWizard.tsx`, `packages/codex-ouronet/tests/
    ui-legacy-prime-migration-wizard.test.tsx`

## Wave 4

- [x] T6: Fix Step 2 (account-based, tiered candidates) and Step 3
      (derivation-method choice, never new words) in
      `packages/codex-ouronet/src/ui/internal/LegacyPrimeMigrationWizard.tsx`
      per the corrected `docs/work/legacy-prime-migration-wizard/design.md`
      (read it in full — the "Page 2"/"Page 3" sections were rewritten this
      session). Read the CURRENT file in full first (it's ~1133 lines);
      this task replaces `computeStoicCandidates` and both `AccountStep`'s
      option-2 rendering and `KeysStep`'s two-option rendering, and changes
      `LegacyPrimeMigrationAccountChoice`'s `"existing"` variant shape.

      **Step 2 (`AccountStep`) changes:**
      - Replace `computeStoicCandidates(allSeeds, allAccounts)` with a new
        `computeExistingAccountCandidates(allAccounts, currentAccountId)`
        that returns every `IOuroAccount` in `allAccounts` EXCEPT the one
        matching `currentAccountId`, where `account.originSeedTab !==
        undefined` (i.e. `"12-words"`, `"24-words"`, or `"write-seed"` —
        a real, known word origin). Accounts with `originSeedTab ===
        undefined` (bitmap/bitstring/int10/int49 origin, or a legacy
        account predating this field) are EXCLUDED entirely — never shown,
        not even sub-optimally. Each returned candidate carries
        `recommended: boolean` (`true` iff `originSeedTab === "write-seed"`).
      - `LegacyPrimeMigrationAccountChoice`'s `"existing"` variant changes
        from `{ kind: "existing"; seedId: string; accountId: string }` to
        `{ kind: "existing"; accountId: string }` — there is no seed
        concept at this step anymore (Step 3 is what establishes the seed
        pairing, at Finalize time, per T7/T8 below). Update every call
        site in this file that constructs or reads `.seedId` on an
        `"existing"` choice.
      - Option 2's block is hidden only when `computeExistingAccountCandidates`
        returns zero entries (not when zero are "recommended" — a
        sub-optimal-but-real candidate still renders the block). Each
        listed candidate shows its own RECOMMENDED badge when
        `recommended === true`, or no badge (plain) when `false` — never
        hidden based on tier.
      - Option 1 ("keep current")'s `RecommendedBadge` shows iff the
        CURRENT account (`currentPrimeAccount`, already a prop) has
        `originSeedTab === "write-seed"`. When the current account has
        `originSeedTab === undefined` (no known words at all), render an
        additional, visible warning directly under option 1's description
        (reuse the SAME warning-box style `NEW_ACCOUNT_ACTIVATION_WARNING_TEXT`/
        `NEW_ACCOUNT_EMPTY_WARNING_TEXT` already use, a new constant, your
        own wording — e.g. "Keeping this account will not make seed-words-
        only restore possible — it has no known recovery words on record.")
        — option 1 stays selectable, just honestly labeled.
      - Option 3 ("type new words")'s `RecommendedBadge` shows iff NEITHER
        the current account NOR any candidate from
        `computeExistingAccountCandidates` has `recommended === true` (i.e.
        no existing `"write-seed"` account exists anywhere). Currently
        Option 3 renders NO badge at all in the shipped code (confirmed by
        reading it) — this is a real gap relative to the original plan
        text, fix it here.

      **Step 3 (`KeysStep`) changes:**
      - Remove the "Accept the existing keys" / "Define new keys" framing
        entirely. Replace with a derivation-METHOD choice, always applied
        to the SAME words as the Step-2-chosen account (never re-prompted):
        1. **Stoic Dalos Derivation** (default/recommended, always
           available) — position 0 = payment key, position 1 = guard key,
           `keys-all` predicate. Reuse `STOIC_DALOS_DERIVATION_LABEL`
           (already defined in this file) for the label.
        2. **Advanced (native format) derivation** — offered ONLY when the
           Step-2-chosen account's `originSeedTab` is `"12-words"` or
           `"24-words"` (read via a new prop or by looking up the chosen
           account from `allAccounts` using `accountChoice.accountId` —
           your call on exact plumbing, state it). Label it visibly
           "Advanced" and "Not recommended". Derives via that word
           format's own native mnemonic pipeline — mirror
           `SeedWordsTab.tsx`'s `revealPrivateKey`'s own
           `StoaChainWalletBuilder.createWalletPairFromMnemonic` call
           for the equivalent seedType (chainweaver for "12-words",
           koala for "24-words") rather than inventing new derivation
           code.
      - Store the chosen derivation method in a new field on
        `LegacyPrimeMigrationKeysChoice` (replacing `"accept-existing"` /
        `"new-keys"` with e.g. `{ kind: "stoic-dalos" } | { kind:
        "advanced-native" }` — your call on exact naming, state it and
        keep it consistent with the rest of the file's naming style).
      - `KeysWordsBlock` (the transparency block showing words + derivation
        path) must still render correctly for both new choice kinds —
        update its branching accordingly.
      - This task does NOT compute `sweepNeeded` or perform any derivation
        side effect — selection UI only, same discipline the existing file
        already follows (confirmed in its own doc comments: "choosing an
        option only calls `onChoose`, never performs any key derivation or
        other side effect").

      done when:
      - A test with zero existing-account candidates (every other account
        has `originSeedTab === undefined`) shows option 2 absent, option 1
        recommended ONLY if the current account is `"write-seed"`-origin,
        option 3 recommended whenever the current account is NOT
        `"write-seed"`-origin.
      - A test with one candidate account whose `originSeedTab ===
        "write-seed"` shows option 2 present, that candidate tagged
        RECOMMENDED, option 1/3 NOT tagged recommended (assuming current
        account isn't also write-seed-origin).
      - A test with one candidate account whose `originSeedTab ===
        "12-words"` shows option 2 present, that candidate shown WITHOUT
        the recommended tag (still selectable — clicking it updates
        `accountChoice` to `{ kind: "existing", accountId: <that account's
        id> }`, verified).
      - A test with the current account's own `originSeedTab === undefined`
        shows option 1's new warning text; a test with the current
        account's own `originSeedTab === "write-seed"` does NOT show that
        warning.
      - A test selecting an account whose `originSeedTab === "12-words"`
        via option 2, then viewing Step 3, shows BOTH derivation options
        (Stoic Dalos AND Advanced); a test with an account whose
        `originSeedTab === "write-seed"` (or option-3 freshly-typed words)
        shows ONLY Stoic Dalos — the Advanced option is entirely absent
        from the DOM, not just disabled.
      - `npx vitest run tests/ui-legacy-prime-migration-wizard.test.tsx`
        passes, `npx tsc --noEmit` in `packages/codex-ouronet` is clean.
      - files: `packages/codex-ouronet/src/ui/internal/LegacyPrimeMigrationWizard.tsx`,
        `packages/codex-ouronet/tests/ui-legacy-prime-migration-wizard.test.tsx`

- [x] T7: New store action in `packages/codex-ouronet/src/state/store.ts`
      that ensures the Step-2-chosen account has a paired Chainweb seed
      (creating one if needed) and determines whether a sweep is needed —
      WITHOUT performing any fund-moving sweep and WITHOUT promoting to
      Prime when a sweep would be needed. Read `promoteSeedAndAccountToPrime`
      (~line 2091) and `addStoaChainSeed`/`updateOuroAccount`
      (~lines 1503/2052) in full first — this task composes them, it does
      not reimplement their logic.

      Add to the action interface (near `promoteSeedAndAccountToPrime`'s
      own declaration, ~line 534):
      ```ts
      ensurePrimeSeedAccountPairingAndPromote(
        accountId: string,
        derivation: { bitString: string; words?: readonly string[]; method: "stoic-dalos" | "advanced-native" },
      ): Promise<{ sweepNeeded: boolean; seedId: string }>;
      ```
      (adjust the `derivation` shape to match whatever T6 actually settled
      on for `LegacyPrimeMigrationKeysChoice` — read T6's final file state
      before implementing this, these two tasks are in the same wave and
      may land in either order; if T6 hasn't landed yet when you start,
      use the shape documented in this task and flag the mismatch in your
      report rather than guessing silently).

      Algorithm:
      1. Validate `get().primeAlignment !== "aligned"` (mirror
         `promoteSeedAndAccountToPrime`'s own first check; throw the SAME
         `CodexError` pattern if already aligned).
      2. Find `targetAccount = get().ouroAccounts.find(a => a.id ===
         accountId)`; throw `CodexError` if missing (mirror
         `promoteSeedAndAccountToPrime`'s own not-found message style).
      3. If `targetAccount.parentSeedId` already points at a real seed in
         `get().kadenaSeeds`, reuse it as `seedId`. Otherwise: create a new
         `IStoaChainSeed` via `addStoaChainSeed` — `seedType: "stoic"` for
         the `"stoic-dalos"` derivation method, or the native
         `seedType` (`"chainweaver"`/`"koala"`) for `"advanced-native"` —
         encrypt `derivation.bitString` into `secret` via `encryptStringV2`
         with the live codex password (same `getPassword()` seam
         `changeCodexPassword`/other actions already use), and
         `wordsSecret` from `derivation.words` when present (mirrors
         `CreateStoaChainSeedModal.tsx`'s `finalizeStoicSeed` convention —
         read it for the exact field-population pattern, don't reimplement
         derivation, just the persistence shape). Then call
         `updateOuroAccount({ ...targetAccount, parentSeedId: <new seed's
         id> })` to link them.
      4. Derive the payment/guard public keys from `derivation.bitString`
         via the chosen method (Stoic Dalos: `deriveStoaDalosKeypairAtIndex`
         at positions 0 and 1, from `packages/codex-ouronet/src/wallet/stoaDalosKeygen.ts`;
         advanced-native: the equivalent mnemonic-based derivation — mirror
         whatever T6's UI already computed for its own preview, don't
         re-derive differently).
      5. Compute `sweepNeeded`: `true` unless `targetAccount.guard` is
         non-null, `targetAccount.guard.pred === "keys-all"`, and
         `targetAccount.guard.keys` (as a set) exactly equals the two
         newly-derived public keys (as a set).
      6. If `sweepNeeded` is `false`: call the EXISTING
         `promoteSeedAndAccountToPrime(seedId, accountId)` (reuse it
         verbatim, don't duplicate its validation/mutation). If `true`:
         do NOT call it, do NOT mutate `kadenaSeeds`/`ouroAccounts`'s
         `isPrime` flags at all beyond whatever step 3 already persisted
         (the seed-pairing creation from step 3 is fine to keep — only
         the PROMOTION is gated on `sweepNeeded`).
      7. Return `{ sweepNeeded, seedId }`.

      done when:
      - A test on an account with NO paired seed and `guard: null`:
        the action creates a new `IStoaChainSeed` (findable in
        `store.getState().kadenaSeeds` afterward), links it via
        `parentSeedId`, returns `sweepNeeded: true`, and
        `store.getState().ouroAccounts.find(...).isPrime` is still
        `false`/unset (promotion was skipped).
      - A test on an account whose `guard` ALREADY exactly matches what
        the Stoic Dalos derivation at positions 0/1 would produce (set up
        the fixture's `guard.keys` to the real derived pubkeys for a known
        bitstring): returns `sweepNeeded: false`, and
        `store.getState().ouroAccounts.find(...).isPrime === true` (real
        promotion happened) alongside the corresponding seed's
        `isPrime === true`.
      - A test on an ALREADY-aligned codex (`primeAlignment: "aligned"`)
        rejects with the same error pattern `promoteSeedAndAccountToPrime`
        already uses, no state change.
      - A test on an account that already HAS a valid `parentSeedId`
        (pointing at a real existing seed) does NOT create a second seed —
        confirmed by `store.getState().kadenaSeeds.length` unchanged.
      - `npx vitest run tests/state-store.test.ts tests/state-legacy-prime-migration-finalize.test.ts`
        (the second file is new) passes, `npx tsc --noEmit` in
        `packages/codex-ouronet` is clean.
      - files: `packages/codex-ouronet/src/state/store.ts`,
        `packages/codex-ouronet/tests/state-legacy-prime-migration-finalize.test.ts` (new)

## Wave 5 (depends on Wave 4)

- [x] T8: Wire Page 7 (Finalize) into the wizard. Extends
      `LegacyPrimeMigrationWizard.tsx`'s step union with a new step (e.g.
      `"finalize"`), reached via Step 3's "Continue" (currently a stub
      logging to console — read the EXACT current stub location before
      editing, it may have shifted after T6's changes). Add a new prop:
      ```ts
      ensurePrimeArweaveSeed?: (words: { bitString: string; words?: readonly string[] }) => Promise<void>;
      ```
      (optional, defaulted/handled gracefully when absent — e.g. treat as
      "not wired yet" and show the same honest not-available messaging
      T9 will eventually make real; state your exact fallback behavior).

      On reaching "finalize": call the store's
      `ensurePrimeSeedAccountPairingAndPromote` (T7) with the Step-2
      account id and Step-3 derivation. If the result's `sweepNeeded` is
      `true`: show a clear, honest message — sweep execution is not built
      yet, name what WOULD need to move (reuse whatever data is available
      — at minimum state plainly "fund-moving sweep isn't available yet;
      nothing has changed, it's safe to close this wizard"), a "Close"
      button, NO further action taken (no Arweave seed step, no alignment
      stamp — this path is explicitly a dead end until the sweep engine
      exists, not a silent failure). If `sweepNeeded` is `false`: call
      `ensurePrimeArweaveSeed` (if provided) with the same
      bitString/words, then call the store's existing
      `stampPrimeAlignmentAligned()`, then show a success screen with an
      explicit "the Prime trio is now permanently locked" reminder and a
      "Close" button. If `ensurePrimeArweaveSeed` throws, or is absent,
      show an honest error/not-available state instead of silently
      stamping alignment anyway — alignment must never be stamped if the
      Arweave-seed step didn't genuinely complete.

      done when:
      - A test with a fixture that resolves `sweepNeeded: true` (mock/stub
        the store action, or use a real fixture that produces it per T7's
        own test conventions) reaches the finalize step and shows the
        "sweep isn't available yet, nothing has changed" message, with NO
        call to `stampPrimeAlignmentAligned` (verified via spy or by
        checking `store.getState().primeAlignment` is still `"legacy"`
        afterward).
      - A test with a fixture that resolves `sweepNeeded: false`, and an
        `ensurePrimeArweaveSeed` prop that resolves successfully, reaches
        a success screen, and `store.getState().primeAlignment ===
        "aligned"` afterward.
      - A test with `sweepNeeded: false` but `ensurePrimeArweaveSeed`
        rejecting (or omitted entirely) shows an honest error/not-available
        state, and `store.getState().primeAlignment` is STILL `"legacy"`
        (never stamped).
      - `npx vitest run tests/ui-legacy-prime-migration-wizard.test.tsx`
        passes, `npx tsc --noEmit` in `packages/codex-ouronet` is clean.
      - files: `packages/codex-ouronet/src/ui/internal/LegacyPrimeMigrationWizard.tsx`,
        `packages/codex-ouronet/tests/ui-legacy-prime-migration-wizard.test.tsx`

## Wave 6 (depends on Wave 5 T8)

- [x] T9: Wire the REAL `ensurePrimeArweaveSeed` capability into
      `packages/codex-arweave/src/panel/CodexIdPage.tsx`'s mount of
      `<LegacyPrimeMigrationWizard>`. Mirror
      `apps/codex-playground/src/kickstartPrimeArweaveSeed.ts` — read it in
      full first, it is the EXACT precedent for this exact job (deriving
      and installing a Prime Arweave Seed from known words/bitstring,
      including the injected `workerFactory` seam and the
      `secret`/`wordsSecret` persistence shape via `encryptStringV2`) —
      this task adapts that pattern to run from INSIDE the wizard's
      finalize flow instead of at kickstart time, and must additionally
      implement the "doesn't fit, add a new one instead of overwriting"
      reconciliation T8's design.md section describes: check whether an
      existing Prime Arweave Seed (if any) decrypts to the SAME words/
      bitstring being finalized (same password, same seam `SeedWordsTab.tsx`
      already uses to decrypt); if it matches, do nothing; if it exists but
      differs, add a NEW seed from the finalize words (do not overwrite/
      delete the mismatched one); if none exists at all, create+install one
      as Prime (reusing `deriveArweaveSeedAtPositionZero` from
      `@ancientpantheon/codex-arweave/seeds`, same as
      `kickstartPrimeArweaveSeed.ts`).

      done when:
      - A test (real browser-level or component-level, your call on
        depth — check how `e4-panel-codex-id.test.tsx` already tests
        wizard-opening to match this file's established convention)
        confirms that completing the wizard's finalize step on a codex
        with ZERO Arweave seeds results in exactly one new Prime Arweave
        Seed whose decrypted bitstring matches the finalize words.
      - The same, on a codex whose EXISTING Prime Arweave Seed already
        matches the finalize words: no new seed is added (seed count
        unchanged).
      - The same, on a codex whose existing Prime Arweave Seed does NOT
        match: a new seed is added (seed count increases by one), the
        original mismatched seed is NOT deleted/overwritten (still present,
        still decrypts to its own original words).
      - `npx vitest run` on the relevant `e4-panel-codex-id*.test.tsx`
        file(s) passes, `npx tsc --noEmit` in `packages/codex-arweave` is
        clean.
      - files: `packages/codex-arweave/src/panel/CodexIdPage.tsx`, and
        whichever `packages/codex-arweave/tests/e4-panel-codex-id*.test.tsx`
        file(s) best fit the new scenarios (extend in place; add a new
        file only if none fit naturally)
