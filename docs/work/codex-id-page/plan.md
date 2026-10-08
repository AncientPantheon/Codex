## Wave 1

- [x] T1: The tab + page shell + live eligibility status. Read
      `docs/work/codex-id-page/design.md` in full first. Read
      `packages/codex-arweave/src/panel/ArweavePanel.tsx` in FULL,
      specifically: the `CATEGORIES` tuple (`["seeds", "pure-keys",
      "accounts", "upload", "library"] as const`, line ~138) and whatever
      type `active` is derived from it, the tab-bar button rendering for
      the existing categories (mirror its exact style/structure for a new
      tab, don't invent a new tab-bar convention), and the
      `active === "..."` conditional body-rendering pattern used for
      every existing tab. Read `packages/codex-arweave/src/panel/
      ArweaveRestoreEligibilityStatus.tsx` in full — the existing,
      already-built eligibility display currently shown in the Library
      tab; this task reuses its underlying data (`checkArweaveRestoreEligibility`/
      `ArweavePanelDeps.checkArweaveRestoreEligibility`), either by
      reusing the component directly (if its styling/shape fits a
      standalone page) or building a new presentational wrapper around
      the SAME underlying call — ground which makes more sense once
      you've read it, don't duplicate the eligibility-checking logic
      itself either way.

      Add a new tab, e.g. `"codex-id"` (exact id/label your call — "Codex
      ID" is the user-facing label per the owner's own naming), to
      `CATEGORIES` and the tab bar. New body content for
      `active === "codex-id"`: a page shell showing the real, live
      eligibility status (eligible / not eligible + why, matching
      `ArweaveRestoreEligibilityStatus.tsx`'s own real current messaging)
      at the top. Leave clearly-marked composition points (e.g. named
      sections or a simple prop-driven layout) for T2's informatics
      content and T3's action buttons to slot into — don't hard-code
      placeholder text where real content is coming in Wave 2, but don't
      block this task on T2 either; a minimal, honest "informatics
      coming in this same page" stand-in is fine if you reach that point
      before T2 lands (you're running in parallel).

      Follow TDD: write failing tests first in `packages/codex-arweave/
      tests/e4-panel-codex-id.test.tsx` (new, mirror this package's real
      `e4-panel-*.test.tsx` conventions for panel-level component tests)
      covering: the new tab is present and selectable in the tab bar; an
      ELIGIBLE codex's status renders correctly (fake
      `checkArweaveRestoreEligibility` resolving eligible); a
      NOT-eligible codex's status renders correctly, with its reason;
      selecting the tab doesn't affect any other tab's state (regression
      guard, mirror how sibling tab tests already check this). Confirm
      red-for-the-right-reason first, then implement.

      Done when: the new tab is reachable, renders real (fake-injected,
      at test level) eligibility status correctly for both outcomes, and
      the full existing `e4-panel-*.test.tsx` suite still passes
      unmodified (no regression to existing tabs).
  - files: `packages/codex-arweave/src/panel/ArweavePanel.tsx`,
    `packages/codex-arweave/tests/e4-panel-codex-id.test.tsx` (new) —
    and, ONLY if `ArweaveRestoreEligibilityStatus.tsx` genuinely needs a
    small additive change to be reusable standalone (e.g. an optional
    layout prop) rather than only inside the Library tab, that file too
    — flag clearly if touched.

- [x] T2 (parallel with T1 — independent, purely presentational, no
      dependency on the tab/shell existing yet): The informatics content.
      Read `docs/work/codex-id-page/design.md`'s "The informatics
      section" and "Migration-process informatics" subsections in full,
      PLUS — for accuracy, this is explicitly graded on matching the real
      design, not freehand prose — `docs/work/
      codex-backup-envelope-encryption/design.md` (the WHOLE document,
      including the now-in-scope Arweave-PIN section) and `docs/work/
      legacy-prime-migration/design.md` (the whole document).

      Build two presentational components (exact file names/props your
      call, keep them composable into T1's/T3's shell):
      1. A "how codex backup on Arweave works" explainer covering, in
         plain language (no internal type/function names, written for a
         non-engineer end user): what gets backed up (the whole running
         codex, every keyring, vs. individual file uploads); the
         encryption in plain terms (fresh one-time key per backup, that
         key locked under your own real secrets, the whole thing sealed
         again so even the shape/structure is hidden); the two
         independent restore paths (Master Seed words; Codex Identity's
         Standard Apollo half) — explicitly stating either alone
         suffices; the optional Arweave-PIN extra lock, with the explicit,
         prominent "forgetting this PIN is exactly as unrecoverable as
         losing your seed words — there is no reset" warning, and that
         it's opt-in, never default-recommended.
      2. A "what migration does" explainer covering: why some codexes
         aren't eligible yet (Ouronet identity and Arweave recovery seed
         don't share origin words, often from a wallet-imported phrase);
         the three choices the migration wizard will offer (new words /
         promote an existing custom-worded account / keep current words
         re-derived properly), in the SAME recommended-default framing
         the design doc specifies (option 2 when available, else option
         1, option 3 always available but marked not-recommended); the
         plain statement that migration moves real on-chain balances
         (native STOA and urSTOA) as a necessary, explicit, multi-step
         part of the process, never instant, never a single click, always
         requiring confirmation at each step.

      Follow TDD: write tests in `packages/codex-arweave/tests/
      e4-panel-codex-id-informatics.test.tsx` (or fold into T1's test
      file's own natural home once merged — your call on filename, just
      keep it test-file-convention-consistent) asserting the REQUIRED
      factual content is present and correctly stated — e.g. assert the
      PIN-unrecoverable warning text is present verbatim-equivalent, both
      restore paths are named, the "not a single click"/multi-step
      migration language is present, option 2's conditional-default
      framing is present — not just "a div renders," but that the
      SPECIFIC required claims from the design docs are actually in the
      rendered output (a reviewer reading only the test file should be
      able to confirm content accuracy without re-reading the design docs
      themselves). Confirm red-for-missing-component first, then
      implement.

      Done when: both explainer components render the required content
      accurately (verified against the real design docs, not from
      memory), in plain, non-technical language, with the PIN warning and
      the multi-step-fund-movement statement both unmissable (not buried
      in fine print).
  - files: new component file(s) under `packages/codex-arweave/src/
    panel/` (exact names your call, e.g. `CodexBackupInformatics.tsx`,
    `CodexMigrationInformatics.tsx`), corresponding new test file(s)

## Wave 2 (depends on Wave 1: T1 + T2)

- [x] T3: Compose the full page, add the two honestly-disabled action
      buttons, real-browser verification. Read T1's and T2's actual
      final files fresh (re-read, don't rely on their own task
      descriptions above — both may have made real, reasonable
      implementation decisions during their own build) before writing
      any code. Read `packages/codex-arweave/src/panel/ArweavePanel.tsx`'s
      EXISTING disabled "(coming soon)" button for Codex backup
      (grep for it — it already exists, your two new buttons mirror its
      exact pattern: visible, clearly labeled, disabled, with a title/
      tooltip or adjacent text explaining what's coming and why it isn't
      live yet — never a silently-missing affordance, never a dead
      button with no explanation).

      Compose T1's shell + T2's two informatics components + two new
      action buttons into the finished `"codex-id"` tab body:
      - **"Make this codex eligible"** — when `checkArweaveRestoreEligibility`
        resolves not-eligible, a button that would open the
        `legacy-prime-migration` wizard. Since that wizard doesn't exist
        yet, render it disabled with honest "coming soon" messaging
        (mirror the existing convention exactly). When the codex IS
        already eligible, this button/section's presence — your call,
        ground it: likely hidden or replaced with a simple "already
        eligible" confirmation, not shown as a disabled no-op in that
        case.
      - **"Back up this codex to Arweave"** — same disabled "coming soon"
        treatment, pending `codex-backup-envelope-encryption`.

      Follow TDD: extend `e4-panel-codex-id.test.tsx` (T1's file) with
      tests confirming: both buttons are present and genuinely disabled
      (not just visually styled to look disabled while still clickable —
      assert the real disabled state/attribute); their "coming soon"
      messaging is present and honest (not vague); the eligible-codex
      case does NOT show a disabled "make eligible" button (per whichever
      choice you ground above); the informatics sections from T2 render
      within the composed page. Confirm red-for-the-right-reason first,
      then implement.

      Then run a real-browser check (reuse the established throwaway-CDP
      convention) driving the real `ArweavePanel`/host-adapter wiring,
      confirming the new tab is reachable and renders correctly for a
      real eligible AND a real not-eligible codex (create one of each if
      practical, or at minimum confirm one real case end-to-end and
      reason carefully about why the other case is adequately covered by
      the unit-level fake-injection tests above if driving both through a
      real codex is impractical in one verification pass — state your
      reasoning either way, don't silently skip it).

      Done when: the finished page composes correctly, both "coming
      soon" actions are honestly disabled (never silently missing, never
      fake-interactive), a real browser confirms it renders through the
      actual production wiring, and the full `codex-arweave` test suite
      passes (unscoped, the one known pre-existing `node:sqlite` failure
      allowed). Clean typecheck.
  - files: `packages/codex-arweave/src/panel/ArweavePanel.tsx`,
    `packages/codex-arweave/tests/e4-panel-codex-id.test.tsx`, throwaway
    real-browser verification script (deleted after use)
