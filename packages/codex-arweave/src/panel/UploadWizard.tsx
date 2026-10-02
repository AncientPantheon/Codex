// UploadWizard — the guided Upload flow (arweave-upload-wizard).
//
// A real popup (`CodexModalShell`, the SAME chrome/import-path/invocation
// style `PureKeysArea.tsx` already established for this package) replacing
// `UploadArea.tsx`'s flat, always-visible form with a linear, always-
// revisitable step flow.
//
// OWNER CORRECTION PASS (post-first-build, see design.md's "Addendum —
// owner correction pass"): the first built version got the mechanics right
// but not the UX or the step order. This revision:
//   1. Restyles every control with this package's own `ACCENT` (`#ceac5f`)
//      gold pill/row convention (`ArweaveAccountsArea.tsx`/`PureKeysArea.tsx`)
//      — no bare default-browser-chrome `<button>`/`<select>` anywhere.
//   2. Reorders the steps to Account → Category+Mode (ONE combined step,
//      category driving a recommended-but-changeable Public/Encrypted
//      default) → Files → Review & Cost.
//   3. Rebuilds the file chooser: a repeatable "Add File" (capped at 10,
//      clear inline message past the cap) and a repeatable "Add Folder"
//      (multiple folder picks append, each folder's own name prefixed onto
//      its files' paths so two picks can never collide), a live running
//      total size, and per-file/per-folder removal.
//   4. Expands Review & Cost with the chosen account's live balance, the
//      estimated remaining balance after the upload (Confirm disabled when
//      it would go negative), and plain-language copy on what happens next.
//   5. Gates "Confirm & Upload" on an optional `ensureCodexUnlocked`.
//
// REUSE, NOT REIMPLEMENTATION: every piece of category/tag/bundle-routing
// logic `UploadArea.tsx` already built and tested is reused here verbatim —
// `CATEGORY_GROUPS` (the grouped taxonomy), `previewTags` (the tag-preview
// builder), and `isBundleResult` (the single-vs-bundle result
// discriminator) are all exported from `UploadArea.tsx` and imported here
// rather than copy-pasted a second time. `NFT_ASSET_TYPES`/
// `UPLOAD_PERMANENCE_WARNING` are reused from their own existing homes the
// same way `UploadArea.tsx` itself already reuses them. The ONE genuinely
// new wiring beyond this revision's own UI work is Step 4's live
// `estimateUploadCostAr` call.
//
// ONE internal step index plus ONE accumulating "draft" — changing steps,
// forward OR Back, never resets a previously made selection. Only the
// Review & Cost step triggers any side effect: entering it fetches a live
// cost estimate (loading/success/error, never blocking the rest of the
// review), and it is also where the mandatory permanence warning lives —
// this step IS the "are you sure" moment, so there is no second, separate
// permanence-confirm popup layered on top of it.
//
// SECOND OWNER CORRECTION ROUND (live-tested, screenshots — see design.md's
// "Addendum 2"): item 1 there (the tag-preview `name:value` separator) was
// already fixed directly; this revision covers the rest:
//   1. The category `<select>` and asset-type `<select>` are now custom
//      ACCENT-styled controls — a grouped dropdown (category, 24 options
//      across 9 groups) and a flat pill row (asset type, 7 options) — not
//      native `<select>`s. Zero bare `<select>`/default-chrome file-input
//      buttons remain anywhere in this component.
//   2. App-Id/App-Version render ONLY for `software-code`/
//      `website-dapp-hosting` — hidden (and cleared back to `""`, so
//      `buildSelection` omits them entirely) for every other category,
//      `nft-data` included.
//   3. The dedicated "Attach metadata (optional)" input/disclaimer is gone.
//      The Files step's existing multi-file list already fully subsumes
//      "add a second file for metadata" — 2+ files already ride the SAME
//      bundle path with no special-cased "first file = asset" distinction,
//      so no replacement/dead-code field was needed once the special case
//      was removed.
//   4. The 7-way asset-type picker is unchanged — still Ouronet-only, no
//      chain selector. A small clarifying label appears beside it for
//      `nft-data`.
//   5. Public/Encrypted get "(Recommended)"/"(Not recommended)" text ONLY
//      for `nft-data` (a judgment call — every other category already
//      communicates its recommendation via silent pre-selection alone, per
//      the first correction round, and the owner scoped this explicitly to
//      nft-data). Choosing Encrypted for `nft-data` shows a warning
//      SPECIFIC to that case (not the generic permanence warning): the
//      content won't be viewable anywhere expecting a public asset URL
//      without decrypting it through this codex first.
//   6. An advisory-only (never blocking) extension-mismatch warning shows
//      per file whose extension doesn't fit the chosen nft asset type — see
//      `ASSET_TYPE_EXTENSIONS` below for the exact lists per type.
//
// `UploadWizardSelection` widens `UploadArea.tsx`'s own `UploadCategorySelection`
// with one additional optional field, `encryptFor` — the EXACT
// `UploadEncryptFor` shape `library/flow.ts`'s `uploadAndTrack`/
// `uploadFilesAndTrack` already accept (`arweave-upload-encryption`, T5).

import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";
import {
  NFT_ASSET_TYPES,
  winstonToAr,
  TAG_APP_NAME,
  TAG_CONTENT_TYPE,
  TAG_CODEX_ITEM_ID,
  TAG_CODEX_OWNER,
  TAG_CODEX_TAG_SCHEMA_VERSION,
  TAG_CODEX_UPLOAD_ID,
  TAG_CODEX_ITEM_TYPE,
  TAG_CODEX_CATEGORY,
  TAG_CODEX_ASSET_TYPE,
  TAG_CODEX_APP_ID,
  TAG_CODEX_APP_VERSION,
  TAG_CODEX_ENCRYPTED,
  TAG_CODEX_ENCRYPTOR,
  TAG_CODEX_ENCRYPTION_VERSION,
  CODEX_ENCRYPTION_VERSION_CURRENT,
  type GatewayPool,
  type EstimateFeeGetPriceFn,
  type UploadCategory,
  type NftAssetType,
  type Tag,
} from "@ancientpantheon/arweave-core";
import { CodexModalShell } from "@ancientpantheon/codex-ouronet/ui";

import { UPLOAD_PERMANENCE_WARNING } from "../library/constants.js";
import type { UploadEncryptFor } from "../library/flow.js";
import type { ArweaveSeedAccountSource } from "./ArweaveSeedsArea.js";
import {
  CATEGORY_GROUPS,
  previewTags,
  isBundleResult,
  type UploadCategorySelection,
  type UploadTrackResult,
  type UploadBundleTrackResult,
} from "./UploadArea.js";
import { estimateUploadCostAr, type UploadCostEstimate } from "./estimateUploadCost.js";

/** {@link UploadArea.tsx}'s own mandatory-category selection, widened with
 *  one optional field: `encryptFor`, the exact shape `library/flow.ts`'s
 *  `uploadAndTrack`/`uploadFilesAndTrack` already accept for an Encrypted
 *  upload (T5, `arweave-upload-encryption`). Present only when the
 *  Category+Mode step's mode choice was Encrypted; absent (never a stub/
 *  empty object) for Public. */
export interface UploadWizardSelection extends UploadCategorySelection {
  encryptFor?: UploadEncryptFor;
}

