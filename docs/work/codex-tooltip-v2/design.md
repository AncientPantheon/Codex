# Codex tooltip v2 (final handoff) — Design

## Problem

A comprehensive follow-up handoff (post-registry-1.2.0) identified real gaps in the pre-ZBOM tooltip
feature, plus one genuine misdiagnosis in this session's own prior fix:

1. **Registry-side (v1.2.0) semantics not respected, and a wrong turn taken last round.** The registry now
   carries `ghost.use` tags for restricted parameters (`zbom`/`tooltip`/`display` per param — 6 of 423
   entrypoints, all `guard`-typed). Separately, this session's own prior round rebuilt the numbered argument
   list against the EXEC's own parameter list instead of the PREVIEW's, in direct response to a live
   complaint — but the handed-over reference implementation (OuronetUI's current, shipped
   `ExecutionTooltip.tsx`, extensively doc-commented) proves this was the wrong fix: previews differ from
   their execution in name/order/arity for 410 of 423 entrypoints, and binding by the exec's names instead
   of the preview's is the EXACT bug class ("`executor = <the pool id>`, `swpair = true`, `toggle = MISSING`
   for a call that was entirely correct") this whole feature exists to prevent. Confirmed live against the
   just-upgraded registry: the preview signatures for the two disputed entrypoints (`ReleaseStoicTag`,
   `RotateGuard`) are genuinely narrower than their execs even in 1.2.0 — the registry upgrade does not
   resolve the original complaint, because the complaint's diagnosis was the actual error, not the display.
   Also: a ghost value that is itself the literal sentinel string `"example"` isn't currently detected as a
   placeholder (only this codebase's OWN synthesized fallback is), and the live-read currently only skips
   when ALL args are placeholders, not when ANY is (the reference fires only when `ghostCount === 0`).

2. **Native STOA (`coin.*`) transfers have zero tooltip coverage.** `coin` is StoaChain's root-namespace
   contract — never in the Talos registry, by design, so there's no entrypoint key to resolve and no
   INFO/IGNIS preview. Codex's 5 Stoa/UrStoa launcher buttons (Send, Transfer UrStoa, Stake/Unstake/Collect
   UrStoa, all in `StoaAccountsTab.tsx`) currently have no `PreZbomHint` wrapping at all — they're outside
   this feature's original 11-launcher scope entirely.

3. **Two of those launchers front a runtime choice the tooltip can't resolve at hover time.** `SendStoaModal.tsx`
   and `TransferUrStoaModal.tsx` both pick between two entrypoints (`C_Transfer`/`C_TransferAnew`,
   `C_UR|Transfer`/`C_UR|TransferAnew`) at execution time, based on whether the receiver account already
   exists on chain — unknowable when the button is merely hovered. A tooltip naming only one is describing
   a call the user might not make.

## Approach

