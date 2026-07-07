// ============================================================================
// The App composition (D6 terminus, revised for the single-load-screen UX).
//
// The product flow is one path: no codex loaded → a clean "Load your Codex"
// upload screen; upload the encrypted backup `.json` → restore it into the
// mounted store via the REAL useCodexBackup().importFromCloud → unlock with the
// password → the full dashboard.  mount → restore → unlock → dashboard.
//
// The dashboard itself is also exercised DIRECTLY (mounted against a plaintext-
// hydrated store via the hydrateFromPlaintextSnapshot dev/test seam), so the
// real shell renders the fixture content without the encrypt/unlock round-trip.
//
//   - the export-to-JSON button calls the REAL useCodexBackup().downloadAsJson()
//     (Blob + <a>.click), asserted via the jsdom download side-effect — SYMMETRIC
//     with the upload, NOT a bespoke serializer.
//
// These tests mount the REAL provider + shell under the jsdom+RTL harness (single
// React copy, zustand inlined). They do NOT mock the codex hooks — the point is
// that the real store/shell renders the fixtures — except that the async chain
// read (URC_0027) is a caught no-op under jsdom (no node reachable), which the
// shell tolerates, so the at-rest store content still renders synchronously.
// ============================================================================

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";

import { App, Dashboard } from "../src/App";
import { hydrateFromPlaintextSnapshot } from "../src/loadCodex";
import {
  backupJson,
  backupPassword,
  emptySnapshot,
  populatedStoaChainSnapshot,
} from "../fixtures";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Dashboard — renders a plaintext-hydrated store directly (dev/test seam)", () => {
  it("mounts the populated-StoaChain fixture and renders the dashboard with the StoaChain seed entry visible (no unlock)", async () => {
    const user = userEvent.setup();
    const adapter = await hydrateFromPlaintextSnapshot(populatedStoaChainSnapshot);
    render(
      <CodexProvider adapter={adapter} deviceVariant="dev">
        <Dashboard />
      </CodexProvider>,
    );

    // The dashboard mounts directly — the tab strip (real shell) is present and
    // there is NO unlock prompt (a hydrated plaintext store has no locked secrets).
    const seedTab = await screen.findByRole("tab", { name: /seed words/i });
    expect(screen.queryByRole("button", { name: /^unlock$/i })).toBeNull();

    // The Seed Words tab surfaces the fixture's ONE StoaChain seed — the index-0
    // seed renders as "Prime Codex Seed", proving the real store hydrated from
    // the fixture (not an empty codex, which shows the empty-state text).
    await user.click(seedTab);
    expect(await screen.findByText(/prime codex seed/i)).toBeInTheDocument();
  });

  it("mounts the empty fixture and renders an empty codex dashboard (no StoaChain seeds)", async () => {
    const user = userEvent.setup();
    const adapter = await hydrateFromPlaintextSnapshot(emptySnapshot);
    render(
      <CodexProvider adapter={adapter} deviceVariant="dev">
        <Dashboard />
      </CodexProvider>,
    );

    const seedTab = await screen.findByRole("tab", { name: /seed words/i });
    await user.click(seedTab);
    // The empty fixture hydrates a valid-but-empty codex — the seed tab shows
    // its empty state, NOT a seed count of 1.
    expect(await screen.findByText(/no seeds in the codex/i)).toBeInTheDocument();
  });
});

