/**
 * The Pantheonic-mobile breakpoint context — container-relative, NOT
 * viewport-relative. See docs/work/codex-ui-mobile/design.md §1: OuronetUI's
 * own mobile shell (the reference implementation this whole package's mobile
 * view follows — AncientPantheon/websites/Pantheon/docs/pantheonic-architecture
 * /mobile/README.md §11) reads `window.innerWidth` because it OWNS the
 * viewport. CodexUI, embedded inside a bigger host UI, does not — an embedded
 * CodexUI can be mobile-shaped inside a desktop-width host page (a narrow
 * sidebar panel, a modal, a split view) and the reverse, so the viewport is
 * never the right signal here.
 *
 * `CodexUiRoot` measures ITS OWN box via `ResizeObserver` and provides the
 * result through this context; `useIsMobile()` reads it with zero ref/prop
 * drilling required from any descendant, however deeply nested (a modal, a
 * tab shell, an account row).
 */
import { createContext, useContext } from "react";

/** Below this measured CodexUiRoot width (px), the mobile shell engages.
 *  Matches OuronetUI's own tablet/phone-vs-desktop split threshold pattern
 *  (its own breakpoint is 1280, tuned for ITS 3-tier desktop header — this
 *  package's desktop layout is lighter, so a narrower threshold is correct
 *  here, not a copy of that exact number). */
export const CODEX_MOBILE_BREAKPOINT = 700;

const MobileCtx = createContext<boolean>(false);

export const MobileProvider = MobileCtx.Provider;

/**
 * Whether the nearest `<CodexUiRoot>` ancestor is currently narrower than
 * {@link CODEX_MOBILE_BREAKPOINT}. Defaults to `false` (desktop) when called
 * with no `<CodexUiRoot>` ancestor at all — the safe assumption for orphaned
 * usage (e.g. a unit test rendering a leaf component directly) rather than
 * silently forcing every unwrapped consumer into a mobile layout.
 */
export function useIsMobile(): boolean {
  return useContext(MobileCtx);
}
