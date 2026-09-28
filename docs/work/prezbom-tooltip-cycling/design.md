# prezbom-tooltip-cycling — Design

(Topic 3 of 3 in `docs/work/codex-tooltip-v2/design.md` — read that first for the full picture.)

## Problem

Two of Codex's launchers front a runtime choice `PreZbomHint` cannot resolve at hover time:
`SendStoaModal.tsx` picks `coin.C_Transfer` vs `coin.C_TransferAnew`, and `TransferUrStoaModal.tsx`
picks `coin.C_UR|Transfer` vs `coin.C_UR|TransferAnew`, both based on whether the receiver account
already exists on chain — unknowable when the button is merely hovered, before any receiver has been
typed. `PreZbomHint`'s `entrypoint` prop is a single `string` today; naming only one of the two real
possibilities describes a call the user might not actually make.

## Approach

Widen `PreZbomHint`'s (and `PreZbomTooltipCard`'s) `entrypoint` prop to `string | readonly string[]`.
Multiple keys cycle through a shared window every `CYCLE_MS` while the tooltip is open, with a
depletion bar and one dot per variant — mirroring OuronetUI's own `ExecutionHint.tsx` cycling state
machine (interval, slot, depletion progress), re-read fresh for this topic rather than from memory.

**A correction found by re-reading the reference just now, not carried over from an earlier round:**
the reference's own `CYCLE_MS` was recently changed from `3200` to `10_000` (10 seconds), dated
`2026-09-27` — today — with the owner's own reasoning inline: "Three seconds is not enough to finish
one variant, let alone compare it with the next, and a panel that changes while you are still reading
it is worse than one that does not change at all." This design uses `10_000`, the reference's CURRENT
value, not the stale `~3200ms` figure from an earlier round's handoff notes.

**How Codex's architecture makes this simpler than the reference's own implementation.** OuronetUI's
`ExecutionHint` hand-rolls its own `open` state, a `createPortal`-based absolute-positioned box, and
viewport placement math, because none of that comes for free in its stack. Codex's `PreZbomHint`
already sits on Radix's `Tooltip.Root`/`Portal` (via `ActionTooltip`), and Radix's own `Tooltip.Content`
is lazily mounted: `PreZbomTooltipCard` (the `content=` prop's element) is only actually rendered by
React while the tooltip is open, and unmounted when it closes (already the load-bearing assumption
several of this file's own existing doc comments and this package's on/off-gate test rely on).
That means **the cycling state machine does not need an `open` flag of its own at all** — a `useState`
initialized to slot `0` inside `PreZbomTooltipCard`, plus a `useEffect` that starts an interval on
mount and clears it on unmount, already gives "restart at slot 0 on every fresh hover" and "stop
cycling when closed" for free, simply because mount and unmount correspond exactly to open and close.
No `onOpenChange` plumbing, no portal, no placement math — Radix and this package's existing
`ActionTooltip`/`unstyled` support already own all of that.

**Rendering a slot.** `PreZbomTooltipCard` computes `keys` (the entrypoint prop normalized to an
array), then `activeKey = keys[Math.min(slot, keys.length - 1)]`, and renders EXACTLY the same body
this file already renders for a single entrypoint (the native-key branch or the registry-resolution
branch, unchanged), just parameterized by `activeKey` instead of a fixed prop. This is also what gives
the "gold/grey border flip" for free: the native branch already renders a 2px gold border and the
registry branch a plain 1px border, so a slot change whose native-ness differs from the previous slot
naturally flips the visible border color — no separate flip-detection logic needed, because the two
branches' existing distinct styling IS the signal. (For Codex's own 2 real cycling launchers, both
variants of each are entirely native, so this flip never visibly fires today — built generally per the
project design's own framing, not because either current launcher exercises it.)

A cycle footer (depletion bar + `N` dots, one gold when active) renders below the existing card content
only when `keys.length > 1` — a bare single-string `entrypoint` (every existing caller) renders zero
cycle UI and behaves byte-for-byte as it does today.

Wire the 2 launchers that actually front this choice:
- Send (`StoaAccountsTab.tsx`, plain-Stoa mode) → `entrypoint={["coin.C_Transfer", "coin.C_TransferAnew"]}`.
- Transfer UrStoa (`StoaAccountsTab.tsx`, UrStoa mode) → `entrypoint={["coin.C_UR|Transfer", "coin.C_UR|TransferAnew"]}`.

(Topic 2 wired these two launchers with a single representative key each; this topic replaces just
that one prop value on each of the same 2 call sites with the 2-element array — no other part of
topic 2's wiring changes.)

**Alternatives considered:**
- *Keep `CYCLE_MS` at the earlier-quoted `3200`.* Rejected: the reference's own current value is
  `10_000`, changed by the actual owner today with an explicit, considered reason; matching a stale
  number from an earlier round's notes over the live reference would repeat exactly the mistake this
  whole project's topic 1 was created to correct (trusting an earlier assumption instead of
  re-verifying against the current source).
- *Give `PreZbomTooltipCard` its own `open`/`onOpenChange` state, mirroring the reference's `open`
  flag literally.* Rejected: Radix's own lazy-mount already provides this for Codex's architecture;
  adding a redundant open flag would be unused complexity with no behavioral difference, since the
  component's mount lifecycle already IS the open/close signal here.
- *Detect native-ness flip explicitly and apply a dedicated "flip" animation/highlight.* Rejected: the
  native/registry branches' existing distinct border styling already IS the flip signal; a separate
  detection mechanism would duplicate information already expressed structurally.

## Acceptance criteria

- [ ] `PreZbomHint`/`PreZbomTooltipCard`'s `entrypoint` prop accepts `string | readonly string[]`; a
      bare string behaves byte-for-byte identically to today (no cycle footer, no behavior change) —
      every existing test in `zbom-prezbom-hint.test.tsx` passes unmodified.
- [ ] Given a 2-element array, the rendered card cycles between the two entrypoints' full bodies
      (native or registry, whichever each key resolves to) every `10_000`ms while mounted, restarting
      at slot 0 every time the component is freshly mounted (i.e. every fresh hover, given Radix's own
      lazy-mount).
- [ ] A cycle footer (depletion bar + one dot per variant, the active one highlighted) renders only
      when given more than one entrypoint key.
- [ ] Hovering "Send" (plain-Stoa mode) cycles `[coin.C_Transfer, coin.C_TransferAnew]`; hovering
      "Transfer" (UrStoa mode) cycles `[coin.C_UR|Transfer, coin.C_UR|TransferAnew]`.
- [ ] Full workspace typecheck + test green.

## Out of scope

- Any change to OuronetUI's own `ExecutionHint.tsx`/`ExecutionTooltip.tsx` — read-only reference.
- A dedicated flip ANIMATION or transition effect — the existing native/registry branch styling
  difference is the whole signal (see Approach).
- Any launcher besides Send/Transfer UrStoa — no other current Codex launcher fronts a
  runtime-resolved choice between multiple entrypoints.
