/**
 * CodexBackupInformatics — "Codex ID" page informatics, part 1
 * (`codex-id-page` T2; re-styled + extended per an explicit owner
 * correction after shipping — see the two notes below).
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
 *   itself an access-granting wrap source). Grounded against
 *   `packages/codex/ARWEAVE_TAG_SCHEMA.md` §4 "Wrap sources": both default
 *   sources wrap the SAME two one-time keys independently, which is WHY
 *   either one alone suffices.
 * - The optional Arweave-PIN wrap path: an opt-in extra lock on EITHER
 *   default path above, with an unmissable (always-rendered, never
 *   collapsed) warning that forgetting it is exactly as unrecoverable as
 *   losing the seed words.
 * - NEW: a backup taken BEFORE a Codex Identity existed only ever had the
 *   Master Seed path — adding a Codex Identity later does not retroactively
 *   add it as a second unlock path to that already-permanent record; a
 *   fresh backup is required to cover the new path. Restoring is therefore
 *   designed around picking WHICH of possibly several past backups to
 *   restore from (not a single implicit "the backup"), discovered by
 *   looking up every backup ever made from the account's own Arweave
 *   address — this is a real, load-bearing design fact for the not-yet-built
 *   restore UI (see the "Known gap" note this package's own README already
 *   carries), not a claim that the picker exists today.
 *
 * Re-styled (owner correction): the original flat, unstyled single-column
 * text wall is replaced with `informaticsStyles.ts`'s shared card/section
 * treatment — same content discipline, legible layout.
 */

import * as React from "react";
import {
  INFORMATICS_BODY_LAST_STYLE,
  INFORMATICS_BODY_STYLE,
  INFORMATICS_CARD_STYLE,
  INFORMATICS_HEADING_STYLE,
  INFORMATICS_LAST_SECTION_STYLE,
  INFORMATICS_LIST_ITEM_STYLE,
  INFORMATICS_LIST_STYLE,
  INFORMATICS_SECTION_STYLE,
  INFORMATICS_WARNING_STYLE,
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

      <section style={INFORMATICS_SECTION_STYLE}>
        <p style={INFORMATICS_BODY_STYLE}>
          Every codex backup generates a fresh, random, one-time key, used only for that single
          backup, which re-encrypts everything inside it.
        </p>
        <p style={INFORMATICS_BODY_STYLE}>
          That one-time key is itself locked (wrapped) under your own real secrets — it is
          never stored anywhere in a form anyone could use directly.
        </p>
        <p style={INFORMATICS_BODY_LAST_STYLE}>
          Finally, the whole backup is sealed again as one single opaque block. The result:
          even someone who finds the permanent, public Arweave record of your backup cannot
          tell how many accounts or seeds it contains, let alone read any of them — it is not
          just the individual values that are hidden, the shape of your codex itself is hidden
          too.
        </p>
      </section>

      <section style={INFORMATICS_SECTION_STYLE}>
        <p style={INFORMATICS_BODY_STYLE}>
          There are two completely independent ways to unlock a codex backup. Either one alone
          is enough to restore — you do not need both:
        </p>
        <ul style={INFORMATICS_LIST_STYLE}>
          <li style={INFORMATICS_LIST_ITEM_STYLE}>Your Master Seed words.</li>
          <li style={INFORMATICS_LIST_ITEM_STYLE}>
            Your Codex Identity — specifically its &quot;Standard&quot; half (not the combined
            identity, and not the &quot;Smart&quot; half).
          </li>
        </ul>
        <p style={INFORMATICS_BODY_LAST_STYLE}>
          Both of these independently lock the very same one-time key described above — not two
          different keys, one for each. That is why either one works alone: whichever one you
          use, it unlocks that same key by itself. In practice, this means losing one of them
          does not lock you out of your backup, as long as you still have the other.
        </p>
      </section>

      <section style={INFORMATICS_SECTION_STYLE}>
        <p style={INFORMATICS_BODY_STYLE}>
          You can add an optional PIN — a 6-to-15-digit number that only you know — as an extra
          lock on top of either restore path above.
        </p>
        <p style={INFORMATICS_BODY_STYLE}>
          Turning on a PIN for one of these two paths generates a real, second key from the
          PIN&apos;s digits, and that new key takes the place of that path&apos;s ordinary lock
          — it is not an extra lock added on top of it, it stands in for it. The other restore
          path, if you leave it without a PIN, is unaffected and keeps working exactly as before
          on its own.
        </p>
        <div data-testid="pin-unrecoverable-warning" role="alert" style={INFORMATICS_WARNING_STYLE}>
          Warning: forgetting this PIN is exactly as unrecoverable as losing your seed words —
          there is no &quot;forgot PIN&quot; reset, ever.
        </div>
        <p style={INFORMATICS_BODY_LAST_STYLE}>
          This PIN is entirely opt-in: it is never turned on by default, and it is never
          presented as the recommended choice.
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