export interface UploadWizardProps {
  /** This codex's own Arweave accounts — the Account step's picker. Each
   *  entry's `.id` IS its canonical Arweave address (`keyring/foreignKeys.ts`'s
   *  `toEncryptedEntry`), so no decryption is needed just to list them. */
  accounts: ForeignKeyEntry[];
  /** Activated Ouronet accounts offered by the Category+Mode step's
   *  encrypting-account sub-picker — the SAME shape `LibraryArea.tsx`'s
   *  `findEncryptorAccount` already consumes. */
  ouronetAccounts: readonly ArweaveSeedAccountSource[];
  /** The gateway pool the Review & Cost step's live cost estimate
   *  (`estimateUploadCostAr`) runs through. */
  pool: GatewayPool;
  /** E3 upload-then-append: uploads a single file under the chosen
   *  selection. Same (file, selection) call shape `UploadArea.tsx`'s own
   *  prop of the same name already takes, widened to an optional
   *  `encryptFor` (see {@link UploadWizardSelection}) AND a third, mandatory
   *  `accountId` — the Account step's own chosen `ForeignKeyEntry.id` (the
   *  SAME id this component's `accountId` state already holds, so no
   *  translation happens at the call site). Owner-reported Bug 1: before
   *  this parameter existed, the Account step's picker was purely cosmetic —
   *  nothing told the real implementation WHICH account should actually
   *  sign/pay for the upload, so it silently used whatever identity the
   *  host's deps happened to be constructed with, regardless of what the
   *  wizard showed as selected. */
  uploadAndTrack: (
    file: File,
    selection: UploadWizardSelection,
    accountId: string,
  ) => Promise<UploadTrackResult>;
  /** T7 bundle-aware upload-then-append: uploads 2+ files (or a folder), the
   *  SAME category selection applied to every item, as one atomic bundle.
   *  Same widening (including the mandatory `accountId`) as
   *  {@link UploadWizardProps.uploadAndTrack}. */
  uploadFilesAndTrack: (
    files: File[],
    selection: UploadWizardSelection,
    accountId: string,
  ) => Promise<UploadBundleTrackResult>;
  /** E3 openUrl: composes a healthy-gateway URL for a data-item id. */
  openUrl: (id: string) => string;
  /** Closes the wizard — wired to the modal's own close (×) AND the
   *  post-success "Done" button. */
  onClose: () => void;
  /** Unlock-gated reveal of an Ouronet account's decrypted secret — the SAME
   *  seam shape as `ArweavePanelDeps.revealAccountSecret`/`LibraryArea.tsx`'s
   *  own prop of the same name. Threaded verbatim into
   *  `UploadEncryptFor.revealAccountSecret` when Encrypted mode is chosen;
   *  this component never resolves or derives a key itself — that happens
   *  wherever the injected `uploadAndTrack`/`uploadFilesAndTrack` eventually
   *  calls it (`library/flow.ts`'s own `resolveEncryptionKey`). Omitted →
   *  an Encrypted upload's `encryptFor.revealAccountSecret` always resolves
   *  `null`, which `flow.ts` turns into its own specific
   *  "cannot encrypt this upload" error rather than a silent public upload. */
  revealAccountSecret?: (accountId: string) => Promise<string | null> | string | null;
  /** Injectable per-endpoint price-quote seam, forwarded verbatim into
   *  `estimateUploadCostAr` — tests inject a fake so the Review & Cost
   *  step's cost estimate never reaches a real gateway; a real caller
   *  omits it and gets `estimateFee`'s own default arweave-js client. */
  getPrice?: EstimateFeeGetPriceFn;
  /** Owner correction pass: a live AR balance read (winston bigint),
   *  keyed by address — the SAME seam shape `ArweavePanelDeps.getBalance`/
   *  `ArweaveAccountsArea.tsx`'s own prop of the same name already use.
   *  Feeds both the Account step's per-row balance and the Review & Cost
   *  step's chosen-account balance / estimated-remaining-balance
   *  computation. OPTIONAL and additive — a caller that omits it (every
   *  pre-this-task test) sees a plain "—" balance everywhere and no
   *  insufficient-balance gate (unknown balance never blocks Confirm). A
   *  real caller is wired by a parallel task directly from
   *  `ArweavePanelDeps.getBalance`. */
  getBalance?: (address: string) => Promise<bigint>;
  /** Owner correction pass: gates "Confirm & Upload" on the codex actually
   *  being unlocked — the SAME established pattern already used throughout
   *  `codex-ouronet`'s own modals (e.g. `RotatePaymentKeyModal.tsx`,
   *  `StakeUrStoaModal.tsx`): prompts for the password if the codex is
   *  locked, resolves `true` once unlocked, `false` on cancel. Called FIRST
   *  (if provided) on Confirm, BEFORE any upload is attempted; resolving
   *  `false` returns to the Review step with no error shown (a cancel is
   *  not a failure). OPTIONAL — omitted, Confirm proceeds exactly as
   *  before (backward compatible with any caller that doesn't supply it). */
  ensureCodexUnlocked?: () => Promise<boolean>;
  /** `arweave-non-removable-account` T4 — the SAME seam shape as
   *  `ArweavePanelDeps.onAccountUsedForEncryption`. Called ONCE, with the
   *  chosen encryptor's `accountId` (the exact id `buildSelection` put on
   *  `selection.encryptFor.accountId`), immediately after an Encrypted
   *  upload's `uploadAndTrack`/`uploadFilesAndTrack` call resolves
   *  successfully — never for a Public upload, and never on a rejected
   *  upload. OPTIONAL and additive — omitted, Confirm proceeds exactly as
   *  before (every pre-this-task test). */
  onAccountUsedForEncryption?: (accountId: string) => void;
}

type UploadMode = "" | "public" | "encrypted";
type UploadPhase = "idle" | "uploading" | "done" | "error";
type CostState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; estimate: UploadCostEstimate }
  | { status: "error"; message: string };
/** The live account-balance read state, keyed by address — mirrors
 *  `ArweaveAccountsArea.tsx`'s own `BalanceState` shape so both surfaces
 *  read the same way. */
type AccountBalanceState = { status: "loading" } | { status: "ready"; balance: bigint } | { status: "error" };

const STEP_LABELS = ["Account", "Category & Mode", "Files", "Review & Cost"] as const;
const LAST_STEP = STEP_LABELS.length - 1;

/** The gold accent this whole package's own established visual language
 *  uses (`ArweaveAccountsArea.tsx`/`PureKeysArea.tsx`'s own `ACCENT`) —
 *  applied here to every control, per the owner correction pass's explicit
 *  "no bare default-browser-chrome `<button>`/`<select>` anywhere". */
const ACCENT = "#ceac5f";

/** A selectable row/pill — accent-tinted background + border when active,
 *  plain otherwise. The SAME convention `ArweaveAccountsArea.tsx` uses
 *  throughout (e.g. its mobile position medallion's `selected` styling). */
function optionRowStyle(active: boolean): React.CSSProperties {
  return {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "10px 14px",
    borderRadius: 8,
    cursor: "pointer",
    border: `1px solid ${active ? ACCENT : "#262626"}`,
    backgroundColor: active ? `${ACCENT}1a` : "transparent",
    color: active ? ACCENT : "#d2d3d4",
  };
}

/** The primary (filled-gold) action button — mirrors `PureKeysArea.tsx`'s
 *  own "Save to Codex" button exactly (solid `ACCENT` fill, near-black
 *  text, `#262626`/dimmed when disabled). Used for Next/Confirm/Done. */
function primaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "8px 16px",
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 700,
    border: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    backgroundColor: disabled ? "#262626" : ACCENT,
    color: disabled ? "#555" : "#0a0a0a",
    opacity: disabled ? 0.7 : 1,
  };
}

