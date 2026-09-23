/**
 * useSnapScrollCorrection — the JS-enforced backstop guaranteeing a
 * scrollable list always comes to rest with a WHOLE row at both edges
 * (docs/work/codex-ui-mobile/design.md §8, reiterated across multiple
 * rounds, most recently round 8: "no more incomplete viewing of entries on
 * the list... this must be done everywhere"). CSS `scroll-snap-type:
 * mandatory` is the first line of defense; this hook is the guarantee on
 * top for platforms where the native re-snap doesn't reliably fire after a
 * momentum fling settles.
 *
 * jsdom never resolves real layout, so these specs drive the hook by
 * overriding `getBoundingClientRect` directly on specific elements — the
 * SAME technique already used elsewhere in this codebase for
 * layout-dependent behavior that can't rely on jsdom's real (always-zero)
 * measurements.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";
import { useSnapScrollCorrection } from "../src/ui/mobile/useSnapScrollCorrection.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function rect(top: number, bottom: number): DOMRect {
  return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
}

/** jsdom's `scrollTop`/`scrollHeight`/`clientHeight` all read 0 by default
 *  (no real layout) — the hook now uses them to decide whether a candidate
 *  correction is actually reachable (not clamped by the scroll bounds), so
 *  every spec needs to stub in a plausible geometry. Defaults here are
 *  generous (room to scroll a good way in either direction) — specs
 *  testing the CLAMPING behavior itself override `scrollTop`/`scrollHeight`
 *  explicitly. */
function mockScrollGeometry(
  el: HTMLElement,
  { scrollTop = 500, scrollHeight = 2000, clientHeight = 250 }: { scrollTop?: number; scrollHeight?: number; clientHeight?: number } = {},
) {
  Object.defineProperty(el, "scrollTop", { value: scrollTop, configurable: true });
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
}

function Harness({ rowRects }: { rowRects: [number, number][] }) {
  const ref = useSnapScrollCorrection<HTMLDivElement>();
  return (
    <div ref={ref} data-testid="scroller" style={{ height: 300, overflowY: "auto" }}>
      {rowRects.map((r, i) => (
        <div key={i} data-snap-row data-row-index={i} style={{ height: r[1] - r[0] }} />
      ))}
    </div>
  );
}

