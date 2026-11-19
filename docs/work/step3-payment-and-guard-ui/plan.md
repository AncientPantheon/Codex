# Step 3 — Payment Key & Guard UI — Plan

Topic 5 of `docs/work/codex-master-seed-model/design.md`; implements
`docs/work/prime-payment-and-guard-step/design.md`.

## What Page 3 can reach (verified, not assumed)

- The Page-2 probe keeps only booleans (`probedHasWords` / `probedUngated`),
  NOT words — so Page 3 decrypts the ONE chosen account itself to derive its
  position 0/1 keys. The codex is already unlocked by then (Make Eligible
  gates on it), and `deriveStoaDalosKeypairAtIndex` is pure + synchronous.
- The CURRENT payment key is `kadenaSeeds[0].accounts[0].publicKey` - the
  same value `ActivateStandardAccountModal.tsx:212` uses as `primeKey0`, and
  the exact key the owner quoted as their FROM ("Initial Seed" Key #0).
- The CURRENT guard is `currentPrimeAccount.guard`, unfolded through
  `resolveGuardKeys` (topic 4).

## Honest scoping call

"Keep as is" for the payment key is offered, per the owner's ask — but
keeping a payment key derived from DIFFERENT words is precisely what makes a
codex ineligible, so it is labelled as not achieving words-only restore
rather than presented as equivalent. This mirrors Page 2's existing treatment
of "keep your current account". It does NOT silently no-op.

## Wave 1
- [x] T1: Choice types + the derived-key preview. `LegacyPrimeMigrationPaymentChoice`
      (`keep` | `stoic-dalos-position-0`) and `LegacyPrimeMigrationGuardChoice`
      (`keep` | `recommended-single-key` | `custom`), plus a preview that
      decrypts the Page-2-chosen account once and derives position 0 + 1,
      with explicit loading / error states and no silent empty render.
      — done when: `tests/ui-step3-key-preview.test.tsx` proves the preview
      derives both positions for a chosen account, shows a loading state
      first, and surfaces a decrypt failure as a message rather than blanks.
  - files: `packages/codex-ouronet/src/ui/internal/LegacyPrimeMigrationWizard.tsx`,
    `packages/codex-ouronet/tests/ui-step3-key-preview.test.tsx`

## Wave 2 (depends on Wave 1)
- [x] T2: The payment-key section — current key with its ties (seed name +
      `Key #N`), the two options with RECOMMENDED on derivation, and the
      `FROM <old> -> TO <new>` pair rendered through `MeasuredHexHighlight`
      so neither value overflows.
      — done when: `tests/ui-step3-payment-section.test.tsx` proves the ties
      line names the seed and position, FROM/TO both render, and choosing
      "keep" shows the not-eligible explanation.
  - files: same wizard file,
    `packages/codex-ouronet/tests/ui-step3-payment-section.test.tsx`
- [x] T3: The guard section — current guard rendered by shape (direct keyset,
      unfolded reference, capability/user, or none), the recommended
      `keys-all` over the single position-1 key in its two wordings (upgrade
      a keyset / upgrade a reference), keep-as-is, and a custom keyset built
      from keys the codex already holds with a predicate picker.
      — done when: `tests/ui-step3-guard-section.test.tsx` covers all four
      current-guard shapes including an unresolvable reference, and proves
      keep-as-is on a reference states that it will lock the keys it names.
  - files: same wizard file,
    `packages/codex-ouronet/tests/ui-step3-guard-section.test.tsx`

## Wave 3 (depends on Wave 2)
- [x] T4: Wire both sections into the wizard — extend
      `LegacyPrimeMigrationWizardState` with `paymentChoice`/`guardChoice`,
      report them through `onStateChange`, and gate Continue on both being
      chosen while preserving the existing `keysChoice` -> finalize contract.
      — done when: the existing wizard suite still passes and
      `tests/ui-step3-wiring.test.tsx` proves Continue stays disabled until
      both decisions are made and that the reported state carries them.
  - files: same wizard file,
    `packages/codex-ouronet/tests/ui-step3-wiring.test.tsx`

## Explicitly NOT in this topic
- Changing any on-chain keyset (owner decision: never, in this migration).
- The fund sweep (pages 4-6).
- Calling `secureMasterAccount` from the wizard — the choices are recorded
  here; applying them is finalize's job.
