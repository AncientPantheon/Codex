// The UPLOAD area of the Arweave panel (E-10, N-10).
//
// Presentation over E3's upload-then-append flow: a file picker computes a TAG
// PREVIEW (the full required tag set — App-Name/Content-Type/Codex-Item-Id/
// Codex-Owner plus T7's Codex-Tag-Schema-Version/Codex-Upload-Id/Codex-Item-
// Type — Codex-Owner === the selected address) BEFORE any upload; a MANDATORY
// permanence confirm (E3's UPLOAD_PERMANENCE_WARNING, verbatim) gates the
// upload; a non-re-entrant progress indicator runs while the injected upload
// seam is pending; on success the result surfaces; on failure a clear error
// surfaces and NO phantom entry is added.
//
// T7 — file AND folder picker: the (now `multiple`) file input plus an
// additional `webkitdirectory` folder input both feed ONE `files: File[]`
// selection. A single picked file takes the ORIGINAL single-file path
// (`uploadAndTrack`, unchanged result view); 2+ files (from either input)
// take the NEW bundle-aware path (`uploadFilesAndTrack`, injected the SAME
// way as `uploadAndTrack` — a distinct result view: the manifest link plus a
// count of files uploaded) — mirrors `uploadBundle`'s own "a single file
// uses the plain path instead" rule, so a 1-file selection never pays
// bundle/manifest overhead.
//
// `arweave-upload-categories` (T5) — a category is MANDATORY on every
// upload, never a silent default (design doc's own acceptance criterion): the
// Upload button stays disabled until BOTH a file/folder selection AND a
// category are chosen. The category `<select>` is populated from
// `UPLOAD_CATEGORIES` EXCLUDING `"foreign"` (Topic 3's retroactive-add flow,
// never a choice for a NEW upload) and `"codex-backup"` (its own dedicated
// `CodexBackupArea` entry point sets that category itself) — 24 of the 26
// enum values, grouped via `<optgroup>` matching the design doc's grouped
// table (minus its Codex/Provenance groups, which have no selectable member
// here). Picking `"nft-data"` reveals a second REQUIRED `<select>` for
// `assetType` (from `NFT_ASSET_TYPES`) that also gates the button; any other
// category never shows it. `appId`/`appVersion` are optional free-text
// inputs, always visible, never gating the button. The chosen
// category/assetType/appId/appVersion are (a) added to the tag preview
// whenever they have a value and (b) wired into the `uploadAndTrack`/
// `uploadFilesAndTrack` calls as a second `selection` argument.
//
// Secret hygiene (N-06): the JWK never reaches this layer — both upload seams
// are injected and return only public metadata. No key field is ever rendered.
//
// `arweave-upload-categories` addendum — optional NFT metadata attachment:
// Ouronet's own native NFTs store their metadata on StoaChain itself and
// never need an Arweave-hosted metadata file, so by default an `nft-data`
// upload is just the bare asset file — `NFT_METADATA_DISCLAIMER` says so
// explicitly, gated on `category === "nft-data"` exactly like the asset-type
// picker. An OPTIONAL second file input (not restricted to `.json` — any
// metadata format is selectable) lets a user attach one for interoperability
// with other chains/marketplaces. When exactly 1 asset file is selected AND
// a metadata file is attached, the upload reuses the EXISTING bundle path
// (`uploadFilesAndTrack([assetFile, metadataFile], selection)`) instead of
// the single-file path — Codex never reads/parses/rewrites the metadata
// file's contents, it is bundled as-is. With no metadata attached, behavior
// is unchanged (1 file → `uploadAndTrack`, 2+ files → `uploadFilesAndTrack`).

import * as React from "react";
import { useState } from "react";

