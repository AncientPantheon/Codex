/**
 * CodexBackupInformatics — "Codex ID" page informatics, "How Backup Works"
 * tab (`codex-id-page` T2; re-styled, extended, then SPLIT per explicit
 * owner corrections after shipping — see the notes below).
 *
 * A static, presentational, plain-language explainer of WHAT backing up a
 * codex does and HOW it behaves over time — written for a non-engineer end
 * user (no internal type/function/variable names anywhere below). The
 * encryption MECHANICS (the one-time key, the dual-unlock paths, the PIN)
 * moved to their own dedicated tab, `CodexEncryptionInformatics.tsx` —
 * owner correction: the page read as one giant, undifferentiated wall even
 * after a visual-only re-style, and the encryption detail specifically
 * deserved its own focused section rather than being buried inside a
 * general overview.
 *
 * - What gets backed up: the whole running codex — every keyring
 *   (Ouronet accounts, Arweave seeds, pure keypairs, foreign keys, watch
 *   list, UI settings) — as ONE Arweave upload, distinct from the
 *   per-file `UploadArea`/`UploadWizard` flow.
 * - Each backup is its own permanent, independent record — a later backup
 *   never updates an earlier one. A Codex Identity added after an
 *   already-made Master-Seed-only backup is NOT retroactively covered by
 *   it; restoring is designed around picking WHICH of possibly several
 *   past backups to use (discovered from the account's own Arweave
 *   address), each prompting its own unlock — describes the not-yet-built
 *   restore UI's intended behavior, not a shipped feature.
 *
 * Styled with `informaticsStyles.ts`'s shared card/section treatment,
 * mounted as one tab of `CodexIdPage.tsx`'s informatics tab group (not
 * stacked with the others on one long page).
 */

import * as React from "react";
import {
  INFORMATICS_BODY_LAST_STYLE,
  INFORMATICS_BODY_STYLE,
  INFORMATICS_CARD_STYLE,
  INFORMATICS_HEADING_STYLE,
  INFORMATICS_LAST_SECTION_STYLE,
  INFORMATICS_SECTION_STYLE,
} from "./informaticsStyles.js";

export function CodexBackupInformatics(): React.ReactElement {
  return (
    <div data-testid="codex-backup-informatics" style={INFORMATICS_CARD_STYLE}>
      <h3 style={INFORMATICS_HEADING_STYLE}>How codex backup on Arweave works</h3>

      <section style={INFORMATICS_SECTION_STYLE}>
        <p style={INFORMATICS_BODY_STYLE}>
          Backing up your codex uploads your entire running codex — every keyring it holds
          (your Ouronet accounts, Arweave seeds, pure keypairs, foreign keys, watch list, and
          UI settings) — as one single Arweave upload.
        </p>
        <p style={INFORMATICS_BODY_LAST_STYLE}>
          This is different from the regular Upload Wizard, which uploads individual files you
          pick one at a time — that is a separate, already-existing feature.
        </p>
      </section>

      <section style={INFORMATICS_LAST_SECTION_STYLE}>
        <p style={INFORMATICS_BODY_STYLE}>
          Each backup you make is its own permanent, independent record — a later backup never
          replaces or updates an earlier one. This matters in particular if you add a Codex
          Identity after already backing up with only your Master Seed: that earlier backup
          stays exactly as it was, covering only the Master Seed path. Making a new backup is
          what adds the Codex Identity path — it does not retroactively appear on the old one.
        </p>
        <p style={INFORMATICS_BODY_LAST_STYLE}>
          Because of this, restoring is designed around picking WHICH of your past backups to
          restore from — not just "the" backup — by looking up every backup your Arweave
          address has ever made. Choosing a different one than you first tried prompts you
          again for its own unlock, independently, since an older backup may only accept the
          unlock path it was actually made with. There is no restore screen yet to do this with
          (see this project&apos;s own known-gap note) — this describes how the system is built
          to behave once one exists, not a feature available today.
        </p>
      </section>
    </div>
  );
}

export default CodexBackupInformatics;
