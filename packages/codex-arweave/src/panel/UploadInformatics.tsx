/**
 * UploadInformatics — the Upload page's own static explainer section
 * (`arweave-split-bundle-upload` T5b addendum, Part 2; re-styled per an
 * explicit owner correction after shipping — see `informaticsStyles.ts`'s
 * own doc comment for why).
 *
 * A static, presentational, plain-language explainer of HOW an Arweave
 * upload actually works — written for a non-engineer end user (no internal
 * type/function/variable names anywhere below). Content is adapted from
 * `packages/codex/ARWEAVE_STREAMING_UPLOAD_ARCHITECTURE.md` (the full
 * technical walkthrough already shipped), shortened and plained for an
 * in-app reader rather than reproducing every implementation byte-layout
 * detail:
 *
 * - WHY a bundle has to be fully assembled before it can be posted: every
 *   file in one upload action shares a single Merkle tree and a single
 *   signature, so the whole thing has to exist, concatenated, before
 *   either can be computed — that's what makes a bundle upload faster
 *   than posting every file as its own separate transaction.
 * - The 256 KiB chunking the underlying protocol already works in, which
 *   is what makes an upload resumable at all (a dropped connection only
 *   ever costs the current chunk, never the whole upload).
 * - WHY a private, on-device staging area (OPFS) is used instead of
 *   holding everything in memory at once, and that staging needs free
 *   disk space roughly equal to the size of what's being uploaded.
 * - Now that automatic multi-bundle splitting is live
 *   (`arweave-split-bundle-upload`): a selection too large for your
 *   currently available free space is no longer a failure or an
 *   impossible-space demand — it automatically becomes several smaller,
 *   roughly-equal uploads instead, posted one after another, tied together
 *   under a single shared result.
 *
 * This component takes no props and performs no data fetching — pure
 * static content. Styled with `informaticsStyles.ts`'s shared card/section
 * treatment, matching `CodexBackupInformatics.tsx`/
 * `CodexMigrationInformatics.tsx` exactly.
 */

import * as React from "react";
import {
  INFORMATICS_BODY_LAST_STYLE,
  INFORMATICS_CARD_STYLE,
  INFORMATICS_HEADING_STYLE,
  INFORMATICS_LAST_SECTION_STYLE,
  INFORMATICS_SECTION_STYLE,
} from "./informaticsStyles.js";

export function UploadInformatics(): React.ReactElement {
  return (
    <div data-testid="upload-informatics" style={INFORMATICS_CARD_STYLE}>
      <h3 style={INFORMATICS_HEADING_STYLE}>How an Arweave upload works</h3>

      <section style={INFORMATICS_SECTION_STYLE}>
        <p style={INFORMATICS_BODY_LAST_STYLE}>
          When you upload two or more files (or a whole folder) in one go, they are combined
          into a single bundle before anything is sent. This is necessary, not just convenient:
          every file in the bundle shares one combined fingerprint and one signature, so the
          whole bundle has to be fully put together first before either can be computed. This
          is also what makes uploading many files together faster than sending each one as its
          own separate, fully independent upload.
        </p>
      </section>

      <section style={INFORMATICS_SECTION_STYLE}>
        <p style={INFORMATICS_BODY_LAST_STYLE}>
          Underneath, Arweave moves data in small, fixed-size pieces — 256 KiB (about a quarter
          of a megabyte) at a time — regardless of how large your overall upload is. This is
          what makes an upload resumable: if your connection drops partway through, only the
          current small piece is lost, never the whole upload. Picking back up continues from
          the last successfully-sent piece, never starting over from scratch.
        </p>
      </section>

      <section style={INFORMATICS_SECTION_STYLE}>
        <p style={INFORMATICS_BODY_LAST_STYLE}>
          While a bundle is being put together, it is staged in a private area of your own
          device&apos;s storage, set aside for this app and inaccessible to other sites — never
          held entirely in your browser tab&apos;s working memory. Staging this way means your
          device needs free disk space roughly equal to the size of what you&apos;re uploading,
          for the duration of that upload.
        </p>
      </section>

      <section style={INFORMATICS_LAST_SECTION_STYLE}>
        <p style={INFORMATICS_BODY_LAST_STYLE}>
          If a selection is larger than your currently available free space, it no longer fails
          or asks for space you don&apos;t have. It automatically becomes several smaller,
          roughly equal-sized uploads instead, sent one after another — never at the same time,
          since each one needs that same staging space to itself before the next can start. You
          will see the plan (how many parts, roughly how large each one is) before anything is
          sent, and a single progress indicator covers the whole sequence from start to finish.
          Once every part has gone through, they are tied together under one shared result, the
          same as a single, unsplit upload.
        </p>
      </section>
    </div>
  );
}

export default UploadInformatics;