import {
  TAG_APP_NAME,
  TAG_CONTENT_TYPE,
  TAG_CODEX_ITEM_ID,
  TAG_CODEX_OWNER,
  TAG_CODEX_TAG_SCHEMA_VERSION,
  CODEX_TAG_SCHEMA_VERSION_CURRENT,
  TAG_CODEX_UPLOAD_ID,
  TAG_CODEX_ITEM_TYPE,
  TAG_CODEX_CATEGORY,
  TAG_CODEX_ASSET_TYPE,
  TAG_CODEX_APP_ID,
  TAG_CODEX_APP_VERSION,
  TAG_CODEX_ENCRYPTED,
  TAG_CODEX_ENCRYPTOR,
  TAG_CODEX_ENCRYPTION_VERSION,
  DEFAULT_APP_NAME,
  NFT_ASSET_TYPES,
  type Tag,
  type UploadCategory,
  type NftAssetType,
} from "@ancientpantheon/arweave-core";

import { UPLOAD_PERMANENCE_WARNING, NFT_METADATA_DISCLAIMER } from "../library/constants.js";

/** The E3 upload-then-append result the Upload area renders for a SINGLE file. */
export interface UploadTrackResult {
  id: string;
  itemId: string;
  ownerAddress: string;
  tags: unknown[];
}

/** The T7 bundle-aware upload-then-append result for 2+ files/a folder. */
export interface UploadBundleTrackResult {
  manifestId: string;
  fileIds: { path: string; id: string }[];
  uploadId: string;
}

/**
 * The mandatory-category selection wired into every `uploadAndTrack`/
 * `uploadFilesAndTrack` call (T5). `category` is REQUIRED — the button never
 * enables without one; `assetType` is present only when `category ===
 * "nft-data"`; `appId`/`appVersion` are always optional.
 */
export interface UploadCategorySelection {
  category: UploadCategory;
  assetType?: NftAssetType;
  appId?: string;
  appVersion?: string;
}

export interface UploadAreaProps {
  /** The selected owner address (the `Codex-Owner` tag value). */
  address: string;
  /** E3 upload-then-append: uploads a single file (with the chosen category
   *  selection) and returns the data-item result. */
  uploadAndTrack: (
    file: File,
    selection: UploadCategorySelection,
  ) => Promise<UploadTrackResult>;
  /** T7 bundle-aware upload-then-append: uploads 2+ files (or a folder), with
   *  the SAME category selection applied to every item, as one atomic bundle
   *  and returns the manifest + per-file result. */
  uploadFilesAndTrack: (
    files: File[],
    selection: UploadCategorySelection,
  ) => Promise<UploadBundleTrackResult>;
  /** E3 openUrl: composes a healthy-gateway URL for a data-item id. */
  openUrl: (id: string) => string;
}

/** A placeholder shown for a value only assigned once the upload actually runs. */
const ASSIGNED_ON_UPLOAD = "(assigned on upload)";

/**
 * The category `<select>`'s `<optgroup>` layout — matches the design doc's
 * grouped taxonomy table verbatim, minus its Codex (`codex-backup`) and
 * Provenance (`foreign`) groups, which have no selectable member on THIS
 * picker (`codex-backup` has its own dedicated `CodexBackupArea` entry point;
 * `foreign` is reserved for a later retroactive-add flow). 9 groups, 24
 * categories total.
 */
export const CATEGORY_GROUPS: { label: string; categories: UploadCategory[] }[] = [
  {
    label: "Personal",
    categories: [
      "personal-photos",
      "personal-videos",
      "personal-audio",
      "journals-writing",
      "personal-documents",
      "medical-records",
    ],
  },
  {
    label: "Financial & Legal",
    categories: ["financial-records", "legal-records", "certificates-credentials"],
  },
  {
    label: "Creative & Professional",
    categories: [
      "creative-work",
      "nft-data",
      "software-code",
      "website-dapp-hosting",
      "research-data",
      "publications-books",
    ],
  },
  { label: "Public / Web3-native", categories: ["public-statement", "proof-timestamping"] },
  {
    label: "Legacy & Family",
    categories: ["memorial-legacy", "historical-archive", "genealogy-family-history"],
  },
  { label: "Correspondence", categories: ["correspondence-archive"] },
  { label: "Gaming", categories: ["gaming-virtual-assets"] },
  { label: "Events", categories: ["event-records"] },
  { label: "Fallback", categories: ["general-other"] },
];

