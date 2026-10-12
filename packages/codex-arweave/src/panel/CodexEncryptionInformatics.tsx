/**
 * CodexEncryptionInformatics — "Codex ID" page informatics, "Encryption"
 * tab (NEW — owner correction, 2026-10-12: "maybe a third one explaining
 * the encryption process of the codex upload").
 *
 * Extracted verbatim from `CodexBackupInformatics.tsx`'s own original
 * content (the encryption-specific sections: the one-time key, the two
 * independent unlock paths, and the optional PIN) into its own dedicated
 * tab — the overview component kept growing with genuinely different
 * concerns (what gets backed up vs. HOW it is encrypted), and encryption
 * specifically deserves its own focused section a reader can jump straight
 * to without scrolling past unrelated content. No wording changed from the
 * original, already-grounded content — see `CodexBackupInformatics.tsx`'s
 * own doc comment history for the original grounding against
 * `codex-backup-envelope-encryption/design.md` and
 * `packages/codex/ARWEAVE_TAG_SCHEMA.md` §4.
 *
 * Styled with `informaticsStyles.ts`'s shared card/section treatment,
 * mounted as one tab of `CodexIdPage.tsx`'s informatics tab group.
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

export function CodexEncryptionInformatics(): React.ReactElement {
  return (
    <div data-testid="codex-encryption-informatics" style={INFORMATICS_CARD_STYLE}>
      <h3 style={INFORMATICS_HEADING_STYLE}>How the codex backup is encrypted</h3>

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

      <section style={INFORMATICS_LAST_SECTION_STYLE}>
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
    </div>
  );
}

export default CodexEncryptionInformatics;
