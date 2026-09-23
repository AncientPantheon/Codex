import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { MobileProvider, CODEX_MOBILE_BREAKPOINT } from "./mobile/MobileContext.js";

export interface CodexUiRootProps {
  /** Content rendered inside the `.codex-ui` token scope. */
  children?: React.ReactNode;
  /** Consumer class(es) merged alongside the scope class (never replace it). */
  className?: string;
  /** Per-instance overrides — e.g. `{ "--codex-accent": "#ff0000" }`. */
  style?: React.CSSProperties;
}

/**
 * Token-scope boundary for every assembled `@ancientpantheon/codex-ouronet/ui`
 * component. Renders a `<div className="codex-ui">` so the `--codex-*` defaults
 * from `tokens.css` (`@ancientpantheon/codex-ouronet/ui.css`) bind for everything
 * inside it. Consumers reskin by overriding any `--codex-*` var on this
 * element via `style`, in their own stylesheet, or globally on `:root`.
 *
 * ALSO the container-relative anchor for the Pantheonic-mobile shell (see
 * `docs/work/codex-ui-mobile/design.md` §1 and `mobile/MobileContext.tsx`):
 * it measures its OWN box via `ResizeObserver` and provides `useIsMobile()`'s
 * value through context, so every descendant — however deeply nested — reads
 * "is my container narrow" without a ref or a prop passed down. `position:
 * relative` here is the anchor `position: absolute` mobile chrome (a
 * full-screen modal sheet, a Controls riser) is positioned against, instead
 * of `position: fixed` escaping to the browser viewport — correct whether
 * CodexUiRoot fills the whole page (standalone/dev) or a smaller rectangle
 * inside a bigger host UI (embedded).
 */
export function CodexUiRoot({ children, className, style }: CodexUiRootProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? el.clientWidth;
      setIsMobile(width < CODEX_MOBILE_BREAKPOINT);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scoped = className ? `codex-ui ${className}` : "codex-ui";
  return (
    <div ref={ref} className={scoped} style={{ position: "relative", ...style }}>
      <MobileProvider value={isMobile}>{children}</MobileProvider>
    </div>
  );
}

export default CodexUiRoot;
