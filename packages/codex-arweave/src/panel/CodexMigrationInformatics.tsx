/**
 * CodexMigrationInformatics — "Codex ID" page informatics, part 2
 * (`codex-id-page` T2).
 *
 * A static, presentational, plain-language explainer of WHAT the
 * `legacy-prime-migration` wizard will do once built (it is not built
 * yet — this is written now, from the already-complete design, per
 * `codex-id-page/design.md`'s "Migration-process informatics"). No
 * internal type/function/variable names anywhere below. Content is
 * accurate against `legacy-prime-migration/design.md` as it stood when
 * this was written, NOT freehand prose:
 *
 * - Why some codexes aren't eligible: the Ouronet identity and the
 *   Arweave recovery seed don't currently share the same origin words,
 *   most commonly because the codex was bootstrapped with a
 *   wallet-imported word phrase rather than Codex's own fresh word
 *   generation.
 * - The three-option menu, with the design's EXACT conditional-default
 *   framing: option 2 (promote an existing already-custom-worded
 *   account) is recommended WHEN one exists; option 1 (write brand-new
 *   custom words) is recommended otherwise; option 3 (keep current
 *   words, properly re-derived) is always available but always marked
 *   not recommended.
 * - The explicit statement that migration moves real on-chain funds
 *   (native STOA and urSTOA) from old keys to new ones as a necessary,
 *   multi-step part of the process — never instant, never a single
 *   click — and that every fund-moving step will require explicit
 *   confirmation once the wizard is built.
 *
 * This component takes no props and performs no data fetching — it is
 * pure static content, composed into the real page by a later task
 * (`codex-id-page` T3). Styled with this package's own gold-accent
 * convention (`ACCENT`), matching `CodexBackupInformatics.tsx`.
 */

import * as React from "react";

const ACCENT = "#ceac5f";

const SECTION_STYLE: React.CSSProperties = {
  marginBottom: 16,
};

const HEADING_STYLE: React.CSSProperties = {
  margin: "0 0 6px 0",
  fontSize: 14,
  fontWeight: 700,
  color: ACCENT,
};

const BODY_STYLE: React.CSSProperties = {
  margin: "0 0 6px 0",
  fontSize: 13,
  lineHeight: 1.5,
  color: "#d2d3d4",
};

export function CodexMigrationInformatics(): React.ReactElement {
  return (
    <div data-testid="codex-migration-informatics">
      <h3 style={HEADING_STYLE}>What migration does</h3>

      <section style={SECTION_STYLE}>
        <p style={BODY_STYLE}>
          Some codexes aren&apos;t eligible for seed-words-only restore yet. This happens when
          your Ouronet identity and your Arweave recovery seed don&apos;t currently share the
          same origin words — most commonly because your codex was originally set up using a
          wallet-imported word phrase, rather than words generated fresh by Codex itself.
        </p>
      </section>

      <section style={SECTION_STYLE}>
        <p style={BODY_STYLE}>
          Once it exists, the migration wizard will offer you three choices:
        </p>
        <ul>
          <li data-testid="migration-option-new-words" style={BODY_STYLE}>
            <strong>Write brand-new custom words.</strong> Creates a genuinely new identity.
            Recommended when no better option exists (see the next choice).
          </li>
          <li data-testid="migration-option-promote" style={BODY_STYLE}>
            <strong>Promote an existing account already in your codex</strong> that is already
            using custom (non-dictionary) words. Recommended when such an account already
            exists — it avoids creating a new identity at all.
          </li>
          <li data-testid="migration-option-keep-current" style={BODY_STYLE}>
            <strong>Keep your current words exactly as they are</strong>, properly re-derived.
            Always available, but always not recommended, since it keeps relying on
            dictionary-word entropy rather than fully custom words.
          </li>
        </ul>
      </section>

      <section style={SECTION_STYLE}>
        <p style={BODY_STYLE}>
          Whichever choice you make, migration moves your real on-chain money — native STOA and
          your staked and unstaked urSTOA — from your old keys to new ones. This is a genuinely
          necessary part of becoming eligible. It is not instant and not a single click:
          migration is a multi-step process, and once the wizard is built, every step that
          moves funds will require your explicit confirmation before it happens.
        </p>
      </section>
    </div>
  );
}

export default CodexMigrationInformatics;
