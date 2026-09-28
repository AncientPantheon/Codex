# codex-native-stoa-tooltips — Design

(Topic 2 of 3 in `docs/work/codex-tooltip-v2/design.md` — read that first for the full picture.)

## Problem

Codex's 5 Stoa/UrStoa launcher buttons (Send, Transfer UrStoa, Stake/Unstake/Collect UrStoa — all
in `packages/codex-ouronet/src/ui/tabs/StoaAccountsTab.tsx`) have zero `PreZbomHint` coverage today.
`coin` is StoaChain's own root-namespace contract — never in the Talos registry by design, since the
registry is generated exclusively from deployed `ouronet-ns` modules — so `tryGetEntrypoint` has
nothing to resolve for any of the 7 `coin.*` functions these 5 buttons actually call. Wrapping them
with `PreZbomHint` today (naively, without this topic's work) would render the existing "not on
chain" error card, which is actively wrong: these functions genuinely exist on chain, just outside
the registry's reach by construction, not because they're unknown.

## Approach

Hand-author `packages/codex-ouronet/src/zbom/cfm/nativeStoaSpecs.ts`, mirroring OuronetUI's own
`src/constants/nativeStoaSpecs.ts` structure: a `NATIVE_SPECS: Readonly<Record<string, NativeStoaSpec>>`
map keyed by the bare `coin.<Fn>` string (no `ouronet-ns.` prefix — `coin` is root-namespace, and that
absence is itself information the tooltip should show, not hide). Covers the 7 entrypoints Codex's 5
launchers actually call, each verified line-for-line against
`_onchain/Ouronet/0_Stoa/coin-contract/coin-live.pact` on this machine just now (re-read directly for
this design, not transcribed from an earlier round or from memory):

| key | signature | source line |
|---|---|---|
| `coin.C_Transfer` | `(sender receiver amount)` | coin-live.pact:583 |
| `coin.C_TransferAnew` | `(sender receiver receiver-guard amount)` | coin-live.pact:586 |
| `coin.C_UR\|Transfer` | `(sender receiver amount)` | coin-live.pact:1075 |
| `coin.C_UR\|TransferAnew` | `(sender receiver receiver-guard amount)` | coin-live.pact:1080 |
| `coin.C_URV\|Stake` | `(account urstoa-amount)` | coin-live.pact:1407 |
| `coin.C_URV\|Unstake` | `(account urstoa-amount)` | coin-live.pact:1439 |
| `coin.C_URV\|Collect` | `(account)` | coin-live.pact:1467 |

Both Transfer variants are hand-authored now for EACH of Send/Transfer-UrStoa, even though this
topic wires only one representative per launcher — topic 3 wires the cycling UI on top of these same
already-verified specs, so it never has to re-derive or re-verify a signature; it only adds the
cycling state machine.

`PreZbomTooltipCard` gains an `isNativeKey(entrypoint)` check at its very top — mirroring the
reference implementation's own `specFor()` pattern of checking `NATIVE_SPECS` FIRST, before ever
calling `tryGetEntrypoint`. No change to `PreZbomHintProps` at all: `entrypoint` stays a bare string;
a native key simply never reaches the registry-resolution branch, so every one of the 5 call sites in
`StoaAccountsTab.tsx` looks identical to a registry-backed launcher — the caller passes a string, full
stop, and never needs to know or care which kind it is.

When native, `PreZbomTooltipCard` renders an entirely separate body (still module-scope, still inside
the same `ActionTooltip`/Radix wiring topic 1 already fixed):
- 2px solid gold border (`#ceac5f`) replacing the default 1px border — the one visual signal that
  this is a different kind of call.
- A "STOA NATIVE" header label, replacing the registry-key display line (there is no registry key).
- The numbered param list, built directly from the hand-authored `signature`/`args` — a Kadena-shaped
  `k:...` example account (never an Ouronet glyph string — a glyph account in a `coin` call would
  teach a call shape that cannot work).
- No preview section, no IGNIS line, no live `pactRead` at all — natives are never priced by an
  `INFO_` reader and collect no IGNIS (Ouronet's own virtual gas). A footer instead: "no IGNIS — this
  costs native STOA gas, paid by the signer directly" (not gas-station sponsored).

A new test `packages/codex-ouronet/tests/zbom-native-stoa-specs.test.ts` mirrors OuronetUI's own
`native-stoa-specs.test.ts` exactly: re-reads the sibling `coin-live.pact` checkout (confirmed
resolving on this machine at
`../../../../../../OuroborosNetwork/_onchain/Ouronet/0_Stoa/coin-contract/coin-live.pact` relative to
`packages/codex-ouronet/tests/` — 6 levels up from `tests/` reaches the shared `ClaudeWS` parent that
both `AncientPantheon` and `OuroborosNetwork` sit under), parses every `(defun NAME:type (...))`
signature with the same regex, and fails loudly if any `NATIVE_SPECS` entry drifts from the deployed
source — skipping VISIBLY (a `console.warn`, not a silent green) when that sibling checkout is absent
from a given machine, via the same `HAVE_SOURCE` / `maybe = HAVE_SOURCE ? it : it.skip` pattern.

Wire the 5 currently-uncovered launchers — the DESKTOP button instances only (lines ~789-808 in
`StoaAccountsTab.tsx`) — with `PreZbomHint`:
- Send/Transfer (one mode-dependent button/slot) → `entrypoint={mode === "urstoa" ? "coin.C_UR|Transfer" : "coin.C_Transfer"}`
  (single representative this topic; topic 3 upgrades this one call site to the cycling
  `[coin.C_Transfer, coin.C_TransferAnew]` / `[coin.C_UR|Transfer, coin.C_UR|TransferAnew]` array).
- Stake UrStoa → `entrypoint="coin.C_URV|Stake"`.
- Unstake UrStoa → `entrypoint="coin.C_URV|Unstake"`.
- Collect UrStoa → `entrypoint="coin.C_URV|Collect"`.

A wrinkle discovered while locating these 4 call sites: unlike every other current `PreZbomHint`
caller (which wraps a bare button with no pre-existing tooltip), these 4 desktop buttons are each
ALREADY wrapped in their own plain `<ActionTooltip content="...">` carrying a friendly, sometimes
LIVE-BALANCE-DEPENDENT description (e.g. `` `Stake your liquid UrStoa into the vault. ${fmt12(urBal?.balance ?? 0)} UrStoa available.` ``
) — information `PreZbomTooltipCard` has no way to reconstruct on its own, and which nesting a second
Radix `Tooltip.Root` inside/around would risk two competing popups on one hover. Rather than deleting
that live context or double-nesting, `PreZbomHintProps` gains one new optional prop:
`description?: React.ReactNode` (threaded straight through to `PreZbomTooltipCard`), rendered at the
top of the SAME card, above the entrypoint/native section, in a lighter/smaller style — replacing
each button's standalone `ActionTooltip` wrapper with `PreZbomHint`'s own (single Radix root, no
nesting), so the existing descriptive text survives verbatim alongside the new technical section.
This is additive and optional — every one of topic 1's existing callers is unaffected (prop omitted,
nothing renders where the description would go).

The mobile-specific duplicate button instances further down the same file (the `leftEdgeStack`/
`rightEdgeStack` blocks, each already wrapped in their own plain `ActionTooltip`) are explicitly
UNCHANGED — see Out of scope.

**Alternatives considered:**
- *Add a separate `nativeSpec` prop to `PreZbomHint` instead of overloading `entrypoint`.* Rejected:
  forces every one of the 5 call sites to branch between two different prop shapes depending on
  whether they're native. A single `entrypoint: string` + internal `isNativeKey()` check (matching
  the reference's own design) means every call site looks identical regardless of native-ness.
- *Extend the Talos registry itself to include `coin.*`.* Rejected: `coin` is StoaChain's own
  root-namespace contract, not part of `ouronet-ns` — the registry is generated exclusively from
  deployed `ouronet-ns` modules and will never include it, by design (already out of scope in the
  project's own design.md).
- *Skip the source-verification test, since this is a one-time hand-transcription.* Rejected: a
  hand-written signature with no check is exactly the class of bug the registry was built to end;
  not reintroducing it here is the entire reason OuronetUI's own reference file has this test at all.

## Acceptance criteria

- [ ] Hovering each of the 5 currently-uncovered launchers (Send, Transfer UrStoa, Stake, Unstake,
      Collect UrStoa) in `StoaAccountsTab.tsx` shows a gold-bordered, "STOA NATIVE"-labelled tooltip
      with the correct hand-authored signature.
- [ ] The native tooltip has no INFO/cost-preview section and no IGNIS line at all, and explicitly
      states native STOA gas is paid by the signer (not gas-station sponsored).
- [ ] The tooltip's example account is Kadena-shaped (`k:...`), never an Ouronet glyph string.
- [ ] `zbom-native-stoa-specs.test.ts` fails loudly when a `NATIVE_SPECS` signature is deliberately
      mismatched against the real contract (proved by injection), and skips VISIBLY (a console
      warning, not a silent green) when the sibling Pact checkout is absent from this machine.
- [ ] A registry-resolvable (non-native) entrypoint's tooltip is completely unaffected — the
      native-key check adds a branch ahead of the existing registry-resolution path, it does not
      alter that path at all (topic 1's tests still pass unmodified).
- [ ] Each of the 4 desktop button instances' existing live-balance-aware descriptive text (Stake/
      Unstake/Collect's `fmt12(...)`-formatted figures, Send/Transfer's mode caption) still appears
      in its tooltip, now alongside the new technical native section, via the new `description` prop
      — not lost, not double-tooltipped.
- [ ] Full workspace typecheck + test green.

## Out of scope

- The cycling UI itself (multi-entrypoint `entrypoint` prop, depletion bar, border-flip) — topic 3.
- `coin.C_Transmit`/`coin.C_UR|Transmit` (cross-chain transmit) — confirmed via grep, Codex has no
  cross-chain STOA launcher UI at all; only same-chain Transfer/TransferAnew are wired to any button.
- `coin.C_CreateAccount`/`coin.C_UR|CreateAccount`/`coin.C_RotateAccount`/`coin.C_UR|RotateAccount` —
  confirmed via grep, no Codex launcher calls these directly (TransferAnew's own on-chain semantics
  handle receiver-account creation internally; Codex never calls a bare CreateAccount/RotateAccount).
- Any change to OuronetUI's own `nativeStoaSpecs.ts`/`native-stoa-specs.test.ts` — read-only reference,
  never edited from this repo.
- The mobile-specific duplicate Stake/Unstake/Collect/Send/Transfer button instances in
  `StoaAccountsTab.tsx`'s `leftEdgeStack`/`rightEdgeStack` blocks — `PreZbomHint` already no-ops to
  bare children on mobile (no hover affordance exists to trigger it), so wrapping these would silently
  DELETE their existing `ActionTooltip` descriptive text for a net loss, not a gain. Left untouched.
