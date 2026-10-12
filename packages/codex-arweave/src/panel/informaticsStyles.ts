/**
 * informaticsStyles — shared visual language for every static "how this
 * works" explainer in the Arweave panel (`CodexBackupInformatics.tsx`,
 * `CodexMigrationInformatics.tsx`, `UploadInformatics.tsx`).
 *
 * Replaces each component's own previously-duplicated, bare-text local
 * style constants (no card, no section separation, a cramped 560px column
 * with the rest of the viewport left empty) — a real, reported readability
 * problem, not a style preference. Centralized here deliberately (these
 * components used to each define their own copy on purpose, "self-contained
 * so they never drift" — but drift was never the risk; a flat, unstyled
 * wall of text was) so every future informatics section gets the same
 * legible card/heading/section/list treatment for free, and a future visual
 * fix only has to happen once.
 *
 * Matches this package's own established dark-card convention verbatim
 * (`ArweavePanel.tsx`'s `LEAVE_DIALOG_STYLE`: `border: 1px solid #262626`,
 * `backgroundColor: #111111`, `borderRadius: 12`) rather than inventing a
 * new one.
 */

import * as React from "react";

export const INFORMATICS_ACCENT = "#ceac5f";

/** The outer card every informatics component wraps its whole content in.
 *  Fills the available container width (owner correction, 2026-10-12: a
 *  fixed 760px reading-width cap left real empty space on wide viewports —
 *  "why isn't it using the whole width" — so this now stretches to its
 *  parent's full width instead of imposing its own cap). */
export const INFORMATICS_CARD_STYLE: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  borderRadius: 12,
  border: "1px solid #262626",
  backgroundColor: "#111111",
  padding: "22px 26px",
};

export const INFORMATICS_HEADING_STYLE: React.CSSProperties = {
  margin: "0 0 16px 0",
  fontSize: 17,
  fontWeight: 700,
  color: INFORMATICS_ACCENT,
  letterSpacing: 0.1,
};

/** A lighter, smaller label for a sub-point within a section (e.g. "Why
 *  this exists", "How migration works") — optional, used where a section
 *  benefits from its own mini-heading rather than running straight into
 *  prose. */
export const INFORMATICS_SUBHEADING_STYLE: React.CSSProperties = {
  margin: "0 0 8px 0",
  fontSize: 12,
  fontWeight: 700,
  color: "#9a9a9a",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

/** Each section gets real visual separation from the next — a hairline
 *  divider plus generous spacing, not just a `marginBottom` between
 *  paragraphs that reads as one continuous wall. The LAST section in a
 *  component should use {@link INFORMATICS_LAST_SECTION_STYLE} instead, so
 *  the card doesn't end with a dangling divider + empty space. */
export const INFORMATICS_SECTION_STYLE: React.CSSProperties = {
  marginBottom: 20,
  paddingBottom: 20,
  borderBottom: "1px solid #1e1e1e",
};

export const INFORMATICS_LAST_SECTION_STYLE: React.CSSProperties = {
  marginBottom: 0,
  paddingBottom: 0,
  borderBottom: "none",
};

export const INFORMATICS_BODY_STYLE: React.CSSProperties = {
  margin: "0 0 10px 0",
  fontSize: 14,
  lineHeight: 1.65,
  color: "#d2d3d4",
};

/** Last paragraph in a section shouldn't carry trailing margin — use this
 *  on the final `<p>`/list in a section so spacing stays even. */
export const INFORMATICS_BODY_LAST_STYLE: React.CSSProperties = {
  ...INFORMATICS_BODY_STYLE,
  margin: 0,
};

export const INFORMATICS_LIST_STYLE: React.CSSProperties = {
  margin: "0 0 10px 0",
  paddingLeft: 22,
};

export const INFORMATICS_LIST_ITEM_STYLE: React.CSSProperties = {
  margin: "0 0 6px 0",
  fontSize: 14,
  lineHeight: 1.65,
  color: "#d2d3d4",
};

/** An always-rendered (never collapsible) high-visibility warning box —
 *  same visual weight `CodexBackupArea.tsx`'s own permanence warning
 *  already uses for "this is a real, unrecoverable risk" content. */
export const INFORMATICS_WARNING_STYLE: React.CSSProperties = {
  margin: "4px 0 10px 0",
  padding: "12px 14px",
  borderRadius: 10,
  border: "1px solid #f8717140",
  backgroundColor: "#f871711a",
  color: "#fca5a5",
  fontSize: 14,
  fontWeight: 600,
  lineHeight: 1.6,
};
