/**
 * Shared display-formatting helpers for the two `zbom/cfm/` tooltip cards
 * (`ExecutionTooltip.tsx`'s `ExecutionTooltipCard`, `PreZbomHint.tsx`'s
 * `PreZbomTooltipCard`). Extracted here (2026-09-27 review round) after the
 * two cards' independently-maintained copies of `readablePreview` had
 * already drifted: the original inline `need?.decimal` check treats a
 * genuine `decimal: 0` cost as falsy and falls through to `String(need)`
 * (stringifying the whole object), while a later copy correctly special-
 * cased `decimal !== undefined`. Both cards now share this ONE
 * implementation (the correct one) instead of two independently-editable
 * copies that can silently disagree on the same input.
 *
 * Deliberately NOT a talos-registry/Pact-building concern — this is display
 * formatting only, so extracting it does not touch `ExecutionTooltip.tsx`'s
 * out-of-scope call-building mechanism (`pactSignatures.generated.ts`),
 * which stays exactly as it was.
 */

/** Shared live-read state union — both cards' `usePreview`-shaped hooks
 *  produce this; the `"ok"` variant is exactly `readablePreview`'s return
 *  shape, so it lives here rather than as two independently-editable copies
 *  (the exact drift risk this module exists to close — see module doc). */
export type Preview =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ok"; text: string; ignis: string | null }
  | { state: "error"; message: string };

/**
 * Reformat a live INFO/preview response into display text + an IGNIS cost
 * string.
 */
export function readablePreview(data: unknown): { text: string; ignis: string | null } {
  if (data === null || data === undefined) return { text: "(no data)", ignis: null };
  if (typeof data === "string") return { text: data, ignis: null };

  const record = data as Record<string, unknown>;
  const pre = record["pre-text"];
  const text = Array.isArray(pre) && pre.length
    ? pre.join("\n")
    : JSON.stringify(data).slice(0, 300);

  const costs = record["ignis"] as Record<string, unknown> | undefined;
  const need = costs?.["ignis-need"] as { decimal?: unknown } | string | number | undefined;
  const ignis =
    need === undefined || need === null
      ? null
      : typeof need === "object" && "decimal" in need && need.decimal !== undefined
        ? String(need.decimal)
        : String(need);

  return { text: String(text), ignis };
}

/**
 * Middle-elide a rendered value, keeping HEAD and TAIL — those are what
 * identify a value at a glance (`"OURO-8Nh…4F5"`, `"Σ.ъΦĞ…ΦλУ"`), unlike a
 * head-only truncation. An Ouronet account is a 162-glyph string; three of
 * them in a five-parameter tooltip produced a card taller than the thing it
 * annotated before this existed.
 *
 * Quotes are preserved OUTSIDE the elision (never truncated away): a reader
 * must be able to tell a Pact STRING from a bare decimal at a glance, and
 * that is exactly the distinction a careless truncation destroys. Applying
 * this at the render site still needs `title={raw}` alongside it so the
 * full value stays reachable on hover — `shorten()` only changes what's
 * shown inline, never what's retained.
 */
export function shorten(rendered: string, keep = 14): string {
  const quoted = rendered.length > 1 && rendered.startsWith('"') && rendered.endsWith('"');
  const body = quoted ? rendered.slice(1, -1) : rendered;
  if (body.length <= keep * 2 + 1) return rendered;
  const cut = `${body.slice(0, keep)}…${body.slice(-keep)}`;
  return quoted ? `"${cut}"` : cut;
}

/** Shared monospace text style for the tooltip cards' exec/preview lines. */
export const mono = { fontFamily: "monospace", fontSize: "10px" } as const;

/** Shared outer card style for the tooltip cards. */
export const previewCardStyle = {
  position: "relative",
  backgroundColor: "#0b0b0b",
  borderColor: "#2a2a2a",
  padding: "10px 12px",
  // `minWidth` alongside `maxWidth`: a floating/absolutely-positioned card
  // (Radix Tooltip.Content) shrink-to-fits its content by default, so a
  // short exec signature with few short args renders a visibly NARROWER
  // card than one with several long lines — `minWidth` keeps the card a
  // consistent size regardless of content length (matching the reference
  // implementation's own consistently-sized card).
  minWidth: "320px",
  maxWidth: "480px",
  boxShadow: "0 8px 24px #000a",
} as const;
