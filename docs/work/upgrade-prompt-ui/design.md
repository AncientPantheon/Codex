# Upgrade Prompt UI — Design

(Topic 3 of `docs/work/codex-versioning/design.md`. Wires the already-built
Structural Migration Engine — `docs/work/structural-migration-engine/`,
`runStructuralMigration` in `packages/codex-ouronet/src/structural-migration/index.ts`
— into real, clickable UI so the owner can actually run it against real
broken codices. The auto-offer-at-unlock banner is explicitly DEFERRED
(owner's own call: "we defer, we first make sure it works before we auto
offer it") — this topic builds the manual trigger path only: a persistent
red-flashing nav indicator + a real "Codex Upgrade" page/wizard, reachable
and testable without any new banner.)

## Problem

The engine built in `structural-migration-engine` is real, tested, and
proven against both real Foreign codex files — but nothing in the app
calls it. There is no button, no page, no progress display, and no way for
the owner to supply missing seed words when the engine can't resolve a seed
automatically. The owner's real client codices are sitting there unfixable
through the UI even though the fix itself works.

## Approach

Every piece this topic needs already has a direct, proven precedent in this
codebase — this is wiring, not new architecture:

- **Store action** (`packages/codex-ouronet/src/state/store.ts`): a new
  `runStructuralUpgrade(options?)` action, mirroring the existing
  `changeCodexPassword` action's exact shape (the direct precedent, read in
  full this session): assemble the live snapshot via the already-existing
  `buildForeignKeySnapshot(get(), get().foreignKeys)`, get the current
  password via the existing `getPassword()` action (throws
  `CodexLockedError` if actually locked — never a new password prompt,
  this only ever runs already-unlocked), call `runStructuralMigration`,
  persist the result via the existing `persistAndTouch((a) => a.saveAll(...))`
  helper, then `set()` the changed slices
  (`kadenaSeeds`, `arweaveSeeds`, `Codex_Shape_Version`) into live state —
  exactly `changeCodexPassword`'s own persist-then-mirror-into-state
  sequence, nothing invented.
