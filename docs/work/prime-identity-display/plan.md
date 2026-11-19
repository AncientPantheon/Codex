# Prime Identity Display — Plan

Topic 2 of `docs/work/prime-two-name-model/design.md`. Topics 1 and 3 are
DONE. This is the one that fixes the owner's screenshot.

## Before you start

1. `@testing-library/jest-dom` is declared but NEVER registered in
   `packages/codex-ouronet/tests/setup.ts` — its matchers throw `Invalid Chai
   property`, surfacing inside `waitFor` as an opaque *"Test timed out in
   5000ms"*. Use plain checks there. `packages/codex-arweave/tests/setup.ts`
   DOES register it (line 12).
2. **Measured flake:** `packages/codex-ouronet/tests/ui-legacy-prime-migration-wizard.test.tsx`
   gives ~10 pure-timeout failures at 5000ms on a loaded box and passes fully
   at `--testTimeout=40000`. Always use that flag for this package.

Baselines: `codex-core` 300 passed; `codex-ouronet` 2107 passed + 1
pre-existing unrelated failure (`tests/pact-signatures.test.ts`);
`codex-arweave` 71/71 files, 1113 passed, 1 skipped; `apps/codex-playground`
249 passed.

Shipped by topics 1 and 3, reuse as-is:
- `OURONET_CODEX_MASTER` is now `"Codex Ouronet Master"`. The SYMBOL still
  reads `OURONET_CODEX_MASTER` — deliberately not renamed; do not rename it
  here either.
- `FORMER_OURONET_CODEX_MASTER` = `` `Former ${OURONET_CODEX_MASTER}` ``.
- `isFormerMasterAccount(accountId, row, progress)` — seal-gated, with the
  progress a REQUIRED third parameter that fails closed. Same for
  `isFormerMasterArweaveSeed`.
- `CodexMasterSeed.formerOuroAccountIds?` / `formerArweaveSeedIds?`, appended
  automatically by `setCodexMasterSeed` whenever a face id changes.
- `resolveMasterArweaveSeed(seeds, masterArweaveSeedId)`
  (`packages/codex-arweave/src/panel/resolveMasterArweaveSeed.ts:50-59`) — the
  shape to mirror for accounts.
- The two-line designation rendering shipped in `ArweaveSeedsArea` —
  `arweave-seed-designation-<id>` gold `#ceac5f` / `arweave-seed-own-name-<id>`
  muted `#888`, with the former-master variant in `#9a9a9a`.

Verified grounding for this topic:
- `packages/codex-ouronet/src/ui/tabs/OuronetAccountsTab.tsx:1311` —
  `const codexPrimeAcct = hydratedAccounts[0];` with the comment "index-0 ⇒
  AccountRow renders it as CodexPrime". Pinning is PURELY POSITIONAL.
- `:587` — gold is `isFirst` only: `nameColor = isApollo ? apolloAccent :
  isFirst ? "#ceac5f" : …`.
- `:504-506` — `isFirst = index === 0`, `isCodexIdPrime = !!primeName`,
  `locked = isFirst || isCodexIdPrime`. `locked` drives the 🔒 Prime badge
  (`:655-671`), hides the rename affordance (`:926`) and disables delete
  (`:959-961`).
- `:512-516` — the NAME alone follows `codexMasterSeed.ouroAccountId`, via
  `masterOuronetAccountParts`. So gold and the role name are already different
  rows on a settled codex. That IS the screenshot.
- `:518-525` + `:681-692` — a two-line rendering already exists for accounts
  (`account-former-name-<id>`, 11px `#888`), but is framed as "former name,
  demoted" and narrowed to `displayName === OURONET_CODEX_MASTER`.
- `packages/codex-core/src/codex/masterNames.ts:151-165` —
  `resolveOuronetAccountName`'s precedence: `explicitName` → settled master →
  position 0 → storedName → `"Account #N"`. `explicitName` (the CodexID APOLLO
  `primeName`) OUTRANKS the master designation.
- `packages/codex-arweave/src/panel/ArweaveAccountsArea.tsx:1693` — a FOURTH
  independent master rule: `label: seed.isPrime === true || i === 0 ?
  PRIME_LABEL : seed.label || \`Seed #${i+1}\`` (`PRIME_LABEL =
  MASTER_ARWEAVE_SEED`, `:85`). Titles the wrong group after a settlement.

## Wave 1

- [x] T1: `resolveMasterOuronetAccount`, the account-side mirror — done when:
      `packages/codex-core` exports a pure, unit-tested
      `resolveMasterOuronetAccount(accounts, masterAccountId)` returning the
      account the codex has SETTLED on, with the documented precedence:
      the settled id when it names an account actually present (a dangling id
      falls through), else the account flagged prime, else position 0.
      Mirror `resolveMasterArweaveSeed`'s shape, doc voice and generic
      signature (`<T extends { id: string; isPrime?: boolean }>`) so the two
      read as one idea — that file's header is the model for explaining why a
      provenance flag is the wrong answer.
      Tests (`packages/codex-core/tests/`, a new spec beside
      `master-seed-row.test.ts`): the settled id wins over a different
      `isPrime` account; a dangling settled id falls back; no settled id falls
      back to `isPrime`; neither falls back to position 0; an empty list
      returns undefined.
  - files: `packages/codex-core/src/codex/masterOuronetAccount.ts`,
    `packages/codex-core/src/index.ts`,
    `packages/codex-core/tests/master-ouronet-account.test.ts`

