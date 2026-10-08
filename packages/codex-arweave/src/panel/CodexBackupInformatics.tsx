/**
 * CodexBackupInformatics — "Codex ID" page informatics, part 1
 * (`codex-id-page` T2).
 *
 * A static, presentational, plain-language explainer of HOW a whole-codex
 * backup to Arweave works — written for a non-engineer end user (no
 * internal type/function/variable names anywhere below). Content is
 * accurate against `codex-backup-envelope-encryption/design.md` (the
 * dual-DEK envelope scheme, including its now-in-scope Arweave-PIN wrap
 * path) as it stood when this was written, NOT freehand prose:
 *
 * - What gets backed up: the whole running codex — every keyring
 *   (Ouronet accounts, Arweave seeds, pure keypairs, foreign keys, watch
 *   list, UI settings) — as ONE Arweave upload, distinct from the
 *   per-file `UploadArea`/`UploadWizard` flow.
 * - The encryption: a fresh, random, one-time key (plain-language for the
 *   design's IDEK/EDEK pair) generated per backup re-encrypts everything
 *   inside it; that key is itself wrapped under the user's own real
 *   secrets rather than stored anywhere directly usable; the whole result
 *   is sealed again as one opaque block, hiding the SHAPE of the backup
 *   (not just its values) from anyone who finds the permanent public
 *   record.
 * - The two default, independent restore paths (either alone suffices):
 *   the Master Seed words, and the Codex Identity's "Standard" half
 *   specifically (NOT the combined identity, NOT the "Smart" half —
 *   design.md's "Out of scope" section is explicit that the Smart half is
 *   reserved for a separate, higher-authority mechanism and is never
 *   itself an access-granting wrap source).
 * - The optional Arweave-PIN wrap path (moved in scope, owner decision
 *   2026-10-08): an opt-in extra lock on EITHER default path above, with
 *   an unmissable (always-rendered, never collapsed) warning that
 *   forgetting it is exactly as unrecoverable as losing the seed words —
 *   there is no reset, ever — and that it is never the recommended
 *   default.
 *
 * This component takes no props and performs no data fetching — it is
 * pure static content, composed into the real page by a later task
 * (`codex-id-page` T3) alongside the live eligibility status and action
 * buttons. Styled with this package's own gold-accent convention
 * (`ACCENT`, shared by `ArweaveAccountsArea.tsx`/`PureKeysArea.tsx`/
 * `CodexBackupArea.tsx`) rather than bare, unstyled text.
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

/** The PIN-unrecoverable warning's own box — deliberately NOT a `<details>`
 *  or anything else that could render collapsed/hidden by default; this
 *  warning is always fully rendered and visually distinct (a red-amber
 *  border, same "this is a real risk" visual weight this package already
 *  uses for `CODEX_BACKUP_PERMANENCE_WARNING` in `CodexBackupArea.tsx`). */
const PIN_WARNING_STYLE: React.CSSProperties = {
  margin: "8px 0",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #f8717140",
  backgroundColor: "#f871711a",
  color: "#fca5a5",
  fontSize: 13,
  fontWeight: 600,
  lineHeight: 1.5,
};

export function CodexBackupInformatics(): React.ReactElement {
  return (
    <div data-testid="codex-backup-informatics">
      <h3 style={HEADING_STYLE}>How codex backup on Arweave works</h3>

      <section style={SECTION_STYLE}>
        <p style={BODY_STYLE}>
          Backing up your codex uploads your entire running codex — every keyring it holds
          (your Ouronet accounts, Arweave seeds, pure keypairs, foreign keys, watch list, and
          UI settings) — as one single Arweave upload.
        </p>
        <p style={BODY_STYLE}>
          This is different from the regular Upload Wizard, which uploads individual files you
          pick one at a time — that is a separate, already-existing feature.
        </p>
      </section>

      <section style={SECTION_STYLE}>
        <p style={BODY_STYLE}>
          Every codex backup generates a fresh, random, one-time key, used only for that single
          backup, which re-encrypts everything inside it.
        </p>
        <p style={BODY_STYLE}>
          That one-time key is itself locked (wrapped) under your own real secrets — it is
          never stored anywhere in a form anyone could use directly.
        </p>
        <p style={BODY_STYLE}>
          Finally, the whole backup is sealed again as one single opaque block. The result:
          even someone who finds the permanent, public Arweave record of your backup cannot
          tell how many accounts or seeds it contains, let alone read any of them — it is not
          just the individual values that are hidden, the shape of your codex itself is hidden
          too.
        </p>
      </section>

      <section style={SECTION_STYLE}>
        <p style={BODY_STYLE}>
          There are two completely independent ways to unlock a codex backup. Either one alone
          is enough to restore — you do not need both:
        </p>
        <ul>
          <li style={BODY_STYLE}>Your Master Seed words.</li>
          <li style={BODY_STYLE}>
            Your Codex Identity — specifically its &quot;Standard&quot; half (not the combined
            identity, and not the &quot;Smart&quot; half).
          </li>
        </ul>
      </section>

      <section style={SECTION_STYLE}>
        <p style={BODY_STYLE}>
          You can add an optional PIN — a 6-to-15-digit number that only you know — as an extra
          lock on top of either restore path above.
        </p>
        <div data-testid="pin-unrecoverable-warning" role="alert" style={PIN_WARNING_STYLE}>
          Warning: forgetting this PIN is exactly as unrecoverable as losing your seed words —
          there is no &quot;forgot PIN&quot; reset, ever.
        </div>
        <p style={BODY_STYLE}>
          This PIN is entirely opt-in: it is never turned on by default, and it is never
          presented as the recommended choice.
        </p>
      </section>
    </div>
  );
}

export default CodexBackupInformatics;