- **Progress reporting**: `StructuralMigrationOptions` (Topic 2's type)
  gets one small ADDITIVE extension — `onProgress?: (step: string) => void`
  — called once per checked seed with a human-readable step string
  (`"Checking seed 2/5: My Second Seed…"` / `"Fixed seed 2/5…"` / `"Seed 2/5
  needs your input…"`). Mirrors `ChangePasswordCard`'s own already-shipped
  `onProgress` pattern (`packages/codex-ui/src/ui/settings/ChangePasswordCard.tsx`)
  exactly — optional, backward-compatible, same "call it as many times as
  you like" contract. This is the SAME counted-progress idea the owner
  asked to get back for Change Password, reused here for its other natural
  home.
- **"Needs upgrade" derived state**: a new `useNeedsStructuralUpgrade()`
  hook in `packages/codex-ouronet/src/hooks/` (NOT `codex-ui` — codex-ui is
  a lower layer than codex-ouronet in this codebase's established
  `core ← ui ← ouronet` dependency direction, and the comparison needs
  `STRUCTURAL_SHAPE_TARGET_VERSION`, which lives in codex-ouronet's own
  `structural-migration` module; codex-ouronet already owns the store, so
  this has no layering problem living there). Returns
  `Codex_Shape_Version !== STRUCTURAL_SHAPE_TARGET_VERSION` (true for both
  `undefined`/"Unversioned" and any older stamped value) — single source
  of truth, used by both the nav indicator and the Codex ID page's own
  gating, so they can never disagree.
- **Red-flashing nav indicator**: both real nav locations found this
  session — `apps/codex-playground/src/App.tsx`'s desktop `.cxpg-viewtab`
  "Codex ID" button (~line 660) and `OuronetShellMock.tsx`'s mobile
  `.cxpg-osm-codex-menu-item` "Codex ID" entry (~line 214) — get a small
  conditionally-rendered badge + CSS flash animation, each independently
  calling `useNeedsStructuralUpgrade()`. Two call sites, same hook, same
  boolean — never duplicated comparison logic.
- **"Codex Upgrade" action card in `CodexIdPage.tsx`**: a new sibling to
  the existing "Make This Codex Eligible" card (same file, same page,
  copied pattern exactly — eligibility-style gating, `ENABLED_PRIMARY_BUTTON_STYLE`/
  `CODEX_ID_ALREADY_ELIGIBLE_STYLE` reused verbatim, not reinvented). Shows
  the current `Codex_Shape_Version` (via `formatCodexShapeVersionLabel`,
  already built in Topic 1), an enabled "Upgrade Codex Now" button when
  `useNeedsStructuralUpgrade()` is true opening the new wizard in a
  `CodexModalShell` (same modal chrome every other write-action already
  uses), or the existing green "already eligible"-style note, relabeled,
  when false. This is the postpone mechanism by construction: the button
  sits here, inert, until clicked — nothing forces it.
- **`StructuralUpgradeWizard` component** (new,
  `packages/codex-ouronet/src/ui/internal/StructuralUpgradeWizard.tsx`,
  exported via `@ancientpantheon/codex-ouronet/components` — mirrors
  `LegacyPrimeMigrationWizard`'s own export path exactly): a confirm step,
  a running step showing live `onProgress` text, a per-seed "needs your
  input" step (rendered when the engine's `requestMissingData` callback
  fires — a text input for the seed's words plus Submit/Skip, resolving a
  pending promise held in a ref, mirroring the store's own existing
  `PendingPasswordRequest`-style "resolve held in state until the UI
  settles it" pattern), and a final result step listing fixed vs. skipped
  seeds with their reasons.

### Alternatives considered

- **Call `runStructuralMigration` directly from the wizard component,
  skipping a store action.** Rejected: every other write-action that
  mutates+persists the whole snapshot (`changeCodexPassword`, kickstart,
  migrateToCurrent) goes through a store action that owns the
  assemble→migrate→persist→mirror-into-state sequence; a component calling
  the pure engine directly would have to reimplement that sequence itself,
  and would bypass `persistAndTouch`'s existing adapter-guard/touch
  discipline.
- **A brand-new progress-reporting mechanism instead of extending
  `StructuralMigrationOptions` with `onProgress`.** Rejected: would create
  a THIRD progress-callback shape in this codebase (after
  `ChangePasswordCard`'s and `SeedWordsTab.tsx`'s own staged-progress
  pattern for key derivation) for the exact same concept — "call this with
  a human-readable string as work proceeds." Reusing the shape costs
  nothing and keeps one convention.

## Acceptance criteria

- [ ] On a live codex whose `Codex_Shape_Version` is not the current
      target, both the desktop `.cxpg-viewtab` "Codex ID" tab and the
      mobile `OuronetShellMock` "Codex ID" menu item show a visibly
      flashing indicator; neither shows it once the codex is current.
- [ ] `CodexIdPage.tsx` shows a "Codex Upgrade" card: the current shape
      label, an enabled "Upgrade Codex Now" button when upgrade is needed,
      or a green "already current" note when it isn't — never both.
- [ ] Clicking "Upgrade Codex Now" opens a real modal wizard that, when
      confirmed, actually calls the Structural Migration Engine against
      the live, already-unlocked codex (no new password prompt) and
      persists the result.
- [ ] While running, the wizard shows live, human-readable progress text
      that changes at least once per checked seed (not a single static
      "please wait").
- [ ] When the engine reports a seed it can't resolve automatically, the
      wizard pauses on a real input step naming that seed and the reason,
      lets the owner type the seed's words and submit (the engine retries
      and, if valid, fixes it in the same run) or explicitly skip it (the
      run continues, that seed stays as-is).
- [ ] After a run, the wizard shows a final summary distinguishing fixed
      seeds from skipped ones (with each skip's reason), and the nav
      indicator from criterion 1 stops flashing once every entry is
      resolved (fixed or deliberately skipped) and `Codex_Shape_Version`
      is stamped current.
- [ ] Running the full flow against the owner's real client codices (read
      directly, never committed into the repo) actually produces a codex
      whose previously-unreadable stoic seed now reveals its private
      key/words correctly through the existing `SeedWordsTab`/
      `KeyFieldsHalves` UI — the end-to-end proof this topic exists for.

## Out of scope

- The auto-offer-at-unlock banner — explicitly deferred by the owner this
  session; a separate, later addition once the manual path here is proven
  working.
- The Permaweb Eligibility Migration Engine / `LegacyPrimeMigrationWizard`
  — a completely separate migration, already its own card on the same
  page; untouched by this topic beyond sitting beside it.
- Wiring any of this into OuronetUI (a separate repo consuming the
  published `@ancientpantheon/codex` package) — this topic builds and
  proves the flow in `apps/codex-playground` only, same pattern Topic 1
  used; OuronetUI wiring is a follow-up handoff once this ships.
