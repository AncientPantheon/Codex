import * as React from "react";

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
 */
export function CodexUiRoot({ children, className, style }: CodexUiRootProps) {
  const scoped = className ? `codex-ui ${className}` : "codex-ui";
  return (
    <div className={scoped} style={style}>
      {children}
    </div>
  );
}

export default CodexUiRoot;
