# Codex ID — Step Flow Redesign

## Problem

`CodexIdPage.tsx`'s action area is currently 3 unordered, vertically-stacked
cards ("Make This Codex Eligible" / "Codex Upgrade" / "Back up codex to
Arweave") with no visual indication that they form a sequence, or that two
of them are *gated* by the others. The result (owner's own words, this
session, looking at a real screenshot): confusing — "no one understands
anything... what the hell he has to do." All three underlying actions
(`StructuralUpgradeWizard`, `LegacyPrimeMigrationWizard`,
`CodexBackupArea`'s modal) are already fully built and working — this is
purely a layout/sequencing redesign of how they're presented, not new
business logic.

## Approach

Replace the vertical card stack with a horizontal 3-step flow, numbered and
connected by arrows, directly expressing the real dependency chain:

```
[1. Version your codex] → [2. Make codex eligible] → [3. Upload to Arweave]
```

- **Step 1 — Version.** Checked (✓) when `!useNeedsStructuralUpgrade()`.
  Always clickable (nothing gates it) — opens `StructuralUpgradeWizard`,
  same as today's "Upgrade Codex Now" button.
- **Step 2 — Make eligible.** Checked (✓) when `isEligible` (the existing
  `codexIdEligibility === "eligible"` check). Disabled until Step 1 is
  checked — reuses the gate we already built this session
  (`useNeedsStructuralUpgrade()`), just re-presented as a step rather than
  a standalone disabled button with a tooltip. Opens
  `LegacyPrimeMigrationWizard`.
- **Step 3 — Upload to Arweave.** Disabled until BOTH Step 1 and Step 2 are
  checked. Unlike the first two, backing up is a repeatable action (you can
  back up more than once) — its own "done" indicator is "last backup
  succeeded" (shown as a timestamp/status under the step, not a permanent
  lock-in checkmark), not a one-time completion state. Opens the existing
  `CodexBackupArea` modal, unchanged.

Each step is a self-contained card: step number badge, check/empty circle,
short label, one-line status text, and (when enabled) a real button that
opens its existing wizard/modal — no new wizard logic anywhere, this task
only touches how they're triggered and displayed. An arrow (→ or a chevron
icon) sits between each pair of cards, reinforcing the sequence visually.
On narrow/mobile widths, the row wraps to a vertical stack with the arrows
rotated 90° (down-arrows) rather than disappearing — the sequencing cue
should survive responsive layout, not just exist on desktop.

A disabled step still shows ITS OWN short reason inline (mirroring the
existing "Your codex is not versioned yet..." pattern we already built) —
never a bare greyed-out control with no explanation.

### Alternatives considered

- **Keep the vertical stack, just add numbering/checkmarks without
  reflowing to horizontal.** Rejected: doesn't fix the core problem — a
  vertical stack of same-width cards still reads as "three independent
  options," not a required sequence, even with numbers slapped on.
- **A single combined wizard that walks all 3 steps internally (one modal,
  3 internal pages).** Rejected: these are three genuinely separate,
  already-independently-useful actions (you might version a codex today
  and make it eligible next week) — forcing them into one modal would
  regress that flexibility for no real gain, and would mean throwing away
  three already-working, already-tested wizard components to rebuild as
  one.

## Acceptance criteria

- [ ] The three actions render as a single horizontal row, left to right,
      in the order Version → Eligible → Upload, connected by a visible
      arrow/chevron between each pair.
- [ ] Step 1 is always enabled regardless of the other two steps' state.
- [ ] Step 2 is disabled whenever Step 1 is unchecked, with its own inline
      reason shown (not just greyed out).
- [ ] Step 3 is disabled whenever Step 1 OR Step 2 is unchecked, with its
      own inline reason shown.
- [ ] Step 1 shows a checkmark iff `!useNeedsStructuralUpgrade()`; Step 2
      shows a checkmark iff `isEligible`; both update live if the
      underlying state changes while the page is open (e.g. right after
      completing Step 1's wizard).
- [ ] Step 3 shows a distinct "last backup" status (not a permanent
      checkmark) reflecting whether a backup has been made this session,
      separate from the gating logic.
- [ ] On a narrow viewport, the row wraps to a vertical stack with the
      connecting arrows rotated to point downward — the sequence is still
      visually legible, not dropped.
- [ ] Clicking each step's own button opens the exact same
      wizard/modal already wired today (`StructuralUpgradeWizard`,
      `LegacyPrimeMigrationWizard`, the backup modal) — no new wizard
      behavior, only the trigger/presentation changes.

## Out of scope

- Any change to the three wizards'/modal's own internal behavior — this is
  purely how they're presented and gated from this one page.
- The informatics tabs ("How Backup Works" / "Encryption" / "Migration")
  below the action row — untouched, stay as-is.
- Mobile-specific navigation beyond the responsive wrap described above —
  no new mobile-only screen.
