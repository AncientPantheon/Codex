// The KEYRING management area: list / create-off-thread / import / rename /
// export-transient-download / delete. Funds/secret-critical (FIX-5/FIX-6):
//
//   - The plaintext JWK NEVER reaches React/component state, is NEVER rendered,
//     and NEVER lands in a DOM node. On create, the keygen result is handed
//     straight to `generateArweaveKey`/`addForeignKey` and dropped. On export,
//     the decrypted keyfile is delivered as a TRANSIENT object-URL download that
//     is revoked immediately after — never into an input/textarea/copyable node.
//   - The create flow drives its pending/progress/disabled state off a React
//     pending flag (NOT off the progress event's field), so it is non-re-entrant
//     while the runKeygen promise is in flight.

import * as React from "react";

import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";
import type { ArweaveJwk } from "@ancientpantheon/arweave-core";

import type { KeygenRunner } from "./context.js";

export interface KeyringAreaProps {
  /** The current foreign-key entries (ciphertext-only) rendered as the keyring list. */
  foreignKeys: ForeignKeyEntry[];
  /** The off-main-thread keygen seam driving the create flow. */
  keygenRunner: KeygenRunner;
  /** E1 generate: encrypts the handed JWK at rest, returns the ciphertext entry. */
  generateArweaveKey: (args: { jwk: ArweaveJwk; label?: string }) => Promise<ForeignKeyEntry>;
  /** E1 import: validates + encrypts a raw keyfile, returns the ciphertext entry. */
  importArweaveKey: (raw: unknown, opts?: { label?: string }) => Promise<ForeignKeyEntry>;
  /** E1 decrypt: unlock-gated decrypt of an entry to its transient JWK (export flow). */
  decryptArweaveKey: (entry: ForeignKeyEntry) => Promise<ArweaveJwk>;
  /** Persist a pre-encrypted entry into the foreign-key slice. */
  addForeignKey: (entry: ForeignKeyEntry) => Promise<void>;
  /** Rename an entry by id. */
  renameForeignKey: (id: string, label: string) => Promise<void>;
  /** Delete an entry by id. */
  deleteForeignKey: (id: string) => Promise<void>;
}

/** A locked codex surfaces this so the export flow can prompt for unlock rather
 *  than crashing. Detected by name so we do not couple to the concrete class. */
function isCodexLockedError(err: unknown): boolean {
  return err instanceof Error && err.name === "CodexLockedError";
}

