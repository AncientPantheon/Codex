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

/**
 * The mandatory, distinct permanence warning surfaced BEFORE a codex-backup
 * upload (`CodexBackupArea`) — never `UPLOAD_PERMANENCE_WARNING`'s text. A
 * codex backup carries a stronger, specific risk than a regular upload: the
 * codex password AT THE TIME OF THIS UPLOAD becomes the only thing protecting
 * every secret in the backup, permanently, with no rotation or revocation
 * possible once posted. This is a first-class exported value the confirm
 * dialog renders verbatim — never a buried log line.
 */
export const CODEX_BACKUP_PERMANENCE_WARNING =
  "Backing up your codex to Arweave is PERMANENT and PUBLIC. The codex " +
  "password you use RIGHT NOW becomes the ONLY thing protecting every secret " +
  "in this backup, FOREVER — there is no rotation and no revocation once it " +
  "is posted. If this password is ever guessed, leaked, or brute-forced, " +
  "every secret in this backup is exposed permanently. This is different " +
  "from a regular upload: review that your codex password is strong before " +
  "confirming.";

/**
 * The disclaimer surfaced in the Upload area once `"nft-data"` is the chosen
 * category — a first-class exported value the E4 UI renders verbatim, never
 * inlined in the component. Explains that Ouronet's own native NFTs store
 * their metadata on StoaChain itself (flexible, modifiable, no Arweave
 * dependency required), so by default an `nft-data` upload posts only the
 * bare asset file with no metadata attached; the optional second file picker
 * shown alongside this disclaimer exists purely for interoperability with
 * other blockchains/marketplaces that expect an off-chain metadata file
 * alongside the asset.
 */
export const NFT_METADATA_DISCLAIMER =
  "By default, only the asset file itself is uploaded to Arweave — no " +
  "metadata is attached. Ouronet's own NFTs store their metadata directly " +
  "on StoaChain, so they don't need an Arweave-hosted metadata file. " +
  "Attaching a metadata file below is optional and only needed for " +
  "interoperability with other blockchains or marketplaces that expect a " +
  "separate off-chain metadata file (commonly JSON) alongside the asset.";
