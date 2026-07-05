/**
 * Library-module constants shared across the upload/library/rebuild surfaces.
 *
 * These live in `src/library` because they are the canonical spelling both the
 * upload path and the Library persistence layer consume — the manifest
 * content-type detection and the permanence warning the E4 UI renders verbatim.
 */

/**
 * The Arweave path-manifest content-type. An upload whose Content-Type equals
 * this value is a manifest (a single data-item linking N files) — the Library
 * flags it as one entry / one link. Detection/labeling only; construction is a
 * caller concern.
 */
export const MANIFEST_CONTENT_TYPE = "application/x.arweave-manifest+json";

/**
 * The mandatory permanence warning surfaced BEFORE an upload. An Arweave upload
 * is irreversible: the data AND every tag are world-readable forever, and there
 * is no delete or edit. This is a first-class exported value the E4 confirm
 * dialog renders verbatim — never a buried log line.
 */
export const UPLOAD_PERMANENCE_WARNING =
  "This upload is PERMANENT and PUBLIC. Once submitted it cannot be deleted, " +
  "removed, edited, changed, or modified. The data and every tag you attach are " +
  "world-readable forever. Do not upload anything private, and review your tags " +
  "before confirming.";
