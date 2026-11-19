# Stage 3A — Apply the chosen key changes — Plan

Owner: *"Part A is something we can easily wire in, it's rotate payment key
and rotate guard."* And: stage 3 is OPTIONAL — *"migration is basically a
tool for those that want to give up old accounts and use new ones."*

## Placement — decided, and reversible

**On the Codex ID page, not inside the wizard.** The owner wants stage 1+2
shippable without stage 3; a separate surface can be added or pulled without
touching the wizard, and an optional act that can be done days later does not
belong in a flow the user is trying to finish. The recorded run already
survives stage 2, which is what makes this possible at all.

## Measured constraint

`RotatePaymentKeyModal` and `RotateGuardModal` take
`{open, onClose, account, accounts, kadenaSeeds, stoaChainAccounts}` — no
prefill. They are verified, signing, Papyrus Page transaction modals, so this
topic REUSES them rather than building transactions, and does not modify
their signing path.

## Wave 1
- [x] T1: Record the derived PUBLIC keys in `committed` during stage 2
      (`paymentPublicKey`, `guardPublicKeys`). They are public, so nothing
      secret is added; recording them means stage 3A can show what should be
      in force without re-decrypting the seed just to display it.
      — done when: the commit-order suite asserts both are recorded, and the
      no-secrets scan still passes over the row.
  - files: `packages/codex-core/src/codex/migrationProgress.ts`,
    `packages/codex-ouronet/src/ui/internal/LegacyPrimeMigrationWizard.tsx`,
    `packages/codex-core/tests/migration-progress.test.ts`
- [x] T2: `computeOutstandingKeyChanges(recorded, account)` — pure. Compares
      what was CHOSEN against what the account currently carries, and reports
      per-change `{ from, to }`. Reports nothing outstanding when the user
      chose "keep" for both, which is the common case and must not show a
      call to action that does nothing.
      — done when: `tests/stage3a-outstanding-changes.test.ts` covers both
      "keep" choices (nothing outstanding), a guard that already matches
      (nothing), a guard that differs (outstanding), and a missing record.
  - files: `packages/codex-ouronet/src/ui/internal/outstandingKeyChanges.ts`,
    `packages/codex-ouronet/tests/stage3a-outstanding-changes.test.ts`

## Wave 2 (depends on Wave 1)
- [x] T3: A Codex ID card — shown ONLY when something is outstanding —
      naming each pending change as FROM -> TO, stating plainly that it is
      optional and that the old keys keep working, and launching the existing
      rotate modal for each.
      — done when: `tests/e4-panel-stage3a-card.test.tsx` proves the card is
      absent when nothing is outstanding, names each pending change when
      something is, and says the change is optional.
  - files: `packages/codex-ouronet/src/ui/settings/PendingKeyChangesCard.tsx`
    (or the arweave panel, wherever the Codex ID page composes),
    `packages/codex-arweave/src/panel/CodexIdPage.tsx`, plus its test

## NOT in this topic
- Part B, asset migration. Parked on the owner's own thinking.
- Prefilling the rotate modals with the recorded choice. Worth doing, but it
  means adding props to verified signing modals; raised separately rather
  than slipped in here.