## Wave 2 (depends on Wave 1 — T2 and T3 touch different packages, run in parallel)

- [x] T2: Account gold, pinning and the Prime badge follow the sealed master —
      done when: in `OuronetAccountsTab.tsx`, the row pinned to the prime zone,
      the row painted gold, and the row wearing the 🔒 Prime badge are all the
      SETTLED master — resolved once via T1's `resolveMasterOuronetAccount`
      from `codexMasterSeed.ouroAccountId` — rather than `hydratedAccounts[0]`
      and `index === 0`. Derive it ONCE and let pinning, gold and the badge all
      read that single value; the defect being fixed is precisely that they
      currently disagree.
      **Gated on the seal**, per the design's "the designation follows the SEAL,
      not the finalize": use `isMigrationSealed(migrationProgress)`. On an
      unsealed codex — including one that has finalized but not applied —
      behaviour is EXACTLY today's positional rule, so a never-migrated codex
      is untouched. This backwards-compatibility requirement is hard; many
      existing tests depend on it.
      The master row renders BOTH names: `OURONET_CODEX_MASTER` as the golden
      designation and the account's own stored `name` beneath, reusing the
      existing `account-former-name-<id>` two-line slot but re-framed as the
      normal name rather than a displaced one (rename the testid if that makes
      it honest; say what you chose). An account displaced from the role
      renders `FORMER_OURONET_CODEX_MASTER` via `isFormerMasterAccount(id, row,
      progress)`, muted, NOT gold — exactly one gold row.
      The stored `name` is never overwritten. Note `locked` also governs the
      rename affordance and delete-protection: deliberately decide whether the
      settled master becomes renameable (the owner's "a prime account can still
      get its normal name, which wasn't possible before" says YES) and state
      your reasoning.
      Tests (`packages/codex-ouronet/tests/ui-ouronet-accounts-tab.test.tsx`
      and `-mobile`): on a SEALED codex the settled master is pinned first,
      gold, badged, and "Initial Seed" is none of those — the owner's exact
      screenshot; the master shows its own name as a second line; the displaced
      account reads the former designation and is not gold; on a codex with no
      settled master, and on a finalized-but-unsealed one, ordering/gold/badge
      are byte-identical to today.
  - files: `packages/codex-ouronet/src/ui/tabs/OuronetAccountsTab.tsx`,
    `packages/codex-ouronet/tests/ui-ouronet-accounts-tab.test.tsx`,
    `packages/codex-ouronet/tests/ui-ouronet-accounts-tab-mobile.test.tsx`

- [x] T3: The fourth master rule in the Arweave accounts area — done when:
      `ArweaveAccountsArea.tsx:1693`'s group heading stops deciding the master
      by `seed.isPrime === true || i === 0` and uses `resolveMasterArweaveSeed`
      against the injected settled id, like the seeds area already does. The
      heading shows `MASTER_ARWEAVE_SEED` for the settled master and the seed's
      own name otherwise; a displaced seed never keeps the master title.
      The area reaches no store — take the settled id as an injected prop
      resolved in `ArweavePanel.tsx`, the pattern `masterArweaveSeedId` already
      uses.
      Tests (`packages/codex-arweave/tests/`, the existing accounts-area spec):
      after a settlement the group heading titles the settled seed, not the
      `isPrime` one; with no settled id the heading is byte-identical to today.
  - files: `packages/codex-arweave/src/panel/ArweaveAccountsArea.tsx`,
    `packages/codex-arweave/src/panel/ArweavePanel.tsx`,
    `packages/codex-arweave/tests/e5-accounts-area.test.tsx`

## Design-criteria coverage

| design.md criterion | task |
|---|---|
| On a SEALED codex the settled master is pinned first, badged, gold | T1, T2 |
| A prime account shows golden designation AND its own stored name | T2 |
| An account renamed before becoming prime keeps that name visible | T2 |
| Displaced account reads "Former Codex Ouronet Master" | T2 |
| Finalized-but-unapplied codex does NOT move gold or the badge | T2 |

Out of scope, logged in `backlog.md`: the 14 ZBOM modals that hand-roll
`accounts.indexOf(x) === 0 ? OURONET_CODEX_MASTER : …`; the duplicated
`seedNames.ts`; `apps/codex-playground`'s `ForeignChainsWiring.tsx:449-454`;
Chainweb seed two-name rendering; an account that is both settled master and a
CodexID APOLLO half.
