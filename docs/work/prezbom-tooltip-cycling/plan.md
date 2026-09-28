## Wave 1
- [x] T1: Widen `entrypoint` to `string | readonly string[]` and add the cycling state machine to
  `PreZbomTooltipCard`, reusing the existing native/registry render bodies unchanged, parameterized
  by the currently-active key.
  - In `packages/codex-ouronet/src/zbom/cfm/PreZbomHint.tsx`:
    - Add `const CYCLE_MS = 10_000;` near the top (module scope) with a comment citing that this
      matches OuronetUI's own CURRENT `ExecutionHint.tsx` value (re-read live for this topic — raised
      from an earlier `3200`, dated `2026-09-27`, with the owner's own reasoning: a panel that changes
      while still being read is worse than one that doesn't change at all).
    - Change `PreZbomTooltipCard`'s prop type: `entrypoint: string | readonly string[]` (was
      `string`). Same widening for the exported `PreZbomHintProps.entrypoint`.
    - At the top of `PreZbomTooltipCard`'s body, before the existing `native`/`ep` logic: compute
      `const keys = Array.isArray(entrypoint) ? entrypoint : [entrypoint];` (a bare string becomes a
      1-element array — every existing call site keeps working unchanged), then
      `const [slot, setSlot] = useState(0);` and `const [cycleProgress, setCycleProgress] = useState(0);`
      and `const cycles = keys.length > 1;`. Add a `useEffect` keyed on
      `[cycles, keys.length]` (NOT on `keys` itself — an inline array literal like
      `entrypoint={["coin.C_Transfer", "coin.C_TransferAnew"]}` is a fresh identity every render,
      the same trap #2 `usePreZbomPreview` already avoids elsewhere in this file) that does nothing
      when `!cycles`, otherwise runs a `setInterval` on a `STEP = 120` ms tick advancing
      `cycleProgress` and, once `elapsed >= CYCLE_MS`, resets `elapsed` to 0 and
      `setSlot(i => (i + 1) % keys.length)` — mirrors the reference's own interval shape exactly
      (`ExecutionHint.tsx`'s own cycling effect, re-read for this topic). Clears the interval on
      cleanup. NO `open`/`onOpenChange` state anywhere — `PreZbomTooltipCard` is only ever rendered
      by React while Radix's `Tooltip.Content` is actually open (the existing, already-relied-upon
      lazy-mount assumption elsewhere in this file), so `useState(0)`'s initial value already gives
      "restart at slot 0 on every fresh hover", and unmount already clears the interval via the
      effect's own cleanup — no extra plumbing needed.
    - Compute `const activeKey = keys[Math.min(slot, keys.length - 1)];` and use `activeKey`
      EVERYWHERE the function body currently uses the (now-removed) single `entrypoint` string
      parameter: the `isNativeKey`/`NATIVE_SPECS` lookup, `tryGetEntrypoint`, `buildMergedPreviewValues`,
      `usePreZbomPreview`, `warnUnknownEntrypointOnce`, and every rendered occurrence of the key
      itself (the `{entrypoint}`/`{activeKey}` display line). The native/registry branch bodies
      themselves are UNCHANGED — only the variable they're parameterized by changes name/source.
    - After the existing card's closing `</div>` (both the native and the registry-resolution
      branches' returned JSX), append a cycle footer, rendered only `{cycles && (...)}`: a 2px-tall
      depletion bar (`backgroundColor: "#1a1a1a"` track, inner bar `backgroundColor: "#ceac5f"`,
      `width: \`${Math.max(0, Math.min(1, 1 - cycleProgress)) * 100}%\``, `transition: "width 120ms linear"`),
      then a row with caption text `this button offers {keys.length} executions` (small, muted) and
      `keys.length` dots (`5px` circles, gold `#ceac5f` for `i === slot`, dim `#333` otherwise) —
      mirrors the reference's own cycle-indicator block structurally (re-read for this topic), adapted
      to sit inside this file's existing unstyled card rather than a separate portal panel.
    - Since both the native and registry branches currently `return` their own JSX directly, restructure
      minimally: extract the cycle footer into a small module-scope helper,
      `function CycleFooter({ keys, slot, cycleProgress }: { keys: readonly string[]; slot: number; cycleProgress: number })`,
      and call `{cycles && <CycleFooter keys={keys} slot={slot} cycleProgress={cycleProgress} />}` as
      the last child inside EACH branch's existing wrapping `<div>` (native card's div, registry
      card's div, and the two error-path divs — `!ep`/unknown-entrypoint — do NOT get a footer, since
      an unresolvable key mid-cycle is already a degenerate case topic 1/2 never had to handle single-
      key either; leaving it un-cycled there is acceptable and out of scope to special-case further).
  - In `packages/codex-ouronet/tests/zbom-prezbom-hint.test.tsx`, add (new `describe` block):
    - Every existing test in this file passes UNMODIFIED (bare-string `entrypoint=` callers are
      unaffected) — this is itself a done-when check, not a new test.
    - `render(<PreZbomTooltipCard entrypoint={["coin.C_URV|Stake", "coin.C_URV|Collect"]} />)`: asserts
      `container.textContent` contains `"this button offers 2 executions"`, and contains EXACTLY ONE
      of `"coin.C_URV|Stake"` / `"coin.C_URV|Collect"` at a time (slot starts at 0 — assert
      `screen.getByText("coin.C_URV|Stake")` present and `screen.queryByText("coin.C_URV|Collect")`
      absent immediately after mount, i.e. before any timer advances).
    - Using `vi.useFakeTimers()`: render the same 2-key card, `vi.advanceTimersByTime(10_000)`, assert
      the card now shows `"coin.C_URV|Collect"` and no longer shows `"coin.C_URV|Stake"` — proves one
      full cycle advances the slot. `vi.useRealTimers()` in an `afterEach` or at the test's end.
    - `render(<PreZbomTooltipCard entrypoint="coin.C_URV|Stake" />)` (bare string, unchanged from
      topic 2's own test): asserts `container.textContent` does NOT contain `"executions"` — no cycle
      footer for a single key.
    - Mount/unmount test: render the 2-key card, advance timers partway (e.g. 5000ms, NOT a full
      cycle), unmount via `cleanup()` (or `rerender` to a different tree), render a FRESH instance of
      the same 2-key card again, assert it shows the FIRST key again (`"coin.C_URV|Stake"`) — proves a
      fresh mount always restarts at slot 0, regardless of where a prior instance's cycle had reached.
  - done when:
    - `npx vitest run tests/zbom-prezbom-hint.test.tsx` — all new + all pre-existing tests in this
      file pass; `npx tsc --noEmit` clean.
  - files: `packages/codex-ouronet/src/zbom/cfm/PreZbomHint.tsx`, `packages/codex-ouronet/tests/zbom-prezbom-hint.test.tsx`

## Wave 2 (depends on Wave 1)
- [x] T2: Wire Send and Transfer UrStoa in `StoaAccountsTab.tsx` to their real 2-entrypoint arrays,
  and update the launcher-coverage test's one affected entry to match.
  - In `packages/codex-ouronet/src/ui/tabs/StoaAccountsTab.tsx`:
    - Change the Send/Transfer `PreZbomHint`'s `entrypoint=` prop (currently
      `entrypoint={isUrstoaMode ? "coin.C_UR|Transfer" : "coin.C_Transfer"}`, wired in topic 2) to
      `entrypoint={isUrstoaMode ? ["coin.C_UR|Transfer", "coin.C_UR|TransferAnew"] : ["coin.C_Transfer", "coin.C_TransferAnew"]}`
      — nothing else about that call site (the `description=` prop, the wrapped `<button>`) changes.
  - In `packages/codex-ouronet/tests/zbom-prezbom-launcher-coverage.test.ts`:
    - Update the `stoa` Send/Transfer entry in `EXPECTED_OPEN_CALLS` from
      `expectedEntrypoints: ["coin.C_UR|Transfer", "coin.C_Transfer"]` to
      `expectedEntrypoints: ["coin.C_UR|Transfer", "coin.C_UR|TransferAnew", "coin.C_Transfer", "coin.C_TransferAnew"]`
      — `extractEntrypointValues`'s existing bare `/"([^"]+)"/g` scan already extracts every quoted
      literal inside the `entrypoint={...}` braces left-to-right regardless of array/ternary nesting,
      so no change to the test HELPER is needed, only this one entry's expected list (the positional,
      non-sorted comparison fixed in topic 2's review is what makes this update meaningful rather than
      vacuous).
  - done when:
    - `npx vitest run tests/zbom-prezbom-launcher-coverage.test.ts tests/zbom-prezbom-hint.test.tsx`
      passes.
    - `npx tsc --noEmit` clean; full `packages/codex-ouronet` suite green (`npx vitest run`).
    - Full workspace `npm run typecheck` (root) clean.
    - Deliberate-break check (run, observe RED, revert): temporarily swap the two array elements in
      ONE branch of the `StoaAccountsTab.tsx` ternary (e.g. reverse `["coin.C_Transfer", "coin.C_TransferAnew"]`
      to `["coin.C_TransferAnew", "coin.C_Transfer"]`), re-run the coverage test, confirm it fails
      naming the mismatch, then revert and confirm green again — proves the positional comparison
      from topic 2's review genuinely covers this 4-literal case too, not just the 2-literal one it
      was fixed for.
  - files: `packages/codex-ouronet/src/ui/tabs/StoaAccountsTab.tsx`, `packages/codex-ouronet/tests/zbom-prezbom-launcher-coverage.test.ts`
