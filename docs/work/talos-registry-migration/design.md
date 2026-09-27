# Talos Registry Migration — Design

## Problem

`codex-ouronet` hand-builds `ouronet-ns.*` Pact call strings by hardcoding function
names, argument order, and namespace (via a `KADENA_NAMESPACE`/`STOACHAIN_NAMESPACE`
alias) directly in source. This is exactly the failure class this session has already
hit twice this session (StoicTag execute calls, Rotate Payment Key) via live-chain
audits: a contract rename or reorder silently breaks a hand-written call, and because
Pact "partial application" doesn't error, nothing throws — it just does nothing, or
(worse, per the trap the registry's own docs cite) puts an account in the wrong slot.

`@ouronet/talos-registry@1.1.0` is now live: a pinned, generated snapshot of the actual
deployed callable surface (423 entrypoints + 428 previews), with `buildCall`/
`buildPreviewCall` helpers that render a call from named values and *throw loudly* on
any name/arity mismatch instead of silently partially-applying. The owner's brief
(both HANDOFF docs, already read in full) requires migrating every local call-string
builder onto this registry, as a `^1.1.0` peer (not bundled), with `surfaceHash` +
version visible in settings, and a test that fails the suite (not a user's panel) the
next time a contract renames.

## Investigation already done (informs scope below)

- `peerDependencies`/`devDependencies` already added to `codex-ouronet` and the
  aggregator `codex` package (`^1.1.0`, both places, per the brief's explicit
  "CARET not >=" instruction).
- Full alias-aware inventory run (literal `ouronet-ns.` **and** the
  `KADENA_NAMESPACE`/`STOACHAIN_NAMESPACE` alias pattern the handoffs warn a naive
  grep misses), comments excluded. Confirmed against `buildCall`'s live throw
  behavior (missing/unexpected key → throws with `missing:`/`unexpected:`/`declared:`;
  extra key a preview doesn't need → silently tolerated).
- Traced every hit to its actual call-building code (not just the grep line) to
  separate **local** Pact-string construction (in scope) from calls that **delegate
  to `@ouronet/ouronet-core/pact`** (out of scope — can't fix another package's
  internals; only migrate whichever inline preview literal sits next to it).

**In scope — local call construction to migrate:**

| File | What it builds |
|---|---|
| `src/zbom/stoicTagExecOps.ts` | EXEC: Release/Register StoicTag |
| `src/zbom/pythia/dualLinkOps.ts` | EXEC: Rename/Revoke dual link |
| `src/zbom/pythia/linkDualApiKey.ts` | EXEC: Link dual API key |
| `src/zbom/pythia/deployApiKey.ts` | EXEC: Deploy API key |
| `src/zbom/rotatePaymentKeyLive.ts` | EXEC: Rotate Stoa payment key |
| `src/zbom/ouroSelectorReads.ts` | 12 reads: selector lists (`O-UI-SEVEN.URC_*`), StoicTag/DeployAccount/RotateGuard/RotateStoa INFO_ previews, `DALOS.UR_AccountStoa` (used standalone AND spliced into two composite `let`+`map` expressions) |
| 12 `zbom/modals/*.tsx` files | Inline, display-only `pactCall={...}` preview strings shown in `ExecutionTooltip` (truncated values; never submitted) |

**Confirmed out of scope** (investigated, not assumed):
- `src/kadena/kadenaReads.ts`, `connection/createKadenaConnection.ts` — raw Kadena
  mainnet `coin` module, `networkId: "mainnet01"`, never `ouronet-ns`-namespaced. Not
  part of this registry's surface at all.
- `src/components/{RotateSovereignModal,RotatePaymentKeyModal,RotateGuardModal}.tsx`
  — a separate, still-live component family (exported via `components/index.ts`,
  consumed by `codex-ui`'s `RotateModals.tsx`, own test files). Checked: all three
  delegate EXEC entirely to `@ouronet/ouronet-core/pact` builders and have **no**
  local preview-string construction. Zero call sites here.
- `zbom/modals/{RotateGovernorModal,RotateSovereignModal,ActivateStandardAccountModal,
  ActivateSmartAccountModal}.tsx` **EXEC** calls — delegate to
  `@ouronet/ouronet-core/pact` (`buildRotateGovernorPactCode` etc.). Only their inline
  preview strings are in scope (already counted in the modals row above).
- `src/ui/internal/SendStoaModal.tsx`'s `${STOACHAIN_NAMESPACE}.DALOS.GAS_PAYER` — a
  capability/account name, not a function call; `buildCall` renders calls, not bare
  namespaced identifiers. Confirmed this is the only alias hit in that file.
- `RotateGuardModal.tsx`'s (`components/`) UI hint text `"e.g.
  ouronet-ns.dh_sc_dpdc-keyset"` — user-facing example copy in a label, not a call.
  The "zero `ouronet-ns.` literals" bar is about call construction; this survives as
  prose, flagged explicitly so it isn't mistaken for a miss later.
- Every `zbom/modals/*.tsx`'s `<Zone2Wrapper functionName="ouronet-ns....">` prop
  (discovered during Topic 1's build, not in the original inventory — a second
  literal-string class the `pactCall=` grep never targeted). Confirmed via
  `Zone2Wrapper.tsx`'s own doc comment and `functionAnnotation.ts`'s: this string is
  a static inventory anchor, kept byte-identical to OuronetUI's own modals "purely
  for the build-time annotation scanner OuronetUI runs over its modals; the value is
  NEVER read at runtime by the zone itself." A dynamic/registry-built expression
  would render the same value at runtime but would no longer be a literal for that
  external scanner's source-text match to find — worse fidelity, not better. Stays a
  hand-written literal in every modal; T7-equivalent verification greps must exclude
  `functionName=` lines specifically (in addition to comment lines).

## Registry coverage boundary (verified live, changes scope below)

Checked directly against the installed package: `tryGetEntrypoint` only resolves the
423 **capability-gated `C_*` EXECUTE functions** — each carrying its own `.preview`
key resolved via `buildPreviewCall`. The `UR_*`/`URC_*` view/selector helpers
(`DALOS.UR_AccountStoa`, `PYTHIA.UR_ApiKeyRowOrNull`, `P-UI-ONE.URC_01|ApiKeys`,
`P-UI-ONE.URC_02|DualLinks`, `P-UI-ONE.URC_03|Prices`, every `O-UI-SEVEN.URC_*`) are
**not in the registry at all** — confirmed via `tryGetEntrypoint` returning
`undefined` for all of them live. The registry's own scope statement ("423
entrypoints, their INFO_ previews") is literal: it covers callable, capability-gated
entrypoints and their cost-preview readers, not generic view helpers.

This means "zero `ouronet-ns.` literals" can't mean "every call goes through
`buildCall`" — for the non-entrypoint reads, there is no registry-backed name/arity
check to move to. The achievable, still-meaningful bar for those: stop sourcing the
namespace from the `KADENA_NAMESPACE`/`STOACHAIN_NAMESPACE` alias
(`@ouronet/ouronet-core/constants`) and source it from the registry's own `namespace`
export instead (confirmed live: `"ouronet-ns"`) — so every namespaced call in the
package, entrypoint or not, traces to the one package whose job is describing this
surface, and a comment at each such call notes *why* it isn't `buildCall`-backed
(not a registered entrypoint) so a future reader doesn't mistake it for a miss.

## Approach

**Chosen: centralize through the existing ops files; modals stop building Pact
strings entirely.**

Every ops file (`stoicTagExecOps.ts`, `dualLinkOps.ts`, `linkDualApiKey.ts`,
`deployApiKey.ts`, `rotatePaymentKeyLive.ts`, `ouroSelectorReads.ts`) already exports
one function per operation — this already matches the shape `buildCall`/
`buildPreviewCall` want. Each function:
1. Exports its registry key as a named constant (e.g. `RELEASE_STOIC_TAG_KEY =
   "TS01-C4.CODEX|C_ReleaseStoicTag"`), so one test file can import every key used
   in the package and walk it through `tryGetEntrypoint`.
2. Builds its EXEC string via `buildCall(KEY, valuesByName)` instead of a template
   literal — deleting the local namespace-alias import once nothing in the file
   needs it.
3. Where a modal currently inlines its own preview string, the *ops file* gains a
   sibling `buildXPreview(values)` using `buildPreviewCall`, keyed on
   `getEntrypoint(KEY).preview` — **never** the exec key, and **never** merged
   positionally against the exec signature (Trap ①). The modal imports and calls
   this instead of hand-writing the string. Existing display truncation (`.slice(0,
   20)+"…"`) stays in the modal, applied to the *values* passed in, not retrofitted
   onto the rendered string — `buildPreviewCall` doesn't validate string content, so
   a truncated display value renders fine.

For `ouroSelectorReads.ts`'s two composite `let`+`map` expressions (an INFO_ read
spliced together with a `map` over `DALOS.UR_AccountStoa`): the outer `let`/`map`
Pact stays hand-composed (it's cross-entrypoint composition, not a single call the
registry describes), but each inner call (`INFO_CODEX|RegisterStoicTag`,
`INFO_DALOS|DeployStandardAccount`, `DALOS.UR_AccountStoa`) is individually rendered
via `buildCall`/`buildPreviewCall` and spliced into the surrounding template — so the
function name/arity/namespace for each piece still comes from the registry, only the
outer composition is hand-written (matches the registry's own documented Trap ③:
`execution.mode` composition is not something `buildCall` alone replaces).

**Alternative considered and rejected:** leave modals building their own preview
strings inline, only migrate the ops files' EXEC calls. Rejected because it leaves
12 files independently re-deriving preview parameter lists — exactly the "positional
merge against the wrong signature" trap the brief calls out as hitting 97% of calls
silently. Centralizing removes the chance entirely: there is one place per operation
where preview values are named, and it's the same place that already owns the exec
values.

**Alternative considered and rejected:** a single shared `pactCalls.ts` re-export
module. Rejected — it would require flattening operation-specific parameter-mapping
logic (e.g. StoicTag names use `tag-name`, DualLink uses `dual-link-key`) into one
generic file, adding a layer with no behavioral benefit over the existing
one-file-per-operation structure that's already there and already the natural test
seam.

## Acceptance criteria

- [ ] `grep -rn "ouronet-ns\."` and a parallel alias-aware scan (`KADENA_NAMESPACE`/
      `STOACHAIN_NAMESPACE` used to build call syntax, not identifiers) across
      `src/` return zero hits sourced from `@ouronet/ouronet-core/constants` —
      outside the documented out-of-scope exceptions (SendStoaModal's `GAS_PAYER`
      identifier, the RotateGuardModal hint text, and anything delegating to
      `@ouronet/ouronet-core/pact`). Non-entrypoint view/selector reads (the
      `UR_*`/`URC_*` helpers — see registry coverage boundary above) are allowed to
      remain hand-built, but must source their namespace prefix from
      `@ouronet/talos-registry`'s own `namespace` export, not the ouronet-core alias.
- [ ] Every EXEC call and its preview, for every registered entrypoint among the
      in-scope files, is built via `buildCall`/`buildPreviewCall`, with preview
      values keyed on `getPreview(entrypoint.preview).params` — never positionally
      against the exec signature.
- [ ] A new test file imports every registry key constant exported by the migrated
      ops files and asserts each resolves via `tryGetEntrypoint` (fails loudly, at
      the suite, on the next rename — not at a user's panel).
- [ ] `packages/codex-ouronet/src/ui/settings/CodexInfoCard.tsx` shows the installed
      `@ouronet/talos-registry` version (read at build time from the installed
      package, not hardcoded) and its `surfaceHash`, as a new row alongside the
      existing Schema Version / Codex Form rows.
- [ ] The package typechecks, tests pass, and `dist/` is rebuilt and spot-checked to
      confirm the migrated calls compiled through.
- [ ] A smoke check exercises `buildCall`/`tryGetEntrypoint` against the installed
      `@ouronet/talos-registry` from outside the monorepo's own OuronetUI-adjacent
      context (no host-provided rewrite shim present) — the class of test the brief
      says would have caught all nineteen dead names originally.
- [ ] `peerDependencies`/`devDependencies` on `codex` (aggregator) and
      `codex-ouronet` both pin `@ouronet/talos-registry` at `^1.1.0` (already done;
      re-verified as part of this topic's acceptance, not re-done).

## Topics

Decomposition surfaced ~17 file-level tasks during planning — over plan's 10-task
escalation trigger — so this is project scale, split by operation family (each
topic's tasks touch disjoint files from the others, so topics can build in any
order once shaped, though verification naturally runs last):

1. `talos-registry-pythia-ops` — Pythia exec+preview migration: `dualLinkOps.ts`,
   `linkDualApiKey.ts`, `deployApiKey.ts`, and the four modals that consume them
   (`RenameDualLaneModal`, `RevokeDualLinkModal`, `LinkDualApiKeyModal`,
   `ActivateApolloPythiaKeyModal`).
2. `talos-registry-codex-rotate-ops` — StoicTag, Rotate Payment Key, the 12-read
   `ouroSelectorReads.ts`, and the two externally-delegated rotate-authority modals'
   inline previews: `stoicTagExecOps.ts`, `rotatePaymentKeyLive.ts`,
   `ouroSelectorReads.ts`, and the modals `ReleaseStoicTagModal`,
   `RegisterStoicTagModal`, `RotatePaymentKeyModal` (zbom), `RotateGuardModal`
   (zbom), `ActivateStandardAccountModal`, `ActivateSmartAccountModal`,
   `RotateGovernorModal`, `RotateSovereignModal` (zbom).
3. `talos-registry-surfacing-verification` — depends on Topics 1 and 2 (needs their
   exported key constants to exist): the `tryGetEntrypoint` coverage test, the
   `CodexInfoCard.tsx` surfaceHash/version display, and the empty-directory/no-
   OuronetUI-shim smoke verification.

## Out of scope

- `kadenaReads.ts` / `createKadenaConnection.ts` (raw Kadena mainnet, no
  `ouronet-ns` namespace — confirmed unrelated to this registry).
- `<Zone2Wrapper functionName="ouronet-ns...."` literals across every `zbom/modals/`
  file — a static inventory anchor for OuronetUI's own build-time source-text
  scanner, never read at runtime; a dynamic expression breaks the scanner's literal
  match. Stays hand-written. See the registry coverage boundary section above.
- `src/components/*Modal.tsx` legacy family (delegates EXEC externally, builds no
  local preview strings).
- Fixing `@ouronet/ouronet-core`'s own peer pin (`>=4.6.0`, now stale per the
  handoff's aside about its 5.0.0 breaking release) — noted as a real, separate
  problem but not part of this brief's instructions, which only specify `^` for the
  *new* talos-registry peer.
- Changing `@ouronet/ouronet-core/pact`'s own internals for the four modals that
  delegate to it (`RotateGovernorModal`, `RotateSovereignModal`,
  `ActivateStandardAccountModal`, `ActivateSmartAccountModal`'s EXEC paths, plus the
  three `components/*` modals) — not this package's source to fix.
- Version bump / CHANGELOG / commit — happens after the build+review passes, as a
  separate closing step, following this session's established rhythm. No publish,
  no push, no tag without the user's separate explicit confirmation (standing
  constraint, unaffected by this topic).
