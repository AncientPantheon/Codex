# Talos Registry Migration — Pythia Ops — Design

Sub-topic of `docs/work/talos-registry-migration/design.md` (read that first — it
carries the full problem statement, the registry coverage boundary finding, and the
chosen approach). This topic scopes that approach to the three Pythia ops files and
their four consuming modals.

## Problem

`src/zbom/pythia/dualLinkOps.ts`, `linkDualApiKey.ts`, and `deployApiKey.ts` hand-build
`ouronet-ns.*` Pact strings via the `KADENA_NAMESPACE` alias for both their EXECUTE
calls and their INFO_ preview reads. Read in full this round; exact scope confirmed
live against the installed `@ouronet/talos-registry`:

| File | Registered entrypoint (buildCall/buildPreviewCall) | Not registered (namespace-only fix) |
|---|---|---|
| `dualLinkOps.ts` | `TS01-C4.PYTHIA\|C_UpdateDualConsumerLane` (preview `PYTHIA.INFO_PYTHIA\|UpdateDualConsumerLane`), `TS01-C4.PYTHIA\|C_RevokeLink` (preview `PYTHIA.INFO_PYTHIA\|RevokeLink`) | `DALOS.UR_AccountStoa` (used inside the Rename composite `let*`) |
| `linkDualApiKey.ts` | `TS01-C4.PYTHIA\|C_Link` (preview `PYTHIA.INFO_PYTHIA\|Link`) | — |
| `deployApiKey.ts` | `TS01-C4.PYTHIA\|C_DeployApiKey` (preview `PYTHIA.INFO_PYTHIA\|DeployApiKey`) | `DALOS.UR_AccountStoa` (Deploy composite `let*`), `PYTHIA.UR_ApiKeyRowOrNull`, `P-UI-ONE.URC_01\|ApiKeys`, `P-UI-ONE.URC_02\|DualLinks`, `P-UI-ONE.URC_03\|Prices` |

Live-confirmed param mismatches between EXEC and preview (Trap ①, not hypothetical
here): `C_Link` is `(executor standard-apollo smart-apollo consumer-lane)` — 4 args;
its preview `INFO_PYTHIA|Link` is `(standard-apollo smart-apollo consumer-lane)` — 3
args, no `executor`. A positional merge would silently shift every arg by one.

Four modals each inline their own truncated-display copy of an INFO_ preview string
that duplicates (imperfectly — by hand) what these ops files already compute:
`RenameDualLaneModal.tsx:424`, `RevokeDualLinkModal.tsx:336`,
`LinkDualApiKeyModal.tsx:345`, `ActivateApolloPythiaKeyModal.tsx:524`.

## Approach

Per the parent design: each ops file's EXEC builder moves to `buildCall`; each gets a
new `buildXPreview(values)` sibling using `buildPreviewCall`, keyed off the
entrypoint's own `.preview`; each exports its EXEC key as a named constant for the
verification topic's test. The four modals stop inlining preview strings — they call
the new `buildXPreview` export instead, still truncating the *values* before passing
them in (unchanged display behavior, different construction path).

The five non-entrypoint reads (`getApiKeyRow`, `getApiKeySelectorData`,
`getDualApiKeySelectorData`, `getPythiaPrices`, and the `DALOS.UR_AccountStoa` calls
inside the two composite `let*` reads) stay hand-built — no registry data describes
them — but switch their namespace source from `KADENA_NAMESPACE` (aliased from
`@ouronet/ouronet-core/constants`) to `namespace` (from `@ouronet/talos-registry`),
with a one-line comment at each site noting it's intentionally outside `buildCall`'s
coverage (not a registered entrypoint), so it doesn't read as a missed call site
later.

## Acceptance criteria

- [ ] `dualLinkOps.ts`: `buildRenameDualLanePactCode` and `buildRevokeDualLinkPactCode`
      use `buildCall`; `getRenameDualLaneInfoOnly` and the INFO_ half of
      `getRenameDualLaneInfo`'s composite read use `buildPreviewCall`;
      `getRevokeDualLinkInfoOnly` uses `buildPreviewCall`; the `DALOS.UR_AccountStoa`
      call inside `getRenameDualLaneInfo` uses the registry's `namespace` export; new
      exports `buildRenameDualLanePreview`, `buildRevokeDualLinkPreview`,
      `RENAME_DUAL_LANE_KEY`, `REVOKE_DUAL_LINK_KEY` exist; `KADENA_NAMESPACE` import
      from `@ouronet/ouronet-core/constants` is gone from the file.
- [ ] `linkDualApiKey.ts`: `buildLinkDualApiKeyPactCode` and `getLinkDualApiKeyInfo`'s
      call use `buildCall`/`buildPreviewCall` respectively; new exports
      `buildLinkDualApiKeyPreview`, `LINK_DUAL_API_KEY_KEY` exist; `KADENA_NAMESPACE`
      import is gone.
- [ ] `deployApiKey.ts`: `buildDeployApiKeyPactCode`, `getDeployApiKeyInfoOnly`, and
      the INFO_ half of `getDeployApiKeyInfo`'s composite read use
      `buildCall`/`buildPreviewCall`; `getApiKeyRow`, `getApiKeySelectorData`,
      `getDualApiKeySelectorData`, `getPythiaPrices`, and the composite read's
      `DALOS.UR_AccountStoa` call use the registry's `namespace` export in place of
      `KADENA_NAMESPACE`, each with a comment noting it's not a registered
      entrypoint; new exports `buildDeployApiKeyPreview`, `DEPLOY_API_KEY_KEY` exist;
      `KADENA_NAMESPACE` import from `@ouronet/ouronet-core/constants` is gone.
- [ ] `RenameDualLaneModal.tsx`, `RevokeDualLinkModal.tsx`, `LinkDualApiKeyModal.tsx`,
      `ActivateApolloPythiaKeyModal.tsx` each replace their inline `pactCall={...}`
      template literal with a call to the corresponding new `buildXPreview` export;
      zero `ouronet-ns.` literals remain in these four files.
- [ ] `cd packages/codex-ouronet && npm run typecheck` passes.
- [ ] `cd packages/codex-ouronet && npm test` passes (existing suite, no regressions).

## Out of scope

- The verification test walking every exported key through `tryGetEntrypoint`, the
  settings UI surfaceHash/version display, and the empty-directory smoke check —
  all belong to `talos-registry-surfacing-verification`, planned after this topic
  and `talos-registry-codex-rotate-ops` both land (it needs their key constants too).
- `talos-registry-codex-rotate-ops` (StoicTag, Rotate Payment Key, `ouroSelectorReads.ts`,
  the two externally-delegated rotate-authority modals) — separate topic, disjoint
  files.
- Version bump / CHANGELOG / commit — closing step once all three topics land.
