/**
 * SwipeDeck — a lightweight, dependency-free snap carousel for mobile. Ported
 * from OuronetUI's `src/components/ui/SwipeDeck.tsx` (docs/work/
 * codex-ui-mobile/design.md §5) — the LOGIC is verbatim (zero
 * OuronetUI-specific dependencies to swap, native CSS scroll-snap, no
 * external libs), only the styling is translated from that component's
 * Tailwind classes into inline styles, matching this package's own
 * no-Tailwind convention (see `CodexTabsShell.tsx`'s identical note).
 *
 * Native touch swipe via CSS scroll-snap (`scroll-snap-stop: always`, so a
 * swipe moves exactly one pane with nothing in between), plus dot/arrow
 * indicators. Horizontal by default with arrow buttons + bottom dots;
 * `vertical` swaps to up/down swipe with dots on the right. One pane per
 * child. `fill` makes the deck fill its parent's height.
 */
import * as React from "react";
import { Children, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const ACCENT = "#ceac5f";
const DIM = "#3a3a3a";

export interface SwipeDeckProps {
  children: ReactNode;
  /** Show a sliver of the neighbouring pane (horizontal only). Default true. */
  peek?: boolean;
  /** Fill the parent's height — scroller flexes, each pane is full height. */
  fill?: boolean;
  /** Vertical swipe (up/down) with dots on the right. Implies fill. */
  vertical?: boolean;
  /** Pane to open on first render. Default 0. */
  initialIndex?: number;
  /** Fires with the active pane index whenever it changes. */
  onActiveChange?: (index: number) => void;
  /** Show a single static dot even with exactly ONE pane, instead of no dots
   *  at all (design.md §8, Zone 1's "same structural slot" rule) — a host
   *  with more panes (e.g. a real embedded OuronetUI adding its own account
   *  ⇄ timers panes alongside this one) shows the SAME zone with multiple
   *  dots; standalone shows the identical zone shape with just the one. No
   *  click handler (nowhere to go with a single pane) — purely a shape/size
   *  signal, not a control. */
  showSingleDot?: boolean;
  /** Suppress the deck's own built-in dot/arrow indicator strip entirely
   *  (design.md §8, the Zone 3 "swipe lines must live OUTSIDE the box"
   *  round) — for a host that sits inside a CLIPPED/bordered box (unlike
   *  Zone 1's border-less slot, which lets its dots spill into the gap
   *  below for free) and shows the swipe position through an external,
   *  already-outside-the-box control instead (e.g. Zone 3's pagination
   *  riser). Default false — every other caller keeps its own dots. */
  hideIndicators?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/** Imperative handle for a caller that needs to drive the deck from OUTSIDE
 *  (e.g. an external Prev/Next riser) — the deck's own active pane is
 *  otherwise entirely internal (scroll-driven) state, unreachable via props
 *  alone. */
export interface SwipeDeckHandle {
  scrollToIndex: (index: number) => void;
}

export const SwipeDeck = React.forwardRef<SwipeDeckHandle, SwipeDeckProps>(function SwipeDeck({
  children,
  peek = true,
  fill = false,
  vertical = false,
  initialIndex = 0,
  onActiveChange,
  showSingleDot = false,
  hideIndicators = false,
  className,
  style,
}, ref) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const slides = Children.toArray(children);
  const [active, setActive] = useState(initialIndex);
  const filled = fill || vertical;

  const onActiveChangeRef = useRef(onActiveChange);
  onActiveChangeRef.current = onActiveChange;
  useEffect(() => {
    onActiveChangeRef.current?.(active);
  }, [active]);

  const scrollToIndex = useCallback(
    (i: number) => {
      const el = scrollerRef.current;
      if (!el) return;
      const idx = Math.max(0, Math.min(slides.length - 1, i));
      const slideEl = el.children[idx] as HTMLElement | undefined;
      if (!slideEl) return;
      // Guarded: `Element.scrollTo` isn't implemented in jsdom (test env) and
      // isn't guaranteed in every minimal/embedded webview — degrade to a
      // no-op scroll rather than throwing; the scroll-driven `active` state
      // still updates correctly via the real browser's native scroll-snap.
      if (typeof el.scrollTo !== "function") return;
      if (vertical) {
        el.scrollTo({ top: slideEl.offsetTop - (el.clientHeight - slideEl.clientHeight) / 2, behavior: "smooth" });
      } else {
        el.scrollTo({ left: slideEl.offsetLeft - (el.clientWidth - slideEl.clientWidth) / 2, behavior: "smooth" });
      }
    },
    [slides.length, vertical],
  );

  useImperativeHandle(ref, () => ({ scrollToIndex }), [scrollToIndex]);

  // Open on the requested pane (instant) once laid out.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || initialIndex <= 0) return;
    const idx = Math.min(initialIndex, slides.length - 1);
    const slideEl = el.children[idx] as HTMLElement | undefined;
    if (!slideEl) return;
    if (vertical) el.scrollTop = slideEl.offsetTop - (el.clientHeight - slideEl.clientHeight) / 2;
    else el.scrollLeft = slideEl.offsetLeft - (el.clientWidth - slideEl.clientWidth) / 2;
    setActive(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides.length]);

  // Track the centred pane as the user swipes.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const center = vertical ? el.scrollTop + el.clientHeight / 2 : el.scrollLeft + el.clientWidth / 2;
        let best = 0;
        let bestDist = Infinity;
        Array.from(el.children).forEach((c, i) => {
          const child = c as HTMLElement;
          const cc = vertical ? child.offsetTop + child.clientHeight / 2 : child.offsetLeft + child.clientWidth / 2;
          const d = Math.abs(cc - center);
          if (d < bestDist) {
            bestDist = d;
            best = i;
          }
        });
        setActive(best);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", onScroll);
    };
  }, [slides.length, vertical]);

  const multi = slides.length > 1;

  return (
    <div
      className={className}
      style={{
        position: "relative",
        ...(filled ? { display: "flex", height: "100%", minHeight: 0, flexDirection: "column" } : {}),
        ...style,
      }}
    >
      <div
        ref={scrollerRef}
        className="codex-swipedeck-scroller"
        style={{
          display: "flex",
          gap: 8,
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          ...(vertical
            ? { flexDirection: "column", overflowY: "auto" }
            : { overflowX: "auto" }),
          ...(filled ? { minHeight: 0, flex: 1 } : {}),
          ...(!vertical && !hideIndicators && (multi || showSingleDot) ? { paddingBottom: 16 } : {}),
          ...(vertical && !hideIndicators && multi ? { paddingRight: 16 } : {}),
          scrollSnapType: vertical ? "y mandatory" : "x mandatory",
          scrollBehavior: "smooth",
        }}
      >
        {slides.map((child, i) => (
          <div
            key={i}
            // minWidth/minHeight 0 → the pane is exactly one screen on the swipe
            // axis (its flex-basis), NOT its content size; content clips instead
            // of forcing scroll.
            style={{
              flexShrink: 0,
              overflow: "hidden",
              ...(vertical ? { minHeight: 0, width: "100%" } : { minWidth: 0, ...(filled ? { height: "100%" } : {}) }),
              flexBasis: vertical ? "100%" : multi && peek ? "86%" : "100%",
              scrollSnapAlign: !vertical && peek ? "center" : "start",
              scrollSnapStop: "always",
            }}
          >
            {child}
          </div>
        ))}
      </div>
      {/* Hides the scrollbar in WebKit browsers — scrollbarWidth/msOverflowStyle
          above cover Firefox/legacy Edge, but ::-webkit-scrollbar can't be
          expressed as an inline style. */}
      <style>{".codex-swipedeck-scroller::-webkit-scrollbar{display:none}"}</style>

      {/* Controls: a tiny bulge in the reserved bottom strip (the paddingBottom
          above keeps content clear of it), so they never overlay the pane's
          data and cost minimal height. */}
      {multi && !vertical && !hideIndicators && (
        <div
          style={{
            pointerEvents: "none", position: "absolute", inset: "auto 0 0 0",
            zIndex: 10, display: "flex", height: 16, alignItems: "center", justifyContent: "center",
          }}
        >
          <div
            style={{
              pointerEvents: "auto", display: "flex", alignItems: "center", gap: 4,
              borderRadius: 9999, padding: "1px 6px",
              backgroundColor: "#0a0a0acc", backdropFilter: "blur(3px)",
            }}
          >
            <button
              type="button"
              aria-label="Previous"
              onClick={() => scrollToIndex(active - 1)}
              disabled={active === 0}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "none", border: "none", cursor: active === 0 ? "default" : "pointer",
                opacity: active === 0 ? 0.25 : 1, color: ACCENT, padding: 0,
              }}
            >
              <ChevronLeft size={12} />
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {slides.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`Go to pane ${i + 1}`}
                  onClick={() => scrollToIndex(i)}
                  style={{
                    height: 4, borderRadius: 9999, border: "none", padding: 0, cursor: "pointer",
                    transition: "all 0.2s",
                    width: i === active ? 12 : 4,
                    backgroundColor: i === active ? ACCENT : DIM,
                  }}
                />
              ))}
            </div>
            <button
              type="button"
              aria-label="Next"
              onClick={() => scrollToIndex(active + 1)}
              disabled={active === slides.length - 1}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "none", border: "none",
                cursor: active === slides.length - 1 ? "default" : "pointer",
                opacity: active === slides.length - 1 ? 0.25 : 1, color: ACCENT, padding: 0,
              }}
            >
              <ChevronRight size={12} />
            </button>
          </div>
        </div>
      )}

      {multi && vertical && !hideIndicators && (
        <div
          style={{
            position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)",
            display: "flex", flexDirection: "column", gap: 6,
          }}
        >
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Go to pane ${i + 1}`}
              onClick={() => scrollToIndex(i)}
              style={{
                width: 6, borderRadius: 9999, border: "none", padding: 0, cursor: "pointer",
                transition: "all 0.2s",
                height: i === active ? 18 : 6,
                backgroundColor: i === active ? ACCENT : DIM,
              }}
            />
          ))}
        </div>
      )}

      {/* Single-pane "this IS a swipe zone, it just has one pane right now"
          signal (design.md §8) — no arrows, no click target, just the dot. */}
      {!multi && showSingleDot && !hideIndicators && (
        <div
          style={{
            pointerEvents: "none", position: "absolute", inset: "auto 0 0 0",
            zIndex: 10, display: "flex", height: 16, alignItems: "center", justifyContent: "center",
          }}
        >
          <div style={{ width: 12, height: 4, borderRadius: 9999, backgroundColor: ACCENT }} />
        </div>
      )}
    </div>
  );
});

export default SwipeDeck;