/** The secondary (outlined) action button — mirrors `PureKeysArea.tsx`'s
 *  own "Choose Keyfile"/"Cancel" buttons exactly. Used for Back/Add File/
 *  Add Folder/Retry. */
function secondaryButtonStyle(disabled = false): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "8px 16px",
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? "default" : "pointer",
    border: "1px solid #262626",
    backgroundColor: "#111",
    color: disabled ? "#444" : "#888",
    opacity: disabled ? 0.6 : 1,
  };
}

/** The destructive (reddish-outline) small button — mirrors
 *  `ArweaveAccountsArea.tsx`'s own `dangerIconButtonStyle` palette. Used
 *  for per-file/per-folder removal. */
function dangerButtonStyle(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "4px 10px",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    border: "1px solid #7f1d1d",
    backgroundColor: "#1a0a0a",
    color: "#f87171",
  };
}

/** The plain text-input field chrome used throughout this package (e.g.
 *  `PureKeysArea.tsx`'s own label input) — applied to the app-id/
 *  app-version `<input>`s so neither renders as bare, unstyled browser
 *  chrome. The category/asset-type pickers are their own custom
 *  `optionRowStyle`/`secondaryButtonStyle` controls (round 2), not plain
 *  text inputs, so they don't use this. */
const fieldStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #262626",
  backgroundColor: "#111",
  color: "#d2d3d4",
  fontSize: 12,
};

/**
 * Category → recommended (pre-selected, still freely changeable) Public/
 * Encrypted default for the combined Category+Mode step (owner correction
 * pass, design.md addendum point 3). `nft-data` → Public is the owner's own
 * explicit call: "Ouronet's own NFTs store their metadata on StoaChain and
 * don't need Arweave-side privacy." Every other mapping is this task's own
 * judgment call, applying the same reasoning: a category whose whole POINT
 * is being found, shared, hosted, or verified by other people recommends
 * Public (creative work, code, dapp hosting, research, publications, public
 * statements, timestamping, memorials meant to be visited, broad historical
 * archives, gaming assets meant to be shown/traded); a category that is
 * inherently personal, or routinely carries OTHER people's private details,
 * recommends Encrypted (photos/videos/audio/journals/documents/medical/
 * financial/legal/credentials — all personally identifying; correspondence
 * and genealogy, which routinely name people who never consented to a
 * public record; event records, which commonly carry attendee details) —
 * and `general-other`, whose shape is unknown, defaults to the
 * privacy-safe choice rather than guessing Public.
 */
const CATEGORY_RECOMMENDED_MODE: Partial<Record<UploadCategory, UploadMode>> = {
  "personal-photos": "encrypted",
  "personal-videos": "encrypted",
  "personal-audio": "encrypted",
  "journals-writing": "encrypted",
  "personal-documents": "encrypted",
  "medical-records": "encrypted",
  "financial-records": "encrypted",
  "legal-records": "encrypted",
  "certificates-credentials": "encrypted",
  "creative-work": "public",
  "nft-data": "public",
  "software-code": "public",
  "website-dapp-hosting": "public",
  "research-data": "public",
  "publications-books": "public",
  "public-statement": "public",
  "proof-timestamping": "public",
  "memorial-legacy": "public",
  "historical-archive": "public",
  "genealogy-family-history": "encrypted",
  "correspondence-archive": "encrypted",
  "gaming-virtual-assets": "public",
  "event-records": "encrypted",
  "general-other": "encrypted",
};

/** Individual ("Add File") selections are capped at 10 — folder selections
 *  carry no cap (design.md addendum point 4). */
const MAX_INDIVIDUAL_FILES = 10;

/** A TEMPORARY total-upload-size cap — 1 GiB, the binary gibibyte value
 *  (1,073,741,824 bytes), not a decimal-GB approximation. The current
 *  bundle-assembly architecture holds roughly 2x the total upload size in
 *  browser memory (every file read fully into memory concurrently, then
 *  concatenated into a second buffer), so an uncapped multi-gigabyte
 *  selection can crash the tab mid-upload. A future streaming rewrite
 *  removes this cap entirely — until then it is enforced here, mirroring
 *  `MAX_INDIVIDUAL_FILES`'s own block-on-add pattern exactly: adding a
 *  file/folder that would push the RUNNING TOTAL over this cap is blocked
 *  outright (never partially added, and the cap applies to the total across
 *  every file/folder already selected plus the new one, not just the new
 *  one on its own), with a clear inline message reusing the SAME
 *  `fileCapMessage` state/UI the 10-file cap already uses. The boundary is
 *  INCLUSIVE — a running total of EXACTLY `MAX_TOTAL_SIZE_BYTES` is allowed;
 *  only a total that EXCEEDS it blocks. */
const MAX_TOTAL_SIZE_BYTES = 1_073_741_824;

/** The Files step's block-on-add message for the `MAX_TOTAL_SIZE_BYTES` cap
 *  — same plain, factual tone as `MAX_INDIVIDUAL_FILES`'s own inline
 *  message: names the actual total this add would have produced, states the
 *  limit explicitly, and is explicit that the cap is a TEMPORARY
 *  architecture limitation (not a permanent product decision), so it never
 *  reads as an alarming or permanent restriction. */
function totalSizeCapMessage(prospectiveTotalBytes: number): string {
  return (
    `Total selected size would be ${prospectiveTotalBytes} bytes — uploads are currently capped at 1 GiB ` +
    `(${MAX_TOTAL_SIZE_BYTES} bytes) while a larger-upload architecture is being built. This is a temporary ` +
    "limit, not a permanent one — remove a file, or split this into smaller batches, for now."
  );
}

/** Second owner correction round, point 2: App-Id/App-Version only apply
 *  conceptually to a category with its own app-version lineage — code and
 *  dapp hosting. Every other category (`nft-data` included) hides them. */
function showsAppFields(category: string): boolean {
  return category === "software-code" || category === "website-dapp-hosting";
}

/**
 * `arweave-tag-schema-spec` T4: the Review step's tag preview renders a
 * FIXED, CANONICAL set of rows in a FIXED order — this is that order,
 * copied verbatim from `packages/codex/ARWEAVE_TAG_SCHEMA.md` §2's own
 * canonical emission-order table (minus `Codex-Path`, a bundle-FILE-ITEM-
 * only tag with no single per-upload-action value to preview here). A row
 * whose condition doesn't hold for THIS upload still renders — with a
 * placeholder (see `NOT_APPLICABLE_*` below) rather than disappearing — so
 * the row layout never shifts shape based on what the user picked. This is
 * PRESENTATION ONLY: it changes nothing about what `previewTags`/the real
 * upload call actually emit on chain (see `tags` above, still computed
 * exactly as before).
 */
const CANONICAL_REVIEW_TAG_ROWS = [
  TAG_APP_NAME,
  TAG_CONTENT_TYPE,
  TAG_CODEX_ITEM_ID,
  TAG_CODEX_OWNER,
  TAG_CODEX_TAG_SCHEMA_VERSION,
  TAG_CODEX_UPLOAD_ID,
  TAG_CODEX_ITEM_TYPE,
  TAG_CODEX_CATEGORY,
  TAG_CODEX_ASSET_TYPE,
  TAG_CODEX_APP_ID,
  TAG_CODEX_APP_VERSION,
  TAG_CODEX_ENCRYPTED,
  TAG_CODEX_ENCRYPTOR,
  TAG_CODEX_ENCRYPTION_VERSION,
] as const;

/** Placeholder text for a row that doesn't apply to THIS upload because it
 *  is Public — `Codex-Encryptor`/`Codex-Encryption-Version` only. */
