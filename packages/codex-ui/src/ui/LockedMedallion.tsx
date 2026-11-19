/**
 * LockedMedallion — the single badge every surface wears on an entity the
 * STORE would refuse to delete (docs/work/locked-entities-and-former-prime/
 * design.md §B5). Five callers across three packages render this one
 * component so the "locked" read is identical everywhere:
 * `OuronetAccountsTab`, `StoaSeedsTab`, `SeedWordsTab`, `PureKeypairsTab`
 * (codex-ouronet) and `ArweaveSeedsArea` (codex-arweave).
 *
 * Purely presentational: it takes the REASON as a plain string and renders
 * it. The reason-deciding predicates live in codex-core; mapping a predicate
 * result to this component's props is each call site's job. codex-ui carries
 * no value `@stoachain`/Ouronet import and this component adds none.
 *
 * ── The four constraints, each pinned by an EXISTING test elsewhere ──
 *
 * 1. The word is **"Locked"**, never "Protected" (owner decision 2):
 *    `ArweaveAccountsArea` already uses "Protected" for an unrelated tier (a
 *    seed whose words are held). Two meanings of one word on one screen is
 *    exactly the drift this topic exists to remove.
 *
 * 2. The glyph is a Lock SVG and **never the `🔒` character**: the Ouronet
 *    accounts row's Prime pill is already `🔒 Prime`, and
 *    `ui-ouronet-accounts-tab.test.tsx:426` queries `getByText(/🔒\s*Prime/)`,
 *    which THROWS on a second match in the same row.
 *
 * 3. The accessible name is `"Locked"` or `` `Locked — ${reason}` `` — never
 *    bare `"Prime"` or `"Standard"`: `ui-ouronet-accounts-tab-mobile.test.tsx`
 *    `:264-266` uses `getByLabelText("Prime")` (throws on >1 match) and `:274`
 *    asserts `getAllByLabelText("Standard")` has length exactly 2.
 *
 * 4. The default colour is NOT the CodexPrime gold `#ceac5f`:
 *    `ui-ouronet-accounts-tab.test.tsx:415` asserts exactly one gold row.
 *
 * ── Why the glyph is a hand-rolled inline SVG, not `lucide-react` ──
 *
 * `codex-arweave` renders this medallion (T8) and deliberately imports NO
 * icon package: `lucide-react` resolved from that package's location hits a
 * documented dual-React-instance bug, so every Arweave glyph is a hand-rolled
 * SVG (`ArweavePanel.tsx:161-165`). This component therefore inlines lucide's
 * own `Lock` icon node — `<rect x=3 y=11 w=18 h=11 rx=2 ry=2>` plus
 * `<path d="M7 11V7a5 5 0 0 1 10 0v4">`, with lucide's default 24-unit
 * viewBox, `currentColor` stroke, width 2, round caps — so it renders
 * pixel-identically to `<Lock size={10} />` while importing nothing. Same
 * precedent as `MobileCategoryIconBtn`, the other shared primitive both
 * codex-ouronet and codex-arweave consume.
 *
 * ── The two forms ──
 *
 * - **full** — `PureKeypairsTab.tsx:286-290`'s pill, ported verbatim (the one
 *   surface that already did this correctly): icon + "Locked", `inline-flex`,
 *   `gap: 4`, `padding: "2px 8px"`, `borderRadius: 9999`, `fontSize: 10`,
 *   `fontWeight: 600`, `flexShrink: 0`, `color: C`, `backgroundColor: C+"20"`.
 * - **compact** — `OuronetAccountsTab.tsx:385-398`'s `IconBadge` geometry: a
 *   20×20 round icon-only badge carrying the text via `title`/`aria-label`.
 *   Icon-only because the mobile accounts fork pins chunk sizes derived from
 *   MEASURED row height (`ui-ouronet-accounts-tab-mobile.test.tsx:167-203`) —
 *   a text pill there would grow the row and move those numbers.
 */

/** The medallion's default accent. Deliberately a neutral slate: NOT the
 *  CodexPrime gold `#ceac5f` (exactly one gold row is the invariant), and not
 *  the `#9a9a9a` muted silver the "Former Codex Prime" designation uses, so a
 *  row carrying both never reads them as one signal. Exported so a caller — or
 *  a caller's test — can name the colour instead of duplicating the literal. */
export const LOCKED_MEDALLION_COLOR = "#8b8f96";

/** The accessible name / tooltip for a given reason. Always begins with the
 *  WORD, so it can never collapse to a bare `"Prime"`/`"Standard"`. */
export function lockedMedallionLabel(reason?: string): string {
  const trimmed = reason?.trim();
  return trimmed ? `Locked — ${trimmed}` : "Locked";
}

export interface LockedMedallionProps {
  /** Why the store would refuse — becomes the tooltip and extends the
   *  accessible name. A plain string: the call site maps its entity lock's
   *  own label onto it. */
  reason?: string;
  /** Icon-only 20×20 form for the measured-height mobile rows. */
  compact?: boolean;
  /** Accent override for a surface with its own row colour. */
  color?: string;
  /** `data-testid` of the medallion's own element. */
  testId?: string;
}

/** Lucide's `Lock` icon node, inlined (see the module note: codex-arweave
 *  cannot import `lucide-react`). Renders identically to `<Lock size={n} />`. */
function LockGlyph({ size }: { size: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

export function LockedMedallion({
  reason,
  compact = false,
  color = LOCKED_MEDALLION_COLOR,
  testId = "locked-medallion",
}: LockedMedallionProps) {
  const label = lockedMedallionLabel(reason);
  const tint = `${color}20`;

  if (compact) {
    return (
      <span
        data-testid={testId}
        title={label}
        aria-label={label}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 20, height: 20, borderRadius: 9999, flexShrink: 0,
          backgroundColor: tint, color,
        }}
      >
        <LockGlyph size={11} />
      </span>
    );
  }

  return (
    <span
      data-testid={testId}
      title={label}
      aria-label={label}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px",
        borderRadius: 9999, fontSize: 10, fontWeight: 600, flexShrink: 0,
        color, backgroundColor: tint,
      }}
    >
      <LockGlyph size={10} /> Locked
    </span>
  );
}

export default LockedMedallion;