Three topics, built in dependency order (2 and 3 both build on 1's revised `PreZbomTooltipCard`):

1. **`prezbom-tooltip-registry-rebuild`** — upgrade `@ouronet/talos-registry` to 1.2.0 (done: installed via
   `npx npm@11`, since npm 9.2.0 in this repo cannot resolve the `@rollup/wasm-node` override — confirmed
   live, matches the handoff's own warning). Revert the numbered-argument-list to PREVIEW-param binding
   (matching the reference implementation exactly, including its "MISSING"/ghost-italic styling and the "the
   arguments above are this preview's" caption). Respect `ghost.use[param].display` (render this string
   verbatim instead of the raw value) and `ghost.use[param].tooltip` (default true; `false` means never
   render or read this param — treat as unresolved). Detect a ghost value that IS the literal string
   `"example"` as a placeholder, not a real value. Change the live-read gate from "ALL args placeholder" to
   "ANY arg placeholder" (matching the reference's `ghostCount === 0` condition exactly — stricter than this
   session's prior `allPlaceholder`).
2. **`codex-native-stoa-tooltips`** — hand-author `NATIVE_SPECS`-equivalent for all 9 `coin.*` signatures
   (verified line-for-line against `_onchain/Ouronet/0_Stoa/coin-contract/coin-live.pact`, not transcribed
   blind), with a source-re-reading verification test that skips visibly (not silently) when that sibling
   checkout is absent — mirrors OuronetUI's own `native-stoa-specs.test.ts` structure exactly. Extend
   `PreZbomHint`/`PreZbomTooltipCard` to accept a native spec directly (bypassing registry resolution
   entirely) with the gold 2px-border/"STOA NATIVE" header/no-IGNIS-footer treatment. Wire the 5 currently-
   uncovered Stoa/UrStoa launchers.
3. **`prezbom-tooltip-cycling`** — `PreZbomHint`'s `entrypoint` prop accepts `string | readonly string[]`;
   when given multiple, cycle through them every ~3200ms while hovered (depletion bar + one dot per variant,
   restart at slot 0 on every fresh hover, gold/grey border flip when a variant's native-ness differs from
   the previous one). Wire the 2 launchers that actually front this (Send → `[C_Transfer, C_TransferAnew]`;
   Transfer UrStoa → `[C_UR|Transfer, C_UR|TransferAnew]`), both entirely native so the "gold flip" won't
   visually fire for these two specifically (both variants are native) — the capability is still built
   generally, per the handoff's own framing ("if any of your buttons...").

**Alternatives considered:**
- *Keep round 7's exec-based display and just add a disambiguating caption.* Rejected: the reference
  implementation's own doc comments make clear this reintroduces a real, previously-shipped bug class
  (positional drift disguised as a "signature", not merely a stylistic difference) — not a matter of
  wording.
- *Hand-roll the cycling tooltip as OuronetUI did (a bespoke `createPortal`-based absolute-positioned div).*
  Rejected: Codex's `PreZbomHint` already sits on Radix's `Tooltip.Root`/`Portal` (via `ActionTooltip`), which
  already solves viewport clamping/z-index/lazy-mounting for free — the cycling STATE MACHINE (interval,
  slot, depletion progress) is the actual reusable logic from the reference; the positioning plumbing is not
  worth re-deriving when Radix already owns it correctly here.
- *Treat native specs as a special "entrypoint" string the registry-resolution code special-cases.*
  Rejected: `coin` will never be in the registry by design (root-namespace) — conflating "a registry key
  string" with "a hand-authored native spec" in one prop type invites exactly the confusion the reference
  file's own `specFor()` avoids by checking `NATIVE_SPECS` FIRST, before ever consulting the registry.

## Acceptance criteria

- [ ] A `ReleaseStoicTag`/`RotateGuard` hover shows the PREVIEW's own 2-param numbered list (not the exec's
      3-4), each labelled by the preview's own param name, with the exec's full signature still shown once,
      unlabelled, above it for reference — matching the reference implementation's exact layout.
- [ ] `RotateGuard`'s `new-guard` ghost value renders as `(read-keyset "ks")` — the registry's own `display`
      string — not a hand-derived guess, and not `[object Object]`.
- [ ] A ghost value that is the literal string `"example"` renders distinctly (grayed/italic, "no live
      example on chain") and does NOT fire a live read — even when other args in the same call have real
      values (any-placeholder blocks the whole read, not all-placeholder).
- [ ] Hovering "Send" (plain-Stoa mode) or "Transfer" (UrStoa mode) shows a cycling tooltip alternating
      between the two entrypoints that button's modal actually picks between at execution time, restarting
      at the first variant on every fresh hover.
- [ ] Hovering Stake/Unstake/Collect UrStoa shows a single, gold-bordered, "STOA NATIVE"-labelled tooltip
      with the correct hand-authored signature (verified against the deployed `coin` contract, not typed
      from memory) and an explicit "no IGNIS... costs native STOA gas" footer — no INFO/cost section at all.
- [ ] The native-spec verification test fails loudly on a deliberately-wrong parameter (proved by injection,
      matching the reference's own verification standard) and skips VISIBLY (a console warning, not a
      silent green) when the sibling Pact checkout is absent from this machine.
- [ ] Full workspace typecheck + test green across all three topics.

## Out of scope

- The registry's `oracle-guard` (`TS02-C3.AQP-DSA|C_SetOracleAuth`) — explicitly flagged "(not yours)" in
  the handoff; Codex has no launcher for it.
- Any change to `ExecutionTooltip.tsx`'s own wiring (still only Zone2Wrapper's signature-only header label,
  per the standing owner ruling) — this project only touches its shared `previewFormatting.ts` helpers where
  genuinely reusable, never its own execute-button-adjacent usage.
- OuronetUI itself — the handoff is explicit that "OuronetUI needs no change here" for guards, and Codex has
  no access to modify that repository regardless.
- A distinct "UrStoa card" UI concept, if OuronetUI has one — Codex's existing StoaAccountsTab layout for
  these 5 buttons is unchanged; only their tooltips are added.

## Topics

1. `prezbom-tooltip-registry-rebuild` — registry upgrade + revert to preview-param binding + ghost `use`
   tags + placeholder-sentinel detection + any-placeholder read-gating.
2. `codex-native-stoa-tooltips` — hand-authored, source-verified native specs + gold tooltip variant +
   wiring 5 launchers.
3. `prezbom-tooltip-cycling` — multi-entrypoint cycling tooltip + wiring the 2 launchers that need it.
