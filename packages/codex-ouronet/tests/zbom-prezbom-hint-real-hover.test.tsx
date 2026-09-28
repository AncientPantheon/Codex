/**
 * PreZbomHint — REAL hover, through the REAL `ActionTooltip` (Radix), wrapping
 * one of this package's own non-forwarding button components (`GreenBtn`).
 *
 * Every other `PreZbomHint`/`PreZbomTooltipCard` test in this suite
 * (`zbom-prezbom-hint.test.tsx`) deliberately mocks `ActionTooltip` with a
 * simple always-visible passthrough — correct for testing the on/off/mobile
 * GATE and the card's own content, but it means none of those tests ever
 * exercised Radix's REAL `Tooltip.Trigger asChild` hover mechanism at all.
 *
 * That gap is exactly how this bug shipped: `GoldenBtn`/`VioletBtn`/`GreenBtn`
 * (`ui/internal/accountFields.tsx`) are plain functions with a fixed, narrow
 * prop signature and no `...rest` spread — `asChild` clones its child and
 * injects the ref + hover event handlers directly onto it, so for these three
 * components every Radix-injected prop landed as an unrecognized extra prop
 * and was silently dropped before reaching the real `<button>`. Confirmed
 * live: hovering a launcher built on `GreenBtn` (Release StoicTag) never
 * showed anything at all. Fixed by wrapping `children` in a plain `<span>`
 * inside `PreZbomHint` before handing off to `ActionTooltip`, so Radix always
 * has a real host element to attach to regardless of what the caller passes.
 *
 * This file is the regression lock: real `ActionTooltip`, real `GreenBtn`.
 * jsdom cannot reliably drive Radix's full hover-intent-to-open animation
 * (confirmed by hand: even WITH the fix, a synthetic `fireEvent.pointerEnter`
 * does not flip `Tooltip.Content` to open within jsdom — a known environment
 * limitation, not a live-app behavior), so this asserts the one signal that
 * IS reliable and IS the actual root-cause distinction: whether Radix's own
 * `data-state` attribute (its trigger-wiring marker, injected via `asChild`'s
 * `cloneElement`) lands on the rendered element at all. Before the fix it
 * never appeared anywhere in the DOM (Radix's cloned props were silently
 * dropped by `GreenBtn`'s fixed prop signature); after the fix it appears on
 * the wrapping `<span>` — proving Radix actually controls a real host element
 * now, which is the precondition the open transition depends on.
 */
import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { setPactReader } from "@stoachain/stoa-core/reads";
import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import PreZbomHint from "../src/zbom/cfm/PreZbomHint.js";
import { GreenBtn } from "../src/ui/internal/accountFields.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mkWrapper(adapter: MemoryCodexAdapter) {
  return ({ children }: { children: React.ReactNode }) => (
    <CodexProvider adapter={adapter}>{children}</CodexProvider>
  );
}

describe("PreZbomHint — real Radix wiring through a non-forwarding button component (GreenBtn)", () => {
  it("Radix's own data-state trigger marker lands on a real element in the rendered tree — proving asChild actually attached, not silently dropped", async () => {
    setPactReader(vi.fn().mockResolvedValue({ result: { status: "success", data: null } }));
    const adapter = new MemoryCodexAdapter("dev");

    const { container } = render(
      <PreZbomHint entrypoint="TS01-C4.CODEX|C_ReleaseStoicTag">
        <GreenBtn icon={null} label="Release StoicTag" onClick={() => {}} />
      </PreZbomHint>,
      { wrapper: mkWrapper(adapter) },
    );

    // The button itself renders regardless.
    expect(await screen.findByText("Release StoicTag")).toBeTruthy();

    // Radix's `Tooltip.Trigger asChild` injects `data-state` onto whatever
    // element it successfully cloned onto. If `GreenBtn` swallowed the
    // injected props (the actual bug — its fixed prop signature has no
    // `...rest` spread), NOTHING in the rendered tree would carry this
    // attribute at all. The wrapping `<span>` this fix adds is what gives
    // Radix a real host element to attach to instead.
    const stateCarrier = container.querySelector("[data-state]");
    expect(
      stateCarrier,
      "no element in the tree carries Radix's data-state attribute — asChild's injected props were dropped",
    ).not.toBeNull();
    expect(stateCarrier?.tagName).toBe("SPAN");
    expect(stateCarrier?.getAttribute("data-state")).toBe("closed");

    // The real <button> itself must NOT carry it — proving the fix routes
    // Radix's wiring around GreenBtn's fixed signature, not through it.
    const button = screen.getByText("Release StoicTag").closest("button");
    expect(button?.hasAttribute("data-state")).toBe(false);
  });
});