/**
 * Build the full required tag-set preview for a picked selection, before any
 * upload — the four original tags PLUS T7's three schema-versioning tags
 * PLUS T5's category/asset-type/app-lineage tags, whichever currently have a
 * value (an omitted optional field renders no preview row — mirrors
 * `buildUploadTags`'s own "only the ones actually provided" rule).
 * `contentType` is the single picked file's MIME type, or a
 * `"(multiple files)"` placeholder for a 2+ selection (no single
 * representative Content-Type exists yet).
 */
export function previewTags(
  address: string,
  contentType: string,
  selection: {
    category: string;
    assetType: string;
    appId: string;
    appVersion: string;
    /** Optional — omitted entirely by callers (e.g. `UploadArea.tsx`'s own
     *  flat form, which never offers encryption) means "don't preview an
     *  encryption tag at all," matching `buildUploadTags`'s own
     *  omitted-field-emits-no-tag rule. `UploadWizard.tsx` passes this once
     *  a Public/Encrypted mode has actually been chosen. */
    encrypted?: boolean;
    /** The encrypting Ouronet account's OWN address (never an Arweave-
     *  canonical one — see `arweave-upload-encryption`'s design doc for why
     *  these are different address spaces). Only meaningful, and only
     *  included in the preview, when `encrypted === true`. */
    encryptorAddress?: string;
    /** The pinned CURRENT encryption-procedure version (`arweave-tag-
     *  schema-spec` T1/T4) — `CODEX_ENCRYPTION_VERSION_CURRENT`, never a
     *  free-form caller value. Only meaningful, and only included in the
     *  preview, when `encrypted === true`; mirrors `encryptorAddress`'s own
     *  presence rule exactly, emitted immediately after `Codex-Encryptor`. */
    encryptionVersion?: string;
  },
): Tag[] {
  const tags: Tag[] = [
    { name: TAG_APP_NAME, value: DEFAULT_APP_NAME },
    { name: TAG_CONTENT_TYPE, value: contentType },
    { name: TAG_CODEX_ITEM_ID, value: ASSIGNED_ON_UPLOAD },
    { name: TAG_CODEX_OWNER, value: address },
    { name: TAG_CODEX_TAG_SCHEMA_VERSION, value: CODEX_TAG_SCHEMA_VERSION_CURRENT },
    { name: TAG_CODEX_UPLOAD_ID, value: ASSIGNED_ON_UPLOAD },
    { name: TAG_CODEX_ITEM_TYPE, value: "file" },
  ];
  if (selection.category !== "") tags.push({ name: TAG_CODEX_CATEGORY, value: selection.category });
  if (selection.assetType !== "") tags.push({ name: TAG_CODEX_ASSET_TYPE, value: selection.assetType });
  if (selection.appId !== "") tags.push({ name: TAG_CODEX_APP_ID, value: selection.appId });
  if (selection.appVersion !== "") tags.push({ name: TAG_CODEX_APP_VERSION, value: selection.appVersion });
  // Mirror buildUploadTags' exact emission rule: Codex-Encrypted is shown
  // whenever the caller has explicitly decided true/false (never emitted
  // while the choice is still unmade); Codex-Encryptor only alongside true.
  if (selection.encrypted !== undefined) {
    tags.push({ name: TAG_CODEX_ENCRYPTED, value: selection.encrypted ? "true" : "false" });
    if (selection.encrypted && selection.encryptorAddress !== undefined) {
      tags.push({ name: TAG_CODEX_ENCRYPTOR, value: selection.encryptorAddress });
    }
    if (selection.encrypted && selection.encryptionVersion !== undefined) {
      tags.push({ name: TAG_CODEX_ENCRYPTION_VERSION, value: selection.encryptionVersion });
    }
  }
  return tags;
}