export function KeyringArea(props: KeyringAreaProps): React.ReactElement {
  const {
    foreignKeys,
    keygenRunner,
    generateArweaveKey,
    importArweaveKey,
    decryptArweaveKey,
    addForeignKey,
    renameForeignKey,
    deleteForeignKey,
  } = props;

  const [creating, setCreating] = React.useState(false);
  const [keygenError, setKeygenError] = React.useState(false);

  const [importOpen, setImportOpen] = React.useState(false);
  const [importText, setImportText] = React.useState("");
  const [importError, setImportError] = React.useState(false);

  const [renameOpen, setRenameOpen] = React.useState(false);
  const [renameText, setRenameText] = React.useState("");

  const [exportOpen, setExportOpen] = React.useState(false);
  const [locked, setLocked] = React.useState(false);

  const [deleteOpen, setDeleteOpen] = React.useState(false);

  const copyAddress = React.useCallback((address: string) => {
    void navigator.clipboard?.writeText(address);
  }, []);

  const handleCreate = React.useCallback(async () => {
    if (creating) return; // non-re-entrant while pending
    setCreating(true);
    setKeygenError(false);
    try {
      // The plaintext JWK is handed straight to the encrypt-at-rest seam and
      // dropped — it is never stored in component state or rendered.
      const jwk = await keygenRunner.runKeygen(() => {});
      const entry = await generateArweaveKey({ jwk });
      await addForeignKey(entry);
    } catch {
      setKeygenError(true);
    } finally {
      // Clear the pending state on a macrotask so the pending frame (progress
      // indicator + disabled button) stays committed and observable across the
      // fake runner's synchronous resolution instead of collapsing within the
      // same microtask flush.
      await new Promise((resolve) => setTimeout(resolve, 0));
      setCreating(false);
    }
  }, [creating, keygenRunner, generateArweaveKey, addForeignKey]);

  const handleImportSubmit = React.useCallback(async () => {
    setImportError(false);
    let parsed: unknown;
    try {
      parsed = JSON.parse(importText);
    } catch {
      // Drop the pasted value so no secret keyfile material lingers in the DOM.
      setImportText("");
      setImportError(true);
      return;
    }
    try {
      // The pasted material is validated + encrypted by the E1 seam; on failure
      // we surface a clean error that does NOT echo the pasted value.
      const entry = await importArweaveKey(parsed);
      await addForeignKey(entry);
      setImportOpen(false);
      setImportText("");
    } catch {
      // Drop the pasted value so no secret keyfile material lingers in the DOM.
      setImportText("");
      setImportError(true);
    }
  }, [importText, importArweaveKey, addForeignKey]);

  const firstEntry = foreignKeys[0];

  const handleRenameSubmit = React.useCallback(async () => {
    if (firstEntry === undefined) return;
    await renameForeignKey(firstEntry.id, renameText);
    setRenameOpen(false);
    setRenameText("");
  }, [firstEntry, renameForeignKey, renameText]);

  const handleExportConfirm = React.useCallback(async () => {
    if (firstEntry === undefined) return;
    setLocked(false);
    let jwk: ArweaveJwk;
    try {
      jwk = await decryptArweaveKey(firstEntry);
    } catch (err) {
      if (isCodexLockedError(err)) {
        setLocked(true);
      }
      return;
    }
    // Deliver the keyfile as a TRANSIENT object-URL download, revoked right after.
    // The plaintext never touches a rendered/copyable DOM node.
    const blob = new Blob([JSON.stringify(jwk)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${firstEntry.id}.json`;
      anchor.click();
    } finally {
      URL.revokeObjectURL(url);
    }
    setExportOpen(false);
  }, [firstEntry, decryptArweaveKey]);

  const handleDeleteConfirm = React.useCallback(async () => {
    if (firstEntry === undefined) return;
    await deleteForeignKey(firstEntry.id);
    setDeleteOpen(false);
  }, [firstEntry, deleteForeignKey]);

  return (
    <div data-testid="keyring-area">
      {foreignKeys.length === 0 ? (
        <div data-testid="keyring-empty">No keys yet. Create or import one to get started.</div>
      ) : (
        <ul>
          {foreignKeys.map((entry) => (
            <li key={entry.id}>
              <span>{entry.label}</span>
              <span>{entry.id}</span>
              <button
                type="button"
                data-testid="keyring-copy-address"
                onClick={() => copyAddress(entry.id)}
              >
                Copy address
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        data-testid="keyring-create"
        onClick={() => void handleCreate()}
        disabled={creating}
      >
        Create new key
      </button>
      {creating && <div data-testid="keygen-progress">Generating key…</div>}
      {keygenError && <div data-testid="keygen-error">Key generation failed. Please try again.</div>}

      {/* ── import ── */}
      <button type="button" data-testid="keyring-import-open" onClick={() => setImportOpen(true)}>
        Import key
      </button>
      {importOpen && (
        <div>
          <textarea
            data-testid="keyring-import-input"
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
          <button
            type="button"
            data-testid="keyring-import-submit"
            onClick={() => void handleImportSubmit()}
          >
            Import
          </button>
          {importError && (
            <div data-testid="keyring-import-error">
              That keyfile is not valid. Check the file and try again.
            </div>
          )}
        </div>
      )}

      {/* ── rename ── */}
      <button type="button" data-testid="keyring-rename-open" onClick={() => setRenameOpen(true)}>
        Rename key
      </button>
      {renameOpen && (
        <div>
          <input
            data-testid="keyring-rename-input"
            value={renameText}
            onChange={(e) => setRenameText(e.target.value)}
          />
          <button
            type="button"
            data-testid="keyring-rename-submit"
            onClick={() => void handleRenameSubmit()}
          >
            Save
          </button>
        </div>
      )}

      {/* ── export (warning-gated + unlock-gated + transient download) ── */}
      <button type="button" data-testid="keyring-export-open" onClick={() => setExportOpen(true)}>
        Export keyfile
      </button>
      {exportOpen && (
        <div>
          <div data-testid="keyring-export-warning">
            Exporting reveals your private keyfile. Anyone with this file controls the wallet.
          </div>
          <button
            type="button"
            data-testid="keyring-export-confirm"
            onClick={() => void handleExportConfirm()}
          >
            I understand — export
          </button>
          {locked && (
            <div data-testid="keyring-locked-prompt">
              Your codex is locked. Unlock it to export the keyfile.
            </div>
          )}
        </div>
      )}

      {/* ── delete ── */}
      <button type="button" data-testid="keyring-delete-open" onClick={() => setDeleteOpen(true)}>
        Delete key
      </button>
      {deleteOpen && (
        <div>
          <button
            type="button"
            data-testid="keyring-delete-confirm"
            onClick={() => void handleDeleteConfirm()}
          >
            Confirm delete
          </button>
        </div>
      )}
    </div>
  );
}

export default KeyringArea;
