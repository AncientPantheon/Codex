// The UPLOAD area of the Arweave panel (E-10, N-10).
//
// Presentation over E3's upload-then-append flow: a file picker computes a TAG
// PREVIEW (the four required tags, Codex-Owner === the selected address) BEFORE
// any upload; a MANDATORY permanence confirm (E3's UPLOAD_PERMANENCE_WARNING,
// verbatim) gates the upload; a non-re-entrant progress indicator runs while the
// injected `uploadAndTrack` seam is pending; on success the data-item id + a
// gateway LINK (via the injected `openUrl`) + the pending Library entry surface;
// on failure a clear error surfaces and NO phantom entry is added.
//
// Secret hygiene (N-06): the JWK never reaches this layer — the upload seam is
// injected and returns only public metadata. No key field is ever rendered.

import * as React from "react";
import { useState } from "react";

import {
  TAG_APP_NAME,
  TAG_CONTENT_TYPE,
  TAG_CODEX_ITEM_ID,
  TAG_CODEX_OWNER,
  DEFAULT_APP_NAME,
  type Tag,
} from "@ancientpantheon/arweave-core";

import { UPLOAD_PERMANENCE_WARNING } from "../library/constants.js";

/** The E3 upload-then-append result the Upload area renders. */
export interface UploadTrackResult {
  id: string;
  itemId: string;
  ownerAddress: string;
  tags: unknown[];
}

export interface UploadAreaProps {
  /** The selected owner address (the `Codex-Owner` tag value). */
  address: string;
  /** E3 upload-then-append: uploads the file and returns the data-item result. */
  uploadAndTrack: (file: File) => Promise<UploadTrackResult>;
  /** E3 openUrl: composes a healthy-gateway URL for a data-item id. */
  openUrl: (id: string) => string;
}

/** Build the required four-tag preview for a picked file, before any upload. */
function previewTags(address: string, contentType: string): Tag[] {
  return [
    { name: TAG_APP_NAME, value: DEFAULT_APP_NAME },
    { name: TAG_CONTENT_TYPE, value: contentType },
    { name: TAG_CODEX_ITEM_ID, value: "(assigned on upload)" },
    { name: TAG_CODEX_OWNER, value: address },
  ];
}

type UploadPhase = "idle" | "confirming" | "uploading" | "done" | "error";

export function UploadArea(props: UploadAreaProps): React.ReactElement {
  const { address, uploadAndTrack, openUrl } = props;

  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [result, setResult] = useState<UploadTrackResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const tags = file ? previewTags(address, file.type) : null;
  const pending = phase === "uploading";

  function onPickFile(ev: React.ChangeEvent<HTMLInputElement>): void {
    const picked = ev.target.files?.[0] ?? null;
    setFile(picked);
    setResult(null);
    setErrorMessage(null);
    setPhase("idle");
  }

  function onStart(): void {
    if (!file || pending) return;
    setPhase("confirming");
  }

  function onCancelConfirm(): void {
    setPhase("idle");
  }

  async function onAcceptConfirm(): Promise<void> {
    if (!file) return;
    setPhase("uploading");
    setErrorMessage(null);
    try {
      const res = await uploadAndTrack(file);
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
        data-testid="upload-file-input"
        onChange={onPickFile}
      />

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
        disabled={!file || pending}
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

      {phase === "done" && result ? (
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
