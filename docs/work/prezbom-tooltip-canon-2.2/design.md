# prezbom-tooltip-canon-2.2 — Design

## Problem

`@ouronet/talos-registry` was reissued at 2.2.0 with a retracted claim from the earlier canon and
two new rules (7 and 8) that Codex's `PreZbomHint.tsx` did not yet implement:

1. **Retraction**: an earlier canon round wrongly claimed a StoaChain native call's signer pays
   its own gas. False — every native modal carries `GAS_PAYER` on the gas-station key. Codex's own
   `ModelCard` already said "Gas is still sponsored" correctly (from an earlier round's own fix),
   but `LocalStopgapCard` (the local stopgap for `coin.C_TransferAcross`, still missing from the
   registry) had the SAME footer text minus that clause — the exact wrong-direction claim the
   retraction warns about, just in the one card that didn't get the earlier fix.
2. **Rule 7 — fill every parameter you can, and prove it.** Confirmed live against the installed
   registry: **eight launchers in `OuronetAccountsTab.tsx`** (`RotateStoa`, `RotateGuard`,
   `ReleaseStoicTag`/`RegisterStoicTag`, `RotateSovereign`, `RotateGovernor`,
   `DeploySmartAccount`/`DeployStandardAccount`, `DeployApiKey`) passed
   `values={{ account: account.address }}` — but `account` is not an execution parameter name for
   ANY of them (`tooltipModel(key).slots` confirmed their real names are `patron`/`executor`).
   Since `tooltipModel`'s `values` merges strictly by name, every one of these calls was a
   complete, silent no-op: the tooltip showed the registry's own example ghost account instead of
   the real one, on every account-management button in the app. Two more real gaps found the same
   way: `SingleApiPanel.tsx`'s Link button never filled `executor`; `DualApiPanel.tsx`'s
   Rename/Revoke buttons never filled `patron`/`executor` at all.
3. **Rule 8 — a refusal is an answer; render it as one.** A live-read failure (e.g. "No value
   found in table ... for key ...") rendered as plain red text — indistinguishable from a genuinely
   broken contract call.

## Approach

**Retraction fix**: one-line addition to `LocalStopgapCard`'s footer, matching `ModelCard`'s
already-correct text exactly.

**Rule 8**: a `classifyRefusal(message)` helper in `PreZbomHint.tsx`, checked before rendering an
error preview. A `/no value found in table .+ for key/i` match renders a friendly, grey,
non-alarming message; anything else renders raw, in red — red is reserved for the genuinely
unclassified case, matching the canon's own "prettifying everything is how real faults get
hidden" warning. The canon's own third case ("placeholder argument → name the argument, don't show
the refusal") is structurally unreachable in this renderer: `m.shouldRead` already gates the read
before it ever fires whenever the rendered call contains a placeholder, so an error here can only
ever be a genuine on-chain refusal — documented in the code rather than silently omitted.

**Rule 7**: one shared fill-map module, `zbom/cfm/preZbomFillMap.ts` — canon's own "one fill map,
not one per page" requirement, taken literally:
- `ouronetAccountFillValues(self)` — fills every CONFIRMED "this account" alias (`executor`,
  `account`, `owner-account`, `apollo-account`) with the launcher's own row account. Each alias was
  individually confirmed correct by reading the REAL modal each launcher opens (not guessed) —
  see the module's own doc comment for the full evidence trail per name.
- `resolvePatronFillValue(initialPatronMode, self, primeAddress)` — mirrors the EXACT same
  resident-vs-prime resolution every ZBOM modal's own `usePatronSelectionDefaults` +
  `accounts[0]` seed already uses at mount, so the hover tooltip shows the SAME patron the modal
  is about to open with. Deliberately does NOT fall back to `self` when a prime address is
  unavailable — that would be exactly the "plausible but wrong entity" fault rule 7 exists to
  catch, relocated into this helper instead of eliminated.

Wired into every launcher that has a real account in scope: 8 in `OuronetAccountsTab.tsx`, 1 in
`SingleApiPanel.tsx` (`executor` via the already-computed `stdOwner`), 2 in `DualApiPanel.tsx`
(`patron`+`executor` via the same `owner-account` resolution `dualLinkOps.ts`'s own doc comment
confirms).

**The one deliberate, documented exemption**: `StoaAccountsTab.tsx`'s Send launcher's `receiver`
parameter is `ouronet-account`-roled but genuinely launcher-time-unknowable — the whole point of
the Send modal is to let the user type in a receiver that doesn't exist in the launcher's own
context yet. This is NOT a gap the fill map should paper over (a guessed receiver would be exactly
the "plausible but wrong entity" fault the canon warns against), so it stays an honest placeholder,
and is proven-as-intentional by a dedicated test asserting `unfilledFillable` returns exactly
`["receiver"]` for this one case, not empty.

**The check, taken as literally as the canon states it**: `tests/zbom-prezbom-fill-map.test.ts`
asserts `unfilledFillable(model)` is empty for all 11 fixed launchers, using the SAME shared
helper functions the real code calls (not hand-reconstructed values) — plus a source-text guard
that the exact old broken pattern (`values={{ account: account.address }}`) never reappears in
`OuronetAccountsTab.tsx`, and that every `PreZbomHint` call site there references the shared
fill-map result rather than a hand-rolled object.

**Two items the reissued canon flagged as "still open in your build" were independently verified
already satisfied**, not blindly trusted or re-implemented:
- Elision (`shorten()`, `previewFormatting.ts`): already keep=14, head+tail, quotes outside,
  `title` carrying the full value — confirmed by reading the file directly.
- Rule 9 (launcher-only placement): confirmed via a dedicated, already-passing, whole-`src`-tree
  regression test (`tests/zbom-execute-button-no-tooltip.test.ts`) that `ZbomLayout.tsx`'s own
  execute button never references `ExecutionTooltip`/`ExecutionSpec` anywhere in the codebase.

**Alternatives considered:**
- *Fill `patron` with the row's own account everywhere, matching `executor`.* Rejected: confirmed
  via `usePatronSelectionDefaults` that the DEFAULT patron mode is "prime" (or "wealthiest",
  seeded as prime), not "resident" — blindly using `self` would be wrong in the common case, the
  exact fault class this whole rule exists to prevent.
- *Have `preZbomFillMap.ts` itself resolve the prime account (own hook, own accounts-list lookup).*
  Rejected: not every launcher file has the same accounts-array shape in scope at the same
  render point; keeping the helper a pure function and letting each call site supply its own
  `primeAddress` is more robust than baking a specific data-fetching assumption into the shared
  module.

## Acceptance criteria

- [x] `@ouronet/talos-registry@2.2.0` installed (`surfaceHash 8107265a0be6edc3`), peer range
      (`^2.1.0`) unchanged (2.2.0 falls within it).
- [x] `LocalStopgapCard`'s footer says "Gas is still sponsored", matching `ModelCard`.
- [x] A classified live-read refusal ("no value found... for key") renders as a friendly, non-red
      message; every other refusal still renders raw and red.
- [x] `unfilledFillable(model)` is empty for all 11 launchers this round's fill map covers; the one
      documented exemption (Send's `receiver`) is proven intentional, not accidental, by its own
      test.
- [x] Full workspace typecheck + test green, nectar review clean pass. See
      `docs/work/prezbom-tooltip-canon-2.2/review.md` for the full 8-finding review round and the
      quoted terminal clean pass.

## Out of scope

- Auditing every OTHER `PreZbomHint` launcher in the app beyond the 11 confirmed this round (the
  registry's `paramsByRole()` currently classifies only 35 names total — a future round extending
  coverage to `token-id`/`ats-pool`/`swap-pool`/`dpof-id`-roled launchers elsewhere in the app is
  real, separate work, not attempted here).
- Building a "claim a pending crosschain transfer" UI or any other feature unrelated to this
  canon reissue.
