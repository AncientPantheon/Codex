# Master Naming Constants + Informatics — Plan

Topic 1 of `docs/work/codex-master-seed-model/design.md`.

## Measured surface (not estimated)

| String | quoted display literals in src | in comments | test occurrences |
|---|---|---|---|
| `CodexPrime` | 48 | 61 | 138 |
| `Prime Codex Seed` | 10 | 9 | 71 |
| `Prime Arweave Seed` | 10 | 15 | 103 |

So the user-visible surface is ~68 literals plus a little JSX prose — the
other ~85 are doc-comments, which are not renamed (they describe internal
identifiers that keep their names per the design's display-only scope).

## Scope calls

- **Test ids are NOT renamed.** `data-testid`, route ids and
  `useRegisterControls` keys are internal identifiers; renaming them would
  churn ~250 test assertions for zero user-visible benefit.
- **Internal identifiers are NOT renamed** (`isPrime`, `primeAlignment`,
  `CodexPrimeProtectedError`, …) — design decision, already recorded.
- **The stored account name stays `"CodexPrime"`** (`store.ts` writes it at
  kickstart). The display layer resolves the master POSITIONALLY instead, so
  codices created before and after this change read identically.

## Wave 1
- [x] T1: One source of truth for the names — `masterNames.ts` in codex-core
      exporting `OURONET_CODEX_MASTER`, `MASTER_CHAINWEB_SEED`,
      `MASTER_ARWEAVE_SEED`, `CODEX_MASTER_SEED`, `CODEX_STOIC_IDENTITY`,
      plus `masterOuronetAccountName(index, storedName)` and
      `masterChainwebSeedName(index, isPrime, storedName)` encoding the
      positional rule in ONE place instead of the 20+ inline
      `indexOf(acc) === 0 ? "CodexPrime" : …` copies that caused the drift.
      — done when: `tests/master-names.test.ts` pins every literal and both
      helpers, including that a stored `"CodexPrime"` name still renders as
      the new master name.
  - files: `packages/codex-core/src/codex/masterNames.ts`,
    `packages/codex-core/src/index.ts`,
    `packages/codex-core/tests/master-names.test.ts`

## Wave 2 (depends on Wave 1)
- [x] T2: Route the seed/account display sites through the constants —
      `seedNames.ts`, `SeedWordsTab`, `StoaAccountsTab`, `ForeignChainsWiring`,
      `OuronetAccountsTab`, `AddressBookPicker`, the ZBOM modal signer labels,
      `ArweaveSeedsArea`/`ArweaveAccountsArea`/`kickstartPrimeArweaveSeed`
      labels, and the two user-visible error messages in `errors/types.ts`.
      — done when: no quoted `"CodexPrime"`/`"Prime Codex Seed"`/
      `"Prime Arweave Seed"` display literal remains in src, and the affected
      suites pass with assertions updated to the new names.
  - files: the display sites listed above, plus their tests
- [x] T3: Rewrite `CodexMigrationInformatics.tsx` — the Master Seed threefold
      model (one word set -> Ouronet Codex Master, Master Chainweb Seed,
      Master ArWeave Seed), the Codex Stoic Identity, and BOTH ArWeave restore
      paths, stated honestly including that no restore screen exists yet.
      — done when: `tests/e4-panel-codex-migration-informatics.test.tsx`
      asserts the threefold model, both restore paths, and the no-restore-yet
      caveat are present.
  - files: `packages/codex-arweave/src/panel/CodexMigrationInformatics.tsx`,
    `packages/codex-arweave/tests/*informatics*`

## Wave 3 (depends on Wave 2)
- [ ] T4: Rename the user-visible "Codex ID"/"Codex Identity" LABELS to
      "Codex Stoic Identity" (headings, buttons, aria-labels, card titles) —
      leaving every `data-testid`, route id and control key untouched.
      — done when: the affected suites pass and no user-visible "Codex
      Identity" heading remains unrenamed.
  - files: `packages/codex-ui/src/ui/ObservationalCodexId.tsx`,
    `packages/codex-ui/src/ui/settings/CodexIdentityCard.tsx`,
    `packages/codex-arweave/src/panel/ArweavePanel.tsx`,
    `apps/codex-playground/src/{App,OuronetShellMock}.tsx`, plus their tests