describe("useSnapScrollCorrection", () => {
  it("corrects a row straddling the BOTTOM edge by scrolling it fully into view when that's the smaller move", async () => {
    vi.useFakeTimers();
    render(<Harness rowRects={[[0, 100], [100, 200], [200, 280]]} />);
    const scroller = screen.getByTestId("scroller");
    scroller.getBoundingClientRect = () => rect(0, 250);
    mockScrollGeometry(scroller);
    const rows = Array.from(scroller.querySelectorAll("[data-snap-row]")) as HTMLElement[];
    rows[0].getBoundingClientRect = () => rect(0, 100);
    rows[1].getBoundingClientRect = () => rect(100, 200);
    // Row 2 straddles the container's bottom edge (250): top=200 (< 250),
    // bottom=280 (> 250). Fully revealing it costs 30 (280-250); fully
    // hiding it costs 50 (250-200) — revealing is cheaper.
    rows[2].getBoundingClientRect = () => rect(200, 280);

    const scrollBy = vi.fn();
    scroller.scrollBy = scrollBy;

    fireEvent.scroll(scroller);
    vi.advanceTimersByTime(150);

    expect(scrollBy).toHaveBeenCalledWith({ top: 30, behavior: "auto" });
  });

  it("corrects a row straddling the TOP edge by scrolling it fully out of view when that's the smaller move", async () => {
    vi.useFakeTimers();
    render(<Harness rowRects={[[0, 100], [100, 200], [200, 280]]} />);
    const scroller = screen.getByTestId("scroller");
    scroller.getBoundingClientRect = () => rect(0, 250);
    mockScrollGeometry(scroller);
    const rows = Array.from(scroller.querySelectorAll("[data-snap-row]")) as HTMLElement[];
    // Row 0 straddles the container's top edge (0): top=-40 (< 0), bottom=60 (> 0).
    // Fully revealing it costs 40 (0-(-40)); fully hiding it costs 60 (60-0) —
    // revealing is cheaper, scrolled UP (negative delta).
    rows[0].getBoundingClientRect = () => rect(-40, 60);
    rows[1].getBoundingClientRect = () => rect(60, 160);
    rows[2].getBoundingClientRect = () => rect(160, 240);

    const scrollBy = vi.fn();
    scroller.scrollBy = scrollBy;

    fireEvent.scroll(scroller);
    vi.advanceTimersByTime(150);

    expect(scrollBy).toHaveBeenCalledWith({ top: -40, behavior: "auto" });
  });

  it("does nothing once every row already sits cleanly within the container's edges", async () => {
    vi.useFakeTimers();
    render(<Harness rowRects={[[0, 100], [100, 200]]} />);
    const scroller = screen.getByTestId("scroller");
    scroller.getBoundingClientRect = () => rect(0, 250);
    mockScrollGeometry(scroller);
    const rows = Array.from(scroller.querySelectorAll("[data-snap-row]")) as HTMLElement[];
    rows[0].getBoundingClientRect = () => rect(0, 100);
    rows[1].getBoundingClientRect = () => rect(100, 200);

    const scrollBy = vi.fn();
    scroller.scrollBy = scrollBy;

    fireEvent.scroll(scroller);
    vi.advanceTimersByTime(150);

    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("prefers the innermost marked row over a marked ANCESTOR that also straddles an edge — the ancestor being oversized excludes it outright (see the dedicated spec below), so the ordinary-sized inner row wins by being the only real candidate at all, not merely 'the smaller of two options'", async () => {
    vi.useFakeTimers();
    // A custom harness (not the shared `Harness` above) so we control the
    // nesting directly: an OUTER marked box (the "group card", much
    // taller, ALSO straddling the bottom edge) wrapping an INNER marked
    // row (the actual entry at that edge) — the correction must target the
    // inner row's much smaller delta, not the outer box's huge one.
    function NestedHarness() {
      const ref = useSnapScrollCorrection<HTMLDivElement>();
      return (
        <div ref={ref} data-testid="scroller" style={{ height: 300, overflowY: "auto" }}>
          <div data-snap-row data-testid="outer-group">
            <div data-snap-row data-testid="inner-row-a" />
            <div data-snap-row data-testid="inner-row-b" />
          </div>
        </div>
      );
    }
    render(<NestedHarness />);
    const scroller = screen.getByTestId("scroller");
    scroller.getBoundingClientRect = () => rect(0, 250);
    mockScrollGeometry(scroller);
    // The outer group spans almost the whole scroller and straddles the
    // bottom edge by a LOT (needs a 400px correction either way).
    screen.getByTestId("outer-group").getBoundingClientRect = () => rect(-100, 650);
    screen.getByTestId("inner-row-a").getBoundingClientRect = () => rect(-100, 0);
    // The inner row at the actual edge — ordinary, viewport-sized (210px,
    // well under the 250px container) — only needs a small 10px correction.
    screen.getByTestId("inner-row-b").getBoundingClientRect = () => rect(50, 260);

    const scrollBy = vi.fn();
    scroller.scrollBy = scrollBy;

    fireEvent.scroll(scroller);
    vi.advanceTimersByTime(150);

    // Fully revealing inner-row-b costs 10 (260-250); fully hiding it costs
    // 200 (250-50) — revealing wins, and it's far smaller than anything the
    // outer group could offer (400 either way) or would even be considered
    // for at all (the outer group is skipped outright — see the dedicated
    // oversized-element spec below).
    expect(scrollBy).toHaveBeenCalledWith({ top: 10, behavior: "auto" });
  });

  it("corrects with an INSTANT jump (behavior: 'auto'), not an animated one — owner-reported live bug: 'scrolling scrolls me back, it doesnt keep' (an earlier smooth-scroll version's own resulting scroll events fired throughout its animation, re-arming the debounce and re-correcting off a not-yet-settled intermediate position, fighting itself)", async () => {
    vi.useFakeTimers();
    render(<Harness rowRects={[[0, 100], [100, 200], [200, 280]]} />);
    const scroller = screen.getByTestId("scroller");
    scroller.getBoundingClientRect = () => rect(0, 250);
    mockScrollGeometry(scroller);
    const rows = Array.from(scroller.querySelectorAll("[data-snap-row]")) as HTMLElement[];
    rows[0].getBoundingClientRect = () => rect(0, 100);
    rows[1].getBoundingClientRect = () => rect(100, 200);
    rows[2].getBoundingClientRect = () => rect(200, 280);

    const scrollBy = vi.fn();
    scroller.scrollBy = scrollBy;

    fireEvent.scroll(scroller);
    vi.advanceTimersByTime(150);

    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }));
  });

  it("at the very top of the list (scrollTop already 0), never picks the 'hide it by scrolling further up' option — that's impossible (clamped), even when it's numerically smaller — owner-reported live bug: 'if i scroll on the very top, it still show a remnant on the last position'", async () => {
    vi.useFakeTimers();
    render(<Harness rowRects={[[0, 100], [100, 200], [200, 280]]} />);
    const scroller = screen.getByTestId("scroller");
    scroller.getBoundingClientRect = () => rect(0, 250);
    // Already at the very top — no room to scroll up further at all.
    mockScrollGeometry(scroller, { scrollTop: 0, scrollHeight: 1000, clientHeight: 250 });
    const rows = Array.from(scroller.querySelectorAll("[data-snap-row]")) as HTMLElement[];
    rows[0].getBoundingClientRect = () => rect(0, 100);
    rows[1].getBoundingClientRect = () => rect(100, 200);
    // Row 2 straddles the bottom edge (250): revealing it costs 30
    // (280-250, achievable — there's more list below); "hiding" it would
    // cost only 20 (250-200 = wait, recompute: pastView = rect.bottom -
    // r.top = 250-200 = 50) scrolling UP by 50 — IMPOSSIBLE at scrollTop 0.
    // The old (pre-fix) logic would have picked whichever was numerically
    // smaller regardless of reachability; here revealing (30) already
    // happens to be smaller, so make hiding artificially cheaper (20) to
    // actually exercise the clamp-awareness.
    rows[2].getBoundingClientRect = () => rect(230, 280); // reveal=30, hide(up)=20 — hide would "win" if unchecked

    const scrollBy = vi.fn();
    scroller.scrollBy = scrollBy;

    fireEvent.scroll(scroller);
    vi.advanceTimersByTime(150);

    // Hiding (scroll up 20) is impossible at scrollTop 0 — only revealing
    // (scroll down 30) is achievable, so that's what must be chosen even
    // though it's the numerically larger option.
    expect(scrollBy).toHaveBeenCalledWith({ top: 30, behavior: "auto" });
  });

  it("skips a marked element TALLER than the container itself, rather than treating it as a normal reveal/hide candidate — owner-reported live bug: 'scrolling down automatically triggers the hook which makes a few ups and downs and brings me all the way up'", async () => {
    // An earlier version let an oversized element (e.g. a multi-row
    // expanded group card) participate in the SAME reveal/hide heuristic
    // as ordinary rows. Since such an element's edges fall "inside" the
    // container's viewport for almost the entire time you're scrolled
    // anywhere within it — not just at genuine start/end boundaries — it
    // produced a spurious "correction" on nearly every settle, which won
    // by default whenever (the normal case) no ordinary row actually
    // needed one. `data-snap-row` promises "this can be shown WHOLE," which
    // is incoherent for something taller than the viewport, so it's now
    // skipped outright regardless of how it's marked.
    vi.useFakeTimers();
    function OversizedHarness() {
      const ref = useSnapScrollCorrection<HTMLDivElement>();
      return (
        <div ref={ref} data-testid="scroller" style={{ height: 300, overflowY: "auto" }}>
          <div data-snap-row data-testid="oversized" />
        </div>
      );
    }
    render(<OversizedHarness />);
    const scroller = screen.getByTestId("scroller");
    scroller.getBoundingClientRect = () => rect(0, 250);
    mockScrollGeometry(scroller);
    // 900px tall — far taller than the 250px container — and scrolled to
    // dead center, straddling BOTH the top and bottom edges at once (the
    // exact "almost always straddling" state that caused the bug).
    screen.getByTestId("oversized").getBoundingClientRect = () => rect(-300, 600);

    const scrollBy = vi.fn();
    scroller.scrollBy = scrollBy;

    fireEvent.scroll(scroller);
    vi.advanceTimersByTime(150);

    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("debounces — only corrects once settled, not on every intermediate scroll event during a fling", async () => {
    vi.useFakeTimers();
    render(<Harness rowRects={[[0, 100], [100, 280]]} />);
    const scroller = screen.getByTestId("scroller");
    scroller.getBoundingClientRect = () => rect(0, 250);
    mockScrollGeometry(scroller);
    const rows = Array.from(scroller.querySelectorAll("[data-snap-row]")) as HTMLElement[];
    rows[0].getBoundingClientRect = () => rect(0, 100);
    rows[1].getBoundingClientRect = () => rect(100, 280);

    const scrollBy = vi.fn();
    scroller.scrollBy = scrollBy;

    fireEvent.scroll(scroller);
    vi.advanceTimersByTime(50);
    fireEvent.scroll(scroller); // resets the debounce timer
    vi.advanceTimersByTime(50);
    expect(scrollBy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(scrollBy).toHaveBeenCalledTimes(1);
  });
});
