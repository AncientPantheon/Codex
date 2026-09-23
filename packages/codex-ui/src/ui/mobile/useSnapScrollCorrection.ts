import { useEffect, useRef, type RefObject } from "react";

/** How long after the LAST scroll event fires before we treat the gesture as
 *  "settled" and check for a cut row — long enough that a fling's own
 *  momentum-deceleration scroll events (which keep firing until it stops)
 *  never trigger a correction mid-flight. */
const SETTLE_DELAY_MS = 120;

/**
 * A GUARANTEED backstop for "every entry, everywhere, must be shown whole
 * when scrolling" (docs/work/codex-ui-mobile/design.md §8 — reiterated
 * across MULTIPLE feedback rounds, most recently round 8: "no more
 * incomplete viewing of entries on the list... How do we [call/design] this
 * display procedure?"). CSS `scroll-snap-type: y mandatory` (each row
 * opting in via `scrollSnapAlign: "start"`) is the FIRST line of defense
 * and stays in place everywhere it's already used — but mobile WebViews are
 * inconsistent about actually re-snapping once a momentum fling decelerates
 * to a stop, so relying on CSS alone can still leave a row visibly cut after
 * a real gesture even though the declarative CSS is textbook-correct.
 *
 * This hook is the JS-ENFORCED guarantee on top: attach the returned ref to
 * the scrollable container, mark every row that must never be shown partial
 * with `data-snap-row` (a plain marker attribute — no coupling to whatever
 * `scrollSnapAlign` styling that same row already carries). On scroll
 * SETTLE (debounced — see `SETTLE_DELAY_MS`), it finds whichever marked row
 * is straddling the container's own top or bottom edge (the only rows that
 * COULD be showing "cut") and INSTANTLY jumps the minimal distance to bring
 * it fully into view (or fully out, whichever is the smaller correction) —
 * so the container always comes to rest with a whole row at both edges,
 * regardless of whether the platform's native CSS snap actually engaged.
 *
 * Round 8 follow-up bug fix — owner-reported live bug: "scrolling scrolls
 * me back, it doesnt keep": an EARLIER version corrected with
 * `behavior: "smooth"`. That animated scroll fires its OWN `scroll` events
 * throughout the animation, which re-armed the debounce above and could
 * re-invoke `settle()` again WHILE the first correction was still
 * mid-flight — reading the not-yet-arrived intermediate scroll position,
 * computing a second (possibly conflicting) correction on top of the
 * first, and so on. On a real device this reads exactly like "scrolling
 * scrolls me back" — the view visibly fighting itself and drifting away
 * from where the user actually scrolled to. An INSTANT jump (`behavior:
 * "auto"`) applies synchronously, so by the time the resulting `scroll`
 * event's re-armed debounce fires 120ms later, the geometry already
 * reflects the corrected (final) position — `settle()` finds nothing left
 * to fix and no-ops, terminating in exactly one correction.
 *
 * Round 8 follow-up bug fix — owner-reported live bug: "if i scroll on the
 * very top, it still show a remnant on the last position": the two
 * candidate corrections for a straddling row (fully reveal it vs. fully
 * hide it) were compared purely by DISTANCE, with no regard for whether
 * either is actually POSSIBLE at the current scroll position. At the very
 * top of the list (`scrollTop` already 0), "hide it by scrolling further
 * up" is impossible — the browser just clamps to 0, silently doing
 * nothing — but if that impossible option happened to be the numerically
 * SMALLER one, it "won" anyway and the row stayed cut. Candidates are now
 * filtered to ones actually achievable given `scrollTop`/`scrollHeight`/
 * `clientHeight` BEFORE picking the smallest.
 *
 * Round 8 follow-up bug fix — owner-reported live bug: "scrolling down
 * automatically triggers the hook which makes a few ups and downs and
 * brings me all the way up": a caller briefly marked an element MUCH
 * TALLER than the scroll container itself (an expanded, multi-row group
 * card in `StoaAccountsTab`) as a `data-snap-row` candidate, reasoning
 * that "smallest correction wins" would keep it harmless. That missed that
 * the straddle check ("container's edge falls strictly inside this
 * element's own span") is true for almost the ENTIRE time you're
 * scrolled anywhere inside such an oversized element, not just at its own
 * boundaries — so nearly every settle produced a large, spurious
 * "correction" that won by default whenever (the normal case) no
 * ordinary, viewport-sized row actually needed one. `data-snap-row` is a
 * contract for "this row must be shown WHOLE" — a promise that's
 * incoherent for an element taller than the viewport (it can never be
 * fully shown no matter where you scroll), so such elements are now
 * SKIPPED entirely, regardless of what marks them, rather than trusted to
 * behave via the general reveal/hide heuristic.
 *
 * No-ops harmlessly wherever real layout doesn't exist (jsdom: every
 * `getBoundingClientRect()` reads all-zero, so no row is ever "straddling"
 * anything) — the same "browser-only concern" this codebase already
 * accepts for other real-measurement-dependent hooks (see
 * `OuronetAccountsTab`'s `useMobilePageSize`).
 */
