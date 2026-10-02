/**
 * RED matrix for the Arweave panel CODEX-BACKUP area (arweave-upload-categories, T5).
 *
 * Pins the `CodexBackupArea` contract: a single "Back up codex to Arweave"
 * button; a MANDATORY confirm dialog rendering `CODEX_BACKUP_PERMANENCE_WARNING`
 * verbatim (a DISTINCT text from `UploadArea`'s `UPLOAD_PERMANENCE_WARNING`);
 * on confirm, resolves the injected `getExportJson()` getter FRESH (never at
 * mount/render time — the backup must always capture the codex's CURRENT
 * state at the moment of the click, not a snapshot from an earlier render)
 * and calls `backupCodex(exportJson)` with the resolved value; a
 * non-re-entrant progress indicator; a result with a direct link on success;
 * a clear error view on failure. Mirrors `UploadArea.tsx`'s own
 * idle/confirming/uploading/done/error phase machine.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor, cleanup, fireEvent } from "@testing-library/react";

import { CodexBackupArea } from "../src/panel/CodexBackupArea";
import {
  UPLOAD_PERMANENCE_WARNING,
  CODEX_BACKUP_PERMANENCE_WARNING,
} from "../src/library/constants.js";

const RESULT_ID = "aXcDefGhIjKlMnOpQrStUvWxYz0123456789_-ABCDE";
const EXPORT_JSON = '{"labels":["seed-1"],"ciphertext":"opaque-blob"}';

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    getExportJson: vi.fn(async () => EXPORT_JSON),
    backupCodex: vi.fn(async (_exportJson: string) => ({ id: RESULT_ID })),
    openUrl: vi.fn((id: string) => `https://healthy.example/${id}`),
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CodexBackupArea — mandatory, DISTINCT permanence confirm", () => {
  it("clicking the button shows CODEX_BACKUP_PERMANENCE_WARNING verbatim, NOT UPLOAD_PERMANENCE_WARNING's text", async () => {
    const props = makeProps();
    render(<CodexBackupArea {...props} />);
    fireEvent.click(screen.getByTestId("codex-backup-start"));

    const confirm = await screen.findByTestId("codex-backup-permanence-confirm");
    expect(confirm.textContent).toContain(CODEX_BACKUP_PERMANENCE_WARNING);
    expect(confirm.textContent).not.toContain(UPLOAD_PERMANENCE_WARNING);
    // The two warnings are genuinely distinct strings (not the same constant
    // re-exported under two names).
    expect(CODEX_BACKUP_PERMANENCE_WARNING).not.toBe(UPLOAD_PERMANENCE_WARNING);
    expect(props.backupCodex).not.toHaveBeenCalled();
  });

  it("cancel aborts with no backupCodex call", async () => {
    const props = makeProps();
    render(<CodexBackupArea {...props} />);
    fireEvent.click(screen.getByTestId("codex-backup-start"));
    fireEvent.click(await screen.findByTestId("codex-backup-permanence-cancel"));
    expect(props.backupCodex).not.toHaveBeenCalled();
  });
});

describe("CodexBackupArea — confirm calls the injected backupCodex prop", () => {
  it("resolves getExportJson and passes its resolved value to backupCodex", async () => {
    const props = makeProps();
    render(<CodexBackupArea {...props} />);
    fireEvent.click(screen.getByTestId("codex-backup-start"));
    fireEvent.click(await screen.findByTestId("codex-backup-permanence-accept"));

    await waitFor(() => expect(props.backupCodex).toHaveBeenCalledTimes(1));
    expect(props.backupCodex).toHaveBeenCalledWith(EXPORT_JSON);
  });

  it("calls getExportJson fresh at CONFIRM-time — never at mount/render time — so a click always backs up the CURRENT codex state, not a stale render snapshot", async () => {
    const props = makeProps();
    render(<CodexBackupArea {...props} />);

    // Rendering (and even opening the confirm dialog) must NOT resolve the
    // export yet — only the user's actual confirm click may trigger it,
    // otherwise the resolved value could go stale before the click lands.
    expect(props.getExportJson).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("codex-backup-start"));
    await screen.findByTestId("codex-backup-permanence-confirm");
    expect(props.getExportJson).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByTestId("codex-backup-permanence-accept"));

    await waitFor(() => expect(props.getExportJson).toHaveBeenCalledTimes(1));
    expect(props.backupCodex).toHaveBeenCalledWith(EXPORT_JSON);
  });

  it("shows a progress indicator and is non-re-entrant while pending", async () => {
    let resolveBackup: (v: unknown) => void = () => {};
    const backupCodex = vi.fn(() => new Promise((res) => { resolveBackup = res; }));
    const props = makeProps({ backupCodex });
    render(<CodexBackupArea {...props} />);
    fireEvent.click(screen.getByTestId("codex-backup-start"));
    fireEvent.click(await screen.findByTestId("codex-backup-permanence-accept"));

    await waitFor(() => expect(screen.getByTestId("codex-backup-progress")).toBeInTheDocument());
    expect(screen.getByTestId("codex-backup-start")).toBeDisabled();

    resolveBackup({ id: RESULT_ID });
    await waitFor(() => expect(backupCodex).toHaveBeenCalledTimes(1));
  });

  it("shows a direct result link on success", async () => {
    const props = makeProps();
    render(<CodexBackupArea {...props} />);
    fireEvent.click(screen.getByTestId("codex-backup-start"));
    fireEvent.click(await screen.findByTestId("codex-backup-permanence-accept"));

    const result = await screen.findByTestId("codex-backup-result");
    expect(result.textContent).toContain(RESULT_ID);
    const link = within(result).getByRole("link");
    expect(link).toHaveAttribute("href", `https://healthy.example/${RESULT_ID}`);
    expect(props.openUrl).toHaveBeenCalledWith(RESULT_ID);
  });
});

describe("CodexBackupArea — failure", () => {
  it("shows a clear error view when backupCodex rejects", async () => {
    class UploadFailedError extends Error {
      override readonly name = "UploadFailedError";
    }
    const backupCodex = vi.fn(async () => {
      throw new UploadFailedError("gateway rejected the backup");
    });
    const props = makeProps({ backupCodex });
    render(<CodexBackupArea {...props} />);
    fireEvent.click(screen.getByTestId("codex-backup-start"));
    fireEvent.click(await screen.findByTestId("codex-backup-permanence-accept"));

    expect(await screen.findByTestId("codex-backup-error")).toBeInTheDocument();
    expect(screen.queryByTestId("codex-backup-result")).not.toBeInTheDocument();
  });
});

describe("CodexBackupArea — secret hygiene", () => {
  it("never renders a JWK value in the DOM", () => {
    const props = makeProps();
    render(<CodexBackupArea {...props} />);
    expect(document.body.innerHTML).not.toContain('"d":');
    expect(document.body.innerHTML).not.toContain('"qi":');
  });
});
