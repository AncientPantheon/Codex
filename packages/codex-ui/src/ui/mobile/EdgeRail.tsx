/**
 * EdgeRail — an icon-only, edge-docked half-disc button that straddles a
 * horizontal seam (docs/work/codex-ui-mobile/design.md §8, Core-zone bullet).
 *
 * Ported from the concrete reference `claudstermind` shared live
 * (`.mc-rail`, `dashboard/public/mobile-cockpit.{js,css}`, scoped under
 * `.ws-mobile2`), translated from Tailwind/CSS-file into this package's own
 * inline-style convention:
 *   - Shape: pure one-sided `border-radius` (`side="left"` rounds only the
 *     RIGHT corners, flush against the left edge, and mirrored for
 *     `side="right"`) — a true half-disc, not a full pill clipped by overflow.
 *   - Position: `position: absolute; top: 0; transform: translateY(-50%)`,
 *     anchored to whatever `position: relative` ancestor the caller supplies
 *     (the seam it should straddle) — floats OVER the corner rather than
 *     reserving a content gutter (the reference's own explicit fix over an
 *     earlier version that cost a gutter by sitting across the middle).
 *   - Size: the reference's icon-only `--arc` variant, 26×52px — comfortably
 *     above the ~44px touch-target minimum on the long axis.
 *   - Touch: `touchAction: "manipulation"` + `WebkitTapHighlightColor:
 *     "transparent"` for a clean mobile tap, no animation beyond a plain
 *     click handler (the reference's own slide is a CSS transition on the
 *     panel it opens, not on the rail itself — out of scope here, the
 *     caller owns what opening does).
 *
 * The reference's own explicit design note, worth repeating: rails are an
 * ADDITIONAL affordance, never the only door to a view — callers should make
 * sure whatever an `EdgeRail` opens is also reachable another way.
 */
import * as React from "react";

export interface EdgeRailProps {
  /** Which screen edge this rail is docked to — mirrors ("left" rounds its
   *  right corners, flush left; "right" rounds its left corners, flush right). */
  side: "left" | "right";
  /**
   * Which horizontal seam of the anchor this rail straddles — `"top"`
   * (default, unchanged) docks at the anchor's OWN top edge; `"bottom"`
   * docks at its bottom edge instead. Added when the owner flagged that a
   * rail anchored to a CONTENT box's top corner reads as "locked inside"
   * that box — moving it to straddle the SEPARATION gap below the box
   * (Zone 3's own bottom margin, in CodexTabs' case) is "the perfect
   * place", matching how OuronetUI's real dashboard leaves room below its
   * equivalent card for exactly this.
   *
   * `"middle"` — added when the owner flagged that even the bottom-seam
   * placement still left the rail "tied into Zone 3" (bounded by, and
   * clipped against, that box's own edges): "they should look like on the
   * claudstermind mobile implementation, docked to the screen, on top of
   * everything, shown in their entirety." Vertically centers the rail
   * (`top: 50%; transform: translateY(-50%)`) against whatever anchor the
   * caller supplies — intended for a FULL-SCREEN portal target (a mobile
   * shell's whole body, not any one zone's own bounded frame), so the rail
   * is never clipped by a zone's own `overflow`/border-radius and paints
   * above every zone's content instead of being confined inside one of them.
   */
  edge?: "top" | "bottom" | "middle";
  onClick: () => void;
  /** Pressed/active visual state (e.g. this rail's view is the one showing).
   *  The ACTIVE rail (the view currently showing) reads in full accent
   *  color against a tinted backdrop; the INACTIVE one (the other, still-
   *  clickable, switch target) reads dimmed/grey — same standard tab-bar
   *  convention as the mobile filter row's own `MobileFilterIconBtn`. A
   *  prior round made this rail fully transparent (no backdrop at all,
   *  either state) — reverted per explicit owner correction ("i told you
   *  not to make transparent"); it now carries a real, visible backdrop
   *  again. Not a real HTML `disabled` — the inactive rail is the only door
   *  to the OTHER view, so it must stay clickable; "greyed out" here is
   *  purely the muted styling, not non-interactivity. */
  active?: boolean;
  /** Accent color for the icon + active border. Defaults to the codex gold. */
  accent?: string;
  "aria-label": string;
  children: React.ReactNode;
}

const DEFAULT_ACCENT = "#ceac5f";

export function EdgeRail({ side, edge = "top", onClick, active = false, accent = DEFAULT_ACCENT, children, ...rest }: EdgeRailProps) {
  const isLeft = side === "left";
  // Exactly one of top/bottom is ever set — the other stays the browser
  // default ("") — existing tests pin this (`edge="bottom"` ⇒ `style.top ===
  // ""`), so `"middle"` follows the same one-set/one-blank shape rather than
  // setting both top AND bottom.
  const seam: React.CSSProperties =
    edge === "bottom"
      ? { bottom: 0, transform: "translateY(50%)" }
      : edge === "middle"
        ? { top: "50%", transform: "translateY(-50%)" }
        : { top: 0, transform: "translateY(-50%)" };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        position: "absolute",
        ...seam,
        [isLeft ? "left" : "right"]: 0,
        width: 26,
        height: 52,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: `1px solid ${active ? accent : "#4a4a4a"}`,
        [isLeft ? "borderLeft" : "borderRight"]: "0",
        borderRadius: isLeft ? "0 999px 999px 0" : "999px 0 0 999px",
        // A real, visible backdrop, DISTINCT from the surrounding page
        // background — not just "non-transparent" in the technical sense.
        // The previous near-black fill (`#0a0a0af0`) was so close to the
        // page's own near-black background/card colors (`#05060a`/
        // `#0a0a0a`) that it still read as blending in / see-through, even
        // though it wasn't (owner correction: "they share the background
        // colour with the rest of the display, they appear as if they are
        // transparent, which they are not... they need to be seen as
        // something sitting on the screen"). A visibly LIGHTER surface tone
        // fixes that regardless of state; active additionally tints toward
        // the accent.
        backgroundColor: active ? `${accent}33` : "#26262bf5",
        color: active ? accent : "#c4c4c4",
        cursor: "pointer",
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
        // Explicit (not just the implicit default) — `edge="middle"` is
        // meant for a caller that portals this rail into a `pointer-events:
        // none` full-screen overlay wrapper (the SAME reasoning
        // `CodexModalShell` already documents for itself); without this
        // override the rail would silently become unclickable in that case.
        pointerEvents: "auto",
        zIndex: 5,
        padding: 0,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

export default EdgeRail;
