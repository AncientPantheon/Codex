# C4 Lift Proof Notes

Read-only confirmation and scope-boundary record for the Codex lift from
`@stoachain/ouronet-codex` (stoa-js monorepo) into `@ancientpantheon/codex-ouronet`
(this monorepo). No source file was modified to produce this record; the stoa-js
tree was inspected read-only.

## NO-SHIM decision (C-08 / N-02, strangler-fig)

No compatibility shim ships in this program.

- The old package `@stoachain/ouronet-codex@0.5.7` stays **frozen and published**
  on npm. It is not re-exported, aliased, or wrapped.
- The new package `@ancientpantheon/codex-ouronet` is **private and unpublished**
  (`"private": true`, version `0.0.1`). It does not claim the old package name and
  ships no re-export bridge or alias package pointing back at it.
- Consumer migration (OuronetUI, AncientHoldings, future apps switching their
  imports from `@stoachain/ouronet-codex` to `@ancientpantheon/codex-ouronet`) is
  a **later phase**, performed just-in-time per consumer, and is **out of scope**
  here. The strangler-fig approach keeps both packages independently resolvable
  until each consumer is migrated on its own schedule.

Consequence: there is no runtime coupling between old and new during this program.
The old package's live consumers keep resolving the old artifact exactly as before
the lift.

## BOUNDED-PROOF honesty (CI-004)

The lift proof is deliberately **bounded**. It is the union of two things, and
nothing more:

1. **C3's GREEN 52-file suite** — the behaviors the SOURCE test suite covers,
   now executed against the **REGISTRY dist** of the @stoachain triplet
   (`ouronet-core`/`kadena-stoic-legacy`/`stoa-core` `4.3.6`, `dalos-crypto`
   `4.0.3`), NOT against a source-linked build. This re-verifies the source-suite
   behaviors against the published dependency dist the new package will actually
   resolve.
2. **C4's STRUCTURAL surface guards** — the 12-module public-export surface plus
   the `./ui.css` subpath; the hook inventory; the four singular invariants; and
   the frozen `"1.2"` codec-version gate. These pin the SHAPE of the public API,
   not the runtime behavior behind every entry point.

**Explicit boundary.** Behaviors exercised **solely** by the live consumers
(OuronetUI, AncientHoldings) and **not** covered by the 52 unit tests are
**SHAPE-verified only** — their public surface is confirmed present and correctly
typed, but their runtime behavior is **not** behaviorally re-verified against the
registry dist here. Full behavioral parity for those consumer-only behaviors is
established at **CONSUMER MIGRATION** (out of scope for this program).

Do NOT read "green suite + structural guards" as an unbounded, whole-package
behavioral proof. It is bounded to (1) the source-suite behaviors and (2) the
structural surface. Consumer-only behavior beyond that surface is deferred.

### No registry-version-drift signal to adjudicate

C3's green suite recorded **zero** cross-package registry-version-drift signals:
after the React-dedupe harness fix, the suite went fully green against the
registry dist (`4.3.6` / `4.0.3`). There is therefore **no (b)-class drift**
(a behavioral divergence caused by the registry dependency versions differing
from the source-linked build) to adjudicate in these notes.

## OLD PACKAGE UNTOUCHED — confirmation evidence (C-08)

Read-only inspection of `D:/_Claude/StoaOuronet/stoa-js/packages/ouronet-codex/`.
The lift was a **one-way COPY** into this monorepo; C2 never wrote under stoa-js.

- **Version:** `@stoachain/ouronet-codex` is at `"version": "0.5.7"` — unchanged.
- **Manifest intact:** the `exports` map still declares its full public surface —
  12 module subpaths (`.`, `./adapters`, `./provider`, `./hooks`, `./components`,
  `./resolver`, `./errors`, `./codex-identity`, `./ui`, `./types`,
  `./google-drive`, `./zbom`) plus the `./ui.css` asset subpath. `main`, `types`,
  `files`, `peerDependencies`, and `publishConfig` are unchanged.
- **Working tree clean:** `git status --short packages/ouronet-codex/` in the
  stoa-js repo reports **0 changed lines**. The last commit touching its
  `package.json` is `a353d9b` (2026-06-20, "codex 0.5.7: absolute
  (non-sliding) codex unlock window") — this **predates the lift**, confirming
  the lift produced no write under stoa-js.

No evidence of mutation. PASS.

## TWO LIVE CONSUMERS still resolve the old package

Neither consumer was re-pointed by the lift. Both still declare and resolve
`@stoachain/ouronet-codex`.

| Consumer | package.json path | Declared range | Resolved in node_modules |
|---|---|---|---|
| OuronetUI | `D:/_Claude/StoaOuronet/OuronetUI/package.json` | `^0.5.7` | `0.5.7` |
| AncientHoldings | `D:/_Claude/StoaOuronet/AncientHoldings/package.json` | `^0.5.5` | `0.5.5` |

- OuronetUI resolves `node_modules/@stoachain/ouronet-codex` → `0.5.7` (satisfies
  `^0.5.7`).
- AncientHoldings resolves `node_modules/@stoachain/ouronet-codex` → `0.5.5`
  (satisfies its declared `^0.5.5`; not yet bumped to `0.5.7` — its own
  independent schedule, untouched by the lift).

The key claim holds: **the lift did not re-point either consumer.** Both continue
to depend on the frozen `@stoachain/ouronet-codex`, not on
`@ancientpantheon/codex-ouronet`.