describe("App — encrypted backup: load screen → upload → restore → unlock → dashboard", () => {
  it("uploads the backup, restores via importFromCloud, shows the unlock screen, then the dashboard after authenticate", async () => {
    const user = userEvent.setup();
    render(<App />);

    // Upload the backup JSON via the single "Load your Codex" file input.
    const file = new File([backupJson], "codex-backup.json", {
      type: "application/json",
    });
    const fileInput = screen.getByLabelText(/load your codex/i) as HTMLInputElement;
    await user.upload(fileInput, file);

    // After restore-into-the-mounted-store, the UNLOCK screen gates the dashboard
    // (the secrets are still encrypted). The dashboard's tab strip is NOT yet
    // shown — the sequence is mount → restore → unlock → (authenticate) → dashboard.
    const passwordInput = await screen.findByLabelText(/^password$/i);
    expect(passwordInput).toHaveAttribute("type", "password");
    expect(screen.queryByRole("tab", { name: /seed words/i })).toBeNull();

    // Authenticate with the throwaway password — the real useCodexAuth path.
    await user.type(passwordInput, backupPassword);
    await user.click(screen.getByRole("button", { name: /^unlock$/i }));

    // The dashboard now renders, hydrated from the restored backup: the backup's
    // ONE StoaChain seed is present (restore mapped kadenaWallets → kadenaSeeds); the
    // index-0 seed renders as "Prime Codex Seed".
    const seedTab = await screen.findByRole("tab", { name: /seed words/i });
    await user.click(seedTab);
    expect(await screen.findByText(/prime codex seed/i)).toBeInTheDocument();
  });

  it("surfaces a secret-free error and offers the load screen (never hangs) when a wrong-version backup is uploaded", async () => {
    // A caught unhandled rejection would leave the effect's restore-once flag set
    // with restored===false — the pin the fix removes. Fail the test if any
    // rejection escapes to the process.
    const rejections: unknown[] = [];
    const onRejection = (e: PromiseRejectionEvent): void => {
      rejections.push(e.reason);
    };
    window.addEventListener("unhandledrejection", onRejection);

    // Spy the console so we can prove the failure path logs no secret/password.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const user = userEvent.setup();
      render(<App />);

      // A syntactically-valid but WRONG-VERSION backup — importFromCloud's own
      // parseBackupFile gate rejects it with CodexImportError at the "shape" stage.
      const badBackup = '{"version":"1.1"}';
      const file = new File([badBackup], "codex-backup.json", {
        type: "application/json",
      });
      const fileInput = screen.getByLabelText(
        /load your codex/i,
      ) as HTMLInputElement;
      await user.upload(fileInput, file);

      // (a) An error message renders (the CodexImportError message names the
      // unsupported version — secret-free).
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(/could not restore backup/i);
      expect(alert).toHaveTextContent(/unsupported version 1\.1/i);

      // (b) The app is NOT stuck on the restoring spinner, and a recovery path
      // back to the load screen is offered.
      expect(screen.queryByText(/restoring backup/i)).toBeNull();
      expect(
        screen.getByRole("button", { name: /try another file/i }),
      ).toBeInTheDocument();

      // (c) No unhandled rejection escaped, and no secret/password/raw-bytes
      // leaked to the console or the DOM. The bad-upload bytes ('1.1' payload)
      // must not be echoed; the dev password must never appear.
      expect(rejections).toEqual([]);
      const consoleText = [...errorSpy.mock.calls, ...logSpy.mock.calls]
        .flat()
        .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
        .join(" ");
      expect(consoleText).not.toContain(badBackup);
      expect(consoleText).not.toContain(backupPassword);
      expect(document.body.textContent ?? "").not.toContain(backupPassword);
    } finally {
      window.removeEventListener("unhandledrejection", onRejection);
      errorSpy.mockRestore();
      logSpy.mockRestore();
    }
  });
});

describe("Dashboard — the export-to-JSON button reuses the REAL useCodexBackup().downloadAsJson", () => {
  it("triggers the browser download side-effect (Blob + <a>.click) when clicked in the dashboard context", async () => {
    const user = userEvent.setup();

    // Spy the browser download primitives the REAL downloadAsJson drives. If the
    // button called a bespoke serializer instead of the hook, these would not fire.
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:mock");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    // Mount the dashboard directly against a hydrated store so the export button
    // is reachable without the encrypt/unlock round-trip.
    const adapter = await hydrateFromPlaintextSnapshot(populatedStoaChainSnapshot);
    render(
      <CodexProvider adapter={adapter} deviceVariant="dev">
        <Dashboard />
      </CodexProvider>,
    );
    await screen.findByRole("tab", { name: /seed words/i });

    const exportBtn = screen.getByRole("button", { name: /export.*json/i });
    await user.click(exportBtn);

    // The real hook serialized the current store to a Blob URL and clicked a
    // download anchor — the export path went through useCodexBackup, not a fork.
    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(anchorClick).toHaveBeenCalledTimes(1);
    });
    const blobArg = createObjectURL.mock.calls[0][0] as Blob;
    expect(blobArg).toBeInstanceOf(Blob);
    expect(blobArg.type).toBe("application/json");
  });
});