type UploadPhase = "idle" | "confirming" | "uploading" | "done" | "error";

/** Discriminates the two result shapes: a bundle result always carries `manifestId`. */
export function isBundleResult(
  result: UploadTrackResult | UploadBundleTrackResult,
): result is UploadBundleTrackResult {
  return "manifestId" in result;
}

export function UploadArea(props: UploadAreaProps): React.ReactElement {
  const { address, uploadAndTrack, uploadFilesAndTrack, openUrl } = props;

  const [files, setFiles] = useState<File[]>([]);
  const [category, setCategory] = useState("");
  const [assetType, setAssetType] = useState("");
  const [appId, setAppId] = useState("");
  const [appVersion, setAppVersion] = useState("");
  const [metadataFile, setMetadataFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [result, setResult] = useState<UploadTrackResult | UploadBundleTrackResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isNftData = category === "nft-data";
  // Attaching a metadata file only changes the upload routing for the normal
  // single-asset NFT case — 2+ picked asset files already take the bundle
  // path on their own, and a metadata file is meaningless outside nft-data.
  const hasMetadata = isNftData && metadataFile !== null && files.length === 1;
  const isBundle = files.length >= 2 || hasMetadata;
  const previewContentType =
    files.length === 1 ? files[0].type : files.length > 1 ? "(multiple files)" : "";
  const tags =
    files.length > 0
      ? previewTags(address, previewContentType, { category, assetType, appId, appVersion })
      : null;
  const pending = phase === "uploading";
  const categoryChosen = category !== "" && (!isNftData || assetType !== "");

  function onPickFiles(ev: React.ChangeEvent<HTMLInputElement>): void {
    const picked = Array.from(ev.target.files ?? []);
    setFiles(picked);
    setResult(null);
    setErrorMessage(null);
    setPhase("idle");
  }

  function onCategoryChange(ev: React.ChangeEvent<HTMLSelectElement>): void {
    setCategory(ev.target.value);
    // Switching away from nft-data drops any previously chosen asset-type and
    // any attached metadata file so a stale value never silently rides along
    // under a different category.
    if (ev.target.value !== "nft-data") {
      setAssetType("");
      setMetadataFile(null);
    }
  }

  function onPickMetadataFile(ev: React.ChangeEvent<HTMLInputElement>): void {
    const picked = ev.target.files?.[0] ?? null;
    setMetadataFile(picked);
    setResult(null);
    setErrorMessage(null);
    setPhase("idle");
  }

  function onStart(): void {
    if (files.length === 0 || pending || !categoryChosen) return;
    setPhase("confirming");
  }

  function onCancelConfirm(): void {
    setPhase("idle");
  }

  function buildSelection(): UploadCategorySelection {
    return {
      category: category as UploadCategory,
      ...(assetType !== "" ? { assetType: assetType as NftAssetType } : {}),
      ...(appId !== "" ? { appId } : {}),
      ...(appVersion !== "" ? { appVersion } : {}),
    };
  }

  async function onAcceptConfirm(): Promise<void> {
    if (files.length === 0 || !categoryChosen) return;
    setPhase("uploading");
    setErrorMessage(null);
    try {
      const selection = buildSelection();
      // 1 asset file + an attached metadata file rides in the SAME bundle as
      // a second item — [assetFile, metadataFile], in that order — reusing
      // the existing bundle path verbatim rather than a new pipeline.
      const bundleFiles = hasMetadata ? [files[0], metadataFile as File] : files;
      const res = isBundle
        ? await uploadFilesAndTrack(bundleFiles, selection)
        : await uploadAndTrack(files[0], selection);
      setResult(res);
      setPhase("done");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Upload failed.");
      setPhase("error");
    }
  }

  return (
    <div data-testid="upload-area">
      <input
        type="file"
        multiple
        data-testid="upload-file-input"
        onChange={onPickFiles}
      />
      <input
        type="file"
        // `webkitdirectory` is a non-standard boolean attribute (no typed React
        // prop) — folder selection support, additive to the plain multi-file
        // input above. Cast keeps this one line free of a broader JSX
        // attribute-typing workaround.
        {...({ webkitdirectory: "" } as Record<string, string>)}
        data-testid="upload-folder-input"
        onChange={onPickFiles}
      />

      {files.length > 0 ? (
        <select
          data-testid="upload-category"
          value={category}
          onChange={onCategoryChange}
        >
          <option value="">Select a category…</option>
          {CATEGORY_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      ) : null}

      {files.length > 0 && isNftData ? (
        <select
          data-testid="upload-asset-type"
          value={assetType}
          onChange={(ev) => setAssetType(ev.target.value)}
        >
          <option value="">Select an asset type…</option>
          {NFT_ASSET_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      ) : null}

      {files.length > 0 && isNftData ? (
        <div data-testid="nft-metadata-disclaimer-wrap">
          <p data-testid="nft-metadata-disclaimer">{NFT_METADATA_DISCLAIMER}</p>
          <label>
            Attach metadata (optional)
            <input
              type="file"
              data-testid="upload-metadata-file-input"
              onChange={onPickMetadataFile}
            />
          </label>
        </div>
      ) : null}

      {files.length > 0 ? (
        <>
          <input
            type="text"
            data-testid="upload-app-id"
            placeholder="App-Id (optional)"
            value={appId}
            onChange={(ev) => setAppId(ev.target.value)}
          />
          <input
            type="text"
            data-testid="upload-app-version"
            placeholder="App-Version (optional)"
            value={appVersion}
            onChange={(ev) => setAppVersion(ev.target.value)}
          />
        </>
      ) : null}

      {files.length > 0 ? (
        <div data-testid="upload-file-preview">
          <ul>
            {files.map((f) => (
              <li key={f.name}>{f.name}</li>
            ))}
          </ul>
          {metadataFile ? (
            <p data-testid="upload-metadata-file-name">Metadata: {metadataFile.name}</p>
          ) : null}
        </div>
      ) : null}

      {tags ? (
        <ul data-testid="upload-tag-preview">
          {tags.map((tag) => (
            <li key={tag.name}>
              <span>{tag.name}</span>
              <span>{tag.value}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <button
        type="button"
        data-testid="upload-start"
        disabled={files.length === 0 || pending || !categoryChosen}
        onClick={onStart}
      >
        Upload
      </button>

      {phase === "confirming" ? (
        <div data-testid="upload-permanence-confirm" role="alertdialog">
          <p>{UPLOAD_PERMANENCE_WARNING}</p>
          <button
            type="button"
            data-testid="upload-permanence-accept"
            onClick={() => {
              void onAcceptConfirm();
            }}
          >
            Confirm permanent upload
          </button>
          <button
            type="button"
            data-testid="upload-permanence-cancel"
            onClick={onCancelConfirm}
          >
            Cancel
          </button>
        </div>
      ) : null}

      {pending ? (
        <div data-testid="upload-progress" role="status">
          Uploading…
        </div>
      ) : null}

      {phase === "done" && result && isBundleResult(result) ? (
        <div data-testid="upload-bundle-result">
          <p>{result.manifestId}</p>
          <a href={openUrl(result.manifestId)}>Open the manifest on the permaweb</a>
          <p>{result.fileIds.length} files uploaded</p>
          <div data-testid="upload-pending-entry">Pending in your Library</div>
        </div>
      ) : null}

      {phase === "done" && result && !isBundleResult(result) ? (
        <div data-testid="upload-result">
          <p>{result.id}</p>
          <a href={openUrl(result.id)}>Open on the permaweb</a>
          <div data-testid="upload-pending-entry">Pending in your Library</div>
        </div>
      ) : null}

      {phase === "error" ? (
        <div data-testid="upload-error" role="alert">
          {errorMessage}
        </div>
      ) : null}
    </div>
  );
}

export default UploadArea;
