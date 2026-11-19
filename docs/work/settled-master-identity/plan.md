# Settled Master Identity — Plan

Design: `docs/work/settled-master-identity/design.md`. Parent concept:
`docs/work/codex-master-seed-model/design.md`.

## Before you start — traps that have already cost hours in this repo

1. **`@testing-library/jest-dom` is declared but never registered** in
   `packages/codex-ouronet/tests/setup.ts`. `toBeDisabled()` /
   `toHaveAttribute()` / `toBeInTheDocument()` throw `Invalid Chai property`,
   and inside `waitFor` that surfaces as an opaque *"Test timed out in
   5000ms"*. Use plain checks: `(el as HTMLButtonElement).disabled`,
   `el.getAttribute("data-lit")`, `screen.queryByTestId("x") === null`.
2. **vitest `testTimeout` is 5000ms** while `setup.ts` sets
   `asyncUtilTimeout: 15000`, so a failing `findBy*` hides the real Testing
   Library error. When diagnosing a RED, re-run with `--testTimeout=40000`.
3. Workspace packages are **aliased to `src`** in the vite configs, so no
   rebuild is needed after changing `codex-core` — consumers see it directly.

Baselines. `packages/codex-ouronet`: **2006/2007**, the one failure being the
pre-existing unrelated `tests/pact-signatures.test.ts` Pact-codegen drift
guard. `packages/codex-arweave`: has load-dependent flakes
(`e4-treeshake-bundle.test.ts`, `e1-foreign-keys-slice.test.ts` — both pass in
isolation) **plus** a pre-existing failure in
`tests/e4-panel-codex-id-extraction.test.tsx` ("accounts are PURE POSITIONAL
(isPrime ignored)…") which T5 must explicitly adjudicate rather than ignore.

Existing helpers to reuse, not reinvent:
- `codexIdPrimeName(designated, original)` in
  `packages/codex-ui/src/ui/ObservationalCodexId.tsx` already returns exactly
  `"Ouronet Codex Master (AncientHodler)"` — the dropdown format.
- `useCodex()` (`packages/codex-ui/src/hooks/useCodex.ts`) already exposes
  `codexMasterSeed`, so every call site can reach the settled master's id.
- `OuronetAccountsTab` already threads an `explicitName` through
  `masterOuronetAccountName(index, account.name, primeName)`, where
  `primeName` is the APOLLO CodexID-prime label. That mechanism must keep
  winning — see T1.

## Wave 1

- [x] T1: Make the master-name rule identity-first in `codex-core` — done when:
      `masterOuronetAccountName` accepts a new OPTIONAL fourth argument
      `opts?: { accountId?: string; settledMasterAccountId?: string | null }`
      and resolves in this precedence: (1) an `explicitName` still wins
      outright, unchanged — `OuronetAccountsTab`'s APOLLO `primeName` depends
      on it; (2) when `opts.settledMasterAccountId` is a non-empty string, the
      account whose `opts.accountId` equals it returns `OURONET_CODEX_MASTER`
      and **every other account falls through to its stored name / `"Account
      #N"`, including the one at index 0**; (3) when
      `settledMasterAccountId` is absent/null/empty, behaviour is byte-identical
      to today (`index === 0` wins). Omitting the fourth argument entirely
      must also be byte-identical to today, so all existing call sites compile
      and behave unchanged.
      Additionally export `masterOuronetAccountParts(index, storedName?,
      explicitName?, opts?)` returning `{ name: string; formerName?: string }`
      — the same rule, but exposing the two halves so a caller with room can
      render the former name on a second line. `formerName` is set ONLY when
      the returned `name` is `OURONET_CODEX_MASTER` (or the explicit name) AND
      a non-empty `storedName` was displaced; otherwise it is `undefined`.
      Both exported from `packages/codex-core/src/index.ts`.
      Tests (`packages/codex-core/tests/master-names.test.ts` — create if
      absent, otherwise extend): with no fourth arg, index 0 → master name and
      index 2 → stored name (today's behaviour pinned); with
      `settledMasterAccountId` matching a NON-zero index, that account → master
      name AND index 0 → its own stored name; with `settledMasterAccountId`
      set but matching nothing, no account gets the master name; `explicitName`
      still wins over a settled master; `masterOuronetAccountParts` returns
      `formerName: "AncientHodler"` for the settled master that had that name,
      and `formerName: undefined` for a master with no stored name.
  - files: `packages/codex-core/src/codex/masterNames.ts`,
    `packages/codex-core/src/index.ts`,
    `packages/codex-core/tests/master-names.test.ts`

- [x] T2: Make `resolveAccountSeedId` try the claimed parent seed first and
      memoise seed bitstrings — done when: `resolveAccountSeedId` in
      `packages/codex-ouronet/src/ui/internal/seedDashboard.ts` orders its
      candidate scan so that, when `account.parentSeedId` names a seed present
      in `candidateSeeds`, that seed is decrypted and compared FIRST, with the
      remaining candidates still scanned in their original relative order
      afterwards. The decrypt-and-compare verification itself is UNCHANGED: a
      `parentSeedId` naming a seed whose bitstring does NOT match must fall
      through and still resolve to the genuinely matching seed, and a
      `parentSeedId` naming a seed absent from `candidateSeeds` must be
      ignored without throwing. The function additionally accepts an OPTIONAL
      `seedBitsCache?: Map<string, string | null>` on its input object, keyed
      by seed id, which it reads before decrypting a candidate and populates
      after; when the option is omitted behaviour is unchanged. The cache is
      caller-owned and passed in — it must NOT be a module-level mutable in
      this file, which that file's own header documents as a deliberately
      pure, React-free module (a module-level cache would leak across tests).
      Tests (`packages/codex-ouronet/tests/seed-dashboard-rows.test.ts`):
      an account whose `parentSeedId` names the correct seed resolves with
      exactly ONE candidate decrypt (assert via a counting `smartDecrypt`
      spy — one for the account, one for the parent seed, two total); an
      account whose `parentSeedId` names a NON-matching seed still resolves to
      the correct seed; an account whose `parentSeedId` names an unknown id
      resolves correctly and does not throw; an account with no `parentSeedId`
      behaves exactly as before; a pre-populated `seedBitsCache` causes zero
      decrypts for cached seeds; a cache passed empty is populated after the
      call so a second call with the same cache performs no seed decrypts.
  - files: `packages/codex-ouronet/src/ui/internal/seedDashboard.ts`,
    `packages/codex-ouronet/tests/seed-dashboard-rows.test.ts`

## Wave 2 (depends on Wave 1 — T3/T4/T5 import T1's helper; T6 imports T2's cache option)

- [x] T3: Account rows name the settled master by role, former name beneath —
      done when: `OuronetAccountsTab`'s `displayName` is produced by
      `masterOuronetAccountParts(index, account.name, primeName, { accountId:
      account.id, settledMasterAccountId: codexMasterSeed?.ouroAccountId ??
      null })`, reading `codexMasterSeed` from `useCodex()`; the row renders
      `parts.name` as its primary name and, when `parts.formerName` is set,
      renders it directly beneath in the row's existing secondary/muted text
      treatment. A codex with no settled master renders exactly as today.
      Tests (`packages/codex-ouronet/tests/ui-ouronet-accounts-tab.test.tsx` —
      if that file does not exist, find the existing test file covering this
      tab by grepping `tests/` for `OuronetAccountsTab` and extend it):
      with `codexMasterSeed.ouroAccountId` pointing at a NON-first account,
      that row shows "Ouronet Codex Master" with "AncientHodler" beneath, and
      the first row shows its own stored name; with no `codexMasterSeed`, the
      first row still shows "Ouronet Codex Master" (today's behaviour).
  - files: `packages/codex-ouronet/src/ui/tabs/OuronetAccountsTab.tsx`,
    `packages/codex-ouronet/tests/ui-ouronet-accounts-tab.test.tsx`

- [x] T4: Both ZBOM dropdowns name the settled master inline — done when:
      `StoicTagPicker` and `AddressBookPicker` each resolve their option label
      via `masterOuronetAccountName(idx, acc.name, undefined, { accountId:
      acc.id, settledMasterAccountId: codexMasterSeed?.ouroAccountId ?? null })`
      with `codexMasterSeed` from `useCodex()`, and render the settled master
      as the single-line form `Ouronet Codex Master (AncientHodler)` — built
      with the EXISTING `codexIdPrimeName(designated, original)` helper from
      `packages/codex-ui/src/ui/ObservationalCodexId.tsx`, not a new string
      template. An account with no stored name renders just `Ouronet Codex
      Master`. A codex with no settled master renders exactly as today.
      Tests (`packages/codex-ouronet/tests/zbom-master-name-pickers.test.tsx`,
      new): for EACH picker, with a settled master at a non-first index the
      option reads `Ouronet Codex Master (AncientHodler)` on one line and
      contains no second line; with no settled master the first account still
      reads `Ouronet Codex Master`.
  - files: `packages/codex-ouronet/src/zbom/cfm/StoicTagPicker.tsx`,
    `packages/codex-ouronet/src/zbom/cfm/AddressBookPicker.tsx`,
    `packages/codex-ouronet/tests/zbom-master-name-pickers.test.tsx`

- [x] T5: The Codex ID card shows the master's former name beneath, and the
      pre-existing arweave naming failure is adjudicated — done when:
      `CodexMasterSeedSection`'s Ouronet face renders `OURONET_CODEX_MASTER`
      as its value with the pointed-at account's stored name beneath it as
      secondary text (reusing `masterOuronetAccountParts` from T1 so one rule
      governs every surface), while the Chainweb and ArWeave faces are
      unchanged. The existing `UNNAMED_FACE_NOTE` behaviour ("established —
      unnamed" for a found-but-nameless entity, never a raw UUID) must still
      hold and its test must still pass — do not regress it.
      Separately, run `npx vitest run tests/e4-panel-codex-id-extraction.test.tsx`
      and adjudicate its pre-existing failure ("accounts are PURE POSITIONAL
      (isPrime ignored) while seeds still let isPrime override position"):
      state in your report whether this change makes it pass, leaves it
      failing for its original unrelated reason, or requires updating it to
      match the identity-first rule — and if updating is right, update it.
      Do not leave it silently red.
      Tests (`packages/codex-arweave/tests/e4-panel-codex-master-seed-section.test.tsx`):
      the Ouronet face shows "Ouronet Codex Master" with "AncientHodler"
      beneath; an account with no stored name shows "Ouronet Codex Master"
      with no second line; the existing nameless-seed and
      not-derived-yet/not-found-in-this-codex tests still pass unchanged.
  - files: `packages/codex-arweave/src/panel/CodexMasterSeedSection.tsx`,
    `packages/codex-arweave/tests/e4-panel-codex-master-seed-section.test.tsx`,
    `packages/codex-arweave/tests/e4-panel-codex-id-extraction.test.tsx`

- [x] T6: The wizard supplies the seed-bitstring cache so switching accounts
      does not re-decrypt — done when: the `resolveAccountSeedId` call site in
      `packages/codex-ouronet/src/ui/internal/LegacyPrimeMigrationWizard.tsx`
      passes a `seedBitsCache` held in a `useRef(new Map())` that lives for the
      wizard's mounted lifetime, so selecting account A then B then A again
      performs seed decrypts only on the first pass. The existing request-id
      guard around that effect is unchanged, and a resolution superseded by a
      newer one must still be discarded exactly as today.
      Tests (`packages/codex-ouronet/tests/ui-seed-dashboard.test.tsx`, whose
      `ARWEAVE_DECRYPT_MAP` / `PENDING_DECRYPTS` harnesses already control
      decrypt timing): switching from account A to account B and back to A
      lights A's blue ticker again without a second decrypt of the same seed
      (assert with a counting decrypt spy); the account-switch race test(s)
      already in that file still pass, proving the cache did not weaken the
      request-id guard.
  - files: `packages/codex-ouronet/src/ui/internal/LegacyPrimeMigrationWizard.tsx`,
    `packages/codex-ouronet/tests/ui-seed-dashboard.test.tsx`

## Design-criteria coverage

| design.md criterion | task |
|---|---|
| Settled master's rows show "Ouronet Codex Master" + former name beneath | T3 (rule: T1) |
| Pickers show `Ouronet Codex Master (<former name>)` | T4 (rule: T1) |
| Never-settled codex names exactly as today (position 0 wins) | T1, and re-pinned in T3, T4, T5 |
| Settling a non-index-0 master moves the name onto it and off index 0 | T1, T3 |
| Correct `parentSeedId` lights the blue ticker in ≤2 decrypts | T2 |
| Absent/stale/wrong `parentSeedId` still resolves correctly, by full scan | T2 |
| Switching back to a resolved account re-decrypts no seed | T2 (cache), T6 (wiring) |