const NOT_APPLICABLE_PUBLIC = "— does not apply (public upload)";
/** Placeholder text for `Codex-App-Id`/`Codex-App-Version` outside
 *  `software-code`/`website-dapp-hosting` — mirrors `showsAppFields`. */
const NOT_APPLICABLE_NOT_APP = "— does not apply (not an app/site upload)";
/** Placeholder text for `Codex-Asset-Type` outside `category === "nft-data"`. */
const NOT_APPLICABLE_NOT_NFT = "— does not apply (not an NFT upload)";
/** Placeholder text for a row that DOES apply to this upload (its condition
 *  holds) but the caller hasn't actually supplied a value yet — e.g.
 *  `Codex-App-Id` left blank on a `software-code` upload. Distinct from the
 *  `NOT_APPLICABLE_*` placeholders above, which mean the row's CONDITION
 *  doesn't hold at all. */
const NOT_SET_PLACEHOLDER = "(not set)";

/**
 * Builds the Review step's fixed-row tag preview: `CANONICAL_REVIEW_TAG_ROWS`,
 * in order, every row always present. A row whose own condition doesn't hold
 * for this upload (`category`/`mode`-driven, matching `buildSelection`'s own
 * omission rules) renders its `NOT_APPLICABLE_*` placeholder; every other row
 * renders the real value `previewTags` computed in `tags` above, or
 * `NOT_SET_PLACEHOLDER` for a row that applies but has no value yet (e.g. an
 * as-yet-unfilled optional App-Id on a `software-code` upload).
 */
function buildReviewTagRows(
  tags: readonly Tag[],
  category: string,
  mode: UploadMode,
): { name: string; value: string }[] {
  const byName = new Map(tags.map((t) => [t.name, t.value]));
  const isNftData = category === "nft-data";
  const isEncrypted = mode === "encrypted";

  return CANONICAL_REVIEW_TAG_ROWS.map((name) => {
    if (name === TAG_CODEX_ASSET_TYPE && !isNftData) {
      return { name, value: NOT_APPLICABLE_NOT_NFT };
    }
    if ((name === TAG_CODEX_APP_ID || name === TAG_CODEX_APP_VERSION) && !showsAppFields(category)) {
      return { name, value: NOT_APPLICABLE_NOT_APP };
    }
    if ((name === TAG_CODEX_ENCRYPTOR || name === TAG_CODEX_ENCRYPTION_VERSION) && !isEncrypted) {
      return { name, value: NOT_APPLICABLE_PUBLIC };
    }
    return { name, value: byName.get(name) ?? NOT_SET_PLACEHOLDER };
  });
}

/** Second owner correction round, point 6: a non-blocking, advisory-only
 *  extension-mismatch check, per `NftAssetType`. Each list is this task's
 *  own judgment call of "common, recognizable extensions for the type" —
 *  NOT an exhaustive or authoritative format registry:
 *   - image: png, jpg, jpeg, gif, webp, svg, bmp (the task's own example)
 *   - audio: mp3, wav, ogg, flac, aac, m4a, wma
 *   - video: mp4, mov, webm, mkv, avi, m4v
 *   - document: pdf, doc, docx, txt, md, rtf, odt
 *   - archive: zip, rar, 7z, tar, gz, tgz
 *   - model: glb, gltf, obj, fbx, stl, usdz
 *   - exotic: deliberately EMPTY — "exotic" is nft-data's own catch-all for
 *     assets that don't fit the other 6 types, so by definition no
 *     extension is ever "wrong" for it; `isExtensionMismatch` below never
 *     flags an exotic-typed file. */
const ASSET_TYPE_EXTENSIONS: Record<NftAssetType, readonly string[]> = {
  image: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"],
  audio: ["mp3", "wav", "ogg", "flac", "aac", "m4a", "wma"],
  video: ["mp4", "mov", "webm", "mkv", "avi", "m4v"],
  document: ["pdf", "doc", "docx", "txt", "md", "rtf", "odt"],
  archive: ["zip", "rar", "7z", "tar", "gz", "tgz"],
  model: ["glb", "gltf", "obj", "fbx", "stl", "usdz"],
  exotic: [],
};

/** The lowercased extension of a file name (no leading dot), or `""` when
 *  the name carries none. */
function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/** Whether `fileName` looks like an unusual pick for `assetType` — ADVISORY
 *  ONLY (design.md addendum point 6: "never a hard gate"). `assetType` of
 *  `""` (none chosen yet) or `"exotic"` (no recognized set) never mismatch. */
function isExtensionMismatch(assetType: string, fileName: string): boolean {
  const allowed = ASSET_TYPE_EXTENSIONS[assetType as NftAssetType];
  if (!allowed || allowed.length === 0) return false;
  return !allowed.includes(fileExtension(fileName));
}

/** Second owner correction round, point 5: the nft-data-specific warning
 *  shown when Encrypted is chosen for an nft-data upload — NOT the generic
 *  permanence warning, which still renders unconditionally at Review. */
const NFT_ENCRYPTED_WARNING =
  "Encrypted nft-data won't be viewable anywhere that expects a public asset URL (galleries, marketplaces, viewers) — only this codex can decrypt and display it.";

/** One entry in the Files step's running selection. `path` is the DISPLAY
 *  (and collision-proofed) path — for an individually added file, just its
 *  own name; for a folder-added file, `${uniqueFolderName}/${relativePath}`.
 *  `id` is a stable per-entry identity independent of `path` (two
 *  individually added files could legitimately share a name), used for
 *  removal. `folderId` is present only for folder-added files — both the
 *  "remove this whole folder" grouping key and that folder's own
 *  (already-uniquified) display name, so two different folder picks can
 *  never collide even when the picked folders share a literal name. */
interface FileEntry {
  id: string;
  file: File;
  path: string;
  folderId?: string;
}

/** A `File` as `webkitdirectory` actually delivers it — `webkitRelativePath`
 *  is a non-standard property with no typed `File` member. */
type FileWithRelativePath = File & { webkitRelativePath?: string };

/** The top-level folder name a `webkitdirectory` pick's own files carry on
 *  `webkitRelativePath` (e.g. `"catA/img1.png"` → `"catA"`). Falls back to
 *  a generic label only when no file in the pick carries a relative path at
 *  all (an environment/stub with no such property). */
function folderNameFromPicked(picked: readonly File[]): string {
  const withPath = picked.find((f): f is FileWithRelativePath => {
    const rel = (f as FileWithRelativePath).webkitRelativePath;
    return typeof rel === "string" && rel.includes("/");
  });
  if (!withPath) return "folder";
  return (withPath as FileWithRelativePath).webkitRelativePath!.split("/")[0];
}

/** A folder-picked file's path relative to ITS OWN folder root (the part
 *  after the folder name itself) — falls back to the file's own name when
 *  no relative path is available. */
function relativePathWithinFolder(file: File): string {
  const rel = (file as FileWithRelativePath).webkitRelativePath;
  if (rel && rel.includes("/")) return rel.slice(rel.indexOf("/") + 1);
  return file.name;
}

/** Disambiguates a folder's own name against folder names already present
 *  in the running selection — the actual collision guard (design.md
 *  addendum point 4): two folder picks that happen to share a literal name
 *  still end up with distinct prefixes (`"catA"`, then `"catA (2)"`), not
 *  just two differently-named picks (the addendum's own example). */
