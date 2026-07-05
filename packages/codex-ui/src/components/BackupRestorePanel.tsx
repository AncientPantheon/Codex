/**
 * <BackupRestorePanel> — codex backup + restore UI surface.
 *
 * Composes useCodexBackup. Four operations: download as JSON file,
 * import from JSON file, export as string (for cloud backup flows
 * the consumer orchestrates), import from string.
 *
 * Headless — accepts className + render-prop slots. Default markup
 * is semantic HTML with no CSS.
 *
 * Cloud export/import are exposed as raw helpers via render-props;
 * consumers wire them to their own UI (e.g. Google Drive integration
 * via @ancientpantheon/codex-ouronet/google-drive, or a custom backend).
 */

import * as React from "react";
import { useCallback, useRef, useState } from "react";
import { useCodexBackup } from "../hooks/useCodexBackup.js";

export interface BackupRestoreRenderArgs {
  downloadAsJson: () => Promise<void>;
  importFromFile: (file: File) => Promise<void>;
  exportForCloud: () => Promise<string>;
  importFromCloud: (json: string) => Promise<void>;
  isDirty: boolean;
  clearDirty: () => void;
  lastError: string | null;
  busy: boolean;
}

export interface BackupRestorePanelProps {
  className?: string;
  /** Full markup override — receives every action + state slot. */
  render?: (args: BackupRestoreRenderArgs) => React.ReactNode;
  renderHeader?: (isDirty: boolean) => React.ReactNode;
  renderDownloadButton?: (
    onClick: () => void,
    busy: boolean
  ) => React.ReactNode;
  renderImportButton?: (
    onClick: () => void,
    busy: boolean
  ) => React.ReactNode;
  renderError?: (message: string) => React.ReactNode;
  /** Filename for the downloaded JSON file. Default:
   *  `OuronetCodex_<ISO>.json`. */
  downloadFilename?: string;
}

export function BackupRestorePanel({
  className,
  render,
  renderHeader,
  renderDownloadButton,
  renderImportButton,
  renderError,
  downloadFilename,
}: BackupRestorePanelProps): React.JSX.Element {
  const backup = useCodexBackup();
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleDownload = useCallback(async () => {
    setBusy(true);
    setLastError(null);
    try {
      await backup.downloadAsJson(downloadFilename);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [backup, downloadFilename]);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setBusy(true);
      setLastError(null);
      try {
        await backup.importFromFile(file);
      } catch (err) {
        setLastError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
        // Clear the input so re-selecting the same file fires onChange.
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [backup]
  );

  const renderArgs: BackupRestoreRenderArgs = {
    downloadAsJson: () => backup.downloadAsJson(downloadFilename),
    importFromFile: backup.importFromFile,
    exportForCloud: backup.exportForCloud,
    importFromCloud: backup.importFromCloud,
    isDirty: backup.isDirty,
    clearDirty: backup.clearDirty,
    lastError,
    busy,
  };

  if (render) {
    return <>{render(renderArgs)}</>;
  }

  return (
    <section className={className} aria-labelledby="codex-backup-header">
      <div id="codex-backup-header">
        {renderHeader ? (
          renderHeader(backup.isDirty)
        ) : (
          <h3>
            Codex backup{backup.isDirty ? " (unsaved changes)" : ""}
          </h3>
        )}
      </div>
      <div>
        {renderDownloadButton ? (
          renderDownloadButton(handleDownload, busy)
        ) : (
          <button type="button" onClick={handleDownload} disabled={busy}>
            Download as JSON
          </button>
        )}
        {renderImportButton ? (
          renderImportButton(handleImportClick, busy)
        ) : (
          <button type="button" onClick={handleImportClick} disabled={busy}>
            Restore from file
          </button>
        )}
        {/* Hidden file input — clicked programmatically by the button above. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          onChange={handleFileChange}
          style={{ display: "none" }}
          aria-hidden="true"
        />
      </div>
      {lastError &&
        (renderError ? (
          renderError(lastError)
        ) : (
          <p role="alert">{lastError}</p>
        ))}
    </section>
  );
}
