// The CODEX-BACKUP area of the Arweave panel (arweave-upload-categories, T5).
//
// A small, separate component from `UploadArea.tsx`: backing up the codex
// itself is "back up the codex", not a file-picker flow, so it does not
// belong inside `UploadArea`'s file-selection UI and has its own dedicated
// entry point. A single "Back up codex to Arweave" button; on click, a
// MANDATORY confirm dialog renders `CODEX_BACKUP_PERMANENCE_WARNING` —
// DELIBERATELY a distinct constant/text from `UploadArea`'s
// `UPLOAD_PERMANENCE_WARNING`, naming the specific permanent-password-lockin
// risk a codex backup carries. On confirm, the injected `getExportJson`
// getter is resolved FRESH (never at mount/render time — a click must
// always back up the codex's CURRENT state at the moment of the click, not
// a stale snapshot from an earlier render) and the injected `backupCodex`
// prop is called with the resolved string — this component does not know
// how to PRODUCE that export string (that is the consuming app's own export
// flow) or how to clear the codex's `dirty` flag (the consuming app's job,
// via whatever `backupCodex` closure wiring or subsequent success handling
// it chooses) — matching this package's
// existing dependency-injection pattern for every other panel area
// (`UploadArea.tsx`'s own `uploadAndTrack`/`uploadFilesAndTrack`/`openUrl`
// props). Mirrors `UploadArea.tsx`'s own idle/confirming/uploading/done/error
// phase-state-machine structure rather than inventing a new shape.
//
// Secret hygiene (N-06): the JWK never reaches this layer — `backupCodex` is
// injected and returns only a public data-item id. No key field is ever
// rendered.

import * as React from "react";
import { useState } from "react";

import { CODEX_BACKUP_PERMANENCE_WARNING } from "../library/constants.js";

/** The gold accent this package's own established visual language uses
 *  (`ArweaveAccountsArea.tsx`/`PureKeysArea.tsx`/`UploadWizard.tsx`'s own
 *  `ACCENT`) — this module's own local copy, following the same per-file
 *  convention every other panel area already uses (no shared/exported style
 *  helper exists across these components yet). */
const ACCENT = "#ceac5f";

/** The primary (filled-gold) action button — mirrors `UploadWizard.tsx`'s
 *  own `primaryButtonStyle()` exactly (solid `ACCENT` fill, near-black
 *  text). Used for "Back up codex to Arweave" and the permanence dialog's
 *  own "Confirm permanent backup" — the owner's own repeatedly-stated
 *  rejection of plain/default-styled buttons anywhere in this app, already
 *  applied elsewhere in this package. */
const primaryButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "8px 16px",
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 700,
  border: "none",
  cursor: "pointer",
  backgroundColor: ACCENT,
  color: "#0a0a0a",
};

/** The outlined ("secondary") action button chrome — mirrors
 *  `UploadWizard.tsx`'s own `secondaryButtonStyle()` palette. Used for the
 *  permanence dialog's "Cancel". */
const secondaryButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "8px 16px",
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  border: "1px solid #262626",
  backgroundColor: "#111",
  color: "#888",
};

/** The result `backupCodex` resolves — a public data-item id, nothing else. */
export interface CodexBackupResult {
  id: string;
}

export interface CodexBackupAreaProps {
  /** Resolves the codex's CURRENT export payload — called fresh, INSIDE the
   *  confirm handler, only after the user clicks confirm (never at mount or
   *  render time), so a backup always captures whatever's true at the
   *  moment of the click rather than a snapshot from an earlier render. The
   *  consuming app's own export flow produces this (this component does not
   *  know how to produce it, parse it, or interpret it; the resolved string
   *  is forwarded to `backupCodex` verbatim). */
  getExportJson: () => Promise<string>;
  /** Uploads the resolved export payload and resolves the resulting data-item id. This
   *  component does not clear the codex's `dirty` flag — that is the
   *  consuming app's job (via this closure or its own success handling). */
  backupCodex: (exportJson: string) => Promise<CodexBackupResult>;
  /** Composes a healthy-gateway URL for a data-item id — the SAME seam
   *  `UploadArea.tsx`'s own `openUrl` prop follows. */
  openUrl: (id: string) => string;
}

type CodexBackupPhase = "idle" | "confirming" | "uploading" | "done" | "error";

export function CodexBackupArea(props: CodexBackupAreaProps): React.ReactElement {
  const { getExportJson, backupCodex, openUrl } = props;

  const [phase, setPhase] = useState<CodexBackupPhase>("idle");
  const [result, setResult] = useState<CodexBackupResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pending = phase === "uploading";

  function onStart(): void {
    if (pending) return;
    setPhase("confirming");
  }

  function onCancelConfirm(): void {
    setPhase("idle");
  }

  async function onAcceptConfirm(): Promise<void> {
    setPhase("uploading");
    setErrorMessage(null);
    try {
      // Resolved HERE, at confirm-time — never earlier — so the backup
      // always captures the codex's CURRENT state at the moment of the
      // click, not a value captured at whatever render produced this
      // closure.
      const exportJson = await getExportJson();
      const res = await backupCodex(exportJson);
      setResult(res);
      setPhase("done");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Codex backup failed.");
      setPhase("error");
    }
  }

  return (
    <div data-testid="codex-backup-area">
      <button
        type="button"
        data-testid="codex-backup-start"
        disabled={pending}
        onClick={onStart}
        style={primaryButtonStyle}
      >
        Back up codex to Arweave
      </button>

      {phase === "confirming" ? (
        <div data-testid="codex-backup-permanence-confirm" role="alertdialog">
          <p>{CODEX_BACKUP_PERMANENCE_WARNING}</p>
          <button
            type="button"
            data-testid="codex-backup-permanence-accept"
            onClick={() => {
              void onAcceptConfirm();
            }}
            style={primaryButtonStyle}
          >
            Confirm permanent backup
          </button>
          <button
            type="button"
            data-testid="codex-backup-permanence-cancel"
            onClick={onCancelConfirm}
            style={secondaryButtonStyle}
          >
            Cancel
          </button>
        </div>
      ) : null}

      {pending ? (
        <div data-testid="codex-backup-progress" role="status">
          Backing up…
        </div>
      ) : null}

      {phase === "done" && result ? (
        <div data-testid="codex-backup-result">
          <p>{result.id}</p>
          <a href={openUrl(result.id)}>Open on the permaweb</a>
        </div>
      ) : null}

      {phase === "error" ? (
        <div data-testid="codex-backup-error" role="alert">
          {errorMessage}
        </div>
      ) : null}
    </div>
  );
}

export default CodexBackupArea;