function uniqueFolderName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} (${n})`)) n += 1;
  return `${base} (${n})`;
}

/** Renders a Winston bigint as a signed AR string — `winstonToAr` itself
 *  rejects negative input (arweave-core's own exact-precision guard), so a
 *  possibly-negative "estimated remaining balance" formats the sign itself
 *  and converts the absolute value. */
function formatSignedAr(winston: bigint): string {
  return winston < 0n ? `-${winstonToAr(-winston)}` : winstonToAr(winston);
}

export function UploadWizard(props: UploadWizardProps): React.ReactElement {
  const {
    accounts,
    ouronetAccounts,
    pool,
    uploadAndTrack,
    uploadFilesAndTrack,
    openUrl,
    onClose,
    revealAccountSecret,
    getPrice,
    getBalance,
    ensureCodexUnlocked,
    onAccountUsedForEncryption,
  } = props;

  const [step, setStep] = useState(0);

  // ── the one accumulating draft — Back never resets any of this ──
  const [accountId, setAccountId] = useState("");
  const [mode, setMode] = useState<UploadMode>("");
  const [encryptorAccountId, setEncryptorAccountId] = useState("");
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [fileCapMessage, setFileCapMessage] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [assetType, setAssetType] = useState("");
  const [appId, setAppId] = useState("");
  const [appVersion, setAppVersion] = useState("");

  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [result, setResult] = useState<UploadTrackResult | UploadBundleTrackResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [costState, setCostState] = useState<CostState>({ status: "idle" });
  const [balances, setBalances] = useState<Record<string, AccountBalanceState>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const entryIdSeqRef = useRef(0);

  const files = useMemo(() => fileEntries.map((e) => e.file), [fileEntries]);

  const isNftData = category === "nft-data";
  const categoryChosen = category !== "" && (!isNftData || assetType !== "");
  // Second owner correction round, point 3: no more dedicated
  // metadata-file special case — a user who wants metadata just adds a
  // second file in this SAME Files step, which already bundles 2+ files as
  // one atomic upload. Nothing here distinguishes "asset" from "metadata"
  // files beyond their own order in the list.
  const isBundle = files.length >= 2;

  /** The Category+Mode step's default encrypting account — whichever entry
   *  is flagged `isDefault` (this shape's own "Prime" equivalent — its own
   *  doc comment on `ArweaveSeedAccountSource.isDefault` reads "the default
   *  selection (CodexPrime)"), else the first entry. `""` when
   *  `ouronetAccounts` is empty (nothing to default to). */
  const defaultEncryptorId = useMemo(() => {
    if (ouronetAccounts.length === 0) return "";
    const flagged = ouronetAccounts.find((a) => a.isDefault === true);
    return (flagged ?? ouronetAccounts[0]).id;
  }, [ouronetAccounts]);

  // Pre-selects the default encryptor the FIRST time Encrypted mode is
  // chosen — guarded on `encryptorAccountId === ""` so it never overwrites
  // an explicit later choice, including across a Back-then-forward
  // round-trip (the choice already made stays made).
  useEffect(() => {
    if (mode === "encrypted" && encryptorAccountId === "" && defaultEncryptorId !== "") {
      setEncryptorAccountId(defaultEncryptorId);
    }
  }, [mode, defaultEncryptorId, encryptorAccountId]);

  const effectiveEncryptorId = encryptorAccountId !== "" ? encryptorAccountId : defaultEncryptorId;
  const encryptorAccount = ouronetAccounts.find((a) => a.id === effectiveEncryptorId);

  // Owner correction pass: every account's live AR balance (Account step's
  // own per-row display, and the Review & Cost step's chosen-account/
  // remaining-balance computation below) — fetched once `getBalance` is
  // wired. Omitted entirely → `balances` stays empty and every balance
  // display falls back to its own plain "—", exactly like
  // `ArweaveAccountsArea.tsx`'s own `getBalance`-omitted convention.
  useEffect(() => {
    if (!getBalance) return;
    let cancelled = false;
    accounts.forEach((acc) => {
      setBalances((prev) => ({ ...prev, [acc.id]: { status: "loading" } }));
      getBalance(acc.id)
        .then((balance) => {
          if (!cancelled) setBalances((prev) => ({ ...prev, [acc.id]: { status: "ready", balance } }));
        })
        .catch(() => {
          if (!cancelled) setBalances((prev) => ({ ...prev, [acc.id]: { status: "error" } }));
        });
    });
    return () => {
      cancelled = true;
    };
  }, [accounts, getBalance]);

  const canAdvance: Record<number, boolean> = {
    0: accountId !== "",
    1: categoryChosen && (mode === "public" || (mode === "encrypted" && effectiveEncryptorId !== "")),
    2: files.length > 0,
  };

  const totalByteSize = useMemo(
    () => fileEntries.reduce((sum, e) => sum + e.file.size, 0),
    [fileEntries],
  );

  const previewContentType =
    files.length === 1 ? files[0].type : files.length > 1 ? "(multiple files)" : "";
  const tags: Tag[] =
    accountId !== "" && files.length > 0
      ? previewTags(accountId, previewContentType, {
          category,
          assetType,
          appId,
          appVersion,
          // Mirrors exactly what the real upload call (below) will send:
          // undefined while no mode is chosen yet (no tag shown); "true"/
          // "false" once Public or Encrypted is picked; the encryptor's OWN
          // Ouronet address (never an Arweave-canonical one) alongside
          // "true", the exact same value `encryptFor.accountAddress` uses.
          encrypted: mode === "" ? undefined : mode === "encrypted",
          encryptorAddress: mode === "encrypted" ? encryptorAccount?.account.address : undefined,
          // Mirrors `flow.ts`'s own `uploadAndTrack`: the pinned CURRENT
          // encryption-procedure version, never a free-form value, present
          // iff this upload is actually encrypted (arweave-tag-schema-spec
          // T4).
          encryptionVersion: mode === "encrypted" ? CODEX_ENCRYPTION_VERSION_CURRENT : undefined,
        })
      : [];

  // The Review step's own FIXED, CANONICAL row set — built from `tags`
  // above (never altering what it contains), never changing shape based on
  // `category`/`mode` (arweave-tag-schema-spec T4).
  const reviewTagRows = buildReviewTagRows(tags, category, mode);

  // The Review & Cost step's live cost estimate — fetched fresh every time
  // the step is entered, or the byte size it prices changes while already
  // there. Never blocks the rest of the review from rendering while in
  // flight or on failure (`costState` is its own independent piece of
  // state).
  useEffect(() => {
    if (step !== LAST_STEP) return;
    let cancelled = false;
    setCostState({ status: "loading" });
    (async () => {
      try {
        const estimate = await estimateUploadCostAr(pool, totalByteSize, { getPrice });
        if (!cancelled) setCostState({ status: "success", estimate });
      } catch (err) {
        if (!cancelled) {
          setCostState({
            status: "error",
            message: err instanceof Error ? err.message : "Could not estimate the upload cost.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, totalByteSize, pool, getPrice]);

  // Owner-reported Bug 2: the Account step's list is sorted highest-balance-
  // first, since this component already fetches every account's own live
  // balance (the effect above) regardless of which one is selected. An
  // account whose balance hasn't resolved yet (still "loading") or failed to
  // resolve ("error") sorts AFTER every account with a known balance — a
  // stable sort (`Array.prototype.sort` is stable, per spec), so two
  // accounts that tie (same known balance, or both unknown) keep their
  // original relative order rather than reshuffling unpredictably.
  const sortedAccounts = useMemo(() => {
    const knownBalance = (acc: ForeignKeyEntry): bigint | null => {
      const state = balances[acc.id];
      return state?.status === "ready" ? state.balance : null;
    };
    return [...accounts].sort((a, b) => {
      const av = knownBalance(a);
      const bv = knownBalance(b);
      if (av !== null && bv !== null) {
        if (av === bv) return 0;
        return av > bv ? -1 : 1;
      }
      if (av !== null) return -1; // a known, b unknown — a sorts first
      if (bv !== null) return 1; // b known, a unknown — b sorts first
      return 0; // both unknown — preserve original order
    });
  }, [accounts, balances]);

  const selectedAccountBalance = balances[accountId];
  const knownBalanceWinston = selectedAccountBalance?.status === "ready" ? selectedAccountBalance.balance : null;
  const knownCostWinston = costState.status === "success" ? costState.estimate.winston : null;
  // "Estimated remaining balance after the upload" (design.md addendum
  // point 5) — `null` (no warning/block shown at all) until BOTH the
  // chosen account's balance and the cost estimate are actually known;
  // never a guess against a half-loaded value.
  const remainingWinston =
    knownBalanceWinston !== null && knownCostWinston !== null ? knownBalanceWinston - knownCostWinston : null;
  // A HARD block (Confirm disabled), not just a warning — design.md
  // addendum point 5: "unless the chosen account's balance is YES less than
  // the cost, in which case Confirm should be disabled."
  const insufficientBalance = remainingWinston !== null && remainingWinston < 0n;

  function onAddFile(ev: React.ChangeEvent<HTMLInputElement>): void {
    const picked = ev.target.files?.[0] ?? null;
    ev.target.value = ""; // allow re-picking the same filename later
    if (!picked) return;
    const individualCount = fileEntries.filter((e) => e.folderId === undefined).length;
    if (individualCount >= MAX_INDIVIDUAL_FILES) {
      setFileCapMessage(
        `You've added ${MAX_INDIVIDUAL_FILES} individual files, the limit for "Add File". Use "Add Folder" instead to upload more at once.`,
      );
      return;
    }
    const prospectiveTotal = totalByteSize + picked.size;
    if (prospectiveTotal > MAX_TOTAL_SIZE_BYTES) {
      setFileCapMessage(totalSizeCapMessage(prospectiveTotal));
      return;
    }
    setFileCapMessage(null);
    entryIdSeqRef.current += 1;
    setFileEntries((prev) => [...prev, { id: `entry-${entryIdSeqRef.current}`, file: picked, path: picked.name }]);
  }

  function onAddFolder(ev: React.ChangeEvent<HTMLInputElement>): void {
    const picked = Array.from(ev.target.files ?? []);
    ev.target.value = ""; // allow re-picking the same folder later
    if (picked.length === 0) return;
    // The 1 GiB total-size cap applies to the whole folder pick at once —
    // never a partial add (see MAX_TOTAL_SIZE_BYTES above): if the folder's
    // OWN combined size, added to what's already selected, would exceed the
    // cap, the entire pick is blocked outright.
    const pickedTotal = picked.reduce((sum, f) => sum + f.size, 0);
    const prospectiveTotal = totalByteSize + pickedTotal;
    if (prospectiveTotal > MAX_TOTAL_SIZE_BYTES) {
      setFileCapMessage(totalSizeCapMessage(prospectiveTotal));
      return;
    }
    setFileEntries((prev) => {
      const takenFolderNames = new Set(
        prev.map((e) => e.folderId).filter((n): n is string => n !== undefined),
      );
      const folderName = uniqueFolderName(folderNameFromPicked(picked), takenFolderNames);
      const added = picked.map((file) => {
        entryIdSeqRef.current += 1;
        return {
          id: `entry-${entryIdSeqRef.current}`,
          file,
          path: `${folderName}/${relativePathWithinFolder(file)}`,
          folderId: folderName,
        };
      });
      return [...prev, ...added];
    });
    setFileCapMessage(null);
  }

  function onRemoveFile(id: string): void {
    setFileEntries((prev) => prev.filter((e) => e.id !== id));
  }

  function onRemoveFolder(folderId: string): void {
    setFileEntries((prev) => prev.filter((e) => e.folderId !== folderId));
  }

  function onCategoryChange(value: string): void {
    setCategory(value);
    // Mirrors `UploadArea.tsx`'s own rule: switching away from nft-data
    // drops any previously chosen asset-type so a stale value never
    // silently rides along under a different category.
    if (value !== "nft-data") {
      setAssetType("");
    }
    // Second owner correction round, point 2: App-Id/App-Version only show
    // for software-code/website-dapp-hosting — switching away from both
    // clears the draft (never a stale, hidden value sent through as a tag).
    if (!showsAppFields(value)) {
      setAppId("");
      setAppVersion("");
    }
    // Owner correction pass: picking a category drives a RECOMMENDED (not
    // forced) Public/Encrypted default — still freely changeable via the
    // Public/Encrypted buttons below.
    const recommended = CATEGORY_RECOMMENDED_MODE[value as UploadCategory];
    if (recommended) setMode(recommended);
  }

  function buildSelection(): UploadWizardSelection {
    const selection: UploadWizardSelection = {
      category: category as UploadCategory,
      ...(assetType !== "" ? { assetType: assetType as NftAssetType } : {}),
      ...(appId !== "" ? { appId } : {}),
      ...(appVersion !== "" ? { appVersion } : {}),
    };
    if (mode === "encrypted" && encryptorAccount !== undefined) {
      selection.encryptFor = {
        accountId: encryptorAccount.id,
        accountAddress: encryptorAccount.account.address,
        revealAccountSecret: revealAccountSecret ?? (() => null),
      };
    }
    return selection;
  }

  async function onConfirmUpload(): Promise<void> {
    if (phase === "uploading" || files.length === 0 || !categoryChosen || insufficientBalance) return;
    // Owner correction pass: gate on the codex being unlocked BEFORE
    // attempting to sign anything. A cancel (`false`) is not a failure —
    // stay on the Review step with no error, same as never having clicked
    // Confirm at all.
    if (ensureCodexUnlocked) {
      const unlocked = await ensureCodexUnlocked();
      if (!unlocked) return;
    }
    setPhase("uploading");
    setErrorMessage(null);
    try {
      const selection = buildSelection();
      // Owner-reported Bug 1: thread the Account step's OWN chosen id
      // through verbatim — this is what makes the real signing/paying key
      // actually track the wizard's selection instead of whatever identity
      // the host's deps were constructed with.
      const res = isBundle
        ? await uploadFilesAndTrack(files, selection, accountId)
        : await uploadAndTrack(files[0], selection, accountId);
      setResult(res);
      setPhase("done");
      // `arweave-non-removable-account` T4: the ONE place this component
      // fires the non-removable-account trigger — only once the upload has
      // actually resolved successfully, and only for an Encrypted upload
      // (mirrors `library/flow.ts`'s own `onAccountUsedForEncryption`
      // contract: "never called for an unencrypted upload, and never called
      // when the upload rejects").
      if (selection.encryptFor) {
        onAccountUsedForEncryption?.(selection.encryptFor.accountId);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Upload failed.");
      setPhase("error");
    }
  }

  function onRetry(): void {
    setPhase("idle");
    setErrorMessage(null);
  }

  function goNext(): void {
    if (canAdvance[step] !== true) return;
    setStep((s) => Math.min(LAST_STEP, s + 1));
  }

  function goBack(): void {
    setStep((s) => Math.max(0, s - 1));
  }

  function balanceText(state: AccountBalanceState | undefined): string {
    if (state?.status === "ready") return `${winstonToAr(state.balance)} AR`;
    if (state?.status === "loading") return "…";
    return "—";
  }

  /** One Files-step entry's row, SHARED between the folder-grouped and
   *  individual-file lists — factored out so the second owner correction
   *  round's advisory extension-mismatch warning (point 6) is written once,
   *  not duplicated across both call sites. */
  function renderFileEntry(entry: FileEntry): React.ReactElement {
    const mismatch = isNftData && assetType !== "" && isExtensionMismatch(assetType, entry.file.name);
    return (
      <li
        key={entry.id}
        data-testid="upload-wizard-file-entry"
        style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>
            {entry.path} — {entry.file.size} bytes
          </span>
          <button
            type="button"
            data-testid={`upload-wizard-remove-file-${entry.id}`}
            onClick={() => onRemoveFile(entry.id)}
            style={dangerButtonStyle()}
          >
            Remove
          </button>
        </div>
        {mismatch ? (
          <p
            data-testid={`upload-wizard-extension-mismatch-${entry.id}`}
            style={{ color: "#f0b429", fontSize: 11, margin: 0 }}
          >
            This doesn&apos;t look like a typical {assetType} file — proceed anyway?
          </p>
        ) : null}
      </li>
    );
  }

  const selectedAccount = accounts.find((a) => a.id === accountId);

  let body: React.ReactElement;

  if (step === 0) {
    body = (
      <div data-testid="upload-wizard-step-account">
        <p>Which of this codex&apos;s Arweave accounts pays for and owns this upload?</p>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {sortedAccounts.map((acc) => (
            <li key={acc.id}>
              <button
                type="button"
                data-testid={`upload-wizard-account-${acc.id}`}
                aria-pressed={accountId === acc.id}
                onClick={() => setAccountId(acc.id)}
                style={optionRowStyle(accountId === acc.id)}
              >
                <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span>
                    <strong>{acc.label ?? "Untitled account"}</strong>
                    <span style={{ display: "block", fontSize: 11, color: "#888" }}>{acc.id}</span>
                  </span>
                  <span
                    data-testid={`upload-wizard-account-balance-${acc.id}`}
                    style={{ fontSize: 12, fontFamily: "monospace", color: "#888", flexShrink: 0 }}
                  >
                    {balanceText(balances[acc.id])}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  } else if (step === 1) {
    body = (
      <div data-testid="upload-wizard-step-category-mode">
        <p>Which category best describes this upload?</p>
        <div style={{ position: "relative" }}>
          <button
            type="button"
            data-testid="upload-wizard-category"
            aria-haspopup="listbox"
            aria-expanded={categoryMenuOpen}
            onClick={() => setCategoryMenuOpen((open) => !open)}
            style={{ ...secondaryButtonStyle(), width: "100%", justifyContent: "space-between" }}
          >
            {category !== "" ? category : "Select a category…"}
          </button>
          {categoryMenuOpen ? (
            <div
              data-testid="upload-wizard-category-menu"
              style={{
                marginTop: 8,
                display: "flex",
                flexDirection: "column",
                gap: 10,
                border: "1px solid #262626",
                borderRadius: 8,
                padding: 10,
                maxHeight: 320,
                overflowY: "auto",
                backgroundColor: "#0a0a0a",
              }}
            >
              {CATEGORY_GROUPS.map((group) => (
                <div key={group.label}>
                  <p style={{ margin: "0 0 4px", fontSize: 11, color: "#888", textTransform: "uppercase" }}>
                    {group.label}
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {group.categories.map((c) => (
                      <button
                        key={c}
                        type="button"
                        data-testid={`upload-wizard-category-option-${c}`}
                        aria-pressed={category === c}
                        onClick={() => {
                          onCategoryChange(c);
                          setCategoryMenuOpen(false);
                        }}
                        style={optionRowStyle(category === c)}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {isNftData ? (
          <div style={{ marginTop: 16 }}>
            <p data-testid="upload-wizard-nft-asset-type-label" style={{ fontSize: 12, color: ACCENT, margin: "0 0 8px" }}>
              Ouronet Collectables — SFTs &amp; NFTs
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {NFT_ASSET_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  data-testid={`upload-wizard-asset-type-option-${t}`}
                  aria-pressed={assetType === t}
                  onClick={() => setAssetType(t)}
                  style={optionRowStyle(assetType === t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {showsAppFields(category) ? (
          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            <input
              type="text"
              data-testid="upload-wizard-app-id"
              placeholder="App-Id (optional)"
              value={appId}
              onChange={(ev) => setAppId(ev.target.value)}
              style={fieldStyle}
            />
            <input
              type="text"
              data-testid="upload-wizard-app-version"
              placeholder="App-Version (optional)"
              value={appVersion}
              onChange={(ev) => setAppVersion(ev.target.value)}
              style={fieldStyle}
            />
          </div>
        ) : null}

        <div style={{ marginTop: 16 }}>
          <p>Should this upload be Public or Encrypted?</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              data-testid="upload-wizard-mode-public"
              aria-pressed={mode === "public"}
              onClick={() => setMode("public")}
              style={optionRowStyle(mode === "public")}
            >
              Public{isNftData ? " (Recommended)" : ""}
            </button>
            <button
              type="button"
              data-testid="upload-wizard-mode-encrypted"
              aria-pressed={mode === "encrypted"}
              onClick={() => setMode("encrypted")}
              style={optionRowStyle(mode === "encrypted")}
            >
              Encrypted{isNftData ? " (Not recommended)" : ""}
            </button>
          </div>
          {isNftData && mode === "encrypted" ? (
            <p
              data-testid="upload-wizard-nft-encrypted-warning"
              role="alert"
              style={{ color: "#f87171", fontSize: 12, marginTop: 8 }}
            >
              {NFT_ENCRYPTED_WARNING}
            </p>
          ) : null}
          {mode === "encrypted" ? (
            <div data-testid="upload-wizard-encryptor-picker" style={{ marginTop: 12 }}>
              <p>Which Ouronet account encrypts this upload?</p>
              {ouronetAccounts.length === 0 ? (
                <p style={{ color: "#888" }}>This codex holds no Ouronet accounts to encrypt under.</p>
              ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                  {ouronetAccounts.map((acc) => (
                    <li key={acc.id}>
                      <button
                        type="button"
                        data-testid={`upload-wizard-encryptor-${acc.id}`}
                        aria-pressed={effectiveEncryptorId === acc.id}
                        onClick={() => setEncryptorAccountId(acc.id)}
                        style={optionRowStyle(effectiveEncryptorId === acc.id)}
                      >
                        <strong>{acc.label}</strong>
                        <span style={{ display: "block", fontSize: 11, color: "#888" }}>{acc.account.address}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      </div>
    );
  } else if (step === 2) {
    const individualFileCount = fileEntries.filter((e) => e.folderId === undefined).length;
    const folderIds = Array.from(
      new Set(fileEntries.filter((e) => e.folderId !== undefined).map((e) => e.folderId as string)),
    );
    body = (
      <div data-testid="upload-wizard-step-files">
        <p>Add the file(s) or folder(s) to upload.</p>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            data-testid="upload-wizard-add-file-button"
            onClick={() => fileInputRef.current?.click()}
            style={secondaryButtonStyle()}
          >
            Add File
          </button>
          <button
            type="button"
            data-testid="upload-wizard-add-folder-button"
            onClick={() => folderInputRef.current?.click()}
            style={secondaryButtonStyle()}
          >
            Add Folder
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          data-testid="upload-wizard-add-file-input"
          onChange={onAddFile}
          style={{ display: "none" }}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          // See `UploadArea.tsx`'s identical cast/comment — `webkitdirectory`
          // is a non-standard boolean attribute with no typed React prop.
          {...({ webkitdirectory: "" } as Record<string, string>)}
          data-testid="upload-wizard-add-folder-input"
          onChange={onAddFolder}
          style={{ display: "none" }}
        />
        <p style={{ fontSize: 11, color: "#888" }}>
          Individual files: {individualFileCount} / {MAX_INDIVIDUAL_FILES}. Need more than that at once? Use
          &quot;Add Folder&quot; instead — folders carry no file-count limit.
        </p>
        {fileCapMessage ? (
          <p data-testid="upload-wizard-file-cap-message" role="alert" style={{ color: "#f87171", fontSize: 12 }}>
            {fileCapMessage}
          </p>
        ) : null}
        {fileEntries.length > 0 ? (
          <>
            <p data-testid="upload-wizard-file-total-size">Total size: {totalByteSize} bytes</p>
            <ul
              data-testid="upload-wizard-file-preview"
              style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}
            >
              {folderIds.map((folderId) => (
                <li
                  key={folderId}
                  data-testid={`upload-wizard-folder-group-${folderId}`}
                  style={{ border: "1px solid #262626", borderRadius: 8, padding: 8 }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <strong style={{ fontSize: 12 }}>{folderId}</strong>
                    <button
                      type="button"
                      data-testid={`upload-wizard-remove-folder-${folderId}`}
                      onClick={() => onRemoveFolder(folderId)}
                      style={dangerButtonStyle()}
                    >
                      Remove folder
                    </button>
                  </div>
                  <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                    {fileEntries.filter((e) => e.folderId === folderId).map(renderFileEntry)}
                  </ul>
                </li>
              ))}
              {fileEntries.filter((e) => e.folderId === undefined).map(renderFileEntry)}
            </ul>
          </>
        ) : null}
      </div>
    );
  } else {
    // step === LAST_STEP (3): Review & Cost.
    body = (
      <div data-testid="upload-wizard-step-review">
        <ul>
          <li>Account: {selectedAccount?.label ?? selectedAccount?.id ?? "—"}</li>
          <li data-testid="upload-wizard-review-balance">Balance: {balanceText(selectedAccountBalance)}</li>
          <li>Mode: {mode === "encrypted" ? `Encrypted (${encryptorAccount?.label ?? "—"})` : "Public"}</li>
          <li>Files: {files.length}</li>
          <li>Total size: {totalByteSize} bytes</li>
          <li>Category: {category}</li>
        </ul>

        {costState.status === "loading" ? (
          <p data-testid="upload-wizard-cost-loading">Estimating the network fee…</p>
        ) : null}
        {costState.status === "success" ? (
          <p data-testid="upload-wizard-cost-estimate">Network fee: ~{costState.estimate.ar} AR</p>
        ) : null}
        {costState.status === "error" ? (
          <p data-testid="upload-wizard-cost-error" role="alert">
            Could not estimate the network fee: {costState.message}
          </p>
        ) : null}

        {remainingWinston !== null ? (
          <p data-testid="upload-wizard-remaining-balance">
            Estimated remaining balance after this upload: {formatSignedAr(remainingWinston)} AR
          </p>
        ) : null}
        {insufficientBalance ? (
          <p data-testid="upload-wizard-insufficient-balance" role="alert">
            This account doesn&apos;t hold enough AR to cover the estimated network fee. Add funds, or choose a
            different account, before continuing.
          </p>
        ) : null}

        <ul data-testid="upload-wizard-tag-preview" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {reviewTagRows.map((row) => (
            <li
              key={row.name}
              style={{ display: "flex", gap: 8, fontFamily: "monospace", fontSize: 12, padding: "2px 0" }}
            >
              <span style={{ color: ACCENT, flexShrink: 0 }}>{row.name}:</span>
              <span style={{ color: "#ccc", wordBreak: "break-all" }}>{row.value}</span>
            </li>
          ))}
        </ul>

        <p data-testid="upload-wizard-permanence-warning">{UPLOAD_PERMANENCE_WARNING}</p>

        <div
          data-testid="upload-wizard-review-explainer"
          style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "#aaa" }}
        >
          <p data-testid="upload-wizard-review-explainer-transaction">
            This upload posts as a single transaction — or one bundle transaction, for multiple files — so there is
            nothing further to babysit once you confirm.
          </p>
          <p data-testid="upload-wizard-review-explainer-pending">
            It will appear in your Library immediately, marked &quot;pending&quot;.
          </p>
          <p data-testid="upload-wizard-review-explainer-blocktime">
            Arweave&apos;s own block time is roughly two minutes, so full on-chain confirmation takes a little while
            after that.
          </p>
          <p data-testid="upload-wizard-review-explainer-metadata">
            The tags and versioning above are transaction metadata, entirely separate from the file bytes — they can
            never alter or corrupt the uploaded content.
          </p>
          <p data-testid="upload-wizard-review-link-pattern">
            Once posted, your files will be reachable at https://&lt;gateway&gt;/&lt;id&gt; — the exact links appear
            here once the upload completes.
          </p>
        </div>

        <button
          type="button"
          data-testid="upload-wizard-confirm-upload"
          disabled={phase === "uploading" || files.length === 0 || !categoryChosen || insufficientBalance}
          onClick={() => {
            void onConfirmUpload();
          }}
          style={primaryButtonStyle(phase === "uploading" || files.length === 0 || !categoryChosen || insufficientBalance)}
        >
          {phase === "uploading" ? "Uploading…" : "Confirm & Upload"}
        </button>
      </div>
    );
  }

  return (
    <CodexModalShell
      title="Start Upload"
      subtitle={STEP_LABELS[step]}
      onClose={onClose}
      accent={ACCENT}
      maxWidth={640}
      dialogTestId="upload-wizard-modal"
      closeTestId="upload-wizard-close"
    >
      {phase === "done" && result ? (
        isBundleResult(result) ? (
          <div data-testid="upload-wizard-bundle-result">
            <p>{result.manifestId}</p>
            <a href={openUrl(result.manifestId)}>Open the manifest on the permaweb</a>
            <p>{result.fileIds.length} files uploaded</p>
            <button
              type="button"
              data-testid="upload-wizard-done"
              onClick={onClose}
              style={primaryButtonStyle(false)}
            >
              Done
            </button>
          </div>
        ) : (
          <div data-testid="upload-wizard-result">
            <p>{result.id}</p>
            <a href={openUrl(result.id)}>Open on the permaweb</a>
            <button
              type="button"
              data-testid="upload-wizard-done"
              onClick={onClose}
              style={primaryButtonStyle(false)}
            >
              Done
            </button>
          </div>
        )
      ) : phase === "error" ? (
        <div data-testid="upload-wizard-error" role="alert">
          <p>{errorMessage}</p>
          <button
            type="button"
            data-testid="upload-wizard-retry"
            onClick={onRetry}
            style={secondaryButtonStyle()}
          >
            Back to review
          </button>
        </div>
      ) : (
        <>
          {body}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
            <button
              type="button"
              data-testid="upload-wizard-back"
              onClick={goBack}
              disabled={step === 0 || phase === "uploading"}
              style={secondaryButtonStyle(step === 0 || phase === "uploading")}
            >
              Back
            </button>
            {step < LAST_STEP ? (
              <button
                type="button"
                data-testid="upload-wizard-next"
                onClick={goNext}
                disabled={!canAdvance[step]}
                style={primaryButtonStyle(!canAdvance[step])}
              >
                Next
              </button>
            ) : null}
          </div>
        </>
      )}
    </CodexModalShell>
  );
}

export default UploadWizard;