export function useSnapScrollCorrection<T extends HTMLElement = HTMLDivElement>(): RefObject<T | null> {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    // Extra belt-and-suspenders against re-entrancy (see the bug-fix doc
    // comment above): while a correction is being applied, ignore the
    // `scroll` event(s) it itself produces rather than re-arming the
    // debounce off them.
    let correcting = false;

    const settle = () => {
      if (typeof el.scrollBy !== "function") return; // jsdom / minimal webview guard
      const rect = el.getBoundingClientRect();
      const rows = Array.from(el.querySelectorAll<HTMLElement>("[data-snap-row]"));
      // How far the container can ACTUALLY move in each direction before
      // clamping — a candidate correction past either limit is not really
      // an option at all (see the bug-fix doc comment above).
      const maxUp = el.scrollTop;
      const maxDown = el.scrollHeight - el.clientHeight - el.scrollTop;
      const TOLERANCE = 1;
      const achievable = (d: number) => (d < 0 ? -d <= maxUp + TOLERANCE : d <= maxDown + TOLERANCE);
      // A marked row can be NESTED inside another marked row (e.g. a
      // collapsed group card and, independently, each of ITS OWN entry
      // rows once expanded) — both are valid snap targets in the moments
      // that overlap, but the outer one is usually taller, so whenever
      // it's the one straddling an edge it needs a bigger correction than
      // whichever inner row is actually at that edge. Picking the
      // SMALLEST-magnitude correction across every candidate naturally
      // prefers the innermost/most specific row instead of dragging a
      // whole outer box into view.
      const containerSize = rect.bottom - rect.top;
      let best: number | null = null;
      for (const row of rows) {
        const r = row.getBoundingClientRect();
        // An element TALLER than the container itself can never be shown
        // fully no matter where you scroll — treating it as a normal
        // reveal/hide candidate is incoherent and, worse, spuriously
        // "straddles" almost constantly while you're scrolled anywhere
        // inside it (see the bug-fix doc comment above). Skip it outright.
        if (r.bottom - r.top > containerSize + 1) continue;
        let intoView: number | null = null;
        let pastView: number | null = null;
        // Straddling the container's TOP edge.
        if (r.top < rect.top - 1 && r.bottom > rect.top + 1) {
          intoView = -(rect.top - r.top); // scroll UP (negative) to fully reveal it
          pastView = r.bottom - rect.top; // scroll DOWN (positive) to fully hide it
        } else if (r.bottom > rect.bottom + 1 && r.top < rect.bottom - 1) {
          // Straddling the container's BOTTOM edge.
          intoView = r.bottom - rect.bottom; // scroll DOWN (positive) to fully reveal it
          pastView = -(rect.bottom - r.top); // scroll UP (negative) to fully hide it
        } else {
          continue;
        }
        const candidates = [intoView, pastView].filter(achievable);
        if (candidates.length === 0) continue;
        const delta = candidates.reduce((a, b) => (Math.abs(a) <= Math.abs(b) ? a : b));
        if (best === null || Math.abs(delta) < Math.abs(best)) best = delta;
      }
      if (best !== null) {
        correcting = true;
        el.scrollBy({ top: best, behavior: "auto" });
        // Released on the next tick — well after the instant scroll (and
        // its own synchronous/near-synchronous `scroll` event) has landed,
        // but before the NEXT real user gesture could plausibly fire one.
        setTimeout(() => { correcting = false; }, 0);
      }
    };

    const onScroll = () => {
      if (correcting) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(settle, SETTLE_DELAY_MS);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (timer) clearTimeout(timer);
    };
  }, []);

  return ref;
}
